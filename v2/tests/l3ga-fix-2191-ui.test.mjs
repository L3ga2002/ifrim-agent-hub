// 2.19.1 — the L3ga screen after the owner's session of 2026-10-25: the company map readable, bigger and on the whole screen, the
// conversation minimizable, a department on that map, the wishlist panel. Pure view logic, then the real screen in the project's
// Playwright Chromium on a fresh synthetic Hub (fake providers, no model; needs the fresh UI build).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { acceptanceHub } from "./accept-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { browserLaunchOptions, browserStatus } from "../server/tools/browser.mjs";
import { MAP_CLOSED, MAP_ZOOM, nextMapState, normalizeMapState, viewChangesOf, viewFromLiveEvent, conversationShown, zoomLabel } from "../web/src/lib/legaMapView.js";
import { replyFor } from "../web/src/lib/cockpitLogic.js";
import { COMMAND_EXAMPLES } from "../web/src/lib/legaOneScreen.js";

test("L3-UI-01 map and conversation view state: „mărește” opens, fills the screen, then zooms; „micșorează” goes back; live events only from this session", () => {
  let s = MAP_CLOSED;
  s = nextMapState(s, "bigger"); assert.deepEqual(s, { open: true, full: false, zoom: 1 });
  s = nextMapState(s, "bigger"); assert.deepEqual(s, { open: true, full: true, zoom: 1 });
  s = nextMapState(s, "bigger"); assert.deepEqual(s, { open: true, full: true, zoom: 1.25 });
  for (let i = 0; i < 20; i += 1) s = nextMapState(s, "zoom_in");
  assert.equal(s.zoom, MAP_ZOOM.max);
  for (let i = 0; i < 6; i += 1) s = nextMapState(s, "smaller");
  assert.deepEqual(s, { open: true, full: true, zoom: 1 });
  s = nextMapState(s, "smaller"); assert.deepEqual(s, { open: true, full: false, zoom: 1 });
  s = nextMapState(s, "smaller"); assert.equal(s.zoom, 0.75); assert.equal(s.open, true);
  assert.equal(nextMapState(nextMapState(s, "zoom_out"), "zoom_out").zoom, MAP_ZOOM.min);
  assert.deepEqual(nextMapState(s, "reset"), { open: true, full: false, zoom: 1 });
  assert.deepEqual(nextMapState(s, "close"), MAP_CLOSED);
  assert.deepEqual(nextMapState(MAP_CLOSED, "full"), { open: true, full: true, zoom: 1 });
  assert.deepEqual(nextMapState(MAP_CLOSED, "smaller"), MAP_CLOSED, "nothing to make smaller");
  assert.deepEqual(nextMapState(MAP_CLOSED, "zoom_in"), MAP_CLOSED, "the wheel never opens the map");
  assert.deepEqual(nextMapState(s, "explode"), normalizeMapState(s));
  // Stored values: old, edited or broken ones never break the screen.
  assert.deepEqual(normalizeMapState(null), MAP_CLOSED);
  assert.deepEqual(normalizeMapState({ open: true, full: true, zoom: 99 }), { open: true, full: true, zoom: MAP_ZOOM.max });
  assert.deepEqual(normalizeMapState({ open: false, full: true, zoom: 2 }), MAP_CLOSED);
  assert.deepEqual(normalizeMapState({ open: true, zoom: "x" }), { open: true, full: false, zoom: 1 });
  assert.equal(zoomLabel({ open: true, zoom: 1.25 }), "125%");
  // The conversation: hidden on request, and minimized while the map fills the screen.
  assert.equal(conversationShown(MAP_CLOSED, false), true);
  assert.equal(conversationShown(MAP_CLOSED, true), false);
  assert.equal(conversationShown({ open: true, full: true, zoom: 1 }, false), false);
  // The Hub's answer → view changes (refused / failed results change nothing).
  assert.deepEqual(viewChangesOf([{ intent: "show_company" }, { intent: "map_view", mapView: { action: "bigger" } }, { intent: "chat_view", chatView: { hidden: true } }]), { map: ["open", "bigger"], chat: true });
  assert.deepEqual(viewChangesOf([{ intent: "map_view", mapView: { action: "bigger" }, refused: "nu" }, { intent: "chat_view", chatView: { hidden: "da" } }]), { map: [], chat: null });
  // Voice: only this tab's session, only the exact shapes.
  assert.deepEqual(viewFromLiveEvent({ type: "lega.view", sessionId: "s1", map: { action: "full" } }, "s1"), { map: "full" });
  assert.deepEqual(viewFromLiveEvent({ type: "lega.view", sessionId: "s1", chat: { hidden: false } }, "s1"), { chat: false });
  assert.equal(viewFromLiveEvent({ type: "lega.view", sessionId: "s2", map: { action: "full" } }, "s1"), null);
  assert.equal(viewFromLiveEvent({ type: "lega.view", sessionId: "s1", map: { action: "rm -rf" } }, "s1"), null);
  assert.equal(viewFromLiveEvent({ type: "lega.view", sessionId: "s1", map: { action: "full" } }, null), null);
  // An unknown sentence now names the wishlist; the help lists the new sentences.
  assert.match(replyFor({ resolved: { steps: [{ intent: "unknown" }], refused: [] }, results: [{}] }), /Pune asta pe wishlist/);
  for (const x of ["Mărește harta", "Ascunde chatul", "La vânzări", "Pune asta pe wishlist", "Ce e pe wishlist?"]) assert.ok(COMMAND_EXAMPLES.includes(x), x);
});

