import { NextResponse } from "next/server";
import {
  createServerClient,
  decryptOAuthToken,
  getToolCallWithSessionUser,
  markPendingToolConfirmationResolvedInMessages,
} from "@agents/db";
import { runAgent } from "@agents/agent";
import {
  approvePendingToolCall,
  rejectPendingToolCall,
} from "@/lib/pending-tool-actions";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number }; message_id: number };
    data: string;
  };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Telegram sendMessage failed:", res.status, body);
  }
}

/** Telegram sends "/cmd@BotName args" when the user picks a command from the menu. */
function parseBotCommand(messageText: string): { command: string; args: string } {
  const trimmed = messageText.trim();
  const i = trimmed.indexOf(" ");
  const head = i === -1 ? trimmed : trimmed.slice(0, i);
  const tail = i === -1 ? "" : trimmed.slice(i + 1).trim();
  const at = head.indexOf("@");
  const command = (at === -1 ? head : head.slice(0, at)).toLowerCase();
  return { command, args: tail };
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function POST(request: Request) {
  if (!BOT_TOKEN) {
    console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN is not set");
    return NextResponse.json({ error: "Bot not configured" }, { status: 503 });
  }

  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    console.error(
      "[telegram/webhook] Secret mismatch: set TELEGRAM_WEBHOOK_SECRET in .env and re-run /api/telegram/setup so Telegram sends the same token in x-telegram-bot-api-secret-token"
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let db: ReturnType<typeof createServerClient>;
  try {
    db = createServerClient();
  } catch (e) {
    console.error("[telegram/webhook] Supabase server client:", e);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  // Handle callback queries (confirmation buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const sep = cb.data.indexOf(":");
    const action = sep === -1 ? cb.data : cb.data.slice(0, sep);
    const toolCallId = sep === -1 ? "" : cb.data.slice(sep + 1);

    const { data: tgAccount } = await db
      .from("telegram_accounts")
      .select("user_id")
      .eq("telegram_user_id", cb.from.id)
      .single();

    if (!toolCallId || !tgAccount?.user_id) {
      await answerCallbackQuery(cb.id, "Sesión no válida");
      return NextResponse.json({ ok: true });
    }

    const row = await getToolCallWithSessionUser(db, toolCallId);
    if (!row || row.user_id !== tgAccount.user_id) {
      await answerCallbackQuery(cb.id, "No autorizado");
      return NextResponse.json({ ok: true });
    }

    if (action === "approve") {
      const key = process.env.OAUTH_ENCRYPTION_KEY;
      await answerCallbackQuery(cb.id, "Aprobado");
      await sendTelegramMessage(cb.message.chat.id, "Ejecutando…");
      const out = await approvePendingToolCall(
        db,
        toolCallId,
        tgAccount.user_id as string,
        key
      );
      if (out.ok) {
        const r = out.result;
        let line = "Listo.";
        if (typeof r.issue_url === "string") line = `Issue: ${r.issue_url}`;
        else if (typeof r.html_url === "string") line = `Repositorio: ${r.html_url}`;
        else if (typeof r.stdout === "string" || typeof r.stderr === "string") {
          const parts: string[] = [];
          if (typeof r.message === "string") parts.push(r.message);
          if (typeof r.exit_code === "number") parts.push(`Salida: código ${r.exit_code}`);
          if (typeof r.stdout === "string" && r.stdout.trim())
            parts.push(r.stdout.trimEnd().slice(0, 3500));
          if (typeof r.stderr === "string" && r.stderr.trim())
            parts.push(`stderr: ${r.stderr.trimEnd().slice(0, 1500)}`);
          line = parts.join("\n\n") || "Listo.";
        }         else if (typeof r.path === "string" && typeof r.bytes_written === "number") {
          line = `${typeof r.message === "string" ? r.message : "Hecho."} ${r.path} (${r.bytes_written} bytes)`;
        } else if (typeof r.scheduled_task_id === "string") {
          const st = typeof r.status === "string" ? ` Estado: ${r.status}.` : "";
          line = `Tarea programada. Id: ${r.scheduled_task_id}.${st} Próxima: ${r.next_run_at ?? "—"}`;
        } else if (typeof r.message === "string") line = r.message;
        else if (typeof r.note_id === "string") {
          line = `Nota guardada (id: ${r.note_id}).`;
        }
        await sendTelegramMessage(cb.message.chat.id, line);
        await markPendingToolConfirmationResolvedInMessages(db, toolCallId);
      } else {
        if (out.error === "OAUTH_ENCRYPTION_KEY is not configured") {
          await sendTelegramMessage(
            cb.message.chat.id,
            "El servidor no tiene configurada la clave de cifrado (OAUTH_ENCRYPTION_KEY), necesaria para GitHub."
          );
        } else {
          await sendTelegramMessage(
            cb.message.chat.id,
            `No se pudo completar: ${out.error}`
          );
        }
      }
    } else if (action === "reject") {
      const ok = await rejectPendingToolCall(db, toolCallId, tgAccount.user_id as string);
      await answerCallbackQuery(cb.id, ok ? "Rechazado" : "No aplicable");
      if (ok) {
        await markPendingToolConfirmationResolvedInMessages(db, toolCallId);
      }
      await sendTelegramMessage(
        cb.message.chat.id,
        ok ? "Acción cancelada." : "No se pudo cancelar (estado inválido)."
      );
    }

    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const telegramUserId = message.from.id;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const { command, args } = parseBotCommand(text);

  // Handle /start (/start@BotName optional)
  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      "¡Hola! Soy tu agente personal.\n\nSi ya tienes cuenta web, ve a Ajustes → Telegram en la web, genera un código de vinculación y envíamelo así:\n/link TU_CODIGO"
    );
    return NextResponse.json({ ok: true });
  }

  // Handle /link CODE (/link@BotName CODE when chosen from the command list)
  if (command === "/link") {
    const code = args.trim().toUpperCase();
    if (!code) {
      await sendTelegramMessage(
        chatId,
        "Indica el código que generaste en la web, por ejemplo:\n/link ABC123"
      );
      return NextResponse.json({ ok: true });
    }

    const { data: linkRecord } = await db
      .from("telegram_link_codes")
      .select("*")
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!linkRecord) {
      await sendTelegramMessage(chatId, "Código inválido o expirado. Genera uno nuevo desde la web.");
      return NextResponse.json({ ok: true });
    }

    await db.from("telegram_accounts").upsert(
      {
        user_id: linkRecord.user_id,
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    await db
      .from("telegram_link_codes")
      .update({ used: true })
      .eq("id", linkRecord.id);

    await sendTelegramMessage(chatId, "¡Cuenta vinculada correctamente! Ya puedes chatear conmigo.");
    return NextResponse.json({ ok: true });
  }

  // Resolve user from telegram_user_id
  const { data: telegramAccount } = await db
    .from("telegram_accounts")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .single();

  if (!telegramAccount) {
    await sendTelegramMessage(
      chatId,
      "No tienes una cuenta vinculada. Usa /link TU_CODIGO (código desde Ajustes en la web)."
    );
    return NextResponse.json({ ok: true });
  }

  const userId = telegramAccount.user_id;

  // Get or create session
  let session = await db
    .from("agent_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
    .then((r) => r.data);

  if (!session) {
    const { data } = await db
      .from("agent_sessions")
      .insert({
        user_id: userId,
        channel: "telegram",
        status: "active",
        budget_tokens_used: 0,
        budget_tokens_limit: 100000,
      })
      .select()
      .single();
    session = data;
  }

  if (!session) {
    await sendTelegramMessage(chatId, "Error interno creando sesión.");
    return NextResponse.json({ ok: true });
  }

  // Load profile, tools, integrations
  const { data: profile } = await db
    .from("profiles")
    .select("agent_system_prompt")
    .eq("id", userId)
    .single();

  const { data: toolSettings } = await db
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", userId);

  const { data: integrations } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  const encryptionKey = process.env.OAUTH_ENCRYPTION_KEY;
  const githubRow = (integrations ?? []).find(
    (i: Record<string, unknown>) => i.provider === "github"
  );
  let githubAccessToken: string | null = null;
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

  try {
    const result = await runAgent({
      message: text,
      userId,
      sessionId: session.id,
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

    if (result.pendingConfirmation) {
      const pc = result.pendingConfirmation;
      await sendTelegramMessage(chatId, pc.message, {
        inline_keyboard: [
          [
            { text: "Aprobar", callback_data: `approve:${pc.toolCallId}` },
            { text: "Cancelar", callback_data: `reject:${pc.toolCallId}` },
          ],
        ],
      });
    } else if (result.response) {
      await sendTelegramMessage(chatId, result.response);
    } else {
      await sendTelegramMessage(chatId, "(Sin respuesta de texto)");
    }
  } catch (error) {
    console.error("Telegram agent error:", error);
    await sendTelegramMessage(chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}
