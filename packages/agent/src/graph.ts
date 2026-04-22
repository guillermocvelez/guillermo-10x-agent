import { StateGraph } from "@langchain/langgraph";
import { getGraphCheckpointer } from "./checkpointer";

/** Human-in-the-loop: medium/high tools return `pending_confirmation` JSON; approval runs in the web API
 *  (`approvePendingToolCall`) so OAuth secrets stay server-side. Checkpoints use Postgres when configured
 *  (see `getGraphCheckpointer`). For native `interrupt()` + `commandResume`, see `hil.ts`. */
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
import { userMessageForBashToolInvocation } from "./bash-user-routing";

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
      "Si el usuario pide **guardar una nota** o recordatorio privado en su cuenta, usa `save_secure_note` con `content` (y opcionalmente `title`). La app pedirá confirmación antes de guardar. " +
        "**No** uses `save_secure_note` si el usuario solo escribe confirmaciones genéricas ('confirmo', 'sí', 'ok', 'vale') sin pedir explícitamente guardar una nota ni dar el texto a guardar. **No** inventes títulos o cuerpos de notas que el usuario no haya escrito literalmente."
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
  if (toolNames.has("bash_executor")) {
    toolHints.push(
      "Si pide **listar archivos** o **curl HTTPS**, debes **invocar** `bash_executor` con `command` en una sola línea (`ls`, `ls -la`, `curl …`). Si el usuario escribe `bash_executor ls`, el valor de `command` es `ls` (no repitas el prefijo `bash_executor` dentro de `command`). La app mostrará Aprobar/Cancelar; **no** pidas confirmación solo en texto sin invocar la herramienta."
    );
  }
  if (toolNames.has("schedule_cron_task")) {
    toolHints.push(
      "Si el usuario pide **automatizar** algo periódico (cada minuto, diario, etc.), **invoca en el mismo turno** `schedule_cron_task` con `title`, `task_prompt`, `cron_expression` (p. ej. `* * * * *` cada minuto en zona elegida, `0 8 * * *` diario a las 8:00). Opcional: `timezone` (IANA) y `pre_notify_minutes` (1–120; con cron cada minuto usa `1` si quieres recordatorio coherente). **Nunca** sustituyas la herramienta por «¿confirmas?» / «confirma para continuar» solo en texto: sin invocación no aparecen botones. Si ya acordaste parámetros y el usuario responde «confirmo», «sí», «adelante», etc., **invoca entonces** `schedule_cron_task` con esos datos."
    );
  }
  if (toolNames.has("list_scheduled_tasks")) {
    toolHints.push(
      "Si el usuario pregunta por sus **tareas programadas**, cron agendados o quiere el **id** para pausar, usa `list_scheduled_tasks`."
    );
  }
  if (toolNames.has("set_scheduled_task_status")) {
    toolHints.push(
      "Para **parar, pausar o cancelar** una tarea recurrente, usa `set_scheduled_task_status` con el UUID (`list_scheduled_tasks`) y `status`: `paused`, `cancelled` o `active` para reanudar. Requiere Aprobar en la interfaz."
    );
  }
  if (
    toolNames.has("workspace_read_file") ||
    toolNames.has("workspace_write_file") ||
    toolNames.has("workspace_edit_file")
  ) {
    toolHints.push(
      "Para **leer, crear o editar archivos del repositorio** (texto UTF-8), usa `workspace_read_file`, `workspace_write_file` y `workspace_edit_file` con **path relativo** al workspace (no rutas absolutas). **No** uses `bash_executor` con `>` o heredocs para escribir archivos; esas operaciones van con las herramientas workspace_*."
    );
  }
  if (toolHints.length > 0) {
    effectiveSystem = `${systemPrompt}\n\n---\nHerramientas:\n${toolHints.map((h) => `- ${h}`).join("\n")}`;
    effectiveSystem +=
      "\n\n---\nConfirmaciones: para acciones con riesgo (notas, GitHub, bash, archivos en disco, **tareas cron** programadas, etc.) **invoca siempre la herramienta** correspondiente; la interfaz mostrará botones **Aprobar** / **Cancelar**. No sustituyas eso con una pregunta en texto sin invocar la tool: el usuario no verá botones. Para listar nombres en disco sigue siendo válido `bash_executor` con `ls`; para **ver el contenido** de un fichero usa `workspace_read_file`.";
  }

  const history = await getSessionMessages(db, sessionId, 30);
  const priorMessages: BaseMessage[] = history.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "assistant") return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  await addMessage(db, sessionId, "user", message);

  const humanTurnForModel = userMessageForBashToolInvocation(
    message,
    toolNames.has("bash_executor")
  );

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

  const checkpointer = await getGraphCheckpointer();
  const app = graph.compile({ checkpointer });

  const initialMessages: BaseMessage[] = [
    new SystemMessage(effectiveSystem),
    ...priorMessages,
    new HumanMessage(humanTurnForModel),
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
