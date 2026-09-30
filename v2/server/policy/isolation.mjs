import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HUB_ROOT } from "../config.mjs";

/**
 * Workspace isolation for provider runs (Milestone 02, SECURITY READINESS §05).
 *
 * Three layers are kept apart:
 *   1. the Hub backend, which legitimately handles private data (never exposed through a provider);
 *   2. the official client process and its own authentication (Codex app-server, Claude Code): not restricted here;
 *   3. the tools, shell and code the MODEL runs: restricted here.
 *
 * Codex: the owner's machine runs the native Windows `elevated` sandbox (dedicated CodexSandbox* users + ACLs).
 * A Hub permission profile passed per process denies the protected paths; the OS enforces it for every command the
 * model runs, including through junctions (verified with fictive canaries and `codex sandbox`, no model involved).
 * The elevated sandbox requires `:root` read access, so the profile denies specific paths instead of the whole host.
 *
 * Verified side effect (fictive tree, 2026-09-30): the elevated sandbox enforces a deny by writing an inheritable
 * DENY-read ACE for the CodexSandboxUsers group on the path. The ACE stays after the run (a later run without the
 * deny does not remove it), so it also applies to Codex desktop sessions of this Windows user. A child "read" entry
 * cannot re-allow a denied parent. Hence: ~/.codex is never denied as a directory (the sandbox runs its command runner
 * from ~/.codex/.sandbox-bin), and a Codex run on Windows needs the owner's explicit consent to these persistent ACEs.
 *
 * Claude Code: its Bash sandbox does not exist on native Windows (code.claude.com/docs/en/sandboxing). Read-only
 * runs use only Read/Glob/Grep with absolute deny rules, enforced by Claude Code for its built-in tools. Runs that
 * can execute shell commands have no OS boundary on native Windows and stay blocked.
 */

/** Project-relative paths no model may read (Hub DB, logs, provider runtime, archives, scratch). */
export const PROTECTED_PROJECT_PATHS = Object.freeze([".ifrim/private", ".ifrim/BACKUPS", ".ifrim/tmp"]);

/** Home-relative credential/config directories that commands run by a model never need (denied whole). */
export const PROTECTED_HOME_PATHS = Object.freeze([".claude", ".ssh", ".aws", ".azure", ".docker", ".gnupg", ".config/gh", ".openclaw"]);

/**
 * Inside ~/.codex only credential and transcript entries are denied, never the directory itself: the Windows sandbox
 * starts its command runner from ~/.codex/.sandbox-bin and an inherited DENY cannot be re-allowed on a child.
 */
export const PROTECTED_CODEX_HOME_ENTRIES = Object.freeze([".codex/auth.json", ".codex/secrets", ".codex/sessions", ".codex/archived_sessions"]);

export const CODEX_PROFILE_BY_ACCESS = Object.freeze({ "read-only": "ifrim_hub_ro", "workspace-write": "ifrim_hub_rw" });

/** Exact text the owner types to accept the persistent ACEs the Codex Windows sandbox writes for the Hub profile. */
export const CODEX_ACL_CONSENT_TEXT = "Accept ca sandbox-ul Windows al Codex să scrie reguli ACL DENY persistente pentru grupul CodexSandboxUsers pe căile protejate afișate de Hub. Regulile rămân după rulare, se aplică și sesiunilor Codex desktop și se elimină manual cu icacls <cale> /remove:d CodexSandboxUsers.";

const q = (s) => JSON.stringify(s); // TOML basic strings accept JSON string escapes
const fwd = (p) => p.split(path.sep).join("/");

/**
 * Absolute paths of the Hub's own private data, denied even when the run's workspace is another project (the
 * workspace-relative denies only cover the workspace). `extra` adds the configured data and backup directories.
 */
