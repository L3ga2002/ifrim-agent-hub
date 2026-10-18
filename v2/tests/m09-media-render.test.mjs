// M09 EDIT: render compiler, durable render queue, editor adapters and interchange exports (T07 + T09).
// Real-render tests run the REAL ffmpeg/ffprobe through tests/fixtures/ffmpeg-proxy.mjs and report SKIPPED_ENV when the
// binaries (or the preset fonts) are absent; failure injection (hang/crash/diskfull/corrupt) uses tests/fixtures/fake-ffmpeg.mjs.
// Everything lives in a temporary data dir under .ifrim/tmp/v2-tests; no Hub, no model, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { makeMediaEnv, realLaunchers, fakeLaunchers, makeSyntheticMedia, probeJson, realTool, mediaTempDir } from "./media-helpers.mjs";
import { createMediaPaths } from "../server/media/paths.mjs";
import { createMediaTools, prepareArgs } from "../server/media/tools.mjs";
import { createMediaAssets } from "../server/media/assets.mjs";
import { createMediaRights } from "../server/media/rights.mjs";
import { irHash, framesToMs, timelineDuration, clipDuration } from "../server/media/ir.mjs";
import { PRESETS, seedPresets, resolveFonts } from "../server/media/visual-bible.mjs";
import { compileRenderPlan, parseLoudnormJson, usableMeasurement, profileCanvas, num, COMPILE_VERSION } from "../server/media/compile.mjs";
import { createRenderQueue, classifyRenderError, RENDER_FAILURE_CODES } from "../server/media/render.mjs";
import { EDITOR_ADAPTERS, createEditors, exportOtio, exportEdl, explainEdit, detectCapCut, detectPremiere } from "../server/media/editors.mjs";
import { newId } from "../server/core/ids.mjs";
import { isPidAlive } from "../server/runtime/supervisor.mjs";

const SHA_A = "a".repeat(64), SHA_B = "b".repeat(64), SHA_M = "c".repeat(64);
const PROBE_VIDEO = { container: "mov,mp4", durationMs: 2000, hasVideo: true, hasAudio: true, video: { width: 640, height: 360, fps: { num: 30, den: 1 }, pixFmt: "yuv420p", frameCount: 60 }, audio: { sampleRate: 48000, channels: 2 } };
const PROBE_AUDIO = { container: "wav", durationMs: 4000, hasVideo: false, hasAudio: true, video: null, audio: { sampleRate: 48000, channels: 1 } };
const FAKE_VIDEO_PROBE_JSON = JSON.stringify({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000", size: "4096", bit_rate: "16384" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1", r_frame_rate: "30/1", pix_fmt: "yuv420p", nb_frames: "60" },
    { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ],
});
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]);
const fakeMp4 = (seed) => Buffer.concat([MP4_HEAD, crypto.createHash("sha256").update(seed).digest(), Buffer.alloc(2048, seed.charCodeAt(0))]);
const TEXT_RO = "Știință și țară: ăâî — „test” %{n}";

function setPolicy(env, patch) {
  env.bus.transaction(() => env.settings.set("mediaPolicy", { ...env.settings.get("mediaPolicy"), ...patch }, "test"));
}
const events = (db, type) => db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);
const renderAssets = (db) => db.prepare("SELECT COUNT(*) AS n FROM media_assets WHERE category = 'render'").get().n;

/** A two-clip IR (crossfade + keyframed zoom), a Romanian text item, burned Romanian captions and an audio bed. */
function makeIR({ a, b, music, fps = { num: 30, den: 1 }, canvas = { width: 360, height: 640, background: "#0B0D10" }, text = TEXT_RO, extraClip = null, extraClips = [] }) {
  const clips = [
    { id: "c1", assetVersionId: a, sourceIn: 0, sourceOut: 45, start: 0, keyframes: [{ frame: 0, scale: 1, cx: 0.5, cy: 0.5 }, { frame: 40, scale: 1.15, cx: 0.55, cy: 0.45, ease: "inOut" }] },
    { id: "c2", assetVersionId: b, sourceIn: 6, sourceOut: 51, start: 36, transitionIn: { kind: "crossfade", frames: 9 }, fit: "contain", color: { preset: "warm" }, focus: { x: 0.3, y: 0.2, w: 0.4, h: 0.3 } },
  ];
  if (extraClip) clips.push(extraClip);
  clips.push(...extraClips);
  const D = clips.reduce((end, c) => Math.max(end, c.start + Math.round((c.sourceOut - c.sourceIn) / (c.speed ?? 1))), 0);
  const tracks = [
    { id: "v1", kind: "video", clips },
    { id: "t1", kind: "text", items: [{ id: "x1", start: 3, end: 60, text, style: "hook", anchor: "top", x: 0.5, y: 0.1, maxWidth: 0.86, animation: "fade" }] },
    { id: "cap", kind: "captions", burnIn: true, style: "caption", cues: [{ id: "q1", start: 10, end: 40, text: "Bună ziua, așa arată subtitrarea" }, { id: "q2", start: 45, end: 78, text: "Țintă: −14 LUFS, șase secunde" }] },
  ];
  if (music) tracks.push({ id: "a1", kind: "audio", clips: [{ id: "m1", assetVersionId: music, sourceIn: 0, sourceOut: D, start: 0, role: "music", gainDb: -12, fadeIn: 6, fadeOut: 9, envelope: [{ frame: 0, gainDb: -12 }, { frame: 60, gainDb: -18 }] }] });
  return { irVersion: 1, fps, canvas, preset: { id: "ifrim-tech", version: 1 }, language: "ro", tracks,
    markers: [{ frame: 0, kind: "hook", note: "Deschidere" }, { frame: 40, kind: "demo", note: "" }], loudness: { targetLufs: -14, maxTruePeakDb: -1 },
    meta: { title: "Test randare", labels: [], author: "test", notes: "" } };
}

function insertEdit(db, ir, title = "Proiect test") {
  const at = new Date().toISOString();
  const projectId = newId("mep");
  const versionId = newId("mev");
  db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, NULL, ?, 1, 'test', ?, ?)").run(projectId, title, at, at);
  db.prepare(`INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, parent_version_id, change_kind, change_json, validation_json, variant_key, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, NULL, 'initial', '{}', '{}', NULL, 'test', ?)`).run(versionId, projectId, JSON.stringify(ir), irHash(ir), at);
  return versionId;
}

/** Real media env: synthetic clips + music ingested, presets seeded, a queue on the real tools. */
async function realSetup(t, { queueOpts = {}, fps } = {}) {
  const launchers = realLaunchers();
  if (!launchers.available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe absent"); return null; }
  const fonts = resolveFonts(PRESETS["ifrim-tech"]);
  if (!fonts.ok) { t.skip(`SKIPPED_ENV: preset fonts missing (${fonts.missing.map((m) => m.file).join(", ")})`); return null; }
  const env = makeMediaEnv({ launchers });
  t.after(() => env.cleanup());
  setPolicy(env, { diskReserveGb: 0 });
  seedPresets(env.db);
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const tools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  // M10.2: a render needs pinned tools and pinning is an explicit act (never a side effect of the render or a read).
  await tools.pin({ actor: "test" });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools, settings: env.settings });
  const rights = createMediaRights({ db: env.db, bus: env.bus, clock: env.clock });
  const inbox = path.join(env.dir, "inbox");
  makeSyntheticMedia(inbox, { name: "clip-a.mp4", seconds: 2, width: 640, height: 360 });
  makeSyntheticMedia(inbox, { name: "clip-b.mp4", seconds: 2, width: 480, height: 480, text: true });
  makeSyntheticMedia(inbox, { name: "bed.wav", seconds: 4, kind: "audio" });
  const ingest = (name, category = "raw") => assets.ingestFile({ sourcePath: path.join(inbox, name), allowedRoots: [inbox], category, origin: "OWNED", actor: "test" });
  const a = (await ingest("clip-a.mp4")).version.id;
  const b = (await ingest("clip-b.mp4")).version.id;
  const music = (await ingest("bed.wav", "music")).version.id;
  const published = [];
  const queue = createRenderQueue({ db: env.db, bus: env.bus, live: { publish: (e) => published.push(e) }, clock: env.clock, paths, tools, assets, settings: env.settings, ...queueOpts });
  return { env, paths, tools, assets, rights, queue, published, a, b, music, fps };
}

