import { HubError } from "../core/errors.mjs";
import { parse } from "../storage/db.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";

/**
 * M10.2.1 (owner decision D22, the consistency of D15): what a Stop All — or a shutdown / security suspension — ITSELF stopped (an
 * operation plan, the desktop operator's session, a Software Factory mission) is resumed only after the owner rearms the gate in the
 * cockpit, whatever the path: typed or spoken „Continuă”, the plan card's own resume (ops.plan.resume), desktop.resume, a
 * clarification choice. Work paused for ANY other reason — the owner's own pause, a palette / gate.set suspension (it never pauses
 * operation plans or the desktop), a desktop intervention (USER_INPUT), „Preiau eu”, desktop.stop, a plan's own NEEDS_OWNER — keeps
 * its resume even while the gate is suspended. New operation plans after a Stop All stay allowed (M10-OP-12).
 *
 * Evidence, never inference from texts: the stop records the ids it stopped in ITS system.stop_all event (payload.scope, written by
 * runs.stopAll from the stop's own results: the missions it cancelled, the plans it paused — or, for a shutdown, the plans it
 * interrupted —, the desktop session it paused); a reader asks whether a stop of the CURRENT suspension chain (the classes stop_all,
 * shutdown, security) stopped THIS item and nothing has resumed it since. A suspension written before this version (legacy_unknown,
 * no record) falls back to "stopped at or before the suspension was written". Read-only: nothing here pauses, resumes or reopens.
 */
export const STOP_SCOPE_VERSION = 1;
/** The suspension classes whose own stop holds what it stopped until the rearm (D22); every other class never holds. */
export const STOP_HOLD_CLASSES = Object.freeze(new Set(["stop_all", "shutdown", "security", "legacy_unknown"]));
export const STOP_SCOPE_KINDS = Object.freeze(["ops", "desktop", "mission"]);
/** The classes whose stop also closes the plans still waiting for a confirmation (D15; the boot defence below). */
const STOP_CLOSE_CLASSES = new Set(["stop_all", "shutdown", "security"]);
const MAX_IDS = 200;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const STOPPED_PLAN = new Set(["PAUSED", "NEEDS_OWNER"]);
/** „… a fost oprit <BY>” per class (the owner's words). */
const BY = Object.freeze({ stop_all: "de Stop All", shutdown: "la oprirea Hub-ului", security: "după un eveniment de securitate",
  legacy_unknown: "înainte de suspendarea porții (originea opririi nu a fost înregistrată)" });
const AFTER_REARM = "îl reiei cu „Continuă” după ce redeschizi poarta aici, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello";

const idList = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? "")).filter((x) => ID.test(x)))].slice(0, MAX_IDS);

/**
 * The record a stop writes in its system.stop_all event (payload.scope): what THIS stop stopped beyond the runs. Normalized (ids only,
 * deduplicated, bounded), so a reader never trusts a shape it did not write.
 *   missions          the Software Factory missions the stop cancelled (factory.stopAll)
 *   plansPaused       the operation plans the stop paused (RUNNING / CONFIRMED at the stop)
 *   plansInterrupted  the operation plans a shutdown left running (the boot reconciles them as NEEDS_OWNER; never paused at exit)
 *   desktopSessionId  the desktop operator session the stop paused (only one that was ACTIVE: an intervention's pause stays its own)
 */
export function stopScopeRecord({ missions = [], plansPaused = [], plansInterrupted = [], desktopSessionId = null } = {}) {
  const desktop = String(desktopSessionId ?? "");
  return { v: STOP_SCOPE_VERSION, missions: idList(missions), plansPaused: idList(plansPaused), plansInterrupted: idList(plansInterrupted), desktopSessionId: ID.test(desktop) ? desktop : null };
}

