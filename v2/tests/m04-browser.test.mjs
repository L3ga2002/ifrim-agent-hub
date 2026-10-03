// Milestone 04 — the Sales UI in a REAL browser (Playwright 1.61.0 + the cached Chromium, OS sandbox on) against a throwaway
// test Hub on a free local port, on synthetic data only (fictitious companies, .test domains, a "(SINTETIC)" catalog service).
// The browser reaches nothing but that Hub: the same network isolation as Browser Workspace (dead proxy, no DNS except
// localhost). No model, no network, no real transport (outreach stays DISABLED). PASS_LOCAL when Playwright is installed and
// the UI is built; SKIPPED_ENV otherwise. Screenshots go to a temp folder under .ifrim/tmp that the test removes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, tempDir, WEB_DIST } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { generateSyntheticOrgs } from "../server/sales/synthetic.mjs";
import { MANUAL_CONTACT_TEXT, CLIENT_ACCEPTANCE_TEXT } from "../server/sales/sales.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const DIST = path.join(WEB_DIST, "index.html");
const installed = browserStatus({ hubRoot: HUB_ROOT }).installed;
const skip = !installed ? "SKIPPED_ENV: Playwright is not installed" : !fs.existsSync(DIST) ? "SKIPPED_ENV: the UI is not built (npm run build:v2)" : false;

const made = [];
const scratch = (label) => { const dir = tempDir(label); made.push(dir); return dir; };
test.afterEach(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a file still open on Windows */ } } });

const dispatch = (hub, type, payload) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test" }).then((r) => r.result ?? r);
const SALES_TABS = ["overview", "imports", "orgs", "org", "pipeline", "opp", "followups", "services"];

/** A local datetime-local value (the browser's zone is the test process's zone). */
const localInput = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