/** Fake env: fake MP4 bytes ingested with a fake probe; the queue runs fake-ffmpeg in `mode`. */
async function fakeSetup(t, { mode = "copy", probeJson: queueProbe = FAKE_VIDEO_PROBE_JSON, queueOpts = {}, ffmpegEnv = null } = {}) {
  const env = makeMediaEnv({ launchers: fakeLaunchers({ FAKE_FFPROBE_JSON: FAKE_VIDEO_PROBE_JSON }) });
  t.after(() => env.cleanup());
  setPolicy(env, { diskReserveGb: 0 });
  seedPresets(env.db);
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const ingestTools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools: ingestTools, settings: env.settings });
  const rights = createMediaRights({ db: env.db, bus: env.bus, clock: env.clock });
  const inbox = path.join(env.dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const put = (name, seed) => { fs.writeFileSync(path.join(inbox, name), fakeMp4(seed)); return path.join(inbox, name); };
  const a = (await assets.ingestFile({ sourcePath: put("a.mp4", "a"), allowedRoots: [inbox], origin: "OWNED", actor: "test", title: "Clip A" })).version.id;
  const b = (await assets.ingestFile({ sourcePath: put("b.mp4", "b"), allowedRoots: [inbox], origin: "OWNED", actor: "test", title: "Clip B" })).version.id;
  const log = path.join(env.dir, "ffmpeg-log.jsonl");
  const base = fakeLaunchers({});
  const launchers = { ...base,
    ffmpeg: { ...base.ffmpeg, env: { FAKE_FFMPEG_MODE: mode, FAKE_FFMPEG_LOG: log, ...(ffmpegEnv ? ffmpegEnv(env.dir) : {}) } },
    ffprobe: { ...base.ffprobe, env: { FAKE_FFMPEG_MODE: "probe", FAKE_FFPROBE_JSON: queueProbe } } };
  const qconfig = Object.freeze({ ...env.config, mediaTools: Object.freeze({ ffmpeg: null, ffprobe: null, launcher: launchers }) });
  const tools = createMediaTools({ config: qconfig, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const published = [];
  const queue = createRenderQueue({ db: env.db, bus: env.bus, live: { publish: (e) => published.push(e) }, clock: env.clock, paths, tools, assets, settings: env.settings,
    resolveToolVersion: async () => "fake-ffmpeg-1", ...queueOpts });
  const simpleIR = () => ({ irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 360, height: 640, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: a, sourceIn: 0, sourceOut: 30, start: 0 }, { id: "c2", assetVersionId: b, sourceIn: 0, sourceOut: 30, start: 30 }] }],
    markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Fals", labels: [], author: "", notes: "" } });
  const readLog = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { env, paths, tools, assets, rights, queue, published, a, b, inbox, simpleIR, readLog };
}

/** Pure compile inputs for a synthetic IR (no files needed: compile never touches the disk). */
function pureInputs(fps = { num: 30, den: 1 }) {
  const ir = makeIR({ a: "mav_a", b: "mav_b", music: "mav_m", fps });
  const assets = {
    mav_a: { absPath: "C:/lib/originals/aa/a.mp4", inputPath: "../../../v2-media/originals/aa/a.mp4", sha256: SHA_A, probe: PROBE_VIDEO },
    mav_b: { absPath: "C:/lib/originals/bb/b.mp4", inputPath: "../../../v2-media/originals/bb/b.mp4", sha256: SHA_B, probe: PROBE_VIDEO },
    mav_m: { absPath: "C:/lib/originals/cc/m.wav", inputPath: "../../../v2-media/originals/cc/m.wav", sha256: SHA_M, probe: PROBE_AUDIO },
  };
  const fonts = { "SegUIVar.ttf": "C:/Windows/Fonts/SegUIVar.ttf", "segoeui.ttf": "C:/Windows/Fonts/segoeui.ttf", "CascadiaCode.ttf": "C:/Windows/Fonts/CascadiaCode.ttf" };
  return { ir, profile: "final", assets, fonts, preset: PRESETS["ifrim-tech"], toolVersion: "ffmpeg-8.1.2+0123456789abcdef" };
}
const allGraphText = (plan) => [...plan.segments.flatMap((s) => Object.values(s.files)), plan.final.files["graph.txt"], ...(plan.measure ? Object.values(plan.measure.files) : [])].join("\n");