let pw;
try { pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); } catch { /* explicit skip below */ }
const skip = !pw || !browserStatus({ hubRoot: HUB_ROOT }).installed || !fs.existsSync(path.join(WEB_DIST, "index.html")) ? "Playwright (cached Chromium) or the built UI is missing" : false;
const until = async (fn, message) => { for (let i = 0; i < 200; i += 1) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(message); };
const work = (hub) => Object.fromEntries(["agent_runs", "mission_envelopes", "ops_plans", "approvals"].map((x) => [x, hub.db.prepare(`SELECT COUNT(*) AS n FROM ${x}`).get().n]));
const typed = async (page, text) => { const input = page.getByRole("textbox", { name: "Mesaj pentru Lega" }); await input.fill(text); await input.press("Enter"); };
/** Department cards outside the map, over L3ga or over each other (the M16 rule, on the L3ga screen's map). */
const overlaps = (page) => page.locator(".lega-map .radial-map").evaluate((map) => {
  const m = map.getBoundingClientRect(), core = map.querySelector(".radial-core").getBoundingClientRect();
  const cards = [...map.querySelectorAll(".department-node")].map((e) => ({ name: e.querySelector("strong")?.textContent, r: e.getBoundingClientRect() }));
  const cross = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const out = [];
  cards.forEach((a, i) => {
    if (a.r.left < m.left - 1 || a.r.right > m.right + 1 || a.r.top < m.top - 1 || a.r.bottom > m.bottom + 1) out.push(`${a.name} outside the map`);
    if (cross(a.r, core)) out.push(`${a.name} over L3ga`);
    for (const b of cards.slice(i + 1)) if (cross(a.r, b.r)) out.push(`${a.name} x ${b.name}`);
  });
  return { out, cards: cards.length, fits: m.bottom <= map.closest(".lega-map-viewport").getBoundingClientRect().bottom + 1 };
});

