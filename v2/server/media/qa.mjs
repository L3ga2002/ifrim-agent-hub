import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { validateIR, normalizeIR, irHash, timelineDuration, clipDuration, primaryVideoTrack, framesToMs, msToFrames, framesToTimecode, fpsValue,
  DISCLOSURE_LABELS } from "./ir.mjs";
import { checkCues, normalizeRo } from "./captions.mjs";
import { PRESETS } from "./visual-bible.mjs";
import { inputArgs } from "./tools.mjs";
import { profileCanvas } from "./compile.mjs";
import { PLATFORM_PROFILES, DEFAULT_SAFE_AREA, TEXT_METRICS, safeRect, estimateTextBox, estimateCaptionBox, intersectRect, containsRect, presetForIR,
  FULL_RECT, getProfile, isDisclosureText } from "./variants.mjs";

/**
 * Media QA — technical, layout, editorial (heuristic), factual and rights checks of an edit version and its render.
 *
 * Every finding is concrete: { id, check, code, severity: error|warning|info, criterion, message, evidence, range: { fromMs, toMs,
 * fromFrame, toFrame, timecode } | null, proposedFix, justified, justification }. A report's status is FAIL when an unjustified
 * error remains, WARN for an unjustified warning, PASS otherwise; NOT_RUN when the check could not run (tool missing, no render),
 * with the reason as a finding — never a silent pass.
 *
 * Technical QA = ffprobe + ONE ffmpeg analysis pass on the rendered file (`-loglevel info`, so ebur128 / blackdetect /
 * freezedetect / silencedetect report on stderr). ALL stderr lines are parsed as they stream (tools.run onStderrLine; the
 * supervisor's ring keeps only 80 lines and tools.run's own buffer is capped), so a long render loses no event. Findings are
 * mapped to timeline frames of the IR. A black / frozen / silent range is `justified` only by the shot it lies in: a clip (or
 * consecutive clips of one shotId) marked `holdIntentional`, a `fade` transition (dip through a dark canvas background) for
 * black, or a timeline range with no audio clip in the IR for silence. There is no global whitelist.
 *
 * Layout QA uses the platform profile's safe area (variants.mjs, internal estimates) and the documented text-box estimate
 * (TEXT_METRICS: average advance 0,55 em proportional / 0,60 em mono, ×1,15 uppercase, line height 1,2); captions are checked
 * for readability (captions.checkCues), size against the safe area and overlap with on-screen text and evidence.
 *
 * Persistence (run): one media_qa_reports row per DB kind — technical, editorial (layout + editorial heuristics in one row,
 * because migration 9 has no "layout" kind; each finding carries `check`), factual, rights — in one transaction with a
 * `media.qa.reported` event. A FAIL blocks manifest approval (distribution reads the latest row per kind or `summary()`).
 */

export const QA_VERSION = 1;
export const QA_THRESHOLDS = Object.freeze({
  blackMinS: 0.25, blackPixTh: 0.1, blackPicTh: 0.98,
  freezeMinS: 1, freezeNoiseDb: -60,
  silenceMinS: 0.5, silenceNoiseDb: -50,
  loudnessToleranceLu: 2, truePeakMarginDb: 0.1,
  durationToleranceMs: 50, justifyToleranceFrames: 2,
  textMaxLines: 3, textMinSizeRel: 0.018, textMaxCps: 20,
  hookMaxMs: 1000, demoMinMs: 2000, introMaxMs: 3000, ctaWindowMs: 5000, briefTolerance: 0.15,
});
const MAX_EVENTS = 2000;
const STATUS_ORDER = { FAIL: 3, WARN: 2, NOT_RUN: 1, PASS: 0 };
const SEVERITY = Object.freeze(["error", "warning", "info"]);

/** Words accepted as the on-screen disclosure label (prefix match, so „SIMULARE”, „GENERATĂ” count). */
// Whole words only (M09 review: a prefix match accepted „Simulatorul” / „Generatorul” as a disclosure); the Romanian inflections
// are listed explicitly.
export const LABEL_WORDS = Object.freeze({
  SIMULATION: Object.freeze(["SIMULATION", "SIMULARE", "SIMULAREA", "SIMULAT", "SIMULATĂ", "SIMULATE", "SIMULAȚI"]),
  RECONSTRUCTION: Object.freeze(["RECONSTRUCTION", "RECONSTITUIRE", "RECONSTITUIREA", "RECONSTRUCȚIE", "RECONSTRUIT", "RECONSTRUITĂ", "RECONSTITUIT", "RECONSTITUITĂ"]),
  REPLAY: Object.freeze(["REPLAY", "RELUARE", "RELUAREA", "RELUAT", "RELUATĂ"]),
  GENERATED: Object.freeze(["GENERATED", "AI-GENERATED", "GENERAT", "GENERATĂ", "GENERATE", "GENERAȚI"]),
});
const LABEL_RO = { SIMULATION: "simulare", RECONSTRUCTION: "reconstituire", REPLAY: "reluare", GENERATED: "conținut generat" };

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers

const fmtS = (ms) => `${(ms / 1000).toFixed(3).replace(".", ",")} s`;
const fmtDb = (v) => (Number.isFinite(v) ? v.toFixed(1).replace(".", ",").replace("-", "−") : "—");

/** A finding's time range at `fps` (frames are floor/ceil of the measured times). */
export function rangeOf(fromMs, toMs, fps) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const f = fps || { num: 30, den: 1 };
  const fromFrame = Math.max(0, msToFrames(Math.max(0, fromMs), f, "floor"));
  const toFrame = Math.max(fromFrame + 1, msToFrames(Math.max(0, toMs), f, "ceil"));
  return { fromMs: Math.round(fromMs), toMs: Math.round(toMs), fromFrame, toFrame,
    timecode: `${framesToTimecode(fromFrame, f)} – ${framesToTimecode(toFrame, f)}`, label: `${fmtS(fromMs)} – ${fmtS(toMs)}` };
}
/** A range given in timeline frames (exact frames kept; ms derived). */
const frameRange = (from, to, fps) => ({ ...rangeOf(framesToMs(from, fps), framesToMs(to, fps), fps), fromFrame: from, toFrame: to,
  timecode: `${framesToTimecode(from, fps)} – ${framesToTimecode(to, fps)}` });

function makeCollector(check) {
  const list = [];
  const add = ({ code, severity, criterion, message, evidence = {}, range = null, proposedFix = "", justified = false, justification = null, ...refs }) => {
    if (!SEVERITY.includes(severity)) throw new Error(`severity ${severity}`);
    const f = { id: `${check.slice(0, 3).toUpperCase()}-${list.length + 1}`, check, code, severity, criterion, message, evidence, range, proposedFix, justified, justification, ...refs };
    list.push(f);
    return f;
  };
  return { list, add };
}
export function statusOf(findings, { notRun = false } = {}) {
  if (notRun) return "NOT_RUN";
  if (findings.some((f) => f.severity === "error" && !f.justified)) return "FAIL";
  if (findings.some((f) => f.severity === "warning" && !f.justified)) return "WARN";
  return "PASS";
}
export function worstStatus(statuses) {
  const list = statuses.filter(Boolean);
  if (!list.length) return "NOT_RUN";
  return list.reduce((w, s) => (STATUS_ORDER[s] > STATUS_ORDER[w] ? s : w), "PASS");
}

// ---------------------------------------------------------------------------------------------------------------------
// ffmpeg analysis stderr parser (pure, streaming)

