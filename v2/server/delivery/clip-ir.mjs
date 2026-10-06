// M11 „Ifrim Delivery” — the master clip of a delivery as an EditProjectIR v1 (pure): two Hub captures of the verified preview
// (desktop, then the phone-width capture), the Hub's template texts and bundle facts. No stock, no music, no generated media, no model.
//
// - buildMasterIR(input) → a valid IR (validated here with media/ir.mjs validateIR; an invalid result throws, it is never returned):
//     · video track: c-desktop then c-mobile, both fit "contain" (the phone capture is a centred pillarbox), HARD CUTS only — so a later
//       cut_range can never touch a transition (media/review.mjs cutRange refuses those);
//     · a label track over 100 % of the timeline: „DATE SINTETICE · DEMO LOCAL”, or „SIMULARE · DATE SINTETICE · DEMO LOCAL” when a
//       capture is a SIMULATION (the first word is a whole LABEL_WORDS entry, so factual QA finds the disclosure on every frame);
//     · tone texts with stable ids t-hook, t-desktop, t-mobile, t-cta — each only when ALL its criteria are PASS (a non-PASS criterion
//       produces no text and no claim); one text on screen at a time, read at ≤ 15 characters/s whatever tone is chosen later;
//     · markers: chapter „intro”, demo „<noun> desktop”, demo „<noun> mobil”, evidence (the phone-width proof), cta. A capture marker
//       at t ms sits at frame round(t·fps/1000) + the clip's offset. The demo notes carry the domain noun, so „după secunda zece arată
//       direct programarea” resolves to a marker, never to a fixed second;
//     · evidence regions from the capture's highlight rects (viewport-normalized) of the states the criterion checks, mapped through
//       the contain framing into canvas space, each with the clip's claim id; the clip focus is the first evidence rect (else the
//       first highlight).
// - buildMaster(input)   → { ir, included, omitted, claims, markers, notes } (the same IR plus what was left out and why).
// - toneOps(ir, texts, tone) → replace_text operations on t-* items only (never the label), only where the text really changes.
// - jumpCut(ir, { afterSec, markerNote }) → the cut [frame(afterSec), first matching marker after it) or why there is none.
// - applyPrefs(ir, prefs) → the owner's kept choices re-applied to a regenerated clip (the jump as a cut_range).
//
// Tones: "business", "technical", and "both" = business hook and CTA + technical evidence texts (the default of a first clip, so
// „prea tehnic” has something to change).
import { HubError } from "../core/errors.mjs";
import { validateIR, msToFrames, framesToMs, sourceFramesAvailable, timelineDuration, IR_VERSION, DISCLOSURE_LABELS } from "../media/ir.mjs";
import { PRESETS } from "../media/visual-bible.mjs";
import { LABEL_WORDS } from "../media/qa.mjs";
import { FULL_RECT, DEFAULT_SAFE_AREA, safeRect, clipFraming, srcToCanvas, estimateTextBox, intersectRect } from "../media/variants.mjs";
import { applyOps } from "../media/review.mjs";
import { normalizeRo } from "../media/captions.mjs";
import { normalize } from "../owner/intents.mjs";

export const CLIP_LABEL_TEXT = "DATE SINTETICE · DEMO LOCAL";
export const CLIP_LABEL_TEXT_SIMULATION = `SIMULARE · ${CLIP_LABEL_TEXT}`;
export const TONES = Object.freeze(["both", "business", "technical"]);
export const TEXT_SLOTS = Object.freeze(["hook", "desktop", "mobile", "cta"]);
export const TEXT_IDS = Object.freeze({ hook: "t-hook", desktop: "t-desktop", mobile: "t-mobile", cta: "t-cta" });
export const LABEL_ITEM_ID = "l-data";
export const CLIP_IDS = Object.freeze({ desktop: "c-desktop", mobile: "c-mobile" });
/** Which variant of each slot a tone shows. */
export const TONE_SLOTS = Object.freeze({
  both: Object.freeze({ hook: "business", desktop: "technical", mobile: "technical", cta: "business" }),
  business: Object.freeze({ hook: "business", desktop: "business", mobile: "business", cta: "business" }),
  technical: Object.freeze({ hook: "technical", desktop: "technical", mobile: "technical", cta: "technical" }),
});
export const MASTER_PRESET = Object.freeze({ id: "ifrim-business", version: 1 });
/** Pacing and legibility (owner lens): reading speed, how long each text stays, the pause between two texts. */
export const PACING = Object.freeze({ readCps: 15, hookMs: 3000, hookMaxMs: 5000, textMs: 3500, textMaxMs: 7000, ctaMs: 2500, ctaMaxMs: 5000, gapMs: 200, minTextMs: 1500, evidenceHoldMs: 1500, minCaptureMs: 1000 });
const TEXT_STYLE = Object.freeze({ hook: "hook", desktop: "lower_third", mobile: "lower_third", cta: "cta" });
const ROLE_WORD = Object.freeze({ desktop: "desktop", mobile: "mobil" });
const ROLE_PLACE = Object.freeze({ desktop: "pe desktop", mobile: "pe telefon" });
const ROLES = Object.freeze(["desktop", "mobile"]);
const VERSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CLAIM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const CRITERION_RE = /^AC-\d{1,3}$/;
const PASS_STATUSES = new Set(["PASS", "PASS_EVIDENCE", "PASS_REVIEW"]);
const CAPTURE_LABELS_ALLOWED = Object.freeze(["ORIGINAL_RECORDING", "SIMULATION"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const round4 = (v) => Math.round(v * 10000) / 10000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bad = (code, message, data) => new HubError("validation", message, { code, ...(data ? { data } : {}) });

// ---------------------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------------------

/** The ids of the criteria that passed, from a bundle manifest's criteria list ([{ id, status }]). */
export function passedCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : []).filter((c) => c && PASS_STATUSES.has(String(c.status))).map((c) => String(c.id));
}