test("L3-UI-02 the L3ga screen: the map on screen, bigger, on the whole screen with the conversation minimized, a department on it, the wishlist; nothing decided", { skip, timeout: 300000 }, async () => {
  const profile = { enabled: true, version: 1, id: "dev_l3ga_2191", ...machineIdentity() };
  const t = await acceptanceHub({ devProfile: () => profile });
  let browser; const errors = [];
  try {
    const before = work(t.hub), origin = `http://localhost:${t.config.port}`;
    browser = await pw.chromium.launch({ ...browserLaunchOptions(origin) });
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ro-RO" })).newPage();
    page.setDefaultTimeout(20000); page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/#/lega`);
    await page.locator(".lega-one").waitFor();
    // 1. „Arată harta companiei”: the readable map (12 departments) on the screen, next to the conversation.
    await typed(page, "Arată harta companiei");
    await page.locator(".lega-map .department-node").first().waitFor();
    assert.equal(await page.locator(".lega-map .department-node").count(), 12);
    assert.equal(await page.locator(".lega-conv").isVisible(), true, "the conversation stays next to the map");
    // 2. „Poți să o mărești”: the map fills the screen and the conversation is minimized (the composer stays).
    await typed(page, "Poți să o mărești");
    await page.locator(".lega-one.is-map-full").waitFor();
    assert.equal(await page.locator(".lega-conv").count(), 0);
    assert.equal(await page.locator(".lega-conv-min").isVisible(), true);
    assert.equal(await page.locator(".lega-one-side").isVisible(), false);
    assert.equal(await page.getByRole("textbox", { name: "Mesaj pentru Lega" }).isVisible(), true);
    for (const [w, h] of [[1920, 1080], [1280, 800], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
      const r = await overlaps(page);
      assert.deepEqual(r.out, [], `full map ${w}x${h}: department cards must not overlap`); assert.equal(r.cards, 12);
      // From 1100 px the ring fits its panel at 100%; narrower, M16 shows the departments as a list the panel scrolls.
      if (w >= 1100) assert.equal(r.fits, true, `full map ${w}x${h} fits its panel at 100%`);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    // 3. „Mărește harta” zooms; the buttons and the wheel too.
    await typed(page, "Mărește harta");
    await until(async () => (await page.locator(".lega-map-zoom").innerText()) === "125%", "zoom 125% by words");
    await page.getByRole("button", { name: "Mărește harta" }).click();
    await until(async () => (await page.locator(".lega-map-zoom").innerText()) === "150%", "zoom 150% by the button");
    await page.locator(".lega-map-viewport").hover(); await page.mouse.wheel(0, 300);
    await until(async () => (await page.locator(".lega-map-zoom").innerText()) === "125%", "zoom 125% by the wheel");
    assert.equal(await page.locator(".lega-map-viewport").evaluate((e) => e.scrollWidth > e.clientWidth), true, "a zoomed map can be moved");
    // 4. „La vânzări”: the department opens on this map (the address stays the L3ga screen).
    await typed(page, "La vânzări");
    await until(async () => /Vânzări/.test(await page.locator(".lega-map-title").innerText()), "the Sales department on the map");
    assert.match(page.url(), /#\/lega/);
    await page.getByRole("button", { name: "‹ Toată compania" }).click();
    await page.locator(".lega-map .department-node").first().waitFor();
    // 5. „Arată conversația”: the conversation is back, the map stays open next to it.
    await typed(page, "Arată conversația");
    await page.locator(".lega-conv").waitFor();
    assert.equal(await page.locator(".lega-one.is-map-full").count(), 0); assert.equal(await page.locator(".lega-map").isVisible(), true);
    // 6. The wishlist: said, shown in its panel, marked done there.
    await typed(page, "Pune pe wishlist: mărirea hărții cu rotița");
    const item = page.locator(".wishlist-panel .wishlist-list li", { hasText: "mărirea hărții cu rotița" });
    await item.waitFor();
    await item.getByRole("button", { name: /Marchează ca făcut/ }).click();
    await until(async () => (await page.locator(".wishlist-panel .wishlist-list:not(.is-done) li").count()) === 0, "done leaves the open list");
    assert.deepEqual(t.hub.wishlist.list().map((x) => [x.text, x.status, x.source]), [["mărirea hărții cu rotița", "DONE", "typed"]]);
    // 7. The M16 screen named with the quotes copied from the acceptance steps.
    await typed(page, "„L3ga, mod comandă”");
    await until(async () => /#\/comanda/.test(page.url()), "Mod Comandă opens");
    assert.deepEqual(work(t.hub), before, "nothing started, planned or approved");
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await t.cleanup(); }
});
