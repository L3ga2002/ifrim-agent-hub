// M12 WP11 — the Opportunity screen and the org sheet in a REAL browser (Playwright + the cached Chromium, the same isolation as
// M04-BR-01: the page reaches nothing but the local test Hub) after one synthetic preparation ran to a READY „Dosarul ofertei”: the
// preparation's status and reason, the owner's request, who confirmed it (Windows Hello, truthfully), the dossier with its FULL manifest SHA,
// DRAFT_ONLY and APP_NOT_RUN said as such; the org sheet's q-v2 notes (inferences, „fără dovadă”). 360 px: no horizontal page scroll; the
// eight Sales tabs unchanged. A fully synthetic acceptance hub (accept-helpers isolation). Needs the fresh UI build (HUB_V2_WEB_DIST) and
// Playwright, like every browser suite of the gate: without them it fails with that reason (never a skip).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WEB_DIST } from "./helpers.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation } from "./sales-helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");

test("M12-BR-01 the Opportunity screen shows the preparation and „Dosarul ofertei” (full manifest SHA, DRAFT_ONLY, APP_NOT_RUN said truthfully); the org sheet the q-v2 notes; 360 px without horizontal scroll; still eight Sales tabs", { timeout: 240000 }, async (c) => {
  assert.ok(browserStatus({ hubRoot: HUB_ROOT }).installed, "Playwright (cached Chromium) is required for the browser suites");
  assert.ok(fs.existsSync(path.join(WEB_DIST, "index.html")), `the UI build is required (HUB_V2_WEB_DIST → ${WEB_DIST})`);
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const dossier = t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0];
  const base = `http://localhost:${t.config.port}`;
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const browser = await pw.chromium.launch(browserLaunchOptions(base));
  const pageErrors = [];
  const foreign = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ro-RO" });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.on("request", (r) => { const u = new URL(r.url()); if (!["data:", "blob:"].includes(u.protocol) && u.origin !== base) foreign.push(r.url()); });
    page.setDefaultTimeout(15000);
    const panel = page.locator("#sales-panel");
    await page.goto(`${base}/#/sales?tab=opp&id=${encodeURIComponent(done.opportunityId)}`);
    const prep = panel.locator("section.panel", { hasText: "Pregătirea ofertei și dosarul" });
    await prep.waitFor();
    await prep.getByText("Dosarul e gata").waitFor();
    const text = await prep.innerText();
    assert.ok(text.includes(dossier.manifestSha256), "the FULL manifest SHA is shown");
    assert.match(text, /Revizia 1/);
    assert.match(text, /DRAFT_ONLY, netrimisă/);
    assert.match(text, /APP_NOT_RUN/);
    assert.match(text, /verificat doar ca fișier, nu în Word/);
    assert.doesNotMatch(text, /Deschis și verificat în Word/, "Word never ran here: it is not said");
    assert.match(text, /Windows Hello/, "confirmed in the WebAuthn session: said so");
    assert.match(text, /Confirmarea planului nu aprobă oferta/);
    assert.match(text, /programări online/, "the owner's own request");
    assert.match(text, /OUTREACH_DISABLED/);
    assert.ok(text.includes(done.awaited.proposalId) && text.includes(done.awaited.proposalSha), "the exact offer it waited for (id + full SHA)");
    // The approved version states itself once in the proposal view; no dead „Aprob intern” (part 1's ProposalDecision applies only to a DRAFT under review).
    assert.equal(await panel.getByRole("button", { name: "Aprob intern" }).count(), 0);
    // The org sheet: the q-v2 notes of the synthetic company.
    await page.evaluate((h) => { window.location.hash = h; }, `/sales?tab=org&id=${encodeURIComponent(done.orgId)}`);
    const notes = panel.locator("section.panel", { hasText: "Ce nu primește puncte (q-v2)" });
    await notes.waitFor();
    const notesText = await notes.innerText();
    assert.match(notesText, /Inferențe \(deduse, fără punctaj\)/i, "a section title (rendered upper case)");
    assert.match(notesText, /brief:city — inferență/, "the city the brief only deduced: listed, never scored");
    // 360 px: the two screens and every Sales tab without horizontal page scroll; the tab bar still has eight tabs.
    await page.setViewportSize({ width: 360, height: 780 });
    for (const hash of [`/sales?tab=opp&id=${encodeURIComponent(done.opportunityId)}`, `/sales?tab=org&id=${encodeURIComponent(done.orgId)}`]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForFunction(() => !document.querySelector("#sales-panel .skeleton"));
      await page.waitForTimeout(200);
      const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      assert.ok(scroll <= view + 1, `${hash}: page scroll width ${scroll} > viewport ${view}`);
    }
    assert.equal(await page.locator(".sales-tabs [role='tab']").count(), 8);
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(foreign, [], "the page requested nothing outside the local test Hub");
    await context.close();
  } finally {
    await browser.close();
  }
  t.assertPaths();
});
