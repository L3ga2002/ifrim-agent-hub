// M12 WP7 — the Sales preparation, phase A (SPEC §5; owner clarification 2; C-01, S-02, S-03, S-08, T-S1, T-S3, T-S9). Every Hub here is
// a fully synthetic acceptance hub (accept-helpers: own root, write fence, port ≠ 8011, Office COM off). ONE owner confirmation of ONE
// card runs: the synthetic client → fixture research (a generated .test host has no fixture page → one UNKNOWN row) → q-v2 → the offer
// up to READY_FOR_OWNER_REVIEW; then the preparation waits for the owner's own approval (approved_sha stays NULL). No model, no send,
// no hand-off, no mission, no catalog change; every operation goes through the C-01 ledger (one row, one event, the same id).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, prepStatus, countRows, eventCount } from "./sales-helpers.mjs";
import { opKeyOf } from "../server/sales/plan-ledger.mjs";
import { OPERATIONS } from "../server/policy/action-policy.mjs";
import { PREPARE_KIND, DOSSIER_KIND, PREPARATION_PHASE_B_OPS, prepareSteps } from "../server/sales/preparation.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { createHub } from "../server/hub.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const salesRows = (t) => Object.fromEntries(["sales_orgs", "sales_opportunities", "sales_proposals", "sales_evidence", "sales_qualifications", "sales_drafts", "sales_audits"]
  .map((table) => [table, countRows(t, `SELECT COUNT(*) AS n FROM ${table}`)]));
const stepCtx = (t, card, kind, extra = {}) => {
  const plan = t.hub.opsPlans.view(card.id);
  return { planId: card.id, stepId: `ops_${kind}`, params: plan.steps.find((s) => s.kind === kind).params, authorize: () => ({}), abort: { aborted: false }, plan, ...extra };
};

