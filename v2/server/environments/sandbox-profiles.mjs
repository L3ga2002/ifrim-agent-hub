import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_GUARD_ENV } from "../providers/claude.mjs";
import { BILLING_RISK_ENV } from "../policy/billing.mjs";

/**
 * The bwrap profiles of ifrim-runner (M06-A, M07), defined ONCE: production builds its argv here, and the canary
 * (canary.mjs → canaryPrelude) receives the very same argv as bash arrays, so what C18/C19/C20 attest is what runs. This
 * file is part of CANARY_VERSION: changing a flag invalidates the attestation. Every element is a separate argv entry (no
 * shell); paths are fixed or validated workspace paths.
 *
 *   localOnlyArgs  — the preview (and, with `browser`, its E2E): own network namespace with loopback only, /usr read-only,
 *                    private /tmp, empty /home, the project COPY at /work (writable), the host scripts read-only at /hub.
 *                    `browser` adds Playwright (/pw/pkg) and the headless shell (/pw/browsers) read-only and /etc/fonts.
 *                    Chromium keeps its own sandbox inside (renderer seccomp-bpf + nested user namespace, measured: C19).
 *   reviewerArgs   — Claude Code as a read-only reviewer: the copy at /work READ-ONLY, the network SHARED (the client must
 *                    reach Anthropic; the model has only Read/Glob/Grep, no shell or web tool), no nested user namespaces,
 *                    the CLI read-only at /opt/claude, a dedicated config dir writable at /rhome/.claude-config (OAuth
 *                    refresh, session files the Hub deletes after the run), nothing else of /home (C20).
 */
export const BWRAP = "/usr/bin/bwrap";
export const PW_PKG = "/home/runner/tools/pw";
export const PW_BROWSERS = "/home/runner/.cache/ms-playwright";
export const CLAUDE_PKG = "/home/runner/tools/claude";
export const REVIEWER_CONFIG = "/home/runner/ifrim-reviewer/config";
/** Inside the reviewer sandbox: the real native binary (the .bin/claude symlink points to it), never a shim. */
export const CLAUDE_IN_SANDBOX = "/opt/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe";
export const PW_IN_SANDBOX = "/pw/pkg";
export const REVIEWER_HOME = "/rhome";
export const REVIEWER_CONFIG_IN = "/rhome/.claude-config";

// A workspace dir of the Hub root: one plain segment (never "." or ".."), then repo or host.
const WORKSPACE_DIR = /^\/home\/runner\/ws\/hub\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}\/(repo|host)$/;
const MARKER = /^[A-Za-z0-9_-]{4,80}$/;
function assertDir(p, kind) {
  if (!WORKSPACE_DIR.test(String(p)) || !String(p).endsWith(`/${kind}`)) throw new Error(`cale de workspace invalidă pentru bwrap: ${String(p).slice(0, 80)}`);
}
function assertMarker(marker) { if (!MARKER.test(String(marker))) throw new Error("marcaj invalid"); }
const setenv = (vars) => Object.entries(vars).flatMap(([k, v]) => ["--setenv", k, String(v)]);

const SYSTEM = ["--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--symlink", "usr/sbin", "/sbin"];
const SCRATCH = ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/home"];

/** The LOCAL-ONLY profile (M06-A, measured in ifrim-runner on 2026-10-02); `browser` adds the E2E binds (M07, C19). */
export function localOnlyArgs({ repo, hostDir, marker, browser = false }) {
  assertDir(repo, "repo");
  assertDir(hostDir, "host");
  assertMarker(marker);
  return ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
    ...SYSTEM, ...SCRATCH,
    "--bind", repo, "/work", "--ro-bind", hostDir, "/hub",
    ...(browser ? ["--ro-bind", PW_PKG, PW_IN_SANDBOX, "--ro-bind", PW_BROWSERS, "/pw/browsers", "--ro-bind", "/etc/fonts", "/etc/fonts"] : []),
    "--chdir", "/work",
    ...setenv({ PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", LANG: "C.UTF-8", NODE_ENV: "development", IFRIM_RUN: marker,
      npm_config_cache: "/tmp/npm-cache", npm_config_update_notifier: "false", ...(browser ? { PLAYWRIGHT_BROWSERS_PATH: "/pw/browsers" } : {}) })];
}

