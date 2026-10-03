import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { redactText } from "../security/redact.mjs";
import { buildChildEnv } from "../policy/billing.mjs";

const execFileAsync = promisify(execFile);
const GIT = "git";
const SECRET_PATHSPEC = [":(exclude,glob)**/.env*", ":(exclude,glob)**/private/**", ":(exclude,glob)**/*.pem", ":(exclude,glob)**/*.key"];

/**
 * Every Hub git call is read-only and runs no program the repository's own config names (M05 §15, T09): core.fsmonitor is
 * a command git would run for status/ls-files with the Hub's rights, so it is pinned off; no prompts, no optional locks,
 * and the child gets the Hub's allowlisted environment (no keys, tokens or proxies).
 */
const SAFE_GIT_CONFIG = ["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "diff.external=", "-c", "core.hooksPath=/dev/null"];
const gitEnv = () => buildChildEnv({ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1" });

async function git(cwd, args, { timeout = 10000, maxBuffer = 2 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execFileAsync(GIT, [...SAFE_GIT_CONFIG, ...args], { cwd, windowsHide: true, timeout, maxBuffer, env: gitEnv() });
    return { ok: true, out: stdout };
  } catch (error) {
    return { ok: false, out: "", error: error.killed ? "timeout" : (error.code || "error") };
  }
}

/**
 * Synchronous read-only git for the factory snapshot (which is synchronous by design). Same safe config and environment;
 * only the read-only subcommands below call it. Returns a Buffer, or null when git fails.
 */
function gitSync(cwd, args, { timeout = 30000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try { return execFileSync(GIT, [...SAFE_GIT_CONFIG, ...args], { cwd, windowsHide: true, timeout, maxBuffer, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}

/** Index entries (tracked files): [{ path, mode, blob }]; null when the folder is not a readable repository. */
export function gitIndexEntriesSync(cwd) {
  // -v adds a tag: lowercase = "assume unchanged", S = "skip worktree" — git would not look at those files' contents.
  const out = gitSync(cwd, ["ls-files", "-s", "-v", "-z"]);
  if (!out) return null;
  return out.toString("utf8").split("\0").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const fields = line.slice(0, tab).split(" ");
    const tag = /^[A-Za-z?]$/.test(fields[0]) ? fields.shift() : "H";
    const [mode, blob] = fields;
    return { path: line.slice(tab + 1), mode, blob, trusted: tag === "H" };
  });
}

/** Paths whose working-tree content may differ from the index (modified, deleted, renamed, conflicted) and untracked ones. */
export function gitChangedPathsSync(cwd) {
  const out = gitSync(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  if (!out) return null;
  const changed = new Set();
  const untracked = new Set();
  for (const entry of out.toString("utf8").split("\0").filter(Boolean)) {
    const code = entry.slice(0, 2);
    const p = entry.slice(3);
    if (code === "??") untracked.add(p); else changed.add(p);
  }
  return { changed, untracked };
}

/** The content of one blob from the object database (read-only), or null. */
export function gitBlobSync(cwd, blob) {
  if (!/^[0-9a-f]{40,64}$/.test(String(blob || ""))) return null;
  return gitSync(cwd, ["cat-file", "blob", blob], { maxBuffer: 16 * 1024 * 1024 });
}

/** Ignored untracked paths (ignored folders collapsed to "dir/"), read-only. */
export function gitIgnoredFilesSync(cwd) {
  const out = gitSync(cwd, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"]);
  return out ? out.toString("utf8").split("\0").filter(Boolean) : null;
}

export function gitHeadSync(cwd) {
  const out = gitSync(cwd, ["rev-parse", "HEAD"]);
  return out ? out.toString("utf8").trim() : "";
}

/**
 * The project files as git sees them: tracked plus untracked, ignored ones excluded (M05 workspace transfer). Read-only;
 * the caller applies its own exclusion policy on top (a .gitignore is not a security policy). Throws when git fails.
 */
export async function gitListFiles(cwd, { split = false } = {}) {
  const tracked = await git(cwd, ["ls-files", "-z", "--cached"], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  const others = await git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (!tracked.ok || !others.ok) throw new Error(`git ls-files: ${tracked.error || others.error}`);
  const lists = { tracked: [...new Set(tracked.out.split("\0").filter(Boolean))], others: [...new Set(others.out.split("\0").filter(Boolean))] };
  return split ? lists : [...new Set([...lists.tracked, ...lists.others])];
}

/**
 * Which of `paths` (project-relative, forward slashes) the project's ignore rules exclude, as git applies them on this computer:
 * the repository's .gitignore files, .git/info/exclude and the Windows user's global excludes — the same rules the transfer
 * into an environment uses (gitListFiles --exclude-standard), read from the project on Windows, never from a copy an agent
 * could edit. Untracked paths only (git never reports a tracked file as ignored). Asynchronous: the Hub keeps serving while
 * git answers. Returns { ignored: Set, error } — exit 1 means "none ignored" (no error); any other failure (a pathspec inside
 * a submodule, a timeout) returns an empty set AND the error, so nothing is left out and the evidence says why. A folder without
 * its own .git is never asked: git would answer with the rules of an enclosing repository.
 */
export function gitCheckIgnored(cwd, paths, { timeoutMs = 30000 } = {}) {
  const list = [...new Set(paths)].filter((p) => p && !p.includes("\0"));
  if (!list.length) return Promise.resolve({ ignored: new Set(), error: null });
  if (!cwd || !fs.existsSync(path.join(cwd, ".git"))) return Promise.resolve({ ignored: new Set(), error: "proiectul nu are un depozit git propriu; regulile de ignorare nu au fost consultate" });
  return new Promise((resolve) => {
    let child;
    try { child = spawn(GIT, [...SAFE_GIT_CONFIG, "check-ignore", "-z", "--stdin"], { cwd, windowsHide: true, env: gitEnv(), stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { resolve({ ignored: new Set(), error: `git check-ignore nu a pornit: ${String(error.message).slice(0, 160)}` }); return; }
    const out = [];
    let err = "";
    let size = 0;
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill(); done({ ignored: new Set(), error: `git check-ignore a depășit ${Math.round(timeoutMs / 1000)} s` }); }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size <= 8 * 1024 * 1024) out.push(chunk); });
    child.stderr.on("data", (chunk) => { if (err.length < 2000) err += chunk.toString("utf8"); });
    child.on("error", (error) => done({ ignored: new Set(), error: `git check-ignore: ${String(error.message).slice(0, 160)}` }));
    child.on("close", (code) => {
      if (code === 0) done({ ignored: new Set(Buffer.concat(out).toString("utf8").split("\0").filter(Boolean)), error: null });
      else if (code === 1) done({ ignored: new Set(), error: null });
      else done({ ignored: new Set(), error: `git check-ignore a ieșit cu ${code}: ${redactText(err.trim()).slice(0, 200)}` });
    });
    child.stdin.on("error", () => { /* git exited before reading everything: reported by close */ });
    child.stdin.end(Buffer.from(`${list.join("\0")}\0`, "utf8"));
  });
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
