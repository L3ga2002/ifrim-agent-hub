// Milestone 04 — Sales & Lead Generation through the Hub's command bus, on synthetic data only (PASS_SIMULATED / PASS_LOCAL):
// import → identity → provenance → qualification → opportunity → proposal → draft → (fake) contact → acceptance → Engineering
// draft. No model, no network, no real transport: the outreach transport is disabled; a fake one exists only in test hubs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub } from "./helpers.mjs";
import { generateSyntheticOrgs } from "../server/sales/synthetic.mjs";
import { toCsv, writeXlsx } from "../server/sales/tabular.mjs";
import { MANUAL_CONTACT_TEXT, CLIENT_ACCEPTANCE_TEXT } from "../server/sales/sales.mjs";

const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" }).then((r) => r.result ?? r);
/** An approval-gated command: request, decide with the displayed hash, execute (what the UI's one click does). */
async function approved(hub, type, payload) {
  const requested = await hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
  assert.equal(requested.approvalRequired, true, `${type} must ask for approval`);
  await hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash }, channel: "test", actor: "test" });
  const done = await hub.commands.executeApproved(requested.command.id, "user");
  return done.result ?? done;
}
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const HEADERS = ["Denumire firmă", "CUI", "Site web", "E-mail", "Telefon", "Localitate", "Județ", "Cifra de afaceri", "An"];
const rowOf = (o) => [o.name, o.fiscalCode, o.website, o.email, o.phone, o.city, o.county, o.turnover, o.turnoverYear];

async function importCsv(hub, rows, { fileName = "firme.csv", synthetic = true, mapping = null, chunk = null } = {}) {
  const batch = await dispatch(hub, "sales.import.create", { fileName, contentBase64: b64(toCsv(HEADERS, rows, { delimiter: ";" })), synthetic });
  await dispatch(hub, "sales.import.mapping", { batchId: batch.id, mapping: mapping || batch.suggestedMapping });
  const preview = await dispatch(hub, "sales.import.preview", { batchId: batch.id });
  let result = await dispatch(hub, "sales.import.confirm", { batchId: batch.id, ...(chunk ? { maxRows: chunk } : {}) });
  while (!result.done) result = await dispatch(hub, "sales.import.confirm", { batchId: batch.id });
  return { batch, preview, result };
}

/** A fake transport (test hubs only): records every send; never touches the network. */
function fakeTransport() {
  const sent = [];
  return { id: "fake-test", sent, send: async (message) => { sent.push(message); return { status: "DELIVERED", deliveredAt: new Date().toISOString() }; } };
}

