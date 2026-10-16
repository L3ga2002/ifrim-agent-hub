// M12 WP6 — S-01 / S-02: the brief-v1 parser (pure, deterministic, no model) and the synthetic client identity. A sentence table with
// typos, missing diacritics, legacy cedillas and negations; send / contact / publish verbs go to `refused` (never a step, never the
// noun „contact”); what the request does not say goes to `missing`; USER_PROVIDED values are verbatim spans, every normalisation is
// INFERRED with its rule. Pure: nothing boots.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrief, briefSha, BRIEF_VERSION, MAX_BRIEF_REQUEST } from "../server/sales/brief.mjs";
import { syntheticOrgFor, generateSyntheticOrgs, SYNTHETIC_ORG_GENERATOR } from "../server/sales/synthetic.mjs";
import { findCommercialFigures } from "../server/sales/figures.mjs";
import { normalizeFiscalCode, isIdentityDomain, classifyUrl, checkEmail } from "../server/sales/identity.mjs";
import { HubError } from "../server/core/errors.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL = "pregătește o ofertă pentru un service auto din Cluj care vrea programări online";
const value = (b, field) => b.fields[field]?.value ?? null;
const missingFields = (b) => b.missing.map((m) => m.field);

/** Every USER_PROVIDED value is a verbatim span of the request; every INFERRED value names its rule and reasoning. */
function assertProvenance(b) {
  for (const [name, f] of Object.entries(b.fields)) {
    if (!f) continue;
    if (f.provenance === "USER_PROVIDED") {
      for (const v of Array.isArray(f.value) ? f.value : String(f.value).split("; ")) assert.ok(b.request.includes(v), `${name}: „${v}” is not verbatim`);
    } else {
      assert.equal(f.provenance, "INFERRED", name);
      assert.match(f.rule, /^R-[A-Z]+@1$/, name);
      assert.ok(f.reasoning && f.from && b.request.includes(f.from), name);
    }
  }
  if (b.intent) assert.ok(b.request.includes(b.intent.span));
  for (const r of b.refused) assert.ok(b.request.includes(r.text));
}

test("M12-BRIEF-01 the canonical request: verbatim statements, inferred normalisations with rules, nothing invented", () => {
  const b = parseBrief(CANONICAL);
  assert.equal(b.version, BRIEF_VERSION);
  assert.deepEqual(b.parser.model, null);
  assert.equal(b.request, CANONICAL);
  assert.deepEqual(b.intent, { value: "PREPARE_OFFER", provenance: "USER_PROVIDED", span: "pregătește o ofertă" });
  assert.deepEqual(b.fields.clientType, { value: "service auto", provenance: "USER_PROVIDED", span: "service auto" });
  assert.deepEqual([b.fields.sector.value, b.fields.sector.provenance, b.fields.sector.rule], ["service auto", "INFERRED", "R-SECTOR@1"]);
  assert.deepEqual([b.fields.caen.value, b.fields.caen.provenance], ["4520", "INFERRED"]);
  assert.deepEqual(b.fields.place, { value: "Cluj", provenance: "USER_PROVIDED", span: "Cluj" });
  assert.deepEqual([value(b, "county"), b.fields.county.provenance], ["Cluj", "INFERRED"]);
  assert.deepEqual([value(b, "city"), b.fields.city.provenance, b.fields.city.rule], ["Cluj-Napoca", "INFERRED", "R-PLACE@1"]);
  assert.deepEqual(b.fields.problem, { value: "programări online", provenance: "USER_PROVIDED", span: "care vrea programări online" });
  assert.deepEqual([value(b, "service"), b.fields.service.provenance, b.fields.service.rule], ["programări online pe site", "INFERRED", "R-SERVICE@1"]);
  for (const f of ["budget", "deadline", "constraints"]) assert.equal(b.fields[f], null, f);
  assert.deepEqual(missingFields(b), ["budget", "deadline", "companySize", "website", "catalog"]);
  assert.ok(b.missing.find((m) => m.field === "catalog").text.includes("catalog neconfigurat"));
  assert.deepEqual(b.assumptions.map((a) => a.id), ["A-SYNTH", "A-CITY", "A-SERVICE"]);
  assert.ok(b.assumptions.find((a) => a.id === "A-CITY").text.includes("e o inferență, nu o afirmație"));
  assert.deepEqual(b.refused, []);
  assert.deepEqual(b.corrections, []);
  assertProvenance(b);
});

