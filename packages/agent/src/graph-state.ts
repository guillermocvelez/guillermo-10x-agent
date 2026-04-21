import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { PendingToolConfirmation } from "@agents/types";

/**
 * Estado del grafo LangGraph para una petición: memoria a corto plazo del turno.
 * Los mensajes se acumulan con el reducer; el resto describe el contexto de ejecución.
 */
export const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  sessionId: Annotation<string>(),
  userId: Annotation<string>(),
  systemPrompt: Annotation<string>(),
  pendingConfirmation: Annotation<PendingToolConfirmation | null>({
    reducer: (prev, next) => (next === undefined ? prev : next),
    default: () => null,
  }),
});
