import { foldDiacritics } from "./identity.mjs";
import { priceText, leadTimeText } from "./proposal.mjs";

/**
 * Commercial figures in client texts (M12, C-02). The catalog starts empty and the owner has given no real prices, so a text the
 * Hub generates for a client must not carry an amount, a duration, a percentage, a return-on-investment promise, a discount or an
 * approximation ("aproximativ 2000", "~2000"): a missing price is the explicit state UNKNOWN, written „De stabilit (neconfigurat)”.
 * This scanner finds such figures so the M12 path can refuse the text (before READY_FOR_OWNER_REVIEW, at the approval of a
 * preparation-bound offer, before the dossier is written). The manual M04 path is not gated by it.
 *
 * The only figures allowed are the exact texts of CONFIGURED catalog entries (`allowedCatalogTexts`): the owner configured them.
 * Plain counts ("3 din 7 imagini"), fiscal codes, versions and dates are not commercial figures and are not reported.
 *
 * Pure module: no database, no network, no clock.
 */

export const FIGURE_CATEGORIES = Object.freeze(["currency", "price", "duration", "percentage", "roi", "discount", "approximation"]);

const CURRENCY = "(?:lei|leu|ron|eur|euro|euri|usd|dolari|dolar|gbp|chf)";
const NUMBER_WORD = "(?:o|un|una|doua|doi|trei|patru|cinci|sase|sapte|opt|noua|zece|cateva|cativa|cele)";
const UNIT = "(?:zile|zi|saptamani|saptamana|sapt|luni|luna|ore|ora|ani|an|minute|days?|weeks?|months?|hours?|years?)";
/**
 * M12 review R1/R2: an amount or a term is also written in words („trei mii de lei”, „douăzeci de zile”, „jumătate de an”, „5k”). The
 * number words (folded), the magnitudes and the currency / time words below are shared with the brief parser (brief.mjs), which cuts
 * the client's need before any of them (fail closed).
 */
export const NUMBER_WORDS_BIG = Object.freeze(["zero", "unu", "doi", "doua", "trei", "patru", "cinci", "sase", "sapte", "opt", "noua", "zece", "unsprezece", "unspe",
  "doisprezece", "douasprezece", "doispe", "treisprezece", "treispe", "paisprezece", "paispe", "cincisprezece", "cinspe", "saisprezece", "saispe", "saptesprezece",
  "saptespe", "optsprezece", "optspe", "nouasprezece", "nouaspe", "douazeci", "treizeci", "patruzeci", "cincizeci", "saizeci", "saptezeci", "optzeci", "nouazeci",
  "zeci", "jumatate", "sfert"]);
/** Words that are a quantity only before a unit, a magnitude or a currency („o zi”, „un milion”, „câteva mii”), else an article. */
export const NUMBER_WORDS_SMALL = Object.freeze(["o", "un", "una", "cateva", "cativa"]);
export const MAGNITUDE_WORDS = Object.freeze(["suta", "sute", "mie", "mii", "milion", "milioane", "mil", "miliard", "miliarde", "k"]);
export const CURRENCY_WORDS = Object.freeze(["lei", "leu", "ron", "eur", "euro", "euri", "usd", "dolari", "dolar", "gbp", "chf"]);
export const TIME_UNIT_WORDS = Object.freeze(["zile", "zi", "saptamani", "saptamana", "sapt", "luni", "luna", "ore", "ora", "h", "ani", "an", "minute"]);
export const PERCENT_WORDS = Object.freeze(["procent", "procente", "procentul"]);
const alt = (list) => `(?:${[...list].sort((a, b) => b.length - a.length).join("|")})`;
const NUM_WORD = alt([...NUMBER_WORDS_BIG, ...NUMBER_WORDS_SMALL]);
const MAGNITUDE = alt(MAGNITUDE_WORDS.filter((w) => w !== "k"));
/** A quantity in digits („2”, „1,5”, „5k”) or in words („două”, „douăzeci și cinci”, „o mie”, „cinci sute”, „două milioane”). */
export const QUANTITY_SOURCE = `(?:\\d+(?:[.,]\\d+)*(?:\\s*k\\b)?|\\b${NUM_WORD}\\b)(?:\\s+(?:si\\s+)?(?:${NUM_WORD}|(?:de\\s+)?${MAGNITUDE})\\b)*`;
/** Every pattern runs on the folded text (lower case, no diacritics, same length as the original). */
const PATTERNS = Object.freeze([
  ["currency", new RegExp(`\\d+(?:[., ]\\d+)*\\s*(?:de\\s+)?${CURRENCY}\\b`, "g")],
  ["currency", new RegExp(`\\d+(?:[.,]\\d+)*\\s*[€$£]`, "g")],
  ["currency", new RegExp(`(?:[€$£]|\\b${CURRENCY})\\s*\\d+(?:[.,]\\d+)*`, "g")],
  // „două mii de lei”, „2 mii lei”, „5k EUR”, „1,5 milioane lei”, „o mie de lei”, „cinci sute de lei”, „mii de euro”, „5k”.
  ["currency", new RegExp(`${QUANTITY_SOURCE}\\s*(?:de\\s+)?${CURRENCY}\\b`, "g")],
  ["currency", new RegExp(`\\b${MAGNITUDE}\\s+(?:de\\s+)?${CURRENCY}\\b`, "g")],
  ["currency", /\b\d+(?:[.,]\d+)?\s*k\b/g],
  ["price", /\b(?:pret|preturi|pretul|cost|costuri|costul|costa|tarif|tarife|tariful|buget|bugetul|investitie|investitia|abonament|abonamentul|onorariu|onorariul)\b[^\n.;]{0,25}\d/g],
  ["price", new RegExp(`\\b(?:pret|preturi|pretul|cost|costuri|costul|costa|tarif|tarife|tariful|buget|bugetul|investitie|investitia|abonament|abonamentul|onorariu|onorariul)\\b[^\\n.;\\d]{0,25}?\\b${alt([...NUMBER_WORDS_BIG, ...MAGNITUDE_WORDS.filter((w) => w !== "k")])}\\b`, "g")],
  ["duration", new RegExp(`\\b\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|—|la|sau)\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:de\\s+)?${UNIT}\\b`, "g")],
  ["duration", new RegExp(`\\b${NUMBER_WORD}\\s+${UNIT}\\b`, "g")],
  // „douăzeci de zile”, „cincisprezece zile”, „jumătate de an”, „48h”.
  ["duration", new RegExp(`\\b${QUANTITY_SOURCE}\\s+(?:de\\s+)?${UNIT}\\b`, "g")],
  ["duration", /\b\d+(?:[.,]\d+)?\s*h\b/g],
  ["percentage", /\d+(?:[.,]\d+)?\s*%/g],
  ["percentage", /\b\d+(?:[.,]\d+)?\s*(?:la suta|procente|procent)\b/g],
  ["percentage", new RegExp(`${QUANTITY_SOURCE}\\s+(?:la suta|procente|procent)\\b`, "g")],
  ["roi", /\b(?:roi|randament\w*|rentabilitat\w*|amortiz\w*|economis\w*|profit\w*|venituri suplimentare|crestere (?:de|a vanzarilor|a veniturilor|a clientilor)|dublar\w*|dubla\w* (?:vanzarile|veniturile|clientii)|triplar\w*|castig\w* (?:in plus|suplimentar\w*)|return on investment|payback)\b/g],
  ["discount", /\b(?:reducere|reduceri|reducerea|discount\w*|gratuit\w*|gratis|bonus\w*|oferta speciala|promoti\w*|pret redus|fara cost|free)\b/g],
  ["approximation", /\b(?:aproximativ\w*|aprox|estim(?:at|ativ|ar)\w*)\b/g],
  ["approximation", /(?:\b(?:circa|cca|in jur de)\s*|~\s*)\d+(?:[.,]\d+)*/g],
]);

