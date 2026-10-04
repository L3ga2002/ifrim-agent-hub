// Ifrim Agent Hub — pure helpers of the local voice worker (M09 AUDIO hardening). Kept apart from voice-worker.mjs so the tests can
// assert the exact whisper-server command line, the listener check and the bounded response read without starting a model.
//
// whisper-server (whisper.cpp 1.9.4) has no authentication, no TLS, no unix socket / named pipe and answers with
// "Access-Control-Allow-Origin: *" (see .ifrim/M07_SECURITY_READINESS.md). What the worker can do, and does here:
//  - bind 127.0.0.1 only (constant; never a configurable host), an empty --public folder, no --convert (no ffmpeg in the server);
//  - check that EVERY process LISTENING on its port is the whisper-server it started, at start-up and again before each
//    transcription (a confirmation included); on Windows an unreadable netstat is a refusal, never a pass;
//  - read at most MAX_RESPONSE_BYTES of an /inference answer;
//  - report (only report) log lines that look like a model being (re)loaded after start-up, i.e. someone called /load;
//  - optionally move /inference to a random per-start path. OFF by default: `--inference-path` exists in `--help`, but
//    `--request-path` was broken in this build and the flag has NOT been verified against the real binary (a live check needs the
//    owner's approval to start whisper-server). It hides /inference only; /load, /health and / stay open.
import crypto from "node:crypto";

/** The only host whisper-server is ever bound to. Not configurable on purpose. */
export const WHISPER_HOST = "127.0.0.1";
/** An /inference answer for one ≤ 15 s segment is a few hundred bytes; anything near this cap is not our server's answer. */
export const MAX_RESPONSE_BYTES = 256 * 1024;
const INFERENCE_PATH_RE = /^\/[0-9a-f]{32}$/;

/** A random per-start inference path ("/" + 32 hex). */
export function randomInferencePath() {
  return `/${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * The exact whisper-server argv. `inferencePath` (optional) must be "/" + 32 lowercase hex. Never --convert, never another host.
 * cfg: { sttModel, language, threads, publicDir }.
 */
export function whisperServerArgs(cfg, port, inferencePath = null) {
  if (!cfg?.sttModel || !cfg?.publicDir) throw new Error("configurație whisper-server incompletă (model sau dosar public)");
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`port invalid pentru whisper-server: ${port}`);
  const language = String(cfg.language || "ro");
  if (!/^[a-z]{2,3}$|^auto$/.test(language)) throw new Error(`limbă invalidă pentru whisper-server: ${language}`);
  const threads = Number(cfg.threads || 6);
  if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw new Error(`număr de fire invalid: ${cfg.threads}`);
  const args = ["-m", String(cfg.sttModel), "-l", language, "-t", String(threads), "-bs", "1", "-bo", "1", "-nt",
    "--host", WHISPER_HOST, "--port", String(p), "--public", String(cfg.publicDir)];
  if (inferencePath !== null && inferencePath !== undefined) {
    if (!INFERENCE_PATH_RE.test(String(inferencePath))) throw new Error("calea de inferență trebuie să fie „/” urmat de 32 de caractere hex");
    args.push("--inference-path", String(inferencePath));
  }
  return args;
}

/** The URL of the inference endpoint for this start. */
export function inferenceUrl(port, inferencePath = null) {
  return `http://${WHISPER_HOST}:${Number(port)}${inferencePath || "/inference"}`;
}

/**
 * Every PID that LISTENS on TCP `port` in `netstat -ano` output, on any local address (127.0.0.1, 0.0.0.0, [::1], [::]).
 * A listening row is recognised by its state "LISTENING" OR by a wildcard foreign address ("0.0.0.0:0" / "[::]:0"), because
 * netstat translates the state name on a localized Windows. Returns unique PIDs in order of appearance ([] when none).
 * Input that is not a string → null (unknown, which the caller treats as a refusal on Windows).
 */