/** Near-white, colourless pixels (Y > 200, |U−128| and |V−128| < 14) in a band [y, y + h) of one frame (real ffmpeg, raw yuv444p). */
function brightPixels(file, frame, y, h) {
  const out = execFileSync(realTool("ffmpeg"), ["-v", "error", "-i", file, "-vf", `select='eq(n,${frame})',crop=iw:${h}:0:${y},format=yuv444p`, "-frames:v", "1", "-f", "rawvideo", "-"],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const plane = out.length / 3;
  let n = 0;
  for (let i = 0; i < plane; i += 1) if (out[i] > 200 && Math.abs(out[plane + i] - 128) < 14 && Math.abs(out[2 * plane + i] - 128) < 14) n += 1;
  return n;
}

async function waitFor(fn, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// =====================================================================================================================
// compile (pure)

test("M09-RN-01: compile is deterministic — same IR → same argv, graphs and cache keys; keys follow only the clip's inputs", () => {
  const inputs = pureInputs();
  const p1 = compileRenderPlan(inputs);
  const p2 = compileRenderPlan(structuredClone(inputs));
  assert.deepEqual(p1, p2);
  assert.equal(p1.planHash, p2.planHash);
  assert.equal(p1.segments.length, 2);
  for (const s of p1.segments) assert.match(s.key, /^[0-9a-f]{64}$/);
  assert.notEqual(p1.segments[0].key, p1.segments[1].key);
  assert.equal(p1.final.needsMeasurement, true, "final profile = two-pass loudness: the first compile asks for the measurement");
  assert.equal(p1.final.args, null);
  assert.ok(p1.measure.args.includes("-f") && p1.measure.args.at(-1) === "-");

  // Changing ONLY the CTA/text keeps every segment key (no clip is re-rendered).
  const t = structuredClone(inputs); t.ir.tracks[1].items[0].text = "Programează un demo";
  const p3 = compileRenderPlan(t);
  assert.deepEqual(p3.segments.map((s) => s.key), p1.segments.map((s) => s.key));
  assert.notEqual(p3.final.files["text/t0.txt"], p1.final.files["text/t0.txt"]);
  // Captions, audio and transitions are final-pass only as well.
  const c = structuredClone(inputs); c.ir.tracks[2].cues[0].text = "Alt text"; c.ir.tracks[3].clips[0].gainDb = -6;
  assert.deepEqual(compileRenderPlan(c).segments.map((s) => s.key), p1.segments.map((s) => s.key));
  // A keyframe change re-keys that clip only; the tool version and the profile re-key everything.
  const k = structuredClone(inputs); k.ir.tracks[0].clips[0].keyframes[1].scale = 1.1;
  const p4 = compileRenderPlan(k);
  assert.notEqual(p4.segments[0].key, p1.segments[0].key);
  assert.equal(p4.segments[1].key, p1.segments[1].key);
  const tv = compileRenderPlan({ ...structuredClone(inputs), toolVersion: "ffmpeg-8.2" });
  assert.ok(tv.segments.every((s, i) => s.key !== p1.segments[i].key));
  const draft = compileRenderPlan({ ...structuredClone(inputs), profile: "draft" });
  assert.ok(draft.segments.every((s, i) => s.key !== p1.segments[i].key));
  // Another asset sha (new file content) re-keys the clip; the input PATH does not.
  const moved = structuredClone(inputs); moved.assets.mav_a.inputPath = "D:/elsewhere/a.mp4";
  assert.equal(compileRenderPlan(moved).segments[0].key, p1.segments[0].key);
  const changed = structuredClone(inputs); changed.assets.mav_a.sha256 = "d".repeat(64);
  assert.notEqual(compileRenderPlan(changed).segments[0].key, p1.segments[0].key);
});

test("M09-RN-02: no IR string reaches a filter graph; text via textfile + expansion=none, captions via ASS, relative paths only", () => {
  const inputs = pureInputs();
  inputs.ir.tracks[1].items[0].text = "Titlu'] ; [x] drawtext=text=evil:%{pts} C:\\Windows\\win.ini";
  const plan = compileRenderPlan({ ...inputs, loudness: { inputI: -20, inputTp: -3, inputLra: 4, inputThresh: -30, targetOffset: 0.2 } });
  const graphs = allGraphText(plan);
  assert.ok(!graphs.includes("evil") && !graphs.includes("win.ini") && !graphs.includes("Bună ziua"), "IR text never appears inside a graph");
  assert.match(plan.final.files["graph.txt"], /drawtext=fontfile=fonts\/f\d\.ttf:textfile=text\/t0\.txt:expansion=none/);
  assert.match(plan.final.files["graph.txt"], /subtitles=filename=captions\.ass:fontsdir=fonts/);
  assert.ok(plan.final.files["text/t0.txt"].includes("evil"), "the text lives in its own file");
  assert.ok(plan.final.files["captions.ass"].includes("Bună ziua, așa arată subtitrarea"));
  assert.ok(!/[A-Za-z]:[\\/]/.test(graphs), "no absolute Windows path inside a graph");
  assert.ok(Object.keys(plan.final.fontCopies).length >= 1);
  for (const name of Object.keys(plan.final.fontCopies)) assert.match(name, /^fonts\/f\d+\.(ttf|otf|ttc)$/);
  // Every argv passes the tools' own argv policy (whitelist before each input, graph files inspected, no forbidden filters).
  const dir = mediaTempDir("rn02");
  try {
    for (const s of plan.segments) for (const [rel, content] of Object.entries(s.files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); }
    fs.writeFileSync(path.join(dir, "graph.txt"), plan.final.files["graph.txt"]);
    for (const s of plan.segments) assert.doesNotThrow(() => prepareArgs("ffmpeg", s.args, { cwd: dir }));
    const prepared = prepareArgs("ffmpeg", plan.final.args, { cwd: dir });
    assert.equal(prepared.filter((a) => a === "-i").length, prepared.filter((a) => a === "file,pipe").length);
    assert.ok(plan.final.args.includes("-/filter_complex") && plan.final.args.includes("graph.txt"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // Encode settings per profile.
  const f = plan.final.args.join(" ");
  assert.match(f, /-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p/);
  assert.match(f, /-c:a aac -b:a 192k -ar 48000 -ac 2 -movflags \+faststart out\.partial\.mp4$/);
  assert.match(f, /-map_metadata -1/);
  const d = compileRenderPlan({ ...pureInputs(), profile: "draft" });
  assert.match(d.final.args.join(" "), /-preset ultrafast -crf 30/);
  assert.deepEqual(d.canvas, { width: 180, height: 320 });
  assert.equal(d.final.loudnessMode, "single_pass");
  assert.match(d.final.files["graph.txt"], /loudnorm=I=-14:TP=-1:LRA=11,aresample=48000/);
});

test("M09-RN-03: frame-rate cases 30 and 30000/1001 — xfade offsets, sample counts and durations from rational fps", () => {
  const p30 = compileRenderPlan({ ...pureInputs({ num: 30, den: 1 }), loudness: { inputI: -20, inputTp: -3, inputLra: 4, inputThresh: -30, targetOffset: 0.2 } });
  assert.equal(p30.expectedFrames, 81);
  assert.equal(p30.expectedDurationMs, 2700);
  assert.match(p30.final.files["graph.txt"], /xfade=transition=fade:duration=0\.3:offset=1\.2\[/);
  assert.match(p30.final.files["graph.txt"], /settb=expr=1\/30,setpts=N/);
  assert.match(p30.final.files["graph.txt"], /atrim=end_sample=129600/); // 81 frames × 48000 / 30
  assert.match(p30.final.files["graph.txt"], /afade=t=out:ss=115200:ns=14400/); // fadeOut 9 frames = 14400 samples
  assert.match(p30.final.files["graph.txt"], /measured_I=-20:measured_TP=-3:measured_LRA=4:measured_thresh=-30:offset=0\.2:linear=true/);

  const ntsc = { num: 30000, den: 1001 };
  const p = compileRenderPlan({ ...pureInputs(ntsc), loudness: { inputI: -20, inputTp: -3, inputLra: 4, inputThresh: -30, targetOffset: 0.2 } });
  assert.equal(p.expectedFrames, 81);
  assert.equal(p.expectedDurationMs, framesToMs(81, ntsc));
  assert.ok(Math.abs(p.expectedDurationMs - 2702.7) < 0.01);
  // offset = 36 × 1001 / 30000 = 1.2012 s, duration = 9 × 1001 / 30000 = 0.3003 s (exact frame boundaries in tb 1001/30000).
  assert.match(p.final.files["graph.txt"], /xfade=transition=fade:duration=0\.3003:offset=1\.2012\[/);
  assert.match(p.final.files["graph.txt"], /settb=expr=1001\/30000,setpts=N/);
  assert.match(p.final.files["graph.txt"], /atrim=end_sample=129730/); // round(81 × 1001 × 48000 / 30000) = 129729.6 → 129730
  for (const s of p.segments) {
    assert.ok(s.args.join(" ").includes("-r 30000/1001 -fps_mode cfr"));
    assert.match(Object.values(s.files)[0], /fps=30000\/1001:round=near/);
  }
  // Second clip seeks a quarter frame before its first source frame (6 − 0.25) × 1001/30000 s.
  const seg2 = p.segments[1].args;
  assert.equal(seg2[seg2.indexOf("-ss") + 1], num((5.75 * 1001) / 30000));
  // The keyframe expressions are numbers only.
  const zoom = Object.values(p.segments[0].files)[0];
  assert.match(zoom, /zoompan=z='if\(lt\(on,0\),1,if\(lt\(on,40\),1\+0\.15\*\(clip\(\(on-0\)\/40,0,1\)\*clip/);
  assert.match(zoom, /s=360x640:fps=30000\/1001/);
  assert.match(zoom, /scale=w=720:h=1280/, "final profile supersamples ×2 before zoompan");
  // Profile canvas rounding.
  assert.deepEqual(profileCanvas({ width: 1080, height: 1920 }, "draft"), { width: 540, height: 960 });
  assert.deepEqual(profileCanvas({ width: 1078, height: 1918 }, "draft"), { width: 540, height: 960 });
});

test("M09-RN-04: compile refuses invalid input with typed codes; loudnorm JSON is parsed strictly", () => {
  const inputs = pureInputs();
  const bad = structuredClone(inputs); bad.ir.tracks[0].clips[0].filter = "movie=/etc/passwd";
  assert.throws(() => compileRenderPlan(bad), (e) => e.code === "IR_INVALID");
  assert.throws(() => compileRenderPlan({ ...structuredClone(inputs), profile: "ultra" }), (e) => e.code === "PROFILE_INVALID");
  assert.throws(() => compileRenderPlan({ ...structuredClone(inputs), toolVersion: "" }), (e) => e.code === "TOOL_VERSION_MISSING");
  const missing = structuredClone(inputs); delete missing.assets.mav_b;
  assert.throws(() => compileRenderPlan(missing), (e) => e.code === "INPUT_MISSING");
  const noFont = structuredClone(inputs); noFont.fonts = {};
  assert.throws(() => compileRenderPlan(noFont), (e) => e.code === "FONT_MISSING");
  const fallback = structuredClone(inputs); delete fallback.fonts["SegUIVar.ttf"];
  assert.ok(compileRenderPlan(fallback).final.fontCopies, "the declared fallback (segoeui.ttf) is used");
  // loudnorm
  const lines = ["[Parsed_loudnorm_0 @ 0x1] ", "{", '\t"input_i" : "-21.75",', '\t"input_tp" : "-18.06",', '\t"input_lra" : "0.00",', '\t"input_thresh" : "-31.75",',
    '\t"output_i" : "-13.95",', '\t"normalization_type" : "dynamic",', '\t"target_offset" : "-0.05"', "}"];
  const m = parseLoudnormJson(lines);
  assert.deepEqual(m, { inputI: -21.75, inputTp: -18.06, inputLra: 0, inputThresh: -31.75, targetOffset: -0.05 });
  assert.equal(usableMeasurement(m), true);
  const silent = parseLoudnormJson(["{", '"input_i" : "-inf",', '"input_tp" : "-inf",', '"input_lra" : "0.00",', '"input_thresh" : "-70.00",', '"target_offset" : "inf"', "}"]);
  assert.equal(silent.inputI, -Infinity);
  assert.equal(usableMeasurement(silent), false);
  assert.equal(compileRenderPlan({ ...structuredClone(inputs), loudness: silent }).final.loudnessMode, "two_pass_silent");
  assert.equal(parseLoudnormJson(["no json here"]), null);
  assert.equal(parseLoudnormJson(["{", '"input_i" : "abc"', "}"]), null);
  for (const code of RENDER_FAILURE_CODES) assert.equal(classifyRenderError({ code }).code, code);
  assert.equal(classifyRenderError({ code: "ENOSPC", message: "x" }).code, "DISK_FULL");
  assert.equal(classifyRenderError({ code: "MEDIA_FILE_MISSING" }).code, "INPUT_MISSING");
  assert.equal(classifyRenderError({ code: "FONT_MISSING" }).code, "IR_INVALID");
  assert.equal(classifyRenderError(new Error("boom")).code, "TOOL_FAILED");
});

// =====================================================================================================================
// real renders

test("M09-RN-05: real end-to-end FINAL render (30 fps) — crossfade, keyframed zoom, Romanian text and captions, audio bed", async (t) => {
  const s = await realSetup(t);
  if (!s) return;
  const ir = makeIR({ a: s.a, b: s.b, music: s.music });
  const editVersionId = insertEdit(s.env.db, ir);
  const job = s.queue.request({ editVersionId, profile: "final", actor: "owner" });
  assert.equal(job.status, "REQUESTED");
  assert.equal(s.queue.request({ editVersionId, profile: "final", actor: "owner" }).duplicate, true, "a double click returns the same job");
  const run = s.queue.tick();
  assert.equal(run.claimed, job.id);
  const done = await run.done;
  assert.equal(done.status, "DONE", JSON.stringify(done.error));
  assert.ok(done.outputAssetVersionId);
  assert.equal(done.progress.cacheMisses, 2);
  assert.equal(done.progress.loudness, "two_pass");
  const version = s.assets.getVersion(done.outputAssetVersionId);
  assert.equal(version.category, "render");
  assert.equal(version.isOriginal, false);
  assert.deepEqual(version.derivedFrom.map((d) => d.versionId).sort(), [s.a, s.b, s.music].sort());
  const file = s.assets.versionPath(done.outputAssetVersionId);
  assert.equal(path.basename(file), `${job.id}.mp4`);
  // Independent checks with the real ffprobe/ffmpeg.
  const pj = probeJson(file);
  const v = pj.streams.find((x) => x.codec_type === "video");
  const a = pj.streams.find((x) => x.codec_type === "audio");
  assert.equal(v.width, 360); assert.equal(v.height, 640);
  assert.equal(v.pix_fmt, "yuv420p");
  assert.equal(v.r_frame_rate, "30/1");
  assert.equal(Number(v.nb_frames), 81);
  assert.ok(Math.abs(Number(v.duration) * 1000 - 2700) <= 1000 / 30 + 1e-6, `video duration ${v.duration}`);
  assert.equal(a.codec_name, "aac"); assert.equal(Number(a.sample_rate), 48000); assert.equal(a.channels, 2);
  assert.ok(Math.abs(Number(pj.format.duration) * 1000 - 2700) <= 1000 / 30 + 50);
  execFileSync(realTool("ffmpeg"), ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  // Two-pass loudnorm lands on the IR target (−14 LUFS integrated), measured independently with ebur128.
  const r128 = spawnSync(realTool("ffmpeg"), ["-hide_banner", "-nostdin", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const integrated = Number((/I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(r128.stderr.slice(r128.stderr.lastIndexOf("Summary:"))) || [])[1]);
  assert.ok(Math.abs(integrated - -14) <= 1.5, `integrated loudness ${integrated} LUFS`);
  // The job folder keeps the journal and the graphs (text never inside the graph); media copies are gone.
  const jobDir = s.paths.jobDir(job.id);
  const journal = JSON.parse(fs.readFileSync(path.join(jobDir, "journal.json"), "utf8"));
  assert.equal(journal.status, "DONE");
  assert.ok(Number.isFinite(journal.loudness.inputI));
  const graph = fs.readFileSync(path.join(jobDir, "graph.txt"), "utf8");
  assert.ok(!graph.includes("Știință") && graph.includes("textfile=text/t0.txt"));
  assert.equal(fs.readFileSync(path.join(jobDir, "text", "t0.txt"), "utf8").includes("Știință și țară"), true);
  assert.ok(!fs.existsSync(path.join(jobDir, "seg")) && !fs.existsSync(path.join(jobDir, "fonts")) && !fs.existsSync(path.join(jobDir, "out.partial.mp4")));
  // Events: transitions persisted; progress only live.
  const types = s.env.db.prepare("SELECT type FROM events WHERE scope_type = 'media_render' ORDER BY seq").all().map((r) => r.type);
  assert.deepEqual(types, ["media.render.requested", "media.render.claimed", "media.render.done"]);
  assert.equal(s.env.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE '%progress%'").get().n, 0);
  assert.ok(s.published.some((e) => e.type === "media.render.progress" && e.phase === "final"));
  assert.ok(s.published.some((e) => e.type === "media.render.progress" && Number.isFinite(e.outTimeMs)), "progress is measured from ffmpeg out_time");
  assert.equal(s.published.at(-1).phase, "done");
  // Segment cache rows live in the library cache folder.
  const cache = s.env.db.prepare("SELECT * FROM media_render_cache").all();
  assert.equal(cache.length, 2);
  for (const row of cache) { assert.match(row.rel_path, /^cache\/seg\/[0-9a-f]{64}\.mp4$/); assert.ok(fs.existsSync(s.paths.resolveRel(row.rel_path))); }
  // Text and captions are really drawn: near-white pixels (text #F2F5F8, captions #FFFFFF) appear in the top band once the hook
  // is visible (frame 20 vs frame 1, before it starts) and in the caption band once the first cue is on (frame 20 vs frame 2).
  assert.ok(brightPixels(file, 20, 50, 110) > brightPixels(file, 1, 50, 110) + 300, "hook text drawn");
  assert.ok(brightPixels(file, 20, 530, 60) > brightPixels(file, 2, 530, 60) + 50, "caption burned");
  assert.equal(s.env.supervisor.list().length, 0, "no process left");
});

test("M09-RN-06: real DRAFT render at 30000/1001 — half resolution, exact frame count, rational cadence, speed 2, still image with fade", async (t) => {
  const s = await realSetup(t);
  if (!s) return;
  const ntsc = { num: 30000, den: 1001 };
  // Plus a clip at constant speed 2 and a still image entering with a fade (dip through the background).
  makeSyntheticMedia(path.join(s.env.dir, "inbox"), { name: "still.png", kind: "image", width: 400, height: 300 });
  const img = (await s.assets.ingestFile({ sourcePath: path.join(s.env.dir, "inbox", "still.png"), allowedRoots: [path.join(s.env.dir, "inbox")], origin: "OWNED", category: "brand", actor: "test" })).version;
  assert.equal(img.kind, "image");
  const extraClips = [
    { id: "c3", assetVersionId: s.a, sourceIn: 0, sourceOut: 40, start: 81, speed: 2 },
    { id: "c4", assetVersionId: img.id, sourceIn: 0, sourceOut: 20, start: 95, transitionIn: { kind: "fade", frames: 6 } },
  ];
  const ir = makeIR({ a: s.a, b: s.b, music: s.music, fps: ntsc, extraClips });
  assert.equal(timelineDuration(ir), 115);
  const editVersionId = insertEdit(s.env.db, ir);
  const job = s.queue.request({ editVersionId, profile: "draft", actor: "owner" });
  const done = await s.queue.tick().done;
  assert.equal(done.status, "DONE", JSON.stringify(done.error));
  assert.equal(done.progress.loudness, "single_pass");
  assert.equal(done.segments.length, 4);
  const pj = probeJson(s.assets.versionPath(done.outputAssetVersionId));
  const v = pj.streams.find((x) => x.codec_type === "video");
  assert.equal(v.width, 180); assert.equal(v.height, 320);
  assert.equal(v.r_frame_rate, "30000/1001");
  assert.equal(Number(v.nb_frames), 115);
  assert.ok(Math.abs(Number(v.duration) * 1000 - framesToMs(115, ntsc)) <= framesToMs(1, ntsc) + 1e-6);
  assert.ok(pj.streams.some((x) => x.codec_type === "audio"));
  assert.equal(job.profile, "draft");
});

test("M09-RN-07: changing only the CTA text re-renders with segment cache hits; a TIMEOUT failure then retry reuses finished segments", async (t) => {
  const ntsc = { num: 30, den: 1 };
  // Clip 3 has a distinctive duration (21 frames) so the first queue can give exactly its segment a 100 ms timeout.
  const s = await realSetup(t, { queueOpts: { timeoutMs: (ms) => (Math.abs(ms - 700) < 1 ? 100 : 600000) } });
  if (!s) return;
  const extra = { id: "c3", assetVersionId: s.a, sourceIn: 10, sourceOut: 31, start: 81 };
  const ir = makeIR({ a: s.a, b: s.b, music: null, fps: ntsc, extraClip: extra });
  const v1 = insertEdit(s.env.db, ir);
  const first = s.queue.request({ editVersionId: v1, profile: "draft", actor: "owner" });
  const failed = await s.queue.tick().done;
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error.code, "TIMEOUT");
  assert.equal(renderAssets(s.env.db), 0, "nothing registered for a failed render");
  assert.equal(s.env.db.prepare("SELECT COUNT(*) AS n FROM media_render_cache").get().n, 2, "the two finished segments are cached");
  const journal = JSON.parse(fs.readFileSync(path.join(s.paths.jobDir(first.id), "journal.json"), "utf8"));
  assert.equal(journal.status, "FAILED");
  assert.ok(journal.partials.length >= 1, "the partial of the timed-out segment is recorded in the journal");
  assert.equal(events(s.env.db, "media.render.failed").length, 1);

  // Retry on a queue with normal timeouts: the two cached segments are hits, only clip 3 renders.
  const q2 = createRenderQueue({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, paths: s.paths, tools: s.tools, assets: s.assets, settings: s.env.settings });
  const retried = q2.retry(first.id, "owner");
  assert.equal(retried.status, "REQUESTED");
  assert.equal(retried.request.retryOf, first.id);
  assert.equal(q2.retry(first.id, "owner").id, retried.id, "a double retry returns the same new job");
  const done = await q2.tick().done;
  assert.equal(done.status, "DONE", JSON.stringify(done.error));
  assert.deepEqual(done.segments.map((x) => x.cache), ["hit", "hit", "miss"]);

  // A new edit version that changes only the text: every segment is a cache hit.
  const changed = structuredClone(ir); changed.tracks[1].items[0].text = "Programează un demo";
  const v2 = insertEdit(s.env.db, changed);
  q2.request({ editVersionId: v2, profile: "draft", actor: "owner" });
  const done2 = await q2.tick().done;
  assert.equal(done2.status, "DONE", JSON.stringify(done2.error));
  assert.deepEqual(done2.segments.map((x) => x.cache), ["hit", "hit", "hit"]);
  assert.equal(done2.progress.cacheMisses, 0);
  assert.equal(timelineDuration(changed), 102);

  // Cache cleanup: dry run lists, a real run removes only cache files (renders stay).
  const dry = q2.pruneCache({ olderThanDays: 0 });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.candidates.length, 3);
  assert.throws(() => q2.pruneCache({ olderThanDays: 0, dryRun: false }), (e) => e.code === "ACTOR_REQUIRED");
  const pruned = q2.pruneCache({ olderThanDays: 0, dryRun: false, actor: "owner" });
  assert.equal(pruned.removed.length, 3);
  assert.equal(s.env.db.prepare("SELECT COUNT(*) AS n FROM media_render_cache").get().n, 0);
  assert.equal(fs.readdirSync(path.join(s.paths.root, "cache", "seg")).length, 0);
  assert.ok(fs.existsSync(s.assets.versionPath(done2.outputAssetVersionId)), "renders are never pruned");
  assert.equal(events(s.env.db, "media.render.cache_pruned").length, 1);
});

// =====================================================================================================================
// failure injection (fake ffmpeg)

test("M09-RN-08: cancel during a render (fake hang) → CANCELLED, the process tree is killed, nothing registered", async (t) => {
  const s = await fakeSetup(t, { mode: "hang" });
  const editVersionId = insertEdit(s.env.db, s.simpleIR());
  const job = s.queue.request({ editVersionId, profile: "draft", actor: "owner" });
  const run = s.queue.tick();
  const proc = await waitFor(() => s.env.supervisor.list().find((p) => p.key.startsWith(`media:render:${job.id}`)));
  assert.ok(proc, "the fake ffmpeg is running");
  assert.equal(s.queue.get(job.id).status, "RUNNING");
  const r = await s.queue.cancel(job.id, "owner");
  assert.equal(r.changed, true);
  assert.equal(r.job.status, "CANCELLED");
  assert.equal(r.job.error.code, "CANCELLED");
  assert.equal((await run.done).status, "CANCELLED");
  assert.equal(s.env.supervisor.list().length, 0);
  assert.equal(await isPidAlive(proc.pid), false, "the killed process is gone");
  assert.equal(renderAssets(s.env.db), 0);
  const ev = events(s.env.db, "media.render.cancelled");
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].payload_json).code, "CANCELLED");
  assert.equal((await s.queue.cancel(job.id, "owner")).changed, false, "cancelling a finished job is a no-op");
});

test("M09-RN-09: crash → FAILED TOOL_FAILED, the partial stays in the job folder and is never registered", async (t) => {
  const s = await fakeSetup(t, { mode: "crash" });
  const editVersionId = insertEdit(s.env.db, s.simpleIR());
  const job = s.queue.request({ editVersionId, profile: "draft", actor: "owner" });
  const done = await s.queue.tick().done;
  assert.equal(done.status, "FAILED");
  assert.equal(done.error.code, "TOOL_FAILED");
  assert.match(done.error.message, /simulated crash/);
  const jobDir = s.paths.jobDir(job.id);
  const journal = JSON.parse(fs.readFileSync(path.join(jobDir, "journal.json"), "utf8"));
  assert.equal(journal.status, "FAILED");
  assert.ok(journal.partials.length === 1 && fs.existsSync(path.join(jobDir, journal.partials[0])), "the partial artifact is kept for diagnosis");
  assert.equal(renderAssets(s.env.db), 0);
  assert.equal(fs.readdirSync(path.join(s.paths.root, "renders")).length, 0, "nothing promoted");
  assert.equal(s.env.db.prepare("SELECT COUNT(*) AS n FROM media_render_cache").get().n, 0, "a failed segment never enters the cache");
  // The argv the fake saw: cwd = job folder, relative graph file, whitelist before the input.
  const call = s.readLog()[0];
  assert.equal(path.resolve(call.cwd).toLowerCase(), path.resolve(jobDir).toLowerCase());
  assert.ok(call.args.includes("-/filter_complex"));
  assert.equal(call.args[call.args.indexOf("-i") - 1], "file,pipe");
  assert.ok(!path.isAbsolute(call.args[call.args.indexOf("-/filter_complex") + 1]));
  assert.equal(s.env.supervisor.list().length, 0);
});

test("M09-RN-10: disk full → DISK_FULL; corrupt output → INVALID_OUTPUT; disk reserve → DISK_RESERVE before any ffmpeg call", async (t) => {
  const full = await fakeSetup(t, { mode: "diskfull" });
  full.queue.request({ editVersionId: insertEdit(full.env.db, full.simpleIR()), profile: "draft", actor: "owner" });
  const a = await full.queue.tick().done;
  assert.equal(a.status, "FAILED"); assert.equal(a.error.code, "DISK_FULL");

  const corrupt = await fakeSetup(t, { mode: "corrupt", probeJson: JSON.stringify({ format: {}, streams: [] }) });
  corrupt.queue.request({ editVersionId: insertEdit(corrupt.env.db, corrupt.simpleIR()), profile: "draft", actor: "owner" });
  const b = await corrupt.queue.tick().done;
  assert.equal(b.status, "FAILED"); assert.equal(b.error.code, "INVALID_OUTPUT");
  assert.equal(renderAssets(corrupt.env.db), 0);
  assert.equal(corrupt.env.db.prepare("SELECT COUNT(*) AS n FROM media_render_cache").get().n, 0);

  // A probe that reports the wrong geometry is refused too (validation is not just "it decodes").
  const wrong = await fakeSetup(t, { mode: "copy", ffmpegEnv: (dir) => ({ FAKE_FFMPEG_SOURCE: path.join(dir, "inbox", "a.mp4") }) });
  wrong.queue.request({ editVersionId: insertEdit(wrong.env.db, wrong.simpleIR()), profile: "draft", actor: "owner" });
  const w = await wrong.queue.tick().done;
  assert.equal(w.error.code, "INVALID_OUTPUT");
  assert.match(w.error.message, /dimensiuni 640×360/);

  const reserve = await fakeSetup(t, { mode: "copy" });
  setPolicy(reserve.env, { diskReserveGb: 1e9 });
  reserve.queue.request({ editVersionId: insertEdit(reserve.env.db, reserve.simpleIR()), profile: "draft", actor: "owner" });
  const c = await reserve.queue.tick().done;
  assert.equal(c.status, "FAILED"); assert.equal(c.error.code, "DISK_RESERVE");
  assert.equal(reserve.readLog().length, 0, "no ffmpeg call when the reserve is not met");
});

test("M09-RN-11: recover() marks active jobs INTERRUPTED (CANCEL_REQUESTED → CANCELLED) and never resumes them; retry is explicit", async (t) => {
  const s = await fakeSetup(t, { mode: "copy" });
  const editVersionId = insertEdit(s.env.db, s.simpleIR());
  const ids = {};
  for (const status of ["CLAIMED", "RUNNING", "VALIDATING", "CANCEL_REQUESTED"]) {
    const j = s.queue.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: `k-${status}` });
    s.env.db.prepare("UPDATE media_render_jobs SET status = ?, claim_token = 'old' WHERE id = ?").run(status, j.id);
    ids[status] = j.id;
  }
  const r = s.queue.recover();
  assert.deepEqual(r.interrupted.sort(), [ids.CLAIMED, ids.RUNNING, ids.VALIDATING].sort());
  assert.deepEqual(r.cancelled, [ids.CANCEL_REQUESTED]);
  assert.equal(s.queue.get(ids.RUNNING).status, "INTERRUPTED");
  assert.equal(s.queue.get(ids.RUNNING).error.code, "INTERRUPTED");
  assert.equal(events(s.env.db, "media.render.interrupted").length, 3);
  assert.deepEqual(s.queue.tick(), { idle: true }, "an interrupted job is never claimed again by itself");
  assert.deepEqual(s.queue.recover(), { interrupted: [], cancelled: [] }, "idempotent");
  const retry = s.queue.retry(ids.RUNNING, "owner");
  assert.equal(retry.status, "REQUESTED");
  assert.throws(() => s.queue.retry(retry.id, "owner"), (e) => e.code === "RENDER_NOT_RETRYABLE");
  assert.equal(s.readLog().length, 0, "recover runs no process");
});

test("M09-RN-12: request validation, idempotency, queued cancel, interactive priority and concurrency", async (t) => {
  const s = await fakeSetup(t, { mode: "hang" });
  const editVersionId = insertEdit(s.env.db, s.simpleIR());
  assert.throws(() => s.queue.request({ editVersionId, profile: "4k", actor: "owner" }), (e) => e.code === "PROFILE_INVALID");
  assert.throws(() => s.queue.request({ editVersionId: "mev_nope", profile: "draft", actor: "owner" }), (e) => e.code === "EDIT_VERSION_MISSING");
  assert.throws(() => s.queue.request({ editVersionId, profile: "draft", actor: "" }), (e) => e.code === "ACTOR_REQUIRED");
  assert.throws(() => s.queue.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: "a b" }), (e) => e.code === "FIELD_INVALID");
  const j1 = s.queue.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: "same" });
  assert.equal(s.queue.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: "same" }).id, j1.id);
  assert.throws(() => s.queue.request({ editVersionId, profile: "final", actor: "owner", idempotencyKey: "same" }), (e) => e.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(events(s.env.db, "media.render.requested").length, 1);
  // A queued job is cancelled without any process.
  const c = await s.queue.cancel(j1.id, "owner");
  assert.equal(c.job.status, "CANCELLED");
  assert.equal(s.readLog().length, 0);
  // Interactive priority defers renders while an AI run / Lega voice is active.
  let busy = true;
  const q = createRenderQueue({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, paths: s.paths, tools: s.tools, assets: s.assets, settings: s.env.settings,
    resolveToolVersion: async () => "fake", isInteractiveBusy: () => busy });
  const j2 = q.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: "two" });
  q.request({ editVersionId, profile: "draft", actor: "owner", idempotencyKey: "three" });
  assert.deepEqual(q.tick(), { deferred: true, reason: "interactive" });
  assert.equal(q.get(j2.id).status, "REQUESTED");
  busy = false;
  const run = q.tick();
  assert.equal(run.claimed, j2.id);
  assert.deepEqual(q.tick(), { deferred: true, reason: "concurrency" }, "renderConcurrency = 1");
  await waitFor(() => s.env.supervisor.list().length > 0);
  await q.cancel(j2.id, "owner");
  assert.equal((await run.done).status, "CANCELLED");
  // With the setting off, a busy interactive state does not defer.
  setPolicy(s.env, { interactivePriority: false });
  busy = true;
  const run3 = q.tick();
  assert.ok(run3.claimed);
  await waitFor(() => s.env.supervisor.list().length > 0);
  await q.cancel(run3.claimed, "owner");
  await run3.done;
  assert.equal(s.env.supervisor.list().length, 0);
});

