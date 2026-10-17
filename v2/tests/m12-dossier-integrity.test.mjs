// M12 review fixes (parts 2–3) — „Dosarul ofertei” (SPEC §6, S-06, T-S6, T-S12, C-05). Every Hub is a fully synthetic acceptance hub
// (accept-helpers isolation: own root, write fence, exports root inside it, Office COM off); Word is an injected verifier, never Office.
// A dossier left WRITING by a stop is declared INCOMPLETE (its files stay, listed) once its plan can no longer finish it; Word's refusal
// or failure is APP_FAILED, never READY; the PDF is exported in the Hub's work folder and copied without overwrite; a resume after a stop
// or a crash rebuilds README and the manifest byte for byte (also for a reused, Word-verified document); every value a file renders is an
// input of the dossier (a change → a new revision, a READY dossier → STALE); the exports root never resolves into the Hub's own data.
// Review items: R9/R19, R10, R20/C3, R21, R22.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand, folderShas } from "./sales-helpers.mjs";
import { createSalesPlanExecutors } from "../server/sales/plan-executors.mjs";
import { verifyPackageFolder } from "../server/delivery/office-executors.mjs";

async function waiting(c) {
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  return { t, preparationId, prep: t.hub.salesPreparations.get(preparationId) };
}
async function readyDossier(c) {
  const { t, preparationId, prep } = await waiting(c);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  return { t, preparationId, prep: done, d: t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0] };
}
const DIRECT = "opp_sd_integrity_1";
/** The owner revises the draft by hand (a new dossier key), then the preparation is put back in PACKAGING under a test plan id (fixture). */
async function nextRevisionDirect(t, prep, text = "O frază scrisă de tine.") {
  const d1 = t.hub.sales.latestDraft(prep.opportunityId);
  await salesCommand(t, "sales.draft.revise", { draftId: d1.id, body: `${d1.body}\n\n${text}` });
  t.hub.db.prepare("UPDATE sales_preparations SET status = 'PACKAGING', phase_b_plan_id = ? WHERE id = ?").run(DIRECT, prep.id);
  return t.hub.salesPreparations.get(prep.id);
}
const runDossier = (t, preparationId, { authorize = () => ({}), executors = t.hub.executors } = {}) =>
  executors["sales.dossier"].run({ planId: DIRECT, stepId: "ops_sd_integrity", params: { preparationId }, authorize, abort: { aborted: false } });
/** Executors with an injected Word verifier (Office COM stays off in the suite). */
const withWord = (t, verifyDocx) => createSalesPlanExecutors({ sales: t.hub.sales, preparations: t.hub.salesPreparations, ledger: t.hub.salesLedger, opsPlans: t.hub.opsPlans,
  media: t.hub.media, config: t.config, bus: t.hub.bus, appCheck: "com", officeAvailable: () => true, verifyDocx });
const stubWord = (counter = { n: 0 }) => async (file, shape, { pdfOut }) => {
  counter.n += 1;
  fs.mkdirSync(path.dirname(pdfOut), { recursive: true });
  fs.writeFileSync(pdfOut, `%PDF-1.4\n% verificator injectat de test (nu Word) ${counter.n}\n${"x".repeat(1200)}\n`);
  return { ok: true, level: "APP_VERIFIED", app: "Verificator de test", version: "0", pages: 1, pdf: pdfOut, problems: [] };
};
const stopAt = (match) => (a) => { if (match(a)) throw Object.assign(new Error("Oprit (test)"), { code: "STOPPED" }); return {}; };
const rowOf = (t, prep, revision) => t.hub.db.prepare("SELECT * FROM sales_dossiers WHERE preparation_id = ? AND revision = ?").get(prep.id, revision);
const ledgerOf = (t, row) => t.hub.salesLedger.get(row.op_key).status;
const read = (row, name) => fs.readFileSync(path.join(row.folder, name));

