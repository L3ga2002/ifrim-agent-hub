// One L3ga screen (2026-10-18): #/lega is the one Lega interface — the company map behind, Lega's figure (Nucleu / Față / Hartă,
// discret, ascunsă), the conversation, the voice panel (the top bar's one session, rendered in the screen), the controls and the plan /
// decision / result cards. Pure checks of the continuity helpers, static checks of what must not come back (a modal stage, a second
// audio capture), and ONE real-browser flow on a fully synthetic Hub (Playwright + the cached Chromium, the local development profile —
// PASS_SIMULATED, never Windows Hello, never the live Hub): the M12 offer prepared, confirmed and approved from this screen.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WEB_DIST } from "./helpers.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { prepHub, settlePreparation, countRows } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { conversationKey, conversationOf, withConversation, draftOf, withDraft, exchangeProject, CONVERSATION_MAX } from "../web/src/lib/legaConversation.js";
import { salesOppFromPath, offerToShow, screenActivity, decisionsReload, COMMAND_EXAMPLES } from "../web/src/lib/legaOneScreen.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(here, "..");
const HUB_ROOT = path.resolve(V2, "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");

test("R-LEGA-ONE-01 the conversation and the unsent text are kept per project: separate histories, bounded, never merged", () => {
  assert.equal(conversationKey(""), "company");
  assert.equal(conversationKey(null), "company");
  assert.equal(conversationKey("prj_a"), "prj_a");
  let map = {};
  map = withConversation(map, "prj_a", (c) => [...c, { role: "user", text: "a1" }]);
  map = withConversation(map, "prj_b", (c) => [...c, { role: "user", text: "b1" }]);
  map = withConversation(map, "", (c) => [...c, { role: "user", text: "co1" }]);
  const before = map.prj_b;
  map = withConversation(map, "prj_a", (c) => [...c, { role: "lega", text: "a2" }]);
  assert.deepEqual(conversationOf(map, "prj_a").map((m) => m.text), ["a1", "a2"]);
  assert.deepEqual(conversationOf(map, "prj_b").map((m) => m.text), ["b1"], "another project's history is untouched");
  assert.equal(map.prj_b, before, "the same object: never rebuilt, never merged");
  assert.deepEqual(conversationOf(map, null).map((m) => m.text), ["co1"]);
  assert.equal(conversationOf(map, "prj_x"), conversationOf({}, "prj_y"), "an empty history is one stable value (no re-render loop)");
  for (let i = 0; i < 100; i += 1) map = withConversation(map, "prj_a", (c) => [...c, { role: "user", text: `n${i}` }]);
  assert.equal(conversationOf(map, "prj_a").length, CONVERSATION_MAX);
  assert.equal(conversationOf(map, "prj_a").at(-1).text, "n99");
  let drafts = withDraft({}, "prj_a", "netrimis A");
  drafts = withDraft(drafts, "", "netrimis companie");
  assert.equal(draftOf(drafts, "prj_a"), "netrimis A");
  assert.equal(draftOf(drafts, "prj_b"), "");
  assert.equal(draftOf(drafts, ""), "netrimis companie");
  drafts = withDraft(drafts, "prj_a", "");
  assert.equal(Object.hasOwn(drafts, "prj_a"), false, "a sent (emptied) text leaves no entry");
  assert.equal(draftOf(withDraft({}, "p", "x".repeat(5000)), "p").length, 4000);
  // „Hai să lucrăm la X” from the company view: the project the answer opens (it gets one neutral line; the exchange stays where it was asked).
  assert.equal(exchangeProject("", [{ intent: "open_project", navigate: "/cockpit/prj_b" }]), "prj_b");
  assert.equal(exchangeProject("prj_a", [{ navigate: "/sales?tab=opp&id=o" }]), "prj_a");
  assert.equal(exchangeProject("prj_a", []), "prj_a");
});

