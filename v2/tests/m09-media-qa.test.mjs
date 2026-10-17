// M09 QA: media QA (technical / layout / factual / rights / editorial), platform variants and creative review (T08 + review).
// Pure checks run on hand-built EditProjectIR documents; the technical QA test generates a synthetic file with the REAL ffmpeg
// (test harness only), ingests it into a temporary library and runs ffprobe + the single analysis pass through
// tests/fixtures/ffmpeg-proxy.mjs; it reports SKIPPED_ENV when the binaries are absent. No Hub, no model, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { makeMediaEnv, realLaunchers, fakeLaunchers, realTool, FFMPEG_PROXY } from "./media-helpers.mjs";
import { createMediaPaths } from "../server/media/paths.mjs";
import { createMediaTools } from "../server/media/tools.mjs";
import { createMediaAssets } from "../server/media/assets.mjs";
import { createMediaRights } from "../server/media/rights.mjs";
import { validateIR, timelineDuration, msToFrames } from "../server/media/ir.mjs";
import { PRESETS } from "../server/media/visual-bible.mjs";
import { createMediaQa, createAnalysisParser, layoutCheck, factualCheck, editorialCheck, justificationFor, QA_THRESHOLDS } from "../server/media/qa.mjs";
import { PLATFORM_PROFILES, PLATFORM_KEYS, PROFILES_VERSION, deriveVariant, estimateTextBox, createVariantService, clipFraming, keyframeToSrc, srcToKeyframe } from "../server/media/variants.mjs";
import { parseInstruction, applyOps, diffIR, createReviews, insertEditVersion } from "../server/media/review.mjs";

// ---------------------------------------------------------------- fixtures

const VIDEO_PROBE = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000", size: "4096", bit_rate: "16384" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1", r_frame_rate: "30/1", pix_fmt: "yuv420p", nb_frames: "60" },
    { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ],
};
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]);
const fakeMp4 = (seed = "a", size = 2048) => Buffer.concat([MP4_HEAD, crypto.createHash("sha256").update(seed).digest(), Buffer.alloc(size, seed.charCodeAt(0))]);
const codes = (findings) => findings.map((f) => f.code);
const unjustified = (findings) => findings.filter((f) => !f.justified);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test("M09-QA-19 factual text claims are checked per occurrence across text tracks; labels are excluded", () => {
  const ir = reviewIr(); ir.evidenceRegions = [];
  ir.tracks = ir.tracks.filter(t => t.kind !== "text");
  ir.tracks.push({ id: "facts", kind: "text", items: [
    { id: "fact1", start: 0, end: 30, text: "AC-1: PASS", style: "body" },
    { id: "label1", start: 30, end: 60, text: "Testat", style: "label" },
  ] }, { id: "more", kind: "text", items: [{ id: "fact2", start: 60, end: 90, text: "E2E verificat", claimIds: ["ccl_missing"], style: "body" }] });
  const report = factualCheck({ ir, claims: [], getVersion: stubVersions(), presets: PRESETS });
  assert.ok(!report.findings.some(f => f.code === "IR_INVALID"), JSON.stringify(report.findings));
  assert.ok(report.findings.some(f => f.code === "TEXT_CLAIM_MISSING" && f.itemId === "fact1" && f.range.timecode));
  assert.ok(report.findings.some(f => f.code === "CLAIM_UNKNOWN" && f.itemId === "fact2" && f.claimId === "ccl_missing" && f.range.timecode));
  assert.ok(!report.findings.some(f => f.itemId === "label1"));
  assert.equal(report.measurements.textItemsClaimed, 1);
  assert.equal(report.measurements.textItemsUnclaimed, 1);
});

/** A getVersion stub: READY video+audio source of `durationMs`, `w`×`h`. */
const stubVersions = ({ durationMs = 20000, w = 1920, h = 1080, captureLabel = "NOT_APPLICABLE", origin = "OWNED", overrides = {} } = {}) => (id) => ({
  id, status: "READY", origin, capture_label: overrides[id]?.captureLabel ?? captureLabel, kind: "video",
  probe: { hasVideo: true, hasAudio: true, durationMs, container: "mov,mp4", video: { width: w, height: h, displayWidth: w, displayHeight: h, fps: { num: 30, den: 1 } }, audio: { codec: "aac" } },
});

/** Vertical 1080×1920 edit at `fps`: c1 0–10 s, c2 10–15 s (demo, evidence 11–14 s), c3 15–20 s. */
function reviewIr(fps = { num: 30, den: 1 }) {
  return {
    irVersion: 1, fps, canvas: { width: 1080, height: 1920, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [
        { id: "c1", assetVersionId: "mav_a", sourceIn: 0, sourceOut: 300, start: 0 },
        { id: "c2", assetVersionId: "mav_a", sourceIn: 300, sourceOut: 450, start: 300 },
        { id: "c3", assetVersionId: "mav_a", sourceIn: 450, sourceOut: 600, start: 450 },
      ] },
      { id: "t1", kind: "text", items: [
        { id: "x1", start: 0, end: 30, text: "Raport în 3 secunde", style: "hook", anchor: "top", x: 0.5, y: 0.16 },
        { id: "x2", start: 330, end: 450, text: "Apasă Generează", style: "body", anchor: "center", x: 0.5, y: 0.5 },
        { id: "x3", start: 540, end: 600, text: "Programează un demo", style: "cta", anchor: "center", x: 0.5, y: 0.6 },
      ] },
      { id: "cap", kind: "captions", burnIn: true, cues: [
        { id: "q1", start: 150, end: 210, text: "Deschidem raportul" },
        { id: "q2", start: 360, end: 420, text: "Butonul generează tot" },
      ] },
      { id: "a1", kind: "audio", clips: [{ id: "m1", assetVersionId: "mav_a", sourceIn: 0, sourceOut: 600, start: 0, role: "music", gainDb: -20 }] },
    ],
    markers: [{ frame: 330, kind: "demo", note: "" }],
    evidenceRegions: [{ clipId: "c2", from: 330, to: 420, rect: { x: 0.3, y: 0.45, w: 0.4, h: 0.1 }, claimId: "ccl_1" }],
    meta: { title: "Test", labels: [], author: "", notes: "" },
  };
}

/** Horizontal 1920×1080 master: c1 with focus, c2 with evidence + keyframes; two texts; one caption. */
function masterIr({ evidenceRect = { x: 0.1, y: 0.4, w: 0.15, h: 0.2 }, captions = true } = {}) {
  return {
    irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [
        { id: "c1", assetVersionId: "mav_src", sourceIn: 0, sourceOut: 150, start: 0, focus: { x: 0.6, y: 0.3, w: 0.2, h: 0.3 } },
        { id: "c2", assetVersionId: "mav_src", sourceIn: 150, sourceOut: 300, start: 150, keyframes: [{ frame: 0, scale: 1, cx: 0.5, cy: 0.5 }, { frame: 149, scale: 1.5, cx: 0.2, cy: 0.5, ease: "inOut" }] },
      ] },
      { id: "t1", kind: "text", items: [
        { id: "x1", start: 0, end: 60, text: "Raport în 3 secunde", style: "hook", anchor: "top", x: 0.3, y: 0.1, maxWidth: 0.5 },
        { id: "x2", start: 200, end: 300, text: "Programează un demo", style: "cta", anchor: "bottom", x: 0.8, y: 0.88, maxWidth: 0.3 },
      ] },
      ...(captions ? [{ id: "cap", kind: "captions", burnIn: true, cues: [{ id: "q1", start: 30, end: 120, text: "Deschidem raportul generat automat din datele lunii" }] }] : []),
    ],
    evidenceRegions: [{ clipId: "c2", from: 150, to: 240, rect: evidenceRect, claimId: "ccl_1" }],
    meta: { title: "Master", labels: [], author: "", notes: "" },
  };
}

function setPolicy(env, patch) { env.bus.transaction(() => env.settings.set("mediaPolicy", { ...env.settings.get("mediaPolicy"), ...patch }, "test")); }

