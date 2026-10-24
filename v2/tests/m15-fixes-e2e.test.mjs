// M15 final fixes (2.18.1-m15) — QA evidence in a real browser (headless Chromium, Playwright) against a test Hub created from zero that
// serves the built UI, plus one HTTP check without a browser. PASS_SIMULATED: synthetic projects only, fixture providers, a virtual
// authenticator; no model, no network, nothing on the live Hub.
// R-STATE: the Factory's real stages on the history (L3ga tab and #/rezultate) — working stages as work in progress, pause, stop in
// progress, blocked and the owner's decision with their own words, an unknown stage as „Stare necunoscută” with the Hub's raw value.
// R-ERROR: a response lost after the Hub executed the request → the screen says it does not know, re-reads the saved state and finds the
// plan (no second request, no second plan, kept after F5); a refusal the Hub proves happened before execution → „nu s-a schimbat nimic”.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { makeTestHub, waitFor, prepareLiveWithoutGrants, HUB_ROOT, tempDir, WEB_DIST } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { ApiError } from "../web/src/api.js";
import { errorOutcome, errorContinuation, canRetryDirectly } from "../web/src/lib/errorOutcome.js";

const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
const skip = !status.installed || !status.cachedBrowsers.length || !built ? "Playwright/Chromium or the built UI is missing" : false;
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const evidenceDir = () => process.env.M15_EVIDENCE_DIR || tempDir("m15-fixes-e2e");

async function ownerBrowserHub(name) {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }]));
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  const dir = path.join(t.dataDir, "m15-fix-demo");
  materializeFixture("bug-demo", dir);
  const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir, name } })).result;
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
  await page.goto(`${origin}/#/lega/setup`);
  await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor();
  await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
  await page.getByText(/sesiune deschisă până la/).waitFor();
  await page.getByRole("button", { name: /Accept și activez/ }).click();
  await page.getByText(/activă \(v1\)/).waitFor();
  const close = async () => { try { await browser.close(); } finally { await new Promise((r) => server.close(r)); await t.cleanup(); } };
  return { t, project, origin, page, pageErrors, close };
}

