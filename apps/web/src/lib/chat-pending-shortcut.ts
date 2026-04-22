/** Mensaje de usuario que aprueba la última acción pendiente (sin usar el botón). */
export function matchesPendingApproval(text: string): boolean {
  const t = text.trim();
  return /^(confirmo|sí|si|ok|vale|apruebo|adelante|de acuerdo)\.?$/i.test(t);
}

/** Mensaje de usuario que rechaza la última acción pendiente. */
export function matchesPendingReject(text: string): boolean {
  const t = text.trim();
  return /^(no|cancelar|rechazo)\.?$/i.test(t);
}
