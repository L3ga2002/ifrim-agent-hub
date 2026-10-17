// M09 render compiler: EditProjectIR v1 → an ffmpeg render plan. PURE (no I/O, no clock, no randomness): the same IR, profile,
// asset hashes, fonts and tool version always give byte-identical argv, filter graphs and cache keys.
//
// Safety model. The filter graph is built ONLY from validated, typed IR fields: integers (frames), finite numbers (formatted
// by `num()`), closed enums mapped through lookup tables (colour presets, easing, anchors) and colours that match #RRGGBB.
// No string taken from the IR ever enters a filter graph: on-screen text goes to `text/t<n>.txt` and is read by drawtext with
// `textfile=` and `expansion=none` (so "%{…}" in a title is printed, never expanded); captions go to `captions.ass` (escaped by
// captions.toAss) and are burned with `subtitles=…:fontsdir=fonts`. Fonts are copied by the render queue into `<job>/fonts`
// under neutral names (f0.ttf, f1.otf…). Every path inside a graph is RELATIVE to the job folder (the process runs with
// cwd = job dir), so Windows drive letters and backslashes never need filter escaping. Graphs are passed as files with the
// ffmpeg ≥ 7 syntax `-/filter_complex <file>` (verified on ffmpeg 8.1.2), never on the command line (Windows caps a command
// line at 32 767 characters; keyframe expressions can be long).
//
// Plan shape.
// - Segments: one per primary-track clip. A segment normalises the clip on its own: trim (frames at the IR fps), constant speed,
//   IR crop, fit cover|contain (cover is centred on the clip's `focus` when given), keyframed zoom/pan (zoompan with
//   expressions computed from the keyframe numbers; the picture is supersampled ×2 in the final profile so the integer-pixel
//   pan of zoompan does not judder), colour preset, yuv420p, square pixels, exactly clipDuration frames at the IR fps.
//   Segments are video-only (IR v1: video clips are silent in the mix) and cached by `key` = sha256 over (compile version,
//   tool version, profile, asset sha256, the clip's picture parameters, canvas, fps, encoder settings). Text, captions,
//   transitions and audio are NOT in the key, so changing a CTA text never re-renders a clip.
// - Final pass: segments composed with xfade (crossfade = dissolve; fade = dip through canvas.background, made of a fade-out to
//   the background colour on the outgoing clip and a fade-in from it on the incoming one) or concat (cut); xfade offsets and
//   durations come from integer frames and the rational fps (timebase 1/fps, so each offset lands exactly on a frame);
//   drawtext per text item (alpha fades / slide-up computed from frame numbers); burned captions; the audio mix (sample-exact
//   atrim/adelay at 48 kHz, gain, fades, gain envelope, amix without normalisation, padded/trimmed to the timeline) and the
//   loudness target from the IR: draft = single-pass loudnorm; final = two-pass (the queue runs `measure` first and compiles
//   again with the measured values; a silent mix is left silent). Encode: draft = half resolution, x264 ultrafast CRF 30,
//   AAC 128k; final = x264 medium CRF 18, yuv420p, AAC 192k 48 kHz stereo, +faststart. Metadata and chapters of the inputs are
//   dropped (-map_metadata -1): a phone recording's location never reaches a render.
//
// Geometry conventions (documented here because the IR leaves them to the backend): keyframe `scale`/`cx`/`cy` are relative
// to the clip's picture AFTER crop and fit (scale 1 = the whole fitted canvas picture; the visible window is 1/scale of it,
// centred on (cx, cy) and clamped to the picture). `focus` is in source coordinates and only moves the cover crop window.
// A gain envelope, when present, is the clip's absolute gain curve in dB (linear in dB between points, held before the first
// and after the last point); without an envelope the clip plays at `gainDb`.
import { HubError } from "../core/errors.mjs";
import { canonicalJson, sha256 } from "../core/canonical.mjs";
import { validateIR, clipDuration, timelineDuration, framesToMs, isStillVersion, primaryVideoTrack } from "./ir.mjs";
import { normalizeRo, wrapLines, toAss } from "./captions.mjs";
import { PRESETS } from "./visual-bible.mjs";
import { textAdvancePx } from "./variants.mjs";

