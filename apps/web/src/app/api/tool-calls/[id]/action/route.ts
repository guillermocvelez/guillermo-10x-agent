import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, markPendingToolConfirmationResolvedInMessages } from "@agents/db";
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

    /** Service role: evita fallos RLS con `tool_calls` de sesiones `scheduled` u otras lecturas cruzadas. */
    const db = createServerClient();

    if (action === "reject") {
      const ok = await rejectPendingToolCall(db, id, user.id);
      if (!ok) {
        return NextResponse.json({ error: "Not found or invalid state" }, { status: 400 });
      }
      await markPendingToolConfirmationResolvedInMessages(db, id);
      return NextResponse.json({ ok: true });
    }

    const key = process.env.OAUTH_ENCRYPTION_KEY;
    const out = await approvePendingToolCall(db, id, user.id, key);
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.httpStatus });
    }
    await markPendingToolConfirmationResolvedInMessages(db, id);
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
