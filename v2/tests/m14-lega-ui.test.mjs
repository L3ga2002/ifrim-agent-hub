// M14 in the one L3ga screen: a Lega read opens the EXISTING „Birou intern” record in the panel (marked, kept across a reload); the
// conversation and the unsent text come back after a reload; the project picker stays on the Lega screen in a narrow window; the
// interruptions (Stop All first, Pauză, Preiau eu) stay on screen at phone width, also in „Ecran complet”. Real browser, synthetic hub,
// local development profile (a simulated phone viewport, not a physical device).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WEB_DIST } from "./helpers.mjs";
import { acceptanceHub, settle } from "./accept-helpers.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { deskOverview } from "../web/src/lib/deskLogic.js";
import { persistedConversations, restoredConversations, mergeConversations, CONVERSATION_MAX, PERSIST_MAX_CONVERSATIONS, CONVERSATIONS_STORAGE_KEY } from "../web/src/lib/legaConversation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const FLOW = { desk_ops_prepare: "ops_start", desk_finance_prepare: "finance_doc" };
const propose = (t, text, intent) => t.hub.intake.plan({ kind: "desk", text, source: "typed", args: { flow: FLOW[intent] } }, { channel: "test", actor: "test", ownerSession: null });
async function settleRecord(t, id) { for (let i = 0; i < 6; i += 1) { await settle(); await t.hub.desk.idle(id); } return t.hub.desk.get(id); }

test("M14-UI-01 the panel shows the record a read opened (else the newest); the kept conversation: text lines only (never the choice / blocker buttons), bounded, unreadable storage → an empty start", () => {
  const records = [{ id: "dsk_2", kind: "finance_doc" }, { id: "dsk_1", kind: "finance_doc" }, { id: "dsk_3", kind: "ops_start" }];
  assert.deepEqual(deskOverview(records, "dsk_1").map((s) => [s.kind, s.current?.id || null, s.focused]), [["ops_start", "dsk_3", false], ["support_case", null, false], ["finance_doc", "dsk_1", true]]);
  assert.deepEqual(deskOverview(records, "dsk_gone").map((s) => s.current?.id || null), ["dsk_3", null, "dsk_2"], "a focus not in the list is ignored");
  const conv = { prj_a: [{ role: "user", text: "Arată devizul DVZ-0001", at: 2, mount: "m1" }, { role: "lega", text: "Devizul…", at: 3, mount: "m1", clarification: { options: [{ id: "x", label: "X" }] }, blocker: { options: [1] }, links: [{ path: "/sales", label: "Vânzări" }] }],
    company: [{ role: "lega", text: "Bună", at: 1 }, { role: "system", text: "x", at: 1 }, { role: "user", text: 5 }] };
  const kept = persistedConversations(conv, { prj_a: "netrimis", company: "" });
  assert.deepEqual(kept.conversations.prj_a, [{ role: "user", text: "Arată devizul DVZ-0001", at: 2 }, { role: "lega", text: "Devizul…", at: 3, links: [{ path: "/sales", label: "Vânzări" }], expiredOptions: true }]);
  assert.deepEqual(kept.conversations.company, [{ role: "lega", text: "Bună", at: 1 }]);
  assert.deepEqual(kept.drafts, { prj_a: "netrimis" });
  assert.deepEqual(restoredConversations(JSON.stringify(kept)), { legaConversations: kept.conversations, legaDrafts: kept.drafts });
  for (const bad of [null, "", "{", "[]", JSON.stringify({ v: 2, conversations: { a: [{ role: "user", text: "x" }] } })]) assert.deepEqual(restoredConversations(bad), { legaConversations: {}, legaDrafts: {} });
  const many = Object.fromEntries(Array.from({ length: PERSIST_MAX_CONVERSATIONS + 5 }, (_, i) => [`p${i}`, Array.from({ length: CONVERSATION_MAX + 9 }, (_, k) => ({ role: "user", text: `m${k}`, at: i * 1000 + k }))]));
  const bounded = persistedConversations(many, {});
  assert.equal(Object.keys(bounded.conversations).length, PERSIST_MAX_CONVERSATIONS);
  assert.ok(bounded.conversations[`p${PERSIST_MAX_CONVERSATIONS + 4}`] && !bounded.conversations.p0, "the most recently used conversations are kept");
  assert.equal(bounded.conversations.p16.length, CONVERSATION_MAX);
  // Two tabs: per project the newest conversation wins (never mixed); this tab's unsent text wins unless it has none.
  const a = { legaConversations: { p1: [{ role: "user", text: "a", at: 5 }], p2: [{ role: "user", text: "a2", at: 1 }] }, legaDrafts: { p1: "mine" } };
  const b = { legaConversations: { p1: [{ role: "user", text: "b", at: 3 }], p2: [{ role: "user", text: "b2", at: 9 }], p3: [{ role: "user", text: "b3", at: 2 }] }, legaDrafts: { p1: "theirs", p3: "t3" } };
  assert.deepEqual(mergeConversations(a, b), { legaConversations: { p1: a.legaConversations.p1, p2: b.legaConversations.p2, p3: b.legaConversations.p3 }, legaDrafts: { p1: "mine", p3: "t3" } });
});

