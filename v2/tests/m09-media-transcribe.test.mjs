// Milestone 09 — local MEDIA transcription (whisper-cli per file) and the live voice server hardening (PASS_SIMULATED: a fixture
// whisper-cli and the fixture voice worker; no model, no whisper binary, no network). Covers: the exact whisper-cli argv (fixed
// input name, no network/convert flags), option injection through file names, timeout / output caps / malformed output, integrity
// refused before any spawn, path validation, the strict separation from owner voice evidence (no voice_utterances row, no voice.*
// event, an mtr_ id is not an utterance, media text never confirms), the GPU mutex with the voice engine, and the whisper-server
// helpers (exact flags, every listener checked, bounded answers, tamper reported only, 5 min idle stop).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeMediaEnv, mediaTempDir, FIXTURES } from "./media-helpers.mjs";
import { makeTestHub, enrolOwner, waitFor } from "./helpers.mjs";
import { segment } from "./voice-helpers.mjs";
import { createMediaTranscriber, whisperCliArgs, resolveWhisperCliLaunch, parseWhisperJson, sniffFormat, tokensToWords, parseTasklistMemoryBytes, makeFfmpegExtractor,
  untrustedTranscriptBlock, MEDIA_INTENT_SOURCE, MEDIA_TRANSCRIPT_PROVENANCE, FORBIDDEN_CLI_FLAGS } from "../server/media/transcribe.mjs";
import { createVoiceEngine, VOICE_COMPONENTS, VOICE_ENGINE_LIMITS } from "../server/owner/voice-engine.mjs";
import { whisperServerArgs, inferenceUrl, listenerPids, checkListeners, isTamperLine, readBoundedText, readBoundedJson, MAX_RESPONSE_BYTES, WHISPER_HOST } from "../server/owner/voice-worker-lib.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";

const FAKE_WCLI = path.join(FIXTURES, "fake-whisper-cli.mjs");
const FAKE_VOICE = path.join(FIXTURES, "fake-voice-worker.mjs");

/** PCM16 mono 16 kHz WAV of `ms` milliseconds of silence. */
function wavBuffer(ms = 1000) {
  const data = Buffer.alloc(Math.round((ms / 1000) * 16000) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii"); h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const MP3_BYTES = Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.alloc(256, 0x55)]);
const MP4_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(256, 1)]);
const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left in .ifrim/tmp */ } };

/**
 * A standalone media env: migrated DB, test supervisor, the fixture whisper-cli as launcher, a fixture voice engine (or a stub),
 * a source folder outside the data root. `wcliEnv` = FAKE_WCLI_* switches.
 */
function makeEnv({ wcliEnv = {}, limits = {}, extractAudio = null, voiceEngine = null, voiceWorkerEnv = {}, engineTestHooks = {}, engineOptions = {}, clock } = {}) {
  const log = path.join(mediaTempDir("wcli-log"), "wcli.log");
  const env = makeMediaEnv({ launchers: { available: false, whisperCli: { executable: process.execPath, prefixArgs: [FAKE_WCLI], env: { FAKE_WCLI_LOG: log, ...wcliEnv } } }, ...(clock ? { clock } : {}) });
  const engineConfig = { ...env.config, voiceWorker: FAKE_VOICE, voiceWorkerEnv, voiceRoot: path.join(env.dir, "voice") };
  const events = [];
  const engine = voiceEngine || createVoiceEngine({ config: engineConfig, supervisor: env.supervisor, clock: env.clock, onEvent: (e) => events.push(e), testHooks: engineTestHooks, options: engineOptions });
  const src = path.join(env.dir, "src");
  fs.mkdirSync(src, { recursive: true });
  const transcriber = createMediaTranscriber({ db: env.db, bus: env.bus, clock: env.clock, config: env.config, supervisor: env.supervisor, voiceEngine: engine, settings: env.settings, limits, extractAudio });
  const put = (name, bytes = wavBuffer()) => { const p = path.join(src, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); return p; };
  const req = (absPath, extra = {}) => ({ absPath, allowedRoots: [src], actor: "test", channel: "test", ...extra });
  const rows = () => env.db.prepare("SELECT * FROM media_transcripts ORDER BY created_at").all();
  const eventTypes = () => env.db.prepare("SELECT type FROM events ORDER BY seq").all().map((r) => r.type);
  const cleanup = async () => { await transcriber.stopAll().catch(() => {}); await env.supervisor.stopAll(); env.cleanup(); rm(env.dir); rm(path.dirname(log)); };
  return { ...env, engine, engineEvents: events, src, transcriber, put, req, rows, eventTypes, log, cleanup };
}

function stubEngine({ paths, activity = () => ({ running: false, pending: 0 }), integrity = { ok: true, fixture: true, problems: [] } } = {}) {
  const holds = [];
  let released = 0;
  return {
    paths, holds, released: () => released,
    verifyIntegrity: async () => integrity,
    activity,
    holdMediaGpu: (label) => { holds.push(label); return () => { released += 1; }; },
  };
}
const stubPaths = (dir) => ({ release: path.join(dir, "Release"), whisperCli: path.join(dir, "Release", "whisper-cli.exe"), stt: path.join(dir, "models", "ggml-large-v3-turbo-q8_0.bin") });

// ---------------------------------------------------------------- media transcription

