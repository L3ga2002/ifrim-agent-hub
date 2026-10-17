// M12 WP11 — T-S7 (D13): synthetic data never reaches a real report and never mixes with real Sales rows. One `synthetic = 0` company is
// seeded in the test database (test data, not real) with EXACTLY the identity the M12 flow will generate (the same name, CUI, domain and
// e-mail); the whole flow then runs to a READY dossier. The M12 company is its own synthetic row: it never matched, merged with or wrote
// to the real one; overview() splits real / synthetic (additive keys, the old ones kept); the Lega summaries flag each item; the board's
// Sales line says „(sintetic)”; the CSV export marks each row. A fully synthetic acceptance hub; no model, nothing sent.
import test from "node:test";
import assert from "node:assert/strict";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows } from "./sales-helpers.mjs";
import { syntheticOrgFor } from "../server/sales/synthetic.mjs";
import { toCsv, parseCsv } from "../server/sales/tabular.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";

const run = async (t, type, payload) => (await salesCommand(t, type, payload)).result;
/** Everything the real company owns (row, aliases, contacts, evidence, audits, qualifications, opportunities, merges), hashed. */
const realState = (t, orgId) => hashCanonical(Object.fromEntries([
  ["org", "SELECT * FROM sales_orgs WHERE id = ?"], ["aliases", "SELECT * FROM sales_org_aliases WHERE org_id = ? ORDER BY rowid"], ["contacts", "SELECT * FROM sales_contacts WHERE org_id = ? ORDER BY rowid"],
  ["evidence", "SELECT * FROM sales_evidence WHERE subject_id = ? ORDER BY rowid"], ["audits", "SELECT * FROM sales_audits WHERE org_id = ? ORDER BY rowid"],
  ["qualifications", "SELECT * FROM sales_qualifications WHERE org_id = ? ORDER BY rowid"], ["opportunities", "SELECT * FROM sales_opportunities WHERE org_id = ? ORDER BY rowid"],
].map(([k, sql]) => [k, t.hub.db.prepare(sql).all(orgId)])));

