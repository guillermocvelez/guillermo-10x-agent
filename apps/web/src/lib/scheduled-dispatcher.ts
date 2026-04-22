import type { ScheduledTask } from "@agents/types";
import type { DbClient } from "@agents/db";
import type { AgentOutput } from "@agents/agent";
import {
  listScheduledTasksDueForMainRun,
  listScheduledTasksDueForPreNotify,
  advanceScheduledTaskAfterMainRun,
  markScheduledTaskPreNotified,
  getTelegramChatIdForUser,
  decryptOAuthToken,
  getOrCreateSession,
  addMessage,
} from "@agents/db";
import { runAgent, getNextRunPair } from "@agents/agent";
import { sendTelegramText } from "@/lib/telegram-notify";

/** Cada iteración del cron queda visible en el chat web (sesión `channel=web`). */
async function appendScheduledRunToWebChat(
  db: DbClient,
  task: ScheduledTask,
  phase: "pre_notify" | "main",
  result: AgentOutput
): Promise<void> {
  const web = await getOrCreateSession(db, task.user_id, "web");
  const whenIso = new Date(task.next_run_at).toISOString();

  if (result.pendingConfirmation) {
    const pc = result.pendingConfirmation;
    await addMessage(db, web.id, "assistant", pc.message, {
      structured_payload: {
        kind: "pending_tool_confirmation",
        toolCallId: pc.toolCallId,
        toolName: pc.toolName,
      },
    });
    return;
  }

  const header =
    phase === "pre_notify"
      ? `**Recordatorio programado** · *${task.title}*\nEjecución prevista: \`${whenIso}\` · cron \`${task.cron_expression}\``
      : `**Tarea programada** · ejecución · *${task.title}*\nCron: \`${task.cron_expression}\` · zona \`${task.timezone}\``;
  const body = (result.response?.trim() || "_(Sin respuesta de texto del modelo.)_").slice(0, 45000);
  const content = `${header}\n\n---\n\n${body}`;
  await addMessage(db, web.id, "assistant", content, {
    structured_payload: {
      kind: "scheduled_task_run",
      phase,
      scheduled_task_id: task.id,
      task_title: task.title,
    },
  });
}

async function getOrCreateScheduledSession(
  db: DbClient,
  userId: string
): Promise<string> {
  const { data: existing } = await db
    .from("agent_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("channel", "scheduled")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await db
    .from("agent_sessions")
    .insert({
      user_id: userId,
      channel: "scheduled",
      status: "active",
      budget_tokens_used: 0,
      budget_tokens_limit: 100000,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function runScheduledInvocation(
  db: DbClient,
  task: ScheduledTask,
  phase: "pre_notify" | "main",
  encryptionKey: string | undefined
): Promise<void> {
  const { data: profile } = await db
    .from("profiles")
    .select("agent_system_prompt")
    .eq("id", task.user_id)
    .single();

  const { data: toolSettings } = await db
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", task.user_id);

  const { data: integrations } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", task.user_id)
    .eq("status", "active");

  let githubAccessToken: string | null = null;
  const githubRow = (integrations ?? []).find(
    (i: Record<string, unknown>) => i.provider === "github"
  );
  if (
    githubRow &&
    encryptionKey &&
    typeof githubRow.encrypted_tokens === "string" &&
    githubRow.encrypted_tokens.length > 0
  ) {
    try {
      githubAccessToken = decryptOAuthToken(
        githubRow.encrypted_tokens as string,
        encryptionKey
      );
    } catch {
      githubAccessToken = null;
    }
  }

  const sessionId = await getOrCreateScheduledSession(db, task.user_id);
  const when = new Date(task.next_run_at).toISOString();
  const intro =
    phase === "pre_notify"
      ? `[Recordatorio programado] En unos ${task.pre_notify_minutes} minutos (ejecución prevista ${when}) se ejecutará la tarea **${task.title}**. Puedes preparar contexto; en la ejecución se usará el mismo prompt.`
      : `[Tarea programada — ejecución] **${task.title}**`;
  const message = `${intro}\n\n---\n\n${task.task_prompt}`;

  const result = await runAgent({
    message,
    userId: task.user_id,
    sessionId,
    systemPrompt: profile?.agent_system_prompt ?? "Eres un asistente útil.",
    db,
    enabledTools: (toolSettings ?? []).map((t: Record<string, unknown>) => ({
      id: t.id as string,
      user_id: t.user_id as string,
      tool_id: t.tool_id as string,
      enabled: t.enabled as boolean,
      config_json: (t.config_json as Record<string, unknown>) ?? {},
    })),
    integrations: (integrations ?? []).map((i: Record<string, unknown>) => ({
      id: i.id as string,
      user_id: i.user_id as string,
      provider: i.provider as string,
      scopes: (i.scopes as string[]) ?? [],
      status: i.status as "active" | "revoked" | "expired",
      created_at: i.created_at as string,
    })),
    githubAccessToken,
  });

  await appendScheduledRunToWebChat(db, task, phase, result);

  const chatId = await getTelegramChatIdForUser(db, task.user_id);
  if (chatId != null) {
    const lines: string[] = [];
    if (phase === "pre_notify") {
      lines.push(`⏳ Recordatorio: **${task.title}**`);
    } else {
      lines.push(`✅ Tarea programada: **${task.title}**`);
    }
    if (result.pendingConfirmation) {
      lines.push(result.pendingConfirmation.message);
      lines.push("(Acción pendiente de aprobación en la web.)");
    } else if (result.response) {
      lines.push(result.response.slice(0, 3500));
    } else {
      lines.push("(Sin respuesta de texto)");
    }
    await sendTelegramText(chatId, lines.join("\n\n"));
  }
}

/**
 * Procesa ejecuciones principales (cron vencido) y recordatorios (T−N minutos).
 * Debe llamarse ~cada minuto vía `POST /api/cron/scheduled-tasks` con `CRON_SECRET`.
 */
export async function dispatchScheduledTasks(
  db: DbClient
): Promise<{ main: number; pre: number; errors: string[] }> {
  const encryptionKey = process.env.OAUTH_ENCRYPTION_KEY;
  const nowIso = new Date().toISOString();
  const errors: string[] = [];
  let main = 0;
  let pre = 0;

  const mainTasks = await listScheduledTasksDueForMainRun(db, nowIso);
  for (const task of mainTasks) {
    try {
      await runScheduledInvocation(db, task, "main", encryptionKey);
      const { next_run_at, next_pre_notify_at } = getNextRunPair(
        task.cron_expression,
        task.timezone,
        task.pre_notify_minutes,
        new Date()
      );
      await advanceScheduledTaskAfterMainRun(
        db,
        task.id,
        next_run_at,
        next_pre_notify_at
      );
      main += 1;
    } catch (e) {
      errors.push(`main ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const preTasks = await listScheduledTasksDueForPreNotify(db, nowIso);
  for (const task of preTasks) {
    try {
      await runScheduledInvocation(db, task, "pre_notify", encryptionKey);
      await markScheduledTaskPreNotified(db, task.id);
      pre += 1;
    } catch (e) {
      errors.push(`pre ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { main, pre, errors };
}
