import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

/** Marker in tools_json that makes a grant a Lega VOICE grant (sessions, not runs). No schema change needed. */
export const VOICE_GRANT_TOOL = "voice.lega";
export const grantKind = (tools = []) => (Array.isArray(tools) && tools.includes(VOICE_GRANT_TOOL) ? "voice" : "run");

/*
 * M10.2 (U12) run envelopes: a plan for ONE bounded model step (no Software Factory mission). Its derived grant names the plan in
 * binding.envelopeRunId, and the run it admits carries the same plan as its scope key "envrun:<envelopeId>" where a factory step
 * carries its missionId (runs.mjs → plan.missionId → gate → grants). Matching on that key keeps the two plan kinds in ONE rule: a
 * plan step uses only the grant its plan derived for exactly this scope and binding, and nothing else uses that grant.
 */
export const RUN_SCOPE_PREFIX = "envrun:";
export const runScopeKey = (envelopeId) => `${RUN_SCOPE_PREFIX}${String(envelopeId || "")}`;
/** The run envelope a scope key names, or null (a mission id, an empty key). */
export const runEnvelopeIdOf = (scope) => (typeof scope === "string" && scope.startsWith(RUN_SCOPE_PREFIX) && scope.length > RUN_SCOPE_PREFIX.length ? scope.slice(RUN_SCOPE_PREFIX.length) : null);
/** The scope a bound grant serves: its mission, or its run envelope's key (null = unscoped). */
const scopeOfGrant = (grant) => grant?.binding?.missionId || (grant?.binding?.envelopeRunId ? runScopeKey(grant.binding.envelopeRunId) : null);

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
    envelopeId: row.envelope_id ?? null,
    // M09: the model/effort binding an envelope-derived grant may serve ({ role, provider, model, effort, bindingHash }); null = any.
    binding: parse(row.binding_json, null) });

  function create({ provider, projectId, access, maxAttempts, maxDurationS, ttlMinutes, tools = [], note = "", kind = "run", envelopeId = null, expiresAt = null, binding = null }, actor) {
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
    // M09: a binding is only for an envelope-derived run grant, and it must be complete (the hash is what the gate compares).
    if (binding && (!envelopeId || kind !== "run")) throw new HubError("validation", "Doar un grant derivat dintr-un plan poate fi legat de un model");
    if (binding && (binding.provider !== provider || !/^[0-9a-f]{64}$/.test(String(binding.bindingHash || "")) || !String(binding.model || "").trim())) {
      throw new HubError("validation", "Legătura de model a grantului e incompletă sau pentru alt provider");
    }
    const id = newId("grant");
    const now = clock();
    const ttlEnd = now.getTime() + ttlMinutes * 60000;
    const end = expiresAt ? Math.min(ttlEnd, Date.parse(expiresAt)) : ttlEnd;
    if (!(end > now.getTime())) throw new HubError("validation", "The grant would already be expired");
    const bound = binding ? { role: String(binding.role || ""), provider: binding.provider, model: String(binding.model).trim().slice(0, 80), effort: String(binding.effort || "").slice(0, 20), bindingHash: binding.bindingHash,
      ...(binding.missionId ? { missionId: String(binding.missionId).slice(0, 80) } : {}),
      // M10.2 (U12): a run envelope's grant names its plan instead of a mission (never both: one scope per grant).
      ...(binding.envelopeRunId && !binding.missionId ? { envelopeRunId: String(binding.envelopeRunId).slice(0, 80) } : {}) } : null;
    if (bound?.envelopeRunId && bound.envelopeRunId !== envelopeId) throw new HubError("validation", "Grantul unei execuții din plan poate numi doar planul care l-a derivat");
    db.prepare(`INSERT INTO live_grants (id, provider, project_id, max_attempts, tools_json, access, max_duration_s, expires_at, status, note, created_at, envelope_id, binding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run(id, provider, projectId, maxAttempts, json(tools), access, maxDurationS,
      new Date(end).toISOString(), note, now.toISOString(), envelopeId, bound ? json(bound) : null);
    bus.append({ type: "grant.created", scopeType: "project", scopeId: projectId, projectId, source: actor, payload: { grantId: id, provider, access, maxAttempts, ttlMinutes, kind, envelopeId,
      ...(bound ? { binding: { role: bound.role, model: bound.model, effort: bound.effort, hash: bound.bindingHash.slice(0, 16) } } : {}) } });
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM live_grants WHERE id = ?").get(id));

  /**
   * M10.2: a mission whose authority was ever derived from a plan (an envelope-derived grant names it in its binding, whatever
   * that grant's status now). Its bound runs are PLAN runs: they may use only a grant the plan derived for them — never a manual
   * LIVE_VALIDATION grant lying around on the same project (the live residue grant_muu67o8g showed exactly that asymmetry: a
   * bound grant could not serve a manual run, but a manual grant could serve a plan run). A Software Factory mission approved
   * through Approvals (legacy policy, no envelope) is also bound (M09), but it was never a plan's: it keeps using the manual
   * grants the owner created for it, as in M03–M09.
   */
  // M10.2 (U12): a run envelope's scope key is a plan step by construction (only the run envelope's own start carries it).
  const planMission = (missionId) => Boolean(runEnvelopeIdOf(missionId)) || Boolean(missionId) && Boolean(db.prepare("SELECT 1 FROM live_grants WHERE envelope_id IS NOT NULL AND json_extract(binding_json, '$.missionId') = ? LIMIT 1").get(String(missionId)));

  /** `bindingHash` (M09): the approved binding of the run asking (null = a run with no binding: manual, shadow, Lega). */
  function findUsable(provider, projectId, access, kind = "run", { bindingHash = null, missionId = null } = {}) {
    const rows = db.prepare("SELECT * FROM live_grants WHERE provider = ? AND project_id = ? AND status = 'active' ORDER BY created_at DESC").all(provider, projectId)
      .map(rowTo).filter((g) => g.kind === kind);
    const planRun = Boolean(bindingHash) && planMission(missionId);
    const ctx = { provider, projectId, access, now: clock(), kind, bindingHash, missionId, planRun };
    if (planRun) {
      // M10.2: only the plan's own grants for exactly this binding and mission are candidates — no fallback to another row, so a
      // plan step with no derived grant left is refused (and its reason names the plan's grant), never served by a manual one.
      const bound = rows.filter((g) => g.binding?.bindingHash === bindingHash && scopeOfGrant(g) === missionId);
      return bound.find((g) => !problem(g, ctx)) || bound[0] || null;
    }
    return rows.find((g) => !problem(g, ctx)) || rows[0] || null;
  }

  /**
   * `planRun` (M10.2): the run is a step of a plan (see planMission); computed here when the caller does not pass it, so every
   * caller — the gate with an explicit grantId included — gets the same answer.
   */
  function problem(grant, { provider, projectId, access, now, kind = "run", bindingHash = null, missionId = null, planRun = undefined }) {
    const isPlanRun = planRun === undefined ? Boolean(bindingHash) && planMission(missionId) : Boolean(planRun);
    if (!grant && isPlanRun) return "Execuția planului folosește doar grantul derivat din plan; planul nu mai are unul activ pentru acest pas";
    if (!grant) return kind === "voice" ? "Niciun grant de voce (Lega) activ" : "Niciun grant de validare live pentru acest provider și proiect";
    if (grant.kind !== kind) return kind === "voice" ? "Grantul este pentru execuții, nu pentru Lega" : "Grantul este pentru Lega (voce), nu pentru execuții";
    if (grant.status === "expired" || (grant.status === "active" && new Date(grant.expiresAt) <= now)) return "Grantul a expirat";
    if (grant.status !== "active") return `Grantul este ${grant.status}`;
    if (grant.provider !== provider) return `Grantul este pentru ${grant.provider}`;
    if (grant.projectId !== projectId) return "Grantul este pentru alt proiect";
    if (access === "workspace-write" && grant.access !== "workspace-write") return "Grantul permite doar citire";
    if (new Date(grant.expiresAt) <= now) return "Grantul a expirat";
    if (grant.attemptsUsed >= grant.maxAttempts) return "Încercările grantului sunt epuizate";
    // M10.2: a plan step never consumes a grant the plan did not derive for it (a manual grant, or a bound grant of another
    // mission/binding): the manual LIVE_VALIDATION path and the plan path stay separate in both directions.
    if (isPlanRun && !grant.binding?.bindingHash) return "Execuția planului folosește doar grantul derivat din plan";
    if (isPlanRun && scopeOfGrant(grant) !== missionId) return `Grantul a fost derivat pentru ${scopeLabel(grant)}, nu pentru această execuție`;
    // M09: a grant bound to the model the owner confirmed in a plan serves only a run dispatched under that exact binding.
    if (grant.binding?.bindingHash && grant.binding.bindingHash !== bindingHash) {
      return `Grantul este legat de modelul confirmat în plan (${grant.binding.model} · ${grant.binding.effort || "—"}); ${bindingHash ? "execuția cere alt model sau alt efort" : "o execuție fără modelul aprobat (manuală, shadow, Lega) nu îl poate folosi"}`;
    }
    // …and only the mission it was derived for: another mission with the same model has its own authority (or none).
    // M10.2 (U12): the same for a run envelope's grant: only the run its plan started (scope "envrun:<id>").
    if (scopeOfGrant(grant) && scopeOfGrant(grant) !== missionId) return `Grantul a fost derivat pentru ${scopeLabel(grant)}, nu pentru această execuție`;
    return null;
  }
  const scopeLabel = (grant) => (grant?.binding?.missionId ? `misiunea ${grant.binding.missionId}` : grant?.binding?.envelopeRunId ? `execuția planului ${grant.binding.envelopeRunId}` : "misiunea —");

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
