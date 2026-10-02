import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/** Marker in tools_json that makes a grant a Lega VOICE grant (sessions, not runs). No schema change needed. */
export const VOICE_GRANT_TOOL = "voice.lega";
export const grantKind = (tools = []) => (Array.isArray(tools) && tools.includes(VOICE_GRANT_TOOL) ? "voice" : "run");

/**
 * LIVE_VALIDATION grants: the only way a model can run while validating. Each grant names the
 * provider, project, access level, tools, number of attempts and expiry — never "anything".
 * Kind "run" admits agent runs; kind "voice" admits Lega voice sessions (attempts = sessions,
 * maxDurationS = session cap). A grant of one kind never admits the other.
 */
export function createGrants({ db, bus, clock }) {
  const rowTo = (row) => row && ({ id: row.id, provider: row.provider, projectId: row.project_id, maxAttempts: row.max_attempts,
    attemptsUsed: row.attempts_used, tools: parse(row.tools_json, []), kind: grantKind(parse(row.tools_json, [])), access: row.access, maxDurationS: row.max_duration_s,
    // An active grant past its expiry is shown and judged as expired (the row itself is not rewritten on read).
    expiresAt: row.expires_at, status: row.status === "active" && new Date(row.expires_at) <= clock() ? "expired" : row.status, note: row.note, createdAt: row.created_at,
    // M06: a grant derived from a Mission Authorization Envelope names it (null = created by hand in LIVE_VALIDATION).
    envelopeId: row.envelope_id ?? null });

  function create({ provider, projectId, access, maxAttempts, maxDurationS, ttlMinutes, tools = [], note = "", kind = "run", envelopeId = null, expiresAt = null }, actor) {
    if (!["run", "voice"].includes(kind)) throw new HubError("validation", "kind must be run or voice");
    if (kind === "voice") {
      // Lega runs on Codex with the read-only profile; sessions are capped at 30 minutes.
      if (provider !== "codex") throw new HubError("validation", "A voice grant is for Codex (Lega uses GPT-Live through Codex)");
      if (access !== "read-only") throw new HubError("validation", "A voice grant is read-only");
      if (!(maxDurationS >= 60 && maxDurationS <= 1800)) throw new HubError("validation", "A voice session cap must be 60..1800 s");
      tools = [VOICE_GRANT_TOOL];
    } else tools = (tools || []).filter((t) => t !== VOICE_GRANT_TOOL);
    if (!["codex", "claude"].includes(provider)) throw new HubError("validation", "Unknown provider");
    if (!["read-only", "workspace-write"].includes(access)) throw new HubError("validation", "access must be read-only or workspace-write");
    if (!(maxAttempts >= 1 && maxAttempts <= 5)) throw new HubError("validation", "maxAttempts must be 1..5");
    if (!(ttlMinutes >= 5 && ttlMinutes <= 480)) throw new HubError("validation", "ttlMinutes must be 5..480");
    // A derived grant may end earlier than its TTL: never after the envelope that authorized it.
    if (expiresAt && !envelopeId) throw new HubError("validation", "An explicit expiry is only for envelope-derived grants");
    if (!(maxDurationS >= 60 && maxDurationS <= 7200)) throw new HubError("validation", "maxDurationS must be 60..7200");
    const id = newId("grant");
    const now = clock();
    const ttlEnd = now.getTime() + ttlMinutes * 60000;
    const end = expiresAt ? Math.min(ttlEnd, Date.parse(expiresAt)) : ttlEnd;
    if (!(end > now.getTime())) throw new HubError("validation", "The grant would already be expired");
    db.prepare(`INSERT INTO live_grants (id, provider, project_id, max_attempts, tools_json, access, max_duration_s, expires_at, status, note, created_at, envelope_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, provider, projectId, maxAttempts, json(tools), access, maxDurationS,
      new Date(end).toISOString(), note, now.toISOString(), envelopeId);
    bus.append({ type: "grant.created", scopeType: "project", scopeId: projectId, projectId, source: actor, payload: { grantId: id, provider, access, maxAttempts, ttlMinutes, kind, envelopeId } });
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM live_grants WHERE id = ?").get(id));

  function findUsable(provider, projectId, access, kind = "run") {
    const rows = db.prepare("SELECT * FROM live_grants WHERE provider = ? AND project_id = ? AND status = 'active' ORDER BY created_at DESC").all(provider, projectId)
      .map(rowTo).filter((g) => g.kind === kind);
    return rows.find((g) => !problem(g, { provider, projectId, access, now: clock(), kind })) || rows[0] || null;
  }

  function problem(grant, { provider, projectId, access, now, kind = "run" }) {
    if (!grant) return kind === "voice" ? "Niciun grant de voce (Lega) activ" : "Niciun grant de validare live pentru acest provider și proiect";
    if (grant.kind !== kind) return kind === "voice" ? "Grantul este pentru execuții, nu pentru Lega" : "Grantul este pentru Lega (voce), nu pentru execuții";
    if (grant.status === "expired" || (grant.status === "active" && new Date(grant.expiresAt) <= now)) return "Grantul a expirat";
    if (grant.status !== "active") return `Grantul este ${grant.status}`;
    if (grant.provider !== provider) return `Grantul este pentru ${grant.provider}`;
    if (grant.projectId !== projectId) return "Grantul este pentru alt proiect";
    if (access === "workspace-write" && grant.access !== "workspace-write") return "Grantul permite doar citire";
    if (new Date(grant.expiresAt) <= now) return "Grantul a expirat";
    if (grant.attemptsUsed >= grant.maxAttempts) return "Încercările grantului sunt epuizate";
    return null;
  }

  /** Atomically takes one attempt; fails if another request consumed the last one. */
  function consumeAttempt(id) {
    const result = db.prepare("UPDATE live_grants SET attempts_used = attempts_used + 1 WHERE id = ? AND status = 'active' AND attempts_used < max_attempts").run(id);
    if (result.changes !== 1) throw new HubError("gate", "Grant has no attempts left");
    const grant = get(id);
    if (grant.attemptsUsed >= grant.maxAttempts) db.prepare("UPDATE live_grants SET status = 'exhausted' WHERE id = ?").run(id);
    return get(id);
  }

  /**
   * Gives back one attempt taken by a start that failed before any model/voice call existed (e.g. a Lega pre-flight
   * refusal). Never revives a revoked or expired grant.
   */
  function refundAttempt(id, actor = "hub", reason = "") {
    const now = clock().toISOString();
    const result = db.prepare(`UPDATE live_grants SET attempts_used = attempts_used - 1,
      status = CASE WHEN status = 'exhausted' AND expires_at > ? THEN 'active' ELSE status END
      WHERE id = ? AND attempts_used > 0 AND status IN ('active', 'exhausted')`).run(now, id);
    if (result.changes === 1) bus.append({ type: "grant.refunded", scopeType: "grant", scopeId: id, source: actor, payload: { reason: String(reason).slice(0, 200) } });
    return get(id);
  }

  function revoke(id, actor) {
    db.prepare("UPDATE live_grants SET status = 'revoked' WHERE id = ? AND status = 'active'").run(id);
    bus.append({ type: "grant.revoked", scopeType: "grant", scopeId: id, source: actor, payload: {} });
    return get(id);
  }

  function revokeAll(actor, reason) {
    const ids = db.prepare("SELECT id FROM live_grants WHERE status = 'active'").all().map((r) => r.id);
    db.prepare("UPDATE live_grants SET status = 'revoked' WHERE status = 'active'").run();
    if (ids.length) bus.append({ type: "grant.revoked_all", scopeType: "system", scopeId: "grants", source: actor, payload: { count: ids.length, reason } });
    return ids.length;
  }

  const list = () => db.prepare("SELECT * FROM live_grants ORDER BY created_at DESC LIMIT 50").all().map(rowTo);
  /** Every active grant of one project (not only the latest 50), e.g. to revoke them when its runs are withdrawn. */
  const activeForProject = (projectId) => db.prepare("SELECT * FROM live_grants WHERE project_id = ? AND status = 'active'").all(projectId).map(rowTo);
  /** The grants an envelope derived (any status), oldest first. */
  const ofEnvelope = (envelopeId) => db.prepare("SELECT * FROM live_grants WHERE envelope_id = ? ORDER BY created_at").all(envelopeId).map(rowTo);
  return { create, get, findUsable, problem, consumeAttempt, refundAttempt, revoke, revokeAll, list, activeForProject, ofEnvelope };
}

/** Latest provider inspections (installation + probe). Stored without identities or secrets. */
export function createProviderState({ db, clock }) {
  const key = (provider) => `provider:${provider}`;
  return {
    get(provider) {
      const row = db.prepare("SELECT config_json FROM integration_connections WHERE id = ?").get(key(provider));
      return row ? parse(row.config_json, null) : null;
    },
    set(provider, value) {
      const now = clock().toISOString();
      db.prepare(`INSERT INTO integration_connections (id, kind, status, config_json, created_at, updated_at) VALUES (?, 'provider', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, config_json = excluded.config_json, updated_at = excluded.updated_at`)
        .run(key(provider), value?.ok === false ? "error" : "inspected", json(value), now, now);
      return value;
    },
  };
}
