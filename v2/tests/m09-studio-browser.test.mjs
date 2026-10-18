// Milestone 09 — the Content Studio in a REAL browser (Playwright + the cached Chromium, OS sandbox on) against a throwaway test
// Hub on a free local port that serves the Studio build made for this test (HUB_V2_STUDIO_DIST or .ifrim/tmp/m09-web-dist-studio;
// the live Hub's v2/web/dist is never rebuilt or used). Synthetic content only: one content project, and — when ffmpeg/ffprobe
// are on the machine — two generated clips, an edit plan and a local draft render. No model, no network, nothing published.
// PASS_LOCAL when Playwright is installed and the build exists; SKIPPED_ENV otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, tempDir, waitFor } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const STUDIO_DIST = process.env.HUB_V2_STUDIO_DIST ? path.resolve(process.env.HUB_V2_STUDIO_DIST) : path.join(HUB_ROOT, ".ifrim", "tmp", "m09-web-dist-studio");
const installed = browserStatus({ hubRoot: HUB_ROOT }).installed;
const skip = !installed ? "SKIPPED_ENV: Playwright is not installed"
  : !fs.existsSync(path.join(STUDIO_DIST, "index.html")) ? `SKIPPED_ENV: the Studio build is missing (${STUDIO_DIST})` : false;

const made = [];
test.afterEach(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a file still open on Windows */ } } });
const dispatch = (hub, type, payload) => hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test" }).then((r) => r.result ?? r);
const setPolicy = (hub, patch) => hub.bus.transaction(() => hub.settings.set("mediaPolicy", { ...hub.settings.get("mediaPolicy"), ...patch }, "test"));
const STUDIO_TABS = ["board", "project", "library", "command", "platforms", "analytics"];