test("M12-BRIEF-02 the same request typed differently (no diacritics, cedillas, typos, upper case, abbreviations, a city name) reads the same", () => {
  const variants = [
    "pregateste o oferta pentru un service auto din Cluj care vrea programari online",
    "Pregăteşte o ofertă pentru un service auto din Cluj care vrea programări online",
    "PREGĂTEȘTE O OFERTĂ PENTRU UN SERVICE AUTO DIN CLUJ CARE VREA PROGRAMĂRI ONLINE",
    "pregatște o oferat pt un servis auto din cluj care vrea programări online",
    "fă o ofertă pentru un atelier auto din Cluj-Napoca care vrea programări online",
    "  pregătește   o ofertă pentru un service auto din județul Cluj, care vrea programări online.  ",
    "vreau o propunere pentru un service-auto din Cluj care își dorește programări online",
    "o ofertă pentru un service auto clujean care vrea programări online",
  ];
  for (const s of variants) {
    const b = parseBrief(s);
    assert.equal(b.intent?.value, "PREPARE_OFFER", s);
    assert.deepEqual([value(b, "sector"), value(b, "caen"), value(b, "county"), value(b, "city"), value(b, "service")], ["service auto", "4520", "Cluj", "Cluj-Napoca", "programări online pe site"], s);
    assert.equal(b.fields.problem.value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""), "programari online", s);
    assert.deepEqual(b.refused, [], s);
    assertProvenance(b);
  }
  const typos = parseBrief(variants[3]);
  assert.deepEqual(typos.corrections, [{ from: "pregatște", to: "pregateste" }, { from: "oferat", to: "oferta" }]);
  assert.equal(typos.fields.clientType.value, "servis auto", "the client type stays as typed (USER_PROVIDED)");
  assert.ok(typos.assumptions.some((a) => a.id === "A-SECTOR" && a.text.includes("„servis auto”")));
  const seat = parseBrief(variants[4]);
  assert.equal(seat.fields.place.value, "Cluj-Napoca");
  assert.ok(!seat.assumptions.some((a) => a.id === "A-CITY"), "a seat named as such needs no city assumption");
});

test("M12-BRIEF-03 negations: an excluded need, a missing site, a negated send and a negated preparation are read as such", () => {
  const exclusion = parseBrief("pregătește o ofertă pentru un service auto din Cluj care nu vrea magazin online");
  assert.equal(exclusion.fields.problem, null, "„nu vrea X” is never the need X");
  assert.deepEqual(exclusion.fields.constraints.value, ["nu vrea magazin online"]);
  assert.ok(missingFields(exclusion).includes("problem"));
  const both = parseBrief("pregătește o ofertă pentru o brutărie din Iași care vrea un site nou, nu și magazin online");
  assert.equal(value(both, "problem"), "un site nou");
  assert.deepEqual(both.fields.constraints.value, ["nu și magazin online"]);
  const noSite = parseBrief("fă o ofertă pentru un cabinet stomatologic din Iasi care nu are site");
  assert.equal(value(noSite, "problem"), "nu are site");
  assert.equal(value(noSite, "service"), "site de prezentare");
  assert.ok(!missingFields(noSite).includes("website"), "the request says there is no site");
  const quiet = parseBrief(`${CANONICAL}, fără să trimiți nimic`);
  assert.deepEqual(quiet.refused, [], "a negated send is not a request to send");
  assert.deepEqual(quiet.fields.constraints.value, ["fără să trimiți nimic"]);
  assert.equal(parseBrief(`${CANONICAL} și nu o trimite`).refused.length, 0);
  assert.equal(parseBrief(`${CANONICAL}; nu vreau să-i contactezi`).refused.length, 0);
  const notYet = parseBrief("nu pregăti încă oferta pentru service auto");
  assert.equal(notYet.intent, null);
  assert.ok(notYet.missing.find((m) => m.field === "intent").text.includes("negată"));
  // „nu uita să trimiți” asks to send: the negation belongs to „uita”, not to the send verb.
  assert.deepEqual(parseBrief(`${CANONICAL}; nu uita să o trimiți`).refused.map((r) => r.kind), ["send"]);
});