function setup({ launchers = null } = {}) {
  const env = makeMediaEnv({ launchers: launchers || fakeLaunchers({ FAKE_FFPROBE_JSON: JSON.stringify(VIDEO_PROBE) }) });
  setPolicy(env, { diskReserveGb: 0 });
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const tools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools, settings: env.settings });
  const rights = createMediaRights({ db: env.db, bus: env.bus, clock: env.clock });
  const qa = createMediaQa({ db: env.db, bus: env.bus, clock: env.clock, tools, paths, assets, rights });
  const inbox = path.join(env.dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  return { env, paths, tools, assets, rights, qa, inbox };
}

function seedEditVersion(env, ir, { contentProjectId = null } = {}) {
  const at = new Date().toISOString();
  const pid = `mep_${crypto.randomBytes(4).toString("hex")}`;
  env.db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, ?, 'Test', 0, 'test', ?, ?)").run(pid, contentProjectId, at, at);
  const version = insertEditVersion(env.db, env.bus, env.clock, { editProjectId: pid, ir, changeKind: "initial", actor: "test" });
  return { projectId: pid, version };
}
const count = (db, table, where = "1=1", ...args) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;
const events = (db, type) => db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);

// ---------------------------------------------------------------- layout (T08)

const ok0 = (ir) => layoutCheck({ ir, profile: "tiktok_9x16" }).findings;

test("M09-QA-01: layout QA flags text outside the TikTok safe area, text and captions over evidence, unreadable captions (T08)", () => {
  const ir = reviewIr();
  ir.tracks[1].items.push({ id: "x4", start: 60, end: 120, text: "Sub butoane", style: "body", anchor: "bottom", x: 0.5, y: 0.95 });
  ir.evidenceRegions.push({ clipId: "c1", from: 140, to: 220, rect: { x: 0.2, y: 0.66, w: 0.6, h: 0.08 }, claimId: "ccl_2" });
  ir.tracks[2].cues.splice(1, 0, { id: "q3", start: 240, end: 250, text: "Aceasta este o subtitrare mult prea lungă pentru o secundă" });
  const r = layoutCheck({ ir, profile: "tiktok_9x16" });
  assert.equal(r.status, "FAIL");
  assert.equal(r.measurements.profile, "tiktok_9x16");
  const out = r.findings.find((f) => f.code === "TEXT_OUTSIDE_SAFE_AREA" && f.itemId === "x4");
  assert.ok(out, JSON.stringify(codes(r.findings)));
  assert.equal(out.severity, "error");
  assert.ok(out.fix.dy < 0, "the proposed fix moves the text up");
  assert.deepEqual(out.evidence.safeArea, PLATFORM_PROFILES.tiktok_9x16.safeArea);
  assert.equal(out.range.fromFrame, 60); assert.equal(out.range.toFrame, 120);
  const over = r.findings.find((f) => f.code === "TEXT_OVER_EVIDENCE" && f.itemId === "x2");
  assert.ok(over);
  assert.equal(over.range.fromFrame, 330); assert.equal(over.range.toFrame, 420, "time intersection of text and evidence");
  assert.equal(over.range.timecode, "00:00:11:00 – 00:00:14:00");
  assert.ok(over.fix && over.fix.op === "move_text" && over.fix.dy !== 0);
  const capOver = r.findings.find((f) => f.code === "CAPTION_OVER_EVIDENCE");
  assert.ok(capOver && capOver.cueId === "q1", JSON.stringify(codes(r.findings)));
  assert.equal(capOver.range.fromFrame, 150); assert.equal(capOver.range.toFrame, 210);
  assert.ok(r.findings.some((f) => f.code === "CPS_HARD" && f.cueId === "q3"));
  for (const f of r.findings) {
    assert.ok(f.criterion && f.message && f.proposedFix !== undefined && "justified" in f, `finding shape ${f.code}`);
    assert.doesNotMatch(f.message, /[şţŞŢ]/, "comma-below diacritics only");
  }
  // The same edit for YouTube (wrong aspect) is refused as a layout for that profile.
  assert.ok(layoutCheck({ ir, profile: "youtube_16x9" }).findings.some((f) => f.code === "PROFILE_CANVAS_MISMATCH"));

  // Fixed: texts inside the safe area and off the evidence, readable captions → no layout error.
  const fixed = reviewIr();
  fixed.tracks[1].items[1].y = 0.36;
  // The one-line CTA (≈ 0,79 of the width) does not fit beside TikTok's right-hand buttons: wrap it and centre it in the safe band.
  assert.ok(ok0(fixed).some((f) => f.code === "TEXT_OUTSIDE_SAFE_AREA" && f.itemId === "x3"));
  Object.assign(fixed.tracks[1].items[2], { maxWidth: 0.7, x: 0.45 });
  const ok = layoutCheck({ ir: fixed, profile: "tiktok_9x16" });
  assert.deepEqual(ok.findings.filter((f) => f.severity === "error").map((f) => f.code), [], JSON.stringify(ok.findings.map((f) => [f.code, f.message])));
  assert.notEqual(ok.status, "FAIL");
});

test("M09-QA-02: the text-box estimate follows the documented metrics (0,55 em proportional, preset size, padding, line height)", () => {
  const item = { id: "x1", start: 0, end: 30, text: "Raport în 3 secunde", style: "hook", anchor: "top", x: 0.5, y: 0.16, maxWidth: 0.86 };
  const box = estimateTextBox(item, { canvas: { width: 1080, height: 1920 }, preset: PRESETS["ifrim-tech"] });
  // hook: sizeRel 0.052 → 99.84 px; advance 0.55 em − 0.01 em letter spacing = 53.9136 px; pad 0.008 × 1920 = 15.36 px.
  assert.equal(box.maxChars, 16);
  assert.deepEqual(box.wrapped, ["Raport în", "3 secunde"]);
  near(box.rect.w, (9 * 53.9136 + 2 * 15.36) / 1080, 1e-9, "width");
  near(box.rect.h, (2 * 99.84 * 1.15 + 2 * 15.36) / 1920, 1e-9, "height");
  near(box.rect.y, 0.16, 1e-12, "top anchor");
  near(box.rect.x + box.rect.w / 2, 0.5, 1e-12, "x is the centre");
  const mono = estimateTextBox({ ...item, style: "label", text: "SIMULATION" }, { canvas: { width: 1080, height: 1920 }, preset: PRESETS["ifrim-tech"] });
  // label: Cascadia (mono 0.60 em) × 1.15 uppercase + 0.04 em spacing.
  const fontPx = 0.022 * 1920;
  near(mono.rect.w, (10 * (fontPx * 0.6 * 1.15 + 0.04 * fontPx) + 2 * 0.005 * 1920) / 1080, 1e-9, "mono width");
});

// ---------------------------------------------------------------- technical QA

test("M09-QA-03: the analysis parser reads every stderr event (black, freeze, silence, open-ended, ebur128 summary, decoder errors)", () => {
  const p = createAnalysisParser();
  const lines = [
    "[Parsed_ebur128_2 @ 000001] t: 0.1  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -inf dBFS  TPK: -inf dBFS",
    "[Parsed_ebur128_2 @ 000001] t: 2.4  TARGET:-23 LUFS    M: -18.2 S: -19.9     I: -21.0 LUFS       LRA:   1.0 LU  FTPK: -16.0 dBFS  TPK: -16.0 dBFS",
    "[Parsed_blackdetect_0 @ 000002] black_start:1 black_end:2 black_duration:1",
    "[Parsed_freezedetect_1 @ 000003] lavfi.freezedetect.freeze_start: 1.0333",
    "[Parsed_freezedetect_1 @ 000003] lavfi.freezedetect.freeze_duration: 0.9667",
    "[Parsed_freezedetect_1 @ 000003] lavfi.freezedetect.freeze_end: 2",
    "[Parsed_silencedetect_3 @ 000004] silence_start: 1.998",
    "[Parsed_silencedetect_3 @ 000004] silence_end: 3.008 | silence_duration: 1.01",
    "[h264 @ 000005] error while decoding MB 10 4, bytestream -5",
    "[Parsed_silencedetect_3 @ 000004] silence_start: 5.5",
    "[Parsed_freezedetect_1 @ 000003] lavfi.freezedetect.freeze_start: 5.2",
    "[Parsed_ebur128_2 @ 000001] Summary:",
    "",
    "  Integrated loudness:",
    "    I:         -22.0 LUFS",
    "    Threshold: -32.1 LUFS",
    "",
    "  Loudness range:",
    "    LRA:         1.5 LU",
    "    Threshold: -43.2 LUFS",
    "",
    "  True peak:",
    "    Peak:      -16.1 dBFS",
    "[out#0/null @ 000006] video:75KiB audio:564KiB",
  ];
  for (const l of lines) p.feed(`${l}\r`);
  const r = p.result(6);
  assert.deepEqual(r.black, [{ startS: 1, endS: 2, durationS: 1 }]);
  assert.equal(r.freeze.length, 2);
  near(r.freeze[0].startS, 1.0333, 1e-9, "freeze start");
  assert.equal(r.freeze[1].openEnded, true); assert.equal(r.freeze[1].endS, 6);
  assert.equal(r.silence.length, 2);
  near(r.silence[0].startS, 1.998, 1e-9, "silence start");
  assert.equal(r.silence[1].openEnded, true);
  assert.equal(r.loudness.integratedLufs, -22);
  assert.equal(r.loudness.thresholdLufs, -32.1);
  assert.equal(r.loudness.lraLu, 1.5);
  assert.equal(r.loudness.truePeakDbfs, -16.1);
  assert.equal(r.loudness.maxMomentaryLufs, -18.2);
  assert.equal(r.loudness.frames, 2, "per-frame lines never overwrite the summary");
  assert.equal(r.decodeErrors.count, 1);
  assert.equal(r.lines, lines.length);
});

