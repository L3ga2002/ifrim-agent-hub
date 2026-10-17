import { HubError } from "../core/errors.mjs";
import { canonicalJson, sha256 } from "../core/canonical.mjs";
import { clipHoldProblems, HOLD_REASONS, HOLD_LIMITS } from "./holds.mjs";

/**
 * EditProjectIR v1 — the single, explicit description of an edit. Every consumer reads THIS document and nothing else:
 * compile (ffmpeg render plan), QA (technical/layout/factual), variants (reframing per platform), review (patch ops),
 * editor exports (OTIO/EDL/CapCut-assisted pack) and the Studio UI. The IR never contains filters, expressions, shell
 * fragments or scripts: only the closed set of fields below. Anything else is rejected by `validateIR` (UNKNOWN_FIELD /
 * UNSUPPORTED_OP), so a backend can trust that it only has to map documented operations.
 *
 * Units and conventions
 * - Time: integer FRAMES of `fps` = { num, den } (rational: 30000/1001 = 29.97, 24000/1001 = 23.976). Milliseconds are
 *   derived, never stored (`framesToMs`, `framesToMsInt`), so timestamps never drift over long timelines.
 * - `sourceIn` / `sourceOut`: source range in frames AT THE IR FPS (half-open [sourceIn, sourceOut)). The source frame
 *   bound is floor(durationMs × fps). Still images: `sourceIn = 0`, `sourceOut` = hold length in frames, `speed = 1`
 *   (the duration comes from the timeline; there is no source bound).
 * - Clip duration on the timeline = round((sourceOut − sourceIn) / speed) (`clipDuration`).
 * - Geometry: normalized 0..1 of the source (crop, focus, keyframe centre) or of the canvas (text x/y/maxWidth, evidence
 *   rects are in canvas space of the master).
 * - Keyframe / envelope `frame` values are CLIP-RELATIVE timeline frames in [0, clipDuration − 1].
 * - Intervals are half-open: a text item [start, end) is visible on frames start … end − 1.
 *
 * Tracks (array order is significant only inside a track)
 * - exactly ONE `video` track (the primary track): clips contiguous; the first clip starts at 0;
 *   next.start = prev.start + clipDuration(prev) − (next.transitionIn?.frames || 0). A `crossfade` overlaps the previous
 *   clip (dissolve); a `fade` also overlaps but dips through `canvas.background`. On the FIRST clip only `fade` is allowed
 *   (fade-in from the background, no overlap). Transitions ≤ 1 s, shorter than both neighbours, and two transitions may
 *   not overlap inside one clip. Video clips are silent in the mix: to use a clip's own sound, add an audio-track clip
 *   with the same assetVersionId and matching ranges.
 * - `text` tracks (0..n): items with a preset text style; no overlap inside one track (use another track to stack).
 * - `audio` tracks (0..n): clips at speed 1 with gain, fades and a gain envelope; no overlap inside one track.
 * - `captions` track (0..1): cues sorted, no overlap; `burnIn` selects burned-in (libass) vs. sidecar only.
 * Text, audio, captions, markers and evidence regions must lie inside the primary timeline [0, timelineDuration).
 *
 * Supported operations v1 (see CAPABILITIES for what each backend does with them): trim, constant speed 0.25–4 (ramps are
 * unsupported), crop, fit cover|contain, keyframed zoom/pan (linear | inOut), transitions crossfade|fade (≤ 1 s), color
 * presets neutral|crisp|warm|cool|mono, text styles from the preset, captions, audio gain/fades/envelope, image stills,
 * loudness target.
 *
 * Asset checks (when `getVersion` is given): the version must exist and be READY (QUARANTINED / MISSING /
 * REMOVED_DERIVATIVE are refused), have the needed stream (video/audio) and cover the requested source range.
 *
 * Exports: IR_VERSION, constants, CAPABILITIES, validateIR, assertValidIR, normalizeIR, canonicalIR, irHash, frame helpers
 * (fpsValue, framesToMs, framesToMsInt, msToFrames, framesToTimecode, maxTransitionFrames), clipDuration,
 * timelineDuration, activeAt, clipAtFrame, opsUsed, checkBackend. Pure module: no I/O.
 */

export const IR_VERSION = 1;
export const COLOR_PRESETS = Object.freeze(["neutral", "crisp", "warm", "cool", "mono"]);
export const TRANSITION_KINDS = Object.freeze(["crossfade", "fade"]);
export const EASINGS = Object.freeze(["linear", "inOut"]);
export const FIT_MODES = Object.freeze(["cover", "contain"]);
export const TEXT_ANCHORS = Object.freeze(["top", "center", "bottom"]);
export const TEXT_ANIMATIONS = Object.freeze(["none", "fade", "slide_up"]);
export const AUDIO_ROLES = Object.freeze(["music", "voice", "sfx", "ambient"]);
export const CAPTION_STYLES = Object.freeze(["caption"]);
export const MARKER_KINDS = Object.freeze(["hook", "demo", "evidence", "cta", "beat", "chapter", "note"]);
export const TRACK_KINDS = Object.freeze(["video", "text", "audio", "captions"]);
/** Clip labels: what the footage IS. The disclosure labels require a visible on-screen label (QA factual). */
export const CLIP_LABELS = Object.freeze(["ORIGINAL_RECORDING", "REPLAY", "RECONSTRUCTION", "SIMULATION", "GENERATED"]);
export const DISCLOSURE_LABELS = Object.freeze(["REPLAY", "RECONSTRUCTION", "SIMULATION", "GENERATED"]);
export const LANGUAGES = Object.freeze(["ro", "en"]);
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const SCALE_MAX = 4;
export const LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024, tracks: 16, clips: 500, items: 1000, cues: 2000, keyframes: 64, envelope: 64, markers: 200,
  evidenceRegions: 200, claimIds: 20, labels: 8, text: 500, note: 2000, title: 200, maxFrames: 24 * 60 * 60 * 120,
});

/** Keys that name arbitrary processing; they get a specific refusal instead of the generic UNKNOWN_FIELD. */
const FORBIDDEN_OP_KEYS = new Set(["filter", "filters", "filter_complex", "filtercomplex", "vf", "af", "lavfi", "expr", "expression",
  "expressions", "script", "scripts", "shell", "command", "commands", "cmd", "exec", "args", "argv", "eval", "code", "plugin", "plugins",
  "effect", "effects", "lut", "graph", "ffmpeg", "template", "html", "css", "js", "url", "path", "file", "fontfile", "textfile"]);
const SPEED_RAMP_KEYS = new Set(["speedramp", "speedcurve", "timeremap", "ramp", "speedkeyframes", "timewarp"]);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const VERSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
// Control characters other than \n (and the BOM / bidi overrides, which can disguise text) are refused in free text.
// Non-ASCII code points are built with String.fromCharCode so this source file contains no invisible, bidi or cedilla
// characters itself.
const cp = (...codes) => String.fromCharCode(...codes);
const CONTROL_RE = new RegExp(`[\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}]`);
const CEDILLA_RE = new RegExp(`[${cp(0x15e, 0x15f, 0x162, 0x163)}]`);
/** The wrong (cedilla) forms, for messages. */
const CEDILLA_FORMS = `${cp(0x15f)}/${cp(0x163)}`;