test("M09-RN-13: an invalid IR fails as IR_INVALID and a vanished input as INPUT_MISSING, before any ffmpeg call", async (t) => {
  const s = await fakeSetup(t, { mode: "copy" });
  const bad = s.simpleIR(); bad.tracks[0].clips[1].start = 40; // gap
  s.queue.request({ editVersionId: insertEdit(s.env.db, bad), profile: "draft", actor: "owner" });
  const a = await s.queue.tick().done;
  assert.equal(a.status, "FAILED"); assert.equal(a.error.code, "IR_INVALID");
  const v = s.assets.getVersion(s.b);
  const abs = s.paths.resolveRel(v.relPath);
  fs.chmodSync(abs, 0o666); fs.unlinkSync(abs);
  s.queue.request({ editVersionId: insertEdit(s.env.db, s.simpleIR()), profile: "draft", actor: "owner" });
  const b = await s.queue.tick().done;
  assert.equal(b.status, "FAILED"); assert.equal(b.error.code, "INPUT_MISSING");
  assert.equal(s.readLog().length, 0);
  // A REQUESTED job of a deleted edit version is IR_INVALID; retry of a DONE job is refused.
  assert.throws(() => s.queue.retry("mrj_nope", "owner"), (e) => e.code === "RENDER_MISSING");
  // (review R24) Edit versions are immutable: an IR changed underneath the stored hash is refused before any ffmpeg call.
  const vid = insertEdit(s.env.db, s.simpleIR());
  s.queue.request({ editVersionId: vid, profile: "draft", actor: "owner" });
  const changed = s.simpleIR(); changed.tracks[0].clips[0].sourceOut = 20; changed.tracks[0].clips[1].start = 20;
  s.env.db.prepare("UPDATE media_edit_versions SET ir_json = ? WHERE id = ?").run(JSON.stringify(changed), vid);
  const c = await s.queue.tick().done;
  assert.equal(c.status, "FAILED"); assert.equal(c.error.code, "IR_INVALID");
  assert.match(c.error.message, /amprentei/);
  assert.equal(s.readLog().length, 0, "still no ffmpeg call");
});