test("M04-A import: mapping suggestion, preview without writes, duplicates/invalid rows, chunked resumable import, idempotent re-upload, provenance per row", async () => {
  const t = await makeTestHub();
  try {
    const orgs = generateSyntheticOrgs(12, { seed: 11 });
    const rows = orgs.map(rowOf);
    rows.push(rowOf(orgs[0]));                                   // exact duplicate inside the file
    rows.push(["", "", "", "", "", "Cluj-Napoca", "Cluj", "", ""]); // empty name → INVALID
    rows.push(["=HYPERLINK(\"x\")", "", "", "", "", "Iași", "Iași", "", ""]); // formula-looking name: stored as text
    // A raw CSV (our own toCsv neutralizes formulas on export): the formula-looking name reaches the importer as written.
    const rawCsv = [HEADERS, ...rows].map((r) => r.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(";")).join("\r\n");
    const batch = await dispatch(t.hub, "sales.import.create", { fileName: "firme.csv", contentBase64: b64(rawCsv), synthetic: true });
    assert.equal(batch.status, "UPLOADED");
    assert.deepEqual(Object.values(batch.suggestedMapping).filter((f) => f !== "ignore").sort(), ["city", "county", "email", "fiscalCode", "name", "phone", "turnover", "turnoverYear", "website"].sort());
    await assert.rejects(dispatch(t.hub, "sales.import.mapping", { batchId: batch.id, mapping: { 0: "city", 1: "city" } }), /două coloane|name/);
    await dispatch(t.hub, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
    const preview = await dispatch(t.hub, "sales.import.preview", { batchId: batch.id });
    assert.equal(preview.summary.total, 15);
    assert.equal(preview.summary.INVALID, 1);
    assert.ok(preview.summary.DUPLICATE_IN_FILE >= 1);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n, 0, "preview writes nothing");
    // Interrupted import: one chunk, then resumed; processed rows are never processed twice.
    const first = await dispatch(t.hub, "sales.import.confirm", { batchId: batch.id, maxRows: 5 });
    assert.equal(first.done, false);
    assert.equal(first.batch.status, "IMPORTING");
    const rest = await dispatch(t.hub, "sales.import.confirm", { batchId: batch.id });
    assert.equal(rest.done, true);
    assert.equal(rest.batch.status, "IMPORTED");
    const orgCount = t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n;
    assert.equal(orgCount, rest.summary.CREATED);
    assert.equal((await dispatch(t.hub, "sales.import.confirm", { batchId: batch.id })).alreadyImported, true);
    // Same file again: the same batch, no second copy.
    const again = await dispatch(t.hub, "sales.import.create", { fileName: "firme-copie.csv", contentBase64: b64(rawCsv), synthetic: true });
    assert.equal(again.id, batch.id);
    assert.equal(again.existing, true);
    // Provenance: every created org has a USER_PROVIDED evidence pointing to the file and row; the formula-looking name stays text.
    const formulaOrg = t.hub.db.prepare("SELECT * FROM sales_orgs WHERE display_name LIKE '=HYPERLINK%'").get();
    assert.ok(formulaOrg, "kept as text");
    const sheet = t.hub.sales.getOrg(formulaOrg.id);
    assert.ok(sheet.evidence.some((e) => e.label === "USER_PROVIDED" && /firme\.csv#rând \d+/.test(e.sourceRef)));
    const csv = t.hub.sales.exportOrgsCsv({ q: "hyperlink" });
    assert.match(csv, /'=HYPERLINK/, "export neutralizes formula injection");
    // A second file overlapping by fiscal code matches the existing orgs instead of creating new ones.
    const overlap = await importCsv(t.hub, orgs.slice(0, 3).map((o) => rowOf({ ...o, name: `${o.name} (alt nume)` })), { fileName: "suprapunere.csv" });
    assert.equal(overlap.result.summary.MATCHED, 3);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n, orgCount);
    assert.ok(t.hub.sales.getOrg(t.hub.db.prepare("SELECT id FROM sales_orgs WHERE fiscal_code = ?").get(orgs[0].fiscalCode.replace(/\D/g, "")).id).aliases.length >= 1, "the other name is kept as an alias");
  } finally { await t.cleanup(); }
});

test("M04-A2 XLSX import (formulas never evaluated, a phone stored as a number is flagged) and controlled rollback that keeps the orgs edited since", async () => {
  const t = await makeTestHub();
  try {
    const orgs = generateSyntheticOrgs(4, { seed: 5 });
    const rows = [HEADERS, ...orgs.map(rowOf)];
    rows[1][4] = "740000123"; // the phone lost its leading zero in a spreadsheet
    const xlsx = writeXlsx(rows, { numericCells: [[1, 4]], formulaCells: [[2, 7, "SUM(1,2)", "3"]] });
    const batch = await dispatch(t.hub, "sales.import.create", { fileName: "firme.xlsx", contentBase64: xlsx.toString("base64"), synthetic: true });
    assert.equal(batch.fileKind, "xlsx");
    assert.ok(batch.warnings.some((w) => /formule/.test(w)), "formula cells are reported, never evaluated");
    await dispatch(t.hub, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
    const preview = await dispatch(t.hub, "sales.import.preview", { batchId: batch.id });
    assert.ok(preview.rows[0].warnings.some((w) => /0 inițial|zero/i.test(w)), JSON.stringify(preview.rows[0].warnings));
    const res = await dispatch(t.hub, "sales.import.confirm", { batchId: batch.id });
    assert.equal(res.done, true);
    await assert.rejects(dispatch(t.hub, "sales.import.create", { fileName: "macro.xlsm", contentBase64: xlsx.toString("base64") }), /xlsm/);
    // Rollback: an org edited after the import is kept; the untouched ones are archived (not deleted).
    const created = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE created_batch_id = ? ORDER BY created_at").all(batch.id).map((r) => r.id);
    await dispatch(t.hub, "sales.org.update", { orgId: created[0], city: "Oradea", reason: "corectat la telefon" });
    const plan = await t.hub.sales.rollbackPreview(batch.id);
    assert.deepEqual(plan.conflicts.map((c) => c.orgId), [created[0]]);
    assert.equal(plan.removable.length, created.length - 1);
    const done = await approved(t.hub, "sales.import.rollback", { batchId: batch.id });
    assert.equal(done.batch.status, "ROLLED_BACK");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs WHERE archived_at IS NULL").get().n, 1);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n, created.length, "archived, not deleted");
  } finally { await t.cleanup(); }
});

test("M04-B identity: similar names in different cities stay separate; same name+city or same domain with another name wait for the owner; different fiscal codes never merge; merge is reversible", async () => {
  const t = await makeTestHub();
  try {
    const rows = [
      ["Alfa Construct SRL", "", "https://alfa-construct.test", "", "", "Cluj-Napoca", "Cluj", "", ""],
      ["Alfa Construct SRL", "", "", "", "", "Iași", "Iași", "", ""],
      ["Beta Design SRL", "", "https://beta-design.test", "", "", "Brașov", "Brașov", "", ""],
      ["Ziarul Local", "", "https://www.facebook.com/ziarul-local-fictiv", "", "", "Sibiu", "Sibiu", "", ""],
    ];
    const first = await importCsv(t.hub, rows, { fileName: "identitate-1.csv" });
    // Same name in another city: never merged automatically; the owner decides (a branch or another company), with the reason shown.
    assert.equal(first.result.summary.CREATED, 3);
    assert.equal(first.result.summary.NEEDS_REVIEW, 1);
    const otherCity = t.hub.sales.reviewRows().items[0];
    assert.match(otherCity.matches[0].conflicts.join(" "), /orașe diferite/);
    await dispatch(t.hub, "sales.import_row.resolve", { rowId: otherCity.id, action: "create", reason: "altă firmă, alt oraș" });
    assert.equal(t.hub.sales.listOrgs({ q: "alfa construct" }).total, 2);
    const social = t.hub.db.prepare("SELECT * FROM sales_orgs WHERE display_name = 'Ziarul Local'").get();
    assert.equal(social.domain_kind, "social_profile");
    const second = await importCsv(t.hub, [
      ["Alfa Construct SRL", "", "", "", "", "Cluj-Napoca", "Cluj", "", ""],          // same name + city → review, not auto
      ["Gama Studio SRL", "", "https://beta-design.test", "", "", "Brașov", "Brașov", "", ""], // same domain, other name → review
    ], { fileName: "identitate-2.csv" });
    assert.equal(second.result.summary.NEEDS_REVIEW, 2);
    const review = t.hub.sales.reviewRows();
    assert.equal(review.total, 2);
    assert.ok(review.items.every((r) => r.matches.length >= 1 && r.matches[0].reasons.length >= 1), "the reason of every candidate is shown");
    const gama = review.items.find((r) => r.normalized.record.name.startsWith("Gama"));
    await dispatch(t.hub, "sales.import_row.resolve", { rowId: gama.id, action: "create", reason: "brand diferit" });
    const alfa = review.items.find((r) => r.normalized.record.name.startsWith("Alfa"));
    const sameCity = alfa.matches.find((m) => m.strength === "CANDIDATE");
    assert.ok(sameCity, "same name + same city is a candidate");
    await dispatch(t.hub, "sales.import_row.resolve", { rowId: alfa.id, action: "match", orgId: sameCity.existingId });
    assert.equal(t.hub.sales.reviewRows().total, 0);
    // Two orgs with different valid fiscal codes can never be merged; a merge is reversible.
    const [x, y] = generateSyntheticOrgs(2, { seed: 99 });
    const cuiImport = await importCsv(t.hub, [rowOf(x), rowOf({ ...y, name: x.name, city: x.city, website: "", email: "" })], { fileName: "cui.csv" });
    // Same name and city but another valid fiscal code: flagged for the owner, can never be attached to the first one.
    assert.equal(cuiImport.result.summary.NEEDS_REVIEW, 1, JSON.stringify(cuiImport.result.summary));
    const twin = t.hub.sales.reviewRows().items[0];
    assert.match(twin.matches[0].conflicts.join(" "), /CUI-uri valide diferite/);
    await assert.rejects(dispatch(t.hub, "sales.import_row.resolve", { rowId: twin.id, action: "match", orgId: twin.matches[0].existingId }), /CUI-uri valide diferite/);
    await dispatch(t.hub, "sales.import_row.resolve", { rowId: twin.id, action: "create", reason: "altă persoană juridică" });
    const ids = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE fiscal_code IN (?, ?)").all(x.fiscalCode.replace(/\D/g, ""), y.fiscalCode.replace(/\D/g, "")).map((r) => r.id);
    assert.equal(ids.length, 2, "different fiscal codes stay two orgs even with the same name and city");
    await assert.rejects(dispatch(t.hub, "sales.org.merge", { orgId: ids[0], intoId: ids[1], reason: "par a fi aceeași firmă" }), /CUI-uri valide diferite/);
    const alfaIds = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE display_name = 'Alfa Construct SRL' ORDER BY city").all().map((r) => r.id);
    const merged = await dispatch(t.hub, "sales.org.merge", { orgId: alfaIds[1], intoId: alfaIds[0], reason: "același sediu, confirmat telefonic" });
    assert.equal(t.hub.sales.listOrgs({ q: "alfa construct" }).total, 1);
    await dispatch(t.hub, "sales.merge.revert", { mergeId: merged.mergeId });
    assert.equal(t.hub.sales.listOrgs({ q: "alfa construct" }).total, 2);
  } finally { await t.cleanup(); }
});

async function serviceAndOrg(t, { price = null } = {}) {
  const svc = await dispatch(t.hub, "sales.service.save", { name: "Site de prezentare (SINTETIC)", description: "Serviciu de test", scope: ["Pagini de prezentare", "Formular de contact"],
    exclusions: ["Conținut text"], tags: ["website", "responsive", "contact"], ...(price ? { price } : {}) });
  const [o] = generateSyntheticOrgs(1, { seed: 3 });
  await importCsv(t.hub, [rowOf({ ...o, email: `office@${o.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")}` })], { fileName: "o-firma.csv" });
  const org = t.hub.db.prepare("SELECT * FROM sales_orgs WHERE fiscal_code = ?").get(o.fiscalCode.replace(/\D/g, ""));
  return { svc, org };
}

test("M04-D qualification: deterministic and explainable; unknown is not zero; override needs a reason and keeps the history", async () => {
  const t = await makeTestHub();
  try {
    const { org } = await serviceAndOrg(t);
    const q = await dispatch(t.hub, "sales.org.qualify", { orgId: org.id });
    assert.equal(q.formulaVersion, "q-v1");
    assert.ok(q.result.components && "serviceFit" in q.result.components);
    assert.equal(q.result.components.serviceFit.score, null, "no audit yet: service fit unknown, not 0");
    assert.ok(q.result.unknowns.length >= 1);
    assert.equal(q.result.financialFilter.status === "FAIL", false, "missing financial data never excludes");
    await assert.rejects(dispatch(t.hub, "sales.qualification.override", { orgId: org.id, priority: 80, reason: "da" }), /reason|motiv|5/);
    const o = await dispatch(t.hub, "sales.qualification.override", { orgId: org.id, priority: 80, reason: "client recomandat de un partener" });
    assert.equal(o.priority, 80);
    assert.equal(t.hub.sales.getOrg(org.id).qualificationHistory.length, 2, "history kept");
  } finally { await t.cleanup(); }
});

async function toApprovedProposal(t, oppId) {
  const proposal = await dispatch(t.hub, "sales.proposal.create", { opportunityId: oppId });
  await dispatch(t.hub, "sales.opportunity.transition", { opportunityId: oppId, to: "READY_FOR_OWNER_REVIEW", reason: "revizuită" });
  await approved(t.hub, "sales.proposal.approve", { proposalId: proposal.id, displayedSha: proposal.contentSha });
  return proposal;
}

test("M04-E proposal: no invented price (unconfigured → 'de stabilit'), configured price used as configured; a new version invalidates the internal approval", async () => {
  const t = await makeTestHub();
  try {
    const { svc, org } = await serviceAndOrg(t);
    const opp = await dispatch(t.hub, "sales.opportunity.create", { orgId: org.id, title: "Site nou", need: "Prezentare pe mobil", serviceId: svc.id });
    const p1 = await dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.opportunity.id });
    assert.match(p1.content.text, /De stabilit/);
    assert.doesNotMatch(p1.content.text, /\d+\s?(lei|RON|EUR)/i, "no price appears");
    await assert.rejects(dispatch(t.hub, "sales.opportunity.transition", { opportunityId: opp.opportunity.id, to: "APPROVED_INTERNAL", reason: "direct" }), /aprobarea propunerii/);
    await dispatch(t.hub, "sales.opportunity.transition", { opportunityId: opp.opportunity.id, to: "READY_FOR_OWNER_REVIEW", reason: "gata" });
    await approved(t.hub, "sales.proposal.approve", { proposalId: p1.id, displayedSha: p1.contentSha });
    assert.equal(t.hub.sales.getOpportunity(opp.opportunity.id).opportunity.status, "APPROVED_INTERNAL");
    // Configured price → used exactly; the new version sends the opportunity back to PROPOSAL_DRAFT and the old approval no longer applies.
    await dispatch(t.hub, "sales.service.save", { serviceId: svc.id, name: svc.name, description: svc.description, scope: svc.scope, exclusions: svc.exclusions, tags: svc.tags,
      price: { status: "CONFIGURED", amount: 4500, currency: "RON", unit: "proiect" } });
    const p2 = await dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.opportunity.id });
    assert.equal(p2.version, 2);
    assert.match(p2.content.text, /4[.\s]?500/);
    const view = t.hub.sales.getOpportunity(opp.opportunity.id);
    assert.equal(view.opportunity.status, "PROPOSAL_DRAFT");
    assert.equal(view.proposals.find((p) => p.id === p1.id).status, "SUPERSEDED");
    assert.throws(() => t.hub.sales.approveProposal(p1.id, { displayedSha: p1.contentSha }, "test"), /versiune mai nouă/);
  } finally { await t.cleanup(); }
});

