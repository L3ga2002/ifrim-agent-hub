// Milestone 04 — regression tests for the adversarial review of the Sales backend (each case was reproduced before its fix).
// Synthetic data only; a fake transport exists only in test hubs. PASS_LOCAL.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub } from "./helpers.mjs";
import { generateSyntheticOrgs } from "../server/sales/synthetic.mjs";
import { toCsv } from "../server/sales/tabular.mjs";
import { MANUAL_CONTACT_TEXT, CLIENT_ACCEPTANCE_TEXT } from "../server/sales/sales.mjs";

const dispatch = (hub, type, payload) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test" }).then((r) => r.result ?? r);
async function approved(hub, type, payload) {
  const requested = await hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
  assert.equal(requested.approvalRequired, true, `${type} must ask for approval`);
  await hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash }, channel: "test", actor: "test" });
  const done = await hub.commands.executeApproved(requested.command.id, "user");
  return done.result ?? done;
}
const HEADERS = ["Denumire firmă", "CUI", "Site web", "E-mail", "Telefon", "Localitate", "Județ"];
async function importRows(hub, rows, fileName = "firme.csv") {
  const batch = await dispatch(hub, "sales.import.create", { fileName, contentBase64: Buffer.from(toCsv(HEADERS, rows, { delimiter: ";" })).toString("base64"), synthetic: true });
  await dispatch(hub, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await dispatch(hub, "sales.import.preview", { batchId: batch.id });
  let result = await dispatch(hub, "sales.import.confirm", { batchId: batch.id });
  while (!result.done) result = await dispatch(hub, "sales.import.confirm", { batchId: batch.id });
  return { batch, result };
}
const service = (hub) => dispatch(hub, "sales.service.save", { name: "Site (SINTETIC)", description: "Test", scope: ["Pagini"], exclusions: ["Text"], tags: ["website", "contact"] });
async function approvedProposal(hub, oppId) {
  const proposal = await dispatch(hub, "sales.proposal.create", { opportunityId: oppId });
  await dispatch(hub, "sales.opportunity.transition", { opportunityId: oppId, to: "READY_FOR_OWNER_REVIEW", reason: "revizuită" });
  await approved(hub, "sales.proposal.approve", { proposalId: proposal.id, displayedSha: proposal.contentSha });
  return proposal;
}
async function opportunityFor(hub, orgId) {
  const svc = await service(hub);
  return (await dispatch(hub, "sales.opportunity.create", { orgId, title: "Site nou", serviceId: svc.id })).opportunity;
}
function transport({ delayMs = 0 } = {}) {
  const sent = [];
  return { id: "fake-test", sent, send: async (m) => { sent.push(m); if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return { status: "DELIVERED", deliveredAt: new Date().toISOString() }; } };
}
const orgByName = (hub, name) => hub.db.prepare("SELECT * FROM sales_orgs WHERE display_name = ? ORDER BY created_at DESC").get(name);
const cuis = () => generateSyntheticOrgs(4, { seed: 77 }).map((o) => o.fiscalCode.replace(/\D/g, ""));

test("M04-RV-01 do-not-contact by domain: a re-import with only an e-mail on the suppressed domain, or a blog URL on it, is SUPPRESSED", async () => {
  const t = await makeTestHub();
  try {
    const [cui] = cuis();
    await importRows(t.hub, [["Alfa Panificație SRL", cui, "https://alfa-pan.test", "office@alfa-pan.test", "", "Cluj-Napoca", "Cluj"]], "a.csv");
    const a = orgByName(t.hub, "Alfa Panificație SRL");
    await dispatch(t.hub, "sales.org.suppress", { orgId: a.id, reason: "a cerut să nu fie contactat" });
    const viaEmail = await importRows(t.hub, [["Alfa Grup Distribuție SRL", "", "", "Comenzi@ALFA-PAN.test", "", "Iași", "Iași"]], "b.csv");
    assert.equal(viaEmail.result.summary.SUPPRESSED, 1);
    const viaBlog = await importRows(t.hub, [["Alfa Brutăria Nouă SRL", "", "https://alfa-pan.test/blog/oferta", "", "", "Arad", "Arad"]], "c.csv");
    assert.equal(viaBlog.result.summary.SUPPRESSED, 1);
    // A webmail address is never an identity domain: suppressing one gmail user does not block gmail.
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_suppressions WHERE kind = 'domain' AND value LIKE '%gmail%'").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M04-RV-02 a recipient on a suppressed domain is blocked at draft time even for another company", async () => {
  const t = await makeTestHub({ configOverrides: { salesTransport: transport() } });
  try {
    const [c1, c2] = cuis();
    await importRows(t.hub, [["Delta Termo SRL", c1, "https://delta-termo.test", "office@delta-termo.test", "", "Constanța", "Constanța"],
      ["Gama Instal SRL", c2, "", "vanzari@gama-instal.test", "", "Brașov", "Brașov"]]);
    const gama = orgByName(t.hub, "Gama Instal SRL");
    const opp = await opportunityFor(t.hub, gama.id);
    await approvedProposal(t.hub, opp.id);
    // The owner adds a contact on the domain of a company that later asks not to be contacted.
    await dispatch(t.hub, "sales.org.suppress", { orgId: orgByName(t.hub, "Delta Termo SRL").id, reason: "opoziție" });
    t.hub.db.prepare("UPDATE sales_contacts SET value = 'vanzari@delta-termo.test' WHERE org_id = ?").run(gama.id);
    await assert.rejects(dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id }), /DO_NOT_CONTACT/);
  } finally { await t.cleanup(); }
});

test("M04-RV-03 merges carry do-not-contact both ways, and work on a merged-away company is refused", async () => {
  const fake = transport();
  const t = await makeTestHub({ configOverrides: { salesTransport: fake } });
  try {
    const [c1, , c3] = cuis();
    await importRows(t.hub, [["Beta Nou SRL", "", "https://beta-new.test", "contact@beta-new.test", "", "Arad", "Arad"],
      ["Beta Vechi SRL", c1, "", "", "", "Arad", "Arad"],
      ["Gama Nou SRL", "", "", "contact@gama-new.test", "", "Sibiu", "Sibiu"],
      ["Delta Opus SRL", c3, "", "", "", "Sibiu", "Sibiu"]]);
    const id = (n) => orgByName(t.hub, n).id;
    // (a) a suppressed company merged into a clean one: the survivor is suppressed too.
    await dispatch(t.hub, "sales.org.suppress", { orgId: id("Beta Vechi SRL"), reason: "opoziție la contact" });
    await dispatch(t.hub, "sales.org.merge", { orgId: id("Beta Vechi SRL"), intoId: id("Beta Nou SRL"), reason: "aceeași firmă, nume nou" });
    assert.equal(t.hub.sales.getOrg(id("Beta Nou SRL")).org.status, "DO_NOT_CONTACT");
    await assert.rejects(dispatch(t.hub, "sales.opportunity.create", { orgId: id("Beta Nou SRL"), title: "Site" }), /DO_NOT_CONTACT/);
    // (b) a clean company with an approved opportunity merged INTO a suppressed one: its opportunity can no longer draft.
    const opp = await opportunityFor(t.hub, id("Gama Nou SRL"));
    await approvedProposal(t.hub, opp.id);
    await dispatch(t.hub, "sales.org.suppress", { orgId: id("Delta Opus SRL"), reason: "opoziție la contact" });
    await dispatch(t.hub, "sales.org.merge", { orgId: id("Gama Nou SRL"), intoId: id("Delta Opus SRL"), reason: "aceeași firmă confirmată" });
    await assert.rejects(dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id }), /unită|DO_NOT_CONTACT/);
    assert.equal(fake.sent.length, 0);
  } finally { await t.cleanup(); }
});