test("M09-RN-13b (review R18): a captions track's layout (anchor + platform safe area) reaches the burned ASS style", () => {
  const inputs = pureInputs();
  const cap = inputs.ir.tracks.find((tr) => tr.kind === "captions");
  const assOf = (plan) => [...plan.segments.flatMap((s) => Object.entries(s.files)), ...Object.entries(plan.final.files)].find(([name]) => name.endsWith(".ass"))?.[1] || "";
  const styleOf = (ass) => {
    const fmt = ass.split(/\r?\n/).find((l) => l.startsWith("Format:") && l.includes("Alignment")).slice(7).split(",").map((x) => x.trim());
    const val = ass.split(/\r?\n/).find((l) => l.startsWith("Style:")).slice(6).split(",").map((x) => x.trim());
    return Object.fromEntries(fmt.map((k, i) => [k, val[i]]));
  };
  const before = styleOf(assOf(compileRenderPlan(inputs)));
  assert.equal(before.Alignment, "2", "default: bottom");
  cap.layout = { anchor: "top", safeArea: { top: 0.14, bottom: 0.22, left: 0.06, right: 0.14 } };
  const after = styleOf(assOf(compileRenderPlan(inputs)));
  assert.equal(after.Alignment, "8", "the track's anchor (top) is used");
  assert.equal(Number(after.MarginV), Math.round(0.14 * 640), "the vertical margin comes from the platform safe area (top)");
  assert.equal(Number(after.MarginR), Math.round(0.14 * 360), "the right margin keeps captions off the platform's side buttons");
});