test("M12-PREP-01 one confirmation → WAITING_OWNER with no other question; the offer is NOT approved; no model, send, hand-off, mission or catalog change", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const services = countRows(t, "SELECT COUNT(*) AS n FROM sales_services");
  const before = salesRows(t);
  const { card, preparationId, result } = await proposePreparation(t);
  // The card: the four steps, „fără model”, nothing leaves the computer, the offer's approval left to the owner, what never happens.
  assert.equal(card.kind, PREPARE_KIND);
  assert.equal(card.summary.steps.length, 4);
  assert.equal(card.summary.model, "fără model");
  assert.equal(card.summary.confirmations, 1);
  assert.deepEqual(card.summary.transmitted, ["nimic nu pleacă din calculator"]);
  assert.match(card.decisionsLeft.join(" "), /aprobarea internă a ofertei exacte.*rămâne decizia ta/i);
  for (const w of ["trimiterea ofertei sau a mesajului", "contactarea firmei", "publicare", "cheltuieli"]) assert.ok(card.never.includes(w), w);
  assert.ok(card.never.some((x) => /Fabrica/.test(x)));
  assert.equal(card.then.stepTitles.length, 2, "the derived draft + dossier steps are hashed in the same card");
  assert.match(card.then.bodySha, /^[0-9a-f]{64}$/);
  assert.match(result.note, /fără model/);
  assert.equal(card.brief.fields.problem.provenance, "USER_PROVIDED");
  assert.equal(prepStatus(t, preparationId), "PLANNED");
  assert.deepEqual(salesRows(t), before, "nothing runs before the confirmation");
  await confirmCard(t, card);
  const plan = t.hub.opsPlans.view(card.id);
  assert.equal(plan.status, "DONE", plan.statusReason);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal(prep.status, "WAITING_OWNER", prep.statusReason);
  assert.match(prep.awaited.proposalSha, /^[0-9a-f]{64}$/);
  assert.equal(prep.consent.planId, card.id);
  assert.equal(prep.consent.authority, "webauthn");
  const view = t.hub.sales.getOpportunity(prep.opportunityId);
  assert.equal(view.opportunity.status, "READY_FOR_OWNER_REVIEW");
  assert.equal(view.opportunity.synthetic, true);
  assert.equal(view.org.synthetic, true);
  assert.match(view.org.domain, /\.test$/);
  assert.match(view.org.fiscalCode, /^99\d{8}$/);
  assert.deepEqual([view.org.city, view.org.county, view.org.caen], ["", "", ""], "inferred values never become record fields");
  const proposal = view.proposals[0];
  assert.equal(proposal.id, prep.awaited.proposalId);
  assert.equal(proposal.status, "DRAFT");
  assert.equal(proposal.approvedSha, null, "confirming the plan never approves the offer");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_proposals WHERE approved_sha IS NOT NULL"), 0);
  assert.ok(proposal.content.basis && typeof proposal.content.basis === "object", "preparation-bound offer");
  assert.ok(proposal.content.sections.some((s) => s.id === "request"), "„Ce s-a cerut” from the brief");
  assert.ok(proposal.content.pricing.every((p) => p.status === "UNKNOWN" && p.reason === "catalog neconfigurat"));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "no model");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_handoffs"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM missions"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts"), 0, "no draft before the owner's approval");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_services"), services, "the catalog is untouched");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no approval was requested or decided by the plan");
  // S-03 / D10: the generated .test host has no fixture page → ONE UNKNOWN row (FIXTURE kind), never an invented fact.
  const research = t.hub.sales.getOrg(prep.orgId).evidence.filter((e) => e.claim === "research:site");
  assert.equal(research.length, 1);
  assert.deepEqual([research[0].label, research[0].dataKind, research[0].excerpt], ["UNKNOWN", "FIXTURE", "neverificat: nu există pagina fixture"]);
  // The provenance kinds of what A1 wrote: FIXTURE identity, STATEMENT for what the owner said, INFERENCE for what the brief deduced.
  const ev = t.hub.sales.getOrg(prep.orgId).evidence;
  for (const claim of ["name", "fiscalCode", "website", "email"]) assert.equal(ev.find((e) => e.claim === claim)?.dataKind, "FIXTURE", claim);
  assert.equal(ev.find((e) => e.claim === "brief:problem")?.dataKind, "STATEMENT");
  assert.equal(ev.find((e) => e.claim === "brief:city")?.dataKind, "INFERENCE");
  // The q-v2 qualification of the synthetic company: every point names its evidence; the brief's inferences are listed, never scored.
  const q = t.hub.sales.getOrg(prep.orgId).qualification;
  assert.equal(q.formulaVersion, "q-v2");
  assert.ok(q.result.inferences.length >= 1);
  for (const comp of Object.values(q.result.components)) for (const x of comp.contributions) if (x.points > 0) assert.ok(x.evidenceIds.length, x.factor);
  // One ledger row per operation, all DONE, all keyed by the confirmed root plan.
  const ops = t.hub.salesLedger.ofRoot(card.id);
  assert.deepEqual(ops.map((o) => o.op), ["sales.synthetic", "sales.research", "sales.qualify", "sales.proposal.draft"]);
  assert.ok(ops.every((o) => o.status === "DONE" && o.rootPlanHash === plan.hash));
  t.assertPaths();
});

