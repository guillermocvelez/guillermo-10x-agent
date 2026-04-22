import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { UserToolSetting, UserIntegration } from "@agents/types";
import { TOOL_CATALOG, toolRequiresConfirmation } from "./catalog";
import {
  createToolCall,
  updateToolCallStatus,
  insertUserSecureNote,
  getLastUserMessageContent,
  listUserSecureNotes,
  listScheduledTasksForUser,
} from "@agents/db";
import { userMessageAllowsListSecureNotes } from "./list-notes-gate";
import {
  githubListRepos,
  githubListIssues,
  githubCreateIssue,
  githubCreateRepo,
} from "./github-api";
import { parseAllowlistedCommand, runAllowlistedCommand } from "./bash-allowlist";
import {
  workspaceReadFileImpl,
  workspaceWriteFileImpl,
  workspaceEditFileImpl,
} from "./file-tools-impl";
import {
  executeConfirmedScheduleCronTask,
  executeConfirmedSetScheduledTaskStatus,
} from "../scheduled-task-deferred";
import type { AgentToolContext } from "./tool-context";
import { readAgentIdsFromRunnableConfig } from "./runtime-config";

function isToolAvailable(toolId: string, ctx: AgentToolContext): boolean {
  const setting = ctx.enabledTools.find((t) => t.tool_id === toolId);
  if (!setting?.enabled) return false;

  const def = TOOL_CATALOG.find((t) => t.id === toolId);
  if (def?.requires_integration) {
    const hasIntegration = ctx.integrations.some(
      (i) => i.provider === def.requires_integration && i.status === "active"
    );
    if (!hasIntegration) return false;
  }
  return true;
}

function noTokenResponse() {
  return JSON.stringify({
    error: "github_token_missing",
    message:
      "GitHub is not connected or the token could not be loaded. Connect GitHub in Settings.",
  });
}

