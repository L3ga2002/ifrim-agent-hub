import { HubError } from "../core/errors.mjs";
import { cuiControlDigit, foldDiacritics, normalizeName, MATCH_THRESHOLDS } from "./identity.mjs";

/**
 * Synthetic prospect lists (M04 §2.2) for demos, fixtures and load tests, so the import, matching and review flows can be
 * exercised without a single real company. Everything is fictitious by construction:
 * - names are invented Romanian words with diacritics (real city and county names only describe the location);
 * - websites and e-mails live on the reserved ".test" TLD, which never resolves on the internet;
 * - phones are in the fictitious "+40 7xx 000 xxx" range;
 * - fiscal codes have a valid control digit but 10 digits starting with "99", a range far above the codes issued so far
 *   (8 digits), so a generated code cannot point at a real company.
 * Duplicates and invalid rows are injected on request, at known positions, so tests can check what the importer finds.
 * Deterministic: the same `n` and options always give the same rows (seeded PRNG, no clock, no Math.random).
 */

export const MAX_SYNTHETIC_ROWS = 50000;
export const SYNTHETIC_FIELDS = Object.freeze(["name", "fiscalCode", "website", "email", "phone", "city", "county", "caen", "turnover", "turnoverYear"]);
export const DUPLICATE_KINDS = Object.freeze(["same_cui", "name_city", "same_domain"]);
export const INVALID_PROBLEMS = Object.freeze(["cui_checksum", "email_syntax", "phone_short", "name_blank", "website_invalid", "phone_lost_zero"]);

const ROOTS = [
  "Ștejăraș", "Țarinița", "Brădulețul", "Mălăiaș", "Gânduleț", "Fânețica", "Pârâiaș", "Izvorașul", "Vâlcelușa", "Cireșica",
  "Măgurița", "Răsăritul", "Luncșorica", "Ciocârlia", "Ghiocelul", "Albăstrița", "Tăciunel", "Pădurețul", "Mărțișorul",
  "Sânziana", "Frăsinel", "Tămâioara", "Bujorel", "Ulmișor", "Stânișoara", "Plopșorel", "Vișinel", "Cătinel", "Zăvoiaș",
  "Fluturaș", "Rândunica", "Mușcățica", "Busuiocel", "Liliăcel", "Nufărel", "Iederița", "Arțărel", "Jnepeniș", "Șoimănel",
  "Țintăraș", "Câmpșorel", "Ogoraș", "Brâulețul", "Zâmbărel", "Pănușica", "Lăstărel", "Murăraș", "Căpșunica",
];
/** Sector word → CAEN rev. 2 code of that activity, so name and activity agree. */
const SECTORS = [
  ["Construcții", "4120"], ["Soft", "6201"], ["Bistro", "5610"], ["Auto Service", "4520"], ["Dental", "8623"],
  ["Imobiliare", "6820"], ["Turism", "7911"], ["Transport", "4941"], ["Panificație", "1071"], ["Tipografie", "1812"],
  ["Grădinărit", "8130"], ["Instalații", "4322"], ["Contabilitate", "6920"], ["Studio Foto", "7420"], ["Evenimente", "9329"],
  ["Croitorie", "1413"], ["Agro", "0111"], ["Mobilă", "3109"], ["Consultanță", "7022"], ["Design", "7410"],
  ["Electrice", "4321"], ["Curățenie", "8121"], ["Pensiune", "5520"], ["Fitness", "9313"], ["Veterinar", "7500"],
  ["Farmacie", "4773"], ["Optică", "4778"], ["Florărie", "4776"], ["Cafenea", "5630"], ["Logistică", "5210"],
];
/** Second invented word: three-word names differ from each other by a whole word, so they stay clearly distinct. */
const WORDS = [
  "Mărgeluș", "Pietrișel", "Cărbunel", "Fulgușor", "Smărăndel", "Argințel", "Vâltoarea", "Ploiuța", "Neguraș", "Tăunel",
  "Curcubeu", "Steluța", "Ciupercuța", "Gutuiaș", "Alunel", "Castănel", "Ghindușa", "Răchițel", "Mărăcine", "Trestioara",
  "Cocoșel", "Pițigoi", "Țurțuraș", "Măceșel", "Scoruș", "Lăcrămioara", "Clopoțel", "Buburuza", "Greieraș", "Furnicuța",
  "Licurici", "Ariciul", "Veverița", "Bursucel", "Vulpița", "Iepuraș", "Brândușa", "Căprioara", "Mierlița", "Sticlețel",
];
/** Occasional fourth word; "& Fiii" exercises the "&" → "si" normalization. */
const QUALIFIERS = ["Nord", "Sud", "Plus", "Expert", "Grup", "Prim", "Nova", "Pro", "& Fiii", "Familia", "Clasic", "Integral"];
const LEGAL_FORMS = [["SRL", 60], ["S.R.L.", 15], ["SA", 8], ["PFA", 6], ["II", 5], ["SNC", 3], ["IF", 3]];
const CITIES = [
  ["Cluj-Napoca", "Cluj"], ["Iași", "Iași"], ["Timișoara", "Timiș"], ["Brașov", "Brașov"], ["Constanța", "Constanța"],
  ["Craiova", "Dolj"], ["Galați", "Galați"], ["Ploiești", "Prahova"], ["Oradea", "Bihor"], ["Sibiu", "Sibiu"],
  ["Bacău", "Bacău"], ["Pitești", "Argeș"], ["Arad", "Arad"], ["Târgu Mureș", "Mureș"], ["Baia Mare", "Maramureș"],
  ["Buzău", "Buzău"], ["Botoșani", "Botoșani"], ["Suceava", "Suceava"], ["Satu Mare", "Satu Mare"], ["Râmnicu Vâlcea", "Vâlcea"],
  ["București", "București"], ["Focșani", "Vrancea"], ["Târgoviște", "Dâmbovița"], ["Alba Iulia", "Alba"],
];
const GENERIC_LOCALS = ["office", "contact", "info", "comenzi", "vanzari"];
const PERSONAL_LOCALS = ["ana.p", "mihai.d", "elena.v", "radu.c", "ioana.m", "andrei.s", "sorina.t", "vlad.b", "irina.g", "tudor.n"];

