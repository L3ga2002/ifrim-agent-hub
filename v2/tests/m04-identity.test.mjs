// Milestone 04 — Sales identity: fiscal codes, names, domains, URLs, phones, e-mails, the matcher and the import decision,
// plus the synthetic prospect generator. Pure functions only: no database, no network, no files. All data is fictitious.
import test from "node:test";
import assert from "node:assert/strict";
import {
  foldDiacritics, normalizeName, normalizeFiscalCode, cuiControlDigit, normalizeDomain, classifyUrl, isIdentityDomain,
  normalizePhone, checkEmail, nameSimilarity, matchCandidates, decideImportAction, MATCH_THRESHOLDS, createMatchIndex,
} from "../server/sales/identity.mjs";
import { generateSyntheticOrgs, generateSyntheticDataset, SYNTHETIC_FIELDS, MAX_SYNTHETIC_ROWS } from "../server/sales/synthetic.mjs";
import { HubError } from "../server/core/errors.mjs";

/* ------------------------------------------------------------ fiscal code */

test("M04-ID-01 CUI control digit (key 753217532): hand-computed valid codes, including the 10 → 0 case", () => {
  // 001234567 · 753217532 = 95; 950 mod 11 = 4
  assert.equal(cuiControlDigit("1234567"), 4);
  // 991234567 · 753217532 = 203; 2030 mod 11 = 6
  assert.equal(cuiControlDigit("991234567"), 6);
  // 000000123 · 753217532 = 17; 170 mod 11 = 5
  assert.equal(cuiControlDigit("123"), 5);
  // 000000006 · 753217532 = 12; 120 mod 11 = 10 → 0
  assert.equal(cuiControlDigit("6"), 0);
  for (const code of ["12345674", "9912345676", "1235", "60"]) {
    const r = normalizeFiscalCode(code);
    assert.deepEqual([r.value, r.valid, r.prefixRO], [code, true, false], code);
    assert.match(r.reason, /valid/);
  }
  assert.throws(() => cuiControlDigit("1234567890"), TypeError);
  assert.throws(() => cuiControlDigit("12a"), TypeError);
});

test("M04-ID-02 CUI: RO prefix, spacing, labels and spreadsheet artefacts are normalized; the value never keeps RO", () => {
  for (const raw of ["RO12345674", "ro12345674", "RO 12345674", " RO 1234 5674 ", "CUI: RO12345674", "CIF 12345674", "RO-12345674"]) {
    const r = normalizeFiscalCode(raw);
    assert.equal(r.value, "12345674", raw);
    assert.equal(r.valid, true, raw);
  }
  assert.equal(normalizeFiscalCode("RO12345674").prefixRO, true);
  assert.equal(normalizeFiscalCode("CIF 12345674").prefixRO, false);
  assert.deepEqual(normalizeFiscalCode("12345674.0").valid, true, "a numeric cell shown as 12345674.0 is the same code");
});

test("M04-ID-03 CUI: invalid control digit, bad characters, length, leading zero; blank is unknown (null), not invalid", () => {
  const wrong = normalizeFiscalCode("12345675");
  assert.equal(wrong.valid, false);
  assert.equal(wrong.value, "12345675", "the typed digits stay visible to the owner");
  assert.match(wrong.reason, /control.*4/);
  assert.deepEqual([normalizeFiscalCode("12A45674").valid, normalizeFiscalCode("12A45674").value], [false, null]);
  assert.equal(normalizeFiscalCode("RO").valid, false);
  assert.equal(normalizeFiscalCode("1").valid, false);
  assert.match(normalizeFiscalCode("123456789012").reason, /Lungime/);
  assert.match(normalizeFiscalCode("012345674").reason, /nu începe cu 0/);
  for (const blank of ["", "   ", null, undefined]) {
    assert.deepEqual(normalizeFiscalCode(blank), { value: null, prefixRO: false, valid: null, reason: "Cod fiscal lipsă" });
  }
});

/* ------------------------------------------------------------------ names */