export function createStopScope(hub) {
  const { db, settings } = hub;
  const current = () => classifySuspension(settings.get("executionGate") || {});

  /**
   * The stops of the current suspension chain that recorded a scope, newest first: every system.stop_all from the chain start
   * (`since` is kept across the chain; an opening starts a new one) plus the one that wrote the current record. Index-backed
   * (scope system/hub).
   */
  function chainRecords(c) {
    if (!c.id && !c.since) return [];
    const rows = db.prepare(`SELECT seq, created_at, payload_json FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all'
      AND (created_at >= ? OR json_extract(payload_json, '$.suspensionId') = ?) ORDER BY seq DESC LIMIT 50`).all(String(c.since || "9999"), String(c.id || ""));
    const out = [];
    for (const r of rows) {
      const p = parse(r.payload_json, {});
      if (p?.scope && typeof p.scope === "object") out.push({ seq: Number(r.seq), at: r.created_at, suspensionId: p.suspensionId || null, kind: p.kind || null, scope: stopScopeRecord(p.scope) });
    }
    return out;
  }

  /** The latest event of `types` for one scoped item ({ seq, type, created_at } or null). */
  const lastEvent = (scopeType, scopeId, types) => db.prepare(`SELECT seq, type, created_at FROM events WHERE scope_type = ? AND scope_id = ? AND type IN (${types.map(() => "?").join(",")}) ORDER BY seq DESC LIMIT 1`)
    .get(scopeType, String(scopeId), ...types) || null;

  /** An operation plan the current suspension's stop paused (or a shutdown interrupted) and nothing resumed since; else null. */
  function opsHeld(planId, c, recs) {
    const p = db.prepare("SELECT id, title, status FROM ops_plans WHERE id = ?").get(String(planId || ""));
    if (!p || !STOPPED_PLAN.has(p.status)) return null;
    if (c.cls === "legacy_unknown") {
      const last = lastEvent("ops_plan", p.id, ["ops.plan.paused", "ops.plan.needs_owner", "ops.plan.running", "ops.plan.resumed"]);
      return last && (last.type === "ops.plan.paused" || last.type === "ops.plan.needs_owner") && c.at && last.created_at <= c.at ? p : null;
    }
    for (const r of recs) {
      if (!r.scope.plansPaused.includes(p.id) && !r.scope.plansInterrupted.includes(p.id)) continue;
      // A plan that ran again after the stop (resumed, then stopped for its own reason) is no longer the stop's.
      const ranSince = db.prepare("SELECT 1 FROM events WHERE scope_type = 'ops_plan' AND scope_id = ? AND seq > ? AND type IN ('ops.plan.running','ops.plan.resumed') LIMIT 1").get(p.id, r.seq);
      if (!ranSince) return p;
    }
    return null;
  }

  /** The desktop session (PAUSED) the current suspension's stop paused, when its latest pause is still that stop's; else null. */
  function desktopHeld(sessionId, c, recs) {
    const s = sessionId ? db.prepare("SELECT id, status FROM desktop_sessions WHERE id = ?").get(String(sessionId))
      : db.prepare("SELECT id, status FROM desktop_sessions WHERE status = 'PAUSED' LIMIT 1").get();
    if (!s || s.status !== "PAUSED") return null;
    const lastPause = lastEvent("desktop", s.id, ["desktop.session.paused"]);
    if (c.cls === "legacy_unknown") return lastPause && c.at && lastPause.created_at <= c.at ? s : null;
    // An intervention (USER_INPUT, a lost focus…) after the stop pauses the session again: that later pause is the session's own.
    for (const r of recs) if (r.scope.desktopSessionId === s.id && (!lastPause || lastPause.seq < r.seq)) return s;
    return null;
  }

  /** A Software Factory mission the current suspension's stop cancelled (it stays stopped); else null. */
  function missionHeld(missionId, c, recs) {
    const f = db.prepare("SELECT fm.mission_id AS id, fm.stage, m.title FROM factory_missions fm LEFT JOIN missions m ON m.id = fm.mission_id WHERE fm.mission_id = ?").get(String(missionId || ""));
    if (!f) return null;
    if (c.cls === "legacy_unknown") {
      if (!["PAUSED", "CANCELLED"].includes(f.stage)) return null;
      const last = lastEvent("mission", f.id, ["factory.stage"]);
      return last && c.at && last.created_at <= c.at ? f : null;
    }
    return recs.some((r) => r.scope.missions.includes(f.id)) ? f : null;
  }

  const reasonFor = (kind, item, cls) => {
    const by = BY[cls] || BY.legacy_unknown;
    if (kind === "ops") return `Planul de operare „${String(item.title || item.id).slice(0, 120)}” a fost oprit ${by}: ${AFTER_REARM}.`;
    if (kind === "desktop") return `Operatorul desktop a fost oprit ${by}: ${AFTER_REARM}.`;
    return `Misiunea „${String(item.title || item.id).slice(0, 120)}” a fost oprită ${by} și rămâne oprită; după ce redeschizi poarta aici, în cockpit, cu Windows Hello, decizi tu cum continuă.`;
  };

  /**
   * Whether the CURRENT suspension itself stopped this item (D22): { held, cls, code: 'GATE_REARM_REQUIRED' | null, reason (ro) | null }.
   * `kind` ops (id = the plan), desktop (id = the session; omitted = the paused session), mission (id = the mission).
   */
  function heldByStop({ kind, id = null } = {}) {
    if (!STOP_SCOPE_KINDS.includes(kind)) throw new HubError("validation", `Tip necunoscut pentru oprire: ${String(kind).slice(0, 20)}`);
    const c = current();
    const free = { held: false, cls: c.cls, code: null, reason: null };
    if (!STOP_HOLD_CLASSES.has(c.cls)) return free;
    const recs = c.cls === "legacy_unknown" ? [] : chainRecords(c);
    const item = kind === "ops" ? opsHeld(id, c, recs) : kind === "desktop" ? desktopHeld(id, c, recs) : missionHeld(id, c, recs);
    return item ? { held: true, cls: c.cls, code: "GATE_REARM_REQUIRED", reason: reasonFor(kind, item, c.cls) } : free;
  }

  /** Everything the current suspension's own stop holds now: { cls, ops: Set<planId>, desktop: boolean, missions: Set<missionId> }. */
  function stoppedSet() {
    const c = current();
    const out = { cls: c.cls, ops: new Set(), desktop: false, missions: new Set() };
    if (!STOP_HOLD_CLASSES.has(c.cls)) return out;
    const recs = c.cls === "legacy_unknown" ? [] : chainRecords(c);
    for (const p of db.prepare("SELECT id FROM ops_plans WHERE status IN ('PAUSED','NEEDS_OWNER')").all()) if (opsHeld(p.id, c, recs)) out.ops.add(p.id);
    out.desktop = Boolean(desktopHeld(null, c, recs));
    if (c.cls === "legacy_unknown") {
      for (const f of db.prepare("SELECT mission_id FROM factory_missions WHERE stage IN ('PAUSED','CANCELLED') ORDER BY updated_at DESC LIMIT ?").all(MAX_IDS)) if (missionHeld(f.mission_id, c, recs)) out.missions.add(f.mission_id);
    } else for (const r of recs) for (const m of r.scope.missions) out.missions.add(m);
    return out;
  }

  return { heldByStop, stoppedSet, chainRecords: () => chainRecords(current()) };
}

