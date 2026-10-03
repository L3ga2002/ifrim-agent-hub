import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";

/**
 * The local voice engines (M07 B1/B2), owned by the Hub. One child process (voice-worker.mjs, started by the supervisor) holds
 * the speaker model and drives whisper.cpp; the Hub talks to it only through stdin/stdout JSON lines. Nothing here sends audio
 * anywhere: the engines run on this computer, from files whose SHA-256 is pinned below (a changed binary or model is refused,
 * not silently used). Installed outside the repository and outside OneDrive, under the user's profile.
 *
 * Components (owner-approved M07 install package; see .ifrim/M07_INSTALL_MANIFEST.md):
 * - whisper.cpp v1.9.4 Windows CUDA 12.4 build (release b5130, MIT), large-v3-turbo q8_0 weights (MIT), Romanian forced;
 * - 3D-Speaker CAM++ VoxCeleb speaker model (Apache-2.0) through sherpa-onnx-node 1.13.8 (Apache-2.0, npm, exact version).
 */
export const VOICE_COMPONENTS = Object.freeze({
  whisper: { version: "1.9.4 (b5130, CUDA 12.4)", dir: "whisper-1.9.4-cu124/Release", exe: "whisper-server.exe", license: "MIT",
    treeSha256: "3c80b88ee4b08d05ad001ab79e07271e327a1413aa324325545378325bde7bbc" },
  stt: { file: "models/ggml-large-v3-turbo-q8_0.bin", bytes: 874188075, sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1", license: "MIT (OpenAI Whisper weights)" },
  sv: { file: "models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx", bytes: 29596978, sha256: "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b", license: "Apache-2.0 (3D-Speaker)", dim: 512 },
  sherpa: { npm: "sherpa-onnx-node", version: "1.13.8", license: "Apache-2.0" },
});
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "voice-worker.mjs");
const READY_TIMEOUT_MS = 120000;
const REQUEST_TIMEOUT_MS = 45000;
const IDLE_STOP_MS = 30 * 60000;
/** Words that bias the Romanian transcription toward the Hub's vocabulary (names the owner says). */
export const STT_PROMPT = "Lega, Hub, ProDelivery, Codex, Claude, misiune, plan, confirm, execută, oprește.";

export function defaultVoiceRoot(env = process.env) {
  // Not %LOCALAPPDATA%: a process started from a packaged (MSIX) app sees a redirected copy of AppData, so the files would
  // exist for one launcher and not for another.
  return env.IFRIM_VOICE_ROOT ? path.resolve(env.IFRIM_VOICE_ROOT) : path.join(os.homedir(), "IfrimHub", "voice");
}

export async function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** Canonical hash of a directory: sorted "relative/path<TAB>sha256" lines (so any added, removed or changed file counts). */
export async function treeHash(dir) {
  const files = [];
  const walk = (d, rel = "") => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile()) files.push(r); } };
  walk(dir);
  files.sort();
  const h = crypto.createHash("sha256");
  for (const rel of files) h.update(`${rel}\t${await fileSha256(path.join(dir, ...rel.split("/")))}\n`);
  return h.digest("hex");
}