test("R-LEGA-ONE-02 the screen's panels: the offer it shows, the activity line from real data only, the decisions reload", () => {
  assert.equal(salesOppFromPath("/sales?tab=opp&id=sop_1"), "sop_1");
  assert.equal(salesOppFromPath("/sales?tab=org&id=sor_1"), null);
  assert.equal(salesOppFromPath("/sales?tab=opp&id=../x"), null);
  assert.equal(salesOppFromPath(null), null);
  const items = [{ kind: "software_bundle", id: "b" }, { kind: "sales_offer", id: "spr_1", opportunityId: "sop_1" }, { kind: "sales_offer", id: "spr_2", opportunityId: "sop_2" }];
  assert.equal(offerToShow({ items }), "sop_1", "the waiting offer comes on screen by itself");
  assert.equal(offerToShow({ items, dismissed: ["sop_1"] }), "sop_2", "a dismissed one is not forced back");
  assert.equal(offerToShow({ items, dismissed: ["sop_1", "sop_2"] }), null, "two dismissed offers never take turns coming back");
  assert.equal(offerToShow({ items, current: "sop_9" }), "sop_9", "the one the owner opened stays");
  assert.equal(offerToShow({ items: [] }), null);
  assert.equal(screenActivity({ error: new Error("x") }).tone, "error");
  assert.equal(screenActivity({ busy: true }).text, "Procesez cererea ta…");
  assert.equal(screenActivity({ legaStatus: "active", legaPhase: "listening" }).text, "Lega te ascultă");
  assert.equal(screenActivity({ legaStatus: "active", legaPhase: "speaking" }).text, "Lega vorbește");
  assert.equal(screenActivity({ legaStatus: "active", legaPhase: "user-speaking" }).text, "Te aud");
  assert.equal(screenActivity({ legaStatus: "connecting" }).tone, "info");
  assert.equal(screenActivity({ planWaiting: true, decisions: 2 }).text, "Un plan așteaptă confirmarea ta");
  assert.equal(screenActivity({ decisions: 1 }).text, "O decizie așteaptă");
  assert.equal(screenActivity({ runs: 2 }).text, "2 execuții rulează");
  assert.equal(screenActivity({}).tone, "neutral");
  for (const type of ["approval.decided", "sales.proposal.approved", "factory.bundle", "ops.plan.confirmed"]) assert.ok(decisionsReload({ type }), type);
  assert.equal(decisionsReload({ type: "run.activity" }), false);
  assert.ok(COMMAND_EXAMPLES.length >= 10 && COMMAND_EXAMPLES.some((x) => /ofertă demonstrativă/.test(x)));
});