test("M04-RV-04 WON needs a real contact: ON_HOLD → IN_DISCUSSION without one is refused, and so is the acceptance", async () => {
  const t = await makeTestHub();
  try {
    await importRows(t.hub, [["Omega Studio SRL", "", "https://omega-studio.test", "office@omega-studio.test", "", "Iași", "Iași"]]);
    const opp = await opportunityFor(t.hub, orgByName(t.hub, "Omega Studio SRL").id);
    const proposal = await approvedProposal(t.hub, opp.id);
    await dispatch(t.hub, "sales.opportunity.transition", { opportunityId: opp.id, to: "ON_HOLD", reason: "pauză" });
    await assert.rejects(dispatch(t.hub, "sales.opportunity.transition", { opportunityId: opp.id, to: "IN_DISCUSSION", reason: "discuție" }), /contact real/);
    await assert.rejects(dispatch(t.hub, "sales.acceptance.record", { opportunityId: opp.id, proposalId: proposal.id, confirmText: CLIENT_ACCEPTANCE_TEXT }), /contact/);
    assert.notEqual(t.hub.sales.getOpportunity(opp.id).opportunity.status, "WON");
  } finally { await t.cleanup(); }
});

test("M04-RV-05 one draft is delivered once: two keys in two tabs, a key reused for another draft, and the open-send index", async () => {
  const fake = transport({ delayMs: 40 });
  const t = await makeTestHub({ configOverrides: { salesTransport: fake } });
  try {
    await importRows(t.hub, [["Sigma Print SRL", "", "https://sigma-print.test", "office@sigma-print.test", "", "Cluj-Napoca", "Cluj"]]);
    const opp = await opportunityFor(t.hub, orgByName(t.hub, "Sigma Print SRL").id);
    await approvedProposal(t.hub, opp.id);
    const draft = await dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id });
    await approved(t.hub, "sales.draft.approve_content", { draftId: draft.id, displayedSha: draft.contentSha });
    const results = await Promise.allSettled([dispatch(t.hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "tab-1" }),
      dispatch(t.hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "tab-2" })]);
    assert.equal(fake.sent.length, 1, "one message");
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.match(String(results.find((r) => r.status === "rejected").reason.message), /deja o trimitere/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_contact_events WHERE kind = 'SENT_VIA_HUB'").get().n, 1);
    assert.throws(() => t.hub.db.prepare("INSERT INTO sales_sends (id, draft_id, idempotency_key, transport, status, created_at, updated_at) VALUES ('x', ?, 'k-x', 't', 'ATTEMPTED', 'n', 'n')").run(draft.id), /UNIQUE/);
    // The key of draft A cannot answer for draft B.
    const followDraft = await dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id });
    await approved(t.hub, "sales.draft.approve_content", { draftId: followDraft.id, displayedSha: followDraft.contentSha });
    await assert.rejects(dispatch(t.hub, "sales.draft.send", { draftId: followDraft.id, idempotencyKey: "tab-1" }), /altei ciorne/);
  } finally { await t.cleanup(); }
});