test("M09-MT-01 whisper-cli argv: pinned whisper-cli.exe in production, fixed input name in the job folder, JSON/SRT outputs, -d bound; never --host/--port/--public/--convert", async () => {
  // Pure: the exact argv and the production launch (no fixture, no prefix, no inherited env extras).
  const model = path.resolve("/v/models/m.bin"); const input = path.resolve("/w/stt/mtr_x/input.wav"); const outBase = path.resolve("/w/stt/mtr_x/out");
  assert.deepEqual(whisperCliArgs({ model, input, outBase, language: "ro", maxMs: 2000, threads: 6, gpu: true }),
    ["-m", model, "-f", input, "-l", "ro", "-t", "6", "-np", "-oj", "-ojf", "-osrt", "-of", outBase, "-d", "2000"]);
  assert.deepEqual(whisperCliArgs({ model, input, outBase, language: "auto", maxMs: 5, gpu: false }).slice(-1), ["-ng"]);
  assert.throws(() => whisperCliArgs({ model, input, outBase, language: "de", maxMs: 5 }), /Limbă de transcriere nepermisă/);
  assert.throws(() => whisperCliArgs({ model, input: "input.wav", outBase, maxMs: 5 }), /trebuie absolută/);
  const prodRoot = mediaTempDir("prod-voice-root");
  try {
    const prodEngine = createVoiceEngine({ config: { testMode: false, voiceRoot: prodRoot, hubRoot: prodRoot }, supervisor: { get: () => null } });
    assert.equal(path.basename(prodEngine.paths.whisperCli), VOICE_COMPONENTS.whisper.cli);
    assert.equal(VOICE_COMPONENTS.whisper.cli, "whisper-cli.exe");
    const args = whisperCliArgs({ model: prodEngine.paths.stt, input, outBase, maxMs: 1000 });
    const launch = resolveWhisperCliLaunch({ config: { testMode: false, mediaTools: { launcher: { whisperCli: { executable: process.execPath, prefixArgs: [FAKE_WCLI] } } } }, enginePaths: prodEngine.paths, args });
    assert.equal(path.basename(launch.executable), "whisper-cli.exe", "production ignores any configured launcher");
    assert.deepEqual(launch.args, args);
    assert.deepEqual(launch.env, {});
    assert.throws(() => resolveWhisperCliLaunch({ config: { testMode: false }, enginePaths: { ...prodEngine.paths, whisperCli: path.join(prodRoot, "elsewhere", "whisper-cli.exe") }, args }), /verificat/);
    assert.throws(() => resolveWhisperCliLaunch({ config: { testMode: true, mediaTools: { launcher: null } }, enginePaths: prodEngine.paths, args }), /lansatorul de test/);
  } finally { rm(prodRoot); }

  // Through the transcriber with the fixture.
  const e = makeEnv();
  try {
    const file = e.put("interviu.wav", wavBuffer(1000));
    const tr = await e.transcriber.transcribe(e.req(file));
    assert.equal(tr.status, "final", tr.error);
    assert.match(tr.id, /^mtr_/);
    assert.equal(tr.text, "Transcriere de test fără model.");
    assert.equal(tr.provenance, MEDIA_TRANSCRIPT_PROVENANCE); assert.equal(tr.intentSource, "document"); assert.equal(tr.authority, false);
    assert.deepEqual(tr.segments[0].words.map((w) => w.text), ["Transcriere", "de", "test", "fără", "model."], "BPE pieces merged into words; special tokens dropped");
    const start = readLog(e.log).find((l) => l.event === "start");
    const jobDir = path.join(e.config.mediaWorkDir, "stt", tr.id);
    const a = start.args; // the fixture logs the argv after its own script path
    // The voice engine is stopped here, so the GPU is free: no -ng.
    assert.deepEqual(a, ["-m", e.engine.paths.stt, "-f", path.join(jobDir, "input.wav"), "-l", "ro", "-t", "6", "-np", "-oj", "-ojf", "-osrt", "-of", path.join(jobDir, "out"), "-d", "2000"]);
    assert.equal(path.resolve(start.cwd).toLowerCase(), jobDir.toLowerCase(), "the job folder is the working directory (never the pinned Release folder)");
    for (const flag of ["--host", "--port", "--public", "--convert"]) assert.ok(!a.includes(flag), flag);
    assert.ok(FORBIDDEN_CLI_FLAGS.includes("--convert"));
    assert.ok(!fs.existsSync(jobDir), "the job folder (with the input copy) is removed");
    assert.equal(tr.jsonRelPath, `transcripts/${tr.id}.json`); assert.equal(tr.srtRelPath, `transcripts/${tr.id}.srt`);
    assert.ok(fs.existsSync(path.join(e.config.mediaDir, "transcripts", `${tr.id}.json`)));
    assert.ok(tr.args.includes("<job>/input.wav") && tr.args.includes("<model>"), "stored argv uses placeholders, not local paths");
    assert.equal(tr.durationMs, 1000);
    assert.match(tr.inputSha256, /^[0-9a-f]{64}$/);
    const types = e.eventTypes();
    assert.deepEqual(types.filter((t) => t.startsWith("media.transcript.")), ["media.transcript.requested", "media.transcript.started", "media.transcript.final"]);
    const payloads = e.db.prepare("SELECT payload_json FROM events WHERE type LIKE 'media.transcript.%'").all().map((r) => r.payload_json).join("\n");
    assert.doesNotMatch(payloads, /Transcriere de test/, "the transcript text never goes into the durable events");
  } finally { await e.cleanup(); }
});

