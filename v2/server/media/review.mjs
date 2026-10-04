import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { validateIR, normalizeIR, canonicalIR, irHash, timelineDuration, clipDuration, primaryVideoTrack, clipAtFrame,
  msToFrames, framesToMs, fpsValue, framesToTimecode } from "./ir.mjs";
import { normalizeRo } from "./captions.mjs";
import { PRESETS } from "./visual-bible.mjs";

/**
 * Creative review of an edit: Romanian instructions → explicit patch operations on EditProjectIR v1, a structured diff, and
 * the review rows (proposal, application as a NEW validated version, owner decisions, manual divergences).
 *
 * parseInstruction never guesses silently:
 * - a time in the text („la secunda 12”, „la 0:12”, „la 00:00:12:15” = HH:MM:SS:FF non-drop-frame at the nominal rate)
 *   overrides the player position `atMs`; the frame shown at a time is floor(ms × fps) (12 s at 29,97 fps = frame 359);
 * - an amount that is not stated becomes an explicit proposal with its default in the notes („propunere: 1,5 s”);
 * - a negated clause („nu muta textul”) produces no operation; an instruction made only of negations or observations asks
 *   for a clarification instead of inventing a change;
 * - an ambiguous target (two texts on screen, a caption position) asks for a clarification.
 * Operations: move_text{itemId, dx, dy} (canvas fractions, dy < 0 = up), extend_clip{clipId, frames}, trim_clip{clipId,
 * frames, from: "end"|"start"}, replace_text{itemId, text}, remove_cue{cueId}, cut_range{from, to} (timeline frames,
 * half-open), edit_cue{cueId, text}.
 *
 * applyOps and diffIR are pure. Ripple rules: extending a clip inserts frames before its outgoing transition and shifts what
 * follows (text/captions that end exactly with the clip are extended with it); a cut removes [from, to) everywhere and closes
 * the gap; a cut that touches a transition is refused (choose an interval without a transition). The result is validated by
 * the caller (`createReviews.apply` refuses an invalid result and leaves the review OPEN).
 */

export const PARSER_VERSION = 1;
export const REVIEW_OPS = Object.freeze(["move_text", "extend_clip", "trim_clip", "replace_text", "remove_cue", "cut_range", "edit_cue"]);
export const REVIEW_KINDS = Object.freeze(["COMMENT", "CHANGES_REQUESTED", "CREATIVE_APPROVED", "REJECTED"]);
export const DEFAULTS = Object.freeze({ extendMs: 1500, trimMs: 1000, moveFraction: 0.08, moveSmall: 0.04, moveLarge: 0.15 });

// ---------------------------------------------------------------------------------------------------------------------
// Parsing helpers

const L = "\\p{L}\\p{N}";
/** A whole-word regex (Unicode letters count as word characters, unlike \b). */
const word = (src, flags = "") => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, `u${flags}`);
const NUM_WORDS = { o: 1, un: 1, una: 1, unu: 1, doi: 2, "două": 2, trei: 3, patru: 4, cinci: 5, "șase": 6, "șapte": 7, opt: 8, "nouă": 9, zece: 10, "jumătate": 0.5 };
const NUM = `\\d+(?:[.,]\\d+)?|${Object.keys(NUM_WORDS).join("|")}`;
const TIME = "\\d{1,2}:\\d{2}:\\d{2}[:;]\\d{2}|\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d+)?";
const UNIT = "milisecunde|milisecundă|ms|secunde|secundă|secunda|sec|s|minute|minut|min|cadre|cadru|frames";

