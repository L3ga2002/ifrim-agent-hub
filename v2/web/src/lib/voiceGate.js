// Voice gate orchestration in the page (M06 §08–§10): microphone → AudioWorklet (holds each sentence) → local features →
// Hub verification (features only, over loopback) → release or drop → the track that goes to Lega. Also enrolment capture.
import { api } from "../api.js";
import { segmentFeatures, envelope, bestCorrelation, isVirtualDevice } from "./voiceFeatures.js";
import { legaLevels } from "./legaLevels.js";

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
  return { legaOverlap: Math.round(legaOverlap * 100) / 100, envelopeCorrelation, virtualDevice: isVirtualDevice(trackLabel) };
}

/**
 * Wraps the microphone stream. `strict`: hold each sentence until it is verified (true by default). Returns the track to send,
 * plus a close(). `onDecision({ result, reason, flags, ms })` reports every decision (shown to the owner; not stored by the Hub).
 */
export async function createVoiceGate(stream, { strict = true, onDecision = () => {} } = {}) {
  startLegaHistory();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.audioWorklet.addModule("/voice-gate-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "ifrim-voice-gate", { processorOptions: { strict }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const dest = ctx.createMediaStreamDestination();
  source.connect(node); node.connect(dest);
  const label = stream.getAudioTracks()[0]?.label || "";
  let closed = false;
  node.port.onmessage = async (event) => {
    const m = event.data || {};
    if (m.type !== "segment" || closed) return;
    const t0 = performance.now();
    const durMs = (m.pcm.length / m.sampleRate) * 1000;
    let decision;
    try {
      const features = segmentFeatures(m.pcm, m.sampleRate);
      const flags = { ...localFlags(m.pcm, m.sampleRate, t0, durMs, label), playbackLike: features.playbackLike };
      decision = await api("/api/voice/verify", { method: "POST", body: { features, flags } });
    } catch (error) { decision = { result: "UNCERTAIN", reason: `verificarea nu a rulat: ${error.message}` }; }
    if (closed) return;
    node.port.postMessage({ type: decision.result === "MATCH" ? "release" : "drop", id: m.id });
    onDecision({ ...decision, ms: Math.round(performance.now() - t0), segmentMs: Math.round(durMs) });
  };
  return {
    track: dest.stream.getAudioTracks()[0],
    setStrict: (value) => node.port.postMessage({ type: "strict", value }),
    close() { closed = true; try { node.port.postMessage({ type: "flush" }); source.disconnect(); node.disconnect(); ctx.close(); } catch { /* closed */ } },
  };
}

/**
 * Records one enrolment sample (the owner reads a sentence). Only its summary features leave this function; the audio is
 * dropped as soon as they are computed.
 */
export async function recordSample(seconds = 4) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(e.inputBuffer.getChannelData(0).slice());
    source.connect(proc); proc.connect(ctx.destination);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    proc.disconnect(); source.disconnect();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total); let off = 0; for (const c of chunks) { pcm.set(c, off); off += c.length; }
    const label = stream.getAudioTracks()[0]?.label || "";
    const features = segmentFeatures(pcm, ctx.sampleRate);
    pcm.fill(0);
    return { features, virtualDevice: isVirtualDevice(label) };
  } finally { stream.getTracks().forEach((t) => t.stop()); ctx.close(); }
}

export const ENROLL_SENTENCES = Object.freeze([
  "Lega, hai să lucrăm la proiectul de astăzi și arată-mi ce a rămas deschis.",
  "Vreau să văd planul complet înainte să pornească vreo execuție.",
  "Arată-mi ce a schimbat Codex și ce a găsit Claude la review.",
  "Oprește tot dacă apare ceva neprevăzut și spune-mi de ce.",
  "Pentru clientul nostru vreau livrarea gata de verificare până diseară.",
  "Mâine dimineață începem cu sinteza și deciziile importante.",
]);