export function createVoiceEngine({ config, supervisor, clock = () => new Date(), onEvent = () => {} }) {
  const fixture = config.testMode ? config.voiceWorker || null : null;
  const root = config.voiceRoot || defaultVoiceRoot();
  const paths = {
    root, release: path.join(root, ...VOICE_COMPONENTS.whisper.dir.split("/")), whisperExe: path.join(root, ...VOICE_COMPONENTS.whisper.dir.split("/"), VOICE_COMPONENTS.whisper.exe),
    stt: path.join(root, ...VOICE_COMPONENTS.stt.file.split("/")), sv: path.join(root, ...VOICE_COMPONENTS.sv.file.split("/")), publicDir: path.join(root, "empty-public"),
  };
  let state = { status: "stopped", detail: null, gpu: null, readyAt: null, startupMs: null, lastUsedAt: null };
  let integrity = null; // { ok, problems, checkedAt, stamp }
  let starting = null;
  let seq = 0;
  const pending = new Map();
  const KEY = "voice-worker";

  // Size and mtime of every file that is hashed (the whole whisper.cpp Release folder, both models): a changed DLL is re-verified.
  const stampOf = () => {
    try {
      const files = [...fs.readdirSync(paths.release).map((n) => path.join(paths.release, n)), paths.stt, paths.sv];
      return files.map((file) => { const st = fs.statSync(file); return `${path.basename(file)}:${st.size}:${st.mtimeMs}`; }).join("|");
    } catch { return null; }
  };

  /** Which files are present (no hashing): what the setup screen shows before anything is verified. */
  function installation() {
    if (fixture) return { installed: true, fixture: true, missing: [] };
    const missing = [];
    if (!fs.existsSync(paths.whisperExe)) missing.push(`whisper.cpp ${VOICE_COMPONENTS.whisper.version}`);
    if (!fs.existsSync(paths.stt)) missing.push("modelul de transcriere (large-v3-turbo q8_0)");
    if (!fs.existsSync(paths.sv)) missing.push("modelul de vorbitor (CAM++)");
    let sherpa = null;
    try { sherpa = JSON.parse(fs.readFileSync(path.join(config.hubRoot, "node_modules", "sherpa-onnx-node", "package.json"), "utf8")).version; } catch { /* absent */ }
    if (sherpa !== VOICE_COMPONENTS.sherpa.version) missing.push(`sherpa-onnx-node ${VOICE_COMPONENTS.sherpa.version}${sherpa ? ` (găsit ${sherpa})` : ""}`);
    return { installed: missing.length === 0, missing, root };
  }

  /** SHA-256 of the binaries and models against the pinned values; cached until a file's size or mtime changes. */
  async function verifyIntegrity({ force = false } = {}) {
    if (fixture) return { ok: true, fixture: true, problems: [] };
    const stamp = stampOf();
    if (!force && integrity && integrity.stamp === stamp) return integrity;
    const problems = [];
    const inst = installation();
    if (!inst.installed) problems.push(...inst.missing.map((m) => `lipsește ${m}`));
    else {
      const [tree, stt, sv] = await Promise.all([treeHash(paths.release), fileSha256(paths.stt), fileSha256(paths.sv)]);
      if (tree !== VOICE_COMPONENTS.whisper.treeSha256) problems.push("binarele whisper.cpp diferă de cele instalate și verificate");
      if (stt !== VOICE_COMPONENTS.stt.sha256) problems.push("modelul de transcriere diferă de cel verificat");
      if (sv !== VOICE_COMPONENTS.sv.sha256) problems.push("modelul de vorbitor diferă de cel verificat");
    }
    integrity = { ok: problems.length === 0, problems, checkedAt: clock().toISOString(), stamp };
    return integrity;
  }

  // Each start is a generation: a late exit or message of an older worker never touches the state of a newer one.
  let generation = 0;

  function onLineOf(gen) {
    return (line) => {
      if (gen !== generation) return;
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.kind === "ready") {
        const at = clock().toISOString();
        // The idle clock starts at readiness: an engine warmed and never used is still stopped after the idle period.
        state = { ...state, status: "ready", detail: null, gpu: Boolean(msg.stt?.gpu), readyAt: at, lastUsedAt: at, startupMs: msg.stt?.startupMs ?? null, svDim: msg.sv?.dim ?? null, failedAt: null };
        starting?.resolve(); return;
      }
      if (msg.kind === "fatal") { state = { ...state, status: "failed", detail: String(msg.error || "eroare").slice(0, 300), failedAt: clock().toISOString() }; starting?.reject(new HubError("tool", `Motorul vocal local nu a pornit: ${state.detail}`)); return; }
      if (msg.kind === "stt-exited") { state = { ...state, status: "failed", detail: "whisper-server s-a oprit; repornesc la următoarea cerere", failedAt: clock().toISOString() }; return; }
      const waiter = msg.id && pending.get(msg.id);
      if (waiter) { pending.delete(msg.id); clearTimeout(waiter.timer); if (msg.ok) waiter.resolve(msg); else waiter.reject(new HubError("tool", `Motorul vocal local: ${String(msg.error).slice(0, 200)}`)); }
    };
  }

  async function ensure() {
    if (state.status === "ready" && supervisor.get(KEY) && !supervisor.get(KEY).exited) return state;
    if (starting) return starting.promise;
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const handle = { promise, resolve, reject };
    starting = handle;
    const gen = ++generation;
    (async () => {
      try {
        const inst = installation();
        if (!inst.installed) throw new HubError("tool", `Motorul vocal local nu e instalat: ${inst.missing.join(", ")}`);
        state = { ...state, status: "verifying", detail: "verific amprentele fișierelor" };
        const check = await verifyIntegrity();
        if (!check.ok) { state = { ...state, status: "integrity_failed", detail: check.problems.join("; ") }; throw new HubError("tool", `Motorul vocal refuzat: ${check.problems.join("; ")}`); }
        state = { ...state, status: "starting", detail: "încarc modelele (GPU dacă există)" };
        // A previous worker (stopping, or exited) must be gone before the next one takes the supervisor key.
        const previous = supervisor.get(KEY);
        if (previous && !previous.exited) await supervisor.stop(KEY, { graceMs: 2000 });
        supervisor.forget(KEY);
        const cfg = Buffer.from(JSON.stringify({ whisperExe: paths.whisperExe, sttModel: paths.stt, svModel: paths.sv, publicDir: paths.publicDir, threads: 6, language: "ro", hubRoot: config.hubRoot })).toString("base64");
        fs.mkdirSync(paths.publicDir, { recursive: true });
        const record = supervisor.start({ key: KEY, label: "voce locală (whisper.cpp + CAM++)", executable: process.execPath, args: [fixture || WORKER, "--config", cfg], cwd: config.hubRoot, env: fixture ? config.voiceWorkerEnv || {} : {}, onStdoutLine: onLineOf(gen) });
        record.exit.then((exit) => {
          if (gen !== generation) return; // an older worker: its exit concerns nothing current
          if (state.status !== "stopped") state = { ...state, status: exit.code === 0 ? "stopped" : "failed", detail: exit.code === 0 ? null : `procesul vocal s-a oprit (${exit.code})`, failedAt: exit.code === 0 ? state.failedAt : clock().toISOString() };
          for (const [id, w] of pending) { clearTimeout(w.timer); w.reject(new HubError("tool", "Motorul vocal local s-a oprit")); pending.delete(id); }
          handle.reject(new HubError("tool", "Motorul vocal local s-a oprit la pornire"));
        });
        const timer = setTimeout(() => handle.reject(new HubError("tool", "Motorul vocal local nu a pornit în 120 s")), READY_TIMEOUT_MS);
        timer.unref?.();
        await promise.finally(() => clearTimeout(timer));
      } catch (error) { handle.reject(error); }
    })();
    try { await promise; onEvent({ type: "voice.engine_ready", gpu: state.gpu, startupMs: state.startupMs }); return state; }
    catch (error) {
      // The failure stays visible (setup, status) after the half-started worker is cleaned up; integrity refusals keep their own state.
      const failed = state.status === "integrity_failed" ? state : { ...state, status: "failed", detail: state.status === "failed" && state.detail ? state.detail : String(error.message).slice(0, 300) };
      if (gen === generation) {
        await stop().catch(() => {});
        state = { ...state, status: failed.status, detail: failed.detail, failedAt: clock().toISOString() };
      }
      throw error;
    }
    finally { if (starting === handle) starting = null; }
  }

  /** One segment → { embedding?, transcript?, sttMs?, svMs?, sttEngine? } computed locally. */
  async function analyze(buffer, { embed = true, transcribe = false } = {}) {
    await ensure();
    const record = supervisor.get(KEY);
    if (!record || record.exited) throw new HubError("tool", "Motorul vocal local nu rulează");
    state.lastUsedAt = clock().toISOString();
    const id = `v${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new HubError("tool", "Motorul vocal local nu a răspuns la timp")); }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try { record.child.stdin.write(`${JSON.stringify({ id, op: "analyze", pcm: buffer.toString("base64"), embed, transcribe, prompt: transcribe ? STT_PROMPT : undefined })}\n`); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(new HubError("tool", `Motorul vocal local: ${error.message}`)); }
    });
  }

  async function stop() {
    if (!supervisor.get(KEY)) { state = { ...state, status: "stopped" }; return; }
    state = { ...state, status: "stopped", detail: null };
    await supervisor.stop(KEY, { graceMs: 3000 });
    supervisor.forget(KEY);
  }

  /** Frees the GPU memory after a long idle period (the next segment starts it again, ~10 s). */
  function tick() {
    const last = state.lastUsedAt || state.readyAt;
    if (state.status === "ready" && last && !pending.size && clock().getTime() - new Date(last).getTime() > IDLE_STOP_MS) stop().catch(() => {});
  }

  function status() {
    const inst = installation();
    return { installed: inst.installed, missing: inst.missing, fixture: Boolean(fixture), root: fixture ? null : root, engine: state.status, detail: state.detail, gpu: state.gpu, failedAt: state.failedAt || null,
      integrityStale: Boolean(integrity && !integrity.ok && integrity.stamp !== stampOf()),
      startupMs: state.startupMs, lastUsedAt: state.lastUsedAt, integrity: integrity ? { ok: integrity.ok, problems: integrity.problems, checkedAt: integrity.checkedAt } : null,
      components: { stt: `whisper.cpp ${VOICE_COMPONENTS.whisper.version} · large-v3-turbo q8_0 · română forțată`, sv: `3D-Speaker CAM++ VoxCeleb (${VOICE_COMPONENTS.sv.dim} dim) · sherpa-onnx ${VOICE_COMPONENTS.sherpa.version}` } };
  }

  return { ensure, analyze, stop, tick, status, installation, verifyIntegrity, paths };
}
