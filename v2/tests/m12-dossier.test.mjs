// M12 WP9 — „Dosarul ofertei” (SPEC §6, S-06, T-S6; inv-package SD-01..SD-13). The local folder of ONE internally approved synthetic
// offer, written only by the derived phase-B step: files created exclusively (never overwritten, never a „ (2)” copy), deterministic
// bytes (a retry writes the same files), the Word document read back and — with Office COM off, as in every test here — APP_NOT_RUN
// declared (never mapped to FILE_CHECKED), README listed and the manifest with the sha256 of every file written last, a revision that
// reuses an artifact only by an identical-inputs rebuild proof (bytes copied), STALE when its inputs change. Pure builders run with no
// Hub; every other test is a fully synthetic acceptance hub (own root, write fence, exports root inside it, outside root/data and root/hub).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir, TEST_TMP } from "./helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand, folderShas } from "./sales-helpers.mjs";
import { dossierArtifacts, dossierFolderNames, dossierFigures, proposalDocxModel, expectedDocxShape, slugOf, DOSSIER_EXTS } from "../server/sales/dossier.mjs";
import { createSalesPlanExecutors } from "../server/sales/plan-executors.mjs";
import { verifyPackageFolder } from "../server/delivery/office-executors.mjs";
import { writeNew } from "../server/delivery/files.mjs";
import { checkDocxFile } from "../server/office/office.mjs";
import { findCommercialFigures } from "../server/sales/figures.mjs";
import { findUnresolvedPlaceholders } from "../server/sales/proposal.mjs";
import { buildDocx } from "../server/office/docx.mjs";

const SHA = (c) => c.repeat(64);
/** Synthetic facts as the dossier step reads them (pure builders: no Hub, no database). */
function facts(extra = {}) {
  return {
    proposal: { id: "spr_sd01_1", version: 1, contentSha: SHA("a"), approvedSha: SHA("a"), approvedAt: "2026-10-17T08:00:00.000Z", createdAt: "2026-10-17T07:00:00.000Z", status: "APPROVED_INTERNAL",
      content: { title: "[DATE SINTETICE] Propunere pentru Firma Test SRL", sections: [{ id: "context", heading: "Context verificat", text: "- Firmă: Firma Test SRL\n- Site: https://firma-test.test" },
        { id: "request", heading: "Ce s-a cerut", text: "- programări online (sursa: brief:spp_sd01#problem; USER_PROVIDED)" },
        { id: "price_terms", heading: "Preț și termen", text: "Preț: De stabilit (neconfigurat). Termen: De stabilit (neconfigurat)." }],
        claimsToVerify: [], usedEvidenceIds: ["sev_sd01_1"], pricing: [{ item: "price", serviceId: null, status: "UNKNOWN", text: "De stabilit (neconfigurat)", reason: "catalog neconfigurat" }] } },
    draft: { id: "sdr_sd01_1", version: 1, contentSha: SHA("b"), status: "DRAFT", subject: "[DATE SINTETICE] Propunere de colaborare pentru Firma Test SRL", body: "Bună ziua,\n\nVă scriu din partea Ifrim Digital.",
      recipients: ["office@firma-test.test"], meta: { proposalSha: SHA("a"), claimsToVerify: [] } },
    org: { id: "org_sd01", displayName: "Firma Țestă SRL", legalForm: "SRL", fiscalCode: "9900000001", fiscalCodeValid: true, website: "https://firma-test.test", domain: "firma-test.test", city: "", county: "", caen: "", status: "OPPORTUNITY", synthetic: true },
    contacts: [{ id: "sct_sd01", kind: "email", generic: true, status: "ACTIVE", value: "office@firma-test.test" }],
    evidence: [{ id: "sev_sd01_1", claim: "name", value: { name: "Firma Țestă SRL" }, label: "OBSERVED", dataKind: "FIXTURE", sourceKind: "fixture", sourceRef: "synthetic-org-v1:x (fixture sintetic)", retrievedAt: "2026-10-17T07:00:00.000Z" }],
    unknowns: ["oraș"], qualification: { id: "squ_sd01", formulaVersion: "q-v2", priority: 50, result: { components: {}, explanation: ["Prioritate: 50/100."], overrides: [] } }, qualificationHistory: [{ id: "squ_sd01" }],
    brief: { missing: [{ field: "budget", text: "bugetul" }] }, ...extra };
}