test("M12-PREP-02 C-01 (T-S1, T-S9): Promise.all of the same operation → one row, one event, the same id; a key with other params → IDEMPOTENCY_CONFLICT", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const ex = t.hub.executors;
  // The synchronous operation (synthetic client): two concurrent runs of the same step of the same plan.
  const [a, b] = await Promise.all([ex["sales.synthetic"].run(stepCtx(t, card, "sales.synthetic")), ex["sales.synthetic"].run(stepCtx(t, card, "sales.synthetic"))]);
  assert.equal(a.result.orgId, b.result.orgId);
  assert.equal(a.result.opportunityId, b.result.opportunityId);
  assert.deepEqual([a.result.duplicate, b.result.duplicate].sort(), [false, true]);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities"), 1);
  assert.equal(eventCount(t, "sales.synthetic.created"), 1);
  assert.equal(eventCount(t, "sales.opportunity.created"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.synthetic'"), 1);
  assert.equal(prepStatus(t, preparationId), "PREPARING");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'sales.preparation.status' AND json_extract(payload_json, '$.to') = 'PREPARING'"), 1, "one status event");
  // The asynchronous operation (fixture research): the second caller waits for the first and gets the same rows.
  const [r1, r2] = await Promise.all([ex["sales.research"].run(stepCtx(t, card, "sales.research")), ex["sales.research"].run(stepCtx(t, card, "sales.research"))]);
  assert.deepEqual(r1.result.evidenceIds, r2.result.evidenceIds);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence WHERE claim = 'research:site'"), 1);
  assert.equal(eventCount(t, "sales.research.recorded"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.research' AND status = 'DONE'"), 1);
  // The same key with other recorded parameters is refused; the key needs the confirmed plan's id AND hash, normalised parameters.
  const prep = t.hub.salesPreparations.get(preparationId);
  const root = t.hub.salesPreparations.rootOf(prep);
  t.hub.salesLedger.runSync({ root, op: "test.op", keyParams: { k: 1 }, params: { inputs: "a" }, effect: () => ({ ok: true }) });
  assert.throws(() => t.hub.salesLedger.runSync({ root, op: "test.op", keyParams: { k: 1 }, params: { inputs: "b" }, effect: () => ({ ok: true }) }), (e) => e.code === "IDEMPOTENCY_CONFLICT");
  const hash = "c".repeat(64);
  assert.notEqual(opKeyOf({ planId: "opp_a_1", planHash: hash }, "sales.synthetic", { x: 1 }), opKeyOf({ planId: "opp_b_1", planHash: hash }, "sales.synthetic", { x: 1 }), "two plans with the same text are never unified");
  assert.equal(opKeyOf(root, "sales.research", { host: " Firma.TEST ", note: "a  b" }), opKeyOf(root, "sales.research", { note: "a b", host: "firma.test" }), "normalised parameters");
  assert.throws(() => opKeyOf({ planId: "spp_x", planHash: hash }, "op", {}), (e) => e.code === "LEDGER_ROOT");
});

test("M12-PREP-03 two confirmed plans with the same text → two preparations, two synthetic companies (nothing unified)", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const one = await proposePreparation(t);
  await confirmCard(t, one.card);
  const two = await proposePreparation(t);
  await confirmCard(t, two.card);
  const p1 = t.hub.salesPreparations.get(one.preparationId);
  const p2 = t.hub.salesPreparations.get(two.preparationId);
  assert.deepEqual([p1.status, p2.status], ["WAITING_OWNER", "WAITING_OWNER"]);
  assert.notEqual(p1.rootPlanId, p2.rootPlanId);
  assert.equal(p1.briefSha, p2.briefSha, "the same brief");
  assert.notEqual(p1.orgId, p2.orgId);
  assert.notEqual(t.hub.sales.getOrg(p1.orgId).org.domain, t.hub.sales.getOrg(p2.orgId).org.domain, "the seed is the confirmed plan");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 2);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops"), 8);
  assert.equal(t.hub.salesLedger.ofRoot(p1.rootPlanId).length, 4);
  assert.equal(t.hub.salesLedger.ofRoot(p2.rootPlanId).length, 4);
});

test("M12-PREP-04 a crash with the research claimed (IN_PROGRESS) → boot waits for the owner; „Continuă” reconciles from the ledger and the effect happens once", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  let release;
  const hang = new Promise((r) => { release = r; });
  const original = t.hub.sales.fixturePage;
  t.hub.sales.fixturePage = async (...args) => { await hang; return original(...args); };
  const confirm = t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } });
  assert.equal((await confirm).status, 200);
  for (let i = 0; i < 200 && countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.research' AND status = 'IN_PROGRESS'") === 0; i += 1) await settle();
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.research' AND status = 'IN_PROGRESS'"), 1, "the research is claimed, its effect not yet written");
  const sessionId = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
  // The process ends mid-step (the page was never returned).
  await t.hub.close();
  const again = createHub(t.config, { homeDir: t.homeDir });
  try {
    await again.boot();
    await settle();
    const plan = again.opsPlans.view(card.id);
    assert.equal(plan.status, "NEEDS_OWNER", "never resumed by the boot");
    assert.equal(plan.steps.find((s) => s.kind === "sales.research").status, "UNCERTAIN");
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM sales_evidence WHERE claim = 'research:site'").get().n, 0);
    // The owner's „Continuă” (same session): reconcile reads the ledger (IN_PROGRESS, no effect) → retry → one effect.
    const resumed = await again.commands.dispatch({ type: "ops.plan.resume", payload: { planId: card.id }, channel: "owner", actor: `owner:${sessionId}`, ownerSession: { id: sessionId } });
    assert.ok(resumed.result);
    await again.opsPlans.idle(card.id);
    assert.equal(again.opsPlans.view(card.id).status, "DONE", again.opsPlans.view(card.id).statusReason);
    assert.equal(again.salesPreparations.get(preparationId).status, "WAITING_OWNER");
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM sales_evidence WHERE claim = 'research:site'").get().n, 1, "the effect happened once");
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sales.research.recorded'").get().n, 1);
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op = 'sales.research'").get().n, 1);
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n, 1, "no duplicate company");
  } finally { release(); await again.close(); }
});

