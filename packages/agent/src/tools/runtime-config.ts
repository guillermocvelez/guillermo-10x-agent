import type { RunnableConfig } from "@langchain/core/runnables";

/** Claves en `config.configurable` para contexto del agente (inyectado al invocar la tool). */
export const AGENT_CONFIGURABLE_KEYS = {
  userId: "agentUserId",
  sessionId: "agentSessionId",
} as const;

/**
 * Config que se pasa a `tool.invoke(args, config)` para que las herramientas puedan leer
 * user/session desde RunnableConfig (además del cierre), alineado con el patrón config de LangChain.
 */
export function buildAgentToolInvokeConfig(
  agent: { userId: string; sessionId: string },
  threadId: string
): RunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
      [AGENT_CONFIGURABLE_KEYS.userId]: agent.userId,
      [AGENT_CONFIGURABLE_KEYS.sessionId]: agent.sessionId,
    },
  };
}

export function readAgentIdsFromRunnableConfig(
  config?: RunnableConfig
): { userId?: string; sessionId?: string } {
  const c = config?.configurable as Record<string, unknown> | undefined;
  const uid = c?.[AGENT_CONFIGURABLE_KEYS.userId];
  const sid = c?.[AGENT_CONFIGURABLE_KEYS.sessionId];
  return {
    userId: typeof uid === "string" ? uid : undefined,
    sessionId: typeof sid === "string" ? sid : undefined,
  };
}