/** One turn of the event loop: the reactions a writer deferred with setImmediate (and the promise each one starts) run first. */
export const drainDeferred = () => new Promise((resolve) => setImmediate(resolve));

/**
 * The Hub's own shutdown (main.mjs; SM-05). With work in flight — an active run, or a start still in admission (AS-01) — the stop
 * records its origin as the shutdown (D17) and the operation plans it leaves running as interrupted (D22; they are never paused at
 * exit: the boot reconciles their running step as uncertain → NEEDS_OWNER). Then the reactions the stop queued — the closure of plans
 * still waiting for a confirmation (D15) — run BEFORE the services close; otherwise envelopes.close() would drop them and a card shown
 * before the stop would be confirmable again after a restart and a rearm. Two turns: what those reactions queue in turn runs too.
 */
export async function stopForShutdown(hub, signal = "shutdown") {
  let out = null;
  if (Number(hub.runs?.activeCount?.() || 0) > 0) {
    const running = () => { try { return (hub.opsPlans?.active?.() || []).filter((p) => ["RUNNING", "CONFIRMED"].includes(p.status)).map((p) => p.id); } catch { return []; } };
    out = await hub.runs.stopAll("system", `Hub shutdown (${String(signal).slice(0, 40)})`, { kind: "shutdown", channel: "system", actor: "system" },
      { alsoStop: async () => ({ plansInterrupted: running() }) });
  }
  await drainDeferred();
  await drainDeferred();
  return { stopped: Boolean(out), suspensionId: out?.suspensionId || null };
}

/**
 * Boot defence (SM-05, D15): when the gate is still suspended by a stop (stop_all, shutdown, security), a plan still waiting for its
 * confirmation that was proposed before that stop is closed now („Stop All”, an owner closure: its preserved request goes back to OPEN
 * and is not re-proposed) — the stop's own deferred closure may have been lost with the previous process. A plan proposed after the
 * stop is never touched. Idempotent; nothing is started, confirmed or reopened.
 */
export function closeProposalsFromBeforeStop(hub) {
  const c = classifySuspension(hub.settings.get("executionGate") || {});
  if (!STOP_CLOSE_CLASSES.has(c.cls) || !hub.envelopes?.revoke) return { closed: [], cls: c.cls };
  // The stop event's own time when it is recorded (the closure it would have run compares with it), else the record's.
  const stopEvent = c.id ? hub.db.prepare("SELECT created_at FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all' AND json_extract(payload_json, '$.suspensionId') = ? ORDER BY seq DESC LIMIT 1").get(c.id) : null;
  const stoppedAt = stopEvent?.created_at || c.at;
  if (!stoppedAt) return { closed: [], cls: c.cls };
  const closed = [];
  for (const r of hub.db.prepare("SELECT id FROM mission_envelopes WHERE status = 'PROPOSED' AND created_at <= ? ORDER BY created_at").all(stoppedAt)) {
    try { if (hub.envelopes.revoke(r.id, { actor: "recovery", reason: "Stop All" })?.status !== "PROPOSED") closed.push(r.id); } catch { /* reported by the plan's own status */ }
  }
  if (closed.length) {
    hub.bus.emit({ type: "recovery.stop_proposals_closed", scopeType: "system", scopeId: "gate", source: "recovery",
      payload: { cls: c.cls, suspensionId: c.id || null, stoppedAt, envelopes: closed.slice(0, 50), count: closed.length } });
  }
  return { closed, cls: c.cls };
}
