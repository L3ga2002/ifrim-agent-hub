// M09 IRCAP: EditProjectIR v1 (strict validation, frame math, timeline helpers, capabilities), captions (Romanian
// normalization, wrapping, readability checks, SRT/VTT/ASS writers) and the visual bible (presets, seed, fonts).
// Pure/deterministic: no ffmpeg, no model, no network. The DB tests use a migrated temp DB from media-helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../server/core/errors.mjs";
import {
  validateIR, assertValidIR, normalizeIR, canonicalIR, irHash, framesToMs, framesToMsInt, msToFrames, maxTransitionFrames,
  framesToTimecode, clipDuration, timelineDuration, activeAt, clipAtFrame, opsUsed, checkBackend, CAPABILITIES, IR_OPS,
} from "../server/media/ir.mjs";
import { normalizeRo, wrapLines, checkCues, toSrt, toVtt, toAss, cuesFromSegments, assEscape, assColor, srtTime } from "../server/media/captions.mjs";
import { PRESETS, PRESET_IDS, seedPresets, getPreset, listPresets, resolveFonts, presetSha } from "../server/media/visual-bible.mjs";
import { makeMediaEnv, fakeLaunchers, mediaTempDir } from "./media-helpers.mjs";

const FPS30 = { num: 30, den: 1 };
const NTSC = { num: 30000, den: 1001 };
const FILM = { num: 24000, den: 1001 };

// Fake asset catalogue in the shape assets.getVersion() returns (probe already normalized).
const VERSIONS = {
  mav_screen: { status: "READY", origin: "OWNED", capture_label: "ORIGINAL_RECORDING", probe: { container: "mov,mp4,m4a,3gp,3g2,mj2", durationMs: 10000, hasVideo: true, hasAudio: true, video: { width: 1920, height: 1080, fps: { num: 30, den: 1 } }, audio: { codec: "aac" } } },
  mav_sim: { status: "READY", origin: "OWNED", capture_label: "SIMULATION", probe: { container: "mov,mp4,m4a,3gp,3g2,mj2", durationMs: 5000, hasVideo: true, hasAudio: false, video: { width: 1920, height: 1080 }, audio: null } },
  mav_music: { status: "READY", origin: "LICENSED", capture_label: "NOT_APPLICABLE", probe: { container: "wav", durationMs: 60000, hasVideo: false, hasAudio: true, video: null, audio: { codec: "pcm_s16le" } } },
  mav_still: { status: "READY", origin: "OWNED", capture_label: "NOT_APPLICABLE", kind: "image", probe: { container: "png_pipe", durationMs: null, hasVideo: true, hasAudio: false, video: { width: 1080, height: 1920, frameCount: 1 } } },
  mav_quar: { status: "QUARANTINED", origin: "OWNED", capture_label: "NOT_APPLICABLE", probe: {} },
  mav_gone: { status: "MISSING", origin: "OWNED", capture_label: "NOT_APPLICABLE", probe: { durationMs: 10000, hasVideo: true } },
  mav_film: { status: "READY", origin: "OWNED", capture_label: "ORIGINAL_RECORDING", probe: { container: "mov", durationMs: 10000, hasVideo: true, hasAudio: false, video: {} } },
};
const getVersion = (id) => VERSIONS[id] || null;
const FONTS_OK = { ok: true, missing: [] };
const opts = (extra = {}) => ({ getVersion, presets: PRESETS, fonts: FONTS_OK, ...extra });

/** A valid master: two video clips with a 12-frame crossfade, a hook, captions, music, an evidence region. */
function baseIR() {
  return {
    irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1920, background: "#0B0D10" },
    preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [
        { id: "c1", assetVersionId: "mav_screen", sourceIn: 0, sourceOut: 150, start: 0, speed: 1, fit: "cover", crop: { x: 0, y: 0, w: 1, h: 1 },
          keyframes: [{ frame: 0, scale: 1, cx: 0.5, cy: 0.5 }, { frame: 90, scale: 1.12, cx: 0.55, cy: 0.5, ease: "inOut" }],
          focus: { x: 0.3, y: 0.2, w: 0.4, h: 0.3 }, shotId: "s1", claimIds: ["ccl_1"], holdIntentional: false, color: { preset: "crisp" } },
        { id: "c2", assetVersionId: "mav_sim", sourceIn: 0, sourceOut: 120, start: 138, transitionIn: { kind: "crossfade", frames: 12 }, label: "SIMULATION" },
      ] },
      { id: "t1", kind: "text", items: [
        { id: "x1", start: 0, end: 30, text: "Raport în 3 secunde", style: "hook", anchor: "top", x: 0.5, y: 0.12, maxWidth: 0.86, animation: "fade" },
        { id: "x2", start: 138, end: 258, text: "SIMULATION", style: "label", anchor: "top", x: 0.1, y: 0.05 },
      ] },
      { id: "a1", kind: "audio", clips: [
        { id: "m1", assetVersionId: "mav_music", sourceIn: 0, sourceOut: 258, start: 0, role: "music", gainDb: -20, fadeIn: 15, fadeOut: 30, envelope: [{ frame: 0, gainDb: -20 }, { frame: 200, gainDb: -26 }] },
      ] },
      { id: "cap", kind: "captions", burnIn: true, style: "caption", cues: [
        { id: "q1", start: 10, end: 70, text: "Așa arată raportul." },
        { id: "q2", start: 70, end: 140, text: "Totul durează trei secunde." },
      ] },
    ],
    markers: [{ frame: 0, kind: "hook", note: "" }],
    evidenceRegions: [{ clipId: "c1", from: 30, to: 90, rect: { x: 0.1, y: 0.3, w: 0.5, h: 0.2 }, claimId: "ccl_1" }],
    loudness: { targetLufs: -14, maxTruePeakDb: -1 },
    meta: { title: "Demo raport", labels: ["SIMULATION"], author: "Ifrim Digital", notes: "" },
  };
}
const codes = (result) => result.errors.map((e) => e.code);

test("M09-IR-27 optional text claimIds preserve legacy normalization and validate the id list", () => {
  const ir = baseIR(), before = irHash(ir);
  const baseline = JSON.parse(fs.readFileSync(new URL("fixtures/claims-baseline.json", import.meta.url)));
  assert.equal(before, baseline.legacyIrSha, "hash computed with pristine bedda1d IR normalizer");
  const text = ir.tracks.find(t => t.kind === "text").items[0];
  assert.equal(Object.hasOwn(normalizeIR(ir).tracks.find(t => t.kind === "text").items[0], "claimIds"), false);
  text.claimIds = ["ccl_text"];
  assert.deepEqual(validateIR(ir, opts()).errors, []);
  assert.notEqual(irHash(ir), before);
  for (const invalid of [["not an id"], Array(21).fill("ccl_text"), "ccl_text"]) {
    text.claimIds = invalid;
    assert.ok(validateIR(ir, opts()).errors.some(e => e.path.includes("claimIds")));
  }
  delete text.claimIds;
  assert.equal(irHash(ir), before);
});
const hasError = (result, code, pathPart = "") => result.errors.some((e) => e.code === code && e.path.includes(pathPart));
const video = (ir) => ir.tracks[0];

