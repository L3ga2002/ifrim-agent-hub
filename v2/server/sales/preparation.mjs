import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { PLAN_LIMITS } from "../ops/plans.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";
import { dossierFolderNames, DOSSIER_LABELS } from "./dossier.mjs";

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
  PREPARING: ["WAITING_OWNER", "STALE", "FAILED", "CANCELLED"],
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

  /** The only writer of a preparation's status (an event when it changes; extra columns may be set with it). */
  function setStatus(id, to, reason = "", { from = null, extra = {} } = {}) {
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
        bus.append({ type: "sales.preparation.status", scopeType: "sales", scopeId: id, source: "sales", payload: { preparationId: id, from: p.status, to, reason: clip(reason, 200), opportunityId: p.opportunityId } });
      }
      return n === 1;
    });
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
    const rootCredential = p.consent?.rootCredential || opsPlans.view(p.rootPlanId)?.consent?.credential || "";
    if (!rootCredential || rootCredential !== plan.consent?.credential) throw notBound("Continuarea a fost confirmată cu altă cheie decât planul inițial; cere pregătirea din nou.");
    return p;
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
  /** A Stop All (or a stop-class suspension of the gate) since `iso`: nothing continues by itself after it. */
  function stoppedSince(iso) {
    if (!iso) return true;
    if (db.prepare("SELECT 1 FROM events WHERE type = 'system.stop_all' AND created_at > ? LIMIT 1").get(String(iso))) return true;
    const g = settings.get("executionGate") || {};
    return g.status !== "open" && ["stop_all", "security"].includes(classifySuspension(g).cls) && String(g.changedAt || "") > String(iso);
  }

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
    const fail = (to, reason) => { setStatus(id, to, reason, { from: ["PACKAGING"] }); return { activated: false, reason, status: to }; };
    if (!consent.planId || !consent.sessionId || !consent.confirmedAt) return fail("FAILED", "Pregătirea nu are confirmarea planului");
    if (p.activateBy && new Date(p.activateBy) < clock()) return fail("EXPIRED", "Fereastra planului confirmat a trecut; o continuare cere o confirmare nouă");
    const plan = opsPlans.view(consent.planId);
    if (!plan || plan.kind !== PREPARE_KIND || plan.hash !== consent.planHash || plan.status !== "DONE") return fail("FAILED", "Planul confirmat nu mai e cel terminat");
    if (stoppedSince(consent.confirmedAt)) return fail("STOPPED", "„Oprește tot” a venit după confirmare; ciorna și dosarul nu pornesc singure");
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
          if (stoppedSince(consent.confirmedAt)) throw new HubError("policy", "„Oprește tot” a venit după confirmare", { code: "STOPPED" });
          const n = db.prepare("UPDATE sales_preparations SET phase_b_plan_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PACKAGING' AND phase_b_plan_id IS NULL").run(planId, now(), id).changes;
          if (n !== 1) throw new HubError("conflict", "Pregătirea s-a schimbat în timpul pornirii", { code: "SALES_PREPARATION_STATE" });
        } });
      return { activated: true, planId: derived.id };
    } catch (error) {
      if (closing) return { activated: false, reason: "Hub-ul se oprește" };
      const code = error?.code || "";
      const to = ["SESSION_CLOSED", "STOPPED"].includes(code) ? "STOPPED" : code === "PLAN_DERIVED_CHANGED" ? "STALE" : code === "PLAN_DERIVED_EXPIRED" ? "EXPIRED" : "FAILED";
      return fail(to, `Ciorna și dosarul nu au pornit: ${clip(error?.message, 200)}`);
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
    const plan = await opsPlans.propose({ kind: PREPARE_KIND, title: `Continuă pregătirea ofertei (sintetic): ${clip(p.brief?.fields?.clientType?.value || "cerere de ofertă", 80)}`,
      steps: prepareSteps({ preparationId: p.id, briefSha: p.briefSha, continues: { rootPlanId: p.rootPlanId, rootPlanHash: p.rootPlanHash } }), limits: phaseALimits(), actor, via });
    return { plan, preparation: p, decisionsLeft: SALES_DECISIONS_LEFT, never: SALES_NEVER };
  }

  // ---------------------------------------------------------------- dossiers (rows; the files are written by the plan step)
  const dossierView = (r) => r && ({ id: r.id, preparationId: r.preparation_id, opportunityId: r.opportunity_id, orgId: r.org_id || null, proposalId: r.proposal_id, proposalSha: r.proposal_sha,
    draftId: r.draft_id || null, draftSha: r.draft_sha || null, revision: r.revision, folder: r.folder, folderName: path.basename(r.folder), files: parse(r.files_json, []), manifestSha256: r.manifest_sha256 || null,
    verification: parse(r.verification_json, {}), status: r.status, statusReason: r.status_reason || "", opKey: r.op_key, inputsSha: r.inputs_sha, planId: r.ops_plan_id || null,
    labels: DOSSIER_LABELS, sent: false, synthetic: true, createdAt: r.created_at, updatedAt: r.updated_at });
  const dossierOf = (id) => dossierView(db.prepare("SELECT * FROM sales_dossiers WHERE id = ?").get(String(id || "")));
  /** What a dossier is evidence of, recomputed from the database: the offer, its draft and the offer's inputs (no time inside). */
  function dossierInputs(oppId) {
    const p = sales.latestProposal(oppId);
    const d = sales.latestDraft(oppId);
    const basis = p && sales.isPreparationBound(p.content) ? sales.preparationBasis(oppId, { briefSha: p.content.basis.briefSha || null }) : null;
    return { proposal: p ? { id: p.id, status: p.status, contentSha: p.contentSha, approvedSha: p.approvedSha } : null,
      draft: d ? { id: d.id, contentSha: d.contentSha, proposalSha: d.meta?.proposalSha || null } : null, basis: basis ? hashCanonical(basis) : null };
  }
  const dossierKeyParams = (p, facts) => ({ preparationId: p.id, proposalId: facts.proposal.id, proposalSha: facts.proposal.contentSha, draftId: facts.draft.id, draftSha: facts.draft.contentSha });
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
      .map(({ brief, consent, ...rest }) => ({ ...rest, request: brief?.request || "", authority: consent?.authority || null, confirmedAt: consent?.confirmedAt || null, decisionsLeft: SALES_DECISIONS_LEFT }));
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
        for (const r of db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER'").all()) {
          setStatus(r.id, "STOPPED", "„Oprește tot” a venit după confirmare: ciorna și dosarul nu pornesc singure; o continuare cere o confirmare nouă", { from: ["WAITING_OWNER"] });
        }
      }
    } catch { /* a listener never breaks the publisher; the tick re-checks */ }
  }
  /** Housekeeping (scheduler): expiry of a waiting preparation, an approval whose event was missed, an activation a restart cut. */
  async function tick() {
    if (closing) return { checked: 0 };
    const rows = db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER' OR (status = 'PACKAGING' AND phase_b_plan_id IS NULL)").all();
    for (const r of rows) { if (closing) break; await activate(r.id); }
    return { checked: rows.length };
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
    onInvalidated, onEvent, tick, boot, close, idle };
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
