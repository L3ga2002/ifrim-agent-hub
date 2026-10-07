import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";

/**
 * Pure audio helpers for the local voice path (M07). The browser sends one speech segment as raw PCM: 16-bit little-endian,
 * mono, 16 kHz (it resamples before sending). Nothing here keeps audio: callers hash it, analyse it, hand it to the local
 * engines and drop the buffer.
 */
export const VOICE_SAMPLE_RATE = 16000;
export const MAX_SEGMENT_SECONDS = 15;
export const MIN_SEGMENT_MS = 300;
const FRAME = 320; // 20 ms at 16 kHz
const CLIP = 32700;

/** Raw request body → Int16Array (validated length/alignment). */
export function decodePcm16(buffer, { maxSeconds = MAX_SEGMENT_SECONDS } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) throw new HubError("validation", "Segment audio gol");
  if (buffer.length % 2 !== 0) throw new HubError("validation", "Segmentul trebuie să fie PCM pe 16 biți (lungime pară)");
  const samples = buffer.length / 2;
  if (samples > maxSeconds * VOICE_SAMPLE_RATE) throw new HubError("validation", `Segment prea lung (peste ${maxSeconds} s)`);
  if ((samples / VOICE_SAMPLE_RATE) * 1000 < MIN_SEGMENT_MS) throw new HubError("validation", "Segment prea scurt");
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = buffer.readInt16LE(i * 2);
  return out;
}

export const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * Signal quality, measured on the server (never taken from the client): 20 ms frames, an adaptive noise floor (the 10th
 * percentile of frame energy), speech = frames 10 dB above that floor and above -50 dBFS. SNR = mean speech level minus
 * the floor; clipping = share of samples at full scale.
 */
export function analyseQuality(pcm) {
  const frames = [];
  for (let o = 0; o + FRAME <= pcm.length; o += FRAME) {
    let s = 0;
    for (let i = o; i < o + FRAME; i += 1) s += pcm[i] * pcm[i];
    const rms = Math.sqrt(s / FRAME) / 32768;
    frames.push(20 * Math.log10(Math.max(rms, 1e-6)));
  }
  let clipped = 0;
  for (let i = 0; i < pcm.length; i += 1) if (pcm[i] >= CLIP || pcm[i] <= -CLIP) clipped += 1;
  const sorted = frames.slice().sort((a, b) => a - b);
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -120;
  const speech = frames.filter((db) => db > floor + 10 && db > -50);
  const speechLevel = speech.length ? speech.reduce((a, b) => a + b, 0) / speech.length : floor;
  // M11 voice diagnostic (additive): frames that stand out of the floor but stay under the -50 dBFS line are counted apart, so a
  // segment refused as "too short" says whether the voice was short or only too quiet for the line. They never count as speech.
  const quiet = frames.filter((db) => db > floor + 10 && db <= -50);
  return {
    durationMs: Math.round((pcm.length / VOICE_SAMPLE_RATE) * 1000),
    speechMs: speech.length * 20,
    snrDb: Number((speechLevel - floor).toFixed(1)),
    peakDb: Number((sorted.at(-1) ?? -120).toFixed(1)),
    clipping: Number((pcm.length ? clipped / pcm.length : 0).toFixed(4)),
    floorDb: Number(floor.toFixed(1)),
    speechLevelDb: speech.length ? Number(speechLevel.toFixed(1)) : null,
    quietSpeechMs: quiet.length * 20,
  };
}

/**
 * Only the spoken part, for the speaker model (M07, measured on the live owner flow): a push-to-talk capture starts and ends
 * with silence/room noise, and an embedding of that silence makes every sample look alike (a stranger's segment drifts toward
 * MATCH) while the owner's own samples disagree (enrolment refused). Frames 10 dB over the floor (and over -50 dBFS) are
 * speech; the span from the first to the last such frame is kept, padded by 160 ms. Without speech, the input is returned.
 */
export function trimToSpeech(pcm) {
  const levels = [];
  for (let o = 0; o + FRAME <= pcm.length; o += FRAME) {
    let s = 0;
    for (let i = o; i < o + FRAME; i += 1) s += pcm[i] * pcm[i];
    levels.push(20 * Math.log10(Math.max(Math.sqrt(s / FRAME) / 32768, 1e-6)));
  }
  if (!levels.length) return pcm;
  const floor = levels.slice().sort((a, b) => a - b)[Math.floor(levels.length * 0.1)];
  const speech = levels.map((db) => db > floor + 10 && db > -50);
  const first = speech.indexOf(true);
  const last = speech.lastIndexOf(true);
  if (first < 0) return pcm;
  const padFrames = 8;
  return pcm.subarray(Math.max(0, (first - padFrames) * FRAME), Math.min(pcm.length, (last + 1 + padFrames) * FRAME));
}

/** Float32 in [-1, 1] for the speaker model. */
export const toFloat = (pcm) => Float32Array.from(pcm, (v) => v / 32768);

/** A minimal RIFF/WAVE (PCM16 mono 16 kHz) around the samples, for the local transcription engine. */
export function wavFromPcm16(pcm) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) data.writeInt16LE(pcm[i], i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(VOICE_SAMPLE_RATE, 24); header.writeUInt32LE(VOICE_SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii"); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Int16 samples → the little-endian byte buffer the worker protocol carries (base64). */
export function pcm16ToBuffer(pcm) {
  const b = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) b.writeInt16LE(pcm[i], i * 2);
  return b;
}

const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Array.from(v, (x) => x / n); };
export const normalize = norm;
export function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; }
export function centroidOf(vectors) {
  const dims = vectors[0].length;
  const sum = new Array(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i += 1) sum[i] += v[i];
  return norm(sum.map((x) => x / vectors.length));
}

/**
 * Whisper sometimes "hears" a stock phrase in silence or noise (subtitle credits, "thanks for watching"). Such a transcript
 * is discarded instead of being treated as the owner's words.
 */
const HALLUCINATIONS = [/mul[țt]umesc pentru vizionare/i, /mul[țt]umim pentru vizionare/i, /v[ăa] mul[țt]umim pentru vizionare/i, /nu uita[țt]i s[ăa] v[ăa] abona[țt]i/i,
  /subtitr(are|ări|at)/i, /amara\.org/i, /thanks? for watching/i, /^\s*[.…,!?-]*\s*$/];
export function isLikelyHallucination(text, quality) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (HALLUCINATIONS.some((re) => re.test(t))) return true;
  // Many words over very little speech is not something a person said in that time.
  const words = t.split(/\s+/).length;
  return quality && quality.speechMs < 400 && words > 3;
}
