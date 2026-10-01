// Milestone 04 — proposal and first-contact texts (contract §2.4): price and lead time only when CONFIGURED, every
// non-OBSERVED claim listed for verification, no "Am analizat site-ul" without an OBSERVED audit, generic address →
// generic greeting, nothing invented (portfolio, testimonials, discounts, names), no unresolved placeholders. Synthetic data.
import test from "node:test";
import assert from "node:assert/strict";
import { renderProposal, renderContactDraft, findUnresolvedPlaceholders } from "../server/sales/proposal.mjs";

const SECTION_IDS = ["context", "observations", "solution", "scope", "exclusions", "materials", "questions", "next_step", "price_terms"];
const INVENTED = /portofoliu|testimonial|recenzi|reducere|discount|garant|clien[țt]i mulțumi|prima pagin[ăa] (?:în|in) google|rezultate seo/i;

const org = {
  id: "org-1", displayName: "Atelierul Țesătorilor Fictivi SRL", city: "Brașov", fiscalCode: "18547290", fiscalCodeValid: true,
  domain: "atelierul-tesatorilor.test", website: "https://atelierul-tesatorilor.test",
  contacts: [{ id: "c1", kind: "email", value: "office@atelierul-tesatorilor.test", generic: true }],
};
const service = (over = {}) => ({
  id: "svc-web", name: "Site de prezentare responsive", description: "Refacerea paginilor principale pentru afișare corectă pe telefon.",
  scope: ["Pagina principală", "Pagina de contact"], exclusions: ["Texte de marketing", "Fotografii"], tags: ["responsive", "website"],
  price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, materials: ["Logo în format vectorial", "Lista serviciilor"],
  ...over,
});
const configured = service({ price: { status: "CONFIGURED", amount: 3200, currency: "ron", unit: "proiect" }, leadTime: { status: "CONFIGURED", text: "15 zile lucrătoare de la primirea materialelor" } });
const check = (id, status, label = "OBSERVED", observation = `verificarea ${id}`) => ({ id, area: "site", status, observation, evidence: { selector: "meta[name=viewport]", excerpt: "", method: "static-html" }, label });
const observedAudit = { version: "audit-v1", url: "https://atelierul-tesatorilor.test/", sourceKind: "fixture", checks: [check("mobile_viewport", "ISSUE", "OBSERVED", "Pagina nu declară viewport pentru mobil"), check("https", "PASS")], limits: [] };
const inferredAudit = { ...observedAudit, checks: [check("mobile_viewport", "ISSUE", "INFERRED", "Probabil nu e adaptat pentru mobil"), check("https", "UNKNOWN")] };
const opportunity = { checkId: "mobile_viewport", observation: "Pagina nu declară viewport pentru mobil", possibleEffect: "vizitatorii de pe telefon pot avea dificultăți de citire", serviceId: "svc-web", conditionsToConfirm: ["Câți vizitatori vin de pe telefon?"] };
const evidence = [
  { id: "ev-obs", claim: "website", value: "https://atelierul-tesatorilor.test", label: "OBSERVED", sourceKind: "fixture", sourceRef: "fixture:atelierul-tesatorilor.test", verifiedAt: "2026-09-30T10:00:00Z" },
  { id: "ev-user", claim: "Număr de magazine", value: "2", label: "USER_PROVIDED", sourceKind: "import", sourceRef: "import:lot-1#7", verifiedAt: "2026-09-30T10:00:00Z" },
  { id: "ev-src", claim: "Cifra de afaceri 2024", value: "1200000 RON", label: "SOURCE_REPORTED", sourceKind: "registry", sourceRef: "registru-fictiv.test/18547290", verifiedAt: "2026-09-30T10:00:00Z" },
  { id: "ev-inf", claim: "Vând și online", value: "probabil", label: "INFERRED", sourceKind: "note", sourceRef: "dedus din meniu", verifiedAt: "2026-09-30T10:00:00Z" },
  { id: "ev-unk", claim: "Număr de angajați", value: "necunoscut", label: "UNKNOWN", sourceKind: "import", sourceRef: "import:lot-1#7", verifiedAt: "2026-09-30T10:00:00Z" },
];
const owner = { companyName: "Studio Exemplu Digital", signatureName: "", materials: [] };
const section = (p, id) => p.sections.find((s) => s.id === id);

