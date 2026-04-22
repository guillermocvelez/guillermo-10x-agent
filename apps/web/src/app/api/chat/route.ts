import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createServerClient,
  decryptOAuthToken,
  addMessage,
  getLatestPendingToolCallForSession,
  markPendingToolConfirmationResolvedInMessages,
} from "@agents/db";
import { runAgent } from "@agents/agent";
import {
  approvePendingToolCall,
  rejectPendingToolCall,
} from "@/lib/pending-tool-actions";
import { formatToolResult } from "@/lib/format-tool-result";
import {
  matchesPendingApproval,
  matchesPendingReject,
} from "@/lib/chat-pending-shortcut";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message } = await request.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    const db = createServerClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_system_prompt, agent_name")
      .eq("id", user.id)
      .single();

    const { data: toolSettings } = await supabase
      .from("user_tool_settings")
      .select("*")
      .eq("user_id", user.id);

    const { data: integrations } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");

    const encryptionKey = process.env.OAUTH_ENCRYPTION_KEY;
    const githubRow = (integrations ?? []).find(
      (i: Record<string, unknown>) => i.provider === "github"
    );
    let githubAccessToken: string | null = null;
    if (
      githubRow &&
      encryptionKey &&
      typeof githubRow.encrypted_tokens === "string" &&
      githubRow.encrypted_tokens.length > 0
    ) {
      try {
        githubAccessToken = decryptOAuthToken(
          githubRow.encrypted_tokens as string,
          encryptionKey
        );
      } catch {
        githubAccessToken = null;
      }
    }

    let session = await supabase
      .from("agent_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("channel", "web")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .then((r) => r.data);

    if (!session) {
      const { data } = await supabase
        .from("agent_sessions")
        .insert({
          user_id: user.id,
          channel: "web",
          status: "active",
          budget_tokens_used: 0,
          budget_tokens_limit: 100000,
        })
        .select()
        .single();
      session = data;
    }

    if (!session) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    const pending = await getLatestPendingToolCallForSession(
      db,
      session.id,
      user.id
    );
    if (pending) {
      if (matchesPendingApproval(message)) {
        await addMessage(db, session.id, "user", message);
        const out = await approvePendingToolCall(
          db,
          pending.id,
          user.id,
          encryptionKey
        );
        const responseText = out.ok
          ? formatToolResult(out.result)
          : `No se pudo completar la acción: ${out.error}`;
        if (out.ok) {
          await markPendingToolConfirmationResolvedInMessages(db, pending.id);
        }
        await addMessage(db, session.id, "assistant", responseText);
        return NextResponse.json({
          response: responseText,
          pendingConfirmation: null,
          toolCalls: [pending.tool_name],
        });
      }
      if (matchesPendingReject(message)) {
        await addMessage(db, session.id, "user", message);
        const ok = await rejectPendingToolCall(db, pending.id, user.id);
        if (ok) {
          await markPendingToolConfirmationResolvedInMessages(db, pending.id);
        }
        const responseText = ok
          ? "Acción cancelada."
          : "No había una acción pendiente válida para cancelar.";
        await addMessage(db, session.id, "assistant", responseText);
        return NextResponse.json({
          response: responseText,
          pendingConfirmation: null,
          toolCalls: [],
        });
      }
    }
    // Sin fila `pending_confirmation`: no interceptar "confirmo"/"cancelo" aquí.
    // Si el modelo pidió confirmación solo en texto (p. ej. cron) sin invocar la tool,
    // el usuario puede escribir "confirmo" y `runAgent` debe invocar la herramienta para mostrar Aprobar/Cancelar.

    const result = await runAgent({
      message,
      userId: user.id,
      sessionId: session.id,
      systemPrompt: (profile?.agent_system_prompt as string) ?? "Eres un asistente útil.",
      db,
      enabledTools: (toolSettings ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as string,
        user_id: t.user_id as string,
        tool_id: t.tool_id as string,
        enabled: t.enabled as boolean,
        config_json: (t.config_json as Record<string, unknown>) ?? {},
      })),
      integrations: (integrations ?? []).map((i: Record<string, unknown>) => ({
        id: i.id as string,
        user_id: i.user_id as string,
        provider: i.provider as string,
        scopes: (i.scopes as string[]) ?? [],
        status: i.status as "active" | "revoked" | "expired",
        created_at: i.created_at as string,
      })),
      githubAccessToken,
    });

    return NextResponse.json({
      response: result.pendingConfirmation ? null : result.response,
      pendingConfirmation: result.pendingConfirmation ?? null,
      toolCalls: result.toolCalls,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