export const COMPILE_VERSION = "m09-compile-1";
export const AUDIO_RATE = 48000;
export const RENDER_PROFILES = Object.freeze({
  draft: Object.freeze({ id: "draft", scale: 0.5, supersample: 1, segment: { preset: "ultrafast", crf: 20 }, video: { preset: "ultrafast", crf: 30 }, audioBitrate: "128k", loudness: "single_pass" }),
  final: Object.freeze({ id: "final", scale: 1, supersample: 2, segment: { preset: "veryfast", crf: 14 }, video: { preset: "medium", crf: 18 }, audioBitrate: "192k", loudness: "two_pass" }),
});
/** Fixed filter chains per IR colour preset (closed table; the IR only names the preset). */
export const COLOR_FILTERS = Object.freeze({
  neutral: null,
  crisp: "eq=contrast=1.06:saturation=1.08,unsharp=lx=5:ly=5:la=0.35",
  warm: "colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03",
  cool: "colorbalance=rs=-0.04:bs=0.05:rm=-0.02:bm=0.03",
  mono: "hue=s=0",
});
const LRA = 11;
const HEX = /^#([0-9A-Fa-f]{6})$/;
const SHA = /^[0-9a-f]{64}$/;
const FONT_EXT = /\.(ttf|otf|ttc)$/i;
// Average advance of a glyph as a fraction of the font size, used to pre-wrap drawtext lines to `maxWidth` (drawtext does not
// wrap). Deliberately generous for Segoe/Bahnschrift so a wrapped line stays inside the box.
const GLYPH_ADVANCE = 0.52;
/** M10: the plate behind a text item that asks for one (`plate: true`) when its style has no box of its own. */
export const DEFAULT_PLATE = Object.freeze({ color: "#0B0D10", opacity: 0.9, padRel: 0.014 });

const fail = (code, message, data) => { throw new HubError("validation", message, { code, data }); };

/** A finite number formatted for an ffmpeg expression (max 6 decimals, no exponent, no trailing zeros). */
export function num(value, digits = 6) {
  const v = Number(value);
  if (typeof value !== "number" || !Number.isFinite(v)) throw new HubError("internal", "Valoare numerică invalidă în planul de randare.", { code: "COMPILE_NUMBER" });
  if (Math.abs(v) < 0.5 * 10 ** -digits) return "0";
  let s = v.toFixed(digits);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}
const int = (value) => {
  if (!Number.isInteger(value)) throw new HubError("internal", "Valoare întreagă invalidă în planul de randare.", { code: "COMPILE_NUMBER" });
  return String(value);
};
/** "#RRGGBB" → "0xRRGGBB" (validated; anything else is refused). */
export function hexColor(value) {
  const m = HEX.exec(String(value || ""));
  if (!m) fail("COMPILE_COLOR", `Culoare invalidă în preset sau canvas: „${String(value).slice(0, 20)}”.`);
  return `0x${m[1].toUpperCase()}`;
}
const opacityOf = (v, d = 1) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const even = (v) => Math.max(16, Math.round(v / 2) * 2);
/** Seconds of `frames` at the rational fps (exact rational, formatted to microseconds). */
const secs = ({ num: n, den: d }, frames) => num((frames * d) / n);
/** Samples at 48 kHz for a frame index (rounded from the exact rational). */
const samplesOf = ({ num: n, den: d }, frames) => Math.round((frames * d * AUDIO_RATE) / n);

/** The output canvas for a profile: draft = half resolution, rounded to even dimensions. */
export function profileCanvas(canvas, profile) {
  const p = RENDER_PROFILES[profile];
  if (!p) fail("PROFILE_INVALID", `Profil de randare necunoscut: „${String(profile).slice(0, 20)}” (permise: draft, final).`);
  return { width: even(canvas.width * p.scale), height: even(canvas.height * p.scale) };
}

