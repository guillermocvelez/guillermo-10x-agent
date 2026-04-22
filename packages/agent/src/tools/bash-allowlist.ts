import { spawn } from "node:child_process";
import path from "node:path";

/** Demo safety: only `ls` (limited flags/paths) and `curl` (HTTPS GET). No shell. */
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 64_000;

export type AllowedCommand =
  | { type: "ls"; argv: string[] }
  | { type: "curl"; argv: string[] };

/**
 * Parses a one-line command string into a safe argv for spawn (no shell).
 * Allowed: `ls` with optional -l/-a flags and one optional relative path; `curl` with optional -s and one https URL.
 */
export function parseAllowlistedCommand(
  command: string
): { ok: true; parsed: AllowedCommand } | { ok: false; error: string } {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, error: "empty_command" };
  if (/[\n\r;`$|&<>]/.test(trimmed)) {
    return { ok: false, error: "unsupported_shell_syntax" };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const bin = parts[0]?.toLowerCase();

  if (bin === "ls") {
    const argv: string[] = ["ls"];
    const rest = parts.slice(1);
    let pathSeen = false;
    for (const token of rest) {
      if (token.startsWith("-")) {
        if (!/^-(?:[la]+)$/.test(token) || token.length > 3) {
          return { ok: false, error: "ls_flags_only_la" };
        }
        argv.push(token);
      } else {
        if (pathSeen) return { ok: false, error: "ls_single_path_max" };
        pathSeen = true;
        if (!isSafeRelativePath(token)) {
          return { ok: false, error: "ls_path_not_allowed" };
        }
        argv.push(token);
      }
    }
    return { ok: true, parsed: { type: "ls", argv } };
  }

  if (bin === "curl") {
    const rest = parts.slice(1);
    const curlArgs: string[] = [];
    let url = "";
    for (const token of rest) {
      if (token === "-s" || token === "--silent") {
        curlArgs.push("-s");
      } else if (token.startsWith("http")) {
        if (url) return { ok: false, error: "curl_single_url" };
        url = token;
      } else {
        return { ok: false, error: "curl_only_silent_and_https_url" };
      }
    }
    if (!url) return { ok: false, error: "curl_requires_url" };
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: "curl_invalid_url" };
    }
    if (u.protocol !== "https:") {
      return { ok: false, error: "curl_https_only" };
    }
    if (!isHostnameAllowed(u.hostname)) {
      return { ok: false, error: "curl_host_not_allowed" };
    }
    const argv = ["curl", "-S", "--max-time", "25"];
    if (curlArgs.includes("-s")) argv.push("-s");
    argv.push(url);
    return { ok: true, parsed: { type: "curl", argv } };
  }

  return { ok: false, error: "only_ls_and_curl_supported" };
}

function isSafeRelativePath(p: string): boolean {
  if (!p || p.includes("..")) return false;
  const norm = path.normalize(p);
  if (path.isAbsolute(norm)) return false;
  return /^[\w./\-]+$/.test(norm);
}

function isHostnameAllowed(host: string): boolean {
  const h = host.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local")
  ) {
    return false;
  }
  if (h === "127.0.0.1" || h === "::1") return false;
  return true;
}

function runSpawn(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const push = (buf: Buffer, acc: { s: string }) => {
      if (acc.s.length >= MAX_OUTPUT_CHARS) return;
      acc.s += buf.toString("utf8").slice(0, MAX_OUTPUT_CHARS - acc.s.length);
    };

    const outAcc = { s: "" };
    const errAcc = { s: "" };
    child.stdout?.on("data", (c: Buffer) => push(c, outAcc));
    child.stderr?.on("data", (c: Buffer) => push(c, errAcc));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: outAcc.s,
        stderr: errAcc.s,
        exit_code: code ?? 1,
      });
    });
  });
}

export async function runAllowlistedCommand(
  parsed: AllowedCommand
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  if (parsed.type === "ls") {
    const [cmd, ...args] = parsed.argv;
    return runSpawn(cmd, args);
  }
  const [cmd, ...args] = parsed.argv;
  return runSpawn(cmd, args);
}