/** Phase B through the REAL derived plan, its dossier step holding inside Word until released. */
async function writingDossier(c) {
  const { t, preparationId, prep } = await waiting(c);
  let entered;
  const inWord = new Promise((r) => { entered = r; });
  let release;
  const gate = new Promise((r) => { release = r; });
  const ex = withWord(t, async (file, shape, opts) => { entered(); await gate; return stubWord()(file, shape, opts); });
  t.hub.executors["sales.dossier"] = ex["sales.dossier"];
  assert.equal((await approveAwaited(t, prep)).status, 200);
  for (let i = 0; i < 5; i += 1) await settle();
  await inWord;
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "PACKAGING");
  const row = t.hub.db.prepare("SELECT * FROM sales_dossiers WHERE preparation_id = ?").get(preparationId);
  assert.equal(row.status, "WRITING");
  return { t, preparationId, p, row, release };
}
function assertDeclaredPartial(t, row, reason) {
  const after = t.hub.salesPreparations.dossier(row.id);
  assert.equal(after.status, "INCOMPLETE");
  assert.equal(after.partial, true);
  assert.match(after.statusReason, reason);
  const files = after.files.map((f) => f.path);
  assert.ok(files.length >= 8, `the files written so far stay listed: ${files}`);
  for (const f of files) assert.ok(fs.existsSync(path.join(after.folder, f)), `${f} stays on disk (never deleted)`);
  assert.equal(fs.existsSync(path.join(after.folder, "README.md")), false);
  assert.equal(fs.existsSync(path.join(after.folder, "manifest.json")), false);
  assert.equal(ledgerOf(t, row), "FAILED");
  const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.dossier.incomplete' AND scope_id = ?").all(row.id).map((r) => JSON.parse(r.payload_json));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].partial, true);
}

test("M12-DI-01 (R9/R19) the preparation cancelled while its dossier is WRITING → the dossier INCOMPLETE (declared partial: files listed, kept), its ledger operation FAILED; nothing more is written", async (c) => {
  const { t, preparationId, p, row, release } = await writingDossier(c);
  const out = (await salesCommand(t, "sales.preparation.cancel", { preparationId, reason: "Nu mai vreau" })).result;
  assert.equal(out.preparation.status, "CANCELLED");
  assertDeclaredPartial(t, row, /Parțial.*CANCELLED/);
  const before = folderShas(row.folder);
  release();
  await t.hub.opsPlans.idle(p.phaseBPlanId);
  await settlePreparation(t, preparationId);
  assert.deepEqual(folderShas(row.folder), before, "nothing written after the cancel (no PDF, no README, no manifest)");
  assert.equal(t.hub.salesPreparations.dossier(row.id).status, "INCOMPLETE");
  assert.equal(prepStatus(t, preparationId), "CANCELLED");
  const read = await t.request(`/api/sales/opportunities/${p.opportunityId}/dossiers`, { method: "GET" });
  assert.deepEqual(read.json.dossiers.map((d) => [d.status, d.partial]), [["INCOMPLETE", true]]);
  assert.equal(read.json.preparations[0].continuable, false, "a cancelled preparation is closed");
  t.assertPaths();
});

test("M12-DI-02 (R9/R19) the phase-B plan cancelled (ops.plan.cancel) while the dossier is WRITING → the same declared partial effect", async (c) => {
  const { t, preparationId, p, row, release } = await writingDossier(c);
  t.hub.opsPlans.cancel(p.phaseBPlanId, { reason: "Oprit de tine", actor: "owner" });
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(prepStatus(t, preparationId), "CANCELLED");
  assertDeclaredPartial(t, row, /Parțial/);
  release();
  await t.hub.opsPlans.idle(p.phaseBPlanId);
  assert.equal(t.hub.salesPreparations.dossier(row.id).status, "INCOMPLETE");
  assert.equal(fs.existsSync(path.join(row.folder, "manifest.json")), false);
});

