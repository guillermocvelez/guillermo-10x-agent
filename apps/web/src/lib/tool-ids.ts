/**
 * Tool ids that can be toggled in settings / onboarding and persisted to `user_tool_settings`.
 * Keep aligned with `TOOL_CATALOG` in `@agents/agent`.
 */
export const USER_TOGGLEABLE_TOOL_IDS: readonly string[] = [
  "get_user_preferences",
  "list_enabled_tools",
  "session_context",
  "bash_executor",
  "workspace_read_file",
  "workspace_write_file",
  "workspace_edit_file",
  "schedule_cron_task",
  "save_secure_note",
  "list_secure_notes",
  "github_list_repos",
  "github_list_issues",
  "github_create_issue",
  "github_create_repo",
];

/** Optional friendly line in settings (checkbox list uses raw id otherwise). */
export const USER_TOOL_LABEL: Partial<Record<string, string>> = {
  bash_executor:
    "bash_executor — ls / curl HTTPS (alto riesgo, pide confirmación)",
  workspace_read_file: "workspace_read_file — leer archivos del workspace (bajo riesgo)",
  workspace_write_file:
    "workspace_write_file — crear/sobrescribir archivo (medio, pide confirmación)",
  workspace_edit_file:
    "workspace_edit_file — reemplazo único en archivo (medio, pide confirmación)",
  schedule_cron_task:
    "schedule_cron_task — tareas recurrentes (cron + recordatorio; medio, pide confirmación)",
};
