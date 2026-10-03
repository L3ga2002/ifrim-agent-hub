// Synthetic voice segments for the M07 tests (no model, no microphone). A segment is 16 kHz PCM16:
//   [marker 31354][L][L samples = the UTF-8 bytes of the "spoken" text][quiet lead-in][a tone whose frequency names the speaker][quiet tail]
// The fake worker (fake-voice-worker.mjs) reads the text back as the "transcript" and the tone frequency as the "speaker".
// The quiet parts give the server's own quality analysis a realistic noise floor. This is a fixture, never a recording of a person.
export const MARKER = 31354;
const RATE = 16000;

export function voicePcm({ speaker = 10, text = "", seconds = 2.5, amplitude = 9000, quietSeconds = 0.4, clip = false } = {}) {
  const bytes = Buffer.from(String(text), "utf8");
  const quiet = Math.round(quietSeconds * RATE);
  const tone = Math.round(seconds * RATE);
  const total = 2 + bytes.length + quiet + tone + quiet;
  const pcm = new Int16Array(total);
  pcm[0] = MARKER; pcm[1] = bytes.length;
  for (let i = 0; i < bytes.length; i += 1) pcm[2 + i] = bytes[i];
  let o = 2 + bytes.length;
  // Deterministic low noise (an LCG), so the quality numbers are stable across runs.
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * 60; };
  for (let i = 0; i < quiet; i += 1) pcm[o++] = Math.round(noise());
  const f = speakerFrequency(speaker);
  for (let i = 0; i < tone; i += 1) { const v = Math.sin((2 * Math.PI * f * i) / RATE) * amplitude; pcm[o++] = clip ? Math.max(-32768, Math.min(32767, Math.round(v * 4))) : Math.round(v); }
  for (let i = 0; i < quiet; i += 1) pcm[o++] = Math.round(noise());
  return pcm;
}

export const speakerFrequency = (speaker) => 100 + 20 * speaker;

export function toBuffer(pcm) {
  const b = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) b.writeInt16LE(pcm[i], i * 2);
  return b;
}

/** Inverse of voicePcm (used by the fake worker). */
export function readVoicePcm(buffer) {
  const n = buffer.length / 2;
  const at = (i) => buffer.readInt16LE(i * 2);
  let text = "";
  let start = 0;
  if (n > 2 && at(0) === MARKER) {
    const len = at(1);
    const bytes = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) bytes[i] = at(2 + i) & 0xff;
    text = bytes.toString("utf8");
    start = 2 + len;
  }
  // Speaker: zero crossings of the loud part.
  let crossings = 0; let loud = 0; let prev = 0;
  for (let i = start; i < n; i += 1) {
    const v = at(i);
    if (Math.abs(v) < 1000) continue;
    loud += 1;
    if (prev !== 0 && Math.sign(v) !== Math.sign(prev)) crossings += 1;
    prev = v;
  }
  const f = loud ? (crossings / 2) / (loud / RATE) : 0;
  return { text, speaker: loud ? Math.round((f - 100) / 20) : null, loudSamples: loud };
}