test("M09-MT-02 option injection: a file named '-dl.wav' or '--load x.mp3' reaches whisper-cli only as the fixed name input.<ext>", async () => {
  const e = makeEnv();
  try {
    for (const [name, bytes, ext] of [["-dl.wav", wavBuffer(500), "wav"], ["--load x.mp3", MP3_BYTES, "mp3"]]) {
      fs.writeFileSync(e.log, "");
      const tr = await e.transcriber.transcribe(e.req(e.put(name, bytes)));
      assert.equal(tr.status, "final", tr.error);
      assert.equal(tr.format, ext);
      const args = readLog(e.log).find((l) => l.event === "start").args;
      assert.equal(path.basename(args[args.indexOf("-f") + 1]), `input.${ext}`);
      assert.ok(args.every((x) => !x.includes("-dl") && !x.includes("--load") && !x.includes("load x")), JSON.stringify(args));
    }
  } finally { await e.cleanup(); }
});

test("M09-MT-03 timeout: status timeout, the process tree stopped, partial outputs removed, no text", async () => {
  const e = makeEnv({ wcliEnv: { FAKE_WCLI_SLEEP: "20000" }, limits: { timeoutMs: 700 } });
  try {
    const t0 = Date.now();
    const tr = await e.transcriber.transcribe(e.req(e.put("lung.wav")));
    assert.equal(tr.status, "timeout");
    assert.match(tr.error, /^TIMEOUT: /);
    assert.ok(Date.now() - t0 < 15000);
    assert.equal(tr.text, null);
    assert.deepEqual(e.supervisor.list(), []);
    assert.ok(!fs.existsSync(path.join(e.config.mediaWorkDir, "stt", tr.id)), "the job folder with the partial out.srt is gone");
    assert.ok(!fs.existsSync(path.join(e.config.mediaDir, "transcripts", `${tr.id}.srt`)));
    assert.ok(e.eventTypes().includes("media.transcript.timeout"));
  } finally { await e.cleanup(); }
});

test("M09-MT-04 malformed or oversized output → failed with no text stored; odd entries are skipped, never invented", async () => {
  const cases = [
    [{ FAKE_WCLI_BADJSON: "1" }, {}, /^OUTPUT_INVALID/],
    [{ FAKE_WCLI_HUGE: "json", FAKE_WCLI_HUGE_BYTES: "200000" }, { maxJsonBytes: 4096 }, /^OUTPUT_TOO_LARGE/],
    [{ FAKE_WCLI_HUGE: "segments", FAKE_WCLI_SEGMENTS: "300" }, { maxSegments: 100 }, /^OUTPUT_TOO_LARGE/],
    [{ FAKE_WCLI_HUGE: "stdout" }, { maxStdoutBytes: 64 * 1024, timeoutMs: 20000 }, /^OUTPUT_TOO_LARGE/],
    [{ FAKE_WCLI_EXIT: "3" }, {}, /^TOOL_FAILED: whisper-cli a ieșit cu codul 3/],
  ];
  for (const [wcliEnv, limits, expected] of cases) {
    const e = makeEnv({ wcliEnv, limits });
    try {
      const tr = await e.transcriber.transcribe(e.req(e.put("x.wav")));
      assert.equal(tr.status, "failed", JSON.stringify(wcliEnv));
      assert.match(tr.error, expected);
      assert.equal(tr.text, null); assert.deepEqual(tr.segments, []); assert.equal(tr.jsonRelPath, null);
      assert.deepEqual(e.supervisor.list(), []);
      const tdir = path.join(e.config.mediaDir, "transcripts");
      assert.ok(!fs.existsSync(tdir) || fs.readdirSync(tdir).length === 0, "nothing kept for a failed job");
    } finally { await e.cleanup(); }
  }
  // Parser: entries of the wrong type are skipped; bad offsets → null times; a non-string language → null.
  const odd = parseWhisperJson(JSON.stringify({ result: { language: 7 }, transcription: [null, 42, { text: 5 }, { offsets: { from: "x", to: -3 }, text: " fără timp" }, { timestamps: { from: "00:00:01,000", to: "00:00:02,500" }, text: " gata" }] }));
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.segments.map((s) => [s.fromMs, s.toMs, s.text]), [[null, null, "fără timp"], [1000, 2500, "gata"]]);
  assert.equal(odd.language, null); assert.equal(odd.text, "fără timp gata"); assert.equal(odd.wordCount, 3);
  assert.equal(parseWhisperJson(JSON.stringify({ transcription: [null, 1] })).code, "OUTPUT_INVALID");
  assert.equal(parseWhisperJson(JSON.stringify({ text: "x" })).code, "OUTPUT_INVALID");
  assert.equal(parseWhisperJson(JSON.stringify({ transcription: [] })).ok, true, "silence: an empty transcript, not a failure");
  assert.deepEqual(tokensToWords([{ text: "[_BEG_]" }, { text: " ex", offsets: { from: 0, to: 10 }, p: 0.9 }, { text: "ecută", offsets: { from: 10, to: 30 }, p: 0.5 }, { text: "," }, { text: " <|en|>" }, { text: " da", offsets: { from: 40, to: 50 } }]),
    [{ text: "execută,", fromMs: 0, toMs: 30, p: 0.5 }, { text: "da", fromMs: 40, toMs: 50, p: null }]);
  assert.equal(parseTasklistMemoryBytes('"whisper-cli.exe","1234","Console","1","123.456 K"\r\n'), 123456 * 1024);
  assert.equal(parseTasklistMemoryBytes("INFO: No tasks are running"), null);
});

test("M09-MT-05 integrity mismatch of the whisper.cpp folder → refused before any process, no row", async () => {
  const problems = ["binarele whisper.cpp diferă de cele instalate și verificate"];
  const e = makeEnv({ engineTestHooks: { integrity: { ok: false, problems } } });
  try {
    await assert.rejects(e.transcriber.transcribe(e.req(e.put("a.wav"))), (err) => err.category === "tool" && /Transcrierea media refuzată: binarele whisper.cpp diferă/.test(err.message));
    assert.deepEqual(e.rows(), []);
    assert.deepEqual(readLog(e.log), [], "whisper-cli never started");
    assert.deepEqual(e.supervisor.list(), []);
    await assert.rejects(e.engine.ensure(), /Motorul vocal refuzat/, "the same seam refuses the live voice engine");
    assert.equal(e.engine.status().engine, "integrity_failed");
  } finally { await e.cleanup(); }
});

