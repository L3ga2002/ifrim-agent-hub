import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";
import { readinessOnlyDelta } from "./blockers.mjs";

/**
 * M10.2 preserved work requests (migration 11). Before M10.2 a request the gate refused was dropped: Lega logged only the tool
 * name and the owner had to fix the blocker elsewhere and ask again from scratch. Here the request is kept (redacted text, source,
 * project, intent, effect class) together with the blocker signature, and:
 *
 *  - the full explanation is given ONCE per (request, blocker signature); later mentions get one line ("Încă blocat de X; cererea
 *    ta e păstrată"). A new signature (another cause) is explained in full again;
 *  - when an event may have cleared a cause (attestation PASS, account check, isolation / route / autonomy / billing decisions,
 *    a media import, a skills reconcile), the request is explained again from verified state and, when nothing blocks any more,
 *    RE-PROPOSED through the planner: a proposal only (a PROPOSED plan + one `lega.plan` event). Nothing is confirmed or started
 *    here; the owner's one confirmation is still required;
 *  - when the plan it became closes without fulfilling it (expired, superseded, cancelled, revoked, failed to start; ops plan
 *    expired / superseded / cancelled / failed) it goes back to OPEN with its draft link, and is re-proposed unless the owner closed
 *    that plan himself or another plan waits (review #33); a plan that finishes (COMPLETED / ops DONE) makes it DONE;
 *  - the owner can cancel it ("renunță la cerere"); it expires after 7 days.
 *
 * `confirmForReadiness` records the owner's one confirmation of a plan whose only blockers are automatic readiness steps (owner
 * decision 3): it is what lets the readiness runner re-attest on the same fingerprint as a pre-step. It is checked against the
 * plan the owner saw (nonce + hash, still PROPOSED, in time) in a server-resolved owner session under the voice-first policy.
 */
export const WORK_REQUEST_STATUSES = Object.freeze(["OPEN", "BLOCKED", "PLANNED", "CONFIRMED", "DONE", "CANCELLED", "EXPIRED"]);
export const WORK_REQUEST_TTL_DAYS = 7;
const LIVE = new Set(["OPEN", "BLOCKED", "PLANNED", "CONFIRMED"]);
// run = one bounded analysis step (run plan), re-proposed by the intake; sales (M12 final review F7) = an offer request kept until the exports
// folder exists, explained and re-proposed by the intake's Sales rules (owner/sales-kept.mjs).
const INTENTS = new Set(["engineering", "studio", "operation", "run", "sales", "other"]);
/** Event types after which a preserved request is explained again (and re-proposed when nothing blocks). */
export const CLEARING_EVENTS = Object.freeze(new Set(["environment.attested", "environment.probed", "environment.reviewer_probed", "environment.inspected", "provider.probed",
  "billing.declared", "media.asset.imported", "skill.reconciled", "readiness.completed"]));
const CLEARING_SETTINGS = Object.freeze(new Set(["r2Acceptance", "environmentPolicy", "projectEnvironments", "projectAutonomy", "executionGate", "projectFreeze", "billingEvidence", "isolationConsent", "mediaToolPins"]));
/**
 * Review #33: the closures of the plan a request became that did NOT fulfil it (COMPLETED / ops DONE make it DONE instead). The
 * request goes back to OPEN — never stuck PLANNED behind a plan that no longer exists (a false "plan pregătit" notice, a slot of
 * Lega's proposal cap, an intake draft the cleanup would retire). Envelope statuses and ops event types.
 */
export const PLAN_CLOSERS = Object.freeze({ envelope: Object.freeze(new Set(["EXPIRED", "SUPERSEDED", "CANCELLED", "REVOKED", "FAILED_TO_START"])),
  ops: Object.freeze(new Set(["ops.plan.expired", "ops.plan.superseded", "ops.plan.cancelled", "ops.plan.failed"])) });
