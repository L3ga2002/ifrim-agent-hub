// M13 „Birou intern” in the one L3ga screen: the pure panel helpers, the panel's place in the work column (the pinned lines of Lega.jsx
// untouched), and — in a real browser on a fully synthetic hub under the local development profile — the start dossier and the deviz
// asked in words, confirmed and approved from #/lega, found again after a reload with their state and next action, at phone width.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WEB_DIST } from "./helpers.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { deskOverview, deskDecision, deskNext, exportWordText, deskReload } from "../web/src/lib/deskLogic.js";
import { DECISION_KIND, COMMAND_EXAMPLES, decisionsReload } from "../web/src/lib/legaOneScreen.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(here, "..");
const HUB_ROOT = path.resolve(V2, "..");
const SHA = "a".repeat(64);

test("M13-UI-01 the desk panel helpers: the newest record per flow, the exact decision target (id + full SHA) or none, the next action, the Word level as recorded; the reload rules", () => {
  const ov = deskOverview([{ id: "dsk_2", kind: "ops_start" }, { id: "dsk_1", kind: "ops_start" }, { id: "dsk_3", kind: "finance_doc" }]);
  assert.deepEqual(ov.map((s) => [s.kind, s.current?.id || null, s.older]), [["ops_start", "dsk_2", 1], ["support_case", null, 0], ["finance_doc", "dsk_3", 0]]);
  assert.deepEqual(deskDecision({ decision: null }), { ok: false, reason: null });
  assert.equal(deskDecision({ record: { kind: "finance_doc" }, decision: { artifactId: "dar_x", version: 1, sha: "abc" } }).ok, false, "a short SHA never approves");
  const d = deskDecision({ record: { kind: "support_case" }, decision: { artifactId: "dar_x", version: 2, sha: SHA } });
  assert.deepEqual([d.ok, d.path, d.label], [true, "/api/desk/artifacts/dar_x/approve", "Aprob textul intern"]);
  assert.match(d.says, /NETRIMIS/);
  assert.match(deskDecision({ record: { kind: "finance_doc" }, decision: { artifactId: "dar_y", version: 1, sha: SHA } }).says, /nu e emitere fiscală/);
  assert.match(deskNext({ record: { status: "STALE", statusReason: "Oferta s-a schimbat." }, continuable: true }), /Un card nou/);
  assert.match(deskNext({ record: { status: "STALE" }, continuable: true, waitsForRearm: true }), /redeschiderea porții/);
  assert.equal(deskNext({ record: { status: "READY", nextAction: "Ceri materialele." } }), "Ceri materialele.");
  assert.match(exportWordText({ verification: { docx: { app: "APP_NOT_RUN", note: "fără Office" } } }), /PDF-ul nu a fost produs/);
  assert.match(exportWordText({ verification: { docx: { app: "APP_VERIFIED", appVersion: "16.0", pages: 1 } } }), /verificat în Word 16\.0, 1 pagini; PDF exportat de Word/);
  assert.equal(deskReload({ type: "desk.export.written" }), true);
  assert.equal(deskReload({ type: "run.activity" }), false);
  assert.equal(decisionsReload({ type: "desk.artifact.approved" }), true);
  assert.equal(DECISION_KIND.desk_support_reply, "Răspuns de suport de aprobat");
  assert.ok(COMMAND_EXAMPLES.includes("Pregătește devizul din oferta aprobată"));
});

test("M13-UI-02 the panel sits in the work column after the offer card; the pinned Lega.jsx lines are unchanged", () => {
  const src = fs.readFileSync(path.join(V2, "web", "src", "screens", "Lega.jsx"), "utf8");
  const main = src.indexOf('<main className="cockpit-main"');
  const offer = src.indexOf("{offerOpp && <SalesOfferCard");
  const desk = src.indexOf("<DeskPanel />");
  assert.ok(main > 0 && offer > main && desk > src.indexOf("{!pid ?", offer) && desk < src.indexOf("</main>", main), "inside cockpit-main, after the offer card and the cockpit's own cards");
  assert.equal(src.split("<DeskPanel />").length - 1, 1);
  const panel = fs.readFileSync(path.join(V2, "web", "src", "screens", "lega", "DeskPanel.jsx"), "utf8");
  for (const forbidden of ["getUserMedia", "RTCPeerConnection", "new Audio(", "/send", "/publish"]) assert.ok(!panel.includes(forbidden), forbidden);
});

