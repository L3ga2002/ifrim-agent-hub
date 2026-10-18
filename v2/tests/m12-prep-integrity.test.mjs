// M12 review fixes (parts 2–3) — the preparation's inputs and lifecycle (SPEC §3, §5; owner clarifications 2–3; C-04, C-05, C-06, D7,
// D22, DP-05, T-S12). Every Hub is a fully synthetic acceptance hub (accept-helpers isolation; Office COM off); the q-v2 and synthetic-
// identity checks at the top are pure. Review items: R3/R8 (the exact q-v2 row), R5/R11 (revoke-all after the consent session ended),
// R6 (a dead phase plan → EXPIRED, continuable), R7 (owner profile hook, in-transaction basis check), R12 (supersede per preparation),
// R16 (q-v2 never scores an UNKNOWN reading), R17 (unique synthetic identities), R18 (only a confirmed root continues), R23 (a shutdown
// is not „Oprește tot”), C2 (no continuation while the Stop All holds the gate), C4 (an inference's basis exists and is about the same
// company), C5 (a STALE bound offer is never „ready for review”).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand, seedSalesReview } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { stopForShutdown } from "../server/owner/stop-scope.mjs";
import { qualify } from "../server/sales/qualify.mjs";
import { parseBrief } from "../server/sales/brief.mjs";
import { syntheticOrgFor } from "../server/sales/synthetic.mjs";
import { DOSSIER_KIND, PREPARE_KIND, prepareSteps, phaseALimits } from "../server/sales/preparation.mjs";