test("M12-BRIEF-04 send, contact and publish verbs are refused (OUTREACH_DISABLED), even misspelt; the nouns never are", () => {
  const table = [
    ["Pregătește și trimite oferta pentru un service auto din Cluj care vrea programări online", ["send"], "PREPARE_OFFER"],
    ["trimite oferta la service auto din Cluj", ["send"], null],
    ["trimite-le oferta celor de la service auto", ["send"], null],
    ["Contactează-i pe cei de la service-ul auto din Cluj", ["contact"], null],
    ["pregătește oferta și contactați firma mâine", ["contact"], "PREPARE_OFFER"],
    ["contactez eu firma, tu pregătește o ofertă pentru un service auto", ["contact"], "PREPARE_OFFER"],
    ["publică oferta pe Facebook pentru service auto din Cluj", ["publish"], null],
    ["postează oferta pe site", ["publish"], null],
    ["sună-i și scrie-le oferta", ["contact", "send"], null],
    ["trimte oferta la service auto din Cluj", ["send"], null],
    ["contacteza firma din Cluj", ["contact"], null],
  ];
  for (const [s, kinds, intent] of table) {
    const b = parseBrief(s);
    assert.deepEqual(b.refused.map((r) => r.kind), kinds, s);
    assert.ok(b.refused.every((r) => r.code === "OUTREACH_DISABLED" && /OUTREACH_DISABLED/.test(r.reason)), s);
    assert.equal(b.intent?.value ?? null, intent, s);
    assert.ok(!b.corrections.some((c) => /trimit|contact|publi|post/.test(c.to)), `never corrected toward outreach: ${s}`);
    assertProvenance(b);
  }
  assert.ok(parseBrief("trimte oferta la service auto din Cluj").refused[0].typo, "a misspelt send verb is refused, marked as such");
  assert.equal(parseBrief("Pregătește și trimite oferta pentru un service auto").intent.span, "Pregătește", "the intent span never includes a refused word");
  const nouns = [
    "Adaugă formularul de contact pe pagina de contact; datele de contact sunt pe site",
    "pregătește o ofertă pentru un service auto din Cluj care vrea un formular de contact",
    "pregătește o ofertă pentru o florărie din Timișoara care vrea postări pe Facebook și publicitate online",
    "pregătește o ofertă pentru o pensiune din Sibiu care vrea o pagină publică de prezentare și contactele firmei pe site",
    "pregătește o ofertă; trimiterea e dezactivată oricum și nimic nu a fost trimis",
  ];
  for (const s of nouns) assert.deepEqual(parseBrief(s).refused, [], s);
  assert.equal(value(parseBrief(nouns[1]), "service"), "formular de contact");
});

test("M12-BRIEF-05 budget and deadline are kept verbatim and internal: the need never carries a figure", () => {
  const b = parseBrief("pregătește o ofertă pentru un service auto din Cluj care vrea programări online, buget 2000 lei, în 2 săptămâni");
  assert.deepEqual([value(b, "budget"), b.fields.budget.provenance], ["buget 2000 lei", "USER_PROVIDED"]);
  assert.deepEqual([value(b, "deadline"), b.fields.deadline.provenance], ["în 2 săptămâni", "USER_PROVIDED"]);
  assert.ok(!missingFields(b).includes("budget") && !missingFields(b).includes("deadline"));
  assert.equal(value(b, "problem"), "programări online");
  for (const s of [
    "pregătește o ofertă pentru un service auto din Cluj care vrea programări online de 2000 lei",
    "pregătește o ofertă pentru un service auto din Cluj care vrea programări online în 3 zile",
    "pregătește o ofertă pentru un service auto din Cluj care vrea programări online până la Crăciun",
    "pregătește o ofertă pentru un service auto din Cluj care vrea programări online cu buget de 1.500 €",
    "pregătește o ofertă pentru un service auto din Cluj care vrea programări online gratuite",
  ]) {
    const p = parseBrief(s);
    assert.equal(value(p, "problem"), "programări online", s);
    assert.deepEqual(findCommercialFigures(value(p, "problem")), [], s);
    assertProvenance(p);
  }
  assert.equal(value(parseBrief("pregătește o ofertă pentru un restaurant din București care vrea programări online până la Crăciun"), "deadline"), "până la Crăciun");
});