/** mulberry32: small, fast, good enough for test data, identical on every platform. */
function createRng(seed) {
  let a = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : hashSeed(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function makeTools(rng) {
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const chance = (p) => rng() < p;
  const weighted = (pairs) => {
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let r = rng() * total;
    for (const [value, w] of pairs) {
      r -= w;
      if (r < 0) return value;
    }
    return pairs.at(-1)[0];
  };
  const digits = (count) => Array.from({ length: count }, () => int(0, 9)).join("");
  return { int, pick, chance, weighted, digits };
}

const rate = (value, label) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n >= 1) throw new HubError("validation", `${label} trebuie să fie un număr între 0 și 1 (exclusiv)`);
  return n;
};

/**
 * Originals stay below the matcher's "very close" threshold with a margin. Past the point where the vocabulary runs out of
 * distinct names (several thousand rows) the guard is relaxed and only exact uniqueness is kept.
 */
const DISTINCT_NAME_LIMIT = MATCH_THRESHOLDS.veryClose - 0.05;

function bigramProfile(normalized) {
  const compact = normalized.replace(/ /g, "");
  const grams = new Map();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const g = compact.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return { grams, size: Math.max(0, compact.length - 1) };
}

function dice(a, b) {
  const total = a.size + b.size;
  if (!total || (2 * Math.min(a.size, b.size)) / total < DISTINCT_NAME_LIMIT) return 0;
  let common = 0;
  const [small, big] = a.grams.size <= b.grams.size ? [a.grams, b.grams] : [b.grams, a.grams];
  for (const [g, count] of small) {
    const other = big.get(g);
    if (other) common += Math.min(count, other);
  }
  return (2 * common) / total;
}

const toCedilla = (text) => text.replace(/ș/g, "ş").replace(/ț/g, "ţ").replace(/Ș/g, "Ş").replace(/Ț/g, "Ţ");
const swapLegalForm = (name) => (name.endsWith(" S.R.L.") ? name.replace(/ S\.R\.L\.$/, " SRL") : name.replace(/ SRL$/, " S.R.L."));