const NUM = "(-?\\d+(?:\\.\\d+)?|-?inf|nan)";
const RE = {
  black: /black_start:\s*(-?\d+(?:\.\d+)?)\s+black_end:\s*(-?\d+(?:\.\d+)?)\s+black_duration:\s*(\d+(?:\.\d+)?)/,
  freezeStart: /freezedetect\.freeze_start:\s*(\d+(?:\.\d+)?)/,
  freezeDuration: /freezedetect\.freeze_duration:\s*(\d+(?:\.\d+)?)/,
  freezeEnd: /freezedetect\.freeze_end:\s*(\d+(?:\.\d+)?)/,
  silenceStart: /silence_start:\s*(-?\d+(?:\.\d+)?)/,
  silenceEnd: /silence_end:\s*(\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)/,
  eburFrame: new RegExp(`\\bt:\\s*(\\d+(?:\\.\\d+)?)\\s+.*?\\bM:\\s*${NUM}\\s+S:\\s*${NUM}`),
  summary: /\]\s*Summary:\s*$/,
  integrated: new RegExp(`^\\s*I:\\s*${NUM}\\s*LUFS`),
  threshold: new RegExp(`^\\s*Threshold:\\s*${NUM}\\s*LUFS`),
  lra: new RegExp(`^\\s*LRA:\\s*${NUM}\\s*LU\\b`),
  peak: new RegExp(`^\\s*Peak:\\s*${NUM}\\s*dBFS`),
  decodeError: /^\[(h264|hevc|aac|mp3|mp3float|opus|vorbis|vp8|vp9|av1|libdav1d|mpeg4|mpeg2video|prores|png|mjpeg|flac|pcm_\w+)\s*@[^\]]*\]\s*(.*)$/i,
  decodeBad: /error|corrupt|invalid|missing|concealing|non-existing/i,
  genericError: /Error while decoding|Invalid data found|corrupt decoded frame/i,
};
const toNum = (s) => { if (s === undefined || s === null || /nan/i.test(s)) return null; if (/inf/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity; const n = Number(s); return Number.isFinite(n) ? n : null; };

/** → { feed(line), result(durationS) } parsing blackdetect / freezedetect / silencedetect / ebur128 / decoder errors. */
export function createAnalysisParser() {
  const black = [], freeze = [], silence = [];
  let openFreeze = null, openSilence = null, lines = 0;
  const loud = { integratedLufs: null, thresholdLufs: null, lraLu: null, truePeakDbfs: null, samplePeakDbfs: null, maxMomentaryLufs: null, maxShortTermLufs: null, frames: 0 };
  let section = null, inSummary = false;
  const decode = { count: 0, samples: [] };
  const push = (list, item) => { if (list.length < MAX_EVENTS) list.push(item); };
  function feed(raw) {
    const line = String(raw).replace(/\r$/, "");
    lines += 1;
    let m;
    if ((m = RE.black.exec(line))) { push(black, { startS: Math.max(0, Number(m[1])), endS: Number(m[2]), durationS: Number(m[3]) }); return; }
    if ((m = RE.freezeStart.exec(line))) { openFreeze = { startS: Number(m[1]) }; return; }
    if ((m = RE.freezeDuration.exec(line))) { if (openFreeze) openFreeze.durationS = Number(m[1]); return; }
    if ((m = RE.freezeEnd.exec(line))) {
      const endS = Number(m[1]);
      const startS = openFreeze?.startS ?? (openFreeze?.durationS !== undefined ? endS - openFreeze.durationS : endS);
      push(freeze, { startS, endS, durationS: endS - startS });
      openFreeze = null; return;
    }
    if ((m = RE.silenceEnd.exec(line))) {
      const endS = Number(m[1]), durationS = Number(m[2]);
      const startS = openSilence ? openSilence.startS : Math.max(0, endS - durationS);
      push(silence, { startS, endS, durationS: endS - startS });
      openSilence = null; return;
    }
    if ((m = RE.silenceStart.exec(line))) { openSilence = { startS: Math.max(0, Number(m[1])) }; return; }
    if ((m = RE.eburFrame.exec(line)) && /TARGET:/.test(line)) {
      loud.frames += 1;
      const M = toNum(m[2]), S = toNum(m[3]);
      if (Number.isFinite(M) && M > -70 && (loud.maxMomentaryLufs === null || M > loud.maxMomentaryLufs)) loud.maxMomentaryLufs = M;
      if (Number.isFinite(S) && S > -70 && (loud.maxShortTermLufs === null || S > loud.maxShortTermLufs)) loud.maxShortTermLufs = S;
      return;
    }
    if (RE.summary.test(line) && /ebur128/i.test(line)) { inSummary = true; section = null; return; }
    if (inSummary) {
      const t = line.trim();
      if (/^Integrated loudness:/i.test(t)) { section = "integrated"; return; }
      if (/^Loudness range:/i.test(t)) { section = "range"; return; }
      if (/^True peak:/i.test(t)) { section = "true"; return; }
      if (/^Sample peak:/i.test(t)) { section = "sample"; return; }
      if (section === "integrated" && (m = RE.integrated.exec(line))) { loud.integratedLufs = toNum(m[1]); return; }
      if (section === "integrated" && (m = RE.threshold.exec(line))) { loud.thresholdLufs = toNum(m[1]); return; }
      if (section === "range" && (m = RE.lra.exec(line))) { loud.lraLu = toNum(m[1]); return; }
      if (section === "true" && (m = RE.peak.exec(line))) { loud.truePeakDbfs = toNum(m[1]); return; }
      if (section === "sample" && (m = RE.peak.exec(line))) { loud.samplePeakDbfs = toNum(m[1]); return; }
      if (/^\[/.test(t)) inSummary = false; // the next logger line ends the summary block
    }
    if (((m = RE.decodeError.exec(line)) && RE.decodeBad.test(m[2])) || RE.genericError.test(line)) {
      decode.count += 1;
      if (decode.samples.length < 5) decode.samples.push(line.slice(0, 240));
    }
  }
  function result(durationS = null) {
    const end = Number.isFinite(durationS) ? durationS : null;
    const out = { black: [...black], freeze: [...freeze], silence: [...silence], loudness: { ...loud }, decodeErrors: { ...decode, samples: [...decode.samples] }, lines };
    if (openFreeze && end !== null) out.freeze.push({ startS: openFreeze.startS, endS: end, durationS: end - openFreeze.startS, openEnded: true });
    if (openSilence && end !== null) out.silence.push({ startS: openSilence.startS, endS: end, durationS: end - openSilence.startS, openEnded: true });
    return out;
  }
  return { feed, result };
}

// ---------------------------------------------------------------------------------------------------------------------
// Justification (per shot only)

const isDarkHex = (hex) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "#000000"));
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= QA_THRESHOLDS.blackPixTh + 0.02;
};

