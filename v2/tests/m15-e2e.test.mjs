// M15 — the owner's activities end to end through the NEW L3ga screen, in a real browser (headless Chromium, Playwright) against a test Hub
// created from zero that serves the built UI: browser → HTTP → Hub services → SQLite → files. PASS_SIMULATED: fixture providers (fake
// Codex app-server, fake Claude, fake WSL runner), a Chromium virtual authenticator (never Windows Hello), synthetic projects only; no model,
// no network, nothing on the live Hub. What it proves: the screen's three zones drive the existing flows with the existing authority (one
// plan confirmation, the owner's local acceptance), the exact target is shown in full before each click, and a reload / an expiry / a
// navigation keep the state without a second request. It does NOT prove that a real writer, reviewer or capture works (that is the live
// acceptance session).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTestHub, waitFor, prepareLiveWithoutGrants, HUB_ROOT, tempDir, WEB_DIST } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
const skip = !status.installed || !status.cachedBrowsers.length || !built ? "Playwright/Chromium or the built UI is missing" : false;
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const evidenceDir = () => process.env.M15_EVIDENCE_DIR || tempDir("m15-e2e");

async function ownerBrowserHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }]));
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  const dir = path.join(t.dataDir, "m15-demo");
  materializeFixture("bug-demo", dir);
  const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir, name: "M15 Demo" } })).result;
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ro-RO" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
  page.setDefaultTimeout(20000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  // The owner's one-time setup (the authenticator, then the voice-first policy), as in M06: no other form.
  await page.goto(`${origin}/#/lega/setup`);
  await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor();
  await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
  await page.getByText(/sesiune deschisă până la/).waitFor();
  await page.getByRole("button", { name: /Accept și activez/ }).click();
  await page.getByText(/activă \(v1\)/).waitFor();
  const close = async () => { try { await browser.close(); } finally { await new Promise((r) => server.close(r)); await t.cleanup(); } };
  return { t, project, origin, page, pageErrors, close };
}

