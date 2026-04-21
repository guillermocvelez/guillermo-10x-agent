import type { DbClient } from "@agents/db";
import type { UserIntegration, UserToolSetting } from "@agents/types";

/**
 * Contexto de runtime inyectado al construir herramientas (cierre sobre buildLangChainTools).
 * No forma parte de los argumentos que el LLM rellena; sirve para filtrar por usuario y sesión.
 */
export interface AgentToolContext {
  db: DbClient;
  userId: string;
  sessionId: string;
  enabledTools: UserToolSetting[];
  integrations: UserIntegration[];
  githubAccessToken: string | null;
}
