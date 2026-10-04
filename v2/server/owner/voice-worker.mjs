// Ifrim Agent Hub — local voice worker (M07; hardened in M09). A child process of the Hub (its supervisor owns and stops it); it
// speaks JSON lines on stdin/stdout and nothing else. It loads:
//  - the speaker model (3D-Speaker CAM++ VoxCeleb, ONNX, through sherpa-onnx-node) in-process;
//  - whisper.cpp's whisper-server (large-v3-turbo q8_0, Romanian forced) as ITS OWN child on a random 127.0.0.1 port.
// Native crashes stay in this process (the Hub restarts it on demand). whisper-server has no authentication and answers with
// "Access-Control-Allow-Origin: *": the port is random, bound to loopback only, its static folder is empty, and the worker checks
// that EVERY process LISTENING on that port is the one it started — once at start-up and again before each transcription (on
// Windows an unreadable netstat refuses the request; a second listener stops the worker). The answer is read with a size cap.
// Model-load log lines after start-up (someone calling the unauthenticated /load) are reported to the Hub, not acted on. The Hub
// never accepts a transcript from anywhere but this worker's answer to its own request. stdin closing = stop (whisper-server is
// killed). Pure helpers (argv, listener parsing, bounded read) live in voice-worker-lib.mjs.
//
// argv: --config <base64 JSON {whisperExe, sttModel, svModel, publicDir, threads, language, hubRoot, randomInferencePath}>
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { whisperServerArgs, inferenceUrl, randomInferencePath, listenerPids, checkListeners, isTamperLine, readBoundedJson, wavFromPcm16Mono16k, WHISPER_HOST, MAX_RESPONSE_BYTES } from "./voice-worker-lib.mjs";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
let cfg;
try { cfg = JSON.parse(Buffer.from(arg("config") || "", "base64").toString("utf8")); } catch { cfg = null; }
const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
if (!cfg?.whisperExe || !cfg?.sttModel || !cfg?.svModel || !cfg?.hubRoot) { say({ kind: "fatal", error: "configurație lipsă" }); process.exit(2); }

let whisper = null;
let port = 0;
let inferencePath = null;
let extractor = null;
let gpu = null;
let stopping = false;
let ready = false;
let tamperReports = 0;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, WHISPER_HOST, () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => new Promise((resolve) => {
  if (!pid) return resolve();
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  else { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } resolve(); }
});

/** Every PID listening on TCP <port> (Windows: netstat over IPv4 and IPv6; elsewhere unknown → null). */
function currentListenerPids(p) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    execFile("netstat", ["-ano"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(listenerPids(String(stdout), p));
    });
  });
}

/** The listener check (start-up and before each transcription). Returns the decision; never throws. */
async function verifyListener() {
  if (!whisper) return { ok: false, checked: false, reason: "motorul de transcriere nu rulează" };
  return checkListeners({ pids: await currentListenerPids(port), expectedPid: whisper.pid });
}