test("M09-IR-01 valid IR passes with dependencies, duration and a canonical hash", () => {
  const ir = baseIR();
  const r = validateIR(ir, opts());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.durationFrames, 258); // 150 + 120 − 12
  assert.equal(timelineDuration(ir), 258);
  assert.deepEqual(r.dependencies.assetVersionIds, ["mav_music", "mav_screen", "mav_sim"]);
  assert.deepEqual(r.dependencies.presets, [{ id: "ifrim-tech", version: 1 }]);
  assert.ok(r.dependencies.fonts.includes("SegUIVar.ttf") && r.dependencies.fonts.includes("CascadiaCode.ttf"), r.dependencies.fonts.join());
  assert.equal(r.ir.tracks[0].clips[1].fit, "cover", "the normalized IR makes defaults explicit");
  // Key order and omitted defaults do not change the hash; a real edit does.
  const reverseKeys = (v) => (Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])])) : v);
  const reordered = reverseKeys(ir);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(ir));
  const explicit = normalizeIR(ir);
  assert.equal(irHash(reordered), irHash(ir));
  assert.equal(irHash(explicit), irHash(ir));
  assert.match(irHash(ir), /^[0-9a-f]{64}$/);
  assert.equal(canonicalIR(ir), canonicalIR(explicit));
  const edited = baseIR(); edited.tracks[1].items[0].text = "Raport în 2 secunde";
  assert.notEqual(irHash(edited), irHash(ir));
  assert.equal(r.warnings.filter((w) => w.code === "LABEL_MISMATCH").length, 0);
  assert.doesNotThrow(() => assertValidIR(ir, opts()));
});

test("M09-IR-02 gaps on the primary track are refused (first clip at 0, contiguity)", () => {
  const gap = baseIR(); video(gap).clips[1].start = 140;
  let r = validateIR(gap, opts());
  assert.equal(r.ok, false);
  assert.ok(hasError(r, "TIMELINE_GAP", "clips[1].start"), codes(r).join());
  const late = baseIR(); video(late).clips[0].start = 5; video(late).clips[1].start = 143;
  r = validateIR(late, opts());
  assert.ok(hasError(r, "TIMELINE_GAP", "clips[0].start"), codes(r).join());
  const noTransition = baseIR(); delete video(noTransition).clips[1].transitionIn; video(noTransition).clips[1].start = 150;
  r = validateIR(noTransition, opts());
  assert.equal(r.ok, true, "a hard cut at prev.start + prev.duration is contiguous");
  assert.equal(r.durationFrames, 270);
});

test("M09-IR-03 overlaps are refused on every track kind", () => {
  const ov = baseIR(); video(ov).clips[1].start = 130;
  let r = validateIR(ov, opts());
  assert.ok(hasError(r, "TIMELINE_OVERLAP", "clips[1].start"), codes(r).join());
  const text = baseIR(); text.tracks[1].items[1].start = 20;
  r = validateIR(text, opts());
  assert.ok(hasError(r, "OVERLAP", "tracks[1].items[1]"), codes(r).join());
  const cue = baseIR(); cue.tracks[3].cues[1].start = 60;
  r = validateIR(cue, opts());
  assert.ok(hasError(r, "CUE_OVERLAP"), codes(r).join());
  const audio = baseIR(); audio.tracks[2].clips.push({ id: "m2", assetVersionId: "mav_music", sourceIn: 0, sourceOut: 30, start: 100, role: "sfx" });
  r = validateIR(audio, opts());
  assert.ok(hasError(r, "OVERLAP", "tracks[2].clips[1]"), codes(r).join());
  const dup = baseIR(); dup.tracks[1].items[1].id = "c1";
  r = validateIR(dup, opts());
  assert.ok(hasError(r, "DUPLICATE_ID"), "ids are unique across tracks (review ops address them by id)");
});

test("M09-IR-04 source frames outside the asset and bad ranges are refused", () => {
  const ir = baseIR(); video(ir).clips[0].sourceOut = 301; video(ir).clips[1].start = 289; // mav_screen = 10 s = 300 frames
  let r = validateIR(ir, opts());
  assert.ok(hasError(r, "SOURCE_OUT_OF_RANGE", "clips[0]"), codes(r).join());
  const edge = baseIR(); video(edge).clips[0].sourceOut = 300; video(edge).clips[1].start = 288;
  r = validateIR(edge, opts());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const inverted = baseIR(); video(inverted).clips[0].sourceIn = 150;
  r = validateIR(inverted, opts());
  assert.ok(hasError(r, "FRAME_RANGE", "clips[0].sourceOut"), codes(r).join());
  const negative = baseIR(); video(negative).clips[0].sourceIn = -1;
  r = validateIR(negative, opts());
  assert.ok(hasError(r, "RANGE", "clips[0].sourceIn"));
  const music = baseIR(); music.tracks[2].clips[0].sourceIn = 1790; music.tracks[2].clips[0].sourceOut = 1810; music.tracks[2].clips[0].fadeIn = 0; music.tracks[2].clips[0].fadeOut = 0; music.tracks[2].clips[0].envelope = [];
  r = validateIR(music, opts());
  assert.ok(hasError(r, "SOURCE_OUT_OF_RANGE", "tracks[2]"), "audio is bounded by its 60 s source too");
});

test("M09-IR-05 speed: constant 0.25–4 only, ramps unsupported", () => {
  const ramp = baseIR(); video(ramp).clips[0].speed = [1, 2];
  let r = validateIR(ramp, opts());
  assert.ok(hasError(r, "UNSUPPORTED_SPEED_RAMP"), codes(r).join());
  const rampKey = baseIR(); video(rampKey).clips[0].speedRamp = [{ frame: 0, speed: 1 }, { frame: 60, speed: 3 }];
  r = validateIR(rampKey, opts());
  assert.ok(hasError(r, "UNSUPPORTED_SPEED_RAMP", "speedRamp"), codes(r).join());
  const remap = baseIR(); video(remap).clips[0].timeRemap = "t*2";
  assert.ok(hasError(validateIR(remap, opts()), "UNSUPPORTED_SPEED_RAMP"));
  for (const speed of [5, 0.2, 0]) {
    const bad = baseIR(); video(bad).clips[0].speed = speed;
    assert.ok(hasError(validateIR(bad, opts()), "UNSUPPORTED_SPEED"), `speed ${speed}`);
  }
  const slow = baseIR(); video(slow).clips[0].sourceOut = 75; video(slow).clips[0].speed = 0.5; video(slow).clips[0].keyframes = [];
  r = validateIR(slow, opts());
  assert.equal(clipDuration(video(slow).clips[0]), 150);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const fast = { sourceIn: 0, sourceOut: 100, speed: 1.5 };
  assert.equal(clipDuration(fast), 67, "round((out − in) / speed)");
});