test("M04-F contact: sending is OUTREACH_DISABLED; with a fake test transport a send needs approved unchanged content, is idempotent and is the only way to SENT; do-not-contact blocks everything, also on re-import", async () => {
  const transport = fakeTransport();
  const plain = await makeTestHub();
  const t = await makeTestHub({ configOverrides: { salesTransport: transport } });
  try {
    for (const hub of [plain.hub, t.hub]) {
      const { svc, org } = await serviceAndOrg({ hub });
      const opp = await dispatch(hub, "sales.opportunity.create", { orgId: org.id, title: "Site nou", serviceId: svc.id });
      await toApprovedProposal({ hub }, opp.opportunity.id);
      const draft = await dispatch(hub, "sales.draft.create", { opportunityId: opp.opportunity.id });
      assert.equal(draft.status, "DRAFT");
      assert.doesNotMatch(draft.body, /am analizat site-ul/i, "no audit → never claims an analysis");
      assert.ok(Array.isArray(draft.meta.claimsToVerify));
      if (hub === plain.hub) {
        await assert.rejects(dispatch(hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "k1" }), /OUTREACH_DISABLED/);
        assert.equal(hub.sales.getOpportunity(opp.opportunity.id).opportunity.status, "APPROVED_INTERNAL", "nothing changed");
        continue;
      }
      await assert.rejects(dispatch(hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "k0" }), /aprobat/, "not approved → no send");
      const approvedDraft = await approved(hub, "sales.draft.approve_content", { draftId: draft.id, displayedSha: draft.contentSha });
      assert.equal(approvedDraft.status, "CONTENT_APPROVED");
      const [r1, r2] = await Promise.all([dispatch(hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "k1" }), dispatch(hub, "sales.draft.send", { draftId: draft.id, idempotencyKey: "k1" })]);
      assert.equal(transport.sent.length, 1, "double click: one message");
      assert.ok([r1, r2].some((r) => r.duplicate));
      const after = hub.sales.getOpportunity(opp.opportunity.id);
      assert.equal(after.drafts[0].status, "SENT");
      assert.equal(after.opportunity.status, "CONTACTED");
      assert.equal(after.contactEvents[0].kind, "SENT_VIA_HUB");
      // Opposition to contact: suppression at once; no new draft; re-importing the same company under another name is SUPPRESSED.
      await dispatch(hub, "sales.contact_event.record", { opportunityId: opp.opportunity.id, kind: "OPT_OUT", note: "nu doresc oferte" });
      await assert.rejects(dispatch(hub, "sales.draft.create", { opportunityId: opp.opportunity.id }), /DO_NOT_CONTACT/);
      const fiscal = org.fiscal_code;
      const re = await importCsv(hub, [["Alt Nume Comercial SRL", fiscal, "", "", "", "Arad", "Arad", "", ""]], { fileName: "reimport.csv" });
      assert.equal(re.result.summary.SUPPRESSED, 1);
      await assert.rejects(dispatch(hub, "sales.org.transition", { orgId: org.id, to: "QUALIFIED", reason: "încerc din nou" }), /DO_NOT_CONTACT/);
      const lifted = await approved(hub, "sales.suppression.lift", { orgId: org.id, reason: "clientul a cerut el să revenim" });
      assert.equal(lifted.org.status, "ON_HOLD");
    }
  } finally { await t.cleanup(); await plain.cleanup(); }
});

