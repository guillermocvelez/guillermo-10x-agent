import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafeWorkspacePath, getFileToolsWorkspaceRoot } from "./workspace-path";

const DEFAULT_MAX_READ = 512 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

function maxReadBytes(requested?: number): number {
  const cap = Math.min(
    typeof requested === "number" && requested > 0
      ? Math.floor(requested)
      : DEFAULT_MAX_READ,
    DEFAULT_MAX_READ
  );
  return Math.max(1, cap);
}

export async function workspaceReadFileImpl(
  relativePath: string,
  options?: { max_bytes?: number; offset_chars?: number }
): Promise<Record<string, unknown>> {
  const resolved = resolveSafeWorkspacePath(relativePath);
  if (!resolved.ok) {
    return { error: resolved.error, message: "Ruta no válida para lectura." };
  }
  const { abs } = resolved;
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { error: "not_found", message: `No existe: ${relativePath}` };
  }
  if (st.isDirectory()) {
    return {
      error: "is_directory",
      message: "Error: la ruta especificada es un directorio, no un archivo.",
    };
  }
  const maxBytes = maxReadBytes(options?.max_bytes);
  const offset =
    typeof options?.offset_chars === "number" && options.offset_chars > 0
      ? Math.floor(options.offset_chars)
      : 0;

  const buf = await fs.readFile(abs);
  const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(slice);
  } catch {
    return {
      error: "not_utf8",
      message: "El archivo no es texto UTF-8 válido en el rango leído (o es binario).",
    };
  }
  const content =
    offset > 0 && offset < text.length ? text.slice(offset) : text;
  const truncated = buf.length > maxBytes || offset > 0;
  return {
    message: "Archivo leído.",
    path: relativePath.trim(),
    workspace_root: getFileToolsWorkspaceRoot(),
    content,
    truncated,
    bytes_read: Buffer.byteLength(content, "utf8"),
  };
}

export async function workspaceWriteFileImpl(
  relativePath: string,
  content: string
): Promise<Record<string, unknown>> {
  const resolved = resolveSafeWorkspacePath(relativePath);
  if (!resolved.ok) {
    return { error: resolved.error, message: "Ruta no válida para escritura." };
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    return {
      error: "content_too_large",
      message: `Contenido demasiado grande (máx. ${MAX_WRITE_BYTES} bytes).`,
    };
  }
  const { abs } = resolved;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return {
    message: "Archivo escrito.",
    path: relativePath.trim(),
    workspace_root: getFileToolsWorkspaceRoot(),
    bytes_written: bytes,
  };
}

export async function workspaceEditFileImpl(
  relativePath: string,
  oldString: string,
  newString: string
): Promise<Record<string, unknown>> {
  const resolved = resolveSafeWorkspacePath(relativePath);
  if (!resolved.ok) {
    return { error: resolved.error, message: "Ruta no válida para edición." };
  }
  if (!oldString) {
    return {
      error: "empty_old_string",
      message: "Error: old_string no puede estar vacío.",
    };
  }
  const { abs } = resolved;
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return { error: "not_found", message: `No existe: ${relativePath}` };
  }
  if (st.isDirectory()) {
    return {
      error: "is_directory",
      message: "Error: la ruta especificada es un directorio.",
    };
  }
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch {
    return {
      error: "read_failed",
      message: "No se pudo leer el archivo como UTF-8.",
    };
  }
  const count = raw.split(oldString).length - 1;
  if (count === 0) {
    return {
      error: "old_string_not_found",
      message: "Error: el texto a reemplazar no se encontró en el archivo.",
    };
  }
  if (count > 1) {
    return {
      error: "old_string_not_unique",
      message: `Error: old_string aparece ${count} veces; debe ser único para un reemplazo seguro.`,
    };
  }
  const updated = raw.replace(oldString, newString);
  const newBytes = Buffer.byteLength(updated, "utf8");
  if (newBytes > MAX_WRITE_BYTES) {
    return {
      error: "result_too_large",
      message: "El resultado tras editar supera el tamaño máximo permitido.",
    };
  }
  await fs.writeFile(abs, updated, "utf-8");
  return {
    message: "Archivo editado (un reemplazo).",
    path: relativePath.trim(),
    workspace_root: getFileToolsWorkspaceRoot(),
    replacements: 1,
    bytes_written: newBytes,
  };
}
