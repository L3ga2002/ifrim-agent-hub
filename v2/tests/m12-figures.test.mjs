// M12 WP6 — C-02 / T-S5: no invented commercial figure in a generated offer. The scanner finds every category in positive controls
// (so it is not vacuous), ignores counts, fiscal codes, dates and versions, allows only CONFIGURED catalog texts, and finds nothing
// in the offers and drafts the M12 path generates (a missing price is UNKNOWN, „catalog neconfigurat”). The offer gains „Ce s-a
// cerut” only with a brief; M04 inputs keep their nine sections. A preparation-bound offer with a figure cannot be approved.
import test from "node:test";
import assert from "node:assert/strict";
import { findCommercialFigures, allowedCatalogTexts, proposalFigures, FIGURE_CATEGORIES } from "../server/sales/figures.mjs";
import { renderProposal, renderContactDraft, findUnresolvedPlaceholders, UNKNOWN_PRICE_REASON } from "../server/sales/proposal.mjs";
import { parseBrief } from "../server/sales/brief.mjs";
import { syntheticOrgFor } from "../server/sales/synthetic.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { salesAcceptanceHub, seedSalesReview, salesCommand, salesFingerprint } from "./sales-helpers.mjs";

const M04_SECTION_IDS = ["context", "observations", "solution", "scope", "exclusions", "materials", "questions", "next_step", "price_terms"];
const categories = (text, options) => [...new Set(findCommercialFigures(text, options).map((f) => f.category))];
const owner = { companyName: "Ifrim Digital", signatureName: "", materials: [] };
const REQUESTS = [
  "pregătește o ofertă pentru un service auto din Cluj care vrea programări online",
  "pregateste o oferta pt un servis auto din cluj care vrea programari online, buget 2000 lei, în 2 săptămâni",
  "fă o ofertă pentru un cabinet stomatologic din Iasi care nu are site",
  "pregătește o ofertă pentru o florărie din Timișoara care vrea postări pe Facebook, cu reducere de 10% și ROI garantat",
  "pregătește o ofertă pentru o pensiune din Sibiu care vrea rezervări online până la Crăciun",
];

/** An M12 offer as the preparation renders it: synthetic client from the brief, empty catalog, no audit, the brief's need. */
function m12Offer(request, seed) {
  const brief = { ...parseBrief(request), id: `spp_m12fig_${seed}` };
  const identity = syntheticOrgFor(brief, `opp_plan_${seed}`);
  const org = { id: `org_${seed}`, displayName: identity.name, fiscalCode: identity.fiscalCode, fiscalCodeValid: true, website: identity.website, domain: identity.domain, synthetic: true,
    contacts: [{ id: "sct_1", kind: "email", value: identity.email, generic: true }] };
  const proposal = renderProposal({ org, opportunity: { title: "Ofertă sintetică", need: brief.fields.problem?.value || "", serviceId: null }, services: [], evidence: [], audit: null, owner, brief });
  const draft = renderContactDraft({ org, contact: org.contacts[0], proposal, audit: null, owner });
  return { brief, proposal, draft };
}

test("M12-FIG-01 positive controls: every category is found (the scanner is not vacuous)", () => {
  const controls = {
    currency: ["1.500 de lei", "€1500", "1500 €", "$200", "2000 EUR", "RON 3000", "1 500 lei", "0 lei", "zero lei? nu: 0 lei"],
    price: ["preț: 2500", "costul este 300", "abonament 50 pe lună", "buget 7000"],
    duration: ["15 zile lucrătoare", "două săptămâni", "48 de ore", "3 luni", "1-2 săptămâni", "o lună", "un an"],
    percentage: ["30%", "10 %", "15 la sută", "20 procente"],
    roi: ["ROI 30%", "randament mai bun", "amortizare rapidă", "economisiți timp", "profit mai mare", "venituri suplimentare", "dublarea vânzărilor"],
    discount: ["reducere 10%", "discount pentru primii clienți", "gratuit", "consultanță gratis", "bonus la livrare", "ofertă specială", "promoție"],
    approximation: ["aproximativ 2000", "aprox. 300", "~2000", "în jur de 500", "circa 3000", "estimativ", "un cost estimat"],
  };
  assert.deepEqual(Object.keys(controls), FIGURE_CATEGORIES);
  for (const [category, texts] of Object.entries(controls)) {
    for (const text of texts) assert.ok(categories(text).includes(category), `${category} not found in „${text}”: ${JSON.stringify(findCommercialFigures(text))}`);
  }
  const found = findCommercialFigures("Oferta: 1.500 de lei, livrare în 15 zile, reducere 10%.");
  assert.deepEqual(found.map((f) => f.text), ["1.500 de lei", "15 zile", "reducere", "10%"]);
  assert.ok(found.every((f, i) => i === 0 || f.index >= found[i - 1].index), "ordered by position");
});