async function waiting(c, options = {}) {
  const t = await prepHub(c, options);
  await t.authenticate(options.devProfile ? { dev: true } : {});
  // An M04 synthetic company seeded first (seedSalesReview picks the first synthetic company it finds).
  const m04 = options.m04 ? await seedSalesReview(t) : null;
  const { card, preparationId } = await proposePreparation(t, options.text);
  await confirmCard(t, card);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  return { t, card, preparationId, prep: t.hub.salesPreparations.get(preparationId), m04 };
}
const devHub = async (c) => {
  const clock = { now: Date.now() };
  const t = await prepHub(c, { devProfile: () => ({ enabled: true, version: 1, id: "dev_m12integrity", ...machineIdentity() }), clock: () => new Date(clock.now) });
  await t.authenticate({ dev: true });
  return { t, clock };
};
/** Holds the fixture read of the research step until released (a step in flight). */
function holdResearch(t) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { called: false, release: () => release() };
  const original = t.hub.sales.fixturePage;
  t.hub.sales.fixturePage = async (...args) => { state.called = true; await gate; return original(...args); };
  return state;
}
const stopAll = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
async function rearmGate(t) {
  const card = await t.request("/api/owner/gate/rearm/card");
  assert.equal(card.status, 200, JSON.stringify(card.json));
  await t.authenticate({ reauth: true });
  const done = await t.request("/api/owner/gate/rearm", { body: { nonce: card.json.nonce, hash: card.json.hash, modality: "click" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
}
const phaseB = (t) => countRows(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE kind = ?", DOSSIER_KIND);
const lastStatusEvent = (t, id) => JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.preparation.status' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(id).payload_json);

test("M12-INT-01 (R16) q-v2 never scores an UNKNOWN reading: a field backed only by one is unproven, never „prezent” with that evidence", () => {
  const org = { displayName: "", fiscalCode: "", city: "", website: "", contacts: [{ kind: "phone", value: "+40 700 000 000" }] };
  const unknown = { id: "sev_u", claim: "phone", value: null, label: "UNKNOWN" };
  const r = qualify({ org, evidence: [unknown] }, { formula: "q-v2" });
  assert.equal(r.components.completeness.score, null, JSON.stringify(r.components.completeness));
  assert.ok(r.unproven.some((u) => u.component === "completeness"), "listed as unproven");
  assert.ok(!JSON.stringify(r.components).includes("sev_u"), "no point names the UNKNOWN reading");
  // Control: the same phone with a real (observed) reading scores, naming it.
  const seen = qualify({ org, evidence: [{ ...unknown, id: "sev_o", label: "OBSERVED" }] }, { formula: "q-v2" });
  assert.ok(seen.components.completeness.contributions.some((x) => x.points > 0 && x.evidenceIds.includes("sev_o")));
});

test("M12-INT-02 (R17) syntheticOrgFor draws again, deterministically, while an identity is taken; refuses when nothing is free", () => {
  const brief = parseBrief("pregătește o ofertă pentru un service auto din Cluj care vrea programări online");
  const first = syntheticOrgFor(brief, "opp_int02");
  const taken = (id) => id.domain === first.domain;
  const next = syntheticOrgFor(brief, "opp_int02", { taken });
  assert.notEqual(next.domain, first.domain);
  assert.notEqual(next.email, first.email);
  assert.equal(next.attempt, 1);
  assert.deepEqual(syntheticOrgFor(brief, "opp_int02", { taken }), next, "deterministic for the same root and the same taken set");
  assert.deepEqual(syntheticOrgFor(brief, "opp_int02"), first, "attempt 0 is the original draw (unchanged outputs)");
  assert.throws(() => syntheticOrgFor(brief, "opp_int02", { taken: () => true }), (e) => e.code === "SALES_SYNTHETIC_TAKEN");
});

test("M12-INT-03 (R17) a preparation never creates a company whose domain, fiscal code or e-mail another company already has", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const prep = t.hub.salesPreparations.get(preparationId);
  const clash = syntheticOrgFor(prep.brief, prep.rootPlanId);
  // An M04 company (synthetic import) that already has exactly the identity the plan would draw first.
  t.hub.db.prepare(`INSERT INTO sales_orgs (id, display_name, normalized_name, legal_form, fiscal_code, fiscal_code_valid, website, domain, domain_kind, city, county, address, caen, status, synthetic, created_at, updated_at)
    VALUES ('org_int03_m04', ?, 'x', 'SRL', ?, 1, ?, ?, 'organization_site', '', '', '', '', 'NEW', 1, ?, ?)`).run(clash.name, clash.fiscalCode, clash.website, clash.domain, new Date().toISOString(), new Date().toISOString());
  await confirmCard(t, card);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  const org = t.hub.sales.getOrg(t.hub.salesPreparations.get(preparationId).orgId);
  assert.notEqual(org.org.domain, clash.domain);
  assert.notEqual(org.org.fiscalCode, clash.fiscalCode);
  assert.notEqual(org.contacts[0].value, clash.email);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs WHERE domain = ?", clash.domain), 1, "never a second company with that domain");
  assert.throws(() => t.hub.sales.createPreparationOrg({ identity: clash, brief: prep.brief, preparationId, actor: "test" }), (e) => e.code === "SALES_SYNTHETIC_TAKEN");
});

test("M12-INT-04 (R3/R8) an M04 q-v1 recompute in between: the continuation qualifies again with q-v2; the offer and the dossier use that exact q-v2 row", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const q0 = t.hub.sales.latestQualification(prep.orgId);
  assert.equal(q0.formulaVersion, "q-v2");
  assert.deepEqual([t.hub.sales.latestProposal(prep.opportunityId).content.basis.qualificationId, t.hub.sales.latestProposal(prep.opportunityId).content.basis.qualificationInputsSha], [q0.id, q0.inputsSha]);
  await salesCommand(t, "sales.org.qualify", { orgId: prep.orgId }); // the M04 org-sheet „Recalculează” (q-v1 default)
  const q1 = t.hub.sales.latestQualification(prep.orgId);
  assert.equal(q1.formulaVersion, "q-v1");
  assert.equal(prepStatus(t, preparationId), "STALE", "a newer qualification row is an input change");
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  const again = await settlePreparation(t, preparationId);
  assert.equal(again.status, "WAITING_OWNER", again.statusReason);
  const q2 = t.hub.sales.latestQualification(prep.orgId);
  assert.equal(q2.formulaVersion, "q-v2", "q-v2 computed again under a new key");
  assert.notEqual(q2.id, q0.id);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.qualify'"), 2);
  const offer = t.hub.sales.latestProposal(prep.opportunityId);
  assert.equal(offer.content.basis.qualificationId, q2.id);
  assert.equal((await approveAwaited(t, again)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const d = t.hub.salesPreparations.forOpportunity(prep.opportunityId).dossiers[0];
  const q = JSON.parse(fs.readFileSync(path.join(d.folder, "calificare.json"), "utf8"));
  assert.deepEqual([q.qualificationId, q.formulaVersion], [q2.id, "q-v2"]);
  // A resume of the qualification step (its row is the latest, the inputs unchanged) writes nothing new.
  const ex = t.hub.executors["sales.qualify"];
  const plan = t.hub.opsPlans.view(out.plan.id);
  assert.deepEqual(await ex.reconcile({ planId: out.plan.id, stepId: "x", params: plan.steps.find((s) => s.kind === "sales.qualify").params, plan }).then((r) => [r.outcome, r.result.qualificationId]), ["done", q2.id]);
});

test("M12-INT-05 (R7) the owner profile is an input: saving it makes the waiting offer STALE at once; the approval re-verifies the basis inside its transaction", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await salesCommand(t, "sales.owner.save", { companyName: "Alt Nume (sintetic) SRL", signatureName: "Semnătura test" });
  const offer = t.hub.sales.latestProposal(prep.opportunityId);
  assert.equal(offer.status, "STALE");
  assert.equal(eventCount(t, "sales.proposal.stale"), 1);
  assert.equal(t.hub.sales.getOpportunity(prep.opportunityId).opportunity.status, "PROPOSAL_DRAFT");
  assert.equal(prepStatus(t, preparationId), "STALE");
  const r = await approveAwaited(t, prep);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error.code, "SALES_PROPOSAL_STALE");
  await assert.rejects(salesCommand(t, "sales.draft.create", { opportunityId: prep.opportunityId }), /aprobată intern/, "no M04 draft from it either");
});

test("M12-INT-05b (R7) a change that bypasses every hook (a direct settings write) still never gets a bound offer approved: the basis is re-verified in the approval's transaction", async (c) => {
  const second = await waiting(c);
  second.t.hub.bus.transaction(() => second.t.hub.settings.set("salesOwner", { companyName: "Schimbat fără cârlig", signatureName: "", materials: [] }, "test", "fără hook"));
  assert.equal(second.t.hub.sales.latestProposal(second.prep.opportunityId).status, "DRAFT", "no hook ran");
  const refused = await approveAwaited(second.t, second.prep);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, "SALES_PROPOSAL_STALE");
  assert.equal(second.t.hub.sales.latestProposal(second.prep.opportunityId).approvedSha, null);
  assert.equal(phaseB(second.t), 0);
});

test("M12-INT-06 (C5) a STALE preparation-bound offer can never be moved back to „ready for review”; an M04 offer can", async (c) => {
  const { t, prep, m04 } = await waiting(c, { m04: true });
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prep.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
  assert.equal(t.hub.sales.latestProposal(prep.opportunityId).status, "STALE");
  await assert.rejects(salesCommand(t, "sales.opportunity.transition", { opportunityId: prep.opportunityId, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire" }),
    (e) => e.code === "SALES_PROPOSAL_STALE" && /STALE/.test(e.message));
  assert.equal(t.hub.sales.getOpportunity(prep.opportunityId).opportunity.status, "PROPOSAL_DRAFT");
  assert.notEqual(m04.orgId, prep.orgId);
  await salesCommand(t, "sales.opportunity.transition", { opportunityId: m04.oppId, to: "ON_HOLD", reason: "Pauză" });
  await salesCommand(t, "sales.opportunity.transition", { opportunityId: m04.oppId, to: "PROPOSAL_DRAFT", reason: "Reluare" });
  await salesCommand(t, "sales.opportunity.transition", { opportunityId: m04.oppId, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire" });
  assert.equal(t.hub.sales.getOpportunity(m04.oppId).opportunity.status, "READY_FOR_OWNER_REVIEW", "the M04 path is unchanged");
});

test("M12-INT-07 (C4) an INFERENCE's basis exists and is about the same company: brief field, audit check and evidence row are checked", async (c) => {
  const { t, prep, m04: other } = await waiting(c, { m04: true });
  assert.notEqual(other.orgId, prep.orgId);
  const ownRow = t.hub.sales.getOrg(prep.orgId).evidence.find((e) => e.claim === "name").id;
  const foreignRow = t.hub.sales.getOrg(other.orgId).evidence[0].id;
  const add = (orgId, basis) => salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: orgId, claim: "angajati", value: { employees: 40 }, label: "INFERRED", sourceKind: "manual",
    sourceRef: "rule:test", dataKind: "INFERENCE", basis, reasoning: "dedus pentru test" });
  const before = countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence");
  for (const [orgId, basis, pattern] of [
    [prep.orgId, ["brief:spp_doesnotexist#nimic"], /nu există/],
    [prep.orgId, [`brief:${prep.id}#nimic`], /nu are câmpul nimic/],
    [other.orgId, [`brief:${prep.id}#place`], /nu e despre această firmă/],
    [prep.orgId, [foreignRow], /nu e despre această firmă/],
    [other.orgId, [ownRow], /nu e despre această firmă/],
  ]) await assert.rejects(add(orgId, basis), pattern, JSON.stringify(basis));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence"), before, "nothing written");
  // Real bases of the same company are accepted (the brief's own field, the request itself, an evidence row of the company).
  for (const basis of [[`brief:${prep.id}#place`], [`brief:${prep.id}#request`], [ownRow]]) assert.ok((await add(prep.orgId, basis)).result.id);
});

test("M12-INT-08 (R5/R11) „Închide toate sesiunile” after the consent session ended (logout): the waiting preparation stops at once; an approval in a new session continues nothing", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const s1 = prep.consent.sessionId;
  assert.equal((await t.request("/api/owner/logout")).status, 200);
  assert.equal(t.hub.trust.confirmedAuthority(s1).ok, true, "a logout alone keeps the confirmation's authority (DP-05)");
  assert.equal((await t.request("/api/owner/sessions/revoke-all", { sessionCookie: "" })).status, 200);
  assert.deepEqual(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'owner.sessions_revoked'").all().map((r) => JSON.parse(r.payload_json).count), [0]);
  const held = t.hub.trust.confirmedAuthority(s1);
  assert.equal(held.ok, false, "revoke-all ends it, also for a session that had already ended");
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /revocată/);
  await t.authenticate({ reauth: true });
  const s2 = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
  assert.equal(t.hub.trust.confirmedAuthority(s2).ok, true, "a session opened after the revocation has its own authority");
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "STOPPED", done.statusReason);
  assert.equal(phaseB(t), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), 0);
});