test("M15-E2E-A Engineering in the new L3ga screen: typed request → plan (exact target in full) → ONE confirmation → writer, checks, review, QA → „Ce te așteaptă” → the owner's local acceptance → history; nothing else decided", { skip, timeout: 420000 }, async () => {
  const { t, project, origin, page, pageErrors, close } = await ownerBrowserHub();
  const ev = evidenceDir();
  try {
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.locator(".lega-one").waitFor();
    // The open activity says where you are; nothing waits yet.
    const head = page.getByRole("region", { name: "Activitatea deschisă" }).first();
    await head.getByText("Lucrezi la M15 Demo").waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    await composer.fill(BUG);
    await composer.press("Enter");
    const confirm = page.getByRole("button", { name: /Da, execută planul/ });
    await confirm.waitFor({ timeout: 30000 });
    const env = t.hub.db.prepare("SELECT id, envelope_hash FROM mission_envelopes WHERE status = 'PROPOSED'").all();
    assert.equal(env.length, 1, "ONE plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "the plan started nothing");
    // „Ce te așteaptă” names the plan first (the Hub inbox lists results; the plan on this screen is added).
    await page.getByRole("region", { name: "Ce te așteaptă" }).getByText(/^Plan: /).first().waitFor();
    // The activity header turns into the decision, with ONE primary action that brings the card into focus.
    await head.getByText("Decizia ta").first().waitFor();
    await head.getByRole("button", { name: "Vezi planul și confirmă" }).click();
    // The exact target, in full, before the click (the same values the confirmation sends).
    const card = page.locator(".lega-one .cockpit-main section.panel", { hasText: "Arată-mi înainte să faci" }).first();
    for (const label of ["Obiect", "Versiune", "Acțiune", "Consecință", "Nu se întâmplă"]) await card.getByText(label, { exact: true }).first().waitFor();
    await card.getByRole("button", { name: /Ținta exactă/ }).click();
    const target = await card.locator(".target-box").innerText();
    assert.ok(target.includes(env[0].id) && target.includes(env[0].envelope_hash), "the plan id and its full hash are on screen before the confirmation");
    await page.screenshot({ path: path.join(ev, "m15-A-plan.png") });

    // ONE confirmation; the fixture writer fixes the bug, the fixture reviewer passes it.
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await waitFor(async () => confirm.isEnabled(), 10000);
    await confirm.click();
    const mission = await waitFor(() => t.hub.factory.list().find((f) => f.projectId === project.id), 20000, 100);
    await waitFor(() => ["DELIVERY_READY", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(t.hub.factory.view(mission.missionId).factory.stage), 240000, 250);
    const ready = t.hub.factory.view(mission.missionId);
    assert.equal(ready.factory.stage, "DELIVERY_READY", ready.factory.stageReason);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE", "BUILD_SAFE throughout");

    // „Ce te așteaptă” shows the package; one click opens the place of the decision; the full bundle SHA is shown before „Accept local”.
    const attention = page.getByRole("region", { name: "Ce te așteaptă" });
    await attention.getByText("Pachet software").first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(ev, "m15-A-ready.png") });
    const bundle = t.hub.db.prepare("SELECT id, sha256 FROM factory_bundles WHERE mission_id = ? AND status = 'READY_FOR_OWNER_ACCEPTANCE'").get(mission.missionId);
    assert.ok(bundle, "a package waits for the owner");
    await attention.locator(".attention-item", { hasText: "Pachet software" }).first().getByRole("button", { name: "Deschide locul deciziei" }).click();
    await page.waitForFunction(() => /#\/(missions|livrare)\//.test(location.hash));
    if (await page.evaluate(() => location.hash.startsWith("#/livrare/"))) {
      // The Delivery Room's own software decision (same command and lock as before).
      const row = page.locator("[data-decision='software']");
      await row.getByRole("button", { name: /Ținta exactă/ }).click();
      assert.ok((await row.locator(".target-box").innerText()).includes(bundle.sha256));
      await row.getByRole("button", { name: "Accept local" }).click();
    } else {
      const panel = page.locator("section.panel", { has: page.getByRole("heading", { name: "Pachet de livrare", exact: true }) }).first();
      await panel.getByRole("button", { name: /Ținta exactă/ }).click();
      assert.ok((await panel.locator(".target-box").innerText()).includes(bundle.sha256), "the full bundle SHA before the acceptance");
      await panel.getByRole("button", { name: "Accept local" }).click();
    }
    await waitFor(() => t.hub.db.prepare("SELECT status FROM factory_bundles WHERE id = ?").get(bundle.id).status === "OWNER_ACCEPTED", 30000, 200);
    assert.equal(t.hub.factory.view(mission.missionId).factory.stage, "ACCEPTED");

    // Back on L3ga: nothing waits; the history names the accepted result (no id to remember).
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.locator(".lega-one").waitFor();
    await page.getByRole("tab", { name: "Istoric și rezultate" }).click();
    const history = page.locator(".history-list");
    await history.getByText(/Lucrare software/).first().waitFor();
    await history.getByText("Rezultat acceptat").first().waitFor();
    await page.locator(".history-search input").fill("spații");
    await history.getByText(/Lucrare software/).first().waitFor();
    await page.screenshot({ path: path.join(ev, "m15-A-history.png") });
    // Exactly the owner's two decisions; nothing published, committed or approved elsewhere.
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'envelope.confirm'"), 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('grant.create','mode.set','gate.set')"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE decided_via = 'ui'"), 0);
    assert.deepEqual(pageErrors, []);
  } catch (error) { await page.screenshot({ path: path.join(ev, "m15-A-failure.png"), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(ev, "m15-A-failure.txt"), await page.locator("body").innerText().catch(() => "")); throw error; } finally { await close(); }
});

test("M15-E2E-E recovery in the new L3ga screen: F5 keeps the plan (no second request, no second plan) and the unsent text; an expired plan says so with ONE next action; „Ce decizii am?” / „Arată-mi rezultatele” in plain words", { skip, timeout: 300000 }, async () => {
  const { t, project, origin, page, pageErrors, close } = await ownerBrowserHub();
  try {
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.locator(".lega-one").waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    // The owner is reading the history when the plan arrives: the plan's card is shown AND focused (Enter confirms exactly it), never hidden.
    await page.getByRole("tab", { name: "Istoric și rezultate" }).click();
    await composer.fill(BUG);
    await composer.press("Enter");
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor({ timeout: 30000 });
    await page.getByRole("tab", { name: "Acum", selected: true }).waitFor();
    await page.waitForFunction(() => Boolean(document.activeElement?.closest(".decision")), null, { timeout: 10000 });
    const intents = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'");
    const before = intents();
    await composer.fill("text netrimis M15");
    await page.waitForTimeout(600);
    // F5: the plan comes back from the Hub (never re-created), the unsent text and the conversation from this browser.
    await page.reload();
    await page.locator(".lega-one").waitFor();
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor();
    assert.equal(await composer.inputValue(), "text netrimis M15");
    await page.getByRole("list", { name: "Conversația cu Lega" }).getByText(BUG).waitFor();
    assert.equal(intents(), before, "no request sent again");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 1, "no second plan");
    // „Ecran complet” and a visit elsewhere: the same.
    await page.getByRole("button", { name: "Ecran complet" }).click();
    await page.locator(".lega-one.is-immersive").waitFor();
    await page.getByRole("button", { name: "Ieși din ecran complet" }).click();
    await page.evaluate(() => { location.hash = "/rezultate"; });
    await page.getByRole("heading", { name: "Rezultate și istoric" }).waitFor();
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor();
    assert.equal(intents(), before);

    // The plan's window passes (the Hub's own expiry sweep): the screen says „Expirat”, nothing ran, and offers ONE next action.
    t.hub.db.prepare("UPDATE mission_envelopes SET confirm_by = ? WHERE status = 'PROPOSED'").run(new Date(Date.now() - 1000).toISOString());
    t.hub.envelopes.tick();
    // On the open screen (no reload): the card reads the plan's real state back; the header says „Expirat” with its ONE next action.
    const head = page.getByRole("region", { name: "Activitatea deschisă" }).first();
    await head.getByText("Expirat").first().waitFor({ timeout: 20000 });
    await head.getByRole("button", { name: "Cere planul din nou" }).waitFor();
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "an expired plan runs nothing");
    assert.equal(await page.getByRole("button", { name: /Da, execută planul/ }).count(), 0, "no confirmation offered for an expired plan");

    // Plain questions: the decisions in words (never „none” while something waits), the history opened on this screen.
    await composer.fill("Ce am de decis?");
    await composer.press("Enter");
    await page.locator(".lega-conv li.lc-lega").last().waitFor();
    await composer.fill("Arată-mi rezultatele");
    await composer.press("Enter");
    await page.getByRole("tab", { name: "Istoric și rezultate", selected: true }).waitFor();
    await composer.fill("Care e starea proiectului?");
    await composer.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".lega-conv li.lc-lega").length >= 3);
    const last = await page.locator(".lega-conv li.lc-lega").last().innerText();
    assert.doesNotMatch(last, /Nu am înțeles|nu știu ce/i, "„Care e starea proiectului?” is understood");
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});
