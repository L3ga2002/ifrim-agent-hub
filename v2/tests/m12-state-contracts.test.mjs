// M12 WP11 — T-S11 / C-05: the state contracts of the Sales objects the M12 flow sets or touches (opportunity, offer, preparation,
// „Dosarul ofertei”, the C-01 ledger, the contact draft), one table exported as data (v2/server/sales/state-contracts.mjs) and checked
// against the code: the status sets and transition maps, the event every observed transition emits, the refusals of the preconditions,
// what a state never implies (S-08: an approved offer, a finished plan or a ready dossier is never sent / CONTACTED / WON), and the
// structural rule that only the existing M04 writer lines set CONTACTED or WON. Hub-booting cases are fully synthetic acceptance hubs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_CONTRACTS, CONTACTED_WON_WRITERS, PROPOSAL_STATUSES, NEVER_IMPLIED, stateContractRows } from "../server/sales/state-contracts.mjs";
import { OPPORTUNITY_TRANSITIONS, PREPARATION_STATUSES, DOSSIER_STATUSES, PLAN_OP_STATUSES } from "../server/sales/sales.mjs";
import { PREPARATION_TRANSITIONS } from "../server/sales/preparation.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows, eventCount, salesAcceptanceHub, seedSalesReview } from "./sales-helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "server");
/** Every server module (recursively) with its text; comments are kept out of the structural checks. */
function serverFiles(dir = SERVER) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? serverFiles(path.join(dir, e.name)) : e.name.endsWith(".mjs") ? [path.join(dir, e.name)] : []));
}
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
const pairs = (rows) => new Set(rows.map((t) => `${t.from}→${t.to}`));
const mapPairs = (map) => new Set(Object.entries(map).flatMap(([from, tos]) => tos.map((to) => `${from}→${to}`)));

test("M12-SC-01 the table is the code's: status sets, transition maps, the events it names exist, every row says who sets it and what it does not imply", () => {
  const { opportunity, proposal, preparation, dossier, ledger } = STATE_CONTRACTS;
  // Opportunity: the statuses and the manual moves are exactly OPPORTUNITY_TRANSITIONS; the event-only states have their own writers.
  assert.deepEqual([...opportunity.statuses].sort(), Object.keys(OPPORTUNITY_TRANSITIONS).sort());
  assert.deepEqual(pairs(opportunity.transitions.filter((t) => t.kind === "manual")), mapPairs(OPPORTUNITY_TRANSITIONS));
  for (const s of opportunity.eventOnly) {
    const rows = opportunity.transitions.filter((t) => t.to === s);
    assert.ok(rows.length && rows.every((t) => t.kind === "event_only"), `${s} is reached only by its own event`);
  }
  // Preparation: the statuses are the schema's CHECK list; the transitions are exactly PREPARATION_TRANSITIONS (plus the planner's creation).
  assert.deepEqual([...preparation.statuses].sort(), [...PREPARATION_STATUSES].sort());
  assert.deepEqual(pairs(preparation.transitions.filter((t) => t.from !== null)), mapPairs(PREPARATION_TRANSITIONS));
  assert.deepEqual([...dossier.statuses].sort(), [...DOSSIER_STATUSES].sort());
  assert.deepEqual([...ledger.statuses].sort(), [...PLAN_OP_STATUSES].sort());
  // Offer rows: the table's statuses are exactly the literals the code writes into sales_proposals.status.
  const code = serverFiles().map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
  const written = new Set([...code.matchAll(/UPDATE sales_proposals SET status ?= ?'([A-Z_]+)'/g)].map((m) => m[1]));
  for (const m of code.matchAll(/INSERT INTO sales_proposals \([^)]*\) VALUES \([^)]*'([A-Z_]+)'/g)) written.add(m[1]);
  assert.deepEqual([...written].sort(), [...PROPOSAL_STATUSES].sort());
  assert.deepEqual([...proposal.statuses].sort(), [...PROPOSAL_STATUSES].sort());
  // Every status of every object is reached by a declared transition; every row names its writer, and every Sales event it names exists.
  for (const c of Object.values(STATE_CONTRACTS)) {
    for (const s of c.statuses) if (!(c.m12Writes && !c.m12Writes.includes(s))) assert.ok(c.transitions.some((t) => t.to === s), `${c.object}: ${s} has a writer`);
  }
  const rows = stateContractRows();
  assert.ok(rows.length >= 60, `${rows.length} rows`);
  for (const r of rows) {
    assert.ok(r.setBy.length > 10, `${r.object} ${r.from}→${r.to} names who sets it`);
    assert.ok(Array.isArray(r.preconditions) && Array.isArray(r.invalidates) && Array.isArray(r.doesNotImply));
    if (r.event && /^sales\.[a-z_.]+$/.test(r.event)) assert.match(code, new RegExp(`["'\`]${r.event.replace(/\./g, "\\.")}["'\`]`), `${r.event} is emitted by the code`);
  }
  // What the flow's own states never imply (S-08).
  for (const [object, to] of [["proposal", "APPROVED_INTERNAL"], ["preparation", "READY"], ["preparation", "PACKAGING"], ["dossier", "READY"], ["opportunity", "APPROVED_INTERNAL"]]) {
    const row = STATE_CONTRACTS[object].transitions.find((t) => t.to === to && t.doesNotImply.length);
    for (const w of ["CONTACTED", "WON"]) assert.ok(row.doesNotImply.some((x) => x.includes(w)), `${object} ${to} does not imply ${w}`);
  }
  assert.ok(NEVER_IMPLIED.includes("CONTACTED") && NEVER_IMPLIED.includes("WON"));
});

