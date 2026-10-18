// M11 voice segmentation and the local voice diagnostic (PASS_SIMULATED: synthetic signals and the fixture voice worker; never a
// person's voice, never TTS as a positive proof). The worklet is the file the browser loads (v2/web/public/voice-gate-worklet.js),
// run here in a vm with the AudioWorklet globals stubbed. Measures what the filter cut, not what a speaker model thinks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { enrolVoice, segment, speak, OTHER_SPEAKER, NEAR_SPEAKER } from "./voice-helpers.mjs";
import { diagRows, diagSummary } from "../web/src/lib/voiceDiagLogic.js";
import { analyseQuality } from "../server/owner/audio.mjs";
import { voicePcm } from "./fixtures/voice-pcm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKLET = fs.readFileSync(path.join(here, "..", "web", "public", "voice-gate-worklet.js"), "utf8");
const RATE = 48000;
const BLOCK = 128;

/** Loads the worklet class in a sandbox; returns a driver that feeds 128-sample blocks and collects what it posts and outputs. */
function worklet(options = {}) {
  const posted = [];
  let Klass = null;
  const sandbox = {
    sampleRate: RATE, currentTime: 0, Math, Float32Array, Map, Number,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } },
    registerProcessor: (_name, k) => { Klass = k; },
  };
  vm.runInNewContext(WORKLET, sandbox);
  const node = new Klass({ processorOptions: { strict: true, ...options } });
  const out = [];
  const feed = (signal) => {
    for (let o = 0; o + BLOCK <= signal.length; o += BLOCK) {
      const output = new Float32Array(BLOCK);
      node.process([[signal.subarray(o, o + BLOCK)]], [[output]]);
      out.push(output);
    }
  };
  const send = (m) => node.port.onmessage({ data: m });
  return { node, posted, feed, send, segments: () => posted.filter((m) => m.type === "segment"), dropped: () => posted.filter((m) => m.type === "dropped"), output: () => concat(out) };
}

const concat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const r = new Float32Array(n); let o = 0; for (const p of parts) { r.set(p, o); o += p.length; } return r; };
const dbToAmp = (db) => 10 ** (db / 20);
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
/** White noise at an RMS level in dBFS (deterministic). */
const noise = (seconds, db) => { const a = dbToAmp(db) * Math.sqrt(12); const s = new Float32Array(Math.round(seconds * RATE)); for (let i = 0; i < s.length; i += 1) s[i] = rnd() * a; return s; };
/** A voiced-like tone at an RMS level in dBFS, with a 5 ms fade so it starts like a real onset. */
const tone = (seconds, db, f = 180) => { const a = dbToAmp(db) * Math.SQRT2; const n = Math.round(seconds * RATE); const s = new Float32Array(n); const fade = Math.round(0.005 * RATE); for (let i = 0; i < n; i += 1) s[i] = Math.sin((2 * Math.PI * f * i) / RATE) * a * Math.min(1, i / fade, (n - i) / fade); return s; };
const mix = (a, b) => { const r = a.slice(); for (let i = 0; i < Math.min(a.length, b.length); i += 1) r[i] += b[i]; return r; };
const energy = (s) => s.reduce((a, x) => a + x * x, 0);
/** Energy at one frequency (Goertzel): how much of the consonant (its own frequency) is inside a segment. */
const at = (s, f) => { const k = 2 * Math.cos((2 * Math.PI * f) / RATE); let a = 0; let b = 0; for (const x of s) { const c = x + k * a - b; b = a; a = c; } return a * a + b * b - k * a * b; };

/**
 * A short command shaped like „Da” / „Taci”: a weak consonant onset (here 40 ms at -45 dBFS: plosive burst and aspiration) and a
 * vowel (220 ms at -26 dBFS), in a room at -65 dBFS. Returns the room, the word, and where the word starts.
 */
function shortCommand() {
  const lead = noise(1.0, -65);
  const word = concat([tone(0.04, -45, 2500), tone(0.22, -26, 180)]);
  const tail = noise(1.0, -65);
  return { signal: concat([lead, mix(word, noise(word.length / RATE, -65)), tail]), word, start: lead.length };
}