test("M12-INT-09 (R5/R11) revoke-all after the consent session idled while the research step runs: the plan stops before its effect (NEEDS_OWNER), nothing recorded", async (c) => {
  let now = Date.now();
  const t = await prepHub(c, { clock: () => new Date(now) });
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 200);
  for (let i = 0; i < 200 && !hold.called; i += 1) await settle();
  assert.ok(hold.called);
  const s1 = t.hub.opsPlans.view(card.id).consent.sessionId;
  now += 31 * 60000;
  await t.request("/api/owner/status", { method: "GET" }); // the page resolves its old cookie: S1 ends as idle
  assert.equal(t.hub.db.prepare("SELECT revoke_reason FROM owner_sessions WHERE id = ?").get(s1).revoke_reason, "idle");
  assert.equal(t.hub.trust.confirmedAuthority(s1).ok, true);
  assert.equal((await t.request("/api/owner/sessions/revoke-all", { sessionCookie: "" })).status, 200);
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  const plan = t.hub.opsPlans.view(card.id);
  assert.equal(plan.status, "NEEDS_OWNER", plan.statusReason);
  assert.match(plan.steps.find((s) => s.kind === "sales.research").error, /SESSION_CLOSED/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence WHERE claim = 'research:site'"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_proposals"), 0);
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "PREPARING");
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /^Planul pregătirii ofertei e oprit \(.*revocată.*„Continuă”/, "a truthful reason (R23)");
});