test("M12-DI-03 (R10) Word refuses the document (APP_MISMATCH) on the real plan → OFFICE_VERIFY_FAILED, APP_FAILED recorded, dossier INCOMPLETE, no README / manifest / PDF, ledger FAILED, preparation FAILED (never READY)", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const ex = withWord(t, async () => ({ ok: false, level: "APP_MISMATCH", problems: ["Word vede alte titluri decât oferta"] }));
  t.hub.executors["sales.dossier"] = ex["sales.dossier"];
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "FAILED", done.statusReason);
  const plan = t.hub.opsPlans.view(done.phaseBPlanId);
  assert.equal(plan.status, "FAILED");
  assert.match(plan.steps.find((s) => s.kind === "sales.dossier").error, /^OFFICE_VERIFY_FAILED: Word nu confirmă documentul: Word vede alte titluri/);
  const row = t.hub.db.prepare("SELECT * FROM sales_dossiers WHERE preparation_id = ?").get(preparationId);
  const d = t.hub.salesPreparations.dossier(row.id);
  assert.equal(d.status, "INCOMPLETE");
  assert.deepEqual([d.verification.proposalDocx.app, d.verification.proposalDocx.level], ["APP_FAILED", "APP_MISMATCH"]);
  for (const name of ["README.md", "manifest.json", "oferta-v1.pdf"]) assert.equal(fs.existsSync(path.join(d.folder, name)), false, name);
  assert.equal(ledgerOf(t, row), "FAILED");
  assert.equal(eventCount(t, "sales.dossier.written"), 0);
});

test("M12-DI-04 (R10) a Word verifier that throws is APP_FAILED too (recorded, INCOMPLETE, no README)", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const ex = withWord(t, async () => { throw new Error("COM: instanța Word nu a pornit"); });
  await assert.rejects(runDossier(t, p.id, { executors: ex }), (e) => e.code === "OFFICE_VERIFY_FAILED" && /instanța Word nu a pornit/.test(e.message));
  const row = rowOf(t, p, 2);
  assert.equal(row.status, "INCOMPLETE");
  assert.equal(JSON.parse(row.verification_json).proposalDocx.app, "APP_FAILED");
  assert.equal(fs.existsSync(path.join(row.folder, "README.md")), false);
  assert.equal(ledgerOf(t, row), "FAILED");
});

test("M12-DI-05 (R21) the PDF is exported in the Hub's work folder (never in the dossier) and copied without overwrite: a foreign PDF in the folder is refused, its bytes unchanged", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const seen = [];
  const word = stubWord();
  const ex = withWord(t, async (file, shape, opts) => { seen.push(opts); return word(file, shape, opts); });
  // A stop right after the docx (before Word): the revision folder is this dossier's own; then a foreign PDF appears in it.
  await assert.rejects(runDossier(t, p.id, { executors: ex, authorize: stopAt((a) => a?.op === "office.verify") }), (e) => e.code === "STOPPED");
  const row = rowOf(t, p, 2);
  assert.equal(seen.length, 0);
  fs.writeFileSync(path.join(row.folder, "oferta-v1.pdf"), "%PDF străin, nu al dosarului");
  await assert.rejects(runDossier(t, p.id, { executors: ex }), (e) => e.code === "DELIVERY_FILE_TAKEN");
  assert.equal(fs.readFileSync(path.join(row.folder, "oferta-v1.pdf"), "utf8"), "%PDF străin, nu al dosarului", "never overwritten");
  assert.equal(seen.length, 1);
  const work = path.resolve(t.config.workDir);
  const out = path.resolve(seen[0].pdfOut);
  assert.ok(!path.relative(work, out).startsWith("..") && !path.isAbsolute(path.relative(work, out)), `exported inside the work folder: ${out}`);
  assert.ok(path.relative(row.folder, out).startsWith(".."), "never exported into the dossier folder");
  assert.equal(path.resolve(seen[0].workDir), path.dirname(out));
  assert.equal(t.hub.db.prepare("SELECT status FROM sales_dossiers WHERE id = ?").get(row.id).status, "INCOMPLETE");
});

