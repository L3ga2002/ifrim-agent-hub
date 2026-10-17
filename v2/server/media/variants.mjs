import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { parse } from "../storage/db.mjs";
import { insertEditVersion as insertEditVersionRow } from "./review.mjs";
import { validateIR, normalizeIR, irHash, timelineDuration, clipDuration, primaryVideoTrack, msToFrames, framesToMs } from "./ir.mjs";
import { wrapLines, normalizeRo } from "./captions.mjs";
import { PRESETS } from "./visual-bible.mjs";

/**
 * Platform variants of a master edit (EditProjectIR v1) and the layout geometry shared with QA.
 *
 * PLATFORM_PROFILES (profilesVersion 1) are INTERNAL ESTIMATES of each platform's canvas, preferred frame rate, maximum
 * duration and the zones covered by the platform's own interface (safe area as fractions of the canvas). They are marked
 * „estimare internă — verifică regulile actuale” and `verifiedAt: null`: nothing here was checked against a live platform,
 * and a change of the estimates needs profilesVersion 2 (variants record the version they were derived with).
 *
 * deriveVariant reframes every primary clip for the target aspect around its `focus` (source space) WITHOUT cutting the
 * evidence regions of that clip (evidence rects are in the master's canvas space and are mapped through the master framing
 * back to the source and then into the variant canvas). When a cover crop cannot keep the evidence whole, the clip falls back
 * to `fit: "contain"` (letterbox) and a finding says so; with `allowLetterbox: false` the best cover crop is kept and the
 * cut is an error finding — never silent. Text items are moved into the profile's safe area and away from evidence; caption
 * cues are re-wrapped for the profile's line length (the caption position itself comes from the safe area at render time and
 * is returned in `layout`). A different hook, CTA and duration are allowed; a result identical to the master is refused
 * (a variant is never a renamed copy).
 *
 * Geometry conventions (documented here because compile/QA/variants must agree):
 * - crop, focus and keyframe centres (cx, cy) are normalized to the SOURCE picture; text x/y/maxWidth and evidence rects are
 *   normalized to the CANVAS.
 * - fit "cover": the crop is scaled to cover the canvas and centre-cropped to the canvas aspect; fit "contain": the whole crop is
 *   shown, centred, letterboxed with canvas.background.
 * - Text item: `x` is the horizontal centre of the box; `anchor` says which edge of the box sits at `y` (top edge, centre,
 *   bottom edge).
 * - Text box estimate (no font rasterizer is available to the pure modules): font size = style.sizeRel × canvas height;
 *   average glyph advance = 0.55 em for proportional fonts (Segoe UI / Bahnschrift class) and 0.60 em for monospaced fonts
 *   (Cascadia Code / Consolas), × 1.15 for uppercase styles, + letterSpacing (em); line height = style.lineHeight (default
 *   1.2); box padding = style.box.padRel × canvas height. The estimate errs on the wide side; QA labels it an estimate.
 *
 * Pure module except for the optional persistence helper `createVariantService` (one DB transaction per variant).
 */

export const PROFILES_VERSION = 1;
const SOURCE_NOTE = "estimare internă — verifică regulile actuale";

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const profile = (key, body) => ({ key, profilesVersion: PROFILES_VERSION, source: SOURCE_NOTE, verifiedAt: null, ...body });

export const PLATFORM_PROFILES = deepFreeze(Object.defineProperty({
  reels_9x16: profile("reels_9x16", {
    label: "Instagram Reels 9:16", platform: "instagram", rightsPlatform: "instagram", canvas: { width: 1080, height: 1920 }, fpsPreferred: 30, maxDurationS: 90,
    safeArea: { top: 0.14, bottom: 0.22, left: 0.06, right: 0.14 }, captionDefaults: { anchor: "bottom", maxChars: 30, maxLines: 2 },
    notes: ["Zona de jos este acoperită de descriere și butoane, dreapta de butoanele de reacție.", "Durata maximă este o estimare pentru Reels din aplicație."],
  }),
  tiktok_9x16: profile("tiktok_9x16", {
    label: "TikTok 9:16", platform: "tiktok", rightsPlatform: "tiktok", canvas: { width: 1080, height: 1920 }, fpsPreferred: 30, maxDurationS: 600,
    safeArea: { top: 0.12, bottom: 0.24, left: 0.06, right: 0.15 }, captionDefaults: { anchor: "bottom", maxChars: 28, maxLines: 2 },
    notes: ["Interfața TikTok acoperă o bandă lată jos (descriere, sunet) și coloana din dreapta.", "Limita de durată diferă între încărcare din aplicație și din browser."],
  }),
  shorts_9x16: profile("shorts_9x16", {
    label: "YouTube Shorts 9:16", platform: "youtube", rightsPlatform: "youtube", canvas: { width: 1080, height: 1920 }, fpsPreferred: 30, maxDurationS: 180,
    safeArea: { top: 0.1, bottom: 0.2, left: 0.06, right: 0.13 }, captionDefaults: { anchor: "bottom", maxChars: 30, maxLines: 2 },
    notes: ["Titlul și butoanele Shorts acoperă partea de jos și dreapta."],
  }),
  youtube_16x9: profile("youtube_16x9", {
    label: "YouTube 16:9", platform: "youtube", rightsPlatform: "youtube", canvas: { width: 1920, height: 1080 }, fpsPreferred: 30, maxDurationS: null,
    safeArea: { top: 0.06, bottom: 0.1, left: 0.05, right: 0.05 }, captionDefaults: { anchor: "bottom", maxChars: 42, maxLines: 2 },
    notes: ["Bara de control a playerului acoperă banda de jos la pauză.", "Fără limită practică de durată pentru conturile verificate (estimare)."],
  }),
  x_16x9: profile("x_16x9", {
    label: "X 16:9", platform: "x", rightsPlatform: "x", canvas: { width: 1920, height: 1080 }, fpsPreferred: 30, maxDurationS: 140,
    safeArea: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 }, captionDefaults: { anchor: "bottom", maxChars: 42, maxLines: 2 },
    notes: ["Limita de 140 s este pentru conturile fără abonament (estimare)."],
  }),
  x_1x1: profile("x_1x1", {
    label: "X 1:1", platform: "x", rightsPlatform: "x", canvas: { width: 1080, height: 1080 }, fpsPreferred: 30, maxDurationS: 140,
    safeArea: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 }, captionDefaults: { anchor: "bottom", maxChars: 34, maxLines: 2 },
    notes: ["Format pătrat pentru fluxul pe mobil."],
  }),
  linkedin_1x1: profile("linkedin_1x1", {
    label: "LinkedIn 1:1", platform: "linkedin", rightsPlatform: "linkedin", canvas: { width: 1080, height: 1080 }, fpsPreferred: 30, maxDurationS: 600,
    safeArea: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 }, captionDefaults: { anchor: "bottom", maxChars: 34, maxLines: 2 },
    notes: ["Redare fără sunet frecventă: subtitrările arse sunt recomandate."],
  }),
  linkedin_4x5: profile("linkedin_4x5", {
    label: "LinkedIn 4:5", platform: "linkedin", rightsPlatform: "linkedin", canvas: { width: 1080, height: 1350 }, fpsPreferred: 30, maxDurationS: 600,
    safeArea: { top: 0.06, bottom: 0.1, left: 0.05, right: 0.05 }, captionDefaults: { anchor: "bottom", maxChars: 34, maxLines: 2 },
    notes: ["Vertical moderat; ocupă mai mult din flux decât 1:1."],
  }),
}, "profilesVersion", { value: PROFILES_VERSION, enumerable: false }));
export const PLATFORM_KEYS = Object.freeze(Object.keys(PLATFORM_PROFILES));

