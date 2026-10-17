import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { redactText } from "../security/redact.mjs";
import { foldDiacritics } from "./identity.mjs";
import { foldAligned, findCommercialFigures, QUANTITY_SOURCE, NUMBER_WORDS_BIG, NUMBER_WORDS_SMALL, MAGNITUDE_WORDS, CURRENCY_WORDS, TIME_UNIT_WORDS, PERCENT_WORDS } from "./figures.mjs";
import { osaDistance, NEVER_TARGET } from "../owner/typos.mjs";

/**
 * The structured brief of a natural Sales request (M12, S-01), e.g. „pregătește o ofertă pentru un service auto din Cluj care vrea
 * programări online”. Deterministic rules, no model: the same sentence always gives the same brief.
 *
 * Provenance per field: USER_PROVIDED values are the owner's words, verbatim (`value` is the exact span of the request); every
 * normalisation (the sector a phrase names, its CAEN code, the county and the city a place name points to, the service a need
 * suggests) is INFERRED, with its rule id and reasoning. Nothing is invented: what the request does not say goes to `missing`
 * (budget, deadline, size…), never to a value. Inferred values describe the brief only; the caller keeps them as INFERENCE evidence
 * and never writes them into the record of the (synthetic) client.
 *
 * Sending, contacting and publishing are refused first (`refused`, OUTREACH_DISABLED): they never become a step of a plan. Only verb
 * forms count („trimite oferta”, „contactează-i”, „publică oferta”), never the noun („formularul de contact”); a negated one („fără
 * să trimiți nimic”) is a constraint, not a request. Typo tolerance reads a misspelt word of the vocabulary below, but it never
 * produces a send, contact or publish verb (a misspelt send verb is refused, not corrected).
 *
 * Pure module: no database, no network, no clock.
 */

export const BRIEF_VERSION = "brief-v1";
export const BRIEF_PROVENANCE = Object.freeze({ USER_PROVIDED: "USER_PROVIDED", INFERRED: "INFERRED" });
export const MAX_BRIEF_REQUEST = 2000;
export const BRIEF_RULES = Object.freeze(["R-REFUSE@1", "R-INTENT@1", "R-SECTOR@1", "R-PLACE@1", "R-NEED@1", "R-SERVICE@1", "R-BUDGET@1", "R-DEADLINE@1", "R-CONSTRAINT@1",
  "R-TYPO@1", "R-NEED-CUT@1"]);
const OUTREACH = "OUTREACH_DISABLED";

/* ------------------------------------------------------------------ vocabulary (folded: lower case, no diacritics) */

const PREPARE_VERBS = [["pregateste"], ["pregatesti"], ["pregatiti"], ["pregatim"], ["pregatesc"], ["pregateasca"], ["fa"], ["faceti"], ["faci"], ["facem"],
  ["construieste"], ["redacteaza"], ["genereaza"], ["creeaza"], ["elaboreaza"], ["scrie"], ["scrieti"], ["vreau"], ["vrem"], ["as", "vrea"], ["am", "nevoie", "de"]];
const OFFER_NOUNS = ["oferta", "oferte", "ofertei", "ofertele", "propunere", "propunerea", "propuneri", "propunerii", "deviz", "devizul", "cotatie", "cotatia"];
/** „Want” verbs say what the owner wants only when an offer noun follows them closely („vreau o ofertă”). */
const WANT_VERBS = new Set(["vreau", "vrem", "as", "am"]);
/** Real words one or two letters away from the vocabulary: never read as a typo of it. */
const NOT_A_TYPO = new Set(["ofera", "ofere", "oferim", "oferi", "propune", "propun", "propunem", "propui", "propus", "propusa", "propuse", "creeze", "scrise",
  // M12 review R13: real words one letter away from a client type or a place („o ofertă optimă”, „are o cabină”, „contabila ei”, „din Arieș”).
  "optim", "optima", "optime", "optimi", "optimul", "optimala", "cabina", "cabine", "cabinei", "contabila", "contabile", "contabilei", "aries", "ariesul"]);
/** Typo tolerance for a client type or a place: only words of at least 6 letters, one slip (two from 10 letters) — never a short word. */
const TYPO_MIN_NAME = 6;
/** The article and case endings of a noun („restaurant” → „restaurantul”, „farmacie” → „farmacia”, „farmaciei”). */
const NOUN_ENDINGS = new Set(["ul", "ului", "uri", "urile", "urilor", "l", "lui", "le", "lor", "i", "ii", "ile", "ilor", "a", "ua", "ei", "lei"]);
const inflectionOf = (fold, word) => fold.length > word.length && word.length >= 4
  && ((fold.startsWith(word) && NOUN_ENDINGS.has(fold.slice(word.length))) || (/[ea]$/.test(word) && fold.startsWith(word.slice(0, -1)) && NOUN_ENDINGS.has(fold.slice(word.length - 1))));