async function startWhisper() {
  port = await freePort();
  // Per-start random inference path: only when the Hub asks for it (OFF by default; unverified on the real binary).
  inferencePath = cfg.randomInferencePath === true ? randomInferencePath() : null;
  const args = whisperServerArgs({ sttModel: cfg.sttModel, language: cfg.language || "ro", threads: cfg.threads || 6, publicDir: cfg.publicDir }, port, inferencePath);
  const tail = [];
  whisper = spawn(cfg.whisperExe, args, { cwd: path.dirname(cfg.whisperExe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (chunk) => { for (const line of String(chunk).split(/\r?\n/)) { if (!line.trim()) continue; tail.push(line.slice(0, 200)); if (tail.length > 30) tail.shift();
    if (/ggml_cuda_init: found \d+ CUDA devices|using CUDA0 backend/.test(line)) gpu = true;
    // After readiness a model-load line means /load was called (whisper-server has no auth). Reported, rate-limited; never acted on.
    if (ready && tamperReports < 5 && isTamperLine(line)) { tamperReports += 1; say({ kind: "tamper_suspected", line: line.slice(0, 160), count: tamperReports }); } } };
  whisper.stdout.on("data", keep); whisper.stderr.on("data", keep);
  whisper.on("exit", (code) => { const was = whisper; whisper = null; if (!stopping && was) { say({ kind: "stt-exited", code, tail: tail.slice(-5) }); process.exit(1); } });
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (!whisper) throw new Error(`whisper-server s-a oprit la pornire: ${tail.slice(-3).join(" | ")}`);
    try { const r = await fetch(`http://${WHISPER_HOST}:${port}/health`, { signal: AbortSignal.timeout(1500) }); await r.body?.cancel(); if (r.ok) break; } catch { /* not yet */ }
    await sleep(400);
  }
  if (Date.now() - started >= 90000) throw new Error("whisper-server nu a răspuns în 90 s");
  const check = await verifyListener();
  if (!check.ok) throw new Error(check.reason);
  return { port, gpu: Boolean(gpu), startupMs: Date.now() - started, listenerChecked: check.checked, inferencePathRandom: Boolean(inferencePath) };
}

function loadSpeakerModel() {
  const sherpa = createRequire(path.join(cfg.hubRoot, "package.json"))("sherpa-onnx-node");
  const t = Date.now();
  extractor = new sherpa.SpeakerEmbeddingExtractor({ model: cfg.svModel, numThreads: 2, debug: false, provider: "cpu" });
  return { dim: extractor.dim, loadMs: Date.now() - t };
}

function embed(samples) {
  const t = Date.now();
  const stream = extractor.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  if (typeof stream.inputFinished === "function") stream.inputFinished();
  if (!extractor.isReady(stream)) return { embedding: null, ms: Date.now() - t };
  return { embedding: Array.from(extractor.compute(stream)), ms: Date.now() - t };
}

async function transcribe(buffer, prompt) {
  if (!whisper) throw new Error("motorul de transcriere nu rulează");
  // Before EVERY transcription (a confirmation or a gate sentence included): the port must still be whisper-server's alone.
  const check = await verifyListener();
  if (!check.ok) {
    if (check.checked) {
      // A second listener on our port: this engine instance is no longer trusted. Stop it; the Hub restarts on the next request.
      say({ kind: "listener_mismatch", reason: check.reason });
      setImmediate(() => shutdown(1));
    }
    throw new Error(`transcriere refuzată: ${check.reason}`);
  }
  const t = Date.now();
  const form = new FormData();
  form.append("file", new Blob([wavFromPcm16Mono16k(buffer)], { type: "audio/wav" }), "segment.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("language", cfg.language || "ro");
  if (prompt) form.append("prompt", String(prompt).slice(0, 200));
  const res = await fetch(inferenceUrl(port, inferencePath), { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new Error(`transcriere HTTP ${res.status}`); }
  const data = await readBoundedJson(res, MAX_RESPONSE_BYTES);
  return { text: String(data?.text || "").replace(/\s+/g, " ").trim().slice(0, 4000), ms: Date.now() - t };
}

async function handle(msg) {
  const { id, op } = msg;
  try {
    if (op === "status") return say({ id, ok: true, stt: { port: Boolean(port), gpu: Boolean(gpu), running: Boolean(whisper), inferencePathRandom: Boolean(inferencePath) }, sv: { dim: extractor?.dim || null } });
    if (op !== "analyze") return say({ id, ok: false, error: `operație necunoscută: ${op}` });
    const buffer = Buffer.from(String(msg.pcm || ""), "base64");
    const samples = new Float32Array(buffer.length / 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = buffer.readInt16LE(i * 2) / 32768;
    const out = { id, ok: true };
    if (msg.embed !== false) { const e = embed(samples); out.embedding = e.embedding; out.svMs = e.ms; }
    if (msg.transcribe) { const r = await transcribe(buffer, msg.prompt); out.transcript = r.text; out.sttMs = r.ms; out.sttEngine = `whisper.cpp large-v3-turbo-q8_0 (${gpu ? "GPU" : "CPU"})`; }
    say(out);
  } catch (error) { say({ id, ok: false, error: String(error?.message || error).slice(0, 300) }); }
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const pid = whisper?.pid;
  whisper = null;
  await killTree(pid);
  process.exit(code);
}

// The channel is open from the first instant: the Hub closing stdin during start-up still stops whisper-server.
// One request at a time (the GPU and the extractor are not shared across requests); requests wait for "ready".
const queue = [];
let busy = false;
const pump = async () => { if (busy || !ready) return; busy = true; while (queue.length && !stopping) await handle(queue.shift()); busy = false; };
readline.createInterface({ input: process.stdin }).on("line", (line) => { let msg; try { msg = JSON.parse(line); } catch { return; } queue.push(msg); pump(); });
process.stdin.on("end", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

(async () => {
  try {
    const sv = loadSpeakerModel();
    const stt = await startWhisper();
    if (stopping) return;
    ready = true;
    say({ kind: "ready", sv, stt });
    pump();
  } catch (error) {
    say({ kind: "fatal", error: String(error?.message || error).slice(0, 300) });
    await shutdown(1);
  }
})();
