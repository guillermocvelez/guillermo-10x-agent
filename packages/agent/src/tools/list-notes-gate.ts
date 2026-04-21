/**
 * Comprueba si el último mensaje del usuario encaja con listar notas guardadas:
 * debe tratar de notas y de ver/listar/mostrar (no de guardar solo).
 */
export function userMessageAllowsListSecureNotes(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (!/\bnota(s)?\b/i.test(t)) return false;

  const saveOnly =
    /\b(guardar|guarda)\b/i.test(t) &&
    /\b(esta|esto|esto como|como nota|texto siguiente|lo siguiente)\b/i.test(t) &&
    !/\b(ver|mostrar|listar|mu[eé]str|revis|consult)\b/i.test(t);
  if (saveOnly) return false;

  const viewIntent =
    /\b(ver|mostrar|listar|mu[eé]str|ens[eé]ñ|revis|consult|listado)\b/i.test(t) ||
    /\b(puedo\s+ver|quiero\s+ver|podr[ií]a\s+ver|dame\s+(las|mis)|cu[aá]les\s+(son\s+)?(mis\s+)?nota)/i.test(
      t
    ) ||
    /\b(hay\s+nota|tengo\s+nota|notas\s+guardad|lo(s)?\s+que\s+guard)/i.test(t) ||
    /\b(cu[aá]ntas\s+nota|qu[eé]\s+notas)/i.test(t);

  return viewIntent;
}
