// M12 WP5 — C-04 / S-04 / T-S10 / T-S4: qualification formula q-v2 next to the unchanged q-v1 (the default). The same dataset is
// scored under both: q-v2 lists every inference (explanation, `inferences`, „ce lipsește”) and is NEUTRAL to it — the same data
// without its inferences gives the same q-v2 score — and it is STRICT: no point without a recorded, non-inference evidence id (a
// field present without evidence is „fără dovadă” in „ce lipsește”). q-v2 is never asserted to be ≤ (or ≥) q-v1: on the realistic
// dataset it is higher, on the M04 fixture lower. Pure datasets first, then the same rules through the Sales service on an isolated
// synthetic hub (rows side by side, q-v1 row untouched, overrides).
import test from "node:test";
import assert from "node:assert/strict";
import { QUALIFICATION_FORMULA, QUALIFICATION_FORMULAS, QUALIFICATION_FORMULA_DOC_V2, QUALIFICATION_FORMULA_DOCS, qualify } from "../server/sales/qualify.mjs";
import { HubError } from "../server/core/errors.mjs";
import { salesAcceptanceHub, seedSalesReview, salesCommand } from "./sales-helpers.mjs";

const run = async (t, type, payload) => (await salesCommand(t, type, payload)).result;
const catalog = [
  { id: "svc-web", name: "Site de prezentare", tags: ["website"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" } },
  { id: "svc-contact", name: "Formular de contact", tags: ["contact"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" } },
];
const check = (id, status, label = "OBSERVED") => ({ id, area: "site", status, observation: `verificarea ${id}: ${status}`, evidence: { selector: "head", excerpt: "", method: "static-html" }, label });
const opp = (checkId, serviceId, observation) => ({ checkId, observation, possibleEffect: "", serviceId, conditionsToConfirm: [] });

/**
 * A realistic dataset (what the Sales service passes to qualify): every field of the record is backed by evidence (an import row
 * and its contact), the audit has one OBSERVED and one INFERRED issue, and three things are inferences: an INFERRED reading
 * (employees), the city (only an INFERENCE row backs it) and an opportunity on the INFERRED check.
 */
function dataset({ withInferences = true } = {}) {
  const org = { id: "org-m12", displayName: "Ștejăraș Auto Service Mărgeluș SRL", fiscalCode: "9912345679", fiscalCodeValid: true, website: "https://stejaras-auto-service-margelus.test",
    domain: "stejaras-auto-service-margelus.test", city: withInferences ? "Cluj-Napoca" : "", synthetic: true,
    contacts: [{ id: "sct-1", kind: "email", value: "office@stejaras-auto-service-margelus.test", generic: true, evidenceId: "ev-import" }] };
  const evidence = [
    { id: "ev-import", claim: "Date furnizate în importul sintetic.csv#rând 2", value: { name: org.displayName, fiscalCode: org.fiscalCode, website: org.website }, label: "USER_PROVIDED", sourceKind: "file", sourceRef: "sintetic.csv#rând 2", dataKind: null },
    { id: "ev-site", claim: "audit:mobile_viewport", value: { status: "ISSUE" }, label: "OBSERVED", sourceKind: "fixture", sourceRef: "https://x.test (fixture sintetic)", dataKind: "FIXTURE" },
    { id: "ev-unknown", claim: "turnover", value: "?", label: "UNKNOWN", sourceKind: "file", sourceRef: "sintetic.csv#rând 2", dataKind: null },
    ...(withInferences ? [
      { id: "ev-employees", claim: "employees", value: "12", label: "INFERRED", sourceKind: "manual", sourceRef: "dedus din pagină", dataKind: "INFERENCE", basis: ["sev_x"], reasoning: "meniul are 12 nume" },
      { id: "ev-city", claim: "city", value: "Cluj-Napoca", label: "INFERRED", sourceKind: "manual", sourceRef: "brief:spp_1#place", dataKind: "INFERENCE", basis: ["brief:spp_1#place"], reasoning: "reședința județului" },
      { id: "ev-form", claim: "audit:contact_form", value: { status: "ISSUE" }, label: "INFERRED", sourceKind: "fixture", sourceRef: "https://x.test (fixture sintetic)", dataKind: "INFERENCE", basis: ["audit:sad_1#contact_form"], reasoning: "dedus" },
    ] : []),
  ];
  const audit = { version: "audit-v1", url: "https://x.test/", sourceKind: "fixture", checks: [check("mobile_viewport", "ISSUE"), check("https", "PASS"), ...(withInferences ? [check("contact_form", "ISSUE", "INFERRED")] : [])], limits: [] };
  const opportunities = [opp("mobile_viewport", "svc-web", "Pagina nu declară viewport pentru mobil"), ...(withInferences ? [opp("contact_form", "svc-contact", "Nu există formular de contact")] : [])];
  return { org, evidence, audit, opportunities, catalog };
}
const INFERENCE_IDS = ["ev-employees", "ev-city", "ev-form"];
const neutralPart = (r) => ({ components: r.components, priority: r.priority, weightsUsed: r.weightsUsed, unknowns: r.unknowns, financialFilter: r.financialFilter });
const points = (r) => Object.values(r.components).flatMap((c) => c.contributions).filter((c) => c.points > 0);

test("M12-QV2-01 two formulas, q-v1 unchanged and the default; q-v2 keeps the q-v1 weights; an unknown formula is a validation error", () => {
  assert.deepEqual(Object.keys(QUALIFICATION_FORMULAS), ["q-v1", "q-v2"]);
  assert.equal(QUALIFICATION_FORMULAS["q-v1"], QUALIFICATION_FORMULA);
  assert.equal(QUALIFICATION_FORMULA.version, "q-v1");
  assert.deepEqual({ ...QUALIFICATION_FORMULAS["q-v2"].weights }, { ...QUALIFICATION_FORMULA.weights });
  assert.ok(Object.isFrozen(QUALIFICATION_FORMULAS["q-v2"]));
  const d = dataset();
  assert.deepEqual(qualify(d), qualify(d, { formula: "q-v1" }), "no option = q-v1");
  assert.deepEqual(qualify(d, {}), qualify(d));
  assert.equal(qualify(d).inferences, undefined, "q-v1 output keeps its M04 shape");
  for (const formula of ["q-v3", "", "Q-V2", null]) assert.throws(() => qualify(d, { formula }), (e) => e instanceof HubError && e.category === "validation", String(formula));
  assert.ok(QUALIFICATION_FORMULA_DOC_V2.some((l) => l.includes("q-v2") && l.includes("inferențele nu se punctează")));
  assert.ok(QUALIFICATION_FORMULA_DOC_V2.some((l) => /probabilitate/.test(l)));
  assert.deepEqual(Object.keys(QUALIFICATION_FORMULA_DOCS), ["q-v1", "q-v2"]);
});

test("M12-QV2-02 T-S10 same dataset under q-v1 and q-v2: q-v2 is neutral to inferences (D and D without them score the same), q-v1 is not", () => {
  const D = dataset();
  const DminusI = dataset({ withInferences: false });
  const v1 = qualify(D, { formula: "q-v1" });
  const v2 = qualify(D, { formula: "q-v2" });
  assert.equal(v1.version, "q-v1"); assert.equal(v2.version, "q-v2");
  // Neutrality: removing every inference (the INFERRED readings, the inferred city value, the opportunity on an inferred check)
  // changes no q-v2 component, contribution, unknown or the priority.
  assert.deepEqual(neutralPart(v2), neutralPart(qualify(DminusI, { formula: "q-v2" })));
  // q-v1 (documented old behaviour) counts them: INFERRED readings in the evidence average, +10 for the unconfirmed opportunity, the city's presence.
  const v1Minus = qualify(DminusI, { formula: "q-v1" });
  assert.notEqual(v1.components.evidence.score, v1Minus.components.evidence.score);
  assert.equal(v1.components.serviceFit.score, 35); assert.equal(v1Minus.components.serviceFit.score, 25);
  assert.equal(v2.components.serviceFit.score, 25);
  assert.equal(v1.components.completeness.score - v1Minus.components.completeness.score, 10, "q-v1 scores the inferred city");
  // Documented values on this dataset (here q-v2 is higher; never asserted as an order): q-v1 49 = 35·0.5 + 51·0.3 + 80·0.2;
  // q-v2 54 = 25·0.5 + 90·0.3 + 70·0.2 (every field of the record is backed by evidence, the city only by an inference).
  assert.deepEqual([v1.components.serviceFit.score, v1.components.evidence.score, v1.components.completeness.score, v1.priority], [35, 51, 80, 49]);
  assert.deepEqual([v2.components.serviceFit.score, v2.components.evidence.score, v2.components.completeness.score, v2.priority], [25, 90, 70, 54]);
  assert.deepEqual(v2.unproven, [], "every present field is backed here");
  // Every inference is listed: in `inferences`, in „ce lipsește” and in the explanation.
  const listed = v2.inferences.flatMap((i) => i.evidenceIds);
  for (const id of INFERENCE_IDS) assert.ok(listed.includes(id), id);
  assert.ok(v2.inferences.some((i) => i.component === "serviceFit" && i.claim.includes("formular de contact")));
  assert.ok(v2.inferences.some((i) => (i.fields || []).includes("oraș") || (i.component === "completeness" && i.claim === "oraș")), "the inferred city is named as a field");
  assert.equal(v2.missing.filter((m) => m.startsWith("de confirmat: ")).length, v2.inferences.length);
  for (const u of v2.unknowns) assert.ok(v2.missing.includes(u));
  assert.ok(v2.explanation.some((l) => l.startsWith(`Inferențe (nu se punctează în q-v2): ${v2.inferences.length}`)));
  assert.ok(v2.explanation[0].startsWith("Formula q-v2:"));
  // S-04: every q-v2 point carries its evidence, and never an inference's.
  for (const c of points(v2)) {
    assert.ok(c.evidenceIds.length > 0, `point without evidence: ${c.factor}`);
    assert.ok(!c.evidenceIds.some((id) => INFERENCE_IDS.includes(id)), `point from an inference: ${c.factor}`);
  }
  // Deterministic (T-S4).
  assert.deepEqual(qualify(dataset(), { formula: "q-v2" }), v2);
});

test("M12-QV2-03 inference-only data: q-v1 scores it (25 per reading, 10 per unconfirmed opportunity), q-v2 says unknown and lists it", () => {
  const evidence = [{ id: "ev-a", claim: "employees", value: "12", label: "INFERRED", sourceRef: "dedus" }, { id: "ev-b", claim: "online", value: "da", label: "INFERRED", dataKind: "INFERENCE", sourceRef: "dedus" }];
  const org = { id: "o", displayName: "Firma Sintetică SRL", contacts: [] };
  const v1 = qualify({ org, evidence, audit: null, opportunities: [opp("contact_form", "svc-contact", "Nu există formular")], catalog });
  const v2 = qualify({ org, evidence, audit: null, opportunities: [opp("contact_form", "svc-contact", "Nu există formular")], catalog }, { formula: "q-v2" });
  assert.equal(v1.components.evidence.score, 25);
  assert.equal(v1.components.serviceFit.score, 10);
  assert.equal(v2.components.evidence.score, null);
  assert.equal(v2.components.serviceFit.score, null);
  assert.ok(v2.unknowns.some((u) => u.includes("calitatea dovezilor")) && v2.unknowns.some((u) => u.includes("potrivirea cu serviciile")));
  assert.deepEqual(v2.inferences.map((i) => i.component).sort(), ["evidence", "evidence", "serviceFit"]);
  assert.ok(v2.missing.includes("de confirmat: employees") && v2.missing.includes("de confirmat: online"));
  // The name is in the record but no evidence row proves it: q-v1 gives it 10 points, q-v2 none (it is „fără dovadă”).
  assert.equal(v1.components.completeness.score, 10);
  assert.equal(v2.components.completeness.score, null, "nothing proven: unknown, never 0 or 10");
  assert.equal(v2.priority, null);
  assert.deepEqual(v2.unproven, [{ component: "completeness", claim: "nume firmă", why: "prezent în fișă, fără o dovadă înregistrată" }]);
  assert.ok(v2.missing.includes("fără dovadă: nume firmă"));
  assert.deepEqual(points(v2), []);
  // A data kind alone marks an inference even if a caller mislabelled it (C-03 forbids that label for new rows).
  const mislabelled = qualify({ org, evidence: [{ id: "ev-c", claim: "x", label: "OBSERVED", dataKind: "INFERENCE", sourceRef: "dedus" }] }, { formula: "q-v2" });
  assert.equal(mislabelled.components.evidence.score, null);
  // A confirmed reading without an id cannot name its evidence: it scores nothing in q-v2 (q-v1 counts it).
  const anonymous = [{ claim: "website", value: "https://x.test", label: "OBSERVED", sourceRef: "fixture" }];
  assert.equal(qualify({ org, evidence: anonymous }).components.evidence.score, 100);
  const strict = qualify({ org, evidence: anonymous }, { formula: "q-v2" });
  assert.equal(strict.components.evidence.score, null);
  assert.ok(strict.missing.includes("fără dovadă: website"));
});

test("M12-QV2-04 a pure dataset (the M04 fixture) under q-v2: no point without its evidence id; unproven fields are „fără dovadă”; with evidence the points return", () => {
  const org = { id: "org-1", displayName: "Brutăria Șoricelul Fictiv SRL", city: "Iași", fiscalCode: "18547290", fiscalCodeValid: true, domain: "brutaria-soricelul.test", website: "https://brutaria-soricelul.test",
    contacts: [{ id: "c1", kind: "email", value: "office@brutaria-soricelul.test", generic: true }, { id: "c2", kind: "phone", value: "+40700000123", generic: false }] };
  const audit = { version: "audit-v1", url: "https://brutaria-soricelul.test/", sourceKind: "fixture", checks: [check("mobile_viewport", "ISSUE"), check("contact_form", "ISSUE"), check("https", "PASS")], limits: [] };
  const opportunities = [opp("mobile_viewport", "svc-web", "Pagina nu declară viewport pentru mobil"), opp("contact_form", "svc-contact", "Nu există formular de contact")];
  const evidence = [
    { id: "ev-1", claim: "website", value: "https://brutaria-soricelul.test", label: "OBSERVED", sourceKind: "fixture", sourceRef: "fixture:brutaria-soricelul.test" },
    { id: "ev-2", claim: "phone", value: "+40700000123", label: "USER_PROVIDED", sourceKind: "import", sourceRef: "import:lot-1#3" },
    { id: "ev-3", claim: "employees", value: "12", label: "INFERRED", sourceKind: "note", sourceRef: "nota proprietar" },
    { id: "ev-4", claim: "turnover", value: "?", label: "UNKNOWN", sourceKind: "import", sourceRef: "import:lot-1#3" },
  ];
  const input = { org, evidence, audit, opportunities, catalog };
  const v1 = qualify(input);
  const v2 = qualify(input, { formula: "q-v2" });
  assert.deepEqual([v1.components.serviceFit.score, v1.components.evidence.score, v1.components.completeness.score, v1.priority], [50, 68, 100, 65], "q-v1 exactly as M04-Q-02");
  // q-v2 (recomputed; lower here, never asserted as an order): the two observed issues have no evidence row → 0; the readings
  // OBSERVED 100 + USER_PROVIDED 80 → 90; only the site (ev-1) and the phone (ev-2) are proven → 40; 0·0.5 + 90·0.3 + 40·0.2 = 35.
  assert.deepEqual([v2.components.serviceFit.score, v2.components.evidence.score, v2.components.completeness.score, v2.priority], [0, 90, 40, 35]);
  for (const c of points(v2)) assert.ok(c.evidenceIds.length > 0, `point without evidence: ${c.factor}`);
  assert.deepEqual(v2.unproven.map((u) => `${u.component}:${u.claim}`), ["serviceFit:Pagina nu declară viewport pentru mobil", "serviceFit:Nu există formular de contact",
    "completeness:nume firmă", "completeness:CUI valid", "completeness:oraș", "completeness:e-mail"]);
  for (const u of v2.unproven) assert.ok(v2.missing.includes(`fără dovadă: ${u.claim}`), u.claim);
  assert.ok(v2.explanation.some((l) => l.startsWith("Fără dovadă înregistrată (nu se punctează în q-v2): 6")));
  assert.ok(v2.components.completeness.contributions.some((c) => c.factor === "nume firmă: prezent fără dovadă (nu se punctează în q-v2)" && c.points === 0));
  assert.deepEqual(v2.inferences, [{ component: "evidence", claim: "employees", evidenceIds: ["ev-3"], why: "inferență (INFERRED): nu se punctează ca dovadă confirmată în q-v2" }]);
  // The same record with its evidence recorded (the audit rows the Sales service stores, an import row, the contact's evidence):
  // every point is back, each with its id.
  const backed = { ...input, org: { ...org, contacts: org.contacts.map((ct) => (ct.kind === "email" ? { ...ct, evidenceId: "ev-imp" } : ct)) }, evidence: [...evidence,
    { id: "ev-imp", claim: "Date furnizate în importul lot-1#3", value: { name: org.displayName, fiscalCode: org.fiscalCode, city: org.city }, label: "USER_PROVIDED", sourceRef: "import:lot-1#3" },
    { id: "ev-mv", claim: "audit:mobile_viewport", value: { status: "ISSUE" }, label: "OBSERVED", sourceRef: "https://brutaria-soricelul.test (fixture sintetic)" },
    { id: "ev-cf", claim: "audit:contact_form", value: { status: "ISSUE" }, label: "OBSERVED", sourceRef: "https://brutaria-soricelul.test (fixture sintetic)" }] };
  const full = qualify(backed, { formula: "q-v2" });
  assert.deepEqual([full.components.serviceFit.score, full.components.completeness.score, full.unproven], [50, 100, []]);
  for (const c of points(full)) assert.ok(c.evidenceIds.length > 0, `point without evidence: ${c.factor}`);
});

test("M12-QV2-05 through the Sales service (isolated synthetic hub): q-v1 stays the default, q-v2 on request, rows side by side with the same inputs_sha, the q-v1 row untouched, an inference added later changes no q-v2 score, an override keeps q-v2 and its basis", async (c) => {
  const t = await salesAcceptanceHub(c, { listen: false });
  const b = await seedSalesReview(t);
  const row = (id) => t.hub.db.prepare("SELECT * FROM sales_qualifications WHERE id = ?").get(id);
  const v1Row = row(b.qualificationId);
  assert.equal(v1Row.formula_version, "q-v1", "the seed used the default");
  const v2 = await run(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v2" });
  assert.equal(v2.formulaVersion, "q-v2");
  assert.equal(row(v2.id).inputs_sha, v1Row.inputs_sha, "same dataset, same inputs_sha");
  assert.deepEqual(row(b.qualificationId), v1Row, "the stored q-v1 row is byte-identical");
  const again = await run(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v2" });
  assert.equal(row(again.id).inputs_sha, row(v2.id).inputs_sha);
  assert.equal(row(again.id).result_json, row(v2.id).result_json, "deterministic re-run");
  assert.equal((await run(t, "sales.org.qualify", { orgId: b.orgId })).formulaVersion, "q-v1", "no formula = q-v1 (M04-D)");
  await assert.rejects(salesCommand(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v9" }), /formula/);
  // Every q-v2 point carries its evidence (the import row and its contact); every field of the imported record is proven.
  for (const p of points(v2.result)) assert.ok(p.evidenceIds.length > 0, p.factor);
  assert.ok(points(v2.result).length > 0);
  assert.deepEqual(v2.result.unproven, []);
  // An inference added afterwards: q-v2 lists it and keeps the score; q-v1 counts it.
  const importEvidence = t.hub.sales.getOrg(b.orgId).evidence.find((e) => e.label === "USER_PROVIDED");
  await run(t, "sales.evidence.add", { subjectType: "org", subjectId: b.orgId, claim: "employees", value: "12", label: "INFERRED", sourceKind: "manual", sourceRef: "dedus din fișa sintetică",
    dataKind: "INFERENCE", basis: [importEvidence.id], reasoning: "firma are un singur sediu în fișă" });
  const after = await run(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v2" });
  assert.notEqual(row(after.id).inputs_sha, row(v2.id).inputs_sha, "the dataset changed");
  assert.deepEqual(neutralPart(after.result), neutralPart(v2.result), "neutral to the new inference");
  assert.ok(after.result.missing.includes("de confirmat: employees"));
  const v1After = await run(t, "sales.org.qualify", { orgId: b.orgId });
  assert.ok(v1After.result.components.evidence.score < JSON.parse(v1Row.result_json).components.evidence.score, "q-v1 averages the INFERRED reading in");
  // The override of a q-v2 row keeps its formula and the basis row's inputs_sha (the owner's history stays explainable).
  const q2 = await run(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v2" });
  const over = await run(t, "sales.qualification.override", { orgId: b.orgId, priority: 77, reason: "Recomandare sintetică", displayedQualificationId: q2.id });
  assert.equal(over.formulaVersion, "q-v2");
  assert.equal(row(over.id).inputs_sha, row(q2.id).inputs_sha);
  assert.equal(over.override.basedOn, q2.id);
  assert.deepEqual(over.result.inferences, q2.result.inferences);
});