test("M04-RV-06 a draft only from the latest internally approved proposal; a newer proposal invalidates an approved draft before sending", async () => {
  const fake = transport();
  const t = await makeTestHub({ configOverrides: { salesTransport: fake } });
  try {
    await importRows(t.hub, [["Tau Media SRL", "", "https://tau-media.test", "office@tau-media.test", "", "Oradea", "Bihor"]]);
    const opp = await opportunityFor(t.hub, orgByName(t.hub, "Tau Media SRL").id);
    const p1 = await dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.id });
    await assert.rejects(dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id }), /aprobată intern/);
    await dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.id });
    await assert.rejects(dispatch(t.hub, "sales.draft.create", { opportunityId: opp.id, proposalId: p1.id }), /ultima versiune/);
    assert.equal(fake.sent.length, 0);
    // Empty or placeholder sections in owner edits are refused.
    await assert.rejects(dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.id, edits: { sections: [{ id: "scope", text: "   " }] } }), /goală/);
    await assert.rejects(dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.id, edits: { sections: [{ id: "scope", text: "Preț: {{pret}}" }] } }), /necompletate/);
  } finally { await t.cleanup(); }
});

test("M04-RV-07 an audit that finishes after a do-not-contact does not overwrite it", async () => {
  const t = await makeTestHub();
  try {
    await importRows(t.hub, [["Atelierul Verde SRL", "", "https://atelierul-verde.test", "", "", "Cluj-Napoca", "Cluj"]]);
    const org = orgByName(t.hub, "Atelierul Verde SRL");
    const audit = dispatch(t.hub, "sales.org.audit", { orgId: org.id });
    await dispatch(t.hub, "sales.org.suppress", { orgId: org.id, reason: "opoziție la contact" });
    await audit;
    assert.equal(t.hub.sales.getOrg(org.id).org.status, "DO_NOT_CONTACT");
    await assert.rejects(dispatch(t.hub, "sales.org.transition", { orgId: org.id, to: "QUALIFIED", reason: "încerc" }), /DO_NOT_CONTACT/);
  } finally { await t.cleanup(); }
});

