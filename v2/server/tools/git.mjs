import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactText } from "../security/redact.mjs";

const execFileAsync = promisify(execFile);
const SECRET_PATHSPEC = [":(exclude,glob)**/.env*", ":(exclude,glob)**/private/**", ":(exclude,glob)**/*.pem", ":(exclude,glob)**/*.key"];

async function git(cwd, args, { timeout = 10000, maxBuffer = 2 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=off", ...args], { cwd, windowsHide: true, timeout, maxBuffer });
    return { ok: true, out: stdout };
  } catch (error) {
    return { ok: false, out: "", error: error.killed ? "timeout" : (error.code || "error") };
  }
}

/** Read-only repository snapshot used by checkpoints, handoffs and backups. */
export async function gitState(cwd) {
  const [branch, head, status, upstream] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "HEAD"]),
    git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
  ]);
  const lines = status.out.split("\n").filter(Boolean);
  const changed = lines.map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
  return {
    isRepo: head.ok,
    branch: branch.out.trim(),
    head: head.out.trim(),
    upstream: upstream.ok ? upstream.out.trim() : "",
    dirty: changed.filter((c) => c.code !== "??"),
    untracked: changed.filter((c) => c.code === "??").map((c) => c.path),
  };
}

export async function gitDiff(cwd, { maxChars = 60000, staged = false } = {}) {
  const result = await git(cwd, ["diff", "--no-ext-diff", ...(staged ? ["--cached"] : []), "--", ".", ...SECRET_PATHSPEC], { maxBuffer: 8 * 1024 * 1024 });
  const text = redactText(result.out);
  return { diff: text.slice(0, maxChars), truncated: text.length > maxChars, ok: result.ok };
}

export async function gitLog(cwd, limit = 20) {
  const result = await git(cwd, ["log", `-${Math.min(100, Math.max(1, limit))}`, "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s"]);
  return result.out.split("\n").filter(Boolean).map((line) => {
    const [hash, short, author, date, subject] = line.split("\x1f");
    return { hash, short, author, date, subject: redactText(subject) };
  });
}

/** Prepares (never runs) a commit proposal from the current diff. Commit/push always need approval. */
export async function prepareCommitProposal(cwd, summary) {
  const state = await gitState(cwd);
  const files = [...state.dirty.map((d) => d.path), ...state.untracked];
  return {
    branch: state.branch, head: state.head, files,
    message: `${summary.trim().slice(0, 72)}\n\nPrepared by Ifrim Agent Hub. Review before committing.`,
    commands: ["git add <reviewed files>", "git commit -F <message file>"],
    executable: false, note: "The Hub does not commit, push or open PRs without an explicit, action-bound approval.",
  };
}
