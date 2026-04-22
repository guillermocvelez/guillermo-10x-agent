import path from "node:path";

/**
 * Raíz del sandbox de herramientas de archivo (`FILE_TOOLS_WORKSPACE_ROOT` o `process.cwd()`).
 */
export function getFileToolsWorkspaceRoot(): string {
  const fromEnv = process.env.FILE_TOOLS_WORKSPACE_ROOT?.trim();
  return path.resolve(fromEnv && fromEnv.length > 0 ? fromEnv : process.cwd());
}

/**
 * Resuelve una ruta relativa al workspace; rechaza absolutas y salidas con `..`.
 */
export function resolveSafeWorkspacePath(
  relativePath: string
): { ok: true; abs: string } | { ok: false; error: string } {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { ok: false, error: "path_required" };
  }
  const trimmed = relativePath.trim();
  if (path.isAbsolute(trimmed)) {
    return { ok: false, error: "path_must_be_relative_to_workspace" };
  }
  const root = getFileToolsWorkspaceRoot();
  const abs = path.resolve(root, trimmed);
  const rel = path.relative(root, abs);
  if (rel.startsWith(`..${path.sep}`) || rel === "..") {
    return { ok: false, error: "path_escapes_workspace" };
  }
  return { ok: true, abs };
}