test("M04-P-01 proposal structure: all sections, title, text joins them, no placeholders, nothing invented", () => {
  const p = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  assert.deepEqual(p.sections.map((s) => s.id), SECTION_IDS);
  for (const s of p.sections) {
    assert.ok(s.heading && s.text, s.id);
    assert.ok(p.text.includes(s.heading) && p.text.includes(s.text), s.id);
  }
  assert.equal(p.title, "Propunere Site de prezentare responsive pentru Atelierul Țesătorilor Fictivi SRL");
  assert.deepEqual(findUnresolvedPlaceholders(p.text), []);
  assert.doesNotMatch(p.text, INVENTED);
  assert.ok(p.text.includes("Studio Exemplu Digital"));
  assert.ok(section(p, "questions").text.includes("Câți vizitatori vin de pe telefon?"));
  assert.ok(section(p, "scope").text.includes("Pagina principală") && section(p, "exclusions").text.includes("Fotografii"));
  assert.ok(section(p, "materials").text.includes("Logo în format vectorial"));
});

test("M04-P-02 price and lead time only from CONFIGURED; otherwise 'De stabilit (neconfigurat)' with warnings", () => {
  const open = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  assert.match(section(open, "price_terms").text, /preț De stabilit \(neconfigurat\); termen De stabilit \(neconfigurat\)/);
  assert.doesNotMatch(open.text, /\d+\s*(?:RON|EUR|lei)\b/i);
  assert.ok(open.warnings.some((w) => w.includes("Prețul")) && open.warnings.some((w) => w.includes("Termenul")));

  const set = renderProposal({ org, opportunity, services: [configured], evidence, audit: observedAudit, owner });
  assert.match(section(set, "price_terms").text, /preț 3200 RON \/ proiect; termen 15 zile lucrătoare de la primirea materialelor/);
  assert.ok(!set.warnings.some((w) => w.includes("Prețul") || w.includes("Termenul")));

  // A CONFIGURED status without a usable amount or currency is not a price; text on a NOT_CONFIGURED price is ignored.
  for (const price of [{ status: "CONFIGURED" }, { status: "CONFIGURED", amount: 100 }, { status: "CONFIGURED", amount: "o sută", currency: "RON" }, { status: "CONFIGURED", amount: Number.NaN, currency: "RON" }, { status: "NOT_CONFIGURED", amount: 999, currency: "RON" }, { status: "configured", amount: 999, currency: "RON" }]) {
    const p = renderProposal({ org, opportunity, services: [service({ price })], evidence, audit: observedAudit, owner });
    assert.ok(section(p, "price_terms").text.includes("preț De stabilit (neconfigurat)"), JSON.stringify(price));
    assert.ok(!p.text.includes("999"));
  }
  const leadText = renderProposal({ org, opportunity, services: [service({ leadTime: { status: "NOT_CONFIGURED", text: "3 zile" } })], evidence, audit: observedAudit, owner });
  assert.ok(!leadText.text.includes("3 zile"));
});

test("M04-P-03 observations: only OBSERVED and USER_PROVIDED with their source; claimsToVerify lists every non-OBSERVED claim", () => {
  const p = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  const obs = section(p, "observations").text;
  assert.ok(obs.includes("website: https://atelierul-tesatorilor.test") && obs.includes("fixture:atelierul-tesatorilor.test"));
  assert.ok(obs.includes("Număr de magazine: 2") && obs.includes("import:lot-1#7"));
  assert.ok(obs.includes("Pagina nu declară viewport pentru mobil") && obs.includes("OBSERVED"));
  for (const hidden of ["Cifra de afaceri", "Vând și online", "Număr de angajați"]) assert.ok(!obs.includes(hidden), hidden);
  for (const e of evidence.filter((x) => x.label !== "OBSERVED")) {
    assert.ok(p.claimsToVerify.some((c) => c.includes(e.claim) && c.includes(e.label)), e.claim);
  }
  assert.ok(!p.claimsToVerify.some((c) => c.startsWith("website")));
  assert.ok(p.claimsToVerify.some((c) => c.startsWith("Efect posibil")));
  assert.deepEqual(p.usedEvidenceIds, ["ev-obs", "ev-user"]);
  assert.ok(p.observations.some((o) => o.checkId === "mobile_viewport" && o.label === "OBSERVED"));
});