/** Why a black/freeze/silence range is intentional, from the shot it lies in — or null. */
export function justificationFor(ir, kind, fromFrame, toFrame) {
  const track = primaryVideoTrack(ir);
  if (!track) return null;
  const tol = QA_THRESHOLDS.justifyToleranceFrames;
  const clips = track.clips.map((c) => ({ c, s: c.start, e: c.start + clipDuration(c) }));
  const overlapping = clips.filter((x) => x.s < toFrame - tol && fromFrame + tol < x.e);
  if (overlapping.length) {
    const s = Math.min(...overlapping.map((x) => x.s)), e = Math.max(...overlapping.map((x) => x.e));
    const sameShot = overlapping.length === 1 || (overlapping[0].c.shotId && overlapping.every((x) => x.c.shotId === overlapping[0].c.shotId));
    if (sameShot && overlapping.every((x) => x.c.holdIntentional === true) && s - tol <= fromFrame && toFrame <= e + tol) {
      const c = overlapping[0].c;
      return { reason: `Cadrul „${c.id}”${c.shotId ? ` (shot ${c.shotId})` : ""} este marcat holdIntentional.`, clipId: c.id, shotId: c.shotId || null };
    }
  }
  if (kind === "black" && isDarkHex(ir.canvas?.background)) {
    for (const x of clips) {
      const t = x.c.transitionIn;
      if (t?.kind === "fade" && x.s - tol <= fromFrame && toFrame <= x.s + t.frames + tol) {
        return { reason: `Tranziție „fade” prin fundalul ${ir.canvas.background} la intrarea clipului „${x.c.id}”.`, clipId: x.c.id, shotId: x.c.shotId || null };
      }
    }
  }
  if (kind === "silence") {
    const audio = ir.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips);
    const covered = audio.some((a) => a.start < toFrame - tol && fromFrame + tol < a.start + (a.sourceOut - a.sourceIn));
    if (!covered) return { reason: "Intervalul nu are niciun clip audio în IR (liniște intenționată).", clipId: null, shotId: null };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout (pure)

function resolveProfile(profile, ir, preset) {
  if (profile && typeof profile === "string") return getProfile(profile);
  if (profile && typeof profile === "object" && profile.safeArea) return profile;
  return { key: null, label: "fără profil de platformă", canvas: ir?.canvas, safeArea: { ...DEFAULT_SAFE_AREA },
    captionDefaults: { anchor: preset?.captionStyle?.anchor || "bottom", maxChars: preset?.captionStyle?.maxChars || 42, maxLines: preset?.captionStyle?.maxLines || 2 } };
}

/** `layoutCheck({ ir, profile, presets })` → report { kind: "layout", status, findings, measurements }. */
export function layoutCheck({ ir, profile = null, presets = PRESETS, captionAnchor = null } = {}) {
  const { list, add } = makeCollector("layout");
  const v = validateIR(ir, { presets });
  if (!v.ok) {
    for (const e of v.errors.slice(0, 20)) add({ code: "IR_INVALID", severity: "error", criterion: "IR valid", message: `${e.path || "IR"}: ${e.message}`, evidence: { path: e.path, code: e.code }, proposedFix: "Corectează IR-ul înainte de QA." });
    return { kind: "layout", status: "FAIL", findings: list, measurements: { qaVersion: QA_VERSION } };
  }
  const nir = v.ir;
  const fps = nir.fps;
  const preset = presetForIR(nir, presets);
  const prof = resolveProfile(profile, nir, preset);
  const safe = safeRect(prof.safeArea);
  const canvas = nir.canvas;
  if (prof.canvas && Math.abs(prof.canvas.width / prof.canvas.height - canvas.width / canvas.height) > 0.01) {
    add({ code: "PROFILE_CANVAS_MISMATCH", severity: "error", criterion: "Raportul de aspect al platformei", message: `Canvasul ${canvas.width}×${canvas.height} nu are raportul profilului ${prof.label} (${prof.canvas.width}×${prof.canvas.height}).`,
      evidence: { canvas, profileCanvas: prof.canvas }, proposedFix: "Derivă o variantă pentru această platformă (deriveVariant)." });
  }
  const texts = nir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items.map((i) => ({ ...i, trackId: t.id })));
  const evidence = nir.evidenceRegions || [];
  const boxes = new Map();
  for (const item of texts) {
    const box = estimateTextBox(item, { canvas, preset });
    boxes.set(item.id, box);
    const r = box.rect;
    const range = frameRange(item.start, item.end, fps);
    const ev = { rect: roundRect(r), lines: box.lines, sizeRel: box.sizeRel, estimate: TEXT_METRICS.note };
    if (!containsRect(FULL_RECT, r, 1e-3)) {
      add({ code: "TEXT_OFF_CANVAS", severity: "error", criterion: "Textul este în întregime în cadru", message: `Textul „${clip30(item.text)}” iese din cadru.`, evidence: ev, range, itemId: item.id,
        proposedFix: "Mută textul spre centru sau scurtează-l.", fix: { op: "move_text", itemId: item.id, dx: round4(nudgeInto(r, safe).dx), dy: round4(nudgeInto(r, safe).dy) } });
    } else if (!containsRect(safe, r, 1e-3)) {
      const n = nudgeInto(r, safe);
      add({ code: "TEXT_OUTSIDE_SAFE_AREA", severity: "error", criterion: `Text în zona sigură ${prof.label}`, message: `Textul „${clip30(item.text)}” intră în zona acoperită de interfața platformei (${prof.label}).`,
        evidence: { ...ev, safeArea: prof.safeArea, profile: prof.key, source: prof.source || null }, range, itemId: item.id,
        proposedFix: `Mută textul cu ${fmtFrac(n.dy)} pe verticală${n.dx ? ` și ${fmtFrac(n.dx)} pe orizontală` : ""}.`, fix: { op: "move_text", itemId: item.id, dx: round4(n.dx), dy: round4(n.dy) } });
    }
    for (const e of evidence) {
      const tFrom = Math.max(item.start, e.from), tTo = Math.min(item.end, e.to);
      if (tTo <= tFrom) continue;
      const hit = intersectRect(r, e.rect);
      if (!hit) continue;
      const fix = freeSpot(r, e.rect, safe);
      add({ code: "TEXT_OVER_EVIDENCE", severity: "error", criterion: "Textul nu acoperă dovada", message: `Textul „${clip30(item.text)}” acoperă dovada clipului „${e.clipId}”${e.claimId ? ` (afirmația ${e.claimId})` : ""}.`,
        evidence: { textRect: roundRect(r), evidenceRect: e.rect, overlap: roundRect(hit), claimId: e.claimId ?? null }, range: frameRange(tFrom, tTo, fps), itemId: item.id, clipId: e.clipId,
        proposedFix: fix ? `Mută textul ${fix.dy < 0 ? "mai sus" : "mai jos"} cu ${fmtFrac(fix.dy)} (deasupra/dedesubtul dovezii, în zona sigură).` : "Scurtează textul sau afișează-l după intervalul dovezii.",
        fix: fix ? { op: "move_text", itemId: item.id, dx: 0, dy: round4(fix.dy) } : null });
    }
    if (box.overflow) add({ code: "TEXT_OVERFLOW", severity: "warning", criterion: "Cuvintele încap pe lățimea textului", message: `Textul „${clip30(item.text)}” are un cuvânt mai lung decât lățimea disponibilă.`, evidence: ev, range, itemId: item.id, proposedFix: "Mărește maxWidth sau scurtează cuvântul." });
    if (box.lines > QA_THRESHOLDS.textMaxLines) add({ code: "TEXT_TOO_MANY_LINES", severity: "warning", criterion: `Cel mult ${QA_THRESHOLDS.textMaxLines} rânduri`, message: `Textul „${clip30(item.text)}” are ${box.lines} rânduri (estimare).`, evidence: ev, range, itemId: item.id, proposedFix: "Scurtează textul sau împarte-l în două momente." });
    if (box.sizeRel < QA_THRESHOLDS.textMinSizeRel) add({ code: "TEXT_TOO_SMALL", severity: "warning", criterion: "Text lizibil pe telefon", message: `Textul „${clip30(item.text)}” este mic (${(box.sizeRel * 100).toFixed(1)}% din înălțime).`, evidence: ev, range, itemId: item.id, proposedFix: "Folosește un stil mai mare din preset." });
    const secs = framesToMs(item.end - item.start, fps) / 1000;
    const cps = [...normalizeRo(item.text)].length / Math.max(0.001, secs);
    if (cps > QA_THRESHOLDS.textMaxCps) add({ code: "TEXT_READ_TIME", severity: "warning", criterion: `Cel mult ${QA_THRESHOLDS.textMaxCps} caractere/s pe ecran`, message: `Textul „${clip30(item.text)}” stă ${secs.toFixed(1).replace(".", ",")} s pentru ${cps.toFixed(1).replace(".", ",")} caractere/s.`, evidence: { cps: Math.round(cps * 10) / 10 }, range, itemId: item.id, proposedFix: "Lasă textul mai mult pe ecran sau scurtează-l." });
  }
  // Text over text (different tracks, same time).
  for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
    const a = texts[i], b = texts[j];
    const tFrom = Math.max(a.start, b.start), tTo = Math.min(a.end, b.end);
    if (tTo <= tFrom) continue;
    const hit = intersectRect(boxes.get(a.id).rect, boxes.get(b.id).rect);
    if (hit) add({ code: "TEXT_OVERLAP", severity: "warning", criterion: "Textele nu se suprapun", message: `Textele „${clip30(a.text)}” și „${clip30(b.text)}” se suprapun pe ecran.`, evidence: { overlap: roundRect(hit) }, range: frameRange(tFrom, tTo, fps), itemId: a.id, otherItemId: b.id, proposedFix: "Mută unul dintre texte sau decalează-le în timp." });
  }
  // Captions.
  const capTrack = nir.tracks.find((t) => t.kind === "captions");
  let cueCount = 0;
  if (capTrack && capTrack.cues.length) {
    cueCount = capTrack.cues.length;
    const maxChars = Math.min(prof.captionDefaults?.maxChars || 42, preset?.captionStyle?.maxChars || 99);
    const maxLines = prof.captionDefaults?.maxLines || preset?.captionStyle?.maxLines || 2;
    for (const c of checkCues(capTrack.cues, { fps, durationFrames: timelineDuration(nir), maxChars, maxLines })) {
      const cue = capTrack.cues.find((q) => q.id === c.cueId);
      add({ code: c.code, severity: c.severity, criterion: "Lizibilitatea subtitrărilor", message: c.message, evidence: { cueId: c.cueId, maxChars, maxLines }, range: cue ? frameRange(cue.start, cue.end, fps) : null, cueId: c.cueId,
        proposedFix: /CPS/.test(c.code) ? "Împarte subtitrarea sau prelungește-o." : /LINE|LINES/.test(c.code) ? "Reformulează mai scurt sau împarte subtitrarea." : /SHORT/.test(c.code) ? "Ține subtitrarea cel puțin 0,8 s." : /CEDILLA/.test(c.code) ? "Folosește ș/ț cu virgulă (normalizeRo)." : "Corectează intervalul subtitrării." });
    }
    if (capTrack.burnIn !== false) {
      // The captions track's own layout is what compile renders (M09 review); the profile defaults apply only without one.
      const anchor = capTrack.layout?.anchor || captionAnchor || prof.captionDefaults?.anchor || "bottom";
      const capSafe = capTrack.layout?.safeArea || prof.safeArea;
      for (const cue of capTrack.cues) {
        const cb = estimateCaptionBox(cue, { canvas, preset, safeArea: capSafe, anchor, maxChars, maxLines });
        if (cb.overflow) add({ code: "CAPTION_TOO_WIDE", severity: "warning", criterion: "Subtitrarea încape în zona sigură", message: `Subtitrarea „${cue.id}” nu încape în lățimea zonei sigure (estimare).`, evidence: { rect: roundRect(cb.rect) }, range: frameRange(cue.start, cue.end, fps), cueId: cue.id, proposedFix: "Scurtează sau împarte subtitrarea." });
        for (const e of evidence) {
          const tFrom = Math.max(cue.start, e.from), tTo = Math.min(cue.end, e.to);
          if (tTo <= tFrom) continue;
          const hit = intersectRect(cb.rect, e.rect);
          if (hit) add({ code: "CAPTION_OVER_EVIDENCE", severity: "error", criterion: "Subtitrarea nu acoperă dovada", message: `Subtitrarea „${cue.id}” acoperă dovada clipului „${e.clipId}”.`, evidence: { captionRect: roundRect(cb.rect), evidenceRect: e.rect, overlap: roundRect(hit) }, range: frameRange(tFrom, tTo, fps), cueId: cue.id, clipId: e.clipId, proposedFix: "Mută subtitrările sus pentru acest interval (captionAnchor „top”) sau reîncadrează dovada." });
        }
        for (const item of texts) {
          const tFrom = Math.max(cue.start, item.start), tTo = Math.min(cue.end, item.end);
          if (tTo <= tFrom) continue;
          const hit = intersectRect(cb.rect, boxes.get(item.id).rect);
          if (hit) add({ code: "CAPTION_TEXT_OVERLAP", severity: "warning", criterion: "Subtitrarea nu se suprapune cu textul", message: `Subtitrarea „${cue.id}” se suprapune cu textul „${clip30(item.text)}”.`, evidence: { overlap: roundRect(hit) }, range: frameRange(tFrom, tTo, fps), cueId: cue.id, itemId: item.id, proposedFix: "Mută textul mai sus sau decalează-l." });
        }
      }
    }
  }
  return { kind: "layout", status: statusOf(list), findings: list,
    measurements: { qaVersion: QA_VERSION, profile: prof.key, profilesVersion: PLATFORM_PROFILES.profilesVersion, safeArea: prof.safeArea, source: prof.source || null,
      textItems: texts.length, cues: cueCount, evidenceRegions: evidence.length, textMetrics: TEXT_METRICS } };
}