/** Sector phrases → the canonical sector and its CAEN rev. 2 code (the synthetic generator's sector table where it has one). */
const SECTORS = [
  { label: "service auto", caen: "4520", phrases: ["service auto", "service ul auto", "servis auto", "autoservice", "service de masini", "service pentru masini", "atelier auto",
    "atelier de reparatii auto", "reparatii auto", "vulcanizare", "spalatorie auto"] },
  { label: "cabinet stomatologic", caen: "8623", phrases: ["cabinet stomatologic", "clinica stomatologica", "clinica dentara", "cabinet dentar", "dentist", "stomatolog"] },
  { label: "restaurant", caen: "5610", phrases: ["restaurant", "bistro", "pizzerie", "pizzeria"] },
  { label: "cafenea", caen: "5630", phrases: ["cafenea", "coffee shop"] },
  { label: "brutărie", caen: "1071", phrases: ["brutarie", "patiserie", "panificatie"] },
  { label: "florărie", caen: "4776", phrases: ["florarie"] },
  { label: "pensiune", caen: "5520", phrases: ["pensiune", "cabana"] },
  { label: "sală de fitness", caen: "9313", phrases: ["sala de fitness", "sala de sport", "fitness"] },
  { label: "firmă de contabilitate", caen: "6920", phrases: ["firma de contabilitate", "birou de contabilitate", "cabinet de contabilitate", "contabil"] },
  { label: "agenție imobiliară", caen: "6820", phrases: ["agentie imobiliara", "agentie de imobiliare"] },
  { label: "cabinet veterinar", caen: "7500", phrases: ["cabinet veterinar", "clinica veterinara", "veterinar"] },
  { label: "farmacie", caen: "4773", phrases: ["farmacie"] },
  { label: "magazin de optică", caen: "4778", phrases: ["magazin de optica", "optica medicala", "optica"] },
  { label: "croitorie", caen: "1413", phrases: ["croitorie", "atelier de croitorie"] },
  { label: "studio foto", caen: "7420", phrases: ["studio foto", "fotograf"] },
  { label: "firmă de curățenie", caen: "8121", phrases: ["firma de curatenie", "curatenie"] },
  { label: "firmă de construcții", caen: "4120", phrases: ["firma de constructii", "constructii"] },
  { label: "agenție de turism", caen: "7911", phrases: ["agentie de turism"] },
  { label: "instalații sanitare", caen: "4322", phrases: ["instalatii sanitare", "instalator"] },
  { label: "instalații electrice", caen: "4321", phrases: ["instalatii electrice", "electrician"] },
  { label: "salon de înfrumusețare", caen: "9602", phrases: ["salon de infrumusetare", "salon de coafura", "coafor", "frizerie"] },
].map((s) => ({ ...s, phrases: s.phrases.map((p) => p.split(" ")) }));

/** County → seat. A county named like its seat (Iași, Brașov…) is read as the county, and the seat is an assumption. */
const COUNTIES = [["Alba", "Alba Iulia"], ["Arad", "Arad"], ["Argeș", "Pitești"], ["Bacău", "Bacău"], ["Bihor", "Oradea"], ["Bistrița-Năsăud", "Bistrița"],
  ["Botoșani", "Botoșani"], ["Brașov", "Brașov"], ["Brăila", "Brăila"], ["Buzău", "Buzău"], ["Caraș-Severin", "Reșița"], ["Călărași", "Călărași"],
  ["Cluj", "Cluj-Napoca"], ["Constanța", "Constanța"], ["Covasna", "Sfântu Gheorghe"], ["Dâmbovița", "Târgoviște"], ["Dolj", "Craiova"], ["Galați", "Galați"],
  ["Giurgiu", "Giurgiu"], ["Gorj", "Târgu Jiu"], ["Harghita", "Miercurea Ciuc"], ["Hunedoara", "Deva"], ["Ialomița", "Slobozia"], ["Iași", "Iași"],
  ["Ilfov", "Buftea"], ["Maramureș", "Baia Mare"], ["Mehedinți", "Drobeta-Turnu Severin"], ["Mureș", "Târgu Mureș"], ["Neamț", "Piatra Neamț"],
  ["Olt", "Slatina"], ["Prahova", "Ploiești"], ["Satu Mare", "Satu Mare"], ["Sălaj", "Zalău"], ["Sibiu", "Sibiu"], ["Suceava", "Suceava"],
  ["Teleorman", "Alexandria"], ["Timiș", "Timișoara"], ["Tulcea", "Tulcea"], ["Vaslui", "Vaslui"], ["Vâlcea", "Râmnicu Vâlcea"], ["Vrancea", "Focșani"],
  ["București", "București"]];