/** 6 s, 320×240, 30 fps: testsrc 0–1 s, black 1–2 s, testsrc 2–3 s, solid (frozen) 3–4,5 s, testsrc 4,5–6 s; sine with silence 2–3 s. */
function makeQaFile(dir) {
  const ffmpeg = realTool("ffmpeg");
  const out = path.join(dir, "qa-source.mp4");
  const src = (f, d) => ["-f", "lavfi", "-i", `${f}=size=320x240:rate=30:duration=${d}`];
  execFileSync(ffmpeg, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    ...src("testsrc2", 1), "-f", "lavfi", "-i", "color=c=black:size=320x240:rate=30:duration=1", ...src("testsrc2", 1),
    "-f", "lavfi", "-i", "color=c=0x3366cc:size=320x240:rate=30:duration=1.5", ...src("testsrc2", 1.5),
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
    "-filter_complex", "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v];[5:a]volume=volume=0:enable='between(t,2,3)'[a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-c:a", "aac", out], { stdio: "ignore", windowsHide: true });
  return out;
}
function qaFileIr(versionId, { hold = false, splitAudio = false } = {}) {
  const clip = (id, a, b, extra = {}) => ({ id, assetVersionId: versionId, sourceIn: a, sourceOut: b, start: a, ...extra });
  return {
    irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 320, height: 240, background: "#0B0D10" }, preset: { id: "ifrim-devlog", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [clip("c1", 0, 30), clip("c2", 30, 60, { holdIntentional: hold, shotId: "s2" }), clip("c3", 60, 90), clip("c4", 90, 135, { holdIntentional: hold, shotId: "s4" }), clip("c5", 135, 180)] },
      { id: "a1", kind: "audio", clips: splitAudio
        ? [{ id: "m1", assetVersionId: versionId, sourceIn: 0, sourceOut: 60, start: 0, role: "voice" }, { id: "m2", assetVersionId: versionId, sourceIn: 90, sourceOut: 180, start: 90, role: "voice" }]
        : [{ id: "m1", assetVersionId: versionId, sourceIn: 0, sourceOut: 180, start: 0, role: "voice" }] },
    ],
    loudness: { targetLufs: -14, maxTruePeakDb: -1 },
  };
}

