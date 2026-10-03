// Milestone 06 — the whole owner flow in a REAL browser (headless Chromium through Playwright) against a test Hub serving the
// built UI: register this "computer" (a Chromium VIRTUAL authenticator with user verification — PASS_SIMULATED, never Windows
// Hello), activate the voice-first policy, ask "Arată-mi înainte să faci", confirm once, and watch the ordinary factory loop
// (fixture providers) reach "Gata pentru verificare" with zero grant forms. Skipped when Playwright or its Chromium is missing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTestHub, waitFor, prepareLiveWithoutGrants, HUB_ROOT, tempDir } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(HUB_ROOT, "v2", "web", "dist", "index.html"));
const skip = !status.installed || !status.cachedBrowsers.length || !built ? "Playwright/Chromium or the built UI is missing" : false;

test("M06-UI-E2E-01 register (virtual authenticator) → policy → plan → ONE confirmation → loop → ready for review, in the real UI", { skip, timeout: 240000 }, async () => {
  const t = await makeTestHub({ queues: true });
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const evidence = process.env.M06_EVIDENCE_DIR || tempDir("m06-ui");
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir } })).result;
    await t.hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo") } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

    // 1 · setup page (M07: the resumable steps on top; the shown setup text is accepted by the authenticator gesture).
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    // 2 · the voice-first policy (fresh session; the versioned text shown and accepted with the gesture).
    await page.getByRole("button", { name: /Accept și activez/ }).click();
    await page.getByText(/activă \(v1\)/).waitFor({ timeout: 20000 });
    assert.equal(t.hub.trust.policy().active, true);
    await page.screenshot({ path: path.join(evidence, "m06-setup.png"), fullPage: true });

    // 3 · the cockpit: one sentence → the plan, nothing started.
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.getByLabel("Mesaj pentru Lega").fill("Arată-mi înainte să faci");
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    const confirmButton = page.getByRole("button", { name: /Da, execută planul/ });
    await confirmButton.waitFor({ timeout: 20000 });
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "the plan started nothing");
    assert.equal(t.hub.grants.list().length, 0, "and created no grant");
    await page.screenshot({ path: path.join(evidence, "m06-plan.png"), fullPage: true });

    // 4 · ONE confirmation; the envelope derives the grants and the factory runs (fixture writer + reviewer).
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await waitFor(async () => confirmButton.isEnabled(), 10000);
    await confirmButton.click();
    const mission = t.hub.factory.list().find((f) => f.projectId === project.id);
    await waitFor(() => ["DELIVERY_READY", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(t.hub.factory.view(mission.missionId).factory.stage), 120000, 200);
    assert.equal(t.hub.factory.view(mission.missionId).factory.stage, "DELIVERY_READY");
    await page.getByText("Gata pentru verificare").first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(evidence, "m06-ready.png"), fullPage: true });

    // What the owner did: 1 registration, 1 policy activation, 1 confirmation — and no grant form, no approval click.
    const types = t.hub.db.prepare("SELECT type, channel FROM commands WHERE type IN ('grant.create','approval.decide','owner.policy.activate','envelope.confirm','owner.register.finish','mode.set')").all();
    assert.deepEqual(types.map((r) => r.type).sort(), ["envelope.confirm", "owner.policy.activate", "owner.register.finish"]);
    assert.ok(types.filter((r) => r.type !== "owner.register.finish").every((r) => r.channel === "owner"), "recorded on the owner channel");
    assert.equal(t.hub.db.prepare("SELECT decided_via FROM approvals WHERE action_kind = 'factory.scope'").get().decided_via, "owner_session");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