/** Lower case, diacritics folded, ONE character per character: indexes in the folded text are indexes in the original. */
export function foldAligned(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    const f = foldDiacritics(ch).toLowerCase();
    // Astral characters take two UTF-16 units: keep the length so indexes stay aligned.
    out += f.length === ch.length ? f : ch.length === 2 ? "__" : "_";
  }
  return out;
}

/**
 * Commercial figures in `text` outside the allowed exact substrings.
 * @param {string} text
 * @param {{ allow?: string[] }} [options] exact substrings that may contain figures (CONFIGURED catalog texts only)
 * @returns {{ category: string, text: string, index: number }[]} ordered by position; [] when the text has none
 */
export function findCommercialFigures(text, { allow = [] } = {}) {
  const source = String(text ?? "").normalize("NFC");
  if (!source) return [];
  // Allowed texts are masked (same length) before scanning, so a figure next to them is still found.
  let masked = source;
  for (const a of (Array.isArray(allow) ? allow : []).map((x) => String(x ?? "")).filter((x) => x.trim()).sort((x, y) => y.length - x.length)) {
    masked = masked.split(a).join(" ".repeat(a.length));
  }
  const folded = foldAligned(masked);
  const found = [];
  for (const [category, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of folded.matchAll(pattern)) {
      const match = source.slice(m.index, m.index + m[0].length).trim();
      if (match && !found.some((f) => f.index === m.index && f.category === category)) found.push({ category, text: match, index: m.index, end: m.index + m[0].length });
    }
  }
  // A match inside a longer one of the same category („mii de lei” inside „două mii de lei”) is the same figure, reported once.
  const within = (a, b) => a !== b && a.category === b.category && a.index >= b.index && a.end <= b.end && (a.index > b.index || a.end < b.end);
  return found.filter((f) => !found.some((g) => within(f, g))).map(({ end, ...f }) => f)
    .sort((a, b) => a.index - b.index || FIGURE_CATEGORIES.indexOf(a.category) - FIGURE_CATEGORIES.indexOf(b.category));
}

/** The exact price and lead-time texts of CONFIGURED catalog services (the same text the proposal prints); nothing else is allowed. */
export function allowedCatalogTexts(services = []) {
  const out = [];
  for (const s of Array.isArray(services) ? services : []) {
    const price = priceText(s);
    const lead = leadTimeText(s);
    if (price) out.push(price);
    if (lead) out.push(lead);
  }
  return [...new Set(out)];
}

/** Every client-facing text of a rendered proposal (title, sections, joined text). The internal qualification is never part of it. */
export function proposalClientTexts(content) {
  const sections = Array.isArray(content?.sections) ? content.sections : [];
  return [content?.title, ...sections.flatMap((s) => [s?.heading, s?.text]), content?.text].map((t) => String(t ?? "")).filter(Boolean);
}

/** Figures in a proposal's client texts (deduplicated by category + text). */
export function proposalFigures(content, { allow = [] } = {}) {
  const seen = new Set();
  const out = [];
  for (const t of proposalClientTexts(content)) {
    for (const f of findCommercialFigures(t, { allow })) {
      const key = `${f.category}|${f.text}`;
      if (!seen.has(key)) { seen.add(key); out.push({ category: f.category, text: f.text }); }
    }
  }
  return out;
}
