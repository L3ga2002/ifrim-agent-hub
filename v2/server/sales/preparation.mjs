import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { PLAN_LIMITS } from "../ops/plans.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";
import { STOP_HOLD_CLASSES, createStopScope } from "../owner/stop-scope.mjs";
import { dossierFolderNames, dossierRenderedInputs, DOSSIER_LABELS } from "./dossier.mjs";

/**
 * M12 Sales preparation (SPEC §5, owner clarifications 2 and 3): ONE plan the owner confirms once, shown as one card, run in two phases
 * over the operation plans (ops/plans.mjs), on the M11 delivery precedent (wait outside any plan, continue under the same consent):
 *
 *   phase A  `sales.prepare` (the owner's one confirmation): synthetic client → fixture research → q-v2 qualification → the offer up
 *            to READY_FOR_OWNER_REVIEW; the preparation then WAITS (WAITING_OWNER) for exactly {proposalId, proposalSha}.
 *            Confirming the plan never approves the offer (approved_sha stays NULL).
 *   phase B  `sales.dossier`, DERIVED from phase A's consent (opsPlans.adoptDerived, registerParent("sales.prepare")) — no second
 *            confirmation — and activated only by the owner's verified approval (owner session) of exactly that id + sha: the contact
 *            draft (createDraft keeps its APPROVED_INTERNAL precondition; DRAFT_ONLY) and „Dosarul ofertei”.
 *
 * The preparation row (sales_preparations, ids spp_) is the binding: a step acts only for the preparation bound to ITS plan. Every status
 * change is an event of this service (sales.preparation.status); nothing here approves, sends, contacts, hands off or deletes, and a
 * boot or a tick that changes nothing writes nothing (M04-H). A change of the offer or of its inputs, a Stop All since the consent, an
 * expiry or a revoked authority stop the automatic continuation (STALE / STOPPED / EXPIRED) and the owner continues with ONE new card
 * (`sales.preparation.continue`): the same root plan, so the C-01 ledger reuses every operation already done.
 */
export const PREPARE_KIND = "sales.prepare";
export const DOSSIER_KIND = "sales.dossier";
export const DOSSIER_PLAN_TITLE = "Ciorna de contact și dosarul ofertei (din planul confirmat, după aprobarea ta)";
export const PREPARATION_LIMITS = Object.freeze({ phaseAMinutes: PLAN_LIMITS.maxDurationMin, phaseAActions: 200, phaseBMinutes: 60, phaseBActions: 200 });
/** The automatic continuation window: from the confirmation, the phase-A plan's own limit (D11: anchored at the confirmation). */
export const ACTIVATE_WITHIN_MIN = PREPARATION_LIMITS.phaseAMinutes + PLAN_LIMITS.slackMin;
/** What a derived phase-B plan may contain (and nothing else: no decision, model, app, send, hand-off or delete). */
export const PREPARATION_PHASE_B_OPS = Object.freeze(["sales.draft", "sales.dossier", "export.local", "office.verify"]);
export const SALES_DECISIONS_LEFT = Object.freeze(["Aprobarea internă a ofertei exacte (id + SHA complet) rămâne decizia ta, separat: confirmarea planului nu o include."]);
export const SALES_NEVER = Object.freeze(["trimiterea ofertei sau a mesajului", "contactarea firmei", "publicare", "cheltuieli", "aprobarea ofertei în locul tău",
  "CONTACTED sau WON", "predarea către Engineering sau Fabrica", "ștergeri", "colectare live"]);
