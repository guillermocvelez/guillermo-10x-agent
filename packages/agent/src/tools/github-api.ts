import { Octokit } from "@octokit/rest";

function client(token: string) {
  return new Octokit({ auth: token });
}

export async function githubListRepos(token: string, perPage: number) {
  const octokit = client(token);
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: Math.min(Math.max(perPage, 1), 100),
    sort: "updated",
  });
  return {
    repos: data.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      html_url: r.html_url,
      default_branch: r.default_branch,
    })),
  };
}

export async function githubListIssues(
  token: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all"
) {
  const octokit = client(token);
  const { data } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state,
    per_page: 30,
  });
  const issues = data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      html_url: i.html_url,
    }));
  return { issues };
}

export async function githubCreateIssue(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string
) {
  const octokit = client(token);
  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body: body || undefined,
  });
  return {
    message: "Issue created",
    issue_url: data.html_url,
    number: data.number,
  };
}

export async function githubCreateRepo(
  token: string,
  name: string,
  description: string | undefined,
  isPrivate: boolean
) {
  const octokit = client(token);
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name,
    description: description || undefined,
    private: isPrivate,
  });
  return {
    message: "Repository created",
    html_url: data.html_url,
    full_name: data.full_name,
  };
}
