import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { PLAN_LIMITS } from "../ops/plans.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";
import { STOP_HOLD_CLASSES } from "../owner/stop-scope.mjs";
import { DESK_NEVER, DESK_LABELS, deskFolderNames, offerFacts, opsProgress, supportSources, UNKNOWN_TEXT } from "./builders.mjs";

/**
 * M13 „Birou intern”: three internal flows of the company over the operation plans (ops/plans.mjs), on the M12 Sales precedent
 * (sales/preparation.mjs) — one card the owner confirms once, steps that act only for the record bound to their plan, a C-01 ledger
 * (desk_plan_ops) so a resume or a continuation never repeats an effect, and the owner's reserved decision on the exact text.
 *
 *   Operations      `desk.ops.prepare`      the internal start dossier of a project from an internally approved offer (one decision:
 *                                            the card). The record keeps the checklist, what is received / missing, questions, risks,
 *                                            owner, next action, deadlines (unknown ones marked); a received material makes the export
 *                                            STALE and one continuation card exports the next revision.
 *   Customer Support `desk.support.prepare`  a synthetic request → a case: classification, read-only sources (the accepted package of the
 *                                            project), a reply DRAFT_ONLY; the owner approves the exact reply (id + version + sha) and the
 *                                            export follows DERIVED from the card (`desk.support.export`), without another card.
 *   Finance-Admin   `desk.finance.prepare`   the deviz in draft from the approved offer (unknowns „De stabilit”, no total), registered
 *                                            internally; the owner approves the exact document (id + sha); Word + PDF follow derived.
 *
 * Nothing here sends, publishes, contacts, marks CONTACTED / WON, hands off to Engineering, starts the Factory or a model, issues a
 * fiscal document or deletes. A record pins its inputs (the offer id + sha, the accepted package): a change makes it STALE (history kept).
 */