test("M09-IR-06 unknown fields, ops and expression/shell injection attempts are refused", () => {
  const cases = [
    [(ir) => { video(ir).clips[0].filter = "eq=brightness=0.3,drawtext=text='x'"; }, "UNSUPPORTED_OP", "clips[0].filter"],
    [(ir) => { video(ir).clips[0].filter_complex = "[0:v]split"; }, "UNSUPPORTED_OP", "filter_complex"],
    [(ir) => { video(ir).clips[0].keyframes[1].expression = "if(gt(t,1),2,1)"; }, "UNSUPPORTED_OP", "keyframes[1].expression"],
    [(ir) => { ir.tracks[1].items[0].fontfile = "C:/Windows/Fonts/x.ttf"; }, "UNSUPPORTED_OP", "fontfile"],
    [(ir) => { ir.meta.script = "rm -rf /"; }, "UNSUPPORTED_OP", "meta.script"],
    [(ir) => { ir.tracks[2].clips[0].args = ["-f", "lavfi"]; }, "UNSUPPORTED_OP", "args"],
    [(ir) => { ir.ffmpeg = { vf: "x" }; }, "UNSUPPORTED_OP", "ffmpeg"],
    [(ir) => { ir.extra = 1; }, "UNKNOWN_FIELD", "extra"],
    [(ir) => { video(ir).clips[0].blur = 3; }, "UNKNOWN_FIELD", "clips[0].blur"],
    [(ir) => { video(ir).clips[0].fit = "cover; rm -rf /"; }, "UNSUPPORTED_VALUE", "fit"],
    [(ir) => { video(ir).clips[0].color = { preset: "lut3d=evil.cube" }; }, "UNSUPPORTED_VALUE", "color.preset"],
    [(ir) => { video(ir).clips[1].transitionIn.kind = "wipe"; }, "UNSUPPORTED_VALUE", "transitionIn.kind"],
    [(ir) => { video(ir).clips[0].assetVersionId = "../../etc/passwd"; }, "FORMAT", "assetVersionId"],
    [(ir) => { video(ir).clips[0].sourceOut = "150"; }, "TYPE", "sourceOut"],
    [(ir) => { ir.tracks[1].items[0].text = "a\u0000b"; }, "CONTROL_CHARS", "items[0].text"],
    [(ir) => { ir.tracks[1].items[0].text = "evil\u202Etxt"; }, "CONTROL_CHARS", "items[0].text"],
    [(ir) => { ir.tracks[1].items[0].style = "hook;x"; }, "FORMAT", "style"],
    [(ir) => { ir.tracks.push({ id: "fx", kind: "effect", items: [] }); }, "UNKNOWN_TRACK_KIND", "tracks[4].kind"],
    [(ir) => { ir.tracks.push({ id: "v2", kind: "video", clips: [] }); }, "VIDEO_TRACK_COUNT", "tracks"],
    [(ir) => { ir.canvas.background = "red"; }, "FORMAT", "canvas.background"],
    [(ir) => { ir.irVersion = 2; }, "UNSUPPORTED_VERSION", "irVersion"],
  ];
  for (const [mutate, code, where] of cases) {
    const ir = baseIR(); mutate(ir);
    const r = validateIR(ir, opts());
    assert.equal(r.ok, false, `${code} ${where}`);
    assert.ok(hasError(r, code, where), `${code} @ ${where}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.ir, undefined, "no normalized IR is handed out when invalid");
  }
  // Prototype pollution through JSON: "__proto__" is an own key after JSON.parse and must be refused, not merged.
  const polluted = JSON.parse(JSON.stringify(baseIR()).replace('"irVersion":1', '"irVersion":1,"__proto__":{"polluted":true}'));
  const r = validateIR(polluted, opts());
  assert.ok(hasError(r, "UNKNOWN_FIELD", "__proto__"), codes(r).join());
  assert.equal({}.polluted, undefined);
  // Non-objects and non-serializable input.
  assert.ok(hasError(validateIR("[]", opts()), "TYPE"));
  const cyclic = baseIR(); cyclic.meta.self = cyclic;
  assert.ok(hasError(validateIR(cyclic, opts()), "NOT_JSON"));
  assert.ok(hasError(validateIR({ ...baseIR(), meta: { notes: "x".repeat(3 * 1024 * 1024) } }, opts()), "TOO_LARGE"));
});

test("M09-IR-07 NaN, Infinity and fractional frames are refused", () => {
  const nan = baseIR(); video(nan).clips[0].sourceOut = NaN;
  assert.ok(hasError(validateIR(nan, opts()), "NOT_FINITE", "sourceOut"));
  const inf = baseIR(); video(inf).clips[0].keyframes[1].scale = Infinity;
  assert.ok(hasError(validateIR(inf, opts()), "NOT_FINITE", "scale"));
  const frac = baseIR(); video(frac).clips[1].start = 138.5;
  assert.ok(hasError(validateIR(frac, opts()), "NOT_INTEGER", "clips[1].start"));
  const gain = baseIR(); gain.tracks[2].clips[0].gainDb = NaN;
  assert.ok(hasError(validateIR(gain, opts()), "NOT_FINITE", "gainDb"));
  const fps = baseIR(); fps.fps = { num: 29.97, den: 1 };
  assert.ok(hasError(validateIR(fps, opts()), "NOT_INTEGER", "fps.num"), "fractional fps must be written as a rational");
  assert.throws(() => msToFrames(NaN, FPS30), HubError);
});

test("M09-IR-08 23.976 (24000/1001) frame math is exact", () => {
  assert.equal(framesToMs(24000, FILM), 1001000);
  assert.equal(framesToMsInt(1, FILM), 42); // 41.708…
  assert.equal(framesToMsInt(24, FILM), 1001);
  assert.equal(msToFrames(1001000, FILM), 24000);
  assert.equal(msToFrames(1000, FILM, "floor"), 23);
  assert.equal(msToFrames(1000, FILM, "ceil"), 24);
  assert.equal(maxTransitionFrames(FILM), 23);
  // Round-trip of every frame index for 10 minutes: ms → frame recovers the frame.
  for (let f = 0; f < 24 * 600; f += 7) assert.equal(msToFrames(framesToMsInt(f, FILM), FILM), f);
  // 10 s source at 23.976 holds floor(239.76) = 239 frames.
  const ir = baseIR(); ir.fps = FILM;
  ir.tracks = [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_film", sourceIn: 0, sourceOut: 240, start: 0 }] }];
  ir.evidenceRegions = []; ir.meta.labels = [];
  assert.ok(hasError(validateIR(ir, opts()), "SOURCE_OUT_OF_RANGE"));
  ir.tracks[0].clips[0].sourceOut = 239;
  assert.equal(validateIR(ir, opts()).ok, true);
  ir.tracks[0].clips.push({ id: "c2", assetVersionId: "mav_film", sourceIn: 0, sourceOut: 100, start: 215, transitionIn: { kind: "crossfade", frames: 24 } });
  assert.ok(hasError(validateIR(ir, opts()), "TRANSITION_TOO_LONG"), "1 s at 23.976 = 23 whole frames");
});

test("M09-IR-09 29.97 (30000/1001) frame math, timecode and limits", () => {
  assert.equal(framesToMsInt(30, NTSC), 1001);
  assert.equal(framesToMsInt(30000, NTSC), 1001000);
  assert.equal(framesToMsInt(107892, NTSC), 3599996); // 3599996.4
  assert.equal(framesToMsInt(1, NTSC, 100), 3); // centiseconds
  assert.equal(maxTransitionFrames(NTSC), 29);
  assert.equal(framesToTimecode(30, NTSC), "00:00:01:00");
  assert.equal(framesToTimecode(108000, NTSC), "01:00:00:00", "NDF timecode counts frames at the nominal 30");
  assert.equal(framesToTimecode(29, FPS30), "00:00:00:29");
  const ir = baseIR(); ir.fps = NTSC; video(ir).clips[1].transitionIn.frames = 30; video(ir).clips[1].start = 120;
  const r = validateIR(ir, opts());
  assert.ok(hasError(r, "TRANSITION_TOO_LONG"), codes(r).join());
  const okIr = baseIR(); okIr.fps = NTSC;
  assert.equal(validateIR(okIr, opts()).ok, true, "the same frame-based IR is valid at 29.97");
});

test("M09-IR-10 keyframes and envelope points outside the clip or out of order are refused", () => {
  const out = baseIR(); video(out).clips[0].keyframes[1].frame = 150; // clip has frames 0..149
  assert.ok(hasError(validateIR(out, opts()), "KEYFRAME_OUTSIDE_CLIP", "keyframes[1].frame"));
  const edge = baseIR(); video(edge).clips[0].keyframes[1].frame = 149;
  assert.equal(validateIR(edge, opts()).ok, true);
  const order = baseIR(); video(order).clips[0].keyframes[1].frame = 0;
  assert.ok(hasError(validateIR(order, opts()), "KEYFRAME_ORDER"));
  const zoomOut = baseIR(); video(zoomOut).clips[0].keyframes[1].scale = 0.8;
  assert.ok(hasError(validateIR(zoomOut, opts()), "RANGE", "scale"));
  const env = baseIR(); env.tracks[2].clips[0].envelope[1].frame = 258;
  assert.ok(hasError(validateIR(env, opts()), "KEYFRAME_OUTSIDE_CLIP", "envelope[1]"));
  const fades = baseIR(); fades.tracks[2].clips[0].fadeIn = 200; fades.tracks[2].clips[0].fadeOut = 100;
  assert.ok(hasError(validateIR(fades, opts()), "FADE_TOO_LONG"));
  const presetZoom = baseIR(); video(presetZoom).clips[0].keyframes[1].scale = 1.3; video(presetZoom).clips[0].keyframes[1].cx = 0.5;
  const r = validateIR(presetZoom, opts());
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === "ZOOM_ABOVE_PRESET"), "preset motion limit is a warning, not a hard error");
});

test("M09-IR-11 transitions: longer than a clip, crossfade on the first clip, overlapping transitions", () => {
  const long = baseIR();
  video(long).clips[1] = { id: "c2", assetVersionId: "mav_sim", sourceIn: 0, sourceOut: 10, start: 140, transitionIn: { kind: "crossfade", frames: 10 } };
  long.tracks = [video(long)]; long.evidenceRegions = [];
  let r = validateIR(long, opts());
  assert.ok(hasError(r, "TRANSITION_LONGER_THAN_CLIP"), codes(r).join());
  const first = baseIR(); video(first).clips[0].transitionIn = { kind: "crossfade", frames: 10 };
  assert.ok(hasError(validateIR(first, opts()), "TRANSITION_NO_PREVIOUS"));
  const fadeFirst = baseIR(); video(fadeFirst).clips[0].transitionIn = { kind: "fade", frames: 10 };
  assert.equal(validateIR(fadeFirst, opts()).ok, true, "a fade-in from the background is allowed on the first clip");
  const chain = baseIR();
  chain.tracks = [{ id: "v1", kind: "video", clips: [
    { id: "c1", assetVersionId: "mav_screen", sourceIn: 0, sourceOut: 100, start: 0 },
    { id: "c2", assetVersionId: "mav_screen", sourceIn: 0, sourceOut: 30, start: 80, transitionIn: { kind: "crossfade", frames: 20 } },
    { id: "c3", assetVersionId: "mav_screen", sourceIn: 0, sourceOut: 100, start: 90, transitionIn: { kind: "crossfade", frames: 20 } },
  ] }];
  chain.evidenceRegions = []; chain.meta.labels = [];
  r = validateIR(chain, opts());
  assert.ok(hasError(r, "TRANSITION_OVERLAP"), codes(r).join());
  const devlog = baseIR(); devlog.preset = { id: "ifrim-devlog", version: 1 };
  r = validateIR(devlog, opts());
  assert.ok(r.warnings.some((w) => w.code === "PRESET_TRANSITION"), "the devlog preset is cuts-only");
});

test("M09-IR-12 missing, quarantined and unsuitable assets are refused", () => {
  const missing = baseIR(); video(missing).clips[0].assetVersionId = "mav_nope";
  assert.ok(hasError(validateIR(missing, opts()), "ASSET_MISSING", "clips[0]"));
  const quarantined = baseIR(); video(quarantined).clips[0].assetVersionId = "mav_quar";
  let r = validateIR(quarantined, opts());
  assert.ok(hasError(r, "ASSET_UNAVAILABLE", "clips[0]"));
  assert.match(r.errors.find((e) => e.code === "ASSET_UNAVAILABLE").message, /carantină/);
  const gone = baseIR(); video(gone).clips[0].assetVersionId = "mav_gone";
  assert.ok(hasError(validateIR(gone, opts()), "ASSET_UNAVAILABLE"));
  const silent = baseIR(); silent.tracks[2].clips[0].assetVersionId = "mav_sim";
  assert.ok(hasError(validateIR(silent, opts()), "NO_AUDIO_STREAM"));
  const noVideo = baseIR(); video(noVideo).clips[0].assetVersionId = "mav_music";
  assert.ok(hasError(validateIR(noVideo, opts()), "NO_VIDEO_STREAM"));
  const throwing = validateIR(baseIR(), opts({ getVersion: () => { throw new Error("db down"); } }));
  assert.ok(hasError(throwing, "ASSET_MISSING"), "a failing lookup is a refusal, never a pass");
  const unchecked = validateIR(baseIR(), { presets: PRESETS });
  assert.ok(unchecked.warnings.some((w) => w.code === "ASSETS_NOT_CHECKED"));
  // Still image: duration from the timeline, speed 1, sourceIn 0, no source bound.
  const still = baseIR();
  still.tracks = [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_still", sourceIn: 0, sourceOut: 900, start: 0, keyframes: [{ frame: 0, scale: 1, cx: 0.5, cy: 0.5 }, { frame: 899, scale: 1.1, cx: 0.5, cy: 0.5 }] }] }];
  still.evidenceRegions = []; still.meta.labels = [];
  r = validateIR(still, opts());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.durationFrames, 900);
  still.tracks[0].clips[0].speed = 2;
  assert.ok(hasError(validateIR(still, opts()), "UNSUPPORTED_SPEED"));
  // Label coherence warnings.
  const unlabeled = baseIR(); delete video(unlabeled).clips[1].label;
  assert.ok(validateIR(unlabeled, opts()).warnings.some((w) => w.code === "LABEL_MISMATCH"));
  const undeclared = baseIR(); undeclared.meta.labels = [];
  assert.ok(validateIR(undeclared, opts()).warnings.some((w) => w.code === "LABEL_NOT_DECLARED"));
});

test("M09-IR-13 text, audio, captions, markers and evidence regions must lie inside the timeline", () => {
  const text = baseIR(); text.tracks[1].items[1].end = 259;
  assert.ok(hasError(validateIR(text, opts()), "OUT_OF_TIMELINE", "items[1]"));
  const audio = baseIR(); audio.tracks[2].clips[0].start = 10;
  assert.ok(hasError(validateIR(audio, opts()), "OUT_OF_TIMELINE", "tracks[2]"));
  const cue = baseIR(); cue.tracks[3].cues[1].end = 300;
  assert.ok(hasError(validateIR(cue, opts()), "OUT_OF_TIMELINE", "cues[1]"));
  const marker = baseIR(); marker.markers.push({ frame: 258, kind: "cta" });
  assert.ok(hasError(validateIR(marker, opts()), "OUT_OF_TIMELINE", "markers[1]"));
  const ev = baseIR(); ev.evidenceRegions[0].to = 151;
  assert.ok(hasError(validateIR(ev, opts()), "EVIDENCE_OUTSIDE_CLIP"));
  const evClip = baseIR(); evClip.evidenceRegions[0].clipId = "zz";
  assert.ok(hasError(validateIR(evClip, opts()), "CLIP_UNKNOWN"));
  const rect = baseIR(); rect.evidenceRegions[0].rect = { x: 0.8, y: 0.3, w: 0.5, h: 0.2 };
  assert.ok(hasError(validateIR(rect, opts()), "RANGE", "evidenceRegions[0].rect"));
  const order = baseIR(); order.tracks[3].cues.reverse();
  assert.ok(hasError(validateIR(order, opts()), "CUE_ORDER"));
  const cedilla = baseIR(); cedilla.tracks[3].cues[0].text = "Aşa arată";
  assert.ok(validateIR(cedilla, opts()).warnings.some((w) => w.code === "DIACRITIC_CEDILLA"));
  const twoCaptions = baseIR(); twoCaptions.tracks.push({ id: "cap2", kind: "captions", cues: [] });
  assert.ok(hasError(validateIR(twoCaptions, opts()), "CAPTIONS_TRACK_COUNT"));
});

test("M09-IR-14 timeline helpers: clipAtFrame, activeAt, timelineDuration around a crossfade", () => {
  const ir = baseIR();
  assert.equal(clipAtFrame(ir, 0).clip.id, "c1");
  assert.equal(clipAtFrame(ir, 137).clip.id, "c1");
  const during = clipAtFrame(ir, 140);
  assert.equal(during.clip.id, "c2", "the incoming clip is on top during the dissolve");
  assert.equal(during.inTransition, true);
  assert.equal(during.previous.id, "c1");
  assert.equal(during.localFrame, 2);
  assert.equal(clipAtFrame(ir, 150).inTransition, false);
  assert.equal(clipAtFrame(ir, 257).clip.id, "c2");
  assert.equal(clipAtFrame(ir, 258), null, "half-open: the last frame index is duration − 1");
  const a = activeAt(ir, 140);
  assert.deepEqual(a.video.map((v) => v.clip.id).sort(), ["c1", "c2"]);
  assert.equal(a.video.find((v) => v.clip.id === "c1").sourceFrame, 140);
  assert.deepEqual(a.text.map((t) => t.item.id), ["x2"]);
  assert.deepEqual(a.cues.map((c) => c.cue.id), []);
  assert.deepEqual(activeAt(ir, 10).cues.map((c) => c.cue.id), ["q1"]);
  assert.deepEqual(activeAt(ir, 70).cues.map((c) => c.cue.id), ["q2"], "cue end is exclusive");
  assert.equal(activeAt(ir, 0).markers.length, 1);
  assert.equal(activeAt(ir, 100).audio[0].clip.id, "m1");
  const slow = baseIR(); video(slow).clips[0].speed = 0.5; video(slow).clips[0].sourceOut = 75;
  assert.equal(clipAtFrame(slow, 100).sourceFrame, 50, "source frame = sourceIn + local × speed");
  assert.equal(timelineDuration({ tracks: [] }), 0);
});

test("M09-IR-15 capabilities matrix per backend", () => {
  for (const backend of ["ffmpeg", "capcut_assisted", "premiere", "otio", "edl"]) {
    assert.ok(CAPABILITIES[backend], backend);
    assert.deepEqual(Object.keys(CAPABILITIES[backend].ops).sort(), [...IR_OPS].sort(), `${backend} covers every op`);
  }
  const ir = baseIR();
  const used = opsUsed(ir);
  for (const op of ["trim", "keyframes", "transition_crossfade", "color_preset", "text", "captions_burn", "audio_gain", "audio_fades", "audio_envelope", "loudness"]) assert.ok(used.includes(op), op);
  const ff = checkBackend(ir, "ffmpeg");
  assert.equal(ff.ok, true);
  assert.deepEqual(ff.unsupported, []);
  const edl = checkBackend(ir, "edl");
  assert.equal(edl.ok, false);
  assert.ok(edl.unsupported.includes("transition_crossfade") && edl.native.includes("trim"), "EDL keeps cuts only");
  const otio = checkBackend(ir, "otio");
  assert.ok(otio.native.includes("transition_crossfade") && otio.metadata.includes("keyframes"));
  const capcut = checkBackend(ir, "capcut_assisted");
  assert.ok(capcut.instructions.includes("text"));
  const premiere = checkBackend(ir, "premiere");
  assert.equal(premiere.ok, false);
  assert.equal(premiere.status, "not_installed");
  assert.throws(() => checkBackend(ir, "davinci"), HubError);
});

test("M09-IR-16 preset-aware checks: unknown preset/style, missing fonts; assertValidIR throws IR_INVALID", () => {
  const unknown = baseIR(); unknown.preset = { id: "ifrim-nope", version: 1 };
  assert.ok(hasError(validateIR(unknown, opts()), "PRESET_UNKNOWN"));
  const v2 = baseIR(); v2.preset = { id: "ifrim-tech", version: 2 };
  assert.ok(hasError(validateIR(v2, opts()), "PRESET_UNKNOWN"), "the version is part of the reference");
  const style = baseIR(); style.tracks[1].items[0].style = "metric"; // metric exists in business/ai-lab, not tech
  assert.ok(hasError(validateIR(style, opts()), "STYLE_UNKNOWN"));
  const fonts = validateIR(baseIR(), opts({ fonts: { ok: false, missing: [{ role: "mono", family: "Cascadia Code", file: "CascadiaCode.ttf" }] } }));
  assert.ok(hasError(fonts, "FONT_MISSING"));
  const byFn = validateIR(baseIR(), opts({ presets: (id, version) => (id === "ifrim-tech" && version === 1 ? PRESETS["ifrim-tech"] : null) }));
  assert.equal(byFn.ok, true, "presets may be a lookup function (e.g. getPreset bound to the DB)");
  const bad = baseIR(); video(bad).clips[1].start = 999;
  try { assertValidIR(bad, opts()); assert.fail("must throw"); } catch (error) {
    assert.ok(error instanceof HubError);
    assert.equal(error.category, "validation");
    assert.equal(error.code, "IR_INVALID");
    assert.ok(Array.isArray(error.details.errors) && error.details.errors.length >= 1);
    assert.match(error.message, /IR invalid/);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Captions

test("M09-IR-20 Romanian normalization: cedilla → comma below, combining marks, whitespace", () => {
  assert.equal(normalizeRo("Aşa ţară, ŞI ŢARA"), "Așa țară, ȘI ȚARA");
  assert.equal(normalizeRo("s\u0327i t\u0327e"), "și țe", "combining cedilla sequences are mapped too");
  assert.equal(normalizeRo("s\u0326"), "ș", "combining comma below composes to ș");
  assert.equal(normalizeRo("  un   rând \r\n\r\n al doilea\u200B rând\t "), "un rând\nal doilea rând");
  assert.equal(normalizeRo("a\u0007b\u202Ec"), "abc");
  assert.equal(normalizeRo(null), "");
  assert.doesNotMatch(normalizeRo("ŞşŢţ"), /[\u015E\u015F\u0162\u0163]/);
});

test("M09-IR-21 wrapLines balances two lines, keeps hard breaks and reports overflow", () => {
  const two = wrapLines("Aplicația generează raportul lunar în trei secunde", { maxChars: 32, maxLines: 2 });
  assert.equal(two.lines.length, 2);
  assert.equal(two.overflow, false);
  assert.ok(two.lines.every((l) => [...l].length <= 32));
  // Balanced: the split minimizes the longest line (28/21 here), unlike greedy filling (30/19 or worse).
  assert.deepEqual(two.lines, ["Aplicația generează raportul", "lunar în trei secunde"]);
  const tie = wrapLines("ana are mere bune", { maxChars: 12, maxLines: 2 }); // 7/9 vs 12/4 vs 3/13: best max 9
  assert.deepEqual(tie.lines, ["ana are", "mere bune"]);
  const even = wrapLines("abcdefgh ijkl mnopqrst", { maxChars: 13, maxLines: 2 }); // 8/13 vs 13/8: equal longest line
  assert.deepEqual(even.lines, ["abcdefgh", "ijkl mnopqrst"],"on equal longest lines the shorter top line wins (bottom-heavy)");
  assert.deepEqual(wrapLines("scurt", { maxChars: 32 }).lines, ["scurt"]);
  assert.deepEqual(wrapLines("primul\nal doilea", { maxChars: 32 }).lines, ["primul", "al doilea"]);
  const long = wrapLines("cuvinte multe ".repeat(10), { maxChars: 20, maxLines: 2 });
  assert.equal(long.overflow, true);
  const word = wrapLines("supercalifragilisticexpialidocious", { maxChars: 20 });
  assert.equal(word.overflow, true);
  assert.equal(word.lines.length, 1, "a word is never cut");
  assert.throws(() => wrapLines("x", { maxChars: 3 }), HubError);
});

test("M09-IR-22 checkCues: CPS, lines, overlap, bounds, duration and cedilla findings", () => {
  const cues = [
    { id: "q1", start: 0, end: 60, text: "Bună ziua." }, // 10 chars / 2 s = 5 cps
    { id: "q2", start: 60, end: 90, text: "Acesta este un text destul de lung pentru o secundă." }, // ~52 cps
    { id: "q3", start: 85, end: 120, text: "Suprapus" },
    { id: "q4", start: 120, end: 150, text: "Aşa ceva" },
    { id: "q5", start: 150, end: 180, text: "Optsprezece litere" }, // 18 chars / 1 s
    { id: "q6", start: 180, end: 400, text: "Rând unu\nrând doi\nrând trei" },
    { id: "q7", start: 400, end: 405, text: "  " },
  ];
  const f = checkCues(cues, { fps: FPS30, durationFrames: 300, maxChars: 32 });
  const has = (id, code, severity) => f.some((x) => x.cueId === id && x.code === code && (!severity || x.severity === severity));
  assert.equal(f.filter((x) => x.cueId === "q1").length, 0, JSON.stringify(f.filter((x) => x.cueId === "q1")));
  assert.ok(has("q2", "CPS_HARD", "error"));
  assert.ok(has("q3", "CUE_OVERLAP", "error"));
  assert.ok(has("q4", "DIACRITIC_CEDILLA", "warning"));
  assert.ok(has("q5", "CPS_HIGH", "warning"));
  assert.ok(has("q6", "TOO_MANY_LINES", "warning"));
  assert.ok(has("q6", "CUE_BOUNDS", "error"));
  assert.ok(has("q6", "CUE_TOO_LONG", "warning"));
  assert.ok(has("q7", "CUE_EMPTY", "error"));
  assert.ok(checkCues([{ id: "z", start: 10, end: 10, text: "x" }], { fps: FPS30 }).some((x) => x.code === "CUE_RANGE"));
  assert.ok(f.every((x) => typeof x.message === "string" && x.message.length > 5));
  assert.throws(() => checkCues(cues, { fps: { num: 0, den: 1 } }), HubError);
});

test("M09-IR-23 SRT and VTT timestamps at 30000/1001 are drift-free over two hours", () => {
  // Reference: exact rational with BigInt, rounded half-up.
  const ref = (frame) => { const n = BigInt(frame) * 1000n * 1001n; return Number((2n * n + 30000n) / 60000n); };
  for (let f = 0; f <= 2 * 3600 * 30; f += 997) assert.equal(framesToMsInt(f, NTSC), ref(f), `frame ${f}`);
  // Naive accumulation of a float frame duration would drift; our per-cue computation does not.
  const cues = [];
  for (let i = 0; i < 2000; i += 1) cues.push({ id: `q${i + 1}`, start: i * 107, end: i * 107 + 100, text: `Cue ${i + 1}` });
  const srt = toSrt(cues, NTSC);
  const last = cues[cues.length - 1];
  const fmt = (ms) => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  assert.ok(srt.includes(`2000\n${fmt(ref(last.start))} --> ${fmt(ref(last.end))}\nCue 2000\n`), "last cue timestamp equals the exact rational");
  assert.equal(srtTime(30000, NTSC), "00:16:41,000");
  assert.equal(srtTime(107892, NTSC), "00:59:59,996");
  assert.ok(srt.startsWith("1\n00:00:00,000 --> 00:00:03,337\nCue 1\n"), srt.slice(0, 60));
  const vtt = toVtt(cues.slice(0, 2), NTSC);
  assert.ok(vtt.startsWith("WEBVTT\n\nq1\n00:00:00.000 --> 00:00:03.337\nCue 1\n"), vtt.slice(0, 80));
  // Text safety: VTT escapes markup, SRT defuses the arrow and never emits an early blank line.
  const tricky = [{ id: "q1", start: 0, end: 30, text: "a <b>&</b> --> b\n\n\nşi" }];
  const v = toVtt(tricky, FPS30);
  assert.ok(v.includes("a &lt;b&gt;&amp;&lt;/b&gt; --&gt; b\nși"), v);
  const s = toSrt(tricky, FPS30);
  assert.ok(s.includes("a <b>&</b> -> b\nși\n") && !/\n\n\S/.test(s.trimEnd().split("\n").slice(2).join("\n")), s);
  assert.throws(() => toSrt([{ id: "x", start: 5, end: 4, text: "x" }], FPS30), HubError);
  // Unsorted input is written in time order.
  assert.ok(toSrt([{ id: "b", start: 30, end: 60, text: "B" }, { id: "a", start: 0, end: 30, text: "A" }], FPS30).startsWith("1\n00:00:00,000 --> 00:00:01,000\nA"));
});

test("M09-IR-24 ASS escaping of braces, backslashes and newlines; style from the preset", () => {
  assert.equal(assEscape("{\\b1}"), "\\{\\\u2060b1\\}");
  assert.equal(assColor("#2BD4FF", 1), "&H00FFD42B");
  assert.equal(assColor("#000000", 0.6), "&H66000000");
  assert.throws(() => assColor("red"), HubError);
  const cues = [
    { id: "q1", start: 0, end: 45, text: "Override {\\pos(0,0)\\c&H0000FF&} încercat" },
    { id: "q2", start: 45, end: 90, text: "Literal \\N nu e rând nou\nDar acesta este" },
    { id: "q3", start: 90, end: 91, text: "ţ" },
  ];
  const ass = toAss(cues, { canvas: { width: 1080, height: 1920 }, style: PRESETS["ifrim-tech"].captionStyle, fps: NTSC,
    safeArea: { top: 0.1, bottom: 0.15, left: 0.06, right: 0.06 }, fontName: "Segoe UI Variable, Evil" });
  const lines = ass.split("\n");
  const dialogues = lines.filter((l) => l.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 3);
  const text = (d) => d.split(",").slice(9).join(",");
  // No override block can open: every "{" is escaped.
  for (const d of dialogues) assert.doesNotMatch(text(d), /(^|[^\\])\{/, d);
  assert.ok(text(dialogues[0]).includes("\\{\\\u2060pos(0,0)\\\u2060c&H0000FF&\\}"), text(dialogues[0]));
  // A typed "\N" stays literal (backslash + word joiner), a real line break becomes \N.
  assert.equal(text(dialogues[1]), "Literal \\\u2060N nu e rând nou\\NDar acesta este");
  assert.equal(text(dialogues[2]), "ț", "normalized to comma below");
  // Timestamps in centiseconds from the rational fps; a one-frame cue still has end > start.
  assert.ok(dialogues[0].startsWith("Dialogue: 0,0:00:00.00,0:00:01.50,Caption,,"), dialogues[0]);
  assert.ok(dialogues[2].startsWith("Dialogue: 0,0:00:03.00,0:00:03.04,"), dialogues[2]);
  // Header and style: PlayRes = canvas, comma-free font name, box style, bottom alignment, margins from the safe area.
  assert.ok(lines.includes("PlayResX: 1080") && lines.includes("PlayResY: 1920") && lines.includes("WrapStyle: 2"));
  const styleLine = lines.find((l) => l.startsWith("Style: Caption,"));
  const fields = styleLine.slice("Style: ".length).split(",");
  assert.equal(fields.length, 23, styleLine);
  assert.equal(fields[1], "Segoe UI Variable Evil");
  assert.equal(fields[2], String(Math.round(0.036 * 1920)));
  assert.equal(fields[15], "3", "opaque box");
  assert.equal(fields[18], "2", "bottom centre");
  assert.equal(fields[21], String(Math.round(0.15 * 1920)));
  const cine = toAss(cues.slice(0, 1), { canvas: { width: 1920, height: 1080 }, style: PRESETS["ifrim-cinematic"].captionStyle, fps: FPS30 });
  assert.equal(cine.split("\n").find((l) => l.startsWith("Style:")).split(",")[15], "1", "outline style without a box");
  assert.throws(() => toAss(cues, { canvas: { width: 0, height: 10 }, fps: FPS30 }), HubError);
});

test("M09-IR-25 cuesFromSegments: split, frame rounding, no overlap, skipped segments", () => {
  const segments = [
    { startMs: 0, endMs: 1500, text: "Bună, eu sunt Cătălin." },
    { fromMs: 1400, toMs: 9000, text: "Astăzi vă arăt cum aplicația noastră generează automat raportul lunar pentru fiecare client, fără nicio intervenție manuală din partea echipei." },
    { start: 9.2, end: 10.4, text: "Mulţumesc!" },
    { startMs: 11000, endMs: 10000, text: "invalid" },
    { startMs: 12000, endMs: 13000, text: "   " },
  ];
  const cues = cuesFromSegments(segments, { fps: NTSC, maxChars: 32, maxLines: 2 });
  assert.equal(cues.skipped, 2);
  assert.ok(cues.length >= 5, `long segment split: ${cues.length}`);
  assert.deepEqual(cues.map((c) => c.id), cues.map((_, i) => `q${i + 1}`));
  for (let i = 0; i < cues.length; i += 1) {
    assert.ok(Number.isInteger(cues[i].start) && Number.isInteger(cues[i].end) && cues[i].end > cues[i].start);
    if (i) assert.ok(cues[i].start >= cues[i - 1].end, "no overlap");
    const lines = cues[i].text.split("\n");
    assert.ok(lines.length <= 2 && lines.every((l) => [...l].length <= 32), JSON.stringify(cues[i]));
  }
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, msToFrames(1500, NTSC));
  assert.equal(cues[1].start, cues[0].end, "the overlapping second segment is pushed after the first cue");
  assert.equal(cues[cues.length - 1].text, "Mulțumesc!");
  assert.equal(cues[cues.length - 1].start, msToFrames(9200, NTSC), "start/end in seconds are converted");
  assert.equal(checkCues(cues, { fps: NTSC, maxChars: 32 }).filter((f) => f.severity === "error").length, 0);
  assert.throws(() => cuesFromSegments("x", { fps: NTSC }), HubError);
});

// ---------------------------------------------------------------------------------------------------------------------
// Visual bible

test("M09-IR-30 five genuinely distinct presets, complete and internally consistent", () => {
  assert.deepEqual([...PRESET_IDS].sort(), ["ifrim-ai-lab", "ifrim-business", "ifrim-cinematic", "ifrim-devlog", "ifrim-tech"]);
  const required = ["id", "version", "title", "summary", "fonts", "palette", "textStyles", "captionStyle", "motion", "transitions", "color", "loudness", "cta", "cover", "examples"];
  const signatures = new Set(), accents = new Set(), colors = new Set(), displayFonts = new Set(), captions = new Set(), motions = new Set();
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    for (const key of required) assert.ok(p[key] !== undefined, `${id}.${key}`);
    assert.equal(p.version, p.id === "ifrim-business" ? 2 : 1); // ifrim-business v2 (stage before M12): CTA plate 4.5:1
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.palette), "presets are immutable in code");
    assert.match(p.palette.base, /^#[0-9A-F]{6}$/i);
    const base = parseInt(p.palette.base.slice(1), 16);
    assert.ok(((base >> 16) & 255) < 0x20 && ((base >> 8) & 255) < 0x20 && (base & 255) < 0x20, `${id}: dark graphite base`);
    for (const [role, font] of Object.entries(p.fonts)) {
      assert.ok(font.family && font.file && font.license, `${id}.fonts.${role}`);
      assert.match(font.license, /Windows|SIL Open Font License/);
    }
    for (const [name, s] of Object.entries({ ...p.textStyles, caption: p.captionStyle })) {
      assert.ok(p.fonts[s.font], `${id}.${name} uses a defined font role (${s.font})`);
      assert.ok(s.sizeRel > 0.01 && s.sizeRel < 0.1, `${id}.${name} size relative to canvas height`);
      assert.match(s.color, /^#[0-9A-F]{6}$/i);
    }
    for (const style of ["hook", "title", "body", "label", "cta"]) assert.ok(p.textStyles[style], `${id}.${style}`);
    assert.ok(["neutral", "crisp", "warm", "cool", "mono"].includes(p.color.preset));
    assert.equal(p.loudness.targetLufs, -14);
    assert.equal(p.loudness.maxTruePeakDb, -1);
    assert.match(p.loudness.note, /nu un standard de platformă/);
    assert.ok(p.examples.accepted.length >= 2 && p.examples.rejected.length >= 2);
    assert.ok(p.cta.rules.length >= 2 && p.cover.rules.length >= 2);
    assert.ok(p.motion.maxZoom >= 1 && p.motion.maxZoom <= 1.5);
    assert.ok(p.transitions.allowed.every((t) => ["crossfade", "fade"].includes(t)));
    assert.doesNotMatch(JSON.stringify(p), /[\u015E\u015F\u0162\u0163]/, `${id}: Romanian text uses comma-below ș/ț`);
    accents.add(p.palette.accent); colors.add(p.color.preset); displayFonts.add(`${p.fonts.display.file}|${p.textStyles.hook.weight}|${p.textStyles.hook.uppercase}`);
    captions.add(JSON.stringify(p.captionStyle)); motions.add(`${p.motion.fadeMs}|${p.motion.maxZoom}|${p.motion.easing}|${p.transitions.allowed.join("+")}`);
    signatures.add(JSON.stringify([p.palette, p.fonts, p.textStyles.hook, p.captionStyle, p.motion, p.color]));
  }
  for (const [label, set] of Object.entries({ signatures, accents, colors, displayFonts, captions, motions })) assert.equal(set.size, 5, `${label} differ across the five presets`);
  // Every preset validates an IR that uses its common styles.
  for (const id of PRESET_IDS) {
    const ir = baseIR(); ir.preset = { id, version: PRESETS[id].version };
    const r = validateIR(ir, opts());
    assert.equal(r.ok, true, `${id}: ${JSON.stringify(r.errors)}`);
  }
});

test("M09-IR-31 seedPresets is idempotent, never overwrites, and getPreset verifies integrity", (t) => {
  const env = makeMediaEnv({ launchers: fakeLaunchers() });
  t.after(() => env.cleanup());
  const first = seedPresets(env.db, env.clock, { bus: env.bus });
  assert.equal(first.inserted.length, 5);
  assert.deepEqual(first.conflicts, []);
  const second = seedPresets(env.db, env.clock, { bus: env.bus });
  assert.equal(second.inserted.length, 0);
  assert.equal(second.existing.length, 5);
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM content_style_presets").get().n, 5);
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'content.presets.seeded'").get().n, 1, "one event, only when something was inserted");
  seedPresets(env.db, env.clock); // without a bus
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM content_style_presets").get().n, 5);
  const p = getPreset(env.db, "ifrim-cinematic", 1);
  assert.equal(p.id, "ifrim-cinematic");
  assert.equal(p.sha256, presetSha(PRESETS["ifrim-cinematic"]));
  assert.deepEqual(p.palette, PRESETS["ifrim-cinematic"].palette);
  assert.equal(getPreset(env.db, "ifrim-cinematic").version, 1, "latest active version");
  assert.equal(getPreset(env.db, "ifrim-cinematic", 7), null);
  assert.equal(listPresets(env.db).length, 5);
  assert.throws(() => getPreset(env.db, "../x", 1), HubError);
  // A tampered body is refused, and the seed reports the conflict without overwriting it.
  const row = env.db.prepare("SELECT body_json FROM content_style_presets WHERE id = 'ifrim-tech' AND version = 1").get();
  const tampered = JSON.parse(row.body_json); tampered.palette.accent = "#FF00FF";
  env.db.prepare("UPDATE content_style_presets SET body_json = ? WHERE id = 'ifrim-tech' AND version = 1").run(JSON.stringify(tampered));
  assert.throws(() => getPreset(env.db, "ifrim-tech", 1), (e) => e instanceof HubError && e.code === "PRESET_TAMPERED");
  env.db.prepare("UPDATE content_style_presets SET sha256 = 'x' WHERE id = 'ifrim-tech' AND version = 1").run();
  const third = seedPresets(env.db, env.clock, { bus: env.bus });
  assert.equal(third.conflicts.length, 1);
  assert.equal(third.conflicts[0].id, "ifrim-tech");
  assert.equal(env.db.prepare("SELECT sha256 FROM content_style_presets WHERE id = 'ifrim-tech'").get().sha256, "x", "never overwritten");
  // validateIR can use the DB lookup.
  const r = validateIR({ ...baseIR(), preset: { id: "ifrim-business", version: 2 } }, opts({ presets: (id, version) => getPreset(env.db, id, version) }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("M09-IR-32 resolveFonts reports present, substituted and missing font files", (t) => {
  const dir = mediaTempDir("fonts");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of ["SegUIVar.ttf", "segoeui.ttf", "CASCADIACODE.TTF"]) fs.writeFileSync(path.join(dir, f), "font");
  const tech = resolveFonts(PRESETS["ifrim-tech"], { fontsDir: dir });
  assert.equal(tech.ok, true, JSON.stringify(tech));
  assert.deepEqual(Object.keys(tech.files).sort(), ["CascadiaCode.ttf", "SegUIVar.ttf", "segoeui.ttf"]);
  assert.equal(tech.roles.mono.absPath, path.join(dir, "CASCADIACODE.TTF"), "case-insensitive lookup returns the real name");
  assert.deepEqual(tech.substitutions, []);
  fs.rmSync(path.join(dir, "CASCADIACODE.TTF"));
  const noMono = resolveFonts(PRESETS["ifrim-tech"], { fontsDir: dir });
  assert.equal(noMono.ok, false);
  assert.deepEqual(noMono.missing, [{ role: "mono", family: "Cascadia Code", file: "CascadiaCode.ttf" }]);
  fs.writeFileSync(path.join(dir, "consola.ttf"), "font");
  const fallback = resolveFonts(PRESETS["ifrim-tech"], { fontsDir: dir });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.roles.mono.family, "Consolas");
  assert.equal(fallback.roles.mono.substituted, true);
  assert.equal(fallback.substitutions.length, 1, "a substitution is reported, never silent");
  const missingDir = resolveFonts(PRESETS["ifrim-business"], { fontsDir: path.join(dir, "nope") });
  assert.equal(missingDir.ok, false);
  assert.equal(missingDir.missing.length, 2);
  const evil = resolveFonts({ fonts: { display: { family: "X", file: "../segoeui.ttf", license: "x" } } }, { fontsDir: dir });
  assert.equal(evil.ok, false, "only plain file names inside the fonts dir are accepted");
  assert.throws(() => resolveFonts({}, { fontsDir: dir }), HubError);
});

test("M09-IR-33 resolveFonts on this machine's C:/Windows/Fonts", (t) => {
  if (process.platform !== "win32" || !fs.existsSync("C:/Windows/Fonts")) { t.skip("SKIPPED_ENV: C:/Windows/Fonts nu există pe acest sistem"); return; }
  for (const id of PRESET_IDS) {
    const r = resolveFonts(PRESETS[id]);
    assert.equal(Object.keys(r.roles).length + r.missing.length, Object.keys(PRESETS[id].fonts).length, id);
    for (const role of Object.values(r.roles)) assert.ok(fs.existsSync(role.absPath), role.absPath);
    t.diagnostic(`${id}: ok=${r.ok} substitutions=${r.substitutions.map((s) => s.used).join("; ") || "-"} missing=${r.missing.map((m) => m.file).join("; ") || "-"}`);
    const v = validateIR({ ...baseIR(), preset: { id, version: PRESETS[id].version } }, opts({ fonts: r }));
    assert.equal(v.ok, r.ok || !r.missing.some((m) => v.dependencies.fonts.includes(m.file)), `${id}: validateIR reflects missing fonts`);
  }
});