test("M09-MT-06 paths: outside the allowed roots, links/junctions, protected folders, the Hub data root and unknown formats are refused; library versions resolve under the media root", async (t) => {
  const e = makeEnv();
  try {
    const refuse = async (request, code) => { await assert.rejects(e.transcriber.transcribe(request), (err) => err.code === code || assert.fail(`${err.code}: ${err.message} (expected ${code})`)); };
    const outsideDir = path.join(e.dir, "other"); fs.mkdirSync(outsideDir, { recursive: true });
    const outside = path.join(outsideDir, "o.wav"); fs.writeFileSync(outside, wavBuffer());
    await refuse(e.req(outside), "MEDIA_PATH_OUTSIDE");
    await refuse({ absPath: e.put("ok.wav"), allowedRoots: [], actor: "test", channel: "test" }, "MEDIA_ROOTS_MISSING");
    await refuse(e.req("relativ.wav"), "MEDIA_PATH_INVALID");
    await refuse(e.req(e.put(path.join("proiect", ".ifrim", "private", "a.wav"))), "MEDIA_PATH_PROTECTED");
    await refuse(e.req(e.put(path.join("proiect", ".env.wav"))), "MEDIA_PATH_PROTECTED");
    const inData = path.join(e.dataDir, "d.wav"); fs.writeFileSync(inData, wavBuffer());
    await refuse({ absPath: inData, allowedRoots: [e.dir], actor: "test", channel: "test" }, "MEDIA_PATH_PROTECTED");
    // The Hub's real private folder: refused from the path text alone (nothing there is opened; the file does not even exist).
    await refuse({ absPath: path.join(e.config.hubRoot, ".ifrim", "private", "nu-exista.wav"), allowedRoots: [e.config.hubRoot], actor: "test", channel: "test" }, "MEDIA_PATH_PROTECTED");
    // A junction inside the root that points elsewhere inside the root is still refused (only real paths are accepted).
    const realDir = path.join(e.src, "real"); fs.mkdirSync(realDir, { recursive: true }); fs.writeFileSync(path.join(realDir, "j.wav"), wavBuffer());
    fs.symlinkSync(realDir, path.join(e.src, "jonctiune"), "junction");
    await refuse(e.req(path.join(e.src, "jonctiune", "j.wav")), "MEDIA_LINK_REFUSED");
    try { fs.symlinkSync(path.join(realDir, "j.wav"), path.join(e.src, "leg.wav"), "file"); await refuse(e.req(path.join(e.src, "leg.wav")), "MEDIA_SYMLINK_REFUSED"); }
    catch (err) { if (err.code !== "EPERM") throw err; t.diagnostic("file symlink not creatable without privilege (EPERM): symlink sub-case covered by lstat only"); }
    await refuse(e.req(e.put("text.wav", Buffer.from("nu este audio, doar text"))), "MEDIA_FORMAT_UNKNOWN");
    await refuse(e.req(e.put("video.mp4", MP4_BYTES)), "MEDIA_EXTRACT_UNAVAILABLE");
    await refuse(e.req(e.put("gol.wav", Buffer.alloc(0))), "MEDIA_EMPTY");
    await refuse({ ...e.req(e.put("ok2.wav")), language: "de" }, "VALIDATION");
    assert.deepEqual(e.rows(), [], "refusals create no row");

    // Library versions (rel_path under mediaDir).
    const now = new Date().toISOString();
    const lib = path.join(e.config.mediaDir, "originals", "ab"); fs.mkdirSync(lib, { recursive: true });
    const bytes = wavBuffer(800); fs.writeFileSync(path.join(lib, "ab.wav"), bytes);
    const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    e.db.prepare("INSERT INTO media_assets (id, kind, category, title, origin, created_by, created_at, updated_at, project_id) VALUES ('mas_1', 'audio', 'raw', 'Interviu', 'OWNED', 'test', ?, ?, 'prj_1')").run(now, now);
    const ver = e.db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, probe_json, status, created_by, created_at) VALUES (?, 'mas_1', ?, ?, ?, ?, ?, ?, 'test', ?)");
    ver.run("mav_ok", 1, sha, bytes.length, "originals/ab/ab.wav", JSON.stringify({ durationMs: 800, hasAudio: true }), "READY", now);
    ver.run("mav_escape", 2, sha, bytes.length, "../escape.wav", "{}", "READY", now);
    ver.run("mav_quar", 3, sha, bytes.length, "originals/ab/ab.wav", "{}", "QUARANTINED", now);
    ver.run("mav_changed", 4, "0".repeat(64), bytes.length, "originals/ab/ab.wav", "{}", "READY", now);
    ver.run("mav_mute", 5, sha, bytes.length, "originals/ab/ab.wav", JSON.stringify({ hasAudio: false }), "READY", now);
    const lreq = (id) => ({ assetVersionId: id, actor: "test", channel: "test" });
    await refuse(lreq("mav_escape"), "MEDIA_PATH_INVALID");
    await refuse(lreq("mav_quar"), "MEDIA_VERSION_NOT_READY");
    await refuse(lreq("mav_nu"), "MEDIA_VERSION_NOT_FOUND");
    await refuse(lreq("mav_mute"), "MEDIA_NO_AUDIO");
    const ok = await e.transcriber.transcribe(lreq("mav_ok"));
    assert.equal(ok.status, "final", ok.error); assert.equal(ok.assetVersionId, "mav_ok"); assert.equal(ok.projectId, "prj_1"); assert.equal(ok.inputSha256, sha);
    const again = await e.transcriber.transcribe(lreq("mav_ok"));
    assert.equal(again.reused, true); assert.equal(again.id, ok.id, "same bytes, same language: reused, no second job");
    const changed = await e.transcriber.transcribe(lreq("mav_changed"));
    assert.equal(changed.status, "failed"); assert.match(changed.error, /^INPUT_CHANGED/);
    assert.equal(e.rows().length, 2);
  } finally { await e.cleanup(); }
});

