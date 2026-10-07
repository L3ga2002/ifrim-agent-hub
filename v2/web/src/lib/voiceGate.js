// Voice gate and voice capture in the page (M06 §08–§10, M07 §12–§15).
//
// microphone → AudioWorklet (holds each sentence whole) → 16 kHz PCM → the HUB decides (local speaker model on this computer,
// owner session only) → release (MATCH) or drop → the track that goes to Lega's cloud route. Nothing unaccepted reaches the
// cloud: the held sentence is played into Lega's track only after the Hub answered MATCH. The page's own checks (Lega's voice
// echoed in the microphone, a virtual device, playback-like audio) travel as flags that can only LOWER the Hub's decision.
//
// Also: one-segment capture for enrolment and for the spoken confirmation of a plan (push-to-talk), with the same
// microphone settings as Lega, so the profile is built from the audio it will be compared with.
import { apiRaw } from "../api.js";
import { segmentFeatures, envelope, bestCorrelation, isVirtualDevice } from "./voiceFeatures.js";
import { legaLevels } from "./legaLevels.js";

export const MIC_CONSTRAINTS = Object.freeze({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
const TARGET_RATE = 16000;
const MAX_SECONDS = 15;
const SAMPLE_HZ = 20; // Lega output level history (for "is Lega's own voice in the microphone?")
const history = []; // [{ t, level }]
let sampler = null;
function startLegaHistory() {
  if (sampler) return;
  sampler = setInterval(() => { history.push({ t: performance.now(), level: legaLevels.muted ? 0 : legaLevels.lega || 0 }); if (history.length > SAMPLE_HZ * 30) history.shift(); }, 1000 / SAMPLE_HZ);
}

/** Flags of the local suspicious-input checks for a segment that ended at `endedMs` (performance.now()) and lasted `durMs`. */
function localFlags(pcm, sampleRate, endedMs, durMs, trackLabel) {
  const from = endedMs - durMs;
  const window = history.filter((h) => h.t >= from && h.t <= endedMs);
  const legaOverlap = window.length ? window.filter((h) => h.level > 0.08).length / window.length : 0;
  const mic = envelope(pcm, sampleRate, 1000 / SAMPLE_HZ);
  const lega = window.map((h) => h.level);
  const envelopeCorrelation = lega.length >= 10 && lega.some((x) => x > 0.05) ? bestCorrelation(mic.slice(-lega.length), lega, 6) : 0;
  let playbackLike = false;
  try { playbackLike = Boolean(segmentFeatures(pcm, sampleRate).playbackLike); } catch { /* too short to tell */ }
  return { legaOverlap: Math.round(legaOverlap * 100) / 100, envelopeCorrelation: Math.round(envelopeCorrelation * 100) / 100, virtualDevice: isVirtualDevice(trackLabel), playbackLike };
}

/** Float32 at the device rate → PCM16 little-endian at 16 kHz (the browser's own resampler, with its anti-aliasing filter). */
export async function toPcm16k(pcm, sampleRate) {
  let mono = pcm;
  if (sampleRate !== TARGET_RATE) {
    const length = Math.max(1, Math.round((pcm.length * TARGET_RATE) / sampleRate));
    const offline = new OfflineAudioContext(1, length, TARGET_RATE);
    const buffer = offline.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);
    const src = offline.createBufferSource();
    src.buffer = buffer; src.connect(offline.destination); src.start();
    mono = (await offline.startRendering()).getChannelData(0);
  }
  // A held sentence is capped at 15 s at the device rate; resampling rounding must not push it over the Hub's 15 s limit.
  const n = Math.min(mono.length, MAX_SECONDS * TARGET_RATE);
  const out = new DataView(new ArrayBuffer(n * 2));
  for (let i = 0; i < n; i += 1) out.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))), true);
  return out.buffer;
}

const query = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/** One segment to the Hub: { utteranceId, result, reason, transcript?, transcriptStatus, ... }. Needs the owner session. */
export function sendSegment(bytes, { purpose, legaSessionId = null, envelopeId = null, flags = {}, seg = null } = {}) {
  return apiRaw(`/api/voice/utterances?${query({ purpose, legaSession: legaSessionId, envelope: envelopeId })}`, bytes, { headers: { "X-Voice-Flags": JSON.stringify(flags), ...(seg ? { "X-Voice-Seg": JSON.stringify(seg) } : {}) } });
}

/** M11: one segment to the local voice diagnostic (no utterance row, no binding: it can never confirm or release anything). */
export function diagnoseSegment(bytes, { flags = {}, seg = null } = {}) {
  return apiRaw("/api/voice/diagnostics", bytes, { headers: { "X-Voice-Flags": JSON.stringify(flags), ...(seg ? { "X-Voice-Seg": JSON.stringify(seg) } : {}) } });
}

/**
 * Wraps the microphone stream (always strict: a "pass" mode would only look like a filter). Returns the track to send to
 * Lega, plus close(). `context()` gives { legaSessionId, envelopeId } at the moment a sentence ends (the plan on screen, if
 * any, so a spoken "yes" is bound to it). `onDecision(decision)` reports each decision (shown to the owner).
 */