test("M04-RV-08 rollback is per batch (two files with the same name), closes its pending rows and retires its evidence", async () => {
  const t = await makeTestHub();
  try {
    const [c1, c2] = cuis();
    const first = await importRows(t.hub, [["Unu SRL", c1, "", "a@one-r6.test", "", "Arad", "Arad"], ["Doi SRL", c2, "", "b@two-r6.test", "", "Arad", "Arad"]], "firme.csv");
    // Same file name, other content: it matches both orgs (same CUI) and brings one ambiguous row.
    const second = await importRows(t.hub, [["Unu SRL", c1, "", "c@three-r6.test", "", "Arad", "Arad"], ["Unu SRL", "", "", "", "", "Iași", "Iași"]], "firme.csv");
    assert.notEqual(first.batch.id, second.batch.id);
    assert.equal(second.result.summary.NEEDS_REVIEW, 1);
    const plan = await t.hub.sales.rollbackPreview(second.batch.id);
    assert.equal(plan.matchedContacts, 1, "only the contact the second batch brought");
    await approved(t.hub, "sales.import.rollback", { batchId: second.batch.id, reason: "fișier greșit" });
    const contacts = t.hub.db.prepare("SELECT value, status FROM sales_contacts ORDER BY value").all();
    assert.deepEqual(contacts.map((c) => `${c.value}:${c.status}`), ["a@one-r6.test:ACTIVE", "b@two-r6.test:ACTIVE", "c@three-r6.test:ROLLED_BACK"]);
    assert.equal(t.hub.sales.reviewRows().total, 0, "rows of a rolled-back batch leave the review queue");
    const pending = t.hub.db.prepare("SELECT id FROM sales_import_rows WHERE batch_id = ? AND status = 'SKIPPED'").get(second.batch.id);
    await assert.rejects(dispatch(t.hub, "sales.import_row.resolve", { rowId: pending.id, action: "create" }), /SKIPPED|anulat/);
    const unu = t.hub.sales.getOrg(orgByName(t.hub, "Unu SRL").id);
    assert.ok(unu.evidence.some((e) => e.freshness === "ROLLED_BACK"));
    assert.equal(unu.evidenceStatus.rolledBack >= 1, true);
  } finally { await t.cleanup(); }
});

test("M04-RV-09 resolving a row later applies today's do-not-contact list and never duplicates a valid fiscal code", async () => {
  const t = await makeTestHub();
  try {
    const [c1] = cuis();
    await importRows(t.hub, [["Delta Termo SRL", "", "https://delta-termo.test", "", "", "Constanța", "Constanța"], ["Kappa SRL", c1, "", "", "", "Iași", "Iași"]]);
    const review = await importRows(t.hub, [["Delta Instal Grup SRL", "", "https://delta-termo.test", "", "", "Constanța", "Constanța"]], "review.csv");
    assert.equal(review.result.summary.NEEDS_REVIEW, 1);
    await dispatch(t.hub, "sales.org.suppress", { orgId: orgByName(t.hub, "Delta Termo SRL").id, reason: "opoziție la contact" });
    const row = t.hub.sales.reviewRows().items[0];
    await assert.rejects(dispatch(t.hub, "sales.import_row.resolve", { rowId: row.id, action: "create" }), /DO_NOT_CONTACT/);
    await dispatch(t.hub, "sales.import_row.resolve", { rowId: row.id, action: "skip" });
    // A valid CUI already in use: "create" is refused, "match" is the way.
    const twin = await importRows(t.hub, [["Kappa Distribuție SRL", c1, "", "", "", "Iași", "Iași"]], "twin.csv");
    if (twin.result.summary.NEEDS_REVIEW) {
      const r = t.hub.sales.reviewRows().items[0];
      await assert.rejects(dispatch(t.hub, "sales.import_row.resolve", { rowId: r.id, action: "create" }), /același CUI/);
    }
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs WHERE fiscal_code = ? AND archived_at IS NULL AND merged_into IS NULL").get(c1).n, 1);
  } finally { await t.cleanup(); }
});