test("M12-INT-10 (R6) phase A paused and its window passes: EXPIRED (event, reason), the dead plan closed; ONE continuation card resumes it from the ledger", async (c) => {
  const { t, clock } = await devHub(c);
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 200);
  for (let i = 0; i < 200 && !hold.called; i += 1) await settle();
  t.hub.opsPlans.pause(card.id, { reason: "Pauză", actor: "owner" });
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED");
  await settle(); await settle();
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /^Planul pregătirii ofertei e oprit \(Pauză/, "the reason says the plan is paused and how it resumes");
  await t.hub.salesPreparations.tick();
  assert.equal(prepStatus(t, preparationId), "PREPARING", "within its window the plan can still be resumed");
  clock.now += 5 * 3600000;
  await t.authenticate({ dev: true });
  await t.hub.salesPreparations.tick();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "EXPIRED");
  assert.match(p.statusReason, /Fereastra planului.*a trecut cât era oprit.*o continuare/);
  assert.equal(lastStatusEvent(t, preparationId).to, "EXPIRED");
  assert.equal(t.hub.opsPlans.view(card.id).status, "CANCELLED", "the dead plan is closed");
  assert.equal(t.hub.salesPreparations.isContinuable(p), true);
  const events = countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type LIKE 'sales.%'");
  await t.hub.salesPreparations.tick();
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type LIKE 'sales.%'"), events, "a tick that changes nothing writes nothing");
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  const again = await settlePreparation(t, preparationId);
  assert.equal(again.status, "WAITING_OWNER", again.statusReason);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 1, "the same synthetic company (ledger)");
  assert.equal(eventCount(t, "sales.synthetic.created"), 1);
});