test("M09-QA-04: real technical QA finds 1 s of black, a frozen segment and silence with correct timecodes; justified only by the shot; loudness measured", async (t) => {
  const launchers = realLaunchers();
  if (!launchers.available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found on PATH"); return; }
  const s = setup({ launchers });
  try {
    const file = makeQaFile(s.inbox);
    const { version } = await s.assets.ingestFile({ sourcePath: file, allowedRoots: [s.inbox], origin: "OWNED", actor: "owner" });
    assert.equal(version.status, "READY");
    const ir = qaFileIr(version.id);
    assert.equal(validateIR(ir, { getVersion: s.assets.getVersion, presets: PRESETS }).ok, true);

    const r = await s.qa.technical({ assetVersionId: version.id, ir });
    assert.equal(r.status, "FAIL", JSON.stringify(r.findings.map((f) => [f.code, f.range?.label, f.justified])));
    const black = r.findings.filter((f) => f.code === "BLACK_SEGMENT");
    assert.equal(black.length, 1);
    near(black[0].range.fromMs, 1000, 40, "black start"); near(black[0].range.toMs, 2000, 40, "black end");
    assert.equal(black[0].range.fromFrame, 30); assert.equal(black[0].range.toFrame, 60);
    assert.equal(black[0].range.timecode, "00:00:01:00 – 00:00:02:00");
    assert.equal(black[0].severity, "error"); assert.equal(black[0].justified, false);
    assert.equal(black[0].evidence.filter, "blackdetect");
    const frozen = r.findings.filter((f) => f.code === "FROZEN_SEGMENT");
    assert.equal(frozen.length, 1, "the frozen black second is reported once, as black");
    near(frozen[0].range.fromMs, 3000, 60, "freeze start"); near(frozen[0].range.toMs, 4500, 60, "freeze end");
    const silence = r.findings.filter((f) => f.code === "SILENCE");
    assert.equal(silence.length, 1);
    near(silence[0].range.fromMs, 2000, 60, "silence start"); near(silence[0].range.toMs, 3000, 60, "silence end");
    assert.equal(silence[0].justified, false, "audio is expected there (clip m1 covers it)");
    const L = r.measurements.loudness;
    assert.ok(Number.isFinite(L.integratedLufs) && L.integratedLufs < -5 && L.integratedLufs > -60, `integrated ${L.integratedLufs}`);
    assert.ok(Number.isFinite(L.truePeakDbfs) && L.truePeakDbfs < 0, `true peak ${L.truePeakDbfs}`);
    assert.ok(Number.isFinite(L.lraLu));
    assert.ok(r.findings.some((f) => f.code === "LOUDNESS_OFF_TARGET" && f.evidence.integratedLufs === L.integratedLufs));
    assert.ok(!codes(r.findings).includes("DURATION_MISMATCH"), "6 s render vs 180 frames");
    assert.ok(!codes(r.findings).includes("DIMENSIONS_MISMATCH"));
    assert.ok(r.measurements.analysis.stderrLines > 50, "all stderr lines parsed (ebur128 frame log included)");
    assert.ok(r.measurements.analysis.args.includes("-loglevel") && r.measurements.analysis.args.includes("info"));

    // Same file, the edit says the black and the frozen shot are intentional and there is no audio clip over 2–3 s.
    const r2 = await s.qa.technical({ assetVersionId: version.id, ir: qaFileIr(version.id, { hold: true, splitAudio: true }) });
    const j = Object.fromEntries(r2.findings.filter((f) => ["BLACK_SEGMENT", "FROZEN_SEGMENT", "SILENCE"].includes(f.code)).map((f) => [f.code, f]));
    assert.equal(j.BLACK_SEGMENT.justified, true); assert.match(j.BLACK_SEGMENT.justification, /c2.*holdIntentional/);
    assert.equal(j.FROZEN_SEGMENT.justified, true); assert.match(j.FROZEN_SEGMENT.justification, /c4/);
    assert.equal(j.SILENCE.justified, true); assert.match(j.SILENCE.justification, /niciun clip audio/);
    assert.equal(r2.status, "WARN", "only the loudness warning remains");
  } finally { await s.env.cleanup(); }
});

test("M09-QA-05: justification is per shot only (a hold on another clip or a range spilling out of the shot is not justified); tools missing → NOT_RUN", async () => {
  const ir = qaFileIr("mav_x", { hold: false });
  ir.tracks[0].clips[3].holdIntentional = true; // c4 only
  assert.equal(justificationFor(ir, "black", 30, 60), null, "c4's hold does not cover c2's black");
  assert.ok(justificationFor(ir, "freeze", 91, 135));
  assert.equal(justificationFor(ir, "freeze", 80, 135), null, "the freeze starts in c3 (not intentional)");
  const fade = qaFileIr("mav_x");
  fade.tracks[0].clips = [{ id: "c1", assetVersionId: "mav_x", sourceIn: 0, sourceOut: 90, start: 0, transitionIn: { kind: "fade", frames: 15 } }, { id: "c2", assetVersionId: "mav_x", sourceIn: 90, sourceOut: 180, start: 90 }];
  assert.match(justificationFor(fade, "black", 0, 8).reason, /fade/);
  assert.equal(justificationFor(fade, "black", 100, 120), null);

  // A library whose QA tools are absent: technical QA is NOT_RUN with the reason, never a silent pass.
  const s = setup();
  try {
    const p = path.join(s.inbox, "a.mp4"); fs.writeFileSync(p, fakeMp4("q"));
    const { version } = await s.assets.ingestFile({ sourcePath: p, allowedRoots: [s.inbox], origin: "OWNED", actor: "owner" });
    const missing = { executable: process.execPath, prefixArgs: [FFMPEG_PROXY], env: { IFRIM_REAL_TOOL: "" } };
    const tools = createMediaTools({ config: { ...s.env.config, mediaTools: { ffmpeg: null, ffprobe: null, launcher: { ffmpeg: missing, ffprobe: missing } } }, supervisor: s.env.supervisor });
    const qa = createMediaQa({ db: s.env.db, bus: s.env.bus, tools, assets: s.assets, rights: s.rights });
    const r = await qa.technical({ assetVersionId: version.id, ir: null });
    assert.equal(r.status, "NOT_RUN");
    assert.deepEqual(codes(r.findings), ["TOOL_MISSING"]);
  } finally { await s.env.cleanup(); }
});

// ---------------------------------------------------------------- factual

test("M09-QA-06: factual QA — a SIMULATION clip without an on-screen label fails; partial label fails; claims must be SUPPORTED", () => {
  const ir = reviewIr();
  ir.tracks[0].clips[1].label = "SIMULATION";
  ir.tracks[0].clips[0].claimIds = ["ccl_blocked", "ccl_unknown"];
  ir.tracks[0].clips[2].claimIds = ["ccl_uncertain"];
  const claims = [
    { id: "ccl_1", text: "Raportul se generează în 3 secunde", status: "SUPPORTED", evidence: [{ kind: "run", ref: "run_1" }] },
    { id: "ccl_blocked", text: "Crește vânzările cu 40%", status: "BLOCKED", evidence: [] },
    { id: "ccl_uncertain", text: "Merge pe orice browser", status: "UNCERTAIN", evidence: [] },
  ];
  const r = factualCheck({ ir, claims });
  assert.equal(r.status, "FAIL");
  const missing = r.findings.find((f) => f.code === "LABEL_MISSING");
  assert.ok(missing && missing.clipId === "c2");
  assert.equal(missing.range.fromFrame, 300); assert.equal(missing.range.toFrame, 450);
  assert.ok(r.findings.some((f) => f.code === "LABEL_NOT_DECLARED"));
  assert.ok(r.findings.some((f) => f.code === "CLAIM_BLOCKED"));
  assert.ok(r.findings.some((f) => f.code === "CLAIM_UNKNOWN" && f.evidence.claimId === "ccl_unknown"));
  assert.ok(r.findings.some((f) => f.code === "CLAIM_NOT_SUPPORTED" && f.evidence.claimId === "ccl_uncertain"));
  assert.ok(!r.findings.some((f) => f.evidence?.claimId === "ccl_1"), "the supported claim with evidence passes");

  // Label for half of the clip → LABEL_PARTIAL with the uncovered range.
  ir.tracks.push({ id: "t2", kind: "text", items: [{ id: "lab", start: 300, end: 375, text: "SIMULARE", style: "label", anchor: "top", x: 0.5, y: 0.2 }] });
  const partial = factualCheck({ ir, claims }).findings.find((f) => f.code === "LABEL_PARTIAL");
  assert.ok(partial);
  assert.equal(partial.range.fromFrame, 375); assert.equal(partial.range.toFrame, 450);
  // Full coverage (Romanian word, prefix match), declared, valid claims → PASS.
  ir.tracks[ir.tracks.length - 1].items[0].end = 450;
  ir.meta.labels = ["SIMULATION"];
  ir.tracks[0].clips[0].claimIds = [];
  ir.tracks[0].clips[2].claimIds = [];
  const ok = factualCheck({ ir, claims });
  assert.equal(ok.status, "PASS", JSON.stringify(ok.findings));
  // An asset captured as GENERATED needs the GENERATED label even when the clip is unlabelled.
  const gen = reviewIr();
  const r2 = factualCheck({ ir: gen, claims, getVersion: stubVersions({ overrides: { mav_a: { captureLabel: "GENERATED" } } }) });
  assert.ok(r2.findings.filter((f) => f.code === "LABEL_MISSING").every((f) => f.evidence.label === "GENERATED" && f.evidence.source === "asset.capture_label"));
  assert.equal(r2.findings.filter((f) => f.code === "LABEL_MISSING").length, 3);
});

// ---------------------------------------------------------------- variants

test("M09-QA-07: variants 9:16 / 16:9 / 1:1 differ in canvas, crops and text positions; profiles are versioned internal estimates", () => {
  assert.equal(PLATFORM_KEYS.length, 8);
  assert.equal(PLATFORM_PROFILES.profilesVersion, PROFILES_VERSION);
  for (const k of PLATFORM_KEYS) {
    const p = PLATFORM_PROFILES[k];
    assert.equal(p.source, "estimare internă — verifică regulile actuale");
    assert.equal(p.verifiedAt, null);
    assert.ok(p.canvas.width % 2 === 0 && p.canvas.height % 2 === 0 && p.safeArea && p.captionDefaults && "maxDurationS" in p && p.fpsPreferred);
  }
  const getVersion = stubVersions();
  const master = masterIr();
  const v916 = deriveVariant({ masterIr: master, platformKey: "tiktok_9x16", getVersion });
  const v169 = deriveVariant({ masterIr: master, platformKey: "youtube_16x9", overrides: { hookText: "Raportul lunar, gata în 3 secunde" }, getVersion });
  const v11 = deriveVariant({ masterIr: master, platformKey: "x_1x1", getVersion });
  assert.deepEqual([v916.ir.canvas.width, v916.ir.canvas.height], [1080, 1920]);
  assert.deepEqual([v169.ir.canvas.width, v169.ir.canvas.height], [1920, 1080]);
  assert.deepEqual([v11.ir.canvas.width, v11.ir.canvas.height], [1080, 1080]);
  const crop = (v, id) => v.ir.tracks[0].clips.find((c) => c.id === id).crop;
  near(crop(v916, "c1").w, 0.3164, 1e-3, "9:16 crop width of a 16:9 source");
  near(crop(v11, "c1").w, 0.5625, 1e-3, "1:1 crop width");
  assert.equal(crop(v169, "c1").w, 1);
  // The 9:16 crop is centred on the focus (0.6–0.8) and keeps it whole.
  const c1 = crop(v916, "c1");
  assert.ok(c1.x <= 0.6 && c1.x + c1.w >= 0.8, JSON.stringify(c1));
  // Evidence stays whole and is mapped into the variant canvas.
  const ev = v916.ir.evidenceRegions[0];
  assert.ok(ev.rect.x >= 0 && ev.rect.x + ev.rect.w <= 1 && ev.rect.w > 0.15, JSON.stringify(ev.rect));
  assert.ok(!v916.findings.some((f) => /EVIDENCE/.test(f.code)));
  // Text positions differ per platform and are inside each safe area.
  const pos = (v, id) => { const i = v.ir.tracks.find((t) => t.id === "t1").items.find((x) => x.id === id); return [i.x, i.y, i.maxWidth]; };
  assert.notDeepEqual(pos(v916, "x2"), pos(v169, "x2"));
  assert.notDeepEqual(pos(v916, "x2"), pos(v11, "x2"));
  for (const [v, key] of [[v916, "tiktok_9x16"], [v169, "youtube_16x9"], [v11, "x_1x1"]]) {
    const lay = layoutCheck({ ir: v.ir, profile: key });
    assert.ok(!lay.findings.some((f) => ["TEXT_OUTSIDE_SAFE_AREA", "TEXT_OFF_CANVAS", "TEXT_OVER_EVIDENCE", "PROFILE_CANVAS_MISMATCH"].includes(f.code)), `${key}: ${JSON.stringify(lay.findings.map((f) => f.code))}`);
    assert.equal(validateIR(v.ir, { getVersion, presets: PRESETS }).ok, true);
    assert.notEqual(v.variantHash, v.masterHash, "never a renamed copy");
    assert.equal(v.layout.profilesVersion, PROFILES_VERSION);
    assert.match(v.ir.meta.notes, new RegExp(`Variantă ${key}`));
  }
  // Distinct hook per platform.
  assert.equal(v169.ir.tracks.find((t) => t.id === "t1").items[0].text, "Raportul lunar, gata în 3 secunde");
  assert.equal(v916.ir.tracks.find((t) => t.id === "t1").items[0].text, "Raport în 3 secunde");
  // Captions re-wrapped for the vertical line length.
  assert.ok(v916.ir.tracks.find((t) => t.kind === "captions").cues[0].text.includes("\n"));
  // Keyframes keep the evidence inside the zoom window. cx/cy are relative to the fitted window (the same semantics compile.mjs
  // renders — M09 review): mapped back through the variant framing, the centre lies inside the new crop.
  const kf = v916.ir.tracks[0].clips[1].keyframes[0];
  const c2 = crop(v916, "c2");
  assert.ok(kf.cx >= 0 && kf.cx <= 1 && kf.cy >= 0 && kf.cy <= 1);
  const vClip = v916.ir.tracks[0].clips[1];
  const vf = clipFraming(vClip, { w: 1920, h: 1080 }, PLATFORM_PROFILES.reels_9x16.canvas);
  const p = keyframeToSrc(vf, kf);
  assert.ok(p.x >= c2.x - 1e-6 && p.x <= c2.x + c2.w + 1e-6 && p.y >= c2.y - 1e-6 && p.y <= c2.y + c2.h + 1e-6, JSON.stringify({ p, c2 }));
  // Round trip: source ↔ keyframe through one framing is exact.
  const back = srcToKeyframe(vf, p);
  assert.ok(Math.abs(back.cx - kf.cx) < 1e-9 && Math.abs(back.cy - kf.cy) < 1e-9);
  // A variant that would equal the master is refused.
  const plain = masterIr({ captions: false });
  plain.evidenceRegions = [];
  plain.tracks[0].clips = plain.tracks[0].clips.map(({ focus, keyframes, ...c }) => c);
  plain.tracks[1].items = [{ id: "x1", start: 0, end: 60, text: "Raport", style: "body", anchor: "center", x: 0.5, y: 0.5 }];
  assert.throws(() => deriveVariant({ masterIr: plain, platformKey: "youtube_16x9", getVersion }), (e) => e.code === "VARIANT_IDENTICAL");
  assert.throws(() => deriveVariant({ masterIr: master, platformKey: "facebook_9x16", getVersion }), (e) => e.code === "PLATFORM_PROFILE_UNKNOWN");
});

test("M09-QA-08: a crop that would cut evidence yields a finding (letterbox fallback or EVIDENCE_CUT); a trim that drops evidence is an error", () => {
  const getVersion = stubVersions();
  const wide = masterIr({ evidenceRect: { x: 0.05, y: 0.4, w: 0.9, h: 0.2 } });
  const lb = deriveVariant({ masterIr: wide, platformKey: "reels_9x16", getVersion });
  const f = lb.findings.find((x) => x.code === "EVIDENCE_REQUIRES_LETTERBOX");
  assert.ok(f && f.clipId === "c2" && f.severity === "warning", JSON.stringify(lb.findings));
  const c2 = lb.ir.tracks[0].clips.find((c) => c.id === "c2");
  assert.equal(c2.fit, "contain");
  const ev = lb.ir.evidenceRegions[0].rect;
  assert.ok(ev.x >= 0 && ev.x + ev.w <= 1.0001, "the evidence stays whole inside the canvas");
  // The evidence keeps its pixel aspect (contain scales uniformly): 0,9×1920 by 0,2×1080 source px.
  near((ev.w * 1080) / (ev.h * 1920), (0.9 * 1920) / (0.2 * 1080), 0.05, "evidence pixel aspect");
  const cut = deriveVariant({ masterIr: wide, platformKey: "reels_9x16", overrides: { allowLetterbox: false }, getVersion });
  const e = cut.findings.find((x) => x.code === "EVIDENCE_CUT");
  assert.ok(e && e.severity === "error" && e.clipId === "c2", JSON.stringify(cut.findings));
  assert.equal(cut.ir.tracks[0].clips.find((c) => c.id === "c2").fit, "cover");
  // Trimming the duration below the evidence interval.
  const trimmed = deriveVariant({ masterIr: masterIr(), platformKey: "tiktok_9x16", overrides: { trimToFrames: 120, ctaText: "Programează un demo" }, getVersion });
  assert.equal(timelineDuration(trimmed.ir), 120);
  assert.ok(trimmed.findings.some((x) => x.code === "EVIDENCE_TRIMMED" && x.severity === "error"));
  assert.equal(trimmed.ir.evidenceRegions.length, 0);
  assert.ok(trimmed.changes.some((c) => c.kind === "cta"), "a distinct CTA is added for the shorter variant");
  assert.throws(() => deriveVariant({ masterIr: masterIr(), platformKey: "tiktok_9x16", overrides: { trimToFrames: 10 }, getVersion }), (x) => x.code === "VARIANT_TRIM_INVALID");
});

// ---------------------------------------------------------------- review parser

test("M09-QA-09: „la secunda 12 textul acoperă butonul; mută-l mai sus și ține demonstrația mai mult” → move_text + extend_clip with explicit proposals", () => {
  const ir = reviewIr();
  const r = parseInstruction("la secunda 12 textul acoperă butonul; mută-l mai sus și ține demonstrația mai mult", { ir });
  assert.equal(r.atMs, 12000); assert.equal(r.atFrame, 360);
  assert.equal(r.clarification, null, JSON.stringify(r));
  assert.deepEqual(r.ops, [
    { op: "move_text", itemId: "x2", dx: 0, dy: -0.08 },
    { op: "extend_clip", clipId: "c2", frames: 45 },
  ]);
  assert.ok(r.notes.some((n) => n.includes("propunere: 1,5 s")), JSON.stringify(r.notes));
  assert.ok(r.notes.some((n) => /propunere: 8%/.test(n)));
  assert.ok(r.notes.some((n) => /Observație: .*acoperă butonul/.test(n)));
  // A stated amount is used as given (no proposal note for it).
  const r2 = parseInstruction("ține demonstrația mai mult (cu 2 secunde)", { ir, atMs: 12000 });
  assert.deepEqual(r2.ops, [{ op: "extend_clip", clipId: "c2", frames: 60 }]);
  assert.ok(!r2.notes.some((n) => n.includes("propunere")));
  const r3 = parseInstruction("mută textul mai sus cu 5%", { ir, atMs: 12000 });
  assert.deepEqual(r3.ops, [{ op: "move_text", itemId: "x2", dx: 0, dy: -0.05 }]);
});

test("M09-QA-10: negations produce no operation; only-negation asks for clarification; a negated clause does not hide the next one", () => {
  const ir = reviewIr();
  const r = parseInstruction("la secunda 12 nu muta textul", { ir });
  assert.deepEqual(r.ops, []);
  assert.equal(r.negated.length, 1);
  assert.match(r.clarification, /nu propun nicio modificare/);
  const mixed = parseInstruction("la secunda 12 nu muta textul, dar ține demonstrația mai mult cu o secundă", { ir });
  assert.deepEqual(mixed.ops, [{ op: "extend_clip", clipId: "c2", frames: 30 }]);
  assert.equal(mixed.negated.length, 1);
  assert.equal(mixed.clarification, null);
  assert.deepEqual(parseInstruction("lasă textul așa", { ir, atMs: 12000 }).ops, [], "„lasă” without an amount is not an extension");
  assert.deepEqual(parseInstruction("textul mai sus cu 5%", { ir, atMs: 12000 }).ops, [{ op: "move_text", itemId: "x2", dx: 0, dy: -0.05 }]);
  assert.deepEqual(parseInstruction("textul nu mai sus", { ir, atMs: 12000 }).ops, []);
  const none = parseInstruction("arată foarte bine", { ir });
  assert.deepEqual(none.ops, []);
  assert.match(none.clarification, /Nu am identificat o modificare concretă/);
});

test("M09-QA-11: timecodes at 29,97 fps — seconds map to the frame shown (floor), HH:MM:SS:FF is non-drop-frame, ranges round to the nearest frame", () => {
  const fps = { num: 30000, den: 1001 };
  const ir = reviewIr(fps);
  const r = parseInstruction("la secunda 12 mută textul mai sus", { ir });
  assert.equal(r.atMs, 12000);
  assert.equal(r.atFrame, 359, "frame 359 starts at 11,978 s and is on screen at 12,000 s");
  assert.equal(r.ops[0].itemId, "x2");
  const tc = parseInstruction("la 00:00:12:15 mută textul mai jos cu 5%", { ir });
  assert.equal(tc.atFrame, 12 * 30 + 15);
  assert.equal(tc.atMs, Math.round((375 * 1001) / 30));
  assert.deepEqual(tc.ops, [{ op: "move_text", itemId: "x2", dx: 0, dy: 0.05 }]);
  const cut = parseInstruction("taie de la 10 la 12", { ir });
  assert.deepEqual(cut.ops, [{ op: "cut_range", from: msToFrames(10000, fps), to: msToFrames(12000, fps) }]);
  assert.deepEqual(cut.ops[0], { op: "cut_range", from: 300, to: 360 });
  const mmss = parseInstruction("la 0:16 scurtează cadrul cu 0,5 secunde", { ir });
  assert.equal(mmss.atMs, 16000);
  assert.deepEqual(mmss.ops, [{ op: "trim_clip", clipId: "c3", frames: msToFrames(500, fps), from: "end" }]);
});

test("M09-QA-12: replace text, remove/edit captions, cut ranges and ambiguous targets", () => {
  const ir = reviewIr();
  const rep = parseInstruction("schimbă textul «Apasă Generează» în «Apasă butonul Generează»", { ir });
  assert.deepEqual(rep.ops, [{ op: "replace_text", itemId: "x2", text: "Apasă butonul Generează" }]);
  const part = parseInstruction("înlocuiește „3 secunde” cu „trei secunde”", { ir });
  assert.deepEqual(part.ops, [{ op: "replace_text", itemId: "x1", text: "Raport în trei secunde" }]);
  const rm = parseInstruction("scoate subtitrarea de la secunda 5", { ir });
  assert.deepEqual(rm.ops, [{ op: "remove_cue", cueId: "q1" }]);
  const edit = parseInstruction("la secunda 13 schimbă subtitrarea în «Butonul face totul»", { ir });
  assert.deepEqual(edit.ops, [{ op: "edit_cue", cueId: "q2", text: "Butonul face totul" }]);
  const cut = parseInstruction("taie de la 10 la 12", { ir });
  assert.deepEqual(cut.ops, [{ op: "cut_range", from: 300, to: 360 }]);
  const cap = parseInstruction("la secunda 13 mută subtitrarea mai sus", { ir });
  assert.deepEqual(cap.ops, []);
  assert.match(cap.clarification, /zona sigură/);
  // M10 §17: a disclosure label on screen is transparency, never the target of an unqualified "textul" → the content item is chosen.
  const two = reviewIr();
  two.tracks.push({ id: "t2", kind: "text", items: [{ id: "y1", start: 330, end: 400, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.2 }] });
  const picked = parseInstruction("la secunda 12 mută textul mai sus", { ir: two });
  assert.deepEqual(picked.ops.map((o) => [o.op, o.itemId]), [["move_text", "x2"]]);
  assert.ok(picked.notes.some((n) => /Am ales textul/.test(n)));
  // Two CONTENT texts on screen: one short question, the options returned for highlighting.
  const three = reviewIr();
  three.tracks.push({ id: "t3", kind: "text", items: [{ id: "y2", start: 330, end: 400, text: "Alt text", style: "body", anchor: "top", x: 0.5, y: 0.2 }] });
  const amb = parseInstruction("la secunda 12 mută textul mai sus", { ir: three });
  assert.deepEqual(amb.ops, []);
  assert.match(amb.clarification, /2 texte pe ecran/);
  assert.deepEqual(amb.options.sort(), ["x2", "y2"]);
  assert.throws(() => parseInstruction("   ", { ir }), (e) => e.code === "REVIEW_TEXT_REQUIRED");
});

// ---------------------------------------------------------------- applyOps / diffIR

test("M09-QA-13: applyOps is pure and ripples correctly; diffIR reports the duration delta and the changed items", () => {
  const ir = reviewIr();
  const before = JSON.stringify(ir);
  const next = applyOps(ir, [{ op: "extend_clip", clipId: "c2", frames: 45 }, { op: "move_text", itemId: "x2", dx: 0, dy: -0.08 }]);
  assert.equal(JSON.stringify(ir), before, "input untouched");
  assert.equal(timelineDuration(next), 645);
  const clip = (x, id) => x.tracks[0].clips.find((c) => c.id === id);
  assert.equal(clip(next, "c2").sourceOut, 495);
  assert.equal(clip(next, "c3").start, 495);
  const item = (x, id) => x.tracks.find((t) => t.id === "t1").items.find((i) => i.id === id);
  assert.equal(item(next, "x2").end, 495, "text attached to the extended clip is extended");
  assert.equal(item(next, "x2").y, 0.42);
  assert.equal(item(next, "x3").start, 585, "later text shifts");
  assert.equal(validateIR(next, { presets: PRESETS }).ok, true);
  const d = diffIR(ir, next);
  assert.deepEqual(d.durationFrames, { before: 600, after: 645, delta: 45 });
  assert.equal(d.durationMs.delta, 1500);
  assert.ok(d.changes.some((c) => c.kind === "clip" && c.id === "c2" && c.fields.sourceOut.after === 495));
  assert.ok(d.changes.some((c) => c.kind === "text" && c.id === "x2" && c.fields.y));
  assert.ok(d.summary[0].startsWith("Durata: 20 s → 21,5 s"), d.summary[0]);

  const cut = applyOps(ir, [{ op: "cut_range", from: 330, to: 390 }]);
  assert.equal(timelineDuration(cut), 540);
  assert.ok(cut.tracks[0].clips.some((c) => c.id === "c2_b"), "a middle cut splits the clip");
  assert.equal(validateIR(cut, { presets: PRESETS }).ok, true, JSON.stringify(validateIR(cut, { presets: PRESETS }).errors));
  assert.equal(diffIR(ir, cut).durationFrames.delta, -60);
  const evCut = cut.evidenceRegions.filter((r) => r.claimId === "ccl_1");
  assert.ok(evCut.length >= 1 && evCut.every((r) => r.to <= 360));
  const withT = reviewIr();
  withT.tracks[0].clips[2] = { ...withT.tracks[0].clips[2], start: 435, sourceOut: 615, transitionIn: { kind: "crossfade", frames: 15 } };
  assert.equal(validateIR(withT, { presets: PRESETS }).ok, true);
  assert.throws(() => applyOps(withT, [{ op: "cut_range", from: 430, to: 440 }]), (e) => e.code === "PATCH_INVALID" && /tranziți/.test(e.message));
  assert.throws(() => applyOps(ir, [{ op: "move_text", itemId: "nope", dx: 0, dy: 0.1 }]), (e) => e.code === "PATCH_INVALID");
  assert.throws(() => applyOps(ir, [{ op: "shell", cmd: "x" }]), (e) => e.code === "PATCH_INVALID");
  const removed = applyOps(ir, [{ op: "remove_cue", cueId: "q1" }, { op: "edit_cue", cueId: "q2", text: "Corectat ş" }]);
  assert.equal(removed.tracks.find((t) => t.kind === "captions").cues.length, 1);
  assert.equal(removed.tracks.find((t) => t.kind === "captions").cues[0].text, "Corectat ș", "Romanian normalisation on edits");
});

// ---------------------------------------------------------------- createReviews

test("M09-QA-14: reviews — propose applies nothing; apply creates a new validated version (original untouched); stale/invalid refused; decisions", async () => {
  const s = setup();
  try {
    const { env } = s;
    const { projectId, version: v1 } = seedEditVersion(env, reviewIr());
    const reviews = createReviews({ db: env.db, bus: env.bus, clock: env.clock, assets: { getVersion: stubVersions({ durationMs: 20000 }) } });
    const original = env.db.prepare("SELECT ir_json, ir_sha256 FROM media_edit_versions WHERE id = ?").get(v1.id);
    const p = reviews.propose({ editVersionId: v1.id, text: "la secunda 12 textul acoperă butonul; mută-l mai sus și ține demonstrația mai mult", provenance: "lega", actor: "lega", sessionId: "own_1" });
    assert.equal(p.status, "OPEN"); assert.equal(p.kind, "CHANGES_REQUESTED");
    assert.equal(p.timecodeMs, 12000);
    assert.equal(p.patch.preview.valid, true);
    assert.equal(p.patch.preview.diff.durationFrames.delta, 45);
    assert.equal(count(env.db, "media_edit_versions", "edit_project_id = ?", projectId), 1, "a proposal applies nothing");
    assert.equal(events(env.db, "media.review.proposed").length, 1);

    const a = reviews.apply({ reviewId: p.id, actor: "owner" });
    assert.equal(a.alreadyApplied, false);
    assert.equal(a.version.version, 2); assert.equal(a.version.changeKind, "patch"); assert.equal(a.version.parentVersionId, v1.id);
    assert.equal(a.diff.durationFrames.delta, 45);
    assert.equal(a.review.status, "APPLIED"); assert.equal(a.review.resultVersionId, a.version.id);
    assert.deepEqual(env.db.prepare("SELECT ir_json, ir_sha256 FROM media_edit_versions WHERE id = ?").get(v1.id), original, "original version untouched");
    const stored = JSON.parse(env.db.prepare("SELECT ir_json FROM media_edit_versions WHERE id = ?").get(a.version.id).ir_json);
    assert.equal(timelineDuration(stored), 645);
    assert.equal(env.db.prepare("SELECT current_version FROM media_edit_projects WHERE id = ?").get(projectId).current_version, 2);
    assert.equal(reviews.apply({ reviewId: p.id, actor: "owner" }).alreadyApplied, true, "idempotent");
    // A second proposal on v1 is stale once v1 has a patch child.
    const p2 = reviews.propose({ editVersionId: v1.id, text: "taie de la 1 la 2", provenance: "owner_ui", actor: "owner" });
    assert.throws(() => reviews.apply({ reviewId: p2.id, actor: "owner" }), (e) => e.code === "REVIEW_STALE");
    // Extending past the end of the source is refused by validation; the review stays OPEN.
    const p3 = reviews.propose({ editVersionId: a.version.id, text: "la secunda 18 ține cadrul mai mult cu o secundă", provenance: "owner_ui", actor: "owner" });
    assert.equal(p3.patch.preview.valid, false);
    assert.throws(() => reviews.apply({ reviewId: p3.id, actor: "owner" }), (e) => e.code === "IR_INVALID");
    assert.equal(reviews.get(p3.id).status, "OPEN");
    // A comment without changes cannot be applied.
    const c = reviews.propose({ editVersionId: a.version.id, text: "nu muta textul", provenance: "owner_ui", actor: "owner" });
    assert.equal(c.kind, "COMMENT");
    assert.throws(() => reviews.apply({ reviewId: c.id, actor: "owner" }), (e) => e.code === "REVIEW_NO_OPS");
    // CREATIVE_APPROVED only from the owner session.
    assert.throws(() => reviews.decide({ editVersionId: a.version.id, kind: "CREATIVE_APPROVED", actor: "lega" }), (e) => e.category === "policy");
    assert.throws(() => reviews.decide({ editVersionId: a.version.id, kind: "CREATIVE_APPROVED", actor: "lega", sessionId: "own_1", channel: "voice" }), (e) => e.code === "CREATIVE_APPROVAL_OWNER_ONLY");
    const ok = reviews.decide({ editVersionId: a.version.id, kind: "CREATIVE_APPROVED", actor: "owner", sessionId: "own_1", channel: "owner", note: "Aprob" });
    assert.equal(ok.provenance, "owner_session"); assert.equal(ok.status, "RECORDED");
    assert.equal(ok.patch.irSha256, a.version.irSha256);
    // Manual divergence (edited in CapCut): a new version that says the IR is out of sync.
    const div = reviews.recordManualDivergence({ editVersionId: a.version.id, description: "Am schimbat muzica în CapCut", editor: "capcut", actor: "owner" });
    assert.equal(div.version.changeKind, "manual_divergence");
    assert.equal(div.version.change.irOutOfSync, true);
    assert.equal(div.review.resultVersionId, div.version.id);
    assert.equal(events(env.db, "media.review.applied").length, 1);
    assert.equal(events(env.db, "media.review.divergence_recorded").length, 1);
  } finally { await s.env.cleanup(); }
});

// ---------------------------------------------------------------- run / persistence / variant service

test("M09-QA-15: qa.run persists one row per kind; FAIL from factual and rights; fixes turn it around; summary and event; variants derive and inherit the profile", async () => {
  const s = setup();
  try {
    const { env, assets, rights, qa } = s;
    const p = path.join(s.inbox, "src.mp4"); fs.writeFileSync(p, fakeMp4("r"));
    const { asset, version } = await assets.ingestFile({ sourcePath: p, allowedRoots: [s.inbox], origin: "OWNED", actor: "owner" });
    const ir = {
      irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1920, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
      tracks: [
        { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: version.id, sourceIn: 0, sourceOut: 60, start: 0, label: "SIMULATION" }] },
        { id: "t1", kind: "text", items: [{ id: "x1", start: 0, end: 20, text: "Raport în 3 secunde", style: "hook", anchor: "top", x: 0.5, y: 0.16 }] },
      ],
      meta: { title: "Run", labels: ["SIMULATION"], author: "", notes: "" },
    };
    const { version: ev } = seedEditVersion(env, ir);
    const r1 = await qa.run({ editVersionId: ev.id, platform: "tiktok_9x16", actor: "owner" });
    assert.equal(r1.status, "FAIL");
    assert.equal(r1.reports.technical.status, "NOT_RUN");
    assert.deepEqual(codes(r1.reports.technical.findings), ["NO_RENDER"]);
    assert.equal(r1.reports.factual.status, "FAIL");
    assert.ok(r1.reports.rights.findings.some((f) => f.code === "RIGHTS_BLOCKED"));
    assert.equal(r1.profile, "tiktok_9x16");
    const rows = env.db.prepare("SELECT kind, status FROM media_qa_reports WHERE edit_version_id = ? ORDER BY kind").all(ev.id);
    assert.deepEqual(rows.map((r) => r.kind), ["editorial", "factual", "rights", "technical"]);
    const ed = env.db.prepare("SELECT findings_json, measurements_json FROM media_qa_reports WHERE edit_version_id = ? AND kind = 'editorial'").get(ev.id);
    const edM = JSON.parse(ed.measurements_json);
    assert.ok(edM.layout && edM.editorial && edM.statuses.layout, "layout and editorial share the editorial row");
    assert.equal(edM.editorial.heuristic, true);
    assert.ok(JSON.parse(ed.findings_json).every((f) => ["layout", "editorial"].includes(f.check)));
    assert.equal(qa.summary(ev.id).status, "FAIL");
    const evt = events(env.db, "media.qa.reported");
    assert.equal(evt.length, 1);
    assert.equal(JSON.parse(evt[0].payload_json).statuses.factual, "FAIL");

    // Fix: the label on screen and the rights for the scope.
    const ir2 = JSON.parse(JSON.stringify(ir));
    ir2.tracks.push({ id: "t2", kind: "text", items: [{ id: "lab", start: 0, end: 60, text: "SIMULATION", style: "label", anchor: "top", x: 0.5, y: 0.3 }] });
    const { version: ev2 } = seedEditVersion(env, ir2);
    rights.record({ assetId: asset.id, status: "CLEARED_FOR_SCOPE", platforms: ["*"], uses: ["organic"], actor: "owner" });
    const r2 = await qa.run({ editVersionId: ev2.id, platform: "tiktok_9x16", actor: "owner" });
    assert.equal(r2.reports.factual.status, "PASS", JSON.stringify(r2.reports.factual.findings));
    assert.equal(r2.reports.rights.status, "PASS", JSON.stringify(r2.reports.rights.findings));
    assert.notEqual(r2.status, "FAIL");
    assert.notEqual(r2.status, "PASS", "technical QA did not run, so the run cannot be a PASS");

    // Variant service: stored as a variant version (main line untouched) and QA picks the profile from it.
    const variants = createVariantService({ db: env.db, bus: env.bus, clock: env.clock, assets });
    const master = seedEditVersion(env, { ...ir2, canvas: { width: 1920, height: 1080, background: "#0B0D10" } });
    const before = env.db.prepare("SELECT current_version FROM media_edit_projects WHERE id = ?").get(master.projectId).current_version;
    const d = variants.derive({ masterVersionId: master.version.id, platformKey: "tiktok_9x16", actor: "owner" });
    assert.equal(d.variant.status, "DRAFT"); assert.equal(d.version.changeKind, "variant"); assert.equal(d.version.variantKey, "tiktok_9x16");
    assert.equal(env.db.prepare("SELECT current_version FROM media_edit_projects WHERE id = ?").get(master.projectId).current_version, before);
    assert.equal(events(env.db, "media.variant.derived").length, 1);
    const r3 = await qa.run({ editVersionId: d.version.id, actor: "owner" });
    assert.equal(r3.profile, "tiktok_9x16");
    assert.equal(r3.reports.layout.measurements.profile, "tiktok_9x16");
    assert.ok(!r3.reports.layout.findings.some((f) => f.code === "PROFILE_CANVAS_MISMATCH"));
    // Editorial heuristics are warnings only.
    assert.ok(editorialCheck({ ir: reviewIr(), brief: { durationTargetS: 60 } }).findings.every((f) => f.severity === "warning"));
    assert.ok(editorialCheck({ ir: reviewIr(), brief: { durationTargetS: 60 } }).findings.some((f) => f.code === "DURATION_VS_BRIEF"));
    assert.equal(QA_THRESHOLDS.blackMinS, 0.25);
  } finally { await s.env.cleanup(); }
});

