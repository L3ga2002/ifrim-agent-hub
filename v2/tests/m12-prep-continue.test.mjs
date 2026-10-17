// M12 WP8 — phase B of the Sales preparation (SPEC §5; owner clarification 3; C-05, C-06, S-08, T-S12, D7, D11). The owner's verified
// approval (owner session) of EXACTLY the awaited offer id + sha continues the SAME confirmed plan: the contact draft and „Dosarul
// ofertei” are DERIVED from the phase-A consent (modality derived, no second confirmation). Another version, an approval not decided in
// the owner session, a Stop All since the consent, an expiry, a cancel or a revoked authority never continue it; each stops it with its
// reason and the owner continues with ONE new card. An approved offer, a draft or a ready dossier never mean sent / CONTACTED / WON.
// Every Hub is a fully synthetic acceptance hub (accept-helpers isolation; Office COM off → APP_NOT_RUN declared).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { DOSSIER_KIND, PREPARE_KIND, ACTIVATE_WITHIN_MIN } from "../server/sales/preparation.mjs";

async function waiting(c, options = {}) {
  const t = await prepHub(c, options);
  await t.authenticate(options.devProfile ? { dev: true } : {});
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  return { t, card, preparationId, prep: t.hub.salesPreparations.get(preparationId) };
}
const phaseBPlans = (t) => countRows(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE kind = ?", DOSSIER_KIND);
const noPhaseB = (t, oppId) => {
  assert.equal(phaseBPlans(t), 0, "no derived plan");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts"), 0, "no draft");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), 0, "no dossier");
  if (oppId) assert.equal(t.hub.salesPreparations.forOpportunity(oppId).dossiers.length, 0);
};
const nothingSent = (t, oppId) => {
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "missions"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','WON','IN_DISCUSSION')"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts WHERE status = 'SENT'"), 0);
  if (oppId) assert.equal(t.hub.sales.getOpportunity(oppId).opportunity.status, "APPROVED_INTERNAL");
};
const stopAll = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });

test("M12-CONT-01 the owner's approval of exactly id + sha → phase B DERIVED from the same consent, no other confirmation; draft DRAFT, dossier READY (APP_NOT_RUN); nothing sent (S-08)", async (c) => {
  const { t, card, preparationId, prep } = await waiting(c);
  const consents = eventCount(t, "ops.plan.consent");
  const r = await approveAwaited(t, prep);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(eventCount(t, "ops.plan.consent"), consents, "no second confirmation");
  const b = t.hub.opsPlans.view(done.phaseBPlanId);
  assert.equal(b.kind, DOSSIER_KIND);
  assert.equal(b.status, "DONE", b.statusReason);
  assert.equal(b.consent.modality, "derived");
  assert.deepEqual([b.consent.derivedFrom.kind, b.consent.derivedFrom.id, b.consent.derivedFrom.hash], [PREPARE_KIND, card.id, card.hash]);
  assert.equal(b.consent.sessionId, prep.consent.sessionId);
  assert.equal(b.body.model, null);
  assert.equal(t.hub.opsPlans.view(card.id).steps.find((s) => s.kind === "sales.proposal.draft").params.then.bodySha, b.hash, "the derived body is exactly the one hashed in the card");
  const view = t.hub.sales.getOpportunity(done.opportunityId);
  assert.equal(view.proposals[0].status, "APPROVED_INTERNAL");
  assert.equal(view.proposals[0].approvedSha, prep.awaited.proposalSha);
  assert.equal(view.drafts.length, 1);
  assert.equal(view.drafts[0].status, "DRAFT");
  assert.equal(view.drafts[0].meta.proposalSha, prep.awaited.proposalSha);
  const { dossiers } = t.hub.salesPreparations.forOpportunity(done.opportunityId);
  assert.equal(dossiers.length, 1);
  assert.deepEqual([dossiers[0].status, dossiers[0].inputsCurrent], ["READY", true]);
  assert.equal(dossiers[0].verification.proposalDocx.app, "APP_NOT_RUN");
  assert.equal(dossiers[0].verification.proposalDocx.file, "FILE_CHECKED");
  assert.ok(fs.existsSync(dossiers[0].folder));
  assert.equal(eventCount(t, "sales.dossier.written"), 1);
  // S-08: an approved offer, a draft or a ready dossier are not a send, a contact or a win.
  nothingSent(t, done.opportunityId);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "no model");
  t.assertPaths();
});