test("M11-VS-01 (T19) a short command keeps its first consonant: the pre-roll holds the audio before the first loud block", () => {
  const w = worklet();
  const { signal, word } = shortCommand();
  w.feed(signal);
  const segs = w.segments();
  assert.equal(segs.length, 1, "one segment for one short word");
  const seg = segs[0];
  assert.ok(seg.seg.preRollMs >= 250, `pre-roll ${seg.seg.preRollMs} ms`);
  // Every bit of the word's energy is in the held segment (the consonant onset too), not only the vowel.
  assert.ok(energy(seg.pcm) >= energy(word) * 0.99, `segment holds ${(energy(seg.pcm) / energy(word)).toFixed(3)} of the word's energy`);
  // The consonant itself (2.5 kHz, 20 dB under the vowel) is in the segment: the previous worklet kept 0 % of it (measured).
  const consonant = word.subarray(0, Math.round(0.04 * RATE));
  assert.ok(at(seg.pcm, 2500) >= at(consonant, 2500) * 0.95, `consonant kept: ${(at(seg.pcm, 2500) / at(consonant, 2500)).toFixed(2)}`);
  assert.equal(seg.seg.endReason, "silence");
  assert.ok(seg.seg.voicedMs >= 200 && seg.seg.voicedMs <= 300, `voiced ${seg.seg.voicedMs} ms`);
  assert.ok(seg.seg.durationMs < 1400, `the segment ends ~0.6 s after the word (${seg.seg.durationMs} ms)`);
});

test("M11-VS-02 (T19) a click is never sent: too little voiced audio is dropped in the worklet and only reported", () => {
  const w = worklet();
  w.feed(concat([noise(1, -65), tone(0.005, -10, 3000), noise(1.5, -65)]));
  assert.equal(w.segments().length, 0);
  assert.equal(w.dropped().length, 1);
  assert.equal(w.dropped()[0].reason, "click");
  assert.ok(!("pcm" in w.dropped()[0]), "a dropped report carries no audio");
});

test("M11-VS-03 (T19) „Oprește tot”: two words with a 250 ms gap stay one segment", () => {
  const w = worklet();
  w.feed(concat([noise(1, -65), tone(0.35, -28), noise(0.25, -65), tone(0.3, -28), noise(1.2, -65)]));
  assert.equal(w.segments().length, 1);
  assert.ok(w.segments()[0].seg.voicedMs >= 600);
});

test("M11-VS-04 (T19) a digitally quiet microphone: a tick under the absolute floor (-70 dBFS) opens nothing", () => {
  const w = worklet();
  w.feed(concat([noise(1, -95), tone(0.2, -75), noise(1, -95)]));
  assert.equal(w.segments().length + w.dropped().length, 0);
});

test("M11-VS-05 (T19) a quiet speaker (-48 dBFS over a -70 dBFS room) is still segmented; a steady louder noise closes by itself", () => {
  const quiet = worklet();
  quiet.feed(concat([noise(1, -70), tone(0.6, -48), noise(1, -70)]));
  assert.equal(quiet.segments().length, 1, "a quiet voice opens a segment");
  const fan = worklet();
  fan.feed(concat([noise(1, -70), noise(20, -50), noise(1, -70)])); // a fan switched on for 20 s, nobody speaks
  const segs = fan.segments();
  assert.ok(segs.length >= 1);
  assert.ok(segs.every((s) => s.seg.endReason === "silence" && s.seg.durationMs < 15000), `closed by silence before 15 s: ${segs.map((s) => `${s.seg.durationMs}/${s.seg.endReason}`).join(", ")}`);
});