test("M04-ID-04 names: legal forms (SRL / S.R.L. / SRL-D, SA, PFA, II, IF, SNC, SCS, SCA) and the SC prefix are stripped", () => {
  const base = normalizeName("Alfa Construct SRL");
  assert.deepEqual(base, { normalized: "alfa construct", legalForm: "SRL", tokens: ["alfa", "construct"] });
  assert.deepEqual(normalizeName("S.C. ALFA CONSTRUCT S.R.L."), base);
  assert.deepEqual(normalizeName("Alfa-Construct, s.r.l."), base);
  const cases = [
    ["Alfa Construct SRL-D", "SRL-D"], ["Alfa Construct S.A.", "SA"], ["Alfa Construct SA", "SA"], ["PFA Alfa Construct", "PFA"],
    ["Alfa Construct I.I.", "II"], ["Alfa Construct IF", "IF"], ["Alfa Construct SNC", "SNC"], ["Alfa Construct SCS", "SCS"],
    ["Alfa Construct S.C.A.", "SCA"],
  ];
  for (const [name, form] of cases) {
    const r = normalizeName(name);
    assert.equal(r.normalized, "alfa construct", name);
    assert.equal(r.legalForm, form, name);
  }
  // Short forms that are also words are only stripped at the edges.
  assert.equal(normalizeName("What If Studio SRL").normalized, "what if studio");
  assert.deepEqual(normalizeName(""), { normalized: "", legalForm: null, tokens: [] });
  assert.deepEqual(normalizeName(null), { normalized: "", legalForm: null, tokens: [] });
});

test("M04-ID-05 diacritics: ș (comma) and ş (cedilla), ț and ţ, ă â î fold to plain letters; & becomes si", () => {
  assert.equal(foldDiacritics("ȘȚĂÂÎ șțăâî ŞŢ şţ"), "STAAI staai ST st");
  assert.equal(foldDiacritics(null), "");
  const comma = normalizeName("Ștejăraș Țarină & Fiii SRL");
  const cedilla = normalizeName("Ştejăraş Ţarină & Fiii S.R.L.");
  assert.equal(comma.normalized, "stejaras tarina si fiii");
  assert.equal(cedilla.normalized, comma.normalized);
  assert.equal(nameSimilarity("Ștejăraș Țarină SRL", "STEJARAS TARINA S.R.L."), 1);
  assert.equal(normalizeName("Alfa „Construct” (Cluj)").normalized, "alfa construct cluj");
});

test("M04-ID-06 nameSimilarity: Dice on bigrams after normalization, symmetric, in [0, 1]", () => {
  assert.equal(nameSimilarity("Alfa Construct SRL", "ALFA CONSTRUCT S.R.L."), 1);
  const ab = nameSimilarity("Alfa Construct", "Alfa Constructii");
  assert.equal(ab, nameSimilarity("Alfa Constructii", "Alfa Construct"));
  assert.ok(ab > MATCH_THRESHOLDS.veryClose && ab < 1, String(ab));
  assert.ok(nameSimilarity("Alfa Construct", "Beta Panificație") < 0.3);
  assert.equal(nameSimilarity("", "Alfa"), 0);
  assert.equal(nameSimilarity("SRL", "SRL"), 0, "a name that is only a legal form carries no identity");
});

/* --------------------------------------------------------- domains and URLs */

test("M04-ID-07 normalizeDomain: host from URL, bare domain or e-mail; lowercase, no www, nothing for IPs or garbage", () => {
  assert.equal(normalizeDomain("https://www.Alfa-Construct.TEST/contact?x=1"), "alfa-construct.test");
  assert.equal(normalizeDomain("www.alfa.test/"), "alfa.test");
  assert.equal(normalizeDomain("alfa.test."), "alfa.test");
  assert.equal(normalizeDomain("Office@Alfa.TEST"), "alfa.test");
  assert.equal(normalizeDomain("mailto:ana.p@beta.test"), "beta.test");
  assert.equal(normalizeDomain("http://shop.alfa.test:8080/x"), "shop.alfa.test");
  for (const bad of ["", null, "localhost", "http://127.0.0.1/", "nu e un site", "http://", "@"]) assert.equal(normalizeDomain(bad), "", String(bad));
});

test("M04-ID-08 shared platforms are never identity domains; an organization's own .test domain is", () => {
  const shared = [
    "facebook.com", "www.facebook.com", "m.facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "olx.ro",
    "emag.ro", "ro.wikipedia.org", "google.com", "maps.google.com", "alfa.wixsite.com", "alfa.blogspot.com", "alfa.business.site",
    "sites.google.com", "listafirme.ro", "termene.ro", "risco.ro", "gmail.com", "yahoo.ro", "example.com", "localhost", "127.0.0.1",
    "", "https://www.facebook.com/alfa.construct", "ana.p@gmail.com",
  ];
  for (const host of shared) assert.equal(isIdentityDomain(host), false, host);
  for (const own of ["alfa.test", "office@alfa-construct.test", "https://www.alfa-construct.test/contact", "firma-fictiva.com.ro"]) {
    assert.equal(isIdentityDomain(own), true, own);
  }
});