export const DESK_FLOWS = Object.freeze({
  ops_start: Object.freeze({ department: "operations", prefix: "OPS", kind: "desk.ops.prepare", root: "operatiuni", folderPrefix: "pornire", title: "Dosarul de pornire a proiectului", artifact: null, decision: null, exportKind: null }),
  support_case: Object.freeze({ department: "customer-success", prefix: "SUP", kind: "desk.support.prepare", root: "suport", folderPrefix: "caz", title: "Cazul de suport", artifact: "support_reply",
    decision: "desk.support_reply_approve", exportKind: "desk.support.export" }),
  finance_doc: Object.freeze({ department: "finance-admin", prefix: "DVZ", kind: "desk.finance.prepare", root: "financiar", folderPrefix: "deviz", title: "Devizul", artifact: "deviz",
    decision: "desk.finance_doc_approve", exportKind: "desk.finance.export" }),
});
export const DESK_PLAN_KINDS = Object.freeze(Object.values(DESK_FLOWS).map((f) => f.kind));
export const DESK_EXPORT_KINDS = Object.freeze(Object.values(DESK_FLOWS).map((f) => f.exportKind).filter(Boolean));
export const DESK_DECISIONS = Object.freeze(Object.fromEntries(Object.values(DESK_FLOWS).filter((f) => f.decision).map((f) => [f.decision, f])));
export const flowOfKind = (planKind) => Object.entries(DESK_FLOWS).find(([, f]) => f.kind === planKind || f.exportKind === planKind)?.[0] || null;
export const DESK_LIMITS = Object.freeze({ phaseAMinutes: 60, phaseAActions: 200, phaseBMinutes: 60, phaseBActions: 200 });
/** The automatic continuation window of the derived export: from the confirmation, the phase-A limit plus the slack (as in M12). */
export const DESK_ACTIVATE_WITHIN_MIN = PLAN_LIMITS.maxDurationMin + PLAN_LIMITS.slackMin;
export const deskPhaseALimits = () => ({ maxDurationMin: PLAN_LIMITS.maxDurationMin, maxActions: DESK_LIMITS.phaseAActions });
export const deskPhaseBLimits = () => ({ maxDurationMin: DESK_LIMITS.phaseBMinutes, maxActions: DESK_LIMITS.phaseBActions });
export const DESK_PHASE_B_OPS = Object.freeze({ "desk.support.export": ["desk.support.export", "export.local"], "desk.finance.export": ["desk.finance.export", "export.local", "office.verify"] });
export const RECORD_STATUSES = Object.freeze(["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "READY", "STALE", "STOPPED", "EXPIRED", "FAILED", "CANCELLED"]);
export const RECORD_TRANSITIONS = Object.freeze({
  PLANNED: ["PREPARING", "EXPIRED", "CANCELLED"],
  PREPARING: ["WAITING_OWNER", "READY", "STALE", "STOPPED", "EXPIRED", "FAILED", "CANCELLED"],
  WAITING_OWNER: ["PACKAGING", "STALE", "STOPPED", "EXPIRED", "CANCELLED"],
  PACKAGING: ["READY", "STALE", "STOPPED", "EXPIRED", "FAILED", "CANCELLED"],
  READY: ["STALE"],
  STALE: ["PREPARING", "CANCELLED"],
  STOPPED: ["PREPARING", "CANCELLED"],
  EXPIRED: ["PREPARING", "CANCELLED"],
  FAILED: ["PREPARING", "CANCELLED"],
  CANCELLED: [],
});
export const DESK_CONTINUABLE = Object.freeze(["STALE", "STOPPED", "EXPIRED", "FAILED"]);
const OPEN = ["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "STALE", "STOPPED", "EXPIRED", "FAILED"];
export const DESK_STATUS_RO = Object.freeze({ PLANNED: "propusă (aștept confirmarea cardului)", PREPARING: "în pregătire", WAITING_OWNER: "așteaptă decizia ta", PACKAGING: "se exportă",
  READY: "pregătită", STALE: "depășită (intrările s-au schimbat)", STOPPED: "oprită", EXPIRED: "expirată", FAILED: "eșuată", CANCELLED: "anulată" });
/** Step error codes that mean „the inputs changed” (→ STALE) rather than a failure. */
const STALE_CODES = new Set(["DESK_STALE", "DESK_INPUTS_CHANGED", "IDEMPOTENCY_CONFLICT"]);
const PATCHABLE = new Set(["plan_id", "phase_b_plan_id", "consent_json", "activate_by", "awaited_artifact_id", "awaited_sha", "next_action", "proposal_id", "proposal_sha", "inputs_sha", "source_json"]);
const clip = (v, n = 500) => String(v ?? "").slice(0, n);
const authorityOfCredential = (credential) => (String(credential || "").startsWith("devprofile") ? "local_dev_profile" : "webauthn");
const STOP_REASON = { stop_all: "„Oprește tot” a venit după confirmare", security: "o oprire de securitate a venit după confirmare" };
const REARM_WHERE = "pe cardul „Redeschide poarta”, cu Windows Hello";

export function createDesk({ db, bus, clock, settings, sales, deliveries = null, factory = null, projects = null, opsPlans, trust, ledger, media, anchors, config = {} }) {
  const now = () => clock().toISOString();
  let closing = false;
  const flowOf = (kind) => { const f = DESK_FLOWS[kind]; if (!f) throw new HubError("validation", `Tip de înregistrare necunoscut: ${kind}`); return f; };
  const rowOf = (id) => db.prepare("SELECT * FROM desk_records WHERE id = ?").get(String(id || ""));
  const view = (r) => r && ({ id: r.id, kind: r.kind, department: r.department, internalNo: r.internal_no, title: r.title, projectId: r.project_id || null, opportunityId: r.opportunity_id || null,
    proposalId: r.proposal_id || null, proposalSha: r.proposal_sha || null, deliveryId: r.delivery_id || null, request: r.request_text || "", source: parse(r.source_json, {}), inputsSha: r.inputs_sha || "",
    state: parse(r.state_json, {}), status: r.status, statusReason: r.status_reason || "", staleReason: r.stale_reason || "", owner: r.owner, nextAction: r.next_action || "", nextActionAt: r.next_action_at || null,
    rootPlanId: r.root_plan_id, rootPlanHash: r.root_plan_hash, planId: r.plan_id || r.root_plan_id, phaseBPlanId: r.phase_b_plan_id || null, consent: parse(r.consent_json, null), activateBy: r.activate_by || null,
    awaited: r.awaited_artifact_id ? { artifactId: r.awaited_artifact_id, sha: r.awaited_sha } : null, synthetic: true, version: r.version, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const get = (id) => view(rowOf(id));
  const need = (id) => { const r = get(id); if (!r) throw new HubError("not_found", "Înregistrarea nu există.", { code: "DESK_RECORD_MISSING" }); return r; };
  const notBound = (why = "Pasul nu aparține planului acestei înregistrări.") => new HubError("policy", why, { code: "DESK_NOT_BOUND" });
  const rootOf = (r) => ({ planId: r.rootPlanId, planHash: r.rootPlanHash });
  const emit = (type, scopeId, payload, source = "desk") => bus.append({ type, scopeType: "desk", scopeId, source, payload });

  // ---------------------------------------------------------------- status (the only writer)
  function setStatus(id, to, reason = "", { from = null, extra = {}, meta = null } = {}) {
    return bus.transaction(() => {
      const r = need(id);
      if (from && !from.includes(r.status)) return false;
      const entries = Object.entries(extra).filter(([k]) => PATCHABLE.has(k));
      if (r.status === to && !entries.length) return false;
      if (r.status !== to && !(RECORD_TRANSITIONS[r.status] || []).includes(to)) throw new HubError("conflict", `Înregistrarea nu poate trece din ${r.status} în ${to}.`, { code: "DESK_TRANSITION" });
      const sets = ["status = ?", "status_reason = ?", "updated_at = ?", "version = version + 1", ...entries.map(([k]) => `${k} = ?`), ...(to === "STALE" ? ["stale_reason = ?"] : [])];
      const n = db.prepare(`UPDATE desk_records SET ${sets.join(", ")} WHERE id = ? AND status = ? AND version = ?`)
        .run(to, clip(reason), now(), ...entries.map(([, v]) => v), ...(to === "STALE" ? [clip(reason)] : []), id, r.status, r.version).changes;
      if (n === 1 && r.status !== to) {
        emit("desk.record.status", id, { recordId: id, kind: r.kind, from: r.status, to, reason: clip(reason, 200), ...(meta && typeof meta === "object" ? meta : {}) });
        if (!["READY", "PACKAGING", "PREPARING"].includes(to)) declarePartial(r, `${to}: ${clip(reason, 200)}`);
        if (to === "STALE") staleDependents(r, reason);
        if (to === "CANCELLED") db.prepare("UPDATE desk_plan_ops SET status = 'FAILED', claim_token = NULL, result_json = ?, updated_at = ? WHERE root_plan_id = ? AND status = 'IN_PROGRESS'").run(json({ error: clip(reason, 300) }), now(), r.rootPlanId);
      }
      return n === 1;
    });
  }
  /** An export still WRITING when its record leaves the writing phase can never finish under that plan: INCOMPLETE, files kept and listed. */
  function declarePartial(r, reason) {
    for (const x of db.prepare("SELECT id, revision, files_json, op_key FROM desk_exports WHERE record_id = ? AND status = 'WRITING'").all(r.id)) {
      const why = `Parțial (nu se mai poate încheia sub acest plan): ${clip(reason, 260)}`;
      if (db.prepare("UPDATE desk_exports SET status = 'INCOMPLETE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'").run(why, now(), x.id).changes !== 1) continue;
      emit("desk.export.incomplete", x.id, { exportId: x.id, recordId: r.id, revision: x.revision, files: parse(x.files_json, []).length, partial: true, reason: clip(why, 200) });
      db.prepare("UPDATE desk_plan_ops SET status = 'FAILED', claim_token = NULL, result_json = ?, updated_at = ? WHERE op_key = ? AND status = 'IN_PROGRESS'").run(json({ error: clip(why, 300) }), now(), x.op_key);
    }
  }
  /** A STALE record: its open artifact (draft or approved) and its READY exports are STALE too (history and files kept). */
  function staleDependents(r, reason) {
    for (const a of db.prepare("SELECT id FROM desk_artifacts WHERE record_id = ? AND status IN ('DRAFT','APPROVED_INTERNAL')").all(r.id)) {
      if (db.prepare("UPDATE desk_artifacts SET status = 'STALE', status_reason = ?, updated_at = ? WHERE id = ? AND status IN ('DRAFT','APPROVED_INTERNAL')").run(clip(reason, 300), now(), a.id).changes) {
        emit("desk.artifact.stale", a.id, { artifactId: a.id, recordId: r.id, reason: clip(reason, 200) });
      }
    }
    for (const x of db.prepare("SELECT id, revision FROM desk_exports WHERE record_id = ? AND status = 'READY'").all(r.id)) {
      if (db.prepare("UPDATE desk_exports SET status = 'STALE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'READY'").run(clip(reason, 300), now(), x.id).changes) {
        emit("desk.export.stale", x.id, { exportId: x.id, recordId: r.id, revision: x.revision, reason: clip(reason, 200) });
      }
    }
  }

  // ---------------------------------------------------------------- PLANNED (the planner; no domain effect)
  function nextInternalNo(prefix) {
    const n = Number(db.prepare("SELECT COUNT(*) AS n FROM desk_records WHERE internal_no LIKE ?").get(`${prefix}-%`).n) + 1;
    return `${prefix}-${String(n).padStart(4, "0")}`;
  }
  function createPlanned({ id = newId("dsk"), kind, plan, title, pinned = {}, request = "", source = {}, inputsSha = "", nextAction = "", actor = "intake" }) {
    const flow = flowOf(kind);
    if (!plan?.id || plan.kind !== flow.kind || plan.status !== "PROPOSED") throw new HubError("conflict", "Înregistrarea se leagă doar de planul ei propus.", { code: "DESK_NOT_BOUND" });
    bus.transaction(() => {
      db.prepare(`INSERT INTO desk_records (id, kind, department, internal_no, title, project_id, opportunity_id, proposal_id, proposal_sha, delivery_id, request_text, source_json, inputs_sha, state_json,
        status, status_reason, owner, next_action, root_plan_id, root_plan_hash, plan_id, synthetic, version, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'PLANNED', ?, 'proprietar', ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
        .run(id, kind, flow.department, nextInternalNo(flow.prefix), clip(title, 200), pinned.projectId || null, pinned.opportunityId || null, pinned.proposalId || null, pinned.proposalSha || null,
          pinned.deliveryId || null, clip(request, 4000), json(source), inputsSha, "Propusă; aștept confirmarea cardului (nimic nu a pornit)", clip(nextAction || "Confirmi cardul (o dată); nimic nu pornește înainte.", 400),
          plan.id, plan.hash, plan.id, clip(actor, 80), now(), now());
      emit("desk.record.planned", id, { recordId: id, kind, planId: plan.id }, clip(actor, 80));
    });
    return get(id);
  }

  // ---------------------------------------------------------------- binding (the steps)
  const rootConfirmed = (r) => Boolean(r.consent?.rootCredential || opsPlans.view(r.rootPlanId)?.consent?.credential);
  const isContinuable = (r) => Boolean(r) && DESK_CONTINUABLE.includes(r.status) && rootConfirmed(r);
  /** The gate is still held by the Stop All recorded on the record's last status event (same chain, no rearm since). Read only. */
  function stopHold(r) {
    if (!DESK_CONTINUABLE.includes(r?.status)) return null;
    const last = parse(db.prepare("SELECT payload_json FROM events WHERE scope_type = 'desk' AND scope_id = ? AND type = 'desk.record.status' ORDER BY seq DESC LIMIT 1").get(r.id)?.payload_json, {});
    if (last.to !== r.status || !last.stop) return null;
    const c = classifySuspension(settings.get("executionGate") || {});
    if (!STOP_HOLD_CLASSES.has(c.cls)) return null;
    const same = (last.stop.suspensionId && c.id && last.stop.suspensionId === c.id) || (last.stop.at && c.since && String(last.stop.at) >= String(c.since));
    return same ? { cls: c.cls, reason: `„Oprește tot” a oprit această înregistrare și poarta e încă oprită: o continuare se poate cere după ce redeschizi poarta ${REARM_WHERE}.` } : null;
  }
  /** Step 1 of a phase-A plan: the record bound to it (root or resume), or a continuation card of THIS record with the same credential. */
  function enterPlan(recordId, plan) {
    const r = need(recordId);
    const flow = flowOf(r.kind);
    if (!plan || plan.kind !== flow.kind) throw notBound();
    if (r.planId === plan.id) {
      if (!["PLANNED", "PREPARING"].includes(r.status)) throw new HubError("conflict", `Înregistrarea e ${r.status}; pașii ei nu mai rulează.`, { code: "DESK_RECORD_STATE" });
      return r;
    }
    const cont = plan.steps?.[0]?.params?.continues;
    if (!cont || cont.rootPlanId !== r.rootPlanId || cont.rootPlanHash !== r.rootPlanHash) throw notBound();
    if (!DESK_CONTINUABLE.includes(r.status)) throw new HubError("conflict", `Înregistrarea e ${r.status}; o continuare nu se aplică.`, { code: "DESK_RECORD_STATE" });
    if (!rootConfirmed(r)) throw new HubError("conflict", "Cardul inițial nu a fost confirmat niciodată: cere din nou, cu o cerere nouă.", { code: "DESK_RECORD_STATE" });
    const hold = stopHold(r);
    if (hold) throw new HubError("policy", hold.reason, { code: "STOPPED", data: { rearm: true, cls: hold.cls } });
    const rootCredential = r.consent?.rootCredential || opsPlans.view(r.rootPlanId)?.consent?.credential || "";
    if (!rootCredential || rootCredential !== plan.consent?.credential) throw notBound("Continuarea a fost confirmată cu altă cheie decât planul inițial; cere din nou.");
    return r;
  }
  /** After step 1 (in its transaction): the record runs under THIS plan's consent. */
  function enterPreparing(r, plan) {
    const c = plan.consent || {};
    const consent = { planId: plan.id, planHash: plan.hash, sessionId: c.sessionId || null, credential: c.credential || "", confirmedAt: c.confirmedAt || null, modality: c.modality || null,
      authority: authorityOfCredential(c.credential), rootCredential: r.consent?.rootCredential || c.credential || "", activateBy: plan.expiresAt || null };
    const continuing = r.planId !== plan.id;
    return setStatus(r.id, "PREPARING", continuing ? `Continuarea confirmată de tine rulează (planul ${plan.id})` : "Planul confirmat rulează (fără model; nimic nu pleacă din calculator)", {
      from: ["PLANNED", "PREPARING", ...DESK_CONTINUABLE], extra: { plan_id: plan.id, consent_json: json(consent), activate_by: plan.expiresAt || null, ...(continuing ? { phase_b_plan_id: null } : {}) } });
  }
  function bound(recordId, planId, { phase = "A", statuses = null } = {}) {
    const r = need(recordId);
    if ((phase === "A" ? r.planId : r.phaseBPlanId) !== planId) throw notBound();
    const ok = statuses || (phase === "A" ? ["PREPARING"] : ["PACKAGING"]);
    if (!ok.includes(r.status)) throw new HubError("conflict", `Înregistrarea e ${r.status}; pasul nu mai rulează.`, { code: "DESK_RECORD_STATE" });
    return r;
  }
  /** The record's state written by a step or an owner's update (a new record version; one event). */
  function saveState(id, state, { nextAction = null, source = null, inputsSha = null, proposalId = null, proposalSha = null, actor = "desk", event = "desk.record.state", meta = {} } = {}) {
    return bus.transaction(() => {
      const r = need(id);
      const sets = ["state_json = ?", "updated_at = ?", "version = version + 1"], args = [json(state), now()];
      if (nextAction !== null) { sets.push("next_action = ?"); args.push(clip(nextAction, 400)); }
      if (source !== null) { sets.push("source_json = ?"); args.push(json(source)); }
      if (inputsSha !== null) { sets.push("inputs_sha = ?"); args.push(inputsSha); }
      if (proposalId !== null) { sets.push("proposal_id = ?", "proposal_sha = ?"); args.push(proposalId, proposalSha); }
      const n = db.prepare(`UPDATE desk_records SET ${sets.join(", ")} WHERE id = ? AND version = ?`).run(...args, id, r.version).changes;
      if (n !== 1) throw new HubError("conflict", "Înregistrarea s-a schimbat între timp.", { code: "DESK_RECORD_STATE" });
      emit(event, id, { recordId: id, kind: r.kind, version: r.version + 1, ...meta }, actor);
      return get(id);
    });
  }

  // ---------------------------------------------------------------- the pinned inputs
  /** The internally approved offer an Operations / Finance record starts from: the latest version of the opportunity, current, exact. */
  function approvedOffer(opportunityId) {
    const view = sales.getOpportunity(opportunityId);
    const p = sales.latestProposal(opportunityId);
    if (!view?.org?.synthetic || !view?.opportunity?.synthetic) return { ok: false, reason: "În M13 pregătirea internă se face doar pentru o ofertă sintetică." };
    if (!p || p.status !== "APPROVED_INTERNAL" || p.approvedSha !== p.contentSha || hashCanonical(p.content) !== p.contentSha) return { ok: false, reason: "Oferta nu e aprobată intern (ultima versiune, exact)." };
    if (!sales.isPreparationBound(p.content) || !Array.isArray(p.content?.pricing)) return { ok: false, reason: "Oferta nu e pregătită prin planul M12 (fără prețuri și termene explicite); pregătește-o întâi în L3ga." };
    if (sales.isPreparationBound(p.content) && sales.boundStale(p)) return { ok: false, reason: "Oferta aprobată nu mai corespunde intrărilor ei (STALE)." };
    // The approved offer stays the source through the M04 progression after it (a recorded contact, a discussion, the client's yes —
    // written only by their own Sales writers); an opportunity sent back to a draft, put on hold or lost is not.
    if (["IDENTIFIED", "PROPOSAL_DRAFT", "READY_FOR_OWNER_REVIEW", "ON_HOLD", "LOST"].includes(view.opportunity.status)) return { ok: false, reason: `Oportunitatea e ${view.opportunity.status}.` };
    if (view.org.mergedInto || view.org.archivedAt || view.org.status === "DO_NOT_CONTACT" || view.suppression) return { ok: false, reason: "Firma nu mai poate fi lucrată (unită, arhivată sau DO_NOT_CONTACT)." };
    return { ok: true, proposal: p, opportunity: view.opportunity, org: view.org, facts: offerFacts({ proposal: p, opportunity: view.opportunity, org: view.org }) };
  }
  /** The accepted package of a project's delivery a support case reads (read only): the delivery READY, its package OWNER_ACCEPTED. */
  function acceptedSources(projectId, deliveryId) {
    const project = projects?.get?.(projectId) || null;
    const d = deliveries?.get?.(deliveryId) || null;
    if (!project || !d || d.projectId !== project.id) return { ok: false, reason: "Livrarea proiectului nu există." };
    const binding = factory?.deliveryBinding?.(d.missionId, { bundleId: d.bundleId }) || null;
    if (d.status !== "READY" || !binding || binding.bundleStatus !== "OWNER_ACCEPTED" || binding.bundleId !== d.bundleId || binding.bundleSha !== d.bundleSha) {
      return { ok: false, reason: "Livrarea proiectului nu are pachetul acceptat de tine (OWNER_ACCEPTED, același SHA)." };
    }
    return { ok: true, project, delivery: d, sources: supportSources({ project, delivery: d, binding }) };
  }
  /** The inputs of a record recomputed now (no time inside): a difference from the pinned sha makes the record STALE. */
  function inputsOf(r) {
    if (r.kind === "support_case") {
      const s = acceptedSources(r.projectId, r.deliveryId);
      return { kind: r.kind, ok: s.ok, sources: s.ok ? s.sources.sha : null };
    }
    const o = r.opportunityId ? approvedOffer(r.opportunityId) : { ok: false };
    return { kind: r.kind, ok: o.ok, offer: o.ok ? { id: o.proposal.id, contentSha: o.proposal.contentSha, serviceIds: o.facts.serviceIds } : null };
  }
  const inputsShaOf = (r) => hashCanonical(inputsOf(r));
  const inputsCurrent = (r) => Boolean(r?.inputsSha) && inputsOf(r).ok && inputsShaOf(r) === r.inputsSha;

  // ---------------------------------------------------------------- artifacts (the texts the owner approves)
  const artView = (a) => a && ({ id: a.id, recordId: a.record_id, kind: a.kind, version: a.version, content: parse(a.content_json, {}), contentSha: a.content_sha, inputsSha: a.inputs_sha, status: a.status,
    statusReason: a.status_reason || "", approvalId: a.approval_id || null, approvedSha: a.approved_sha || null, approvedAt: a.approved_at || null, approval: parse(a.approval_json, null), createdAt: a.created_at, updatedAt: a.updated_at });
  const artifact = (id) => artView(db.prepare("SELECT * FROM desk_artifacts WHERE id = ?").get(String(id || "")));
  const latestArtifact = (recordId) => artView(db.prepare("SELECT * FROM desk_artifacts WHERE record_id = ? ORDER BY version DESC LIMIT 1").get(String(recordId || "")));
  function createArtifact({ recordId, kind, content, inputsSha, actor }) {
    return bus.transaction(() => {
      const r = need(recordId);
      if (DESK_FLOWS[r.kind].artifact !== kind) throw new HubError("validation", "Tipul documentului nu e al acestei înregistrări.");
      const prev = latestArtifact(recordId);
      const version = (prev?.version || 0) + 1;
      db.prepare("UPDATE desk_artifacts SET status = 'SUPERSEDED', updated_at = ? WHERE record_id = ? AND status IN ('DRAFT','APPROVED_INTERNAL','STALE')").run(now(), recordId);
      const id = newId("dar");
      const sha = hashCanonical(content);
      db.prepare(`INSERT INTO desk_artifacts (id, record_id, kind, version, content_json, content_sha, inputs_sha, status, synthetic, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?, ?, ?)`).run(id, recordId, kind, version, json(content), sha, inputsSha || "", clip(actor, 80), now(), now());
      emit("desk.artifact.created", recordId, { artifactId: id, recordId, kind, version, contentSha: sha }, clip(actor, 80));
      return artifact(id);
    });
  }
  /** After the phase-A step that made the artifact: the record waits for the owner's approval of exactly it (or stops, with the reason). */
  function toWaiting(r, a) {
    const awaited = { awaited_artifact_id: a.id, awaited_sha: a.contentSha };
    const anchor = anchors?.anchorOf ? anchors.anchorOf(opsPlans.view(r.planId)) : null;
    const stopped = anchor && anchors?.stoppedSince ? anchors.stoppedSince(anchor.at, anchor.planId, { afterSeq: anchor.seq }) : null;
    if (stopped) return setStatus(r.id, "STOPPED", `Documentul v${a.version} e pregătit, dar ${STOP_REASON[stopped.kind] || STOP_REASON.stop_all}: exportul nu pornește singur; o continuare cere o confirmare nouă`, { from: ["PREPARING"], extra: awaited, meta: { stop: stopped } });
    const held = anchor && trust.confirmedAuthority ? trust.confirmedAuthority(anchor.sessionId) : { ok: true };
    if (!held.ok) return setStatus(r.id, "STOPPED", `Documentul v${a.version} e pregătit, dar autorizarea în care ai confirmat cardul a fost revocată (${held.reason}); o continuare cere o confirmare nouă`, { from: ["PREPARING"], extra: awaited });
    const what = r.kind === "support_case" ? "Răspunsul" : "Devizul";
    return setStatus(r.id, "WAITING_OWNER", `${what} v${a.version} e gata de revizuirea ta: îl aprobi tu, separat (id + SHA complet); apoi exportul se face fără altă întrebare`, {
      from: ["PREPARING"], extra: { ...awaited, next_action: `Inspectezi ${what.toLowerCase()} v${a.version} și îl aprobi intern pe ID-ul și SHA-ul afișate (sau nu).` } });
  }
  /** The owner's session (or the bounded test channel) of a reserved decision, re-read in its transaction. */
  function decisionSession(channel, sessionCheck, what) {
    const testing = channel === "test" && config.testMode;
    if ((!testing && channel !== "owner") || typeof sessionCheck !== "function") throw new HubError("authentication", `Pentru ${what} deschide sesiunea proprietarului`, { data: { needSession: true } });
    const session = sessionCheck();
    if (!testing && (!session?.id || !session.credentialId || !["webauthn", "local_dev_profile"].includes(session.authority))) throw new HubError("authentication", "Sesiune de proprietar invalidă");
    return session;
  }
  /**
   * The owner's internal approval of exactly the text shown (id + full sha): a reserved decision (approval.owner_decide in the owner
   * session, consumed by this command). One decision on repeats; a stale or superseded text, a changed input, another record state → refused.
   */
  function approveArtifact(artifactId, { displayedSha } = {}, actor, { channel, sessionCheck, approvalId } = {}) {
    if (!/^dar_[A-Za-z0-9_]+$/.test(String(artifactId || "")) || typeof displayedSha !== "string" || !/^[0-9a-f]{64}$/.test(displayedSha)) throw new HubError("validation", "Aprobarea cere ID-ul și SHA-ul complet al documentului afișat");
    return bus.transaction(() => {
      const a = artifact(artifactId);
      if (!a) throw new HubError("not_found", "Documentul nu există");
      const r = need(a.recordId);
      const flow = DESK_FLOWS[r.kind];
      const latest = latestArtifact(r.id);
      const session = decisionSession(channel, sessionCheck, `aprobarea internă a documentului ${r.internalNo}`);
      const result = (duplicate) => { const x = artifact(a.id); return { duplicate, approved: true, artifactId: x.id, recordId: r.id, kind: x.kind, version: x.version, contentSha: x.contentSha, status: x.status, approvedAt: x.approvedAt, approvalId: x.approvalId, record: { id: r.id, status: get(r.id).status } }; };
      if (a.status === "APPROVED_INTERNAL" && a.approvedSha === displayedSha) return result(true);
      if (latest?.id !== a.id || a.status !== "DRAFT") throw new HubError("conflict", `Documentul afișat nu mai e versiunea curentă (${a.status}); aprobarea nu se aplică`, { code: "DESK_STALE" });
      if (displayedSha !== a.contentSha || hashCanonical(a.content) !== a.contentSha) throw new HubError("conflict", "Conținutul s-a schimbat față de ce ai văzut");
      if (r.status !== "WAITING_OWNER" || r.awaited?.artifactId !== a.id || r.awaited?.sha !== a.contentSha) throw new HubError("conflict", `Înregistrarea e ${r.status}; documentul nu așteaptă aprobarea`, { code: "DESK_RECORD_STATE" });
      if (!inputsCurrent(r)) throw new HubError("conflict", "Intrările documentului s-au schimbat (STALE); o continuare îl pregătește din nou", { code: "DESK_STALE" });
      if (r.activateBy && new Date(r.activateBy) < clock()) throw new HubError("conflict", "Fereastra cardului confirmat a trecut; o continuare cere o confirmare nouă", { code: "DESK_EXPIRED" });
      const anchor = anchors?.anchorOf ? anchors.anchorOf(opsPlans.view(r.planId)) : null;
      if (anchor && anchors.stoppedSince(anchor.at, anchor.planId, { afterSeq: anchor.seq })) throw new HubError("conflict", "„Oprește tot” a venit după confirmarea cardului: aprobarea nu se mai aplică; o continuare cere o confirmare nouă", { code: "DESK_STOPPED" });
      if (anchor && trust.confirmedAuthority && !trust.confirmedAuthority(anchor.sessionId).ok) throw new HubError("conflict", "Autorizarea în care ai confirmat cardul a fost revocată; o continuare cere o confirmare nouă", { code: "DESK_STOPPED" });
      const ap = approvalId ? db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) : null;
      const payload = parse(ap?.payload_json, {});
      if (!ap || ap.action_kind !== flow.decision || ap.status !== "consumed" || payload.artifactId !== a.id || payload.displayedSha !== displayedSha
        || (channel === "owner" ? ap.decided_via !== "owner_session" : ap.decided_via !== "test")) throw new HubError("policy", "Lipsește aprobarea ta legată de acest document");
      const at = now();
      const authority = { authority: session?.authority || "test", sessionId: session?.id || null, credentialId: session?.credentialId || null, channel, decidedVia: ap.decided_via };
      if (db.prepare("UPDATE desk_artifacts SET status = 'APPROVED_INTERNAL', approved_sha = ?, approved_at = ?, approval_id = ?, approval_json = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT' AND content_sha = ?")
        .run(displayedSha, at, approvalId, json(authority), at, a.id, displayedSha).changes !== 1) throw new HubError("conflict", "Documentul s-a schimbat");
      emit("desk.artifact.approved", r.id, { artifactId: a.id, recordId: r.id, kind: a.kind, version: a.version, contentSha: displayedSha, approvalId, ...authority }, actor);
      return result(false);
    });
  }
  /** The awaited artifact approved by the owner in the owner session (exact id + sha), its inputs unchanged. */
  function approvedExactly(r) {
    if (!inputsCurrent(r)) return { ok: false, status: "STALE", reason: "Intrările s-au schimbat după pregătire (altă ofertă / alt pachet); o continuare pregătește din nou" };
    const a = r.awaited ? artifact(r.awaited.artifactId) : null;
    const latest = latestArtifact(r.id);
    if (!a || latest?.id !== a.id || a.contentSha !== r.awaited.sha) return { ok: false, status: "STALE", reason: "Documentul s-a schimbat după pregătire" };
    if (a.status === "DRAFT") return { ok: false, wait: true, reason: "aștept aprobarea ta" };
    if (a.status !== "APPROVED_INTERNAL" || a.approvedSha !== a.contentSha) return { ok: false, status: "STALE", reason: `Documentul e ${a.status}` };
    const ap = a.approvalId ? db.prepare("SELECT action_kind, decided_via, payload_json FROM approvals WHERE id = ?").get(a.approvalId) : null;
    const payload = parse(ap?.payload_json, {});
    if (!ap || ap.action_kind !== DESK_FLOWS[r.kind].decision || ap.decided_via !== "owner_session" || payload.artifactId !== a.id || payload.displayedSha !== a.contentSha) {
      return { ok: false, status: "STOPPED", reason: "Aprobarea documentului nu vine din sesiunea ta de proprietar; exportul nu pornește singur" };
    }
    return { ok: true, artifact: a };
  }

  // ---------------------------------------------------------------- phase B: the derived export (no second confirmation)
  const activations = new Map();
  function activate(id) {
    if (closing) return Promise.resolve({ activated: false, reason: "Hub-ul se oprește" });
    if (activations.has(id)) return activations.get(id);
    const promise = activateInner(id).catch((error) => ({ activated: false, reason: error.message })).finally(() => activations.delete(id));
    activations.set(id, promise);
    return promise;
  }
  async function activateInner(id) {
    let r = get(id);
    if (!r) return { activated: false, reason: "înregistrare necunoscută" };
    const flow = DESK_FLOWS[r.kind];
    if (!flow.exportKind) return { activated: false, reason: "fără fază derivată" };
    if (!(r.status === "WAITING_OWNER" || (r.status === "PACKAGING" && !r.phaseBPlanId))) return { activated: false, reason: `înregistrarea e ${r.status}` };
    const consent = r.consent || {};
    if (r.status === "WAITING_OWNER") {
      if (r.activateBy && new Date(r.activateBy) < clock()) { setStatus(id, "EXPIRED", "Fereastra cardului confirmat a trecut înainte de aprobare; o continuare cere o confirmare nouă", { from: ["WAITING_OWNER"] }); return { activated: false, reason: "expirată" }; }
      const check = approvedExactly(r);
      if (check.wait) return { activated: false, reason: check.reason };
      if (!check.ok) { setStatus(id, check.status, check.reason, { from: ["WAITING_OWNER"] }); return { activated: false, reason: check.reason }; }
      const plan = opsPlans.view(consent.planId);
      if (!plan || plan.status !== "DONE") return { activated: false, reason: `planul confirmat e ${plan?.status || "necunoscut"}` };
      if (!setStatus(id, "PACKAGING", "Ai aprobat documentul exact: pornesc exportul, fără altă întrebare", { from: ["WAITING_OWNER"] })) return { activated: false, reason: "înregistrarea s-a schimbat" };
      r = get(id);
    }
    const fail = (to, reason, meta = null) => { setStatus(id, to, reason, { from: ["PACKAGING"], meta }); return { activated: false, reason, status: to }; };
    if (!consent.planId || !consent.sessionId || !consent.confirmedAt) return fail("FAILED", "Înregistrarea nu are confirmarea cardului");
    if (r.activateBy && new Date(r.activateBy) < clock()) return fail("EXPIRED", "Fereastra cardului confirmat a trecut; o continuare cere o confirmare nouă");
    const plan = opsPlans.view(consent.planId);
    if (!plan || plan.kind !== flow.kind || plan.hash !== consent.planHash || plan.status !== "DONE") return fail("FAILED", "Planul confirmat nu mai e cel terminat");
    const anchor = anchors.anchorOf(plan);
    const stopped = anchors.stoppedSince(anchor.at, anchor.planId, { afterSeq: anchor.seq });
    if (stopped) return fail("STOPPED", `${STOP_REASON[stopped.kind] || STOP_REASON.stop_all}; exportul nu pornește singur`, { stop: stopped });
    const held = trust.confirmedAuthority ? trust.confirmedAuthority(anchor.sessionId) : { ok: false, reason: "necunoscută" };
    if (!held.ok) return fail("STOPPED", `Autorizarea în care ai confirmat cardul a fost revocată (${held.reason}); exportul nu pornește`);
    const check = approvedExactly(r);
    if (!check.ok) return fail(check.wait ? "STALE" : check.status, check.reason);
    const thenSha = plan.steps.at(-1)?.params?.then?.bodySha;
    if (!thenSha) return fail("FAILED", "Planul confirmat nu are pasul exportului");
    try {
      const derived = await opsPlans.adoptDerived({ kind: flow.exportKind, title: exportTitle(r.kind), steps: exportSteps(r.kind, { recordId: id }), limits: deskPhaseBLimits(),
        parent: { kind: flow.kind, id: plan.id, hash: plan.hash, confirmedAt: consent.confirmedAt, deliveryId: null }, expectedBodySha: thenSha, sessionId: anchor.sessionId, credential: consent.credential || "",
        onCreated: (planId) => {
          const late = anchors.stoppedSince(anchor.at, anchor.planId, { afterSeq: anchor.seq });
          if (late) throw new HubError("policy", STOP_REASON[late.kind] || STOP_REASON.stop_all, { code: "STOPPED", data: { stop: late } });
          if (db.prepare("UPDATE desk_records SET phase_b_plan_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PACKAGING' AND phase_b_plan_id IS NULL").run(planId, now(), id).changes !== 1) {
            throw new HubError("conflict", "Înregistrarea s-a schimbat în timpul pornirii", { code: "DESK_RECORD_STATE" });
          }
        } });
      return { activated: true, planId: derived.id };
    } catch (error) {
      if (closing) return { activated: false, reason: "Hub-ul se oprește" };
      const code = error?.code || "";
      const to = ["SESSION_CLOSED", "STOPPED"].includes(code) ? "STOPPED" : code === "PLAN_DERIVED_CHANGED" ? "STALE" : code === "PLAN_DERIVED_EXPIRED" ? "EXPIRED" : "FAILED";
      return fail(to, `Exportul nu a pornit: ${clip(error?.message, 200)}`, error?.details?.stop ? { stop: error.details.stop } : null);
    }
  }
  /** registerParent(<flow kind>).verify: the phase-A plan is the finished one this record is bound to and waits for its export. */
  function verifyParent(parent) {
    const plan = opsPlans.view(parent?.id);
    if (!plan || !DESK_PLAN_KINDS.includes(plan.kind) || plan.kind !== parent.kind) return { ok: false, reason: "planul confirmat nu mai există" };
    if (plan.hash !== parent.hash) return { ok: false, reason: "planul confirmat s-a schimbat" };
    if (plan.status !== "DONE") return { ok: false, reason: `planul confirmat e ${plan.status}` };
    const r = db.prepare("SELECT status, phase_b_plan_id FROM desk_records WHERE plan_id = ?").get(plan.id);
    if (!r || r.status !== "PACKAGING" || r.phase_b_plan_id) return { ok: false, reason: "înregistrarea nu așteaptă exportul" };
    return { ok: true };
  }

  // ---------------------------------------------------------------- exports (rows; the files are written by the plan step)
  const expView = (x) => x && ({ id: x.id, recordId: x.record_id, artifactId: x.artifact_id || null, artifactSha: x.artifact_sha || null, revision: x.revision, folder: x.folder, folderName: path.basename(x.folder),
    files: parse(x.files_json, []), manifestSha256: x.manifest_sha256 || null, verification: parse(x.verification_json, {}), status: x.status, statusReason: x.status_reason || "", opKey: x.op_key,
    inputsSha: x.inputs_sha, planId: x.ops_plan_id || null, labels: DESK_LABELS, sent: false, synthetic: true, partial: x.status === "INCOMPLETE", createdAt: x.created_at, updatedAt: x.updated_at });
  const exportOf = (id) => expView(db.prepare("SELECT * FROM desk_exports WHERE id = ?").get(String(id || "")));
  /** Where the next export of this record goes (no write): its C-01 key, a deterministic id, the revision and the folder. */
  function exportTarget(r, { op, keyParams, name, subjectId }, exportsDir = media?.exportsDir?.()) {
    if (!exportsDir) throw new HubError("policy", "Nu există un folder de exporturi aprobat.", { code: "DESK_NO_EXPORTS_DIR" });
    const key = ledger.key(rootOf(r), op, keyParams);
    const existing = db.prepare("SELECT * FROM desk_exports WHERE op_key = ?").get(key);
    if (existing) return { key, exportId: existing.id, revision: existing.revision, folder: existing.folder, existing: expView(existing) };
    const exportId = `dex_${key.slice(0, 10)}_${key.slice(10, 20)}`;
    const revision = Number(db.prepare("SELECT COALESCE(MAX(revision), 0) AS n FROM desk_exports WHERE record_id = ?").get(r.id).n) + 1;
    const flow = DESK_FLOWS[r.kind];
    const names = deskFolderNames({ root: flow.root, prefix: flow.folderPrefix, name, subjectId, revision, exportId });
    return { key, exportId, revision, folder: path.join(path.resolve(exportsDir), names.root, names.subject, names.revision), existing: null };
  }
  function reserveExport({ r, target, artifact: a = null, inputs, fixedAt, planId, actor }) {
    return bus.transaction(() => {
      const existing = db.prepare("SELECT * FROM desk_exports WHERE op_key = ?").get(target.key);
      if (existing) {
        if (existing.status === "INCOMPLETE") db.prepare("UPDATE desk_exports SET status = 'WRITING', status_reason = '', updated_at = ? WHERE id = ? AND status = 'INCOMPLETE'").run(now(), existing.id);
        return { exp: exportOf(existing.id), resumed: true };
      }
      db.prepare(`INSERT INTO desk_exports (id, record_id, artifact_id, artifact_sha, revision, folder, files_json, verification_json, status, status_reason, op_key, inputs_json, inputs_sha, ops_plan_id, synthetic, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, '[]', '{}', 'WRITING', '', ?, ?, ?, ?, 1, ?, ?, ?)`).run(target.exportId, r.id, a?.id || null, a?.contentSha || null, target.revision, target.folder, target.key, json(inputs), hashCanonical(inputs), planId, clip(actor, 80), fixedAt, now());
      return { exp: exportOf(target.exportId), resumed: false };
    });
  }
  function recordExportFiles(exportId, files, { incomplete = null, verification = null } = {}) {
    bus.transaction(() => {
      const x = exportOf(exportId);
      if (!x || !["WRITING", "INCOMPLETE"].includes(x.status)) return;
      db.prepare(`UPDATE desk_exports SET files_json = ?, ${verification ? "verification_json = ?, " : ""}updated_at = ? WHERE id = ?`).run(json(files), ...(verification ? [json(verification)] : []), now(), exportId);
      if (incomplete && x.status === "WRITING") {
        db.prepare("UPDATE desk_exports SET status = 'INCOMPLETE', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'").run(clip(incomplete, 300), now(), exportId);
        emit("desk.export.incomplete", exportId, { exportId, recordId: x.recordId, revision: x.revision, files: files.length, reason: clip(incomplete, 200) });
      }
    });
  }
  /** The final transaction of an export step: READY, older READY revisions SUPERSEDED, the record READY (with its next action). */
  function completeExport({ exportId, planId, phase, files, verification, manifestSha, actor, nextAction, inputsSha, stateAfter = null }) {
    const x = exportOf(exportId);
    const r = need(x.recordId);
    const want = phase === "A" ? { plan: r.planId, status: "PREPARING" } : { plan: r.phaseBPlanId, status: "PACKAGING" };
    if (want.plan !== planId || r.status !== want.status) throw new HubError("conflict", `Înregistrarea e ${r.status}; exportul nu se încheie.`, { code: "DESK_RECORD_STATE" });
    if (x.inputsSha !== inputsSha) throw new HubError("conflict", "Intrările exportului s-au schimbat în timpul scrierii.", { code: "DESK_INPUTS_CHANGED" });
    if (db.prepare("UPDATE desk_exports SET status = 'READY', status_reason = '', files_json = ?, verification_json = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ? AND status = 'WRITING'")
      .run(json(files), json(verification || {}), manifestSha, now(), exportId).changes !== 1) throw new HubError("conflict", "Exportul nu mai e în scriere.", { code: "DESK_EXPORT_STATE" });
    for (const older of db.prepare("SELECT id, revision FROM desk_exports WHERE record_id = ? AND id <> ? AND status IN ('READY','STALE')").all(r.id, exportId)) {
      db.prepare("UPDATE desk_exports SET status = 'SUPERSEDED', status_reason = ?, updated_at = ? WHERE id = ? AND status IN ('READY','STALE')").run(`Înlocuit de revizia ${x.revision}`, now(), older.id);
      emit("desk.export.superseded", older.id, { exportId: older.id, revision: older.revision, by: exportId });
    }
    if (stateAfter) db.prepare("UPDATE desk_records SET state_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(json(stateAfter), now(), r.id);
    setStatus(r.id, "READY", `${DESK_FLOWS[r.kind].title} (revizia ${x.revision}) e gata, local; nimic trimis`, { from: [want.status], extra: { next_action: clip(nextAction, 400) } });
    emit("desk.export.written", exportId, { exportId, recordId: r.id, kind: r.kind, revision: x.revision, folderName: x.folderName, manifestSha256: manifestSha, files: files.length, app: verification?.docx?.app || null }, clip(actor, 80));
    return exportOf(exportId);
  }
  /** A READY export is current while its recorded inputs equal what the record states now (read-time check; never writes). */
  const latestExport = (recordId) => expView(db.prepare("SELECT * FROM desk_exports WHERE record_id = ? ORDER BY revision DESC LIMIT 1").get(String(recordId || "")));
  const previousExport = (recordId, exceptId) => expView(db.prepare("SELECT * FROM desk_exports WHERE record_id = ? AND id <> ? AND status IN ('READY','STALE','SUPERSEDED') ORDER BY revision DESC LIMIT 1").get(recordId, String(exceptId || "")));

  // ---------------------------------------------------------------- Operations: an owner's update of the checklist (continuation)
  /**
   * A material received (or back to missing) in the owner session: a new record version; the exported dossier no longer reflects the
   * state, so it is STALE and the record waits for ONE continuation card that exports the next revision. The same update twice changes nothing.
   */
  function updateItem(recordId, { itemId, status, note = "" }, actor, { channel, sessionCheck } = {}) {
    if (!["RECEIVED", "MISSING"].includes(status)) throw new HubError("validation", "Starea materialului e RECEIVED sau MISSING");
    return bus.transaction(() => {
      const r = need(recordId);
      if (r.kind !== "ops_start") throw new HubError("validation", "Doar dosarul de pornire are materiale de primit");
      if (!["READY", "STALE"].includes(r.status)) throw new HubError("conflict", `Dosarul e ${DESK_STATUS_RO[r.status] || r.status}; îl actualizezi după ce e pregătit.`, { code: "DESK_RECORD_STATE" });
      const session = decisionSession(channel, sessionCheck, "o actualizare a dosarului de pornire");
      const state = r.state || {};
      const item = (state.checklist || []).find((i) => i.id === itemId);
      if (!item) throw new HubError("not_found", "Materialul nu există în checklist");
      const text = clip(note, 300).trim();
      if (item.status === status && (item.note || "") === text) return { unchanged: true, record: r };
      const checklist = state.checklist.map((i) => (i.id === itemId ? { ...i, status, receivedAt: status === "RECEIVED" ? now() : null, note: text } : i));
      const next = { ...state, checklist, rev: (Number(state.rev) || 0) + 1 };
      Object.assign(next, opsProgress(next));
      const updated = saveState(r.id, next, { nextAction: "Actualizezi dosarul de pornire (un card nou exportă revizia următoare), apoi continui: " + next.nextAction, actor, event: "desk.record.item",
        meta: { itemId, status, authority: session?.authority || "test", sessionId: session?.id || null, credentialId: session?.credentialId || null } });
      if (r.status === "READY") setStatus(r.id, "STALE", `Dosarul exportat nu mai reflectă starea: ${item.id} ${status === "RECEIVED" ? "primit" : "marcat lipsă"}`, { from: ["READY"] });
      return { unchanged: false, record: get(updated.id) };
    });
  }

  // ---------------------------------------------------------------- invalidation, cancel, continue
  /** The sales writers' hook (inside their transaction): an Operations / Finance record whose offer is no longer the approved one is STALE. */
  function onSalesInvalidated({ opportunityId, reason }) {
    if (!opportunityId) return;
    for (const row of db.prepare("SELECT id FROM desk_records WHERE opportunity_id = ? AND status IN ('WAITING_OWNER','PACKAGING','READY')").all(opportunityId)) {
      const r = get(row.id);
      if (!inputsCurrent(r)) setStatus(r.id, "STALE", `Oferta nu mai corespunde: ${clip(reason, 200)}`, { from: ["WAITING_OWNER", "PACKAGING", "READY"] });
    }
  }
  /** Every open record whose inputs changed (the tick; also the support cases, whose package lives outside Sales). */
  function checkInputs() {
    let n = 0;
    for (const row of db.prepare("SELECT id FROM desk_records WHERE status IN ('WAITING_OWNER','PACKAGING','READY')").all()) {
      const r = get(row.id);
      if (r.inputsSha && !inputsCurrent(r) && setStatus(r.id, "STALE", r.kind === "support_case" ? "Pachetul acceptat al proiectului nu mai e cel citit" : "Oferta aprobată nu mai e cea din care am pregătit", { from: ["WAITING_OWNER", "PACKAGING", "READY"] })) n += 1;
    }
    return n;
  }
  function cancel(id, { reason = "Anulată de tine", actor = "owner" } = {}) {
    const r = need(id);
    if (!OPEN.includes(r.status)) return { record: r, cancelled: false };
    for (const planId of [r.planId, r.phaseBPlanId].filter(Boolean)) {
      const plan = opsPlans.view(planId);
      if (plan && ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"].includes(plan.status)) opsPlans.cancel(planId, { reason, actor });
    }
    setStatus(id, "CANCELLED", `${clip(reason, 200)} (${clip(actor, 60)})`, { from: OPEN });
    return { record: get(id), cancelled: true };
  }
  let stepsFor = null;
  /** The planner registers how a flow's phase-A steps are built (the same for the first card and a continuation). */
  const registerSteps = (fn) => { stepsFor = fn; };
  /** ONE new card that continues a stopped / stale record: the same root plan (the ledger skips what was done); its own confirmation. */
  async function continueCard(id, { actor = "owner", via = "ui" } = {}) {
    const r = need(id);
    if (!DESK_CONTINUABLE.includes(r.status)) throw new HubError("conflict", `Înregistrarea e ${DESK_STATUS_RO[r.status] || r.status}; nu are ce continua.`, { code: "DESK_RECORD_STATE" });
    if (!rootConfirmed(r)) throw new HubError("conflict", "Cardul inițial nu a fost confirmat niciodată: cere din nou, cu o cerere nouă.", { code: "DESK_RECORD_STATE" });
    const hold = stopHold(r);
    if (hold) throw new HubError("gate", hold.reason, { code: "GATE_REARM_REQUIRED", data: { code: "GATE_REARM_REQUIRED", rearm: true, kind: "desk", cls: hold.cls } });
    if (!stepsFor) throw new HubError("internal", "Planificatorul biroului intern nu e disponibil");
    const built = await stepsFor(r, { continues: { rootPlanId: r.rootPlanId, rootPlanHash: r.rootPlanHash } });
    const plan = await opsPlans.propose({ kind: DESK_FLOWS[r.kind].kind, title: `Continuă: ${DESK_FLOWS[r.kind].title} ${r.internalNo}`, steps: built.steps, limits: deskPhaseALimits(), actor, via });
    return { plan, record: r, decisionsLeft: decisionsLeft(r.kind), never: DESK_NEVER };
  }
  const decisionsLeft = (kind) => (DESK_FLOWS[kind].decision
    ? [`Aprobarea internă a ${kind === "support_case" ? "textului răspunsului" : "devizului"} exact (id + SHA complet) rămâne decizia ta, separat: confirmarea cardului nu o include.`]
    : ["Nicio altă decizie pe traseul normal: pornirea lucrului Engineering rămâne o decizie separată, după acordul clientului."]);

  // ---------------------------------------------------------------- listeners, tick, boot
  function onEvent(e) {
    if (closing) return;
    const p = e.payload || {};
    try {
      if (e.type === "desk.artifact.approved" && p.recordId) activate(p.recordId).catch(() => {});
      else if (e.type === "ops.plan.done") {
        const r = db.prepare("SELECT id FROM desk_records WHERE plan_id = ? AND status = 'WAITING_OWNER'").get(e.scopeId);
        if (r) activate(r.id).catch(() => {});
      } else if (e.type === "ops.plan.failed") {
        const r = db.prepare("SELECT id FROM desk_records WHERE (plan_id = ? AND status = 'PREPARING') OR (phase_b_plan_id = ? AND status = 'PACKAGING')").get(e.scopeId, e.scopeId);
        if (r) {
          const st = opsPlans.view(e.scopeId)?.steps?.find((s) => s.status === "FAILED");
          const code = String(st?.error || "").split(":")[0];
          setStatus(r.id, STALE_CODES.has(code) ? "STALE" : "FAILED", `Planul s-a oprit: ${clip(st?.error || p.reason || "eșec", 200)}`, { from: ["PREPARING", "PACKAGING"] });
        }
      } else if (e.type === "ops.plan.cancelled") {
        const r = db.prepare("SELECT id FROM desk_records WHERE (plan_id = ? OR phase_b_plan_id = ?) AND status IN ('PLANNED','PREPARING','WAITING_OWNER','PACKAGING')").get(e.scopeId, e.scopeId);
        if (r) setStatus(r.id, "CANCELLED", `Planul a fost anulat${p.reason ? `: ${clip(p.reason, 160)}` : ""}`, { from: ["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING"] });
      } else if (e.type === "ops.plan.superseded" || e.type === "ops.plan.expired") {
        const r = db.prepare("SELECT id FROM desk_records WHERE root_plan_id = ? AND status = 'PLANNED'").get(e.scopeId);
        if (r) setStatus(r.id, e.type === "ops.plan.expired" ? "EXPIRED" : "CANCELLED", e.type === "ops.plan.expired" ? "Cardul nu a fost confirmat la timp" : "Un card mai nou l-a înlocuit", { from: ["PLANNED"],
          extra: { next_action: "Cardul nu mai e valabil (neconfirmat): ceri din nou, cu aceleași cuvinte; o cerere nouă primește un card nou." } });
      } else if (e.type === "system.stop_all") {
        const kind = ["stop_all", "shutdown", "security"].includes(p.stopKind) ? p.stopKind : e.source === "system" ? "shutdown" : "stop_all";
        if (kind === "shutdown") return;
        const meta = { stop: { kind, suspensionId: p.suspensionId || null, at: e.createdAt || null, seq: e.seq || null } };
        for (const r of db.prepare("SELECT id FROM desk_records WHERE status = 'WAITING_OWNER'").all()) {
          setStatus(r.id, "STOPPED", `${STOP_REASON[kind] || STOP_REASON.stop_all}: exportul nu pornește singur; o continuare cere o confirmare nouă, după ce redeschizi poarta`, { from: ["WAITING_OWNER"], meta });
        }
      } else if (e.type === "owner.sessions_revoked" || e.type === "owner.credential_revoked") {
        for (const row of db.prepare("SELECT id FROM desk_records WHERE status = 'WAITING_OWNER'").all()) {
          const r = get(row.id);
          const anchor = anchors?.anchorOf ? anchors.anchorOf(opsPlans.view(r.consent?.planId)) : null;
          const held = trust.confirmedAuthority ? trust.confirmedAuthority(anchor?.sessionId || r.consent?.sessionId) : { ok: true };
          if (!held.ok) setStatus(r.id, "STOPPED", `Autorizarea în care ai confirmat cardul a fost revocată (${held.reason}); exportul nu pornește; o continuare cere o confirmare nouă`, { from: ["WAITING_OWNER"] });
        }
      }
    } catch { /* a listener never breaks the publisher; the tick re-checks */ }
  }
  function expireDead() {
    let n = 0;
    for (const row of db.prepare("SELECT id FROM desk_records WHERE status = 'PREPARING' OR (status = 'PACKAGING' AND phase_b_plan_id IS NOT NULL)").all()) {
      const r = get(row.id);
      const planId = r.status === "PREPARING" ? r.planId : r.phaseBPlanId;
      const plan = planId ? opsPlans.view(planId) : null;
      if (!plan || !["PAUSED", "NEEDS_OWNER"].includes(plan.status) || !plan.expiresAt || new Date(plan.expiresAt) > clock()) continue;
      if (!setStatus(r.id, "EXPIRED", `Fereastra planului a trecut cât era oprit (${plan.status === "PAUSED" ? "pauză" : "aștepta decizia ta"}): o continuare (un card nou) îl reia de unde a rămas`, { from: [r.status] })) continue;
      try { opsPlans.cancel(planId, { reason: "Fereastra planului a trecut; continuarea cere un card nou", actor: "hub" }); } catch { /* already closed */ }
      n += 1;
    }
    return n;
  }
  async function tick() {
    if (closing) return { checked: 0 };
    const stale = checkInputs();
    expireDead();
    const rows = db.prepare("SELECT id FROM desk_records WHERE status = 'WAITING_OWNER' OR (status = 'PACKAGING' AND phase_b_plan_id IS NULL)").all();
    for (const r of rows) { if (closing) break; await activate(r.id); }
    return { checked: rows.length, stale };
  }
  let detach = null;
  function boot() {
    closing = false;
    if (!detach && bus.subscribe) detach = bus.subscribe((e) => setTimeout(() => onEvent(e), 0));
    setTimeout(() => { tick().catch(() => {}); }, 0);
  }
  function close() { closing = true; if (detach) detach(); detach = null; }
  async function idle(id) {
    await activations.get(id);
    const r = get(id);
    if (r?.planId) await opsPlans.idle(r.planId);
    await activations.get(id);
    const after = get(id);
    if (after?.phaseBPlanId) await opsPlans.idle(after.phaseBPlanId);
    return get(id);
  }

  /** registerResumeGuard: „Continuă” of a desk plan is refused while a Stop All since the owner's last confirmation still holds the gate. */
  function resumeGuard(plan) {
    if (!plan || ![...DESK_PLAN_KINDS, ...DESK_EXPORT_KINDS].includes(plan.kind) || !anchors?.anchorOf) return;
    const a = anchors.anchorOf(plan);
    const stop = a ? anchors.stoppedSince(a.at, a.planId, { afterSeq: a.seq, latest: true }) : null;
    if (!stop) return;
    const c = classifySuspension(settings.get("executionGate") || {});
    if (!STOP_HOLD_CLASSES.has(c.cls)) return;
    const same = (stop.suspensionId && c.id && stop.suspensionId === c.id) || (stop.at && c.since && String(stop.at) >= String(c.since));
    if (!same) return;
    throw new HubError("gate", `„Oprește tot” a venit după ce ai confirmat cardul și poarta e încă oprită: nu îl reiau acum. După ce redeschizi poarta ${REARM_WHERE}, îl reiei cu „Continuă”.`, { code: "GATE_REARM_REQUIRED", data: { code: "GATE_REARM_REQUIRED", rearm: true, kind: "ops", cls: c.cls } });
  }
  if (typeof opsPlans?.registerResumeGuard === "function") for (const kind of [...DESK_PLAN_KINDS, ...DESK_EXPORT_KINDS]) opsPlans.registerResumeGuard(kind, resumeGuard);

  // ---------------------------------------------------------------- reads
  /** One record with its documents, exports and what comes next (GET only; nothing written). */
  function detail(id) {
    const r = need(id);
    const flow = DESK_FLOWS[r.kind];
    const artifacts = db.prepare("SELECT * FROM desk_artifacts WHERE record_id = ? ORDER BY version DESC").all(r.id).map(artView);
    const exports = db.prepare("SELECT * FROM desk_exports WHERE record_id = ? ORDER BY revision DESC").all(r.id).map(expView);
    const current = ["WAITING_OWNER", "PACKAGING", "READY"].includes(r.status) ? inputsCurrent(r) : null;
    const awaited = r.status === "WAITING_OWNER" && r.awaited ? artifacts.find((a) => a.id === r.awaited.artifactId) || null : null;
    const plans = [r.planId, r.phaseBPlanId].filter(Boolean).map((pid) => { const p = opsPlans.view(pid); return p ? { id: p.id, kind: p.kind, status: p.status, statusReason: p.statusReason, expiresAt: p.expiresAt } : null; }).filter(Boolean);
    return { record: { ...r, departmentTitle: flow.title, statusText: DESK_STATUS_RO[r.status] || r.status, authority: r.consent?.authority || null, confirmedAt: r.consent?.confirmedAt || null },
      artifacts, exports, plans, inputsCurrent: current, continuable: isContinuable(r), waitsForRearm: Boolean(stopHold(r)),
      decision: awaited && current ? { kind: flow.decision, artifactId: awaited.id, version: awaited.version, sha: awaited.contentSha, recordId: r.id } : null,
      decisionsLeft: decisionsLeft(r.kind), never: DESK_NEVER, labels: DESK_LABELS, unknownText: UNKNOWN_TEXT };
  }
  function list({ kind = null, limit = 50 } = {}) {
    const rows = db.prepare(`SELECT * FROM desk_records ${kind ? "WHERE kind = ?" : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...(kind ? [kind] : []), Math.min(200, Math.max(1, Number(limit) || 50))).map(view);
    return rows.map((r) => {
      const a = DESK_FLOWS[r.kind].artifact ? latestArtifact(r.id) : null;
      const x = latestExport(r.id);
      return { id: r.id, kind: r.kind, department: r.department, internalNo: r.internalNo, title: r.title, status: r.status, statusText: DESK_STATUS_RO[r.status] || r.status, statusReason: r.statusReason,
        nextAction: r.nextAction, owner: r.owner, projectId: r.projectId, opportunityId: r.opportunityId, proposalId: r.proposalId, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt,
        artifact: a ? { id: a.id, version: a.version, status: a.status, contentSha: a.contentSha } : null, export: x ? { id: x.id, revision: x.revision, status: x.status, folderName: x.folderName, manifestSha256: x.manifestSha256 } : null,
        waitsForOwner: r.status === "WAITING_OWNER", continuable: isContinuable(r), synthetic: true };
    });
  }
  /** The finance register: every deviz record with its document versions and exports (type, state, sources, manifest, verification). */
  function register() {
    return db.prepare("SELECT * FROM desk_records WHERE kind = 'finance_doc' ORDER BY created_at DESC, rowid DESC").all().map(view).map((r) => ({
      internalNo: r.internalNo, recordId: r.id, docType: "Deviz", status: r.status, statusText: DESK_STATUS_RO[r.status] || r.status, nextAction: r.nextAction, source: { proposalId: r.proposalId, proposalSha: r.proposalSha },
      documents: db.prepare("SELECT * FROM desk_artifacts WHERE record_id = ? ORDER BY version DESC").all(r.id).map(artView).map((a) => ({ id: a.id, version: a.version, status: a.status, contentSha: a.contentSha, approvedAt: a.approvedAt })),
      exports: db.prepare("SELECT * FROM desk_exports WHERE record_id = ? ORDER BY revision DESC").all(r.id).map(expView).map((x) => ({ id: x.id, revision: x.revision, status: x.status, folderName: x.folderName, manifestSha256: x.manifestSha256, app: x.verification?.docx?.app || null })),
      notFiscal: true, synthetic: true }));
  }
  /** The decisions waiting for the owner (the inbox): a record waiting with its current awaited document. */
  function pendingDecisions() {
    return db.prepare("SELECT id FROM desk_records WHERE status = 'WAITING_OWNER'").all().map((x) => detail(x.id)).filter((d) => d.decision).map((d) => ({ ...d.decision, internalNo: d.record.internalNo, title: d.record.title, kind: d.record.kind }));
  }
  /** The newest open record of a kind for the same subject (offer / project + request): the same request never makes a second record. */
  function sameSubject({ kind, opportunityId = null, projectId = null, requestSha = null }) {
    const rows = db.prepare(`SELECT * FROM desk_records WHERE kind = ? AND status <> 'CANCELLED' ${opportunityId ? "AND opportunity_id = ?" : "AND project_id = ?"} ORDER BY created_at DESC, rowid DESC`)
      .all(kind, opportunityId || projectId).map(view);
    // A card never confirmed that expired or was replaced holds nothing (a new request gets its own record).
    return rows.filter((r) => !(DESK_CONTINUABLE.includes(r.status) && !rootConfirmed(r))).find((r) => (requestSha ? r.source?.requestSha === requestSha : true)) || null;
  }

  return { flows: DESK_FLOWS, get, need, view, list, detail, register, pendingDecisions, sameSubject, createPlanned, enterPlan, enterPreparing, bound, saveState, setStatus, rootOf,
    approvedOffer, acceptedSources, inputsOf, inputsShaOf, inputsCurrent, artifact, latestArtifact, createArtifact, toWaiting, approveArtifact, approvedExactly, activate, verifyParent,
    exportTarget, reserveExport, recordExportFiles, completeExport, exportOf, latestExport, previousExport, updateItem, onSalesInvalidated, checkInputs, cancel, continueCard, registerSteps,
    isContinuable, stopHold, decisionsLeft, onEvent, tick, boot, close, idle };
}

/** The derived export step of a flow (its body is hashed in the phase-A card, before any id exists: bound to the record only). */
export const exportSteps = (kind, { recordId }) => [{ kind: DESK_FLOWS[kind].exportKind, params: { recordId } }];
export const exportTitle = (kind) => (kind === "support_case" ? "Exportul cazului de suport (după aprobarea răspunsului)" : "Devizul în Word și PDF (după aprobarea ta)");
