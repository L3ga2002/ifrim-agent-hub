// M10 in a REAL browser (headless Chromium through Playwright) against a test Hub serving the M10 build, with the deterministic
// Desktop Operator fixture: register this "computer" (virtual authenticator — PASS_SIMULATED, never Windows Hello), say „Deschide
// CapCut” → ONE plan card with the app decision → one click → CapCut authorized and opened (verified); then the direct sentence
// works without a card; the Operator page renders without console errors and without horizontal scroll at 360 px.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { waitFor, HUB_ROOT, tempDir, WEB_DIST } from "./helpers.mjs";
import { makeDesktopHub } from "./m10-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
const skip = !status.installed || !status.cachedBrowsers.length || !built ? "Playwright/Chromium or the built UI is missing" : false;

test("M10-UI-E2E-01 „Deschide CapCut” → ONE card with the app decision → one click → authorized + opened; Operator page clean at 360 px", { skip, timeout: 240000 }, async () => {
  const t = await makeDesktopHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const evidence = process.env.M10_EVIDENCE_DIR || tempDir("m10-ui");
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    await t.hub.desktop.discover("test"); // what „Caută aplicațiile” does; nothing is authorized by it

    // One sentence → the card (nothing opened, nothing authorized yet).
    await page.goto(`${origin}/#/lega`);
    await page.getByLabel("Mesaj pentru Lega").fill("Deschide CapCut");
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    const confirm = page.getByRole("button", { name: /Confirmă planul/ });
    await confirm.waitFor({ timeout: 20000 });
    await page.getByText("Decizie inclusă în această confirmare").waitFor();
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, false);
    assert.equal(t.opLog().filter((e) => e.op === "launch").length, 0);
    await page.screenshot({ path: path.join(evidence, "m10-plan-card.png"), fullPage: true });
    // ONE click.
    await confirm.click();
    await waitFor(() => t.hub.opsPlans.list({ limit: 1 })[0]?.status === "DONE", 30000, 100);
    assert.equal(t.hub.desktop.apps.get("capcut").authorized, true);
    assert.equal(t.opLog().filter((e) => e.op === "launch").length, 1);
    await page.getByText("gata (verificat)").first().waitFor({ timeout: 20000 });
    // The same sentence is now direct: no card.
    await page.getByLabel("Mesaj pentru Lega").fill("Adu CapCut în față");
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'").get().n >= 2, 10000);
    await page.getByText(/CapCut/).last().waitFor();
    const commands = t.hub.db.prepare("SELECT type, channel FROM commands WHERE type IN ('ops.plan.confirm','desktop.apps.authorize','grant.create','approval.decide')").all();
    assert.deepEqual(commands.map((c) => c.type), ["ops.plan.confirm"], "one confirmation, no form, no manual grant");
    assert.equal(commands[0].channel, "owner");

    // The Operator page, then at phone width.
    await page.goto(`${origin}/#/desktop`);
    await page.getByRole("heading", { name: /Operator desktop/ }).waitFor({ timeout: 20000 });
    await page.getByText("autorizată pentru operator").first().waitFor();
    await page.screenshot({ path: path.join(evidence, "m10-operator.png"), fullPage: true });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `no horizontal scroll at 360 px (${overflow}px)`);
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(consoleErrors, [], "no console errors");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