/** Generic safe area used when an IR is checked without a platform profile. */
export const DEFAULT_SAFE_AREA = Object.freeze({ top: 0.06, bottom: 0.1, left: 0.05, right: 0.05 });

export function getProfile(key) {
  const p = typeof key === "string" ? PLATFORM_PROFILES[key] : null;
  if (!p) throw new HubError("validation", `Profil de platformă necunoscut „${String(key).slice(0, 40)}” (permise: ${PLATFORM_KEYS.join(", ")}).`, { code: "PLATFORM_PROFILE_UNKNOWN" });
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (normalized rects { x, y, w, h })

const EPS = 1e-6;
const round4 = (v) => Math.round(v * 10000) / 10000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const FULL_RECT = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export function intersectRect(a, b) {
  if (!a || !b) return null;
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 + EPS && y1 > y0 + EPS ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
export function unionRect(list) {
  const rects = list.filter(Boolean);
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const containsRect = (outer, inner, eps = 1e-4) => inner.x >= outer.x - eps && inner.y >= outer.y - eps
  && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
export function safeRect(safeArea = DEFAULT_SAFE_AREA) {
  const sa = { ...DEFAULT_SAFE_AREA, ...(safeArea || {}) };
  return { x: sa.left, y: sa.top, w: 1 - sa.left - sa.right, h: 1 - sa.top - sa.bottom };
}
const roundRect = (r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) });

// ---------------------------------------------------------------------------------------------------------------------
// Text box estimate (see the header for the documented metrics)

/** M10: the smallest legible text height in a narrow variant, as a share of the frame WIDTH (≈45 px on a 1080-wide frame). */
export const LEGIBLE_MIN_WIDTH_REL = 0.042;
/** Disclosure labels ("SIMULARE · …", "Accelerat ×4") keep their own style: transparency, never restyled as content. */
export const isDisclosureText = (item) => item?.style === "label" || /^\s*(simulare|simulation|reconstituire|reconstruction|reluare|replay|generat|generated|accelerat|×\s*\d)/i.test(String(item?.text || ""));
export const TEXT_METRICS = Object.freeze({ proportionalEm: 0.55, monoEm: 0.6, uppercaseFactor: 1.15, lineHeight: 1.2, defaultSizeRel: 0.035,
  note: "Estimare fără rasterizare: avans mediu 0,55 em (proporțional) / 0,60 em (monospațiat), ×1,15 pentru majuscule, înălțime de rând 1,2." });
const MONO_FAMILY = /cascadia|consola|mono|courier/i;

/** The preset body for an IR ({ id, version }) from the code presets (immutable per version), or null. */
export function presetForIR(ir, presets = PRESETS) {
  const id = ir?.preset?.id, version = ir?.preset?.version;
  if (!id) return null;
  const p = typeof presets === "function" ? presets(id, version) : presets?.[`${id}@${version}`] ?? presets?.[id];
  return p && (p.version === undefined || p.version === version) ? p : null;
}

/**
 * Average advance of one glyph in pixels — the ONE estimate shared by QA's text boxes and compile's drawtext pre-wrapping
 * (M09 review: two different estimates meant QA checked a box that was not the rendered one).
 */
export function textAdvancePx({ family = "", uppercase = false, letterSpacing = 0 } = {}, fontPx) {
  const em = MONO_FAMILY.test(String(family)) ? TEXT_METRICS.monoEm : TEXT_METRICS.proportionalEm;
  return fontPx * em * (uppercase ? TEXT_METRICS.uppercaseFactor : 1) + (Number(letterSpacing) || 0) * fontPx;
}
function glyphAdvance(style, preset, fontPx) {
  return textAdvancePx({ family: preset?.fonts?.[style?.font]?.family || "", uppercase: Boolean(style?.uppercase), letterSpacing: style?.letterSpacing }, fontPx);
}

/**
 * Estimated box of a text item on `canvas` (normalized rect) → { rect, lines, fontPx, maxChars, overflow, sizeRel }.
 * Uses the item's preset style (font size, box padding, uppercase, letter spacing, line height).
 */
export function estimateTextBox(item, { canvas, preset = null, text = undefined } = {}) {
  const W = Number(canvas?.width), H = Number(canvas?.height);
  if (!(W > 0) || !(H > 0)) throw new HubError("validation", "Canvas invalid pentru estimarea textului.", { code: "CANVAS_INVALID" });
  const style = preset?.textStyles?.[item?.style] || {};
  const sizeRel = (Number(style.sizeRel) > 0 ? Number(style.sizeRel) : TEXT_METRICS.defaultSizeRel) * (Number(item?.scale) || 1);
  const fontPx = sizeRel * H;
  const charW = glyphAdvance(style, preset, fontPx);
  // The plate the renderer draws (the style's box, or the default plate an item asks for) is part of the box QA checks.
  // (item.plate === true: the renderer pads at least 0.014 of the height, like DEFAULT_PLATE in compile.mjs.)
  const box = item?.plate === false ? null : item?.plate === true ? { padRel: Math.max(Number(style.box?.padRel) || 0.008, 0.014) } : style.box || null;
  const pad = (Number(box?.padRel) || 0) * H;
  const maxWidth = Number.isFinite(Number(item?.maxWidth)) ? Number(item.maxWidth) : 0.86;
  const maxWpx = maxWidth * W;
  const maxChars = Math.max(8, Math.floor((maxWpx - 2 * pad) / charW));
  const raw = text !== undefined ? text : item?.text;
  const wrapped = wrapLines(style.uppercase ? normalizeRo(raw).toLocaleUpperCase("ro-RO") : raw, { maxChars, maxLines: 99 });
  const lines = Math.max(1, wrapped.lines.length);
  const wpx = Math.max(charW, wrapped.longest * charW) + 2 * pad;
  const hpx = lines * fontPx * (Number(style.lineHeight) || TEXT_METRICS.lineHeight) + 2 * pad;
  const w = wpx / W, h = hpx / H;
  const cx = Number.isFinite(Number(item?.x)) ? Number(item.x) : 0.5;
  const y = Number.isFinite(Number(item?.y)) ? Number(item.y) : 0.5;
  const anchor = item?.anchor || "center";
  const y0 = anchor === "top" ? y : anchor === "bottom" ? y - h : y - h / 2;
  return { rect: { x: cx - w / 2, y: y0, w, h }, lines, fontPx, maxChars, overflow: wrapped.longest > maxChars, sizeRel, wrapped: wrapped.lines };
}

/** Item `y` that puts a box of height `h` with its top edge at `top`, for the item's anchor. */
function yForTop(anchor, top, h) { return anchor === "top" ? top : anchor === "bottom" ? top + h : top + h / 2; }

/**
 * Estimated caption box for one cue: the preset caption style at the profile's caption anchor inside the safe area.
 * → { rect, lines, overflow, maxChars }
 */
export function estimateCaptionBox(cue, { canvas, preset = null, safeArea = DEFAULT_SAFE_AREA, anchor = null, maxChars = null, maxLines = null } = {}) {
  const W = Number(canvas?.width), H = Number(canvas?.height);
  const cs = preset?.captionStyle || {};
  const sizeRel = Number(cs.sizeRel) > 0 ? Number(cs.sizeRel) : 0.036;
  const fontPx = sizeRel * H;
  const charW = glyphAdvance(cs, preset, fontPx);
  const pad = (Number(cs.box?.padRel) || 0) * H;
  const limit = Number.isInteger(maxChars) && maxChars >= 8 ? maxChars : Number.isInteger(cs.maxChars) ? cs.maxChars : 42;
  const lineLimit = Number.isInteger(maxLines) ? maxLines : Number.isInteger(cs.maxLines) ? cs.maxLines : 2;
  const wrapped = wrapLines(cue?.text || "", { maxChars: limit, maxLines: lineLimit });
  const lines = Math.max(1, wrapped.lines.length);
  const w = (wrapped.longest * charW + 2 * pad) / W;
  const h = (lines * fontPx * 1.2 + 2 * pad) / H;
  const safe = safeRect(safeArea);
  const where = anchor || cs.anchor || "bottom";
  const y0 = where === "top" ? safe.y : where === "center" ? safe.y + (safe.h - h) / 2 : safe.y + safe.h - h;
  return { rect: { x: safe.x + (safe.w - w) / 2, y: y0, w, h }, lines, overflow: wrapped.overflow || w > safe.w + EPS, maxChars: limit, wrapped: wrapped.lines };
}

// ---------------------------------------------------------------------------------------------------------------------
// Framing (source ↔ canvas)

function probeOf(version) {
  const p = version?.probe ?? version?.probe_json;
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return p && typeof p === "object" ? p : {};
}
/** Display size of a clip's source; falls back to the master canvas (the source is assumed to fill it). */
function sourceSize(clip, getVersion, fallbackCanvas) {
  let v = null;
  try { v = typeof getVersion === "function" ? getVersion(clip.assetVersionId) : null; } catch { v = null; }
  const video = probeOf(v).video;
  const w = Number(video?.displayWidth || video?.width), h = Number(video?.displayHeight || video?.height);
  if (w > 0 && h > 0) return { w, h, known: true };
  return { w: fallbackCanvas.width, h: fallbackCanvas.height, known: false };
}

/** S = source rect shown, D = canvas rect where it is drawn. */
export function clipFraming(clip, src, canvas) {
  const crop = clip?.crop || FULL_RECT;
  const cw = crop.w * src.w, ch = crop.h * src.h;
  const A = canvas.width / canvas.height;
  if (clip?.fit === "contain") {
    const scale = Math.min(canvas.width / cw, canvas.height / ch);
    const dw = (cw * scale) / canvas.width, dh = (ch * scale) / canvas.height;
    return { S: { ...crop }, D: { x: (1 - dw) / 2, y: (1 - dh) / 2, w: dw, h: dh } };
  }
  let vw = cw, vh = ch;
  if (cw / ch > A) vw = ch * A; else vh = cw / A;
  // Same placement as compile.mjs: the cover window is centred on the clip's focus (source space) when given, clamped inside the
  // crop; otherwise centred in the crop.
  const sw = vw / src.w, sh = vh / src.h;
  let fx = 0.5, fy = 0.5;
  if (clip?.focus) {
    const f = clip.focus;
    fx = Math.min(1, Math.max(0, (f.x + f.w / 2 - crop.x) / crop.w));
    fy = Math.min(1, Math.max(0, (f.y + f.h / 2 - crop.y) / crop.h));
  }
  const S = { x: crop.x + Math.max(0, Math.min(crop.w - sw, fx * crop.w - sw / 2)), y: crop.y + Math.max(0, Math.min(crop.h - sh, fy * crop.h - sh / 2)), w: sw, h: sh };
  return { S, D: { ...FULL_RECT } };
}

/** Keyframe centre (cx, cy are relative to the fitted window S, as compile.mjs renders them) ↔ source coordinates. */
export const keyframeToSrc = (framing, kf) => ({ x: framing.S.x + kf.cx * framing.S.w, y: framing.S.y + kf.cy * framing.S.h });
export const srcToKeyframe = (framing, p) => ({ cx: (p.x - framing.S.x) / framing.S.w, cy: (p.y - framing.S.y) / framing.S.h });
export const srcToCanvas = (f, r) => ({ x: f.D.x + ((r.x - f.S.x) / f.S.w) * f.D.w, y: f.D.y + ((r.y - f.S.y) / f.S.h) * f.D.h, w: (r.w / f.S.w) * f.D.w, h: (r.h / f.S.h) * f.D.h });
export const canvasToSrc = (f, r) => ({ x: f.S.x + ((r.x - f.D.x) / f.D.w) * f.S.w, y: f.S.y + ((r.y - f.D.y) / f.D.h) * f.S.h, w: (r.w / f.D.w) * f.S.w, h: (r.h / f.D.h) * f.S.h });

/**
 * A cover crop with the target aspect (pixels) inside the source, sized like the master's visible area when possible, grown to
 * contain `need` (source rect), centred on `centre`. → { crop, fits }
 */
function coverCrop({ src, targetAspect, masterVisible, need, centre }) {
  const srcAspect = src.w / src.h;
  // Largest crop at the target aspect (normalized to the source).
  const maxW = srcAspect > targetAspect ? (src.h * targetAspect) / src.w : 1;
  const maxH = srcAspect > targetAspect ? 1 : src.w / targetAspect / src.h;
  // Preferred size: same pixel height as the master's visible area (keeps the master's zoom), capped by the maximum.
  let h = Math.min(maxH, masterVisible ? masterVisible.h : maxH);
  let w = (h * src.h * targetAspect) / src.w;
  if (w > maxW) { w = maxW; h = (w * src.w) / targetAspect / src.h; }
  let fits = true;
  if (need) {
    const grow = Math.max(need.w / w, need.h / h, 1);
    if (grow > 1) { w *= grow; h *= grow; }
    if (w > maxW + EPS || h > maxH + EPS) { fits = false; const k = Math.min(maxW / w, maxH / h); w *= k; h *= k; }
  }
  w = Math.min(w, 1); h = Math.min(h, 1);
  const c = centre || { x: 0.5, y: 0.5 };
  let x = clamp(c.x - w / 2, 0, 1 - w), y = clamp(c.y - h / 2, 0, 1 - h);
  if (need && fits) {
    // Shift (never shrink) so the needed rect is inside.
    if (need.x < x) x = need.x; if (need.x + need.w > x + w) x = need.x + need.w - w;
    if (need.y < y) y = need.y; if (need.y + need.h > y + h) y = need.y + need.h - h;
    x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
  }
  return { crop: { x, y, w, h }, fits };
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeline trim (variant duration)

const shiftOrClip = (start, end, D) => (start >= D ? null : { start, end: Math.min(end, D) });

function trimTimeline(ir, D, changes, findings, fps) {
  const track = primaryVideoTrack(ir);
  // Clips: drop the ones starting at/after D; shorten the last; drop a last clip that would be shorter than its transition.
  for (let guard = 0; guard < 1000; guard += 1) {
    track.clips = track.clips.filter((c) => c.start < D);
    const last = track.clips[track.clips.length - 1];
    if (!last) throw new HubError("validation", "Durata cerută lasă varianta fără niciun clip.", { code: "VARIANT_TRIM_INVALID" });
    const dur = clipDuration(last);
    if (last.start + dur <= D) break;
    const want = D - last.start;
    const t = last.transitionIn?.frames || 0;
    if (want <= t || want < 1) { track.clips.pop(); continue; }
    const speed = last.speed ?? 1;
    let len = Math.round(want * speed);
    for (let k = 0; k < 4 && Math.round(len / speed) !== want; k += 1) len += Math.round(len / speed) > want ? -1 : 1;
    last.sourceOut = last.sourceIn + Math.max(1, len);
    last.keyframes = (last.keyframes || []).filter((kf) => kf.frame <= clipDuration(last) - 1);
    break;
  }
  const end = timelineDuration(ir);
  for (const t of ir.tracks) {
    if (t.kind === "text") t.items = t.items.map((i) => { const r = shiftOrClip(i.start, i.end, end); return r ? { ...i, ...r } : null; }).filter(Boolean);
    if (t.kind === "captions") t.cues = t.cues.map((q) => { const r = shiftOrClip(q.start, q.end, end); return r ? { ...q, ...r } : null; }).filter(Boolean);
    if (t.kind === "audio") {
      t.clips = t.clips.map((a) => {
        if (a.start >= end) return null;
        const dur = a.sourceOut - a.sourceIn;
        if (a.start + dur <= end) return a;
        const nd = end - a.start;
        return { ...a, sourceOut: a.sourceIn + nd, fadeIn: Math.min(a.fadeIn || 0, nd), fadeOut: Math.min(a.fadeOut || 0, Math.max(0, nd - Math.min(a.fadeIn || 0, nd))),
          envelope: (a.envelope || []).filter((p) => p.frame <= nd - 1) };
      }).filter(Boolean);
    }
  }
  ir.markers = (ir.markers || []).filter((m) => m.frame < end);
  const kept = [];
  for (const r of ir.evidenceRegions || []) {
    if (r.from >= end) {
      findings.push(finding("EVIDENCE_TRIMMED", "error", `Durata variantei (${fmtS(framesToMs(end, fps))}) elimină dovada clipului „${r.clipId}” (${fmtS(framesToMs(r.from, fps))}–${fmtS(framesToMs(r.to, fps))}).`,
        { range: { from: r.from, to: r.to }, claimId: r.claimId ?? null, fix: "Scurtează alt segment (nu intervalul dovezii) sau păstrează durata masterului." }));
      continue;
    }
    if (r.to > end) {
      findings.push(finding("EVIDENCE_SHORTENED", "warning", `Dovada clipului „${r.clipId}” este scurtată de durata variantei.`, { range: { from: end, to: r.to }, claimId: r.claimId ?? null }));
      kept.push({ ...r, to: end });
    } else kept.push(r);
  }
  ir.evidenceRegions = kept;
  changes.push({ kind: "duration", message: `Durata variantei: ${fmtS(framesToMs(end, fps))}.`, frames: end });
  return end;
}

const fmtS = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
function finding(code, severity, message, extra = {}) { return { code, severity, message, ...extra }; }

// ---------------------------------------------------------------------------------------------------------------------
// deriveVariant

/**
 * `deriveVariant({ masterIr, platformKey, overrides, getVersion })` → { ir, changes[], findings[], layout, masterHash, variantHash }.
 * overrides: { hookText, ctaText, trimToFrames, captionAnchor: "top"|"bottom"|"center", allowLetterbox = true }
 * Throws IR_INVALID for an invalid master or a variant that does not validate, VARIANT_IDENTICAL when nothing would change.
 */
export function deriveVariant({ masterIr, platformKey, overrides = {}, getVersion = null, presets = PRESETS } = {}) {
  const prof = getProfile(platformKey);
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const master = validateIR(masterIr, { getVersion: getVersion || undefined, presets });
  if (!master.ok) {
    const first = master.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    throw new HubError("validation", `Masterul nu este un IR valid (${master.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: master.errors.slice(0, 50) } });
  }
  const base = master.ir;
  const ir = normalizeIR(base);
  const fps = ir.fps;
  const preset = presetForIR(ir, presets);
  const changes = [], findings = [];
  const mCanvas = { width: base.canvas.width, height: base.canvas.height };
  const tCanvas = { width: prof.canvas.width, height: prof.canvas.height };
  const safe = safeRect(prof.safeArea);
  const narrow = tCanvas.width / tCanvas.height < 1.3; // vertical, 4:5 and square frames
  const allowLetterbox = o.allowLetterbox !== false;

  // 1. Duration (before reframing so trimmed evidence is not reframed).
  if (o.trimToFrames !== undefined && o.trimToFrames !== null) {
    const D0 = timelineDuration(ir);
    const T = o.trimToFrames;
    if (!Number.isInteger(T) || T < msToFrames(1000, fps, "ceil") || T >= D0) {
      throw new HubError("validation", `Durata variantei trebuie să fie un număr întreg de cadre între 1 s și durata masterului (${D0} cadre).`, { code: "VARIANT_TRIM_INVALID" });
    }
    trimTimeline(ir, T, changes, findings, fps);
  }
  const D = timelineDuration(ir);
  if (prof.maxDurationS !== null && framesToMs(D, fps) > prof.maxDurationS * 1000 + 1) {
    findings.push(finding("DURATION_OVER_PLATFORM", "warning", `Varianta durează ${fmtS(framesToMs(D, fps))}, peste maximul estimat de ${prof.maxDurationS} s pentru ${prof.label} (${SOURCE_NOTE}).`,
      { fix: `Folosește trimToFrames ≤ ${msToFrames(prof.maxDurationS * 1000, fps, "floor")} cadre.` }));
  }

  // 2. Reframe every primary clip.
  ir.canvas = { ...ir.canvas, width: tCanvas.width, height: tCanvas.height };
  if (mCanvas.width !== tCanvas.width || mCanvas.height !== tCanvas.height) changes.push({ kind: "canvas", message: `Canvas ${mCanvas.width}×${mCanvas.height} → ${tCanvas.width}×${tCanvas.height}.` });
  const masterClips = new Map(primaryVideoTrack(base).clips.map((c) => [c.id, c]));
  const variantFraming = new Map();
  const masterFraming = new Map();
  const evidenceByClip = new Map();
  for (const r of ir.evidenceRegions) { if (!evidenceByClip.has(r.clipId)) evidenceByClip.set(r.clipId, []); evidenceByClip.get(r.clipId).push(r); }
  const targetAspect = tCanvas.width / tCanvas.height;
  for (const clip of primaryVideoTrack(ir).clips) {
    const mClip = masterClips.get(clip.id) || clip;
    const src = sourceSize(clip, getVersion, mCanvas);
    const mf = clipFraming(mClip, src, mCanvas);
    masterFraming.set(clip.id, { framing: mf, src });
    const evSrc = (evidenceByClip.get(clip.id) || []).map((r) => canvasToSrc(mf, r.rect)).map((r) => intersectRect(r, FULL_RECT)).filter(Boolean);
    const focus = clip.focus || null;
    const needEv = unionRect(evSrc);
    const centreRect = focus || needEv || mf.S;
    const centre = { x: centreRect.x + centreRect.w / 2, y: centreRect.y + centreRect.h / 2 };
    // Evidence is mandatory, the focus is preferred: when both do not fit, keep the evidence and report the focus.
    let res = coverCrop({ src, targetAspect, masterVisible: mf.S, need: unionRect([focus, needEv]), centre });
    let focusCut = !res.fits && Boolean(focus) && !needEv;
    if (!res.fits && needEv && focus) {
      const evOnly = coverCrop({ src, targetAspect, masterVisible: mf.S, need: needEv, centre });
      if (evOnly.fits) { res = evOnly; focusCut = true; }
    }
    const { crop, fits } = res;
    let next = { ...clip, crop: roundRect(crop), fit: "cover" };
    if (!fits && evSrc.length) {
      if (allowLetterbox) {
        const pad = 0.02;
        const box = unionRect([...evSrc, focus]);
        const lb = { x: clamp(box.x - pad, 0, 1), y: clamp(box.y - pad, 0, 1) };
        lb.w = Math.min(1 - lb.x, box.w + 2 * pad); lb.h = Math.min(1 - lb.y, box.h + 2 * pad);
        next = { ...clip, crop: roundRect(lb), fit: "contain" };
        findings.push(finding("EVIDENCE_REQUIRES_LETTERBOX", "warning", `Clipul „${clip.id}”: un cadru ${prof.canvas.width}×${prof.canvas.height} plin ar tăia dovada; clipul folosește „contain” (benzi pe margini) ca dovada să rămână întreagă.`,
          { clipId: clip.id, range: { from: clip.start, to: clip.start + clipDuration(clip) }, fix: "Acceptă benzile sau capturează din nou dovada mai compactă pentru formatul vertical." }));
      } else {
        findings.push(finding("EVIDENCE_CUT", "error", `Clipul „${clip.id}”: încadrarea pentru ${prof.label} taie dovada (nu încape la acest raport de aspect).`,
          { clipId: clip.id, range: { from: clip.start, to: clip.start + clipDuration(clip) }, fix: "Permite „contain” (allowLetterbox) sau înlocuiește captura." }));
      }
    } else if (focusCut) {
      findings.push(finding("FOCUS_CUT", "warning", `Clipul „${clip.id}”: zona de interes nu încape întreagă la ${prof.label}.`, { clipId: clip.id }));
    }
    const vf = clipFraming(next, src, tCanvas);
    variantFraming.set(clip.id, { framing: vf, src });
    // Keyframes: cx/cy are relative to the fitted window S (compile.mjs semantics). They are taken to source space through the
    // MASTER framing, clamped there so the zoom window stays inside the new crop and keeps evidence whole, then expressed relative
    // to the VARIANT framing again.
    if (Array.isArray(next.keyframes) && next.keyframes.length) {
      const evInClip = (evidenceByClip.get(clip.id) || []).map((r) => ({ r, s: intersectRect(canvasToSrc(mf, r.rect), FULL_RECT) })).filter((e) => e.s);
      // The focus limits the zoom too when the variant's crop holds it whole (the crop was grown for it): a master zoom that fit a
      // wide frame would otherwise cut the very thing the clip is about in a narrow one. A focus that did not fit (FOCUS_CUT) does
      // not limit it — the evidence stays the only hard requirement.
      const focusNeed = focus && !focusCut ? intersectRect(focus, FULL_RECT) : null;
      let touched = false;
      // Pass 1: what each keyframe must keep whole and the largest zoom that allows it.
      const plan = next.keyframes.map((kfRel) => {
        const frameAbs = clip.start + kfRel.frame;
        const evNow = evInClip.filter((e) => frameAbs >= e.r.from && frameAbs < e.r.to).map((e) => e.s);
        const needNow = unionRect([...evNow, focusNeed].filter(Boolean));
        return { needNow, maxScale: needNow ? Math.max(1, Math.min(vf.S.w / needNow.w, vf.S.h / needNow.h)) : Infinity };
      });
      // One factor for the whole clip: every zoom shrinks by the same ratio, so the master's movement (a slow push-in, a pan)
      // survives in the variant instead of collapsing into a frozen frame at the cap; each keyframe still ends at or under its cap.
      const ratio = Math.min(1, ...next.keyframes.map((kf, i) => (kf.scale > plan[i].maxScale + EPS ? plan[i].maxScale / kf.scale : 1)));
      next.keyframes = next.keyframes.map((kfRel, i) => {
        const p = keyframeToSrc(mf, kfRel);
        const kf = { ...kfRel, cx: p.x, cy: p.y };
        const { needNow } = plan[i];
        let scale = kf.scale;
        if (ratio < 1) { scale = Math.max(1, round4(Math.floor(kf.scale * ratio * 1000) / 1000)); touched = true; }
        const ww = vf.S.w / scale, wh = vf.S.h / scale;
        let cx = clamp(kf.cx, vf.S.x + ww / 2, vf.S.x + vf.S.w - ww / 2), cy = clamp(kf.cy, vf.S.y + wh / 2, vf.S.y + vf.S.h - wh / 2);
        if (needNow) {
          cx = clamp(cx, needNow.x + needNow.w - ww / 2, needNow.x + ww / 2);
          cy = clamp(cy, needNow.y + needNow.h - wh / 2, needNow.y + wh / 2);
          cx = clamp(cx, vf.S.x + ww / 2, vf.S.x + vf.S.w - ww / 2); cy = clamp(cy, vf.S.y + wh / 2, vf.S.y + vf.S.h - wh / 2);
        }
        if (Math.abs(cx - kf.cx) > 1e-4 || Math.abs(cy - kf.cy) > 1e-4) touched = true;
        const rel = srcToKeyframe(vf, { x: cx, y: cy });
        return { ...kfRel, scale, cx: round4(clamp(rel.cx, 0, 1)), cy: round4(clamp(rel.cy, 0, 1)) };
      });
      if (touched) changes.push({ kind: "keyframes", clipId: clip.id, message: `Clipul „${clip.id}”: zoom-ul a fost ajustat pentru noul cadru (dovada și zona de interes rămân întregi).` });
    }
    const before = JSON.stringify([clip.crop, clip.fit]);
    Object.assign(clip, next);
    if (JSON.stringify([clip.crop, clip.fit]) !== before) changes.push({ kind: "crop", clipId: clip.id, message: `Clipul „${clip.id}”: încadrare ${clip.fit} pe zona ${fmtRect(clip.crop)} a sursei${src.known ? "" : " (dimensiunile sursei necunoscute — s-a presupus canvasul masterului)"}.`, crop: clip.crop, fit: clip.fit });
  }

  // 3. Evidence regions into the variant canvas.
  const evidence = [];
  for (const r of ir.evidenceRegions) {
    const mf = masterFraming.get(r.clipId), vf = variantFraming.get(r.clipId);
    if (!mf || !vf) { evidence.push(r); continue; }
    const s = intersectRect(canvasToSrc(mf.framing, r.rect), FULL_RECT);
    const mapped = s ? srcToCanvas(vf.framing, s) : null;
    const visible = mapped ? intersectRect(mapped, FULL_RECT) : null;
    if (!visible) {
      findings.push(finding("EVIDENCE_CUT", "error", `Dovada clipului „${r.clipId}” iese complet din cadrul variantei ${prof.label}.`, { clipId: r.clipId, range: { from: r.from, to: r.to }, claimId: r.claimId ?? null }));
      continue;
    }
    if (!containsRect(FULL_RECT, mapped, 1e-3) && !findings.some((f) => (f.code === "EVIDENCE_CUT" || f.code === "EVIDENCE_REQUIRES_LETTERBOX") && f.clipId === r.clipId)) {
      findings.push(finding("EVIDENCE_CUT", "error", `Dovada clipului „${r.clipId}” este tăiată parțial în varianta ${prof.label}.`, { clipId: r.clipId, range: { from: r.from, to: r.to }, claimId: r.claimId ?? null }));
    }
    evidence.push({ ...r, rect: roundRect({ x: visible.x, y: visible.y, w: Math.min(visible.w, 1 - visible.x), h: Math.min(visible.h, 1 - visible.y) }) });
  }
  ir.evidenceRegions = evidence;

  // 4. Hook / CTA overrides (distinct texts are allowed per platform).
  const textTracks = () => ir.tracks.filter((t) => t.kind === "text");
  const allItems = () => textTracks().flatMap((t) => t.items);
  const styleOk = (s) => !preset || Boolean(preset.textStyles?.[s]);
  let extraTrack = null;
  const addItem = (item) => {
    if (!extraTrack) { extraTrack = { id: uniqueId(ir, "tvar"), kind: "text", items: [] }; ir.tracks.push(extraTrack); }
    extraTrack.items.push(item);
    extraTrack.items.sort((a, b) => a.start - b.start);
  };
  if (o.hookText !== undefined && o.hookText !== null) {
    const text = cleanOverride(o.hookText, "hook");
    const hook = allItems().filter((i) => i.style === "hook").sort((a, b) => a.start - b.start)[0];
    if (hook) { if (hook.text !== text) { hook.text = text; changes.push({ kind: "hook", itemId: hook.id, message: `Hook nou pentru ${prof.label}: „${text}”.` }); } }
    else if (allItems().some(i => i.claimIds?.length)) findings.push(finding("OVERRIDE_TARGET_MISSING", "warning", "Textul legat de dovezi lipsește; override-ul nu se adaugă."));
    else {
      if (!styleOk("hook")) throw new HubError("validation", `Presetul „${preset.id}” nu are stilul „hook”.`, { code: "STYLE_UNKNOWN" });
      const item = { id: uniqueId(ir, "vhook"), start: 0, end: Math.min(D, msToFrames(2000, fps)), text, style: "hook", anchor: "top", x: 0.5, y: safe.y + 0.02, maxWidth: round4(safe.w), animation: "fade" };
      addItem(item);
      changes.push({ kind: "hook", itemId: item.id, message: `Hook adăugat pentru ${prof.label}: „${text}”.` });
    }
  }
  if (o.ctaText !== undefined && o.ctaText !== null) {
    const text = cleanOverride(o.ctaText, "CTA");
    const cta = allItems().filter((i) => i.style === "cta").sort((a, b) => b.start - a.start)[0];
    if (cta) { if (cta.text !== text) { cta.text = text; changes.push({ kind: "cta", itemId: cta.id, message: `CTA nou pentru ${prof.label}: „${text}”.` }); } }
    else if (allItems().some(i => i.claimIds?.length)) findings.push(finding("OVERRIDE_TARGET_MISSING", "warning", "Textul legat de dovezi lipsește; override-ul nu se adaugă."));
    else {
      if (!styleOk("cta")) throw new HubError("validation", `Presetul „${preset.id}” nu are stilul „cta”.`, { code: "STYLE_UNKNOWN" });
      const len = Math.min(D, msToFrames(Number(preset?.cta?.minMs) || 2000, fps));
      const item = { id: uniqueId(ir, "vcta"), start: D - len, end: D, text, style: "cta", anchor: "center", x: 0.5, y: 0.6, maxWidth: round4(safe.w), animation: "fade" };
      addItem(item);
      changes.push({ kind: "cta", itemId: item.id, message: `CTA adăugat pentru ${prof.label}: „${text}”.` });
    }
  }

  // 5. Text into the safe area and away from evidence.
  const mSafe = safeRect(DEFAULT_SAFE_AREA);
  for (const track of textTracks()) {
    for (const item of track.items) {
      const before = { x: item.x, y: item.y, maxWidth: item.maxWidth };
      const fromMaster = track !== extraTrack;
      if (fromMaster) {
        // Keep the relative vertical position (master safe area → variant safe area).
        const rel = clamp((item.y - mSafe.y) / mSafe.h, 0, 1);
        item.y = safe.y + rel * safe.h;
      }
      if (item.maxWidth > safe.w) item.maxWidth = round4(safe.w);
      // M10 legibility: in a narrow frame the master's text lands on denser UI and is smaller relative to the width. CONTENT text (never
      // a disclosure label) gets a background plate and a legible minimum size (a share of the frame width), unless the master chose
      // plate: false explicitly. Recorded as a change, so the owner sees it in the variant's diff.
      if (narrow && !isDisclosureText(item)) {
        const style = preset?.textStyles?.[item.style] || {};
        const basePx = (Number(style.sizeRel) > 0 ? Number(style.sizeRel) : TEXT_METRICS.defaultSizeRel) * tCanvas.height * (Number(item.scale) || 1);
        const minPx = LEGIBLE_MIN_WIDTH_REL * tCanvas.width;
        const legible = [];
        if (basePx < minPx - 0.5) { item.scale = round4(Math.min(2, (Number(item.scale) || 1) * (minPx / basePx))); legible.push(`mărime ${Math.round(basePx)} → ${Math.round(minPx)} px`); }
        // A style with its own (translucent) box gets it reinforced: over a busy UI a 0.75 box still lets the text beneath show through.
        if (item.plate === undefined) { item.plate = true; legible.push(style.box ? "plăcuță întărită (opacă)" : "plăcuță de fundal"); }
        if (legible.length) changes.push({ kind: "text_legibility", itemId: item.id, message: `Textul „${item.id}”: ${legible.join(", ")} (lizibilitate în ${prof.label}).` });
      }
      let box = estimateTextBox(item, { canvas: tCanvas, preset });
      if (box.rect.w > safe.w + EPS) { item.maxWidth = round4(safe.w); box = estimateTextBox(item, { canvas: tCanvas, preset }); }
      // Horizontal: keep the centre inside the safe band.
      const halfW = Math.min(box.rect.w, safe.w) / 2;
      item.x = clamp(item.x, safe.x + halfW, safe.x + safe.w - halfW);
      // Vertical: inside the safe band.
      let top = clamp(box.rect.y, safe.y, safe.y + safe.h - box.rect.h);
      // Away from evidence shown at the same time.
      const evNow = ir.evidenceRegions.filter((r) => r.from < item.end && item.start < r.to).map((r) => r.rect);
      const hits = () => evNow.filter((r) => intersectRect({ x: item.x - box.rect.w / 2, y: top, w: box.rect.w, h: box.rect.h }, r));
      if (hits().length) {
        const ev = unionRect(hits());
        const gap = 0.01;
        const above = ev.y - gap - box.rect.h, below = ev.y + ev.h + gap;
        const options = [];
        if (above >= safe.y - EPS) options.push(above);
        if (below + box.rect.h <= safe.y + safe.h + EPS) options.push(below);
        const ok = options.filter((t) => !evNow.some((r) => intersectRect({ x: item.x - box.rect.w / 2, y: t, w: box.rect.w, h: box.rect.h }, r)));
        if (ok.length) top = ok.sort((a, b) => Math.abs(a - top) - Math.abs(b - top))[0];
        else findings.push(finding("TEXT_OVER_EVIDENCE", "error", `Textul „${item.id}” nu are loc în zona sigură fără să acopere dovada.`, { itemId: item.id, range: { from: item.start, to: item.end }, fix: "Scurtează textul sau mută-l într-un interval fără dovadă." }));
      }
      item.y = round4(clamp(yForTop(item.anchor, top, box.rect.h), 0, 1));
      item.x = round4(clamp(item.x, 0, 1));
      if (before.x !== item.x || before.y !== item.y || before.maxWidth !== item.maxWidth) {
        changes.push({ kind: "text_position", itemId: item.id, message: `Textul „${item.id}” mutat în zona sigură ${prof.label} (x ${fmtN(before.x)} → ${fmtN(item.x)}, y ${fmtN(before.y)} → ${fmtN(item.y)}).`, before, after: { x: item.x, y: item.y, maxWidth: item.maxWidth } });
      }
    }
  }

  // 6. Captions: re-wrapped for the profile line length; position follows the profile safe area at render time.
  const capAnchor = ["top", "bottom", "center"].includes(o.captionAnchor) ? o.captionAnchor : prof.captionDefaults.anchor;
  const capMax = Math.min(prof.captionDefaults.maxChars, Number.isInteger(preset?.captionStyle?.maxChars) ? preset.captionStyle.maxChars : 99);
  const capLines = prof.captionDefaults.maxLines;
  for (const track of ir.tracks.filter((t) => t.kind === "captions")) {
    let rewrapped = 0;
    for (const cue of track.cues) {
      const w = wrapLines(cue.text, { maxChars: Math.max(8, capMax), maxLines: capLines });
      const text = w.lines.join("\n");
      if (w.overflow) findings.push(finding("CAPTION_TOO_LONG_FOR_PLATFORM", "warning", `Subtitrarea „${cue.id}” nu încape în ${capLines} rânduri de ${capMax} caractere la ${prof.label}.`, { cueId: cue.id, range: { from: cue.start, to: cue.end }, fix: "Împarte subtitrarea în două." }));
      if (text && text !== cue.text) { cue.text = text; rewrapped += 1; }
    }
    if (rewrapped) changes.push({ kind: "captions", message: `${rewrapped} subtitrări re-împărțite pe rânduri de cel mult ${capMax} caractere.` });
    // M09 review: the position is IN the IR (compile renders it; QA reads the same values), not only in a side note.
    track.layout = { anchor: capAnchor, safeArea: { top: prof.safeArea.top, bottom: prof.safeArea.bottom, left: prof.safeArea.left, right: prof.safeArea.right } };
  }
  changes.push({ kind: "caption_position", message: `Subtitrările stau ${capAnchor === "top" ? "sus" : capAnchor === "center" ? "la mijloc" : "jos"}, în zona sigură ${prof.label}.`, anchor: capAnchor, safeArea: prof.safeArea });

  // 7. Variant note, validation, identity check.
  const masterHash = irHash(base);
  const contentHash = irHash(ir);
  if (contentHash === masterHash) {
    throw new HubError("conflict", `Varianta ${prof.label} ar fi identică cu masterul; folosește masterul sau schimbă hook-ul, CTA-ul ori durata.`, { code: "VARIANT_IDENTICAL" });
  }
  const note = `Variantă ${prof.key} (profiluri v${PROFILES_VERSION}, ${SOURCE_NOTE}) din masterul ${masterHash.slice(0, 12)}.`;
  ir.meta = { ...ir.meta, notes: `${ir.meta.notes ? `${ir.meta.notes}\n` : ""}${note}`.slice(-2000) };
  const checked = validateIR(ir, { getVersion: getVersion || undefined, presets });
  if (!checked.ok) {
    const first = checked.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    throw new HubError("validation", `Varianta generată nu este validă (${checked.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: checked.errors.slice(0, 50) } });
  }
  for (const f of findings) if (f.range && Number.isInteger(f.range.from)) f.range = { ...f.range, fromMs: Math.round(framesToMs(f.range.from, fps)), toMs: Math.round(framesToMs(f.range.to, fps)) };
  return {
    ir: checked.ir, changes, findings, warnings: checked.warnings,
    layout: { profileKey: prof.key, profilesVersion: PROFILES_VERSION, canvas: tCanvas, safeArea: { ...prof.safeArea }, captionAnchor: capAnchor, captionMaxChars: capMax, source: SOURCE_NOTE },
    masterHash, variantHash: irHash(checked.ir),
  };
}

const fmtN = (v) => (Number.isFinite(v) ? v.toFixed(3).replace(".", ",") : "—");
const fmtRect = (r) => `x ${fmtN(r.x)}, y ${fmtN(r.y)}, ${fmtN(r.w)}×${fmtN(r.h)}`;

function cleanOverride(value, label) {
  if (typeof value !== "string") throw new HubError("validation", `Textul pentru ${label} trebuie să fie text.`, { code: "FIELD_INVALID" });
  const t = normalizeRo(value);
  if (!t || t.length > 200) throw new HubError("validation", `Textul pentru ${label} trebuie să aibă între 1 și 200 de caractere.`, { code: "FIELD_INVALID" });
  return t;
}

function uniqueId(ir, prefix) {
  const used = new Set();
  for (const t of ir.tracks) {
    used.add(t.id);
    for (const x of [...(t.clips || []), ...(t.items || []), ...(t.cues || [])]) used.add(x.id);
  }
  if (!used.has(prefix)) return prefix;
  for (let i = 2; i < 10000; i += 1) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  throw new HubError("internal", "Nu s-a putut genera un id unic.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Persistence helper (used by the coordinator's media.variant.derive)

/**
 * `createVariantService({ db, bus, clock, assets })` → { derive({ masterVersionId, platformKey, overrides, actor }), get(id), list({ editProjectId }) }.
 * derive stores the variant IR as a new edit version (change_kind "variant", variant_key = platformKey; the main line's
 * current_version is not moved) and a media_variants row DRAFT, in one transaction with a `media.variant.derived` event.
 */
export function createVariantService({ db, bus, clock = () => new Date(), assets = null }) {
  if (!db || !bus) throw new Error("createVariantService requires db and bus");
  const insertEditVersion = (input) => insertEditVersionRow(db, bus, clock, input);
  const now = () => clock().toISOString();
  const mapRow = (r) => r && ({ id: r.id, editProjectId: r.edit_project_id, masterVersionId: r.master_version_id, platformKey: r.platform_key, variantVersionId: r.variant_version_id,
    status: r.status, notes: parse(r.notes_json, {}), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  function derive({ masterVersionId, platformKey, overrides = {}, actor } = {}) {
    if (typeof actor !== "string" || !actor.trim()) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    const row = db.prepare("SELECT * FROM media_edit_versions WHERE id = ?").get(String(masterVersionId || ""));
    if (!row) throw new HubError("not_found", "Versiunea de editare nu există.", { code: "EDIT_VERSION_MISSING" });
    const masterIr = parse(row.ir_json, null);
    if (!masterIr || irHash(masterIr) !== row.ir_sha256) throw new HubError("conflict", "IR-ul masterului nu corespunde amprentei sale (sha256).", { code: "EDIT_VERSION_TAMPERED" });
    const result = deriveVariant({ masterIr, platformKey, overrides, getVersion: assets?.getVersion ? (vid) => assets.getVersion(vid) : null });
    const id = newId("mvr");
    const at = now();
    return bus.transaction(() => {
      const version = insertEditVersion({ editProjectId: row.edit_project_id, parentVersionId: row.id, ir: result.ir, changeKind: "variant",
        change: { platformKey, profilesVersion: PROFILES_VERSION, overrides, changes: result.changes, findings: result.findings, layout: result.layout },
        validation: { ok: true, warnings: result.warnings.slice(0, 50) }, variantKey: platformKey, actor: actor.trim() });
      db.prepare(`INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, variant_version_id, status, notes_json, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`).run(id, row.edit_project_id, row.id, platformKey, version.id,
        JSON.stringify({ layout: result.layout, findings: result.findings, changes: result.changes.length, profilesVersion: PROFILES_VERSION }), actor.trim(), at, at);
      bus.append({ type: "media.variant.derived", scopeType: "media_variant", scopeId: id, source: actor.trim(),
        payload: { variantId: id, platformKey, masterVersionId: row.id, variantVersionId: version.id, findings: result.findings.map((f) => f.code), changes: result.changes.length } });
      return { variant: mapRow(db.prepare("SELECT * FROM media_variants WHERE id = ?").get(id)), version, ...result };
    });
  }
  const get = (id) => mapRow(db.prepare("SELECT * FROM media_variants WHERE id = ?").get(String(id || ""))) || null;
  const list = ({ editProjectId } = {}) => db.prepare("SELECT * FROM media_variants WHERE edit_project_id = ? ORDER BY created_at, rowid").all(String(editProjectId || "")).map(mapRow);
  /**
   * M11: a variant whose master no longer proves anything (the software it shows changed) is INVALIDATED: idempotent, the reason kept
   * in notes_json.invalidated, a `media.variant.invalidated` event. Distribution's INVALIDATED branches then refuse it.
   */
  function invalidate(variantId, { reason, actor } = {}) {
    if (typeof actor !== "string" || !actor.trim()) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    const row = db.prepare("SELECT * FROM media_variants WHERE id = ?").get(String(variantId || ""));
    if (!row) throw new HubError("not_found", "Varianta nu există.", { code: "VARIANT_MISSING" });
    if (row.status === "INVALIDATED") return mapRow(row);
    const at = now();
    const notes = { ...parse(row.notes_json, {}), invalidated: { previousStatus: row.status, reason: String(reason || "").slice(0, 200), at, by: actor.trim() } };
    return bus.transaction(() => {
      db.prepare("UPDATE media_variants SET status = 'INVALIDATED', notes_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(notes), at, row.id);
      bus.append({ type: "media.variant.invalidated", scopeType: "media_variant", scopeId: row.id, source: actor.trim(), payload: { variantId: row.id, reason: notes.invalidated.reason } });
      return mapRow(db.prepare("SELECT * FROM media_variants WHERE id = ?").get(row.id));
    });
  }
  return { derive, get, list, invalidate };
}