test("M12-FIG-02 not commercial figures: counts, fiscal codes, dates, versions, hosts, phones, the explicit UNKNOWN text", () => {
  for (const text of [
    "3 din 7 imagini nu au atributul alt (text alternativ).", "Pagina are un meniu de navigare cu 4 legături.", "CUI: 9912345679", "Site: https://stejaras-auto-service-margelus.test",
    "verificat la 2026-09-30T10:00:00Z", "Propunerea v3 înlocuiește v2", "Pagina afișează un număr de telefon (+40 721 000 101).", "Preț: De stabilit (neconfigurat). Termen: De stabilit (neconfigurat).",
    "Oraș: Cluj-Napoca", "Care este obiectivul principal pe care îl urmăriți în perioada următoare?", "Ora deschiderii nu apare în pagină.", "",
  ]) assert.deepEqual(findCommercialFigures(text), [], text);
  assert.deepEqual(findCommercialFigures(null), []);
});

test("M12-FIG-03 the allowlist holds only CONFIGURED catalog texts; a figure outside them is still found", () => {
  const configured = { id: "svc_web", name: "Site", price: { status: "CONFIGURED", amount: 3200, currency: "ron", unit: "proiect" }, leadTime: { status: "CONFIGURED", text: "15 zile lucrătoare de la primirea materialelor" } };
  const open = { id: "svc_open", name: "Site", price: { status: "NOT_CONFIGURED", amount: 999, currency: "RON" }, leadTime: { status: "NOT_CONFIGURED", text: "3 zile" } };
  assert.deepEqual(allowedCatalogTexts([configured]), ["3200 RON / proiect", "15 zile lucrătoare de la primirea materialelor"]);
  assert.deepEqual(allowedCatalogTexts([open]), [], "a NOT_CONFIGURED value is never allowed, whatever it holds");
  assert.deepEqual(allowedCatalogTexts([]), []);
  const p = renderProposal({ org: { displayName: "Firma Sintetică SRL" }, opportunity: { serviceId: "svc_web" }, services: [configured], evidence: [], audit: null, owner });
  assert.ok(proposalFigures(p).length > 0, "a configured price is a figure");
  assert.deepEqual(proposalFigures(p, { allow: allowedCatalogTexts([configured]) }), [], "… allowed only as the catalog's exact text");
  assert.deepEqual(categories(`${p.text}\nreducere 10%`, { allow: allowedCatalogTexts([configured]) }).sort(), ["discount", "percentage"]);
  assert.equal("pricing" in p, false, "no brief (M04 path): no pricing field");
  const m12 = renderProposal({ org: { displayName: "Firma Sintetică SRL" }, opportunity: { serviceId: "svc_web" }, services: [configured], evidence: [], audit: null, owner, brief: { ...parseBrief(REQUESTS[0]), id: "spp_m12fig" } });
  assert.deepEqual(m12.pricing, [{ item: "price", serviceId: "svc_web", status: "CONFIGURED", text: "3200 RON / proiect" }, { item: "leadTime", serviceId: "svc_web", status: "CONFIGURED", text: "15 zile lucrătoare de la primirea materialelor" }]);
});

test("M12-FIG-04 generated M12 offers and drafts: zero figures, „Ce s-a cerut” from the brief, explicit UNKNOWN prices, no placeholders", () => {
  REQUESTS.forEach((request, i) => {
    for (const seed of [1, 2, 3]) {
      const { brief, proposal, draft } = m12Offer(request, `${i}_${seed}`);
      assert.deepEqual(proposalFigures(proposal), [], `${request}: ${JSON.stringify(proposalFigures(proposal))}`);
      assert.deepEqual(findCommercialFigures(`${draft.subject}\n${draft.body}`), [], `draft: ${request}`);
      assert.deepEqual(findUnresolvedPlaceholders(proposal.text), []);
      assert.deepEqual(proposal.sections.map((s) => s.id), ["context", "request", ...M04_SECTION_IDS.slice(1)], request);
      const asked = proposal.sections.find((s) => s.id === "request");
      assert.equal(asked.heading, "Ce s-a cerut");
      assert.ok(asked.text.includes(brief.fields.problem.value) && asked.text.includes(`brief:${brief.id}#problem; USER_PROVIDED`), asked.text);
      for (const internal of [brief.fields.budget?.value, brief.fields.deadline?.value, brief.fields.city?.value, brief.fields.service?.value].filter(Boolean)) {
        assert.ok(!proposal.text.includes(internal), `internal brief value in the client text: ${internal}`);
      }
      assert.match(proposal.sections.find((s) => s.id === "price_terms").text, /^Preț: De stabilit \(neconfigurat\)\. Termen: De stabilit \(neconfigurat\)\.$/);
      assert.deepEqual(proposal.pricing, [
        { item: "price", serviceId: null, status: "UNKNOWN", text: "De stabilit (neconfigurat)", reason: UNKNOWN_PRICE_REASON },
        { item: "leadTime", serviceId: null, status: "UNKNOWN", text: "De stabilit (neconfigurat)", reason: UNKNOWN_PRICE_REASON },
      ]);
      assert.equal(UNKNOWN_PRICE_REASON, "catalog neconfigurat");
      assert.ok(proposal.title.startsWith("[DATE SINTETICE] "));
    }
  });
});