test("M09-QA-16 (review R20): a correction applied on a platform variant moves the variant to the corrected version (DRAFT again)", async () => {
  const s = setup();
  try {
    const { env } = s;
    const assets = { getVersion: stubVersions({ durationMs: 20000 }) };
    const master = reviewIr();
    master.canvas = { width: 1920, height: 1080, background: "#0B0D10" };
    const { version: mv } = seedEditVersion(env, master);
    const variants = createVariantService({ db: env.db, bus: env.bus, clock: env.clock, assets });
    const d = variants.derive({ masterVersionId: mv.id, platformKey: "reels_9x16", actor: "owner" });
    env.db.prepare("UPDATE media_variants SET status = 'RENDERED' WHERE id = ?").run(d.variant.id);
    const reviews = createReviews({ db: env.db, bus: env.bus, clock: env.clock, assets });
    const p = reviews.propose({ editVersionId: d.version.id, text: "la secunda 12 mută textul mai sus", provenance: "owner_ui", actor: "owner" });
    const a = reviews.apply({ reviewId: p.id, actor: "owner" });
    assert.equal(a.version.variantKey, "reels_9x16", "the corrected version stays on the variant line");
    const row = env.db.prepare("SELECT variant_version_id, status FROM media_variants WHERE id = ?").get(d.variant.id);
    assert.equal(row.variant_version_id, a.version.id, "distribution now packs the corrected version, not the old render");
    assert.equal(row.status, "DRAFT", "it must be rendered and QA'd again");
    assert.equal(events(env.db, "media.variant.corrected").length, 1);
    // A correction on the master line moves no variant.
    const pm = reviews.propose({ editVersionId: mv.id, text: "la secunda 12 mută textul mai sus", provenance: "owner_ui", actor: "owner" });
    reviews.apply({ reviewId: pm.id, actor: "owner" });
    assert.equal(env.db.prepare("SELECT variant_version_id FROM media_variants WHERE id = ?").get(d.variant.id).variant_version_id, a.version.id);
    assert.equal(events(env.db, "media.variant.corrected").length, 1);
  } finally { await s.env.cleanup(); }
});

