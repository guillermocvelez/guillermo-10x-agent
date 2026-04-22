/**
 * Si el usuario escribe un comando allowlist explícito, reescribe el turno para el modelo
 * de forma que deba llamar a `bash_executor` (evita respuestas solo en prosa sin tool call).
 */
export function userMessageForBashToolInvocation(
  rawUserMessage: string,
  bashExecutorEnabled: boolean
): string {
  if (!bashExecutorEnabled) return rawUserMessage;
  const t = rawUserMessage.trim();
  if (!t || t.includes("\n")) return rawUserMessage;

  const prefixed = t.match(/^bash_executor\s+(.+)$/i);
  if (prefixed) {
    const line = prefixed[1]!.trim();
    if (!line) return rawUserMessage;
    return (
      "[Instrucción interna — cumple con una llamada a herramienta]\n" +
      `Invoca ahora la herramienta bash_executor con el argumento command exactamente igual a esta línea (allowlist):\n${line}\n\n` +
      "El usuario escribió (referencia): " +
      JSON.stringify(rawUserMessage) +
      "\n\n" +
      "No respondas solo pidiendo confirmación en texto: primero invoca bash_executor; la interfaz mostrará Aprobar/Cancelar."
    );
  }

  if (/^(ls|curl)(\s|$)/i.test(t)) {
    return (
      "[Instrucción interna — cumple con una llamada a herramienta]\n" +
      `Invoca ahora bash_executor con {\"command\": ${JSON.stringify(t)}}.\n\n` +
      "Usuario (referencia): " +
      JSON.stringify(rawUserMessage) +
      "\n\n" +
      "No sustituyas esto por una pregunta conversacional sin tool call."
    );
  }

  return rawUserMessage;
}