const words = (s) => foldDiacritics(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const PLACES = COUNTIES.flatMap(([county, seat]) => {
  const same = words(county).join(" ") === words(seat).join(" ");
  return [{ county, seat, kind: same ? "county" : "seat", phrase: words(seat) }, ...(same ? [] : [{ county, seat, kind: "county", phrase: words(county) }])];
});
const DEMONYMS = [["clujean", "Cluj"], ["clujeana", "Cluj"], ["iesean", "Iași"], ["ieseana", "Iași"], ["bucurestean", "București"], ["bucuresteana", "București"],
  ["timisorean", "Timiș"], ["timisoreana", "Timiș"], ["brasovean", "Brașov"], ["brasoveana", "Brașov"], ["constantean", "Constanța"], ["constanteana", "Constanța"],
  ["craiovean", "Dolj"], ["craioveana", "Dolj"], ["sibian", "Sibiu"], ["sibiana", "Sibiu"], ["oradean", "Bihor"], ["oradeana", "Bihor"]]
  .map(([word, county]) => ({ county, seat: COUNTIES.find(([c]) => c === county)[1], kind: "demonym", phrase: [word] }));
const PLACE_PREPS = new Set(["din", "in", "la", "langa", "judetul", "judet", "orasul", "oras", "municipiul", "zona", "comuna", "localitatea"]);

/** Need markers: where the client's need starts. `keep` = trailing marker words that belong to the need („nu are site”). */
const NEED_MARKERS = [
  [["care", "are", "nevoie", "de"], 0], [["care", "au", "nevoie", "de"], 0], [["care", "isi", "doreste"], 0], [["care", "isi", "doresc"], 0],
  [["care", "ar", "vrea"], 0], [["care", "ar", "dori"], 0], [["care", "nu", "are"], 2], [["care", "nu", "au"], 2], [["care", "vrea"], 0], [["care", "vor"], 0],
  [["care", "doreste"], 0], [["care", "doresc"], 0], [["care", "cauta"], 0], [["care", "are"], 1], [["care", "au"], 1], [["ce", "vrea"], 0], [["cu", "nevoie", "de"], 0],
  [["are", "nevoie", "de"], 0], [["au", "nevoie", "de"], 0], [["isi", "doreste"], 0], [["vrea"], 0], [["vor"], 0], [["doreste"], 0], [["cauta"], 0], [["nu", "are"], 2],
].map(([w, keep]) => ({ words: w, keep, care: ["care", "ce", "cu"].includes(w[0]) })).sort((a, b) => b.words.length - a.words.length);
const NEED_LEAD_VERBS = new Set(["aiba", "aibe", "faca", "ofere", "primeasca", "poata", "foloseasca", "introduca", "implementeze"]);
const TRAILING_GLUE = new Set(["de", "cu", "in", "la", "si", "pentru", "pe", "sau", "ca", "a", "al", "o", "un", "care", "sa", "nu"]);
// R1: a cost verb („care să coste…”, „cât costă”, „să plătească”) and „gata” („gata în douăzeci de zile”) end the need: an amount or a term follows.
const CLAUSE_STOP = new Set(["buget", "bugetul", "pana", "termen", "termenul", "urgent", "urgenta", "fara", "dar", "insa", "iar", "deadline", "costa", "coste", "costat", "costeaza",
  "costand", "plateasca", "plateste", "plati", "gata"]);
const UNITS = new Set(TIME_UNIT_WORDS);
const NUMBER_WORDS = new Set([...NUMBER_WORDS_SMALL, ...NUMBER_WORDS_BIG]);
/** R-NEED-CUT (fail closed): what carries a quantity in a need — a number, a number word, a currency, a magnitude, a percent. */
const QTY_BIG = new Set([...NUMBER_WORDS_BIG, ...MAGNITUDE_WORDS, ...CURRENCY_WORDS, ...PERCENT_WORDS]);
const QTY_SMALL = new Set(NUMBER_WORDS_SMALL);
const QTY_AFTER_SMALL = new Set([...TIME_UNIT_WORDS, ...MAGNITUDE_WORDS, ...CURRENCY_WORDS]);
/** Price words cut the need as well (the amount may follow in other words): „un site cu un cost de…”, „cu prețuri…”. */
const PRICE_WORDS = new Set(["pret", "pretul", "preturi", "preturile", "cost", "costul", "costuri", "costurile", "tarif", "tariful", "tarife", "buget", "bugetul",
  "abonament", "abonamentul", "onorariu", "onorariul", "investitie", "investitia"]);

/** The need → the kind of service it suggests (INFERRED; the catalog itself is not configured). First match wins. */
const SERVICES = [
  { value: "programări online pe site", patterns: [/\bprogramar\w*/, /\bprogramez\w*/, /\brezervar\w*/, /\bbooking\b/] },
  { value: "magazin online", patterns: [/\bmagazin\w* online\b/, /\bshop\b/, /\bvanzari online\b/, /\bvand\w* online\b/, /\be-?commerce\b/] },
  { value: "formular de contact", patterns: [/\bformular\w*/] },
  { value: "vizibilitate în căutări (SEO)", patterns: [/\bseo\b/, /\bgoogle\b/, /\bvizibil\w*/, /\bcautari\b/] },
  { value: "site adaptat pentru telefon", patterns: [/\bmobil\w*/, /\btelefon\w*/, /\bresponsive\b/] },
  { value: "site de prezentare", patterns: [/\bsite\w*/, /\bwebsite\w*/, /\bpagin\w* web\b/] },
  { value: "identitate vizuală", patterns: [/\blogo\w*/, /\bidentitate vizuala\b/] },
  { value: "prezență pe rețele sociale", patterns: [/\bfacebook\b/, /\binstagram\b/, /\bretele sociale\b/, /\bsocial media\b/, /\btiktok\b/] },
];

/** Send / contact / publish: verb forms only (never the noun „contact”, „publicitate”, „pagina publică”). */
const REFUSALS = [
  ["send", /\btrimit(?:e|eti|em|i|a)?(?:-(?:o|i|l|le|ne|mi))?\b/g],
  ["send", /\bexpedi(?:aza|ati|ez)(?:-(?:o|i|l|le))?\b/g],
  ["send", /\bscrie(?:ti)?-(?:le|i)\b/g],
  ["send", /\bda(?:ti)?-(?:le|i)\s+(?:un\s+)?(?:e-?mail|mail|mesaj|sms|telefon)\b/g],
  ["send", /\b(?:send|email them|e-mail them|mail them)\b/g],
  ["contact", /\bcontact(?:eaza|ati|ezi|ez|am|eze)(?:-(?:o|i|l|le))?\b/g],
  ["contact", /\bcontacta-(?:o|i|l|le)\b/g],
  ["contact", /\bsuna(?:ti)?-(?:i|l|o|le)\b/g],
  ["contact", /\bcontact (?:them|him|her|the client)\b/g],
  ["publish", /\bpublic(?:a|ati|am)(?:-(?:o|l|le))?\s+(?:oferta|propunerea|anuntul|postarea|articolul|pe)\b/g],
  ["publish", /\bpublica-(?:o|l|le)\b/g],
  ["publish", /\bpost(?:eaza|ati|am|ez|eze)(?:-(?:o|l|le))?\b/g],
  ["publish", /\b(?:publish|post it)\b/g],
];
/** A misspelt send / contact / publish verb is refused (never corrected into a step). Real words near them are not. */
const REFUSAL_TYPOS = [["send", "trimite"], ["send", "trimiteti"], ["contact", "contacteaza"], ["contact", "contactati"], ["contact", "contactez"],
  ["contact", "contactam"], ["publish", "posteaza"], ["publish", "postati"]];
const REFUSAL_BENIGN = new Set(["trimitere", "trimiterea", "trimiteri", "trimiterii", "trimis", "trimisa", "trimise", "trimisi", "contact", "contactul",
  "contacte", "contactele", "contactului", "contactat", "contactata", "contactate", "contactare", "contactarea", "postare", "postarea", "postari",
  "postarile", "postat", "postata", "postul", "poster", "postas", "posta",
  // M12 review R15: ordinary verbs one letter away from a send / contact / publish verb („contractează des firme”, „nu costează mult”, „comenzi primite”).
  "contracteaza", "contractati", "contractam", "contractez", "contractezi", "contracteze", "contractat", "contractata", "contractate", "costeaza", "costati", "costam",
  "costeze", "primite"]);
const REFUSAL_REASON = {
  send: "Trimiterea e dezactivată (OUTREACH_DISABLED): pregătesc doar ciorne locale, nimic nu pleacă.",
  contact: "Contactarea e dezactivată (OUTREACH_DISABLED): nu contactez pe nimeni; ciorna rămâne locală.",
  publish: "Publicarea e dezactivată (OUTREACH_DISABLED): nimic nu se publică.",
};
const NEGATIONS = new Set(["nu", "fara", "nici"]);
/** Words that may stand between a negation and its verb („nu vreau să-i trimiți”). Anything else ends the look-back. */
const NEGATION_GLUE = new Set(["sa", "s", "o", "il", "l", "le", "i", "ii", "mai", "inca", "a", "ne", "vreau", "vrem", "doresc", "dorim", "trebuie"]);
const EXCLUSION_STARTS = [["fara"], ["nu", "si"], ["dar", "nu"], ["insa", "nu"], ["nu", "vrea"], ["nu", "vor"], ["nu", "doreste"], ["nu", "doresc"], ["nici"]];

const CUR = `(?:${CURRENCY_WORDS.join("|")})`;
const UNIT_RE = `(?:${[...TIME_UNIT_WORDS].sort((a, b) => b.length - a.length).join("|")})`;
const BUDGET_PATTERNS = [
  /\bbuget(?:ul)?(?:\s+(?:de|maxim|max|total|disponibil|estimat|aproximativ|in jur de|sub|pana la|cam|circa))*\s*[:-]?\s*~?\s*\d[\d.,]*(?:\s*(?:k|mii|mie))?(?:\s*(?:de\s+)?(?:lei|ron|eur|euro|euri|usd|dolari)\b|\s*[€$])?/g,
  /\bbuget(?:ul)?\s+(?:e\s+|este\s+)?(?:mic|redus|limitat|mare|generos|flexibil|nelimitat|modest)\b/g,
  /\d[\d.,]*(?:\s*(?:k|mii|mie))?\s*(?:de\s+)?(?:lei|ron|eur|euro|euri|usd|dolari)\b/g,
  /[€$]\s*\d[\d.,]*/g,
  /\d[\d.,]*\s*[€$]/g,
  // R1: an amount in words or with a magnitude („trei mii de lei”, „două mii de euro”, „5k EUR”, „un buget de două mii”).
  new RegExp(`${QUANTITY_SOURCE}\\s*(?:de\\s+)?${CUR}\\b`, "g"),
  new RegExp(`\\bbuget(?:ul)?(?:\\s+(?:de|maxim|max|total|disponibil|estimat|aproximativ|in jur de|sub|pana la|cam|circa))*\\s*[:-]?\\s*~?\\s*${QUANTITY_SOURCE}(?:\\s*(?:de\\s+)?${CUR}\\b)?`, "g"),
  /\b\d+(?:[.,]\d+)?\s*k\b/g,
];
const DEADLINE_PATTERNS = [
  /\bpana\s+(?:la|in|pe|de)\s+[a-z0-9]+(?:\s+(?!si\b|cu\b|dar\b|buget)[a-z0-9]+){0,2}/g,
  /\b(?:in termen de|in maxim|in cel mult|in mai putin de|in)\s+(?:\d+|o|un|una|doua|doi|trei|patru|cinci|sase|sapte|opt|noua|zece|cateva)\s+(?:de\s+)?(?:zile|zi|saptamani|saptamana|luni|luna|ore|ani|an)\b/g,
  /\bintr-(?:o|un)\s+(?:luna|saptamana|zi|an)\b/g,
  /\b(?:urgent|urgenta|cat mai repede|cat mai curand|asap|saptamana viitoare|luna viitoare|anul viitor|luna aceasta|saptamana aceasta|luna asta|saptamana asta)\b/g,
  /\btermen(?:ul)?(?:\s+(?:de|limita|maxim|final))*\s*[:-]?\s*[a-z0-9]+(?:\s+(?!si\b|cu\b|dar\b|buget)[a-z0-9]+){0,2}/g,
  // R1: a term in words („în douăzeci de zile”, „în cincisprezece zile”, „peste jumătate de an”, „în 48h”, „în 2 săpt.”).
  new RegExp(`\\b(?:in termen de|in maxim|in cel mult|in mai putin de|in|peste|intr-o|intr-un)\\s+${QUANTITY_SOURCE}\\s*(?:de\\s+)?${UNIT_RE}\\b`, "g"),
];

/* ------------------------------------------------------------------ helpers */

function tokenize(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ raw: m[0], fold: foldDiacritics(m[0]).toLowerCase(), start: m.index, end: m.index + m[0].length }));
}