test("M12-INT-11 (R6) phase B paused after the draft and its window passes: EXPIRED, never stranded in PACKAGING; a continuation finishes it", async (c) => {
  const { t, clock } = await devHub(c);
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  let paused = null;
  const off = t.hub.bus.subscribe((e) => {
    if (e.type !== "ops.step.done" || paused) return;
    const pl = t.hub.opsPlans.view(e.scopeId);
    if (pl?.kind === DOSSIER_KIND && e.payload?.seq === 1) { paused = pl.id; t.hub.opsPlans.pause(pl.id, { reason: "Pauză", actor: "owner" }); }
  });
  assert.equal((await approveAwaited(t, prep)).status, 200);
  await settlePreparation(t, preparationId);
  off();
  assert.equal(prepStatus(t, preparationId), "PACKAGING");
  assert.equal(t.hub.opsPlans.view(paused).status, "PAUSED");
  clock.now += 3 * 3600000;
  await t.authenticate({ dev: true });
  await t.hub.salesPreparations.tick();
  assert.equal(prepStatus(t, preparationId), "EXPIRED");
  assert.equal(t.hub.opsPlans.view(paused).status, "CANCELLED");
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts"), 1, "the draft is reused, not duplicated");
});

test("M12-INT-12 (R12) a Sales card supersedes only the older card of the SAME preparation: card B survives a continuation of A and a new card C", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const A = await proposePreparation(t);
  await confirmCard(t, A.card);
  const prepA = t.hub.salesPreparations.get(A.preparationId);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prepA.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
  assert.equal(prepStatus(t, A.preparationId), "STALE");
  const B = await proposePreparation(t, "pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online");
  const first = (await salesCommand(t, "sales.preparation.continue", { preparationId: A.preparationId })).result;
  await proposePreparation(t, "pregătește o ofertă pentru o florărie din Sibiu care vrea un magazin online");
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(t.hub.opsPlans.view(B.card.id).status, "PROPOSED", t.hub.opsPlans.view(B.card.id).statusReason);
  assert.equal(prepStatus(t, B.preparationId), "PLANNED");
  // A second continuation card of A replaces A's first one only.
  const second = (await salesCommand(t, "sales.preparation.continue", { preparationId: A.preparationId })).result;
  assert.equal(t.hub.opsPlans.view(first.plan.id).status, "SUPERSEDED");
  assert.equal(t.hub.opsPlans.view(second.plan.id).status, "PROPOSED");
  assert.equal(t.hub.opsPlans.view(B.card.id).status, "PROPOSED");
  await confirmCard(t, B.card);
  assert.equal(prepStatus(t, B.preparationId), "WAITING_OWNER", "B's card is still the owner's to confirm");
});