/** One full flow to a READY dossier (revision 1): one card, one confirmation, the owner's approval of the exact offer. */
async function readyDossier(c, options = {}) {
  const t = await prepHub(c, options);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const d = t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0];
  return { t, card, preparationId, prep: done, d };
}
const DIRECT = "opp_sd_direct_1";
/**
 * The owner revises the contact draft by hand (M04 path; the dossier of revision 1 becomes STALE), then — a fixture for the step under
 * test — the preparation is put back in PACKAGING under a test plan id, so the dossier step can be run directly (stubbed authorize).
 */
async function nextRevisionDirect(t, prep) {
  const d1 = t.hub.sales.latestDraft(prep.opportunityId);
  await salesCommand(t, "sales.draft.revise", { draftId: d1.id, body: `${d1.body}\n\nO frază scrisă de tine.` });
  t.hub.db.prepare("UPDATE sales_preparations SET status = 'PACKAGING', phase_b_plan_id = ? WHERE id = ?").run(DIRECT, prep.id);
  return t.hub.salesPreparations.get(prep.id);
}
const runDossier = (t, preparationId, { authorize = () => ({}), abort = { aborted: false }, executors = t.hub.executors } = {}) =>
  executors["sales.dossier"].run({ planId: DIRECT, stepId: "ops_sd_direct", params: { preparationId }, authorize, abort });
const targetOf = (t, prep) => {
  const view = t.hub.sales.getOpportunity(prep.opportunityId);
  return t.hub.salesPreparations.dossierTarget(prep, { proposal: view.proposals[0], draft: view.drafts[0], org: view.org }, t.exportsDir);
};
const isAbs = (s) => typeof s === "string" && (/^[a-z]:[\\/]/i.test(s) || s.startsWith("/") || s.startsWith("\\\\"));
function* strings(v) { if (typeof v === "string") yield v; else if (Array.isArray(v)) for (const x of v) yield* strings(x); else if (v && typeof v === "object") for (const x of Object.values(v)) yield* strings(x); }