test("M04-ID-09 classifyUrl: organization site, social profile, marketplace, directory, article, shared hosting, invalid", () => {
  const expected = {
    "https://www.alfa.test/": "organization_site",
    "alfa.test/servicii": "organization_site",
    "https://www.facebook.com/alfa.construct": "social_profile",
    "instagram.com/alfa": "social_profile",
    "https://www.linkedin.com/company/alfa": "social_profile",
    "https://www.olx.ro/d/oferta/mobilier-ID123.html": "marketplace_listing",
    "https://www.emag.ro/produs/pd/ABC/": "marketplace_listing",
    "https://www.listafirme.ro/alfa-construct-srl": "directory",
    "https://termene.ro/firma/123": "directory",
    "https://www.google.com/maps/place/Alfa": "directory",
    "https://ro.wikipedia.org/wiki/Alfa": "article",
    "https://www.hotnews.ro/stiri-economie-123": "article",
    "https://stiri-locale.test/2025/10/firme-noi-in-cluj": "article",
    "https://alfa.test/blog/noutati": "article",
    "https://alfa.wixsite.com/alfa": "shared_hosting",
    "https://sites.google.com/view/alfa": "shared_hosting",
    "https://alfa.blogspot.com": "shared_hosting",
    "": "invalid",
    "ftp://alfa.test": "invalid",
    "javascript:alert(1)": "invalid",
    "mailto:office@alfa.test": "invalid",
    "office@alfa.test": "invalid",
    "http://127.0.0.1:8011/": "invalid",
    "http://localhost:3000": "invalid",
    "htp:/alfa.test": "invalid",
    "https://user:parola@alfa.test/": "invalid",
    "https://alfa .test": "invalid",
    "https://bit.ly/abc": "invalid",
    "https://www.example.com/": "invalid",
  };
  for (const [url, kind] of Object.entries(expected)) {
    const r = classifyUrl(url);
    assert.equal(r.kind, kind, `${url} → ${JSON.stringify(r)}`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 3, url);
  }
});

/* ------------------------------------------------------------------ phone */

test("M04-ID-10 phone: stays text; +40 only when certain; raw kept as typed", () => {
  for (const raw of ["0722 000 123", "0722.000.123", "+40 722 000 123", "+40722000123", "0040 722 000 123", "+40 (0)722 000 123", "(0722) 000-123", "Tel: 0722 000 123"]) {
    const r = normalizePhone(raw);
    assert.equal(r.value, "+40722000123", raw);
    assert.equal(r.raw, raw);
    assert.deepEqual(r.warnings, [], raw);
  }
  assert.equal(normalizePhone("021 300 0000").value, "+40213000000");
  assert.equal(normalizePhone("+49 30 1234567").value, "+49301234567");
  assert.deepEqual(normalizePhone(""), { value: null, raw: "", warnings: [] });
  assert.deepEqual(normalizePhone(null), { value: null, raw: "", warnings: [] });
  assert.equal(normalizePhone("sună-mă").value, null);
  assert.equal(normalizePhone("0722").value, null);
  const two = normalizePhone("0722 000 123 / 0744 000 222");
  assert.equal(two.value, "+40722000123");
  assert.match(two.warnings[0], /Mai multe numere/);
  const ext = normalizePhone("0264 000 123 int. 12");
  assert.equal(ext.value, "+40264000123");
  assert.match(ext.warnings[0], /Interiorul/);
});

test("M04-ID-11 phone from a numeric cell: 9 digits keep their text with the lost-leading-zero warning, never a guess", () => {
  const r = normalizePhone("722000123", { wasNumeric: true });
  assert.equal(r.value, "722000123");
  assert.equal(typeof r.value, "string");
  assert.equal(r.raw, "722000123");
  assert.ok(r.warnings.some((w) => w.includes("0 inițial posibil pierdut")), JSON.stringify(r.warnings));
  assert.ok(normalizePhone("722000123").warnings.some((w) => w.includes("0 inițial posibil pierdut")), "also when the CSV kept the number");
  const sci = normalizePhone("7.22000123E8", { wasNumeric: true });
  assert.equal(sci.value, "722000123");
  assert.ok(sci.warnings.some((w) => /științifică/.test(w)) && sci.warnings.some((w) => w.includes("0 inițial posibil pierdut")));
  assert.equal(normalizePhone("722000123.0", { wasNumeric: true }).value, "722000123");
  const plusLost = normalizePhone("40722000123", { wasNumeric: true });
  assert.equal(plusLost.value, "40722000123");
  assert.match(plusLost.warnings[0], /\+40/);
});

