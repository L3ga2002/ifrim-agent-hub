// M09 FOUND: media paths, tools (ffmpeg/ffprobe), probe normalisation, the asset library and rights (T05 + T06).
// Deterministic tests use the fake ffmpeg fixture (failure injection, argv log); real-tool tests run the REAL ffmpeg/ffprobe
// through tests/fixtures/ffmpeg-proxy.mjs and report SKIPPED_ENV when the binaries are absent. Everything lives in a temporary
// data dir under .ifrim/tmp/v2-tests; no Hub, no model, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createSupervisor } from "../server/runtime/supervisor.mjs";
import { makeMediaEnv, realLaunchers, fakeLaunchers, makeSyntheticMedia, probeJson, realTool, FFMPEG_PROXY, mediaTempDir } from "./media-helpers.mjs";
import { createMediaPaths, isSyncedPath, assertRegularFile } from "../server/media/paths.mjs";
import { createMediaTools, inputArgs, prepareArgs, createProgressParser, PROTOCOL_WHITELIST } from "../server/media/tools.mjs";
import { normalizeProbe, parseRational, rotationOf } from "../server/media/probe.mjs";
import { createMediaAssets, sniffMagic } from "../server/media/assets.mjs";
import { createMediaRights } from "../server/media/rights.mjs";

const VIDEO_PROBE = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000", size: "4096", bit_rate: "16384" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1", r_frame_rate: "30/1", pix_fmt: "yuv420p", nb_frames: "60" },
    { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, channel_layout: "stereo" },
  ],
};
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2")]);
const fakeMp4 = (seed = "a", size = 2048) => Buffer.concat([MP4_HEAD, crypto.createHash("sha256").update(seed).digest(), Buffer.alloc(size, seed.charCodeAt(0))]);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function setPolicy(env, patch) {
  env.bus.transaction(() => env.settings.set("mediaPolicy", { ...env.settings.get("mediaPolicy"), ...patch }, "test"));
}

/** A media env + services. Disk reserve 0 so a nearly full test machine never fails an import for the wrong reason. */
function setup({ launchers = null, fake = {}, maxBytes, clock } = {}) {
  const env = makeMediaEnv({ launchers: launchers || fakeLaunchers(fake), ...(clock ? { clock } : {}) });
  setPolicy(env, { diskReserveGb: 0 });
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const tools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools, settings: env.settings, ...(maxBytes ? { maxBytes } : {}) });
  const rights = createMediaRights({ db: env.db, bus: env.bus, clock: env.clock });
  const inbox = path.join(env.dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const put = (name, content) => { const p = path.join(inbox, name); fs.writeFileSync(p, content); return p; };
  return { env, paths, tools, assets, rights, inbox, put };
}
const fakeVideoEnv = (extra = {}) => ({ FAKE_FFPROBE_JSON: JSON.stringify(VIDEO_PROBE), ...extra });
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const events = (db, type) => db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);
const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

async function rejectsCode(promiseOrFn, code) {
  await assert.rejects(typeof promiseOrFn === "function" ? promiseOrFn : () => promiseOrFn, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });
}
function throwsCode(fn, code) { assert.throws(fn, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; }); }

function junction(target, link, t) {
  try { fs.symlinkSync(target, link, "junction"); return true; } catch (error) { t.skip(`SKIPPED_ENV: junction creation not permitted (${error.code})`); return false; }
}

// ---------------------------------------------------------------- paths

test("review B assets: a probe completing after detach cannot read or write the closed DB", async () => {
  const s = setup(); let release, entered;
  const held = new Promise((r) => { release = r; });
  const ready = new Promise((r) => { entered = r; });
  s.tools.probe = async () => { entered(); await held; return normalizeProbe(VIDEO_PROBE); };
  const work = s.assets.ingestFile({ sourcePath: s.put("late.mp4", fakeMp4()), allowedRoots: [s.inbox], actor: "test" });
  const refused = assert.rejects(work, (e) => e.code === "HUB_SHUTDOWN");
  await ready;
  s.assets.detach(); await s.env.cleanup(); release();
  await refused;
  fs.rmSync(s.env.dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(s.env.dir), false, "cleanup settled before directory removal");
});

test("M09-AS-01: paths are content-addressed or id-based and resolvers refuse traversal, absolute paths and NUL", async () => {
  const { env, paths } = setup();
  try {
    for (const f of ["originals", "derivatives", "renders", "cache", "exports", "packs", "transcripts", "thumbnails", "capture"]) assert.ok(fs.statSync(path.join(paths.root, f)).isDirectory(), f);
    const s = "ab".repeat(32);
    assert.equal(paths.relOf(paths.originalPath(s, "mp4")), `originals/ab/${s}.mp4`);
    assert.equal(paths.relOf(paths.renderPath("mrj_1_x", "mp4")), "renders/mrj_1_x.mp4");
    assert.equal(paths.relOf(paths.derivativePath("proxy", s, ".MP4")), `derivatives/proxy/${s}.mp4`);
    throwsCode(() => paths.originalPath("../../x", "mp4"), "MEDIA_SHA_INVALID");
    throwsCode(() => paths.originalPath(s, "mp4;rm"), "MEDIA_EXT_INVALID");
    throwsCode(() => paths.renderPath("../evil", "mp4"), "MEDIA_ID_INVALID");
    throwsCode(() => paths.resolveRel("../hub-v2.sqlite"), "MEDIA_PATH_TRAVERSAL");
    throwsCode(() => paths.resolveRel("originals/../../x"), "MEDIA_PATH_TRAVERSAL");
    throwsCode(() => paths.resolveRel("C:\\Windows\\win.ini"), "MEDIA_PATH_ABSOLUTE");
    throwsCode(() => paths.resolveRel("/etc/passwd"), "MEDIA_PATH_ABSOLUTE");
    throwsCode(() => paths.resolveRel("a\0b"), "MEDIA_PATH_INVALID");
    throwsCode(() => paths.relOf(path.join(env.dataDir, "hub-v2.sqlite")), "MEDIA_PATH_OUTSIDE");
    assert.equal(paths.resolveRel("originals/ab/x.mp4"), path.join(paths.root, "originals", "ab", "x.mp4"));
    assert.equal(isSyncedPath("C:\\Users\\x\\OneDrive\\Desktop\\v2-media", {}), true);
    assert.equal(isSyncedPath("C:\\Users\\x\\IfrimHub\\hub-data\\v2-media", {}), false);
    const st = paths.status();
    assert.equal(st.root, paths.root);
    assert.equal(typeof st.synced, "boolean");
    assert.ok(st.freeBytes === null || st.freeBytes > 0);
  } finally { await env.cleanup(); }
});