test("M12-INT-13 (R18) a card that expired unconfirmed is not continuable: no continuation card, nothing consumed", async (c) => {
  let now = Date.now();
  const t = await prepHub(c, { clock: () => new Date(now) });
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  now += 16 * 60000;
  await t.authenticate({ reauth: true });
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 409);
  for (let i = 0; i < 3; i += 1) await settle();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "EXPIRED");
  assert.equal(t.hub.salesPreparations.isContinuable(p), false);
  const plans = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  await assert.rejects(salesCommand(t, "sales.preparation.continue", { preparationId }), (e) => e.code === "SALES_PREPARATION_STATE" && /nu a fost confirmat niciodată/.test(e.message));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans, "no card proposed");
  // A continuation card forged directly on the engine still never passes its first step.
  const forged = await t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Continuare", steps: prepareSteps({ preparationId, briefSha: p.briefSha, continues: { rootPlanId: p.rootPlanId, rootPlanHash: p.rootPlanHash } }),
    limits: phaseALimits(), actor: "test", via: "test" });
  await confirmCard(t, { ...forged, preparationId });
  assert.match(t.hub.opsPlans.view(forged.id).steps[0].error, /nu a fost confirmat niciodată/);
  assert.equal(prepStatus(t, preparationId), "EXPIRED");
});

test("M12-INT-14 (R23) a Hub shutdown's stop (stopKind shutdown) is not „Oprește tot”: the waiting preparation keeps waiting and the owner's approval continues it", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const out = await stopForShutdown({ runs: { activeCount: () => 1, stopAll: t.hub.runs.stopAll }, opsPlans: t.hub.opsPlans }, "test");
  assert.equal(out.stopped, true);
  assert.equal(JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'system.stop_all' ORDER BY seq DESC LIMIT 1").get().payload_json).stopKind, "shutdown");
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER", "no false „Oprește tot” reason");
  assert.equal(t.hub.salesPreparations.stoppedSince(prep.consent.confirmedAt, prep.consent.planId), null);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
});

test("M12-INT-14b (R23) the owner's own „Oprește tot” still stops a waiting preparation, with that reason and the stop recorded", async (c) => {
  const other = await waiting(c);
  await stopAll(other.t);
  await settle(); await settle();
  assert.equal(prepStatus(other.t, other.preparationId), "STOPPED");
  assert.match(other.t.hub.salesPreparations.get(other.preparationId).statusReason, /Oprește tot/);
  assert.equal(lastStatusEvent(other.t, other.preparationId).stop.kind, "stop_all");
});

test("M12-INT-15 (C2) a continuation forged while the Stop All still holds the gate waits for the owner (no effect); after the rearm „Continuă” runs it", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await stopAll(t);
  await settle(); await settle();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "STOPPED");
  assert.ok(t.hub.salesPreparations.stopHold(p));
  const forged = await t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Continuare", steps: prepareSteps({ preparationId, briefSha: p.briefSha, continues: { rootPlanId: p.rootPlanId, rootPlanHash: p.rootPlanHash } }),
    limits: phaseALimits(), actor: "test", via: "test" });
  const rows = countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops");
  await confirmCard(t, { ...forged, preparationId });
  const held = t.hub.opsPlans.view(forged.id);
  assert.equal(held.status, "NEEDS_OWNER", held.statusReason);
  assert.match(held.steps[0].error, /^STOPPED: .*Redeschide poarta/);
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops"), rows, "nothing written");
  await rearmGate(t);
  assert.equal(t.hub.salesPreparations.stopHold(t.hub.salesPreparations.get(preparationId)), null);
  const sessionId = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
  await t.hub.opsPlans.resume(forged.id, { session: { id: sessionId } });
  await t.hub.opsPlans.idle(forged.id);
  const again = await settlePreparation(t, preparationId);
  assert.equal(again.status, "WAITING_OWNER", again.statusReason);
  assert.equal(again.planId, forged.id);
  assert.equal(prep.rootPlanId, again.rootPlanId);
});