async function startHub(launchers) {
  const t = await makeTestHub({ configOverrides: { webDist: STUDIO_DIST, ...(launchers.available ? { mediaTools: { launcher: launchers } } : {}) } });
  const { server } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${t.config.port}`;
  return { ...t, base, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("M09-SB-01 Content Studio in a real browser: renders without console errors, keyboard tabs, board shows the project, detail shows the limitations, timeline + player deep link, no microphone, no horizontal scroll at 360 px", { skip, timeout: 240000 }, async (ctx) => {
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const launchers = realLaunchers();
  const s = await startHub(launchers);
  const browser = await pw.chromium.launch(browserLaunchOptions(s.base));
  const consoleErrors = [];
  const pageErrors = [];
  const foreign = [];
  try {
    // ---------- synthetic seed ----------
    const project = await dispatch(s.hub, "content.project.create", { fields: { title: "Demo Studio (SINTETIC)", format: "short", platforms: ["instagram", "youtube"], responsible: "Cătălin" } });
    const projectId = project.id;
    assert.match(projectId, /^cpr_/);
    let editVersionId = null;
    let rendered = false;
    if (launchers.available) {
      const inbox = path.join(tempDir("m09-studio-inbox"), "inbox");
      made.push(path.dirname(inbox));
      makeSyntheticMedia(inbox, { name: "a.mp4", seconds: 2, width: 640, height: 360 });
      makeSyntheticMedia(inbox, { name: "b.mp4", seconds: 2, width: 640, height: 360 });
      setPolicy(s.hub, { importRoots: [inbox], diskReserveGb: 0, interactivePriority: false });
      await dispatch(s.hub, "media.tools.pin", {}); // M10.2: renders need pinned tools; pinning is an explicit act
      const imp = (name) => dispatch(s.hub, "media.asset.import", { sourcePath: path.join(inbox, name), title: name, category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: projectId });
      const a = await imp("a.mp4");
      const b = await imp("b.mp4");
      const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 360, height: 640, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
        tracks: [
          { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: a.version.id, sourceIn: 0, sourceOut: 30, start: 0, label: "SIMULATION" }, { id: "c2", assetVersionId: b.version.id, sourceIn: 0, sourceOut: 30, start: 30, label: "SIMULATION" }] },
          { id: "t1", kind: "text", items: [{ id: "x1", start: 0, end: 60, text: "Demonstrație pe date de test", style: "label", anchor: "top", x: 0.5, y: 0.08 }] },
        ],
        markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Studio", labels: ["SIMULATION"], author: "test", notes: "" } };
      const edit = await dispatch(s.hub, "media.edit.create", { contentProjectId: projectId, title: "Montaj test", ir });
      editVersionId = edit.version.id;
      const job = await dispatch(s.hub, "media.render.request", { editVersionId, profile: "draft" });
      await waitFor(() => ["DONE", "FAILED"].includes(s.hub.media.render.get(job.id)?.status), 120000, 200);
      rendered = s.hub.media.render.get(job.id).status === "DONE";
    } else {
      ctx.diagnostic("SKIPPED_ENV (partial): ffmpeg/ffprobe absent — the timeline/player part is not exercised");
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ro-RO" });
    // The Studio must never ask for the microphone or start a recording: count any attempt.
    await context.addInitScript(() => {
      window.__micCalls = 0;
      const md = navigator.mediaDevices;
      if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = (...args) => { window.__micCalls += 1; return orig(...args); }; }
      if (window.MediaRecorder) { const Orig = window.MediaRecorder; window.MediaRecorder = function (...args) { window.__micCalls += 1; return new Orig(...args); }; }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("request", (r) => { const u = new URL(r.url()); if (!["data:", "blob:"].includes(u.protocol) && u.origin !== s.base) foreign.push(r.url()); });
    page.setDefaultTimeout(15000);
    const go = async (hash) => { await page.evaluate((h) => { window.location.hash = h; }, hash); };
    const settle = async () => { await page.waitForFunction(() => !document.querySelector("#studio-panel .skeleton")); await page.waitForTimeout(150); };
    // Optional screenshots for a visual review (M09_STUDIO_SHOTS=<folder>); nothing is written otherwise.
    const shot = async (name) => { if (process.env.M09_STUDIO_SHOTS) { fs.mkdirSync(process.env.M09_STUDIO_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.M09_STUDIO_SHOTS, `${name}.png`), fullPage: true }); } };

    // ---------- 1. board: the project is on the Kanban (IDEAS), the header shows the limitations ----------
    await page.goto(`${s.base}/#/studio`);
    await page.getByRole("heading", { name: "Content Studio" }).waitFor();
    const card = page.locator(".studio-col", { has: page.locator("#col-IDEAS") }).getByRole("link", { name: "Demo Studio (SINTETIC)" });
    await card.waitFor();
    assert.equal(await page.locator(".studio-col").count(), 10, "ten Kanban columns IDEAS…ANALYTICS");
    assert.ok(await page.locator(".studio-limits.compact").getByText("LIVE_UPLOAD_DISABLED").count() >= 1, "the header lists the active limitations");
    assert.equal(await page.locator(".studio-card .meter").count(), 0, "no percentage without a measured one");
    await page.locator(".studio-card", { hasText: "Demo Studio (SINTETIC)" }).getByText(/din 9 fapte verificate/).waitFor();

    // ---------- 2. tabs: keyboard navigation (arrows, Home, End) like Pilot ----------
    await page.locator("#studio-tab-board").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator('#studio-tab-project[aria-selected="true"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "studio-tab-project", "focus follows the selected tab");
    await page.keyboard.press("End");
    await page.locator('#studio-tab-analytics[aria-selected="true"]').waitFor();
    await page.keyboard.press("Home");
    await page.locator('#studio-tab-board[aria-selected="true"]').waitFor();
    assert.equal(await page.locator('[role="tab"][aria-selected="true"][tabindex="0"]').count(), 1, "roving tabindex: one tab in the tab order");

    await shot("01-board");
    // ---------- 3. project detail: limitations as notices, keyboard sub-tabs ----------
    await page.locator(".studio-col", { has: page.locator("#col-IDEAS") }).getByRole("link", { name: "Demo Studio (SINTETIC)" }).click();
    await page.locator(".studio-project-title", { hasText: "Demo Studio (SINTETIC)" }).waitFor();
    const limits = page.locator(".studio-project .studio-limits");
    for (const code of ["VOICE_FILTER_OFF", "LIVE_MEDIA_CAPTURE_DISABLED", "LIVE_UPLOAD_DISABLED", "AUTO_PUBLISH_OFF"]) await limits.getByText(code).first().waitFor();
    await limits.getByText("Nimic nu se publică automat.").waitFor();
    await page.locator("#studio-sub-concept").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator('#studio-sub-evidence[aria-selected="true"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "studio-sub-evidence");
    await page.getByRole("heading", { name: "Afirmații și dovezi" }).waitFor();
    // Distribution says why there is no upload button.
    await page.locator("#studio-sub-distribution").click();
    await page.getByText("Încărcarea prin API nu este disponibilă").waitFor();
    assert.equal(await page.getByRole("button", { name: /Publică|Încarcă pe/ }).count(), 0, "no publish/upload button anywhere");

    // ---------- 4. timeline + player deep link (?t=) with the synthetic render ----------
    if (editVersionId) {
      await go(`/studio/${projectId}?t=1.5`);
      await page.locator('#studio-sub-timeline[aria-selected="true"]').waitFor();
      await page.locator(".studio-timeline").waitFor();
      assert.ok(await page.locator(".studio-item.item-clip.has-badge", { hasText: "SIMULATION" }).count() >= 2, "clips carry their capture label");
      await page.getByRole("textbox", { name: "Corectură la timecode" }).waitFor();
      if (rendered) {
        const src = await page.locator("video.studio-video").getAttribute("src");
        assert.match(src || "", /^\/api\/media\/files\/[A-Za-z0-9_-]+$/);
        const range = await page.evaluate(async (u) => { const r = await fetch(u, { headers: { Range: "bytes=0-99" } }); return { status: r.status, len: (await r.arrayBuffer()).byteLength }; }, src);
        assert.deepEqual(range, { status: 206, len: 100 }, "the player's source streams with HTTP Range");
        // The deep link prefilled the correction time (00:01.15 at 30 fps); the timecode display follows the player.
        await page.waitForFunction(() => /00:01\.15/.test(document.querySelector(".studio-tc")?.textContent || ""));
        assert.equal(await page.getByRole("textbox", { name: "Corectură la timecode" }).inputValue(), "00:01.15");
      }
      // Clicking a timeline item seeks: the second clip starts at frame 30 = 00:01.00 (the correction time follows the player).
      await page.locator(".studio-item.item-clip").nth(1).click();
      await page.waitForFunction(() => document.querySelector("#studio-sub-panel input.mono")?.value === "00:01.00");
      // A correction at that time is only a PROPOSAL: shown with its operations, nothing applied, the version unchanged.
      const versionsBefore = s.hub.db.prepare("SELECT COUNT(*) AS n FROM media_edit_versions").get().n;
      await page.getByRole("textbox", { name: "Ce trebuie schimbat" }).fill("textul acoperă butonul, mută-l mai sus");
      await page.getByRole("button", { name: "Propune corectura" }).click();
      await page.locator(".studio-proposal").getByText("Propunere (neaplicată)").waitFor();
      assert.ok(await page.getByRole("button", { name: "Aplică (versiune nouă)" }).count() + await page.locator(".studio-proposal .notice").count() >= 1, "either an applicable patch or a clarification is shown");
      const review = s.hub.db.prepare("SELECT status, timecode_ms FROM media_reviews ORDER BY created_at DESC LIMIT 1").get();
      assert.equal(review.status, "OPEN");
      assert.equal(review.timecode_ms, 1000, "the proposal carries the player's time");
      assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM media_edit_versions").get().n, versionsBefore, "nothing applied by proposing");
      await page.getByRole("button", { name: "Renunță" }).click().catch(() => {});
    }
    if (launchers.available) assert.ok(rendered, "the synthetic draft render finished (real ffmpeg)");
    await shot("02-timeline");
    if (editVersionId) { await go(`/studio/${projectId}?sub=review`); await settle(); await page.waitForTimeout(400); await shot("03-review"); }

    // ---------- 5. 360 px: no horizontal page scroll on any Studio tab or the main project sections ----------
    await page.setViewportSize({ width: 360, height: 780 });
    for (const tab of STUDIO_TABS) {
      await go(tab === "board" ? "/studio" : `/studio/${tab}`);
      await page.locator(`#studio-tab-${tab}[aria-selected="true"]`).waitFor();
      await settle();
      const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      assert.ok(scroll <= view + 1, `tab ${tab}: page scroll width ${scroll} > viewport ${view}`);
    }
    for (const sub of ["concept", "evidence", "timeline", "review", "variants", "distribution", "analytics"]) {
      await go(`/studio/${projectId}?sub=${sub}`);
      await page.locator(`#studio-sub-${sub}[aria-selected="true"]`).waitFor();
      await settle();
      await page.waitForTimeout(200);
      const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      assert.ok(scroll <= view + 1, `project ${sub}: page scroll width ${scroll} > viewport ${view}`);
    }

    await shot("04-mobile-project");
    await go("/studio"); await settle(); await shot("05-mobile-board");
    assert.equal(await page.evaluate(() => window.__micCalls), 0, "the Studio never asked for the microphone or started a recording");
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(consoleErrors, [], "no console errors");
    assert.deepEqual(foreign, [], "the page requested nothing outside the local test Hub");
    // Opening the Studio changed nothing: no release attempt, no capture, no model run.
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0);
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    await context.close();
  } finally {
    await browser.close();
    await s.stop();
  }
});