const round4 = (v) => Math.round(v * 10000) / 10000;
const roundRect = (r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) });
const clip30 = (s) => { const t = normalizeRo(s).replace(/\n/g, " "); return t.length > 30 ? `${t.slice(0, 29)}…` : t; };
const fmtFrac = (v) => `${(Math.abs(v) * 100).toFixed(1).replace(".", ",")}% din cadru`;
/** Smallest move that puts `r` inside `safe` (when it fits). */
function nudgeInto(r, safe) {
  let dx = 0, dy = 0;
  if (r.x < safe.x) dx = safe.x - r.x; else if (r.x + r.w > safe.x + safe.w) dx = safe.x + safe.w - (r.x + r.w);
  if (r.y < safe.y) dy = safe.y - r.y; else if (r.y + r.h > safe.y + safe.h) dy = safe.y + safe.h - (r.y + r.h);
  return { dx, dy };
}
/** A vertical move that clears `ev` while staying inside `safe`, nearest first; null when there is no room. */
function freeSpot(r, ev, safe) {
  const gap = 0.01;
  const options = [ev.y - gap - r.h - r.y, ev.y + ev.h + gap - r.y]
    .filter((dy) => r.y + dy >= safe.y - 1e-6 && r.y + dy + r.h <= safe.y + safe.h + 1e-6);
  if (!options.length) return null;
  return { dy: options.sort((a, b) => Math.abs(a) - Math.abs(b))[0] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Factual (pure)

function claimsMap(claims) {
  const m = new Map();
  const list = Array.isArray(claims) ? claims : claims && typeof claims === "object" ? Object.values(claims) : [];
  for (const c of list) if (c && typeof c.id === "string") m.set(c.id, { id: c.id, status: c.status, text: c.text || "", evidence: Array.isArray(c.evidence) ? c.evidence : parse(c.evidence_json, []) || [] });
  return m;
}
function labelMatches(text, label) {
  const upper = normalizeRo(text).toLocaleUpperCase("ro-RO");
  return (LABEL_WORDS[label] || [label]).some((w) => new RegExp(`(?<![\\p{L}-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(upper));
}
/** Parts of [s, e) not covered by the intervals. */
function uncovered(s, e, intervals) {
  const sorted = intervals.map((i) => [Math.max(s, i[0]), Math.min(e, i[1])]).filter((i) => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = s;
  for (const [a, b] of sorted) { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < e) gaps.push([cur, e]);
  return gaps;
}

/** `factualCheck({ ir, claims, getVersion, presets })` → report { kind: "factual", … }. */
export function factualCheck({ ir, claims = [], getVersion = null, presets = PRESETS } = {}) {
  const { list, add } = makeCollector("factual");
  const v = validateIR(ir, { presets });
  if (!v.ok) {
    add({ code: "IR_INVALID", severity: "error", criterion: "IR valid", message: `IR invalid: ${v.errors[0]?.message || ""}`, evidence: { errors: v.errors.slice(0, 5) }, proposedFix: "Corectează IR-ul." });
    return { kind: "factual", status: "FAIL", findings: list, measurements: { qaVersion: QA_VERSION } };
  }
  const nir = v.ir;
  const fps = nir.fps;
  const preset = presetForIR(nir, presets);
  const byId = claimsMap(claims);
  const referenced = new Map();
  for (const c of primaryVideoTrack(nir).clips) for (const id of c.claimIds || []) if (!referenced.has(id)) referenced.set(id, { clipId: c.id, from: c.start, to: c.start + clipDuration(c) });
  for (const r of nir.evidenceRegions) if (r.claimId && !referenced.has(r.claimId)) referenced.set(r.claimId, { clipId: r.clipId, from: r.from, to: r.to });
  for (const [id, where] of referenced) {
    const claim = byId.get(id);
    const range = frameRange(where.from, where.to, fps);
    if (!claim) { add({ code: "CLAIM_UNKNOWN", severity: "error", criterion: "Fiecare afirmație are o înregistrare", message: `Afirmația „${id}” din clipul „${where.clipId}” nu există în proiectul de conținut.`, evidence: { claimId: id }, range, clipId: where.clipId, proposedFix: "Înregistrează afirmația cu dovada ei sau scoate referința." }); continue; }
    if (claim.status === "BLOCKED") add({ code: "CLAIM_BLOCKED", severity: "error", criterion: "Nicio afirmație blocată în video", message: `Afirmația „${clip30(claim.text)}” este BLOCKED și apare în clipul „${where.clipId}”.`, evidence: { claimId: id, status: claim.status }, range, clipId: where.clipId, proposedFix: "Scoate segmentul sau reformulează fără afirmația blocată." });
    else if (claim.status !== "SUPPORTED") add({ code: "CLAIM_NOT_SUPPORTED", severity: "error", criterion: "Afirmațiile publice au dovadă", message: `Afirmația „${clip30(claim.text)}” are starea ${claim.status || "necunoscută"} (fără dovadă confirmată).`, evidence: { claimId: id, status: claim.status }, range, clipId: where.clipId, proposedFix: "Atașează dovada (rulare, test, commit) și marchează afirmația SUPPORTED, sau formulează-o ca ipoteză." });
    else if (!claim.evidence.length) add({ code: "CLAIM_WITHOUT_EVIDENCE", severity: "error", criterion: "SUPPORTED înseamnă dovadă atașată", message: `Afirmația „${clip30(claim.text)}” este SUPPORTED fără nicio dovadă atașată.`, evidence: { claimId: id }, range, clipId: where.clipId, proposedFix: "Atașează dovada." });
  }
  // Disclosure labels: every SIMULATION/RECONSTRUCTION/REPLAY/GENERATED clip needs a visible on-screen label for its whole duration.
  const texts = nir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items);
  const visible = (item) => containsRect(FULL_RECT, estimateTextBox(item, { canvas: nir.canvas, preset }).rect, 0.02);
  const labels = new Set(nir.meta?.labels || []);
  let labelled = 0;
  for (const c of primaryVideoTrack(nir).clips) {
    const required = new Set();
    if (DISCLOSURE_LABELS.includes(c.label)) required.add(c.label);
    let version = null;
    try { version = typeof getVersion === "function" ? getVersion(c.assetVersionId) : null; } catch { version = null; }
    const capLabel = version?.capture_label ?? version?.captureLabel;
    if (DISCLOSURE_LABELS.includes(capLabel)) required.add(capLabel);
    const s = c.start, e = c.start + clipDuration(c);
    for (const label of required) {
      labelled += 1;
      const matching = texts.filter((i) => labelMatches(i.text, label) && visible(i)).map((i) => [i.start, i.end]);
      const gaps = uncovered(s, e, matching);
      const range = frameRange(s, e, fps);
      if (!matching.length || (gaps.length && gaps.reduce((n, g) => n + g[1] - g[0], 0) === e - s)) {
        add({ code: "LABEL_MISSING", severity: "error", criterion: "Etichetă de dezvăluire vizibilă", message: `Clipul „${c.id}” este ${label} (${LABEL_RO[label]}), dar nu are eticheta „${label}” pe ecran.`, evidence: { label, source: c.label === label ? "clip.label" : "asset.capture_label" }, range, clipId: c.id,
          proposedFix: `Adaugă un text cu stilul „label” „${label}” pe toată durata clipului (${range.label}).` });
      } else if (gaps.length) {
        const g = gaps[0];
        add({ code: "LABEL_PARTIAL", severity: "error", criterion: "Eticheta acoperă tot clipul", message: `Eticheta „${label}” lipsește pe o parte a clipului „${c.id}”.`, evidence: { label, gaps: gaps.map((x) => frameRange(x[0], x[1], fps)) }, range: frameRange(g[0], g[1], fps), clipId: c.id,
          proposedFix: "Prelungește eticheta pe toată durata clipului." });
      }
      if (!labels.has(label)) add({ code: "LABEL_NOT_DECLARED", severity: "warning", criterion: "meta.labels declară eticheta", message: `meta.labels nu declară ${label} (necesar pentru manifest și dezvăluire).`, evidence: { label }, range, clipId: c.id, proposedFix: `Adaugă „${label}” în meta.labels.` });
    }
  }
  return { kind: "factual", status: statusOf(list), findings: list, measurements: { qaVersion: QA_VERSION, claimsReferenced: referenced.size, claimsKnown: byId.size, labelledClips: labelled } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Editorial heuristics (pure)

/** `editorialCheck({ ir, brief })` → report { kind: "editorial", … } — heuristic checklist, warnings only. */
export function editorialCheck({ ir, brief = null, presets = PRESETS } = {}) {
  const { list, add } = makeCollector("editorial");
  const v = validateIR(ir, { presets });
  if (!v.ok) return { kind: "editorial", status: "NOT_RUN", findings: [], measurements: { qaVersion: QA_VERSION, heuristic: true, reason: "IR invalid" } };
  const nir = v.ir;
  const fps = nir.fps;
  const preset = presetForIR(nir, presets);
  const D = timelineDuration(nir);
  const Dms = framesToMs(D, fps);
  const texts = nir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items);
  const markers = nir.markers || [];
  const H = (ms) => msToFrames(ms, fps);
  // Hook ≤ 1 s.
  const hooks = [...texts.filter((i) => i.style === "hook").map((i) => i.start), ...markers.filter((m) => m.kind === "hook").map((m) => m.frame)].sort((a, b) => a - b);
  if (!hooks.length) add({ code: "HOOK_MISSING", severity: "warning", criterion: `Hook în prima secundă (euristic)`, message: "Nu există un hook marcat (text „hook” sau marker „hook”).", range: frameRange(0, Math.min(D, H(1000)), fps), proposedFix: "Adaugă un hook onest (ce se demonstrează) în prima secundă." });
  else if (hooks[0] > H(QA_THRESHOLDS.hookMaxMs)) add({ code: "HOOK_LATE", severity: "warning", criterion: "Hook în prima secundă (euristic)", message: `Hook-ul apare la ${fmtS(framesToMs(hooks[0], fps))}.`, range: frameRange(0, hooks[0], fps), proposedFix: "Mută hook-ul la început." });
  // Demo shots ≥ 2 s.
  const demoMin = Number(preset?.motion?.demoHoldMs) || QA_THRESHOLDS.demoMinMs;
  for (const m of markers.filter((x) => x.kind === "demo" || x.kind === "evidence")) {
    const c = primaryVideoTrack(nir).clips.find((k) => m.frame >= k.start && m.frame < k.start + clipDuration(k));
    if (c && framesToMs(clipDuration(c), fps) < demoMin) add({ code: "DEMO_TOO_SHORT", severity: "warning", criterion: `Cadrele demonstrative ≥ ${fmtS(demoMin)} (euristic)`, message: `Cadrul demonstrativ „${c.id}” durează ${fmtS(framesToMs(clipDuration(c), fps))}.`, range: frameRange(c.start, c.start + clipDuration(c), fps), clipId: c.id, proposedFix: "Ține demonstrația mai mult (extend_clip)." });
  }
  // CTA at the end.
  const ctas = [...texts.filter((i) => i.style === "cta").map((i) => ({ start: i.start, end: i.end })), ...markers.filter((m) => m.kind === "cta").map((m) => ({ start: m.frame, end: m.frame + 1 }))];
  const window = Math.max(0, D - H(Math.min(QA_THRESHOLDS.ctaWindowMs, Dms * 0.3)));
  if (!ctas.length) add({ code: "CTA_MISSING", severity: "warning", criterion: "CTA la final (euristic)", message: "Nu există un CTA (text „cta” sau marker „cta”).", range: frameRange(window, D, fps), proposedFix: "Adaugă un singur CTA la final." });
  else if (!ctas.some((c) => c.start >= window)) add({ code: "CTA_NOT_AT_END", severity: "warning", criterion: "CTA la final (euristic)", message: "CTA-ul nu este în ultimele secunde.", range: frameRange(ctas[0].start, ctas[0].end, fps), proposedFix: "Mută CTA-ul la final." });
  // No long intro: the first demo/evidence moment within 3 s.
  const firstSubstance = markers.filter((m) => m.kind === "demo" || m.kind === "evidence").map((m) => m.frame).concat((nir.evidenceRegions || []).map((r) => r.from)).sort((a, b) => a - b)[0];
  if (firstSubstance !== undefined && framesToMs(firstSubstance, fps) > QA_THRESHOLDS.introMaxMs) add({ code: "LONG_INTRO", severity: "warning", criterion: `Substanța în primele ${fmtS(QA_THRESHOLDS.introMaxMs)} (euristic)`, message: `Prima demonstrație/dovadă apare la ${fmtS(framesToMs(firstSubstance, fps))}.`, range: frameRange(0, firstSubstance, fps), proposedFix: "Scurtează introducerea (cut_range)." });
  // Duration vs brief.
  const target = Number(brief?.durationTargetS ?? brief?.body?.durationTargetS);
  if (Number.isFinite(target) && target > 0) {
    const ratio = Dms / 1000 / target;
    if (Math.abs(ratio - 1) > QA_THRESHOLDS.briefTolerance) add({ code: "DURATION_VS_BRIEF", severity: "warning", criterion: `Durata ±${QA_THRESHOLDS.briefTolerance * 100}% față de brief (euristic)`, message: `Editarea durează ${fmtS(Dms)}; brief-ul cere ~${target} s.`, evidence: { durationS: Math.round(Dms) / 1000, targetS: target }, proposedFix: ratio > 1 ? "Taie segmentele fără dovadă." : "Ține demonstrațiile mai mult." });
  }
  return { kind: "editorial", status: statusOf(list), findings: list, measurements: { qaVersion: QA_VERSION, heuristic: true, note: "Verificări euristice; onestitatea hook-ului și calitatea poveștii se judecă de proprietar.", durationMs: Math.round(Dms) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// createMediaQa

/**
 * `createMediaQa({ db, bus, clock, tools, paths, assets, rights, presets })` →
 * { technical, layout, factual, rightsCheck, editorial, run, summary, list, get }.
 */
export function createMediaQa({ db, bus, clock = () => new Date(), tools = null, paths = null, assets = null, rights = null, presets = PRESETS }) {
  if (!db || !bus) throw new Error("createMediaQa requires db and bus");
  const now = () => clock().toISOString();
  const busy = new Set();
  const getVersion = typeof assets?.getVersion === "function" ? (id) => assets.getVersion(id) : null;
  void paths;

  /**
   * M10 legibility, MEASURED on the rendered frame (not inferred from coordinates): for each content text item (disclosure labels
   * excluded) the frame at the item's midpoint is cut to the text's box and read as luma; pixels near the text colour are the text, the
   * rest is its background. Findings: LOW_CONTRAST_TEXT (WCAG-style ratio text/background < 4.5 → warning, < 3 → error) and
   * BUSY_BACKGROUND (a strongly varying background behind a text without a plate). A heuristic with stated limits: it reads one frame
   * per text and cannot judge a moving background or the viewer's screen. NOT_RUN when the tools or the file are not usable.
   */
  async function legibility({ assetVersionId, ir }) {
    const { list, add } = makeCollector("legibility");
    const measured = [];
    const notRun = (why) => ({ kind: "legibility", status: "NOT_RUN", findings: list, measurements: { qaVersion: QA_VERSION, reason: why, items: measured } });
    if (!assets || !tools || !paths) return notRun("unelte indisponibile");
    const v = assets.getVersion(assetVersionId);
    let abs;
    try { abs = assets.versionPath(assetVersionId); } catch { return notRun("fișierul randat nu e utilizabil"); }
    const W = v?.probe?.video?.displayWidth || v?.probe?.video?.width, H = v?.probe?.video?.displayHeight || v?.probe?.video?.height;
    if (!(W > 0 && H > 0)) return notRun("dimensiunile randării sunt necunoscute");
    const nir = normalizeIR(ir);
    const preset = presetForIR(nir, presets);
    const items = nir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).filter((i) => !isDisclosureText(i)).slice(0, 16);
    const dir = path.join(paths.work, "legibility");
    fs.mkdirSync(dir, { recursive: true });
    const toLin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lumOfHex = (hex) => { const m = String(hex || "#FFFFFF").replace("#", "").padEnd(6, "F"); const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)); return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b); };
    for (const item of items) {
      const style = preset?.textStyles?.[item.style] || {};
      const box = estimateTextBox(item, { canvas: nir.canvas, preset }).rect;
      const x0 = Math.max(0, Math.floor(box.x * W)), y0 = Math.max(0, Math.floor(box.y * H));
      const cw = Math.min(W - x0, Math.ceil(box.w * W)) & ~1, ch = Math.min(H - y0, Math.ceil(box.h * H)) & ~1;
      if (cw < 16 || ch < 8) continue;
      const sw = 160, sh = Math.max(8, Math.round((sw * ch) / cw / 2) * 2);
      const at = framesToMs(Math.floor((item.start + item.end) / 2), nir.fps) / 1000;
      const out = path.join(dir, `l-${newId("lg")}.raw`);
      try {
        const r = await tools.run({ tool: "ffmpeg", args: ["-loglevel", "error", "-ss", at.toFixed(3), ...inputArgs(abs), "-frames:v", "1", "-vf", `crop=${cw}:${ch}:${x0}:${y0},scale=${sw}:${sh}:flags=area,format=gray`, "-f", "rawvideo", "-y", out],
          key: `qa-leg-${assetVersionId}-${item.id}`, timeoutMs: 30000, collectStderr: true });
        if (r.code !== 0 || !fs.existsSync(out)) continue;
        const px = fs.readFileSync(out);
        if (px.length < sw * sh) continue;
        const textLuma = Math.round(255 * Math.cbrt(lumOfHex(style.color)) ); // rough display luma of the text colour
        const isText = (y) => Math.abs(y - textLuma) < 42;
        // The estimated box is a heuristic (no rasterization) and can be wider than the drawn text: the background is measured
        // around the text actually found in the frame (its pixels' bounding box, padded like the plate), not the whole estimate.
        let x0r = sw, y0r = sh, x1r = -1, y1r = -1, found = 0;
        // Strict colour match for locating the glyphs (a bright UI element near the text colour must not stretch the region).
        const isGlyph = (y) => Math.abs(y - textLuma) < 14;
        for (let yy = 0; yy < sh; yy += 1) for (let xx = 0; xx < sw; xx += 1) if (isGlyph(px[yy * sw + xx])) { found += 1; if (xx < x0r) x0r = xx; if (xx > x1r) x1r = xx; if (yy < y0r) y0r = yy; if (yy > y1r) y1r = yy; }
        let rx0 = 0, ry0 = 0, rx1 = sw - 1, ry1 = sh - 1;
        if (found >= 12) {
          const padPx = Math.max(2, Math.round(((Number(style.box?.padRel) || (item.plate ? 0.014 : 0.008)) * H) * (sw / cw)));
          rx0 = Math.max(0, x0r - padPx); ry0 = Math.max(0, y0r - padPx); rx1 = Math.min(sw - 1, x1r + padPx); ry1 = Math.min(sh - 1, y1r + padPx);
        }
        let n = 0, sum = 0, sum2 = 0, textN = 0;
        for (let yy = ry0; yy <= ry1; yy += 1) for (let xx = rx0; xx <= rx1; xx += 1) { const y = px[yy * sw + xx]; if (isText(y)) { textN += 1; continue; } n += 1; sum += y; sum2 += y * y; }
        const area = (rx1 - rx0 + 1) * (ry1 - ry0 + 1);
        if (n < area * 0.2) continue; // the region is almost all text colour: nothing to measure honestly
        const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
        const Lbg = toLin(Math.max(0, Math.min(255, mean)));
        const Lt = lumOfHex(style.color);
        const ratio = (Math.max(Lt, Lbg) + 0.05) / (Math.min(Lt, Lbg) + 0.05);
        const plated = item.plate === true || Boolean(style.box && item.plate !== false);
        const m = { itemId: item.id, atS: Number(at.toFixed(2)), ratio: Number(ratio.toFixed(2)), backgroundLuma: Math.round(mean), backgroundSd: Math.round(sd), textShare: Number((textN / area).toFixed(2)), plated, region: found >= 12 ? "text" : "estimate" };
        measured.push(m);
        const range = { from: item.start, to: item.end };
        if (ratio < 3) add({ code: "LOW_CONTRAST_TEXT", severity: "error", criterion: "Contrast text/fundal ≥ 4,5 (măsurat pe cadru)", message: `Textul „${String(item.text).slice(0, 40)}” are contrast ${m.ratio}:1 față de fundal la ${fmtS(at * 1000)}: practic ilizibil.`, evidence: m, at: { fromFrame: range.from, toFrame: range.to }, proposedFix: "Pune o plăcuță de fundal (plate) sau mută textul pe o zonă calmă." });
        else if (ratio < 4.5) add({ code: "LOW_CONTRAST_TEXT", severity: "warning", criterion: "Contrast text/fundal ≥ 4,5 (măsurat pe cadru)", message: `Textul „${String(item.text).slice(0, 40)}” are contrast ${m.ratio}:1 la ${fmtS(at * 1000)}.`, evidence: m, at: { fromFrame: range.from, toFrame: range.to }, proposedFix: "Plăcuță de fundal sau text mai mare." });
        // (A plate's opacity is not judged from one frame — anti-aliased glyph edges dominate a tight region. It is guaranteed by
        // construction instead: compile.mjs draws an item's plate at ≥ 0.9 opacity; test M10-ST-13.)
        if (!plated && sd > 38) add({ code: "BUSY_BACKGROUND", severity: "warning", criterion: "Fundal calm sub text fără plăcuță", message: `Sub textul „${String(item.text).slice(0, 40)}” fundalul variază puternic (σ ${m.backgroundSd}) la ${fmtS(at * 1000)}: se citește greu.`, evidence: m, at: { fromFrame: range.from, toFrame: range.to }, proposedFix: "Activează plăcuța (plate: true) sau mută textul." });
      } catch { /* one unreadable frame does not fail QA; it is simply not measured */ }
      finally { fs.rmSync(out, { force: true }); }
    }
    if (!measured.length) return notRun(items.length ? "niciun cadru măsurabil" : "niciun text de conținut");
    return { kind: "legibility", status: statusOf(list), findings: list, measurements: { qaVersion: QA_VERSION, heuristic: true, note: "Un cadru pe text; fundalul în mișcare și ecranul privitorului nu sunt măsurate.", items: measured } };
  }

  /** ffprobe + one analysis pass. Never persists; `run` does. */
  async function technical({ assetVersionId, ir = null, key = null, timeoutMs = null } = {}) {
    if (!assets || !tools) throw new HubError("internal", "QA tehnic are nevoie de biblioteca media și de unelte.", { code: "QA_DEPS_MISSING" });
    const { list, add } = makeCollector("technical");
    const startedAt = now();
    const version = assets.getVersion(assetVersionId);
    if (!version) throw new HubError("not_found", "Versiunea media nu există.", { code: "MEDIA_VERSION_MISSING" });
    const measurements = { qaVersion: QA_VERSION, thresholds: QA_THRESHOLDS, assetVersionId: version.id, sha256: version.sha256, startedAt };
    const done = (status) => ({ kind: "technical", status, findings: list, measurements: { ...measurements, finishedAt: now() } });
    const nir = ir ? normalizeIR(ir) : null;
    const fps = nir?.fps || null;
    // A render's expected picture size follows its profile (a draft is rendered at half resolution by design).
    const renderProfile = db.prepare("SELECT profile FROM media_render_jobs WHERE output_asset_version_id = ? ORDER BY created_at DESC LIMIT 1").get(version.id)?.profile || "final";
    measurements.renderProfile = renderProfile;
    let abs;
    try { abs = assets.versionPath(version.id); }
    catch (error) {
      if (/MEDIA_(QUARANTINED|MISSING)|MEDIA_FILE_MISSING/.test(String(error?.code))) {
        add({ code: "RENDER_UNUSABLE", severity: "error", criterion: "Fișierul randat există și se decodează", message: `Fișierul randat nu poate fi folosit: ${error.message}`, evidence: { code: error.code }, proposedFix: "Randează din nou." });
        return done("FAIL");
      }
      throw error;
    }
    let probe;
    try { probe = await tools.probe(abs, { timeoutMs: 60000 }); }
    catch (error) {
      if (error?.code === "TOOL_MISSING" || error?.code === "TIMEOUT" || error?.code === "CANCELLED") {
        add({ code: error.code === "TOOL_MISSING" ? "TOOL_MISSING" : "ANALYSIS_INTERRUPTED", severity: "info", criterion: "QA tehnic rulat", message: `QA tehnic nu a rulat: ${error.message}`, evidence: { code: error.code }, proposedFix: error.code === "TOOL_MISSING" ? "Instalează ffmpeg/ffprobe (pachetul MEDIA_A)." : "Reia QA." });
        return done("NOT_RUN");
      }
      if (error?.code === "UNDECODABLE") {
        add({ code: "UNDECODABLE", severity: "error", criterion: "Fișierul randat se decodează", message: error.message, evidence: { code: error.code }, proposedFix: "Randează din nou." });
        return done("FAIL");
      }
      throw error;
    }
    measurements.probe = { container: probe.container, durationMs: probe.durationMs, video: probe.video ? { codec: probe.video.codec, width: probe.video.displayWidth ?? probe.video.width, height: probe.video.displayHeight ?? probe.video.height, fps: probe.video.fps, pixFmt: probe.video.pixFmt } : null,
      audio: probe.audio ? { codec: probe.audio.codec, sampleRate: probe.audio.sampleRate, channels: probe.audio.channels } : null };
    const durMs = probe.durationMs;
    const rFps = fps || probe.video?.fps || { num: 30, den: 1 };
    // Structure against the IR.
    if (nir) {
      const expectedMs = framesToMs(timelineDuration(nir), nir.fps);
      const tol = framesToMs(1, nir.fps) + QA_THRESHOLDS.durationToleranceMs;
      if (!Number.isFinite(durMs) || Math.abs(durMs - expectedMs) > tol) add({ code: "DURATION_MISMATCH", severity: "error", criterion: "Durata = timeline ± 1 cadru + 50 ms", message: `Randarea durează ${Number.isFinite(durMs) ? fmtS(durMs) : "necunoscut"}, timeline-ul ${fmtS(expectedMs)}.`, evidence: { measuredMs: durMs, expectedMs: Math.round(expectedMs), toleranceMs: Math.round(tol) }, proposedFix: "Randează din nou versiunea corectă." });
      const w = probe.video?.displayWidth ?? probe.video?.width, h = probe.video?.displayHeight ?? probe.video?.height;
      const expectedCanvas = renderProfile === "draft" ? profileCanvas(nir.canvas, "draft") : { width: nir.canvas.width, height: nir.canvas.height };
      if (!probe.hasVideo) add({ code: "VIDEO_MISSING", severity: "error", criterion: "Randarea are video", message: "Randarea nu are flux video.", proposedFix: "Randează din nou." });
      else if (w !== expectedCanvas.width || h !== expectedCanvas.height) add({ code: "DIMENSIONS_MISMATCH", severity: "error", criterion: `Dimensiuni = canvas (profil ${renderProfile})`, message: `Randarea are ${w}×${h}, așteptat ${expectedCanvas.width}×${expectedCanvas.height} (canvas ${nir.canvas.width}×${nir.canvas.height}, profil ${renderProfile}).`, evidence: { measured: { w, h }, expected: nir.canvas }, proposedFix: "Randează profilul final la dimensiunea canvasului." });
      if (probe.video?.fps && Math.abs(fpsValue(probe.video.fps) - fpsValue(nir.fps)) > 0.01) add({ code: "FPS_MISMATCH", severity: "warning", criterion: "Cadre/s = IR", message: `Randarea are ${fpsValue(probe.video.fps).toFixed(3)} cadre/s, IR-ul ${fpsValue(nir.fps).toFixed(3)}.`, evidence: { measured: probe.video.fps, expected: nir.fps }, proposedFix: "Randează la cadența IR-ului." });
      const expectsAudio = nir.tracks.some((t) => t.kind === "audio" && t.clips.length);
      if (expectsAudio && !probe.hasAudio) add({ code: "AUDIO_MISSING", severity: "error", criterion: "Audio prezent când IR-ul are sunet", message: "IR-ul are clipuri audio, dar randarea nu are flux audio.", proposedFix: "Verifică mixajul și randează din nou." });
    }
    if (probe.video?.pixFmt && probe.video.pixFmt !== "yuv420p") add({ code: "PIXFMT_COMPAT", severity: "warning", criterion: "yuv420p pentru compatibilitate", message: `Formatul de pixeli este ${probe.video.pixFmt}; platformele cer de obicei yuv420p.`, evidence: { pixFmt: probe.video.pixFmt }, proposedFix: "Randează cu -pix_fmt yuv420p." });
    if (probe.isImage || (!probe.hasVideo && !probe.hasAudio)) { measurements.analysis = "skipped"; return done(statusOf(list)); }

    // One analysis pass; every stderr line is parsed as it streams.
    const T = QA_THRESHOLDS;
    const chains = [];
    if (probe.hasVideo) chains.push(`[0:v:0]blackdetect=d=${T.blackMinS}:pix_th=${T.blackPixTh}:pic_th=${T.blackPicTh},freezedetect=n=${T.freezeNoiseDb}dB:d=${T.freezeMinS}[vq]`);
    if (probe.hasAudio) chains.push(`[0:a:0]ebur128=peak=true,silencedetect=n=${T.silenceNoiseDb}dB:d=${T.silenceMinS}[aq]`);
    const args = ["-loglevel", "info", "-nostats", ...inputArgs(abs), "-filter_complex", chains.join(";"),
      ...(probe.hasVideo ? ["-map", "[vq]"] : []), ...(probe.hasAudio ? ["-map", "[aq]"] : []), "-f", "null", "-"];
    const parser = createAnalysisParser();
    const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : Math.min(2 * 3600 * 1000, Math.max(60000, (Number(durMs) || 0) * 3 + 60000));
    let r;
    try { r = await tools.run({ tool: "ffmpeg", args, key: key || `media:qa:${version.id}:${newId("q")}`, timeoutMs: limit, collectStderr: false, onStderrLine: (line) => parser.feed(line), maxStdoutLines: 100 }); }
    catch (error) {
      if (error?.code === "TOOL_MISSING") { add({ code: "TOOL_MISSING", severity: "info", criterion: "QA tehnic rulat", message: `QA tehnic nu a rulat: ${error.message}`, proposedFix: "Instalează ffmpeg (pachetul MEDIA_A)." }); return done("NOT_RUN"); }
      throw error;
    }
    const a = parser.result(Number.isFinite(durMs) ? durMs / 1000 : null);
    measurements.analysis = { exitCode: r.code, durationMs: r.durationMs, stderrLines: a.lines, args: args.filter((x) => x !== abs) };
    if (r.timedOut || r.cancelled) {
      add({ code: "ANALYSIS_INTERRUPTED", severity: "info", criterion: "QA tehnic complet", message: r.timedOut ? "Analiza a depășit timpul alocat." : "Analiza a fost anulată.", proposedFix: "Reia QA." });
      return done("NOT_RUN");
    }
    if (r.code !== 0) add({ code: "ANALYSIS_FAILED", severity: "error", criterion: "Fișierul se decodează integral", message: `Analiza ffmpeg a eșuat (cod ${r.code}).`, evidence: { exitCode: r.code, samples: a.decodeErrors.samples }, proposedFix: "Randează din nou; fișierul pare deteriorat." });
    if (a.decodeErrors.count) add({ code: "DECODE_ERRORS", severity: "error", criterion: "Fără erori de decodare", message: `${a.decodeErrors.count} erori de decodare raportate de ffmpeg.`, evidence: a.decodeErrors, proposedFix: "Randează din nou." });
    measurements.events = { black: a.black, freeze: a.freeze, silence: a.silence };
    measurements.loudness = { ...a.loudness, targetLufs: nir?.loudness?.targetLufs ?? -14, maxTruePeakDb: nir?.loudness?.maxTruePeakDb ?? -1,
      note: "Țintă editorială internă (−14 LUFS integrat, −1 dBTP), nu un standard de platformă." };

    const mapEvent = (kind, e) => {
      const range = rangeOf(e.startS * 1000, e.endS * 1000, rFps);
      const just = nir ? justificationFor(nir, kind, range.fromFrame, range.toFrame) : null;
      return { range, just };
    };
    for (const e of a.black) {
      const { range, just } = mapEvent("black", e);
      add({ code: "BLACK_SEGMENT", severity: "error", criterion: `Fără cadre negre ≥ ${T.blackMinS} s neintenționate`, message: `Cadru negru ${range.label} (${e.durationS.toFixed(2).replace(".", ",")} s).`,
        evidence: { filter: "blackdetect", startS: e.startS, endS: e.endS, durationS: e.durationS, pixTh: T.blackPixTh, picTh: T.blackPicTh }, range,
        proposedFix: "Scoate intervalul (cut_range) sau marchează cadrul holdIntentional dacă negrul este voit.", justified: Boolean(just), justification: just?.reason || null, clipId: just?.clipId || undefined });
    }
    for (const e of a.freeze) {
      // A frozen black range is already reported as black.
      if (a.black.some((b) => b.startS <= e.startS + 0.1 && e.endS <= b.endS + 0.1)) continue;
      const { range, just } = mapEvent("freeze", e);
      add({ code: "FROZEN_SEGMENT", severity: "warning", criterion: `Fără imagine înghețată ≥ ${T.freezeMinS} s neintenționată`, message: `Imagine înghețată ${range.label} (${e.durationS.toFixed(2).replace(".", ",")} s).`,
        evidence: { filter: "freezedetect", startS: e.startS, endS: e.endS, durationS: e.durationS, noiseDb: T.freezeNoiseDb, openEnded: Boolean(e.openEnded) }, range,
        proposedFix: "Scurtează sau acoperă cu mișcare (zoom), ori marchează cadrul holdIntentional dacă pauza este voită.", justified: Boolean(just), justification: just?.reason || null, clipId: just?.clipId || undefined });
    }
    for (const e of a.silence) {
      const { range, just } = mapEvent("silence", e);
      add({ code: "SILENCE", severity: "warning", criterion: `Fără liniște ≥ ${T.silenceMinS} s neintenționată (prag ${T.silenceNoiseDb} dB)`, message: `Liniște ${range.label} (${e.durationS.toFixed(2).replace(".", ",")} s).`,
        evidence: { filter: "silencedetect", startS: e.startS, endS: e.endS, durationS: e.durationS, noiseDb: T.silenceNoiseDb, openEnded: Boolean(e.openEnded) }, range,
        proposedFix: "Verifică mixajul (muzică/voce) sau marchează intervalul fără audio în IR dacă liniștea este voită.", justified: Boolean(just), justification: just?.reason || null, clipId: just?.clipId || undefined });
    }
    // An IR without any audio clip is silent by design: the (silent) audio stream is not held to a loudness target.
    const irHasAudio = nir ? nir.tracks.some((t) => t.kind === "audio" && t.clips.length) : true;
    if (!irHasAudio) measurements.loudness.note = "IR-ul nu are clipuri audio: liniște intenționată, fără țintă de loudness.";
    if (probe.hasAudio && irHasAudio) {
      const L = a.loudness, target = measurements.loudness.targetLufs, maxTp = measurements.loudness.maxTruePeakDb;
      if (!Number.isFinite(L.integratedLufs)) add({ code: "LOUDNESS_UNMEASURABLE", severity: "warning", criterion: "Loudness măsurabil", message: "Loudness-ul integrat nu a putut fi măsurat (audio aproape mut).", evidence: { integratedLufs: L.integratedLufs }, proposedFix: "Verifică mixajul audio." });
      else if (Math.abs(L.integratedLufs - target) > T.loudnessToleranceLu) add({ code: "LOUDNESS_OFF_TARGET", severity: "warning", criterion: `Loudness integrat ${fmtDb(target)} LUFS ± ${T.loudnessToleranceLu} LU (țintă internă)`, message: `Loudness integrat ${fmtDb(L.integratedLufs)} LUFS (țintă ${fmtDb(target)} LUFS).`, evidence: { integratedLufs: L.integratedLufs, targetLufs: target, lraLu: L.lraLu }, proposedFix: `Normalizează la ${fmtDb(target)} LUFS în randarea finală.` });
      if (Number.isFinite(L.truePeakDbfs) && L.truePeakDbfs > maxTp + T.truePeakMarginDb) add({ code: "TRUE_PEAK_OVER", severity: "error", criterion: `Vârf real ≤ ${fmtDb(maxTp)} dBTP`, message: `Vârful real este ${fmtDb(L.truePeakDbfs)} dBTP (maxim ${fmtDb(maxTp)}).`, evidence: { truePeakDbfs: L.truePeakDbfs, maxTruePeakDb: maxTp }, proposedFix: "Aplică un limitator true-peak la −1 dBTP." });
    }
    return done(statusOf(list));
  }

  const layout = ({ ir, profile = null, captionAnchor = null } = {}) => layoutCheck({ ir, profile, presets, captionAnchor });
  const factual = ({ ir, claims = [] } = {}) => factualCheck({ ir, claims, getVersion, presets });
  const editorial = ({ ir, brief = null } = {}) => editorialCheck({ ir, brief, presets });

  /** Rights of every asset the IR uses, for the platform (profile key or rights platform) and use. */
  function rightsCheck({ ir, platform = null, use = "organic", at = null } = {}) {
    const { list, add } = makeCollector("rights");
    if (!rights) { add({ code: "RIGHTS_NOT_CHECKED", severity: "info", criterion: "Drepturi verificate", message: "Serviciul de drepturi nu este disponibil.", proposedFix: "" }); return { kind: "rights", status: "NOT_RUN", findings: list, measurements: { qaVersion: QA_VERSION } }; }
    const v = validateIR(ir, { presets });
    const ids = v.dependencies.assetVersionIds;
    const rightsPlatform = platform ? PLATFORM_PROFILES[platform]?.rightsPlatform || platform : null;
    if (!platform) add({ code: "PLATFORM_UNSPECIFIED", severity: "warning", criterion: "Drepturi pentru platforma țintă", message: "Evaluare fără platformă: contează doar drepturile acordate pentru toate platformele (*).", proposedFix: "Rulează QA pentru varianta fiecărei platforme." });
    const res = rights.evaluateAssets({ versionIds: ids, platform: rightsPlatform, use, at });
    for (const b of res.blocking) {
      add({ code: "RIGHTS_BLOCKED", severity: "error", criterion: `Drepturi clarificate pentru ${rightsPlatform || "toate platformele"} (${use})`, message: `Materialul ${b.versionId} nu poate fi folosit: ${b.reasons.map((x) => x.message || x.code).join("; ")}.`,
        evidence: { versionId: b.versionId, status: b.status, reasons: b.reasons }, assetVersionId: b.versionId, proposedFix: "Înregistrează drepturile pentru acest scop sau înlocuiește materialul." });
    }
    for (const item of res.items) for (const w of item.warnings || []) add({ code: `RIGHTS_${w.code}`, severity: "warning", criterion: "Drepturi fără ambiguități", message: w.message || w.code, evidence: { versionId: item.versionId, ...w }, assetVersionId: item.versionId, proposedFix: "Clarifică originea materialului." });
    if (res.requiresDisclosure) add({ code: "DISCLOSURE_REQUIRED", severity: "warning", criterion: "Dezvăluirea conținutului generat", message: "Materialele includ conținut generat AI: manifestul trebuie să declare dezvăluirea la publicare.", evidence: { versionIds: res.items.filter((i) => i.requiresDisclosure).map((i) => i.versionId) }, proposedFix: "Bifează dezvăluirea în manifest și păstrează eticheta GENERATED pe ecran." });
    return { kind: "rights", status: statusOf(list), findings: list, measurements: { qaVersion: QA_VERSION, platform: rightsPlatform, use, assetVersionIds: ids, scope: res.scope } };
  }

  // ---------- persistence ----------
  const insReport = db.prepare(`INSERT INTO media_qa_reports (id, edit_version_id, render_job_id, asset_version_id, kind, status, findings_json, measurements_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const mapReport = (r) => r && ({ id: r.id, editVersionId: r.edit_version_id, renderJobId: r.render_job_id, assetVersionId: r.asset_version_id, kind: r.kind, status: r.status,
    findings: parse(r.findings_json, []), measurements: parse(r.measurements_json, {}), createdBy: r.created_by, createdAt: r.created_at });

  /**
   * Runs every check for an edit version and persists one row per DB kind. `assetVersionId` defaults to the latest DONE render of the
   * version; without a render the technical report is NOT_RUN (with the reason). → { runId, status, reports, reportIds }
   */
  async function run({ editVersionId, assetVersionId = null, renderJobId = null, platform = null, brief = undefined, claims = undefined, use = "organic", at = null, actor = "system:qa" } = {}) {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    const row = db.prepare("SELECT * FROM media_edit_versions WHERE id = ?").get(String(editVersionId || ""));
    if (!row) throw new HubError("not_found", "Versiunea de editare nu există.", { code: "EDIT_VERSION_MISSING" });
    const ir = parse(row.ir_json, null);
    if (!ir || irHash(ir) !== row.ir_sha256) throw new HubError("conflict", "IR-ul versiunii nu corespunde amprentei sale (sha256).", { code: "EDIT_VERSION_TAMPERED" });
    if (busy.has(row.id)) throw new HubError("conflict", "QA rulează deja pentru această versiune.", { code: "QA_BUSY" });
    busy.add(row.id);
    try {
      const variant = db.prepare("SELECT platform_key FROM media_variants WHERE variant_version_id = ? ORDER BY created_at DESC LIMIT 1").get(row.id);
      const profileKey = platform && PLATFORM_PROFILES[platform] ? platform : row.variant_key && PLATFORM_PROFILES[row.variant_key] ? row.variant_key : variant?.platform_key && PLATFORM_PROFILES[variant.platform_key] ? variant.platform_key : null;
      const rightsPlatform = profileKey || platform || null;
      let renderJob = renderJobId;
      let target = assetVersionId;
      if (!target) {
        const job = db.prepare(`SELECT id, output_asset_version_id FROM media_render_jobs WHERE edit_version_id = ? AND status = 'DONE' AND output_asset_version_id IS NOT NULL
          ORDER BY CASE profile WHEN 'final' THEN 0 ELSE 1 END, finished_at DESC, created_at DESC LIMIT 1`).get(row.id);
        if (job) { target = job.output_asset_version_id; renderJob = renderJob || job.id; }
      }
      let claimList = claims;
      if (claimList === undefined) {
        const ids = new Set();
        const nir = normalizeIR(ir);
        for (const t of nir.tracks || []) if (t.kind === "video") for (const c of t.clips || []) for (const id of c.claimIds || []) ids.add(id);
        for (const r of nir.evidenceRegions || []) if (r.claimId) ids.add(r.claimId);
        claimList = ids.size ? db.prepare(`SELECT id, text, status, evidence_json FROM content_claims WHERE id IN (${[...ids].map(() => "?").join(",")})`).all(...ids)
          .map((c) => ({ id: c.id, text: c.text, status: c.status, evidence: parse(c.evidence_json, []) })) : [];
      }
      let briefBody = brief;
      if (briefBody === undefined) {
        const project = db.prepare("SELECT content_project_id FROM media_edit_projects WHERE id = ?").get(row.edit_project_id);
        const b = project?.content_project_id ? db.prepare("SELECT body_json FROM content_briefs WHERE content_project_id = ? ORDER BY version DESC LIMIT 1").get(project.content_project_id) : null;
        briefBody = b ? parse(b.body_json, null) : null;
      }
      let tech;
      if (target) tech = await technical({ assetVersionId: target, ir });
      else {
        const { list, add } = makeCollector("technical");
        add({ code: "NO_RENDER", severity: "info", criterion: "QA tehnic pe randare", message: "Nu există o randare terminată pentru această versiune; QA tehnic nu a rulat.", proposedFix: "Randează versiunea (draft sau final) și rulează din nou QA." });
        tech = { kind: "technical", status: "NOT_RUN", findings: list, measurements: { qaVersion: QA_VERSION } };
      }
      const lay = layout({ ir, profile: profileKey });
      const edi = editorial({ ir, brief: briefBody });
      const fac = factual({ ir, claims: claimList });
      const rig = rightsCheck({ ir, platform: rightsPlatform, use, at });
      // M10: legibility measured on the rendered file (part of the editorial row; NOT_RUN without a usable render).
      const leg = target && tech.status !== "FAIL" ? await legibility({ assetVersionId: target, ir }).catch(() => ({ kind: "legibility", status: "NOT_RUN", findings: [], measurements: { reason: "eroare la măsurare" } }))
        : { kind: "legibility", status: "NOT_RUN", findings: [], measurements: { reason: target ? "randarea nu a trecut QA tehnic" : "fără randare" } };
      const editorialRow = { status: worstStatus([lay.status, edi.status === "NOT_RUN" ? null : edi.status, leg.status === "NOT_RUN" ? null : leg.status]), findings: [...lay.findings, ...edi.findings, ...leg.findings],
        measurements: { qaVersion: QA_VERSION, layout: lay.measurements, editorial: edi.measurements, legibility: leg.measurements, statuses: { layout: lay.status, editorial: edi.status, legibility: leg.status } } };
      const runId = newId("mqr");
      const createdAt = now();
      const status = worstStatus([tech.status, editorialRow.status, fac.status, rig.status]);
      const ids = {};
      bus.transaction(() => {
        const put = (kind, rep, extra = {}) => {
          const id = newId("mqa");
          ids[kind] = id;
          insReport.run(id, row.id, kind === "technical" ? renderJob || null : null, kind === "technical" ? target || null : null, kind, rep.status,
            json(rep.findings), json({ ...rep.measurements, runId, irSha256: row.ir_sha256, profile: profileKey, ...extra }), actor.trim(), createdAt);
        };
        put("technical", tech);
        put("editorial", editorialRow);
        put("factual", fac);
        put("rights", rig);
        bus.append({ type: "media.qa.reported", scopeType: "media_edit_version", scopeId: row.id, source: actor.trim(),
          payload: { runId, editVersionId: row.id, assetVersionId: target || null, renderJobId: renderJob || null, status, profile: profileKey,
            statuses: { technical: tech.status, layout: lay.status, editorial: edi.status, legibility: leg.status, factual: fac.status, rights: rig.status },
            errors: [tech, lay, edi, leg, fac, rig].reduce((n, r) => n + r.findings.filter((f) => f.severity === "error" && !f.justified).length, 0) } });
      });
      return { runId, status, editVersionId: row.id, assetVersionId: target || null, profile: profileKey,
        reports: { technical: tech, layout: lay, editorial: edi, legibility: leg, factual: fac, rights: rig }, reportIds: ids };
    } finally { busy.delete(row.id); }
  }

  /** Latest persisted row per kind for an edit version → { status, kinds, findings (unjustified errors/warnings), at }. */
  function summary(editVersionId) {
    const rows = db.prepare("SELECT * FROM media_qa_reports WHERE edit_version_id = ? ORDER BY created_at DESC, rowid DESC").all(String(editVersionId || ""));
    const latest = new Map();
    for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, mapReport(r));
    const kinds = Object.fromEntries([...latest].map(([k, r]) => [k, r.status]));
    const findings = [...latest.values()].flatMap((r) => r.findings.filter((f) => !f.justified && (f.severity === "error" || f.severity === "warning")).map((f) => ({ ...f, kind: r.kind }))).slice(0, 50);
    return { status: worstStatus([...latest.values()].map((r) => r.status)), kinds, findings, at: rows[0]?.created_at || null };
  }
  const get = (id) => mapReport(db.prepare("SELECT * FROM media_qa_reports WHERE id = ?").get(String(id || ""))) || null;
  const list = ({ editVersionId, limit = 100 } = {}) => db.prepare("SELECT * FROM media_qa_reports WHERE edit_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(String(editVersionId || ""), Math.min(1000, Math.max(1, limit))).map(mapReport);

  return { technical, layout, factual, rightsCheck, editorial, run, summary, get, list };
}