function parseNumber(token) {
  if (token === undefined || token === null) return null;
  const t = String(token).trim();
  if (Object.prototype.hasOwnProperty.call(NUM_WORDS, t)) return NUM_WORDS[t];
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** A time token (+ optional unit) → { ms, frame? } at `fps`; null when unreadable. */
function parseTime(token, unit, fps, { minutesContext = false } = {}) {
  const t = String(token || "").trim();
  let m = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(t);
  if (m) {
    // HH:MM:SS:FF non-drop-frame at the nominal rate (as framesToTimecode writes it).
    const nominal = Math.max(1, Math.round(fpsValue(fps)));
    const ff = Number(m[4]);
    if (ff >= nominal || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
    const frame = ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * nominal) + ff;
    return { ms: framesToMs(frame, fps), frame };
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?$/.exec(t);
  if (m) {
    const frac = m[4] ? Number(`0.${m[4]}`) : 0;
    const secs = m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
    if (Number(m[2]) > 59 || (m[3] !== undefined && Number(m[3]) > 59)) return null;
    return { ms: Math.round((secs + frac) * 1000) };
  }
  const n = parseNumber(t);
  if (n === null || n < 0) return null;
  const u = String(unit || "").toLowerCase();
  if (/^(milisecunde|milisecundă|ms)$/.test(u)) return { ms: n };
  if (/^(minute|minut|min)$/.test(u) || (!u && minutesContext)) return { ms: n * 60000 };
  if (/^(cadre|cadru|frames)$/.test(u)) { const frame = Math.round(n); return { ms: framesToMs(frame, fps), frame }; }
  return { ms: Math.round(n * 1000) };
}

/** An amount of time („cu 2 secunde”, „cu 500 ms”, „încă o secundă”, „30 de cadre”) → frames, or null when not stated. */
function parseDuration(clause, fps) {
  const re = new RegExp(`(?:cu|încă|inca|plus)\\s+(${NUM})\\s*(?:de\\s+)?(${UNIT})?(?![${L}])`, "u");
  let m = re.exec(clause);
  if (!m) {
    const alt = new RegExp(`(${NUM})\\s*(?:de\\s+)?(${UNIT})\\s+(?:în plus|in plus|mai mult)`, "u").exec(clause);
    if (alt) m = alt;
  }
  if (!m) return null;
  const n = parseNumber(m[1]);
  if (n === null || n <= 0) return null;
  const unit = (m[2] || "s").toLowerCase();
  if (/^(cadre|cadru|frames)$/.test(unit)) return { frames: Math.round(n), ms: framesToMs(Math.round(n), fps), stated: `${n} cadre` };
  const ms = /^(milisecunde|milisecundă|ms)$/.test(unit) ? n : /^(minute|minut|min)$/.test(unit) ? n * 60000 : n * 1000;
  return { frames: Math.max(1, msToFrames(ms, fps)), ms, stated: m[0].trim() };
}

const fmtSec = (ms) => `${(Math.round(ms / 100) / 10).toString().replace(".", ",")} s`;

/** Quoted strings (« », „ ”, “ ”, " ") → [{ text, index }], and the text with each quote replaced by a placeholder. */
function extractQuotes(text) {
  const quotes = [];
  const re = /«([^»]{1,500})»|„([^”“"]{1,500})[”“"]|“([^”]{1,500})”|"([^"]{1,500})"/gu;
  const masked = text.replace(re, (all, a, b, c, d) => { quotes.push(normalizeRo(a ?? b ?? c ?? d)); return ` qq${quotes.length - 1}qq `; });
  return { quotes, masked };
}

const ACTIONS = [
  { op: "cut", re: word("taie|tăie|tăia|taia|elimină|elimina|scoate|șterge|sterge|decupează") },
  { op: "replace", re: word("schimbă|schimba|înlocuiește|înlocui|inlocuieste|modifică|modifica|corectează|corecta|rescrie") },
  { op: "extend", re: word("ține|tine|ținea|lasă|lasa|prelungește|prelungi|lungește|lungi|extinde|stea|rămână|ramana") },
  { op: "trim", re: word("scurtează|scurta|scurteaza") },
  { op: "move", re: word("mută|muta|mutați|ridică|ridica|urcă|urca|coboară|coborî|coboara|deplasează|deplasa|pune") },
];
const NEGATION = new RegExp(`(?<![${L}])(?:nu|fără să|fara sa)(?![${L}])|(?<![${L}])n-`, "u");
const UP = word("mai sus|în sus|in sus|sus|ridică|ridica|urcă|urca");
const DOWN = word("mai jos|în jos|in jos|jos|coboară|coborî|coboara");
const LEFT = word("la stânga|spre stânga|stânga|la stanga|stanga");
const RIGHT = word("la dreapta|spre dreapta|dreapta");

/** Splits an instruction into clauses (; . „și” „apoi” „iar”), never inside a quote placeholder or a decimal. */
function splitClauses(masked) {
  return masked.split(/;|\.\s+|\.$|,?\s+(?:și|si|apoi|iar|dar|însă|insa|ci|după aceea)\s+(?=[\p{L}])/u).map((s) => s.trim()).filter(Boolean);
}

/** The first point-in-time mentioned in a clause (not a range) → { ms, frame? } or null. */
function timeInClause(clause, fps) {
  // A number is a time only when introduced as one („la …”, „de la …”, „secunda …”, „minutul …”), never a bare amount.
  const intro = new RegExp(`(?<![${L}])(?:la|de la|începând cu|începând de la|incepand cu)\\s+(?:(secunda|sec\\.?|momentul|minutul|timpul)\\s+)?(${TIME})(?![\\d:])\\s*(${UNIT})?(?![${L}])|(?<![${L}])(secunda|minutul|momentul)\\s+(${TIME})(?![\\d:])\\s*(${UNIT})?(?![${L}])`, "u");
  const m = intro.exec(clause);
  if (!m) return null;
  const kind = m[1] || m[4] || "";
  const token = m[2] || m[5];
  const unit = m[3] || m[6] || "";
  return parseTime(token, unit, fps, { minutesContext: kind === "minutul" && !token.includes(":") });
}

/** A time range in a clause („de la 10 la 12”, „între 0:10 și 0:12”, „secundele 10-12”) → { from, to } in ms (+ frames). */
function rangeInClause(clause, fps) {
  const re = new RegExp(`(?:de\\s+la|între|intre|din|secundele|intervalul)\\s+(?:secunda\\s+)?(${TIME})\\s*(${UNIT})?\\s*(?:la|până la|pana la|și|si|-|–)\\s*(?:secunda\\s+)?(${TIME})\\s*(${UNIT})?(?![${L}])`, "u");
  const m = re.exec(clause);
  if (!m) return null;
  const unitA = m[2] || m[4] || "";
  const a = parseTime(m[1], unitA, fps), b = parseTime(m[3], m[4] || unitA, fps);
  if (!a || !b || b.ms <= a.ms) return null;
  return { a, b, text: m[0] };
}

// ---------------------------------------------------------------------------------------------------------------------
// parseInstruction

/** Styles and texts that are transparency (honest labelling), never the content an unqualified "textul" refers to. */
const DISCLOSURE_STYLES = new Set(["label"]);
const DISCLOSURE_TEXT = /^\s*(simulare|simulation|reconstituire|reconstruction|reluare|replay|generat|generated|conținut generat|accelerat|sped up|×\s*\d)/i;
export const isDisclosureItem = (i) => DISCLOSURE_STYLES.has(i?.style) || DISCLOSURE_TEXT.test(String(i?.text || ""));

/**
 * Which text "textul" (no quote, no style word) means when several texts are on screen at the given time (M10 §17).
 * `active` = text items visible at that frame: { id, text, style, start, end, anchor, x, y }. Order:
 *   1. the item the owner has selected now (in THIS version — a selection from another version or project is not here);
 *   2. (quotes are resolved before this function: an unambiguous quote never reaches it)
 *   3. the only CONTENT item on screen — disclosure labels ("SIMULARE · …", "Accelerat ×4") are transparency, never the target;
 *   4. the item last corrected in this same version, if it is still among the content items on screen.
 * Anything else returns null: the owner is asked ONE short question with the options highlighted (the safe default).
 */
export function preferredTextTarget(active, { selectedItemId = null, recentItemId = null } = {}) {
  if (!Array.isArray(active) || !active.length) return null;
  if (selectedItemId) { const selected = active.find((i) => i.id === selectedItemId); if (selected) return selected; }
  const content = active.filter((i) => !isDisclosureItem(i));
  if (content.length === 1) return content[0];
  if (recentItemId) { const recent = content.find((i) => i.id === recentItemId); if (recent) return recent; }
  return null;
}

/**
 * `parseInstruction(text, { ir, atMs, selectedItemId, recentItemId })` → { parserVersion, atMs, atFrame, ops[], clarification, options[],
 * notes[], negated[] }. `selectedItemId` = the text item selected in the Studio for THIS version (ignored, with a note, when it is not in it).
 */
export function parseInstruction(text, { ir = null, atMs = null, selectedItemId = null, recentItemId = null } = {}) {
  if (typeof text !== "string" || !normalizeRo(text)) throw new HubError("validation", "Instrucțiunea de revizuire este goală.", { code: "REVIEW_TEXT_REQUIRED" });
  if (text.length > 2000) throw new HubError("validation", "Instrucțiunea de revizuire depășește 2000 de caractere.", { code: "REVIEW_TEXT_TOO_LONG" });
  const out = { parserVersion: PARSER_VERSION, atMs: null, atFrame: null, ops: [], clarification: null, notes: [], negated: [] };
  const valid = ir && typeof ir === "object" && ir.fps && Array.isArray(ir.tracks);
  const fps = valid ? ir.fps : { num: 30, den: 1 };
  const nir = valid ? normalizeIR(ir) : null;
  const D = nir ? timelineDuration(nir) : 0;
  const { quotes, masked } = extractQuotes(normalizeRo(text));
  const lower = masked.toLocaleLowerCase("ro-RO");
  const clauses = splitClauses(lower);
  let cursorMs = Number.isFinite(atMs) && atMs >= 0 ? atMs : null;
  let cursorFrame = cursorMs !== null ? msToFrames(cursorMs, fps, "floor") : null;
  let lastNoun = null; // "text" | "caption" | "clip"
  const clar = [];
  const optionIds = new Set(); // text items to highlight when the owner is asked which one
  const setTime = (t) => { if (!t) return; cursorMs = t.ms; cursorFrame = Number.isInteger(t.frame) ? t.frame : msToFrames(t.ms, fps, "floor"); if (out.atMs === null) { out.atMs = Math.round(cursorMs); out.atFrame = cursorFrame; } };
  const quoteOf = (clause) => [...clause.matchAll(/qq(\d+)qq/g)].map((m) => quotes[Number(m[1])]).filter(Boolean);

  const textItems = () => (nir ? nir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items) : []);
  const cues = () => (nir ? nir.tracks.filter((t) => t.kind === "captions").flatMap((t) => t.cues) : []);
  const norm = (s) => normalizeRo(s).toLocaleLowerCase("ro-RO");

  // The owner's current selection counts only when it names an item of THIS version (another version / project invalidates it).
  const selected = selectedItemId ? textItems().find((i) => i.id === selectedItemId) || null : null;
  if (selectedItemId && !selected) out.notes.push("Selecția din Studio nu e în versiunea aceasta (s-a schimbat versiunea sau proiectul); am ignorat-o.");

  function textTarget(clause) {
    if (!nir) return { clarification: "Nu am IR-ul editării pentru a identifica textul." };
    const q = quoteOf(clause);
    // 1. an explicit selection wins over an unqualified "textul" (a quote naming ANOTHER text is a contradiction: ask).
    if (selected && !word("hook|hook-ul|titlul de început|cta|cta-ul|îndemnul|indemnul|apelul|eticheta|etichetă|label").test(clause)) {
      if (!q.length || norm(selected.text).includes(norm(q[0]))) { out.notes.push(`Am folosit textul selectat: „${selected.text.slice(0, 40)}”.`); return { item: selected }; }
      optionIds.add(selected.id);
      return { clarification: `Ai selectat „${selected.text.slice(0, 30)}”, dar ai citat „${q[0].slice(0, 30)}”; care dintre ele?`, options: [selected.id] };
    }
    if (q.length) {
      const hits = textItems().filter((i) => norm(i.text).includes(norm(q[0])));
      if (hits.length === 1) return { item: hits[0] };
      if (hits.length > 1) return { clarification: `Textul „${q[0]}” apare în ${hits.length} elemente (${hits.map((h) => h.id).join(", ")}); spune momentul.` };
    }
    let pool = textItems();
    if (word("hook|hook-ul|titlul de început").test(clause)) pool = pool.filter((i) => i.style === "hook");
    else if (word("cta|cta-ul|îndemnul|indemnul|apelul").test(clause)) pool = pool.filter((i) => i.style === "cta");
    else if (word("eticheta|etichetă|label").test(clause)) pool = pool.filter((i) => i.style === "label");
    if (cursorFrame !== null) {
      const active = pool.filter((i) => cursorFrame >= i.start && cursorFrame < i.end);
      if (active.length === 1) return { item: active[0] };
      if (active.length > 1) {
        // "textul" without a quote and several texts on screen: a preference rule may pick one; otherwise the owner is asked.
        const preferred = pool.length === textItems().length ? preferredTextTarget(active, { recentItemId }) : null;
        if (preferred) {
          out.notes.push(`Am ales textul „${preferred.text.slice(0, 40)}” dintre ${active.length} texte de pe ecran; dacă e altul, citează-l sau selectează-l.`);
          return { item: preferred };
        }
        const options = active.filter((i) => !isDisclosureItem(i));
        const shown = options.length ? options : active;
        for (const i of shown) optionIds.add(i.id);
        return { clarification: `La ${fmtSec(cursorMs)} sunt ${shown.length} texte pe ecran (${shown.map((i) => `„${i.text.slice(0, 30)}”`).join(", ")}); spune care (citează-l sau selectează-l).`, options: shown.map((i) => i.id) };
      }
      const near = pool.map((i) => ({ i, d: Math.min(Math.abs(i.start - cursorFrame), Math.abs(i.end - 1 - cursorFrame)) })).filter((x) => x.d <= msToFrames(1000, fps)).sort((a, b) => a.d - b.d);
      if (near.length === 1 || (near.length > 1 && near[0].d < near[1].d)) return { item: near[0].i };
      return { clarification: `La ${fmtSec(cursorMs)} nu este niciun text pe ecran; spune momentul sau citează textul.` };
    }
    if (pool.length === 1) return { item: pool[0] };
    return { clarification: "Spune momentul (de exemplu „la secunda 12”) sau citează textul pe care vrei să-l schimbi." };
  }

  function cueTarget(clause) {
    if (!nir) return { clarification: "Nu am IR-ul editării pentru a identifica subtitrarea." };
    const all = cues();
    if (!all.length) return { clarification: "Editarea nu are subtitrări." };
    if (cursorFrame === null) return { clarification: "Spune momentul subtitrării (de exemplu „de la secunda 5”)." };
    const active = all.filter((c) => cursorFrame >= c.start && cursorFrame < c.end);
    if (active.length) return { cue: active[0] };
    const tol = msToFrames(500, fps);
    const near = all.filter((c) => c.start >= cursorFrame - tol && c.start <= cursorFrame + tol).sort((a, b) => Math.abs(a.start - cursorFrame) - Math.abs(b.start - cursorFrame));
    if (near.length) return { cue: near[0] };
    return { clarification: `La ${fmtSec(cursorMs)} nu este nicio subtitrare.` };
  }

  function clipTarget(clause) {
    if (!nir) return { clarification: "Nu am IR-ul editării pentru a identifica clipul." };
    const clips = primaryVideoTrack(nir)?.clips || [];
    if (cursorFrame !== null) {
      const hit = clipAtFrame(nir, Math.min(cursorFrame, Math.max(0, D - 1)));
      if (hit) return { clip: hit.clip };
    }
    if (word("demonstrația|demonstratia|demo-ul|demo").test(clause)) {
      const demo = (nir.markers || []).filter((m) => m.kind === "demo").sort((a, b) => a.frame - b.frame)[0];
      if (demo) { const hit = clipAtFrame(nir, demo.frame); if (hit) return { clip: hit.clip }; }
    }
    if (clips.length === 1) return { clip: clips[0] };
    return { clarification: "Spune momentul cadrului (de exemplu „la secunda 12”)." };
  }

  for (const clause of clauses) {
    // Time context: a range belongs to cut/remove; otherwise the first point in time moves the cursor.
    const range = rangeInClause(clause, fps);
    const clauseForTime = range ? clause.replace(range.text, " ") : clause;
    setTime(timeInClause(clauseForTime, fps));
    if (word("text|textul|textului|titlul|hook|hook-ul|cta|cta-ul|eticheta|îndemnul").test(clause)) lastNoun = "text";
    if (word("subtitrarea|subtitrare|subtitrările|subtitrarile|subtitrării|subtitlul|captionul").test(clause)) lastNoun = "caption";
    if (word("demonstrația|demonstratia|cadrul|clipul|scena|imaginea|demo-ul").test(clause)) lastNoun = "clip";

    // „ține/lasă/să stea” are a change only with an amount or „mai mult” („lasă textul așa” is not an extension).
    const extendMeant = /mai mult|mai lung|mai multă|în plus|in plus/u.test(clause) || Boolean(parseDuration(clause, fps)) || word("prelungește|prelungi|lungește|lungi|extinde").test(clause);
    const found = ACTIONS.map((a) => ({ ...a, m: a.re.exec(clause) })).filter((a) => a.m && (a.op !== "extend" || extendMeant)).sort((a, b) => a.m.index - b.m.index);
    let action = found[0] || null;
    const direction = word("mai sus|mai jos|la stânga|la dreapta").exec(clause);
    if (!action && direction && (lastNoun === "text" || word("textul").test(clause))) action = { op: "move", m: direction };
    if (!action) {
      // An observation („textul acoperă butonul”) is context, not a change.
      if (/acoper|nu se (vede|citește|citeste|înțelege)|prea (mic|mare|repede|încet)/u.test(clause)) out.notes.push(`Observație: ${clause}.`);
      continue;
    }
    const before = clause.slice(0, action.m.index);
    if (NEGATION.test(before)) { out.negated.push(clause); continue; }

    if (action.op === "cut") {
      const isCaption = word("subtitrarea|subtitrare|subtitrările|subtitrarile|subtitlul|subtitrării").test(clause);
      if (isCaption) {
        if (word("toate").test(clause)) { for (const c of cues()) out.ops.push({ op: "remove_cue", cueId: c.id }); if (!cues().length) clar.push("Editarea nu are subtitrări."); continue; }
        if (range) {
          const f0 = msToFrames(range.a.ms, fps, "floor"), f1 = msToFrames(range.b.ms, fps, "ceil");
          const hits = cues().filter((c) => c.start < f1 && f0 < c.end);
          if (!hits.length) clar.push(`Nu există subtitrări între ${fmtSec(range.a.ms)} și ${fmtSec(range.b.ms)}.`);
          for (const c of hits) out.ops.push({ op: "remove_cue", cueId: c.id });
          continue;
        }
        const t = cueTarget(clause);
        if (t.cue) out.ops.push({ op: "remove_cue", cueId: t.cue.id }); else clar.push(t.clarification);
        continue;
      }
      if (range) {
        const from = Number.isInteger(range.a.frame) ? range.a.frame : msToFrames(range.a.ms, fps);
        const to = Number.isInteger(range.b.frame) ? range.b.frame : msToFrames(range.b.ms, fps);
        if (nir && from >= D) { clar.push(`Intervalul începe după sfârșitul editării (${fmtSec(framesToMs(D, fps))}).`); continue; }
        out.ops.push({ op: "cut_range", from, to: nir ? Math.min(to, D) : to });
        if (out.atMs === null) { out.atMs = Math.round(range.a.ms); out.atFrame = from; }
        continue;
      }
      if (word("textul|text|titlul").test(clause) || lastNoun === "text") { clar.push("Pot șterge textul doar prin înlocuirea lui; spune ce text să apară în loc sau taie intervalul."); continue; }
      clar.push("Spune intervalul de tăiat (de exemplu „taie de la 10 la 12”).");
      continue;
    }

    if (action.op === "replace") {
      const q = quoteOf(clause);
      const isCaption = word("subtitrarea|subtitrare|subtitlul|subtitrării").test(clause);
      if (q.length >= 2) {
        const [from, to] = q;
        const items = textItems().filter((i) => norm(i.text).includes(norm(from)));
        const cueHits = cues().filter((c) => norm(c.text).includes(norm(from)));
        const pick = isCaption ? null : items.length === 1 ? items[0] : null;
        if (pick) { out.ops.push({ op: "replace_text", itemId: pick.id, text: replaceInsensitive(pick.text, from, to) }); continue; }
        if (!isCaption && items.length > 1) { clar.push(`Textul „${from}” apare în ${items.length} elemente; spune momentul.`); continue; }
        if (cueHits.length === 1) { out.ops.push({ op: "edit_cue", cueId: cueHits[0].id, text: replaceInsensitive(cueHits[0].text, from, to) }); continue; }
        if (cueHits.length > 1) {
          const t = cursorFrame !== null ? cueHits.find((c) => cursorFrame >= c.start && cursorFrame < c.end) : null;
          if (t) out.ops.push({ op: "edit_cue", cueId: t.id, text: replaceInsensitive(t.text, from, to) });
          else clar.push(`„${from}” apare în ${cueHits.length} subtitrări; spune momentul.`);
          continue;
        }
        clar.push(`Nu am găsit „${from}” în textele sau subtitrările editării.`);
        continue;
      }
      if (q.length === 1) {
        if (isCaption || lastNoun === "caption") { const t = cueTarget(clause); if (t.cue) out.ops.push({ op: "edit_cue", cueId: t.cue.id, text: q[0] }); else clar.push(t.clarification); continue; }
        const t = textTarget(clause.replace(/qq\d+qq/, ""));
        if (t.item) out.ops.push({ op: "replace_text", itemId: t.item.id, text: q[0] }); else clar.push(t.clarification);
        continue;
      }
      clar.push("Pune textul nou între ghilimele (de exemplu: schimbă textul «Raport» în «Raport lunar»).");
      continue;
    }

    if (action.op === "extend" || action.op === "trim") {
      const t = clipTarget(clause);
      if (!t.clip) { clar.push(t.clarification); continue; }
      const amount = parseDuration(clause, fps);
      const ms = amount ? amount.ms : action.op === "extend" ? DEFAULTS.extendMs : DEFAULTS.trimMs;
      const frames = amount ? amount.frames : Math.max(1, msToFrames(ms, fps));
      if (!amount) out.notes.push(`propunere: ${fmtSec(ms)} (${action.op === "extend" ? "prelungire" : "scurtare"} nespecificată; confirmă sau spune durata).`);
      out.ops.push(action.op === "extend" ? { op: "extend_clip", clipId: t.clip.id, frames } : { op: "trim_clip", clipId: t.clip.id, frames, from: word("de la început|de la inceput|începutul|inceputul").test(clause) ? "start" : "end" });
      continue;
    }

    if (action.op === "move") {
      if ((lastNoun === "caption" && !word("textul|text|titlul").test(clause)) || word("subtitrarea|subtitrările|subtitrarile").test(clause)) {
        clar.push("Poziția subtitrărilor vine din zona sigură a platformei (profilul variantei); pot muta doar textele de pe ecran.");
        continue;
      }
      const t = textTarget(clause);
      if (!t.item) { clar.push(t.clarification); continue; }
      let dx = 0, dy = 0;
      const pct = /cu\s+(\d+(?:[.,]\d+)?)\s*(%|la sută|procente)/u.exec(clause);
      const px = /cu\s+(\d+)\s*(px|pixeli)/u.exec(clause);
      let mag = DEFAULTS.moveFraction, stated = false;
      if (pct) { mag = parseNumber(pct[1]) / 100; stated = true; }
      else if (/puțin|putin|un pic|ușor|usor/u.test(clause)) { mag = DEFAULTS.moveSmall; stated = true; }
      else if (word("mult|mult mai").test(clause)) { mag = DEFAULTS.moveLarge; stated = true; }
      const up = UP.test(clause), down = DOWN.test(clause), left = LEFT.test(clause), right = RIGHT.test(clause);
      if (!up && !down && !left && !right) { clar.push("Spune direcția (mai sus, mai jos, la stânga sau la dreapta)."); continue; }
      if (px && nir) { const n = Number(px[1]); stated = true; if (up || down) dy = n / nir.canvas.height; if (left || right) dx = n / nir.canvas.width; }
      else { if (up || down) dy = mag; if (left || right) dx = mag; }
      if (up) dy = -Math.abs(dy); if (down) dy = Math.abs(dy); if (left) dx = -Math.abs(dx); if (right) dx = Math.abs(dx);
      if (!stated) out.notes.push(`propunere: ${Math.round(DEFAULTS.moveFraction * 100)}% din ${up || down ? "înălțimea" : "lățimea"} cadrului (distanță nespecificată; confirmă sau spune cât).`);
      out.ops.push({ op: "move_text", itemId: t.item.id, dx: round4(dx), dy: round4(dy) });
      continue;
    }
  }
  if (out.atMs === null && cursorMs !== null) { out.atMs = Math.round(cursorMs); out.atFrame = cursorFrame; }
  if (clar.length) out.clarification = [...new Set(clar)].join(" ");
  else if (!out.ops.length) {
    out.clarification = out.negated.length
      ? "Ai cerut doar ce să nu se schimbe; nu propun nicio modificare. Ce vrei să schimb?"
      : "Nu am identificat o modificare concretă. Spune ce să schimb (de exemplu „mută textul mai sus”, „taie de la 10 la 12”).";
  }
  out.options = clar.length ? [...optionIds] : [];
  return out;
}