test("M04-G hand-off: acceptance only with the exact confirmation, after a real contact, for the latest approved version → WON → Software Factory draft (no grant, no run); a later proposal makes it outdated", async () => {
  const t = await makeTestHub();
  try {
    const { svc, org } = await serviceAndOrg(t);
    const opp = (await dispatch(t.hub, "sales.opportunity.create", { orgId: org.id, title: "Site nou", need: "Formular de contact funcțional pe mobil", serviceId: svc.id })).opportunity;
    const proposal = await toApprovedProposal(t, opp.id);
    await assert.rejects(dispatch(t.hub, "sales.acceptance.record", { opportunityId: opp.id, proposalId: proposal.id, confirmText: CLIENT_ACCEPTANCE_TEXT }), /contactat/);
    await assert.rejects(dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "MANUAL_RECORDED", confirmText: "da" }), /exact/);
    await dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "MANUAL_RECORDED", channel: "telefon", confirmText: MANUAL_CONTACT_TEXT });
    await assert.rejects(dispatch(t.hub, "sales.handoff.create", { opportunityId: opp.id }), /acceptarea clientului/);
    await dispatch(t.hub, "sales.acceptance.record", { opportunityId: opp.id, proposalId: proposal.id, confirmText: CLIENT_ACCEPTANCE_TEXT, note: "acceptat telefonic (test)" });
    assert.equal(t.hub.sales.getOpportunity(opp.id).opportunity.status, "WON");
    const project = t.hub.projects.hub();
    const runsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    const grantsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n;
    const handoff = await dispatch(t.hub, "sales.handoff.create", { opportunityId: opp.id, projectId: project.id });
    assert.ok(handoff.missionId);
    const factoryView = t.hub.factory.view(handoff.missionId);
    assert.equal(factoryView.factory.stage, "SPEC_DRAFT", "a draft: nothing starts");
    assert.equal(factoryView.specs[0].status === "APPROVED", false, "the spec waits for the owner's scope approval");
    assert.ok(Array.isArray(factoryView.specs[0].problems));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsBefore, "no model run");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n, grantsBefore, "no grant");
    assert.equal(handoff.package.proposal.sha, proposal.contentSha);
    assert.equal(t.hub.sales.getOpportunity(opp.id).handoffs[0].outdated, false);
    // A newer proposal after the hand-off (scope change): the opportunity stays WON and the hand-off is shown as outdated.
    await dispatch(t.hub, "sales.service.save", { serviceId: svc.id, name: svc.name, description: "Serviciu de test, scope extins", scope: [...svc.scope, "Pagină de blog"], exclusions: svc.exclusions, tags: svc.tags });
    await dispatch(t.hub, "sales.proposal.create", { opportunityId: opp.id });
    const view = t.hub.sales.getOpportunity(opp.id);
    assert.equal(view.opportunity.status, "WON", "a won opportunity is not reopened by a new version");
    assert.equal(view.handoffs[0].outdated, true);
    assert.match(view.handoffs[0].note, /decizie nouă de scope/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsBefore, "still no run");
  } finally { await t.cleanup(); }
});