// =====================================================================================================================
// editors

test("M09-RN-14: OTIO export is structurally valid (Timeline.1, dissolve offsets, durations, ExternalReference, audio gaps)", () => {
  const ir = makeIR({ a: "mav_a", b: "mav_b", music: "mav_m" });
  ir.tracks[3].clips[0].start = 6; ir.tracks[3].clips[0].sourceOut = 70;
  const assetsMap = { mav_a: { absPath: "C:/lib/a.mp4", probe: PROBE_VIDEO, sha256: SHA_A, title: "Ecran" }, mav_b: { absPath: "C:/lib/b.mp4", probe: PROBE_VIDEO, sha256: SHA_B, title: "Cameră" } };
  const doc = JSON.parse(JSON.stringify(exportOtio(ir, assetsMap)));
  assert.equal(doc.OTIO_SCHEMA, "Timeline.1");
  assert.equal(doc.tracks.OTIO_SCHEMA, "Stack.1");
  const [video, audio] = doc.tracks.children;
  assert.equal(video.OTIO_SCHEMA, "Track.1"); assert.equal(video.kind, "Video");
  assert.deepEqual(video.children.map((c) => c.OTIO_SCHEMA), ["Clip.2", "Transition.1", "Clip.2"]);
  const [c1, tr, c2] = video.children;
  assert.equal(tr.transition_type, "SMPTE_Dissolve");
  assert.equal(tr.in_offset.value + tr.out_offset.value, 9);
  const trackDur = video.children.filter((c) => c.OTIO_SCHEMA === "Clip.2").reduce((s, c) => s + c.source_range.duration.value, 0);
  assert.equal(trackDur, timelineDuration(ir), "OTIO track duration (transitions add none) = IR timeline");
  assert.equal(c1.source_range.duration.rate, 30);
  assert.equal(c2.source_range.start_time.value, 6 + tr.in_offset.value, "the incoming clip's range starts at the cut point");
  assert.equal(c1.media_references.DEFAULT_MEDIA.OTIO_SCHEMA, "ExternalReference.1");
  assert.match(c1.media_references.DEFAULT_MEDIA.target_url, /^file:\/\/\/C:\/lib\/a\.mp4$/);
  assert.equal(c1.media_references.DEFAULT_MEDIA.available_range.duration.value, 60);
  assert.equal(c1.active_media_reference_key, "DEFAULT_MEDIA");
  assert.equal(c1.metadata.ifrim.keyframes.length, 2, "zoom keyframes travel as metadata");
  assert.equal(audio.kind, "Audio");
  assert.deepEqual(audio.children.map((c) => c.OTIO_SCHEMA), ["Gap.1", "Clip.2"]);
  assert.equal(audio.children[0].source_range.duration.value, 6);
  assert.equal(audio.children[1].media_references.DEFAULT_MEDIA.OTIO_SCHEMA, "MissingReference.1", "no file known → MissingReference");
  assert.equal(doc.tracks.markers.length, 2);
  assert.equal(doc.tracks.markers[0].OTIO_SCHEMA, "Marker.2");
  assert.equal(doc.metadata.ifrim.text[0].text, TEXT_RO);
  assert.equal(doc.metadata.ifrim.irSha256, irHash(ir));
  const ntsc = exportOtio(makeIR({ a: "mav_a", b: "mav_b", music: null, fps: { num: 30000, den: 1001 } }), assetsMap);
  assert.ok(Math.abs(ntsc.tracks.children[0].children[0].source_range.duration.rate - 29.97002997) < 1e-6);
  assert.throws(() => exportOtio({ irVersion: 2 }), (e) => e.code === "IR_INVALID");
});