const KEYS = {
  top: ["irVersion", "fps", "canvas", "preset", "language", "tracks", "markers", "evidenceRegions", "loudness", "meta"],
  fps: ["num", "den"],
  canvas: ["width", "height", "background"],
  preset: ["id", "version"],
  videoTrack: ["id", "kind", "clips"],
  textTrack: ["id", "kind", "items"],
  audioTrack: ["id", "kind", "clips"],
  captionsTrack: ["id", "kind", "burnIn", "style", "cues", "layout"],
  captionsLayout: ["anchor", "safeArea"],
  safeArea: ["top", "bottom", "left", "right"],
  videoClip: ["id", "assetVersionId", "sourceIn", "sourceOut", "start", "speed", "fit", "crop", "keyframes", "transitionIn", "focus",
    "shotId", "claimIds", "label", "holdIntentional", "color", "holds"],
  // R-MEDIA: an intentional pause measured in the capture (media/holds.mjs), in SOURCE frames of the clip's asset version.
  hold: ["id", "reason", "srcFrom", "srcTo", "maxFrames", "provenance"],
  holdProvenance: ["schema", "sessionId", "assetVersionId", "stepsSha", "step", "stepKind", "startMs", "endMs", "plannedMs", "maxMs", "postcondition"],
  rect: ["x", "y", "w", "h"],
  keyframe: ["frame", "scale", "cx", "cy", "ease"],
  transition: ["kind", "frames"],
  color: ["preset"],
  // M10: `plate` = a background plate behind the text (legibility over a busy frame); `scale` = the style size × 0.6–2 (a legible
  // minimum in a narrow variant). Both optional; the renderer and QA's text-box estimate read them the same way.
  textItem: ["id", "start", "end", "text", "style", "anchor", "x", "y", "maxWidth", "animation", "plate", "scale", "claimIds"],
  audioClip: ["id", "assetVersionId", "sourceIn", "sourceOut", "start", "role", "gainDb", "fadeIn", "fadeOut", "envelope"],
  envelopePoint: ["frame", "gainDb"],
  cue: ["id", "start", "end", "text"],
  marker: ["frame", "kind", "note"],
  evidence: ["clipId", "from", "to", "rect", "claimId"],
  loudness: ["targetLufs", "maxTruePeakDb"],
  meta: ["title", "labels", "author", "notes"],
};

// ---------------------------------------------------------------------------------------------------------------------
// Frame math (rational fps, integer arithmetic where the result is an integer timestamp)

function fpsParts(fps) {
  const num = Number(fps?.num), den = Number(fps?.den);
  if (!Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) throw new HubError("validation", "fps invalid: se așteaptă { num, den } întregi pozitive.");
  return { num, den };
}
/** Frames per second as a float (display only; never accumulate with it). */
export function fpsValue(fps) { const { num, den } = fpsParts(fps); return num / den; }
/** Exact milliseconds of a frame index (float). */
export function framesToMs(frames, fps) { const { num, den } = fpsParts(fps); return (frames * 1000 * den) / num; }
/** Milliseconds of a frame index rounded half-up with integer arithmetic (drift-free timestamps for SRT/VTT/ASS). */
export function framesToMsInt(frames, fps, unit = 1000) {
  const { num, den } = fpsParts(fps);
  if (!Number.isInteger(frames)) throw new HubError("validation", "Indexul de cadru trebuie să fie un număr întreg.");
  const sign = frames < 0 ? -1 : 1;
  const n = Math.abs(frames) * unit * den;
  return sign * Math.floor((2 * n + num) / (2 * num));
}
/** Frame index for a time in ms. rounding: "round" (nearest), "floor", "ceil". */
export function msToFrames(ms, fps, rounding = "round") {
  const { num, den } = fpsParts(fps);
  if (typeof ms !== "number" || !Number.isFinite(ms)) throw new HubError("validation", "Timpul (ms) trebuie să fie un număr finit.");
  const exact = (ms * num) / (1000 * den);
  const eps = 1e-9;
  if (rounding === "floor") return Math.floor(exact + eps);
  if (rounding === "ceil") return Math.ceil(exact - eps);
  return Math.round(exact);
}
/** Longest allowed transition (1 s) in frames: floor(fps). */
export function maxTransitionFrames(fps) { const { num, den } = fpsParts(fps); return Math.floor(num / den); }
/** Number of whole source frames available in a source of `durationMs` at the IR fps. */
export function sourceFramesAvailable(durationMs, fps) { return msToFrames(durationMs, fps, "floor"); }
/**
 * Non-drop-frame timecode HH:MM:SS:FF at the nominal rate round(fps) (EDL / editor tables). For 29.97 / 23.976 the label is
 * NDF: it counts frames, so it runs 0.1 % ahead of wall-clock time — exports must say NDF.
 */