test("M04-F2 follow-ups: only from a real contact or an explicit date; due by the scheduler tick (no message); suspended by a reply; never after do-not-contact", async () => {
  const t = await makeTestHub();
  try {
    const { svc, org } = await serviceAndOrg(t);
    const opp = (await dispatch(t.hub, "sales.opportunity.create", { orgId: org.id, title: "Site", serviceId: svc.id })).opportunity;
    await assert.rejects(dispatch(t.hub, "sales.followup.schedule", { opportunityId: opp.id, afterDays: 3 }), /contact real/);
    await toApprovedProposal(t, opp.id);
    await dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "MANUAL_RECORDED", occurredAt: new Date(Date.now() - 10 * 86400000).toISOString(), confirmText: MANUAL_CONTACT_TEXT });
    const f = await dispatch(t.hub, "sales.followup.schedule", { opportunityId: opp.id, afterDays: 3 });
    assert.equal(f.status, "SCHEDULED");
    const dup = await dispatch(t.hub, "sales.followup.schedule", { opportunityId: opp.id, afterDays: 3 });
    assert.equal(dup.duplicate, true, "the same follow-up is not created twice");
    const sendsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_sends").get().n;
    assert.deepEqual(t.hub.sales.tick(), { due: 1, expired: 0 });
    assert.deepEqual(t.hub.sales.tick(), { due: 0, expired: 0 }, "idempotent");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_sends").get().n, sendsBefore, "the tick never sends");
    const draft = await dispatch(t.hub, "sales.followup.draft", { followupId: f.id });
    assert.equal(draft.status, "DRAFT");
    await dispatch(t.hub, "sales.contact_event.record", { opportunityId: opp.id, kind: "REPLY_RECORDED", note: "revin săptămâna viitoare" });
    assert.equal(t.hub.sales.getOpportunity(opp.id).followups[0].status, "SUSPENDED");
  } finally { await t.cleanup(); }
});