/**
 * Equal after folding, or (for words of ≥ `minLen` letters, 5 by default) one slip away (two from `minLen` + 4 letters): never a send
 * verb, a negation or a real other word.
 */
function same(tok, word, typo, minLen = 5) {
  if (tok.fold === word) return { ok: true, typo: false };
  // A client type or a place said with its article or case („restaurantul”, „farmaciei”) is the owner's word, not a typo.
  if (minLen >= TYPO_MIN_NAME && !NOT_A_TYPO.has(tok.fold) && inflectionOf(tok.fold, word)) return { ok: true, typo: false };
  if (!typo || word.length < minLen || tok.fold.length < minLen || /\d/.test(tok.fold) || NEVER_TARGET.has(tok.fold) || NOT_A_TYPO.has(tok.fold) || REFUSAL_BENIGN.has(tok.fold)) return { ok: false };
  return osaDistance(tok.fold, word) <= (word.length >= minLen + 4 ? 2 : 1) ? { ok: true, typo: true } : { ok: false };
}

function matchAt(tokens, i, phrase, typo, minLen = 5) {
  const typos = [];
  for (let k = 0; k < phrase.length; k += 1) {
    const tok = tokens[i + k];
    if (!tok) return null;
    const r = same(tok, phrase[k], typo, minLen);
    if (!r.ok) return null;
    if (r.typo) typos.push({ from: tok.raw, to: phrase[k] });
  }
  return { i, j: i + phrase.length - 1, typos };
}