test("M12-SC-02 one synthetic flow: every transition it made is declared, with the event the table names; nothing it reached implies sent / CONTACTED / WON", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const seq = t.hub.bus.lastSeq();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const ev = (type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? AND seq > ? ORDER BY seq").all(type, seq).map((r) => JSON.parse(r.payload_json));
  const declared = (object, from, to) => STATE_CONTRACTS[object].transitions.find((x) => x.from === from && x.to === to);
  // Preparation: created by the planner (its own event), then each change one sales.preparation.status event of a declared transition.
  assert.equal(ev("sales.preparation.planned").length, 1);
  assert.ok(declared("preparation", null, "PLANNED"));
  const prepMoves = ev("sales.preparation.status").filter((p) => p.preparationId === preparationId).map((p) => `${p.from}→${p.to}`);
  assert.deepEqual(prepMoves, ["PLANNED→PREPARING", "PREPARING→WAITING_OWNER", "WAITING_OWNER→PACKAGING", "PACKAGING→READY"]);
  for (const m of prepMoves) { const [from, to] = m.split("→"); assert.equal(declared("preparation", from, to)?.event, "sales.preparation.status", m); }
  // Opportunity: every recorded transition is declared; each non-initial one has its sales.opportunity.transition event.
  const oppMoves = t.hub.db.prepare("SELECT from_status, to_status FROM sales_transitions WHERE subject_type = 'opportunity' AND subject_id = ? ORDER BY created_at, rowid").all(done.opportunityId);
  assert.deepEqual(oppMoves.map((r) => `${r.from_status}→${r.to_status}`), ["null→IDENTIFIED", "IDENTIFIED→PROPOSAL_DRAFT", "PROPOSAL_DRAFT→READY_FOR_OWNER_REVIEW", "READY_FOR_OWNER_REVIEW→APPROVED_INTERNAL"]);
  for (const r of oppMoves) assert.ok(declared("opportunity", r.from_status, r.to_status), `${r.from_status}→${r.to_status}`);
  const oppEvents = ev("sales.opportunity.transition").map((p) => `${p.from}→${p.to}`);
  for (const r of oppMoves.filter((x) => x.from_status)) assert.ok(oppEvents.includes(`${r.from_status}→${r.to_status}`), `event for ${r.from_status}→${r.to_status}`);
  assert.equal(ev("sales.opportunity.created").length, 1);
  // Offer: created DRAFT, approved by the owner's decision (its event), still the latest version.
  const view = t.hub.sales.getOpportunity(done.opportunityId);
  assert.deepEqual(view.proposals.map((p) => p.status), ["APPROVED_INTERNAL"]);
  assert.equal(ev("sales.proposal.created").length, 1);
  assert.equal(ev("sales.proposal.approved").length, 1);
  assert.equal(ev("sales.proposal.approved")[0].decidedVia, "owner_session");
  // Dossier: one revision READY with its event; the contact draft DRAFT (its event).
  const { dossiers } = t.hub.salesPreparations.forOpportunity(done.opportunityId);
  assert.deepEqual(dossiers.map((d) => d.status), ["READY"]);
  assert.equal(ev("sales.dossier.written").length, 1);
  assert.deepEqual(view.drafts.map((d) => d.status), ["DRAFT"]);
  assert.equal(ev("sales.draft.created").length, 1);
  // Ledger: every operation of both phases DONE once, keyed by the confirmed root plan; each with the event of its effect.
  const ops = t.hub.salesLedger.ofRoot(card.id);
  assert.deepEqual(ops.map((o) => o.op).sort(), ["sales.draft", "sales.dossier", "sales.proposal.draft", "sales.qualify", "sales.research", "sales.synthetic"].sort());
  assert.ok(ops.every((o) => o.status === "DONE"));
  for (const type of ["sales.synthetic.created", "sales.research.recorded", "sales.qualified"]) assert.equal(ev(type).length, 1, type);
  // S-08: an approved offer, two finished plans and a ready dossier never mean sent / CONTACTED / WON.
  assert.equal(t.hub.opsPlans.view(card.id).status, "DONE");
  assert.equal(t.hub.opsPlans.view(done.phaseBPlanId).status, "DONE");
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "missions"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','IN_DISCUSSION','WON')"), 0);
  assert.equal(view.opportunity.status, "APPROVED_INTERNAL");
  assert.equal(dossiers[0].sent, false);
  // Invalidation (the table's „invalidates”): new evidence for the company → the offer STALE, the dossier STALE, the preparation STALE,
  // the opportunity back to PROPOSAL_DRAFT, the draft SUPERSEDED — each a declared transition with its event; STALE never returns.
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: done.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
  const after = t.hub.sales.getOpportunity(done.opportunityId);
  assert.equal(after.proposals[0].status, "STALE");
  assert.ok(declared("proposal", "APPROVED_INTERNAL", "STALE"));
  assert.equal(eventCount(t, "sales.proposal.stale"), 1);
  assert.equal(after.opportunity.status, "PROPOSAL_DRAFT");
  assert.ok(declared("opportunity", "APPROVED_INTERNAL", "PROPOSAL_DRAFT"));
  assert.equal(after.drafts[0].status, "SUPERSEDED");
  assert.ok(declared("draft", "DRAFT", "SUPERSEDED"));
  assert.equal(t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0].status, "STALE");
  assert.equal(eventCount(t, "sales.dossier.stale"), 1);
  assert.ok(declared("dossier", "READY", "STALE"));
  assert.equal(t.hub.salesPreparations.get(preparationId).status, "STALE");
  assert.ok(declared("preparation", "READY", "STALE"));
  assert.throws(() => t.hub.sales.approveProposal(after.proposals[0].id, { displayedSha: after.proposals[0].contentSha }, "test", { channel: "test", sessionCheck: () => null }), (e) => e.code === "SALES_PROPOSAL_STALE");
  assert.equal(t.hub.sales.getOpportunity(done.opportunityId).proposals[0].status, "STALE", "a STALE offer never returns to current");
  t.assertPaths();
});