export function hubProtectedPaths({ hubRoot = HUB_ROOT, extra = [] } = {}) {
  const list = [...PROTECTED_PROJECT_PATHS.map((p) => path.join(hubRoot, ...p.split("/"))), ...extra.filter(Boolean).map((p) => path.resolve(p))];
  const key = (p) => path.resolve(p).toLowerCase();
  const unique = [...new Map(list.map((p) => [key(p), path.resolve(p)])).values()];
  // Drop entries already covered by a denied ancestor (e.g. the data dir inside .ifrim/private).
  return unique.filter((p) => !unique.some((o) => o !== p && key(p).startsWith(`${key(o)}${path.sep}`)));
}

/** Every absolute path the Codex profile denies on this machine (shown to the owner before consent). */
export function codexDeniedPaths({ homeDir = os.homedir(), hubRoot = HUB_ROOT, extra = [] } = {}) {
  return [
    ...hubProtectedPaths({ hubRoot, extra }),
    path.join(hubRoot, ".env"),
    ...PROTECTED_HOME_PATHS.map((p) => path.join(homeDir, ...p.split("/"))),
    ...PROTECTED_CODEX_HOME_ENTRIES.map((p) => path.join(homeDir, ...p.split("/"))),
  ];
}

/** Stable fingerprint of the deny list: a consent is valid only for the exact list it was given for. */
export function denyListFingerprint(paths) {
  const canonical = [...new Set(paths.map((p) => path.resolve(p).toLowerCase()))].sort().join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Inline-TOML permission profile for `-c permissions.<id>=<value>` (the value is parsed as TOML). */
export function codexProfileToml(access, { homeDir = os.homedir(), hubRoot = HUB_ROOT, extra = [] } = {}) {
  const workspace = [
    `"."=${q(access === "workspace-write" ? "write" : "read")}`,
    ...PROTECTED_PROJECT_PATHS.map((p) => `${q(p)}="deny"`),
    `"**/.env"="deny"`, `"**/.env.*"="deny"`,
  ].join(", ");
  const absolute = [
    ...codexDeniedPaths({ homeDir, hubRoot, extra }).map((p) => `${q(p)}="deny"`),
    `${q(`${fwd(hubRoot)}/.env.*`)}="deny"`,
  ].join(", ");
  const filesystem = `{":root"="read", glob_scan_max_depth=4, ${absolute}, ":workspace_roots"={${workspace}}}`;
  // Network stays off for model commands (the Hub never enables the Codex network proxy).
  return access === "workspace-write" ? `{extends=":workspace", filesystem=${filesystem}, network={enabled=false}}` : `{filesystem=${filesystem}, network={enabled=false}}`;
}

/** `-c` overrides that select the Hub profile for one app-server process. Nothing is written to config.toml. */
export function codexIsolationArgs(access = "read-only", { platform = process.platform, homeDir, hubRoot, extra } = {}) {
  const id = CODEX_PROFILE_BY_ACCESS[access];
  if (!id) throw new Error(`Unknown access ${access}`);
  // Both Hub profiles are defined in every process, so the account probe can report each one as selectable;
  // default_permissions picks the one for this run's access.
  return [
    ...(platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []),
    ...Object.entries(CODEX_PROFILE_BY_ACCESS).flatMap(([a, pid]) => ["-c", `permissions.${pid}=${codexProfileToml(a, { homeDir, hubRoot, extra })}`]),
    "-c", `default_permissions="${id}"`,
  ];
}

/** POSIX form Claude Code uses for absolute rules on Windows (`C:\x` → `//c/x`). */
export function claudeAbsolute(p) {
  const posix = path.resolve(p).split(path.sep).join("/");
  const m = posix.match(/^([A-Za-z]):\/(.*)$/);
  return m ? `//${m[1].toLowerCase()}/${m[2]}` : `/${posix}`;
}

/**
 * Absolute and relative Read denials for a Claude run in `projectDir` (Read rules also cover Grep/Glob). Claude
 * rules have no filesystem side effect, so ~/.codex is denied whole here.
 */
export function claudeDeniedReads(projectDir, { homeDir = os.homedir(), hubRoot = HUB_ROOT, extra = [] } = {}) {
  const rules = new Set();
  for (const p of PROTECTED_PROJECT_PATHS) {
    rules.add(`Read(./${p}/**)`);
    if (projectDir) rules.add(`Read(${claudeAbsolute(path.join(projectDir, p))}/**)`);
  }
  for (const p of hubProtectedPaths({ hubRoot, extra })) rules.add(`Read(${claudeAbsolute(p)}/**)`);
  for (const p of [".env", ".env.*"]) { rules.add(`Read(./${p})`); rules.add(`Read(./**/${p})`); rules.add(`Read(//**/${p})`); }
  for (const p of [".codex", ...PROTECTED_HOME_PATHS]) rules.add(`Read(${claudeAbsolute(path.join(homeDir, p))}/**)`);
  return [...rules];
}

/**
 * Gate check: can this provider/access run on this machine with a verified boundary?
 * `sandbox` is what the Codex probe read without inference (windowsSandbox/readiness + permissionProfile/list).
 * `consent` is the owner's recorded acceptance of the persistent ACEs; `fingerprint` identifies the current deny list.
 */
export function evaluateIsolation({ provider, access = "read-only", sandbox = null, platform = process.platform, consent = null, fingerprint = null }) {
  if (provider === "codex") {
    const id = CODEX_PROFILE_BY_ACCESS[access];
    if (platform === "win32" && sandbox?.readiness !== "ready") {
      return { ok: false, level: "none", detail: `SECURITY_BLOCKER: sandbox-ul Windows elevated al Codex nu este raportat „ready” (${sandbox?.readiness || "neverificat"}); rulează „Verifică contul” în Integrări` };
    }
    const profile = (sandbox?.profiles || []).find((p) => p.id === id);
    if (!profile?.allowed) {
      return { ok: false, level: "none", detail: `SECURITY_BLOCKER: profilul de permisiuni ${id} nu este raportat ca permis de Codex (${profile ? "nepermis" : "absent"}); fără el, sandbox-ul poate citi .ifrim/private și .env` };
    }
    if (platform === "win32") {
      if (!consent?.confirmedAt) {
        return { ok: false, level: "none", detail: "NEEDS_LIVE_APPROVAL: izolarea Codex scrie ACL-uri DENY persistente pentru CodexSandboxUsers (afectează și Codex desktop); aprobă explicit lista de căi în Integrări → Izolare" };
      }
      if (fingerprint && consent.fingerprint !== fingerprint) {
        return { ok: false, level: "none", detail: `NEEDS_LIVE_APPROVAL: lista de căi protejate s-a schimbat (${consent.fingerprint || "—"} → ${fingerprint}); aprobă din nou în Integrări → Izolare` };
      }
    }
    return { ok: true, level: "os", detail: `OS: sandbox ${platform === "win32" ? "Windows elevated" : "Codex"} + profil ${id} (refuz ${PROTECTED_PROJECT_PATHS.join(", ")} în workspace și în Hub, .env, credențiale)` };
  }
  if (provider === "claude") {
    if (access === "read-only") {
      return { ok: true, level: "tool", detail: "Unelte read-only (Read/Glob/Grep, fără shell) cu reguli deny absolute; aplicate de Claude Code, nu de sistemul de operare" };
    }
    return { ok: false, level: "none", detail: platform === "win32"
      ? "SECURITY_BLOCKER: scrierea permite comenzi shell, iar sandbox-ul Claude Code nu există pe Windows nativ (doar macOS, Linux, WSL2); comenzile ar putea citi .ifrim/private"
      : "SECURITY_BLOCKER: rularea cu shell cere sandbox-ul Claude Code configurat de Hub (neimplementat)" };
  }
  return { ok: false, level: "none", detail: `Provider necunoscut: ${provider}` };
}