test("M04-RV-10 hand-off is idempotent; a package without project gets its mission later on the same row; follow-ups are found by id", async () => {
  const t = await makeTestHub();
  try {
    await importRows(t.hub, [["Lambda Web SRL", "", "https://lambda-web.test", "office@lambda-web.test", "", "Arad", "Arad"]]);
    const opp = await opportunityFor(t.hub, orgByName(t.hub, "Lambda Web SRL").id);
    const proposal = await approvedProposal(t.hub, opp.id);
    await dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "MANUAL_RECORDED", confirmText: MANUAL_CONTACT_TEXT });
    const f = await dispatch(t.hub, "sales.followup.schedule", { opportunityId: opp.id, afterDays: 2 });
    assert.equal(t.hub.sales.getFollowup(f.id).id, f.id);
    await dispatch(t.hub, "sales.acceptance.record", { opportunityId: opp.id, proposalId: proposal.id, confirmText: CLIENT_ACCEPTANCE_TEXT });
    const packageOnly = await dispatch(t.hub, "sales.handoff.create", { opportunityId: opp.id });
    assert.equal(packageOnly.missionId, null);
    const projectId = t.hub.projects.hub().id;
    const [a, b] = await Promise.all([dispatch(t.hub, "sales.handoff.create", { opportunityId: opp.id, projectId }), dispatch(t.hub, "sales.handoff.create", { opportunityId: opp.id, projectId })]);
    assert.ok(a.missionId);
    assert.equal(a.missionId, b.missionId, "one mission");
    assert.equal(a.handoffId, packageOnly.handoffId, "the same hand-off row");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_handoffs WHERE opportunity_id = ?").get(opp.id).n, 1);
  } finally { await t.cleanup(); }
});

test("M04-RV-11 the command log keeps no contact values, and Sales events reach listeners only after COMMIT", async () => {
  const t = await makeTestHub();
  try {
    await importRows(t.hub, [["Rho Consult SRL", "", "https://rho-consult.test", "ana.popescu@rho-consult.test", "0744000111", "Arad", "Arad"]]);
    const seen = [];
    const off = t.hub.bus.subscribe((e) => { if (e.type.startsWith("sales.")) seen.push({ type: e.type, inTx: t.hub.db.isTransaction }); });
    await dispatch(t.hub, "sales.org.suppress", { orgId: orgByName(t.hub, "Rho Consult SRL").id, reason: "opoziție la contact" });
    off();
    assert.ok(seen.length >= 1);
    assert.ok(seen.every((e) => e.inTx === false), JSON.stringify(seen));
    const logged = t.hub.db.prepare("SELECT result_json FROM commands WHERE type LIKE 'sales.%'").all().map((r) => r.result_json).join("\n");
    assert.doesNotMatch(logged, /ana\.popescu|0744000111/);
  } finally { await t.cleanup(); }
});

test("M04-RV-12 lifting needs an active do-not-contact; a follow-up of a closed opportunity cannot be resumed", async () => {
  const t = await makeTestHub();
  try {
    await importRows(t.hub, [["Psi Design SRL", "", "https://psi-design.test", "office@psi-design.test", "", "Arad", "Arad"]]);
    const org = orgByName(t.hub, "Psi Design SRL");
    const requested = await t.hub.commands.dispatch({ type: "sales.suppression.lift", payload: { orgId: org.id, reason: "nu era suprimată" }, channel: "test", actor: "test" });
    await t.hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash }, channel: "test", actor: "test" });
    await assert.rejects(t.hub.commands.executeApproved(requested.command.id, "user"), /nu e DO_NOT_CONTACT/);
    const opp = await opportunityFor(t.hub, org.id);
    await approvedProposal(t.hub, opp.id);
    await dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "MANUAL_RECORDED", confirmText: MANUAL_CONTACT_TEXT });
    const f = await dispatch(t.hub, "sales.followup.schedule", { opportunityId: opp.id, afterDays: 3 });
    await dispatch(t.hub, "sales.followup.action", { followupId: f.id, action: "suspend", reason: "pauză" });
    await dispatch(t.hub, "sales.opportunity.transition", { opportunityId: opp.id, to: "LOST", reason: "a ales alt furnizor" });
    await assert.rejects(dispatch(t.hub, "sales.followup.action", { followupId: f.id, action: "resume" }), /LOST/);
  } finally { await t.cleanup(); }
});
