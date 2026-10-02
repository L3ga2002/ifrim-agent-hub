// Milestone 06 — local voice gate (PASS_SIMULATED on SYNTHETIC voices). Two procedural "speakers" (different pitch and
// vocal-tract length) exercise feature extraction, enrolment, 1:1 verification, the four results, the suspicious-input
// flags and deletion. This proves the mechanics, NOT biometric performance on real people, and no result ever grants
// authority by itself.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { segmentFeatures, envelope, bestCorrelation, isVirtualDevice, analyse, speechMask } from "../web/src/lib/voiceFeatures.js";
import { VOICE_CONSENT_TEXT } from "../server/owner/voice.mjs";

const SR = 16000;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410]];
/** A synthetic voice: glottal pulses at f0 (with jitter) through three formant resonators scaled by the tract length. */
function synthVoice({ f0, tract, seconds = 3, seed = 1, noise = 0.003, silenceS = 0.4 }) {
  const r = rng(seed);
  const n = Math.round(SR * (seconds + 2 * silenceS));
  const out = new Float32Array(n);
  const start = Math.round(SR * silenceS); const end = n - start;
  let phase = 0; let vowel = VOWELS[Math.floor(r() * VOWELS.length)];
  const state = VOWELS[0].map(() => [0, 0]);
  for (let i = 0; i < n; i += 1) {
    let x = 0;
    if (i >= start && i < end) {
      const t = (i - start) / SR;
      if (Math.floor(t * 4) !== Math.floor((t - 1 / SR) * 4)) vowel = VOWELS[Math.floor(r() * VOWELS.length)];
      const f = f0 * (1 + 0.02 * Math.sin(2 * Math.PI * 3 * t)) * (1 + (r() - 0.5) * 0.01);
      phase += f / SR;
      if (phase >= 1) { phase -= 1; x = 1; }
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t) ** 2;
      let y = x;
      vowel.forEach((F, k) => {
        const freq = F / tract; const bw = 80 + 40 * k;
        const rr = Math.exp((-Math.PI * bw) / SR); const th = (2 * Math.PI * freq) / SR;
        const v = y + 2 * rr * Math.cos(th) * state[k][0] - rr * rr * state[k][1];
        state[k][1] = state[k][0]; state[k][0] = v; y = v;
      });
      x = y * 0.02 * env;
    }
    out[i] = Math.max(-0.98, Math.min(0.98, x + (r() - 0.5) * noise));
  }
  return out;
}
const A = (seed, extra = {}) => synthVoice({ f0: 110, tract: 1.0, seed, ...extra });
const B = (seed, extra = {}) => synthVoice({ f0: 215, tract: 0.82, seed, ...extra });

test("M06-VO-01 features: a fixed-size summary with speech duration, SNR and clipping; silence has no speech", () => {
  const f = segmentFeatures(A(1), SR);
  assert.equal(f.embedding.length, 38);
  assert.ok(f.speechMs > 2000, `speech ${f.speechMs}`);
  assert.ok(f.snrDb > 15, `snr ${f.snrDb}`);
  assert.equal(f.clipping, 0);
  const silent = new Float32Array(SR * 2).map((_, i) => Math.sin(i) * 0.0005);
  const s = segmentFeatures(silent, SR);
  assert.ok(s.speechMs < 400 || s.snrDb < 6, "no speech in near-silence");
  const { frames } = analyse(A(2), SR);
  const { mask } = speechMask(frames);
  assert.ok(mask.filter(Boolean).length > mask.length / 2);
});