test("M14-UI-03 locking the owner session forgets the kept conversations and unsent texts in this browser", async () => {
  const mem = new Map([[CONVERSATIONS_STORAGE_KEY, JSON.stringify(persistedConversations({ prj_a: [{ role: "user", text: "secret de firmă", at: 1 }] }, { prj_a: "netrimis" }))]]);
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const store = await import(`../web/src/store.js?m14=${Date.now()}`);
    assert.equal(store.getState().legaConversations.prj_a[0].text, "secret de firmă", "restored at load");
    store.forgetConversations();
    assert.deepEqual([store.getState().legaConversations, store.getState().legaDrafts], [{}, {}]);
    assert.equal(mem.has(CONVERSATIONS_STORAGE_KEY), false);
    const src = fs.readFileSync(path.join(here, "..", "web", "src", "lib", "ownerSession.js"), "utf8");
    const lock = src.split("\n").find((line) => line.startsWith("export const lockSession")) || "";
    assert.ok(lock.includes('api("/api/owner/logout"') && lock.includes("forgetConversations()"), "the lock forgets them");
  } finally { delete globalThis.localStorage; }
});

test("M14-UI-02 in a real browser (#/lega/<project>, local development profile): „Arată devizul DVZ-0001” / „… OPS-0001” open the existing records in the panel (nothing created); after a reload the conversation, the unsent text, the project and the opened record are back; the picker stays at 1000 px; at phone width (simulated 390×844) the interruptions stay on screen while scrolling, also in „Ecran complet”; no horizontal scroll", { timeout: 300000 }, async (c) => {
  assert.ok(browserStatus({ hubRoot: HUB_ROOT }).installed, "Playwright (cached Chromium) is required for the browser suites");
  assert.ok(fs.existsSync(path.join(WEB_DIST, "index.html")), `the UI build is required (HUB_V2_WEB_DIST → ${WEB_DIST})`);
  const t = await acceptanceHub({ seedProject: true, devProfile: () => ({ enabled: true, version: 1, id: "dev_m14ui", ...machineIdentity() }) });
  c.after(() => t.cleanup());
  t.exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: t.exportsDir }, "test", "Folderul de exporturi al testului"));
  await t.authenticate({ dev: true });
  await salesCommand(t, "sales.service.save", { name: "Programări online pe site", description: "Modul de programări (sintetic).", scope: ["Pagină de programare"], exclusions: ["Plata online"],
    materials: ["Programul de lucru", "Lista serviciilor"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true });
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
  const ops = await propose(t, "Pregătește dosarul de pornire a proiectului din oferta aprobată", "desk_ops_prepare");
  await confirmCard(t, ops.opsPlan);
  const opsRec = await settleRecord(t, ops.opsPlan.recordId);
  const fin = await propose(t, "Pregătește devizul din oferta aprobată", "desk_finance_prepare");
  await confirmCard(t, fin.opsPlan);
  const finRec = await settleRecord(t, fin.opsPlan.recordId);
  assert.deepEqual([opsRec.status, finRec.status], ["READY", "WAITING_OWNER"]);
  const counts = () => ["desk_records", "desk_artifacts", "desk_exports", "ops_plans", "approvals"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`));
  const before = counts();
  const pid = t.project.id;
  const base = `http://localhost:${t.config.port}`;
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const browser = await pw.chromium.launch(browserLaunchOptions(base));
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ro-RO" });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.setDefaultTimeout(20000);
    await page.goto(`${base}/#/lega/${pid}`);
    await page.locator(".lega-one").waitFor();
    await page.getByText(/sesiune deschisă/).first().waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    const conv = page.getByRole("list", { name: "Conversația cu Lega" });
    const desk = page.locator("section[aria-label='Birou intern']");
    await desk.waitFor();
    await composer.fill("Arată devizul DVZ-0001");
    await composer.press("Enter");
    await conv.getByText(/Devizul DVZ-0001 \(SINTETIC\): așteaptă decizia ta/).waitFor();
    const focused = desk.locator(".lega-desk-section.is-focused");
    await focused.getByText(/deschis la cererea ta/).waitFor();
    assert.match(await focused.innerText(), /DVZ-0001/);
    await composer.fill("Arată dosarul de pornire OPS-0001");
    await composer.press("Enter");
    await conv.getByText(/Dosarul de pornire a proiectului OPS-0001 \(SINTETIC\)/).waitFor();
    await page.waitForFunction(() => /OPS-0001/.test(document.querySelector(".lega-desk-section.is-focused")?.textContent || ""));
    assert.deepEqual(counts(), before, "the reads created nothing");
    // A reload: the conversation, the unsent text, the project and the opened record come back.
    await composer.fill("text netrimis M14");
    await page.waitForTimeout(500);
    await page.reload();
    await page.locator(".lega-one").waitFor();
    await conv.getByText("Arată devizul DVZ-0001", { exact: true }).waitFor();
    await conv.getByText(/Dosarul de pornire a proiectului OPS-0001 \(SINTETIC\)/).waitFor();
    assert.equal(await composer.inputValue(), "text netrimis M14");
    assert.equal(await page.locator(".lega-project-switch select").inputValue(), pid);
    await page.waitForFunction(() => /OPS-0001/.test(document.querySelector(".lega-desk-section.is-focused")?.textContent || ""));
    // The figure's views keep the conversation (one screen; no remount).
    const figure = page.getByRole("group", { name: "Forma Lega" });
    for (const name of ["Față", "Hartă", "Nucleu"]) await figure.getByRole("button", { name }).click();
    await conv.getByText("Arată devizul DVZ-0001", { exact: true }).waitFor();
    // A narrower window: the project picker of the Lega screen stays (the top bar's own picker may go).
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(200);
    assert.ok(await page.locator(".lega-project-switch select").isVisible(), "the project picker at 1000 px");
    // 768–900 px: the bar stays beside the rail (the rail's links are not covered).
    await page.setViewportSize({ width: 820, height: 800 });
    await page.waitForTimeout(200);
    const railRight = await page.evaluate(() => document.querySelector(".rail")?.getBoundingClientRect().right ?? 0);
    assert.ok((await page.locator(".interrupt-bar").boundingBox()).x >= railRight - 0.5, "the bar starts after the rail");
    // Phone width (simulated): the interruptions stay on screen at the top and at the bottom of the page, Stop All first.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const controls = page.getByRole("group", { name: "Întreruperi" });
    const inView = async (name) => {
      const b = await controls.getByRole("button", { name }).boundingBox();
      const vp = page.viewportSize();
      return Boolean(b) && b.y >= 0 && b.y + b.height <= vp.height + 0.5 && b.x >= -0.5 && b.x + b.width <= vp.width + 0.5;
    };
    for (const where of ["top", "bottom"]) {
      await page.evaluate((w) => { for (const el of [document.scrollingElement, ...document.querySelectorAll("main, .main, .app-main, .content")]) if (el) el.scrollTop = w === "top" ? 0 : el.scrollHeight; }, where);
      await page.waitForTimeout(200);
      assert.ok(await inView("Stop All"), `Stop All on screen (${where})`);
      assert.ok(await inView("Pauză"), `Pauză on screen (${where})`);
      assert.ok(await inView("Preiau eu"), `Preiau eu on screen (${where})`);
    }
    // Under the bar there is room: it never covers the bottom navigation.
    const navTop = await page.evaluate(() => document.querySelector(".bottom-nav")?.getBoundingClientRect().top ?? null);
    const barBox = await page.locator(".interrupt-bar").boundingBox();
    assert.ok(navTop !== null && barBox.y + barBox.height <= navTop + 0.5, `the bar ends above the bottom navigation (${barBox.y + barBox.height} vs ${navTop})`);
    assert.ok(barBox.height <= 132, `the page keeps room for the bar (${barBox.height} px)`);
    // Stop All's confirmation opens over the whole screen (the bar is not its containing block); „Renunță” stops nothing.
    await controls.getByRole("button", { name: "Stop All" }).click();
    const dialog = page.getByRole("dialog", { name: "Stop All" });
    await dialog.waitFor();
    const geo = await page.evaluate(() => { const o = document.querySelector(".overlay").getBoundingClientRect(); const d = document.querySelector("[role='dialog']").getBoundingClientRect(); return { o: [o.x, o.y, o.width, o.height], d: [d.x, d.y, d.width, d.height], vw: innerWidth, vh: innerHeight }; });
    assert.ok(geo.o[0] <= 0 && geo.o[1] <= 0 && geo.o[2] >= geo.vw && geo.o[3] >= geo.vh, `the dim layer covers the screen ${JSON.stringify(geo)}`);
    assert.ok(geo.d[0] >= 0 && geo.d[1] >= 0 && geo.d[0] + geo.d[2] <= geo.vw && geo.d[1] + geo.d[3] <= geo.vh, `the dialog is on screen ${JSON.stringify(geo)}`);
    assert.ok(await dialog.getByRole("button", { name: "Oprește tot" }).isVisible());
    await dialog.getByRole("button", { name: "Renunță" }).click();
    await dialog.waitFor({ state: "detached" });
    // The decision and the documents at phone width: reachable, and not under the interruption bar.
    const approve = desk.getByRole("button", { name: "Aprob devizul intern" });
    await page.getByRole("button", { name: "Cel mai nou" }).click();
    await approve.scrollIntoViewIfNeeded();
    const hit = await approve.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === top || el.contains(top); });
    assert.ok(hit, "the decision button is not covered");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll at 390 px");
    await page.getByRole("button", { name: "Ecran complet" }).click();
    await page.locator(".lega-one.is-immersive").waitFor();
    assert.ok(await inView("Stop All"), "Stop All on screen in „Ecran complet” on a phone");
    assert.ok(await inView("Pauză"), "Pauză on screen in „Ecran complet” on a phone");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(counts(), before, "nothing written by the screen");
  } finally { await browser.close(); }
});