test("M09-MT-07 channel separation: an mtr_ id is not an utterance, confirmations refuse it, zero voice_utterances rows, no voice.* events, Teach Lega refuses media-local", async () => {
  const src = mediaTempDir("mt07-src");
  const log = path.join(src, "wcli.log");
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: { whisperCli: { executable: process.execPath, prefixArgs: [FAKE_WCLI], env: { FAKE_WCLI_TEXT: "Da, execută planul", FAKE_WCLI_LOG: log } } } } } });
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    const voiceEventsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'voice.%'").get().n;
    const transcriber = createMediaTranscriber({ db: t.hub.db, bus: t.hub.bus, clock: t.config.now, config: t.config, supervisor: t.hub.supervisor, voiceEngine: t.hub.voiceEngine, settings: t.hub.settings });
    const file = path.join(src, "client.wav"); fs.writeFileSync(file, wavBuffer());
    const tr = await transcriber.transcribe({ absPath: file, allowedRoots: [src], actor: "owner", channel: "owner" });
    assert.equal(tr.status, "final", tr.error);
    assert.equal(tr.text, "Da, execută planul");
    await assert.rejects(t.hub.commands.dispatch({ type: "owner.intent", channel: "test", actor: "test", ownerSession: owner.session, payload: { utteranceId: tr.id } }), /Segment vocal necunoscut/);
    assert.throws(() => t.hub.voice.claimForConfirmation({ utteranceId: tr.id, session: owner.session, envelope: { id: "env_x" }, pendingEnvelopes: [{ id: "env_x", title: "Plan" }] }), /segmentul nu există/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'voice.%'").get().n, voiceEventsBefore, "no voice.* event from media");
    assert.ok(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'media.transcript.final'").get().n === 1);
    const lesson = t.hub.teach.propose({ text: `${tr.text} de fiecare dată`, provenance: tr.provenance, actor: "test" });
    assert.equal(lesson.refused, true, "media-local is never an owner provenance");
    assert.equal(lesson.lesson.status, "REFUSED");
    assert.ok(!t.hub.supervisor.list().some((p) => p.key === "voice-worker"));
  } finally { await t.cleanup(); rm(src); }
});

test("M09-MT-08 the media path never touches the voice port: no worker request, the engine stays stopped; a failed voice engine does not block media", async () => {
  const src = mediaTempDir("mt08-src");
  const vlog = path.join(src, "voice.log");
  const t = await makeTestHub({ configOverrides: { voiceWorkerEnv: { FAKE_VOICE_LOG: vlog }, mediaTools: { launcher: { whisperCli: { executable: process.execPath, prefixArgs: [FAKE_WCLI], env: {} } } } } });
  try {
    const transcriber = createMediaTranscriber({ db: t.hub.db, bus: t.hub.bus, clock: t.config.now, config: t.config, supervisor: t.hub.supervisor, voiceEngine: t.hub.voiceEngine, settings: t.hub.settings });
    const file = path.join(src, "a.wav"); fs.writeFileSync(file, wavBuffer());
    const tr = await transcriber.transcribe({ absPath: file, allowedRoots: [src], actor: "owner", channel: "owner" });
    assert.equal(tr.status, "final", tr.error);
    assert.ok(!fs.existsSync(vlog) || fs.readFileSync(vlog, "utf8").trim() === "", "zero voice worker requests");
    assert.equal(t.hub.voiceEngine.status().engine, "stopped");
    assert.ok(!t.hub.supervisor.list().some((p) => p.key === "voice-worker"));
    assert.ok(!tr.args.includes("-ng"), "voice engine stopped → the GPU is free for media");
  } finally { await t.cleanup(); rm(src); }

  const e = makeEnv({ voiceWorkerEnv: { FAKE_VOICE_FATAL: "1" } });
  try {
    await assert.rejects(e.engine.ensure(), /Motorul vocal local nu a pornit/);
    assert.equal(e.engine.status().engine, "failed");
    const tr = await e.transcriber.transcribe(e.req(e.put("b.wav")));
    assert.equal(tr.status, "final", "media transcription depends on integrity, not on the voice engine running");
  } finally { await e.cleanup(); }
});