test("M12-DI-06 (R20/R21) a resume after README (and after the manifest) rebuilds them byte for byte and finishes READY", async (c) => {
  const { t, prep } = await readyDossier(c);
  let p = await nextRevisionDirect(t, prep, "Prima revizie de test.");
  await assert.rejects(runDossier(t, p.id, { authorize: stopAt((a) => a?.destination?.endsWith("manifest.json")) }), (e) => e.code === "STOPPED");
  let row = rowOf(t, p, 2);
  const readme = read(row, "README.md");
  assert.equal(fs.existsSync(path.join(row.folder, "manifest.json")), false);
  const done = await runDossier(t, p.id);
  assert.equal(done.result.dossierId, row.id);
  assert.ok(read(row, "README.md").equals(readme), "README identical on the resume");
  assert.equal(verifyPackageFolder(row.folder).ok, true);
  // A stop after the manifest was written (before the final transaction): the same manifest bytes on the resume.
  p = await nextRevisionDirect(t, t.hub.salesPreparations.get(prep.id), "A doua revizie de test.");
  await assert.rejects(runDossier(t, p.id, { authorize: stopAt((a) => a?.op === "sales.dossier") }), (e) => e.code === "STOPPED");
  row = rowOf(t, p, 3);
  const manifest = read(row, "manifest.json");
  const readme3 = read(row, "README.md");
  assert.equal(row.status, "WRITING");
  const again = await runDossier(t, p.id);
  assert.equal(again.result.dossierId, row.id);
  assert.ok(read(row, "manifest.json").equals(manifest), "manifest identical on the resume");
  assert.ok(read(row, "README.md").equals(readme3));
  assert.equal(t.hub.salesPreparations.dossier(row.id).status, "READY");
  assert.equal(fs.readdirSync(row.folder).filter((n) => / \(\d+\)/.test(n) || n.endsWith(".tmp")).length, 0);
});

test("M12-DI-07 (R20) a revision that reuses a Word-verified document and its PDF (R-PACK), stopped after README: the resume finishes with the same README, without opening Word", async (c) => {
  const { t, prep } = await readyDossier(c);
  const counter = { n: 0 };
  const ex = withWord(t, stubWord(counter));
  let p = await nextRevisionDirect(t, prep, "Revizia verificată în Word.");
  assert.equal((await runDossier(t, p.id, { executors: ex })).result.verification.proposalDocx.app, "APP_VERIFIED");
  assert.equal(counter.n, 1);
  p = await nextRevisionDirect(t, t.hub.salesPreparations.get(prep.id), "Revizia care refolosește documentul.");
  await assert.rejects(runDossier(t, p.id, { executors: ex, authorize: stopAt((a) => a?.destination?.endsWith("manifest.json")) }), (e) => e.code === "STOPPED");
  const row = rowOf(t, p, 3);
  const readme = read(row, "README.md");
  assert.match(readme.toString("utf8"), /oferta-v1\.pdf — sha256 [0-9a-f]{64} — din dosarul/, "the PDF is listed as reused");
  const done = await runDossier(t, p.id, { executors: ex });
  assert.equal(done.result.dossierId, row.id);
  assert.ok(read(row, "README.md").equals(readme), "README identical");
  assert.equal(counter.n, 1, "Word not opened again");
  const manifest = JSON.parse(read(row, "manifest.json"));
  assert.ok(manifest.reused.some((r) => r.file === "oferta-v1.pdf"));
  assert.equal(manifest.files.find((f) => f.path === "oferta-v1.pdf").reusedFrom.revision, 2);
  assert.equal(verifyPackageFolder(row.folder).ok, true);
});

test("M12-DI-08 (R20) a stop between Word's recorded check and the PDF copy: the resume copies the recorded work PDF (Word not reopened)", async (c) => {
  const { t, prep } = await readyDossier(c);
  const counter = { n: 0 };
  const ex = withWord(t, stubWord(counter));
  const p = await nextRevisionDirect(t, prep);
  await assert.rejects(runDossier(t, p.id, { executors: ex, authorize: stopAt((a) => a?.destination?.endsWith(".pdf")) }), (e) => e.code === "STOPPED");
  const row = rowOf(t, p, 2);
  const recorded = JSON.parse(row.verification_json).proposalDocx;
  assert.equal(recorded.app, "APP_VERIFIED", "recorded before the copy");
  assert.equal(fs.existsSync(path.join(row.folder, "oferta-v1.pdf")), false);
  const done = await runDossier(t, p.id, { executors: ex });
  assert.equal(counter.n, 1, "Word not opened again");
  assert.equal(done.result.verification.proposalDocx.pdfSha256, recorded.pdfSha256);
  assert.equal(t.hub.salesPreparations.dossier(row.id).status, "READY");
});