test("M09-RN-15: EDL CMX3600 is structurally valid (continuous record timecodes, NDF, lost operations as comments)", () => {
  const ir = makeIR({ a: "mav_a", b: "mav_b", music: "mav_m" });
  ir.tracks[0].clips[1].speed = 1; // explicit
  const edl = exportEdl(ir, { title: "Demo șablon", assetsMap: { mav_a: { title: "Ecran înregistrat" } } });
  const lines = edl.split("\r\n");
  assert.equal(lines[0], "TITLE: DEMO SABLON");
  assert.equal(lines[1], "FCM: NON-DROP FRAME");
  const ev = lines.filter((l) => /^\d{3}  /.test(l));
  assert.equal(ev.length, 2);
  const re = /^(\d{3})  AX {7}V {5}C {8}(\d\d:\d\d:\d\d:\d\d) (\d\d:\d\d:\d\d:\d\d) (\d\d:\d\d:\d\d:\d\d) (\d\d:\d\d:\d\d:\d\d)$/;
  const parsed = ev.map((l) => { const m = re.exec(l); assert.ok(m, l); return m; });
  assert.equal(parsed[0][4], "00:00:00:00");
  assert.equal(parsed[0][5], parsed[1][4], "record timecodes are continuous");
  assert.equal(parsed[1][5], "00:00:02:21", "81 frames at 30 fps");
  assert.ok(edl.includes("* FROM CLIP NAME: Ecran inregistrat"));
  assert.ok(edl.includes("* IFRIM PIERDUT: CROSSFADE 9 CADRE REDAT CA TAIETURA"));
  assert.ok(edl.includes("ZOOM/PAN 2 KEYFRAME-URI OMISE"));
  assert.ok(edl.includes("PISTELE TEXT, SUBTITRARI, AUDIO"));
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(edl), "ASCII only");
  const ntsc = exportEdl(makeIR({ a: "mav_a", b: "mav_b", music: null, fps: { num: 30000, den: 1001 } }));
  assert.match(ntsc, /CADENTA 30000\/1001; TIMECODE NDF/);
});

test("M09-RN-16: explainEdit describes interval, asset, movement, captions, sound and reason in Romanian", () => {
  const ir = makeIR({ a: "mav_a", b: "mav_b", music: "mav_m" });
  ir.tracks[0].clips[0].claimIds = ["ccl_1"];
  const ex = explainEdit(ir, { assetsMap: { mav_a: { title: "Ecran" }, mav_m: { title: "Muzică" } } });
  assert.equal(ex.entries.length, 2);
  const [e1, e2] = ex.entries;
  assert.equal(e1.asset, "Ecran");
  assert.match(e1.movement, /zoom 1,00× → 1,15× \(accelerare\/decelerare lină\)/);
  assert.match(e1.reason, /cârlig \(deschidere\): Deschidere/);
  assert.match(e1.reason, /susține afirmațiile ccl_1/);
  assert.ok(e1.captions.some((c) => c.includes("Bună ziua")));
  assert.ok(e1.sound[0].includes("music „Muzică”") && e1.sound[0].includes("anvelopă"));
  assert.match(e2.movement, /intrare prin dizolvare de 9 cadre/);
  assert.match(e2.movement, /încadrat complet/);
  assert.equal(e2.fromMs, 1200); assert.equal(e2.toMs, 2700);
  assert.equal(ex.durationMs, 2700);
  assert.match(ex.lines[0], /^1\. 0,00 s–1,50 s · Ecran/);
});