test("M09-AS-02: a junction inside the library is refused by the resolvers and by assertRegularFile", async (t) => {
  const { env, paths } = setup();
  try {
    const outside = path.join(env.dir, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.mp4"), "x");
    if (!junction(outside, path.join(paths.root, "cache", "j"), t)) return;
    throwsCode(() => paths.resolveRel("cache/j/secret.mp4"), "MEDIA_LINK_REFUSED");
    throwsCode(() => paths.relOf(path.join(paths.root, "cache", "j", "secret.mp4")), "MEDIA_LINK_REFUSED");
    throwsCode(() => assertRegularFile(path.join(paths.root, "cache", "j", "secret.mp4")), "MEDIA_LINK_REFUSED");
    throwsCode(() => assertRegularFile(path.join(env.dir, "nope.mp4")), "MEDIA_FILE_MISSING");
    throwsCode(() => assertRegularFile(outside), "MEDIA_NOT_A_FILE");
  } finally { await env.cleanup(); }
});

// ---------------------------------------------------------------- tools: argv safety

test("M09-AS-03: inputArgs/prepareArgs whitelist every input, neutralise '-' names and refuse URLs, other whitelists and file-opening filters", () => {
  assert.deepEqual(inputArgs("C:\\media\\a.mp4"), ["-protocol_whitelist", "file,pipe", "-i", "C:\\media\\a.mp4"]);
  assert.deepEqual(inputArgs("-i.mp4").slice(-1), [`.${path.sep}-i.mp4`]);
  for (const url of ["http://127.0.0.1/a.mp4", "tcp://x:1", "file:C:/a.mp4", "concat:a|b", "rtmp://x/live"]) throwsCode(() => inputArgs(url), "MEDIA_URL_REFUSED");
  const argv = prepareArgs("ffmpeg", ["-i", "a.mp4", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "out.mp4"]);
  assert.deepEqual(argv.slice(0, 2), ["-hide_banner", "-nostdin"]);
  const idx = argv.flatMap((a, i) => (a === "-i" ? [i] : []));
  assert.equal(idx.length, 2);
  for (const i of idx) assert.deepEqual(argv.slice(i - 2, i), ["-protocol_whitelist", PROTOCOL_WHITELIST]);
  // An explicit identical whitelist is kept once (not duplicated).
  assert.deepEqual(prepareArgs("ffmpeg", [...inputArgs("a.mp4"), "o.mp4"]), ["-hide_banner", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", "a.mp4", "o.mp4"]);
  assert.deepEqual(prepareArgs("ffprobe", ["-v", "error", ...inputArgs("a.mp4", { format: "mov" })]), ["-hide_banner", "-v", "error", "-f", "mov", "-protocol_whitelist", "file,pipe", "-i", "a.mp4"]);
  throwsCode(() => prepareArgs("ffmpeg", ["-protocol_whitelist", "file,http,tcp", "-i", "a.mp4", "o.mp4"]), "MEDIA_WHITELIST_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "http://x/a.mp4", "o.mp4"]), "MEDIA_URL_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "rtmp://example.invalid/live"]), "MEDIA_URL_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-f", "lavfi", "-i", "amovie=http://x/a.mp3", "o.wav"]), "MEDIA_FILTER_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "-vf", "scale=10:10,zmq", "o.mp4"]), "MEDIA_FILTER_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "-filter_complex", "movie=C\\:/x.mp4[m];[0][m]overlay", "o.mp4"]), "MEDIA_FILTER_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "-headers", "X: y", "o.mp4"]), "MEDIA_ARG_REFUSED");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", 42, "o.mp4"]), "MEDIA_ARG_REFUSED");
  throwsCode(() => prepareArgs("sh", ["-c", "x"]), "MEDIA_TOOL_UNKNOWN");
  // Generated sources stay allowed; a graph read from a file is inspected.
  assert.ok(prepareArgs("ffmpeg", ["-f", "lavfi", "-i", "testsrc2=size=64x64:rate=30", "o.mp4"]).includes("testsrc2=size=64x64:rate=30"));
  const dir = mediaTempDir("graph");
  fs.writeFileSync(path.join(dir, "graph.txt"), "[0:v]scale=64:64[v];\nmovie=x.mp4[m]");
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "-/filter_complex", "graph.txt", "o.mp4"], { cwd: dir }), "MEDIA_FILTER_REFUSED");
  fs.writeFileSync(path.join(dir, "graph.txt"), "[0:v]scale=64:64[v]");
  assert.ok(prepareArgs("ffmpeg", ["-i", "a.mp4", "-/filter_complex", "graph.txt", "o.mp4"], { cwd: dir }).includes("graph.txt"));
  throwsCode(() => prepareArgs("ffmpeg", ["-i", "a.mp4", "-/filter_complex", "missing.txt", "o.mp4"], { cwd: dir }), "MEDIA_ARG_REFUSED");
  // Progress parser: ffmpeg's out_time_ms is microseconds.
  const feed = createProgressParser();
  assert.equal(feed("frame=30"), null);
  assert.equal(feed("out_time_ms=1500000"), null);
  assert.deepEqual({ ...feed("progress=end") }, { outTimeMs: 1500, frame: 30, fps: null, speed: null, totalSize: null, done: true });
});

test("M09-AS-04: run() spawns through the supervisor with the whitelist in the logged argv, progress from -progress pipe:1, stderr collected", async () => {
  const log = path.join(mediaTempDir("log"), "argv.jsonl");
  const { env, tools } = setup({ fake: { FAKE_FFMPEG_LOG: log, FAKE_FFMPEG_MODE: "copy" } });
  try {
    const progress = [];
    const r = await tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "-c", "copy", "out.mp4"], onProgress: (p) => progress.push(p) });
    assert.equal(r.code, 0);
    assert.equal(r.timedOut, false);
    assert.equal(r.cancelled, false);
    assert.ok(progress.some((p) => p.done) && progress.some((p) => p.outTimeMs === 1000), JSON.stringify(progress));
    const crash = await tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "out.mp4"], key: "k-crash" }).catch((e) => e);
    assert.equal(crash.code, 0); // copy mode; crash covered below with its own env
    const entries = readLog(log);
    assert.ok(entries.length >= 2);
    for (const e of entries) {
      assert.equal(e.args[0], "-hide_banner");
      assert.equal(e.args[1], "-nostdin");
      e.args.forEach((a, i) => { if (a === "-i") assert.deepEqual(e.args.slice(i - 2, i), ["-protocol_whitelist", "file,pipe"], JSON.stringify(e.args)); });
      assert.equal(e.args.filter((a) => a === "file,pipe").length, e.args.filter((a) => a === "-i").length, "one whitelist per input, no stray value");
    }
    assert.ok(entries[0].args.includes("-progress") && entries[0].args.includes("pipe:1"));
    await rejectsCode(tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "out.mp4"], cwd: path.join(env.dir, "nope") }), "MEDIA_CWD_MISSING");
  } finally { await env.cleanup(); }
  const c = setup({ fake: { FAKE_FFMPEG_MODE: "diskfull" } });
  try {
    const r = await c.tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "out.mp4"] });
    assert.equal(r.code, 1);
    assert.ok(r.stderrLines.some((l) => /No space left on device/.test(l)));
  } finally { await c.env.cleanup(); }
});

test("M09-AS-05: timeout and cancel stop a hanging ffmpeg (process tree killed, flags reported)", async () => {
  const { env, tools } = setup({ fake: { FAKE_FFMPEG_MODE: "hang" } });
  try {
    const t0 = Date.now();
    const r = await tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "out.mp4"], timeoutMs: 600 });
    assert.equal(r.timedOut, true);
    assert.equal(r.cancelled, false);
    assert.ok(Date.now() - t0 < 15000);
    const pending = tools.run({ tool: "ffmpeg", args: ["-i", "in.mp4", "out.mp4"], key: "media:test:cancel", timeoutMs: 60000, onProgress: () => {} });
    await new Promise((res) => setTimeout(res, 400));
    assert.ok(tools.running().includes("media:test:cancel"));
    await rejectsCode(tools.run({ tool: "ffmpeg", args: ["-i", "a.mp4", "b.mp4"], key: "media:test:cancel" }), "MEDIA_KEY_BUSY");
    const c = await tools.cancel("media:test:cancel");
    assert.equal(c.cancelled, true);
    const done = await pending;
    assert.equal(done.cancelled, true);
    assert.equal(done.timedOut, false);
    assert.equal(tools.running().length, 0);
    assert.deepEqual(await tools.cancel("media:test:cancel"), { cancelled: false, found: false });
    assert.equal(env.supervisor.list().length, 0);
  } finally { await env.cleanup(); }
});

test("M09-AS-06: a missing tool is TOOL_MISSING for run/probe, inspect() reports it (resolve() and pin() refuse) and an import records nothing", async () => {
  const missing = { executable: process.execPath, prefixArgs: [FFMPEG_PROXY], env: { IFRIM_REAL_TOOL: "" } };
  const { env, tools, assets, put, inbox, paths } = setup({ launchers: { available: false, ffmpeg: missing, ffprobe: missing, paths: {} } });
  try {
    // M10.2: inspect() is the read-only report; resolve() (the render path) and pin() refuse a missing tool.
    const r = await tools.inspect();
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems.sort(), ["ffmpeg_missing", "ffprobe_missing"]);
    assert.deepEqual(r.states, { ffmpeg: "MISSING", ffprobe: "MISSING" });
    await rejectsCode(tools.resolve(), "TOOL_MISSING");
    await rejectsCode(tools.pin({ actor: "test" }), "TOOL_MISSING");
    assert.equal(events(env.db, "settings.changed").filter((e) => e.scope_id === "mediaToolPins").length, 0, "nothing pinned");
    assert.deepEqual(env.settings.get("mediaToolPins"), {});
    await rejectsCode(tools.run({ tool: "ffmpeg", args: ["-i", "a.mp4", "b.mp4"] }), "TOOL_MISSING");
    await rejectsCode(tools.probe(put("x.mp4", fakeMp4("m"))), "TOOL_MISSING");
    await rejectsCode(assets.ingestFile({ sourcePath: put("y.mp4", fakeMp4("n")), allowedRoots: [inbox], actor: "owner" }), "TOOL_MISSING");
    assert.equal(count(env.db, "media_assets"), 0);
    assert.equal(fs.readdirSync(path.join(paths.root, "originals"), { recursive: true }).length, 0, "the copied original is removed again");
    // A text caption needs no tool: it still imports.
    const cap = await assets.ingestFile({ sourcePath: put("sub.srt", "1\n00:00:01,000 --> 00:00:02,000\nSalut\n"), allowedRoots: [inbox], category: "caption", actor: "owner" });
    assert.equal(cap.version.status, "READY");
    assert.equal(cap.asset.kind, "caption");
  } finally { await env.cleanup(); }
});

