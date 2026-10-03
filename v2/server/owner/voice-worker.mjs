// Ifrim Agent Hub — local voice worker (M07). A child process of the Hub (its supervisor owns and stops it); it speaks JSON
// lines on stdin/stdout and nothing else. It loads:
//  - the speaker model (3D-Speaker CAM++ VoxCeleb, ONNX, through sherpa-onnx-node) in-process;
//  - whisper.cpp's whisper-server (large-v3-turbo q8_0, Romanian forced) as ITS OWN child on a random 127.0.0.1 port.
// Native crashes stay in this process (the Hub restarts it on demand). whisper-server has no authentication and answers with
// "Access-Control-Allow-Origin: *": the port is random, bound to loopback only, its static folder is empty, and before use the
// worker checks that the process LISTENING on that port is the one it started (a squatter is refused). The Hub never accepts a
// transcript from anywhere but this worker's answer to its own request. stdin closing = stop (whisper-server is killed).
//
// argv: --config <base64 JSON {whisperExe, sttModel, svModel, publicDir, threads, language, prompt, hubRoot}>
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
let cfg;
try { cfg = JSON.parse(Buffer.from(arg("config") || "", "base64").toString("utf8")); } catch { cfg = null; }
const say = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
if (!cfg?.whisperExe || !cfg?.sttModel || !cfg?.svModel || !cfg?.hubRoot) { say({ kind: "fatal", error: "configurație lipsă" }); process.exit(2); }

let whisper = null;
let port = 0;
let extractor = null;
let gpu = null;
let stopping = false;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => new Promise((resolve) => {
  if (!pid) return resolve();
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  else { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } resolve(); }
});

/** The PID listening on 127.0.0.1:<port> (Windows: netstat; elsewhere unknown → null). */
function listenerPid(p) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    execFile("netstat", ["-ano", "-p", "TCP"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      const line = String(stdout).split(/\r?\n/).find((l) => /LISTENING/i.test(l) && l.includes(`127.0.0.1:${p} `));
      resolve(line ? Number(line.trim().split(/\s+/).at(-1)) : null);
    });
  });
}

async function startWhisper() {
  port = await freePort();
  const args = ["-m", cfg.sttModel, "-l", cfg.language || "ro", "-t", String(cfg.threads || 6), "-bs", "1", "-bo", "1", "-nt",
    "--host", "127.0.0.1", "--port", String(port), "--public", cfg.publicDir];
  const tail = [];
  whisper = spawn(cfg.whisperExe, args, { cwd: path.dirname(cfg.whisperExe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (chunk) => { for (const line of String(chunk).split(/\r?\n/)) { if (!line.trim()) continue; tail.push(line.slice(0, 200)); if (tail.length > 30) tail.shift();
    if (/ggml_cuda_init: found \d+ CUDA devices|using CUDA0 backend/.test(line)) gpu = true; } };
  whisper.stdout.on("data", keep); whisper.stderr.on("data", keep);
  whisper.on("exit", (code) => { const was = whisper; whisper = null; if (!stopping && was) { say({ kind: "stt-exited", code, tail: tail.slice(-5) }); process.exit(1); } });
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (!whisper) throw new Error(`whisper-server s-a oprit la pornire: ${tail.slice(-3).join(" | ")}`);
    try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) break; } catch { /* not yet */ }
    await sleep(400);
  }
  if (Date.now() - started >= 90000) throw new Error("whisper-server nu a răspuns în 90 s");
  const owner = await listenerPid(port);
  if (owner !== null && owner !== whisper.pid) throw new Error(`portul ${port} e ascultat de alt proces (pid ${owner}), nu de whisper-server (${whisper.pid})`);
  return { port, gpu: Boolean(gpu), startupMs: Date.now() - started, listenerChecked: owner !== null };
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

function wav(buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + buffer.length, 4); h.write("WAVE", 8, "ascii"); h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([h, buffer]);
}

async function transcribe(buffer, prompt) {
  if (!whisper) throw new Error("motorul de transcriere nu rulează");
  const t = Date.now();
  const form = new FormData();
  form.append("file", new Blob([wav(buffer)], { type: "audio/wav" }), "segment.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("language", cfg.language || "ro");
  if (prompt) form.append("prompt", String(prompt).slice(0, 200));
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`transcriere HTTP ${res.status}`);
  const data = await res.json();
  return { text: String(data.text || "").replace(/\s+/g, " ").trim(), ms: Date.now() - t };
}

async function handle(msg) {
  const { id, op } = msg;
  try {
    if (op === "status") return say({ id, ok: true, stt: { port: Boolean(port), gpu: Boolean(gpu), running: Boolean(whisper) }, sv: { dim: extractor?.dim || null } });
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
let ready = false;
const pump = async () => { if (busy || !ready) return; busy = true; while (queue.length) await handle(queue.shift()); busy = false; };
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