test("M11-VS-07 (owner probe 2026-10-07) room sounds between -70 and -55 dBFS after a word no longer hold the segment open: it ends ~0.6 s after the words", () => {
  const w = worklet();
  const room = concat([noise(1, -77), tone(0.4, -28), ...Array.from({ length: 8 }, () => concat([noise(0.3, -77), tone(0.05, -62, 900)])), noise(1, -77)]);
  w.feed(room);
  const segs = w.segments();
  assert.equal(segs.length, 1);
  assert.ok(segs[0].seg.durationMs < 1600, `segment ${segs[0].seg.durationMs} ms for a 400 ms word`);
});

test("M11-VS-06 strict mode: nothing reaches the output before the Hub's release; a release plays the held segment (pre-roll included); a drop plays nothing", () => {
  const w = worklet();
  const { signal } = shortCommand();
  w.feed(signal);
  assert.ok(w.output().every((x) => x === 0), "silence while the segment waits for the decision");
  const seg = w.segments()[0];
  w.send({ type: "release", id: seg.id });
  const before = w.output().length;
  w.feed(new Float32Array(seg.pcm.length + BLOCK * 4));
  const played = w.output().subarray(before, before + seg.pcm.length);
  assert.deepEqual(Array.from(played), Array.from(seg.pcm), "the released audio is exactly the held segment");
  const w2 = worklet();
  w2.feed(shortCommand().signal);
  w2.send({ type: "drop", id: w2.segments()[0].id });
  w2.feed(new Float32Array(RATE));
  assert.ok(w2.output().every((x) => x === 0));
});

test("M11-VS-10 (T18) the diagnostic measures with the filter's speaker path but writes no row, emits no utterance and cannot confirm anything", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await enrolVoice(t, owner);
    const rowsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances").get().n;
    const seqBefore = t.hub.bus.lastSeq();
    const yes = await t.hub.voice.diagnose({ session: owner.session, buffer: segment("Da, execută planul"), seg: { preRollMs: 300, voicedMs: 900, endReason: "silence", evil: "x" } });
    assert.equal(yes.authority, false);
    assert.equal(yes.speaker.result, "MATCH");
    assert.equal(yes.transcript.text, "Da, execută planul");
    assert.ok(yes.intent.intents.some((i) => /confirm/.test(i)), `intent ${yes.intent.intents}`);
    assert.equal(yes.stages.AUTHORIZED_EFFECT, "nimic (diagnostic)");
    assert.equal(yes.lostAt, null);
    assert.deepEqual(yes.segmentation, { preRollMs: 300, voicedMs: 900, endReason: "silence" }, "only known numeric fields are kept");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances").get().n, rowsBefore, "no utterance row");
    const events = t.hub.db.prepare("SELECT type FROM events WHERE seq > ?").all(seqBefore).map((e) => e.type);
    assert.ok(!events.some((e) => e.startsWith("voice.")), `no voice event: ${events}`);
    // Another voice is never transcribed by the diagnostic either.
    const other = await t.hub.voice.diagnose({ session: owner.session, buffer: segment("Da, execută planul", { speaker: OTHER_SPEAKER }) });
    assert.equal(other.speaker.result, "NON_MATCH");
    assert.equal(other.transcript.text, null);
    assert.equal(other.lostAt, "SPEAKER_MATCH");
    assert.throws(() => t.hub.voice.diagnostics({ session: null }));
  } finally { await t.cleanup(); }
});

test("M11-VS-11 refusal causes are measured: short vs quiet (under -50 dBFS) vs another voice; the utterance answer still never carries a score", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await enrolVoice(t, owner);
    const short = await t.hub.voice.diagnose({ session: owner.session, buffer: segment("Da", { seconds: 0.3 }) });
    assert.equal(short.speaker.cause, "QUALITY_SHORT");
    assert.equal(short.lostAt, "VAD_OK");
    // A voice under the -50 dBFS line (the fixture worker cannot embed such a quiet tone, so the measurement is checked directly):
    // it is counted as quiet speech, never as speech, and the diagnostic names it QUALITY_QUIET instead of "too short".
    const q = analyseQuality(voicePcm({ text: "Pauză", seconds: 1.2, amplitude: 100 }));
    assert.ok(q.quietSpeechMs >= 600 && q.speechMs < 600, JSON.stringify(q));
    const answer = await speak(t, owner, "Arată-mi planul", { purpose: "probe" });
    for (const k of ["score", "cause", "matchAt", "speaker"]) assert.ok(!(k in answer), `${k} not in the utterance answer`);
    const d = t.hub.voice.diagnostics({ session: owner.session });
    const probe = d.entries.at(-1);
    assert.equal(probe.purpose, "probe");
    assert.equal(probe.utteranceId, answer.utteranceId);
    assert.equal(typeof probe.speaker.score, "number", "the owner's own diagnostic shows the rounded score");
    assert.deepEqual(d.lostAt, { VAD_OK: 1, NONE: 1 });
  } finally { await t.cleanup(); }
});

