/** Formatea el JSON devuelto por `approvePendingToolCall` para mostrarlo en el chat. */
export function formatToolResult(result: Record<string, unknown>): string {
  if (typeof result.issue_url === "string") {
    return `Listo. Issue: ${result.issue_url}`;
  }
  if (typeof result.html_url === "string") {
    return `Listo. Repositorio: ${result.html_url}`;
  }
  if (typeof result.note_id === "string" && typeof result.message === "string") {
    return `${result.message} (id: ${result.note_id})`;
  }
  if (typeof result.scheduled_task_id === "string") {
    const lines: string[] = [];
    if (typeof result.message === "string") {
      lines.push(result.message);
    } else {
      lines.push("Tarea programada.");
    }
    lines.push(`Id: ${result.scheduled_task_id}`);
    if (typeof result.status === "string") {
      lines.push(`Estado: ${result.status}`);
    }
    if (typeof result.title === "string") {
      lines.push(`Título: ${result.title}`);
    }
    if (typeof result.next_run_at === "string") {
      lines.push(`Próxima ejecución: ${result.next_run_at}`);
    }
    if (typeof result.next_pre_notify_at === "string") {
      lines.push(`Próximo recordatorio (~${result.pre_notify_minutes ?? 5} min antes): ${result.next_pre_notify_at}`);
    }
    return lines.join("\n");
  }
  if (typeof result.path === "string" && typeof result.content === "string") {
    const head = result.content.slice(0, 6000);
    const more =
      result.content.length > 6000
        ? "\n\n…(contenido truncado en el chat; el archivo es más largo)"
        : "";
    const msg = typeof result.message === "string" ? result.message : "Archivo leído.";
    return `${msg}\n\n**${result.path}**\n\n${head}${more}`;
  }
  if (typeof result.path === "string" && typeof result.bytes_written === "number") {
    const lines = [
      typeof result.message === "string" ? result.message : "Hecho.",
      `Archivo: ${result.path}`,
      `Bytes: ${result.bytes_written}`,
    ];
    if (typeof result.replacements === "number") {
      lines.push(`Reemplazos: ${result.replacements}`);
    }
    return lines.join("\n");
  }
  if (
    typeof result.stdout === "string" ||
    typeof result.stderr === "string" ||
    typeof result.exit_code === "number"
  ) {
    const lines: string[] = [];
    if (typeof result.message === "string") lines.push(result.message);
    if (typeof result.exit_code === "number") {
      lines.push(`Código de salida: ${result.exit_code}`);
    }
    if (typeof result.stdout === "string" && result.stdout.trim()) {
      lines.push("Salida estándar:", result.stdout.trimEnd());
    }
    if (typeof result.stderr === "string" && result.stderr.trim()) {
      lines.push("Error estándar:", result.stderr.trimEnd());
    }
    if (lines.length > 0) return lines.join("\n\n");
  }
  if (typeof result.message === "string") {
    return result.message;
  }
  return JSON.stringify(result, null, 2);
}