test("M09-RN-17: CapCut assisted pack is complete (cleared media, SRT, timeline, steps, manifest with hashes); uncleared media is excluded", async (t) => {
  const s = await fakeSetup(t, { mode: "copy" });
  for (const id of [s.a, s.b]) {
    const v = s.assets.getVersion(id);
    s.rights.record({ assetId: v.assetId, status: "CLEARED_FOR_SCOPE", platforms: ["*"], uses: ["*"], holder: "Ifrim Digital", actor: "owner" });
  }
  const ir = s.simpleIR();
  ir.tracks.push({ id: "cap", kind: "captions", burnIn: true, style: "caption", cues: [{ id: "q1", start: 5, end: 40, text: `Bună ziua, ${String.fromCharCode(0x15f)}tergem` }] }); // U+015F (cedilla) on purpose: normalised to comma-below
  ir.tracks.push({ id: "t1", kind: "text", items: [{ id: "x1", start: 0, end: 30, text: "Programează un demo", style: "cta" }] });
  const editVersionId = insertEdit(s.env.db, ir, "Pachet „asistat”");
  const editors = createEditors({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, paths: s.paths, assets: s.assets, rights: s.rights, tools: s.tools });
  const pack = editors.exportAssistedPack({ editVersionId, actor: "owner" });
  assert.equal(pack.complete, true, JSON.stringify(pack.excluded));
  for (const f of ["captions.srt", "captions.vtt", "timeline.csv", "timeline.md", "steps.md", "explain.md", "manifest.json"]) assert.ok(pack.files.includes(f), f);
  const media = pack.files.filter((f) => f.startsWith("media/"));
  assert.equal(media.length, 2);
  for (const m of media) assert.match(m, /^media\/\d{2}_[0-9a-f]{12}\.mp4$/, "content-addressed names, never the imported file name");
  const manifest = JSON.parse(fs.readFileSync(path.join(pack.dir, "manifest.json"), "utf8"));
  for (const [rel, info] of Object.entries(manifest.files)) assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(pack.dir, rel))).digest("hex"), info.sha256, rel);
  assert.equal(manifest.irSha256, irHash(ir));
  const srt = fs.readFileSync(path.join(pack.dir, "captions.srt"), "utf8");
  assert.match(srt, /^1\n00:00:00,167 --> 00:00:01,333\nBună ziua, ștergem\n/, "SRT with comma-below ș (cedilla normalised)");
  const csv = fs.readFileSync(path.join(pack.dir, "timeline.csv"), "utf8");
  assert.ok(csv.includes("00:00:00:00;00:00:01:00;Video v1;c1;media/"));
  assert.ok(csv.includes("Programează un demo"));
  const steps = fs.readFileSync(path.join(pack.dir, "steps.md"), "utf8");
  assert.match(steps, /NU deschide și NU modifică proiecte CapCut/);
  assert.match(steps, /360×640, 30,000 cadre\/s/);
  assert.ok(!fs.readdirSync(pack.dir, { recursive: true }).some((f) => /\.(ttf|otf|ttc)$/i.test(String(f))), "system fonts are never copied");
  assert.equal(events(s.env.db, "media.export.capcut_pack").length, 1);
  assert.ok(!fs.existsSync(`${pack.dir}.partial`));

  // Clip B without rights (a second asset row for new bytes) → excluded, pack incomplete.
  fs.writeFileSync(path.join(s.inbox, "c.mp4"), fakeMp4("z"));
  const c = (await s.assets.ingestFile({ sourcePath: path.join(s.inbox, "c.mp4"), allowedRoots: [s.inbox], origin: "UNKNOWN", actor: "test" })).version.id;
  const ir2 = s.simpleIR(); ir2.tracks[0].clips[1].assetVersionId = c;
  const p2 = editors.exportAssistedPack({ editVersionId: insertEdit(s.env.db, ir2), actor: "owner" });
  assert.equal(p2.complete, false);
  assert.deepEqual(p2.excluded.map((e) => e.versionId), [c]);
  assert.equal(p2.files.filter((f) => f.startsWith("media/")).length, 1);
  assert.match(fs.readFileSync(path.join(p2.dir, "steps.md"), "utf8"), /Media exclusă/);
  assert.throws(() => editors.exportAssistedPack({ editVersionId: "mev_x", actor: "owner" }), (e) => e.code === "EDIT_VERSION_MISSING");
});

test("M09-RN-18: adapters inspect capabilities (ffmpeg real/fake, Premiere NOT_INSTALLED, CapCut detected + ASSISTED); exports are written", async (t) => {
  const s = await fakeSetup(t, { mode: "copy" });
  const root = path.join(s.env.dir, "fake-programs");
  const pf = path.join(root, "Program Files");
  const lad = path.join(root, "LocalAppData");
  fs.mkdirSync(path.join(pf, "Adobe"), { recursive: true });
  assert.deepEqual(detectPremiere({ programFiles: pf }), { installed: false, status: "NOT_INSTALLED", version: null });
  assert.equal(detectCapCut({ localAppData: lad, programFiles: pf }).status, "NOT_INSTALLED");
  fs.mkdirSync(path.join(lad, "CapCut", "Apps", "5.9.0.2241"), { recursive: true });
  fs.writeFileSync(path.join(lad, "CapCut", "Apps", "5.9.0.2241", "CapCut.exe"), "x");
  fs.mkdirSync(path.join(lad, "CapCut", "Apps", "4.0.0"), { recursive: true }); // no exe → ignored
  const cc = detectCapCut({ localAppData: lad, programFiles: pf });
  assert.deepEqual(cc, { installed: true, status: "INSTALLED", version: "5.9.0.2241", mode: "ASSISTED" });
  const editors = createEditors({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, paths: s.paths, assets: s.assets, rights: s.rights, tools: s.tools, env: { programFiles: pf, localAppData: lad } });
  const all = await editors.inspectAll();
  assert.deepEqual(Object.keys(all).sort(), ["capcut", "edl", "ffmpeg", "otio", "premiere"]);
  assert.equal(all.ffmpeg.status, "AVAILABLE");
  assert.equal(all.premiere.status, "NOT_INSTALLED");
  assert.equal(all.capcut.status, "INSTALLED"); assert.equal(all.capcut.mode, "ASSISTED"); assert.equal(all.capcut.version, "5.9.0.2241");
  assert.equal(all.edl.ops.trim, "native"); assert.equal(all.edl.ops.transition_crossfade, "unsupported");
  assert.equal(typeof EDITOR_ADAPTERS.premiere.inspectCapabilities, "function");
  const missing = await EDITOR_ADAPTERS.ffmpeg.inspectCapabilities({ tools: null });
  assert.equal(missing.status, "MISSING");

  const editVersionId = insertEdit(s.env.db, s.simpleIR());
  const otio = editors.writeOtio({ editVersionId, actor: "owner" });
  assert.match(otio.relPath, /^exports\/mex_otio_[A-Za-z0-9_]+\.otio$/);
  const doc = JSON.parse(fs.readFileSync(otio.absPath, "utf8"));
  assert.equal(doc.OTIO_SCHEMA, "Timeline.1");
  assert.match(doc.tracks.children[0].children[0].media_references.DEFAULT_MEDIA.target_url, /^file:\/\/\//);
  const edl = editors.writeEdl({ editVersionId, actor: "owner" });
  assert.match(fs.readFileSync(edl.absPath, "utf8"), /^TITLE: FALS\r\nFCM: NON-DROP FRAME\r\n/);
  assert.equal(events(s.env.db, "media.export.otio").length, 1);
  assert.equal(events(s.env.db, "media.export.edl").length, 1);
  assert.throws(() => editors.writeOtio({ editVersionId, actor: "" }), (e) => e.code === "ACTOR_REQUIRED");
  assert.equal(clipDuration(s.simpleIR().tracks[0].clips[0]), 30);
  assert.equal(COMPILE_VERSION, "m09-compile-1");
});
