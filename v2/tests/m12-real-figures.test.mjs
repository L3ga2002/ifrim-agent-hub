// M12 final review (F8, T-S7) — synthetic M12 rows never inflate a real figure on any owner surface: the Sales overview screen (its tiles,
// „Firme pe stări” and the pipeline show the real figures only while synthetic data exists; the synthetic ones come apart, labelled), the
// board's Sales item and Lega's pipeline answer. The M04 keys of GET /api/sales/overview keep their meaning (counts stays the total; the
// split is additive). Pure UI logic first, then one fully synthetic acceptance hub (accept-helpers isolation); no model, nothing sent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { overviewFigures, realOnlyTitle } from "../web/src/lib/salesFiguresLogic.js";
import { countEntries, normalizeCounts } from "../web/src/lib/salesLogic.js";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand } from "./sales-helpers.mjs";
import { toCsv } from "../server/sales/tabular.mjs";

const source = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const run = async (t, type, payload) => (await salesCommand(t, type, payload)).result;

test("M12-RF-01 the overview figures: without synthetic data exactly the M04 figures; with it the tiles, statuses and pipeline are the real side only and the synthetic side comes apart", () => {
  const counts = { orgs: 3, needsReview: 1, audits: 2, qualified: 2, suppressions: 0, missingWebsite: 1, missingContact: 1, byStatus: { NEW: 1, OPPORTUNITY: 2 },
    opportunities: { READY_FOR_OWNER_REVIEW: 1, APPROVED_INTERNAL: 1 } };
  const plain = overviewFigures({ counts, synthetic: false, split: { real: { orgs: 3 }, synthetic: { orgs: 0 } } });
  assert.equal(plain.mixed, false);
  assert.deepEqual(plain.tiles, countEntries(counts), "the M04 tiles, unchanged");
  assert.deepEqual(plain.pipeline, [["READY_FOR_OWNER_REVIEW", 1], ["APPROVED_INTERNAL", 1]]);
  assert.deepEqual(plain.byStatus, normalizeCounts(counts.byStatus));
  assert.equal(plain.synthetic, null);
  assert.equal(realOnlyTitle("Pipeline", plain), "Pipeline");
  // An older answer without the split detail keeps the M04 figures (never a half-split screen).
  assert.equal(overviewFigures({ counts, synthetic: true, split: { real: { orgs: 2 }, synthetic: { orgs: 1 } } }).mixed, false);
  const data = { counts, synthetic: true, split: {
    real: { orgs: 2, qualified: 1, opportunities: { READY_FOR_OWNER_REVIEW: 1 }, proposals: { DRAFT: 1 }, drafts: {} },
    synthetic: { orgs: 1, qualified: 1, opportunities: { APPROVED_INTERNAL: 1 }, proposals: { APPROVED_INTERNAL: 1 }, drafts: { DRAFT: 1 }, preparations: { READY: 1 }, dossiers: { READY: 1 } },
    detail: { real: { byStatus: { NEW: 1, OPPORTUNITY: 1 }, audits: 1, followups: {}, missingWebsite: 1, missingContact: 1, suppressions: 0 },
      synthetic: { byStatus: { OPPORTUNITY: 1 }, audits: 1, followups: {}, missingWebsite: 0, missingContact: 0, suppressions: 0 } } } };
  const mixed = overviewFigures(data);
  assert.equal(mixed.mixed, true);
  assert.deepEqual(mixed.tiles.map((x) => x.key), countEntries(counts).map((x) => x.key), "the same tiles, in the same order, with the same labels");
  assert.deepEqual(Object.fromEntries(mixed.tiles.map((x) => [x.key, x.value])), { orgs: 2, needsReview: 1, audits: 1, qualified: 1, suppressions: 0, missingWebsite: 1, missingContact: 1 });
  assert.deepEqual(mixed.pipeline, [["READY_FOR_OWNER_REVIEW", 1]], "the synthetic APPROVED_INTERNAL never reads as real progress");
  assert.deepEqual(mixed.byStatus, [["NEW", 1], ["OPPORTUNITY", 1]]);
  assert.equal(mixed.synthetic.orgs, 1);
  assert.deepEqual(mixed.synthetic.opportunities, [["APPROVED_INTERNAL", 1]]);
  assert.deepEqual(mixed.synthetic.drafts, [["DRAFT", 1]]);
  assert.deepEqual(mixed.synthetic.preparations, [["READY", 1]]);
  assert.equal(realOnlyTitle("Pipeline", mixed), "Pipeline (doar date reale)");
});