test("SD-01 pure builders: the same facts give the same bytes (.md / .json / .docx); the docx reads back with its shape; names are ASCII and checked", () => {
  const a = dossierArtifacts(facts());
  const b = dossierArtifacts(facts());
  assert.deepEqual(a.map((x) => x.path), ["oferta-v1.md", "oferta-v1.docx", "fisa-firmei.md", "dovezi.json", "dovezi.md", "calificare.json", "calificare.md", "ciorna-mesaj.md"]);
  for (let i = 0; i < a.length; i += 1) { assert.ok(a[i].buf.equals(b[i].buf), a[i].path); assert.equal(a[i].inputsSha, b[i].inputsSha); }
  // The artifacts never carry the dossier's id, revision or time; contact values appear only in the draft.
  for (const x of a) if (x.path !== "ciorna-mesaj.md") assert.equal(x.buf.toString("latin1").includes("office@firma-test.test"), false, x.path);
  const dir = tempDir("m12-sd01");
  try {
    const file = path.join(dir, "oferta-v1.docx");
    fs.writeFileSync(file, a[1].buf);
    const shape = expectedDocxShape(proposalDocxModel({ proposal: facts().proposal }));
    const check = checkDocxFile(file, shape);
    assert.equal(check.ok, true, check.problems.join("; "));
    assert.ok(buildDocx(proposalDocxModel({ proposal: facts().proposal }), { created: new Date(facts().proposal.createdAt) }).equals(a[1].buf));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const names = dossierFolderNames({ orgName: "Firma Țestă & Fiii SRL", opportunityId: "opp_mvbn2u0z_eb09c1b786", revision: 2, dossierId: "sdo_e9c13e27ba_9207057e65" });
  assert.deepEqual(names, { root: "vanzari", opportunity: "oferta-sintetic-firma-testa-fiii-srl-eb09c1b786", revision: "revizia-2-9207057e65" });
  assert.equal(slugOf("Ș".repeat(3) + " " + "a".repeat(80)).length <= 40, true);
  assert.throws(() => dossierFolderNames({ orgName: "x", opportunityId: "opp_1", revision: 0, dossierId: "sdo_1" }), /Revizia/);
  // C-02 and placeholders: an amount in a client text is found (a configured catalog text is allowed); an unresolved field refuses.
  const priced = facts();
  priced.proposal.content.sections[2].text = "Preț: 1200 lei. Termen: 10 zile.";
  assert.ok(dossierFigures(dossierArtifacts(priced)).length >= 2);
  assert.equal(dossierFigures(dossierArtifacts(priced), { allow: ["1200 lei", "10 zile"] }).length, 0);
  const broken = facts();
  broken.proposal.content.sections[0].text = "- Firmă: {{nume}}";
  assert.throws(() => dossierArtifacts(broken), (e) => e.code === "SALES_DOSSIER_PLACEHOLDERS");
});

test("SD-01b writeNew: the M11 default is unchanged („ (2)” for other content); the dossier's opt-in exclusive mode never overwrites, never versions and leaves no temporary file", () => {
  const root = tempDir("m12-sd01b");
  try {
    const dir = path.join(root, "x");
    assert.equal(writeNew(dir, "a.md", Buffer.from("1"), { root }).existing, false);
    assert.equal(writeNew(dir, "a.md", Buffer.from("1"), { root }).existing, true);
    assert.equal(path.basename(writeNew(dir, "a.md", Buffer.from("2"), { root }).file), "a (2).md", "M11 behaviour");
    assert.throws(() => writeNew(dir, "a.docx", Buffer.from("x"), { root }), (e) => e.code === "DELIVERY_FILE_NAME", "the M11 default allows only md / html / json");
    const w = writeNew(dir, "b.docx", Buffer.from("doc"), { root, exts: DOSSIER_EXTS, exclusive: true });
    assert.equal(w.existing, false);
    assert.equal(writeNew(dir, "b.docx", Buffer.from("doc"), { root, exts: DOSSIER_EXTS, exclusive: true }).existing, true, "a resume");
    assert.throws(() => writeNew(dir, "b.docx", Buffer.from("other"), { root, exts: DOSSIER_EXTS, exclusive: true }), (e) => e.code === "DELIVERY_FILE_TAKEN");
    assert.equal(fs.readFileSync(path.join(dir, "b.docx"), "utf8"), "doc", "never overwritten");
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")), []);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith("b")), ["b.docx"], "never a „ (2)” copy");
    assert.throws(() => writeNew(path.join(TEST_TMP, ".."), "c.md", Buffer.from("x"), { root, exclusive: true }), (e) => e.code === "DELIVERY_FILE_OUTSIDE");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("SD-02 / SD-03 / SD-10 / SD-11 / SD-13 the READY dossier: manifest with every file's sha256 (README listed, no absolute path), self-verifying also when moved, tamper found; APP_NOT_RUN declared everywhere; nothing sent; no figures or placeholders; stored paths inside the test root", async (c) => {
  const { t, prep, d } = await readyDossier(c);
  const manifest = JSON.parse(fs.readFileSync(path.join(d.folder, "manifest.json"), "utf8"));
  const onDisk = folderShas(d.folder);
  assert.deepEqual(Object.keys(onDisk).sort(), [...manifest.files.map((f) => f.path), "manifest.json"].sort(), "every file is listed (README too); nothing else");
  for (const f of manifest.files) {
    assert.equal(onDisk[f.path], f.sha256, f.path);
    assert.equal(fs.statSync(path.join(d.folder, f.path)).size, f.bytes, f.path);
  }
  assert.ok(manifest.files.some((f) => f.path === "README.md"));
  assert.equal([...strings(manifest)].some(isAbs), false, "no absolute path in the manifest");
  assert.equal(verifyPackageFolder(d.folder).ok, true);
  assert.equal(d.manifestSha256, folderShas(d.folder)["manifest.json"]);
  assert.match(d.manifestSha256, /^[0-9a-f]{64}$/);
  // A moved copy still verifies; a changed byte and an extra file are found.
  const moved = path.join(t.root, "mutat", d.folderName);
  fs.cpSync(d.folder, moved, { recursive: true });
  assert.equal(verifyPackageFolder(moved).ok, true, "a moved folder verifies on its own");
  fs.appendFileSync(path.join(moved, "dovezi.md"), "x");
  fs.writeFileSync(path.join(moved, "intrus.md"), "nu e în dosar");
  const problems = verifyPackageFolder(moved).problems.join(" | ");
  assert.match(problems, /dovezi\.md: octeți diferiți/);
  assert.match(problems, /intrus\.md: nu e în manifest/);
  // SD-03: APP_NOT_RUN declared in the step result, the manifest, the README and the row; never FILE_CHECKED alone; no PDF.
  const step = t.hub.opsPlans.view(prep.phaseBPlanId).steps.find((s) => s.kind === "sales.dossier");
  for (const v of [step.result.verification.proposalDocx, manifest.verification.proposalDocx, d.verification.proposalDocx]) {
    assert.deepEqual([v.file, v.app], ["FILE_CHECKED", "APP_NOT_RUN"]);
    assert.match(v.note, /Word/);
  }
  assert.match(fs.readFileSync(path.join(d.folder, "README.md"), "utf8"), /FILE_CHECKED · APP_NOT_RUN/);
  assert.equal(fs.readdirSync(d.folder).some((n) => n.endsWith(".pdf")), false);
  // SD-10: nothing sent, contacted, won or handed off; the draft says DRAFT_ONLY / sent: false.
  const view = t.hub.sales.getOpportunity(prep.opportunityId);
  assert.equal(view.opportunity.status, "APPROVED_INTERNAL");
  assert.equal(view.drafts[0].status, "DRAFT");
  for (const table of ["sales_sends", "sales_contact_events", "sales_handoffs", "missions", "sales_client_acceptances"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  const draftMd = fs.readFileSync(path.join(d.folder, "ciorna-mesaj.md"), "utf8");
  assert.match(draftMd, /DRAFT_ONLY/);
  assert.match(draftMd, /sent: false/);
  assert.deepEqual([manifest.sent, manifest.published, manifest.spent, manifest.synthetic], [false, false, false, true]);
  assert.equal(manifest.draft.sent, false);
  // SD-11: no amount, term, ROI, discount or approximation in the client texts; prices stated „De stabilit (neconfigurat)”; no placeholder.
  const offer = fs.readFileSync(path.join(d.folder, `oferta-v${view.proposals[0].version}.md`), "utf8");
  const clientOffer = offer.split("## Proveniență")[0];
  assert.deepEqual(findCommercialFigures(clientOffer), []);
  assert.deepEqual(findCommercialFigures(draftMd.split("## Text")[1]), []);
  assert.match(offer, /De stabilit \(neconfigurat\)/);
  for (const name of fs.readdirSync(d.folder).filter((n) => n.endsWith(".md"))) assert.deepEqual(findUnresolvedPlaceholders(fs.readFileSync(path.join(d.folder, name), "utf8")), [], name);
  // The read route (GET only): the dossier with its full manifest sha; no contact value.
  const read = await t.request(`/api/sales/opportunities/${prep.opportunityId}/dossiers`, { method: "GET" });
  assert.equal(read.status, 200);
  assert.equal(read.json.dossiers[0].manifestSha256, d.manifestSha256);
  assert.deepEqual(read.json.dossiers[0].labels, ["SYNTHETIC_DATA", "LOCAL_ONLY", "DRAFT_ONLY"]);
  assert.equal(JSON.stringify(read.json).includes("office@"), false);
  assert.equal((await t.request(`/api/sales/opportunities/${prep.opportunityId}/dossiers`)).status, 404, "no write route");
  // SD-13: the dossier folder and the exports root are inside the test root, outside root/data and root/hub.
  for (const sub of ["data", "hub"]) assert.ok(path.relative(path.join(t.root, sub), d.folder).startsWith(".."), sub);
  assert.ok(!path.relative(t.root, d.folder).startsWith(".."));
  t.assertPaths();
});

test("SD-04a a revision folder that already exists (not this dossier's) → SALES_DOSSIER_FOLDER_TAKEN; the folder is untouched, no row written", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const target = targetOf(t, p);
  assert.equal(target.revision, 2);
  fs.mkdirSync(target.folder, { recursive: true });
  fs.writeFileSync(path.join(target.folder, "al-meu.md"), "un fișier al proprietarului");
  const before = folderShas(target.folder);
  await assert.rejects(runDossier(t, p.id), (e) => e.code === "SALES_DOSSIER_FOLDER_TAKEN");
  assert.deepEqual(folderShas(target.folder), before);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers WHERE op_key = ?", target.key), 0);
  assert.equal(t.hub.salesLedger.get(target.key).status, "FAILED");
});

test("SD-04b a foreign file at a name the dossier still has to write → DELIVERY_FILE_TAKEN, INCOMPLETE (declared files), the foreign bytes unchanged", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  let calls = 0;
  await assert.rejects(runDossier(t, p.id, { authorize: () => { calls += 1; if (calls === 4) throw Object.assign(new Error("Oprit"), { code: "STOPPED" }); return {}; } }), (e) => e.code === "STOPPED");
  const target = targetOf(t, p);
  const row = t.hub.salesPreparations.dossier(target.dossierId);
  assert.equal(row.status, "WRITING", "a stop leaves the declared partial effect");
  assert.deepEqual(row.files.map((f) => f.path), ["oferta-v1.md", "oferta-v1.docx"]);
  fs.writeFileSync(path.join(target.folder, "calificare.md"), "scris de altcineva");
  await assert.rejects(runDossier(t, p.id), (e) => e.code === "DELIVERY_FILE_TAKEN");
  assert.equal(fs.readFileSync(path.join(target.folder, "calificare.md"), "utf8"), "scris de altcineva");
  assert.equal(t.hub.salesPreparations.dossier(target.dossierId).status, "INCOMPLETE");
  assert.equal(fs.existsSync(path.join(target.folder, "manifest.json")), false);
  assert.equal(eventCount(t, "sales.dossier.incomplete"), 1);
});

test("SD-05 / SD-04c selective revision: the draft revised by hand → revision 1 STALE; ONE continuation card → revision 2 reuses (copies) every artifact with identical inputs, writes the new draft; revision 1 untouched; revision 2 verifies alone", async (c) => {
  const { t, preparationId, prep, d } = await readyDossier(c);
  const rev1 = folderShas(d.folder);
  const d1 = t.hub.sales.latestDraft(prep.opportunityId);
  await salesCommand(t, "sales.draft.revise", { draftId: d1.id, body: `${d1.body}\n\nO frază scrisă de tine.` });
  assert.equal(t.hub.salesPreparations.dossier(d.id).status, "STALE", "the dossier's draft changed");
  assert.equal(prepStatus(t, preparationId), "STALE");
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const list = t.hub.salesPreparations.forOpportunity(prep.opportunityId).dossiers;
  assert.deepEqual(list.map((x) => [x.revision, x.status]), [[2, "READY"], [1, "STALE"]]);
  const d2 = list[0];
  const m2 = JSON.parse(fs.readFileSync(path.join(d2.folder, "manifest.json"), "utf8"));
  const byPath = Object.fromEntries(m2.files.map((f) => [f.path, f]));
  for (const p of ["oferta-v1.md", "oferta-v1.docx", "fisa-firmei.md", "dovezi.json", "dovezi.md", "calificare.json", "calificare.md"]) {
    assert.deepEqual(byPath[p].reusedFrom, { dossierId: d.id, revision: 1, file: p, sha256: rev1[p] }, p);
    assert.equal(byPath[p].sha256, rev1[p], `${p}: the same bytes`);
  }
  assert.equal(byPath["ciorna-mesaj.md"].reusedFrom, undefined, "the revised draft is written anew");
  assert.notEqual(byPath["ciorna-mesaj.md"].sha256, rev1["ciorna-mesaj.md"]);
  assert.ok(m2.reused.length >= 7);
  assert.deepEqual(folderShas(d.folder), rev1, "revision 1 is never touched");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts"), 2, "the draft revised by hand is reused, not duplicated");
  // Revision 2 stands on its own: the revision 1 folder moved away, revision 2 still verifies.
  fs.renameSync(d.folder, path.join(t.root, "revizia-1-mutata"));
  assert.equal(verifyPackageFolder(d2.folder).ok, true);
});

test("SD-06 reuse needs the proof: a previous file edited on disk is regenerated (not copied); the others are still reused", async (c) => {
  const { t, preparationId, prep, d } = await readyDossier(c);
  fs.appendFileSync(path.join(d.folder, "fisa-firmei.md"), "\nEditat de mână.");
  const d1 = t.hub.sales.latestDraft(prep.opportunityId);
  await salesCommand(t, "sales.draft.revise", { draftId: d1.id, body: `${d1.body}\n\nAltă frază.` });
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
  const d2 = t.hub.salesPreparations.forOpportunity(prep.opportunityId).dossiers[0];
  const files = Object.fromEntries(d2.files.map((f) => [f.path, f]));
  assert.equal(files["fisa-firmei.md"].reusedFrom, undefined, "not reused: the old file changed");
  assert.ok(files["dovezi.md"].reusedFrom);
  assert.equal(fs.readFileSync(path.join(d2.folder, "fisa-firmei.md"), "utf8").includes("Editat de mână"), false, "regenerated from the inputs");
});

test("SD-07 C-01: two concurrent runs of the same dossier step (Promise.all) → one row, one event, the same id, one set of files", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const written = eventCount(t, "sales.dossier.written");
  const [a, b] = await Promise.all([runDossier(t, p.id), runDossier(t, p.id)]);
  assert.equal(a.result.dossierId, b.result.dossierId);
  assert.deepEqual([Boolean(a.result.duplicate), Boolean(b.result.duplicate)].sort(), [false, true]);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers WHERE opportunity_id = ?", p.opportunityId), 2, "revision 1 and ONE revision 2");
  assert.equal(eventCount(t, "sales.dossier.written"), written + 1);
  const folder = t.hub.salesPreparations.dossier(a.result.dossierId).folder;
  assert.equal(fs.readdirSync(folder).filter((n) => / \(\d+\)/.test(n) || n.endsWith(".tmp")).length, 0);
  assert.equal(verifyPackageFolder(folder).ok, true);
  assert.equal(prepStatus(t, p.id), "READY");
});

test("SD-08 resume after a stop mid-write: the same folder and row, no „ (2)” names, one event", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  let calls = 0;
  await assert.rejects(runDossier(t, p.id, { authorize: () => { calls += 1; if (calls === 6) throw Object.assign(new Error("Pauză"), { code: "PLAN_NOT_RUNNING" }); return {}; } }), (e) => e.code === "PLAN_NOT_RUNNING");
  const target = targetOf(t, p);
  const writing = t.hub.salesPreparations.dossier(target.dossierId);
  assert.equal(writing.status, "WRITING");
  assert.equal(writing.files.length, 4, "the files written before the stop are declared");
  assert.equal(fs.existsSync(path.join(target.folder, "manifest.json")), false);
  assert.equal(t.hub.salesLedger.get(target.key).status, "IN_PROGRESS", "no effect committed: a resume retries");
  const written = eventCount(t, "sales.dossier.written");
  const done = await runDossier(t, p.id);
  assert.equal(done.result.dossierId, target.dossierId);
  assert.equal(done.result.folder, target.folder, "the same folder");
  assert.equal(fs.readdirSync(target.folder).filter((n) => / \(\d+\)/.test(n) || n.endsWith(".tmp")).length, 0);
  assert.equal(eventCount(t, "sales.dossier.written"), written + 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers WHERE op_key = ?", target.key), 1);
  assert.equal(verifyPackageFolder(target.folder).ok, true);
  // A resume of a finished dossier reads the ledger: done, nothing written again.
  const again = await runDossier(t, p.id);
  assert.equal(again.result.duplicate, true);
  assert.equal(eventCount(t, "sales.dossier.written"), written + 1);
});

test("SD-09 preconditions: an awaited sha absent / empty / 12-char / uppercase / wrong, an offer not approved, or a non-synthetic company → refused with NO folder", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const sha = p.awaited.proposalSha;
  const folders = () => folderShas(path.join(t.exportsDir, "vanzari"));
  const before = folders();
  for (const bad of ["", sha.slice(0, 12), sha.toUpperCase(), "f".repeat(64)]) {
    t.hub.db.prepare("UPDATE sales_preparations SET awaited_proposal_sha = ? WHERE id = ?").run(bad, p.id);
    await assert.rejects(runDossier(t, p.id), (e) => e.code === "SALES_DOSSIER_NOT_APPROVED", JSON.stringify(bad));
  }
  t.hub.db.prepare("UPDATE sales_preparations SET awaited_proposal_sha = ? WHERE id = ?").run(sha, p.id);
  t.hub.db.prepare("UPDATE sales_proposals SET status = 'DRAFT', approved_sha = NULL WHERE id = ?").run(p.awaited.proposalId);
  await assert.rejects(runDossier(t, p.id), (e) => e.code === "SALES_DOSSIER_NOT_APPROVED");
  t.hub.db.prepare("UPDATE sales_proposals SET status = 'APPROVED_INTERNAL', approved_sha = ? WHERE id = ?").run(sha, p.awaited.proposalId);
  t.hub.db.prepare("UPDATE sales_orgs SET synthetic = 0 WHERE id = ?").run(p.orgId);
  await assert.rejects(runDossier(t, p.id), (e) => e.code === "SALES_DOSSIER_NOT_SYNTHETIC");
  t.hub.db.prepare("UPDATE sales_orgs SET synthetic = 1 WHERE id = ?").run(p.orgId);
  assert.deepEqual(folders(), before, "no folder or file created by a refusal");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), 1);
});

