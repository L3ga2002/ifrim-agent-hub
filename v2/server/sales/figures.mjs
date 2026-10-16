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
const UNIT = "(?:zile|zi|saptamani|saptamana|luni|luna|ore|ora|ani|an|minute|days?|weeks?|months?|hours?|years?)";
/** Every pattern runs on the folded text (lower case, no diacritics, same length as the original). */
const PATTERNS = Object.freeze([
  ["currency", new RegExp(`\\d+(?:[., ]\\d+)*\\s*(?:de\\s+)?${CURRENCY}\\b`, "g")],
  ["currency", new RegExp(`\\d+(?:[.,]\\d+)*\\s*[€$£]`, "g")],
  ["currency", new RegExp(`(?:[€$£]|\\b${CURRENCY})\\s*\\d+(?:[.,]\\d+)*`, "g")],
  ["price", /\b(?:pret|preturi|pretul|cost|costuri|costul|costa|tarif|tarife|tariful|buget|bugetul|investitie|investitia|abonament|abonamentul|onorariu|onorariul)\b[^\n.;]{0,25}\d/g],
  ["duration", new RegExp(`\\b\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|—|la|sau)\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:de\\s+)?${UNIT}\\b`, "g")],
  ["duration", new RegExp(`\\b${NUMBER_WORD}\\s+${UNIT}\\b`, "g")],
  ["percentage", /\d+(?:[.,]\d+)?\s*%/g],
  ["percentage", /\b\d+(?:[.,]\d+)?\s*(?:la suta|procente|procent)\b/g],
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
      if (match && !found.some((f) => f.index === m.index && f.category === category)) found.push({ category, text: match, index: m.index });
    }
  }
  return found.sort((a, b) => a.index - b.index || FIGURE_CATEGORIES.indexOf(a.category) - FIGURE_CATEGORIES.indexOf(b.category));
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