test("M13-UI-03 in a real browser (#/lega, local development profile): the start dossier and the deviz asked in words, ONE card each confirmed here, the deviz approved on its exact target; after a reload both records show their state and next action; phone width without horizontal scroll", { timeout: 300000 }, async (c) => {
  assert.ok(browserStatus({ hubRoot: HUB_ROOT }).installed, "Playwright (cached Chromium) is required for the browser suites");
  assert.ok(fs.existsSync(path.join(WEB_DIST, "index.html")), `the UI build is required (HUB_V2_WEB_DIST → ${WEB_DIST})`);
  const t = await prepHub(c, { devProfile: () => ({ enabled: true, version: 1, id: "dev_m13ui", ...machineIdentity() }) });
  await t.authenticate({ dev: true });
  await salesCommand(t, "sales.service.save", { name: "Programări online pe site", description: "Modul de programări (sintetic).", scope: ["Pagină de programare"], exclusions: ["Plata online"],
    materials: ["Programul de lucru", "Lista serviciilor"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true });
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
  const plansBefore = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const base = `http://localhost:${t.config.port}`;
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const browser = await pw.chromium.launch(browserLaunchOptions(base));
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ro-RO" });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.setDefaultTimeout(20000);
    await page.goto(`${base}/#/lega`);
    await page.locator(".lega-one").waitFor();
    await page.getByText(/sesiune deschisă/).first().waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    const work = page.locator(".lega-one .cockpit-main");
    const desk = work.locator("section[aria-label='Birou intern']");
    await desk.waitFor();
    // Operations: the words → ONE card → its one confirmation, here.
    await composer.fill("Pregătește dosarul de pornire a proiectului din oferta aprobată");
    await composer.press("Enter");
    const confirm = work.getByRole("button", { name: "Confirmă planul" });
    await confirm.waitFor();
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore + 1, "ONE card");
    await confirm.click();
    const ops = () => t.hub.db.prepare("SELECT id FROM desk_records WHERE kind = 'ops_start'").get()?.id;
    for (let i = 0; i < 200 && !(ops() && t.hub.desk.get(ops()).status === "READY"); i += 1) await page.waitForTimeout(100);
    assert.equal(t.hub.desk.get(ops()).status, "READY", t.hub.desk.get(ops())?.statusReason);
    const opsNo = t.hub.desk.get(ops()).internalNo;
    await desk.getByText(opsNo, { exact: false }).first().waitFor();
    await desk.getByText(/materiale lipsă/).first().waitFor();
    // Finance-Admin: the words → ONE card → confirmed → the exact target → „Aprob devizul intern”.
    await composer.fill("Pregătește devizul din oferta aprobată");
    await composer.press("Enter");
    await work.getByRole("button", { name: "Confirmă planul" }).waitFor();
    await work.getByRole("button", { name: "Confirmă planul" }).click();
    const fin = () => t.hub.db.prepare("SELECT id FROM desk_records WHERE kind = 'finance_doc'").get()?.id;
    for (let i = 0; i < 200 && !(fin() && t.hub.desk.get(fin()).status === "WAITING_OWNER"); i += 1) await page.waitForTimeout(100);
    const doc = t.hub.desk.latestArtifact(fin());
    const decision = desk.locator(".lega-desk-decision");
    await decision.waitFor();
    await decision.getByText(/sesiune locală de dezvoltare/i).waitFor();
    const text = await decision.innerText();
    assert.ok(text.includes(doc.id) && text.includes(doc.contentSha), "the exact target: id + full SHA");
    assert.match(text, /sesiune locală de dezvoltare/i, "the authority said truthfully");
    await decision.getByRole("button", { name: "Aprob devizul intern" }).click();
    for (let i = 0; i < 300 && t.hub.desk.get(fin()).status !== "READY"; i += 1) { await t.hub.desk.idle(fin()); await page.waitForTimeout(100); }
    assert.equal(t.hub.desk.get(fin()).status, "READY", t.hub.desk.get(fin()).statusReason);
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), 1, "one decision");
    const approved = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'desk.artifact.approved'").get();
    assert.equal(JSON.parse(approved.payload_json).authority, "local_dev_profile");
    // After a reload: the same records, their state and next action, from the server.
    await page.reload();
    await desk.waitFor();
    await desk.getByText(opsNo, { exact: false }).first().waitFor();
    await desk.getByText(/Word: verificat doar ca fișier/).first().waitFor();
    await desk.getByText(/Următoarea acțiune/).first().waitFor();
    // Phone width: no horizontal scroll.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll at 360 px");
    assert.deepEqual(pageErrors, []);
    for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "agent_runs", "factory_missions"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  } finally { await browser.close(); }
});