/** A spelling of the same company name: legacy cedillas, no diacritics, capitals or the dotted legal form. */
function nameVariant(name, t) {
  const variants = [toCedilla, foldDiacritics, (s) => s.toLocaleUpperCase("ro-RO"), swapLegalForm];
  const first = t.int(0, variants.length - 1);
  let out = variants[first](name);
  if (t.chance(0.5)) out = variants[(first + t.int(1, variants.length - 1)) % variants.length](out);
  return out === name ? name.toLocaleUpperCase("ro-RO") : out;
}

const websiteFor = (domain, t) => t.pick([`https://www.${domain}`, `http://${domain}`, domain, `www.${domain}/`, `https://${domain}/contact`]);
const phoneFor = (t) => {
  const a = t.digits(2);
  const b = t.digits(3);
  return t.pick([`+40 7${a} 000 ${b}`, `07${a} 000 ${b}`, `07${a}000${b}`, `0040 7${a} 000 ${b}`, `+40-7${a}-000-${b}`]);
};
const formatCui = (cui, t) => t.weighted([[cui, 5], [`RO${cui}`, 3], [`RO ${cui}`, 2]]);

/**
 * Same as generateSyntheticOrgs, plus where the injected rows are: `duplicates[{ index, of, kind }]` (`of` is the index of
 * the original row) and `invalid[{ index, problem }]`. Indexes refer to the returned `rows`.
 */
