import { NextResponse } from "next/server";
import { createServerClient } from "@agents/db";
import { dispatchScheduledTasks } from "@/lib/scheduled-dispatcher";

/**
 * Invocación periódica (p. ej. cada minuto desde Supabase pg_cron, Vercel Cron o un worker).
 * Autenticación: `Authorization: Bearer <CRON_SECRET>` o cabecera `x-cron-secret: <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  if (bearer !== secret && headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createServerClient();
    const out = await dispatchScheduledTasks(db);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[cron/scheduled-tasks]", e);
    return NextResponse.json({ error: "dispatch_failed" }, { status: 500 });
  }
}
