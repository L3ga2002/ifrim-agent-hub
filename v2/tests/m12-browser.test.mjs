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
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";

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

test("M12-BR-02 (final review F1/F21/C1/F8) in a real browser: „Deciziile mele” lists the offer (full SHA) and opens the opportunity; a STALE preparation offers „Pregătește continuarea” → ONE card confirmed on the page → it waits for the owner again; the overview keeps the synthetic figures apart; 360 px without horizontal scroll", { timeout: 240000 }, async (c) => {
  assert.ok(browserStatus({ hubRoot: HUB_ROOT }).installed, "Playwright (cached Chromium) is required for the browser suites");
  assert.ok(fs.existsSync(path.join(WEB_DIST, "index.html")), `the UI build is required (HUB_V2_WEB_DIST → ${WEB_DIST})`);
  // The local development profile: the page opens the owner session by itself (no dialog), like the owner's own Hub.
  const t = await prepHub(c, { devProfile: () => ({ enabled: true, version: 1, id: "dev_m12br02", ...machineIdentity() }) });
  await t.authenticate({ dev: true });
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal(prep.status, "WAITING_OWNER");
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
    // C1: „Deciziile mele” — the offer waiting for the owner, with its exact target; the row opens the opportunity.
    await page.goto(`${base}/#/livrare/decizii`);
    const row = page.locator("section.panel", { hasText: "Ofertă de aprobat" });
    await row.waitFor();
    const rowText = await row.innerText();
    assert.ok(rowText.includes(prep.awaited.proposalId) && rowText.includes(prep.awaited.proposalSha), "the exact target: id + FULL SHA");
    assert.match(rowText, /date sintetice/);
    assert.match(rowText, /Dacă o aprobi:/);
    await row.getByRole("button", { name: "Deschide locul deciziei" }).click();
    const panel = page.locator("#sales-panel");
    const prepPanel = panel.locator("section.panel", { hasText: "Pregătirea ofertei și dosarul" });
    await prepPanel.getByText("Oferta așteptată (ținta exactă a aprobării tale)").waitFor();
    await prepPanel.getByText(/Dacă aprobi oferta exactă în următoarele/).waitFor();
    assert.equal(await prepPanel.getByRole("button", { name: "Pregătește continuarea" }).count(), 0, "nothing to continue while it waits");
    // F1 + F21: an input changes → STALE; the panel names the old offer as outdated and offers the continuation card.
    await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prep.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
      sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
    assert.equal(t.hub.salesPreparations.get(preparationId).status, "STALE");
    const button = prepPanel.getByRole("button", { name: "Pregătește continuarea" });
    await button.waitFor();
    await prepPanel.getByText("Oferta pe care o aștepta (depășită: nu mai e ținta)").waitFor();
    assert.match(await panel.innerText(), /Depășită: intrările s-au schimbat/, "the STALE offer has a Romanian label");
    assert.doesNotMatch(await prepPanel.innerText(), /\(din cockpit\)/);
    // 360 px with the button on screen: no horizontal page scroll.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);
    let w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
    assert.ok(w.scroll <= w.view + 1, `opportunity at 360 px: ${w.scroll} > ${w.view}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    const plans = t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n;
    await button.click();
    const confirm = prepPanel.getByRole("button", { name: "Confirmă planul" });
    await confirm.waitFor();
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n, plans + 1, "ONE card");
    assert.equal(t.hub.salesPreparations.get(preparationId).status, "STALE", "nothing runs before the confirmation");
    await confirm.click();
    for (let i = 0; i < 100 && t.hub.salesPreparations.get(preparationId).status !== "WAITING_OWNER"; i += 1) await page.waitForTimeout(100);
    const again = t.hub.salesPreparations.get(preparationId);
    assert.equal(again.status, "WAITING_OWNER", again.statusReason);
    assert.equal(again.rootPlanId, prep.rootPlanId, "the same preparation, continued");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_orgs").get().n, 1, "no second synthetic company");
    await prepPanel.getByText("Așteaptă aprobarea ta").waitFor();
    // F8: the overview — only synthetic data here: the real figures say so, the synthetic ones are counted apart.
    await page.evaluate((h) => { window.location.hash = h; }, "/sales?tab=overview");
    await panel.getByText("Situația curentă (doar date reale)").waitFor();
    const synth = panel.locator("section.panel", { hasText: "Date sintetice (de test), numărate separat" });
    await synth.waitFor();
    assert.match(await synth.innerText(), /firme sintetice/);
    await page.setViewportSize({ width: 360, height: 780 });
    for (const hash of ["/sales?tab=overview", "/livrare/decizii"]) {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(400);
      w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      assert.ok(w.scroll <= w.view + 1, `${hash} at 360 px: ${w.scroll} > ${w.view}`);
    }
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(foreign, [], "the page requested nothing outside the local test Hub");
    await context.close();
  } finally {
    await browser.close();
  }
  t.assertPaths();
});