test("M12-PREP-05 the plan refuses decisions, live collection and sending: PLAN_REFUSED / PLAN_DERIVED_OP / LIVE_COLLECTION_DISABLED; refused words never become a step; no model", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  // The owner's decisions, the hand-off, sending and deletion are not operations: a step that names one refuses the whole plan.
  for (const op of ["sales.proposal.approve", "sales.qualification.override", "approval.owner_decide", "sales.handoff.create", "sales.draft.send", "send", "delete.external", "data.delete"]) {
    assert.equal(Object.hasOwn(OPERATIONS, op) && OPERATIONS[op] !== "REFUSED", false, op);
    t.hub.executors["test.decision"] = { describe: () => ({ title: `Decizie ${op}`, params: {}, ops: [{ op }], observed: [], transmitted: [], outputs: [] }), run: async () => ({ result: {} }) };
    await assert.rejects(t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Plan cu o decizie", steps: [{ kind: "test.decision", params: {} }] }), (e) => e.code === "PLAN_REFUSED", op);
  }
  for (const op of ["sales.proposal.approve", "sales.qualification.override", "send", "publish", "data.delete", "model.run"]) assert.equal(PREPARATION_PHASE_B_OPS.includes(op), false, op);
  // The derived phase B can hold only its own operations.
  t.hub.executors["test.outside"] = { describe: () => ({ title: "Randare", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }), run: async () => ({ result: {} }) };
  const body = await t.hub.opsPlans.buildBody({ kind: DOSSIER_KIND, title: "x", steps: [{ kind: "test.outside", params: {} }], limits: {} });
  const sessionId = t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' LIMIT 1").get().id;
  await assert.rejects(t.hub.opsPlans.adoptDerived({ kind: DOSSIER_KIND, title: "x", steps: [{ kind: "test.outside", params: {} }], parent: { kind: PREPARE_KIND, id: "opp_none", hash: "h", confirmedAt: new Date().toISOString() },
    expectedBodySha: hashCanonical(body), sessionId }), (e) => e.code === "PLAN_DERIVED_OP");
  // Live collection: refused when the card is built (describe) and again by the step itself.
  const steps = prepareSteps({ preparationId: "spp_live_1", briefSha: "d".repeat(64) }).map((s) => (s.kind === "sales.research" ? { ...s, params: { ...s.params, mode: "live" } } : s));
  await assert.rejects(t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Cercetare live", steps }), (e) => e.code === "LIVE_COLLECTION_DISABLED");
  await assert.rejects(t.hub.executors["sales.research"].run({ planId: "opp_x", stepId: "s", params: { preparationId: "spp_live_1", mode: "live" }, authorize: () => ({}), abort: { aborted: false } }),
    (e) => e.code === "LIVE_COLLECTION_DISABLED");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0, "nothing proposed");
  // Sending words in the owner's sentence are refused (OUTREACH_DISABLED) and never become a step; the plan is model-free.
  const { card } = await proposePreparation(t, "pregătește o ofertă pentru o florărie din Iași și trimite-o pe email");
  assert.deepEqual(t.hub.opsPlans.view(card.id).body.steps.map((s) => s.kind), ["sales.synthetic", "sales.research", "sales.qualify", "sales.proposal.draft"]);
  assert.ok(card.brief.refused.length >= 1);
  assert.equal(t.hub.opsPlans.view(card.id).body.model, null);
  assert.equal(card.summary.model, "fără model");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
});