function slotsOf(texts) {
  if (!isObject(texts)) throw bad("CLIP_TEXTS_INVALID", "Textele șablonului de livrare lipsesc.");
  const out = {};
  for (const slot of TEXT_SLOTS) {
    const raw = texts[slot];
    const entry = { criteria: [], business: "", technical: "" };
    if (isObject(raw)) {
      entry.criteria = (Array.isArray(raw.criteria) ? raw.criteria : []).map((c) => String(c).toUpperCase());
      entry.business = normalizeRo(String(raw.business ?? ""));
      entry.technical = normalizeRo(String(raw.technical ?? ""));
    }
    if (!entry.business || !entry.technical || entry.business.length > 200 || entry.technical.length > 200 || entry.criteria.some((c) => !CRITERION_RE.test(c))) {
      throw bad("CLIP_TEXTS_INVALID", `Textele pentru „${slot}” lipsesc sau nu sunt valide (business + technical, criterii AC-n).`);
    }
    out[slot] = entry;
  }
  return out;
}
const toneOf = (tone) => { if (!TONES.includes(tone)) throw bad("CLIP_TONE_INVALID", `Ton necunoscut „${String(tone).slice(0, 20)}” (both, business sau technical).`); return tone; };

/** The four texts of a tone → { hook, desktop, mobile, cta }. */
export function textsForTone(texts, tone) {
  const slots = slotsOf(texts);
  const map = TONE_SLOTS[toneOf(tone)];
  return Object.fromEntries(TEXT_SLOTS.map((slot) => [slot, slots[slot][map[slot]]]));
}