/* ----------------------------------------------------------------- e-mail */

test("M04-ID-12 e-mail: generic role inboxes vs personal; valid syntax is NOT verified", () => {
  for (const local of ["info", "office", "contact", "sales", "hello", "comenzi", "vanzari", "office.cluj", "info2"]) {
    const r = checkEmail(`${local}@alfa.test`);
    assert.equal(r.valid, true, local);
    assert.equal(r.generic, true, local);
  }
  const personal = checkEmail("Ana.P@Alfa.TEST");
  assert.deepEqual([personal.value, personal.valid, personal.generic], ["ana.p@alfa.test", true, false]);
  assert.match(personal.reason, /nu e verificată/);
  assert.equal("verified" in personal, false, "syntax never claims the mailbox exists");
  assert.deepEqual(Object.keys(personal).sort(), ["generic", "reason", "valid", "value"]);
  assert.match(checkEmail("ana.p@gmail.com").reason, /furnizor public/);
  assert.equal(checkEmail("Ana P <ana.p@alfa.test>").value, "ana.p@alfa.test");
  assert.equal(checkEmail("mailto:office@alfa.test").value, "office@alfa.test");
  const several = checkEmail("office@alfa.test; ana.p@alfa.test");
  assert.equal(several.value, "office@alfa.test");
  assert.match(several.reason, /mai multe adrese/);
});

test("M04-ID-13 e-mail: syntax errors are invalid with a reason; blank is unknown", () => {
  for (const bad of ["office@@alfa.test", "office.alfa.test", "ana p@alfa.test", "ana@alfa", ".ana@alfa.test", "ana..p@alfa.test", "ana@-alfa.test", "@alfa.test", "ana@"]) {
    const r = checkEmail(bad);
    assert.equal(r.valid, false, bad);
    assert.equal(r.value, null, bad);
    assert.ok(r.reason.length > 5, bad);
  }
  assert.deepEqual(checkEmail("  "), { value: null, valid: null, generic: false, reason: "Adresă de e-mail lipsă" });
});

/* --------------------------------------------------------------- matching */

const org = (id, name, extra = {}) => ({ id, name, fiscalCode: "", domain: "", city: "", emails: [], ...extra });

test("M04-ID-14 same valid CUI → STRONG → MATCH_EXISTING, whatever the spelling of name and code", () => {
  const existing = [org("o1", "Alfa Construct SRL", { fiscalCode: "12345674", city: "Cluj-Napoca" }), org("o2", "Beta Panificație SA", { fiscalCode: "1235" })];
  const matches = matchCandidates({ name: "S.C. ALFA CONSTRUCT S.R.L.", fiscalCode: "RO 12345674", city: "Iași" }, existing);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].existingId, "o1");
  assert.equal(matches[0].strength, "STRONG");
  assert.match(matches[0].reasons[0], /Același CUI valid \(12345674\)/);
  assert.deepEqual(matches[0].conflicts, []);
  assert.equal(decideImportAction(matches), "MATCH_EXISTING");
});

test("M04-ID-15 different valid CUIs are never a match: very close names → CONFLICT (review), unrelated → nothing", () => {
  const existing = [org("o1", "Alfa Construct SRL", { fiscalCode: "12345674", city: "Cluj-Napoca", domain: "alfa.test" })];
  const close = matchCandidates({ name: "Alfa Construct SRL", fiscalCode: "9912345676", city: "Cluj-Napoca", domain: "alfa.test" }, existing);
  assert.equal(close.length, 1);
  assert.equal(close[0].strength, "CONFLICT");
  assert.match(close[0].conflicts[0], /CUI-uri valide diferite/);
  assert.equal(decideImportAction(close), "NEEDS_REVIEW");
  const unrelated = matchCandidates({ name: "Gama Transport SRL", fiscalCode: "9912345676", city: "Cluj-Napoca", domain: "alfa.test" }, existing);
  assert.deepEqual(unrelated, []);
  assert.equal(decideImportAction(unrelated), "CREATE");
});

test("M04-ID-16 same identity domain: close names → CANDIDATE, different names → CONFLICT (branches or brands)", () => {
  const existing = [org("o1", "Alfa Construct SRL", { domain: "https://www.alfa.test", city: "Cluj-Napoca" })];
  const close = matchCandidates({ name: "Alfa Construct Grup SRL", domain: "alfa.test", city: "Cluj-Napoca" }, existing);
  assert.deepEqual(close.map((m) => m.strength), ["CANDIDATE"]);
  assert.match(close[0].reasons[0], /Același domeniu de identitate \(alfa\.test\)/);
  assert.equal(decideImportAction(close), "NEEDS_REVIEW");
  const different = matchCandidates({ name: "Delta Imobiliare SRL", emails: ["office@alfa.test"] }, existing);
  assert.deepEqual(different.map((m) => m.strength), ["CONFLICT"]);
  assert.match(different[0].conflicts[0], /filiale sau branduri/);
  assert.equal(decideImportAction(different), "NEEDS_REVIEW");
});