// ---------------------------------------------------------------- probe

test("M09-AS-07: normalizeProbe handles rational fps, rotation (tag and display matrix), colour, audio, cover art and images", () => {
  assert.deepEqual(parseRational("30000/1001"), { num: 30000, den: 1001 });
  assert.deepEqual(parseRational("60/2"), { num: 30, den: 1 });
  assert.equal(parseRational("0/0"), null);
  assert.equal(parseRational("abc"), null);
  assert.equal(rotationOf({ side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] }), 90);
  assert.equal(rotationOf({ tags: { rotate: "270" } }), 270);
  assert.equal(rotationOf({ side_data_list: [{ rotation: 180 }] }), 180);
  assert.equal(rotationOf({}), 0);
  const p = normalizeProbe({
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.345", size: "1000", bit_rate: "800" },
    streams: [
      { index: 0, codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, avg_frame_rate: "0/0", r_frame_rate: "30000/1001", pix_fmt: "yuv420p10le",
        color_space: "bt2020nc", color_range: "tv", color_transfer: "arib-std-b67", side_data_list: [{ rotation: -90 }], nb_frames: "370" },
      { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 1, channel_layout: "mono" },
      { index: 2, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
    ],
  });
  assert.equal(p.durationMs, 12345);
  assert.deepEqual(p.video.fps, { num: 30000, den: 1001 });
  assert.equal(p.video.rotation, 90);
  assert.equal(p.video.displayWidth, 1080);
  assert.equal(p.video.colorSpace, "bt2020nc");
  assert.equal(p.video.colorRange, "tv");
  assert.equal(p.video.frameCount, 370);
  assert.deepEqual(p.audio, { codec: "aac", sampleRate: 44100, channels: 1, layout: "mono", durationMs: null, bitRate: null });
  assert.equal(p.hasVideo && p.hasAudio, true);
  assert.equal(p.isImage, false);
  assert.equal(p.streams[2].cover, true);
  const cover = normalizeProbe({ format: { format_name: "mp3", duration: "3" }, streams: [{ codec_type: "audio", codec_name: "mp3" }, { codec_type: "video", codec_name: "png", disposition: { attached_pic: 1 } }] });
  assert.equal(cover.hasVideo, false);
  const png = normalizeProbe({ format: { format_name: "png_pipe" }, streams: [{ codec_type: "video", codec_name: "png", width: 10, height: 10, r_frame_rate: "25/1" }] });
  assert.equal(png.isImage, true);
  assert.equal(png.durationMs, null);
  assert.deepEqual(normalizeProbe(null).streams, []);
});

test("M09-AS-08: probe() normalises the tool output and refuses streamless or failing files", async () => {
  const ok = setup({ fake: fakeVideoEnv() });
  try {
    const p = await ok.tools.probe(ok.put("a.mp4", fakeMp4("p")));
    assert.equal(p.video.width, 640);
    assert.deepEqual(p.video.fps, { num: 30, den: 1 });
    assert.equal(p.audio.sampleRate, 48000);
  } finally { await ok.env.cleanup(); }
  const empty = setup({ fake: { FAKE_FFPROBE_JSON: "{}" } });
  try { await rejectsCode(empty.tools.probe(empty.put("a.mp4", fakeMp4("q"))), "UNDECODABLE"); } finally { await empty.env.cleanup(); }
  const hang = setup({ fake: { FAKE_FFMPEG_MODE: "hang" } });
  try { await rejectsCode(hang.tools.probe(hang.put("a.mp4", fakeMp4("r")), { timeoutMs: 500 }), "TIMEOUT"); } finally { await hang.env.cleanup(); }
});

// ---------------------------------------------------------------- assets: import refusals (T05)

