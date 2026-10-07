// Ifrim voice gate (M06 §09) — AudioWorklet. In STRICT mode nothing from the microphone reaches the output (the track that
// goes to Lega) until the main thread verified the speaker of that sentence: each utterance is held whole (silence in its
// place), handed to the page for LOCAL analysis, then either released (MATCH: played into the output at normal speed, so it
// arrives later by the length of the sentence plus the check) or dropped. Accepting one sentence never opens the
// microphone for the next one. In "pass" mode the input goes through unchanged (and the page says it is not filtered).
//
// M11 voice segmentation (2.13.2): short commands („Da”, „Pauză”, „Taci”) lost their first consonant because a segment began
// only at the first loud block. Now:
//   - PRE-ROLL: the last `preRollS` of audio before the first voiced block is kept in a ring and prepended to the segment;
//   - ABSOLUTE FLOOR: a block is voiced only above `absFloorDb` (-55 dBFS, measured) as well as 9 dB over the noise estimate (a digitally quiet,
//     noise-suppressed microphone no longer turns every tiny sound into "speech");
//   - NOISE TRACKING: the estimate falls fast and rises slowly (≈ 2 dB/s) even while a segment is open, so a steady louder
//     noise (a fan switched on) closes the segment instead of holding it open for 15 s;
//   - CLICKS: a segment with less than `minVoicedS` of voiced audio is dropped here and reported (no audio) as `dropped`;
//   - METADATA: every segment carries how it was cut (pre-roll, voiced time, levels, end reason) for the local diagnostic.
// The Hub still decides everything about the speaker; nothing here can raise a decision.
const BLOCK_DB = (energy) => 10 * Math.log10(Math.max(energy, 1e-12));

class IfrimVoiceGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    this.strict = o.strict !== false;
    this.maxSamples = Math.round(sampleRate * (o.maxUtteranceS || 15));
    this.minSpeech = Math.round(sampleRate * 0.3);
    this.minVoiced = Math.round(sampleRate * (o.minVoicedS ?? 0.08));
    this.hangSamples = Math.round(sampleRate * (o.endSilenceS || 0.6));
    this.preRoll = new Float32Array(Math.max(0, Math.round(sampleRate * (o.preRollS ?? 0.3))));
    this.ringPos = 0; this.ringFill = 0;
    // Owner probe 2026-10-07: speech at -24…-31 dBFS, room floor -77 dBFS, yet segments of 4–10 s around 0.6–1.5 s of speech — room
    // sounds between -70 and -55 kept the end from coming. The Hub counts speech only above -50 dBFS (owner/audio.mjs), so a block
    // is voiced only above -55 dBFS (5 dB under that line): the end comes ~0.6 s after the words.
    this.absFloor = 10 ** ((o.absFloorDb ?? -55) / 10);
    this.riseFactor = 10 ** ((o.noiseRiseDbPerS ?? 2) / 10 / (sampleRate / 128)); // per 128-sample block
    this.noise = null;
    this.speaking = false; this.silent = 0; this.voiced = 0;
    this.current = []; this.currentLen = 0; this.seq = 0;
    this.meta = null;
    this.pending = new Map(); // id → Float32Array (held until the decision)
    this.queue = []; this.queuePos = 0; // released segments being played out
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "release" && this.pending.has(m.id)) { this.queue.push(this.pending.get(m.id)); this.pending.delete(m.id); }
      else if (m.type === "drop") this.pending.delete(m.id);
      else if (m.type === "strict") this.strict = Boolean(m.value);
      else if (m.type === "flush") { this.pending.clear(); this.queue = []; this.queuePos = 0; this.current = []; this.currentLen = 0; this.speaking = false; this.meta = null; this.ringFill = 0; }
    };
  }
  remember(input) {
    const ring = this.preRoll;
    if (!ring.length) return;
    for (let i = 0; i < input.length; i += 1) { ring[this.ringPos] = input[i]; this.ringPos = (this.ringPos + 1) % ring.length; }
    this.ringFill = Math.min(ring.length, this.ringFill + input.length);
  }
  /** The ring's content, oldest first (what was heard just before the first voiced block). */
  takePreRoll() {
    const ring = this.preRoll; const n = this.ringFill;
    const out = new Float32Array(n);
    const start = (this.ringPos - n + ring.length) % (ring.length || 1);
    for (let i = 0; i < n; i += 1) out[i] = ring[(start + i) % ring.length];
    this.ringFill = 0;
    return out;
  }
  finish(endReason) {
    const ms = (n) => Math.round((n / sampleRate) * 1000);
    const meta = this.meta || {};
    if (this.currentLen >= this.minSpeech && this.voiced >= this.minVoiced) {
      const pcm = new Float32Array(this.currentLen);
      let off = 0; for (const c of this.current) { pcm.set(c, off); off += c.length; }
      const id = ++this.seq;
      this.pending.set(id, pcm);
      const copy = pcm.slice();
      const seg = { preRollMs: ms(meta.preRoll || 0), voicedMs: ms(this.voiced), durationMs: ms(this.currentLen), endReason,
        peakDb: Number((meta.peakDb ?? -120).toFixed(1)), voicedLevelDb: meta.voicedBlocks ? Number((meta.voicedDbSum / meta.voicedBlocks).toFixed(1)) : null,
        noiseDb: Number(BLOCK_DB(meta.noiseAtOnset ?? 0).toFixed(1)), sampleRate };
      this.port.postMessage({ type: "segment", id, pcm: copy, sampleRate, voicedMs: seg.voicedMs, seg, endedAt: currentTime }, [copy.buffer]);
    } else if (this.currentLen) {
      // Too little voiced audio to be a word (a click, a knock, a breath): never sent, only reported.
      this.port.postMessage({ type: "dropped", reason: this.voiced < this.minVoiced ? "click" : "short", voicedMs: ms(this.voiced), durationMs: ms(this.currentLen), endedAt: currentTime });
    }
    this.current = []; this.currentLen = 0; this.speaking = false; this.silent = 0; this.voiced = 0; this.meta = null;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!this.strict) { if (input) output.set(input); return true; }
    // Output: released segments only (else silence).
    for (let i = 0; i < output.length; i += 1) {
      const seg = this.queue[0];
      if (!seg) { output[i] = 0; continue; }
      output[i] = seg[this.queuePos++];
      if (this.queuePos >= seg.length) { this.queue.shift(); this.queuePos = 0; }
    }
    if (!input) return true;
    let energy = 0; for (let i = 0; i < input.length; i += 1) energy += input[i] * input[i];
    energy /= input.length;
    if (this.noise === null) this.noise = Math.max(energy, this.absFloor / 8);
    const voiced = energy > this.noise * 8 && energy > this.absFloor;
    // Falls fast toward a quieter room, rises slowly (also during a segment) toward a louder steady noise.
    this.noise = energy < this.noise ? this.noise * 0.9 + energy * 0.1 : Math.min(energy, this.noise * this.riseFactor);
    if (voiced && !this.speaking) {
      const pre = this.takePreRoll();
      this.meta = { preRoll: pre.length, noiseAtOnset: this.noise, peakDb: -120, voicedDbSum: 0, voicedBlocks: 0 };
      this.speaking = true; this.silent = 0;
      if (pre.length) { this.current.push(pre); this.currentLen += pre.length; }
    }
    if (this.speaking) {
      const db = BLOCK_DB(energy);
      if (db > this.meta.peakDb) this.meta.peakDb = db;
      if (voiced) { this.silent = 0; this.voiced += input.length; this.meta.voicedDbSum += db; this.meta.voicedBlocks += 1; }
      else this.silent += input.length;
      this.current.push(input.slice()); this.currentLen += input.length;
      if (this.silent >= this.hangSamples) this.finish("silence");
      else if (this.currentLen >= this.maxSamples) this.finish("max");
    } else this.remember(input);
    return true;
  }
}
registerProcessor("ifrim-voice-gate", IfrimVoiceGate);