test("M04-H volume and restart: 3,700 synthetic rows import in chunks, list/search are paged, and a restart sends nothing, runs no model and starts nothing", async () => {
  const t = await makeTestHub();
  try {
    const orgs = generateSyntheticOrgs(3700, { seed: 2026, duplicateRate: 0.03, invalidRate: 0.02 });
    const started = Date.now();
    const { result } = await importCsv(t.hub, orgs.map(rowOf), { fileName: "volum-3700.csv", chunk: 1000 });
    const ms = Date.now() - started;
    assert.equal(result.done, true);
    const total = Object.values(result.summary).reduce((a, b) => a + b, 0);
    assert.equal(total, 3700);
    assert.ok(result.summary.CREATED > 3000);
    assert.ok(ms < 120000, `import took ${ms} ms`);
    const page = t.hub.sales.listOrgs({ limit: 50, offset: 100, sort: "name" });
    assert.equal(page.items.length, 50);
    assert.equal(page.total, result.summary.CREATED);
    const one = page.items[0];
    assert.ok(t.hub.sales.listOrgs({ q: one.displayName.slice(0, 12) }).total >= 1);
    const overview = t.hub.sales.overview();
    assert.equal(overview.synthetic, true);
    assert.equal(overview.outreach, "DISABLED");
    // Restart on the same database: nothing is sent, no run, no automatic action.
    const events = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    await t.hub.close();
    const { createHub } = await import("../server/hub.mjs");
    const again = createHub(t.config, { homeDir: t.homeDir });
    await again.boot();
    try {
      assert.equal(again.sales.overview().counts.orgs, result.summary.CREATED);
      assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM sales_sends").get().n, 0);
      assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
      assert.ok(again.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'sales.%'").get().n <= events);
    } finally { await again.close(); }
  } finally { try { fs.rmSync(t.dataDir, { recursive: true, force: true }); } catch { /* Windows */ } }
});

test("M04-L Lega reads Sales only as bounded summaries (no contact values) and the Sales commands are not available from voice except do-not-contact", async () => {
  const t = await makeTestHub();
  try {
    const { org } = await serviceAndOrg(t);
    const s = t.hub.sales.legaPipelineSummary();
    assert.equal(s.orgs, 1);
    const d = t.hub.sales.legaLeadDetail(org.display_name.slice(0, 10));
    assert.equal(d.found, true);
    assert.doesNotMatch(JSON.stringify(d), /@/, "no e-mail addresses in what the voice gets");
    for (const type of ["sales.import.create", "sales.proposal.approve", "sales.draft.approve_content", "sales.draft.send", "sales.acceptance.record", "sales.suppression.lift", "sales.handoff.create"]) {
      await assert.rejects(t.hub.commands.dispatch({ type, payload: {}, channel: "voice", actor: "voice" }), /voice|channel|canal/i, type);
    }
    const dnc = await t.hub.commands.dispatch({ type: "sales.org.suppress", payload: { orgId: org.id, reason: "Lega: proprietarul a spus să nu-i mai contactăm" }, channel: "voice", actor: "voice" });
    assert.equal((dnc.result ?? dnc).org.status, "DO_NOT_CONTACT");
  } finally { await t.cleanup(); }
});

test("M04-C audit on local fixtures only: OBSERVED evidence with selector and excerpt, opportunities mapped to the catalog; live collection, real domains and social profiles refused; page text never acts", async () => {
  const t = await makeTestHub();
  try {
    await dispatch(t.hub, "sales.service.save", { name: "Site responsive (SINTETIC)", description: "Test", scope: ["Adaptare pentru mobil"], exclusions: [], tags: ["responsive", "website", "contact"] });
    const rows = [
      ["Service Auto Boltul SRL", "", "https://service-auto-boltul.test", "", "", "Iași", "Iași", "", ""],
      ["Atelierul Verde SRL", "", "https://atelierul-verde.test", "", "", "Cluj-Napoca", "Cluj", "", ""],
      ["Cofetăria din Centru SRL", "", "https://jurnalul-orasului.test", "", "", "Brașov", "Brașov", "", ""],
      ["Firmă Reală Exemplu SRL", "", "https://exemplu-real.ro", "", "", "Arad", "Arad", "", ""],
      ["Profil Social SRL", "", "https://www.facebook.com/profil-social-fictiv", "", "", "Arad", "Arad", "", ""],
    ];
    await importCsv(t.hub, rows, { fileName: "audit.csv" });
    const id = (name) => t.hub.db.prepare("SELECT id FROM sales_orgs WHERE display_name = ?").get(name).id;
    // Live collection is refused (LIVE_COLLECTION_DISABLED), a real domain is refused, a social profile is not the company's site.
    await assert.rejects(dispatch(t.hub, "sales.org.audit", { orgId: id("Atelierul Verde SRL"), sourceKind: "live" }), /LIVE_COLLECTION_DISABLED/);
    await assert.rejects(dispatch(t.hub, "sales.org.audit", { orgId: id("Firmă Reală Exemplu SRL") }), /\.test/);
    await assert.rejects(dispatch(t.hub, "sales.org.audit", { orgId: id("Profil Social SRL") }), /social_profile/);
    // A good fixture: every reported check carries selector + clipped excerpt + method; PASS/ISSUE become OBSERVED evidence.
    const good = await dispatch(t.hub, "sales.org.audit", { orgId: id("Atelierul Verde SRL") });
    const sheet = t.hub.sales.getOrg(id("Atelierul Verde SRL"));
    assert.equal(sheet.audits.length, 1);
    const result = sheet.audits[0].result;
    assert.equal(result.version, "audit-v1");
    assert.ok(result.checks.every((c) => c.evidence && c.evidence.method === "static-html" && c.evidence.excerpt.length <= 201));
    assert.ok(sheet.evidence.some((e) => e.label === "OBSERVED" && e.sourceKind === "fixture"));
    assert.ok(result.limits.some((l) => /fixture/.test(l)), "the audit says it ran on a fictitious fixture");
    assert.ok(good);
    // Prompt injection in the page: noted in the limits; nothing else changes (no WON, no approval, no draft, no send).
    const before = { approvals: t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n, drafts: t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_drafts").get().n };
    await dispatch(t.hub, "sales.org.audit", { orgId: id("Service Auto Boltul SRL") });
    const injected = t.hub.sales.getOrg(id("Service Auto Boltul SRL"));
    assert.equal(injected.audits[0].result.signals.injectionSuspected, true);
    assert.ok(injected.audits[0].result.limits.some((l) => /prompt injection/.test(l)));
    assert.ok(injected.audits[0].result.checks.some((c) => c.status === "ISSUE"), "the page's claim of 'no problems' is ignored");
    assert.equal(injected.org.status, "AUDITED");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_opportunities WHERE status = 'WON'").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n, before.approvals);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_drafts").get().n, before.drafts);
    // An article about the company is not its site: content checks are NOT_APPLICABLE and no opportunity is invented from them.
    await dispatch(t.hub, "sales.org.audit", { orgId: id("Cofetăria din Centru SRL") });
    const article = t.hub.sales.getOrg(id("Cofetăria din Centru SRL")).audits[0];
    assert.equal(article.result.pageKind, "article");
    assert.ok(article.result.checks.filter((c) => c.id !== "identity_name").every((c) => c.status === "NOT_APPLICABLE"));
    assert.ok(article.opportunities.every((o) => o.checkId === "identity_name"));
    // Qualification after the audit: the service fit is now known and explained.
    const q = await dispatch(t.hub, "sales.org.qualify", { orgId: id("Service Auto Boltul SRL") });
    assert.notEqual(q.result.components.serviceFit.score, null);
  } finally { await t.cleanup(); }
});

