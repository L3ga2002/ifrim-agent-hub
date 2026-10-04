import { HubError } from "../core/errors.mjs";
import { framesToMs, framesToMsInt, msToFrames } from "./ir.mjs";

/**
 * Captions: Romanian text normalization, line wrapping, readability checks and the SRT / WebVTT / ASS writers used by the
 * render plan (burned-in ASS through libass), the sidecar exports and the editor packs. Pure module: no I/O.
 *
 * Cues are IR cues: { id, start, end, text } with start/end in FRAMES of the rational `fps` ({ num, den }), half-open
 * [start, end). Every timestamp is computed independently from its frame index with integer arithmetic
 * (`framesToMsInt`), never by adding per-frame durations, so a 30000/1001 timeline has no cumulative drift.
 *
 * ASS escaping (libass): `{` / `}` become `\{` / `\}` (libass prints them literally, they cannot open an override block),
 * a backslash is followed by U+2060 WORD JOINER (invisible, default-ignorable) so `\N`, `\n`, `\h`, `\{` typed by a
 * user are shown literally instead of being interpreted, and line breaks become `\N`. The font name and style values
 * are sanitized because ASS fields are comma-separated.
 */

// Non-ASCII code points are built with String.fromCharCode so this source file contains no invisible, bidi or
// cedilla characters itself.
const cp = (...codes) => String.fromCharCode(...codes);
const CEDILLA_MAP = { [cp(0x15f)]: cp(0x219), [cp(0x163)]: cp(0x21b), [cp(0x15e)]: cp(0x218), [cp(0x162)]: cp(0x21a) };
const CEDILLA_RE = new RegExp(`[${cp(0x15e, 0x15f, 0x162, 0x163)}]`);
const CEDILLA_RE_G = new RegExp(CEDILLA_RE.source, "g");
const CEDILLA_FORMS = `${cp(0x15f)}/${cp(0x163)}`;
const WORD_JOINER = cp(0x2060);
const SPACES_RE = new RegExp(`[ ${cp(0xa0)}${cp(0x202f)}]+`, "g");
const INVISIBLE_RE = new RegExp(`[${cp(0x200b)}-${cp(0x200d)}${cp(0x2060)}${cp(0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, "g");
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * Romanian normalization: NFC, cedilla s/t (U+015E/F, U+0162/3) → comma-below ș/ț/Ș/Ț (incl. combining sequences), CRLF → LF,
 * invisible / control characters removed, runs of spaces collapsed, each line trimmed, empty lines dropped.
 */
export function normalizeRo(text) {
  if (text === null || text === undefined) return "";
  let s = String(text).normalize("NFC").replace(CEDILLA_RE_G, (c) => CEDILLA_MAP[c]);
  s = s.replace(/\r\n?/g, "\n").replace(INVISIBLE_RE, "").replace(/\t/g, " ").replace(CONTROL_RE, "").replace(SPACES_RE, " ");
  return s.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

const charLen = (s) => [...s].length;

/**
 * Wraps text into lines of at most `maxChars` (explicit line breaks are kept as hard breaks). A paragraph that needs
 * exactly two lines is balanced (shorter top line preferred, the usual bottom-heavy subtitle shape); longer paragraphs
 * are wrapped greedily. A single word longer than `maxChars` stays whole on its own line and is reported.
 * → { lines, overflow (more than maxLines or a line too long), longest }
 */
export function wrapLines(text, { maxChars = 42, maxLines = 2 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 8) throw new HubError("validation", "maxChars trebuie să fie un întreg ≥ 8.");
  const lines = [];
  for (const paragraph of normalizeRo(text).split("\n").filter(Boolean)) {
    const words = paragraph.split(" ").filter(Boolean);
    const greedy = [];
    let current = "";
    for (const word of words) {
      if (!current) current = word;
      else if (charLen(current) + 1 + charLen(word) <= maxChars) current += ` ${word}`;
      else { greedy.push(current); current = word; }
    }
    if (current) greedy.push(current);
    if (greedy.length === 2) {
      let best = null;
      for (let i = 1; i < words.length; i += 1) {
        const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
        const la = charLen(a), lb = charLen(b);
        if (la > maxChars || lb > maxChars) continue;
        const score = Math.max(la, lb) * 2 + (la > lb ? 1 : 0);
        if (!best || score < best.score) best = { score, lines: [a, b] };
      }
      lines.push(...(best ? best.lines : greedy));
    } else lines.push(...greedy);
  }
  const longest = lines.reduce((m, l) => Math.max(m, charLen(l)), 0);
  return { lines, overflow: lines.length > maxLines || longest > maxChars, longest };
}

function assertFps(fps) {
  if (!fps || !Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) {
    throw new HubError("validation", "fps invalid: se așteaptă { num, den } întregi pozitive.");
  }
}
function assertCues(cues) {
  if (!Array.isArray(cues)) throw new HubError("validation", "Subtitrările trebuie să fie o listă de cue-uri.");
  cues.forEach((cue, i) => {
    if (!cue || !Number.isInteger(cue.start) || !Number.isInteger(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      throw new HubError("validation", `Cue-ul ${cue?.id ?? i + 1} are un interval invalid (start/end întregi, end > start).`);
    }
    if (typeof cue.text !== "string") throw new HubError("validation", `Cue-ul ${cue.id ?? i + 1} nu are text.`);
  });
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Readability and timing checks. → findings [{ cueId, index, code, severity: "error"|"warning", message, frame }]
 * errors: CUE_RANGE, CUE_BOUNDS, CUE_OVERLAP, CUE_EMPTY, CPS_HARD; warnings: CPS_HIGH, LINE_TOO_LONG, TOO_MANY_LINES,
 * CUE_TOO_SHORT (< 0,8 s), CUE_TOO_LONG (> 7 s), DIACRITIC_CEDILLA.
 */
export function checkCues(cues, { fps, durationFrames = null, maxCps = 17, hardCps = 25, maxChars = 42, maxLines = 2, minMs = 800, maxMs = 7000 } = {}) {
  assertFps(fps);
  if (!Array.isArray(cues)) throw new HubError("validation", "Subtitrările trebuie să fie o listă de cue-uri.");
  const findings = [];
  const add = (cue, index, code, severity, message) => findings.push({ cueId: cue?.id ?? null, index, code, severity, message, frame: Number.isInteger(cue?.start) ? cue.start : null });
  const order = cues.map((cue, index) => ({ cue, index })).sort((a, b) => (a.cue?.start ?? 0) - (b.cue?.start ?? 0));
  let prev = null;
  for (const { cue, index } of order) {
    const label = `Subtitrarea ${cue?.id ?? index + 1}`;
    if (!cue || !Number.isInteger(cue.start) || !Number.isInteger(cue.end) || cue.end <= cue.start || cue.start < 0) {
      add(cue, index, "CUE_RANGE", "error", `${label}: interval invalid (start/end întregi, end > start ≥ 0).`);
      continue;
    }
    if (durationFrames !== null && cue.end > durationFrames) add(cue, index, "CUE_BOUNDS", "error", `${label} se termină după sfârșitul videoclipului (${cue.end} > ${durationFrames} cadre).`);
    if (prev && cue.start < prev.end) add(cue, index, "CUE_OVERLAP", "error", `${label} se suprapune cu ${prev.id ?? "cea anterioară"}.`);
    prev = cue;
    const raw = typeof cue.text === "string" ? cue.text : "";
    if (CEDILLA_RE.test(raw)) add(cue, index, "DIACRITIC_CEDILLA", "warning", `${label}: ${CEDILLA_FORMS} cu sedilă — forma corectă este ș/ț.`);
    const text = normalizeRo(raw);
    if (!text) { add(cue, index, "CUE_EMPTY", "error", `${label} nu are text.`); continue; }
    const ms = framesToMs(cue.end - cue.start, fps);
    const chars = charLen(text.replace(/\n/g, ""));
    const cps = chars / (ms / 1000);
    const cpsText = cps.toFixed(1).replace(".", ",");
    if (cps > hardCps) add(cue, index, "CPS_HARD", "error", `${label}: ${cpsText} caractere/s — imposibil de citit (limita ${hardCps}).`);
    else if (cps > maxCps) add(cue, index, "CPS_HIGH", "warning", `${label}: ${cpsText} caractere/s peste ținta de ${maxCps}.`);
    const explicit = text.split("\n");
    const lines = explicit.some((l) => charLen(l) > maxChars) ? wrapLines(text, { maxChars, maxLines }).lines : explicit;
    if (lines.length > maxLines) add(cue, index, "TOO_MANY_LINES", "warning", `${label}: ${lines.length} rânduri (maximum ${maxLines}).`);
    const longest = lines.reduce((m, l) => Math.max(m, charLen(l)), 0);
    if (longest > maxChars) add(cue, index, "LINE_TOO_LONG", "warning", `${label}: un rând are ${longest} caractere (maximum ${maxChars}).`);
    if (ms < minMs) add(cue, index, "CUE_TOO_SHORT", "warning", `${label}: ${Math.round(ms)} ms pe ecran (minimum recomandat ${minMs} ms).`);
    if (ms > maxMs) add(cue, index, "CUE_TOO_LONG", "warning", `${label}: ${Math.round(ms)} ms pe ecran (maximum recomandat ${maxMs} ms).`);
  }
  return findings;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
function clockParts(totalUnits, unitsPerSecond) {
  const s = Math.floor(totalUnits / unitsPerSecond);
  return { h: Math.floor(s / 3600), m: Math.floor(s / 60) % 60, s: s % 60, frac: totalUnits % unitsPerSecond };
}
/** HH:MM:SS,mmm (SRT) for a frame index. */
export function srtTime(frames, fps) { const p = clockParts(framesToMsInt(frames, fps), 1000); return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)},${pad(p.frac, 3)}`; }
/** HH:MM:SS.mmm (WebVTT) for a frame index. */
export function vttTime(frames, fps) { const p = clockParts(framesToMsInt(frames, fps), 1000); return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}.${pad(p.frac, 3)}`; }
/** H:MM:SS.cc (ASS, centiseconds) for a frame index. */
export function assTime(frames, fps) { return assTimeCs(framesToMsInt(frames, fps, 100)); }
function assTimeCs(cs) { const p = clockParts(cs, 100); return `${p.h}:${pad(p.m)}:${pad(p.s)}.${pad(p.frac)}`; }

function cueLines(text, maxChars, maxLines) {
  const clean = normalizeRo(text);
  if (!maxChars) return clean.split("\n").filter(Boolean);
  return wrapLines(clean, { maxChars, maxLines: maxLines || 2 }).lines;
}

/** SubRip. Text is normalized; "-->" inside text is defused; a blank line can never end a cue early. */
export function toSrt(cues, fps, { maxChars = null, maxLines = 2 } = {}) {
  assertFps(fps);
  const sorted = assertCues(cues);
  const blocks = [];
  sorted.forEach((cue) => {
    const lines = cueLines(cue.text, maxChars, maxLines).map((l) => l.replace(/-->/g, "->"));
    if (!lines.length) return;
    blocks.push(`${blocks.length + 1}\n${srtTime(cue.start, fps)} --> ${srtTime(cue.end, fps)}\n${lines.join("\n")}\n`);
  });
  return blocks.join("\n");
}

const vttEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** WebVTT with cue identifiers; text HTML-escaped (& < >), so "-->" and markup cannot leak. */
export function toVtt(cues, fps, { maxChars = null, maxLines = 2 } = {}) {
  assertFps(fps);
  const sorted = assertCues(cues);
  let out = "WEBVTT\n";
  for (const cue of sorted) {
    const lines = cueLines(cue.text, maxChars, maxLines).map(vttEscape);
    if (!lines.length) continue;
    const id = String(cue.id ?? "").replace(/-->|[\r\n]/g, "").trim();
    out += `\n${id ? `${id}\n` : ""}${vttTime(cue.start, fps)} --> ${vttTime(cue.end, fps)}\n${lines.join("\n")}\n`;
  }
  return out;
}

/** Escapes a caption line for an ASS Dialogue Text field (see the header comment). */
export function assEscape(text) {
  return String(text).replace(/\\/g, `\\${WORD_JOINER}`).replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}
/** "#RRGGBB" + opacity (0..1) → ASS &HAABBGGRR (AA = transparency). */
export function assColor(hex, opacity = 1) {
  const m = /^#?([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(String(hex || ""));
  if (!m) throw new HubError("validation", `Culoare invalidă „${String(hex).slice(0, 20)}” (se așteaptă #RRGGBB).`);
  const o = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
  const alpha = Math.round((1 - o) * 255).toString(16).toUpperCase().padStart(2, "0");
  return `&H${alpha}${m[3].toUpperCase()}${m[2].toUpperCase()}${m[1].toUpperCase()}`;
}
const assField = (s) => String(s).replace(/[,\r\n\u0000-\u001F{}\\]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Advanced SubStation Alpha for the libass burn-in. opts:
 * - canvas { width, height } (PlayRes = canvas, so sizes are in output pixels)
 * - style: a preset captionStyle { sizeRel, weight, color, outlineColor, outlineRel, shadowRel, box: { color, opacity,
 *   padRel } | null, anchor: bottom|top|center, letterSpacing (em), uppercase, maxChars, maxLines }
 * - fps, safeArea { top, bottom, left, right } (fractions of the canvas), fontName (resolved family name)
 */
export function toAss(cues, { canvas, style = {}, fps, safeArea = { top: 0.1, bottom: 0.1, left: 0.06, right: 0.06 }, fontName = "Segoe UI" } = {}) {
  assertFps(fps);
  const width = Number(canvas?.width), height = Number(canvas?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) throw new HubError("validation", "Canvas invalid pentru ASS (lățime/înălțime întregi).");
  const sorted = assertCues(cues);
  const frac = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 0.5 ? Number(v) : d);
  const sa = { top: frac(safeArea?.top, 0.1), bottom: frac(safeArea?.bottom, 0.1), left: frac(safeArea?.left, 0.06), right: frac(safeArea?.right, 0.06) };
  const fontSize = Math.max(8, Math.round((Number(style.sizeRel) || 0.036) * height));
  const bold = Number(style.weight || 400) >= 600 ? -1 : 0;
  const spacing = Math.round((Number(style.letterSpacing) || 0) * fontSize * 10) / 10;
  const anchor = style.anchor === "top" ? "top" : style.anchor === "center" ? "center" : "bottom";
  const alignment = anchor === "top" ? 8 : anchor === "center" ? 5 : 2;
  const primary = assColor(style.color || "#FFFFFF", 1);
  let borderStyle = 1, outline, shadow, outlineColour, backColour;
  if (style.box) {
    // BorderStyle 3 = opaque box drawn in OutlineColour; Outline = box padding.
    borderStyle = 3;
    outline = Math.max(1, Math.round((Number(style.box.padRel) || 0.008) * height));
    shadow = 0;
    outlineColour = assColor(style.box.color || "#000000", style.box.opacity ?? 0.6);
    backColour = assColor(style.box.color || "#000000", 0);
  } else {
    outline = Math.round((Number(style.outlineRel) || 0.002) * height * 10) / 10;
    shadow = Math.round((Number(style.shadowRel) || 0) * height * 10) / 10;
    outlineColour = assColor(style.outlineColor || "#000000", 1);
    backColour = assColor(style.shadowColor || "#000000", 0.5);
  }
  const marginL = Math.round(sa.left * width), marginR = Math.round(sa.right * width);
  const marginV = Math.round((anchor === "top" ? sa.top : sa.bottom) * height);
  const name = assField(fontName) || "Segoe UI";
  const header = [
    "[Script Info]",
    "; Ifrim Agent Hub — media/captions.mjs",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${name},${fontSize},${primary},${primary},${outlineColour},${backColour},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${alignment},${marginL},${marginR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const maxChars = Number.isInteger(style.maxChars) ? style.maxChars : null;
  const events = [];
  for (const cue of sorted) {
    let lines = cueLines(cue.text, maxChars, style.maxLines || 2);
    if (style.uppercase) lines = lines.map((l) => l.toLocaleUpperCase("ro-RO"));
    if (!lines.length) continue;
    const startCs = framesToMsInt(cue.start, fps, 100);
    const endCs = Math.max(startCs + 1, framesToMsInt(cue.end, fps, 100));
    events.push(`Dialogue: 0,${assTimeCs(startCs)},${assTimeCs(endCs)},Caption,,0,0,0,,${lines.map(assEscape).join("\\N")}`);
  }
  return `${header.join("\n")}\n${events.join("\n")}${events.length ? "\n" : ""}`;
}

/** Reads one transcript segment's time range in ms. Keys: startMs/endMs, fromMs/toMs, offsets.{from,to} (ms) or start/end (SECONDS). */
function segmentRange(seg) {
  const pick = (...vals) => vals.find((v) => typeof v === "number" && Number.isFinite(v));
  let from = pick(seg?.startMs, seg?.fromMs, seg?.offsets?.from);
  let to = pick(seg?.endMs, seg?.toMs, seg?.offsets?.to);
  if (from === undefined && typeof seg?.start === "number") from = seg.start * 1000;
  if (to === undefined && typeof seg?.end === "number") to = seg.end * 1000;
  return { from, to };
}

/**
 * Transcript segments → IR cues. Text is normalized; a segment longer than maxChars × maxLines is split at word
 * boundaries (preferring punctuation) with time shared in proportion to characters; frames are rounded to the nearest
 * frame; cues never overlap (a cue starts at or after the previous end + minGapFrames) and last at least one frame.
 * Segments without a valid range or text are skipped and counted. → cues[] (non-enumerable `cues.skipped` = count)
 */
export function cuesFromSegments(segments, { fps, maxChars = 42, maxLines = 2, minGapFrames = 0, idPrefix = "q" } = {}) {
  assertFps(fps);
  if (!Array.isArray(segments)) throw new HubError("validation", "Segmentele transcrierii trebuie să fie o listă.");
  const capacity = maxChars * maxLines;
  const cues = [];
  let skipped = 0, prevEnd = 0;
  for (const seg of segments) {
    const { from, to } = segmentRange(seg);
    const text = normalizeRo(seg?.text).replace(/\n/g, " ");
    if (from === undefined || to === undefined || to <= from || from < 0 || !text) { skipped += 1; continue; }
    const chunks = [];
    let current = [];
    for (const word of text.split(" ").filter(Boolean)) {
      const candidate = [...current, word].join(" ");
      // A chunk must fit in maxLines wrapped lines (word wrapping can need more lines than chars / maxChars suggests).
      if (current.length && (charLen(candidate) > capacity || wrapLines(candidate, { maxChars, maxLines }).lines.length > maxLines)) {
        chunks.push(current.join(" ")); current = [word]; continue;
      }
      current.push(word);
      if (/[.!?;:]$/.test(word) && charLen(candidate) >= capacity * 0.6) { chunks.push(current.join(" ")); current = []; }
    }
    if (current.length) chunks.push(current.join(" "));
    const total = chunks.reduce((s, c) => s + charLen(c), 0);
    let acc = 0;
    for (const chunk of chunks) {
      const msStart = from + ((to - from) * acc) / total;
      acc += charLen(chunk);
      const msEnd = from + ((to - from) * acc) / total;
      let start = Math.max(msToFrames(msStart, fps), cues.length ? prevEnd + minGapFrames : 0);
      let end = msToFrames(msEnd, fps);
      if (end <= start) end = start + 1;
      cues.push({ id: `${idPrefix}${cues.length + 1}`, start, end, text: wrapLines(chunk, { maxChars, maxLines }).lines.join("\n") });
      prevEnd = end;
    }
  }
  Object.defineProperty(cues, "skipped", { value: skipped, enumerable: false });
  return cues;
}