test("M04-ID-17 same normalized name and same city → CANDIDATE; a missing city is a CANDIDATE too", () => {
  const existing = [org("o1", "Ştejăraş Construcţii SRL", { city: "Mun. Cluj-Napoca" })];
  const same = matchCandidates({ name: "STEJARAS CONSTRUCTII S.R.L.", city: "Cluj Napoca" }, existing);
  assert.deepEqual(same.map((m) => m.strength), ["CANDIDATE"]);
  assert.ok(same[0].reasons.some((r) => /Același oraș/.test(r)));
  assert.equal(decideImportAction(same), "NEEDS_REVIEW");
  assert.deepEqual(matchCandidates({ name: "Ștejăraș Construcții SRL", city: "" }, existing).map((m) => m.strength), ["CANDIDATE"]);
  // Bucharest sectors are one city.
  const buc = matchCandidates({ name: "Gama Soft SRL", city: "Sector 3" }, [org("o9", "Gama Soft SRL", { city: "București" })]);
  assert.deepEqual(buc.map((m) => m.strength), ["CANDIDATE"]);
});

test("M04-ID-18 branches: 'Alfa SRL Cluj' and 'Alfa SRL Iași' are never merged", () => {
  const cluj = org("cluj", "Alfa SRL Cluj", { city: "Cluj-Napoca" });
  // No identifier in common: nothing links them.
  const plain = matchCandidates({ name: "Alfa SRL Iași", city: "Iași" }, [cluj]);
  assert.equal(plain.some((m) => m.strength === "STRONG"), false);
  assert.notEqual(decideImportAction(plain), "MATCH_EXISTING");
  // Shared website: a branch of the same group → CONFLICT for the owner, not a merge.
  const sharedSite = matchCandidates({ name: "Alfa SRL Iași", city: "Iași", domain: "alfa.test" }, [{ ...cluj, domain: "alfa.test" }]);
  assert.deepEqual(sharedSite.map((m) => m.strength), ["CONFLICT"]);
  assert.equal(decideImportAction(sharedSite), "NEEDS_REVIEW");
  // Two valid, different CUIs: distinct legal entities, never matched.
  const withCuis = matchCandidates({ name: "Alfa SRL Iași", city: "Iași", fiscalCode: "9912345676" }, [{ ...cluj, fiscalCode: "12345674" }]);
  assert.deepEqual(withCuis, []);
  // Same exact name in two cities (head office vs work point?) → CONFLICT, never a silent merge.
  const sameName = matchCandidates({ name: "Alfa SRL", city: "Iași" }, [org("x", "Alfa SRL", { city: "Cluj-Napoca" })]);
  assert.deepEqual(sameName.map((m) => m.strength), ["CONFLICT"]);
  assert.match(sameName[0].conflicts[0], /orașe diferite/);
});

test("M04-ID-19 shared platforms and public mailboxes never link two companies", () => {
  const existing = [org("o1", "Alfa Construct SRL", { domain: "https://www.facebook.com/alfa", emails: ["alfa.construct@gmail.com"] })];
  const viaFacebook = matchCandidates({ name: "Omega Turism SRL", domain: "https://www.facebook.com/omega", emails: ["contact@gmail.com"] }, existing);
  assert.deepEqual(viaFacebook, []);
  const viaWix = matchCandidates({ name: "Omega Turism SRL", domain: "omega.wixsite.com" }, [org("o2", "Sigma Design SRL", { domain: "sigma.wixsite.com" })]);
  assert.deepEqual(viaWix, []);
});

