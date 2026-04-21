import {
  githubCreateIssue,
  githubCreateRepo,
} from "./github-api";

/**
 * Runs GitHub mutations that were deferred until the user approved the tool_call.
 */
export async function executeConfirmedGithubTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "github_create_issue": {
      const owner = String(args.owner ?? "");
      const repo = String(args.repo ?? "");
      const title = String(args.title ?? "");
      const body = typeof args.body === "string" ? args.body : "";
      if (!owner || !repo || !title) {
        throw new Error("Missing owner, repo, or title for github_create_issue");
      }
      return await githubCreateIssue(token, owner, repo, title, body);
    }
    case "github_create_repo": {
      const name = String(args.name ?? "");
      const description =
        typeof args.description === "string" ? args.description : undefined;
      const isPrivate = Boolean(args.private);
      if (!name) {
        throw new Error("Missing name for github_create_repo");
      }
      return await githubCreateRepo(token, name, description, isPrivate);
    }
    default:
      throw new Error(`Not a deferred GitHub tool: ${toolName}`);
  }
}