test("M09-MT-09 one job at a time; the GPU mutex waits for in-flight owner requests and uses -ng while the voice engine holds its models; identical requests join, a full queue refuses", async () => {
  const e = makeEnv({ wcliEnv: { FAKE_WCLI_SLEEP: "300" } });
  try {
    const [a, b] = await Promise.all([e.transcriber.transcribe(e.req(e.put("a.wav"))), e.transcriber.transcribe(e.req(e.put("b.wav")))]);
    assert.equal(a.status, "final"); assert.equal(b.status, "final");
    const log = readLog(e.log);
    assert.deepEqual(log.map((l) => l.event), ["start", "end", "start", "end"], "serialized, never overlapping");
    // Identical concurrent requests → one job.
    const c = e.put("c.wav");
    const [h1, h2] = await Promise.all([e.transcriber.start(e.req(c)), e.transcriber.start(e.req(c))]);
    assert.equal(h1.transcript.id, h2.transcript.id);
    await h1.done;
  } finally { await e.cleanup(); }

  const dir = mediaTempDir("gpu-stub");
  try {
    // In-flight owner request: media waits until it is done, then takes the GPU (and releases it).
    let pending = 1; let flippedAt = null;
    const stub = stubEngine({ paths: stubPaths(dir), activity: () => ({ running: false, pending }) });
    setTimeout(() => { pending = 0; flippedAt = Date.now(); }, 400);
    const e2 = makeEnv({ voiceEngine: stub });
    try {
      const tr = await e2.transcriber.transcribe(e2.req(e2.put("g.wav")));
      const start = readLog(e2.log).find((l) => l.event === "start");
      assert.ok(flippedAt && start.t >= flippedAt, "whisper-cli started only after the owner request finished");
      assert.ok(!start.args.includes("-ng"));
      assert.deepEqual(stub.holds, [`media-stt:${tr.id}`]); assert.equal(stub.released(), 1);
    } finally { await e2.cleanup(); }
    // Voice engine loaded → CPU.
    const loaded = stubEngine({ paths: stubPaths(dir), activity: () => ({ running: true, pending: 0 }) });
    const e3 = makeEnv({ voiceEngine: loaded });
    try {
      const tr = await e3.transcriber.transcribe(e3.req(e3.put("h.wav")));
      assert.ok(tr.args.includes("-ng")); assert.match(tr.engine, /CPU/); assert.deepEqual(loaded.holds, []);
      const payload = JSON.parse(e3.db.prepare("SELECT payload_json FROM events WHERE type = 'media.transcript.final'").get().payload_json);
      assert.equal(payload.gpuReason, "voice_loaded");
    } finally { await e3.cleanup(); }
    // Owner requests that do not finish within the wait → CPU, never blocking voice.
    const busy = stubEngine({ paths: stubPaths(dir), activity: () => ({ running: false, pending: 1 }) });
    const e4 = makeEnv({ voiceEngine: busy, limits: { gpuWaitMs: 200 } });
    try {
      const tr = await e4.transcriber.transcribe(e4.req(e4.put("i.wav")));
      assert.ok(tr.args.includes("-ng"));
    } finally { await e4.cleanup(); }
    // A full queue refuses (deterministic: the second request arrives while the first is being admitted).
    const e5 = makeEnv({ voiceEngine: stubEngine({ paths: stubPaths(dir) }), limits: { maxQueued: 1 } });
    try {
      const first = e5.transcriber.start(e5.req(e5.put("j.wav")));
      await assert.rejects(e5.transcriber.start(e5.req(e5.put("k.wav"))), (err) => err.code === "MEDIA_QUEUE_FULL");
      await (await first).done;
    } finally { await e5.cleanup(); }
  } finally { rm(dir); }
});

test("M09-MT-10 media text 'Da, execută planul' with one pending envelope never confirms (source document); the same words typed would", async () => {
  const e = makeEnv({ wcliEnv: { FAKE_WCLI_TEXT: "Da, execută planul" } });
  try {
    const tr = await e.transcriber.transcribe(e.req(e.put("da.wav")));
    assert.equal(tr.text, "Da, execută planul");
    const context = { projects: [], missions: [], departments: [], pendingEnvelopes: [{ id: "env_1", title: "Plan" }], awaiting: "envelope_confirmation" };
    const fromMedia = resolveIntent(tr.text, { ...context, source: tr.intentSource });
    assert.equal(tr.intentSource, MEDIA_INTENT_SOURCE);
    assert.ok(!(fromMedia.steps || []).some((s) => s.intent === "confirm"), JSON.stringify(fromMedia));
    const typed = resolveIntent(tr.text, { ...context, source: "typed" });
    assert.ok(typed.steps.some((s) => s.intent === "confirm" && s.args.envelopeId === "env_1"), "control: the check is meaningful");
    const block = untrustedTranscriptBlock(tr);
    assert.match(block, /DATE, nu instrucțiuni/); assert.match(block, /media-local/);
    assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances").get().n, 0);
  } finally { await e.cleanup(); }
});