export function framesToTimecode(frames, fps) {
  const nominal = Math.max(1, Math.round(fpsValue(fps)));
  const f = Math.max(0, Math.trunc(frames));
  const pad = (n) => String(n).padStart(2, "0");
  const ff = f % nominal, totalS = Math.floor(f / nominal);
  return `${pad(Math.floor(totalS / 3600))}:${pad(Math.floor(totalS / 60) % 60)}:${pad(totalS % 60)}:${pad(ff)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeline helpers (work on a valid IR; tolerant of missing optional fields)

export function clipDuration(clip) {
  const len = Number(clip?.sourceOut) - Number(clip?.sourceIn);
  const speed = clip?.speed === undefined ? 1 : Number(clip.speed);
  if (!Number.isFinite(len) || !Number.isFinite(speed) || speed <= 0) return 0;
  return Math.max(0, Math.round(len / speed));
}
const tracksOf = (ir, kind) => (Array.isArray(ir?.tracks) ? ir.tracks.filter((t) => t && t.kind === kind) : []);
export const primaryVideoTrack = (ir) => tracksOf(ir, "video")[0] || null;

/** Duration of the primary timeline in frames (end of the last clip). */
export function timelineDuration(ir) {
  const track = primaryVideoTrack(ir);
  if (!track || !Array.isArray(track.clips)) return 0;
  let end = 0;
  for (const clip of track.clips) end = Math.max(end, (Number(clip?.start) || 0) + clipDuration(clip));
  return end;
}

const sourceFrameAt = (clip, localFrame) => Math.floor((Number(clip.sourceIn) || 0) + localFrame * (clip.speed === undefined ? 1 : Number(clip.speed)));

/**
 * The primary-track clip that is on top at `frame` (during a transition the incoming clip, which the dissolve draws over
 * the outgoing one), or null outside the timeline. → { clip, index, localFrame, sourceFrame, inTransition, previous }
 */
export function clipAtFrame(ir, frame) {
  const track = primaryVideoTrack(ir);
  if (!track || !Array.isArray(track.clips) || !Number.isFinite(frame)) return null;
  for (let i = track.clips.length - 1; i >= 0; i -= 1) {
    const clip = track.clips[i];
    const start = Number(clip.start) || 0, end = start + clipDuration(clip);
    if (frame >= start && frame < end) {
      const localFrame = frame - start;
      const tIn = clip.transitionIn?.frames || 0;
      const inTransition = localFrame < tIn;
      return { clip, index: i, localFrame, sourceFrame: sourceFrameAt(clip, localFrame), inTransition,
        previous: inTransition && i > 0 ? track.clips[i - 1] : null };
    }
  }
  return null;
}

/** Everything active at `frame` (half-open intervals). → { frame, video[], text[], audio[], cues[], markers[] } */
export function activeAt(ir, frame) {
  const out = { frame, video: [], text: [], audio: [], cues: [], markers: [] };
  if (!ir || !Array.isArray(ir.tracks) || !Number.isFinite(frame)) return out;
  const inside = (start, end) => frame >= start && frame < end;
  for (const track of ir.tracks) {
    if (!track) continue;
    if (track.kind === "video" || track.kind === "audio") {
      for (const clip of track.clips || []) {
        const start = Number(clip.start) || 0, dur = track.kind === "video" ? clipDuration(clip) : clipDuration({ ...clip, speed: 1 });
        if (inside(start, start + dur)) {
          const localFrame = frame - start;
          (track.kind === "video" ? out.video : out.audio).push({ trackId: track.id, clip, localFrame, sourceFrame: sourceFrameAt(track.kind === "video" ? clip : { ...clip, speed: 1 }, localFrame) });
        }
      }
    } else if (track.kind === "text") {
      for (const item of track.items || []) if (inside(item.start, item.end)) out.text.push({ trackId: track.id, item });
    } else if (track.kind === "captions") {
      for (const cue of track.cues || []) if (inside(cue.start, cue.end)) out.cues.push({ trackId: track.id, cue });
    }
  }
  for (const marker of ir.markers || []) if (marker.frame === frame) out.markers.push(marker);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalization / canonical form / hash

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const withDefaults = (obj, defaults) => (isPlainObject(obj) ? { ...defaults, ...obj } : obj);

/**
 * Deep copy with every optional field made explicit (speed 1, fit cover, full crop, …). Unknown fields are KEPT (so an
 * invalid document never hashes like a valid one); validation is `validateIR`'s job.
 */
export function normalizeIR(ir) {
  if (!isPlainObject(ir)) return ir;
  const copy = JSON.parse(JSON.stringify(ir));
  copy.markers ??= [];
  copy.evidenceRegions ??= [];
  copy.loudness = withDefaults(copy.loudness ?? {}, { targetLufs: -14, maxTruePeakDb: -1 });
  copy.meta = withDefaults(copy.meta ?? {}, { title: "", labels: [], author: "", notes: "" });
  if (Array.isArray(copy.tracks)) {
    copy.tracks = copy.tracks.map((track) => {
      if (!isPlainObject(track)) return track;
      if (track.kind === "video" && Array.isArray(track.clips)) {
        track.clips = track.clips.map((c) => {
          const clip = withDefaults(c, { speed: 1, fit: "cover", crop: { x: 0, y: 0, w: 1, h: 1 }, keyframes: [], transitionIn: null, focus: null,
            shotId: null, claimIds: [], label: null, holdIntentional: false, color: { preset: "neutral" } });
          if (isPlainObject(clip) && Array.isArray(clip.keyframes)) clip.keyframes = clip.keyframes.map((k) => withDefaults(k, { ease: "linear" }));
          return clip;
        });
      } else if (track.kind === "text" && Array.isArray(track.items)) {
        track.items = track.items.map((i) => withDefaults(i, { anchor: "center", x: 0.5, y: 0.5, maxWidth: 0.86, animation: "none" }));
      } else if (track.kind === "audio" && Array.isArray(track.clips)) {
        track.clips = track.clips.map((c) => withDefaults(c, { gainDb: 0, fadeIn: 0, fadeOut: 0, envelope: [] }));
      } else if (track.kind === "captions") {
        return withDefaults(track, { burnIn: true, style: "caption" });
      }
      return track;
    });
  }
  return copy;
}
/** Canonical JSON (sorted keys, defaults explicit). */
export const canonicalIR = (ir) => canonicalJson(normalizeIR(ir));
/** sha256 of the canonical JSON. Two IRs that differ only in key order or omitted defaults hash the same. */
export const irHash = (ir) => sha256(canonicalIR(ir));

// ---------------------------------------------------------------------------------------------------------------------
// Capabilities per backend

/** Operation ids used by `opsUsed` / `checkBackend`. */
export const IR_OPS = Object.freeze(["trim", "speed", "crop", "fit_contain", "keyframes", "transition_crossfade", "transition_fade", "color_preset",
  "text", "captions_burn", "captions_sidecar", "audio_gain", "audio_fades", "audio_envelope", "still_image", "loudness"]);
export const CAPABILITY_LEVELS = Object.freeze({
  native: "aplicat de backend ca operație proprie",
  baked: "aplicat de backend, ars în imagine/sunet la randare",
  instructions: "doar instrucțiuni pas cu pas — proprietarul aplică manual",
  metadata: "exportat ca metadate; editorul țintă poate să nu-l aplice",
  unsupported: "pierdut la export — se raportează",
  not_installed: "editorul nu este instalat pe acest sistem",
});
const all = (level) => Object.fromEntries(IR_OPS.map((op) => [op, level]));
export const CAPABILITIES = Object.freeze({
  ffmpeg: Object.freeze({ kind: "render", status: "available", note: "Disponibilitatea reală vine din tools.resolve().",
    ops: Object.freeze({ trim: "native", speed: "native", crop: "native", fit_contain: "native", keyframes: "baked", transition_crossfade: "native",
      transition_fade: "native", color_preset: "baked", text: "baked", captions_burn: "baked", captions_sidecar: "native", audio_gain: "native",
      audio_fades: "native", audio_envelope: "native", still_image: "native", loudness: "native" }) }),
  capcut_assisted: Object.freeze({ kind: "assisted", status: "assisted", note: "Pachet asistat: media aprobată, SRT, tabel cu timecode-uri și pași. Proiectele CapCut nu se editează.",
    ops: Object.freeze({ ...all("instructions"), captions_sidecar: "native" }) }),
  premiere: Object.freeze({ kind: "editor", status: "not_installed", note: "Adobe Premiere nu este instalat pe acest sistem.", ops: Object.freeze(all("not_installed")) }),
  otio: Object.freeze({ kind: "export", status: "available", note: "OpenTimelineIO: tăieturi și tranziții native, efectele ca metadate.",
    ops: Object.freeze({ ...all("metadata"), trim: "native", transition_crossfade: "native", still_image: "native" }) }),
  edl: Object.freeze({ kind: "export", status: "available", note: "CMX3600: doar tăieturile pistei video principale.",
    ops: Object.freeze({ ...all("unsupported"), trim: "native" }) }),
});

/** The set of v1 operations an IR actually uses. */
export function opsUsed(ir, { isStill = () => false } = {}) {
  const used = new Set();
  for (const track of ir?.tracks || []) {
    if (track?.kind === "video") {
      for (const clip of track.clips || []) {
        used.add("trim");
        if (clip.speed !== undefined && clip.speed !== 1) used.add("speed");
        const c = clip.crop;
        if (c && (c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1)) used.add("crop");
        if (clip.fit === "contain") used.add("fit_contain");
        if (Array.isArray(clip.keyframes) && clip.keyframes.length) used.add("keyframes");
        if (clip.transitionIn?.kind === "crossfade") used.add("transition_crossfade");
        if (clip.transitionIn?.kind === "fade") used.add("transition_fade");
        if (clip.color?.preset && clip.color.preset !== "neutral") used.add("color_preset");
        if (isStill(clip)) used.add("still_image");
      }
    } else if (track?.kind === "text" && (track.items || []).length) used.add("text");
    else if (track?.kind === "captions" && (track.cues || []).length) { used.add("captions_sidecar"); if (track.burnIn !== false) used.add("captions_burn"); }
    else if (track?.kind === "audio") {
      for (const clip of track.clips || []) {
        if (clip.gainDb) used.add("audio_gain");
        if (clip.fadeIn || clip.fadeOut) used.add("audio_fades");
        if (Array.isArray(clip.envelope) && clip.envelope.length) used.add("audio_envelope");
      }
    }
  }
  if (ir?.loudness) used.add("loudness");
  return [...used].sort();
}

/** What a backend does with this IR. ok = installed and nothing would be lost. */
export function checkBackend(ir, backend, opts = {}) {
  const cap = CAPABILITIES[backend];
  if (!cap) throw new HubError("validation", `Backend necunoscut „${backend}”.`);
  const out = { backend, status: cap.status, native: [], baked: [], instructions: [], metadata: [], unsupported: [], not_installed: [] };
  for (const op of opsUsed(ir, opts)) out[cap.ops[op]].push(op);
  out.ok = cap.status !== "not_installed" && out.unsupported.length === 0 && out.not_installed.length === 0;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation

function lookupPreset(presets, id, version) {
  if (!presets || !id) return undefined;
  if (typeof presets === "function") return presets(id, version) || null;
  if (Array.isArray(presets)) return presets.find((p) => p?.id === id && (version === undefined || p.version === version)) || null;
  const byKey = presets[`${id}@${version}`] ?? presets[id];
  if (byKey && (byKey.version === undefined || byKey.version === version)) return byKey;
  return null;
}
const probeOf = (version) => {
  const p = version?.probe ?? version?.probe_json;
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return isPlainObject(p) ? p : {};
};
const STILL_CONTAINERS = /^(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|mjpeg|png|jpeg|webp|bmp|tiff)$/i;
/** A version is a still image when its asset kind says so or the probe shows a single-frame image container. */
export function isStillVersion(version) {
  if (!version) return false;
  if (version.kind === "image") return true;
  const probe = probeOf(version);
  if (probe.hasAudio) return false;
  return Boolean(probe.video && (STILL_CONTAINERS.test(String(probe.container || "")) || probe.video.frameCount === 1));
}

/**
 * Strict validation. opts:
 * - getVersion(versionId) → { probe, status, capture_label, origin, kind? } | null
 * - presets: function(id, version) | array | map (id or "id@version" → preset body from visual-bible)
 * - fonts: resolveFonts() result { ok, missing[] } for the preset
 * → { ok, errors[{path, code, message}], warnings[], durationFrames, dependencies: { assetVersionIds, fonts, presets }, ir? }
 */
export function validateIR(ir, opts = {}) {
  const errors = [], warnings = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  const warn = (path, code, message) => warnings.push({ path, code, message });
  const deps = { assetVersionIds: new Set(), fonts: new Set(), presets: [] };
  const finish = (durationFrames = 0) => {
    const ok = errors.length === 0;
    const out = { ok, errors, warnings, durationFrames,
      dependencies: { assetVersionIds: [...deps.assetVersionIds].sort(), fonts: [...deps.fonts].sort(), presets: deps.presets } };
    if (ok) out.ir = normalizeIR(ir);
    return out;
  };

  if (!isPlainObject(ir)) { err("", "TYPE", "IR-ul trebuie să fie un obiect JSON."); return finish(); }
  let size;
  try { size = canonicalJson(ir).length; } catch { err("", "NOT_JSON", "IR-ul nu este JSON serializabil (referință circulară sau valoare nesuportată)."); return finish(); }
  if (size > LIMITS.bytes) { err("", "TOO_LARGE", `IR-ul depășește ${LIMITS.bytes} octeți.`); return finish(); }

  // --- primitive checkers (return the value when valid, undefined otherwise)
  function keys(obj, allowed, path, label) {
    if (!isPlainObject(obj)) { err(path, "TYPE", `${label}: se așteaptă un obiect.`); return false; }
    for (const key of Object.keys(obj)) {
      if (allowed.includes(key)) continue;
      const k = key.toLowerCase();
      const p = path ? `${path}.${key}` : key;
      if (SPEED_RAMP_KEYS.has(k)) err(p, "UNSUPPORTED_SPEED_RAMP", "Rampele de viteză nu sunt suportate în IR v1; folosește o viteză constantă între 0,25 și 4.");
      else if (FORBIDDEN_OP_KEYS.has(k)) err(p, "UNSUPPORTED_OP", `Operația „${key}” nu este suportată în IR v1 (fără filtre, expresii, scripturi, căi sau comenzi arbitrare).`);
      else err(p, "UNKNOWN_FIELD", `Câmp necunoscut „${key}” — IR v1 acceptă doar câmpurile documentate.`);
    }
    return true;
  }
  function num(v, path, { min = -Infinity, max = Infinity, required = true, integer = false, label = path } = {}) {
    if (v === undefined || v === null) { if (required) err(path, "REQUIRED", `${label}: valoare obligatorie.`); return undefined; }
    if (typeof v !== "number") { err(path, "TYPE", `${label}: se așteaptă un număr, nu ${typeof v}.`); return undefined; }
    if (!Number.isFinite(v)) { err(path, "NOT_FINITE", `${label}: valoarea trebuie să fie un număr finit (NaN/Infinity refuzate).`); return undefined; }
    if (integer && !Number.isInteger(v)) { err(path, "NOT_INTEGER", `${label}: se așteaptă un număr întreg de cadre.`); return undefined; }
    if (v < min || v > max) { err(path, "RANGE", `${label}: ${v} este în afara intervalului [${min}, ${max}].`); return undefined; }
    return v;
  }
  const int = (v, path, o = {}) => num(v, path, { ...o, integer: true });
  function str(v, path, { max = 200, pattern = null, required = true, multiline = false, label = path, min = 0 } = {}) {
    if (v === undefined || v === null) { if (required) err(path, "REQUIRED", `${label}: valoare obligatorie.`); return undefined; }
    if (typeof v !== "string") { err(path, "TYPE", `${label}: se așteaptă text.`); return undefined; }
    if (v.length > max) { err(path, "TOO_LONG", `${label}: maximum ${max} caractere.`); return undefined; }
    if (v.length < min || (min > 0 && !v.trim())) { err(path, "TOO_SHORT", `${label}: textul nu poate fi gol.`); return undefined; }
    if (CONTROL_RE.test(v) || (!multiline && v.includes("\n"))) { err(path, "CONTROL_CHARS", `${label}: caractere de control nepermise.`); return undefined; }
    if (pattern && !pattern.test(v)) { err(path, "FORMAT", `${label}: format invalid.`); return undefined; }
    return v;
  }
  function oneOf(v, path, list, { required = true, label = path } = {}) {
    if (v === undefined || v === null) { if (required) err(path, "REQUIRED", `${label}: valoare obligatorie.`); return undefined; }
    if (typeof v !== "string" || !list.includes(v)) { err(path, "UNSUPPORTED_VALUE", `${label}: „${String(v).slice(0, 40)}” nu este suportat (permise: ${list.join(", ")}).`); return undefined; }
    return v;
  }
  function bool(v, path, { required = false } = {}) {
    if (v === undefined) { if (required) err(path, "REQUIRED", `${path}: valoare obligatorie.`); return undefined; }
    if (typeof v !== "boolean") { err(path, "TYPE", `${path}: se așteaptă true/false.`); return undefined; }
    return v;
  }
  function rect(v, path, label) {
    if (!keys(v, KEYS.rect, path, label)) return undefined;
    const x = num(v.x, `${path}.x`, { min: 0, max: 1 }), y = num(v.y, `${path}.y`, { min: 0, max: 1 });
    const w = num(v.w, `${path}.w`, { min: 0, max: 1 }), h = num(v.h, `${path}.h`, { min: 0, max: 1 });
    if ([x, y, w, h].includes(undefined)) return undefined;
    if (w <= 0 || h <= 0) { err(path, "RANGE", `${label}: lățimea și înălțimea trebuie să fie pozitive.`); return undefined; }
    if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) { err(path, "RANGE", `${label}: dreptunghiul iese din cadru (x + w ≤ 1, y + h ≤ 1).`); return undefined; }
    return { x, y, w, h };
  }
  function list(v, path, max, label, { required = true } = {}) {
    if (v === undefined) { if (required) err(path, "REQUIRED", `${label}: listă obligatorie.`); return []; }
    if (!Array.isArray(v)) { err(path, "TYPE", `${label}: se așteaptă o listă.`); return []; }
    if (v.length > max) { err(path, "TOO_MANY", `${label}: maximum ${max} elemente.`); return []; }
    return v;
  }
  const ids = new Map();
  function uniqueId(v, path, label) {
    const id = str(v, path, { pattern: ID_RE, max: 64, label: `${label}.id` });
    if (id === undefined) return undefined;
    if (ids.has(id)) err(path, "DUPLICATE_ID", `Id-ul „${id}” este folosit de două ori (${ids.get(id)} și ${path}).`);
    else ids.set(id, path);
    return id;
  }

  // --- top level
  keys(ir, KEYS.top, "", "IR");
  if (ir.irVersion !== IR_VERSION) err("irVersion", "UNSUPPORTED_VERSION", `Versiune IR nesuportată „${String(ir.irVersion)}” — se acceptă doar ${IR_VERSION}.`);
  let fps = null;
  if (keys(ir.fps, KEYS.fps, "fps", "fps")) {
    const n = int(ir.fps.num, "fps.num", { min: 1, max: 240000 }), d = int(ir.fps.den, "fps.den", { min: 1, max: 100000 });
    if (n !== undefined && d !== undefined) {
      if (n / d < 1 || n / d > 120) err("fps", "RANGE", `fps ${n}/${d} este în afara intervalului 1–120.`);
      else fps = { num: n, den: d };
    }
  }
  let canvas = null;
  if (keys(ir.canvas, KEYS.canvas, "canvas", "canvas")) {
    const w = int(ir.canvas.width, "canvas.width", { min: 16, max: 7680 }), h = int(ir.canvas.height, "canvas.height", { min: 16, max: 7680 });
    str(ir.canvas.background, "canvas.background", { pattern: HEX_RE, max: 7, required: false, label: "canvas.background (#RRGGBB)" });
    if (w !== undefined && h !== undefined) {
      if (w % 2 || h % 2) err("canvas", "ODD_DIMENSIONS", "Dimensiunile canvasului trebuie să fie pare (yuv420p).");
      else canvas = { width: w, height: h };
    }
  }
  let preset = null;
  if (keys(ir.preset, KEYS.preset, "preset", "preset")) {
    const id = str(ir.preset.id, "preset.id", { pattern: PRESET_ID_RE, max: 41 });
    const version = int(ir.preset.version, "preset.version", { min: 1, max: 10000 });
    if (id !== undefined && version !== undefined) {
      deps.presets.push({ id, version });
      if (opts.presets) {
        preset = lookupPreset(opts.presets, id, version);
        if (!preset) err("preset", "PRESET_UNKNOWN", `Presetul vizual „${id}” v${version} nu există.`);
      }
    }
  }
  oneOf(ir.language, "language", LANGUAGES);

  // --- tracks
  const tracks = list(ir.tracks, "tracks", LIMITS.tracks, "tracks");
  const trackIds = new Set();
  const byKind = { video: [], text: [], audio: [], captions: [] };
  tracks.forEach((track, i) => {
    const path = `tracks[${i}]`;
    if (!isPlainObject(track)) { err(path, "TYPE", "Pista trebuie să fie un obiect."); return; }
    if (!TRACK_KINDS.includes(track.kind)) { err(`${path}.kind`, "UNKNOWN_TRACK_KIND", `Tip de pistă nesuportat „${String(track.kind).slice(0, 40)}” (permise: ${TRACK_KINDS.join(", ")}).`); return; }
    const id = str(track.id, `${path}.id`, { pattern: ID_RE, max: 64, label: "id pistă" });
    if (id !== undefined) { if (trackIds.has(id)) err(`${path}.id`, "DUPLICATE_ID", `Pista „${id}” apare de două ori.`); trackIds.add(id); }
    byKind[track.kind].push({ track, path });
  });
  if (byKind.video.length !== 1) err("tracks", "VIDEO_TRACK_COUNT", `IR v1 cere exact o pistă video principală (găsite: ${byKind.video.length}).`);
  if (byKind.captions.length > 1) err("tracks", "CAPTIONS_TRACK_COUNT", "IR v1 acceptă cel mult o pistă de subtitrări.");

  const getVersion = typeof opts.getVersion === "function" ? opts.getVersion : null;
  if (!getVersion) warn("", "ASSETS_NOT_CHECKED", "Asset-urile nu au fost verificate (lipsește getVersion).");
  const versionCache = new Map();
  function checkAsset(versionId, path, need) {
    deps.assetVersionIds.add(versionId);
    if (!getVersion) return { checked: false };
    if (!versionCache.has(versionId)) {
      let v = null;
      try { v = getVersion(versionId) || null; } catch { v = null; }
      versionCache.set(versionId, v);
    }
    const version = versionCache.get(versionId);
    if (!version) { err(path, "ASSET_MISSING", `Versiunea de asset „${versionId}” nu există.`); return { checked: true, usable: false }; }
    const status = version.status || "READY";
    if (status !== "READY") {
      const why = status === "QUARANTINED" ? "este în carantină (fișier nedecodabil)" : status === "MISSING" ? "lipsește de pe disc" : `are starea ${status}`;
      err(path, "ASSET_UNAVAILABLE", `Versiunea de asset „${versionId}” ${why} și nu poate fi folosită.`);
      return { checked: true, usable: false, version };
    }
    const probe = probeOf(version);
    const still = isStillVersion(version);
    if (need === "video" && !(probe.hasVideo || probe.video)) { err(path, "NO_VIDEO_STREAM", `Asset-ul „${versionId}” nu are flux video.`); return { checked: true, usable: false, version }; }
    if (need === "audio" && !(probe.hasAudio || probe.audio)) { err(path, "NO_AUDIO_STREAM", `Asset-ul „${versionId}” nu are flux audio.`); return { checked: true, usable: false, version }; }
    return { checked: true, usable: true, version, probe, still };
  }
  function checkSourceRange(asset, sourceOut, path, versionId) {
    if (!asset.usable || asset.still || !fps) return;
    const durationMs = Number(asset.probe?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) { warn(path, "SOURCE_DURATION_UNKNOWN", `Durata sursei „${versionId}” este necunoscută; intervalul nu a putut fi verificat.`); return; }
    const available = sourceFramesAvailable(durationMs, fps);
    if (sourceOut > available) err(`${path}.sourceOut`, "SOURCE_OUT_OF_RANGE", `sourceOut ${sourceOut} depășește sursa „${versionId}” (${available} cadre la ${fps.num}/${fps.den} fps).`);
  }

  // --- primary video track
  const maxT = fps ? maxTransitionFrames(fps) : Infinity;
  const videoClips = [];
  const clipIndex = new Map();
  let contiguityOk = false;
  if (byKind.video.length >= 1) {
    const { track, path: tpath } = byKind.video[0];
    keys(track, KEYS.videoTrack, tpath, "pista video");
    const clips = list(track.clips, `${tpath}.clips`, LIMITS.clips, "clips");
    if (Array.isArray(track.clips) && track.clips.length === 0) err(`${tpath}.clips`, "EMPTY_TIMELINE", "Pista video principală nu are niciun clip.");
    clips.forEach((clip, i) => {
      const path = `${tpath}.clips[${i}]`;
      if (!keys(clip, KEYS.videoClip, path, "clip video")) { videoClips.push(null); return; }
      const id = uniqueId(clip.id, `${path}.id`, "clip");
      const versionId = str(clip.assetVersionId, `${path}.assetVersionId`, { pattern: VERSION_ID_RE, max: 80, label: "assetVersionId" });
      const sIn = int(clip.sourceIn, `${path}.sourceIn`, { min: 0, max: LIMITS.maxFrames });
      const sOut = int(clip.sourceOut, `${path}.sourceOut`, { min: 1, max: LIMITS.maxFrames });
      const start = int(clip.start, `${path}.start`, { min: 0, max: LIMITS.maxFrames });
      let speed = 1;
      if (clip.speed !== undefined) {
        if (Array.isArray(clip.speed) || isPlainObject(clip.speed)) { err(`${path}.speed`, "UNSUPPORTED_SPEED_RAMP", "Rampele de viteză nu sunt suportate în IR v1; folosește o viteză constantă între 0,25 și 4."); speed = undefined; }
        else {
          speed = num(clip.speed, `${path}.speed`, { label: "speed" });
          if (speed !== undefined && (speed < SPEED_MIN || speed > SPEED_MAX)) { err(`${path}.speed`, "UNSUPPORTED_SPEED", `Viteza ${speed} nu este suportată (constantă între ${SPEED_MIN} și ${SPEED_MAX}).`); speed = undefined; }
        }
      }
      if (sIn !== undefined && sOut !== undefined && sOut <= sIn) err(`${path}.sourceOut`, "FRAME_RANGE", `sourceOut (${sOut}) trebuie să fie mai mare decât sourceIn (${sIn}).`);
      oneOf(clip.fit, `${path}.fit`, FIT_MODES, { required: false });
      if (clip.crop !== undefined) rect(clip.crop, `${path}.crop`, "crop");
      if (clip.focus !== undefined && clip.focus !== null) rect(clip.focus, `${path}.focus`, "focus");
      if (clip.shotId !== undefined && clip.shotId !== null) str(clip.shotId, `${path}.shotId`, { pattern: ID_RE, max: 64 });
      list(clip.claimIds, `${path}.claimIds`, LIMITS.claimIds, "claimIds", { required: false })
        .forEach((c, k) => str(c, `${path}.claimIds[${k}]`, { pattern: ID_RE, max: 64 }));
      if (clip.label !== undefined && clip.label !== null) oneOf(clip.label, `${path}.label`, CLIP_LABELS);
      bool(clip.holdIntentional, `${path}.holdIntentional`);
      // R-MEDIA: the clip's measured pauses. Every field is checked here (none is carried unchecked); the provenance must name this clip's
      // own asset version, and frames / cap are re-derived from the measured interval (media/holds.mjs clipHoldProblems).
      const holdIds = new Set();
      list(clip.holds, `${path}.holds`, HOLD_LIMITS.perClip, "holds", { required: false }).forEach((h, k) => {
        const hp = `${path}.holds[${k}]`;
        if (!keys(h, KEYS.hold, hp, "pauză")) return;
        const hid = str(h.id, `${hp}.id`, { pattern: ID_RE, max: 64 });
        if (hid !== undefined) { if (holdIds.has(hid)) err(`${hp}.id`, "DUPLICATE_ID", `Pauza „${hid}” apare de două ori în clip.`); holdIds.add(hid); }
        oneOf(h.reason, `${hp}.reason`, HOLD_REASONS);
        const hFrom = int(h.srcFrom, `${hp}.srcFrom`, { min: 0, max: LIMITS.maxFrames });
        const hTo = int(h.srcTo, `${hp}.srcTo`, { min: 1, max: LIMITS.maxFrames });
        int(h.maxFrames, `${hp}.maxFrames`, { min: 1, max: LIMITS.maxFrames });
        if (hFrom !== undefined && hTo !== undefined && hTo <= hFrom) err(`${hp}.srcTo`, "FRAME_RANGE", "srcTo trebuie să fie după srcFrom.");
        if (!keys(h.provenance, KEYS.holdProvenance, `${hp}.provenance`, "proveniența pauzei")) return;
        if (fps) for (const pr of clipHoldProblems(h, clip, fps)) err(`${hp}.${pr.field}`, pr.code, pr.message);
      });
      if (clip.color !== undefined && keys(clip.color, KEYS.color, `${path}.color`, "color")) oneOf(clip.color.preset, `${path}.color.preset`, COLOR_PRESETS);
      let transition = null;
      if (clip.transitionIn !== undefined && clip.transitionIn !== null && keys(clip.transitionIn, KEYS.transition, `${path}.transitionIn`, "transitionIn")) {
        const kind = oneOf(clip.transitionIn.kind, `${path}.transitionIn.kind`, TRANSITION_KINDS);
        const frames = int(clip.transitionIn.frames, `${path}.transitionIn.frames`, { min: 1, max: LIMITS.maxFrames });
        if (frames !== undefined && frames > maxT) err(`${path}.transitionIn.frames`, "TRANSITION_TOO_LONG", `Tranziția de ${frames} cadre depășește 1 s (${maxT} cadre).`);
        if (kind && frames !== undefined) transition = { kind, frames };
        if (preset && kind && Array.isArray(preset.transitions?.allowed) && !preset.transitions.allowed.includes(kind)) {
          warn(`${path}.transitionIn.kind`, "PRESET_TRANSITION", `Presetul „${preset.id}” nu folosește tranziția „${kind}”.`);
        }
      }
      const duration = sIn !== undefined && sOut !== undefined && sOut > sIn && speed !== undefined ? clipDuration({ sourceIn: sIn, sourceOut: sOut, speed }) : undefined;
      if (duration === 0) err(path, "FRAME_RANGE", "Clipul are durată zero pe timeline după aplicarea vitezei.");
      let asset = { checked: false };
      if (versionId !== undefined) {
        asset = checkAsset(versionId, `${path}.assetVersionId`, "video");
        if (asset.usable && asset.still) {
          if (speed !== 1) err(`${path}.speed`, "UNSUPPORTED_SPEED", "O imagine statică nu acceptă viteză (speed trebuie să fie 1).");
          if (sIn !== undefined && sIn !== 0) err(`${path}.sourceIn`, "FRAME_RANGE", "Pentru o imagine statică sourceIn trebuie să fie 0 (sourceOut = durata în cadre).");
        }
        if (sOut !== undefined) checkSourceRange(asset, sOut, path, versionId);
        const capLabel = asset.version?.capture_label;
        if (asset.usable && DISCLOSURE_LABELS.includes(capLabel) && clip.label !== capLabel) {
          warn(`${path}.label`, "LABEL_MISMATCH", `Asset-ul este marcat ${capLabel}, dar clipul are eticheta „${clip.label ?? "—"}”.`);
        }
        if (asset.usable && asset.version?.origin === "UNKNOWN") warn(`${path}.assetVersionId`, "ORIGIN_UNKNOWN", `Asset-ul „${versionId}” are originea UNKNOWN — nu poate intra într-un export final fără drepturi clarificate.`);
      }
      // Keyframes: clip-relative, strictly increasing, inside the clip.
      const kfs = list(clip.keyframes, `${path}.keyframes`, LIMITS.keyframes, "keyframes", { required: false });
      let prevFrame = -1;
      kfs.forEach((kf, k) => {
        const kp = `${path}.keyframes[${k}]`;
        if (!keys(kf, KEYS.keyframe, kp, "keyframe")) return;
        const frame = int(kf.frame, `${kp}.frame`, { min: 0, max: LIMITS.maxFrames });
        const scale = num(kf.scale, `${kp}.scale`, { min: 1, max: SCALE_MAX, label: "scale (zoom ≥ 1)" });
        const cx = num(kf.cx, `${kp}.cx`, { min: 0, max: 1 }), cy = num(kf.cy, `${kp}.cy`, { min: 0, max: 1 });
        oneOf(kf.ease, `${kp}.ease`, EASINGS, { required: false });
        if (frame !== undefined) {
          if (duration !== undefined && frame > duration - 1) err(`${kp}.frame`, "KEYFRAME_OUTSIDE_CLIP", `Keyframe la cadrul ${frame}, în afara clipului (0–${duration - 1}).`);
          if (frame <= prevFrame) err(`${kp}.frame`, "KEYFRAME_ORDER", "Keyframe-urile trebuie să fie în ordine strict crescătoare.");
          prevFrame = Math.max(prevFrame, frame);
        }
        if (scale !== undefined && cx !== undefined && cy !== undefined) {
          const half = 0.5 / scale;
          if (cx < half - 1e-9 || cx > 1 - half + 1e-9 || cy < half - 1e-9 || cy > 1 - half + 1e-9) warn(kp, "KEYFRAME_CLAMPED", "Centrul zoom-ului ar ieși din imagine; va fi limitat la margine.");
          const maxZoom = Number(preset?.motion?.maxZoom);
          if (Number.isFinite(maxZoom) && scale > maxZoom + 1e-9) warn(`${kp}.scale`, "ZOOM_ABOVE_PRESET", `Zoom ${scale} peste limita presetului (${maxZoom}).`);
        }
      });
      const entry = { id, start, duration, transition, raw: clip, path };
      videoClips.push(entry);
      if (id !== undefined) clipIndex.set(id, entry);
    });

    // Contiguity (only when every clip parsed).
    if (videoClips.length && videoClips.every((c) => c && c.start !== undefined && c.duration !== undefined)) {
      contiguityOk = true;
      videoClips.forEach((c, i) => {
        if (i === 0) {
          if (c.start !== 0) { err(`${c.path}.start`, "TIMELINE_GAP", `Primul clip trebuie să înceapă la cadrul 0 (start = ${c.start}).`); contiguityOk = false; }
          if (c.transition?.kind === "crossfade") { err(`${c.path}.transitionIn`, "TRANSITION_NO_PREVIOUS", "Primul clip nu poate avea crossfade (nu există clip anterior); folosește „fade”."); contiguityOk = false; }
          if (c.transition && c.transition.frames >= c.duration) { err(`${c.path}.transitionIn.frames`, "TRANSITION_LONGER_THAN_CLIP", "Tranziția este mai lungă decât clipul."); contiguityOk = false; }
          return;
        }
        const prev = videoClips[i - 1];
        const t = c.transition?.frames || 0;
        if (t) {
          if (t >= c.duration || t >= prev.duration) { err(`${c.path}.transitionIn.frames`, "TRANSITION_LONGER_THAN_CLIP", `Tranziția de ${t} cadre trebuie să fie mai scurtă decât ambele clipuri (${prev.duration} și ${c.duration} cadre).`); contiguityOk = false; }
          const prevIn = prev.transition?.frames || 0;
          if (prevIn + t > prev.duration) { err(`${c.path}.transitionIn.frames`, "TRANSITION_OVERLAP", `Tranzițiile din jurul clipului „${prev.id}” se suprapun.`); contiguityOk = false; }
        }
        const expected = prev.start + prev.duration - t;
        if (c.start > expected) { err(`${c.path}.start`, "TIMELINE_GAP", `Gol pe timeline: clipul „${c.id}” începe la ${c.start}, se aștepta ${expected}.`); contiguityOk = false; }
        else if (c.start < expected) { err(`${c.path}.start`, "TIMELINE_OVERLAP", `Suprapunere pe timeline: clipul „${c.id}” începe la ${c.start}, se aștepta ${expected}.`); contiguityOk = false; }
      });
    }
  }
  const D = contiguityOk ? videoClips.reduce((end, c) => Math.max(end, c.start + c.duration), 0) : null;
  const inTimeline = (start, end, path, what) => {
    if (D === null || start === undefined || end === undefined) return;
    if (end > D) err(path, "OUT_OF_TIMELINE", `${what} se termină la cadrul ${end}, după sfârșitul timeline-ului (${D}).`);
  };
  const noOverlap = (entries, label) => {
    const sorted = entries.filter((e) => e.start !== undefined && e.end !== undefined).sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) err(sorted[i].path, "OVERLAP", `${label} „${sorted[i].id}” se suprapune cu „${sorted[i - 1].id}” pe aceeași pistă.`);
    }
  };

  // --- text tracks
  const textStyles = preset && isPlainObject(preset.textStyles) ? preset.textStyles : null;
  const usedFontRoles = new Set();
  for (const { track, path: tpath } of byKind.text) {
    keys(track, KEYS.textTrack, tpath, "pista text");
    const entries = [];
    list(track.items, `${tpath}.items`, LIMITS.items, "items").forEach((item, i) => {
      const path = `${tpath}.items[${i}]`;
      if (!keys(item, KEYS.textItem, path, "text")) return;
      const id = uniqueId(item.id, `${path}.id`, "text");
      const start = int(item.start, `${path}.start`, { min: 0, max: LIMITS.maxFrames });
      const end = int(item.end, `${path}.end`, { min: 1, max: LIMITS.maxFrames });
      if (start !== undefined && end !== undefined && end <= start) err(`${path}.end`, "FRAME_RANGE", "end trebuie să fie după start.");
      list(item.claimIds, `${path}.claimIds`, LIMITS.claimIds, "claimIds", { required: false }).forEach((c, k) => str(c, `${path}.claimIds[${k}]`, { pattern: ID_RE, max: 64 }));
      const text = str(item.text, `${path}.text`, { max: LIMITS.text, multiline: true, min: 1, label: "text" });
      if (text !== undefined && CEDILLA_RE.test(text)) warn(`${path}.text`, "DIACRITIC_CEDILLA", "Textul folosește " + CEDILLA_FORMS + " cu sedilă; forma corectă este ș/ț (virgulă dedesubt).");
      const style = str(item.style, `${path}.style`, { pattern: /^[a-z][a-z0-9_]{0,31}$/, max: 32, label: "style" });
      if (style !== undefined && textStyles) {
        if (!textStyles[style]) err(`${path}.style`, "STYLE_UNKNOWN", `Stilul de text „${style}” nu există în presetul „${preset.id}”.`);
        else if (textStyles[style].font) usedFontRoles.add(textStyles[style].font);
      }
      oneOf(item.anchor, `${path}.anchor`, TEXT_ANCHORS, { required: false });
      if (item.x !== undefined) num(item.x, `${path}.x`, { min: 0, max: 1 });
      if (item.y !== undefined) num(item.y, `${path}.y`, { min: 0, max: 1 });
      if (item.maxWidth !== undefined) num(item.maxWidth, `${path}.maxWidth`, { min: 0.1, max: 1 });
      if (item.plate !== undefined && typeof item.plate !== "boolean") err(`${path}.plate`, "TYPE", "plate este true sau false.");
      if (item.scale !== undefined) num(item.scale, `${path}.scale`, { min: 0.6, max: 2 });
      oneOf(item.animation, `${path}.animation`, TEXT_ANIMATIONS, { required: false });
      if (start !== undefined && end !== undefined && end > start) { inTimeline(start, end, path, `Textul „${id ?? i}”`); entries.push({ id, start, end, path }); }
    });
    noOverlap(entries, "Textul");
  }

  // --- audio tracks
  for (const { track, path: tpath } of byKind.audio) {
    keys(track, KEYS.audioTrack, tpath, "pista audio");
    const entries = [];
    list(track.clips, `${tpath}.clips`, LIMITS.clips, "clips").forEach((clip, i) => {
      const path = `${tpath}.clips[${i}]`;
      if (!keys(clip, KEYS.audioClip, path, "clip audio")) return;
      const id = uniqueId(clip.id, `${path}.id`, "clip audio");
      const versionId = str(clip.assetVersionId, `${path}.assetVersionId`, { pattern: VERSION_ID_RE, max: 80, label: "assetVersionId" });
      const sIn = int(clip.sourceIn, `${path}.sourceIn`, { min: 0, max: LIMITS.maxFrames });
      const sOut = int(clip.sourceOut, `${path}.sourceOut`, { min: 1, max: LIMITS.maxFrames });
      const start = int(clip.start, `${path}.start`, { min: 0, max: LIMITS.maxFrames });
      oneOf(clip.role, `${path}.role`, AUDIO_ROLES);
      if (clip.gainDb !== undefined) num(clip.gainDb, `${path}.gainDb`, { min: -60, max: 12 });
      const fadeIn = clip.fadeIn === undefined ? 0 : int(clip.fadeIn, `${path}.fadeIn`, { min: 0, max: LIMITS.maxFrames });
      const fadeOut = clip.fadeOut === undefined ? 0 : int(clip.fadeOut, `${path}.fadeOut`, { min: 0, max: LIMITS.maxFrames });
      let duration;
      if (sIn !== undefined && sOut !== undefined) {
        if (sOut <= sIn) err(`${path}.sourceOut`, "FRAME_RANGE", `sourceOut (${sOut}) trebuie să fie mai mare decât sourceIn (${sIn}).`);
        else duration = sOut - sIn;
      }
      if (duration !== undefined && fadeIn !== undefined && fadeOut !== undefined && fadeIn + fadeOut > duration) err(path, "FADE_TOO_LONG", "fadeIn + fadeOut depășesc durata clipului audio.");
      let prevFrame = -1;
      list(clip.envelope, `${path}.envelope`, LIMITS.envelope, "envelope", { required: false }).forEach((pt, k) => {
        const ep = `${path}.envelope[${k}]`;
        if (!keys(pt, KEYS.envelopePoint, ep, "punct de anvelopă")) return;
        const frame = int(pt.frame, `${ep}.frame`, { min: 0, max: LIMITS.maxFrames });
        num(pt.gainDb, `${ep}.gainDb`, { min: -60, max: 12 });
        if (frame !== undefined) {
          if (duration !== undefined && frame > duration - 1) err(`${ep}.frame`, "KEYFRAME_OUTSIDE_CLIP", `Punctul de anvelopă la cadrul ${frame} este în afara clipului (0–${duration - 1}).`);
          if (frame <= prevFrame) err(`${ep}.frame`, "KEYFRAME_ORDER", "Punctele de anvelopă trebuie să fie în ordine strict crescătoare.");
          prevFrame = Math.max(prevFrame, frame);
        }
      });
      if (versionId !== undefined) {
        const asset = checkAsset(versionId, `${path}.assetVersionId`, "audio");
        if (sOut !== undefined) checkSourceRange(asset, sOut, path, versionId);
        if (asset.usable && asset.version?.origin === "UNKNOWN") warn(`${path}.assetVersionId`, "ORIGIN_UNKNOWN", `Asset-ul „${versionId}” are originea UNKNOWN — nu poate intra într-un export final fără drepturi clarificate.`);
      }
      if (start !== undefined && duration !== undefined) { inTimeline(start, start + duration, path, `Clipul audio „${id ?? i}”`); entries.push({ id, start, end: start + duration, path }); }
    });
    noOverlap(entries, "Clipul audio");
  }

  // --- captions
  for (const { track, path: tpath } of byKind.captions) {
    keys(track, KEYS.captionsTrack, tpath, "pista subtitrări");
    bool(track.burnIn, `${tpath}.burnIn`);
    oneOf(track.style, `${tpath}.style`, CAPTION_STYLES, { required: false });
    // M09 review: where burned captions sit on THIS canvas (a platform variant sets its safe area and anchor; compile renders
    // exactly this, and QA checks the same values).
    if (track.layout !== undefined && keys(track.layout, KEYS.captionsLayout, `${tpath}.layout`, "așezarea subtitrărilor")) {
      oneOf(track.layout.anchor, `${tpath}.layout.anchor`, TEXT_ANCHORS, { required: false });
      if (track.layout.safeArea !== undefined && keys(track.layout.safeArea, KEYS.safeArea, `${tpath}.layout.safeArea`, "zona sigură")) {
        for (const side of KEYS.safeArea) num(track.layout.safeArea[side], `${tpath}.layout.safeArea.${side}`, { min: 0, max: 0.45 });
      }
    }
    if (preset?.captionStyle?.font) usedFontRoles.add(preset.captionStyle.font);
    let prev = null;
    list(track.cues, `${tpath}.cues`, LIMITS.cues, "cues").forEach((cue, i) => {
      const path = `${tpath}.cues[${i}]`;
      if (!keys(cue, KEYS.cue, path, "cue")) return;
      const id = uniqueId(cue.id, `${path}.id`, "cue");
      const start = int(cue.start, `${path}.start`, { min: 0, max: LIMITS.maxFrames });
      const end = int(cue.end, `${path}.end`, { min: 1, max: LIMITS.maxFrames });
      const text = str(cue.text, `${path}.text`, { max: LIMITS.text, multiline: true, min: 1, label: "text subtitrare" });
      if (text !== undefined && CEDILLA_RE.test(text)) warn(`${path}.text`, "DIACRITIC_CEDILLA", "Subtitrarea folosește " + CEDILLA_FORMS + " cu sedilă; forma corectă este ș/ț.");
      if (start === undefined || end === undefined) return;
      if (end <= start) { err(`${path}.end`, "FRAME_RANGE", "end trebuie să fie după start."); return; }
      inTimeline(start, end, path, `Subtitrarea „${id ?? i}”`);
      if (prev) {
        if (start < prev.start) err(`${path}.start`, "CUE_ORDER", "Subtitrările trebuie să fie sortate după start.");
        else if (start < prev.end) err(`${path}.start`, "CUE_OVERLAP", `Subtitrarea „${id}” se suprapune cu „${prev.id}”.`);
      }
      prev = { id, start, end };
    });
  }

  // --- markers, evidence regions, loudness, meta
  list(ir.markers, "markers", LIMITS.markers, "markers", { required: false }).forEach((m, i) => {
    const path = `markers[${i}]`;
    if (!keys(m, KEYS.marker, path, "marker")) return;
    const frame = int(m.frame, `${path}.frame`, { min: 0, max: LIMITS.maxFrames });
    oneOf(m.kind, `${path}.kind`, MARKER_KINDS);
    str(m.note, `${path}.note`, { max: LIMITS.note, required: false, multiline: true });
    if (frame !== undefined && D !== null && frame >= D) err(`${path}.frame`, "OUT_OF_TIMELINE", `Markerul de la cadrul ${frame} este după sfârșitul timeline-ului (${D}).`);
  });
  list(ir.evidenceRegions, "evidenceRegions", LIMITS.evidenceRegions, "evidenceRegions", { required: false }).forEach((r, i) => {
    const path = `evidenceRegions[${i}]`;
    if (!keys(r, KEYS.evidence, path, "regiune de dovadă")) return;
    const clipId = str(r.clipId, `${path}.clipId`, { pattern: ID_RE, max: 64 });
    const from = int(r.from, `${path}.from`, { min: 0, max: LIMITS.maxFrames });
    const to = int(r.to, `${path}.to`, { min: 1, max: LIMITS.maxFrames });
    rect(r.rect, `${path}.rect`, "rect");
    if (r.claimId !== undefined && r.claimId !== null) str(r.claimId, `${path}.claimId`, { pattern: ID_RE, max: 64 });
    if (from !== undefined && to !== undefined && to <= from) err(`${path}.to`, "FRAME_RANGE", "to trebuie să fie după from.");
    if (clipId !== undefined) {
      const clip = clipIndex.get(clipId);
      if (!clip) err(`${path}.clipId`, "CLIP_UNKNOWN", `Clipul „${clipId}” nu există pe pista video principală.`);
      else if (contiguityOk && from !== undefined && to !== undefined && (from < clip.start || to > clip.start + clip.duration)) {
        err(path, "EVIDENCE_OUTSIDE_CLIP", `Regiunea de dovadă [${from}, ${to}) iese din intervalul clipului „${clipId}” [${clip.start}, ${clip.start + clip.duration}).`);
      }
    }
  });
  if (ir.loudness !== undefined && keys(ir.loudness, KEYS.loudness, "loudness", "loudness")) {
    num(ir.loudness.targetLufs, "loudness.targetLufs", { min: -30, max: -5 });
    num(ir.loudness.maxTruePeakDb, "loudness.maxTruePeakDb", { min: -9, max: 0 });
  }
  let metaLabels = [];
  if (ir.meta !== undefined && keys(ir.meta, KEYS.meta, "meta", "meta")) {
    str(ir.meta.title, "meta.title", { max: LIMITS.title, required: false });
    str(ir.meta.author, "meta.author", { max: LIMITS.title, required: false });
    str(ir.meta.notes, "meta.notes", { max: LIMITS.note, required: false, multiline: true });
    metaLabels = list(ir.meta.labels, "meta.labels", LIMITS.labels, "meta.labels", { required: false }).filter((l, k) => oneOf(l, `meta.labels[${k}]`, CLIP_LABELS) !== undefined);
  }
  for (const c of videoClips) {
    const label = c?.raw?.label;
    if (DISCLOSURE_LABELS.includes(label) && !metaLabels.includes(label)) warn(`${c.path}.label`, "LABEL_NOT_DECLARED", `Clipul este ${label}, dar meta.labels nu îl declară.`);
  }

  // --- fonts used by the referenced styles
  if (preset && isPlainObject(preset.fonts)) {
    for (const role of usedFontRoles) {
      const font = preset.fonts[role];
      if (font?.file) deps.fonts.add(font.file);
      else err("preset", "PRESET_FONT_ROLE", `Presetul „${preset.id}” nu definește fontul pentru rolul „${role}”.`);
    }
    if (opts.fonts && Array.isArray(opts.fonts.missing)) {
      for (const miss of opts.fonts.missing) {
        if (usedFontRoles.has(miss.role) || deps.fonts.has(miss.file)) err("preset", "FONT_MISSING", `Fontul „${miss.family}” (${miss.file}) lipsește pe acest sistem și nu are înlocuitor.`);
      }
    }
  }

  return finish(D ?? 0);
}

/** validateIR or throw HubError("validation", …, code IR_INVALID) with the error list in details. */
export function assertValidIR(ir, opts = {}) {
  const result = validateIR(ir, opts);
  if (!result.ok) {
    const first = result.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    throw new HubError("validation", `IR invalid (${result.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: result.errors.slice(0, 50) } });
  }
  return result;
}