test("M12-BRIEF-06 unknowns go to `missing`, never to a value; the parser is deterministic and the brief has a stable sha", () => {
  const empty = parseBrief("");
  assert.equal(empty.intent, null);
  assert.ok(Object.values(empty.fields).every((f) => f === null));
  assert.deepEqual(missingFields(empty), ["intent", "clientType", "place", "problem", "service", "budget", "deadline", "companySize", "website", "catalog"]);
  const vague = parseBrief("pregătește o ofertă");
  assert.deepEqual(missingFields(vague).slice(0, 4), ["clientType", "place", "problem", "service"]);
  assert.deepEqual(parseBrief(CANONICAL), parseBrief(CANONICAL));
  assert.equal(briefSha(parseBrief(CANONICAL)), hashCanonical(parseBrief(CANONICAL)));
  assert.notEqual(briefSha(parseBrief(CANONICAL)), briefSha(parseBrief(`${CANONICAL} și un logo`)));
  for (const bad of [null, undefined, 42, {}]) assert.throws(() => parseBrief(bad), (e) => e instanceof HubError && e.category === "validation");
  assert.throws(() => parseBrief("a".repeat(MAX_BRIEF_REQUEST + 1)), /prea lungă/);
  // A secret pasted by mistake is redacted before anything else (the brief is stored).
  assert.ok(!parseBrief(`${CANONICAL} token=abcd1234efgh5678`).request.includes("abcd1234efgh5678"));
});

test("M12-BRIEF-07 syntheticOrgFor: a fictitious .test identity (99… fiscal code, generic .test mailbox), deterministic per plan, never a fixture host", () => {
  const brief = parseBrief(CANONICAL);
  const before = JSON.stringify(generateSyntheticOrgs(20, { seed: 1215, duplicateRate: 0.1, invalidRate: 0.1 }));
  const a = syntheticOrgFor(brief, "opp_plan_a");
  assert.deepEqual(syntheticOrgFor(brief, "opp_plan_a"), a, "deterministic");
  const b = syntheticOrgFor(brief, "opp_plan_b");
  assert.notEqual(a.fiscalCode, b.fiscalCode, "two plans, two identities");
  assert.equal(a.generator, SYNTHETIC_ORG_GENERATOR);
  const fixtureHosts = fs.readdirSync(path.join(here, "..", "fixtures", "sales", "sites")).map((f) => f.replace(/\.html$/, ""));
  for (let i = 0; i < 200; i += 1) {
    const o = syntheticOrgFor(brief, `opp_plan_${i}`);
    assert.equal(o.synthetic, true);
    assert.match(o.fiscalCode, /^99\d{8}$/);
    assert.equal(normalizeFiscalCode(o.fiscalCode).valid, true, o.fiscalCode);
    assert.ok(o.domain.endsWith(".test") && isIdentityDomain(o.domain), o.domain);
    assert.equal(classifyUrl(o.website).kind, "organization_site");
    assert.equal(o.email, `office@${o.domain}`);
    assert.equal(checkEmail(o.email).valid, true);
    assert.ok(o.name.endsWith(" SRL") && o.name.includes("Auto Service"), o.name);
    assert.ok(!fixtureHosts.includes(o.domain), `a fixture host would be audited as if it were this client: ${o.domain}`);
    for (const inferred of ["city", "county", "caen", "sector", "place"]) assert.equal(o[inferred], undefined, `${inferred} is not a field of the generated record`);
    assert.deepEqual(Object.values(o.kinds), ["FIXTURE", "FIXTURE", "FIXTURE", "FIXTURE", "FIXTURE"]);
  }
  assert.ok(!syntheticOrgFor(parseBrief("pregătește o ofertă"), "opp_plan_x").name.includes("undefined"));
  for (const seed of [undefined, null, "", "  ", Number.NaN]) assert.throws(() => syntheticOrgFor(brief, seed), /sămânță/);
  assert.equal(JSON.stringify(generateSyntheticOrgs(20, { seed: 1215, duplicateRate: 0.1, invalidRate: 0.1 })), before, "the M04 generator is untouched");
});
