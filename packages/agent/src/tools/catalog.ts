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
    id: "bash_executor",
    name: "bash_executor",
    description:
      "Ejecuta en el servidor un subconjunto acotado de comandos (solo `ls` con flags -l/-a y ruta relativa segura, o `curl` HTTPS GET). Alto riesgo: siempre requiere confirmación en la app o Telegram antes de ejecutar. No uses para shell libre, pipes ni redirecciones.",
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            'Una sola línea. Ejemplos permitidos: "ls", "ls -la", "ls -la src"; "curl -s https://example.com".',
        },
      },
      required: ["command"],
    },
  },
  {
    id: "workspace_read_file",
    name: "workspace_read_file",
    description:
      "Lee un archivo de texto UTF-8 dentro del workspace del agente (ruta relativa). Límite de tamaño por defecto; usa offset/max_bytes para fragmentos. Preferible a bash para inspeccionar código o docs.",
    risk: "low",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta relativa al workspace, p. ej. README.md o packages/agent/src/graph.ts" },
        max_bytes: { type: "number", description: "Techo de lectura en bytes (opcional, máx. 524288)" },
        offset_chars: { type: "number", description: "Recorte inicial en caracteres UTF-8 (opcional)" },
      },
      required: ["path"],
    },
  },
  {
    id: "workspace_write_file",
    name: "workspace_write_file",
    description:
      "Crea o sobrescribe un archivo de texto en el workspace (ruta relativa). Riesgo medio: requiere confirmación en la app antes de escribir. No uses bash con redirecciones para esto.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta relativa al workspace" },
        content: { type: "string", description: "Contenido completo UTF-8 del archivo" },
      },
      required: ["path", "content"],
    },
  },
  {
    id: "workspace_edit_file",
    name: "workspace_edit_file",
    description:
      "Reemplaza exactamente una ocurrencia de old_string por new_string en un archivo UTF-8 del workspace. Riesgo medio: requiere confirmación. old_string debe aparecer una sola vez o la operación falla.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta relativa al workspace" },
        old_string: { type: "string", description: "Fragmento exacto a buscar (una sola coincidencia)" },
        new_string: { type: "string", description: "Texto de reemplazo" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    id: "schedule_cron_task",
    name: "schedule_cron_task",
    description:
      "Registra una tarea periódica: el servidor invoca al agente según el cron y envía recordatorio antes de cada ejecución. Debes invocar esta herramienta (no pedir solo «confirma en el chat»): la interfaz muestra Aprobar/Cancelar tras la invocación. Expresiones cron 5 o 6 campos.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Nombre corto de la tarea" },
        task_prompt: {
          type: "string",
          description: "Instrucciones que recibirá el agente en cada ejecución (qué hacer / qué resumir)",
        },
        cron_expression: {
          type: "string",
          description: 'Ej. "0 8 * * *" (cada día 8:00) o seis campos con segundos según cron-parser',
        },
        timezone: { type: "string", description: "IANA, p. ej. Europe/Madrid; por defecto UTC" },
        pre_notify_minutes: {
          type: "number",
          description: "Minutos antes de cada ejecución para el recordatorio (1–120, default 5)",
        },
      },
      required: ["title", "task_prompt", "cron_expression"],
    },
  },
  {
    id: "list_scheduled_tasks",
    name: "list_scheduled_tasks",
    description:
      "Lista las tareas programadas (cron) del usuario autenticado: id, título, estado, expresión cron y próxima ejecución. Sin efectos secundarios. Disponible cuando el usuario tiene habilitada la familia de tareas programadas.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
  },
  {
    id: "set_scheduled_task_status",
    name: "set_scheduled_task_status",
    description:
      "Cambia el estado de una tarea programada del usuario: paused (detener temporalmente), cancelled (dar por cerrada) o active (reanudar; recalcula próxima ejecución). Requiere confirmación en la app/Telegram.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        scheduled_task_id: { type: "string", description: "UUID de la fila en scheduled_tasks" },
        status: {
          type: "string",
          description: "active | paused | cancelled",
        },
      },
      required: ["scheduled_task_id", "status"],
    },
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