test("M09-QA-17 (review R23): an honest label is a whole word — „SIMULATOR” or „NE-SIMULAT” is not a SIMULATION label; „SIMULARE · …” is", () => {
  const labelled = (text) => {
    const ir = reviewIr();
    ir.tracks[0].clips[1].label = "SIMULATION";
    ir.meta.labels = ["SIMULATION"];
    ir.tracks.push({ id: "t2", kind: "text", items: [{ id: "lab", start: 300, end: 450, text, style: "label", anchor: "top", x: 0.5, y: 0.2 }] });
    return factualCheck({ ir, claims: [] }).findings.filter((f) => f.code === "LABEL_MISSING" || f.code === "LABEL_PARTIAL");
  };
  assert.equal(labelled("SIMULATOR DE ZBOR").length, 1, "a longer word that starts with the label is not the label");
  assert.equal(labelled("NE-SIMULAT").length, 1, "a hyphenated negation is not the label");
  assert.equal(labelled("SIMULARE · Hub de test cu date sintetice").length, 0);
  assert.equal(labelled("Demonstrație simulată").length, 0, "an exact Romanian inflection counts (case-insensitive)");
});

test("M09-QA-18 (first clip, vertical): a master zoom on a small focus is limited in a narrow variant so the focus stays whole; a focus that cannot fit is reported, not chased", () => {
  const ir = masterIr({ captions: false });
  // c2: a toast-like focus in the lower right, zoomed ×2.1 in the 16:9 master (it fits there).
  ir.tracks[0].clips[1].focus = { x: 0.72, y: 0.82, w: 0.27, h: 0.16 };
  ir.tracks[0].clips[1].keyframes = [{ frame: 0, scale: 2.1, cx: 0.82, cy: 0.9 }, { frame: 149, scale: 2.2, cx: 0.82, cy: 0.9, ease: "inOut" }];
  ir.evidenceRegions = [];
  const getVersion = stubVersions({ durationMs: 20000 });
  const d = deriveVariant({ masterIr: ir, platformKey: "reels_9x16", getVersion });
  const clip = d.ir.tracks.find((t) => t.kind === "video").clips.find((c) => c.id === "c2");
  const vf = clipFraming(clip, { w: 1920, h: 1080 }, d.ir.canvas);
  const focus = ir.tracks[0].clips[1].focus;
  for (const kf of clip.keyframes) {
    const c = keyframeToSrc(vf, kf);
    const w = vf.S.w / kf.scale, h = vf.S.h / kf.scale;
    const win = { x: c.x - w / 2, y: c.y - h / 2, w, h };
    assert.ok(win.x <= focus.x + 1e-3 && win.x + win.w >= focus.x + focus.w - 1e-3, `frame ${kf.frame}: focus horizontally whole (window ${JSON.stringify(win)})`);
    assert.ok(win.y <= focus.y + 1e-3 && win.y + win.h >= focus.y + focus.h - 1e-3, `frame ${kf.frame}: focus vertically whole`);
    assert.ok(kf.scale < 2.1, "the zoom was reduced for the narrow frame");
  }
  assert.ok(d.changes.some((c) => c.kind === "keyframes" && c.clipId === "c2"));
  // The master's push-in survives (one ratio for the whole clip), instead of two equal capped zooms = a frozen frame.
  assert.ok(clip.keyframes[1].scale > clip.keyframes[0].scale, `movement kept: ${clip.keyframes.map((k) => k.scale).join(" → ")}`);
  // A focus wider than any 9:16 window: the crop cannot hold it → FOCUS_CUT, and the zoom is not forced down to scale 1 for it.
  const wide = masterIr({ captions: false });
  wide.evidenceRegions = [];
  wide.tracks[0].clips[1].focus = { x: 0.05, y: 0.4, w: 0.9, h: 0.2 };
  wide.tracks[0].clips[1].keyframes = [{ frame: 0, scale: 1.5, cx: 0.5, cy: 0.5 }];
  const dw = deriveVariant({ masterIr: wide, platformKey: "reels_9x16", getVersion });
  assert.ok(dw.findings.some((f) => f.code === "FOCUS_CUT" && f.clipId === "c2"));
  assert.equal(dw.ir.tracks.find((t) => t.kind === "video").clips.find((c) => c.id === "c2").keyframes[0].scale, 1.5);
});