async function startHub() {
  const t = await makeTestHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${t.config.port}`;
  return { ...t, base, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("M04-BR-01 Sales UI end to end in a real browser: import → sheet + fixture audit → opportunity → proposal approval → draft (Send disabled) → manual contact → follow-up draft → client acceptance → Engineering hand-off; no horizontal scroll at 360 px", { skip, timeout: 240000 }, async () => {
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const s = await startHub();
  const shots = scratch("m04-browser");
  const browser = await pw.chromium.launch(browserLaunchOptions(s.base));
  const pageErrors = [];
  const foreign = [];
  try {
    // ---------- synthetic seed: one catalog service, no price configured ----------
    const service = await dispatch(s.hub, "sales.service.save", { name: "Site de prezentare (SINTETIC)", description: "Serviciu fictiv pentru test", scope: ["Pagini de prezentare", "Formular de contact"],
      exclusions: ["Conținut text"], tags: ["website", "responsive", "contact"] });
    assert.equal(service.price.status, "NOT_CONFIGURED");
    const [a, b, c] = generateSyntheticOrgs(3, { seed: 404 });
    // Atelierul Verde has a local fixture site (v2/fixtures/sales/sites/atelierul-verde.test.html); the CUI is generated.
    // Written as a user's file would be (toCsv is the export format: it prefixes "+…" phones against formula injection).
    const national = (phone) => String(phone || "").replace(/^\+40\s?/, "0");
    const cell = (v) => (/[;"\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
    const csv = [["Denumire firmă", "CUI", "Site web", "E-mail", "Telefon", "Localitate", "Județ"],
      ["Atelierul Verde SRL", a.fiscalCode, "https://atelierul-verde.test", "office@atelierul-verde.test", "0700 000 101", "Cluj-Napoca", "Cluj"],
      [b.name, b.fiscalCode, b.website, b.email, national(b.phone), b.city, b.county],
      [c.name, c.fiscalCode, c.website, c.email, national(c.phone), c.city, c.county],
    ].map((r) => r.map(cell).join(";")).join("\r\n");
    const csvFile = path.join(shots, "firme-sintetice.csv");
    fs.writeFileSync(csvFile, `﻿${csv}\r\n`);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ro-RO" });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    page.on("request", (r) => { const u = new URL(r.url()); if (!["data:", "blob:"].includes(u.protocol) && u.origin !== s.base) foreign.push(r.url()); });
    page.setDefaultTimeout(15000);
    const panel = page.locator("#sales-panel");
    const go = async (hash) => { await page.evaluate((h) => { window.location.hash = h; }, hash); };
    const approveOnCard = async () => {
      const card = page.locator(".sales-approval").first();
      await card.getByRole("button", { name: "Aprobă și pornește" }).click();
      await card.waitFor({ state: "detached" });
    };

    // ---------- 1. overview: outreach disabled, nothing synthetic yet ----------
    await page.goto(`${s.base}/#/sales`);
    await page.getByRole("heading", { name: "Vânzări & lead-uri" }).waitFor();
    await panel.getByText("Comunicare: doar ciorne").waitFor();
    await panel.getByText(/OUTREACH_DISABLED/).first().waitFor();
    assert.equal(await page.locator(".synthetic-banner").count(), 0, "no banner before synthetic data exists");

    // ---------- 2. import: upload (marked synthetic) → mapping (server suggestion) → preview → confirm ----------
    await page.getByRole("tab", { name: "Importuri" }).click();
    await page.locator('input[type="file"]').setInputFiles(csvFile);
    await page.getByLabel("Date sintetice (fictive, pentru test)").check();
    await page.getByRole("button", { name: "Încarcă și analizează" }).click();
    const mapButton = page.getByRole("button", { name: "Salvează maparea și previzualizează" });
    await mapButton.waitFor();
    assert.equal(await page.getByLabel("Câmpul pentru coloana Denumire firmă").inputValue(), "name", "the Hub's suggested mapping (by column index) is applied");
    assert.equal(await page.getByLabel("Câmpul pentru coloana CUI").inputValue(), "fiscalCode");
    await mapButton.click();
    await page.getByText(/Previzualizare \(primele 3 rânduri\)/).waitFor();
    await page.locator(".stat-tile", { hasText: "firme noi" }).first().waitFor();
    assert.equal(await page.locator(".sales-rows tbody tr").count(), 3, "three preview rows");
    await page.getByRole("button", { name: "Confirmă importul" }).click();
    await page.locator(".sales-rows").getByText("Creată").first().waitFor();
    const batch = s.hub.sales.listBatches()[0];
    assert.equal(batch.status, "IMPORTED");
    assert.equal(batch.synthetic, true);
    assert.equal(s.hub.sales.listOrgs({}).total, 3);
    await page.locator(".synthetic-banner", { hasText: "Date sintetice:" }).waitFor();
    assert.match(await page.locator(".synthetic-banner").innerText(), /fictive/, "the synthetic banner appears once synthetic data exists (only synthetic companies: the full banner)");
    await page.screenshot({ path: path.join(shots, "01-import.png"), fullPage: true });

    // ---------- 3. company sheet: fixture audit → OBSERVED evidence with excerpts rendered as text ----------
    await page.getByRole("tab", { name: "Firme" }).click();
    await page.getByRole("link", { name: "Atelierul Verde SRL" }).click();
    await page.getByRole("heading", { name: "Atelierul Verde SRL" }).waitFor();
    await panel.getByText("Ultima verificare").waitFor();
    await page.getByRole("button", { name: "Audit (fixture)" }).click();
    await page.locator(".sales-checks > li").first().waitFor();
    await page.locator("td[data-label='Etichetă']", { hasText: "Observat" }).first().waitFor();
    const excerpts = page.locator(".sales-excerpt");
    assert.ok(await excerpts.count() >= 1, "audit excerpts are shown");
    assert.ok(await page.$$eval(".sales-excerpt", (els) => els.every((e) => e.children.length === 0 && e.textContent.trim().length > 0)), "every excerpt is plain text (no element was created from page content)");
    assert.ok(await page.locator("td[data-label='Actualitate']", { hasText: "Actuală" }).count() >= 1, "freshness badge per piece of evidence");
    const orgRow = s.hub.db.prepare("SELECT id FROM sales_orgs WHERE display_name = 'Atelierul Verde SRL'").get();
    const sheet = s.hub.sales.getOrg(orgRow.id);
    assert.equal(sheet.org.status, "AUDITED");
    assert.ok(sheet.evidence.some((e) => e.label === "OBSERVED" && e.excerpt), "OBSERVED evidence with an excerpt was stored");
    await page.screenshot({ path: path.join(shots, "02-org-audit.png"), fullPage: true });

    // ---------- 4. opportunity + proposal ("De stabilit" without a configured price) ----------
    await page.getByRole("button", { name: "Oportunitate nouă" }).click();
    await page.getByLabel("Serviciu din catalog").selectOption(service.id);
    await page.getByRole("button", { name: "Creează", exact: true }).click();
    await page.getByRole("button", { name: "Generează propunerea" }).click();
    await panel.getByText(/De stabilit \(neconfigurat\)/).first().waitFor();
    const oppId = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("id");
    assert.match(oppId || "", /^opp_/);

    // ---------- 5. proposal approval: ready for review → ALWAYS_ASK card bound to the displayed hash → approved ----------
    await page.getByRole("button", { name: "Marchează gata de revizuire" }).click();
    await page.getByRole("button", { name: "Cere aprobarea acestei versiuni" }).click();
    const pending = s.hub.approvals.list("pending").find((x) => x.actionKind === "sales.proposal_approve");
    assert.ok(pending, "the approval was requested, nothing approved yet");
    assert.equal(s.hub.sales.getOpportunity(oppId).proposals[0].status, "DRAFT");
    await approveOnCard();
    await page.locator(".sales-sheet-head").getByText("Aprobată intern").waitFor();
    const approvedProposal = s.hub.sales.getOpportunity(oppId).proposals[0];
    assert.equal(approvedProposal.status, "APPROVED_INTERNAL");
    assert.equal(approvedProposal.approvedSha, approvedProposal.contentSha, "approved exactly the content that was shown");

    // ---------- 6. draft: prepared, content approved through the card; Send stays disabled ----------
    await page.getByRole("button", { name: "Pregătește o ciornă" }).click();
    const draftCard = page.locator(".sales-draft").first();
    await draftCard.waitFor();
    const send = draftCard.getByRole("button", { name: "Trimite" });
    assert.equal(await send.isDisabled(), true, "Send is disabled (OUTREACH_DISABLED)");
    assert.match(await draftCard.innerText(), /OUTREACH_DISABLED/);
    await draftCard.getByRole("button", { name: "Aprobă conținutul" }).click();
    await approveOnCard();
    await page.locator(".sales-draft").first().getByText("Conținut aprobat", { exact: true }).waitFor();
    assert.equal(await page.locator(".sales-draft").first().getByRole("button", { name: "Trimite" }).isDisabled(), true, "still disabled after the content approval");
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_sends").get().n, 0, "nothing was sent");

    // ---------- 7. manual contact with the exact sentence (5 days ago) ----------
    const contactAt = new Date(Date.now() - 5 * 86400000);
    const contactForm = page.locator("form", { hasText: "Înregistrează un contact făcut de tine" });
    await contactForm.locator('input[type="datetime-local"]').fill(localInput(contactAt));
    await contactForm.getByLabel(/Ce s-a discutat/).fill("Discuție telefonică de test (date sintetice)");
    const contactConfirm = contactForm.locator('input[id^="confirm-contact-"]');
    await contactConfirm.fill("Confirm ca am contactat aceasta firma in afara Hub-ului");
    assert.equal(await contactForm.getByRole("button", { name: "Înregistrează contactul" }).isDisabled(), true, "without diacritics the sentence does not match");
    await contactConfirm.fill(MANUAL_CONTACT_TEXT);
    await contactForm.getByRole("button", { name: "Înregistrează contactul" }).click();
    await page.locator(".sales-sheet-head").getByText("Contactată").waitFor();
    assert.equal(s.hub.sales.getOpportunity(oppId).contactEvents[0].kind, "MANUAL_RECORDED");

    // ---------- 8. follow-up after the last contact → due (scheduler tick) → "Pregătește ciorna" ----------
    const fuPanel = page.locator(".panel", { hasText: "Follow-up (" });
    await fuPanel.getByRole("button", { name: "După ultimul contact" }).click();
    await fuPanel.getByLabel(/Zile după contact/).fill("1");
    await fuPanel.getByRole("button", { name: "Programează" }).click();
    await page.locator(".panel", { hasText: "Follow-up (1)" }).waitFor();
    const fu = s.hub.sales.getOpportunity(oppId).followups[0];
    assert.equal(fu.basis, "last_contact");
    assert.equal(s.hub.sales.tick().due >= 0, true);
    assert.equal(s.hub.sales.getOpportunity(oppId).followups[0].status, "DUE", "due one day after a contact made 5 days ago");
    await page.getByRole("tab", { name: "Follow-up" }).click();
    await panel.getByRole("button", { name: "Pregătește ciorna" }).click();
    await panel.getByText("Ciornă pregătită").waitFor();
    assert.ok(s.hub.sales.getOpportunity(oppId).followups[0].draftId, "the follow-up has its draft");
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_sends").get().n, 0, "still nothing sent");

    // ---------- 9. the client's reply → IN_DISCUSSION (follow-ups suspended); then the acceptance with the exact sentence → WON ----------
    await go(`/sales?tab=opp&id=${oppId}`);
    const replyForm = page.locator("form", { hasText: "Răspuns sau opoziție a firmei" });
    await replyForm.getByRole("button", { name: "A răspuns" }).click();
    await replyForm.getByLabel("Notă (opțional)").fill("Revine cu materialele (test)");
    await replyForm.getByRole("button", { name: "Înregistrează răspunsul" }).click();
    await page.locator(".sales-sheet-head").getByText("În discuție").waitFor();
    assert.equal(s.hub.sales.getOpportunity(oppId).followups[0].status, "SUSPENDED", "a reply suspends the follow-up");
    const acceptForm = page.locator("form", { hasText: "Acceptarea clientului" });
    await acceptForm.locator('input[id^="confirm-accept-"]').fill(CLIENT_ACCEPTANCE_TEXT);
    await acceptForm.getByRole("button", { name: "Înregistrează acceptarea" }).click();
    await page.locator(".sales-sheet-head").getByText("Câștigată").waitFor();

    // ---------- 10. hand-off: the package alone first, then its Software Factory draft on the same row; nothing runs ----------
    const runsBefore = s.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    const project = s.hub.projects.hub();
    const handoffPanel = page.locator(".panel", { hasText: "Handoff spre Engineering" });
    await handoffPanel.getByText(/Nimic nu rulează/).first().waitFor();
    await handoffPanel.getByRole("button", { name: "Creează pachetul de handoff" }).click();
    await handoffPanel.getByText("doar pachetul (fără misiune legată încă)").waitFor();
    const packageOnly = s.hub.sales.getOpportunity(oppId).handoffs;
    assert.equal(packageOnly.length, 1);
    assert.equal(packageOnly[0].missionId, null, "no project chosen: only the package");
    const createMission = handoffPanel.getByRole("button", { name: "Creează misiunea" });
    assert.equal(await createMission.isDisabled(), true, "a project is needed for the mission");
    await handoffPanel.getByLabel("Proiectul în care se creează ciorna Engineering").selectOption(project.id);
    await createMission.click();
    const missionLink = handoffPanel.getByRole("link", { name: /Deschide misiunea/ }).first();
    await missionLink.waitFor();
    assert.equal(await handoffPanel.getByRole("link", { name: /Deschide misiunea/ }).count(), 1, "one hand-off row, one link");
    const handoffs = s.hub.sales.getOpportunity(oppId).handoffs;
    assert.equal(handoffs.length, 1, "the mission was attached to the same hand-off");
    const handoff = handoffs[0];
    assert.equal(handoff.id, packageOnly[0].id);
    assert.ok(handoff.missionId, "a mission was created in the chosen project");
    assert.equal(await missionLink.getAttribute("href"), `#/missions/${encodeURIComponent(handoff.missionId)}`);
    assert.equal(s.hub.factory.view(handoff.missionId).factory.stage, "SPEC_DRAFT", "a draft: the scope waits for the owner");
    assert.equal(s.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsBefore, "no model run");
    await page.screenshot({ path: path.join(shots, "03-opportunity.png"), fullPage: true });

    // ---------- 10b. rollback of the import with a reason (ALWAYS_ASK): untouched companies archived, the import's evidence shown as rolled back ----------
    await go(`/sales?tab=imports&batch=${batch.id}`);
    const rollbackPanel = page.locator(".panel", { hasText: "Rollback-ul arhivează" });
    await rollbackPanel.getByRole("button", { name: "Vezi ce s-ar anula" }).click();
    await rollbackPanel.getByText(/Firme care se arhivează \(2\)/).waitFor();
    await rollbackPanel.getByText(/Firme păstrate/).waitFor();
    await rollbackPanel.getByLabel(/Motivul rollback-ului/).fill("Import de test anulat (date sintetice)");
    await rollbackPanel.getByRole("button", { name: "Cere rollback-ul" }).click();
    await approveOnCard();
    await page.locator(".panel").getByText(/Motiv: Import de test anulat/).waitFor();
    const rolled = s.hub.sales.listBatches().find((x) => x.id === batch.id);
    assert.equal(rolled.status, "ROLLED_BACK");
    assert.equal(rolled.counts.rollback.reason, "Import de test anulat (date sintetice)");
    assert.equal(s.hub.sales.listOrgs({}).total, 1, "the company with an opportunity is kept, the other two are archived");
    await go(`/sales?tab=org&id=${orgRow.id}`);
    const historyToggle = page.getByRole("button", { name: /Arată istoricul/ });
    await historyToggle.click();
    await page.locator("tr.sales-evidence-old td[data-label='Actualitate']", { hasText: "Anulată (rollback)" }).first().waitFor();

    // ---------- 11. 360 px: no horizontal page scroll on any Sales tab ----------
    await page.setViewportSize({ width: 360, height: 780 });
    const orgId = orgRow.id;
    for (const tab of SALES_TABS) {
      const params = tab === "org" ? `&id=${orgId}` : tab === "opp" ? `&id=${oppId}` : "";
      await go(`/sales?tab=${tab}${params}`);
      await page.locator(`#sales-tab-${tab}[aria-selected="true"]`).waitFor();
      await page.waitForFunction(() => !document.querySelector("#sales-panel .skeleton, #sales-panel [aria-busy='true'] .skeleton"));
      await page.waitForTimeout(150);
      const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      assert.ok(scroll <= view + 1, `tab ${tab}: page scroll width ${scroll} > viewport ${view}`);
    }
    await page.screenshot({ path: path.join(shots, "04-mobile.png"), fullPage: true });

    for (const f of ["01-import.png", "02-org-audit.png", "03-opportunity.png", "04-mobile.png"]) assert.ok(fs.existsSync(path.join(shots, f)), f);
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
    assert.deepEqual(foreign, [], "the page requested nothing outside the local test Hub");
    await context.close();
  } finally {
    await browser.close();
    await s.stop();
  }
});
