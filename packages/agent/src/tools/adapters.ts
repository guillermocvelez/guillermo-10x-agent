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
} from "@agents/db";
import { userMessageAllowsListSecureNotes } from "./list-notes-gate";
import {
  githubListRepos,
  githubListIssues,
  githubCreateIssue,
  githubCreateRepo,
} from "./github-api";
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

  return tools;
}
