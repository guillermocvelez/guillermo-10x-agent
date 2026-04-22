import type { DbClient } from "@agents/db";
import {
  getToolCallWithSessionUser,
  updateToolCallStatus,
  decryptOAuthToken,
  supabaseErrorMessage,
} from "@agents/db";
import {
  executeConfirmedGithubTool,
  executeConfirmedSaveSecureNote,
  executeConfirmedBash,
  executeConfirmedWorkspaceWrite,
  executeConfirmedWorkspaceEdit,
  executeConfirmedScheduleCronTask,
  executeConfirmedSetScheduledTaskStatus,
} from "@agents/agent";

function errMsg(e: unknown): string {
  return supabaseErrorMessage(e);
}

export async function approvePendingToolCall(
  db: DbClient,
  toolCallId: string,
  ownerUserId: string,
  encryptionKey: string | undefined
): Promise<
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; httpStatus: number }
> {
  try {
    return await approvePendingToolCallInner(
      db,
      toolCallId,
      ownerUserId,
      encryptionKey
    );
  } catch (e) {
    const msg = errMsg(e);
    try {
      await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg, httpStatus: 500 };
  }
}

async function approvePendingToolCallInner(
  db: DbClient,
  toolCallId: string,
  ownerUserId: string,
  encryptionKey: string | undefined
): Promise<
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; httpStatus: number }
> {
  const row = await getToolCallWithSessionUser(db, toolCallId);
  if (!row || row.user_id !== ownerUserId) {
    return { ok: false, error: "Not found", httpStatus: 404 };
  }
  if (row.status !== "pending_confirmation") {
    return { ok: false, error: "Invalid state", httpStatus: 400 };
  }

  const name = row.tool_name;

  if (name === "save_secure_note") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedSaveSecureNote(
        db,
        ownerUserId,
        row.arguments_json as Record<string, unknown>
      );
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore secondary failure */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "bash_executor") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedBash(
        row.arguments_json as Record<string, unknown>
      );
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "workspace_write_file") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedWorkspaceWrite(
        row.arguments_json as Record<string, unknown>
      );
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "workspace_edit_file") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedWorkspaceEdit(
        row.arguments_json as Record<string, unknown>
      );
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "schedule_cron_task") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedScheduleCronTask(
        db,
        ownerUserId,
        row.arguments_json as Record<string, unknown>
      );
      if (result.error) {
        await updateToolCallStatus(db, toolCallId, "failed", result);
        return {
          ok: false,
          error: String(result.message ?? result.error),
          httpStatus: 400,
        };
      }
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "set_scheduled_task_status") {
    try {
      await updateToolCallStatus(db, toolCallId, "approved");
      const result = await executeConfirmedSetScheduledTaskStatus(
        db,
        ownerUserId,
        row.arguments_json as Record<string, unknown>
      );
      if (result.error) {
        await updateToolCallStatus(db, toolCallId, "failed", result);
        return {
          ok: false,
          error: String(result.message ?? result.error),
          httpStatus: 400,
        };
      }
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  if (name === "github_create_issue" || name === "github_create_repo") {
    if (!encryptionKey) {
      return {
        ok: false,
        error: "OAUTH_ENCRYPTION_KEY is not configured",
        httpStatus: 500,
      };
    }

    const { data: integ } = await db
      .from("user_integrations")
      .select("encrypted_tokens")
      .eq("user_id", ownerUserId)
      .eq("provider", "github")
      .eq("status", "active")
      .maybeSingle();

    if (!integ?.encrypted_tokens) {
      await updateToolCallStatus(db, toolCallId, "failed", {
        error: "github_not_connected",
      });
      return { ok: false, error: "GitHub not connected", httpStatus: 400 };
    }

    let token: string;
    try {
      token = decryptOAuthToken(integ.encrypted_tokens as string, encryptionKey);
    } catch {
      await updateToolCallStatus(db, toolCallId, "failed", {
        error: "decrypt_failed",
      });
      return { ok: false, error: "Could not decrypt token", httpStatus: 500 };
    }

    await updateToolCallStatus(db, toolCallId, "approved");

    try {
      const result = await executeConfirmedGithubTool(
        row.tool_name,
        row.arguments_json,
        token
      );
      await updateToolCallStatus(db, toolCallId, "executed", result);
      return { ok: true, result };
    } catch (e) {
      const msg = errMsg(e);
      try {
        await updateToolCallStatus(db, toolCallId, "failed", { error: msg });
      } catch {
        /* ignore */
      }
      return { ok: false, error: msg, httpStatus: 500 };
    }
  }

  return {
    ok: false,
    error: `Unsupported tool for approval: ${name}`,
    httpStatus: 400,
  };
}

export async function rejectPendingToolCall(
  db: DbClient,
  toolCallId: string,
  ownerUserId: string
): Promise<boolean> {
  try {
    const row = await getToolCallWithSessionUser(db, toolCallId);
    if (!row || row.user_id !== ownerUserId) return false;
    if (row.status !== "pending_confirmation") return false;
    await updateToolCallStatus(db, toolCallId, "rejected");
    return true;
  } catch {
    return false;
  }
}