test("M06-VO-02 enrolment (session + consent + quality) and 1:1 verification: owner vs another voice vs too little audio", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    const samples = [1, 2, 3, 4, 5, 6].map((s) => segmentFeatures(A(s), SR));
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.enroll", channel: "ui", actor: "user", payload: { samples, consentText: VOICE_CONSENT_TEXT } }), /cannot be issued through ui/);
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples, consentText: "nu" } }), /acordului/);
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples: samples.slice(0, 3), consentText: VOICE_CONSENT_TEXT } }), /5–12 mostre/);
    const noisy = [1, 2, 3, 4, 5].map((s) => segmentFeatures(A(s, { noise: 0.2 }), SR));
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples: noisy, consentText: VOICE_CONSENT_TEXT } }), /Calitate insuficientă/);
    const enrolled = (await t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples, consentText: VOICE_CONSENT_TEXT } })).result;
    assert.equal(enrolled.profile.samples, 6);
    assert.equal(enrolled.verifier.eligibleForAuthority, false);
    const same = t.hub.voice.verify({ features: segmentFeatures(A(42), SR) });
    const other = t.hub.voice.verify({ features: segmentFeatures(B(43), SR) });
    const short = t.hub.voice.verify({ features: segmentFeatures(A(44, { seconds: 0.3 }), SR) });
    assert.notEqual(same.result, "NON_MATCH", JSON.stringify(same));
    assert.notEqual(other.result, "MATCH", JSON.stringify(other));
    assert.equal(short.result, "INSUFFICIENT_AUDIO");
    for (const r of [same, other, short]) { assert.equal(r.authority, false); assert.ok(!("score" in r), "no uncalibrated percentage is exposed"); }
    // The command log keeps the count of samples, never the vectors.
    const logged = t.hub.db.prepare("SELECT payload_json FROM commands WHERE type = 'voice.enroll' AND status = 'executed'").get().payload_json;
    assert.deepEqual(JSON.parse(logged), { samples: 6 });
    assert.ok(!t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'voice.profile_enrolled'").get().payload_json.includes("centroid"));
  } finally { await t.cleanup(); }
});

test("M06-VO-03 suspicious input never passes: Lega's own voice in the microphone, a virtual device, playback-like spectrum", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples: [1, 2, 3, 4, 5].map((s) => segmentFeatures(A(s), SR)), consentText: VOICE_CONSENT_TEXT } });
    const f = segmentFeatures(A(9), SR);
    assert.notEqual(t.hub.voice.verify({ features: f, flags: { virtualDevice: true } }).result, "MATCH");
    assert.notEqual(t.hub.voice.verify({ features: f, flags: { envelopeCorrelation: 0.9 } }).result, "MATCH");
    assert.notEqual(t.hub.voice.verify({ features: f, flags: { legaOverlap: 0.8 } }).result, "MATCH");
    assert.ok(isVirtualDevice("CABLE Output (VB-Audio Virtual Cable)"));
    assert.ok(!isVirtualDevice("Microphone Array (Realtek)"));
    const lega = A(11);
    const echo = new Float32Array(lega.length); for (let i = 400; i < lega.length; i += 1) echo[i] = lega[i - 400] * 0.3;
    const independent = B(12);
    assert.ok(bestCorrelation(envelope(echo, SR), envelope(lega, SR)) > 0.8, "a delayed copy of Lega's output is recognized");
    assert.ok(bestCorrelation(envelope(independent, SR), envelope(lega, SR)) < bestCorrelation(envelope(echo, SR), envelope(lega, SR)));
  } finally { await t.cleanup(); }
});

test("M06-VO-04 deletion removes the profile file; the gate cannot be enabled without a profile; status names the missing local STT", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.gate", channel: "test", actor: "t", ownerSession: owner.session, payload: { enabled: true } }), /Înscrie întâi/);
    await t.hub.commands.dispatch({ type: "voice.enroll", channel: "test", actor: "t", ownerSession: owner.session, payload: { samples: [1, 2, 3, 4, 5].map((s) => segmentFeatures(A(s), SR)), consentText: VOICE_CONSENT_TEXT } });
    const dir = path.join(t.config.dataDir, "voice");
    assert.equal(fs.readdirSync(dir).length, 1);
    const st = t.hub.voice.status();
    assert.equal(st.localTranscription.available, false);
    assert.match(st.localTranscription.reason, /aprobarea pachetului vocal/);
    await t.hub.commands.dispatch({ type: "voice.delete", channel: "test", actor: "t", ownerSession: owner.session, payload: {} });
    assert.equal(fs.readdirSync(dir).length, 0, "the profile file is deleted");
    assert.equal(t.hub.voice.status().profile, null);
    assert.equal(t.hub.voice.verify({ features: segmentFeatures(A(3), SR) }).result, "UNCERTAIN");
  } finally { await t.cleanup(); }
});
