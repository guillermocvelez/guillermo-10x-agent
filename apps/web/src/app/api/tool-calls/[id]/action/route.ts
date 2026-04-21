import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  approvePendingToolCall,
  rejectPendingToolCall,
} from "@/lib/pending-tool-actions";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const action = body.action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (action === "reject") {
      const ok = await rejectPendingToolCall(supabase, id, user.id);
      if (!ok) {
        return NextResponse.json({ error: "Not found or invalid state" }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    const key = process.env.OAUTH_ENCRYPTION_KEY;
    const out = await approvePendingToolCall(supabase, id, user.id, key);
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.httpStatus });
    }
    return NextResponse.json({ ok: true, result: out.result });
  } catch (e) {
    console.error("tool-calls action:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Error interno al procesar la acción",
      },
      { status: 500 }
    );
  }
}