test("M12-SC-03a preconditions refused (table-driven): an event-only opportunity state is never a plain move; a move outside OPPORTUNITY_TRANSITIONS neither", async (c) => {
  const t = await salesAcceptanceHub(c);
  const s = await seedSalesReview(t);
  // Opportunity: APPROVED_INTERNAL, CONTACTED, WON are never a plain move (each has its own writer and event).
  for (const to of STATE_CONTRACTS.opportunity.eventOnly) {
    await assert.rejects(salesCommand(t, "sales.opportunity.transition", { opportunityId: s.oppId, to, reason: "încercare de test" }), /se atinge doar prin/, to);
    assert.equal(t.hub.sales.getOpportunity(s.oppId).opportunity.status, "READY_FOR_OWNER_REVIEW", to);
  }
  // A manual move outside OPPORTUNITY_TRANSITIONS is refused too.
  await assert.rejects(salesCommand(t, "sales.opportunity.transition", { opportunityId: s.oppId, to: "IN_DISCUSSION", reason: "încercare de test" }), /Tranziție nepermisă/);
});

test("M12-SC-03b preconditions refused: undeclared preparation moves, a ledger key with other params, a dossier marked STALE only from READY", async (c) => {
  // Preparation: only the declared moves (PREPARATION_TRANSITIONS); an undeclared one throws and writes nothing.
  const p = await prepHub(c);
  await p.authenticate();
  const { card, preparationId } = await proposePreparation(p);
  const undeclared = Object.keys(PREPARATION_TRANSITIONS).filter((to) => !PREPARATION_TRANSITIONS.PLANNED.includes(to) && to !== "PLANNED");
  const before = eventCount(p, "sales.preparation.status");
  for (const to of undeclared) assert.throws(() => p.hub.salesPreparations.setStatus(preparationId, to, "test"), (e) => e.code === "SALES_PREPARATION_TRANSITION", to);
  assert.equal(eventCount(p, "sales.preparation.status"), before);
  assert.equal(p.hub.salesPreparations.get(preparationId).status, "PLANNED");
  // Ledger: the same key with other recorded parameters → IDEMPOTENCY_CONFLICT (C-01).
  const root = p.hub.salesPreparations.rootOf(p.hub.salesPreparations.get(preparationId));
  p.hub.salesLedger.runSync({ root, op: "test.sc03", keyParams: { k: 1 }, params: { v: "a" }, effect: () => ({}) });
  assert.throws(() => p.hub.salesLedger.runSync({ root, op: "test.sc03", keyParams: { k: 1 }, params: { v: "b" }, effect: () => ({}) }), (e) => e.code === "IDEMPOTENCY_CONFLICT");
  // Dossier: READY → STALE only from READY (a dossier that is not READY is never marked; no event).
  await confirmCard(p, card);
  const prep = p.hub.salesPreparations.get(preparationId);
  assert.equal((await approveAwaited(p, prep)).status, 200);
  const done = await settlePreparation(p, preparationId);
  const d = p.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0];
  assert.equal(p.hub.salesPreparations.markDossierStale({ ...d, status: "READY" }, "test"), true);
  assert.equal(p.hub.salesPreparations.markDossierStale(d, "test"), false, "already STALE: no second change");
  assert.equal(eventCount(p, "sales.dossier.stale"), 1);
});