export function generateSyntheticDataset(n, { seed = 42, duplicateRate = 0, invalidRate = 0 } = {}) {
  const count = Number(n);
  if (!Number.isInteger(count) || count < 0 || count > MAX_SYNTHETIC_ROWS) {
    throw new HubError("validation", `Numărul de rânduri sintetice trebuie să fie un întreg între 0 și ${MAX_SYNTHETIC_ROWS}`);
  }
  const dupRate = rate(duplicateRate, "duplicateRate");
  const badRate = rate(invalidRate, "invalidRate");
  if (dupRate + badRate > 0.9) throw new HubError("validation", "duplicateRate + invalidRate nu poate depăși 0,9");
  const t = makeTools(createRng(seed));

  const dupCount = count > 1 ? Math.min(Math.round(count * dupRate), count - 1) : 0;
  const baseCount = count - dupCount;
  const invalidCount = Math.min(Math.round(count * badRate), Math.max(0, baseCount - (dupCount > 0 ? 1 : 0)));

  const usedNames = new Set();
  const usedCuis = new Set();
  const groups = new Map();
  const group = (key) => {
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    return list;
  };
  let fallback = 2;
  let relaxed = false;
  const freshName = () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const root = t.pick(ROOTS);
      const [sector, caen] = t.pick(SECTORS);
      const word = t.pick(WORDS);
      const base = [root, sector, word, t.chance(0.1) ? t.pick(QUALIFIERS) : ""].filter(Boolean).join(" ");
      const key = normalizeName(base).normalized;
      if (usedNames.has(key)) continue;
      // Two different companies with near-identical names are a CONFLICT for the matcher; the originals of a synthetic list
      // must import cleanly, so such a name is skipped. Only names sharing the sector and the root or the second word can be
      // that close, so only those are compared (keeps 50 000 rows fast).
      const profile = bigramProfile(key);
      const byRoot = group(`${sector}|r|${root}`);
      const byWord = group(`${sector}|w|${word}`);
      if (!relaxed && (byRoot.some((peer) => dice(profile, peer) >= DISTINCT_NAME_LIMIT) || byWord.some((peer) => dice(profile, peer) >= DISTINCT_NAME_LIMIT))) continue;
      usedNames.add(key);
      byRoot.push(profile);
      byWord.push(profile);
      return { base, caen };
    }
    relaxed = true;
    // Combinations exhausted (very large n): a numbered branch-like name keeps every row unique.
    for (;;) {
      const sector = t.pick(SECTORS);
      const base = `${t.pick(ROOTS)} ${sector[0]} ${fallback++}`;
      const key = normalizeName(base).normalized;
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return { base, caen: sector[1] };
      }
    }
  };
  const freshCui = () => {
    for (;;) {
      const body = `99${t.digits(7)}`;
      const cui = `${body}${cuiControlDigit(body)}`;
      if (!usedCuis.has(cui)) {
        usedCuis.add(cui);
        return cui;
      }
    }
  };

  /** One fictitious company, every value text (as an import cell would be). */
  const baseOrg = () => {
    const { base, caen } = freshName();
    const name = `${base} ${t.weighted(LEGAL_FORMS)}`;
    const domain = `${normalizeName(base).tokens.join("-")}.test`;
    const [city, county] = t.pick(CITIES);
    const cui = freshCui();
    const hasTurnover = t.chance(0.7);
    const row = {
      name,
      fiscalCode: t.chance(0.9) ? formatCui(cui, t) : "",
      website: t.chance(0.8) ? websiteFor(domain, t) : "",
      email: t.chance(0.85) ? `${t.chance(0.65) ? t.pick(GENERIC_LOCALS) : t.pick(PERSONAL_LOCALS)}@${domain}` : "",
      phone: t.chance(0.85) ? phoneFor(t) : "",
      city,
      county,
      caen,
      turnover: hasTurnover ? String(t.int(5000, 2500000) * 10) : "",
      turnoverYear: hasTurnover ? (t.chance(0.8) ? "2024" : "2023") : "",
    };
    return { row, cui, domain };
  };

  // 1. Originals (some made invalid), in creation order.
  const items = [];
  for (let i = 0; i < baseCount; i += 1) items.push({ ...baseOrg(), key: i, seq: i, problem: null });
  const order = items.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = t.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.slice(0, invalidCount).forEach((idx, k) => {
    const item = items[idx];
    const problem = INVALID_PROBLEMS[k % INVALID_PROBLEMS.length];
    item.problem = problem;
    const { row, cui, domain } = item;
    if (problem === "cui_checksum") {
      const body = cui.slice(0, -1);
      const wrong = (cuiControlDigit(body) + t.int(1, 9)) % 10;
      row.fiscalCode = `${body}${wrong}`;
    } else if (problem === "email_syntax") row.email = t.chance(0.5) ? `office@@${domain}` : `office.${domain}`;
    else if (problem === "phone_short") row.phone = `07${t.digits(2)} 000`;
    else if (problem === "name_blank") row.name = "";
    else if (problem === "website_invalid") row.website = `htp:/${domain}`;
    else if (problem === "phone_lost_zero") row.phone = `7${t.digits(2)}000${t.digits(3)}`;
  });

  // 2. Duplicates: another spelling of a valid original, always placed after it.
  const sources = items.filter((item) => !item.problem);
  const all = [...items];
  for (let d = 0; d < dupCount; d += 1) {
    const source = t.pick(sources);
    let kind = t.weighted([["same_cui", 5], ["name_city", 3], ["same_domain", 2]]);
    if (kind === "same_cui" && !source.row.fiscalCode) kind = "name_city";
    if (kind === "same_domain" && !source.row.website && !source.row.email) kind = "name_city";
    const s = source.row;
    const row = { ...s, name: nameVariant(s.name, t) };
    if (kind === "same_cui") {
      row.fiscalCode = formatCui(source.cui, t);
      row.website = s.website ? websiteFor(source.domain, t) : "";
    } else if (kind === "name_city") {
      row.fiscalCode = "";
      row.website = "";
      row.email = "";
    } else {
      row.fiscalCode = "";
      row.website = websiteFor(source.domain, t);
    }
    const key = source.key + Math.max(1e-6, t.int(1, 1000) / 1000) * (baseCount - source.key);
    all.push({ row, key, seq: baseCount + d, source, kind, problem: null });
  }

  all.sort((a, b) => a.key - b.key || a.seq - b.seq);
  const position = new Map(all.map((item, index) => [item, index]));
  const duplicates = [];
  const invalid = [];
  all.forEach((item, index) => {
    if (item.source) duplicates.push({ index, of: position.get(item.source), kind: item.kind });
    if (item.problem) invalid.push({ index, problem: item.problem });
  });
  return { rows: all.map((item) => item.row), meta: { seed, synthetic: true, duplicates, invalid } };
}