const round4 = (v) => Math.round(v * 10000) / 10000;
function replaceInsensitive(source, from, to) {
  const s = normalizeRo(source);
  const i = s.toLocaleLowerCase("ro-RO").indexOf(normalizeRo(from).toLocaleLowerCase("ro-RO"));
  if (i < 0) return normalizeRo(to);
  return normalizeRo(`${s.slice(0, i)}${to}${s.slice(i + normalizeRo(from).length)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// applyOps (pure)

const opError = (message, data) => new HubError("validation", message, { code: "PATCH_INVALID", data });
const isInt = (v) => Number.isInteger(v);

function allIds(ir) {
  const used = new Set();
  for (const t of ir.tracks) { used.add(t.id); for (const x of [...(t.clips || []), ...(t.items || []), ...(t.cues || [])]) used.add(x.id); }
  return used;
}
function freshId(ir, base) {
  const used = allIds(ir);
  const stem = `${base}`.slice(0, 56);
  for (let i = 1; i < 10000; i += 1) { const id = `${stem}_${i === 1 ? "b" : `b${i}`}`; if (!used.has(id)) return id; }
  throw new HubError("internal", "Nu s-a putut genera un id unic.");
}
/** Source frames for `n` timeline frames at `speed` such that clipDuration gives exactly `n` back. */
function sourceLen(n, speed) {
  let len = Math.max(1, Math.round(n * speed));
  for (let k = 0; k < 4 && Math.round(len / speed) !== n; k += 1) len += Math.round(len / speed) > n ? -1 : 1;
  return Math.max(1, len);
}
/** Re-lays the primary clips contiguously (next.start = prev.start + duration − transition). */
function relayout(track) {
  let end = 0;
  track.clips.forEach((c, i) => {
    if (i === 0) c.start = 0;
    else c.start = end - (c.transitionIn?.frames || 0);
    end = c.start + clipDuration(c);
  });
}
const subFrames = (list, lo, hi, field = "frame") => (list || []).filter((k) => k[field] >= lo && k[field] < hi).map((k) => ({ ...k, [field]: k[field] - lo }));

/** [a, b) with [from, to) removed and the gap closed; null when nothing is left. */
function cutInterval(a, b, from, to) {
  const len = to - from;
  if (b <= from) return { a, b };
  if (a >= to) return { a: a - len, b: b - len };
  const na = a < from ? a : from;
  const nb = b > to ? b - len : from;
  return nb > na ? { a: na, b: nb } : null;
}
/** [a, b) with `delta` frames inserted at P. `attachEnd` extends an interval that ends exactly at P. */
function insertInterval(a, b, P, delta, attachEnd = false) {
  if (a >= P) return { a: a + delta, b: b + delta };
  if (b > P || (attachEnd && b === P)) return { a, b: b + delta };
  return { a, b };
}

function cutRange(ir, from, to) {
  if (!isInt(from) || !isInt(to) || from < 0 || to <= from) throw opError("cut_range: intervalul trebuie să fie în cadre întregi, cu to > from ≥ 0.");
  const D = timelineDuration(ir);
  if (from >= D) throw opError(`cut_range: intervalul începe după sfârșitul editării (${D} cadre).`);
  to = Math.min(to, D);
  if (from === 0 && to >= D) throw opError("cut_range: nu se poate tăia toată editarea.");
  const len = to - from;
  const track = primaryVideoTrack(ir);
  for (const c of track.clips) {
    const t = c.transitionIn?.frames || 0;
    if (t && c.start < to && from < c.start + t) throw opError(`cut_range: intervalul atinge tranziția clipului „${c.id}”; alege un interval fără tranziție.`, { clipId: c.id });
  }
  const out = [];
  for (const clip of track.clips) {
    const s = clip.start, e = s + clipDuration(clip), sp = clip.speed ?? 1;
    if (e <= from) { out.push(clip); continue; }
    if (s >= to) { out.push(clip); continue; }
    if (s >= from && e <= to) continue; // removed entirely
    if (s < from && e > to) {
      const aLen = from - s, bSkip = to - s;
      const a = { ...clip, sourceOut: clip.sourceIn + sourceLen(aLen, sp), keyframes: subFrames(clip.keyframes, 0, aLen) };
      const bIn = clip.sourceIn + Math.round(bSkip * sp);
      const b = { ...clip, id: freshId({ tracks: [...ir.tracks, { id: "_", clips: out }] }, clip.id), sourceIn: bIn, transitionIn: null, keyframes: subFrames(clip.keyframes, bSkip, e - s) };
      out.push(a, b);
      continue;
    }
    if (s < from) { out.push({ ...clip, sourceOut: clip.sourceIn + sourceLen(from - s, sp), keyframes: subFrames(clip.keyframes, 0, from - s) }); continue; }
    // head cut: s ∈ [from, to), e > to
    out.push({ ...clip, sourceIn: clip.sourceIn + Math.round((to - s) * sp), keyframes: subFrames(clip.keyframes, to - s, e - s) });
  }
  if (!out.length) throw opError("cut_range: tăietura ar lăsa editarea fără clipuri.");
  track.clips = out;
  relayout(track);
  // Audio: same cut at speed 1 (middle cuts split the clip).
  for (const t of ir.tracks.filter((x) => x.kind === "audio")) {
    const next = [];
    for (const c of t.clips) {
      const s = c.start, e = s + (c.sourceOut - c.sourceIn);
      const fit = (x) => { const d = x.sourceOut - x.sourceIn; return { ...x, fadeIn: Math.min(x.fadeIn || 0, d), fadeOut: Math.min(x.fadeOut || 0, Math.max(0, d - Math.min(x.fadeIn || 0, d))) }; };
      if (e <= from) next.push(c);
      else if (s >= to) next.push({ ...c, start: s - len });
      else if (s >= from && e <= to) continue;
      else if (s < from && e > to) {
        next.push(fit({ ...c, sourceOut: c.sourceIn + (from - s), fadeOut: 0, envelope: subFrames(c.envelope, 0, from - s) }));
        next.push(fit({ ...c, id: freshId(ir, c.id), start: from, sourceIn: c.sourceIn + (to - s), fadeIn: 0, envelope: subFrames(c.envelope, to - s, e - s) }));
      } else if (s < from) next.push(fit({ ...c, sourceOut: c.sourceIn + (from - s), envelope: subFrames(c.envelope, 0, from - s) }));
      else next.push(fit({ ...c, start: from, sourceIn: c.sourceIn + (to - s), envelope: subFrames(c.envelope, to - s, e - s) }));
    }
    t.clips = next;
  }
  for (const t of ir.tracks) {
    if (t.kind === "text") t.items = t.items.map((i) => { const r = cutInterval(i.start, i.end, from, to); return r ? { ...i, start: r.a, end: r.b } : null; }).filter(Boolean);
    if (t.kind === "captions") t.cues = t.cues.map((q) => { const r = cutInterval(q.start, q.end, from, to); return r ? { ...q, start: r.a, end: r.b } : null; }).filter(Boolean);
  }
  ir.markers = (ir.markers || []).filter((m) => m.frame < from || m.frame >= to).map((m) => (m.frame >= to ? { ...m, frame: m.frame - len } : m));
  // Evidence: cut, then re-attached to the clip(s) that now show it (a split clip may carry part of a region).
  const clips = track.clips;
  const ev = [];
  for (const r of ir.evidenceRegions || []) {
    const c = cutInterval(r.from, r.to, from, to);
    if (!c) continue;
    const owner = clips.filter((k) => k.id === r.clipId || k.id.startsWith(`${r.clipId}_b`));
    const pool = owner.length ? owner : clips;
    for (const k of pool) {
      const ks = k.start, ke = ks + clipDuration(k);
      const a = Math.max(c.a, ks), b = Math.min(c.b, ke);
      if (b > a) ev.push({ ...r, clipId: k.id, from: a, to: b });
    }
  }
  ir.evidenceRegions = ev;
}

function extendClip(ir, clipId, frames) {
  if (!isInt(frames) || frames < 1 || frames > LIMIT_EXTEND) throw opError(`extend_clip: numărul de cadre trebuie să fie între 1 și ${LIMIT_EXTEND}.`);
  const track = primaryVideoTrack(ir);
  const idx = track.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) throw opError(`extend_clip: clipul „${clipId}” nu există pe pista video principală.`, { clipId });
  const clip = track.clips[idx];
  const oldDur = clipDuration(clip);
  const tNext = track.clips[idx + 1]?.transitionIn?.frames || 0;
  const P = clip.start + oldDur - tNext;
  const sp = clip.speed ?? 1;
  clip.sourceOut = clip.sourceIn + sourceLen(oldDur + frames, sp);
  const delta = clipDuration(clip) - oldDur;
  relayout(track);
  for (const t of ir.tracks) {
    if (t.kind === "text") t.items = t.items.map((i) => { const r = insertInterval(i.start, i.end, P, delta, i.start >= clip.start); return { ...i, start: r.a, end: r.b }; });
    if (t.kind === "captions") t.cues = t.cues.map((q) => { const r = insertInterval(q.start, q.end, P, delta, false); return { ...q, start: r.a, end: r.b }; });
    if (t.kind === "audio") t.clips = t.clips.map((a) => (a.start >= P ? { ...a, start: a.start + delta } : a));
  }
  ir.markers = (ir.markers || []).map((m) => (m.frame >= P ? { ...m, frame: m.frame + delta } : m));
  ir.evidenceRegions = (ir.evidenceRegions || []).map((r) => { const x = insertInterval(r.from, r.to, P, delta, false); return { ...r, from: x.a, to: x.b }; });
}
const LIMIT_EXTEND = 10 * 60 * 120;

function findItem(ir, itemId) {
  for (const t of ir.tracks) if (t.kind === "text") { const item = t.items.find((i) => i.id === itemId); if (item) return item; }
  return null;
}
function findCue(ir, cueId) {
  for (const t of ir.tracks) if (t.kind === "captions") { const i = t.cues.findIndex((c) => c.id === cueId); if (i >= 0) return { track: t, index: i }; }
  return null;
}
function cleanText(text, label) {
  if (typeof text !== "string") throw opError(`${label}: textul lipsește.`);
  const t = normalizeRo(text);
  if (!t || t.length > 500) throw opError(`${label}: textul trebuie să aibă între 1 și 500 de caractere.`);
  return t;
}

/** Applies patch operations to a copy of `ir` (pure). Throws PATCH_INVALID for an operation that cannot apply. */
export function applyOps(ir, ops) {
  if (!ir || typeof ir !== "object" || !Array.isArray(ir.tracks)) throw opError("applyOps: IR invalid.");
  if (!Array.isArray(ops) || !ops.length || ops.length > 50) throw opError("applyOps: lista de operații trebuie să aibă între 1 și 50 de elemente.");
  const out = normalizeIR(ir);
  ops.forEach((op, n) => {
    if (!op || typeof op !== "object" || !REVIEW_OPS.includes(op.op)) throw opError(`Operația ${n + 1} nu este suportată (permise: ${REVIEW_OPS.join(", ")}).`);
    switch (op.op) {
      case "move_text": {
        const item = findItem(out, op.itemId);
        if (!item) throw opError(`move_text: textul „${op.itemId}” nu există.`, { itemId: op.itemId });
        const dx = Number(op.dx ?? 0), dy = Number(op.dy ?? 0);
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1) throw opError("move_text: dx/dy trebuie să fie fracțiuni ale cadrului între −1 și 1.");
        item.x = round4(Math.min(1, Math.max(0, item.x + dx)));
        item.y = round4(Math.min(1, Math.max(0, item.y + dy)));
        break;
      }
      case "extend_clip": extendClip(out, op.clipId, op.frames); break;
      case "trim_clip": {
        const track = primaryVideoTrack(out);
        const idx = track.clips.findIndex((c) => c.id === op.clipId);
        if (idx < 0) throw opError(`trim_clip: clipul „${op.clipId}” nu există.`, { clipId: op.clipId });
        if (!isInt(op.frames) || op.frames < 1) throw opError("trim_clip: numărul de cadre trebuie să fie un întreg pozitiv.");
        const c = track.clips[idx];
        const tIn = c.transitionIn?.frames || 0, tNext = track.clips[idx + 1]?.transitionIn?.frames || 0;
        const lo = c.start + tIn, hi = c.start + clipDuration(c) - tNext;
        if (hi - lo - op.frames < 1) throw opError(`trim_clip: clipul „${c.id}” are doar ${Math.max(0, hi - lo)} cadre fără tranziții; nu se poate scurta cu ${op.frames}.`);
        if (op.from === "start") cutRange(out, lo, lo + op.frames); else cutRange(out, hi - op.frames, hi);
        break;
      }
      case "replace_text": {
        const item = findItem(out, op.itemId);
        if (!item) throw opError(`replace_text: textul „${op.itemId}” nu există.`, { itemId: op.itemId });
        item.text = cleanText(op.text, "replace_text");
        break;
      }
      case "remove_cue": {
        const hit = findCue(out, op.cueId);
        if (!hit) throw opError(`remove_cue: subtitrarea „${op.cueId}” nu există.`, { cueId: op.cueId });
        hit.track.cues.splice(hit.index, 1);
        break;
      }
      case "edit_cue": {
        const hit = findCue(out, op.cueId);
        if (!hit) throw opError(`edit_cue: subtitrarea „${op.cueId}” nu există.`, { cueId: op.cueId });
        hit.track.cues[hit.index] = { ...hit.track.cues[hit.index], text: cleanText(op.text, "edit_cue") };
        break;
      }
      case "cut_range": cutRange(out, op.from, op.to); break;
      default: throw opError(`Operație necunoscută: ${op.op}.`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// diffIR (pure)

const KIND_LABEL = { clip: "Clip", text: "Text", cue: "Subtitrare", audio: "Clip audio", marker: "Marker", evidence: "Dovadă", top: "Proiect" };

/** Structured diff: duration delta, and per element (by id) added/removed/modified with the changed fields. */
export function diffIR(a, b) {
  const A = normalizeIR(a), B = normalizeIR(b);
  const fps = B?.fps || A?.fps || { num: 30, den: 1 };
  const dA = timelineDuration(A), dB = timelineDuration(B);
  const changes = [];
  const same = (x, y) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(y));
  const byId = (ir, kind) => {
    const m = new Map();
    for (const t of ir?.tracks || []) {
      if (kind === "clip" && t.kind === "video") for (const c of t.clips) m.set(c.id, c);
      if (kind === "text" && t.kind === "text") for (const i of t.items) m.set(i.id, { ...i, trackId: t.id });
      if (kind === "cue" && t.kind === "captions") for (const q of t.cues) m.set(q.id, q);
      if (kind === "audio" && t.kind === "audio") for (const c of t.clips) m.set(c.id, { ...c, trackId: t.id });
    }
    return m;
  };
  for (const kind of ["clip", "text", "cue", "audio"]) {
    const ma = byId(A, kind), mb = byId(B, kind);
    for (const [id, x] of ma) {
      if (!mb.has(id)) { changes.push({ kind, id, change: "removed", before: x }); continue; }
      const y = mb.get(id);
      const fields = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[k], y[k])) fields[k] = { before: x[k], after: y[k] };
      if (Object.keys(fields).length) changes.push({ kind, id, change: "modified", fields });
    }
    for (const [id, y] of mb) if (!ma.has(id)) changes.push({ kind, id, change: "added", after: y });
  }
  const listDiff = (kind, la, lb, key) => {
    const ka = new Map((la || []).map((x) => [key(x), x])), kb = new Map((lb || []).map((x) => [key(x), x]));
    for (const [k, x] of ka) if (!kb.has(k)) changes.push({ kind, id: k, change: "removed", before: x });
    for (const [k, y] of kb) if (!ka.has(k)) changes.push({ kind, id: k, change: "added", after: y });
  };
  listDiff("marker", A?.markers, B?.markers, (m) => `${m.kind}@${m.frame}`);
  listDiff("evidence", A?.evidenceRegions, B?.evidenceRegions, (r) => `${r.clipId}:${r.from}-${r.to}:${JSON.stringify(sortKeys(r.rect))}`);
  for (const k of ["canvas", "fps", "preset", "language", "loudness", "meta"]) if (!same(A?.[k], B?.[k])) changes.push({ kind: "top", id: k, change: "modified", fields: { [k]: { before: A?.[k], after: B?.[k] } } });
  const msA = Math.round(framesToMs(dA, fps)), msB = Math.round(framesToMs(dB, fps));
  const summary = [];
  if (dA !== dB) summary.push(`Durata: ${fmtSec(msA)} → ${fmtSec(msB)} (${dB > dA ? "+" : "−"}${fmtSec(Math.abs(msB - msA))}).`);
  for (const c of changes) {
    const label = KIND_LABEL[c.kind] || c.kind;
    if (c.change === "added") summary.push(`${label} „${c.id}” adăugat.`);
    else if (c.change === "removed") summary.push(`${label} „${c.id}” eliminat.`);
    else summary.push(`${label} „${c.id}”: ${Object.keys(c.fields).join(", ")} modificat.`);
  }
  return {
    durationFrames: { before: dA, after: dB, delta: dB - dA },
    durationMs: { before: msA, after: msB, delta: msB - msA },
    timecode: { before: framesToTimecode(dA, fps), after: framesToTimecode(dB, fps) },
    changes, counts: { added: changes.filter((c) => c.change === "added").length, removed: changes.filter((c) => c.change === "removed").length, modified: changes.filter((c) => c.change === "modified").length },
    summary: summary.slice(0, 200),
  };
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortKeys(v[k]); return o; }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Edit versions (shared by reviews, variants and divergences)

const mapVersion = (r) => r && ({ id: r.id, editProjectId: r.edit_project_id, version: r.version, irSha256: r.ir_sha256, parentVersionId: r.parent_version_id,
  changeKind: r.change_kind, change: parse(r.change_json, {}), validation: parse(r.validation_json, {}), variantKey: r.variant_key, createdBy: r.created_by, createdAt: r.created_at });

/**
 * Inserts a new edit version (version = max + 1) with its canonical IR and sha256, and a `media.edit.version_created` event.
 * Variant versions (variantKey set) do not move the project's main-line `current_version`. Joins the caller's transaction.
 */
export function insertEditVersion(db, bus, clock, { editProjectId, parentVersionId = null, ir, changeKind, change = {}, validation = {}, variantKey = null, actor }) {
  if (!["initial", "patch", "variant", "manual_divergence", "import"].includes(changeKind)) throw new HubError("validation", `Tip de versiune necunoscut: ${changeKind}.`, { code: "FIELD_INVALID" });
  return bus.transaction(() => {
    const project = db.prepare("SELECT * FROM media_edit_projects WHERE id = ?").get(String(editProjectId || ""));
    if (!project) throw new HubError("not_found", "Proiectul de editare nu există.", { code: "EDIT_PROJECT_MISSING" });
    const version = Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM media_edit_versions WHERE edit_project_id = ?").get(project.id).v) + 1;
    const id = newId("mev");
    const at = clock().toISOString();
    const sha = irHash(ir);
    db.prepare(`INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, parent_version_id, change_kind, change_json, validation_json, variant_key, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, project.id, version, canonicalIR(ir), sha, parentVersionId, changeKind, json(change), json(validation), variantKey, actor, at);
    if (variantKey) db.prepare("UPDATE media_edit_projects SET updated_at = ? WHERE id = ?").run(at, project.id);
    else db.prepare("UPDATE media_edit_projects SET current_version = ?, updated_at = ? WHERE id = ?").run(version, at, project.id);
    bus.append({ type: "media.edit.version_created", scopeType: "media_edit_project", scopeId: project.id, source: actor,
      payload: { editVersionId: id, version, changeKind, parentVersionId, irSha256: sha, variantKey } });
    return mapVersion(db.prepare("SELECT * FROM media_edit_versions WHERE id = ?").get(id));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// createReviews

const PROVENANCE_RE = /^[a-z][a-z0-9_.:-]{1,40}$/;

/**
 * `createReviews({ db, bus, clock, assets, presets })` → { propose, apply, decide, recordManualDivergence, get, list }.
 */
export function createReviews({ db, bus, clock = () => new Date(), assets = null, presets = PRESETS }) {
  if (!db || !bus) throw new Error("createReviews requires db and bus");
  const now = () => clock().toISOString();
  const getVersion = typeof assets?.getVersion === "function" ? (id) => assets.getVersion(id) : undefined;
  const validate = (ir) => validateIR(ir, { getVersion, presets });

  const mapReview = (r) => r && ({ id: r.id, editVersionId: r.edit_version_id, kind: r.kind, timecodeMs: r.timecode_ms, text: r.text, patch: parse(r.patch_json, {}),
    status: r.status, resultVersionId: r.result_version_id, provenance: r.provenance, actor: r.actor, sessionId: r.session_id, createdAt: r.created_at, updatedAt: r.updated_at });
  const selReview = db.prepare("SELECT * FROM media_reviews WHERE id = ?");
  const selVersion = db.prepare("SELECT * FROM media_edit_versions WHERE id = ?");
  const insReview = db.prepare(`INSERT INTO media_reviews (id, edit_version_id, kind, timecode_ms, text, patch_json, status, result_version_id, provenance, actor, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const requireActor = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };
  const optionalSession = (s) => {
    if (s === undefined || s === null || s === "") return null;
    if (typeof s !== "string" || s.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(s)) throw new HubError("validation", "Identificator de sesiune invalid.", { code: "FIELD_INVALID" });
    return s;
  };
  function loadVersion(editVersionId) {
    const row = selVersion.get(String(editVersionId || ""));
    if (!row) throw new HubError("not_found", "Versiunea de editare nu există.", { code: "EDIT_VERSION_MISSING" });
    const ir = parse(row.ir_json, null);
    if (!ir || irHash(ir) !== row.ir_sha256) throw new HubError("conflict", "IR-ul versiunii nu corespunde amprentei sale (sha256); versiunea nu este folosită.", { code: "EDIT_VERSION_TAMPERED" });
    return { row, ir };
  }

  /** Records a proposal (row OPEN with the patch and a diff preview). Nothing is applied. */
  /** The text item last corrected on this version line (the change that produced it, or a recent proposal on it): context preference. */
  function recentTextItem(row) {
    const fromChange = (parse(row.change_json, {}).ops || []).find((o) => o.itemId)?.itemId;
    if (fromChange) return fromChange;
    for (const r of db.prepare("SELECT patch_json FROM media_reviews WHERE edit_version_id = ? ORDER BY created_at DESC LIMIT 5").all(row.id)) {
      const id = (parse(r.patch_json, {}).ops || []).find((o) => o.itemId)?.itemId;
      if (id) return id;
    }
    return null;
  }

  function propose({ editVersionId, text, timecodeMs = null, provenance, actor, sessionId = null, selectedItemId = null } = {}) {
    const who = requireActor(actor);
    if (typeof provenance !== "string" || !PROVENANCE_RE.test(provenance)) throw new HubError("validation", "Proveniența revizuirii este obligatorie (de exemplu owner_ui, lega).", { code: "FIELD_INVALID" });
    if (timecodeMs !== null && timecodeMs !== undefined && (typeof timecodeMs !== "number" || !Number.isFinite(timecodeMs) || timecodeMs < 0)) throw new HubError("validation", "Momentul (ms) trebuie să fie un număr pozitiv.", { code: "FIELD_INVALID" });
    const session = optionalSession(sessionId);
    const { row, ir } = loadVersion(editVersionId);
    const parsed = parseInstruction(text, { ir, atMs: timecodeMs ?? null, selectedItemId: selectedItemId || null, recentItemId: recentTextItem(row) });
    let preview = null;
    if (parsed.ops.length) {
      try {
        const next = applyOps(ir, parsed.ops);
        const v = validate(next);
        preview = { valid: v.ok, errors: v.errors.slice(0, 10), warnings: v.warnings.length, diff: diffIR(ir, next) };
      } catch (error) {
        preview = { valid: false, errors: [{ path: "", code: error?.code || "PATCH_INVALID", message: error?.message || String(error) }], diff: null };
      }
    }
    const id = newId("mrv");
    const at = now();
    const kind = parsed.ops.length ? "CHANGES_REQUESTED" : "COMMENT";
    const patch = { parserVersion: parsed.parserVersion, ops: parsed.ops, clarification: parsed.clarification, options: parsed.options || [], selectedItemId: selectedItemId || null, notes: parsed.notes, negated: parsed.negated,
      atMs: parsed.atMs, atFrame: parsed.atFrame, baseIrSha256: row.ir_sha256, preview };
    const tc = parsed.atMs ?? (timecodeMs !== null && timecodeMs !== undefined ? Math.round(timecodeMs) : null);
    bus.transaction(() => {
      insReview.run(id, row.id, kind, tc, normalizeRo(text).slice(0, 2000), json(patch), "OPEN", null, provenance, who, session, at, at);
      bus.append({ type: "media.review.proposed", scopeType: "media_review", scopeId: id, source: who,
        payload: { reviewId: id, editVersionId: row.id, kind, ops: parsed.ops.map((o) => o.op), clarification: Boolean(parsed.clarification), provenance, previewValid: preview?.valid ?? null } });
    });
    return mapReview(selReview.get(id));
  }

  /** Applies an OPEN proposal as a NEW validated edit version (change_kind "patch"); the original version is never changed. */
  function apply({ reviewId, actor } = {}) {
    const who = requireActor(actor);
    const review = selReview.get(String(reviewId || ""));
    if (!review) throw new HubError("not_found", "Revizuirea nu există.", { code: "REVIEW_MISSING" });
    if (review.status === "APPLIED") return { review: mapReview(review), version: mapVersion(selVersion.get(review.result_version_id)), alreadyApplied: true };
    if (review.status !== "OPEN") throw new HubError("conflict", `Revizuirea are starea ${review.status} și nu mai poate fi aplicată.`, { code: "REVIEW_NOT_OPEN" });
    const patch = parse(review.patch_json, {});
    if (!Array.isArray(patch.ops) || !patch.ops.length) throw new HubError("validation", "Revizuirea nu conține modificări aplicabile (doar comentariu sau clarificare).", { code: "REVIEW_NO_OPS" });
    const { row, ir } = loadVersion(review.edit_version_id);
    if (patch.baseIrSha256 && patch.baseIrSha256 !== row.ir_sha256) throw new HubError("conflict", "Versiunea de bază s-a schimbat față de propunere.", { code: "REVIEW_BASE_CHANGED" });
    const newer = db.prepare("SELECT version FROM media_edit_versions WHERE parent_version_id = ? AND change_kind IN ('patch','manual_divergence') ORDER BY version DESC LIMIT 1").get(row.id);
    if (newer) throw new HubError("conflict", `Versiunea v${row.version} a fost deja modificată (v${newer.version}); propune din nou pe ultima versiune.`, { code: "REVIEW_STALE" });
    const next = applyOps(ir, patch.ops);
    const v = validate(next);
    if (!v.ok) {
      const first = v.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
      throw new HubError("validation", `Modificarea ar produce un IR invalid (${v.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: v.errors.slice(0, 50) } });
    }
    const diff = diffIR(ir, v.ir);
    return bus.transaction(() => {
      const fresh = selReview.get(review.id);
      if (fresh.status !== "OPEN") throw new HubError("conflict", "Revizuirea a fost deja procesată.", { code: "REVIEW_NOT_OPEN" });
      const version = insertEditVersion(db, bus, clock, { editProjectId: row.edit_project_id, parentVersionId: row.id, ir: v.ir, changeKind: "patch",
        change: { reviewId: review.id, ops: patch.ops, diff: { durationFrames: diff.durationFrames, counts: diff.counts, summary: diff.summary } },
        validation: { ok: true, warnings: v.warnings.slice(0, 50), durationFrames: v.durationFrames }, variantKey: row.variant_key || null, actor: who });
      const at = now();
      db.prepare("UPDATE media_reviews SET status = 'APPLIED', result_version_id = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'").run(version.id, at, review.id);
      // A correction of a platform variant moves the variant to the corrected version (DRAFT again: it must be rendered and
      // QA'd before a manifest can use it); otherwise distribution would keep packing the uncorrected render.
      if (row.variant_key) {
        const moved = db.prepare("UPDATE media_variants SET variant_version_id = ?, status = 'DRAFT', updated_at = ? WHERE variant_version_id = ?").run(version.id, at, row.id);
        if (moved.changes) bus.append({ type: "media.variant.corrected", scopeType: "media_edit_project", scopeId: row.edit_project_id, source: who,
          payload: { fromVersionId: row.id, toVersionId: version.id, reviewId: review.id } });
      }
      bus.append({ type: "media.review.applied", scopeType: "media_review", scopeId: review.id, source: who,
        payload: { reviewId: review.id, baseVersionId: row.id, resultVersionId: version.id, durationDelta: diff.durationFrames.delta, changes: diff.counts } });
      return { review: mapReview(selReview.get(review.id)), version, diff, alreadyApplied: false };
    });
  }

  /** Dismisses an OPEN proposal (nothing changes). */
  function dismiss({ reviewId, actor, reason = "" } = {}) {
    const who = requireActor(actor);
    return bus.transaction(() => {
      const review = selReview.get(String(reviewId || ""));
      if (!review) throw new HubError("not_found", "Revizuirea nu există.", { code: "REVIEW_MISSING" });
      if (review.status !== "OPEN") throw new HubError("conflict", `Revizuirea are starea ${review.status}.`, { code: "REVIEW_NOT_OPEN" });
      db.prepare("UPDATE media_reviews SET status = 'DISMISSED', updated_at = ? WHERE id = ?").run(now(), review.id);
      bus.append({ type: "media.review.dismissed", scopeType: "media_review", scopeId: review.id, source: who, payload: { reviewId: review.id, reason: String(reason || "").slice(0, 300) } });
      return mapReview(selReview.get(review.id));
    });
  }

  /**
   * Records an owner decision on an edit version. CREATIVE_APPROVED is enforced to the owner channel by the command layer; here it
   * additionally requires the owner session id and refuses a non-owner channel, so it can never be fabricated by another path.
   */
  function decide({ editVersionId, kind, actor, sessionId = null, note = "", channel = null } = {}) {
    const who = requireActor(actor);
    if (!REVIEW_KINDS.includes(kind)) throw new HubError("validation", `Tip de decizie necunoscut: ${String(kind).slice(0, 30)} (permise: ${REVIEW_KINDS.join(", ")}).`, { code: "FIELD_INVALID" });
    const session = optionalSession(sessionId);
    if (kind === "CREATIVE_APPROVED") {
      if (!session) throw new HubError("policy", "Aprobarea creativă se înregistrează doar din sesiunea proprietarului.", { code: "CREATIVE_APPROVAL_OWNER_ONLY" });
      if (channel !== null && !["owner", "test"].includes(channel)) throw new HubError("policy", "Aprobarea creativă nu poate veni din acest canal.", { code: "CREATIVE_APPROVAL_OWNER_ONLY" });
    }
    if (typeof note !== "string" || note.length > 2000) throw new HubError("validation", "Nota deciziei trebuie să fie text de cel mult 2000 de caractere.", { code: "FIELD_INVALID" });
    const { row } = loadVersion(editVersionId);
    const qa = db.prepare("SELECT kind, status, created_at FROM media_qa_reports WHERE edit_version_id = ? ORDER BY created_at DESC, rowid DESC").all(row.id);
    const latest = {};
    for (const q of qa) if (!(q.kind in latest)) latest[q.kind] = q.status;
    const id = newId("mrv");
    const at = now();
    const provenance = kind === "CREATIVE_APPROVED" ? "owner_session" : channel && PROVENANCE_RE.test(channel) ? channel : "ui";
    bus.transaction(() => {
      insReview.run(id, row.id, kind, null, normalizeRo(note), json({ irSha256: row.ir_sha256, qa: latest }), "RECORDED", null, provenance, who, session, at, at);
      bus.append({ type: "media.review.decided", scopeType: "media_review", scopeId: id, source: who, payload: { reviewId: id, editVersionId: row.id, kind, irSha256: row.ir_sha256, qa: latest, sessionId: session } });
    });
    return mapReview(selReview.get(id));
  }

  /**
   * The owner finished the edit outside the Hub (e.g. CapCut). A new version records it (change_kind "manual_divergence"): with the
   * IR when one is given (validated), otherwise the base IR with `irOutOfSync: true` so nobody treats the IR as the deliverable.
   */
  function recordManualDivergence({ editVersionId, ir = null, description, editor = "capcut", externalFileSha256 = null, actor } = {}) {
    const who = requireActor(actor);
    if (typeof description !== "string" || !normalizeRo(description) || description.length > 2000) throw new HubError("validation", "Descrie ce s-a schimbat manual (1–2000 de caractere).", { code: "FIELD_INVALID" });
    if (typeof editor !== "string" || !/^[a-z][a-z0-9_-]{1,30}$/.test(editor)) throw new HubError("validation", "Editor invalid.", { code: "FIELD_INVALID" });
    if (externalFileSha256 !== null && !/^[0-9a-f]{64}$/.test(String(externalFileSha256))) throw new HubError("validation", "Amprenta fișierului extern trebuie să fie SHA-256 (hex).", { code: "FIELD_INVALID" });
    const { row, ir: baseIr } = loadVersion(editVersionId);
    let nextIr = baseIr, validation = { ok: true, warnings: [] };
    if (ir) {
      const v = validate(ir);
      if (!v.ok) {
        const first = v.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
        throw new HubError("validation", `IR-ul divergenței este invalid (${v.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: v.errors.slice(0, 50) } });
      }
      nextIr = v.ir; validation = { ok: true, warnings: v.warnings.slice(0, 50), durationFrames: v.durationFrames };
    }
    const diff = diffIR(baseIr, nextIr);
    return bus.transaction(() => {
      const version = insertEditVersion(db, bus, clock, { editProjectId: row.edit_project_id, parentVersionId: row.id, ir: nextIr, changeKind: "manual_divergence",
        change: { editor, description: normalizeRo(description), irOutOfSync: !ir, externalFileSha256, diff: { durationFrames: diff.durationFrames, counts: diff.counts } },
        validation, variantKey: row.variant_key || null, actor: who });
      const id = newId("mrv");
      const at = now();
      insReview.run(id, row.id, "COMMENT", null, normalizeRo(description), json({ manualDivergence: { editor, irOutOfSync: !ir, externalFileSha256 } }), "RECORDED", version.id, "manual_divergence", who, null, at, at);
      bus.append({ type: "media.review.divergence_recorded", scopeType: "media_review", scopeId: id, source: who,
        payload: { reviewId: id, baseVersionId: row.id, resultVersionId: version.id, editor, irOutOfSync: !ir } });
      return { review: mapReview(selReview.get(id)), version };
    });
  }

  const get = (id) => mapReview(selReview.get(String(id || ""))) || null;
  const list = ({ editVersionId = null, limit = 200 } = {}) => (editVersionId
    ? db.prepare("SELECT * FROM media_reviews WHERE edit_version_id = ? ORDER BY created_at, rowid LIMIT ?").all(String(editVersionId), Math.min(1000, Math.max(1, limit)))
    : db.prepare("SELECT * FROM media_reviews ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(1000, Math.max(1, limit)))).map(mapReview);
  const getVersionRow = (id) => mapVersion(selVersion.get(String(id || ""))) || null;

  return { propose, apply, dismiss, decide, recordManualDivergence, get, list, getEditVersion: getVersionRow };
}