/**
 * The reviewer's process environment (after --clearenv): the Hub's Claude guards plus the switches that keep the client
 * quiet (no telemetry, error reports, updates or claude.ai connectors). Never an API key, auth token or OAuth token: the
 * client authenticates with the subscription login stored in its dedicated config dir.
 */
export const REVIEWER_ENV = Object.freeze({ ...CLAUDE_GUARD_ENV, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false", DISABLE_AUTOUPDATER: "1", DISABLE_UPDATES: "1" });
/** System files the client needs for DNS/TLS and a user name (read-only, -try: a missing one is not an error). Measured 2026-10-02. */
export const REVIEWER_ETC = Object.freeze(["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/ssl", "/etc/ca-certificates", "/etc/passwd", "/etc/group"]);

export function reviewerArgs({ repo, marker }) {
  assertDir(repo, "repo");
  assertMarker(marker);
  const vars = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: REVIEWER_HOME, CLAUDE_CONFIG_DIR: REVIEWER_CONFIG_IN, TMPDIR: "/tmp", LANG: "C.UTF-8", IFRIM_RUN: marker, ...REVIEWER_ENV };
  const risky = Object.keys(vars).filter((name) => BILLING_RISK_ENV.some((r) => r.toUpperCase() === name.toUpperCase()));
  if (risky.length) throw new Error(`variabile de facturare refuzate în mediul reviewer-ului: ${risky.join(", ")}`);
  return ["--unshare-all", "--unshare-user", "--disable-userns", "--share-net", "--die-with-parent", "--new-session", "--clearenv",
    ...SYSTEM, ...REVIEWER_ETC.flatMap((p) => ["--ro-bind-try", p, p]), ...SCRATCH,
    "--ro-bind", repo, "/work", "--ro-bind", CLAUDE_PKG, "/opt/claude",
    "--tmpfs", REVIEWER_HOME, "--bind", REVIEWER_CONFIG, REVIEWER_CONFIG_IN,
    "--chdir", "/work", ...setenv(vars)];
}

/** A bash array literal (single-quoted elements): how the canary receives the production argv. */
export function shellArray(name, args) {
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(name)) throw new Error("nume de variabilă invalid");
  return `${name}=(${args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")})`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * The files of the preview host (copied verbatim into the run's host dir, read-only for the sandbox): the host itself, the
 * shared E2E core of tools/browser.mjs and the Hub's redaction. Read once; part of CANARY_VERSION.
 */
export const HOST_FILES = Object.freeze({
  "preview-host.mjs": fs.readFileSync(path.join(here, "scripts", "preview-host.mjs"), "utf8"),
  "browser-core.mjs": fs.readFileSync(path.join(here, "..", "tools", "browser-core.mjs"), "utf8"),
  "redact.mjs": fs.readFileSync(path.join(here, "..", "security", "redact.mjs"), "utf8"),
});

/** Shell lines writing `files` into the directory held by the shell expression `dirExpr` (quoted heredocs: literal content). */
export function heredocFiles(dirExpr, files = HOST_FILES) {
  return Object.entries(files).map(([name, content], i) => {
    if (!/^[a-z0-9][a-z0-9.-]{0,60}$/.test(name)) throw new Error(`nume de fișier invalid: ${name}`);
    const end = `IFRIM_HOST_${i}_EOF`;
    if (content.split("\n").includes(end)) throw new Error(`${name} conține delimitatorul ${end}`);
    return `cat > "${dirExpr}/${name}" <<'${end}'\n${content.replace(/\n$/, "")}\n${end}`;
  }).join("\n");
}
