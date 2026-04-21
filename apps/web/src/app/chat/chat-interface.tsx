"use client";

import { useState, useRef, useEffect } from "react";

interface StructuredPayload {
  kind?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
  created_at?: string;
  structured_payload?: StructuredPayload | null;
  pendingResolved?: boolean;
}

interface Props {
  agentName: string;
  initialMessages: ChatMessage[];
}

function formatToolResult(result: Record<string, unknown>): string {
  if (typeof result.issue_url === "string") {
    return `Listo. Issue: ${result.issue_url}`;
  }
  if (typeof result.html_url === "string") {
    return `Listo. Repositorio: ${result.html_url}`;
  }
  if (typeof result.note_id === "string" && typeof result.message === "string") {
    return `${result.message} (id: ${result.note_id})`;
  }
  if (typeof result.message === "string") {
    return result.message;
  }
  return JSON.stringify(result, null, 2);
}

export function ChatInterface({ agentName, initialMessages }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function runToolAction(toolCallId: string, action: "approve" | "reject") {
    setActionLoadingId(toolCallId);
    try {
      const res = await fetch(`/api/tool-calls/${toolCallId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));

      setMessages((prev) =>
        prev.map((m) =>
          m.structured_payload?.toolCallId === toolCallId
            ? { ...m, pendingResolved: true }
            : m
        )
      );

      if (action === "reject") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Acción cancelada." },
        ]);
        return;
      }

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              typeof data.error === "string"
                ? `No se pudo completar la acción: ${data.error}`
                : "No se pudo completar la acción.",
          },
        ]);
        return;
      }

      if (data.result && typeof data.result === "object") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: formatToolResult(data.result as Record<string, unknown>),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Acción completada." },
        ]);
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();

      if (data.response) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      }

      if (data.pendingConfirmation) {
        const pc = data.pendingConfirmation as {
          toolCallId: string;
          toolName: string;
          message: string;
        };
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: pc.message,
            structured_payload: {
              kind: "pending_tool_confirmation",
              toolCallId: pc.toolCallId,
              toolName: pc.toolName,
            },
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error al procesar tu mensaje. Intenta de nuevo.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-sm text-neutral-400 py-20">
              <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                ¡Hola! Soy {agentName}
              </p>
              <p className="mt-1">Escribe un mensaje para comenzar.</p>
            </div>
          )}
          {messages.map((msg, i) => {
            const isPendingUi =
              msg.role === "assistant" &&
              msg.structured_payload?.kind === "pending_tool_confirmation" &&
              msg.structured_payload.toolCallId &&
              !msg.pendingResolved;

            return (
              <div
                key={`${i}-${msg.created_at ?? ""}-${msg.content.slice(0, 20)}`}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {isPendingUi && msg.structured_payload?.toolCallId && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-600">
                      <button
                        type="button"
                        disabled={actionLoadingId === msg.structured_payload.toolCallId}
                        onClick={() =>
                          runToolAction(msg.structured_payload!.toolCallId!, "approve")
                        }
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionLoadingId === msg.structured_payload.toolCallId
                          ? "…"
                          : "Aprobar"}
                      </button>
                      <button
                        type="button"
                        disabled={actionLoadingId === msg.structured_payload.toolCallId}
                        onClick={() =>
                          runToolAction(msg.structured_payload!.toolCallId!, "reject")
                        }
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-neutral-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm dark:bg-neutral-800">
                <span className="animate-pulse">Pensando...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <form
          onSubmit={handleSend}
          className="mx-auto flex max-w-2xl gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje..."
            disabled={loading}
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