export function listenerPids(netstatText, port) {
  if (typeof netstatText !== "string") return null;
  const want = Number(port);
  if (!Number.isInteger(want) || want < 1 || want > 65535) return null;
  const out = [];
  for (const raw of netstatText.split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 4 || !/^TCP/i.test(cols[0])) continue;
    const local = cols[1];
    const foreign = cols[2];
    const colon = local.lastIndexOf(":");
    if (colon < 0 || Number(local.slice(colon + 1)) !== want || !/^\d+$/.test(local.slice(colon + 1))) continue;
    const listening = cols.some((c) => /^LISTEN(ING)?$/i.test(c)) || /^(0\.0\.0\.0|\[::\]|\*):(0|\*)$/.test(foreign);
    if (!listening) continue;
    const pid = Number(cols.at(-1));
    if (!Number.isInteger(pid) || pid < 0) continue;
    if (!out.includes(pid)) out.push(pid);
  }
  return out;
}

/**
 * Decision on the listener set. `pids` = listenerPids(...) result (null = netstat failed / unavailable).
 * - Windows: null or [] → refused (cannot prove the port is ours); any PID other than `expectedPid` → refused (squatter or a
 *   second listener).
 * - elsewhere (not a production platform for the Hub): null → allowed but reported as not checked.
 */
export function checkListeners({ pids, expectedPid, platform = process.platform }) {
  if (pids === null || pids === undefined) {
    if (platform === "win32") return { ok: false, checked: false, reason: "nu pot verifica ce proces ascultă portul motorului de transcriere (netstat indisponibil)" };
    return { ok: true, checked: false, reason: null };
  }
  if (!Array.isArray(pids) || pids.length === 0) return { ok: false, checked: true, reason: "niciun proces nu apare ascultând portul motorului de transcriere" };
  const foreign = pids.filter((p) => p !== expectedPid);
  if (foreign.length) return { ok: false, checked: true, reason: `portul motorului de transcriere e ascultat și de alt proces (pid ${foreign.join(", ")}), nu doar de whisper-server (${expectedPid})` };
  return { ok: true, checked: true, reason: null };
}

/**
 * Log lines that mean whisper.cpp is loading a model. At start-up they are expected; after "ready" they mean the /load endpoint
 * was called by someone else (whisper-server exposes it without authentication). The patterns are taken from whisper.cpp's
 * loader log messages and are NOT verified on this exact binary after a /load call (that needs a live run) — so the result is
 * only reported, never used to accept or refuse a transcript.
 */
export const TAMPER_PATTERNS = Object.freeze([
  /whisper_init_from_file(_with_params)?(_no_state)?\s*:\s*loading model/i,
  /whisper_model_load\s*:\s*loading model/i,
  /\bwhisper_init_with_params(_no_state)?\b/i,
]);
export function isTamperLine(line) {
  const s = String(line || "");
  return TAMPER_PATTERNS.some((re) => re.test(s));
}

/**
 * Reads a fetch Response body as text, refusing more than `maxBytes` (Content-Length checked first, then counted while streaming;
 * the stream is cancelled at the cap). Throws an Error with code "RESPONSE_TOO_LARGE".
 */
export async function readBoundedText(res, maxBytes = MAX_RESPONSE_BYTES) {
  const tooLarge = () => Object.assign(new Error(`răspunsul motorului de transcriere depășește ${maxBytes} octeți`), { code: "RESPONSE_TOO_LARGE" });
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) { try { await res.body?.cancel(); } catch { /* ignore */ } throw tooLarge(); }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw tooLarge(); }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

/** Bounded read + JSON.parse; a body that is not JSON → Error code "RESPONSE_INVALID". */
export async function readBoundedJson(res, maxBytes = MAX_RESPONSE_BYTES) {
  const text = await readBoundedText(res, maxBytes);
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("răspunsul motorului de transcriere nu e JSON valid"), { code: "RESPONSE_INVALID" }); }
}

/** 44-byte PCM16 mono 16 kHz WAV header + the samples (what whisper-server expects in the multipart "file" field). */
export function wavFromPcm16Mono16k(buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + buffer.length, 4); h.write("WAVE", 8, "ascii"); h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([h, buffer]);
}
