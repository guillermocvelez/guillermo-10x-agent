import type { DbClient } from "../client";
import { supabaseErrorMessage } from "../errors";

export interface UserSecureNoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
}

export async function insertUserSecureNote(
  db: DbClient,
  userId: string,
  input: { title: string; content: string }
): Promise<UserSecureNoteRow> {
  const { data, error } = await db
    .from("user_notes")
    .insert({
      user_id: userId,
      title: input.title,
      content: input.content,
    })
    .select()
    .single();
  if (error) {
    const msg = supabaseErrorMessage(error);
    const hint =
      /user_notes|schema cache/i.test(msg)
        ? " Asegúrate de aplicar la migración que crea la tabla `user_notes` (p. ej. `supabase db push`)."
        : "";
    throw new Error(`${msg}${hint}`);
  }
  return data as UserSecureNoteRow;
}

export async function listUserSecureNotes(
  db: DbClient,
  userId: string,
  limit = 200
): Promise<UserSecureNoteRow[]> {
  const { data, error } = await db
    .from("user_notes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    const msg = supabaseErrorMessage(error);
    const hint =
      /user_notes|schema cache/i.test(msg)
        ? " Asegúrate de aplicar la migración que crea la tabla `user_notes`."
        : "";
    throw new Error(`${msg}${hint}`);
  }
  return (data ?? []) as UserSecureNoteRow[];
}