/** The PASS criteria the texts rely on (sorted): the delivery creates one SUPPORTED claim for each before building the IR. */
export function criteriaForClaims(texts, passed) {
  const slots = slotsOf(texts);
  const ok = new Set(passed || []);
  return [...new Set(TEXT_SLOTS.flatMap((slot) => slots[slot].criteria))].filter((c) => ok.has(c)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

function rectOf(raw) {
  if (!isObject(raw)) return null;
  const x = Number(raw.x), y = Number(raw.y), w = Number(raw.w), h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  const cw = Math.min(w, 1 - x), ch = Math.min(h, 1 - y);
  return cw > 0.002 && ch > 0.002 ? { x, y, w: cw, h: ch } : null;
}
const roundRect = (r) => { const x = round4(clamp(r.x, 0, 1)), y = round4(clamp(r.y, 0, 1)); return { x, y, w: round4(Math.min(r.w, 1 - x)), h: round4(Math.min(r.h, 1 - y)) }; };

function capturesOf(list, fps) {
  if (!Array.isArray(list)) throw bad("CLIP_CAPTURES_INVALID", "Lipsesc capturile (desktop și lățimea unui telefon).");
  const out = {};
  for (const raw of list) {
    if (!isObject(raw) || !ROLES.includes(raw.role) || out[raw.role]) throw bad("CLIP_CAPTURES_INVALID", "Montajul are nevoie de exact o captură „desktop” și una „mobile”.");
    const id = String(raw.assetVersionId || "");
    if (!VERSION_ID_RE.test(id)) throw bad("CLIP_CAPTURES_INVALID", `Captura ${raw.role} nu are o versiune de asset validă.`);
    const width = Number(raw.width), height = Number(raw.height), durationMs = Number(raw.durationMs);
    if (!(width >= 16) || !(height >= 16) || !Number.isFinite(durationMs)) throw bad("CLIP_CAPTURES_INVALID", `Captura ${raw.role} nu are dimensiuni sau durată.`);
    if (durationMs < PACING.minCaptureMs) throw bad("CLIP_CAPTURE_TOO_SHORT", `Captura ${raw.role} durează sub o secundă; nu am ce monta.`);
    // A delivery capture is a real run of the verified code (ORIGINAL_RECORDING) or a SIMULATION (test mode / a SIMULARE bundle);
    // any other label would need a disclosure text this template does not write.
    const label = raw.captureLabel;
    if (!CAPTURE_LABELS_ALLOWED.includes(label)) throw bad("CLIP_CAPTURES_INVALID", `Captura ${raw.role} trebuie etichetată ORIGINAL_RECORDING sau SIMULATION (primit: ${String(label).slice(0, 30)}).`);
    const markers = (Array.isArray(raw.markers) ? raw.markers : []).filter((m) => isObject(m) && typeof m.kind === "string" && Number.isFinite(m.atMs) && m.atMs >= 0)
      .map((m) => ({ kind: m.kind, atMs: m.atMs, note: typeof m.note === "string" ? m.note : "", rect: rectOf(m.rect) })).sort((a, b) => a.atMs - b.atMs);
    out[raw.role] = { role: raw.role, assetVersionId: id, width, height, durationMs, frames: sourceFramesAvailable(durationMs, fps), label, markers,
      evidenceSelectors: Array.isArray(raw.evidenceSelectors) ? raw.evidenceSelectors.map(String) : null, proofSelector: typeof raw.proofSelector === "string" && raw.proofSelector ? raw.proofSelector : null };
  }
  if (!out.desktop || !out.mobile) throw bad("CLIP_CAPTURES_INVALID", "Montajul are nevoie de ambele capturi: desktop și lățimea unui telefon.");
  return out;
}

function claimMap(input) {
  const map = new Map();
  for (const [criterion, id] of Object.entries(isObject(input) ? input : {})) {
    if (id === null || id === undefined || id === "") continue;
    if (!CRITERION_RE.test(String(criterion).toUpperCase()) || !CLAIM_ID_RE.test(String(id))) throw bad("CLIP_CLAIMS_INVALID", `Afirmația pentru ${String(criterion).slice(0, 20)} nu are un id valid.`);
    map.set(String(criterion).toUpperCase(), String(id));
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Markers and the jump
// ---------------------------------------------------------------------------------------------------------------------------

/** "0:10", "0:18,4", "1:02" — minutes:seconds with tenths only when they are not zero. */
export function fmtTime(ms) {
  const tenths = Math.max(0, Math.round(Number(ms) / 100));
  const s = Math.floor(tenths / 10), d = tenths % 10;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${d ? `,${d}` : ""}`;
}

/** The IR's markers in time order → [{ frame, ms, time, kind, note }]. */
export function markerTable(ir) {
  const fps = ir?.fps;
  return (Array.isArray(ir?.markers) ? ir.markers : []).filter((m) => m && Number.isInteger(m.frame))
    .map((m, index) => ({ frame: m.frame, ms: Math.round(framesToMs(m.frame, fps)), kind: String(m.kind), note: String(m.note || ""), index }))
    .sort((a, b) => a.frame - b.frame || a.index - b.index)
    .map(({ index, ...m }) => ({ ...m, time: fmtTime(m.ms) }));
}

const NEEDLE_STOP = new Set(["la", "pe", "in", "din", "cu", "de", "si", "sa", "se", "a", "al", "o", "un", "cea", "cel", "care", "cand", "unde", "este", "e", "partea", "momentul", "scena",
  "bucata", "sectiunea", "direct", "acolo", "aceea", "acela", "mai", "apoi"]);
const SYNONYMS = Object.freeze({ telefon: ["mobil"], mobil: ["telefon"], calculator: ["desktop"], pc: ["desktop"], laptop: ["desktop"] });
/** Words that name a marker by its kind rather than its note. */
const KIND_WORDS = Object.freeze({
  cta: ["final", "sfarsit", "incheiere", "cta", "indemn"], chapter: ["inceput", "intro", "introducere"], evidence: ["dovada", "proba"], demo: ["demo", "demonstratie"],
});
const SUFFIXES = ["urile", "ului", "ilor", "elor", "ile", "ele", "ul", "le", "ua", "a", "i", "e"];
function stems(word) {
  const out = new Set([word]);
  for (const suffix of SUFFIXES) if (word.endsWith(suffix) && word.length - suffix.length >= 4) out.add(word.slice(0, -suffix.length));
  return [...out];
}
const plainWords = (text) => normalize(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** A spoken reference („programarea”, „partea de pe telefon”, „finalul”) → one list of candidate stems per content word. */
export function markerNeedles(phrase) {
  return plainWords(phrase).filter((w) => !NEEDLE_STOP.has(w)).slice(0, 6).map((w) => { const base = stems(w); return [...new Set([...base, ...base.flatMap((s) => SYNONYMS[s] || [])])]; });
}
const wordHit = (candidate, noteWord) => noteWord === candidate || (candidate.length >= 4 && noteWord.startsWith(candidate)) || (noteWord.length >= 5 && candidate.startsWith(noteWord));
/** Whether every content word of the reference names this marker (by a word of its note or by its kind). → the matched words or null. */
export function markerMatch(marker, needles) {
  if (!Array.isArray(needles) || !needles.length) return null;
  const noteWords = plainWords(marker?.note || "");
  const kindWords = KIND_WORDS[marker?.kind] || [];
  const matched = [];
  for (const candidates of needles) {
    const byNote = noteWords.find((nw) => candidates.some((c) => wordHit(c, nw)));
    if (byNote) { matched.push(byNote); continue; }
    const byKind = kindWords.find((kw) => candidates.some((c) => wordHit(c, kw)));
    if (byKind) { matched.push(byKind); continue; }
    return null;
  }
  return matched;
}

/**
 * `jumpCut(ir, { afterSec, markerNote, markerFrame })` → the cut that makes the clip go, after `afterSec`, straight to a marker:
 *   { ok: true, from, to, marker, needle, op: { op: "cut_range", from, to } }  — from = frame(afterSec), to = the FIRST marker after it
 *     whose note (or kind) the reference names; `needle` is the normalized reference to keep in the brief prefs;
 *   { ok: false, reason: "TIME_INVALID" | "AFTER_END" | "NO_MARKER" | "AMBIGUOUS", from, candidates } — `candidates` are the markers
 *     after that time (for the ONE question that lists them with their times).
 * `markerFrame` is the owner's answer to that question: the marker at exactly that frame, without matching words again.
 * Cut points come from markers, never from fixed seconds: capture timing differs between runs.
 */
export function jumpCut(ir, { afterSec, markerNote = "", markerFrame = null } = {}) {
  const fps = ir?.fps;
  const duration = timelineDuration(ir);
  const seconds = Number(afterSec);
  if (!fps || !duration || !Number.isFinite(seconds) || seconds < 0) return { ok: false, reason: "TIME_INVALID", from: null, candidates: [] };
  const from = msToFrames(seconds * 1000, fps);
  if (from >= duration - 1) return { ok: false, reason: "AFTER_END", from, candidates: [], durationMs: Math.round(framesToMs(duration, fps)) };
  const after = markerTable(ir).filter((m) => m.frame > from);
  const done = (marker, needle) => ({ ok: true, from, to: marker.frame, marker, needle, op: { op: "cut_range", from, to: marker.frame } });
  if (markerFrame !== null && markerFrame !== undefined) {
    const chosen = after.find((m) => m.frame === Number(markerFrame));
    return chosen ? done(chosen, plainWords(chosen.note).join(" ") || chosen.kind) : { ok: false, reason: "NO_MARKER", from, candidates: after };
  }
  const needles = markerNeedles(markerNote);
  const hits = after.map((m) => ({ m, matched: markerMatch(m, needles) })).filter((x) => x.matched);
  if (!hits.length) return { ok: false, reason: "NO_MARKER", from, candidates: after };
  const first = hits[0];
  const sameFrame = hits.filter((x) => x.m.frame === first.m.frame);
  if (sameFrame.length > 1) return { ok: false, reason: "AMBIGUOUS", from, candidates: sameFrame.map((x) => x.m) };
  return done(first.m, first.matched.join(" "));
}

/**
 * `applyPrefs(ir, prefs)` → { ir, applied, skipped }. prefs.jump = { afterSec, markerNote } becomes cut_range
 * [frame(afterSec), first matching marker); a jump that no longer resolves on the new timing is SKIPPED with its reason (the clip is
 * returned uncut, never cut at a guessed second). prefs.tone is applied when the clip is built (buildMasterIR), not here.
 */
export function applyPrefs(ir, prefs = {}) {
  const applied = [], skipped = [];
  let out = ir;
  const jump = isObject(prefs) ? prefs.jump : null;
  if (isObject(jump)) {
    const cut = jumpCut(out, { afterSec: jump.afterSec, markerNote: jump.markerNote });
    if (cut.ok) {
      try { out = applyOps(out, [cut.op]); applied.push({ pref: "jump", from: cut.from, to: cut.to, marker: cut.marker.note }); }
      catch (error) { skipped.push({ pref: "jump", reason: "CUT_REFUSED", detail: String(error?.message || error).slice(0, 200) }); }
    } else skipped.push({ pref: "jump", reason: cut.reason, detail: `saltul după secunda ${Number(jump.afterSec)} la „${String(jump.markerNote || "").slice(0, 60)}” nu mai are un moment marcat pe noul montaj` });
  }
  return { ir: out, applied, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * `toneOps(ir, texts, tone)` → [{ op: "replace_text", itemId, text }] for the t-* items present in the IR whose text differs from
 * the tone's text. Items that are not in the IR (their criteria did not pass, or a cut removed them) get no operation, and the
 * disclosure label is never touched.
 */
export function toneOps(ir, texts, tone) {
  const wanted = textsForTone(texts, tone);
  const items = (Array.isArray(ir?.tracks) ? ir.tracks : []).filter((t) => t?.kind === "text").flatMap((t) => t.items || []);
  const ops = [];
  for (const slot of TEXT_SLOTS) {
    const item = items.find((i) => i.id === TEXT_IDS[slot]);
    if (item && normalizeRo(item.text) !== wanted[slot]) ops.push({ op: "replace_text", itemId: item.id, text: wanted[slot] });
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The master
// ---------------------------------------------------------------------------------------------------------------------------

const charCount = (s) => [...String(s)].length;

/**
 * `buildMaster({ captures, texts, tone, claimIdsByCriterion, passed, prefs, fps, canvas, deliveryId, title, noun, evidenceNote,
 *                getVersion })` → { ir, included, omitted, claims, markers, notes }.
 * captures: [{ role: "desktop" | "mobile", assetVersionId, durationMs, width, height, captureLabel, markers: [{ kind, atMs, note,
 *   rect? }], evidenceSelectors?, proofSelector? }] — `markers` as media/capture.mjs records them (a highlight marker's note is its
 *   selector and its rect is normalized to the capture viewport); `evidenceSelectors` and `proofSelector` come from the template's
 *   capture entry (the selectors of its expectSelector steps; the success state): they say which highlights are evidence. Without
 *   them every highlight rect is an evidence region, the clip has no evidence marker and its focus is the first highlight.
 * texts: the template's { hook | desktop | mobile | cta: { criteria, business, technical } }; `passed`: ids of the PASS criteria;
 * claimIdsByCriterion: { "AC-1": "<claim id>" } for the SUPPORTED claims created for them; prefs: { tone?, jump? } kept in the brief.
 */
export function buildMaster(input = {}) {
  const fps = { num: Number(input.fps?.num ?? 30), den: Number(input.fps?.den ?? 1) };
  const canvas = { width: Number(input.canvas?.width ?? 1920), height: Number(input.canvas?.height ?? 1080) };
  if (!Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) throw bad("CLIP_FPS_INVALID", "fps invalid pentru montaj.");
  if (!(canvas.width >= 16) || !(canvas.height >= 16) || canvas.width % 2 || canvas.height % 2) throw bad("CLIP_CANVAS_INVALID", "Canvas invalid pentru montaj.");
  const preset = PRESETS[MASTER_PRESET.id];
  const texts = slotsOf(input.texts);
  const prefs = isObject(input.prefs) ? input.prefs : {};
  const tone = toneOf(prefs.tone ?? input.tone ?? "both");
  const passed = new Set((input.passed instanceof Set ? [...input.passed] : Array.isArray(input.passed) ? input.passed : []).map((c) => String(c).toUpperCase()));
  const claimIds = claimMap(input.claimIdsByCriterion);
  const caps = capturesOf(input.captures, fps);
  const F = (ms) => msToFrames(ms, fps);
  const notes = [];
  const safe = safeRect(DEFAULT_SAFE_AREA);

  // --- clips: contiguous, hard cuts
  const clipOf = {};
  let cursor = 0;
  for (const role of ROLES) {
    const cap = caps[role];
    const start = cursor;
    // The clip claims what its slot's texts claim, and only for criteria that passed and have a recorded claim.
    const claims = [...new Set(texts[role].criteria.filter((c) => passed.has(c)).map((c) => claimIds.get(c)).filter(Boolean))];
    const framing = clipFraming({ fit: "contain", crop: FULL_RECT }, { w: cap.width, h: cap.height }, canvas);
    // frameAt: the timeline frame of a capture time = round(ms · fps / 1000) + the clip's offset, kept inside the clip.
    clipOf[role] = { id: CLIP_IDS[role], role, cap, start, frames: cap.frames, end: start + cap.frames, claims, framing, frameAt: (ms) => start + clamp(F(ms), 0, cap.frames - 1) };
    cursor += cap.frames;
  }
  const D = cursor;
  const simulation = ROLES.some((role) => caps[role].label === "SIMULATION");

  // --- evidence regions and focus, from the highlight rects
  // A capture highlights two kinds of elements: what a step is about to click (navigation) and what the criterion CHECKS — the
  // selectors of its expectSelector steps and the proof (success) selector. Only the checked states are evidence: a variant keeps
  // them whole (or letterboxes, with a finding) and no text may cover them. The PRIMARY evidence is the first expectSelector
  // highlight (e.g. the booked slot): it gives the clip its focus, the IR's evidence marker and the moment of the phone-width text.
  // A caller that does not say which selectors were checked gets every highlight rect as evidence (nothing is dropped silently).
  const evidenceRegions = [];
  const evidenceMark = {};
  const focusOf = {};
  const hold = F(PACING.evidenceHoldMs);
  for (const role of ROLES) {
    const clip = clipOf[role];
    const highlights = clip.cap.markers.filter((m) => m.kind === "highlight" && m.rect);
    const checked = clip.cap.evidenceSelectors ? new Set([...clip.cap.evidenceSelectors, ...(clip.cap.proofSelector ? [clip.cap.proofSelector] : [])]) : null;
    const evidence = checked ? highlights.filter((m) => checked.has(m.note)) : highlights;
    const primary = clip.cap.evidenceSelectors ? highlights.find((m) => clip.cap.evidenceSelectors.includes(m.note)) || null : null;
    evidenceMark[role] = primary;
    const focus = primary?.rect || highlights[0]?.rect || null;
    focusOf[role] = focus ? roundRect(focus) : null;
    if (!evidence.length) continue;
    if (!clip.claims.length) { notes.push(`Clipul ${ROLE_WORD[role]} nu are criterii PASS cu afirmație, deci nu marchează nicio zonă de dovadă.`); continue; }
    for (const m of evidence) {
      const from = clip.frameAt(m.atMs);
      const to = Math.min(clip.end, from + Math.max(1, hold));
      if (to <= from) continue;
      const rect = roundRect(srcToCanvas(clip.framing, m.rect));
      if (!(rect.w > 0) || !(rect.h > 0)) continue;
      evidenceRegions.push({ clipId: clip.id, from, to, rect, claimId: clip.claims[0] });
    }
  }

  // --- texts: which ones, when, where
  const included = [], omitted = [];
  const gap = F(PACING.gapMs), minText = F(PACING.minTextMs);
  const longest = (slot) => Math.max(charCount(texts[slot].business), charCount(texts[slot].technical));
  const readFrames = (slot, baseMs, maxMs) => F(clamp(Math.ceil((longest(slot) / PACING.readCps) * 1000), baseMs, maxMs));
  const passes = (slot) => texts[slot].criteria.every((c) => passed.has(c));
  const shown = textsForTone(texts, tone);
  for (const slot of TEXT_SLOTS) if (!passes(slot)) omitted.push({ id: TEXT_IDS[slot], reason: "CRITERIA_NOT_PASS", criteria: texts[slot].criteria.filter((c) => !passed.has(c)) });
  const desk = clipOf.desktop, mob = clipOf.mobile;
  const firstMarker = (role, kind) => clipOf[role].cap.markers.find((m) => m.kind === kind) || null;
  const demoFrame = { desktop: firstMarker("desktop", "demo") ? desk.frameAt(firstMarker("desktop", "demo").atMs) : desk.start, mobile: firstMarker("mobile", "demo") ? mob.frameAt(firstMarker("mobile", "demo").atMs) : mob.start };
  const windows = {};
  if (passes("hook")) windows.hook = { start: 0, end: Math.min(readFrames("hook", PACING.hookMs, PACING.hookMaxMs), desk.end) };
  const ctaLen = Math.max(F(Number(preset?.cta?.minMs) || PACING.ctaMs), readFrames("cta", PACING.ctaMs, PACING.ctaMaxMs));
  if (passes("cta")) windows.cta = { start: Math.max(mob.start, D - ctaLen), end: D };
  /** A text of `length` frames wanted at `wanted`, inside [lo, hi): moved earlier when it would not fit; null when the room is too short. */
  const fit = (wanted, length, lo, hi) => {
    if (hi - lo < minText) return null;
    const len = Math.min(length, hi - lo);
    const start = clamp(wanted, lo, hi - len);
    return { start, end: start + len };
  };
  if (passes("desktop")) {
    const lo = windows.hook ? windows.hook.end + gap : desk.start;
    const w = fit(Math.max(demoFrame.desktop, lo), readFrames("desktop", PACING.textMs, PACING.textMaxMs), lo, desk.end);
    if (w) windows.desktop = w; else omitted.push({ id: TEXT_IDS.desktop, reason: "NO_ROOM", criteria: [] });
  }
  if (passes("mobile")) {
    const hi = windows.cta ? windows.cta.start - gap : mob.end;
    const wanted = evidenceMark.mobile ? mob.frameAt(evidenceMark.mobile.atMs) : demoFrame.mobile;
    const w = fit(Math.max(wanted, mob.start), readFrames("mobile", PACING.textMs, PACING.textMaxMs), mob.start, hi);
    if (w) windows.mobile = w; else omitted.push({ id: TEXT_IDS.mobile, reason: "NO_ROOM", criteria: [] });
  }
  for (const o of omitted.filter((x) => x.reason === "NO_ROOM")) notes.push(`Textul ${o.id} nu are loc: captura este prea scurtă pentru a-l putea citi.`);

  const boxAt = (item) => estimateTextBox(item, { canvas, preset }).rect;
  const clear = (rect, start, end) => !evidenceRegions.some((r) => r.from < end && start < r.to && intersectRect(rect, r.rect));
  /** The first candidate position whose estimated box covers no evidence shown at the same time (else the first, with a note). */
  const place = (item, candidates) => {
    for (const pos of candidates) { const next = { ...item, ...pos }; if (clear(boxAt(next), item.start, item.end)) return next; }
    notes.push(`Textul ${item.id} nu are un loc liber de dovadă; QA de layout îl va semnala.`);
    return { ...item, ...candidates[0] };
  };
  const bottomY = round4(safe.y + safe.h - 0.02), topY = round4(safe.y + 0.08);
  const wide = [{ anchor: "bottom", x: 0.5, y: bottomY, maxWidth: 0.8 }, { anchor: "top", x: 0.5, y: topY, maxWidth: 0.8 }];
  const lower = wide.map((pos) => ({ ...pos, maxWidth: 0.7 }));
  // Beside the phone: the pillarbox bars of the phone-width capture. Only the short CTA goes there (the vertical variant replaces
  // its text); a sentence in a 0.3-wide bar would keep that width in the 9:16 variant and wrap into an unreadable column.
  const sideGap = 0.02;
  const bars = { left: { x0: safe.x, x1: mob.framing.D.x - sideGap }, right: { x0: mob.framing.D.x + mob.framing.D.w + sideGap, x1: safe.x + safe.w } };
  const bar = (side) => { const b = bars[side]; const w = b.x1 - b.x0; return w >= 0.2 ? { x: round4(b.x0 + w / 2), maxWidth: round4(w) } : null; };
  const animation = ["none", "fade", "slide_up"].includes(preset?.motion?.textIn) ? preset.motion.textIn : "fade";
  const items = [];
  const addText = (slot, candidates, anim) => {
    const w = windows[slot];
    if (!w) return;
    items.push(place({ id: TEXT_IDS[slot], start: w.start, end: w.end, text: shown[slot], style: TEXT_STYLE[slot], animation: anim }, candidates));
    included.push(TEXT_IDS[slot]);
  };
  addText("hook", wide, "fade");
  addText("desktop", lower, animation);
  addText("mobile", lower, animation);
  const centre = { anchor: "center", x: 0.5, y: 0.6, maxWidth: 0.8 };
  addText("cta", bar("right") ? [{ anchor: "center", y: 0.5, ...bar("right") }, centre] : bar("left") ? [{ anchor: "center", y: 0.5, ...bar("left") }, centre] : [centre], "fade");
  items.sort((a, b) => a.start - b.start);

  // --- the disclosure label: 100 % of the timeline, in a corner free of every evidence region
  const labelText = simulation ? CLIP_LABEL_TEXT_SIMULATION : CLIP_LABEL_TEXT;
  if (simulation && !LABEL_WORDS.SIMULATION.includes(labelText.split(" ")[0])) throw new HubError("internal", "Eticheta de simulare nu începe cu un cuvânt de dezvăluire.", { code: "DELIVERY_LABEL_INVALID" });
  // maxWidth is generous on purpose: a narrow variant keeps this fraction, and the label must stay on as few lines as possible there.
  const labelBase = { id: LABEL_ITEM_ID, start: 0, end: D, text: labelText, style: "label", anchor: "top", animation: "none", maxWidth: 0.86 };
  const labelW = boxAt({ ...labelBase, x: 0.5, y: 0.07 }).w;
  const corner = { right: round4(safe.x + safe.w - labelW / 2), left: round4(safe.x + labelW / 2) };
  const labelSpots = [{ x: corner.right, y: 0.07 }, { x: corner.left, y: 0.07 }, { x: 0.5, y: 0.07 }, { anchor: "bottom", x: corner.left, y: bottomY }, { anchor: "bottom", x: corner.right, y: bottomY }];
  const labelItem = (() => {
    for (const spot of labelSpots) {
      const next = { ...labelBase, ...spot };
      const rect = boxAt(next);
      const overText = items.some((i) => intersectRect(rect, boxAt(i)));
      if (!overText && !evidenceRegions.some((r) => intersectRect(rect, r.rect))) return next;
    }
    notes.push("Eticheta de date sintetice nu are un colț liber de dovadă; rămâne în dreapta sus.");
    return { ...labelBase, ...labelSpots[0] };
  })();

  // --- markers
  const noun = normalizeRo(String(input.noun || "")).toLocaleLowerCase("ro-RO").slice(0, 40) || null;
  const demoNote = (role) => (noun ? `${noun} ${ROLE_WORD[role]}` : normalizeRo(firstMarker(role, "demo")?.note || "") || `demo ${ROLE_WORD[role]}`).slice(0, 120);
  const chapter = firstMarker("desktop", "chapter");
  const markers = [
    { frame: chapter ? desk.frameAt(chapter.atMs) : 0, kind: "chapter", note: "intro" },
    { frame: demoFrame.desktop, kind: "demo", note: demoNote("desktop") },
    { frame: demoFrame.mobile, kind: "demo", note: demoNote("mobile") },
  ];
  if (evidenceMark.mobile) markers.push({ frame: mob.frameAt(evidenceMark.mobile.atMs), kind: "evidence", note: normalizeRo(String(input.evidenceNote || "")).slice(0, 120) || `dovadă ${ROLE_PLACE.mobile}` });
  else notes.push("Captura de la lățimea unui telefon nu are o evidențiere de dovadă cunoscută; montajul nu are marcajul de dovadă.");
  markers.push({ frame: windows.cta ? windows.cta.start : Math.max(mob.start, D - ctaLen), kind: "cta", note: "final" });
  markers.sort((a, b) => a.frame - b.frame);

  // --- the document
  const clipLabel = (role) => (DISCLOSURE_LABELS.includes(caps[role].label) ? caps[role].label : "ORIGINAL_RECORDING");
  const deliveryId = /^[A-Za-z0-9_-]{1,80}$/.test(String(input.deliveryId || "")) ? String(input.deliveryId) : null;
  const ir = {
    irVersion: IR_VERSION, fps, canvas: { ...canvas, background: preset.palette.base }, preset: { ...MASTER_PRESET }, language: "ro",
    tracks: [
      { id: "v-main", kind: "video", clips: ROLES.map((role) => {
        const c = clipOf[role];
        return { id: c.id, assetVersionId: c.cap.assetVersionId, sourceIn: 0, sourceOut: c.frames, start: c.start, fit: "contain", label: clipLabel(role),
          ...(focusOf[role] ? { focus: focusOf[role] } : {}), ...(c.claims.length ? { claimIds: c.claims } : {}) };
      }) },
      { id: "tr-label", kind: "text", items: [labelItem] },
      ...(items.length ? [{ id: "tr-story", kind: "text", items }] : []),
    ],
    markers, evidenceRegions,
    loudness: { targetLufs: -14, maxTruePeakDb: -1 },
    meta: { title: normalizeRo(String(input.title || "Demo local pentru prezentare")).slice(0, 200), labels: [...new Set(ROLES.map(clipLabel))], author: deliveryId ? `delivery:${deliveryId}` : "delivery",
      notes: "Montaj generat de Ifrim Delivery din capturile demo-ului local cu date sintetice, fără model." },
  };
  const checked = validateIR(ir, { presets: PRESETS, ...(typeof input.getVersion === "function" ? { getVersion: input.getVersion } : {}) });
  if (!checked.ok) {
    const first = checked.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    throw new HubError("validation", `Montajul livrării nu este un IR valid (${checked.errors.length} erori): ${first}`, { code: "DELIVERY_IR_INVALID", data: { errors: checked.errors.slice(0, 50) } });
  }
  let out = ir;
  if (isObject(prefs.jump)) {
    const r = applyPrefs(ir, { jump: prefs.jump });
    out = r.ir;
    for (const s of r.skipped) notes.push(`Preferința păstrată nu s-a putut aplica: ${s.detail || s.reason}.`);
  }
  return { ir: out, tone, included, omitted, claims: Object.fromEntries(ROLES.map((role) => [clipOf[role].id, clipOf[role].claims])), markers: markerTable(out), notes };
}

/** The master IR alone (see buildMaster). */
export const buildMasterIR = (input) => buildMaster(input).ir;