test("M15F-HTTP-01 a command the policy denies: the Hub's own answer proves it never executed, and the page says „nu s-a schimbat nimic” only then", async () => {
  const t = await makeTestHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  try {
    let purchases = 0;
    t.hub.commands.register("test.buy_credits", { describe: "Test-only credit purchase", schema: { amount: { type: "integer", required: true, min: 1 } },
      action: () => ({ actionKind: "billing.purchase_credits", target: "provider:billing" }), execute: () => { purchases += 1; return { bought: true }; } });
    const origin = `http://localhost:${t.config.port}`;
    const token = (await (await fetch(`${origin}/api/session`, { headers: { Origin: origin } })).json()).token;
    const res = await fetch(`${origin}/api/commands`, { method: "POST", headers: { Origin: origin, "X-Hub-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ type: "test.buy_credits", payload: { amount: 1 } }) });
    const error = new ApiError(res.status, await res.json());
    assert.equal(purchases, 0, "the handler never ran");
    assert.equal(t.hub.commands.get(error.details.commandId).status, "rejected");
    assert.equal(errorOutcome(error), "refused_before_execution");
    assert.equal(canRetryDirectly(error), true);
    assert.match(errorContinuation(error), /nu s-a schimbat nimic/);
    // The same status without the Hub's proof (a refusal that may follow an earlier success) never says so.
    const unproven = new ApiError(409, { error: { category: "conflict", code: "CONFLICT", message: "Deja decis" } });
    assert.equal(errorOutcome(unproven), "refused");
    assert.doesNotMatch(errorContinuation(unproven), /nu s-a schimbat nimic/);
  } finally { await new Promise((r) => server.close(r)); await t.cleanup(); }
});

test("M15F-E2E-STATE the Factory's real stages on the history (L3ga tab and Rezultate): work in progress, pause, stop, block, decision, unknown with its raw value", { skip, timeout: 300000 }, async () => {
  const { t, project, origin, page, pageErrors, close } = await ownerBrowserHub("M15 Fix Etape");
  const ev = evidenceDir();
  try {
    await t.hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo"), limits: MODELS } });
    const mission = t.hub.factory.list().find((f) => f.projectId === project.id);
    assert.ok(mission, "a mission in SPEC_DRAFT");
    const cases = [["SPEC_DRAFT", "decide", "Decizia ta"], ["TEST_AUTHORING", "run", "În lucru"], ["TEST_PROVING", "run", "În lucru"], ["IMPLEMENTING", "run", "În lucru"],
      ["CHECKING", "run", "În lucru"], ["REVIEWING", "run", "În lucru"], ["REPAIRING", "run", "În lucru"], ["PAUSED", "paused", "În pauză"],
      ["CANCEL_REQUESTED", "stopping", "Se oprește"], ["BLOCKED", "block", "Lipsește ceva"], ["NEEDS_OWNER_DECISION", "decide", "Decizia ta"],
      ["M99_ETAPA_VIITOARE", "unknown", "Stare necunoscută · M99_ETAPA_VIITOARE"]];
    const pill = () => page.locator(".history-list li", { hasText: "Lucrare software" }).first().locator(".state-pill");
    const seen = [];
    for (const [stage, state, text] of cases) {
      // Test-only write to the synthetic Hub's database: the mission's stage as the Factory would record it (no run is started).
      t.hub.db.prepare("UPDATE factory_missions SET stage = ?, stage_reason = ? WHERE mission_id = ?").run(stage, `Motivul Hub-ului pentru ${stage}`, mission.missionId);
      // A fresh load each time (the same address twice is only a hash change: the page would keep the list it already read).
      await page.goto(`${origin}/#/rezultate`);
      await page.reload();
      await page.getByRole("heading", { name: "Rezultate și istoric" }).waitFor();
      await waitFor(async () => (await pill().getAttribute("data-state").catch(() => null)) === state, 15000, 200);
      const shown = await pill().innerText();
      assert.equal(shown.trim(), text, `${stage} → ${text}`);
      assert.equal(t.hub.factory.view(mission.missionId).factory.stage, stage, "the stage did not move while it was read");
      await page.locator(".history-list li", { hasText: "Lucrare software" }).first().getByText(`Motivul Hub-ului pentru ${stage}`).waitFor();
      if (["IMPLEMENTING", "PAUSED", "CANCEL_REQUESTED", "M99_ETAPA_VIITOARE"].includes(stage)) await page.screenshot({ path: path.join(ev, `m15f-rezultate-${stage}.png`) });
      seen.push(`${stage}:${state}`);
    }
    // The legend of the labels names the state itself (no row, no raw value to show).
    await page.locator(".panel", { hasText: "Ce înseamnă etichetele" }).locator(".state-pill[data-state='unknown']").getByText("Stare necunoscută", { exact: true }).waitFor();
    // The L3ga screen's own history tab reuses the same mapping: a mission writing code is never „Pregătit”.
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'IMPLEMENTING', stage_reason = 'Writer-ul implementează specificația aprobată' WHERE mission_id = ?").run(mission.missionId);
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.locator(".lega-one").waitFor();
    await page.getByRole("tab", { name: "Istoric și rezultate" }).click();
    await waitFor(async () => (await pill().getAttribute("data-state").catch(() => null)) === "run", 15000, 200);
    assert.equal((await pill().innerText()).trim(), "În lucru");
    await page.screenshot({ path: path.join(ev, "m15f-lega-istoric-IMPLEMENTING.png") });
    fs.writeFileSync(path.join(ev, "m15f-stages.txt"), `${seen.join("\n")}\n`);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "reading the history started nothing");
    assert.deepEqual(pageErrors, []);
  } catch (error) { await page.screenshot({ path: path.join(ev, "m15f-state-failure.png"), fullPage: true }).catch(() => {}); throw error; } finally { await close(); }
});

test("M15F-E2E-ERROR a response lost after the Hub made the plan: the screen says it does not know, re-reads and finds the plan (no second request or plan, kept after F5); a refusal proven before execution says „nu s-a schimbat nimic”", { skip, timeout: 300000 }, async () => {
  const { t, project, origin, page, pageErrors, close } = await ownerBrowserHub("M15 Fix Erori");
  const ev = evidenceDir();
  const intents = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'");
  const envelopes = () => count(t, "SELECT COUNT(*) AS n FROM mission_envelopes");
  try {
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.locator(".lega-one").waitFor();
    const composer = page.getByLabel("Mesaj pentru Lega");
    const conv = page.getByRole("list", { name: "Conversația cu Lega" });

    // 1 · A refusal the Hub proves happened before execution: an older page's contract (the header an older build would send) — the
    // server's contract check refuses it before any route handler. Nothing is recorded, nothing is planned.
    await page.route("**/api/owner/intent", (route) => route.continue({ headers: { ...route.request().headers(), "x-hub-ui-contract": "19" } }));
    await composer.fill(BUG);
    await composer.press("Enter");
    await conv.getByText(/înainte s-o execute: nu s-a schimbat nimic/).waitFor();
    assert.equal(intents(), 0, "the refused request was never executed");
    assert.equal(envelopes(), 0);
    const head = page.getByRole("region", { name: "Activitatea deschisă" }).first();
    await head.getByRole("button", { name: "Scrie din nou cererea" }).waitFor();
    await page.screenshot({ path: path.join(ev, "m15f-refuz-inainte.png") });
    await page.unroute("**/api/owner/intent");

    // 2 · The Hub executes the request (the plan is made) but its answer never reaches the page (the connection drops).
    await page.route("**/api/owner/intent", async (route) => { await route.fetch(); await route.abort("connectionreset"); });
    await composer.fill(BUG);
    await composer.press("Enter");
    const lost = conv.locator("li.lc-lega", { hasText: "Nu știu dacă cererea a fost executată" }).last();
    await lost.waitFor({ timeout: 30000 });
    const said = await lost.innerText();
    assert.match(said, /Legătura cu Hub-ul s-a întrerupt/);
    assert.doesNotMatch(said, /nu s-a schimbat nimic|trimite din nou|poți repeta/i, "never „nothing changed” or „send it again” after an unknown result");
    // The saved state is read again at once: the plan the Hub made is found, never made twice.
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor({ timeout: 30000 });
    assert.equal(intents(), 1, "one request reached the Hub");
    assert.equal(envelopes(), 1, "one plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "the plan started nothing");
    await page.screenshot({ path: path.join(ev, "m15f-raspuns-pierdut-regasit.png") });
    await page.unroute("**/api/owner/intent");

    // 3 · F5: the plan comes back from the Hub, the conversation (with the line about the unknown result) from this browser; nothing resent.
    await page.reload();
    await page.locator(".lega-one").waitFor();
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor();
    await conv.getByText(/Nu știu dacă cererea a fost executată/).first().waitFor();
    assert.equal(intents(), 1);
    assert.equal(envelopes(), 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'PROPOSED'"), 1, "the plan still waits for the owner (no decision taken)");
    assert.deepEqual(pageErrors, []);
  } catch (error) { await page.screenshot({ path: path.join(ev, "m15f-error-failure.png"), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(ev, "m15f-error-failure.txt"), await page.locator("body").innerText().catch(() => "")); throw error; } finally { await close(); }
});