test("M12-FIG-05 M04 inputs are unchanged: byte-identical to the pre-M12 render (no pricing, nine sections); with a brief, only „Ce s-a cerut” and pricing are added", () => {
  const org = { displayName: "Atelierul Țesătorilor Fictivi SRL", city: "Brașov", fiscalCode: "18547290", fiscalCodeValid: true, website: "https://atelierul-tesatorilor.test", contacts: [] };
  const service = { id: "svc-web", name: "Site de prezentare responsive", description: "Refacere", scope: ["Pagina principală"], exclusions: ["Fotografii"], tags: ["website"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, materials: ["Logo"] };
  const configured = { ...service, price: { status: "CONFIGURED", amount: 3200, currency: "ron", unit: "proiect" }, leadTime: { status: "CONFIGURED", text: "15 zile lucrătoare de la primirea materialelor" } };
  const audit = { version: "audit-v1", url: "https://atelierul-tesatorilor.test/", sourceKind: "fixture", checks: [{ id: "mobile_viewport", area: "site", status: "ISSUE", observation: "Pagina nu declară viewport pentru mobil", evidence: { selector: "meta[name=viewport]", excerpt: "", method: "static-html" }, label: "OBSERVED" }], limits: [] };
  const evidence = [{ id: "ev-obs", claim: "website", value: "https://atelierul-tesatorilor.test", label: "OBSERVED", sourceKind: "fixture", sourceRef: "fixture:atelierul-tesatorilor.test", verifiedAt: "2026-09-30T10:00:00Z" },
    { id: "ev-inf", claim: "Vând și online", value: "probabil", label: "INFERRED", sourceKind: "note", sourceRef: "dedus din meniu", verifiedAt: "2026-09-30T10:00:00Z" }];
  // hashCanonical of the same renders by the pre-M12 proposal.mjs (commit 7fc6c89 = base 2fa81a9 for this file): an M04 proposal keeps
  // byte-identical content, so createProposal stores the same content_sha as before M12.
  const PRE_M12 = {
    open: [{ org, opportunity: { serviceId: "svc-web", checkId: "mobile_viewport", observation: "Pagina nu declară viewport", possibleEffect: "citire greoaie", conditionsToConfirm: ["Câți vizitatori vin de pe telefon?"] }, services: [service], evidence, audit, owner },
      "c69c3d4190a25ca1e6cd0c33a55b69476dfe42b41b739fa459bd8b15cbe5313e"],
    configured: [{ org: { ...org, synthetic: 1 }, opportunity: { serviceId: "svc-web" }, services: [configured], evidence: [], audit: null, owner: { ...owner, materials: ["Portofoliu: proiecte"] } },
      "397bf70bdc13c1a0195fee967031c8da9031346edad5ac214152e7078544aef5"],
    bare: [{}, "593d63b5725225c7348ec576e07b7ec4f18050ae9a782665c618a6b1f941de97"],
  };
  for (const [name, [preInput, sha]] of Object.entries(PRE_M12)) {
    const out = renderProposal(preInput);
    assert.equal(hashCanonical(out), sha, `${name}: the M04 render changed`);
    assert.deepEqual(Object.keys(out), ["title", "sections", "claimsToVerify", "usedEvidenceIds", "warnings", "text", "observations", "serviceNames"], name);
    assert.deepEqual(renderProposal({ ...preInput, brief: null }), out);
  }
  const input = { org, opportunity: { serviceId: "svc-web", observation: "Pagina nu declară viewport", conditionsToConfirm: [] }, services: [service], evidence: [], audit: null, owner };
  const m04 = renderProposal(input);
  assert.deepEqual(m04.sections.map((s) => s.id), M04_SECTION_IDS);
  assert.deepEqual(renderProposal({ ...input, brief: null }), m04);
  assert.deepEqual(renderProposal({ ...input, brief: undefined }), m04);
  assert.equal("pricing" in m04, false);
  const brief = { ...parseBrief(REQUESTS[0]), id: "spp_m12fig" };
  const withBrief = renderProposal({ ...input, brief });
  assert.deepEqual(withBrief.sections.filter((s) => s.id !== "request"), m04.sections, "every M04 section identical");
  assert.equal(withBrief.title, m04.title);
  assert.deepEqual(withBrief.claimsToVerify, m04.claimsToVerify);
  assert.deepEqual(withBrief.pricing.map((p) => [p.item, p.status, p.reason]), [["price", "UNKNOWN", "catalog neconfigurat"], ["leadTime", "UNKNOWN", "catalog neconfigurat"]]);
  // A brief without a stated need adds nothing to the client text (and says so to the owner).
  const vague = renderProposal({ ...input, brief: { ...parseBrief("pregătește o ofertă pentru un service auto"), id: "spp_vague" } });
  assert.deepEqual(vague.sections, m04.sections);
  assert.ok(vague.warnings.some((w) => w.includes("Ce s-a cerut")));
});

test("M12-FIG-06 the approval of a preparation-bound offer refuses invented figures (approval not consumed, nothing written); M04 offers are not gated", async (c) => {
  const t = await salesAcceptanceHub(c, { listen: false });
  const b = await seedSalesReview(t);
  const row = t.hub.db.prepare("SELECT content_json FROM sales_proposals WHERE id = ?").get(b.proposalId);
  // Test-only: make the seeded offer preparation-bound (the preparation step writes `basis`; part 3) with an injected figure.
  const content = JSON.parse(row.content_json);
  const bound = { ...content, basis: { preparationId: "spp_m12fig", briefSha: "0".repeat(64) },
    sections: content.sections.map((s) => (s.id === "next_step" ? { ...s, text: `${s.text} Livrare în 15 zile, cu reducere de 10%.` } : s)) };
  bound.text = bound.sections.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
  const setContent = (value) => { const sha = hashCanonical(value); t.hub.db.prepare("UPDATE sales_proposals SET content_json = ?, content_sha = ? WHERE id = ?").run(JSON.stringify(value), sha, b.proposalId); return sha; };
  const approve = async (sha, proposalId = b.proposalId) => {
    const r = await salesCommand(t, "sales.proposal.approve", { proposalId, displayedSha: sha });
    await salesCommand(t, "approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash });
    return { r, run: () => t.hub.commands.executeApproved(r.command.id, "test") };
  };
  const figureSha = setContent(bound);
  const before = salesFingerprint(t);
  const blocked = await approve(figureSha);
  await assert.rejects(blocked.run(), (e) => e.code === "COMMERCIAL_FIGURES" && /cifre comerciale/.test(e.message) && e.details.figures.some((f) => f.text === "15 zile"));
  assert.notEqual(t.hub.approvals.get(blocked.r.approval.id).status, "consumed", "the refused approval is not burnt");
  assert.equal(t.hub.db.prepare("SELECT status FROM sales_proposals WHERE id = ?").get(b.proposalId).status, "DRAFT");
  assert.equal(t.hub.db.prepare("SELECT status FROM sales_opportunities WHERE id = ?").get(b.oppId).status, "READY_FOR_OWNER_REVIEW");
  assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sales.proposal.approved'").get().n, 0);
  assert.equal(salesFingerprint(t), before, "no Sales write (only the refused command is logged)");
  // Without the figure, the same bound offer is approved.
  const cleanSha = setContent({ ...content, basis: bound.basis });
  const ok = await approve(cleanSha);
  const done = await ok.run();
  assert.equal(done.result.approved, true);
  assert.equal(t.hub.db.prepare("SELECT status, approved_sha FROM sales_proposals WHERE id = ?").get(b.proposalId).approved_sha, cleanSha);
  // An M04 offer (no basis) keeps the M04 behaviour: the owner's own edited text is not gated by the M12 scanner (C-07).
  const p2 = (await salesCommand(t, "sales.proposal.create", { opportunityId: b.oppId, edits: { sections: [{ id: "next_step", text: "Livrare în 15 zile." }] } })).result;
  await salesCommand(t, "sales.opportunity.transition", { opportunityId: b.oppId, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire sintetică" });
  const m04 = await approve(p2.contentSha, p2.id);
  assert.equal((await m04.run()).result.approved, true);
});