test("M12-CONT-02 the same credential in another (rotated) owner session approves → the plan continues (no RECONFIRM_DELTA, no second confirmation)", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const old = prep.consent.sessionId;
  t.hub.db.prepare("UPDATE owner_sessions SET expires_at = ? WHERE id = ?").run(new Date(Date.now() + 60000).toISOString(), old);
  await t.authenticate({ reauth: true });
  const next = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
  assert.notEqual(next, old);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(t.hub.opsPlans.view(done.phaseBPlanId).consent.sessionId, old, "phase B rides on the confirmation's authority");
  assert.equal(JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.proposal.approved'").get().payload_json).sessionId, next);
});

test("M12-CONT-03a another version (made by hand) → the preparation is STALE; approving that version continues nothing", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const v2 = (await salesCommand(t, "sales.proposal.create", { opportunityId: prep.opportunityId })).result;
  assert.equal(prepStatus(t, preparationId), "STALE");
  assert.match(t.hub.salesPreparations.get(preparationId).staleReason, /versiune nouă/);
  await salesCommand(t, "sales.opportunity.transition", { opportunityId: prep.opportunityId, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire versiunea mea" });
  const r = await approveAwaited(t, { awaited: { proposalId: v2.id, proposalSha: v2.contentSha } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await settlePreparation(t, preparationId);
  assert.equal(prepStatus(t, preparationId), "STALE");
  assert.equal(phaseBPlans(t), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), 0);
});

test("M12-CONT-03b an approval decided on the test channel (decided_via test, the M04 path) is not the owner session's → STOPPED, no phase B", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const r = await salesCommand(t, "sales.proposal.approve", { proposalId: prep.awaited.proposalId, displayedSha: prep.awaited.proposalSha });
  await salesCommand(t, "approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash });
  await t.hub.commands.executeApproved(r.command.id, "user");
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "STOPPED", done.statusReason);
  assert.match(done.statusReason, /sesiunea ta de proprietar/);
  noPhaseB(t, prep.opportunityId);
});

test("M12-CONT-03c no owner session: the approval is refused (401) and nothing continues", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const r = await t.request(`/api/sales/proposals/${prep.awaited.proposalId}/approve`, { body: { displayedSha: prep.awaited.proposalSha }, sessionCookie: "" });
  assert.equal(r.status, 401);
  await settlePreparation(t, preparationId);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  noPhaseB(t, prep.opportunityId);
});

test("M12-CONT-04 T-S12 Stop All while waiting → STOPPED and no phase B after the owner's approval; ONE continuation card (new confirmation) continues it without duplicates", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await stopAll(t);
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  assert.equal((await approveAwaited(t, prep)).status, 200, "the owner's decision is recorded");
  const after = await settlePreparation(t, preparationId);
  assert.equal(after.status, "STOPPED");
  noPhaseB(t, prep.opportunityId);
  // The continuation: one new card, confirmed by the owner; the ledger reuses everything already done (no new company, offer or event).
  const rows = ["sales_orgs", "sales_opportunities", "sales_proposals", "sales_qualifications", "sales_evidence"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`));
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId }, { channel: "test" })).result;
  assert.equal(out.plan.status, "PROPOSED");
  assert.equal(out.plan.kind, PREPARE_KIND);
  assert.equal(prepStatus(t, preparationId), "STOPPED", "nothing runs before the confirmation");
  await confirmCard(t, { ...out.plan, preparationId });
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(done.planId, out.plan.id, "the continuation's consent governs now");
  assert.equal(done.rootPlanId, prep.rootPlanId, "the same root plan (C-01 keys)");
  assert.deepEqual(["sales_orgs", "sales_opportunities", "sales_proposals", "sales_qualifications", "sales_evidence"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`)), rows, "no duplicate rows");
  assert.equal(eventCount(t, "sales.synthetic.created"), 1);
  assert.equal(eventCount(t, "sales.research.recorded"), 1);
  assert.equal(t.hub.opsPlans.view(done.phaseBPlanId).consent.derivedFrom.id, out.plan.id);
  nothingSent(t, prep.opportunityId);
});

