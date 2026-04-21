import type { DbClient } from "@agents/db";
import { insertUserSecureNote } from "@agents/db";

function asArgRecord(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o !== null && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

/**
 * Persists a note after the user approved the deferred `save_secure_note` tool_call.
 * `userId` must come from the authenticated session, not from LLM args.
 */
export async function executeConfirmedSaveSecureNote(
  db: DbClient,
  userId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const a = asArgRecord(args);
  const content = String(a.content ?? "").trim();
  if (!content) {
    throw new Error("Missing content for save_secure_note");
  }
  const title = typeof a.title === "string" ? a.title.trim() : "";
  const row = await insertUserSecureNote(db, userId, {
    title,
    content,
  });
  return {
    message: "Nota guardada de forma segura.",
    note_id: row.id,
    title: row.title || undefined,
  };
}