test("M12-PREP-06 a boot and the ticks that change nothing write nothing (M04-H): no sales.% event, no status change", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  await settle();
  const salesEvents = () => countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type LIKE 'sales.%'");
  const before = salesEvents();
  await t.hub.salesPreparations.tick();
  await t.hub.salesPreparations.tick();
  assert.equal(salesEvents(), before);
  await t.hub.close();
  const again = createHub(t.config, { homeDir: t.homeDir });
  try {
    await again.boot();
    for (let i = 0; i < 4; i += 1) await settle();
    await again.salesPreparations.tick();
    assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'sales.%'").get().n, before, "a restart writes no sales event");
    assert.equal(again.salesPreparations.get(preparationId).status, "WAITING_OWNER");
  } finally { await again.close(); }
});

test("M12-PREP-07 static: the preparation, its steps, the dossier and the planner never import or call an owner decision, sending, the hand-off, the Factory, missions, an import rollback or a merge", () => {
  const files = ["../server/sales/plan-executors.mjs", "../server/sales/preparation.mjs", "../server/sales/dossier.mjs", "../server/sales/plan-ledger.mjs", "../server/owner/planners/sales.mjs"];
  const code = (file) => fs.readFileSync(path.join(here, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  const forbidden = [/\bapproveProposal\b/, /\boverrideQualification\b/, /\bsendDraft\b/, /\bbuildHandoffPackage\b/, /\brecordHandoff\b/, /\bcurrentHandoff\b/, /\bcreateMission\b/, /\bfactory\b/i,
    /\bmissions\b/, /\brollback\b/i, /\brevertMerge\b/, /\bmergeOrgs\b/, /\bliftSuppression\b/, /\bsaveService\b/, /\bapproveDraftContent\b/, /\brecordContactEvent\b/, /\brecordClientAcceptance\b/,
    /commands\.(dispatch|executeApproved)/, /\bapprovals\.(decide|decideByOwner|decideByEnvelope)\b/,
    /["'`](?:approval\.(?:owner_)?decide|sales\.proposal\.approve|sales\.qualification\.override|sales\.handoff\.create|sales\.draft\.send|sales\.import\.rollback|sales\.merge\.revert|sales\.org\.merge|sales\.suppression\.lift|sales\.service\.save|factory\.[a-z_.]+|mission\.[a-z_.]+)["'`]/,
    /from\s+["'][^"']*(?:factory|handoff|missions)[^"']*["']/];
  for (const file of files) {
    const text = code(file);
    for (const re of forbidden) assert.equal(re.test(text), false, `${file}: ${re}`);
  }
});

test("M12-PREP-08 a step acts only for the preparation bound to ITS plan (SALES_NOT_BOUND); a continuation needs the same root and a stopped preparation", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const ex = t.hub.executors;
  const run = (kind, extra) => ex[kind].run({ ...stepCtx(t, card, kind), ...extra });
  await assert.rejects(run("sales.qualify", { planId: "opp_not_this_plan" }), (e) => e.code === "SALES_NOT_BOUND");
  await assert.rejects(ex["sales.draft"].run({ planId: card.id, stepId: "s", params: { preparationId }, authorize: () => ({}), abort: { aborted: false } }), (e) => e.code === "SALES_NOT_BOUND", "phase A's plan is not phase B's");
  await assert.rejects(ex["sales.dossier"].run({ planId: card.id, stepId: "s", params: { preparationId }, authorize: () => ({}), abort: { aborted: false } }), (e) => e.code === "SALES_NOT_BOUND");
  // Step 1 of another sales.prepare plan: bound only as a continuation of THIS root, and only while the preparation is stopped.
  const plan = t.hub.opsPlans.view(card.id);
  const other = { ...plan, id: "opp_other_plan_1", steps: plan.steps.map((s, i) => (i === 0 ? { ...s, params: { ...s.params, continues: { rootPlanId: "opp_another_root", rootPlanHash: plan.hash } } } : s)) };
  await assert.rejects(run("sales.synthetic", { planId: other.id, plan: other }), (e) => e.code === "SALES_NOT_BOUND");
  const cont = { ...other, steps: other.steps.map((s, i) => (i === 0 ? { ...s, params: { ...s.params, continues: { rootPlanId: plan.id, rootPlanHash: plan.hash } } } : s)) };
  await assert.rejects(run("sales.synthetic", { planId: cont.id, plan: cont }), (e) => e.code === "SALES_PREPARATION_STATE", "WAITING_OWNER is not continuable");
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 1);
});