test("M04-P-04 without an OBSERVED audit the opportunity is a claim to verify, never an observation", () => {
  for (const audit of [null, inferredAudit]) {
    const p = renderProposal({ org, opportunity, services: [service()], evidence, audit, owner });
    assert.ok(!section(p, "observations").text.includes("viewport"));
    assert.ok(p.claimsToVerify.some((c) => c.includes("Pagina nu declară viewport") && c.includes("neconfirmat")));
    assert.ok(p.warnings.some((w) => w.includes("nu afirmă că site-ul a fost analizat")));
    assert.doesNotMatch(p.text, /am analizat/i);
  }
});

test("M04-P-05 owner materials are the only way portfolio/testimonials appear", () => {
  const withMaterials = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner: { ...owner, materials: [{ kind: "portofoliu", title: "Proiecte realizate", url: "https://studio-exemplu.test/proiecte" }, "Testimonial: Firma Fictivă Beta"] } });
  const s = section(withMaterials, "owner_materials");
  assert.ok(s && s.text.includes("portofoliu: Proiecte realizate (https://studio-exemplu.test/proiecte)") && s.text.includes("Testimonial: Firma Fictivă Beta"));
  const without = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  assert.equal(section(without, "owner_materials"), undefined);
});

test("M04-P-06 missing service, missing names and missing data degrade to explicit text and warnings, never placeholders", () => {
  const noService = renderProposal({ org, opportunity: { ...opportunity, serviceId: null }, services: [service(), configured], evidence, audit: observedAudit, owner });
  assert.ok(noService.warnings.some((w) => w.includes("niciun serviciu")));
  assert.ok(section(noService, "price_terms").text.includes("De stabilit (neconfigurat)"));
  const unknownService = renderProposal({ org, opportunity: { ...opportunity, serviceId: "svc-sters" }, services: [service()], evidence, audit: observedAudit, owner });
  assert.ok(unknownService.warnings.some((w) => w.includes("svc-sters")));
  const bare = renderProposal({ org: { id: "org-x" }, opportunity: null, services: [], evidence: [], audit: null, owner: {} });
  assert.deepEqual(bare.sections.map((s) => s.id), SECTION_IDS);
  assert.deepEqual(findUnresolvedPlaceholders(bare.text), []);
  assert.ok(bare.warnings.some((w) => w.includes("owner.companyName")));
  assert.doesNotMatch(bare.text, INVENTED);
  assert.deepEqual(findUnresolvedPlaceholders(renderProposal().text), []);
});

test("M04-P-07 untrusted values: placeholder syntax neutralised, secrets redacted, long text truncated", () => {
  const hostile = [
    { id: "ev-h1", claim: "Slogan", value: "Bun venit {{nume}} ${process.env.X} [[client]]", label: "USER_PROVIDED", sourceRef: "import:lot-1#9", verifiedAt: "2026-09-30" },
    { id: "ev-h2", claim: "Notă", value: `api_key=abcd1234efgh ${"x".repeat(1000)}`, label: "USER_PROVIDED", sourceRef: "import:lot-1#9", verifiedAt: "2026-09-30" },
  ];
  const p = renderProposal({ org: { ...org, displayName: "Firma {{x}} Fictivă" }, opportunity, services: [service()], evidence: hostile, audit: observedAudit, owner });
  assert.deepEqual(findUnresolvedPlaceholders(p.text), []);
  assert.ok(!p.text.includes("abcd1234efgh"));
  assert.ok(!p.text.includes("x".repeat(400)));
  assert.deepEqual(p.warnings.filter((w) => w.includes("nerezolvate")), []);
});