test("M12-SI-01 a real (synthetic = 0) company with the identity the flow would generate first: the flow re-draws its own (R17), never matches, merges or writes the real one; real figures unchanged; every synthetic item flagged", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  // The identity step 1 will generate (its seed is the confirmed root plan), imported first as a REAL company of the test database.
  const p0 = t.hub.salesPreparations.get(preparationId);
  const id = syntheticOrgFor(p0.brief, p0.rootPlanId);
  const csv = toCsv(["Denumire firmă", "CUI", "Site web", "E-mail"], [[id.name, id.fiscalCode, id.website, id.email]], { delimiter: ";" });
  const batch = await run(t, "sales.import.create", { fileName: "firme-test.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: false });
  await run(t, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run(t, "sales.import.preview", { batchId: batch.id });
  await run(t, "sales.import.confirm", { batchId: batch.id });
  const real = t.hub.db.prepare("SELECT * FROM sales_orgs WHERE synthetic = 0").all();
  assert.equal(real.length, 1, "one real company in the test database");
  const realId = real[0].id;
  await run(t, "sales.org.qualify", { orgId: realId });
  const realBefore = realState(t, realId);
  const before = t.hub.sales.overview();
  assert.equal(before.split.real.orgs, 1);
  assert.equal(before.split.synthetic.orgs, 0);
  // The whole M12 flow: one confirmation, the owner's approval of the exact offer, the dossier.
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  // Its own synthetic row — the first draw was taken by the real company, so step 1 re-drew a different identity (review R17);
  // still never matched or merged with the real one.
  const m12 = t.hub.db.prepare("SELECT * FROM sales_orgs WHERE id = ?").get(done.orgId);
  assert.notEqual(m12.id, realId);
  assert.equal(m12.synthetic, 1);
  assert.notEqual(m12.fiscal_code, real[0].fiscal_code, "the taken CUI is never reused");
  assert.notEqual(m12.domain, real[0].domain, "the taken domain is never reused");
  assert.notEqual(m12.normalized_name, real[0].normalized_name, "the taken name is never reused");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_merges"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs WHERE merged_into IS NOT NULL"), 0);
  assert.equal(realState(t, realId), realBefore, "the real company's row, aliases, contacts, evidence, audits, qualifications and opportunities are untouched");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_evidence WHERE subject_id = ? AND synthetic = 0", done.orgId), 0, "the M12 rows are synthetic");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE org_id = ? AND synthetic = 0", done.orgId), 0);
  // overview(): the old keys stay; the split keeps the real figures exactly as they were and the synthetic ones apart.
  const after = t.hub.sales.overview();
  for (const k of ["counts", "syntheticOrgs", "synthetic", "outreach", "liveResearch", "confirmations", "catalog", "metricsNote"]) assert.ok(Object.hasOwn(after, k), k);
  assert.equal(after.counts.orgs, 2, "the total still counts both (M04 key, unchanged meaning)");
  assert.deepEqual(after.split.real, before.split.real, "nothing synthetic entered a real figure");
  assert.equal(after.split.synthetic.orgs, 1);
  assert.deepEqual(after.split.synthetic.opportunities, { APPROVED_INTERNAL: 1 });
  assert.deepEqual(after.split.synthetic.proposals, { APPROVED_INTERNAL: 1 });
  assert.deepEqual(after.split.synthetic.drafts, { DRAFT: 1 });
  assert.deepEqual(after.split.synthetic.preparations, { READY: 1 });
  assert.deepEqual(after.split.synthetic.dossiers, { READY: 1 });
  assert.equal(after.split.real.orgs + after.split.synthetic.orgs, after.counts.orgs);
  // Lega's summaries: every item says whether it is synthetic.
  const lega = t.hub.sales.legaPipelineSummary();
  assert.deepEqual(lega.split, { real: { orgs: 1 }, synthetic: { orgs: 1 } });
  assert.ok(lega.topPriority.length >= 2 && lega.topPriority.every((x) => typeof x.synthetic === "boolean"));
  assert.equal(lega.topPriority.find((x) => x.id === realId).synthetic, false);
  assert.equal(lega.topPriority.find((x) => x.id === done.orgId).synthetic, true);
  const drafts = t.hub.sales.legaDrafts();
  assert.deepEqual(drafts.map((d) => [d.synthetic, d.sent]), [[true, false]]);
  // The board's Sales line says „(sintetic)” and carries the split; its real side is the real figures only.
  const line = t.hub.board.agenda().items.find((i) => i.section === "sales");
  assert.match(line.title, /\(sintetic: 1 firmă sintetică, 1 reale\)/);
  assert.deepEqual(line.body.split.real, after.split.real);
  // The CSV export marks every company.
  const exported = parseCsv(Buffer.from(t.hub.sales.exportOrgsCsv(), "utf8"));
  const col = exported.headers.findIndex((h) => String(h?.name ?? h) === "Sintetic");
  assert.ok(col >= 0, JSON.stringify(exported.headers));
  assert.deepEqual(exported.rows.map((r) => r[col]).sort(), ["da", "nu"]);
  t.assertPaths();
});

test("M12-SI-02 a database with only real companies reports no synthetic data: the board line has no „(sintetic)”; the split's synthetic side is empty", async (c) => {
  const t = await prepHub(c);
  const csv = toCsv(["Denumire firmă", "CUI", "Site web"], [["Firma Reală de Test SRL", "", "https://firma-reala-de-test.test"]], { delimiter: ";" });
  const batch = await run(t, "sales.import.create", { fileName: "firme.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: false });
  await run(t, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run(t, "sales.import.preview", { batchId: batch.id });
  await run(t, "sales.import.confirm", { batchId: batch.id });
  const o = t.hub.sales.overview();
  assert.equal(o.synthetic, false);
  assert.equal(o.split.real.orgs, 1);
  assert.deepEqual(o.split.synthetic, { orgs: 0, qualified: 0, opportunities: {}, proposals: {}, drafts: {}, preparations: {}, dossiers: {} });
  const line = t.hub.board.agenda().items.find((i) => i.section === "sales");
  assert.equal(line.title, "Pipeline de vânzări (activitate numărată din date)", "the M04 title, unchanged without synthetic data");
  assert.equal(t.hub.sales.legaPipelineSummary().topPriority.length, 0);
});