test("M12-SC-04 S-08 structural: only the existing M04 writer lines set CONTACTED or WON; no M12 module reaches them", () => {
  const files = serverFiles();
  const hits = [];
  // The table itself quotes the writer lines (data): it is the reference, not a writer.
  for (const file of files.filter((f) => !f.endsWith(path.join("sales", "state-contracts.mjs")))) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/setOppStatus\([^)]*["'`](?:CONTACTED|WON)["'`]/.test(line)) {
        let fn = null;
        for (let k = i; k >= 0 && !fn; k -= 1) fn = lines[k].match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/)?.[1] || null;
        hits.push({ file: path.relative(SERVER, file).split(path.sep).join("/"), line: line.trim(), fn });
      }
      assert.doesNotMatch(line, /status\s*=\s*'(?:CONTACTED|WON)'|SET\s+status\s*=\s*"(?:CONTACTED|WON)"/, `${path.relative(SERVER, file)}:${i + 1} writes CONTACTED / WON in SQL`);
    });
  }
  assert.deepEqual(hits.map((h) => ({ file: h.file, line: h.line, fn: h.fn })),
    CONTACTED_WON_WRITERS.map((w) => ({ file: "sales/sales.mjs", line: w.line, fn: w.fn })), JSON.stringify(hits, null, 1));
  // The one generic opportunity writer outside them takes its target from transitionOpportunity, which refuses the event-only states.
  const sales = fs.readFileSync(path.join(SERVER, "sales/sales.mjs"), "utf8");
  assert.equal(sales.match(/(?<!function )setOppStatus\(opp, to,/g)?.length, 1);
  assert.match(sales, /function transitionOpportunity\(id, \{ to, reason = "" \}, actor\) \{\n\s+const opp = needOpp\(id\);\n\s+if \(EVENT_ONLY\[to\]\) throw/);
  // The M12 modules never call a writer of CONTACTED / WON, a send or an acceptance.
  for (const f of ["sales/preparation.mjs", "sales/plan-executors.mjs", "sales/dossier.mjs", "sales/plan-ledger.mjs", "sales/brief.mjs", "sales/figures.mjs", "sales/sales-answers.mjs", "owner/planners/sales.mjs"]) {
    const text = stripComments(fs.readFileSync(path.join(SERVER, f), "utf8"));
    for (const re of [/\bsetOppStatus\b/, /\brecordContactEvent\s*\(/, /\brecordClientAcceptance\s*\(/, /\bsendDraft\s*\(/, /sales\.(?:draft\.send|contact_event\.record|acceptance\.record)/]) assert.equal(re.test(text), false, `${f}: ${re}`);
  }
});