test("M12-CONT-05 T-S12 Stop All during the research step → no effect after the stop; the plan is held for the rearm", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  let release;
  const gate = new Promise((r) => { release = r; });
  let called = false;
  const original = t.hub.sales.fixturePage;
  t.hub.sales.fixturePage = async (...args) => { called = true; await gate; return original(...args); };
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 200);
  for (let i = 0; i < 200 && !called; i += 1) await settle();
  assert.ok(called, "the research step is reading the fixture");
  const stop = await stopAll(t);
  release();
  await t.hub.opsPlans.idle(card.id);
  const plan = t.hub.opsPlans.view(card.id);
  assert.equal(plan.status, "PAUSED");
  assert.equal(plan.steps.find((s) => s.kind === "sales.research").status, "BLOCKED");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence WHERE claim = 'research:site'"), 0, "no evidence after the stop");
  assert.equal(eventCount(t, "sales.research.recorded"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.research' AND status = 'DONE'"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_proposals"), 0);
  assert.ok(JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'system.stop_all' ORDER BY seq DESC LIMIT 1").get().payload_json).scope.plansPaused.includes(card.id));
  assert.equal(prepStatus(t, preparationId), "PREPARING");
  const sessionId = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
  await assert.rejects(t.hub.opsPlans.resume(card.id, { session: { id: sessionId } }), (e) => e.code === "GATE_REARM_REQUIRED");
  assert.ok(stop);
});

test("M12-CONT-06 sales.preparation.cancel (fail-safe, any owner-facing channel) while waiting or before confirmation → CANCELLED; nothing continues", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await assert.rejects(salesCommand(t, "sales.preparation.cancel", { preparationId }, { channel: "agent", delegation: "x" }), /agent|delegat/i);
  const out = (await t.hub.commands.dispatch({ type: "sales.preparation.cancel", payload: { preparationId, reason: "Nu mai vreau" }, channel: "voice", actor: "voice" })).result;
  assert.equal(out.preparation.status, "CANCELLED");
  assert.equal((await approveAwaited(t, prep)).status, 200);
  await settlePreparation(t, preparationId);
  assert.equal(prepStatus(t, preparationId), "CANCELLED");
  noPhaseB(t, prep.opportunityId);
  // Before the confirmation: the card itself is cancelled with the preparation.
  const { card, preparationId: second } = await proposePreparation(t);
  await salesCommand(t, "sales.preparation.cancel", { preparationId: second });
  await settle();
  assert.equal(t.hub.opsPlans.view(card.id).status, "CANCELLED");
  assert.equal(prepStatus(t, second), "CANCELLED");
  await confirmCard(t, card, { status: 409 });
});

test("M12-CONT-07a expiry while waiting → EXPIRED; the owner's later approval continues nothing", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  assert.ok(Math.abs(Date.parse(prep.activateBy) - Date.parse(prep.consent.confirmedAt) - ACTIVATE_WITHIN_MIN * 60000) < 5000, "the window starts at the confirmation");
  t.hub.db.prepare("UPDATE sales_preparations SET activate_by = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), preparationId);
  await t.hub.salesPreparations.tick();
  assert.equal(prepStatus(t, preparationId), "EXPIRED");
  assert.equal((await approveAwaited(t, prep)).status, 200);
  await settlePreparation(t, preparationId);
  assert.equal(prepStatus(t, preparationId), "EXPIRED");
  noPhaseB(t, prep.opportunityId);
});