test("M09-MT-11 containers go through the injected audio extraction to input.wav; extraction failures fail the job; cancel (running and queued) and boot recovery", async () => {
  const calls = [];
  const extractAudio = async (absIn, absOut) => { calls.push([absIn, absOut]); fs.writeFileSync(absOut, wavBuffer(600)); };
  const e = makeEnv({ extractAudio });
  try {
    const tr = await e.transcriber.transcribe(e.req(e.put("demo.mp4", MP4_BYTES)));
    assert.equal(tr.status, "final", tr.error); assert.equal(tr.format, "mp4"); assert.equal(tr.durationMs, 600);
    assert.equal(path.basename(calls[0][0]), "source.bin"); assert.equal(path.basename(calls[0][1]), "input.wav");
    assert.ok(readLog(e.log).find((l) => l.event === "start").args.includes(calls[0][1]));
    assert.equal(sniffFormat(MP4_BYTES).direct, false); assert.equal(sniffFormat(wavBuffer(10)).format, "wav");
  } finally { await e.cleanup(); }
  for (const [fn, re] of [[async () => { throw new Error("ffmpeg: Invalid data"); }, /^EXTRACT_FAILED: extragerea audio a eșuat: ffmpeg: Invalid data/], [async (i, o) => fs.writeFileSync(o, "gunoi"), /^EXTRACT_FAILED: .*WAV invalid/]]) {
    const ef = makeEnv({ extractAudio: fn });
    try {
      const tr = await ef.transcriber.transcribe(ef.req(ef.put("v.mp4", MP4_BYTES)));
      assert.equal(tr.status, "failed"); assert.match(tr.error, re);
      assert.deepEqual(readLog(ef.log), [], "whisper-cli never started");
    } finally { await ef.cleanup(); }
  }
  // The ffmpeg-based extractor over media/tools.mjs: fixed protocol whitelist, audio only, mono 16 kHz.
  const seen = [];
  const tools = { inputArgs: (p) => ["-protocol_whitelist", "file,pipe", "-i", p], run: async (o) => { seen.push(o); return { code: seen.length === 1 ? 0 : 1, stderrLines: ["Invalid data found"] }; } };
  const ex = makeFfmpegExtractor(tools);
  await ex(path.resolve("/j/source.bin"), path.resolve("/j/input.wav"));
  assert.equal(seen[0].tool, "ffmpeg");
  assert.deepEqual(seen[0].args, ["-protocol_whitelist", "file,pipe", "-i", path.resolve("/j/source.bin"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "-y", path.resolve("/j/input.wav")]);
  await assert.rejects(ex(path.resolve("/j/source.bin"), path.resolve("/j/input.wav")), /codul 1: Invalid data found/);

  // Cancel: a running job is stopped (tree) and closed; a queued one never starts.
  const ec = makeEnv({ wcliEnv: { FAKE_WCLI_SLEEP: "20000" } });
  try {
    const h1 = await ec.transcriber.start(ec.req(ec.put("1.wav")));
    const h2 = await ec.transcriber.start(ec.req(ec.put("2.wav")));
    await waitFor(() => ec.supervisor.list().some((p) => p.key === `media-stt:${h1.transcript.id}`), 10000);
    const q = await ec.transcriber.cancel(h2.transcript.id, "owner");
    assert.equal(q.status, "cancelled");
    await ec.transcriber.cancel(h1.transcript.id, "owner");
    const r1 = await h1.done; const r2 = await h2.done;
    assert.equal(r1.status, "cancelled"); assert.equal(r2.status, "cancelled");
    assert.deepEqual(ec.supervisor.list(), []);
    assert.equal(readLog(ec.log).filter((l) => l.event === "start").length, 1, "the queued job never started");
    assert.equal((await ec.transcriber.cancel(h1.transcript.id)).status, "cancelled", "idempotent");
    // Boot recovery: a row left running by a previous process is closed, never resumed.
    ec.db.prepare("INSERT INTO media_transcripts (id, requested_by, channel, input_sha256, input_bytes, format, language, engine, status, created_at) VALUES ('mtr_old_0123456789', 't', 't', '', 1, 'wav', 'ro', 'x', 'running', ?)").run(new Date().toISOString());
    fs.mkdirSync(path.join(ec.config.mediaWorkDir, "stt", "mtr_old_0123456789"), { recursive: true });
    const rec = ec.transcriber.recover();
    assert.equal(rec.interrupted, 1);
    assert.match(ec.transcriber.get("mtr_old_0123456789").error, /^INTERRUPTED/);
  } finally { await ec.cleanup(); }
});

// ---------------------------------------------------------------- live voice server hardening (pure helpers + fixture worker)

test("M09-VS-01 whisper-server argv: exact flags, loopback host constant, no --convert; random --inference-path only when enabled (OFF by default)", async () => {
  const cfg = { sttModel: "C:/v/models/m.bin", language: "ro", threads: 6, publicDir: "C:/v/empty-public" };
  assert.deepEqual(whisperServerArgs(cfg, 50123), ["-m", "C:/v/models/m.bin", "-l", "ro", "-t", "6", "-bs", "1", "-bo", "1", "-nt", "--host", "127.0.0.1", "--port", "50123", "--public", "C:/v/empty-public"]);
  const { randomInferencePath } = await import("../server/owner/voice-worker-lib.mjs");
  const p = randomInferencePath();
  assert.match(p, /^\/[0-9a-f]{32}$/);
  assert.notEqual(p, randomInferencePath(), "per start");
  const withPath = whisperServerArgs(cfg, 50123, p);
  assert.deepEqual(withPath.slice(-2), ["--inference-path", p]);
  assert.equal(inferenceUrl(50123, p), `http://127.0.0.1:50123${p}`);
  assert.equal(inferenceUrl(50123), "http://127.0.0.1:50123/inference");
  for (const bad of ["/inference", "/../load", "/ABCDEF0123456789ABCDEF0123456789", "x".repeat(33)]) assert.throws(() => whisperServerArgs(cfg, 50123, bad), /32 de caractere hex/);
  assert.throws(() => whisperServerArgs(cfg, 0), /port invalid/);
  assert.throws(() => whisperServerArgs({ ...cfg, host: "0.0.0.0" }, 70000), /port invalid/);
  assert.ok(!withPath.includes("--convert") && withPath[withPath.indexOf("--host") + 1] === WHISPER_HOST);
  assert.equal(whisperServerArgs({ ...cfg, host: "0.0.0.0" }, 1)[whisperServerArgs(cfg, 1).indexOf("--host") + 1], "127.0.0.1", "a host in the config is ignored");

  // The engine passes the flag to the worker: false by default, true only when explicitly enabled.
  for (const [options, expected] of [[{}, false], [{ randomInferencePath: true }, true]]) {
    const cfgLog = path.join(mediaTempDir("cfglog"), "cfg.log");
    const e = makeEnv({ voiceWorkerEnv: { FAKE_VOICE_CFG_LOG: cfgLog }, engineOptions: options });
    try {
      await e.engine.ensure();
      assert.deepEqual(readLog(cfgLog), [{ randomInferencePath: expected }]);
      assert.equal(e.engine.status().randomInferencePath, expected);
    } finally { await e.engine.stop(); await e.cleanup(); rm(path.dirname(cfgLog)); }
  }
});

test("M09-VS-02 listener check: every LISTENING pid on the port must be whisper-server's; a squatter, a second listener, none, or an unreadable netstat on Windows refuse", () => {
  const netstat = [
    "",
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100",
    "  TCP    127.0.0.1:50123        0.0.0.0:0              LISTENING       4242",
    "  TCP    127.0.0.1:5012         0.0.0.0:0              LISTENING       5012",
    "  TCP    127.0.0.1:501234       0.0.0.0:0              LISTENING       9",
    "  TCP    127.0.0.1:61000        127.0.0.1:50123        ESTABLISHED     999",
    "  TCP    127.0.0.1:50123        127.0.0.1:61000        ESTABLISHED     4242",
    "  TCP    [::1]:50123            [::]:0                 LISTENING       777",
    "  UDP    127.0.0.1:50123        *:*                                    888",
  ].join("\r\n");
  assert.deepEqual(listenerPids(netstat, 50123), [4242, 777], "IPv4 and IPv6 listeners, not clients, not other ports, not UDP");
  assert.equal(checkListeners({ pids: listenerPids(netstat, 50123), expectedPid: 4242, platform: "win32" }).ok, false);
  assert.match(checkListeners({ pids: [4242, 777], expectedPid: 4242, platform: "win32" }).reason, /pid 777/);
  assert.match(checkListeners({ pids: [31337], expectedPid: 4242, platform: "win32" }).reason, /alt proces \(pid 31337\)/, "a squatter alone");
  assert.deepEqual(checkListeners({ pids: [4242], expectedPid: 4242, platform: "win32" }), { ok: true, checked: true, reason: null });
  assert.equal(checkListeners({ pids: [], expectedPid: 4242, platform: "win32" }).ok, false, "nothing listening = cannot prove it is ours");
  assert.equal(checkListeners({ pids: null, expectedPid: 4242, platform: "win32" }).ok, false, "netstat unavailable on Windows = refusal");
  assert.deepEqual(checkListeners({ pids: null, expectedPid: 4242, platform: "linux" }), { ok: true, checked: false, reason: null });
  // A localized Windows translates the state name: the wildcard foreign address still marks a listener.
  assert.deepEqual(listenerPids("  TCP    127.0.0.1:50123        0.0.0.0:0              ASCULTARE       4242\r\n", 50123), [4242]);
  assert.deepEqual(listenerPids("", 50123), []);
  assert.equal(listenerPids(undefined, 50123), null);
  assert.equal(listenerPids(netstat, "x"), null);
});

test("M09-VS-03 a model-load log line after readiness is reported (event + status) and nothing else changes; answers are read with a size cap", async () => {
  assert.equal(isTamperLine("whisper_init_from_file_with_params_no_state: loading model from 'C:/x.bin'"), true);
  assert.equal(isTamperLine("whisper_model_load: loading model"), true);
  assert.equal(isTamperLine("whisper_full_with_state: auto-detected language: ro"), false);
  assert.equal(isTamperLine("received request: segment.wav"), false);

  const e = makeEnv({ voiceWorkerEnv: { FAKE_VOICE_TAMPER: "1" } });
  try {
    await e.engine.ensure();
    await waitFor(() => e.engine.status().tamper, 5000);
    const st = e.engine.status();
    assert.match(st.tamper.line, /loading model/); assert.equal(st.tamper.count, 1);
    assert.equal(st.engine, "ready", "only reported: the engine is not stopped or restarted by this signal");
    assert.ok(e.engineEvents.some((ev) => ev.type === "voice.engine_tamper_suspected"));
    const out = await e.engine.analyze(segment("Da, execută planul"), { embed: false, transcribe: true });
    assert.equal(out.transcript, "Da, execută planul", "requests are still served");
  } finally { await e.engine.stop(); await e.cleanup(); }

  // Bounded reads.
  assert.equal(MAX_RESPONSE_BYTES, 256 * 1024);
  assert.deepEqual(await readBoundedJson(new Response(JSON.stringify({ text: " Da " }))), { text: " Da " });
  await assert.rejects(readBoundedText(new Response("x".repeat(5000), { headers: { "content-length": "5000" } }), 1000), (err) => err.code === "RESPONSE_TOO_LARGE");
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 10; i += 1) c.enqueue(new Uint8Array(400)); c.close(); } });
  await assert.rejects(readBoundedText(new Response(stream), 1000), (err) => err.code === "RESPONSE_TOO_LARGE", "counted while streaming when no length is declared");
  await assert.rejects(readBoundedJson(new Response("<html>")), (err) => err.code === "RESPONSE_INVALID");
});

test("M09-VS-04 the idle voice engine stops after 5 minutes (whisper-server's port is open only while needed)", async () => {
  assert.equal(VOICE_ENGINE_LIMITS.IDLE_STOP_MS, 5 * 60000);
  let now = Date.parse("2026-10-03T10:00:00Z");
  const e = makeEnv({ clock: () => new Date(now) });
  try {
    await e.engine.ensure();
    assert.equal(e.engine.status().engine, "ready");
    now += 4 * 60000; e.engine.tick();
    assert.equal(e.engine.status().engine, "ready");
    now += 61000; e.engine.tick();
    await waitFor(() => e.engine.status().engine === "stopped" && !e.supervisor.list().some((p) => p.key === "voice-worker"), 10000);
  } finally { await e.engine.stop(); await e.cleanup(); }
});