test("M09-AS-09: import refuses paths outside the allowed roots, junction escapes, missing/empty/oversized files, secrets and non-media", async (t) => {
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv(), maxBytes: 64 * 1024 });
  try {
    const outsideDir = path.join(env.dir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "o.mp4");
    fs.writeFileSync(outsideFile, fakeMp4("o"));
    await rejectsCode(assets.ingestFile({ sourcePath: outsideFile, allowedRoots: [inbox], actor: "owner" }), "MEDIA_OUTSIDE_ALLOWED_ROOTS");
    await rejectsCode(assets.ingestFile({ sourcePath: path.join(inbox, "..", "outside", "o.mp4"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_OUTSIDE_ALLOWED_ROOTS");
    // (review R16) A UNC / remote path outside the roots is refused textually, before any stat (no outbound SMB request).
    if (process.platform === "win32") {
      const statSpy = t.mock.method(fs, "lstatSync");
      await rejectsCode(assets.ingestFile({ sourcePath: "\\\\unreachable-host.invalid\\share\\o.mp4", allowedRoots: [inbox], actor: "owner" }), "MEDIA_OUTSIDE_ALLOWED_ROOTS");
      assert.ok(!statSpy.mock.calls.some((c) => String(c.arguments[0]).startsWith("\\\\")), "the remote path was never stat'ed");
      statSpy.mock.restore();
    }
    await rejectsCode(assets.ingestFile({ sourcePath: put("a.mp4", fakeMp4("a")), allowedRoots: [], actor: "owner" }), "MEDIA_NO_ALLOWED_ROOTS");
    await rejectsCode(assets.ingestFile({ sourcePath: "inbox/a.mp4", allowedRoots: [inbox], actor: "owner" }), "MEDIA_PATH_INVALID");
    await rejectsCode(assets.ingestFile({ sourcePath: path.join(inbox, "missing.mp4"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_FILE_MISSING");
    await rejectsCode(assets.ingestFile({ sourcePath: put("empty.mp4", Buffer.alloc(0)), allowedRoots: [inbox], actor: "owner" }), "MEDIA_EMPTY");
    await rejectsCode(assets.ingestFile({ sourcePath: put("big.mp4", fakeMp4("b", 70 * 1024)), allowedRoots: [inbox], actor: "owner" }), "FILE_TOO_LARGE");
    await rejectsCode(assets.ingestFile({ sourcePath: put("small.mp4", fakeMp4("s", 4000)), allowedRoots: [inbox], actor: "owner", maxBytes: 1000 }), "FILE_TOO_LARGE");
    await rejectsCode(assets.ingestFile({ sourcePath: put(".env", "A=1"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_SECRET_REFUSED");
    await rejectsCode(assets.ingestFile({ sourcePath: put("tool.mp4", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)])), allowedRoots: [inbox], actor: "owner" }), "MEDIA_EXECUTABLE_REFUSED");
    await rejectsCode(assets.ingestFile({ sourcePath: put("notes.mp4", "just text, not media"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_TYPE_UNKNOWN");
    await rejectsCode(assets.ingestFile({ sourcePath: put("arch.mp4", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(100)])), allowedRoots: [inbox], actor: "owner" }), "MEDIA_ARCHIVE_REFUSED");
    await rejectsCode(assets.ingestFile({ sourcePath: put("c.mp4", fakeMp4("c")), allowedRoots: [inbox] }), "ACTOR_REQUIRED");
    await rejectsCode(assets.ingestFile({ sourcePath: put("d.mp4", fakeMp4("d")), allowedRoots: [inbox], actor: "owner", origin: "STOLEN" }), "FIELD_INVALID");
    await rejectsCode(assets.ingestFile({ sourcePath: put("e.mp4", fakeMp4("e")), allowedRoots: [inbox], actor: "owner", category: "render" }), "FIELD_INVALID");
    await rejectsCode(assets.ingestFile({ sourcePath: put("f.srt", "1\n00:00:01,000 --> 00:00:02,000\nx\n"), allowedRoots: [inbox], actor: "owner", category: "raw" }), "CATEGORY_MISMATCH");
    fs.mkdirSync(path.join(inbox, "dir.mp4"));
    await rejectsCode(assets.ingestFile({ sourcePath: path.join(inbox, "dir.mp4"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_NOT_A_FILE");
    // A library file is never re-imported as a new original.
    const inLib = path.join(paths.root, "cache", "x.mp4");
    fs.writeFileSync(inLib, fakeMp4("l"));
    await rejectsCode(assets.ingestFile({ sourcePath: inLib, allowedRoots: [paths.root], actor: "owner" }), "MEDIA_ALREADY_IN_LIBRARY");
    // Protected folders below an allowed root (.git, .ifrim/private) are refused.
    fs.mkdirSync(path.join(inbox, ".git"), { recursive: true });
    await rejectsCode(assets.ingestFile({ sourcePath: (fs.writeFileSync(path.join(inbox, ".git", "v.mp4"), fakeMp4("g")), path.join(inbox, ".git", "v.mp4")), allowedRoots: [inbox], actor: "owner" }), "MEDIA_PROTECTED_REFUSED");
    assert.equal(count(env.db, "media_assets"), 0);
    // A junction below the allowed root that leads outside it is refused (real path ≠ lexical path).
    if (!junction(outsideDir, path.join(inbox, "link"), t)) return;
    await rejectsCode(assets.ingestFile({ sourcePath: path.join(inbox, "link", "o.mp4"), allowedRoots: [inbox], actor: "owner" }), "MEDIA_LINK_REFUSED");
    // Even when the junction target is itself allowed: links below a root are never followed.
    await rejectsCode(assets.ingestFile({ sourcePath: path.join(inbox, "link", "o.mp4"), allowedRoots: [inbox, outsideDir], actor: "owner" }), "MEDIA_LINK_REFUSED");
    assert.equal(count(env.db, "media_assets"), 0);
    assert.equal(fs.readdirSync(path.join(paths.root, ".incoming")).length, 0, "no temp file left behind");
  } finally { await env.cleanup(); }
});

test("M09-AS-10: hostile file names never reach an argv; storage is content-addressed, read-only, and the import is evented", async () => {
  const log = path.join(mediaTempDir("log"), "argv.jsonl");
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv({ FAKE_FFMPEG_LOG: log }) });
  try {
    const content = fakeMp4("hostile");
    const names = ["-i x -f lavfi movie=a.mp4", "--version;calc.exe", "http___127.0.0.1_9_a"];
    const out = [];
    for (const [i, n] of names.entries()) out.push(await assets.ingestFile({ sourcePath: put(`${n}.mp4`, i === 0 ? content : fakeMp4(`hostile${i}`)), allowedRoots: [inbox], actor: "owner", tags: ["demo", "demo", "ro"] }));
    const first = out[0];
    assert.equal(first.version.status, "READY");
    assert.equal(first.version.sha256, sha(content));
    assert.equal(first.version.relPath, `originals/${sha(content).slice(0, 2)}/${sha(content)}.mp4`);
    assert.equal(first.asset.title, names[0]); // display title only
    assert.deepEqual(first.asset.tags, ["demo", "ro"]);
    assert.equal(first.asset.kind, "video");
    assert.equal(first.version.mime, "video/mp4");
    assert.equal(first.version.probe.video.width, 640);
    assert.equal(first.duplicateOf, null);
    const abs = paths.resolveRel(first.version.relPath);
    assert.deepEqual(fs.readFileSync(abs), content);
    assert.throws(() => fs.writeFileSync(abs, "overwrite"), /EPERM|EACCES/);
    for (const entry of readLog(log)) {
      const joined = entry.args.join(" ");
      for (const n of names) assert.ok(!joined.includes(n), `argv must not contain the source name: ${joined}`);
      entry.args.forEach((a, i) => { if (a === "-i") { assert.deepEqual(entry.args.slice(i - 2, i), ["-protocol_whitelist", "file,pipe"]); assert.ok(path.isAbsolute(entry.args[i + 1])); } });
      assert.equal(entry.args.filter((a) => a === "file,pipe").length, entry.args.filter((a) => a === "-i").length, "one whitelist per input, no stray value");
    }
    const ev = events(env.db, "media.asset.imported");
    assert.equal(ev.length, 3);
    const payload = JSON.parse(ev[0].payload_json);
    assert.equal(payload.sha256, sha(content));
    assert.ok(!JSON.stringify(payload).includes(inbox), "no absolute source path in events");
    assert.equal(assets.versionPath(first.version.id), abs);
  } finally { await env.cleanup(); }
});

test("M09-AS-11: an undecodable file is stored QUARANTINED (never READY) and versionPath refuses it", async () => {
  const { env, assets, put, inbox, rights } = setup({ fake: { FAKE_FFMPEG_MODE: "crash" } });
  try {
    const r = await assets.ingestFile({ sourcePath: put("broken.mp4", fakeMp4("broken")), allowedRoots: [inbox], actor: "owner", origin: "OWNED" });
    assert.equal(r.version.status, "QUARANTINED");
    assert.equal(r.version.probe.error, "UNDECODABLE");
    assert.equal(events(env.db, "media.asset.quarantined").length, 1);
    throwsCode(() => assets.versionPath(r.version.id), "MEDIA_QUARANTINED");
    rights.record({ assetId: r.asset.id, platforms: ["*"], uses: ["*"], actor: "owner" });
    const ev = rights.evaluate({ assetId: r.asset.id, platform: "youtube" });
    assert.equal(ev.allowed, false);
    assert.equal(ev.status, "QUARANTINED");
  } finally { await env.cleanup(); }
});

test("M09-AS-12: the same bytes imported twice reuse the file with a NEW asset row and duplicateOf", async () => {
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv() });
  try {
    const content = fakeMp4("dup");
    const a = await assets.ingestFile({ sourcePath: put("one.mp4", content), allowedRoots: [inbox], actor: "owner", origin: "OWNED", title: "Prima" });
    const b = await assets.ingestFile({ sourcePath: put("two.mov", content), allowedRoots: [inbox], actor: "owner", origin: "CLIENT_PROVIDED", title: "A doua" });
    assert.notEqual(a.asset.id, b.asset.id);
    assert.equal(b.duplicateOf, a.asset.id);
    assert.equal(b.version.relPath, a.version.relPath);
    assert.equal(b.asset.origin, "CLIENT_PROVIDED");
    assert.equal(fs.readdirSync(path.dirname(paths.resolveRel(a.version.relPath))).length, 1);
    const q = assets.quota();
    assert.equal(q.usedBytes, content.length, "a shared file counts once");
    assert.equal(assets.get(a.asset.id).versions.length, 1);
  } finally { await env.cleanup(); }
});

test("M09-AS-13: derivatives record their inputs; search covers metadata, transcript segments and capture markers with intervals", async () => {
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv() });
  try {
    const src = await assets.ingestFile({ sourcePath: put("demo.mp4", fakeMp4("demo")), allowedRoots: [inbox], actor: "owner", origin: "OWNED",
      captureLabel: "ORIGINAL_RECORDING", title: "Demonstrație Hub", tags: ["fabrică"], description: "Înregistrare ecran cu pipeline-ul" });
    const music = await assets.ingestFile({ sourcePath: put("music.mp4", fakeMp4("music")), allowedRoots: [inbox], actor: "owner", origin: "LICENSED", captureLabel: "SIMULATION", category: "music" });
    const job = paths.jobDir("mrj_test_1");
    fs.mkdirSync(job, { recursive: true });
    fs.writeFileSync(path.join(job, "out.mp4"), fakeMp4("render"));
    const d = await assets.registerDerivative({ inputVersionIds: [src.version.id, music.version.id], op: "render.final", params: { profile: "final" },
      absPath: path.join(job, "out.mp4"), category: "render", kind: "video", actor: "render-queue" });
    assert.equal(d.version.isOriginal, false);
    assert.deepEqual(d.version.derivedFrom.map((x) => x.versionId), [src.version.id, music.version.id]);
    assert.equal(d.version.derivedFrom[0].op, "render.final");
    assert.equal(d.asset.origin, "LICENSED", "the most restrictive input origin");
    assert.equal(d.asset.captureLabel, "SIMULATION", "an artificial input label is never lost");
    assert.match(d.version.relPath, /^derivatives\/render\/[0-9a-f]{64}\.mp4$/);
    // In-library render output registered in place; originals can never be registered as derivatives.
    const renderAbs = paths.renderPath("mrj_test_2", "mp4");
    fs.writeFileSync(renderAbs, fakeMp4("render2"));
    const d2 = await assets.registerDerivative({ inputVersionIds: [d.version.id], op: "render.draft", absPath: renderAbs, category: "render", kind: "video", actor: "rq" });
    assert.equal(d2.version.relPath, "renders/mrj_test_2.mp4");
    await rejectsCode(assets.registerDerivative({ inputVersionIds: [d.version.id], op: "x", absPath: renderAbs, category: "render", kind: "video", actor: "rq" }), "DERIVATIVE_DUPLICATE");
    await rejectsCode(assets.registerDerivative({ inputVersionIds: [src.version.id], op: "x", absPath: paths.resolveRel(src.version.relPath), category: "render", kind: "video", actor: "rq" }), "ORIGINAL_IMMUTABLE");
    await rejectsCode(assets.registerDerivative({ inputVersionIds: ["mav_nope"], op: "x", absPath: renderAbs, category: "render", kind: "video", actor: "rq" }), "DERIVATIVE_INPUT_MISSING");
    await rejectsCode(assets.registerDerivative({ inputVersionIds: [src.version.id], op: "x", absPath: put("free.mp4", fakeMp4("free")), category: "render", kind: "video", actor: "rq" }), "MEDIA_PATH_OUTSIDE");
    // Metadata update never touches the file; immutable fields are refused.
    throwsCode(() => assets.updateMetadata(src.asset.id, { relPath: "x" }, "owner"), "ORIGINAL_IMMUTABLE");
    const upd = assets.updateMetadata(src.asset.id, { tags: ["fabrică", "lansare"] }, "owner");
    assert.deepEqual(upd.tags, ["fabrică", "lansare"]);
    assert.equal(upd.current.relPath, src.version.relPath);
    throwsCode(() => assets.updateMetadata(src.asset.id, { title: "x" }, "owner", { expectedVersion: 1 }), "STALE_VERSION");

    const at = new Date().toISOString();
    env.db.prepare(`INSERT INTO media_transcripts (id, asset_version_id, requested_by, channel, input_sha256, input_bytes, format, language, engine, status, text, segments_json, created_at)
      VALUES ('mtr_1', ?, 'owner', 'ui', ?, 10, 'mp4', 'ro', 'whisper.cpp', 'final', 'x', ?, ?)`).run(src.version.id, src.version.sha256,
      JSON.stringify([{ fromMs: 0, toMs: 1800, text: "Bun venit în Hub" }, { offsets: { from: 4200, to: 6900 }, text: "Aici pornește fabrica de software" }, { start: 8, end: 9.5, text: "Fabrica livrează" }]), at);
    env.db.prepare(`INSERT INTO media_transcripts (id, asset_version_id, requested_by, channel, input_sha256, input_bytes, format, language, engine, status, text, segments_json, created_at)
      VALUES ('mtr_2', ?, 'owner', 'ui', ?, 10, 'mp4', 'ro', 'whisper.cpp', 'failed', 'x', ?, ?)`).run(src.version.id, src.version.sha256, JSON.stringify([{ fromMs: 0, toMs: 1, text: "fabrica eșuată" }]), at);
    env.db.prepare(`INSERT INTO media_capture_sessions (id, kind, status, markers_json, output_asset_id, created_by, created_at, updated_at)
      VALUES ('mcs_1', 'browser_demo', 'STOPPED', ?, ?, 'owner', ?, ?)`).run(JSON.stringify([{ kind: "hook", atMs: 0, note: "deschidere" }, { kind: "demo", atMs: 1500, note: "Fabrica pornește" }]), src.asset.id, at, at);
    const hits = assets.search({ q: "FABRICA" });
    const bySource = (s) => hits.filter((h) => h.source === s);
    assert.ok(bySource("metadata").some((h) => h.assetId === src.asset.id), "tag „fabrică” matches without diacritics");
    assert.deepEqual(bySource("transcript").map((h) => [h.fromMs, h.toMs]), [[4200, 6900], [8000, 9500]]);
    assert.ok(bySource("transcript").every((h) => h.versionId === src.version.id));
    assert.deepEqual(bySource("marker").map((h) => [h.fromMs, h.toMs]), [[1500, 2000]]); // to the end of the 2 s recording
    throwsCode(() => assets.search({ q: "a" }), "SEARCH_QUERY_INVALID");
    assert.equal(assets.list({ q: "demonstratie" }).length, 1);
    assert.equal(assets.list({ category: "render" }).length, 2);
  } finally { await env.cleanup(); }
});

test("M09-AS-14: quota refuses an import over the library quota; cleanup is a dry run by default and never touches originals or referenced versions", async () => {
  let now = new Date("2026-10-03T10:00:00Z");
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv(), clock: () => now });
  try {
    const orig = await assets.ingestFile({ sourcePath: put("o.mp4", fakeMp4("orig")), allowedRoots: [inbox], actor: "owner", origin: "OWNED" });
    const job = paths.jobDir("mrj_px");
    fs.mkdirSync(job, { recursive: true });
    const mk = async (seed, category = "proxy") => { fs.writeFileSync(path.join(job, `${seed}.mp4`), fakeMp4(seed)); return assets.registerDerivative({ inputVersionIds: [orig.version.id], op: "proxy", absPath: path.join(job, `${seed}.mp4`), category, kind: "video", actor: "rq" }); };
    const p1 = await mk("proxy1");
    const p2 = await mk("proxy2");
    const r1 = await mk("render1", "render");
    env.db.prepare("INSERT INTO media_edit_projects (id, title, created_by, created_at, updated_at) VALUES ('mep_1', 'E', 'o', ?, ?)").run(now.toISOString(), now.toISOString());
    env.db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES ('mev_1', 'mep_1', 1, ?, 'x', 'initial', 'o', ?)")
      .run(JSON.stringify({ tracks: [{ clips: [{ assetVersionId: p2.version.id }] }] }), now.toISOString());
    now = new Date("2026-11-20T10:00:00Z");
    const dry = assets.cleanupDerivatives({ olderThanDays: 30 });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.candidates.map((c) => c.versionId), [p1.version.id]);
    assert.ok(dry.skipped.some((s) => s.versionId === p2.version.id && s.reason === "referenced_by_edit"));
    assert.ok(fs.existsSync(paths.resolveRel(p1.version.relPath)), "dry run deletes nothing");
    throwsCode(() => assets.cleanupDerivatives({ olderThanDays: 30, dryRun: false }), "ACTOR_REQUIRED");
    const real = assets.cleanupDerivatives({ olderThanDays: 30, dryRun: false, actor: "owner" });
    assert.deepEqual(real.removed.map((c) => c.versionId), [p1.version.id]);
    assert.equal(fs.existsSync(paths.resolveRel(p1.version.relPath)), false);
    assert.equal(assets.getVersion(p1.version.id).status, "REMOVED_DERIVATIVE");
    for (const v of [orig, p2, r1]) { assert.equal(assets.getVersion(v.version.id).status, "READY"); assert.ok(fs.existsSync(paths.resolveRel(v.version.relPath))); }
    assert.equal(events(env.db, "media.asset.derivative_removed").length, 1);
    // Quota: a 0 GiB library quota refuses the next import (nothing copied).
    const q = assets.quota();
    assert.equal(q.ok, true);
    assert.ok(q.usedBytes > 0 && q.quotaBytes === 40 * 1024 ** 3);
    setPolicy(env, { libraryQuotaGb: 0 });
    assert.ok(assets.quota().warnings.includes("quota_exceeded"));
    await rejectsCode(assets.ingestFile({ sourcePath: put("n.mp4", fakeMp4("new")), allowedRoots: [inbox], actor: "owner" }), "MEDIA_QUOTA");
    setPolicy(env, { libraryQuotaGb: 40, diskReserveGb: 1e9 });
    await rejectsCode(assets.ingestFile({ sourcePath: put("n2.mp4", fakeMp4("new2")), allowedRoots: [inbox], actor: "owner" }), "DISK_RESERVE");
    assert.equal(count(env.db, "media_assets"), 4);
  } finally { await env.cleanup(); }
});

test("M09-AS-15: a missing library file is marked MISSING with an event and refused", async () => {
  const { env, assets, put, inbox, paths } = setup({ fake: fakeVideoEnv() });
  try {
    const r = await assets.ingestFile({ sourcePath: put("m.mp4", fakeMp4("missing")), allowedRoots: [inbox], actor: "owner" });
    const abs = paths.resolveRel(r.version.relPath);
    fs.chmodSync(abs, 0o666);
    fs.unlinkSync(abs);
    throwsCode(() => assets.versionPath(r.version.id), "MEDIA_FILE_MISSING");
    assert.equal(assets.getVersion(r.version.id).status, "MISSING");
    assert.equal(events(env.db, "media.asset.missing").length, 1);
  } finally { await env.cleanup(); }
});

test("M09-AS-16: sniffMagic identifies media by content, never by name", () => {
  const cases = [
    [MP4_HEAD, "video", "mp4"],
    [Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(8)]), "video", "mov"],
    [Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypM4A "), Buffer.alloc(8)]), "audio", "m4a"],
    [Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")]), "audio", "wav"],
    [Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....webm")]), "video", "webm"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "image", "png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image", "jpg"],
    [Buffer.from("ID3\u0004\u0000xxxx"), "audio", "mp3"],
    [Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nx"), "caption", "vtt"],
    [Buffer.from([0, 1, 0, 0, 0, 0x10]), "font", "ttf"],
  ];
  for (const [buf, kind, ext] of cases) { const s = sniffMagic(buf); assert.equal(s?.kind, kind, ext); assert.equal(s.ext, ext); }
  assert.equal(sniffMagic(Buffer.from("MZ\u0090\u0000")).refused, "EXECUTABLE");
  assert.equal(sniffMagic(Buffer.from("#!/bin/sh\nrm -rf /")).refused, "SCRIPT");
  assert.equal(sniffMagic(Buffer.from("%PDF-1.7")).refused, "DOCUMENT");
  assert.equal(sniffMagic(Buffer.from("hello world")), null);
});

// ---------------------------------------------------------------- rights (T06)

async function rightsFixture(extraFake = {}) {
  const s = setup({ fake: fakeVideoEnv(extraFake) });
  const mk = (seed, opts = {}) => s.assets.ingestFile({ sourcePath: s.put(`${seed}.mp4`, fakeMp4(seed)), allowedRoots: [s.inbox], actor: "owner", ...opts });
  const job = s.paths.jobDir("mrj_rights");
  fs.mkdirSync(job, { recursive: true });
  let n = 0;
  const derive = (inputs, category = "render") => { n += 1; const f = path.join(job, `d${n}.mp4`); fs.writeFileSync(f, fakeMp4(`deriv${n}${Math.random()}`)); return s.assets.registerDerivative({ inputVersionIds: inputs.map((x) => x.version.id), op: "render.final", absPath: f, category, kind: "video", actor: "rq" }); };
  return { ...s, mk, derive };
}

test("M09-AS-17: UNKNOWN origin is never allowed for a public export, even with a right on file; internal drafts only warn", async () => {
  const { env, rights, mk } = await rightsFixture();
  try {
    const a = await mk("unknown");
    rights.record({ assetId: a.asset.id, platforms: ["*"], uses: ["*"], actor: "owner" });
    const pub = rights.evaluate({ assetId: a.asset.id, platform: "youtube" });
    assert.equal(pub.allowed, false);
    assert.equal(pub.status, "ORIGIN_UNKNOWN");
    assert.equal(pub.reasons[0].code, "ORIGIN_UNKNOWN");
    const internal = rights.evaluate({ assetId: a.asset.id, use: "internal" });
    assert.equal(internal.allowed, true);
    assert.equal(internal.warnings[0].code, "ORIGIN_UNKNOWN");
    const none = await mk("owned-no-rights", { origin: "OWNED" });
    const r = rights.evaluate({ assetId: none.asset.id, platform: "youtube" });
    assert.equal(r.allowed, false);
    assert.equal(r.status, "MISSING");
    assert.equal(rights.evaluate({ assetId: "mas_nope", platform: "x" }).allowed, false);
    throwsCode(() => rights.evaluate({ assetId: none.asset.id, platform: "myspace" }), "FIELD_INVALID");
  } finally { await env.cleanup(); }
});

test("M09-AS-18: platform, use and time window scope a cleared right; RESTRICTED denies; LICENSED needs a licence reference", async () => {
  const { env, rights, mk } = await rightsFixture();
  try {
    const a = await mk("licensed", { origin: "LICENSED" });
    throwsCode(() => rights.record({ assetId: a.asset.id, platforms: ["youtube"], uses: ["organic"], actor: "owner" }), "RIGHTS_EVIDENCE_REQUIRED");
    throwsCode(() => rights.record({ assetId: a.asset.id, licenseRef: "L-1", actor: "owner" }), "RIGHTS_SCOPE_REQUIRED");
    throwsCode(() => rights.record({ assetId: a.asset.id, licenseRef: "L-1", platforms: ["youtube"], uses: ["organic"], startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", actor: "owner" }), "FIELD_INVALID");
    throwsCode(() => rights.record({ assetId: a.asset.id, status: "REVOKED", actor: "owner" }), "FIELD_INVALID");
    rights.record({ assetId: a.asset.id, licenseRef: "L-1", platforms: ["youtube", "linkedin"], uses: ["organic"], startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z", actor: "owner" });
    const at = "2026-11-01T12:00:00Z";
    assert.equal(rights.evaluate({ assetId: a.asset.id, platform: "youtube", at }).allowed, true);
    assert.equal(rights.evaluate({ assetId: a.asset.id, platform: "tiktok", at }).reasons[0].code, "PLATFORM_NOT_COVERED");
    assert.equal(rights.evaluate({ assetId: a.asset.id, platform: "youtube", use: "paid", at }).reasons[0].code, "USE_NOT_COVERED");
    assert.equal(rights.evaluate({ assetId: a.asset.id, platform: "youtube", at: "2026-09-01T00:00:00Z" }).reasons[0].code, "NOT_YET_VALID");
    const late = rights.evaluate({ assetId: a.asset.id, platform: "youtube", at: "2027-01-05T00:00:00Z" });
    assert.equal(late.status, "EXPIRED");
    const b = await mk("owned-star", { origin: "OWNED" });
    rights.record({ assetId: b.asset.id, platforms: ["*"], uses: ["organic", "paid"], actor: "owner" });
    assert.equal(rights.evaluate({ assetId: b.asset.id, platform: "tiktok", use: "paid" }).allowed, true);
    rights.record({ assetId: b.asset.id, status: "RESTRICTED", platforms: ["tiktok"], actor: "owner", restrictions: ["fără TikTok"] });
    assert.equal(rights.evaluate({ assetId: b.asset.id, platform: "tiktok" }).status, "RESTRICTED");
    assert.equal(rights.evaluate({ assetId: b.asset.id, platform: "youtube" }).allowed, true);
    assert.equal(rights.current(b.asset.id).active.length, 2);
  } finally { await env.cleanup(); }
});

test("M09-AS-19: revoked and expired rights propagate through derivatives of derivatives", async () => {
  const { env, rights, mk, derive } = await rightsFixture();
  try {
    const owned = await mk("o1", { origin: "OWNED" });
    const music = await mk("m1", { origin: "LICENSED", category: "music" });
    const ownedRight = rights.record({ assetId: owned.asset.id, platforms: ["*"], uses: ["*"], actor: "owner" });
    const musicRight = rights.record({ assetId: music.asset.id, licenseRef: "MUS-7", platforms: ["*"], uses: ["organic"], endsAt: "2026-12-01T00:00:00Z", actor: "owner" });
    const render = await derive([owned, music]);
    const variant = await derive([render], "export");
    const at = "2026-11-01T00:00:00Z";
    assert.equal(rights.evaluate({ assetId: variant.asset.id, platform: "instagram", at }).allowed, true);
    const expired = rights.evaluate({ assetId: variant.asset.id, platform: "instagram", at: "2026-12-02T00:00:00Z" });
    assert.equal(expired.allowed, false);
    assert.equal(expired.status, "EXPIRED");
    assert.equal(expired.reasons[0].assetId, music.asset.id);
    assert.deepEqual(expired.originals.sort(), [owned.asset.id, music.asset.id].sort());
    const rv = rights.revoke(ownedRight.id, "Clientul a retras acordul", "owner");
    assert.equal(rv.right.status, "REVOKED");
    assert.equal(rights.revoke(ownedRight.id, "", "owner").alreadyRevoked, true);
    for (const id of [render.asset.id, variant.asset.id]) {
      const r = rights.evaluate({ assetId: id, platform: "instagram", at });
      assert.equal(r.allowed, false, id);
      assert.ok(r.reasons.some((x) => x.code === "RIGHTS_REVOKED" && x.assetId === owned.asset.id), JSON.stringify(r.reasons));
    }
    // Internal use of a revoked source is blocked too (the newest right is a revocation).
    assert.equal(rights.evaluate({ assetId: variant.asset.id, use: "internal" }).allowed, false);
    const agg = rights.evaluateAssets({ versionIds: [owned.version.id, music.version.id], platform: "instagram", at });
    assert.equal(agg.allowed, false);
    assert.deepEqual(agg.blocking.map((b) => b.versionId), [owned.version.id]);
    assert.equal(events(env.db, "media.rights.revoked").length, 1);
    assert.ok(musicRight.id);
  } finally { await env.cleanup(); }
});

test("M09-AS-20: client material and case studies need marketing consent (with evidence); AI_GENERATED requires disclosure", async () => {
  const { env, rights, mk, derive } = await rightsFixture();
  try {
    const client = await mk("client", { origin: "CLIENT_PROVIDED" });
    rights.record({ assetId: client.asset.id, platforms: ["*"], uses: ["*"], actor: "owner" });
    assert.equal(rights.evaluate({ assetId: client.asset.id, platform: "linkedin" }).status, "CONSENT_MISSING");
    assert.equal(rights.evaluate({ assetId: client.asset.id, platform: "linkedin", use: "case_study" }).reasons[0].code, "MARKETING_CONSENT_MISSING");
    assert.equal(rights.evaluate({ assetId: client.asset.id, use: "internal" }).allowed, true);
    throwsCode(() => rights.record({ assetId: client.asset.id, platforms: ["linkedin"], uses: ["case_study"], marketingConsent: true, actor: "owner" }), "RIGHTS_EVIDENCE_REQUIRED");
    rights.record({ assetId: client.asset.id, platforms: ["linkedin"], uses: ["case_study"], marketingConsent: true, documentRef: "contract-2026-14 §7", actor: "owner" });
    assert.equal(rights.evaluate({ assetId: client.asset.id, platform: "linkedin", use: "case_study" }).allowed, true);
    assert.equal(rights.evaluate({ assetId: client.asset.id, platform: "youtube", use: "case_study" }).allowed, false);
    // A case study made of OWNED material still needs the consent of the client it presents.
    const owned = await mk("owned-cs", { origin: "OWNED" });
    rights.record({ assetId: owned.asset.id, platforms: ["*"], uses: ["*"], actor: "owner" });
    assert.equal(rights.evaluate({ assetId: owned.asset.id, platform: "linkedin", use: "case_study" }).status, "CONSENT_MISSING");
    assert.equal(rights.evaluate({ assetId: owned.asset.id, platform: "linkedin" }).allowed, true);
    const ai = await mk("ai", { origin: "AI_GENERATED" });
    assert.equal(ai.asset.captureLabel, "GENERATED");
    rights.record({ assetId: ai.asset.id, platforms: ["*"], uses: ["organic"], actor: "owner" });
    const ev = rights.evaluate({ assetId: ai.asset.id, platform: "youtube" });
    assert.equal(ev.allowed, true);
    assert.equal(ev.requiresDisclosure, true);
    const mixed = await derive([owned, ai]);
    assert.equal(rights.evaluate({ assetId: mixed.asset.id, platform: "youtube" }).requiresDisclosure, true, "disclosure is inherited");
    assert.equal(rights.evaluate({ assetId: owned.asset.id, platform: "youtube" }).requiresDisclosure, false);
  } finally { await env.cleanup(); }
});

test("M09-AS-21: revocationImpact inventories derivatives, edits, variants, renders, manifests and release attempts — and deletes nothing", async () => {
  const { env, rights, mk, derive, paths } = await rightsFixture();
  try {
    const src = await mk("impact", { origin: "CLIENT_PROVIDED" });
    const other = await mk("unrelated", { origin: "OWNED" });
    const right = rights.record({ assetId: src.asset.id, platforms: ["*"], uses: ["*"], marketingConsent: true, sourceRef: "email 2026-10-01", actor: "owner" });
    const render = await derive([src]);
    const t = new Date().toISOString();
    const db = env.db;
    db.prepare("INSERT INTO content_projects (id, title, created_by, created_at, updated_at) VALUES ('cpr_1', 'Studiu de caz', 'owner', ?, ?)").run(t, t);
    db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, created_by, created_at, updated_at) VALUES ('mep_1', 'cpr_1', 'Montaj', 'owner', ?, ?)").run(t, t);
    db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES ('mev_1', 'mep_1', 1, ?, 'h', 'initial', 'owner', ?)")
      .run(JSON.stringify({ tracks: [{ id: "v1", kind: "video", clips: [{ assetVersionId: src.version.id }] }] }), t);
    db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES ('mev_2', 'mep_1', 2, ?, 'h2', 'patch', 'owner', ?)")
      .run(JSON.stringify({ tracks: [{ id: "v1", kind: "video", clips: [{ assetVersionId: other.version.id }] }] }), t);
    db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, status, created_by, created_at, updated_at) VALUES ('mva_1', 'mep_1', 'mev_1', 'reels_9x16', 'READY', 'owner', ?, ?)").run(t, t);
    db.prepare("INSERT INTO media_render_jobs (id, edit_version_id, profile, idempotency_key, status, output_asset_version_id, created_by, created_at, updated_at) VALUES ('mrj_1', 'mev_1', 'final', 'k1', 'DONE', ?, 'owner', ?, ?)").run(render.version.id, t, t);
    db.prepare("INSERT INTO media_render_jobs (id, edit_version_id, profile, idempotency_key, status, created_by, created_at, updated_at) VALUES ('mrj_2', 'mev_1', 'draft', 'k2', 'RUNNING', 'owner', ?, ?)").run(t, t);
    db.prepare("INSERT INTO content_manifests (id, content_project_id, status, body_json, manifest_sha256, created_by, created_at, updated_at) VALUES ('cmf_1', 'cpr_1', 'APPROVED', ?, 's', 'owner', ?, ?)")
      .run(JSON.stringify({ variants: [{ variantId: "mva_1", platform: "instagram" }] }), t, t);
    db.prepare("INSERT INTO content_release_attempts (id, manifest_id, platform, route, idempotency_key, status, created_by, created_at, updated_at) VALUES ('cra_1', 'cmf_1', 'instagram', 'manual_pack', 'cmf_1:instagram:pack', 'PUBLISHED', 'owner', ?, ?)").run(t, t);
    db.prepare("INSERT INTO content_release_attempts (id, manifest_id, platform, route, idempotency_key, status, created_by, created_at, updated_at) VALUES ('cra_2', 'cmf_1', 'tiktok', 'manual_pack', 'cmf_1:tiktok:pack', 'PACK_READY', 'owner', ?, ?)").run(t, t);
    const tables = ["media_assets", "media_asset_versions", "media_edit_versions", "media_variants", "media_render_jobs", "content_manifests", "content_release_attempts", "media_rights"];
    const before = Object.fromEntries(tables.map((x) => [x, count(db, x)]));
    const statusBefore = db.prepare("SELECT id, status FROM content_release_attempts ORDER BY id").all();
    const { impact } = rights.revoke(right.id, "Acord retras", "owner");
    assert.equal(impact.deletesNothing, true);
    assert.deepEqual(impact.affected.derivatives.map((d) => d.versionId), [render.version.id]);
    assert.deepEqual(impact.affected.editVersions.map((e) => e.editVersionId), ["mev_1"]);
    assert.deepEqual(impact.affected.variants.map((v) => v.variantId), ["mva_1"]);
    assert.deepEqual(impact.affected.renderJobs.map((j) => j.jobId).sort(), ["mrj_1", "mrj_2"]);
    assert.deepEqual(impact.affected.manifests.map((m) => m.manifestId), ["cmf_1"]);
    assert.deepEqual(impact.affected.releaseAttempts.map((a) => a.attemptId).sort(), ["cra_1", "cra_2"]);
    const actions = impact.plan.map((p) => `${p.action}:${p.target}`);
    for (const a of [`replace_or_rerender:${render.version.id}`, "replace_clip:mev_1", "cancel_render:mrj_2", "invalidate_variant:mva_1", "invalidate_manifest:cmf_1", "take_down_manual:cra_1", "discard_pack:cra_2"]) assert.ok(actions.includes(a), a);
    assert.ok(!actions.includes("cancel_render:mrj_1"), "a finished render is not cancelled");
    assert.deepEqual(Object.fromEntries(tables.map((x) => [x, count(db, x)])), before);
    assert.deepEqual(db.prepare("SELECT id, status FROM content_release_attempts ORDER BY id").all(), statusBefore);
    assert.equal(db.prepare("SELECT status FROM content_manifests WHERE id = 'cmf_1'").get().status, "APPROVED");
    assert.ok(fs.existsSync(paths.resolveRel(render.version.relPath)));
    assert.equal(rights.revocationImpact(other.asset.id).counts.editVersions, 1); // mev_2 only
  } finally { await env.cleanup(); }
});

// ---------------------------------------------------------------- real tools (SKIPPED_ENV when absent)

function realSetup(t) {
  const launchers = realLaunchers();
  if (!launchers.available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found on PATH"); return null; }
  return setup({ launchers });
}

test("M09-AS-R1: inspect() reads the real version without writing; pin() pins version + sha256 once; a changed binary is reported until acknowledged", async (t) => {
  const s = realSetup(t);
  if (!s) return;
  const { env, tools } = s;
  try {
    // M10.2: reading never pins; the pin is the explicit act.
    const seen = await tools.inspect();
    assert.deepEqual(seen.states, { ffmpeg: "UNPINNED", ffprobe: "UNPINNED" });
    assert.deepEqual(seen.problems, ["tools_not_pinned"]);
    assert.equal(events(env.db, "media.tool.pinned").length, 0, "inspect() writes nothing");
    await rejectsCode(tools.resolve(), "TOOLS_NOT_PINNED");
    assert.deepEqual((await tools.pin({ actor: "owner" })).pinned, ["ffmpeg", "ffprobe"]);
    const r = await tools.resolve();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.problems, []);
    assert.match(r.ffmpeg.version, /^\S+$/);
    assert.match(r.ffmpeg.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.ffmpeg.path, realTool("ffmpeg"));
    const pins = env.settings.get("mediaToolPins");
    assert.equal(pins.ffmpeg.sha256, r.ffmpeg.sha256);
    assert.equal(pins.ffprobe.version, r.ffprobe.version);
    assert.equal(events(env.db, "media.tool.pinned").length, 2);
    assert.deepEqual((await tools.pin({ actor: "owner" })).pinned, [], "pinning again writes nothing");
    assert.deepEqual((await tools.resolve()).problems, []);
    assert.equal(events(env.db, "media.tool.pinned").length, 2, "pinned once");
    // Simulate a different binary pinned earlier: the change is reported (never silently re-trusted), recorded by a pin, and
    // stays a refusal for renders until the owner acknowledges it.
    env.bus.transaction(() => env.settings.set("mediaToolPins", { ...pins, ffmpeg: { ...pins.ffmpeg, sha256: "0".repeat(64), version: "7.0" } }, "test"));
    assert.deepEqual((await tools.inspect()).problems, ["tool_changed"]);
    assert.equal(events(env.db, "media.tool.changed").length, 0, "a read records nothing");
    await rejectsCode(tools.resolve(), "TOOL_CHANGED");
    assert.deepEqual((await tools.pin({ actor: "owner" })).changed, ["ffmpeg"], "a pin records the change, unacknowledged");
    assert.equal(events(env.db, "media.tool.changed").length, 1);
    assert.equal(env.settings.get("mediaToolPins").ffmpeg.previous.sha256, "0".repeat(64));
    assert.deepEqual((await tools.inspect()).problems, ["tool_changed"], "sticky until acknowledged");
    await rejectsCode(tools.resolve(), "TOOL_CHANGED");
    assert.equal((await tools.acknowledgeChange("ffmpeg", "owner")).acknowledged, true);
    assert.deepEqual((await tools.resolve()).problems, []);
  } finally { await env.cleanup(); }
});

test("M09-AS-R2: production mode finds the tools on PATH (where.exe), never a .cmd shim, and pins them", async (t) => {
  if (!realTool("ffmpeg") || !realTool("ffprobe")) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found on PATH"); return; }
  const env = makeMediaEnv({ launchers: fakeLaunchers() });
  try {
    // Production config (no launcher, not test mode): the binaries come from the PATH lookup. Only `-version` runs.
    const config = { ...env.config, testMode: false, mediaTools: { ffmpeg: null, ffprobe: null, launcher: null } };
    const supervisor = createSupervisor({ config });
    const tools = createMediaTools({ config, supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
    const r = (await tools.pin({ actor: "owner" })).tools; // M10.2: pinning is the explicit act
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.ffmpeg.path.toLowerCase(), realTool("ffmpeg").toLowerCase());
    assert.ok(!/\.(cmd|bat)$/i.test(r.ffmpeg.path));
    assert.match(env.settings.get("mediaToolPins").ffprobe.sha256, /^[0-9a-f]{64}$/);
  } finally { await env.cleanup(); }
});

test("M09-AS-R3: real ingest of synthetic video, audio and image: READY with normalised probe", async (t) => {
  const s = realSetup(t);
  if (!s) return;
  const { env, assets, inbox, paths } = s;
  try {
    const video = makeSyntheticMedia(inbox, { name: "v.mp4", seconds: 1, width: 320, height: 180, fps: 30 });
    const audio = makeSyntheticMedia(inbox, { name: "a.wav", seconds: 1, kind: "audio" });
    const image = makeSyntheticMedia(inbox, { name: "i.png", kind: "image", width: 64, height: 48 });
    const v = await assets.ingestFile({ sourcePath: video, allowedRoots: [inbox], actor: "owner", origin: "OWNED", category: "screen_recording", captureLabel: "SIMULATION" });
    assert.equal(v.version.status, "READY");
    assert.equal(v.asset.kind, "video");
    assert.equal(v.version.probe.video.width, 320);
    assert.equal(v.version.probe.video.height, 180);
    assert.deepEqual(v.version.probe.video.fps, { num: 30, den: 1 });
    assert.equal(v.version.probe.audio.codec, "aac");
    assert.equal(v.version.probe.audio.sampleRate, 48000);
    assert.ok(Math.abs(v.version.probe.durationMs - 1000) <= 100, String(v.version.probe.durationMs));
    const reference = probeJson(paths.resolveRel(v.version.relPath));
    assert.equal(reference.streams.find((x) => x.codec_type === "video").width, 320);
    const a = await assets.ingestFile({ sourcePath: audio, allowedRoots: [inbox], actor: "owner", category: "voice" });
    assert.equal(a.asset.kind, "audio");
    assert.equal(a.version.probe.hasVideo, false);
    assert.equal(a.version.probe.audio.codec, "pcm_s16le");
    const i = await assets.ingestFile({ sourcePath: image, allowedRoots: [inbox], actor: "owner", category: "brand" });
    assert.equal(i.asset.kind, "image");
    assert.equal(i.version.probe.isImage, true);
    assert.equal(i.version.probe.video.width, 64);
  } finally { await env.cleanup(); }
});

test("M09-AS-R4: real ffprobe quarantines a corrupt MP4 and the protocol whitelist blocks a playlist pointing at http", async (t) => {
  const s = realSetup(t);
  if (!s) return;
  const { env, assets, tools, inbox, put } = s;
  try {
    const good = makeSyntheticMedia(inbox, { name: "good.mp4", seconds: 1, width: 160, height: 90 });
    const bytes = fs.readFileSync(good);
    const corrupt = Buffer.concat([bytes.subarray(0, 32), crypto.randomBytes(4096)]);
    const r = await assets.ingestFile({ sourcePath: put("corrupt.mp4", corrupt), allowedRoots: [inbox], actor: "owner" });
    assert.equal(r.version.status, "QUARANTINED");
    // The playlist is not even importable (unknown magic) — and ffprobe itself, with the whitelist, refuses the http segment.
    const playlist = put("pl.m3u8", "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/a.ts\n#EXT-X-ENDLIST\n");
    await rejectsCode(assets.ingestFile({ sourcePath: playlist, allowedRoots: [inbox], actor: "owner" }), "MEDIA_TYPE_UNKNOWN");
    const err = await tools.probe(playlist).catch((e) => e);
    assert.equal(err.code, "UNDECODABLE");
    assert.match(err.message, /not on whitelist|Invalid data/i);
  } finally { await env.cleanup(); }
});
