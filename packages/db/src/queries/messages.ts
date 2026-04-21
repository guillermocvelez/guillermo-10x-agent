import type { DbClient } from "../client";
import type { AgentMessage, MessageRole } from "@agents/types";

export async function addMessage(
  db: DbClient,
  sessionId: string,
  role: MessageRole,
  content: string,
  extra?: { tool_call_id?: string; structured_payload?: Record<string, unknown> }
) {
  const { data, error } = await db
    .from("agent_messages")
    .insert({ session_id: sessionId, role, content, ...extra })
    .select()
    .single();
  if (error) throw error;
  return data as AgentMessage;
}

export async function getSessionMessages(
  db: DbClient,
  sessionId: string,
  limit = 50
) {
  const { data, error } = await db
    .from("agent_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AgentMessage[];
}

/** Último mensaje con role `user` en la sesión (más reciente). */
export async function getLastUserMessageContent(
  db: DbClient,
  sessionId: string,
  lookback = 120
): Promise<string | null> {
  const rows = await getSessionMessages(db, sessionId, lookback);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role === "user") return rows[i].content;
  }
  return null;
}
