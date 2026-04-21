import type { ToolDefinition, ToolRisk } from "@agents/types";

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: "get_user_preferences",
    name: "get_user_preferences",
    description: "Returns the current user preferences and agent configuration.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
  },
  {
    id: "list_enabled_tools",
    name: "list_enabled_tools",
    description: "Lists all tools the user has currently enabled.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
  },
  {
    id: "session_context",
    name: "session_context",
    description:
      "Devuelve el alcance actual de sesión y usuario desde el contexto de runtime (no uses argumentos para suplantar identidades). Útil para depuración y para enseñar el patrón config + cierre.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
  },
  {
    id: "save_secure_note",
    name: "save_secure_note",
    description:
      "Guarda una nota privada asociada al usuario autenticado (título opcional y contenido). Requiere confirmación en la app o Telegram antes de persistir. Úsala solo cuando el usuario pida explícitamente guardar texto como nota; el userId lo inyecta el sistema, no el modelo.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título opcional" },
        content: { type: "string", description: "Texto de la nota" },
      },
      required: ["content"],
    },
  },
  {
    id: "list_secure_notes",
    name: "list_secure_notes",
    description:
      "Lista las notas privadas guardadas del usuario (solo lectura). Invócala únicamente cuando el mensaje actual sea una petición clara de ver, mostrar, listar o consultar sus notas guardadas y mencione notas (p. ej. «¿puedo ver las notas guardadas?»). No la uses para guardar notas, ni si el usuario no habla de notas, ni por iniciativa sin esa intención.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
  },
  {
    id: "github_list_repos",
    name: "github_list_repos",
    description: "Lists the user's GitHub repositories.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        per_page: { type: "number", description: "Results per page (max 30)" },
      },
      required: [],
    },
  },
  {
    id: "github_list_issues",
    name: "github_list_issues",
    description: "Lists issues for a given repository.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
      },
      required: ["owner", "repo"],
    },
  },
  {
    id: "github_create_issue",
    name: "github_create_issue",
    description: "Creates a new issue in a GitHub repository. Requires confirmation.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    id: "github_create_repo",
    name: "github_create_repo",
    description:
      "Creates a new GitHub repository via API when the user asks to create a repo; do not substitute with only manual website steps. Requires confirmation in the app.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name" },
        description: { type: "string", description: "Short description" },
        private: { type: "boolean", description: "Whether the repo is private" },
      },
      required: ["name"],
    },
  },
];

export function getToolRisk(toolId: string): ToolRisk {
  return TOOL_CATALOG.find((t) => t.id === toolId)?.risk ?? "high";
}

export function toolRequiresConfirmation(toolId: string): boolean {
  const risk = getToolRisk(toolId);
  return risk === "medium" || risk === "high";
}
