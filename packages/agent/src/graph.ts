import { StateGraph, MemorySaver } from "@langchain/langgraph";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { DbClient } from "@agents/db";
import type {
  UserToolSetting,
  UserIntegration,
  PendingToolConfirmation,
} from "@agents/types";
import { createChatModel } from "./model";
import { buildLangChainTools } from "./tools/adapters";
import { buildAgentToolInvokeConfig } from "./tools/runtime-config";
import { getSessionMessages, addMessage } from "@agents/db";
import { GraphState } from "./graph-state";

export interface AgentInput {
  message: string;
  userId: string;
  sessionId: string;
  systemPrompt: string;
  db: DbClient;
  enabledTools: UserToolSetting[];
  integrations: UserIntegration[];
  githubAccessToken?: string | null;
}

export interface AgentOutput {
  response: string;
  toolCalls: string[];
  pendingConfirmation?: PendingToolConfirmation;
}

const MAX_TOOL_ITERATIONS = 6;

function parsePendingFromToolContent(
  content: string
): PendingToolConfirmation | null {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    if (
      o.pending_confirmation === true &&
      typeof o.tool_call_id === "string" &&
      typeof o.tool_name === "string"
    ) {
      return {
        toolCallId: o.tool_call_id,
        toolName: o.tool_name,
        message:
          typeof o.message === "string"
            ? o.message
            : "Se requiere tu confirmación para continuar.",
      };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const {
    message,
    userId,
    sessionId,
    systemPrompt,
    db,
    enabledTools,
    integrations,
    githubAccessToken = null,
  } = input;

  const model = createChatModel();
  const lcTools = buildLangChainTools({
    db,
    userId,
    sessionId,
    enabledTools,
    integrations,
    githubAccessToken,
  });

  const modelWithTools = lcTools.length > 0 ? model.bindTools(lcTools) : model;

  const toolNames = new Set(lcTools.map((t) => t.name));
  let effectiveSystem = systemPrompt;
  const toolHints: string[] = [];
  if (toolNames.has("save_secure_note")) {
    toolHints.push(
      "Si el usuario pide **guardar una nota** o recordatorio privado en su cuenta, usa `save_secure_note` con `content` (y opcionalmente `title`). La app pedirá confirmación antes de guardar."
    );
  }
  if (toolNames.has("list_secure_notes")) {
    toolHints.push(
      "Solo si el usuario pide **ver, mostrar o listar sus notas guardadas** (mensaje con intención de consulta y la idea de «notas»), usa `list_secure_notes`. No la uses para guardar notas ni para otras preguntas."
    );
  }
  if (toolNames.has("github_create_repo")) {
    toolHints.push(
      "Si el usuario pide **crear un repositorio** (nombre concreto, “nuevo repo”, etc.), debes invocar la herramienta `github_create_repo` con ese nombre. No respondas solo con pasos para ir a github.com; aquí la creación es real tras la confirmación en la interfaz."
    );
  }
  if (toolNames.has("github_create_issue")) {
    toolHints.push(
      "Si pide **crear un issue**, usa `github_create_issue` con owner, repo y title."
    );
  }
  if (toolHints.length > 0) {
    effectiveSystem = `${systemPrompt}\n\n---\nHerramientas:\n${toolHints.map((h) => `- ${h}`).join("\n")}`;
  }

  const history = await getSessionMessages(db, sessionId, 30);
  const priorMessages: BaseMessage[] = history.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "assistant") return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  await addMessage(db, sessionId, "user", message);

  const toolCallNames: string[] = [];

  async function agentNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    const response = await modelWithTools.invoke(state.messages);
    return { messages: [response] };
  }

  async function toolExecutorNode(
    state: typeof GraphState.State
  ): Promise<Partial<typeof GraphState.State>> {
    const lastMsg = state.messages[state.messages.length - 1];
    if (!(lastMsg instanceof AIMessage) || !lastMsg.tool_calls?.length) {
      return {};
    }

    const { ToolMessage } = await import("@langchain/core/messages");
    const results: BaseMessage[] = [];
    let pending: PendingToolConfirmation | null = null;
    for (const tc of lastMsg.tool_calls) {
      const matchingTool = lcTools.find((t) => t.name === tc.name);
      toolCallNames.push(tc.name);
      if (matchingTool) {
        const invokeConfig = buildAgentToolInvokeConfig(
          { userId: state.userId, sessionId: state.sessionId },
          state.sessionId
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (matchingTool as any).invoke(tc.args, invokeConfig);
        const str = String(result);
        if (!pending) {
          const p = parsePendingFromToolContent(str);
          if (p) pending = p;
        }
        results.push(new ToolMessage({ content: str, tool_call_id: tc.id! }));
      }
    }
    return {
      messages: results,
      pendingConfirmation: pending,
    };
  }

  function shouldContinue(state: typeof GraphState.State): string {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg instanceof AIMessage && lastMsg.tool_calls?.length) {
      const iterations = state.messages.filter(
        (m) => m instanceof AIMessage && (m as AIMessage).tool_calls?.length
      ).length;
      if (iterations >= MAX_TOOL_ITERATIONS) return "end";
      return "tools";
    }
    return "end";
  }

  function routeAfterTools(state: typeof GraphState.State): string {
    if (state.pendingConfirmation) return "end";
    return "agent";
  }

  const graph = new StateGraph(GraphState)
    .addNode("agent", agentNode)
    .addNode("tools", toolExecutorNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addConditionalEdges("tools", routeAfterTools, {
      agent: "agent",
      end: "__end__",
    });

  const checkpointer = new MemorySaver();
  const app = graph.compile({ checkpointer });

  const initialMessages: BaseMessage[] = [
    new SystemMessage(effectiveSystem),
    ...priorMessages,
    new HumanMessage(message),
  ];

  const finalState = await app.invoke(
    {
      messages: initialMessages,
      sessionId,
      userId,
      systemPrompt,
      pendingConfirmation: null,
    },
    { configurable: { thread_id: sessionId } }
  );

  if (finalState.pendingConfirmation) {
    const pc = finalState.pendingConfirmation;
    await addMessage(db, sessionId, "assistant", pc.message, {
      structured_payload: {
        kind: "pending_tool_confirmation",
        toolCallId: pc.toolCallId,
        toolName: pc.toolName,
      },
    });
    return {
      response: "",
      toolCalls: toolCallNames,
      pendingConfirmation: pc,
    };
  }

  const lastMessage = finalState.messages[finalState.messages.length - 1];
  const responseText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  await addMessage(db, sessionId, "assistant", responseText);

  return { response: responseText, toolCalls: toolCallNames };
}
