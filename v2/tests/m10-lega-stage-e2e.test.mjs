// M10.1 in a REAL browser (headless Chromium through Playwright, the M10 build, a virtual authenticator — PASS_SIMULATED, never
// Windows Hello): „Pornește Lega” pressed on the Lega screen in „Ecran complet”. One L3ga screen (2026-10-18): the full screen is the
// Lega screen itself and the voice panel is part of it, so a start failure is shown right there (no modal to close, no floating panel).
// (1) a real blocker (no consent) is named alone — never mode / grant; (2) live web search never starts unseen: the start stops before the
// microphone and the voice details open with the warning, for one more click. Nothing is started, no grant is derived. No microphone,
// no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTestHub, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { OWNER_POLICY_VERSION, OWNER_POLICY_TEXT } from "../server/owner/trust.mjs";

const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
const skip = !status.installed || !status.cachedBrowsers.length || !built ? "Playwright/Chromium or the built UI is missing" : false;

test("M10-LEGA-E2E-01 a start from the Lega screen in „Ecran complet”: a real blocker is shown alone in the screen's voice panel; live web search never starts unseen", { skip, timeout: 240000 }, async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const nothingStarted = () => {
    assert.equal(t.hub.lega.active(), false, "nothing started");
    assert.equal(t.hub.grants.list().filter((g) => g.kind === "voice").length, 0, "no grant derived");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'lega.session.start'").get().n, 0, "no start reached the Hub");
  };
  const openStageAndStart = async (page) => {
    await page.goto(`${origin}/#/lega`);
    // 2.15.4: the full screen is remembered in this browser — after the first part the page may already open in it.
    await page.locator(".lega-one").waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    if (!(await page.locator(".lega-one.is-immersive").count())) await page.getByRole("button", { name: "Ecran complet", exact: true }).click();
    await page.locator(".lega-one.is-immersive").waitFor({ timeout: 20000 });
    const dock = page.locator(".lega-one .lega-voice-dock #lega-panel");
    await dock.waitFor({ timeout: 20000 });
    await dock.getByRole("button", { name: "Pornește Lega" }).click();
  };
  // The voice panel is the Lega screen's own (docked): never a floating panel, never a modal stage.
  const docked = async (page) => {
    assert.equal(await page.locator("#lega-panel").count(), 1, "one voice panel");
    assert.equal(await page.locator(".lega-voice-dock #lega-panel").count(), 1, "rendered inside the Lega screen");
    assert.equal(await page.locator(".lega-stage").count(), 0, "no modal stage");
    assert.ok(await page.locator(".lega-one.is-immersive").isVisible(), "the full screen stays on: nothing was hidden under it");
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    // The voice-first policy (what „Activează politica” records) and every live precondition except the consent.
    t.hub.bus.transaction(() => t.hub.settings.set("ownerPolicy", { mode: "voice_first", version: OWNER_POLICY_VERSION, activatedAt: new Date().toISOString(), text: OWNER_POLICY_TEXT }, "test"));
    await prepareLiveWithoutGrants(t.hub);

    // (1) A real blocker: the screen's voice panel names the consent alone (never mode / grant / LIVE_VALIDATION).
    await openStageAndStart(page);
    const panel = page.locator("#lega-panel");
    await panel.getByText(/Lega nu poate porni încă/).first().waitFor({ timeout: 10000 });
    await panel.getByText(/Înregistrează acordul/).first().waitFor();
    const panelText = await panel.innerText();
    assert.doesNotMatch(panelText, /LIVE_VALIDATION|grant „Lega \(voce\)”/, "the old manual path is not offered for a real blocker");
    await docked(page);
    nothingStarted();

    // (2) Consent recorded, web search set to live. A fresh page (the voice details not shown yet): the start stops before the
    // microphone and the voice details open with the warning, for one more click.
    t.hub.bus.transaction(() => {
      t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test");
      t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch: "live" }, "test");
    });
    await page.reload();
    await openStageAndStart(page);
    await page.locator("#lega-panel").getByText(/Căutarea pe internet e pornită \(live\)/).first().waitFor({ timeout: 10000 });
    await page.locator("#lega-panel").getByText("Căutare live").first().waitFor(); // the warning the owner now sees
    await docked(page);
    nothingStarted();
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