test("M12-CONT-07b a revoked authority (revoke-all) refuses the continuation even after an approval in a new session (STOPPED)", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  assert.equal((await t.request("/api/owner/sessions/revoke-all")).status, 200, "revoke-all with the default reason (a security revocation, not a logout)");
  await t.authenticate({ reauth: true });
  assert.equal((await approveAwaited(t, prep)).status, 200, "a new session decides the offer");
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "STOPPED", done.statusReason);
  assert.match(done.statusReason, /revocată/);
  noPhaseB(t, prep.opportunityId);
});

test("M12-CONT-08 D7: new evidence while waiting makes the bound offer STALE (opportunity back to PROPOSAL_DRAFT, preparation STALE, approval refused); an M04 offer is untouched", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prep.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
  const p = t.hub.sales.getOpportunity(prep.opportunityId);
  assert.equal(p.proposals[0].status, "STALE");
  assert.equal(p.opportunity.status, "PROPOSAL_DRAFT");
  assert.equal(prepStatus(t, preparationId), "STALE");
  assert.equal(eventCount(t, "sales.proposal.stale"), 1);
  // The owner's approval of the STALE version is refused for good (never applied; the preparation asks for a new version).
  const r = await approveAwaited(t, prep);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error.code, "SALES_PROPOSAL_STALE");
  assert.equal(t.hub.sales.getOpportunity(prep.opportunityId).proposals[0].approvedSha, null);
  await settlePreparation(t, preparationId);
  noPhaseB(t, prep.opportunityId);
  // An M04 offer (no basis): the same kind of write changes nothing of it.
  const svc = (await salesCommand(t, "sales.service.save", { name: "Site (SINTETIC)", scope: ["Pagini"] })).result;
  const opp = (await salesCommand(t, "sales.opportunity.create", { orgId: prep.orgId, title: "Altă ofertă (M04)", serviceId: svc.id })).result;
  const m04 = (await salesCommand(t, "sales.proposal.create", { opportunityId: opp.opportunity.id })).result;
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prep.orgId, claim: "observație", value: "x", label: "USER_PROVIDED", sourceKind: "manual", sourceRef: "proprietar" });
  assert.equal(t.hub.sales.getOpportunity(opp.opportunity.id).proposals[0].status, "DRAFT", "M04 offers never become STALE");
  assert.equal(m04.content.basis, undefined);
});

test("M12-CONT-09 D11: under the local development profile a card confirmed 5 h after it was shown runs (the window starts at the confirmation)", async (c) => {
  let now = Date.now();
  const profile = { enabled: true, version: 1, id: "dev_m12prep", ...machineIdentity() };
  const t = await prepHub(c, { devProfile: () => profile, clock: () => new Date(now) });
  await t.authenticate({ dev: true });
  const { card, preparationId } = await proposePreparation(t);
  const proposed = t.hub.opsPlans.view(card.id);
  now += 5 * 3600000;
  await t.authenticate({ dev: true });
  await confirmCard(t, card);
  const plan = t.hub.opsPlans.view(card.id);
  assert.equal(plan.status, "DONE", plan.statusReason);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  const confirmedAt = Date.parse(plan.consent.confirmedAt);
  assert.equal(Date.parse(plan.expiresAt), confirmedAt + (plan.body.limits.maxDurationMin + 30) * 60000, "expiry from the confirmation");
  assert.equal(plan.authority.expiresAt, plan.expiresAt);
  assert.ok(Date.parse(plan.expiresAt) > Date.parse(proposed.expiresAt), "later than the proposal-anchored limit");
  assert.equal(t.hub.salesPreparations.get(preparationId).consent.authority, "local_dev_profile", "recorded truthfully");
});
