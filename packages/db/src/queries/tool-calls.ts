import type { DbClient } from "../client";
import type { ToolCall } from "@agents/types";
import { supabaseErrorMessage } from "../errors";

export async function createToolCall(
  db: DbClient,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  requiresConfirmation: boolean
) {
  const { data, error } = await db
    .from("tool_calls")
    .insert({
      session_id: sessionId,
      tool_name: toolName,
      arguments_json: args,
      status: requiresConfirmation ? "pending_confirmation" : "approved",
      requires_confirmation: requiresConfirmation,
    })
    .select()
    .single();
  if (error) throw new Error(supabaseErrorMessage(error));
  return data as ToolCall;
}

export async function updateToolCallStatus(
  db: DbClient,
  toolCallId: string,
  status: ToolCall["status"],
  resultJson?: Record<string, unknown>
) {
  const update: Record<string, unknown> = { status };
  if (resultJson) update.result_json = resultJson;
  if (status === "executed" || status === "failed") {
    update.finished_at = new Date().toISOString();
  }
  const { error } = await db
    .from("tool_calls")
    .update(update)
    .eq("id", toolCallId);
  if (error) throw new Error(supabaseErrorMessage(error));
}

export async function getPendingToolCall(db: DbClient, toolCallId: string) {
  const { data } = await db
    .from("tool_calls")
    .select("*")
    .eq("id", toolCallId)
    .eq("status", "pending_confirmation")
    .single();
  return data as ToolCall | null;
}

export type ToolCallWithSessionUser = ToolCall & { user_id: string };

/** Resolves tool_calls row and owning user via agent_sessions (service role or RLS). */
export async function getToolCallWithSessionUser(
  db: DbClient,
  toolCallId: string
) {
  const { data, error } = await db
    .from("tool_calls")
    .select("*, agent_sessions!inner(user_id)")
    .eq("id", toolCallId)
    .single();
  if (error || !data) return null;
  const row = data as ToolCall & {
    agent_sessions: { user_id: string };
  };
  const { agent_sessions, ...toolCall } = row;
  return {
    ...(toolCall as ToolCall),
    user_id: agent_sessions.user_id,
  } as ToolCallWithSessionUser;
}
