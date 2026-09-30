import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { newId } from "../core/ids.mjs";
import { buildChildEnv } from "../policy/billing.mjs";
import { CLAUDE_GUARD_ENV } from "./claude.mjs";
import { resolveClaudeBinary } from "./claude.mjs";

const execFileAsync = promisify(execFile);
const STATUS_MAP = { busy: "active", idle: "idle" };

/**
 * MIRROR_STATE for native Claude Code sessions: reads the official `claude agents --json` listing
 * (no TTY, no inference, no model) and keeps a read-only copy of sessions whose working directory is
 * inside a registered project. Sessions of unregistered folders are only counted, never stored.
 * Changes are published as normalized provider-native events:
 * provider.native_task_started / provider.native_task_updated / provider.native_task_completed.
 * The Hub never steers, resumes or stops these sessions: their lifecycle belongs to Claude Code.
 */
export function createNativeSessionMirror({ db, bus, clock, config, projects }) {
  let running = null;
  let last = null;

  const inside = (root, target) => {
    const rel = path.relative(path.resolve(root).toLowerCase(), path.resolve(target).toLowerCase());
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };

  async function readClaudeAgents() {
    const binary = resolveClaudeBinary(config);
    if (!binary) return { ok: false, error: "Claude Code nu este instalat" };
    try {
      const { stdout } = await execFileAsync(binary.executable, [...binary.prefixArgs, "agents", "--json"],
        { env: buildChildEnv(CLAUDE_GUARD_ENV), windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024, cwd: config.hubRoot });
      const parsed = JSON.parse(stdout.trim() || "[]");
      if (!Array.isArray(parsed)) return { ok: false, error: "Ieșire neașteptată (nu este listă)" };
      return { ok: true, sessions: parsed };
    } catch (error) {
      return { ok: false, error: error instanceof SyntaxError ? "Ieșirea nu este JSON valid" : String(error.message || error).slice(0, 300) };
    }
  }

  async function refresh(actor = "user") {
    if (running) return running;
    running = (async () => {
      const observedAt = clock().toISOString();
      const read = await readClaudeAgents();
      if (!read.ok) {
        last = { ok: false, error: read.error, observedAt, sessions: 0, unregisteredCount: 0 };
        bus.emit({ type: "provider.native_mirror_failed", scopeType: "provider", scopeId: "claude", source: actor, payload: { error: read.error } });
        return last;
      }
      const registered = projects.list();
      let unregisteredCount = 0;
      const seen = new Set();
      const changes = [];
      bus.transaction(() => {
        for (const s of read.sessions) {
          const sessionId = typeof s.sessionId === "string" ? s.sessionId : null;
          if (!sessionId || typeof s.cwd !== "string") continue;
          const project = registered.find((p) => inside(p.path, s.cwd));
          if (!project) { unregisteredCount += 1; continue; }
          seen.add(sessionId);
          const status = STATUS_MAP[s.status] || "unknown";
          const existing = db.prepare("SELECT * FROM native_sessions WHERE provider = 'claude' AND native_session_id = ?").get(sessionId);
          const startedAt = Number.isFinite(s.startedAt) ? new Date(s.startedAt).toISOString() : null;
          if (!existing) {
            db.prepare(`INSERT INTO native_sessions (id, provider, surface_id, native_session_id, project_id, name, kind, status, pid, started_at, first_seen_at, last_seen_at, observed_via)
              VALUES (?, 'claude', 'anthropic.claude_code_background', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude agents --json')`)
              .run(newId("nses"), sessionId, project.id, String(s.name || "").slice(0, 200), String(s.kind || ""), status, Number.isInteger(s.pid) ? s.pid : null, startedAt, observedAt, observedAt);
            changes.push({ type: "provider.native_task_started", sessionId, projectId: project.id, status, name: s.name || "" });
          } else {
            db.prepare("UPDATE native_sessions SET status = ?, name = ?, pid = ?, last_seen_at = ? WHERE id = ?")
              .run(status, String(s.name || existing.name).slice(0, 200), Number.isInteger(s.pid) ? s.pid : existing.pid, observedAt, existing.id);
            if (existing.status !== status) changes.push({ type: existing.status === "ended" ? "provider.native_task_started" : "provider.native_task_updated", sessionId, projectId: project.id, status, previous: existing.status });
          }
        }
        for (const gone of db.prepare("SELECT * FROM native_sessions WHERE provider = 'claude' AND status <> 'ended'").all()) {
          if (seen.has(gone.native_session_id)) continue;
          db.prepare("UPDATE native_sessions SET status = 'ended', last_seen_at = ? WHERE id = ?").run(observedAt, gone.id);
          changes.push({ type: "provider.native_task_completed", sessionId: gone.native_session_id, projectId: gone.project_id, status: "ended",
            note: "Sesiunea nu mai apare în listă; finalizarea nu înseamnă verificare" });
        }
        for (const change of changes) {
          bus.append({ type: change.type, scopeType: "native_session", scopeId: change.sessionId, projectId: change.projectId, source: "claude-native",
            rawRef: `claude agents --json @ ${observedAt}`, payload: { provider: "claude", surface: "anthropic.claude_code_background", ...change } });
        }
      });
      last = { ok: true, observedAt, sessions: seen.size, unregisteredCount, changes: changes.length };
      return last;
    })();
    try { return await running; } finally { running = null; }
  }

  const list = ({ includeEnded = false } = {}) => db.prepare(`SELECT id, provider, surface_id AS surfaceId, native_session_id AS nativeSessionId, project_id AS projectId,
      name, kind, status, pid, started_at AS startedAt, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, observed_via AS observedVia
    FROM native_sessions ${includeEnded ? "" : "WHERE status <> 'ended'"} ORDER BY last_seen_at DESC LIMIT 200`).all();

  return { refresh, list, last: () => last,
    codex: { supported: false, reason: "Codex expune sesiunile doar în TUI („codex agents”) sau prin app-server; oglindirea read-only a firelor Codex nu este în allowlist-ul acestui build." } };
}