test("M12-DI-09 (C3/R20) the company status changes between a stop mid-dossier and its resume: a new revision is written (never DELIVERY_FILE_TAKEN), the stopped one declared INCOMPLETE; a READY dossier goes STALE on a status change", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  let calls = 0;
  await assert.rejects(runDossier(t, p.id, { authorize: () => { calls += 1; if (calls === 5) throw Object.assign(new Error("Oprit"), { code: "STOPPED" }); return {}; } }), (e) => e.code === "STOPPED");
  const stopped = rowOf(t, p, 2);
  assert.match(read(stopped, "fisa-firmei.md").toString("utf8"), /- Status: OPPORTUNITY/);
  await salesCommand(t, "sales.org.transition", { orgId: p.orgId, to: "ON_HOLD", reason: "Pauză sintetică" });
  const done = await runDossier(t, p.id);
  const fresh = t.hub.salesPreparations.dossier(done.result.dossierId);
  assert.equal(fresh.revision, 3, "the changed inputs give a new key and a new revision folder");
  assert.equal(fresh.status, "READY");
  assert.match(fs.readFileSync(path.join(fresh.folder, "fisa-firmei.md"), "utf8"), /- Status: ON_HOLD/);
  const old = t.hub.salesPreparations.dossier(stopped.id);
  assert.equal(old.status, "INCOMPLETE");
  assert.match(old.statusReason, /înlocuit de revizia 3/);
  assert.match(read(stopped, "fisa-firmei.md").toString("utf8"), /- Status: OPPORTUNITY/, "the partial files stay as they were");
  assert.equal(prepStatus(t, p.id), "READY");
  await salesCommand(t, "sales.org.transition", { orgId: p.orgId, to: "OPPORTUNITY", reason: "Reluare sintetică" });
  assert.equal(t.hub.salesPreparations.dossier(fresh.id).status, "STALE", "a READY dossier whose rendered status changed is STALE");
  assert.equal(prepStatus(t, p.id), "STALE");
});

test("M12-DI-10 (R22) an exports root that resolves into the Hub's data (directly, through a junction, or with its „vanzari” folder linked there) is refused before any directory is created", async (c) => {
  const { t, prep } = await readyDossier(c);
  const p = await nextRevisionDirect(t, prep);
  const setExports = (dir) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: dir }, "test", "test R22"));
  const rows = countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers");
  const inData = path.join(t.config.dataDir, "exporturi-in-date");
  const linkedTarget = path.join(t.config.dataDir, "tinta-legatura");
  const vanzariTarget = path.join(t.config.dataDir, "tinta-vanzari");
  fs.mkdirSync(linkedTarget);
  fs.mkdirSync(vanzariTarget);
  const linked = path.join(t.root, "exporturi-legate");
  fs.symlinkSync(linkedTarget, linked, "junction");
  const parent = path.join(t.root, "exporturi-cu-vanzari-legat");
  fs.mkdirSync(parent);
  fs.symlinkSync(vanzariTarget, path.join(parent, "vanzari"), "junction");
  try {
    for (const dir of [inData, linked, parent]) {
      setExports(dir);
      await assert.rejects(runDossier(t, p.id), (e) => e.code === "SALES_DOSSIER_FORBIDDEN_ROOT", dir);
    }
    assert.equal(fs.existsSync(inData), false, "nothing created in the data folder");
    assert.deepEqual(fs.readdirSync(linkedTarget), [], "nothing created through the junction");
    assert.deepEqual(fs.readdirSync(vanzariTarget), [], "nothing created through the linked „vanzari”");
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), rows, "no dossier row");
  } finally { setExports(t.exportsDir); }
  // The approved exports root (inside the test root, outside data and hub) still works.
  assert.equal(t.hub.salesPreparations.dossier((await runDossier(t, p.id)).result.dossierId).status, "READY");
  t.assertPaths();
});
