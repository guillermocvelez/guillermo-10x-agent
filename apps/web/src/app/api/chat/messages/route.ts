import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Historial del chat web (para sincronizar ejecuciones programadas y otras inserciones desde el servidor). */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: session } = await supabase
      .from("agent_sessions")
      .select("id")
      .eq("user_id", user.id)
      .eq("channel", "web")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session?.id) {
      return NextResponse.json({ messages: [] as unknown[] });
    }

    const { data, error } = await supabase
      .from("agent_messages")
      .select("id, role, content, created_at, structured_payload")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch (e) {
    console.error("[api/chat/messages]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
