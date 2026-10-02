// Ifrim voice gate (M06 §09) — AudioWorklet. In STRICT mode nothing from the microphone reaches the output (the track that
// goes to Lega) until the main thread verified the speaker of that sentence: each utterance is held whole (silence in its
// place), handed to the page for LOCAL analysis, then either released (MATCH: played into the output at normal speed, so it
// arrives later by the length of the sentence plus the check) or dropped. Accepting one sentence never opens the
// microphone for the next one. In "pass" mode the input goes through unchanged (and the page says it is not filtered).
class IfrimVoiceGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    this.strict = o.strict !== false;
    this.maxSamples = Math.round(sampleRate * (o.maxUtteranceS || 15));
    this.minSpeech = Math.round(sampleRate * 0.3);
    this.hangSamples = Math.round(sampleRate * (o.endSilenceS || 0.6));
    this.noise = 1e-4; this.speaking = false; this.silent = 0; this.voiced = 0;
    this.current = []; this.currentLen = 0; this.seq = 0;
    this.pending = new Map(); // id → Float32Array (held until the decision)
    this.queue = []; this.queuePos = 0; // released segments being played out
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === "release" && this.pending.has(m.id)) { this.queue.push(this.pending.get(m.id)); this.pending.delete(m.id); }
      else if (m.type === "drop") this.pending.delete(m.id);
      else if (m.type === "strict") this.strict = Boolean(m.value);
      else if (m.type === "flush") { this.pending.clear(); this.queue = []; this.queuePos = 0; this.current = []; this.currentLen = 0; this.speaking = false; }
    };
  }
  finish() {
    if (this.currentLen >= this.minSpeech) {
      const pcm = new Float32Array(this.currentLen);
      let off = 0; for (const c of this.current) { pcm.set(c, off); off += c.length; }
      const id = ++this.seq;
      this.pending.set(id, pcm);
      const copy = pcm.slice();
      this.port.postMessage({ type: "segment", id, pcm: copy, sampleRate, voicedMs: Math.round((this.voiced / sampleRate) * 1000), endedAt: currentTime }, [copy.buffer]);
    }
    this.current = []; this.currentLen = 0; this.speaking = false; this.silent = 0; this.voiced = 0;
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
    const voiced = energy > this.noise * 8;
    if (!voiced) this.noise = this.noise * 0.995 + energy * 0.005;
    if (voiced) { this.speaking = true; this.silent = 0; this.voiced += input.length; }
    if (this.speaking) {
      this.current.push(input.slice()); this.currentLen += input.length;
      if (!voiced) this.silent += input.length;
      if (this.silent >= this.hangSamples || this.currentLen >= this.maxSamples) this.finish();
    }
    return true;
  }
}
registerProcessor("ifrim-voice-gate", IfrimVoiceGate);