test("M04-ID-20 matcher details: same CUI with clearly different names, different legal forms, invalid CUI, self, order", () => {
  const renamed = matchCandidates({ name: "Omega Turism SRL", fiscalCode: "12345674" }, [org("o1", "Alfa Construct SRL", { fiscalCode: "12345674" })]);
  assert.equal(renamed[0].strength, "STRONG");
  assert.match(renamed[0].conflicts[0], /nume diferite/);
  assert.equal(decideImportAction(renamed), "NEEDS_REVIEW");

  const forms = matchCandidates({ name: "Alfa Construct SA", city: "Arad" }, [org("o1", "Alfa Construct SRL", { city: "Arad" })]);
  assert.deepEqual(forms.map((m) => m.strength), ["CONFLICT"]);
  assert.ok(forms[0].conflicts.some((c) => /Forme juridice diferite \(SA \/ SRL\)/.test(c)));

  const badCui = matchCandidates({ name: "Alfa Construct SRL", city: "Arad", fiscalCode: "12345675" }, [org("o1", "Alfa Construct SRL", { city: "Arad", fiscalCode: "12345674" })]);
  assert.deepEqual(badCui.map((m) => m.strength), ["CANDIDATE"], "an invalid CUI is ignored, the name and city still count");
  assert.ok(badCui[0].reasons.some((r) => /CUI invalid/.test(r)));

  assert.deepEqual(matchCandidates(org("o1", "Alfa Construct SRL", { city: "Arad" }), [org("o1", "Alfa Construct SRL", { city: "Arad" })]), []);

  const ordered = matchCandidates({ name: "Alfa Construct SRL", fiscalCode: "12345674", city: "Arad", domain: "alfa.test" }, [
    org("cand", "Alfa Construct Grup", { domain: "alfa.test", city: "Arad" }),
    org("strong", "Alfa Construct", { fiscalCode: "12345674" }),
  ]);
  assert.deepEqual(ordered.map((m) => [m.existingId, m.strength]), [["strong", "STRONG"], ["cand", "CANDIDATE"]]);
  assert.equal(decideImportAction(ordered), "NEEDS_REVIEW", "a STRONG next to a CANDIDATE still goes to the owner");
  assert.deepEqual(matchCandidates(null, null), []);
});

test("M04-ID-21 decideImportAction: CREATE, MATCH_EXISTING only for one clean STRONG, NEEDS_REVIEW otherwise", () => {
  const strong = { existingId: "a", strength: "STRONG", reasons: [], conflicts: [] };
  assert.equal(decideImportAction([]), "CREATE");
  assert.equal(decideImportAction(null), "CREATE");
  assert.equal(decideImportAction([strong]), "MATCH_EXISTING");
  assert.equal(decideImportAction([strong, { ...strong, existingId: "b" }]), "NEEDS_REVIEW");
  assert.equal(decideImportAction([{ ...strong, conflicts: ["x"] }]), "NEEDS_REVIEW");
  assert.equal(decideImportAction([{ ...strong, strength: "CANDIDATE" }]), "NEEDS_REVIEW");
  assert.equal(decideImportAction([{ ...strong, strength: "CONFLICT" }]), "NEEDS_REVIEW");
  assert.equal(decideImportAction([strong, { ...strong, existingId: "b", strength: "CONFLICT" }]), "NEEDS_REVIEW");
});

/* -------------------------------------------------------------- synthetic */

