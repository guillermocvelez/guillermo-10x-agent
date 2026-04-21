/** Normaliza errores de PostgREST / Supabase (no siempre son `instanceof Error`). */
export function supabaseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof (error as { details: unknown }).details === "string"
  ) {
    return (error as { details: string }).details;
  }
  return String(error);
}