test("R-LEGA-ONE-03 static: no modal stage, one audio capture owner, the voice panel docked as a portal of the same component", () => {
  const shell = source("web/src/shell/Shell.jsx");
  assert.doesNotMatch(shell, /<LegaStage /, "the full-screen modal is retired");
  assert.match(shell, /if \(stageOpen && !prev\.open && route\.name !== "lega"\) go\("\/lega"\);/, "„Ecran complet” elsewhere opens #/lega");
  assert.match(shell, /else if \(stageOpen && prev\.open && prev\.route === "lega" && route\.name !== "lega"\) setState\(\{ stageOpen: false \}\);/, "leaving #/lega ends it");
  const stage = source("web/src/screens/stage/LegaStage.jsx");
  assert.doesNotMatch(stage, /export function LegaStage\(/);
  assert.match(stage, /export function StageCanvas\(/);
  // The screen and its panels never open a microphone or a peer: the shell's Lega owns the one session; the screen only offers a place.
  for (const rel of ["web/src/screens/Lega.jsx", "web/src/screens/lega/OneScreen.jsx", "web/src/screens/stage/LegaStage.jsx", "web/src/lib/legaConversation.js", "web/src/lib/legaOneScreen.js"]) {
    assert.doesNotMatch(source(rel), /getUserMedia|RTCPeerConnection|new Audio\(/, rel);
  }
  const lega = source("web/src/shell/Lega.jsx");
  assert.match(lega, /const docked = dockEl \? createPortal\(/);
  assert.equal((lega.match(/getUserMedia\(/g) || []).length, 1, "one microphone request in the session owner");
  assert.equal((lega.match(/<audio /g) || []).length, 1, "one player");
  assert.match(lega, /if \(getState\(\)\?\.voicePhase && getState\(\)\.voicePhase !== "idle"\) throw new Error/, "no Lega session while the push-to-talk button holds the microphone");
  assert.match(source("web/src/shell/Voice.jsx"), /if \(lega && lega !== "off"\) \{ setResult\(/, "no push-to-talk capture while Lega's session holds the microphone");
  const screen = source("web/src/screens/Lega.jsx");
  assert.match(screen, /const conversation = useHub\(\(s\) => conversationOf\(s\.legaConversations, pid\)\);/, "the conversation outlives the screen component");
  assert.match(screen, /const text = useHub\(\(s\) => draftOf\(s\.legaDrafts, pid\)\);/, "so does the unsent text");
  assert.match(screen, /<div className="lega-voice-dock" ref=\{dockRef\} \/>/);
  // An answer's choice and blocker buttons are offered only by the screen that received them (never replayed after a remount).
  assert.match(screen, /\{m\.mount === mountRef\.current && m\.clarification\?\.options\?\.length > 0 &&/);
  assert.match(screen, /\{m\.mount === mountRef\.current && m\.blocker\?\.options\?\.length > 0 &&/);
  // Esc is decided before a dialog's own handler (capture) and never while a dialog or the help is open.
  assert.match(screen, /window\.addEventListener\("keydown", onKey, true\);/);
  // The controls keep their old commands and authority: the same /api/owner/interrupt kinds and the same Stop All.
  for (const kind of ["mute", "pause", "stop_worker", "freeze", "takeover"]) assert.match(screen, new RegExp(`interrupt\\("${kind}"`), kind);
  assert.match(screen, /<StopAllButton compact \/>/);
  // 2.15.4: the full screen is remembered per browser (a view preference) and a voice plan no longer leaves it.
  assert.match(screen, /const \[fullPref, setFullPref\] = usePref\("lega\.fullscreen", null\);/);
  assert.doesNotMatch(lega, /if \(fx\.closeStage\) setState\(\{ stageOpen: false \}\);/);
});

test("R-LEGA-ONE-04 in a real browser: the M12 offer prepared, confirmed and approved from the one Lega screen; views, „Ecran complet” and visits keep the conversation and the unsent text; no duplicate request or plan; narrow window", { timeout: 300000 }, async (c) => {
  assert.ok(browserStatus({ hubRoot: HUB_ROOT }).installed, "Playwright (cached Chromium) is required for the browser suites");
  assert.ok(fs.existsSync(path.join(WEB_DIST, "index.html")), `the UI build is required (HUB_V2_WEB_DIST → ${WEB_DIST})`);
  // The local development profile: the page opens the owner session by itself (recorded as local_dev_profile, never Windows Hello).
  const t = await prepHub(c, { devProfile: () => ({ enabled: true, version: 1, id: "dev_legaone", ...machineIdentity() }) });
  const base = `http://localhost:${t.config.port}`;
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const browser = await pw.chromium.launch(browserLaunchOptions(base));
  const pageErrors = [];
  const foreign = [];
  const commands = (type) => countRows(t, "SELECT COUNT(*) AS n FROM commands WHERE type = ?", type);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ro-RO" });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.on("request", (r) => { const u = new URL(r.url()); if (!["data:", "blob:"].includes(u.protocol) && u.origin !== base) foreign.push(r.url()); });
    page.setDefaultTimeout(20000);
    await page.goto(`${base}/#/lega`);
    const screen = page.locator(".lega-one");
    await screen.waitFor();
    await page.getByText(/sesiune deschisă/).first().waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    // One voice panel, inside the screen; no modal stage, no floating panel; the map is the screen's background.
    assert.equal(await page.locator("#lega-panel").count(), 1);
    assert.equal(await page.locator(".lega-one .lega-voice-dock #lega-panel").count(), 1);
    assert.equal(await page.locator(".lega-stage").count(), 0);
    assert.equal(await page.locator("canvas.lega-one-map").count(), 1);
    assert.equal(await page.locator("audio").count(), 1, "one player for Lega's voice");
    // The controls, each reachable in one click: Taci, Pauză, Oprește agentul, Stop All (Îngheață / Preiau eu belong to an open project).
    const controls = page.getByRole("group", { name: "Întreruperi" });
    for (const name of ["Taci", "Pauză", "Oprește agentul", "Stop All"]) assert.ok(await controls.getByRole("button", { name }).isVisible(), name);
    for (const name of ["Nucleu", "Față", "Hartă", "Discret", "Ascunde"]) assert.ok(await page.getByRole("group", { name: "Forma Lega" }).getByRole("button", { name }).isVisible(), name);
    // The command examples live in the help, not in the work area; one click fills the composer and sends nothing.
    await page.getByRole("button", { name: "Exemple de comenzi" }).click();
    await page.getByRole("dialog", { name: "Exemple de comenzi" }).getByRole("button", { name: "Ce decizii am?" }).click();
    assert.equal(await composer.inputValue(), "Ce decizii am?");
    assert.equal(commands("owner.intent"), 0, "an example is never sent by itself");

    // Continuity: the unsent text survives every view, „Ecran complet” (button and Esc), a visit elsewhere and back.
    await composer.fill("text încă netrimis");
    const figure = page.getByRole("group", { name: "Forma Lega" });
    for (const name of ["Față", "Hartă", "Discret", "Ascunde"]) await figure.getByRole("button", { name }).click();
    await page.getByRole("button", { name: "Arată fața" }).click();
    await figure.getByRole("button", { name: "Nucleu" }).click();
    await page.getByRole("button", { name: "Ecran complet" }).click();
    await page.locator(".lega-one.is-immersive").waitFor();
    assert.equal(await composer.inputValue(), "text încă netrimis");
    assert.ok(await page.getByRole("group", { name: "Întreruperi" }).getByRole("button", { name: "Stop All" }).isVisible(), "the emergency stop stays reachable in the full screen");
    await page.locator(".lega-one-activity").click();
    await page.keyboard.press("Escape");
    await page.locator(".lega-one.is-immersive").waitFor({ state: "detached" });
    await page.evaluate(() => { window.location.hash = "/control"; });
    await page.locator(".lega-one").waitFor({ state: "detached" });
    await page.evaluate(() => { window.location.hash = "/lega"; });
    await composer.waitFor();
    assert.equal(await composer.inputValue(), "text încă netrimis", "the unsent text is back with the screen");

    // The M12 request, typed in the screen: ONE plan card, here; Lega's answer in the conversation.
    await composer.fill("L3ga, pregătește o ofertă demonstrativă pentru un service auto fictiv care vrea programări online. Pregătește dosarul și o ciornă de contact, fără trimitere sau publicare. Prețul și termenul rămân de stabilit.");
    await composer.press("Enter");
    const work = page.locator(".lega-one .cockpit-main");
    const confirm = work.getByRole("button", { name: "Confirmă planul" });
    await confirm.waitFor();
    assert.equal(commands("owner.intent"), 1);
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1, "ONE card");
    const conv = page.locator(".lega-conv li");
    await page.waitForFunction(() => document.querySelectorAll(".lega-conv li.lc-lega").length >= 1);
    const lines = await conv.count();
    // Views, the full screen, a visit elsewhere: no second request, no second plan, the same conversation.
    for (const name of ["Față", "Hartă", "Nucleu"]) await figure.getByRole("button", { name }).click();
    await page.keyboard.press("Alt+j");
    await page.locator(".lega-one.is-immersive").waitFor();
    await page.getByRole("button", { name: "Ieși din ecran complet" }).click();
    await page.evaluate(() => { window.location.hash = "/missions"; });
    await page.locator(".lega-one").waitFor({ state: "detached" });
    await page.evaluate(() => { window.location.hash = "/lega"; });
    await confirm.waitFor();
    assert.equal(await conv.count(), lines, "the conversation is the same, not doubled");
    assert.equal(commands("owner.intent"), 1, "no request sent again");
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1, "no plan created again");

    // Decision 1 (the owner's): the plan's one confirmation, on this screen. Then the preparation waits for the owner.
    await confirm.click();
    const prepId = () => t.hub.db.prepare("SELECT id FROM sales_preparations ORDER BY created_at DESC LIMIT 1").get()?.id;
    for (let i = 0; i < 200 && !(prepId() && t.hub.salesPreparations.get(prepId())?.status === "WAITING_OWNER"); i += 1) await page.waitForTimeout(100);
    const prep = t.hub.salesPreparations.get(prepId());
    assert.equal(prep.status, "WAITING_OWNER", prep.statusReason);
    // The pending decision is on the screen: in „Decizii” (full SHA) and as the offer card with its exact target and „Aprob intern”.
    const decisions = page.getByRole("region", { name: "Decizii și execuții" }).or(page.locator("section[aria-label='Decizii și execuții']"));
    await decisions.getByText("Ofertă de aprobat").first().waitFor();
    assert.ok((await decisions.innerText()).includes(prep.awaited.proposalSha), "the full SHA in the decisions");
    const offer = work.locator("section.panel", { hasText: "Ținta exactă: oferta" }).first();
    await offer.waitFor();
    const offerText = await offer.innerText();
    assert.ok(offerText.includes(prep.awaited.proposalId) && offerText.includes(prep.awaited.proposalSha), "the exact target: id + full SHA");
    assert.match(offerText, /De stabilit/, "price and term stay „De stabilit”");
    // Decision 2 (the owner's): „Aprob intern” for exactly that id + SHA, from this screen. The dossier phase follows by itself.
    await offer.getByRole("button", { name: "Aprob intern" }).click();
    for (let i = 0; i < 300 && t.hub.salesPreparations.get(prep.id).status !== "READY"; i += 1) { await settlePreparation(t, prep.id); await page.waitForTimeout(100); }
    const done = t.hub.salesPreparations.get(prep.id);
    assert.equal(done.status, "READY", done.statusReason);
    const result = work.locator("section.panel", { hasText: "Pregătirea ofertei și dosarul" }).first();
    await result.getByText("Dosarul e gata").waitFor();
    const resultText = await result.innerText();
    const dossier = t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0];
    assert.ok(resultText.includes(dossier.manifestSha256), "the full manifest SHA, on this screen");
    assert.match(resultText, /DRAFT_ONLY, netrimisă/);
    assert.match(resultText, /APP_NOT_RUN/, "Word did not run here: said so");
    assert.match(resultText, /sesiune locală de dezvoltare/i, "the authority said truthfully (never Windows Hello)");
    // Nothing sent, published or handed over; no commercial state; exactly the owner's two product decisions.
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_handoffs"), 0);
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM missions"), 0);
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','WON')"), 0);
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'sales.proposal.approved'"), 1);
    assert.equal(commands("ops.plan.confirm"), 1, "one plan confirmation");

    // „Ecran complet” over the Hub's bars: the bars behind it are hidden; the command palette (Ctrl+K) opens ON TOP of it; Esc closes a
    // dialog opened from the screen (Stop All) without leaving the full screen; a short window keeps the controls in view.
    await page.getByRole("button", { name: "Ecran complet" }).click();
    await page.locator(".lega-one.is-immersive").waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".topbar")).visibility), "hidden", "the top bar is not focusable behind the full screen");
    await page.locator(".lega-one-activity").click();
    await page.keyboard.press("Control+k");
    const palette = page.locator(".overlay .palette");
    await palette.waitFor();
    const onTop = await page.evaluate(() => { const r = document.querySelector(".overlay .palette").getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return Boolean(el?.closest(".palette")); });
    assert.ok(onTop, "the palette is above the full screen");
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
    await page.getByRole("group", { name: "Întreruperi" }).getByRole("button", { name: "Stop All" }).click();
    const stopDialog = page.getByRole("dialog", { name: "Stop All" });
    await stopDialog.waitFor();
    await page.keyboard.press("Escape");
    await stopDialog.waitFor({ state: "detached" });
    await page.waitForTimeout(200);
    assert.ok(await page.locator(".lega-one.is-immersive").isVisible(), "Esc closed the dialog only; the full screen stays");
    assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'system.stop_all'"), 0, "the dialog was only opened, never confirmed");
    await page.setViewportSize({ width: 1280, height: 650 });
    await page.waitForTimeout(300);
    const inView = await page.evaluate(() => [...document.querySelectorAll(".lega-one .interrupt-bar button, .lega-one .lega-composer input")].every((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0; }));
    assert.ok(inView, "1280x650 full screen: the composer and every control are in view without scrolling");
    // 2.15.4: the full screen is remembered in this browser: a reload comes back to it; leaving it (Esc) is remembered too.
    await page.reload();
    await page.locator(".lega-one.is-immersive").waitFor();
    await page.locator(".lega-one-activity").click();
    await page.keyboard.press("Escape");
    await page.locator(".lega-one.is-immersive").waitFor({ state: "detached" });
    await page.reload();
    await page.locator(".lega-one").waitFor();
    await page.waitForTimeout(800);
    assert.equal(await page.locator(".lega-one.is-immersive").count(), 0, "left by the owner: stays left after a reload");
    // A narrow window: one column, no horizontal page scroll, the composer and the emergency stop still reachable.
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForTimeout(300);
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth, main: document.getElementById("main").scrollWidth, mainView: document.getElementById("main").clientWidth }));
    assert.ok(w.scroll <= w.view + 1 && w.main <= w.mainView + 1, `no horizontal scroll at 800 px: ${JSON.stringify(w)}`);
    await composer.scrollIntoViewIfNeeded();
    assert.ok(await composer.isVisible());
    assert.ok(await page.getByRole("group", { name: "Întreruperi" }).getByRole("button", { name: "Stop All" }).isVisible());
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
    assert.ok(m.scroll <= m.view + 1, `no horizontal scroll at 360 px: ${JSON.stringify(m)}`);
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(foreign, [], "the page requested nothing outside the local test Hub");
    await context.close();
  } finally {
    await browser.close();
  }
  t.assertPaths();
});