test("M12-RF-02 static: the overview screen takes its tiles, statuses and pipeline from overviewFigures and shows the synthetic figures in their own panel (minimal edit of the owner's file)", () => {
  const overview = source("web/src/screens/sales/Overview.jsx");
  assert.match(overview, /const fig = overviewFigures\(data\);/);
  assert.match(overview, /const tiles = fig\.tiles;/);
  assert.match(overview, /const byStatus = fig\.byStatus;/);
  assert.match(overview, /const pipeline = fig\.pipeline;/);
  assert.equal(overview.match(/<SyntheticFigures figures=\{fig\} \/>/g)?.length, 1);
  assert.match(overview, /realOnlyTitle\("Situația curentă", fig\)/);
  assert.match(overview, /realOnlyTitle\("Pipeline", fig\)/);
  const panel = source("web/src/screens/sales/SyntheticFigures.jsx");
  assert.match(panel, /Date sintetice \(de test\), numărate separat/);
  assert.doesNotMatch(panel, /api\(|method: "POST"|dangerouslySetInnerHTML/, "read only");
  // Lega's pipeline answer is the Sales service's own sentence (legaPipelineText, checked in RF-03).
  assert.match(source("server/runtime/lega.mjs"), /if \(typeof s\.legaPipelineText === "function"\) return \{ ok: true, text: s\.legaPipelineText\(\) \};/);
});

test("M12-RF-03 a real company with a real offer under review, then one whole M12 preparation to READY: every real figure the owner reads (overview tiles, statuses, pipeline; board; Lega) is unchanged; the synthetic ones are said apart", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  // Real (synthetic = 0) test data: one company, qualified, with an offer waiting for the owner's review.
  const csv = toCsv(["Denumire firmă", "CUI", "Site web"], [["Firma Reală de Test SRL", "", "https://firma-reala-de-test.test"]], { delimiter: ";" });
  const batch = await run(t, "sales.import.create", { fileName: "firme.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: false });
  await run(t, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run(t, "sales.import.preview", { batchId: batch.id });
  await run(t, "sales.import.confirm", { batchId: batch.id });
  const orgId = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE synthetic = 0").get().id;
  await run(t, "sales.org.qualify", { orgId });
  const svc = await run(t, "sales.service.save", { name: "Site de prezentare", scope: ["Pagini"] });
  const opp = await run(t, "sales.opportunity.create", { orgId, title: "Site nou", need: "Prezentare", serviceId: svc.id });
  await run(t, "sales.proposal.create", { opportunityId: opp.opportunity.id });
  await run(t, "sales.opportunity.transition", { opportunityId: opp.opportunity.id, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire" });
  const realFigures = () => {
    const fig = overviewFigures(t.hub.sales.overview());
    const board = t.hub.board.agenda().items.find((i) => i.section === "sales").body;
    return { tiles: fig.tiles, byStatus: fig.byStatus, pipeline: fig.pipeline,
      board: { orgs: board.orgs, opportunities: board.opportunities, proposals: board.proposals, followups: board.followups }, lega: t.hub.sales.legaPipelineSummary().sides.real };
  };
  const before = realFigures();
  const textBefore = t.hub.sales.legaPipelineText();
  assert.equal(t.hub.sales.overview().synthetic, false);
  // Without synthetic data Lega's sentence is the M04 one (no „(sintetic)”, no sides).
  assert.match(textBefore, /^1 firme în pipeline \(reale: 1, sintetice: 0\); statusuri: OPPORTUNITY 1; oportunități: READY_FOR_OWNER_REVIEW 1;/);
  assert.doesNotMatch(textBefore, /SINTETICE|sintetic\)/);
  // The whole M12 flow: one confirmation, the owner's approval of the exact offer, the dossier.
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
  const ov = t.hub.sales.overview();
  assert.equal(ov.counts.orgs, 2, "the M04 key keeps its meaning (the total)");
  assert.deepEqual(ov.counts.opportunities, { READY_FOR_OWNER_REVIEW: 1, APPROVED_INTERNAL: 1 }, "the mixed total the finding saw");
  const after = realFigures();
  assert.deepEqual(after, before, "no real figure on any owner surface moved");
  // The synthetic side is said apart, everywhere.
  const fig = overviewFigures(ov);
  assert.equal(fig.mixed, true);
  assert.deepEqual(fig.synthetic.opportunities, [["APPROVED_INTERNAL", 1]]);
  assert.deepEqual(fig.synthetic.drafts, [["DRAFT", 1]]);
  const item = t.hub.board.agenda().items.find((i) => i.section === "sales");
  assert.match(item.title, /\(sintetic: 1 firmă sintetică, 1 reale\)/);
  assert.deepEqual(item.body.syntheticFigures.opportunities, { APPROVED_INTERNAL: 1 });
  assert.equal(item.body.totals.orgs, 2, "the mixed totals only under their own name");
  assert.match(item.body.note, /doar cele reale/);
  const text = t.hub.sales.legaPipelineText();
  assert.match(text, /date REALE: 1 firme; statusuri: OPPORTUNITY 1; oportunități: READY_FOR_OWNER_REVIEW 1; ciorne: niciuna/);
  assert.match(text, /date SINTETICE de test, separat \(nu intră în cifrele reale\): 1 firme; oportunități: APPROVED_INTERNAL 1; ciorne: DRAFT 1; pregătiri de ofertă: READY 1/);
  assert.doesNotMatch(text.split("date SINTETICE")[0], /APPROVED_INTERNAL|DRAFT 1/, "nothing synthetic before the synthetic part");
  // The split's original keys keep their shape (M12-SI-01/02 pin them); the detail is its own key.
  assert.deepEqual(Object.keys(ov.split).sort(), ["detail", "note", "real", "synthetic"]);
  t.assertPaths();
});