/** C-05: who may move a preparation where (event-only transitions; the reasons are in the report's state table). */
export const PREPARATION_TRANSITIONS = Object.freeze({
  PLANNED: ["PREPARING", "EXPIRED", "CANCELLED"],
  // Review R6: a phase-A plan whose window passed while it was paused / waiting for the owner can never resume: EXPIRED, continuable.
  PREPARING: ["WAITING_OWNER", "STALE", "EXPIRED", "FAILED", "CANCELLED"],
  WAITING_OWNER: ["PACKAGING", "STALE", "STOPPED", "EXPIRED", "CANCELLED"],
  PACKAGING: ["READY", "STALE", "STOPPED", "EXPIRED", "FAILED", "CANCELLED"],
  READY: ["STALE"],
  STALE: ["PREPARING", "CANCELLED"],
  STOPPED: ["PREPARING", "CANCELLED"],
  EXPIRED: ["PREPARING", "CANCELLED"],
  FAILED: ["PREPARING", "CANCELLED"],
  CANCELLED: [],
});
/** Statuses a continuation card may resume (one new confirmation, the same root plan). */
export const CONTINUABLE = Object.freeze(["STALE", "STOPPED", "EXPIRED", "FAILED"]);
const OPEN = ["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "STALE", "STOPPED", "EXPIRED", "FAILED"];
/** Step error codes that mean „the inputs changed” (→ STALE) rather than a failure. */
const STALE_CODES = new Set(["SALES_STALE", "SALES_INPUTS_CHANGED", "SALES_PROPOSAL_STALE", "SALES_DOSSIER_INPUTS_CHANGED", "SALES_DOSSIER_NOT_APPROVED", "IDEMPOTENCY_CONFLICT"]);
const PATCHABLE = new Set(["plan_id", "phase_b_plan_id", "org_id", "opportunity_id", "proposal_id", "awaited_proposal_id", "awaited_proposal_sha", "consent_json", "activate_by"]);
const clip = (v, n = 500) => String(v ?? "").slice(0, n);
const authorityOfCredential = (credential) => (String(credential || "").startsWith("devprofile") ? "local_dev_profile" : "webauthn");
/**
 * Review R23: the kind of a system.stop_all — runs.stopAll records this stop's own `stopKind`; an older event written by the Hub itself
 * (source „system”) is its shutdown (the probe's rule, owner/probe.mjs). Only the owner's „Oprește tot” and a security stop stop a
 * preparation; a shutdown follows the operation plans' own rules (what it interrupted waits for the owner after the restart).
 */
const STOP_KINDS = new Set(["stop_all", "shutdown", "security"]);
const stopKindOf = (payload, source) => (STOP_KINDS.has(payload?.stopKind) ? payload.stopKind : source === "system" ? "shutdown" : "stop_all");
const STOP_REASON = { stop_all: "„Oprește tot” a venit după confirmare", security: "o oprire de securitate a venit după confirmare" };

/** The four phase-A steps (the planner's card and a continuation card: the same kinds and parameters, only `continues` differs). */
export function prepareSteps({ preparationId, briefSha, continues = null }) {
  return [
    { kind: "sales.synthetic", params: { preparationId, briefSha, ...(continues ? { continues } : {}) } },
    { kind: "sales.research", params: { preparationId, mode: "fixture" } },
    { kind: "sales.qualify", params: { preparationId, formula: "q-v2" } },
    { kind: "sales.proposal.draft", params: { preparationId } },
  ];
}
/** The two phase-B steps: bound to the preparation only (their body is hashed at phase A's proposal, before any id exists). */
export const dossierSteps = ({ preparationId }) => [{ kind: "sales.draft", params: { preparationId } }, { kind: "sales.dossier", params: { preparationId } }];
export const phaseALimits = () => ({ maxDurationMin: PREPARATION_LIMITS.phaseAMinutes, maxActions: PREPARATION_LIMITS.phaseAActions });
export const phaseBLimits = () => ({ maxDurationMin: PREPARATION_LIMITS.phaseBMinutes, maxActions: PREPARATION_LIMITS.phaseBActions });

export function createSalesPreparations({ db, bus, clock, settings, sales, opsPlans, trust, ledger, media }) {
  const now = () => clock().toISOString();
  let closing = false;
  const rowOf = (id) => db.prepare("SELECT * FROM sales_preparations WHERE id = ?").get(String(id || ""));
  const view = (r) => r && ({ id: r.id, rootPlanId: r.root_plan_id, rootPlanHash: r.root_plan_hash, planId: r.plan_id || r.root_plan_id, phaseBPlanId: r.phase_b_plan_id || null,
    brief: parse(r.brief_json, {}), briefSha: r.brief_sha, orgId: r.org_id || null, opportunityId: r.opportunity_id || null, proposalId: r.proposal_id || null,
    awaited: r.awaited_proposal_id ? { proposalId: r.awaited_proposal_id, proposalSha: r.awaited_proposal_sha } : null, consent: parse(r.consent_json, null), activateBy: r.activate_by || null,
    status: r.status, statusReason: r.status_reason || "", staleReason: r.stale_reason || "", synthetic: true, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const get = (id) => view(rowOf(id));
  const need = (id) => { const p = get(id); if (!p) throw new HubError("not_found", "Pregătirea nu există.", { code: "SALES_PREPARATION_MISSING" }); return p; };
  const notBound = (why = "Pasul nu aparține planului acestei pregătiri.") => new HubError("policy", why, { code: "SALES_NOT_BOUND" });
  const rootOf = (p) => ({ planId: p.rootPlanId, planHash: p.rootPlanHash });

  /**
   * The only writer of a preparation's status (an event when it changes; extra columns may be set with it; `meta` joins the event's
   * payload, e.g. the Stop All that stopped it). A preparation that leaves PACKAGING without its dossier (CANCELLED, STOPPED, EXPIRED,
   * STALE, FAILED) can never finish that write under its plan: the partial effect is declared in the same transaction (review R9/R19).
   */
  function setStatus(id, to, reason = "", { from = null, extra = {}, meta = null } = {}) {
    return bus.transaction(() => {
      const p = need(id);
      if (from && !from.includes(p.status)) return false;
      const entries = Object.entries(extra).filter(([k]) => PATCHABLE.has(k));
      if (p.status === to && !entries.length) return false;
      if (p.status !== to && !(PREPARATION_TRANSITIONS[p.status] || []).includes(to)) throw new HubError("conflict", `Pregătirea nu poate trece din ${p.status} în ${to}.`, { code: "SALES_PREPARATION_TRANSITION" });
      const sets = ["status = ?", "status_reason = ?", "updated_at = ?", "version = version + 1", ...entries.map(([k]) => `${k} = ?`), ...(to === "STALE" ? ["stale_reason = ?"] : [])];
      const n = db.prepare(`UPDATE sales_preparations SET ${sets.join(", ")} WHERE id = ? AND status = ? AND version = ?`)
        .run(to, clip(reason), now(), ...entries.map(([, v]) => v), ...(to === "STALE" ? [clip(reason)] : []), id, p.status, p.version).changes;
      if (n === 1 && p.status !== to) {
        bus.append({ type: "sales.preparation.status", scopeType: "sales", scopeId: id, source: "sales", payload: { preparationId: id, from: p.status, to, reason: clip(reason, 200), opportunityId: p.opportunityId,
          ...(meta && typeof meta === "object" ? meta : {}) } });
        if (!["READY", "PACKAGING"].includes(to)) declarePartial(p, `${to}: ${clip(reason, 200)}`);
        if (to === "CANCELLED") failOpenClaims(p, `pregătirea a fost anulată: ${clip(reason, 160)}`);
      }
      return n === 1;
    });
  }
  /**
   * Review R9/R19: the dossiers of this preparation still WRITING become INCOMPLETE with the reason (event sales.dossier.incomplete,
   * partial: true) and their ledger operation FAILED. The files written so far stay where they are and stay listed in the row (never
   * overwritten, never deleted); a later continuation of the same offer, draft and inputs resumes the same row and folder.
   */
  function declarePartial(p, reason, { except = null } = {}) {
    for (const d of db.prepare("SELECT id, revision, files_json, op_key FROM sales_dossiers WHERE preparation_id = ? AND status = 'WRITING' AND id <> ?").all(p.id, String(except || ""))) {
      const why = `Parțial (nu se mai poate încheia sub acest plan): ${clip(reason, 260)}`;
      if (db.prepare("UPDATE sales_dossiers SET status = 'INCOMPLETE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'").run(why, now(), d.id).changes !== 1) continue;
      bus.append({ type: "sales.dossier.incomplete", scopeType: "sales", scopeId: d.id, source: "sales", payload: { dossierId: d.id, preparationId: p.id, revision: d.revision,
        files: parse(d.files_json, []).length, partial: true, reason: clip(why, 200) } });
      db.prepare("UPDATE sales_plan_ops SET status = 'FAILED', claim_token = NULL, result_json = ?, updated_at = ? WHERE op_key = ? AND status = 'IN_PROGRESS'").run(json({ error: clip(why, 300) }), now(), d.op_key);
    }
  }
  /** A cancelled preparation never resumes: every operation of its root still claimed (a fetch, a write) ends FAILED with the reason. */
  function failOpenClaims(p, reason) {
    db.prepare("UPDATE sales_plan_ops SET status = 'FAILED', claim_token = NULL, result_json = ?, updated_at = ? WHERE root_plan_id = ? AND status = 'IN_PROGRESS'").run(json({ error: clip(reason, 300) }), now(), p.rootPlanId);
  }

  // ---------------------------------------------------------------- PLANNED (the planner; no domain effect)
  function createPlanned({ id, brief, briefSha, plan, actor = "intake" }) {
    if (!plan?.id || plan.kind !== PREPARE_KIND || plan.status !== "PROPOSED") throw new HubError("conflict", "Pregătirea se leagă doar de planul ei propus.", { code: "SALES_NOT_BOUND" });
    if (hashCanonical(brief) !== briefSha) throw new HubError("validation", "Brieful nu corespunde amprentei lui.");
    bus.transaction(() => {
      db.prepare(`INSERT INTO sales_preparations (id, root_plan_id, root_plan_hash, plan_id, brief_json, brief_sha, status, status_reason, synthetic, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PLANNED', ?, 1, ?, ?, ?)`).run(id, plan.id, plan.hash, plan.id, json(brief), briefSha, "Propusă; aștept confirmarea planului (nimic nu a pornit)", clip(actor, 80), now(), now());
      bus.append({ type: "sales.preparation.planned", scopeType: "sales", scopeId: id, source: clip(actor, 80), payload: { preparationId: id, planId: plan.id, briefSha: briefSha.slice(0, 16) } });
    });
    return get(id);
  }

  // ---------------------------------------------------------------- binding (the steps)
  /**
   * Step 1 of a `sales.prepare` plan: the plan the preparation is bound to (the root card, or the same plan after a resume), or a
   * continuation card the owner confirmed for THIS preparation (`continues` names its root, hashed in the card) with the same credential
   * as the root confirmation, while the preparation is STALE / STOPPED / EXPIRED / FAILED.
   */
  function enterPlan(preparationId, plan) {
    const p = need(preparationId);
    if (!plan || plan.kind !== PREPARE_KIND) throw notBound();
    if (p.planId === plan.id) {
      if (!["PLANNED", "PREPARING"].includes(p.status)) throw new HubError("conflict", `Pregătirea e ${p.status}; pașii ei nu mai rulează.`, { code: "SALES_PREPARATION_STATE" });
      return p;
    }
    const cont = plan.steps?.[0]?.params?.continues;
    if (!cont || cont.rootPlanId !== p.rootPlanId || cont.rootPlanHash !== p.rootPlanHash) throw notBound();
    if (!CONTINUABLE.includes(p.status)) throw new HubError("conflict", `Pregătirea e ${p.status}; o continuare nu se aplică.`, { code: "SALES_PREPARATION_STATE" });
    if (!rootConfirmed(p)) throw new HubError("conflict", NEVER_CONFIRMED, { code: "SALES_PREPARATION_STATE" });
    // Review C2 (D22): what the owner's „Oprește tot” stopped continues only after the rearm. The step waits for the owner (STOPPED →
    // the plan NEEDS_OWNER, nothing written); after the rearm „Continuă” runs it.
    const hold = stopHold(p);
    if (hold) throw new HubError("policy", hold.reason, { code: "STOPPED", data: { rearm: true, cls: hold.cls } });
    const rootCredential = p.consent?.rootCredential || opsPlans.view(p.rootPlanId)?.consent?.credential || "";
    if (!rootCredential || rootCredential !== plan.consent?.credential) throw notBound("Continuarea a fost confirmată cu altă cheie decât planul inițial; cere pregătirea din nou.");
    return p;
  }
  const NEVER_CONFIRMED = "Cardul inițial al acestei pregătiri nu a fost confirmat niciodată: nu are ce continua; cere pregătirea din nou (o cerere nouă).";
  /** Review R18: only a preparation whose root card the owner confirmed can be continued (an expired, never-confirmed card cannot). */
  const rootConfirmed = (p) => Boolean(p.consent?.rootCredential || opsPlans.view(p.rootPlanId)?.consent?.credential);
  /** Statuses a continuation may resume AND a root the owner confirmed (the one rule the command and the read route share). */
  const isContinuable = (p) => Boolean(p) && CONTINUABLE.includes(p.status) && rootConfirmed(p);
  /**
   * Review C2 (D22, the rearm rule): the preparation was STOPPED by a Stop All (or a security stop) whose suspension still holds the
   * gate — the same suspension chain, no rearm since. → { cls, reason } | null. Read only, from the stop recorded in its status event.
   */
  function stopHold(p) {
    if (p?.status !== "STOPPED") return null;
    const last = parse(db.prepare("SELECT payload_json FROM events WHERE scope_type = 'sales' AND scope_id = ? AND type = 'sales.preparation.status' ORDER BY seq DESC LIMIT 1").get(p.id)?.payload_json, {});
    if (last.to !== "STOPPED" || !last.stop) return null;
    const c = classifySuspension(settings.get("executionGate") || {});
    if (!STOP_HOLD_CLASSES.has(c.cls)) return null;
    const same = (last.stop.suspensionId && c.id && last.stop.suspensionId === c.id) || (last.stop.at && c.since && String(last.stop.at) >= String(c.since));
    return same ? { cls: c.cls, reason: "„Oprește tot” a oprit această pregătire și poarta e încă oprită: o continuare pornește doar după ce redeschizi poarta aici, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello; apoi „Continuă”." } : null;
  }
  /** After step 1 (in its transaction): the preparation runs under THIS plan's consent; the window starts at its confirmation. */
  function enterPreparing(p, plan, ids) {
    const c = plan.consent || {};
    const consent = { planId: plan.id, planHash: plan.hash, sessionId: c.sessionId || null, credential: c.credential || "", confirmedAt: c.confirmedAt || null, modality: c.modality || null,
      authority: authorityOfCredential(c.credential), rootCredential: p.consent?.rootCredential || c.credential || "", activateBy: plan.expiresAt || null };
    const continuing = p.planId !== plan.id;
    return setStatus(p.id, "PREPARING", continuing ? `Continuarea confirmată de tine rulează (planul ${plan.id})` : "Planul confirmat rulează (fără model; nimic nu pleacă din calculator)", {
      from: ["PLANNED", "PREPARING", ...CONTINUABLE],
      extra: { plan_id: plan.id, consent_json: json(consent), activate_by: plan.expiresAt || null, org_id: ids.orgId, opportunity_id: ids.opportunityId, ...(continuing ? { phase_b_plan_id: null } : {}) } });
  }
  /** Steps 2–4 (phase A) and 5–6 (phase B): only for the preparation bound to THIS plan, in the allowed statuses. */
  function bound(preparationId, planId, { phase = "A", statuses = null } = {}) {
    const p = need(preparationId);
    if ((phase === "A" ? p.planId : p.phaseBPlanId) !== planId) throw notBound();
    const ok = statuses || (phase === "A" ? ["PREPARING"] : ["PACKAGING"]);
    if (!ok.includes(p.status)) throw new HubError("conflict", `Pregătirea e ${p.status}; pasul nu mai rulează.`, { code: "SALES_PREPARATION_STATE" });
    return p;
  }
  /** After the offer step (in its transaction): the preparation waits for the owner's approval of exactly this version. */
  function toWaiting(p, proposal) {
    return setStatus(p.id, "WAITING_OWNER", `Oferta v${proposal.version} e gata de revizuirea ta: o aprobi tu, separat (id + SHA complet); apoi ciorna și dosarul se fac fără altă întrebare`, {
      from: ["PREPARING"], extra: { proposal_id: proposal.id, awaited_proposal_id: proposal.id, awaited_proposal_sha: proposal.contentSha } });
  }

  // ---------------------------------------------------------------- the awaited offer
  /** The offer the preparation waits for is still the current one: the latest version, the same sha, open, its inputs unchanged. */
  function awaitedCurrent(p) {
    if (!p?.awaited || !p.opportunityId) return false;
    const latest = sales.latestProposal(p.opportunityId);
    return Boolean(latest && latest.id === p.awaited.proposalId && latest.contentSha === p.awaited.proposalSha && ["DRAFT", "APPROVED_INTERNAL"].includes(latest.status) && !sales.boundStale(latest));
  }
  /** The awaited offer approved by the owner in the owner session (exact id + sha, the reserved approval bound to its payload). */
  function approvedExactly(p) {
    if (!awaitedCurrent(p)) return { ok: false, status: "STALE", reason: "Oferta s-a schimbat după ce am pregătit-o (altă versiune sau alte intrări); o continuare o pregătește din nou" };
    const latest = sales.latestProposal(p.opportunityId);
    if (latest.status !== "APPROVED_INTERNAL" || latest.approvedSha !== latest.contentSha) return { ok: false, wait: true, reason: "aștept aprobarea ta" };
    const a = latest.approvalId ? db.prepare("SELECT action_kind, decided_via, payload_json FROM approvals WHERE id = ?").get(latest.approvalId) : null;
    const payload = parse(a?.payload_json, {});
    if (!a || a.action_kind !== "sales.proposal_approve" || a.decided_via !== "owner_session" || payload.proposalId !== latest.id || payload.displayedSha !== latest.contentSha) {
      return { ok: false, status: "STOPPED", reason: "Aprobarea ofertei nu vine din sesiunea ta de proprietar; ciorna și dosarul nu pornesc singure" };
    }
    const view = sales.getOpportunity(p.opportunityId);
    if (!view.org.synthetic || !view.opportunity.synthetic) return { ok: false, status: "STOPPED", reason: "Firma nu e sintetică" };
    if (view.opportunity.status !== "APPROVED_INTERNAL") return { ok: false, status: "STALE", reason: `Oportunitatea e ${view.opportunity.status}` };
    if (view.org.mergedInto || view.org.archivedAt || view.org.status === "DO_NOT_CONTACT" || view.suppression) return { ok: false, status: "STALE", reason: "Firma nu mai poate fi lucrată (unită, arhivată sau DO_NOT_CONTACT)" };
    return { ok: true, proposal: latest };
  }
  /**
   * The owner's Stop All (or a security stop) since `iso` — or since the consent event of `planId`, by event order when it is known (a fixed
   * clock or the same millisecond cannot hide it): nothing continues by itself after it. → { kind, suspensionId, at, seq } | null. Review
   * R23: a Hub shutdown (stopKind „shutdown”) is not the owner's Stop All: what it interrupted follows the operation plans' rules.
   */
  function stoppedSince(iso, planId = null) {
    if (!iso) return { kind: "stop_all", suspensionId: null, at: null, seq: null };
    const consentSeq = planId ? Number(db.prepare("SELECT MAX(seq) AS seq FROM events WHERE scope_type = 'ops_plan' AND scope_id = ? AND type = 'ops.plan.consent'").get(String(planId))?.seq || 0) : 0;
    const rows = consentSeq
      ? db.prepare("SELECT seq, created_at, source, payload_json FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all' AND seq > ? ORDER BY seq").all(consentSeq)
      : db.prepare("SELECT seq, created_at, source, payload_json FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all' AND created_at > ? ORDER BY seq").all(String(iso));
    for (const r of rows) {
      const payload = parse(r.payload_json, {});
      const kind = stopKindOf(payload, r.source);
      if (kind !== "shutdown") return { kind, suspensionId: payload.suspensionId || null, at: r.created_at, seq: Number(r.seq) };
    }
    const g = settings.get("executionGate") || {};
    const c = classifySuspension(g);
    // The gate is written before the stop's own event: a stop still in progress is seen here first (its record, not the gate's last write,
    // which a later shutdown would move).
    if (g.status !== "open" && ["stop_all", "security"].includes(c.cls) && String(c.at || "") > String(iso)) return { kind: c.cls, suspensionId: c.id || null, at: c.at, seq: null };
    return null;
  }
  const stopMeta = (s) => (s ? { stop: { kind: s.kind, suspensionId: s.suspensionId || null, at: s.at || null, seq: s.seq || null } } : null);

  // ---------------------------------------------------------------- phase B: activation (no second confirmation)
  const activations = new Map();
  function activate(id, { actor = "hub" } = {}) {
    if (closing) return Promise.resolve({ activated: false, reason: "Hub-ul se oprește" });
    if (activations.has(id)) return activations.get(id);
    const promise = activateInner(id, { actor }).catch((error) => ({ activated: false, reason: error.message })).finally(() => activations.delete(id));
    activations.set(id, promise);
    return promise;
  }
  /**
   * The activation checklist (design inv-plans §4.7, on the delivery precedent): the first failure stops it with the reason (STALE /
   * STOPPED / EXPIRED / FAILED) and nothing is written by phase B. A preparation whose offer is not approved yet just keeps waiting.
   */
  async function activateInner(id) {
    let p = get(id);
    if (!p) return { activated: false, reason: "pregătire necunoscută" };
    if (!(p.status === "WAITING_OWNER" || (p.status === "PACKAGING" && !p.phaseBPlanId))) return { activated: false, reason: `pregătirea e ${p.status}` };
    const consent = p.consent || {};
    if (p.status === "WAITING_OWNER") {
      if (p.activateBy && new Date(p.activateBy) < clock()) { setStatus(id, "EXPIRED", "Fereastra planului confirmat a trecut înainte de aprobarea ofertei; o continuare cere o confirmare nouă", { from: ["WAITING_OWNER"] }); return { activated: false, reason: "expirată" }; }
      const check = approvedExactly(p);
      if (check.wait) return { activated: false, reason: check.reason };
      if (!check.ok) { setStatus(id, check.status, check.reason, { from: ["WAITING_OWNER"] }); return { activated: false, reason: check.reason }; }
      // The plan whose consent this is must have finished (its last step put the preparation here); its DONE event activates it then.
      const plan = opsPlans.view(consent.planId);
      if (!plan || plan.status !== "DONE") return { activated: false, reason: `planul confirmat e ${plan?.status || "necunoscut"}` };
      // Compare-and-swap first: one activation only (adoptDerived inserts a plan on every call).
      if (!setStatus(id, "PACKAGING", "Ai aprobat oferta exactă: pornesc ciorna și dosarul, fără altă întrebare", { from: ["WAITING_OWNER"] })) return { activated: false, reason: "pregătirea s-a schimbat" };
      p = get(id);
    }
    const fail = (to, reason, meta = null) => { setStatus(id, to, reason, { from: ["PACKAGING"], meta }); return { activated: false, reason, status: to }; };
    if (!consent.planId || !consent.sessionId || !consent.confirmedAt) return fail("FAILED", "Pregătirea nu are confirmarea planului");
    if (p.activateBy && new Date(p.activateBy) < clock()) return fail("EXPIRED", "Fereastra planului confirmat a trecut; o continuare cere o confirmare nouă");
    const plan = opsPlans.view(consent.planId);
    if (!plan || plan.kind !== PREPARE_KIND || plan.hash !== consent.planHash || plan.status !== "DONE") return fail("FAILED", "Planul confirmat nu mai e cel terminat");
    const stopped = stoppedSince(consent.confirmedAt, consent.planId);
    if (stopped) return fail("STOPPED", `${STOP_REASON[stopped.kind] || STOP_REASON.stop_all}; ciorna și dosarul nu pornesc singure`, stopMeta(stopped));
    const held = trust.confirmedAuthority ? trust.confirmedAuthority(consent.sessionId) : { ok: false, reason: "necunoscută" };
    if (!held.ok) return fail("STOPPED", `Autorizarea în care ai confirmat planul a fost revocată (${held.reason}); ciorna și dosarul nu pornesc`);
    const check = approvedExactly(p);
    if (!check.ok) return fail(check.wait ? "STALE" : check.status, check.reason);
    const thenSha = plan.steps.find((s) => s.kind === "sales.proposal.draft")?.params?.then?.bodySha;
    if (!thenSha) return fail("FAILED", "Planul confirmat nu are pașii ciornei și ai dosarului");
    try {
      const derived = await opsPlans.adoptDerived({ kind: DOSSIER_KIND, title: DOSSIER_PLAN_TITLE, steps: dossierSteps({ preparationId: id }), limits: phaseBLimits(),
        parent: { kind: PREPARE_KIND, id: plan.id, hash: plan.hash, confirmedAt: consent.confirmedAt, deliveryId: null }, expectedBodySha: thenSha, sessionId: consent.sessionId, credential: consent.credential || "",
        onCreated: (planId) => {
          // In the plan's own transaction: a Stop All that landed while the steps were described stops it; one plan per preparation.
          const late = stoppedSince(consent.confirmedAt, consent.planId);
          if (late) throw new HubError("policy", STOP_REASON[late.kind] || STOP_REASON.stop_all, { code: "STOPPED", data: stopMeta(late) });
          const n = db.prepare("UPDATE sales_preparations SET phase_b_plan_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PACKAGING' AND phase_b_plan_id IS NULL").run(planId, now(), id).changes;
          if (n !== 1) throw new HubError("conflict", "Pregătirea s-a schimbat în timpul pornirii", { code: "SALES_PREPARATION_STATE" });
        } });
      return { activated: true, planId: derived.id };
    } catch (error) {
      if (closing) return { activated: false, reason: "Hub-ul se oprește" };
      const code = error?.code || "";
      const to = ["SESSION_CLOSED", "STOPPED"].includes(code) ? "STOPPED" : code === "PLAN_DERIVED_CHANGED" ? "STALE" : code === "PLAN_DERIVED_EXPIRED" ? "EXPIRED" : "FAILED";
      return fail(to, `Ciorna și dosarul nu au pornit: ${clip(error?.message, 200)}`, error?.details?.stop ? { stop: error.details.stop } : null);
    }
  }
  /** registerParent("sales.prepare").verify: the phase-A plan is the finished one this preparation is bound to and waits for phase B. */
  function verifyParent(parent) {
    const plan = opsPlans.view(parent?.id);
    if (!plan || plan.kind !== PREPARE_KIND) return { ok: false, reason: "planul confirmat nu mai există" };
    if (plan.hash !== parent.hash) return { ok: false, reason: "planul confirmat s-a schimbat" };
    if (plan.status !== "DONE") return { ok: false, reason: `planul confirmat e ${plan.status}` };
    const r = db.prepare("SELECT id, status, phase_b_plan_id FROM sales_preparations WHERE plan_id = ?").get(plan.id);
    if (!r || r.status !== "PACKAGING" || r.phase_b_plan_id) return { ok: false, reason: "pregătirea nu așteaptă ciorna și dosarul" };
    return { ok: true };
  }

  // ---------------------------------------------------------------- cancel, continue
  /** Fail-safe from every owner-facing channel: the running plan is cancelled and the preparation closed; what was done stays. */
  function cancel(id, { reason = "Anulată de tine", actor = "owner" } = {}) {
    const p = need(id);
    if (!OPEN.includes(p.status)) return { preparation: p, cancelled: false };
    for (const planId of [p.planId, p.phaseBPlanId].filter(Boolean)) {
      const plan = opsPlans.view(planId);
      if (plan && ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"].includes(plan.status)) opsPlans.cancel(planId, { reason, actor });
    }
    setStatus(id, "CANCELLED", `${clip(reason, 200)} (${clip(actor, 60)})`, { from: OPEN });
    return { preparation: get(id), cancelled: true };
  }
  /**
   * ONE new card that continues a preparation stopped by a change, an expiry, a Stop All or a failure: the same four steps (the ledger
   * skips what was done under the same root; a changed input makes only the affected steps run again), then the same derived
   * continuation after the owner's approval. It needs its own confirmation (the existing rule); nothing runs before it.
   */
  async function continueCard(id, { actor = "owner", via = "ui" } = {}) {
    const p = need(id);
    if (!CONTINUABLE.includes(p.status)) throw new HubError("conflict", `Pregătirea e ${p.status}; nu are ce continua.`, { code: "SALES_PREPARATION_STATE" });
    if (!rootConfirmed(p)) throw new HubError("conflict", NEVER_CONFIRMED, { code: "SALES_PREPARATION_STATE" });
    // Review C2: no card while the Stop All that stopped it still holds the gate (it could not run before the rearm anyway).
    const hold = stopHold(p);
    if (hold) throw new HubError("gate", hold.reason, { code: "GATE_REARM_REQUIRED", data: { code: "GATE_REARM_REQUIRED", rearm: true, kind: "sales.preparation", cls: hold.cls } });
    const plan = await opsPlans.propose({ kind: PREPARE_KIND, title: `Continuă pregătirea ofertei (sintetic): ${clip(p.brief?.fields?.clientType?.value || "cerere de ofertă", 80)}`,
      steps: prepareSteps({ preparationId: p.id, briefSha: p.briefSha, continues: { rootPlanId: p.rootPlanId, rootPlanHash: p.rootPlanHash } }), limits: phaseALimits(), actor, via });
    return { plan, preparation: p, decisionsLeft: SALES_DECISIONS_LEFT, never: SALES_NEVER };
  }

  // ---------------------------------------------------------------- dossiers (rows; the files are written by the plan step)
  const dossierView = (r) => r && ({ id: r.id, preparationId: r.preparation_id, opportunityId: r.opportunity_id, orgId: r.org_id || null, proposalId: r.proposal_id, proposalSha: r.proposal_sha,
    draftId: r.draft_id || null, draftSha: r.draft_sha || null, revision: r.revision, folder: r.folder, folderName: path.basename(r.folder), files: parse(r.files_json, []), manifestSha256: r.manifest_sha256 || null,
    verification: parse(r.verification_json, {}), status: r.status, statusReason: r.status_reason || "", opKey: r.op_key, inputsSha: r.inputs_sha, planId: r.ops_plan_id || null,
    labels: DOSSIER_LABELS, sent: false, synthetic: true, createdAt: r.created_at, updatedAt: r.updated_at,
    // Review R9/R19: an INCOMPLETE dossier's files are a declared partial effect (they stay; nothing is overwritten or deleted).
    partial: r.status === "INCOMPLETE" });
  const dossierOf = (id) => dossierView(db.prepare("SELECT * FROM sales_dossiers WHERE id = ?").get(String(id || "")));
  /**
   * What a dossier is evidence of, recomputed from the database: the offer, its draft (status included), the offer's inputs and — review
   * R20 / C3 — every other value the files render (the company sheet with its status and contacts, the evidence as listed with its
   * freshness, the exact qualification row the offer is bound to). No time inside. A change of any of them makes a READY dossier STALE
   * and gives a new C-01 key (a new revision), never a resume that would rebuild different bytes.
   */
  function dossierInputs(oppId) {
    const p = sales.latestProposal(oppId);
    const d = sales.latestDraft(oppId);
    const basis = p && sales.isPreparationBound(p.content) ? sales.preparationBasis(oppId, { briefSha: p.content.basis.briefSha || null }) : null;
    return { proposal: p ? { id: p.id, status: p.status, contentSha: p.contentSha, approvedSha: p.approvedSha } : null,
      draft: d ? { id: d.id, contentSha: d.contentSha, proposalSha: d.meta?.proposalSha || null, status: d.status } : null, basis: basis ? hashCanonical(basis) : null,
      rendered: p ? renderedInputs(oppId, p) : null };
  }
  function renderedInputs(oppId, proposal) {
    const view = sales.getOpportunity(oppId);
    const sheet = sales.getOrg(view.org.id);
    const boundId = proposal.content?.basis?.qualificationId || null;
    return dossierRenderedInputs({ proposal, org: view.org, contacts: sheet.contacts, evidence: sheet.evidence, unknowns: sheet.unknowns,
      qualification: boundId ? sales.qualificationById(boundId) : sheet.qualification, qualificationHistory: sheet.qualificationHistory });
  }
  const dossierKeyParams = (p, facts) => ({ preparationId: p.id, proposalId: facts.proposal.id, proposalSha: facts.proposal.contentSha, draftId: facts.draft.id, draftSha: facts.draft.contentSha,
    inputsSha: facts.inputsSha || hashCanonical(dossierInputs(p.opportunityId)) });
  /**
   * Where the next dossier of this preparation goes (no write): its C-01 key, a deterministic id derived from it, the revision and the
   * folder `<exports>\vanzari\oferta-sintetic-…\revizia-N-…`. An existing row for the key (a resume) keeps its own id and folder.
   */
  function dossierTarget(p, facts, exportsDir = media?.exportsDir?.()) {
    if (!exportsDir) throw new HubError("policy", "Nu există un folder de exporturi aprobat pentru dosarul ofertei.", { code: "SALES_DOSSIER_NO_EXPORTS_DIR" });
    const key = ledger.key(rootOf(p), "sales.dossier", dossierKeyParams(p, facts));
    const existing = db.prepare("SELECT * FROM sales_dossiers WHERE op_key = ?").get(key);
    if (existing) return { key, dossierId: existing.id, revision: existing.revision, folder: existing.folder, existing: dossierView(existing) };
    const dossierId = `sdo_${key.slice(0, 10)}_${key.slice(10, 20)}`;
    const revision = Number(db.prepare("SELECT COALESCE(MAX(revision), 0) AS n FROM sales_dossiers WHERE opportunity_id = ?").get(p.opportunityId).n) + 1;
    const names = dossierFolderNames({ orgName: facts.org.displayName, opportunityId: p.opportunityId, revision, dossierId });
    return { key, dossierId, revision, folder: path.join(path.resolve(exportsDir), names.root, names.opportunity, names.revision), existing: null };
  }
  /** The reservation (WRITING, no event): one row per C-01 key; a WRITING / INCOMPLETE row of the same key is resumed in its folder. */
  function reserveDossier({ p, target, facts, fixedAt, planId, actor }) {
    return bus.transaction(() => {
      const existing = db.prepare("SELECT * FROM sales_dossiers WHERE op_key = ?").get(target.key);
      if (existing) {
        if (existing.status === "INCOMPLETE") db.prepare("UPDATE sales_dossiers SET status = 'WRITING', status_reason = '', updated_at = ? WHERE id = ? AND status = 'INCOMPLETE'").run(now(), existing.id);
        return { dossier: dossierOf(existing.id), resumed: true };
      }
      db.prepare(`INSERT INTO sales_dossiers (id, preparation_id, opportunity_id, proposal_id, proposal_sha, revision, folder, files_json, verification_json, status, status_reason, op_key, synthetic,
        created_by, created_at, updated_at, org_id, draft_id, draft_sha, inputs_json, inputs_sha, ops_plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', 'WRITING', '', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(target.dossierId, p.id, p.opportunityId, facts.proposal.id, facts.proposal.contentSha, target.revision, target.folder, target.key, clip(actor, 80), fixedAt, now(),
          facts.org.id, facts.draft.id, facts.draft.contentSha, json(facts.inputs), facts.inputsSha, planId);
      return { dossier: dossierOf(target.dossierId), resumed: false };
    });
  }
  /** The files written so far (a declared partial effect) and, for a stop that cannot finish, INCOMPLETE with the reason. */
  function recordDossierFiles(dossierId, files, { incomplete = null, verification = null } = {}) {
    bus.transaction(() => {
      const d = dossierOf(dossierId);
      if (!d || !["WRITING", "INCOMPLETE"].includes(d.status)) return;
      db.prepare(`UPDATE sales_dossiers SET files_json = ?, ${verification ? "verification_json = ?, " : ""}updated_at = ? WHERE id = ?`).run(json(files), ...(verification ? [json(verification)] : []), now(), dossierId);
      if (incomplete && d.status === "WRITING") {
        db.prepare("UPDATE sales_dossiers SET status = 'INCOMPLETE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'").run(clip(incomplete, 300), now(), dossierId);
        bus.append({ type: "sales.dossier.incomplete", scopeType: "sales", scopeId: dossierId, source: "sales", payload: { dossierId, preparationId: d.preparationId, revision: d.revision, files: files.length, reason: clip(incomplete, 200) } });
      }
    });
  }
  /** The final transaction of the dossier step (inside the ledger's completion): READY, older READY revisions SUPERSEDED, the preparation READY. */
  function completeDossier({ dossierId, planId, files, verification, manifestSha, reused, actor }) {
    const d = dossierOf(dossierId);
    const p = need(d.preparationId);
    if (p.phaseBPlanId !== planId || p.status !== "PACKAGING") throw new HubError("conflict", `Pregătirea e ${p.status}; dosarul nu se încheie.`, { code: "SALES_PREPARATION_STATE" });
    if (hashCanonical(dossierInputs(p.opportunityId)) !== d.inputsSha) throw new HubError("conflict", "Intrările dosarului s-au schimbat în timpul scrierii.", { code: "SALES_DOSSIER_INPUTS_CHANGED" });
    const n = db.prepare("UPDATE sales_dossiers SET status = 'READY', status_reason = '', files_json = ?, verification_json = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'")
      .run(json(files), json(verification), manifestSha, now(), dossierId).changes;
    if (n !== 1) throw new HubError("conflict", "Dosarul nu mai e în scriere.", { code: "SALES_DOSSIER_STATE" });
    for (const older of db.prepare("SELECT id, revision FROM sales_dossiers WHERE opportunity_id = ? AND id <> ? AND status = 'READY'").all(d.opportunityId, dossierId)) {
      db.prepare("UPDATE sales_dossiers SET status = 'SUPERSEDED', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'READY'").run(`Înlocuit de revizia ${d.revision}`, now(), older.id);
      bus.append({ type: "sales.dossier.superseded", scopeType: "sales", scopeId: older.id, source: "sales", payload: { dossierId: older.id, revision: older.revision, by: dossierId } });
    }
    // A write of this preparation stopped earlier under other inputs (another key, review C3) will never finish: declared partial.
    declarePartial(p, `înlocuit de revizia ${d.revision}, scrisă din intrările curente`, { except: dossierId });
    setStatus(p.id, "READY", `Dosarul ofertei (revizia ${d.revision}) e gata, local; nimic trimis`, { from: ["PACKAGING"] });
    bus.append({ type: "sales.dossier.written", scopeType: "sales", scopeId: dossierId, source: clip(actor, 80), payload: { dossierId, preparationId: p.id, opportunityId: d.opportunityId, revision: d.revision,
      folderName: d.folderName, manifestSha256: manifestSha, files: files.length, app: verification?.proposalDocx?.app || null, reused: (reused || []).length } });
    return dossierOf(dossierId);
  }
  /** The latest earlier dossier of the opportunity a revision may reuse from (never one still writing or incomplete). */
  const previousDossier = (oppId, exceptId) => dossierView(db.prepare("SELECT * FROM sales_dossiers WHERE opportunity_id = ? AND id <> ? AND status IN ('READY','STALE','SUPERSEDED') ORDER BY revision DESC LIMIT 1").get(oppId, String(exceptId || "")));
  function markDossierStale(d, reason) {
    if (db.prepare("UPDATE sales_dossiers SET status = 'STALE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'READY'").run(clip(reason, 300), now(), d.id).changes === 1) {
      bus.append({ type: "sales.dossier.stale", scopeType: "sales", scopeId: d.id, source: "sales", payload: { dossierId: d.id, preparationId: d.preparationId, revision: d.revision, reason: clip(reason, 200) } });
      return true;
    }
    return false;
  }
  /** A READY dossier is current while its recorded inputs equal the recomputed ones (read-time check; never writes). */
  const dossierCurrent = (d) => d.status === "READY" && hashCanonical(dossierInputs(d.opportunityId)) === d.inputsSha;
  /** The read route: the opportunity's preparations and dossiers (GET only; contact values never appear here). */
  function forOpportunity(oppId) {
    const preparations = db.prepare("SELECT * FROM sales_preparations WHERE opportunity_id = ? ORDER BY created_at DESC").all(String(oppId || "")).map(view)
      .map((p) => ({ p, continuable: isContinuable(p), held: Boolean(stopHold(p)) }))
      .map(({ p: { brief, consent, ...rest }, continuable, held }) => ({ ...rest, request: brief?.request || "", authority: consent?.authority || null, confirmedAt: consent?.confirmedAt || null,
        decisionsLeft: SALES_DECISIONS_LEFT, continuable, waitsForRearm: held }));
    const dossiers = db.prepare("SELECT * FROM sales_dossiers WHERE opportunity_id = ? ORDER BY revision DESC").all(String(oppId || "")).map(dossierView)
      .map((d) => ({ ...d, inputsCurrent: d.status === "READY" ? dossierCurrent(d) : false }));
    return { opportunityId: String(oppId || ""), preparations, dossiers };
  }

  // ---------------------------------------------------------------- invalidation (inside the writer's transaction)
  /** sales.mjs calls this when something changed the inputs of an offer: the waiting / packaging / ready preparations and the dossiers. */
  function onInvalidated({ opportunityId, reason }) {
    if (!opportunityId) return;
    for (const d of db.prepare("SELECT * FROM sales_dossiers WHERE opportunity_id = ? AND status = 'READY'").all(opportunityId).map(dossierView)) {
      if (!dossierCurrent(d)) markDossierStale(d, reason);
    }
    for (const r of db.prepare("SELECT id FROM sales_preparations WHERE opportunity_id = ? AND status IN ('WAITING_OWNER','PACKAGING','READY')").all(opportunityId)) {
      const p = get(r.id);
      if (p.status === "READY") {
        const last = dossierView(db.prepare("SELECT * FROM sales_dossiers WHERE preparation_id = ? ORDER BY revision DESC LIMIT 1").get(p.id));
        if (!last || last.status !== "READY") setStatus(p.id, "STALE", `Dosarul nu mai corespunde: ${clip(reason, 200)}`, { from: ["READY"] });
      } else if (!awaitedCurrent(p)) setStatus(p.id, "STALE", `Oferta nu mai corespunde: ${clip(reason, 200)}`, { from: ["WAITING_OWNER", "PACKAGING"] });
    }
  }

  // ---------------------------------------------------------------- listeners (post-commit, deferred), tick, boot
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  function stepCode(planId) {
    const st = opsPlans.view(planId)?.steps?.find((s) => s.status === "FAILED");
    return { code: String(st?.error || "").split(":")[0], message: String(st?.error || "").slice(0, 200) };
  }
  function onEvent(e) {
    if (closing) return;
    const p = e.payload || {};
    try {
      if (e.type === "sales.proposal.approved" && p.proposalId) {
        for (const r of db.prepare("SELECT id FROM sales_preparations WHERE awaited_proposal_id = ? AND status = 'WAITING_OWNER'").all(String(p.proposalId))) activate(r.id).catch(() => {});
      } else if (e.type === "ops.plan.done") {
        const r = one("SELECT id FROM sales_preparations WHERE plan_id = ? AND status = 'WAITING_OWNER'", e.scopeId);
        if (r) activate(r.id).catch(() => {});
      } else if (e.type === "ops.plan.failed") {
        const r = one("SELECT id, status FROM sales_preparations WHERE (plan_id = ? AND status = 'PREPARING') OR (phase_b_plan_id = ? AND status = 'PACKAGING')", e.scopeId, e.scopeId);
        if (r) {
          const { code, message } = stepCode(e.scopeId);
          setStatus(r.id, STALE_CODES.has(code) ? "STALE" : "FAILED", `Planul s-a oprit: ${message || p.reason || "eșec"}`, { from: ["PREPARING", "PACKAGING"] });
        }
      } else if (e.type === "ops.plan.cancelled") {
        const r = one("SELECT id FROM sales_preparations WHERE (plan_id = ? OR phase_b_plan_id = ?) AND status IN ('PLANNED','PREPARING','WAITING_OWNER','PACKAGING')", e.scopeId, e.scopeId);
        if (r) setStatus(r.id, "CANCELLED", `Planul a fost anulat${p.reason ? `: ${clip(p.reason, 160)}` : ""}`, { from: ["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING"] });
      } else if (e.type === "ops.plan.superseded" || e.type === "ops.plan.expired") {
        const r = one("SELECT id FROM sales_preparations WHERE root_plan_id = ? AND status = 'PLANNED'", e.scopeId);
        if (r) setStatus(r.id, e.type === "ops.plan.expired" ? "EXPIRED" : "CANCELLED", e.type === "ops.plan.expired" ? "Cardul nu a fost confirmat la timp" : "Un card mai nou l-a înlocuit", { from: ["PLANNED"] });
      } else if (e.type === "system.stop_all") {
        // Review R23: only the owner's „Oprește tot” (or a security stop) stops a waiting preparation; a Hub shutdown does not (nothing of
        // the preparation was running; what a shutdown interrupts waits for the owner by the operation plans' own rules).
        const kind = stopKindOf(p, e.source);
        if (kind === "shutdown") return;
        const meta = { stop: { kind, suspensionId: p.suspensionId || null, at: e.createdAt || null, seq: e.seq || null } };
        for (const r of db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER'").all()) {
          setStatus(r.id, "STOPPED", `${STOP_REASON[kind] || STOP_REASON.stop_all}: ciorna și dosarul nu pornesc singure; o continuare cere o confirmare nouă, după ce redeschizi poarta`,
            { from: ["WAITING_OWNER"], meta });
        }
      } else if (e.type === "owner.sessions_revoked" || e.type === "owner.credential_revoked") {
        // Review R5/R11: a revocation ends the authority of the confirmation a waiting preparation would continue on (also when its session
        // had already ended): it stops now, with the reason, instead of at the owner's later approval.
        for (const r of db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER'").all()) {
          const held = trust.confirmedAuthority ? trust.confirmedAuthority(get(r.id)?.consent?.sessionId) : { ok: true };
          if (!held.ok) setStatus(r.id, "STOPPED", `Autorizarea în care ai confirmat planul a fost revocată (${held.reason}); ciorna și dosarul nu pornesc; o continuare cere o confirmare nouă`, { from: ["WAITING_OWNER"] });
        }
      } else if (e.type === "ops.plan.needs_owner" || e.type === "ops.plan.paused" || e.type === "ops.plan.running") {
        const r = one("SELECT id FROM sales_preparations WHERE (plan_id = ? AND status = 'PREPARING') OR (phase_b_plan_id = ? AND status = 'PACKAGING')", e.scopeId, e.scopeId);
        if (r && !expireDead(get(r.id))) noteGoverningPlan(get(r.id));
      }
    } catch { /* a listener never breaks the publisher; the tick re-checks */ }
  }
  /**
   * Review R6: the phase plan of a PREPARING / PACKAGING preparation that can never resume — its window passed while it was paused or
   * waiting for the owner (Pauză, Stop All, a restart, a revocation) — would strand it. The preparation becomes EXPIRED with the reason
   * (a continuation card then resumes it from the ledger), and the dead plan is closed. Nothing else is written; no event when nothing changed.
   */
  function expireDead(p) {
    const planId = p?.status === "PREPARING" ? p.planId : p?.status === "PACKAGING" ? p.phaseBPlanId : null;
    if (!planId) return false;
    const plan = opsPlans.view(planId);
    if (!plan || !["PAUSED", "NEEDS_OWNER"].includes(plan.status) || !plan.expiresAt || new Date(plan.expiresAt) > clock()) return false;
    const phase = p.status === "PREPARING" ? "pregătirii ofertei" : "ciornei și dosarului";
    if (!setStatus(p.id, "EXPIRED", `Fereastra planului ${phase} a trecut cât era oprit (${plan.status === "PAUSED" ? "pauză" : "aștepta decizia ta"}): nu se mai poate relua; o continuare (un card nou) o reia de unde a rămas`,
      { from: [p.status] })) return false;
    try { opsPlans.cancel(planId, { reason: "Fereastra planului a trecut; pregătirea continuă doar printr-un card nou", actor: "hub" }); } catch { /* the plan is already closed */ }
    return true;
  }
  /**
   * Review R23 (a truthful reason): while the phase plan of a PREPARING / PACKAGING preparation is paused or waits for the owner (a Pauză,
   * a Stop All, a Hub restart, a revocation — the operation plans' own rules), the preparation says so, and how it resumes; when the plan
   * runs again, it says that. Only the reason text changes (the status stays; no event: nothing about the preparation itself changed).
   */
  function noteGoverningPlan(p) {
    const planId = p?.status === "PREPARING" ? p.planId : p?.status === "PACKAGING" ? p.phaseBPlanId : null;
    const plan = planId ? opsPlans.view(planId) : null;
    if (!plan) return false;
    const phase = p.status === "PREPARING" ? "pregătirii ofertei" : "ciornei și dosarului";
    let reason = null;
    if (["PAUSED", "NEEDS_OWNER"].includes(plan.status)) {
      let held = false;
      try { held = Boolean(stopScope().heldByStop({ kind: "ops", id: planId })?.held); } catch { held = true; }
      reason = `Planul ${phase} e oprit (${clip(plan.statusReason, 160)}): îl reiei cu „Continuă”${held ? " după ce redeschizi poarta (cardul „Redeschide poarta”)" : ""}, până la ${plan.expiresAt}; după aceea, o continuare (un card nou)`;
    } else if (plan.status === "RUNNING" && /^Planul .+ e oprit \(/.test(p.statusReason)) reason = p.status === "PREPARING" ? "Planul confirmat rulează (fără model; nimic nu pleacă din calculator)" : "Ciorna și dosarul se fac din planul confirmat (nimic nu pleacă din calculator)";
    if (!reason || reason === p.statusReason) return false;
    return db.prepare("UPDATE sales_preparations SET status_reason = ?, updated_at = ? WHERE id = ? AND status = ? AND version = ?").run(clip(reason), now(), p.id, p.status, p.version).changes === 1;
  }
  let ownStopScope = null;
  const stopScope = () => (ownStopScope ||= createStopScope({ db, settings }));
  /** Housekeeping (scheduler): expiry of a waiting preparation, an approval whose event was missed, an activation a restart cut, a dead phase plan. */
  async function tick() {
    if (closing) return { checked: 0 };
    const rows = db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER' OR (status = 'PACKAGING' AND phase_b_plan_id IS NULL)").all();
    for (const r of rows) { if (closing) break; await activate(r.id); }
    const running = db.prepare("SELECT id FROM sales_preparations WHERE status = 'PREPARING' OR (status = 'PACKAGING' AND phase_b_plan_id IS NOT NULL)").all();
    for (const r of running) { if (closing) break; expireDead(get(r.id)); }
    return { checked: rows.length + running.length };
  }
  let detach = null;
  function boot() {
    closing = false;
    if (!detach && bus.subscribe) detach = bus.subscribe((e) => setTimeout(() => onEvent(e), 0));
    // A restart may have cut an activation or missed an approval: the same checks, after the boot (silent when nothing changes).
    setTimeout(() => { tick().catch(() => {}); }, 0);
  }
  function close() { closing = true; if (detach) detach(); detach = null; }
  /** Tests and the e2e: waits for an activation in flight and for the phase-B plan it started. */
  async function idle(id) {
    await activations.get(id);
    const p = get(id);
    if (p?.phaseBPlanId) await opsPlans.idle(p.phaseBPlanId);
    await activations.get(id);
    return get(id);
  }

  return { get, need, view, list: ({ status = null } = {}) => db.prepare(`SELECT * FROM sales_preparations ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 100`).all(...(status ? [status] : [])).map(view),
    ofPlan: (planId) => view(db.prepare("SELECT * FROM sales_preparations WHERE root_plan_id = ? OR plan_id = ? OR phase_b_plan_id = ?").get(planId, planId, planId)),
    createPlanned, enterPlan, enterPreparing, bound, toWaiting, setStatus, rootOf, awaitedCurrent, approvedExactly, stoppedSince, activate, verifyParent, cancel, continueCard,
    dossierInputs, dossierTarget, dossierKeyParams, reserveDossier, recordDossierFiles, completeDossier, previousDossier, dossier: dossierOf, dossierCurrent, forOpportunity, markDossierStale,
    onInvalidated, onEvent, tick, boot, close, idle,
    // M12 review fixes (parts 2–3): who may be continued (R18), the Stop All rearm hold (C2), the expiry of a dead phase plan (R6).
    isContinuable, stopHold, expireDead };
}

/** Exported for the dossier step: a folder name never reaches outside its exports root (also after links). */
export function realInside(root, target) {
  const norm = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
  let real;
  try { real = fs.realpathSync.native(target); } catch { return false; }
  const base = norm(fs.realpathSync.native(root));
  const t = norm(real);
  return t === base || t.startsWith(`${base}${path.sep}`);
}
