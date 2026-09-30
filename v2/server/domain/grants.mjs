import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * LIVE_VALIDATION grants: the only way a model can run while validating. Each grant names the
 * provider, project, access level, tools, number of attempts and expiry — never "anything".
 */
export function createGrants({ db, bus, clock }) {
  const rowTo = (row) => row && ({ id: row.id, provider: row.provider, projectId: row.project_id, maxAttempts: row.max_attempts,
    attemptsUsed: row.attempts_used, tools: parse(row.tools_json, []), access: row.access, maxDurationS: row.max_duration_s,
    expiresAt: row.expires_at, status: row.status, note: row.note, createdAt: row.created_at });

  function create({ provider, projectId, access, maxAttempts, maxDurationS, ttlMinutes, tools = [], note = "" }, actor) {
    if (!["codex", "claude"].includes(provider)) throw new HubError("validation", "Unknown provider");
    if (!["read-only", "workspace-write"].includes(access)) throw new HubError("validation", "access must be read-only or workspace-write");
    if (!(maxAttempts >= 1 && maxAttempts <= 5)) throw new HubError("validation", "maxAttempts must be 1..5");
    if (!(ttlMinutes >= 5 && ttlMinutes <= 480)) throw new HubError("validation", "ttlMinutes must be 5..480");
    if (!(maxDurationS >= 60 && maxDurationS <= 7200)) throw new HubError("validation", "maxDurationS must be 60..7200");
    const id = newId("grant");
    const now = clock();
    db.prepare(`INSERT INTO live_grants (id, provider, project_id, max_attempts, tools_json, access, max_duration_s, expires_at, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(id, provider, projectId, maxAttempts, json(tools), access, maxDurationS,
      new Date(now.getTime() + ttlMinutes * 60000).toISOString(), note, now.toISOString());
    bus.append({ type: "grant.created", scopeType: "project", scopeId: projectId, projectId, source: actor, payload: { grantId: id, provider, access, maxAttempts, ttlMinutes } });
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM live_grants WHERE id = ?").get(id));

  function findUsable(provider, projectId, access) {
    const rows = db.prepare("SELECT * FROM live_grants WHERE provider = ? AND project_id = ? AND status = 'active' ORDER BY created_at DESC").all(provider, projectId);
    return rows.map(rowTo).find((g) => !problem(g, { provider, projectId, access, now: clock() })) || rows.map(rowTo)[0] || null;
  }

  function problem(grant, { provider, projectId, access, now }) {
    if (!grant) return "Niciun grant de validare live pentru acest provider și proiect";
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
  return { create, get, findUsable, problem, consumeAttempt, revoke, revokeAll, list };
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