test("M04-P-08 synthetic organizations are marked in the title", () => {
  const p = renderProposal({ org: { ...org, synthetic: 1 }, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  assert.ok(p.title.startsWith("[DATE SINTETICE]"));
  assert.ok(p.warnings.some((w) => w.includes("sintetice")));
});

test("M04-D-01 draft with an OBSERVED audit: 'Am analizat site-ul', basis tied to the audit check, generic greeting", () => {
  const proposal = renderProposal({ org, opportunity, services: [service()], evidence, audit: observedAudit, owner });
  const d = renderContactDraft({ org, contact: org.contacts[0], proposal, audit: observedAudit, owner });
  assert.ok(d.body.startsWith("Bună ziua,\n"));
  assert.match(d.body, /Am analizat site-ul atelierul-tesatorilor\.test/);
  assert.ok(d.body.includes("Pagina nu declară viewport pentru mobil"));
  assert.deepEqual(d.personalizationBasis.map((b) => b.checkId), ["mobile_viewport"]);
  assert.ok(d.personalizationBasis.every((b) => typeof b.text === "string" && "evidenceId" in b));
  assert.equal(d.subject, "Propunere Site de prezentare responsive pentru Atelierul Țesătorilor Fictivi SRL");
  assert.deepEqual(d.claimsToVerify, proposal.claimsToVerify);
  assert.ok(d.body.includes("Studio Exemplu Digital"));
  assert.ok(d.body.includes("nu vă vom mai contacta"));
  assert.deepEqual(findUnresolvedPlaceholders(`${d.subject}\n${d.body}`), []);
  assert.doesNotMatch(d.body, INVENTED);
  assert.doesNotMatch(d.body, /\d+\s*(?:RON|EUR|lei)\b/i);
});

test("M04-D-02 no OBSERVED audit → no site-analysis claim and no audit-based personalization", () => {
  for (const audit of [null, inferredAudit, { ...observedAudit, checks: [] }]) {
    const proposal = renderProposal({ org, opportunity, services: [service()], evidence, audit, owner });
    const d = renderContactDraft({ org, contact: org.contacts[0], proposal, audit, owner });
    assert.doesNotMatch(d.body, /am analizat/i);
    assert.doesNotMatch(d.body, /viewport/i);
    assert.ok(d.personalizationBasis.every((b) => !b.checkId));
    assert.deepEqual(findUnresolvedPlaceholders(d.body), []);
  }
  // A forged proposal claiming an OBSERVED check does not unlock the sentence when the audit itself observed nothing.
  const forged = { claimsToVerify: [], observations: [{ text: "Site lent", evidenceId: null, checkId: "speed", label: "OBSERVED" }], serviceNames: [] };
  assert.doesNotMatch(renderContactDraft({ org, contact: org.contacts[0], proposal: forged, audit: null, owner }).body, /am analizat|Site lent/i);
});

test("M04-D-03 greeting: generic or missing contact → generic; never an invented name", () => {
  const generic = renderContactDraft({ org, contact: { id: "c", kind: "email", value: "info@firma-fictiva.test", generic: false, name: "Ion Popescu" }, proposal: null, audit: null, owner });
  assert.ok(generic.body.startsWith("Bună ziua,\n"));
  assert.ok(!generic.body.includes("Ion Popescu"));
  const none = renderContactDraft({ org, contact: null, proposal: null, audit: null, owner });
  assert.ok(none.body.startsWith("Bună ziua,\n") && none.warnings.some((w) => w.includes("contact")));
  const personalNoName = renderContactDraft({ org, contact: { id: "c", kind: "email", value: "a.ionescu@firma-fictiva.test", generic: false }, proposal: null, audit: null, owner });
  assert.ok(personalNoName.body.startsWith("Bună ziua,\n"));
  // A personal address with a recorded name uses it, and the name goes on the owner's verification list.
  const named = renderContactDraft({ org, contact: { id: "c", kind: "email", value: "a.ionescu@firma-fictiva.test", generic: false, name: "Ana Ionescu" }, proposal: null, audit: null, owner });
  assert.ok(named.body.startsWith("Bună ziua, Ana Ionescu,"));
  assert.ok(named.claimsToVerify.some((c) => c.includes("Ana Ionescu")));
  const phone = renderContactDraft({ org, contact: { id: "c", kind: "phone", value: "+40700000123", generic: false }, proposal: null, audit: null, owner });
  assert.ok(phone.warnings.some((w) => w.includes("e-mail")));
});

test("M04-D-04 draft without owner or org data still has no placeholders; synthetic subject is marked", () => {
  const d = renderContactDraft({});
  assert.deepEqual(findUnresolvedPlaceholders(`${d.subject}\n${d.body}`), []);
  assert.equal(d.subject, "Propunere de colaborare");
  assert.ok(d.warnings.some((w) => w.includes("owner.companyName")));
  const s = renderContactDraft({ org: { ...org, synthetic: true }, contact: org.contacts[0], proposal: null, audit: null, owner });
  assert.ok(s.subject.startsWith("[DATE SINTETICE]"));
});

test("M04-D-05 findUnresolvedPlaceholders catches template leftovers", () => {
  for (const bad of ["Salut {{nume}}", "Preț: ${pret}", "Firma undefined", "NaN RON", "[object Object]", "Bună ziua, <nume>", "TODO"]) {
    assert.ok(findUnresolvedPlaceholders(bad).length > 0, bad);
  }
  assert.deepEqual(findUnresolvedPlaceholders("Bună ziua, mulțumim."), []);
});