/** The better of two phrase matches at the same position: more words first, then fewer typos (an exact form beats a near one). */
const better = (m, best) => !best || m.j - m.i > best.j - best.i || (m.j - m.i === best.j - best.i && m.typos.length < best.typos.length);

/** Merges overlapping [start, end) ranges. */
function mergeRanges(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

const rangesOf = (folded, patterns) => mergeRanges(patterns.flatMap((p) => { p.lastIndex = 0; return [...folded.matchAll(p)].map((m) => ({ start: m.index, end: m.index + m[0].length })); }));
const inside = (tok, ranges) => ranges.some((r) => tok.start >= r.start && tok.end <= r.end);
const trimSpan = (text) => text.replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "");

/* ------------------------------------------------------------------ parser */

/**
 * @param {string} request the owner's sentence (text or transcribed voice)
 * @returns {{ version: string, parser: { version: string, model: null, rules: string[] }, request: string,
 *   intent: { value: "PREPARE_OFFER", provenance: "USER_PROVIDED", span: string } | null,
 *   fields: Record<"clientType"|"sector"|"caen"|"place"|"county"|"city"|"problem"|"service"|"budget"|"deadline"|"constraints", object|null>,
 *   assumptions: { id: string, field: string, text: string }[], missing: { field: string, text: string }[],
 *   refused: { text: string, kind: "send"|"contact"|"publish", code: "OUTREACH_DISABLED", reason: string, typo?: true }[],
 *   corrections: { from: string, to: string }[] }}
 */