/**
 * `n` import-ready rows `{ name, fiscalCode, website, email, phone, city, county, caen, turnover, turnoverYear }`, every value
 * a string ("" when unknown). Options: `seed` (number or text), `duplicateRate` and `invalidRate` (fractions of `n`, default 0).
 */
export function generateSyntheticOrgs(n, options = {}) {
  return generateSyntheticDataset(n, options).rows;
}

export const SYNTHETIC_ORG_GENERATOR = "synthetic-org-v1";

/**
 * M12: the fictitious identity of the client a brief describes (S-02), for one confirmed preparation. Additive: the generator
 * above and its seeds are untouched. Same vocabulary and rules — invented name words, a `.test` domain that never resolves, a
 * fiscal code of 10 digits starting with "99" with a valid control digit, a generic `.test` mailbox (the contact draft needs an
 * e-mail; nothing is ever sent) — on its own seed namespace, so it never repeats a row of `generateSyntheticDataset`.
 * Deterministic: the same brief and seed (the confirmed plan) give the same identity; two plans give two identities.
 *
 * Only FIXTURE identity is returned. What the brief says or infers about the client (sector, CAEN, place, city, county) is not a
 * field of the generated record: it is kept as STATEMENT / INFERENCE evidence by the caller. The sector word of the brief may
 * appear inside the invented name, only to make the fictitious label readable.
 * @returns {{ generator: string, seed: string, synthetic: true, name: string, legalForm: "SRL", fiscalCode: string,
 *   fiscalCodeValid: true, domain: string, website: string, email: string, kinds: Record<string, "FIXTURE"> }}
 */
export function syntheticOrgFor(brief, seed, { taken = null, maxAttempts = SYNTHETIC_ORG_ATTEMPTS } = {}) {
  const seedText = typeof seed === "number" && Number.isFinite(seed) ? String(seed) : typeof seed === "string" ? seed.trim() : "";
  if (!seedText || seedText.length > 200) throw new HubError("validation", "Identitatea sintetică are nevoie de o sămânță (planul confirmat)");
  const caen = String(brief?.fields?.caen?.value ?? "");
  const sector = SECTORS.find(([, code]) => code === caen)?.[0] || "";
  // M12 review R17: the vocabulary is small, so two plans (or an M04 synthetic import) can draw the same company. `taken` (the caller's
  // check against the companies it already has: domain, fiscal code, e-mail) makes the generator draw again, deterministically: attempt
  // n uses the seed „<seed>#n”, so the same plan and the same companies always give the same identity. Attempt 0 is the original draw.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const t = makeTools(createRng(`${SYNTHETIC_ORG_GENERATOR}|${seedText}${attempt ? `#${attempt}` : ""}`));
    const base = [t.pick(ROOTS), sector, t.pick(WORDS)].filter(Boolean).join(" ");
    const body = `99${t.digits(7)}`;
    const domain = `${normalizeName(base).tokens.join("-")}.test`;
    const identity = {
      generator: SYNTHETIC_ORG_GENERATOR, seed: seedText, ...(attempt ? { attempt } : {}), synthetic: true,
      name: `${base} SRL`, legalForm: "SRL", fiscalCode: `${body}${cuiControlDigit(body)}`, fiscalCodeValid: true,
      domain, website: `https://${domain}`, email: `office@${domain}`,
      kinds: { name: "FIXTURE", fiscalCode: "FIXTURE", domain: "FIXTURE", website: "FIXTURE", email: "FIXTURE" },
    };
    if (typeof taken !== "function" || !taken(identity)) return identity;
  }
  throw new HubError("conflict", "Nu găsesc o identitate sintetică liberă (domeniu, CUI și e-mail nefolosite) pentru acest plan.", { code: "SALES_SYNTHETIC_TAKEN" });
}
/** How many deterministic draws syntheticOrgFor tries before it refuses (the vocabulary gives about 1 900 names per sector). */
export const SYNTHETIC_ORG_ATTEMPTS = 64;