export async function createVoiceGate(stream, { onDecision = () => {}, context = () => ({}), diagnostic = false, onDropped = () => {} } = {}) {
  startLegaHistory();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.audioWorklet.addModule("/voice-gate-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "ifrim-voice-gate", { processorOptions: { strict: true }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const dest = ctx.createMediaStreamDestination();
  source.connect(node); node.connect(dest);
  const label = stream.getAudioTracks()[0]?.label || "";
  let closed = false;
  node.port.onmessage = async (event) => {
    const m = event.data || {};
    // M11: a click / knock the worklet refused to send (no audio here, only its timing) — shown by the diagnostic.
    if (m.type === "dropped" && !closed) { onDropped({ reason: m.reason, voicedMs: m.voicedMs, durationMs: m.durationMs }); return; }
    if (m.type !== "segment" || closed) return;
    const t0 = performance.now();
    const durMs = (m.pcm.length / m.sampleRate) * 1000;
    const where = context() || {};
    let decision;
    try {
      const flags = localFlags(m.pcm, m.sampleRate, t0, durMs, label);
      const bytes = await toPcm16k(m.pcm, m.sampleRate);
      m.pcm.fill(0);
      // M11 diagnostic mode: the same microphone, worklet and speaker path, sent to the diagnostic (nothing released to Lega).
      decision = diagnostic ? await diagnoseSegment(bytes, { flags, seg: m.seg || null })
        : await sendSegment(bytes, { purpose: "gate", legaSessionId: where.legaSessionId || null, envelopeId: where.envelopeId || null, flags, seg: m.seg || null });
    } catch (error) { decision = { result: "UNCERTAIN", reason: error.status === 401 ? "filtrul cere sesiunea ta de proprietar (Windows Hello)" : `verificarea nu a rulat: ${error.message}` }; }
    if (closed) return;
    const result = diagnostic ? decision.speaker?.result : decision.result;
    node.port.postMessage({ type: !diagnostic && result === "MATCH" ? "release" : "drop", id: m.id });
    onDecision({ ...decision, envelopeId: where.envelopeId || null, ms: Math.round(performance.now() - t0), segmentMs: Math.round(durMs) });
  };
  return {
    track: dest.stream.getAudioTracks()[0],
    close() { closed = true; try { node.port.postMessage({ type: "flush" }); source.disconnect(); node.disconnect(); ctx.close(); } catch { /* closed */ } },
  };
}

/** The audio inputs (labels appear after the microphone permission). */
export async function listMicrophones() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput").map((d) => ({ id: d.deviceId, label: d.label || "microfon" })); }
  catch { return []; }
}

/**
 * Records ONE spoken segment: starts listening, ends ~0.9 s after the speech stops (or at maxSeconds, or on cancel()),
 * returns { bytes (PCM16 16 kHz), durationMs, flags }. The raw float audio is zeroed once converted; the microphone is
 * released at the end. `onLevel(0..1)` drives a level meter.
 */
export function recordSegment({ deviceId = null, maxSeconds = 8, onLevel = () => {}, silenceStopMs = 900 } = {}) {
  let cancel = () => {};
  const promise = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const label = stream.getAudioTracks()[0]?.label || "";
    try {
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const chunks = [];
      let noise = 1e-4; let spoke = false; let quietMs = 0; let stopped = false;
      const done = new Promise((resolve) => {
        cancel = () => { stopped = true; resolve("cancel"); };
        const limit = setTimeout(() => resolve("max"), maxSeconds * 1000);
        proc.onaudioprocess = (e) => {
          if (stopped) return;
          const data = e.inputBuffer.getChannelData(0);
          chunks.push(data.slice());
          let energy = 0; for (let i = 0; i < data.length; i += 1) energy += data[i] * data[i];
          energy /= data.length;
          onLevel(Math.min(1, Math.sqrt(energy) * 8));
          const voiced = energy > noise * 8 && energy > 1e-6;
          if (!voiced) noise = noise * 0.98 + energy * 0.02;
          if (voiced) { spoke = true; quietMs = 0; } else if (spoke) quietMs += (data.length / ctx.sampleRate) * 1000;
          if (spoke && quietMs >= silenceStopMs) { clearTimeout(limit); resolve("silence"); }
        };
      });
      source.connect(proc); proc.connect(ctx.destination);
      const why = await done;
      stopped = true;
      proc.disconnect(); source.disconnect();
      if (why === "cancel") return null;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const pcm = new Float32Array(total); let off = 0; for (const c of chunks) { pcm.set(c, off); off += c.length; }
      const flags = { virtualDevice: isVirtualDevice(label), playbackLike: (() => { try { return Boolean(segmentFeatures(pcm, ctx.sampleRate).playbackLike); } catch { return false; } })() };
      const bytes = await toPcm16k(pcm, ctx.sampleRate);
      pcm.fill(0);
      return { bytes, durationMs: Math.round((total / ctx.sampleRate) * 1000), flags, spoke };
    } finally { onLevel(0); stream.getTracks().forEach((t) => t.stop()); ctx.close(); }
  })();
  return { promise, cancel: () => cancel() };
}