test("M04-ID-22 synthetic: deterministic for a seed, different for another; fixed text fields", () => {
  const a = generateSyntheticOrgs(120, { seed: 7, duplicateRate: 0.1, invalidRate: 0.05 });
  const b = generateSyntheticOrgs(120, { seed: 7, duplicateRate: 0.1, invalidRate: 0.05 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateSyntheticOrgs(120, { seed: 8 }), generateSyntheticOrgs(120, { seed: 7 }));
  assert.deepEqual(generateSyntheticOrgs(20, { seed: "demo" }), generateSyntheticOrgs(20, { seed: "demo" }));
  assert.deepEqual(generateSyntheticOrgs(5), generateSyntheticOrgs(5, { seed: 42 }), "default seed is 42");
  assert.equal(a.length, 120);
  for (const row of a) {
    assert.deepEqual(Object.keys(row), SYNTHETIC_FIELDS);
    for (const value of Object.values(row)) assert.equal(typeof value, "string");
  }
  assert.deepEqual(generateSyntheticOrgs(0), []);
});

test("M04-ID-23 synthetic originals: fictitious, unique, valid; .test domains, fictitious phones, 99… CUIs, diacritics", () => {
  const rows = generateSyntheticOrgs(600, { seed: 11 });
  const names = new Set();
  const cuis = new Set();
  const domains = new Set();
  let withDiacritics = 0;
  for (const row of rows) {
    const key = normalizeName(row.name).normalized;
    assert.ok(key && !names.has(key), `unique name: ${row.name}`);
    names.add(key);
    if (/[ăâîșțĂÂÎȘȚ]/.test(row.name)) withDiacritics += 1;
    if (row.fiscalCode) {
      const cui = normalizeFiscalCode(row.fiscalCode);
      assert.equal(cui.valid, true, row.fiscalCode);
      assert.match(cui.value, /^99\d{8}$/, "a 10-digit range above every issued code");
      assert.ok(!cuis.has(cui.value));
      cuis.add(cui.value);
    }
    if (row.website) {
      assert.equal(classifyUrl(row.website).kind, "organization_site", row.website);
      const d = normalizeDomain(row.website);
      assert.ok(d.endsWith(".test") && !domains.has(d), d);
      domains.add(d);
    }
    if (row.email) {
      const e = checkEmail(row.email);
      assert.equal(e.valid, true, row.email);
      assert.ok(e.value.endsWith(".test"));
    }
    if (row.phone) assert.match(normalizePhone(row.phone).value, /^\+407\d{2}000\d{3}$/, row.phone);
    assert.ok(row.city && row.county && /^\d{4}$/.test(row.caen));
    if (row.turnover) assert.match(`${row.turnover}|${row.turnoverYear}`, /^\d+\|20(23|24)$/);
    else assert.equal(row.turnoverYear, "");
  }
  assert.ok(withDiacritics > rows.length * 0.9, `diacritics in ${withDiacritics}/${rows.length}`);
  assert.ok(cuis.size > rows.length * 0.8 && domains.size > rows.length * 0.7);
});

test("M04-ID-24 synthetic duplicates and invalid rows: counts follow the rates, each one detectable, duplicates after their source", () => {
  const { rows, meta } = generateSyntheticDataset(200, { seed: 5, duplicateRate: 0.1, invalidRate: 0.06 });
  assert.equal(rows.length, 200);
  assert.equal(meta.synthetic, true);
  assert.equal(meta.duplicates.length, 20);
  assert.equal(meta.invalid.length, 12);
  for (const d of meta.duplicates) assert.ok(d.of < d.index, JSON.stringify(d));
  const problems = new Set(meta.invalid.map((x) => x.problem));
  assert.equal(problems.size, 6, "every kind of defect appears");
  for (const { index, problem } of meta.invalid) {
    const row = rows[index];
    if (problem === "cui_checksum") assert.equal(normalizeFiscalCode(row.fiscalCode).valid, false);
    if (problem === "email_syntax") assert.equal(checkEmail(row.email).valid, false);
    if (problem === "phone_short") assert.equal(normalizePhone(row.phone).value, null);
    if (problem === "name_blank") assert.equal(row.name, "");
    if (problem === "website_invalid") assert.equal(classifyUrl(row.website).kind, "invalid");
    if (problem === "phone_lost_zero") assert.ok(normalizePhone(row.phone, { wasNumeric: true }).warnings.some((w) => w.includes("0 inițial posibil pierdut")));
  }
});

test("M04-ID-25 synthetic list through the matcher: originals CREATE, same-CUI copies MATCH_EXISTING, other copies NEEDS_REVIEW", () => {
  const { rows, meta } = generateSyntheticDataset(300, { seed: 3, duplicateRate: 0.1, invalidRate: 0.05 });
  const dupByIndex = new Map(meta.duplicates.map((d) => [d.index, d]));
  const record = (row, id) => ({ id, name: row.name, fiscalCode: row.fiscalCode, domain: row.website, city: row.city, emails: row.email ? [row.email] : [] });
  const originals = rows.map((row, i) => [row, i]).filter(([, i]) => !dupByIndex.has(i)).map(([row, i]) => record(row, i));
  const kinds = new Set();
  rows.forEach((row, i) => {
    const dup = dupByIndex.get(i);
    const matches = matchCandidates(record(row, dup ? `copy-${i}` : i), originals);
    const action = decideImportAction(matches);
    if (!dup) return assert.equal(action, "CREATE", `${row.name}: ${JSON.stringify(matches)}`);
    kinds.add(dup.kind);
    assert.equal(matches[0]?.existingId, dup.of, `${row.name} → ${JSON.stringify(matches)}`);
    assert.equal(action, dup.kind === "same_cui" ? "MATCH_EXISTING" : "NEEDS_REVIEW", `${dup.kind}: ${row.name}`);
  });
  assert.deepEqual([...kinds].sort(), ["name_city", "same_cui", "same_domain"]);
});

test("M04-ID-26 synthetic: 3700 rows with duplicates and invalid rows in under 2 s; bad parameters are refused", () => {
  // CPU time of this process: test files run in parallel, so wall-clock time measures the machine, not the generator.
  const started = process.cpuUsage();
  const { rows, meta } = generateSyntheticDataset(3700, { seed: 42, duplicateRate: 0.05, invalidRate: 0.03 });
  const used = process.cpuUsage(started);
  const cpuMs = (used.user + used.system) / 1000;
  assert.equal(rows.length, 3700);
  assert.equal(meta.duplicates.length, 185);
  assert.equal(meta.invalid.length, 111);
  assert.ok(cpuMs < 2000, `${cpuMs.toFixed(0)} ms CPU`);
  const isValidation = (error) => error instanceof HubError && error.category === "validation";
  assert.throws(() => generateSyntheticOrgs(-1), isValidation);
  assert.throws(() => generateSyntheticOrgs(1.5), isValidation);
  assert.throws(() => generateSyntheticOrgs(MAX_SYNTHETIC_ROWS + 1), isValidation);
  assert.throws(() => generateSyntheticOrgs(10, { duplicateRate: 1 }), isValidation);
  assert.throws(() => generateSyntheticOrgs(10, { invalidRate: -0.1 }), isValidation);
  assert.throws(() => generateSyntheticOrgs(10, { duplicateRate: 0.5, invalidRate: 0.5 }), isValidation);
});

test("M04-ID-27 large lists: the automatic index and createMatchIndex give exactly the full-scan result, near-twins included", () => {
  const { rows } = generateSyntheticDataset(160, { seed: 21, duplicateRate: 0.1, invalidRate: 0.05 });
  const record = (row, id) => ({ id, name: row.name, fiscalCode: row.fiscalCode, domain: row.website, city: row.city, emails: row.email ? [row.email] : [] });
  const list = rows.map(record);
  // Near-twins: a letter more, another valid CUI (the only rule that needs a similarity search).
  list.slice(0, 12).forEach((r, k) => {
    const body = `98${String(1000000 + k * 7919).slice(-7)}`;
    list.push({ ...r, id: `twin-${k}`, name: r.name.replace(/ (\S+)$/, "e $1"), fiscalCode: `${body}${cuiControlDigit(body)}`, domain: "", emails: [] });
  });
  const reference = (rec, existing) => {
    const rank = { STRONG: 0, CONFLICT: 1, CANDIDATE: 2 };
    const all = [];
    existing.forEach((e, position) => matchCandidates(rec, [e]).forEach((m) => all.push({ m, position })));
    return all.sort((a, b) => rank[a.m.strength] - rank[b.m.strength] || a.position - b.position).map((x) => x.m);
  };
  const growing = [];
  const index = createMatchIndex();
  let conflicts = 0;
  list.forEach((rec, i) => {
    const expected = reference(rec, list.slice(0, i));
    assert.deepEqual(matchCandidates(rec, growing), expected, `array #${i}`);
    assert.deepEqual(matchCandidates(rec, index), expected, `index #${i}`);
    conflicts += expected.filter((m) => m.conflicts.some((c) => /CUI-uri valide diferite/.test(c))).length;
    growing.push(rec);
    index.add(rec);
  });
  assert.ok(conflicts >= 12, `near-twins found: ${conflicts}`);
  assert.equal(index.size, list.length);
});

test("M04-ID-28 the cached normalization never goes stale: a record changed or replaced in place is read again", () => {
  const existing = generateSyntheticOrgs(100, { seed: 31 }).map((row, i) => ({ id: `o${i}`, name: row.name, fiscalCode: row.fiscalCode, domain: row.website, city: row.city, emails: [] }));
  const incoming = { name: "Omega Turism SRL", fiscalCode: "12345674", city: "Arad" };
  assert.deepEqual(matchCandidates(incoming, existing), []);
  existing[40].fiscalCode = "RO12345674";
  assert.deepEqual(matchCandidates(incoming, existing).map((m) => [m.existingId, m.strength]), [["o40", "STRONG"]]);
  existing[70] = { id: "o70b", name: "Omega Turism SRL", fiscalCode: "", city: "Arad", emails: [] };
  assert.deepEqual(matchCandidates(incoming, existing).map((m) => [m.existingId, m.strength]), [["o40", "STRONG"], ["o70b", "CANDIDATE"]]);
  existing[40].fiscalCode = "";
  existing.length = 50;
  assert.deepEqual(matchCandidates(incoming, existing), []);
  // Small lists (no index) honour in-place changes too.
  const small = [{ id: "s1", name: "Alfa Construct SRL", fiscalCode: "", city: "Arad", emails: [] }];
  assert.equal(matchCandidates({ name: "Alfa Construct SRL", city: "Arad" }, small)[0].strength, "CANDIDATE");
  small[0].city = "Iași";
  assert.equal(matchCandidates({ name: "Alfa Construct SRL", city: "Arad" }, small)[0].strength, "CONFLICT");
});