/** Parses the JSON block loudnorm prints with print_format=json (stderr lines). → measurement or null. */
export function parseLoudnormJson(lines) {
  if (!Array.isArray(lines)) return null;
  const text = lines.join("\n");
  const start = text.lastIndexOf("{");
  const end = text.indexOf("}", start);
  if (start < 0 || end < 0) return null;
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const pick = (k) => {
    const s = String(raw?.[k] ?? "").trim();
    if (/^-?inf$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    const v = Number(s);
    return s !== "" && Number.isFinite(v) ? v : null;
  };
  const m = { inputI: pick("input_i"), inputTp: pick("input_tp"), inputLra: pick("input_lra"), inputThresh: pick("input_thresh"), targetOffset: pick("target_offset") };
  if (Object.values(m).some((v) => v === null)) return null;
  return m;
}
/** A measurement usable for the second loudnorm pass (finite and inside sane EBU R128 ranges). Silent mixes are not. */
export function usableMeasurement(m) {
  if (!m) return false;
  const finite = [m.inputI, m.inputTp, m.inputLra, m.inputThresh, m.targetOffset].every((v) => Number.isFinite(v));
  return finite && m.inputI > -70 && m.inputI < 5 && m.inputTp > -100 && m.inputTp < 30 && m.inputLra >= 0 && m.inputLra < 100
    && m.inputThresh > -100 && m.inputThresh < 5 && Math.abs(m.targetOffset) < 100;
}

// ---------------------------------------------------------------------------------------------------------------------
// keyframes

/** Piecewise expression in `on` (zoompan output frame, 0 at the clip start) for one keyframe property. */
function keyframeExpr(kfs, key) {
  if (kfs.length === 1) return num(kfs[0][key]);
  let expr = num(kfs[kfs.length - 1][key]);
  for (let i = kfs.length - 2; i >= 0; i -= 1) {
    const a = kfs[i], b = kfs[i + 1];
    const span = b.frame - a.frame;
    const p = `clip((on-${int(a.frame)})/${int(span)},0,1)`;
    const eased = b.ease === "inOut" ? `(${p}*${p}*(3-2*${p}))` : p;
    const delta = b[key] - a[key];
    const seg = delta === 0 ? num(a[key]) : `${num(a[key])}+${num(delta)}*${eased}`;
    expr = `if(lt(on,${int(b.frame)}),${seg},${expr})`;
  }
  return `if(lt(on,${int(kfs[0].frame)}),${num(kfs[0][key])},${expr})`;
}

/** The gain envelope (absolute dB) as a volume expression in `t` (seconds from the clip start). */
function envelopeExpr(points, fps) {
  const pts = points.map((p) => ({ t: (p.frame * fps.den) / fps.num, g: p.gainDb }));
  if (pts.length === 1) return `pow(10,${num(pts[0].g)}/20)`;
  let expr = num(pts[pts.length - 1].g);
  for (let i = pts.length - 2; i >= 0; i -= 1) {
    const a = pts[i], b = pts[i + 1];
    const span = b.t - a.t;
    const delta = b.g - a.g;
    const seg = delta === 0 || span <= 0 ? num(a.g) : `${num(a.g)}+${num(delta)}*clip((t-${num(a.t)})/${num(span)},0,1)`;
    expr = `if(lt(t,${num(b.t)}),${seg},${expr})`;
  }
  return `pow(10,(if(lt(t,${num(pts[0].t)}),${num(pts[0].g)},${expr}))/20)`;
}

// ---------------------------------------------------------------------------------------------------------------------
// inputs

function checkAssets(assets, versionIds) {
  if (!assets || typeof assets !== "object") fail("INPUT_MISSING", "Lipsește harta fișierelor media pentru randare.");
  const out = {};
  for (const id of versionIds) {
    const a = assets[id];
    if (!a || typeof a !== "object") fail("INPUT_MISSING", `Fișierul pentru versiunea „${id}” nu este disponibil pentru randare.`, { versionId: id });
    const p = typeof a.inputPath === "string" && a.inputPath ? a.inputPath : a.absPath;
    if (typeof p !== "string" || !p || /[\0\r\n]/.test(p)) fail("INPUT_MISSING", `Calea fișierului pentru „${id}” este invalidă.`, { versionId: id });
    if (typeof a.sha256 !== "string" || !SHA.test(a.sha256)) fail("INPUT_MISSING", `Amprenta SHA-256 lipsește pentru „${id}”.`, { versionId: id });
    if (!a.probe || typeof a.probe !== "object") fail("INPUT_MISSING", `Analiza ffprobe lipsește pentru „${id}”.`, { versionId: id });
    out[id] = { path: p, sha256: a.sha256, probe: a.probe, still: isStillVersion({ kind: a.kind, probe: a.probe }) };
  }
  return out;
}

/**
 * Font role → { file, family, copy } from `fonts` ({ [file]: absPath }, e.g. resolveFonts().files) and optionally
 * `fontRoles` (resolveFonts().roles, which records fallbacks). Copies get neutral names (f<n>.<ext>) in sorted file order.
 */
function fontPlan(preset, fonts, fontRoles, roles) {
  const byRole = {};
  const files = new Set();
  for (const role of roles) {
    const declared = preset.fonts?.[role];
    if (!declared) fail("FONT_MISSING", `Presetul „${preset.id}” nu definește fontul pentru rolul „${role}”.`);
    const resolved = fontRoles?.[role];
    let file = null, family = null;
    if (resolved?.file && fonts?.[resolved.file]) { file = resolved.file; family = resolved.family; }
    else if (declared.file && fonts?.[declared.file]) { file = declared.file; family = declared.family; }
    else if (declared.fallback?.file && fonts?.[declared.fallback.file]) { file = declared.fallback.file; family = declared.fallback.family; }
    if (!file) fail("FONT_MISSING", `Fontul „${declared.family}” (${declared.file}) lipsește și nu are înlocuitor; textul nu poate fi randat.`, { role });
    if (!FONT_EXT.test(file) || typeof fonts[file] !== "string") fail("FONT_MISSING", `Fișier de font invalid: „${String(file).slice(0, 60)}”.`);
    byRole[role] = { file, family };
    files.add(file);
  }
  const sorted = [...files].sort();
  const copies = {};
  const nameOf = {};
  sorted.forEach((file, i) => {
    const name = `fonts/f${i}${file.slice(file.lastIndexOf(".")).toLowerCase()}`;
    nameOf[file] = name;
    copies[name] = fonts[file];
  });
  for (const role of Object.keys(byRole)) byRole[role].copy = nameOf[byRole[role].file];
  return { byRole, copies };
}

function resolvePreset(ir, preset) {
  const p = preset || PRESETS[ir.preset?.id];
  if (!p || p.id !== ir.preset.id || p.version !== ir.preset.version) fail("PRESET_UNKNOWN", `Presetul vizual „${ir.preset?.id}” v${ir.preset?.version} nu este disponibil pentru randare.`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// segments

function segmentFor({ clip, index, asset, fps, canvas, profile, background, toolVersion, compileVersion }) {
  const prof = RENDER_PROFILES[profile];
  const D = clipDuration(clip);
  const keyframes = Array.isArray(clip.keyframes) ? clip.keyframes : [];
  const ss = keyframes.length ? prof.supersample : 1;
  const W = canvas.width, H = canvas.height;
  const WS = W * ss, HS = H * ss;
  const crop = clip.crop || { x: 0, y: 0, w: 1, h: 1 };
  const fit = clip.fit === "contain" ? "contain" : "cover";
  const color = COLOR_FILTERS[clip.color?.preset || "neutral"];
  if (color === undefined) fail("IR_INVALID", "Preset de culoare necunoscut.");
  const params = {
    still: asset.still, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut, speed: asset.still ? 1 : clip.speed ?? 1, fit, crop,
    keyframes: keyframes.map((k) => ({ frame: k.frame, scale: k.scale, cx: k.cx, cy: k.cy, ease: k.ease || "linear" })),
    focus: fit === "cover" ? clip.focus || null : null, color: clip.color?.preset || "neutral", frames: D,
  };
  const key = sha256(canonicalJson({ v: compileVersion, tool: toolVersion, profile, asset: asset.sha256, clip: params,
    canvas: { width: W, height: H, supersample: ss, background: fit === "contain" ? background : null }, fps, encoder: prof.segment }));

  const chain = [];
  const S = clip.sourceOut - clip.sourceIn;
  if (asset.still) chain.push(`fps=${int(fps.num)}/${int(fps.den)}`);
  else {
    chain.push(`fps=${int(fps.num)}/${int(fps.den)}:round=near`, `trim=end_frame=${int(S)}`, "setpts=PTS-STARTPTS");
    if (params.speed !== 1) chain.push(`setpts=(PTS-STARTPTS)/${num(params.speed)}`, `fps=${int(fps.num)}/${int(fps.den)}:round=near`);
  }
  // Square pixels first, so the fit works on the displayed aspect ratio.
  chain.push("scale=w='trunc(iw*if(gt(sar,0),sar,1)/2)*2':h='trunc(ih/2)*2'", "setsar=1");
  if (crop.x !== 0 || crop.y !== 0 || crop.w !== 1 || crop.h !== 1) {
    chain.push(`crop=w='max(2,floor(iw*${num(crop.w)}/2)*2)':h='max(2,floor(ih*${num(crop.h)}/2)*2)':x='floor(iw*${num(crop.x)})':y='floor(ih*${num(crop.y)})'`);
  }
  if (fit === "cover") {
    let fx = 0.5, fy = 0.5;
    if (params.focus) {
      const f = params.focus;
      fx = Math.min(1, Math.max(0, (f.x + f.w / 2 - crop.x) / crop.w));
      fy = Math.min(1, Math.max(0, (f.y + f.h / 2 - crop.y) / crop.h));
    }
    chain.push(`scale=w=${int(WS)}:h=${int(HS)}:force_original_aspect_ratio=increase:force_divisible_by=2`,
      `crop=w=${int(WS)}:h=${int(HS)}:x='max(0,min(iw-ow,iw*${num(fx)}-ow/2))':y='max(0,min(ih-oh,ih*${num(fy)}-oh/2))'`);
  } else {
    chain.push(`scale=w=${int(WS)}:h=${int(HS)}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      `pad=w=${int(WS)}:h=${int(HS)}:x='(ow-iw)/2':y='(oh-ih)/2':color=${background}`);
  }
  if (keyframes.length) {
    const sorted = [...params.keyframes].sort((a, b) => a.frame - b.frame);
    const z = keyframeExpr(sorted, "scale");
    const cx = keyframeExpr(sorted, "cx");
    const cy = keyframeExpr(sorted, "cy");
    chain.push(`zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw*(${cx})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*(${cy})-ih/zoom/2))':d=1:s=${int(W)}x${int(H)}:fps=${int(fps.num)}/${int(fps.den)}`);
  }
  if (color) chain.push(color);
  chain.push("format=yuv420p", "setsar=1", `tpad=stop_mode=clone:stop=${int(D)}`, `trim=end_frame=${int(D)}`, "setpts=PTS-STARTPTS");
  const graph = `[0:v]${chain.join(",")}[v]\n`;

  const graphFile = `seg/${key}.graph.txt`;
  const output = `seg/${key}.mp4`;
  const partial = `seg/${key}.partial.mp4`;
  const args = ["-y", "-loglevel", "warning"];
  if (asset.still) args.push("-loop", "1", "-framerate", `${int(fps.num)}/${int(fps.den)}`, "-t", secs(fps, D + 2));
  else {
    // Seek a quarter frame early (accurate seek keeps frames at or after the seek point; a rounding error must never drop the
    // first wanted frame) and read two frames more than needed; trim/tpad then fix the exact count.
    const start = Math.max(0, ((clip.sourceIn - 0.25) * fps.den) / fps.num);
    if (start > 0) args.push("-ss", num(start));
    args.push("-t", secs(fps, S + 2));
  }
  args.push("-protocol_whitelist", "file,pipe", "-i", asset.path, "-/filter_complex", graphFile, "-map", "[v]", "-an", "-sn", "-dn",
    "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "libx264", "-preset", prof.segment.preset, "-crf", int(prof.segment.crf),
    "-pix_fmt", "yuv420p", "-r", `${int(fps.num)}/${int(fps.den)}`, "-fps_mode", "cfr", "-frames:v", int(D), "-movflags", "+faststart", partial);
  return { key, clipId: clip.id, index, frames: D, args, output, partial, inputs: [{ versionId: clip.assetVersionId, sha256: asset.sha256 }],
    files: { [graphFile]: graph }, params };
}

// ---------------------------------------------------------------------------------------------------------------------
// final pass pieces

function audioChains({ clips, fps, baseIndex, totalSamples }) {
  const parts = [];
  const labels = [];
  clips.forEach((c, k) => {
    const start = samplesOf(fps, c.sourceIn);
    const end = samplesOf(fps, c.sourceOut);
    const len = end - start;
    const f = [`aresample=${AUDIO_RATE}`, "aformat=sample_fmts=fltp:channel_layouts=stereo", `atrim=start_sample=${int(start)}:end_sample=${int(end)}`, "asetpts=PTS-STARTPTS"];
    if (Array.isArray(c.envelope) && c.envelope.length) f.push(`volume=volume='${envelopeExpr([...c.envelope].sort((a, b) => a.frame - b.frame), fps)}':eval=frame`);
    else if (c.gainDb) f.push(`volume=${num(c.gainDb, 3)}dB`);
    if (c.fadeIn) f.push(`afade=t=in:ss=0:ns=${int(Math.min(len, samplesOf(fps, c.fadeIn)))}`);
    if (c.fadeOut) { const ns = Math.min(len, samplesOf(fps, c.fadeOut)); f.push(`afade=t=out:ss=${int(Math.max(0, len - ns))}:ns=${int(ns)}`); }
    const delay = samplesOf(fps, c.start);
    if (delay > 0) f.push(`adelay=delays=${int(delay)}S:all=1`);
    const label = `a${k}`;
    parts.push(`[${int(baseIndex + k)}:a]${f.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });
  let mixed;
  if (!labels.length) {
    parts.push(`anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end_sample=${int(totalSamples)}[amix]`);
    mixed = "[amix]";
  } else {
    const head = labels.length === 1 ? `${labels[0]}anull` : `${labels.join("")}amix=inputs=${int(labels.length)}:duration=longest:dropout_transition=0:normalize=0`;
    parts.push(`${head},apad=whole_len=${int(totalSamples)},atrim=end_sample=${int(totalSamples)},asetpts=PTS-STARTPTS[amix]`);
    mixed = "[amix]";
  }
  return { parts, mixed };
}

function textItems(ir) {
  const out = [];
  for (const track of ir.tracks) if (track.kind === "text") for (const item of track.items || []) out.push(item);
  return out;
}
function captionTrack(ir) {
  return ir.tracks.find((t) => t.kind === "captions") || null;
}

function drawtextFor({ item, index, style, fontCopy, family = "", canvas, fps, motion }) {
  const H = canvas.height, W = canvas.width;
  const size = Math.max(8, Math.round((Number(style.sizeRel) || 0.03) * H * (Number(item.scale) || 1)));
  let text = normalizeRo(item.text);
  if (style.uppercase) text = text.toLocaleUpperCase("ro-RO");
  // The same glyph-advance estimate QA uses for its text boxes (variants.textAdvancePx), so the wrapped lines QA checks are the
  // rendered ones; GLYPH_ADVANCE remains the floor for an unknown family.
  const advance = Math.max(size * GLYPH_ADVANCE, textAdvancePx({ family, uppercase: Boolean(style.uppercase), letterSpacing: style.letterSpacing }, size));
  const maxChars = Math.max(8, Math.floor(((item.maxWidth ?? 0.86) * W) / advance));
  const lines = wrapLines(text, { maxChars, maxLines: 8 }).lines;
  const file = `text/t${index}.txt`;
  const S = item.start, E = item.end, len = E - S;
  const fadeMs = Number(motion?.fadeMs) || 0;
  const animated = item.animation === "fade" || item.animation === "slide_up";
  const F = animated && fadeMs > 0 ? Math.max(1, Math.min(Math.floor(len / 2), Math.round((fadeMs * fps.num) / (1000 * fps.den)))) : 0;
  const progress = F ? `clip(min((n-${int(S)}+1)/${int(F)},(${int(E)}-n)/${int(F)}),0,1)` : null;
  const X = num(item.x ?? 0.5), Y = num(item.y ?? 0.5);
  const anchorOffset = item.anchor === "top" ? "" : item.anchor === "bottom" ? "-th" : "-th/2";
  const slide = item.animation === "slide_up" && progress ? `+(1-${progress})*h*0.03` : "";
  const opts = [
    `fontfile=${fontCopy}`, `textfile=${file}`, "expansion=none", "text_align=center", `fontsize=${int(size)}`,
    `fontcolor=${hexColor(style.color)}@${num(opacityOf(style.opacity), 3)}`,
    `line_spacing=${int(Math.max(0, Math.round(size * ((Number(style.lineHeight) || 1.15) - 1))))}`,
    `x='max(0,min(w-tw,w*${X}-tw/2))'`, `y='max(0,min(h-th,h*${Y}${anchorOffset}${slide}))'`,
    `enable='between(n,${int(S)},${int(E - 1)})'`,
  ];
  // A plate requested by the item (M10 legibility) must make the text readable over a busy UI: the style's own box made at least as
  // opaque and padded as the default plate (a 0.75 box over light UI text lets 25 % of it show through), otherwise the default plate.
  const box = item.plate === true
    ? (style.box ? { ...style.box, opacity: Math.max(Number(style.box.opacity ?? 1), DEFAULT_PLATE.opacity), padRel: Math.max(Number(style.box.padRel) || 0.008, DEFAULT_PLATE.padRel) } : DEFAULT_PLATE)
    : style.box || null;
  if (box && item.plate !== false) {
    opts.push("box=1", `boxcolor=${hexColor(box.color)}@${num(opacityOf(box.opacity), 3)}`, `boxborderw=${int(Math.max(1, Math.round((Number(box.padRel) || 0.008) * H)))}`);
  }
  if (style.shadow) {
    const d = Math.max(1, Math.round((Number(style.shadow.blurRel) || 0.003) * H));
    opts.push(`shadowcolor=${hexColor(style.shadow.color || "#000000")}@${num(opacityOf(style.shadow.opacity, 0.5), 3)}`, `shadowx=${int(d)}`, `shadowy=${int(d)}`);
  }
  if (progress) opts.push(`alpha='${progress}'`);
  return { filter: `drawtext=${opts.join(":")}`, file, content: `${lines.join("\n")}` };
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * compileRenderPlan({ ir, profile, assets: { [versionId]: { absPath | inputPath, probe, sha256, kind? } }, fonts: { [file]: absPath },
 *   fontRoles?, preset?, toolVersion, compileVersion?, loudness? }) → plan (see the module header).
 * `loudness` = a measurement from `parseLoudnormJson` (final profile, second compile). Throws HubError("validation") with codes
 * IR_INVALID, PROFILE_INVALID, INPUT_MISSING, FONT_MISSING, PRESET_UNKNOWN, TOOL_VERSION_MISSING.
 */
export function compileRenderPlan({ ir: rawIr, profile, assets, fonts = {}, fontRoles = null, preset = null, toolVersion, compileVersion = COMPILE_VERSION, loudness = null } = {}) {
  if (!RENDER_PROFILES[profile]) fail("PROFILE_INVALID", `Profil de randare necunoscut: „${String(profile).slice(0, 20)}” (permise: draft, final).`);
  if (typeof toolVersion !== "string" || !toolVersion.trim() || toolVersion.length > 200) fail("TOOL_VERSION_MISSING", "Versiunea ffmpeg lipsește; planul de randare și cheile de cache depind de ea.");
  const presetBody = rawIr && typeof rawIr === "object" && rawIr.preset ? resolvePreset(rawIr, preset) : null;
  const validation = validateIR(rawIr, presetBody ? { presets: [presetBody] } : {});
  if (!validation.ok) {
    const first = validation.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    fail("IR_INVALID", `IR invalid (${validation.errors.length} erori): ${first}`, { errors: validation.errors.slice(0, 50) });
  }
  const ir = validation.ir;
  const prof = RENDER_PROFILES[profile];
  const fps = { num: ir.fps.num, den: ir.fps.den };
  const canvas = profileCanvas(ir.canvas, profile);
  const background = hexColor(ir.canvas.background || "#000000");
  const D = timelineDuration(ir);
  const media = checkAssets(assets, validation.dependencies.assetVersionIds);
  const video = primaryVideoTrack(ir);

  // Fonts: only the roles actually drawn (text styles used + the caption style when burned).
  const items = textItems(ir);
  const caps = captionTrack(ir);
  const burn = Boolean(caps && caps.burnIn !== false && (caps.cues || []).length);
  const roles = new Set();
  for (const item of items) {
    const st = presetBody.textStyles?.[item.style];
    if (!st) fail("IR_INVALID", `Stilul de text „${item.style}” nu există în presetul „${presetBody.id}”.`);
    roles.add(st.font);
  }
  if (burn) roles.add(presetBody.captionStyle?.font || "body");
  const fp = fontPlan(presetBody, fonts, fontRoles, [...roles].sort());

  // Segments.
  const segments = video.clips.map((clip, index) => segmentFor({ clip, index, asset: media[clip.assetVersionId], fps, canvas, profile, background, toolVersion, compileVersion }));

  // Final video composition.
  const parts = [];
  const tb = `settb=expr=${int(fps.den)}/${int(fps.num)},setpts=N`;
  segments.forEach((s, i) => parts.push(`[${int(i)}:v]${tb}[s${i}]`));
  let acc = "[s0]";
  let n = 0;
  const label = () => `[c${n++}]`;
  const first = video.clips[0];
  if (first.transitionIn?.kind === "fade") {
    const out = label();
    parts.push(`${acc}fade=t=in:s=0:n=${int(first.transitionIn.frames)}:color=${background}${out}`);
    acc = out;
  }
  for (let i = 1; i < video.clips.length; i += 1) {
    const clip = video.clips[i];
    const t = clip.transitionIn;
    let incoming = `[s${i}]`;
    if (!t) {
      const out = label();
      parts.push(`${acc}${tb}[p${i}];[p${i}]${incoming}concat=n=2:v=1:a=0${out}`);
      acc = out;
      continue;
    }
    if (t.kind === "fade") {
      const a = Math.max(1, Math.floor(t.frames / 2));
      const o1 = label(), o2 = label();
      parts.push(`${acc}fade=t=out:s=${int(clip.start)}:n=${int(a)}:color=${background}${o1}`);
      parts.push(`${incoming}fade=t=in:s=${int(a)}:n=${int(Math.max(1, t.frames - a))}:color=${background}${o2}`);
      acc = o1; incoming = o2;
    }
    const out = label();
    parts.push(`${acc}${tb}[p${i}];${incoming}${tb}[q${i}];[p${i}][q${i}]xfade=transition=fade:duration=${secs(fps, t.frames)}:offset=${secs(fps, clip.start)}${out}`);
    acc = out;
  }

  // Text and captions.
  const files = {};
  const overlays = [];
  items.forEach((item, index) => {
    const style = presetBody.textStyles[item.style];
    const d = drawtextFor({ item, index, style, fontCopy: fp.byRole[style.font].copy, family: fp.byRole[style.font].family, canvas, fps, motion: presetBody.motion });
    files[d.file] = d.content;
    overlays.push(d.filter);
  });
  if (burn) {
    const capRole = presetBody.captionStyle?.font || "body";
    // The captions track's own layout (a platform variant's safe area and anchor) wins over the preset defaults.
    const capLayout = caps.layout || {};
    files["captions.ass"] = toAss(caps.cues, { canvas, style: { ...(presetBody.captionStyle || {}), ...(capLayout.anchor ? { anchor: capLayout.anchor } : {}) }, fps,
      ...(capLayout.safeArea ? { safeArea: capLayout.safeArea } : {}), fontName: fp.byRole[capRole].family });
    overlays.push("subtitles=filename=captions.ass:fontsdir=fonts");
  }
  parts.push(`${acc}${overlays.length ? `${overlays.join(",")},` : ""}format=yuv420p,setsar=1,trim=end_frame=${int(D)},setpts=PTS-STARTPTS[vout]`);

  // Audio.
  const audioClips = [];
  for (const track of ir.tracks) if (track.kind === "audio") for (const c of track.clips || []) audioClips.push(c);
  const totalSamples = samplesOf(fps, D);
  const target = { targetLufs: ir.loudness.targetLufs, maxTruePeakDb: ir.loudness.maxTruePeakDb };
  const ln = `loudnorm=I=${num(target.targetLufs, 2)}:TP=${num(target.maxTruePeakDb, 2)}:LRA=${int(LRA)}`;
  const audio = audioChains({ clips: audioClips, fps, baseIndex: segments.length, totalSamples });
  parts.push(...audio.parts);
  let loudnessMode = "none";
  let needsMeasurement = false;
  let measure = null;
  let loudnessFilter = null;
  if (audioClips.length) {
    if (prof.loudness === "single_pass") { loudnessMode = "single_pass"; loudnessFilter = `${ln},aresample=${AUDIO_RATE}`; }
    else {
      const m = measureAudio({ audioClips, fps, totalSamples, ln, media });
      measure = m;
      if (!loudness) { needsMeasurement = true; loudnessMode = "two_pass_pending"; }
      else if (!usableMeasurement(loudness)) loudnessMode = "two_pass_silent";
      else {
        loudnessMode = "two_pass";
        loudnessFilter = `${ln}:measured_I=${num(loudness.inputI, 2)}:measured_TP=${num(loudness.inputTp, 2)}:measured_LRA=${num(loudness.inputLra, 2)}:measured_thresh=${num(loudness.inputThresh, 2)}:offset=${num(loudness.targetOffset, 2)}:linear=true,aresample=${AUDIO_RATE}`;
      }
    }
  }
  parts.push(`${audio.mixed}${loudnessFilter ? `${loudnessFilter},` : ""}aformat=sample_fmts=fltp:sample_rates=${AUDIO_RATE}:channel_layouts=stereo[aout]`);
  files["graph.txt"] = `${parts.join(";\n")}\n`;

  let args = null;
  if (!needsMeasurement) {
    args = ["-y", "-loglevel", "warning"];
    for (const s of segments) args.push("-protocol_whitelist", "file,pipe", "-i", s.output);
    for (const c of audioClips) args.push("-vn", "-sn", "-dn", "-protocol_whitelist", "file,pipe", "-i", media[c.assetVersionId].path);
    args.push("-/filter_complex", "graph.txt", "-map", "[vout]", "-map", "[aout]", "-map_metadata", "-1", "-map_chapters", "-1",
      "-c:v", "libx264", "-preset", prof.video.preset, "-crf", int(prof.video.crf), "-pix_fmt", "yuv420p",
      "-r", `${int(fps.num)}/${int(fps.den)}`, "-fps_mode", "cfr", "-frames:v", int(D),
      "-c:a", "aac", "-b:a", prof.audioBitrate, "-ar", String(AUDIO_RATE), "-ac", "2", "-movflags", "+faststart", "out.partial.mp4");
  }
  const sortedFiles = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const plan = {
    compileVersion, toolVersion, profile, irSha: sha256(canonicalJson(ir)), fps, canvas, expectedFrames: D,
    expectedDurationMs: framesToMs(D, fps), frameMs: framesToMs(1, fps), hasAudio: true, audioClips: audioClips.length,
    segments,
    final: { args, output: "out.partial.mp4", files: sortedFiles, fontCopies: fp.copies, needsMeasurement, loudnessMode,
      inputs: [...segments.map((s) => ({ segmentKey: s.key })), ...audioClips.map((c) => ({ versionId: c.assetVersionId, sha256: media[c.assetVersionId].sha256 }))] },
    measure,
    dependencies: validation.dependencies,
    warnings: validation.warnings,
  };
  plan.planHash = sha256(canonicalJson({ segments: segments.map((s) => ({ key: s.key, args: s.args, files: s.files })), final: plan.final, measure }));
  return plan;
}

/** The first loudnorm pass: the same audio mix, measured only (`-f null`). Inputs are the audio clips alone. */
function measureAudio({ audioClips, fps, totalSamples, ln, media }) {
  const chains = audioChains({ clips: audioClips, fps, baseIndex: 0, totalSamples });
  const graph = `${[...chains.parts, `${chains.mixed}${ln}:print_format=json[am]`].join(";\n")}\n`;
  const args = ["-y", "-loglevel", "info"];
  for (const c of audioClips) args.push("-vn", "-sn", "-dn", "-protocol_whitelist", "file,pipe", "-i", media[c.assetVersionId].path);
  args.push("-/filter_complex", "audio-measure.txt", "-map", "[am]", "-f", "null", "-");
  return { args, files: { "audio-measure.txt": graph } };
}