export function parseBrief(request) {
  if (typeof request !== "string") throw new HubError("validation", "Cererea pentru brief trebuie să fie text");
  const text = redactText(request.normalize("NFC")).trim();
  if (text.length > MAX_BRIEF_REQUEST) throw new HubError("validation", `Cererea e prea lungă pentru un brief (maximum ${MAX_BRIEF_REQUEST} de caractere)`);
  const folded = foldAligned(text);
  const tokens = tokenize(text);
  const corrections = [];
  const correct = (typos) => { for (const t of typos) if (!corrections.some((c) => c.from === t.from && c.to === t.to)) corrections.push(t); };
  const span = (i, j) => text.slice(tokens[i].start, tokens[j].end);
  const gapBefore = (k) => (k > 0 ? text.slice(tokens[k - 1].end, tokens[k].start) : "");

  // 1. Refusals first (R-REFUSE). A negated one is a constraint („fără să trimiți nimic”), not a request.
  const negatedAt = (start) => {
    const at = tokens.findIndex((t) => t.start >= start);
    let k = (at < 0 ? tokens.length : at) - 1;
    for (let steps = 0; k >= 0 && steps < 4; k -= 1, steps += 1) {
      // R15: punctuation between the negation and the verb ends the look-back („Nu, trimite oferta” asks to send).
      if (/[.,;:!?\n()]/.test(text.slice(tokens[k].end, tokens[k + 1] ? Math.min(tokens[k + 1].start, start) : start))) return -1;
      if (NEGATIONS.has(tokens[k].fold)) return k;
      if (!NEGATION_GLUE.has(tokens[k].fold)) return -1;
    }
    return -1;
  };
  const refusalHits = [];
  for (const [kind, pattern] of REFUSALS) {
    pattern.lastIndex = 0;
    for (const m of folded.matchAll(pattern)) refusalHits.push({ kind, start: m.index, end: m.index + m[0].length, typo: false });
  }
  for (const tok of tokens) {
    if (tok.fold.length < 5 || REFUSAL_BENIGN.has(tok.fold) || refusalHits.some((h) => tok.start >= h.start && tok.start < h.end)) continue;
    const hit = REFUSAL_TYPOS.find(([, verb]) => tok.fold !== verb && osaDistance(tok.fold, verb) <= 1);
    if (hit) refusalHits.push({ kind: hit[0], start: tok.start, end: tok.end, typo: true });
  }
  refusalHits.sort((a, b) => a.start - b.start);
  const refused = [];
  const refusedRanges = [];
  const negatedRefusals = [];
  for (const h of refusalHits) {
    const neg = negatedAt(h.start);
    if (neg >= 0) { negatedRefusals.push({ ...h, negation: neg }); continue; }
    refusedRanges.push({ start: h.start, end: h.end });
    refused.push({ text: text.slice(h.start, h.end), kind: h.kind, code: OUTREACH, reason: REFUSAL_REASON[h.kind], ...(h.typo ? { typo: true } : {}) });
  }
  const blocked = (tok) => inside(tok, refusedRanges) || refusedRanges.some((r) => tok.start < r.end && tok.end > r.start);

  // 2. Budget and deadline (USER_PROVIDED, internal only: they never enter a client text).
  const budgetRanges = rangesOf(folded, BUDGET_PATTERNS);
  const deadlineRanges = rangesOf(folded, DEADLINE_PATTERNS).filter((d) => !budgetRanges.some((b) => d.start < b.end && d.end > b.start));
  const constraintRanges = [...budgetRanges, ...deadlineRanges];
  const spanField = (ranges, rule) => (ranges.length ? { value: ranges.map((r) => trimSpan(text.slice(r.start, r.end))).join("; "), provenance: BRIEF_PROVENANCE.USER_PROVIDED,
    span: ranges.map((r) => trimSpan(text.slice(r.start, r.end))).join("; "), rule } : null);
  const budget = spanField(budgetRanges, "R-BUDGET@1");
  const deadline = spanField(deadlineRanges, "R-DEADLINE@1");

  // A clause ends at punctuation, at a refused or constraint span, or where a new instruction starts.
  const clauseEnd = (i, max) => {
    let j = -1;
    for (let k = i; k < tokens.length && k < i + max; k += 1) {
      const f = tokens[k].fold;
      const next = tokens[k + 1]?.fold;
      if (k > i && /[.;!?,:\n()]/.test(gapBefore(k))) break;
      if (blocked(tokens[k]) || inside(tokens[k], constraintRanges) || constraintRanges.some((r) => tokens[k].start < r.end && tokens[k].end > r.start)) break;
      if (k > i && CLAUSE_STOP.has(f)) break;
      if (k > i && f === "cu" && ["buget", "bugetul", "termen", "termenul"].includes(next)) break;
      if (k > i && (f === "in" || f === "intr") && (NUMBER_WORDS.has(next) || /^\d+$/.test(next || "")) && UNITS.has(tokens[k + 2]?.fold)) break;
      if (k > i && f === "si" && (NEGATIONS.has(next) || PREPARE_VERBS.some((v) => v[0] === next) || (tokens[k + 1] && blocked(tokens[k + 1])))) break;
      if (k > i && f === "nu" && ["si", "vrea", "vor", "doreste", "doresc"].includes(next)) break;
      j = k;
    }
    while (j >= i && TRAILING_GLUE.has(tokens[j].fold)) j -= 1;
    return j;
  };

  // 3. Intent (R-INTENT): a non-negated preparation verb with an offer noun, or the bare noun when nothing is refused.
  let verb = null;
  let negatedIntent = false;
  for (let i = 0; i < tokens.length && !verb; i += 1) {
    if (blocked(tokens[i])) continue;
    for (const phrase of PREPARE_VERBS) {
      const m = matchAt(tokens, i, phrase, true);
      if (!m) continue;
      // „vreau”, „aș vrea”, „am nevoie de” name the owner's wish only right before an offer noun („nu vreau să trimiți” is not one).
      if (WANT_VERBS.has(phrase[0]) && !tokens.slice(m.j + 1, m.j + 4).some((t) => OFFER_NOUNS.some((w) => same(t, w, true).ok))) continue;
      if (negatedAt(tokens[i].start) >= 0) { negatedIntent = true; break; }
      verb = m;
      break;
    }
  }
  let noun = null;
  for (let i = 0; i < tokens.length && !noun; i += 1) {
    if (blocked(tokens[i])) continue;
    for (const word of OFFER_NOUNS) {
      const m = matchAt(tokens, i, [word], true);
      if (m) { noun = m; break; }
    }
  }
  let intent = null;
  if (verb && noun) {
    correct([...verb.typos, ...noun.typos]);
    // The verb and its noun as one span, unless a refused word stands between them („pregătește și trimite oferta”).
    const between = tokens.slice(verb.j + 1, noun.i);
    const joined = noun.i > verb.j && noun.i - verb.j <= 4 && !between.some(blocked) ? span(verb.i, noun.j) : span(verb.i, verb.j);
    intent = { value: "PREPARE_OFFER", provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: joined };
  } else if (!verb && noun && !refused.length && !negatedIntent) {
    correct(noun.typos);
    intent = { value: "PREPARE_OFFER", provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: span(noun.i, noun.j) };
  }

  // 4. Client type and sector (R-SECTOR): the phrase as said, its canonical sector and CAEN code inferred.
  let sectorHit = null;
  for (let i = 0; i < tokens.length && !sectorHit; i += 1) {
    if (blocked(tokens[i])) continue;
    let best = null;
    for (const s of SECTORS) {
      for (const phrase of s.phrases) {
        const m = matchAt(tokens, i, phrase, true, TYPO_MIN_NAME);
        if (m && better(m, best?.m)) best = { s, m, phrase };
      }
    }
    sectorHit = best;
  }
  let clientType = null;
  let sector = null;
  let caen = null;
  const assumptions = [{ id: "A-SYNTH", field: "client", text: "Firma e sintetică: numele, domeniul .test și CUI-ul 99… se generează; nu e o firmă reală." }];
  /** R13: a word read through a typo is never the owner's statement: INFERRED, with the rule and the correction, and still to confirm. */
  const typoRead = (field, said, read) => {
    assumptions.push({ id: "A-TYPO", field, text: `Am citit „${said}” ca „${read}” (posibilă greșeală de tastare); nu e o afirmație a ta, de confirmat.` });
    return { value: read, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-TYPO@1", from: said, reasoning: `„${said}” citit ca „${read}” (posibilă greșeală de tastare)` };
  };
  if (sectorHit) {
    correct(sectorHit.m.typos);
    const said = span(sectorHit.m.i, sectorHit.m.j);
    clientType = sectorHit.m.typos.length ? typoRead("clientType", said, sectorHit.phrase.join(" ")) : { value: said, provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: said };
    sector = { value: sectorHit.s.label, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-SECTOR@1", from: said, reasoning: `„${said}” → ${sectorHit.s.label} (lexicon)` };
    caen = { value: sectorHit.s.caen, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-SECTOR@1", from: said, reasoning: `${sectorHit.s.label} → CAEN ${sectorHit.s.caen} (lexicon)` };
  }

  // 5. Place (R-PLACE): the name as said; the county and the city it points to are inferred.
  let placeHit = null;
  for (let i = 0; i < tokens.length && !placeHit; i += 1) {
    if (blocked(tokens[i])) continue;
    const afterPrep = i > 0 && PLACE_PREPS.has(tokens[i - 1].fold);
    let best = null;
    for (const p of afterPrep ? [...PLACES, ...DEMONYMS] : DEMONYMS) {
      const m = matchAt(tokens, i, p.phrase, true, TYPO_MIN_NAME);
      if (m && better(m, best?.m)) best = { p, m };
    }
    placeHit = best;
  }
  let place = null;
  let county = null;
  let city = null;
  if (placeHit) {
    correct(placeHit.m.typos);
    const said = span(placeHit.m.i, placeHit.m.j);
    const { county: c, seat, kind } = placeHit.p;
    place = placeHit.m.typos.length ? typoRead("place", said, kind === "seat" ? seat : c) : { value: said, provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: said };
    county = { value: c, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-PLACE@1", from: said,
      reasoning: kind === "seat" ? `„${said}” e în județul ${c} (lexicon)` : `„${said}” = județul ${c} (lexicon)` };
    city = { value: seat, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-PLACE@1", from: said,
      reasoning: kind === "seat" ? `„${said}” = municipiul ${seat} (lexicon)` : `reședința județului ${c}; poate fi altă localitate din județ` };
    if (kind !== "seat") assumptions.push({ id: "A-CITY", field: "city", text: `Am presupus ${seat} pentru „${said}”; e o inferență, nu o afirmație.` });
  }

  // 6. Need (R-NEED): the client's need, verbatim, from the marker to the end of its clause. The marker is looked for after the client
  // type first; when the client type is named only inside the need („… care vrea un site pentru restaurantul ei”, review R4), before it
  // (a „care …” marker only: never the owner's own „aș vrea” / „am nevoie de”).
  let problem = null;
  let needHit = null;
  const findNeed = (from, to, careOnly) => {
    for (let i = from; i < to; i += 1) {
      if (blocked(tokens[i])) continue;
      for (const marker of NEED_MARKERS) {
        if (careOnly && !marker.care) continue; // without a client the owner's own „vreau” / „am nevoie de” is not the client's need
        if (marker.keep === 0 && tokens[i - 1]?.fold === "nu") continue; // „nu vrea X” is an exclusion, never the need
        const m = matchAt(tokens, i, marker.words, false);
        if (m) return { marker, m };
      }
    }
    return null;
  };
  needHit = findNeed(sectorHit ? sectorHit.m.j + 1 : 0, tokens.length, !sectorHit) || (sectorHit ? findNeed(0, sectorHit.m.i, true) : null);
  let needRange = null;
  if (needHit) {
    let start = needHit.m.j + 1 - needHit.marker.keep;
    if (needHit.marker.keep === 0) {
      if (tokens[start]?.fold === "sa") start += 1;
      if (NEED_LEAD_VERBS.has(tokens[start]?.fold)) start += 1;
    }
    const end = start < tokens.length ? clauseEnd(start, 12) : -1;
    if (end >= start) {
      // R-NEED-CUT (review R1 / R14 / C1, fail closed): the client text gets the need only up to the first word that carries a quantity
      // (a number, a number word, a currency, a magnitude, a percent) or a commercial figure (an amount, a term, ROI, a discount, an
      // approximation — the C-02 scanner, run on the raw clause with the symbols after its last word, e.g. „30%”). What follows stays
      // internal: the full stated need is kept (`stated`, and the request itself) and the cut is recorded in the assumptions.
      let statedEnd = tokens[end].end;
      const trailing = /^\s?[%€$£]+/.exec(text.slice(statedEnd));
      if (trailing) statedEnd += trailing[0].length;
      const stated = text.slice(tokens[start].start, statedEnd);
      let cut = -1;
      for (let k = start; k <= end && cut < 0; k += 1) {
        const f = tokens[k].fold;
        const next = tokens[k + 1]?.fold;
        const after = next === "de" ? tokens[k + 2]?.fold : next;
        if (/\d/.test(f) || QTY_BIG.has(f) || PRICE_WORDS.has(f) || (f === "la" && next === "suta") || (QTY_SMALL.has(f) && QTY_AFTER_SMALL.has(after || ""))
          || (k > start && /[%€$£~]/.test(gapBefore(k)))) cut = k;
      }
      const figure = findCommercialFigures(stated)[0];
      if (figure) {
        const at = tokens.findIndex((t, k) => k >= start && t.end > tokens[start].start + figure.index);
        if (at >= start && (cut < 0 || at < cut)) cut = at;
      }
      let last = cut < 0 ? end : cut - 1;
      while (cut >= 0 && last >= start && TRAILING_GLUE.has(tokens[last].fold)) last -= 1;
      const value = last >= start ? text.slice(tokens[start].start, tokens[last].end) : "";
      needRange = { start: tokens[needHit.m.i].start, end: statedEnd };
      if (cut < 0) problem = { value, provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: text.slice(tokens[needHit.m.i].start, tokens[end].end) };
      else {
        problem = { value, provenance: BRIEF_PROVENANCE.USER_PROVIDED, span: text.slice(tokens[needHit.m.i].start, statedEnd), stated, rule: "R-NEED-CUT@1" };
        const rest = text.slice(tokens[last >= start ? last + 1 : start].start, statedEnd);
        assumptions.push({ id: "A-NEED-CUT", field: "problem", text: value
          ? `Din nevoia spusă am păstrat în ofertă doar partea fără cifre sau promisiuni comerciale („${value}”); restul („${rest}”) rămâne intern.`
          : `Nevoia spusă („${stated}”) începe cu cifre sau promisiuni comerciale: n-o pun în ofertă; rămâne internă.` });
      }
    }
  }
  const needText = problem ? problem.stated || problem.value : "";

  // 7. Service (R-SERVICE): what the need suggests, inferred (from the full stated need: it never enters a client text). The catalog
  // match itself stays unknown (catalog neconfigurat).
  let service = null;
  if (needText) {
    const need = foldDiacritics(needText).toLowerCase();
    const hit = SERVICES.find((s) => s.patterns.some((p) => p.test(need)));
    if (hit) {
      service = { value: hit.value, provenance: BRIEF_PROVENANCE.INFERRED, rule: "R-SERVICE@1", from: needText, reasoning: `„${needText}” → ${hit.value} (lexicon)` };
      assumptions.push({ id: "A-SERVICE", field: "service", text: `Am interpretat „${needText}” ca ${hit.value}; de confirmat.` });
    }
  }
  if (sector && clientType && foldDiacritics(clientType.value).toLowerCase() !== foldDiacritics(sector.value).toLowerCase()) {
    assumptions.push({ id: "A-SECTOR", field: "sector", text: `Am încadrat „${clientType.value}” ca ${sector.value} (CAEN ${caen.value}); de confirmat.` });
  }

  // 8. Other constraints (R-CONSTRAINT): exclusions and negated outreach, verbatim.
  const problemRange = problem ? needRange : null;
  const constraintSpans = [];
  const addClause = (i) => {
    if (constraintSpans.some((c) => tokens[i].start >= c.start && tokens[i].start < c.end)) return;
    const j = clauseEnd(i, 10);
    if (j < i) return;
    constraintSpans.push({ start: tokens[i].start, end: tokens[j].end });
  };
  for (let i = 0; i < tokens.length; i += 1) {
    if (blocked(tokens[i]) || (problemRange && tokens[i].start >= problemRange.start && tokens[i].end <= problemRange.end)) continue;
    if (EXCLUSION_STARTS.some((phrase) => matchAt(tokens, i, phrase, false))) addClause(i);
  }
  for (const h of negatedRefusals) addClause(h.negation);
  constraintSpans.sort((a, b) => a.start - b.start);
  const constraints = constraintSpans.length
    ? { value: constraintSpans.map((c) => trimSpan(text.slice(c.start, c.end))), provenance: BRIEF_PROVENANCE.USER_PROVIDED, rule: "R-CONSTRAINT@1" } : null;

  // 9. What the request does not say is missing: never guessed.
  const noSite = problem && /\b(?:nu are|nu au|fara)\s+(?:un\s+)?(?:site|website|pagina web)\b/.test(foldDiacritics(needText).toLowerCase());
  const typoNote = (f) => (f?.rule === "R-TYPO@1" ? ` (am dedus „${f.value}” din „${f.from}”, o posibilă greșeală de tastare; de confirmat)` : "");
  const missing = [
    ...(!intent ? [{ field: "intent", text: negatedIntent ? "ce să pregătesc (cererea pare negată)" : "ce să pregătesc (o ofertă?)" }] : []),
    ...(clientType?.provenance !== BRIEF_PROVENANCE.USER_PROVIDED ? [{ field: "clientType", text: `tipul firmei (domeniul de activitate)${typoNote(clientType)}` }] : []),
    ...(place?.provenance !== BRIEF_PROVENANCE.USER_PROVIDED ? [{ field: "place", text: `localitatea sau județul firmei${typoNote(place)}` }] : []),
    ...(!problem ? [{ field: "problem", text: "nevoia clientului (ce vrea să rezolve)" }] : []),
    ...(!service ? [{ field: "service", text: "serviciul potrivit (nu reiese din cerere)" }] : []),
    ...(!budget ? [{ field: "budget", text: "bugetul" }] : []),
    ...(!deadline ? [{ field: "deadline", text: "termenul dorit" }] : []),
    { field: "companySize", text: "mărimea firmei" },
    ...(!noSite ? [{ field: "website", text: "site-ul existent al firmei" }] : []),
    { field: "catalog", text: "serviciul și prețul din catalog (catalog neconfigurat)" },
  ];

  return {
    version: BRIEF_VERSION,
    parser: { version: BRIEF_VERSION, model: null, rules: [...BRIEF_RULES] },
    request: text,
    intent,
    fields: { clientType, sector, caen, place, county, city, problem, service, budget, deadline, constraints },
    assumptions,
    missing,
    refused,
    corrections,
  };
}

/** The identity of a brief (it is part of the plan body: a changed brief is a new plan and a new confirmation). */
export const briefSha = (brief) => hashCanonical(brief);