test("M04-S simulator Sales demo: synthetic catalog, import, fixture audits and one proposal waiting for the owner; outreach stays disabled, nothing runs", async () => {
  const t = await makeTestHub({ configOverrides: { simulation: true } });
  try {
    const { createSimulation } = await import("../server/sim/simulation.mjs");
    const sim = createSimulation(t.hub);
    assert.ok(sim.actions.includes("sales"));
    const r = await sim.action("sales");
    assert.ok(r.summary.CREATED >= 50, JSON.stringify(r.summary));
    assert.equal(r.audited, 8);
    const view = t.hub.sales.getOpportunity(r.opportunityId);
    assert.equal(view.opportunity.status, "READY_FOR_OWNER_REVIEW");
    assert.equal(view.proposals[0].status, "DRAFT", "the approval stays the owner's");
    const overview = t.hub.sales.overview();
    assert.equal(overview.outreach, "DISABLED");
    assert.equal(overview.synthetic, true);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    const again = await sim.action("sales");
    assert.equal(again.existingBatch, true, "a second click does not import the demo twice");
    assert.equal(t.hub.sales.overview().counts.orgs, overview.counts.orgs);
  } finally { await t.cleanup(); }
});

test("M04-P provenance over time: an old financial period and a passed recheck date need re-verification, a newer reading supersedes the older one, contradictory sources are kept side by side", async () => {
  let nowMs = Date.parse("2026-10-01T10:00:00.000Z");
  const t = await makeTestHub({ clock: () => new Date(nowMs) });
  try {
    const row = (turnover, year) => ["Atelierul Verde SRL", "", "https://atelierul-verde.test", "", "", "Cluj-Napoca", "Cluj", turnover, year];
    await importCsv(t.hub, [row("120000", "2025")], { fileName: "sursa-1.csv" });
    const orgId = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE display_name = 'Atelierul Verde SRL'").get().id;
    // A second file says something else for the same period: both stay, each points at the other; nothing is overwritten.
    // Without a fiscal code the same name + domain is a candidate: the owner confirms it is the same company.
    const confirmSame = async (fileName, r) => {
      const res = await importCsv(t.hub, [r], { fileName });
      assert.equal(res.result.summary.NEEDS_REVIEW, 1);
      const pending = t.hub.sales.reviewRows().items[0];
      await dispatch(t.hub, "sales.import_row.resolve", { rowId: pending.id, action: "match", orgId });
    };
    await confirmSame("sursa-2.csv", row("95000", "2025"));
    let sheet = t.hub.sales.getOrg(orgId);
    const fin = sheet.evidence.filter((e) => e.claim === "financial:turnover");
    assert.equal(fin.length, 2);
    assert.ok(fin.every((e) => e.conflictsWith.length === 1 && e.freshness === "CURRENT"));
    assert.equal(sheet.evidenceStatus.contradictions.length, 2);
    // An old period always needs re-verification.
    await confirmSame("sursa-veche.csv", row("80000", "2021"));
    sheet = t.hub.sales.getOrg(orgId);
    const old = sheet.evidence.find((e) => e.claim === "financial:turnover" && e.value.period === "2021");
    assert.equal(old.freshness, "NEEDS_RECHECK");
    assert.match(old.freshnessReason, /2021/);
    // Auditing again: the earlier readings are SUPERSEDED (kept in history); after 90 days the audit needs re-verification.
    await dispatch(t.hub, "sales.org.audit", { orgId });
    nowMs += 1000;
    await dispatch(t.hub, "sales.org.audit", { orgId });
    sheet = t.hub.sales.getOrg(orgId);
    const audits = sheet.evidence.filter((e) => e.claim === "audit:title_present");
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((e) => e.freshness).sort(), ["CURRENT", "SUPERSEDED"]);
    nowMs += 91 * 86400000;
    sheet = t.hub.sales.getOrg(orgId);
    assert.equal(sheet.evidence.find((e) => e.claim === "audit:title_present" && e.freshness !== "SUPERSEDED").freshness, "NEEDS_RECHECK");
    assert.ok(sheet.evidenceStatus.needsRecheck >= 1);
    assert.ok(sheet.lastVerifiedAt);
  } finally { await t.cleanup(); }
});