/**
 * Closures that are the owner's own decision (cancel, a revoke / Stop): the request stays preserved (OPEN) but is NOT re-proposed
 * on its own; re-proposing right after the owner withdrew the plan would undo his decision. He mentions it again or cancels it.
 */
const OWNER_CLOSURES = Object.freeze(new Set(["CANCELLED", "REVOKED"]));

export function isClearingEvent(event) {
  if (!event?.type) return false;
  if (event.type === "settings.changed") return CLEARING_SETTINGS.has(event.payload?.key);
  if (event.type === "environment.attested") return /^PASS/.test(String(event.payload?.status || ""));
  return CLEARING_EVENTS.has(event.type);
}

export function createWorkRequests({ db, bus, clock, live = null, trust = null, envelopes = null }) {
  const iso = (d = clock()) => d.toISOString();
  let explainer = null; // (request) → Promise<explanation> (readiness-runner: collectFacts + explain); late-bound in hub.mjs
  let planner = null; // (request) → Promise<{ planRef, headline } | null>: U07/U09/U10 planners; default below
  const replanning = new Set();

  const rowTo = (r) => r && ({ id: r.id, text: r.text_redacted, source: r.source, channel: r.channel, projectId: r.project_id, intent: r.intent, effectClass: r.effect_class,
    status: r.status, blockerSignature: r.blocker_signature, explainedAt: r.explained_at, explanation: parse(r.explanation_json, {}), planRef: parse(r.plan_ref, null),
    consent: parse(r.consent_json, null), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at, version: r.version });
  const get = (id) => rowTo(db.prepare("SELECT * FROM work_requests WHERE id = ?").get(String(id || "")));
  const need = (id) => { const r = get(id); if (!r) throw new HubError("not_found", "Cerere necunoscută"); return r; };
  function list({ status = null, projectId = null, limit = 50 } = {}) {
    const where = []; const args = [];
    if (status) { where.push(`status IN (${[].concat(status).map(() => "?").join(",")})`); args.push(...[].concat(status)); }
    if (projectId) { where.push("project_id = ?"); args.push(projectId); }
    return db.prepare(`SELECT * FROM work_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`).all(...args, Math.min(200, limit)).map(rowTo);
  }
  const openFor = (projectId) => list({ status: [...LIVE], projectId, limit: 20 });

  function update(id, fields, event = null) {
    const cols = Object.keys(fields);
    return bus.transaction(() => {
      const n = db.prepare(`UPDATE work_requests SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(fields), iso(), id).changes;
      if (n && event) bus.append({ type: event.type, scopeType: "work_request", scopeId: id, projectId: event.projectId ?? null, source: event.source || "work-requests", payload: event.payload || {} });
      return n;
    });
  }

  /** Keeps a request. The text is redacted and bounded (it is the owner's words, never a secret store). */
  function create({ text = "", source = "typed", channel = "ui", projectId = null, intent = "engineering", effectClass = "", planRef = null, actor = "owner" } = {}) {
    if (!INTENTS.has(intent)) throw new HubError("validation", `Tip de cerere necunoscut: ${intent}`);
    const id = newId("wrq");
    const t = clock();
    bus.transaction(() => {
      db.prepare(`INSERT INTO work_requests (id, text_redacted, source, channel, project_id, intent, effect_class, status, plan_ref, created_by, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`).run(id, redactText(String(text)).replace(/\s+/g, " ").trim().slice(0, 1000), String(source).slice(0, 40), String(channel).slice(0, 20),
        projectId || null, intent, String(effectClass || "").slice(0, 40), planRef ? json(planRef) : null, String(actor).slice(0, 80), iso(t), iso(t),
        new Date(t.getTime() + WORK_REQUEST_TTL_DAYS * 86400000).toISOString());
      bus.append({ type: "work_request.created", scopeType: "work_request", scopeId: id, projectId: projectId || null, source: actor, payload: { intent, source, channel, effectClass: effectClass || null } });
    });
    return get(id);
  }

  /**
   * The one-time rule. Records the explanation's signature on the request and returns what to say: the full server-authored text the
   * first time this request meets this signature, then the short line. A request with no blocker is OPEN again (nothing to say).
   */
  function explainOnce(id, explanation) {
    const r = need(id);
    if (!LIVE.has(r.status)) return { mode: "none", text: "", signature: r.blockerSignature, request: r };
    if (!explanation?.blocked) {
      if (r.status === "BLOCKED") update(id, { status: "OPEN", blocker_signature: "", explained_at: null, explanation_json: "{}" }, { type: "work_request.unblocked", projectId: r.projectId, payload: { previous: r.blockerSignature } });
      return { mode: "none", text: "", signature: "", request: get(id) };
    }
    const summary = json({ cause: explanation.cause, causes: explanation.causes, options: (explanation.options || []).map((o) => ({ kind: o.kind, code: o.code, label: o.label })), automaticOnly: explanation.automaticOnly });
    if (r.blockerSignature === explanation.signature && r.explainedAt) {
      if (r.status !== "BLOCKED" && r.status !== "CONFIRMED") update(id, { status: "BLOCKED", explanation_json: summary });
      return { mode: "short", text: explanation.short, signature: explanation.signature, request: get(id) };
    }
    update(id, { status: r.status === "CONFIRMED" ? "CONFIRMED" : "BLOCKED", blocker_signature: explanation.signature, explained_at: iso(), explanation_json: summary },
      { type: "work_request.blocked", projectId: r.projectId, payload: { signature: explanation.signature, causes: explanation.causes, automaticOnly: explanation.automaticOnly } });
    return { mode: "full", text: explanation.text, signature: explanation.signature, request: get(id) };
  }

  /** A signature that changed without being spoken (an event cleared one cause, another remains): the next mention is full again. */
  function noteSignature(id, explanation) {
    const r = need(id);
    if (r.blockerSignature === explanation.signature) return false;
    update(id, { blocker_signature: explanation.signature, explained_at: null, explanation_json: json({ cause: explanation.cause, causes: explanation.causes, automaticOnly: explanation.automaticOnly }) },
      { type: "work_request.blocked", projectId: r.projectId, payload: { signature: explanation.signature, causes: explanation.causes, automaticOnly: explanation.automaticOnly, spoken: false } });
    return true;
  }

  function cancel(id, actor = "owner") {
    const r = need(id);
    if (!LIVE.has(r.status)) throw new HubError("conflict", `Cererea nu mai e activă (${r.status})`);
    update(id, { status: "CANCELLED" }, { type: "work_request.cancelled", projectId: r.projectId, source: actor, payload: { from: r.status } });
    return get(id);
  }
  function markDone(id, actor = "hub") {
    const r = need(id);
    if (!LIVE.has(r.status)) return r;
    update(id, { status: "DONE" }, { type: "work_request.done", projectId: r.projectId, source: actor, payload: { planRef: r.planRef } });
    return get(id);
  }
  function markPlanned(id, planRef, { headline = "", readinessOnly = null, actor = "work-requests" } = {}) {
    const r = need(id);
    update(id, { status: "PLANNED", plan_ref: json(planRef), blocker_signature: "", explained_at: null }, { type: "work_request.planned", projectId: r.projectId, source: actor, payload: { planRef } });
    // The owner is told the plan is ready; it is a proposal only (U08 renders it, the owner confirms it once).
    const payload = { workRequestId: id, projectId: r.projectId, planRef, headline: String(headline || "").slice(0, 200), needsConfirmation: true, afterReadiness: r.status === "CONFIRMED", readinessOnly };
    bus.emit({ type: "lega.plan", scopeType: "work_request", scopeId: id, projectId: r.projectId, source: actor, payload });
    try { live?.publish({ type: "lega.plan", data: payload }); } catch { /* a live listener never breaks the record */ }
    return get(id);
  }

  /**
   * The owner's one confirmation of the plan a blocked request became (owner decision 3). The session is the one the HTTP layer
   * resolved; the plan must be the one the owner saw (nonce + hash, PROPOSED, not past its confirm-by) and belong to this request's
   * project. Recorded as CONFIRMED with the consent reference; it is what authorizes a same-fingerprint re-attestation pre-step.
   */
  function confirmForReadiness(id, { session, envelopeId, nonce, displayedHash, modality = "click" } = {}) {
    if (!trust || !envelopes) throw new HubError("internal", "Confirmarea cererii nu e disponibilă");
    if (!trust.policy().active) throw new HubError("policy", "Politica voice-first nu este activă");
    const s = trust.requireSession(session, "confirmarea unei cereri păstrate");
    const r = need(id);
    if (!["BLOCKED", "PLANNED", "OPEN"].includes(r.status)) throw new HubError("conflict", `Cererea nu mai așteaptă confirmarea (${r.status})`);
    const env = envelopes.get(envelopeId);
    if (!env || env.status !== "PROPOSED") throw new HubError("conflict", "Planul nu mai așteaptă confirmarea");
    if (new Date(env.confirmBy) <= clock()) throw new HubError("conflict", "Planul a expirat; cere-l din nou");
    if (nonce !== env.nonce || displayedHash !== env.envelopeHash) throw new HubError("conflict", "Confirmarea nu corespunde planului afișat (altă versiune); reîncarcă planul");
    if (r.projectId && env.projectId !== r.projectId) throw new HubError("policy", "Planul e pentru alt proiect decât cererea");
    if (!["click", "keyboard", "typed", "voice"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută");
    const consent = { channel: "owner_session", sessionId: s.id, envelopeId: env.id, envelopeHash: env.envelopeHash, missionIds: env.missionIds, body: { attestationRefs: env.body?.attestationRefs || [] }, modality, at: iso() };
    update(id, { status: "CONFIRMED", consent_json: json(consent), plan_ref: json({ kind: "envelope", id: env.id, missionId: env.missionIds[0] || null }) },
      { type: "work_request.confirmed", projectId: r.projectId, source: "owner", payload: { envelopeId: env.id, hash: env.envelopeHash.slice(0, 16), session: s.id, modality } });
    return get(id);
  }

  /** Whether a request carries the owner's confirmation the readiness runner may act on (DB state, never a caller's claim). */
  function confirmedForReadiness(id) {
    const r = get(id);
    if (!r || r.status !== "CONFIRMED" || r.consent?.channel !== "owner_session" || !r.consent.sessionId) return null;
    if (new Date(r.expiresAt) <= clock()) return null;
    return r;
  }

  // ---------- re-planning (proposal only) ----------
  /** Default planner: a Software Factory draft named by the request (or the project's own SPEC_DRAFT) → a PROPOSED envelope. */
  async function defaultPlanner(r) {
    if (r.intent !== "engineering" || !envelopes || !r.projectId) return null;
    const missionId = r.planRef?.missionId || null;
    const out = await envelopes.propose({ projectId: r.projectId, missionIds: missionId ? [missionId] : [], actor: `readiness:${r.id}`, via: "work_request" });
    if (!out?.envelope) return { blocked: true, readiness: out?.readiness || null };
    return { planRef: { kind: "envelope", id: out.envelope.id, missionId: out.envelope.missionIds?.[0] || missionId }, headline: out.summary?.headline || "", eligible: Boolean(out.readiness?.eligible || out.readiness?.afterReadiness || out.summary?.state === "PLAN_READY_AFTER_READINESS"), body: out.envelope.body || null };
  }

  /**
   * Explains a live request again from verified state; with no blocker left it is re-proposed (a plan to confirm, never a start).
   * Returns { status, explanation, planned }.
   */
  async function replan(id) {
    if (replanning.has(id)) return { status: "busy" };
    replanning.add(id);
    try {
      const r = need(id);
      if (!LIVE.has(r.status) || r.status === "PLANNED") return { status: r.status };
      if (new Date(r.expiresAt) <= clock()) { expireOne(r); return { status: "EXPIRED" }; }
      const explanation = explainer ? await explainer(r) : null;
      if (explanation?.blocked) {
        // An OPEN request (e.g. reopened after its plan expired, #33) that is blocked now becomes BLOCKED, so the clearing events
        // (which re-plan BLOCKED / CONFIRMED requests) re-propose it when the cause clears; the next mention is the full text.
        if (r.status === "OPEN") update(id, { status: "BLOCKED" });
        noteSignature(id, explanation);
        return { status: get(id).status, explanation };
      }
      const plan = await (planner || defaultPlanner)(r);
      if (!plan) { if (r.status === "BLOCKED") explainOnce(id, { blocked: false }); return { status: get(id).status, explanation }; }
      if (plan.blocked || plan.eligible === false) return { status: get(id).status, explanation, planned: null };
      // After a readiness pre-step under the owner's confirmation, say whether the new plan differs only by the refreshed evidence
      // (the lifecycle decides what that confirmation still covers; this service never confirms).
      const readinessOnly = r.status === "CONFIRMED" && r.consent?.body && plan.body ? readinessOnlyDelta(r.consent.body, { attestationRefs: plan.body.attestationRefs }).readinessOnly : null;
      markPlanned(id, plan.planRef, { headline: plan.headline, readinessOnly });
      return { status: "PLANNED", explanation, planned: plan.planRef };
    } finally { replanning.delete(id); }
  }

  /**
   * M10.2.1 (D15): the ONE request whose rearm card the owner confirmed is re-proposed right after the gate reopens — through the same
   * re-plan path (explained again from verified state; a plan to confirm, never a start). Every other preserved request waits until it
   * is mentioned again (the gate sweep is skipped for a rearm, onEvent below). A request already planned or closed is reported as it
   * is. Returns { requestId, status, planned, envelopeId?, planId?, blocked, text }.
   */
  async function reproposeOne(id) {
    const r = need(id);
    const out = (planRef, extra = {}) => ({ requestId: r.id, status: get(r.id)?.status || r.status, planned: planRef || null,
      ...(planRef?.kind === "envelope" ? { envelopeId: planRef.id } : planRef?.kind === "ops" ? { planId: planRef.id } : {}), blocked: false, text: "", ...extra });
    if (!LIVE.has(r.status)) return out(null, { text: `Cererea nu mai e activă (${r.status}).` });
    if (r.status === "PLANNED") return out(r.planRef, { already: true });
    let res = await replan(r.id);
    if (res?.status === "busy") {
      // Another re-plan of the same request is running (it re-proposes it itself): wait for it (bounded, ~2 s), then report it as it is.
      for (let i = 0; i < 40 && replanning.has(r.id); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      const now = get(r.id);
      res = { status: now?.status, planned: now?.status === "PLANNED" ? now.planRef : null };
    }
    const ex = res?.explanation || null;
    return out(res?.planned || null, { blocked: Boolean(ex?.blocked), text: ex?.blocked ? String(ex.short || ex.text || "").slice(0, 400) : "" });
  }

  // ---------- a plan that closed without fulfilling its request (review #33) ----------
  /** { kind: "envelope"|"ops", status } for a closure in PLAN_CLOSERS, else null. */
  function planClosure(event) {
    if (event.type === "envelope.status" && PLAN_CLOSERS.envelope.has(event.payload?.status)) return { kind: "envelope", status: event.payload.status };
    if (PLAN_CLOSERS.ops.has(event.type)) return { kind: "ops", status: event.type.slice("ops.plan.".length).toUpperCase() };
    return null;
  }
  /**
   * Whether another plan still waits for the owner in the closed plan's supersede scope (envelopes: the same project; ops plans:
   * the same kind). Re-proposing then would supersede THAT plan — the one the owner was just shown — and two preserved requests
   * on one project would supersede each other forever. Unknown (a read error) counts as waiting: never re-propose on a guess.
   */
  function otherPlanWaiting(kind, planId) {
    try {
      const t = iso();
      if (kind === "envelope") return Boolean(db.prepare(`SELECT 1 FROM mission_envelopes WHERE status = 'PROPOSED' AND confirm_by > ? AND id <> ?
        AND project_id = (SELECT project_id FROM mission_envelopes WHERE id = ?) LIMIT 1`).get(t, planId, planId));
      return Boolean(db.prepare(`SELECT 1 FROM ops_plans WHERE status = 'PROPOSED' AND confirm_by > ? AND id <> ?
        AND kind = (SELECT kind FROM ops_plans WHERE id = ?) LIMIT 1`).get(t, planId, planId));
    } catch { return true; }
  }
  /** How many times this request was already reopened because a plan it became expired (the event is the durable counter). */
  const expiryReopenings = (id) => db.prepare(`SELECT COUNT(*) AS n FROM events WHERE scope_type = 'work_request' AND scope_id = ? AND type = 'work_request.reopened'
    AND json_extract(payload_json, '$.planStatus') = 'EXPIRED'`).get(id).n;

  /**
   * Synchronous, in the same subscriber pass as the closure (before the engineering draft cleanup's setImmediate reads the request):
   * every PLANNED / CONFIRMED request that pointed at the closed plan goes back to OPEN. Its draft link (plan_ref.missionId) is kept,
   * so the cleanup's "held" check still keeps the draft; the blocker signature is cleared, so the next mention is explained in full;
   * a CONFIRMED request's consent referred to the closed plan and goes with it (the owner confirms the next plan once, as always).
   * A request that is re-planning right now is skipped: the SUPERSEDED of its own previous plan is its re-proposal, not a loss.
   * Then, unless the owner closed it (cancel / revoke) or another plan waits in that scope, the request is re-proposed (a proposal
   * only, through replan); after an expiry only once, so an ignored plan is not re-presented every 15 minutes for a week.
   */
  function reopenFor(planId, { kind, status }) {
    const rows = db.prepare("SELECT * FROM work_requests WHERE status IN ('PLANNED','CONFIRMED') AND json_extract(plan_ref, '$.id') = ?").all(planId).map(rowTo);
    for (const r of rows) {
      if (replanning.has(r.id)) continue;
      if (r.planRef?.kind && r.planRef.kind !== kind) continue;
      const missionId = r.planRef?.missionId || null;
      const n = update(r.id, { status: "OPEN", plan_ref: missionId ? json({ kind: "mission", missionId }) : null, blocker_signature: "", explained_at: null, explanation_json: "{}", consent_json: null },
        { type: "work_request.reopened", projectId: r.projectId, payload: { from: r.status, planKind: kind, planId, planStatus: status } });
      if (!n) continue;
      if (OWNER_CLOSURES.has(status) || otherPlanWaiting(kind, planId)) continue;
      if (status === "EXPIRED" && expiryReopenings(r.id) > 1) continue;
      setImmediate(() => { replan(r.id).catch(() => {}); });
    }
  }

  /** Post-commit: an event that may clear a cause re-explains the live requests it can concern (bounded, serialized per request). */
  function onEvent(event) {
    // A preserved request is DONE when the plan it became finishes with a verified result (ops plan DONE, envelope COMPLETED):
    // the owner then sees it as fulfilled, never as still waiting.
    const finished = event.type === "ops.plan.done" || (event.type === "envelope.status" && event.payload?.status === "COMPLETED");
    if (finished && event.scopeId) {
      for (const row of db.prepare("SELECT id FROM work_requests WHERE status IN ('PLANNED','CONFIRMED') AND json_extract(plan_ref, '$.id') = ?").all(event.scopeId)) markDone(row.id, "work-requests");
      return;
    }
    const closed = planClosure(event);
    if (closed && event.scopeId) { reopenFor(event.scopeId, closed); return; }
    if (!isClearingEvent(event)) return;
    // M10.2.1 (D15): the owner's contextual rearm reopens the gate for the request that showed the card only (gate-rearm.mjs re-proposes
    // it); the preserved requests are not swept — re-proposing up to 20 old requests would restart work the owner did not name. Read
    // post-commit, so the value is the one this event describes.
    // A suspension (Stop All, a pause) never clears a blocker: no sweep then — a deferred replan could otherwise run after a rearm that
    // happened in between and re-propose an old request under the reopened gate.
    if (event.type === "settings.changed" && event.payload?.key === "executionGate") {
      const gate = parse(db.prepare("SELECT value_json FROM settings WHERE key = 'executionGate'").get()?.value_json, null);
      if (gate?.status !== "open") return;
      if (gate.reopenedAfter?.via === "rearm") return;
    }
    const rows = db.prepare("SELECT id, project_id FROM work_requests WHERE status IN ('BLOCKED','CONFIRMED') AND expires_at > ? ORDER BY updated_at DESC LIMIT 20").all(iso());
    const scoped = event.projectId ? rows.filter((r) => !r.project_id || r.project_id === event.projectId) : rows;
    for (const row of scoped) setImmediate(() => { replan(row.id).catch(() => {}); });
  }

  function expireOne(r) { update(r.id, { status: "EXPIRED" }, { type: "work_request.expired", projectId: r.projectId, payload: { from: r.status } }); }
  function tick() {
    const rows = db.prepare("SELECT * FROM work_requests WHERE status IN ('OPEN','BLOCKED','PLANNED','CONFIRMED') AND expires_at <= ?").all(iso()).map(rowTo);
    for (const r of rows) expireOne(r);
    return { expired: rows.length };
  }

  return { create, get, list, openFor, explainOnce, noteSignature, cancel, markDone, markPlanned, confirmForReadiness, confirmedForReadiness, replan, reproposeOne, onEvent, tick,
    attachExplainer: (fn) => { explainer = typeof fn === "function" ? fn : null; }, attachPlanner: (fn) => { planner = typeof fn === "function" ? fn : null; } };
}

/** Commands: cancel ("renunță la cerere", fail-safe from every owner-facing channel) and the readiness confirmation (owner session). */
export function registerWorkRequestCommands(reg, hub) {
  const session = (ctx) => (ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession : null);
  reg("work.request.cancel", { describe: "Renunți la o cerere păstrată (nu mai e re-propusă)", channels: ["ui", "owner", "voice", "companion", "test"],
    schema: { workRequestId: { required: true, max: 80 } },
    execute: (input, ctx) => { const r = hub.workRequests.cancel(input.workRequestId, ctx.actor); return { workRequestId: r.id, status: r.status }; } });
  reg("work.request.confirm_readiness", { describe: "Confirmarea ta (o dată) a planului unei cereri blocate doar de pași automați de pregătire; Hub-ul îi rulează, fără model", async: true,
    channels: ["owner", "test"],
    schema: { workRequestId: { required: true, max: 80 }, envelopeId: { required: true, max: 80 }, nonce: { required: true, max: 80 }, displayedHash: { required: true, max: 80 },
      // A spoken confirmation is the server-held utterance of the envelope path (U13); a provider transcript never confirms.
      modality: { enum: ["click", "keyboard", "typed"], default: "click" } },
    execute: async (input, ctx) => {
      const r = hub.workRequests.confirmForReadiness(input.workRequestId, { session: session(ctx), envelopeId: input.envelopeId, nonce: input.nonce, displayedHash: input.displayedHash, modality: input.modality });
      // The pre-steps run after the command returns (an attestation takes ~2 min); progress is the readiness.* events.
      hub.readiness.runForRequest(r.id).catch(() => null);
      return { workRequestId: r.id, status: r.status, readiness: "started" };
    } });
}
