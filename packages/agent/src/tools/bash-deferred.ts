import {
  parseAllowlistedCommand,
  runAllowlistedCommand,
} from "./bash-allowlist";

export async function executeConfirmedBash(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = typeof args.command === "string" ? args.command : "";
  const parsed = parseAllowlistedCommand(command);
  if (!parsed.ok) {
    return {
      error: parsed.error,
      message: `Comando no permitido (${parsed.error}). Solo se admiten ls (limitado) y curl https.`,
    };
  }
  try {
    const out = await runAllowlistedCommand(parsed.parsed);
    return {
      message:
        out.exit_code === 0
          ? "Comando ejecutado."
          : "Comando terminó con código distinto de cero.",
      stdout: out.stdout,
      stderr: out.stderr,
      exit_code: out.exit_code,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: "spawn_failed", message: msg };
  }
}