export function buildLangChainTools(ctx: AgentToolContext) {
  const tools = [];

  if (isToolAvailable("get_user_preferences", ctx)) {
    tools.push(
      tool(
        async () => {
          const { getProfile } = await import("@agents/db");
          const profile = await getProfile(ctx.db, ctx.userId);
          return JSON.stringify({
            name: profile.name,
            timezone: profile.timezone,
            language: profile.language,
            agent_name: profile.agent_name,
          });
        },
        {
          name: "get_user_preferences",
          description: "Returns the current user preferences and agent configuration.",
          schema: z.object({}),
        }
      )
    );
  }

  if (isToolAvailable("list_enabled_tools", ctx)) {
    tools.push(
      tool(
        async () => {
          const enabled = ctx.enabledTools
            .filter((t) => t.enabled)
            .map((t) => t.tool_id);
          return JSON.stringify(enabled);
        },
        {
          name: "list_enabled_tools",
          description: "Lists all tools the user has currently enabled.",
          schema: z.object({}),
        }
      )
    );
  }

  if (isToolAvailable("session_context", ctx)) {
    tools.push(
      tool(
        async (_input, config) => {
          const fromConfig = readAgentIdsFromRunnableConfig(config);
          if (
            fromConfig.userId !== undefined &&
            fromConfig.userId !== ctx.userId
          ) {
            return JSON.stringify({
              error: "context_mismatch",
              message:
                "El userId en RunnableConfig no coincide con el contexto del agente.",
            });
          }
          return JSON.stringify({
            userId: ctx.userId,
            sessionId: ctx.sessionId,
            config_injected: Boolean(
              fromConfig.userId && fromConfig.sessionId
            ),
          });
        },
        {
          name: "session_context",
          description:
            "Returns the current user and session scope from agent runtime context. " +
            "Does not accept user-supplied identities; compares RunnableConfig with the closed context when present.",
          schema: z.object({}),
        }
      )
    );
  }

  if (isToolAvailable("save_secure_note", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("save_secure_note");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "save_secure_note",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const preview =
              input.content.length > 120
                ? `${input.content.slice(0, 117)}...`
                : input.content;
            const titlePart = input.title?.trim()
              ? ` (${input.title.trim()})`
              : "";
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "save_secure_note",
              message: `Confirma guardar esta nota en tu cuenta${titlePart}:\n${preview}`,
            });
          }
          try {
            const row = await insertUserSecureNote(ctx.db, ctx.userId, {
              title: input.title?.trim() ?? "",
              content: input.content.trim(),
            });
            await updateToolCallStatus(ctx.db, record.id, "executed", {
              note_id: row.id,
            });
            return JSON.stringify({
              message: "Nota guardada.",
              note_id: row.id,
            });
          } catch (e) {
            const err = e instanceof Error ? e.message : "save failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: err,
            });
            return JSON.stringify({ error: "save_failed", message: err });
          }
        },
        {
          name: "save_secure_note",
          description:
            "Saves a private note for the authenticated user. Requires in-app or Telegram confirmation before persisting. " +
            "Use when the user explicitly asks to save text as a personal note.",
          schema: z.object({
            title: z.string().optional().describe("Optional title"),
            content: z
              .string()
              .min(1)
              .describe("Note body; will be stored only after user approval"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("list_secure_notes", ctx)) {
    tools.push(
      tool(
        async () => {
          const lastUser = await getLastUserMessageContent(
            ctx.db,
            ctx.sessionId
          );
          if (!lastUser || !userMessageAllowsListSecureNotes(lastUser)) {
            return JSON.stringify({
              error: "intent_not_eligible",
              message:
                "No se listan notas: el mensaje del usuario no es una petición clara de ver/mostrar/listar notas guardadas (debe mencionar notas y la intención de consultarlas). Responde sin usar este resultado como listado.",
            });
          }
          try {
            const notes = await listUserSecureNotes(ctx.db, ctx.userId);
            return JSON.stringify({
              count: notes.length,
              notes: notes.map((n) => ({
                id: n.id,
                title: n.title || null,
                content: n.content,
                created_at: n.created_at,
              })),
            });
          } catch (e) {
            const err = e instanceof Error ? e.message : "list failed";
            return JSON.stringify({ error: "list_failed", message: err });
          }
        },
        {
          name: "list_secure_notes",
          description:
            "Lists the authenticated user's saved private notes from the database. " +
            "Call ONLY when the user's latest message clearly asks to view/show/list their saved notes and mentions notes. " +
            "Do not call for saving notes, general chat, or unrelated requests. Empty schema — eligibility is also validated server-side.",
          schema: z.object({}),
        }
      )
    );
  }

  if (isToolAvailable("github_list_repos", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "github_list_repos",
            input,
            false
          );
          if (!ctx.githubAccessToken) {
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: "no_token",
            });
            return noTokenResponse();
          }
          try {
            const { repos } = await githubListRepos(
              ctx.githubAccessToken,
              input.per_page ?? 10
            );
            const result = {
              message: `Listed ${repos.length} repository(ies).`,
              repos,
            };
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err =
              e instanceof Error ? e.message : "GitHub API error";
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: err,
            });
            return JSON.stringify({ error: "github_api_error", message: err });
          }
        },
        {
          name: "github_list_repos",
          description: "Lists the user's GitHub repositories.",
          schema: z.object({
            per_page: z.number().max(100).optional().default(10),
          }),
        }
      )
    );
  }

  if (isToolAvailable("github_list_issues", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "github_list_issues",
            input,
            false
          );
          if (!ctx.githubAccessToken) {
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: "no_token",
            });
            return noTokenResponse();
          }
          try {
            const { issues } = await githubListIssues(
              ctx.githubAccessToken,
              input.owner,
              input.repo,
              input.state ?? "open"
            );
            const result = {
              message: `Found ${issues.length} issue(s) in ${input.owner}/${input.repo}.`,
              issues,
            };
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err =
              e instanceof Error ? e.message : "GitHub API error";
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: err,
            });
            return JSON.stringify({ error: "github_api_error", message: err });
          }
        },
        {
          name: "github_list_issues",
          description: "Lists issues for a given repository.",
          schema: z.object({
            owner: z.string(),
            repo: z.string(),
            state: z.enum(["open", "closed", "all"]).optional().default("open"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("github_create_issue", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("github_create_issue");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "github_create_issue",
            input,
            needsConfirm
          );
          if (needsConfirm) {
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "github_create_issue",
              message: `Confirma crear el issue "${input.title}" en ${input.owner}/${input.repo}.`,
            });
          }
          if (!ctx.githubAccessToken) {
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: "no_token",
            });
            return noTokenResponse();
          }
          try {
            const result = await githubCreateIssue(
              ctx.githubAccessToken,
              input.owner,
              input.repo,
              input.title,
              input.body ?? ""
            );
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err =
              e instanceof Error ? e.message : "GitHub API error";
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: err,
            });
            return JSON.stringify({ error: "github_api_error", message: err });
          }
        },
        {
          name: "github_create_issue",
          description: "Creates a new issue in a GitHub repository. Requires confirmation.",
          schema: z.object({
            owner: z.string(),
            repo: z.string(),
            title: z.string(),
            body: z.string().optional().default(""),
          }),
        }
      )
    );
  }

  if (isToolAvailable("github_create_repo", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("github_create_repo");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "github_create_repo",
            input,
            needsConfirm
          );
          if (needsConfirm) {
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "github_create_repo",
              message: `Confirma crear el repositorio "${input.name}"${input.private ? " (privado)" : " (público)"}.`,
            });
          }
          if (!ctx.githubAccessToken) {
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: "no_token",
            });
            return noTokenResponse();
          }
          try {
            const result = await githubCreateRepo(
              ctx.githubAccessToken,
              input.name,
              input.description,
              input.private ?? false
            );
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err =
              e instanceof Error ? e.message : "GitHub API error";
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: err,
            });
            return JSON.stringify({ error: "github_api_error", message: err });
          }
        },
        {
          name: "github_create_repo",
          description:
            "Creates a NEW repository on the user's GitHub account via API (not instructions). " +
            "When the user asks to create/open a new repo, initialize a project on GitHub, or names a repo to create, " +
            "you MUST call this tool with `name` (repository name/slug), optional `description`, and `private` (true/false). " +
            "Do NOT answer only with manual steps to use the GitHub website; the user confirms in this app and the repo is created for real.",
          schema: z.object({
            name: z.string().describe("Repository name as on GitHub (e.g. my-app)"),
            description: z
              .string()
              .optional()
              .default("")
              .describe("Optional short description"),
            private: z
              .boolean()
              .optional()
              .default(false)
              .describe("true for private repository, false for public"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("bash_executor", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("bash_executor");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "bash_executor",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const preview =
              input.command.length > 200
                ? `${input.command.slice(0, 197)}...`
                : input.command;
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "bash_executor",
              message: `Confirma ejecutar este comando (solo subconjunto permitido: ls / curl https):\n${preview}`,
            });
          }
          const parsed = parseAllowlistedCommand(input.command);
          if (!parsed.ok) {
            await updateToolCallStatus(ctx.db, record.id, "failed", {
              error: parsed.error,
            });
            return JSON.stringify({
              error: parsed.error,
              message: "Comando no permitido.",
            });
          }
          try {
            const out = await runAllowlistedCommand(parsed.parsed);
            const result = {
              message:
                out.exit_code === 0
                  ? "Comando ejecutado."
                  : "Comando terminó con error.",
              stdout: out.stdout,
              stderr: out.stderr,
              exit_code: out.exit_code,
            };
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "exec failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", { error: err });
            return JSON.stringify({ error: "exec_failed", message: err });
          }
        },
        {
          name: "bash_executor",
          description:
            "Runs a strictly allowlisted one-line command on the server (limited `ls` or HTTPS `curl` only). " +
            "When the user says `ls`, `ls -la`, `curl https://...`, or `bash_executor <line>`, you MUST call this tool with that single line as `command` (for `bash_executor ls`, use command `ls`). " +
            "Always requires user confirmation in the app after you call the tool—do not ask for confirmation in plain chat instead of calling the tool. No pipes, redirects, or arbitrary shell.",
          schema: z.object({
            command: z
              .string()
              .min(1)
              .describe(
                'Single allowlisted line only, e.g. "ls", "ls -la", "ls packages/agent", "curl -s https://example.com" — never include the word bash_executor in this field.'
              ),
          }),
        }
      )
    );
  }

  if (isToolAvailable("workspace_read_file", ctx)) {
    tools.push(
      tool(
        async (input) => {
          try {
            const result = await workspaceReadFileImpl(input.path, {
              max_bytes: input.max_bytes,
              offset_chars: input.offset_chars,
            });
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "read_failed";
            return JSON.stringify({ error: "read_failed", message: err });
          }
        },
        {
          name: "workspace_read_file",
          description:
            "Read a UTF-8 text file inside the agent workspace using a **relative** path (e.g. README.md, packages/agent/src/graph.ts). " +
            "Use this instead of bash for inspecting file contents. Returns content or structured errors (directory, not found, not utf8).",
          schema: z.object({
            path: z
              .string()
              .min(1)
              .describe("Relative path from workspace root; must not escape with .."),
            max_bytes: z
              .number()
              .int()
              .positive()
              .max(524288)
              .optional()
              .describe("Max bytes to read (default cap 512KB)"),
            offset_chars: z
              .number()
              .int()
              .nonnegative()
              .optional()
              .describe("Skip first N UTF-8 characters of the decoded slice"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("workspace_write_file", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("workspace_write_file");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "workspace_write_file",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const preview =
              input.content.length > 120
                ? `${input.content.slice(0, 117)}...`
                : input.content;
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "workspace_write_file",
              message: `Confirma escribir el archivo \`${input.path}\` en el workspace:\n${preview}`,
            });
          }
          try {
            const result = await workspaceWriteFileImpl(input.path, input.content);
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "write_failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", { error: err });
            return JSON.stringify({ error: "write_failed", message: err });
          }
        },
        {
          name: "workspace_write_file",
          description:
            "Create or overwrite a UTF-8 text file at a **relative** path in the workspace. " +
            "Requires user confirmation in the UI. Prefer this over bash redirections for writing files.",
          schema: z.object({
            path: z.string().min(1).describe("Relative path under workspace root"),
            content: z.string().describe("Full file body to write"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("workspace_edit_file", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("workspace_edit_file");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "workspace_edit_file",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const oldPreview =
              input.old_string.length > 80
                ? `${input.old_string.slice(0, 77)}...`
                : input.old_string;
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "workspace_edit_file",
              message: `Confirma editar \`${input.path}\` — reemplazo único de:\n${oldPreview}`,
            });
          }
          try {
            const result = await workspaceEditFileImpl(
              input.path,
              input.old_string,
              input.new_string
            );
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "edit_failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", { error: err });
            return JSON.stringify({ error: "edit_failed", message: err });
          }
        },
        {
          name: "workspace_edit_file",
          description:
            "Replace **exactly one** occurrence of old_string with new_string in a UTF-8 workspace file (relative path). " +
            "Fails if old_string is missing or not unique. Requires confirmation. Safer than ad-hoc sed/bash.",
          schema: z.object({
            path: z.string().min(1).describe("Relative path under workspace root"),
            old_string: z
              .string()
              .min(1)
              .describe("Exact substring to replace; must occur exactly once"),
            new_string: z.string().describe("Replacement text (may be empty to delete the match)"),
          }),
        }
      )
    );
  }

  if (isToolAvailable("schedule_cron_task", ctx)) {
    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("schedule_cron_task");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "schedule_cron_task",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const tp = input.task_prompt;
            const preview = tp.length > 400 ? `${tp.slice(0, 397)}...` : tp;
            const tz = input.timezone ?? "UTC";
            const pre = input.pre_notify_minutes ?? 5;
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "schedule_cron_task",
              message:
                `Confirma esta tarea programada:\n**${input.title}**\nCron: \`${input.cron_expression}\`\nZona: ${tz}\nRecordatorio: ${pre} min antes de cada ejecución.\n\nInstrucciones:\n${preview}`,
            });
          }
          try {
            const result = await executeConfirmedScheduleCronTask(
              ctx.db,
              ctx.userId,
              input as Record<string, unknown>
            );
            if (result.error) {
              await updateToolCallStatus(ctx.db, record.id, "failed", result);
              return JSON.stringify(result);
            }
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "schedule_failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", { error: err });
            return JSON.stringify({ error: "schedule_failed", message: err });
          }
        },
        {
          name: "schedule_cron_task",
          description:
            "Registers a recurring task: server runs the agent on cron and reminds `pre_notify_minutes` before each run (default 5). " +
            "Call this tool as soon as the user wants scheduling (do not ask them to type 'confirm' in chat instead of calling you): the UI shows Approve/Cancel after you call. " +
            "If the user replies 'confirm', 'yes', 'ok' after agreeing parameters in the prior message, call this tool now with those parameters.",
          schema: z.object({
            title: z.string().min(1).describe("Short task name"),
            task_prompt: z
              .string()
              .min(1)
              .describe("Instructions the agent receives on each scheduled run"),
            cron_expression: z
              .string()
              .min(1)
              .describe('Cron, e.g. "0 8 * * *" for daily 08:00 (5-field min hour dom month dow)'),
            timezone: z.string().optional().describe("IANA timezone, default UTC"),
            pre_notify_minutes: z
              .number()
              .int()
              .min(1)
              .max(120)
              .optional()
              .describe("Minutes before each run to send reminder (default 5)"),
          }),
        }
      )
    );

    tools.push(
      tool(
        async () => {
          const rows = await listScheduledTasksForUser(ctx.db, ctx.userId);
          const summary = rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            cron_expression: r.cron_expression,
            timezone: r.timezone,
            pre_notify_minutes: r.pre_notify_minutes,
            next_run_at: r.next_run_at,
            next_pre_notify_at: r.next_pre_notify_at,
            task_prompt_preview:
              r.task_prompt.length > 240 ? `${r.task_prompt.slice(0, 237)}…` : r.task_prompt,
          }));
          return JSON.stringify({ tasks: summary, count: summary.length });
        },
        {
          name: "list_scheduled_tasks",
          description:
            "Lists this user's scheduled cron tasks (id, title, status, cron, next run). Read-only. " +
            "Use before pausing/cancelling so you have the correct UUID for `set_scheduled_task_status`.",
          schema: z.object({}),
        }
      )
    );

    tools.push(
      tool(
        async (input) => {
          const needsConfirm = toolRequiresConfirmation("set_scheduled_task_status");
          const record = await createToolCall(
            ctx.db,
            ctx.sessionId,
            "set_scheduled_task_status",
            input as Record<string, unknown>,
            needsConfirm
          );
          if (needsConfirm) {
            const st = String(input.status).toLowerCase();
            return JSON.stringify({
              pending_confirmation: true,
              tool_call_id: record.id,
              tool_name: "set_scheduled_task_status",
              message: `Confirma el cambio de estado de la tarea programada:\n**Id:** \`${input.scheduled_task_id}\`\n**Nuevo estado:** \`${st}\` (${st === "paused" ? "pausar" : st === "cancelled" ? "cancelar" : "reactivar"})`,
            });
          }
          try {
            const result = await executeConfirmedSetScheduledTaskStatus(
              ctx.db,
              ctx.userId,
              input as Record<string, unknown>
            );
            if (result.error) {
              await updateToolCallStatus(ctx.db, record.id, "failed", result);
              return JSON.stringify(result);
            }
            await updateToolCallStatus(ctx.db, record.id, "executed", result);
            return JSON.stringify(result);
          } catch (e) {
            const err = e instanceof Error ? e.message : "set_status_failed";
            await updateToolCallStatus(ctx.db, record.id, "failed", { error: err });
            return JSON.stringify({ error: "set_status_failed", message: err });
          }
        },
        {
          name: "set_scheduled_task_status",
          description:
            "Sets a scheduled task's status: paused (stop until resumed), cancelled (stopped), or active (resume; next run is recomputed). " +
            "Requires UI/Telegram confirmation. Use list_scheduled_tasks for ids.",
          schema: z.object({
            scheduled_task_id: z
              .string()
              .min(1)
              .describe("Task row UUID from list_scheduled_tasks"),
            status: z.enum(["active", "paused", "cancelled"]),
          }),
        }
      )
    );
  }

  return tools;
}