test("SD-12 the inputs change while Word checks the document → SALES_DOSSIER_INPUTS_CHANGED, INCOMPLETE, no manifest", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const h = t.hub;
  const executors = createSalesPlanExecutors({ sales: h.sales, preparations: h.salesPreparations, ledger: h.salesLedger, opsPlans: h.opsPlans, media: h.media, config: t.config, bus: h.bus,
    appCheck: "com", officeAvailable: () => true,
    verifyDocx: async (file, shape, { pdfOut }) => {
      // While „Word” has the document open, the owner records new evidence for the company (the offer's inputs change).
      h.sales.addEvidence("org", p.orgId, { claim: "telefon", value: "0700000001", label: "USER_PROVIDED", sourceKind: "manual", sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" }, "test");
      fs.mkdirSync(path.dirname(pdfOut), { recursive: true });
      fs.writeFileSync(pdfOut, "%PDF-1.4 stub de test (fără Word)\n");
      return { ok: true, level: "APP_VERIFIED", app: "Stub", version: "0", pages: 1, pdf: pdfOut, problems: [] };
    } });
  await assert.rejects(runDossier(t, p.id, { executors }), (e) => e.code === "SALES_DOSSIER_INPUTS_CHANGED");
  const target = targetOf(t, p);
  const row = t.hub.db.prepare("SELECT status FROM sales_dossiers WHERE preparation_id = ? AND revision = 2").get(p.id);
  assert.equal(row.status, "INCOMPLETE");
  const folder = t.hub.db.prepare("SELECT folder FROM sales_dossiers WHERE preparation_id = ? AND revision = 2").get(p.id).folder;
  assert.equal(fs.existsSync(path.join(folder, "manifest.json")), false);
  assert.equal(fs.existsSync(path.join(folder, "README.md")), false);
  assert.ok(target);
});

test("SD-14 the Word path with an injected verifier (no Office in the suite): APP_VERIFIED recorded, the PDF exported in the work folder and copied with COPYFILE_EXCL; a resume keeps it without opening Word again", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const h = t.hub;
  let opened = 0;
  const executors = createSalesPlanExecutors({ sales: h.sales, preparations: h.salesPreparations, ledger: h.salesLedger, opsPlans: h.opsPlans, media: h.media, config: t.config, bus: h.bus,
    appCheck: "com", officeAvailable: () => true,
    verifyDocx: async (file, shape, { pdfOut, workDir }) => {
      opened += 1;
      assert.ok(!path.relative(t.root, workDir).startsWith(".."), "the work folder is the Hub's own (inside the test root)");
      fs.mkdirSync(path.dirname(pdfOut), { recursive: true });
      fs.writeFileSync(pdfOut, `%PDF-1.4\n% verificator injectat de test (nu Word)\n${"x".repeat(1200)}\n`);
      return { ok: true, level: "APP_VERIFIED", app: "Verificator de test", version: "0", pages: 2, pdf: pdfOut, headings: shape.headings, problems: [] };
    } });
  // A stop right after the Word check (at the README): the verified level and the copied PDF are declared, no manifest.
  let calls = 0;
  await assert.rejects(runDossier(t, p.id, { executors, authorize: (a) => { calls += 1; if (a?.destination && a.destination.endsWith("README.md") && calls > 1) throw Object.assign(new Error("Oprit"), { code: "STOPPED" }); return {}; } }),
    (e) => e.code === "STOPPED");
  const target = targetOf(t, p);
  const writing = t.hub.salesPreparations.dossier(target.dossierId);
  assert.equal(writing.status, "WRITING");
  assert.equal(writing.verification.proposalDocx.app, "APP_VERIFIED");
  assert.ok(writing.files.some((f) => f.path === "oferta-v1.pdf"));
  const pdfBefore = fs.readFileSync(path.join(target.folder, "oferta-v1.pdf"));
  // The resume: Word is not opened again; the PDF already copied is this dossier's own (same bytes), never a second copy.
  const done = await runDossier(t, p.id, { executors });
  assert.equal(opened, 1);
  assert.equal(done.result.verification.proposalDocx.app, "APP_VERIFIED");
  assert.equal(done.result.verification.proposalDocx.file, "FILE_CHECKED");
  assert.ok(fs.readFileSync(path.join(target.folder, "oferta-v1.pdf")).equals(pdfBefore));
  const manifest = JSON.parse(fs.readFileSync(path.join(target.folder, "manifest.json"), "utf8"));
  assert.equal(manifest.files.find((f) => f.path === "oferta-v1.pdf").sha256, manifest.verification.proposalDocx.pdfSha256);
  assert.equal(verifyPackageFolder(target.folder).ok, true);
  assert.equal(fs.readdirSync(target.folder).filter((n) => / \(\d+\)/.test(n) || n.endsWith(".tmp")).length, 0);
});