test("M11-VS-12 the diagnostic view says where each sentence was lost, in plain words", () => {
  const entries = [
    { id: "a", at: "2026-10-07T15:00:00Z", purpose: "gate", quality: { durationMs: 900, speechMs: 300, quietSpeechMs: 0, snrDb: 30 }, speaker: { result: "INSUFFICIENT_AUDIO", cause: "QUALITY_SHORT" }, stages: { AUDIO_CAPTURED: true, VAD_OK: false, AUTHORIZED_EFFECT: "aruncată: nu ajunge la Lega" }, lostAt: "VAD_OK", segmentation: { preRollMs: 300 } },
    { id: "b", at: "2026-10-07T15:00:05Z", purpose: "diag", quality: { durationMs: 1500, speechMs: 900, snrDb: 35, speechLevelDb: -28 }, speaker: { result: "MATCH", cause: "SPEAKER_MATCH", score: 0.71, matchAt: 0.55 }, transcript: { text: "Pauză", status: "final" }, stages: { AUDIO_CAPTURED: true, VAD_OK: true, SPEAKER_MATCH: true, TRANSCRIPT_FINAL: true, INTENT: "pause", AUTHORIZED_EFFECT: "nimic (diagnostic)" }, lostAt: null },
  ];
  const rows = diagRows(entries);
  assert.equal(rows[0].id, "b", "newest first");
  assert.equal(rows[0].stages.SPEAKER_MATCH, "da (0.71 ≥ 0.55)");
  assert.equal(rows[0].stages.TRANSCRIPT_FINAL, "„Pauză”");
  assert.equal(rows[1].stages.VAD_OK, "nu: prea scurtă");
  assert.equal(rows[1].lostAt, "segmentare");
  assert.equal(diagSummary(entries).text, "1 din 2 au trecut; pierdute: 1 la segmentare");
});

test("M11-VS-13 (owner decision „da opriri din incert”) an UNCERTAIN voice may only stop: „Pauză” / „Oprește tot” → voice.stop_heard; „Continuă”, „Da”, another voice → nothing", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await enrolVoice(t, owner);
    const heard = [];
    t.hub.bus.subscribe((e) => { if (e.type === "voice.stop_heard") heard.push(e.payload); });
    const gate = (text, speaker) => t.hub.voice.analyzeUtterance({ session: owner.session, buffer: segment(text, { speaker }), purpose: "gate", legaSessionId: "lgs_test_1", flags: {} });
    const p = await gate("Pauză", NEAR_SPEAKER);
    assert.equal(p.result, "UNCERTAIN", "the uncertain voice is still not released to Lega");
    await gate("Oprește tot", NEAR_SPEAKER);
    await gate("Continuă", NEAR_SPEAKER);
    await gate("Da, execută planul", NEAR_SPEAKER);
    await gate("Oprește tot", OTHER_SPEAKER);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(heard.map((h) => h.intent).sort(), ["pause", "stop_all"]);
    assert.ok(heard.every((h) => h.speaker === "UNCERTAIN"));
    const kept = t.hub.db.prepare("SELECT transcript FROM voice_utterances WHERE speaker_result != 'MATCH'").all();
    assert.ok(kept.every((r) => r.transcript === null), "the uncertain text is never kept");
  } finally { await t.cleanup(); }
});
