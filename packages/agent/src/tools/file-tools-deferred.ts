import {
  workspaceWriteFileImpl,
  workspaceEditFileImpl,
} from "./file-tools-impl";

export async function executeConfirmedWorkspaceWrite(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pathRel = typeof args.path === "string" ? args.path : "";
  const content = typeof args.content === "string" ? args.content : "";
  if (!pathRel.trim()) {
    return { error: "invalid_args", message: "Falta path o content." };
  }
  return workspaceWriteFileImpl(pathRel, content);
}

export async function executeConfirmedWorkspaceEdit(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pathRel = typeof args.path === "string" ? args.path : "";
  const oldString = typeof args.old_string === "string" ? args.old_string : "";
  const newString = typeof args.new_string === "string" ? args.new_string : "";
  if (!pathRel.trim()) {
    return { error: "invalid_args", message: "Falta path." };
  }
  return workspaceEditFileImpl(pathRel, oldString, newString);
}
