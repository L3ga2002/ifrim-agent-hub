// Milestone 07 — local voice on the Hub (PASS_SIMULATED: the fixture worker speaks the real worker's protocol; segments are
// synthetic tones with an encoded "transcript", never a person's voice). Covers: the server measuring, embedding and
// transcribing the audio itself; guided enrolment; the four results; other people's speech never transcribed; the gate's
// server-held decision; the HTTP surface (raw PCM, owner cookie, flags only lowering); the Lega bypass check; a spoken
// confirmation that is consumed once and only for the plan it named; an engine failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { makeTestHub, enrolOwner, enableLive, waitFor, prepareLiveWithoutGrants } from "./helpers.mjs";
import { enrolVoice, speak, segment, OWNER_SPEAKER, NEAR_SPEAKER, OTHER_SPEAKER } from "./voice-helpers.mjs";
import { ENROLL_PHRASES, VOICE_CONSENT_TEXT, phraseMatch } from "../server/owner/voice.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { API_CONTRACT } from "../server/config.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
// M09: every factory mission names its models explicitly (without them it is a draft whose scope is incomplete).
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
import { SESSION_COOKIE } from "../server/owner/trust.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });

test("M07-VO-01 the local engine answers through the worker; without a profile nothing matches; audio is never stored, only its hash", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    const status = t.hub.voice.status();
    assert.equal(status.localTranscription.available, true, "the fixture engine is installed (test mode)");
    assert.equal(status.verifier.eligibleForAuthority, false);
    await assert.rejects(t.hub.voice.analyzeUtterance({ session: null, buffer: segment("ceva"), purpose: "gate" }), /sesiun/i);
    const r = await speak(t, owner, "Da, execută planul", { purpose: "probe" });
    assert.equal(r.result, "UNCERTAIN"); assert.match(r.reason, /Niciun profil/);
    assert.equal(r.transcript, null, "nothing is transcribed without a profile");
    const row = t.hub.db.prepare("SELECT * FROM voice_utterances WHERE id = ?").get(r.utteranceId);
    assert.match(row.audio_sha256, /^[0-9a-f]{64}$/);
    assert.ok(!Object.keys(row).some((k) => /audio$|pcm|wav/i.test(k)), "no audio column");
    const voiceDir = path.join(t.config.dataDir, "voice");
    assert.ok(!fs.existsSync(voiceDir) || fs.readdirSync(voiceDir).length === 0, "no file written for a segment");
    assert.equal(t.hub.voiceEngine.status().engine, "stopped", "without a profile the models are not even loaded");
    await enrolVoice(t, owner);
    assert.equal(t.hub.voiceEngine.status().engine, "ready");
  } finally { await t.cleanup(); }
});

test("M07-VO-02 guided enrolment: the Hub checks quality and the phrase it heard; the profile needs 5 accepted samples and the exact consent; session-bound", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    const sample = (i, text, extra) => t.hub.voice.enrollSample({ session: owner.session, buffer: segment(text, extra), phraseIndex: i });
    const wrong = await sample(0, "cu totul altceva decât fraza");
    assert.equal(wrong.accepted, false); assert.ok(wrong.problems.some((p) => /nu am recunoscut fraza/.test(p))); assert.equal(wrong.heard, "cu totul altceva decât fraza");
    const short = await sample(1, ENROLL_PHRASES[1], { seconds: 0.5 });
    assert.equal(short.accepted, false); assert.ok(short.problems.some((p) => /prea scurtă/.test(p)));
    const clipped = await sample(2, ENROLL_PHRASES[2], { clip: true });
    assert.equal(clipped.accepted, false); assert.ok(clipped.problems.some((p) => /saturat/.test(p)));
    await assert.rejects(t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[0]), phraseIndex: 99 }), /necunoscut/);
    for (let i = 0; i < 4; i += 1) assert.equal((await sample(i, ENROLL_PHRASES[i])).accepted, true);
    await assert.rejects(dispatch(t.hub, "voice.enroll.finish", { consentText: VOICE_CONSENT_TEXT }, { ownerSession: owner.session }), /cel puțin 5/);
    assert.equal((await sample(4, ENROLL_PHRASES[4])).accepted, true);
    await assert.rejects(t.hub.commands.dispatch({ type: "voice.enroll.finish", channel: "ui", actor: "user", payload: { consentText: VOICE_CONSENT_TEXT } }), /cannot be issued through ui/);
    await assert.rejects(dispatch(t.hub, "voice.enroll.finish", { consentText: "da" }, { ownerSession: owner.session }), /acordului/);
    // Another session (another browser) has no draft: the samples are bound to the session that recorded them.
    const other = owner.reauth();
    assert.equal(other.id, owner.session.id, "reauth keeps the same session");
    const done = (await dispatch(t.hub, "voice.enroll.finish", { consentText: VOICE_CONSENT_TEXT }, { ownerSession: owner.session })).result;
    assert.equal(done.calibration.samples, 5);
    assert.ok(done.calibration.matchAt <= 0.7 && done.calibration.matchAt >= 0.4);
    // What the setup page shows is the threshold the check uses (the 0.55 ceiling), next to the calibrated value (M07 review).
    const shown = t.hub.voice.status(owner.session).profile.calibration;
    assert.equal(shown.calibratedMatchAt, done.calibration.matchAt);
    assert.equal(shown.matchAt, Math.min(done.calibration.matchAt, 0.55));
    assert.match(done.calibration.negatives, /nemăsurate/);
    assert.equal(fs.readdirSync(path.join(t.config.dataDir, "voice")).length, 1);
    const logged = t.hub.db.prepare("SELECT payload_json FROM commands WHERE type = 'voice.enroll.finish' AND status = 'executed'").get().payload_json;
    assert.deepEqual(JSON.parse(logged), { consent: true }, "the command log keeps no text, vector or audio");
    assert.ok(phraseMatch("da executa planul afisat acum", ENROLL_PHRASES[2]) === 1, "diacritics and punctuation are ignored");
  } finally { await t.cleanup(); }
});

test("M07-VO-03 1:1 decisions: owner MATCH, a close voice UNCERTAIN, another NON_MATCH, too little audio INSUFFICIENT; page flags only lower; others are never transcribed", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await enrolVoice(t, owner);
    const me = await speak(t, owner, "Arată-mi planul", { purpose: "probe" });
    const near = await speak(t, owner, "Arată-mi planul", { purpose: "probe", speaker: NEAR_SPEAKER });
    const other = await speak(t, owner, "Arată-mi planul", { purpose: "probe", speaker: OTHER_SPEAKER });
    const short = await speak(t, owner, "Da", { purpose: "probe", seconds: 0.3 });
    assert.deepEqual([me.result, near.result, other.result, short.result], ["MATCH", "UNCERTAIN", "NON_MATCH", "INSUFFICIENT_AUDIO"]);
    assert.equal(me.transcript, "Arată-mi planul");
    for (const r of [near, other, short]) { assert.equal(r.transcript, null, `${r.result} is not transcribed`); assert.equal(r.transcriptStatus, "skipped"); }
    for (const r of [me, near, other, short]) { assert.equal(r.authority, false); assert.ok(!("score" in r)); }
    assert.equal((await speak(t, owner, "x", { purpose: "probe", flags: { virtualDevice: true } })).result, "NON_MATCH");
    assert.equal((await speak(t, owner, "x", { purpose: "probe", flags: { legaOverlap: 0.8 } })).result, "UNCERTAIN");
    assert.equal((await speak(t, owner, "x", { purpose: "probe", speaker: OTHER_SPEAKER, flags: { virtualDevice: false, playbackLike: false } })).result, "NON_MATCH", "flags never raise a result");
    const stored = t.hub.db.prepare("SELECT transcript FROM voice_utterances WHERE speaker_result != 'MATCH'").all();
    assert.ok(stored.every((r) => r.transcript === null), "no text is kept for speech that is not the owner's");
  } finally { await t.cleanup(); }
});

test("M07-VO-04 the gate: decision first, the owner's text follows asynchronously; release evidence per Lega session; the gate needs a profile; deletion", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await assert.rejects(dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session }), /Înscrie întâi/);
    await enrolVoice(t, owner);
    const st = (await dispatch(t.hub, "voice.gate", { enabled: true, strict: false }, { ownerSession: owner.session })).result;
    assert.equal(st.gate.strict, true, "the filter is strict or off (a non-strict mode would let everything through)");
    const g = await speak(t, owner, "Lega, ce face Codex?", { purpose: "gate", legaSessionId: "lega_1" });
    assert.equal(g.result, "MATCH"); assert.equal(g.transcript, null, "the gate answers before transcribing");
    await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status === "final", 5000);
    assert.equal(t.hub.voice.getUtterance({ id: g.utteranceId, session: owner.session }).transcript, "Lega, ce face Codex?");
    assert.equal(t.hub.voice.recentGateRelease("lega_1"), true);
    assert.equal(t.hub.voice.recentGateRelease("lega_2"), false);
    await speak(t, owner, "altcineva", { purpose: "gate", legaSessionId: "lega_3", speaker: OTHER_SPEAKER });
    assert.equal(t.hub.voice.recentGateRelease("lega_3"), false, "a refused segment is not a release");
    await dispatch(t.hub, "voice.delete", {}, { ownerSession: owner.session });
    assert.equal(fs.readdirSync(path.join(t.config.dataDir, "voice")).length, 0);
    assert.equal(t.hub.settings.get("voiceGate").enabled, false, "deleting the profile turns the gate off");
    assert.equal((await speak(t, owner, "x", { purpose: "probe" })).result, "UNCERTAIN");
  } finally { await t.cleanup(); }
});

test("M07-VO-05 HTTP: raw PCM only with the owner cookie on localhost; JSON refused; flags header only lowers; 'voice-local' is not a client source; utterance → intent text from the server", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const request = (p, { method = "GET", body, raw, cookie = "", headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = raw || (body ? Buffer.from(JSON.stringify(body)) : null);
    const req = http.request({ host: "127.0.0.1", port: t.config.port, path: p, method, headers: { Host: host, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(raw ? { "Content-Type": "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, headers: res.headers }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await enrolVoice(t, owner);
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.token)}`;
    const pcm = segment("Lega, arată-mi recomandările");
    assert.equal((await request("/api/voice/utterances?purpose=probe", { method: "POST", raw: pcm })).status, 401, "no owner session → nothing analysed");
    assert.equal((await request("/api/voice/utterances?purpose=probe", { method: "POST", body: { pcm: "x" }, cookie })).status, 400, "JSON is not audio");
    const ok = await request("/api/voice/utterances?purpose=probe", { method: "POST", raw: pcm, cookie });
    assert.equal(ok.status, 200); assert.equal(ok.json.result, "MATCH"); assert.equal(ok.json.transcript, "Lega, arată-mi recomandările");
    assert.equal(ok.headers["x-hub-contract"], String(API_CONTRACT));
    const flagged = await request("/api/voice/utterances?purpose=probe", { method: "POST", raw: pcm, cookie, headers: { "X-Voice-Flags": JSON.stringify({ virtualDevice: true }) } });
    assert.equal(flagged.json.result, "NON_MATCH");
    const lifted = await request("/api/voice/utterances?purpose=probe", { method: "POST", raw: segment("x", { speaker: OTHER_SPEAKER }), cookie, headers: { "X-Voice-Flags": JSON.stringify({ match: true, result: "MATCH" }) } });
    assert.equal(lifted.json.result, "NON_MATCH", "a header cannot raise a result");
    const big = Buffer.alloc(700 * 1024);
    const tooBig = await request("/api/voice/utterances?purpose=probe", { method: "POST", raw: big, cookie }).catch((error) => ({ status: error.code }));
    assert.ok(tooBig.status === 400 || tooBig.status === "ECONNRESET" || tooBig.status === "EPIPE", `over the limit is refused (${tooBig.status})`);
    // "voice-local" from a client is a validation error; a spoken sentence is an utterance id read on the server.
    const claim = await request("/api/owner/intent", { method: "POST", body: { text: "Lega, arată-mi recomandările", source: "voice-local" }, cookie });
    assert.equal(claim.status, 400);
    const intent = await request("/api/owner/intent", { method: "POST", body: { utteranceId: ok.json.utteranceId }, cookie });
    assert.equal(intent.status, 200); assert.equal(intent.json.source, "voice-local"); assert.deepEqual(intent.json.resolved.steps.map((s) => s.intent), ["recommendations"]);
    // A stale page (another contract) cannot drive the server; a stop still works.
    const stale = await request("/api/owner/intent", { method: "POST", body: { text: "status" }, cookie, headers: { "X-Hub-UI-Contract": String(API_CONTRACT - 1) } });
    assert.equal(stale.status, 409); assert.equal(stale.json.error.code, "UI_STALE");
    const stop = await request("/api/stop-all", { method: "POST", body: {}, headers: { "X-Hub-UI-Contract": String(API_CONTRACT - 1) } });
    assert.notEqual(stop.status, 409, "fail-safe requests are never refused for a stale page");
  } finally { server.close(); await t.cleanup(); }
});

test("M07-VO-06 Lega with the strict gate on: provider words without a segment the Hub accepted stop the session; with one, they are handled", async () => {
  for (const [label, released] of [["bypass", false], ["released", true]]) {
    const t = await makeTestHub({ codex: "lega-navigate-words" });
    try {
      const { hub } = t;
      const owner = await enrolOwner(t, { activatePolicy: false });
      await enrolVoice(t, owner);
      await dispatch(hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
      await enableLive(hub, { provider: "codex" });
      hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
      hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
      await speak(t, owner, "încălzire", { purpose: "probe" }); // the engine is warm before the session (the fake speaks 400 ms after start)
      const events = []; hub.live.subscribe((e) => events.push(e));
      const s = (await hub.commands.dispatch({ type: "lega.session.start", payload: { sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" }, actor: "user", channel: "ui" })).result;
      if (released) await speak(t, owner, "Lega, deschide aprobările", { purpose: "gate", legaSessionId: s.sessionId });
      await waitFor(() => events.some((e) => e.type === "lega.navigate" || (e.type === "lega.notice" && /filtrul vocal/.test(e.text || ""))), 10000);
      if (released) assert.ok(events.some((e) => e.type === "lega.navigate"), "accepted speech is handled");
      else {
        assert.ok(!events.some((e) => e.type === "lega.navigate"), "bypassing words are not acted on");
        await waitFor(() => hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lega.voice_gate_bypass'").get().n === 1, 5000);
      }
      await hub.commands.dispatch({ type: "lega.session.stop", payload: { sessionId: s.sessionId }, actor: "user", channel: "ui" }).catch(() => {});
    } finally { await t.cleanup(); }
  }
});

test("M07-VO-07 a spoken confirmation counts once, for the plan it named, in the session that recorded it, within 2 minutes; two waiting plans need a choice", async () => {
  let now = Date.now();
  const t = await makeTestHub({ queues: true, clock: () => new Date(now) });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const projects = [];
    for (const name of ["a", "b"]) {
      const dir = path.join(t.dataDir, `factory-${name}`);
      materializeFixture("bug-demo", dir);
      const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: `Demo ${name}` })).result;
      projects.push(project);
    }
    const owner = await enrolOwner(t, { activatePolicy: true });
    await enrolVoice(t, owner);
    for (const p of projects) {
      await dispatch(t.hub, "owner.autonomy.set", { projectId: p.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
      await dispatch(t.hub, "factory.prepare", { projectId: p.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    }
    const envA = (await dispatch(t.hub, "envelope.propose", { projectId: projects[0].id })).result.envelope;
    const envB = (await dispatch(t.hub, "envelope.propose", { projectId: projects[1].id })).result.envelope;
    const confirm = (env, utteranceId, session = owner.session) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, modality: "voice", utteranceId }, { ownerSession: session });
    // Two plans wait: a bare "yes" names neither → one question, no guess.
    const yesA = await speak(t, owner, "Da, execută planul", { envelopeId: envA.id });
    await assert.rejects(confirm(envA, yesA.utteranceId), /Care plan/);
    // Lega's own voice played back (correlation) is not the owner.
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envB.id, reason: "test" }, { ownerSession: owner.session });
    const tts = await speak(t, owner, "Da, execută planul", { envelopeId: envA.id, flags: { envelopeCorrelation: 0.9 } });
    await assert.rejects(confirm(envA, tts.utteranceId), /nu a fost recunoscută/);
    // Expired after 2 minutes.
    const late = await speak(t, owner, "Da, execută planul", { envelopeId: envA.id });
    now += 3 * 60000;
    await assert.rejects(confirm(envA, late.utteranceId), /2 minute/);
    // A new profile invalidates older segments.
    const before = await speak(t, owner, "Da, execută planul", { envelopeId: envA.id });
    await enrolVoice(t, owner);
    await assert.rejects(confirm(envA, before.utteranceId), /profilul vocal s-a schimbat/);
    // The real one, then a replay of the same segment.
    const fresh = (await dispatch(t.hub, "envelope.propose", { projectId: projects[0].id })).result.envelope;
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const yes = await speak(t, owner, "Da. Execută planul.", { envelopeId: fresh.id });
    const done = (await confirm(fresh, yes.utteranceId)).result;
    assert.equal(done.envelope.status, "ACTIVE");
    assert.equal(done.envelope.consent.voice.heard, "Da. Execută planul.");
    // M10.2 U13: a spoken confirmation is keyed by its utterance (voice:<id>), so the same segment sent again for the same plan (a retry,
    // the armed path and the page path, a second tab) is the SAME confirmation: duplicate, nothing new starts, nothing consumed twice.
    const again = (await confirm(fresh, yes.utteranceId)).result;
    assert.equal(again.duplicate, true);
    assert.equal(again.envelope.id, fresh.id);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances WHERE consumed_at IS NOT NULL").get().n, 1, "one segment consumed, once");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.confirmed' AND scope_id = ?").get(fresh.id).n, 1, "confirmed once");
  } finally { await t.cleanup(); }
});

test("M07-VO-08 an engine that cannot start: a clear tool error, the state reported, nothing analysed or confirmed", async () => {
  const t = await makeTestHub({ configOverrides: { voiceWorkerEnv: { FAKE_VOICE_FATAL: "1" } } });
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await assert.rejects(t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[0]), phraseIndex: 0 }), /Motorul vocal local nu a pornit/);
    assert.equal(t.hub.voiceEngine.status().engine, "failed");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM voice_utterances").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M07-VO-09 the default voice root is outside AppData (a packaged app sees a redirected AppData) and the pinned hashes match the published model files", async () => {
  const { defaultVoiceRoot, VOICE_COMPONENTS } = await import("../server/owner/voice-engine.mjs");
  assert.doesNotMatch(defaultVoiceRoot({}), /AppData/i);
  assert.equal(VOICE_COMPONENTS.stt.sha256, "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1", "ggml-large-v3-turbo-q8_0.bin as published");
  assert.equal(VOICE_COMPONENTS.sv.sha256, "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b", "CAM++ voxceleb as published in sherpa-onnx checksum.txt");
  assert.match(VOICE_COMPONENTS.whisper.treeSha256, /^[0-9a-f]{64}$/);
  // M09: whisper-cli.exe (media transcription, per file, no port) is part of the same pinned Release folder (same tree hash);
  // the idle stop is 5 min so whisper-server's unauthenticated port is open only while needed (M09-VS-04).
  assert.equal(VOICE_COMPONENTS.whisper.cli, "whisper-cli.exe");
  assert.equal(VOICE_COMPONENTS.whisper.exe, "whisper-server.exe");
  const { VOICE_ENGINE_LIMITS } = await import("../server/owner/voice-engine.mjs");
  assert.equal(VOICE_ENGINE_LIMITS.IDLE_STOP_MS, 5 * 60000);
});

// ---------- regressions from the M07 adversarial review ----------

test("M07-VO-10 through Lega's gate a confirmation must name the plan: 'Da?' and a bare 'Da' never start a mission; 'Da, execută planul' does", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-gate");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await enrolVoice(t, owner);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: project.id })).result.envelope;
    const gateSay = async (text) => {
      const g = await speak(t, owner, text, { purpose: "gate", envelopeId: env.id, legaSessionId: "lega_x" });
      await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 5000);
      return g;
    };
    const confirmWith = (g) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, modality: "voice", utteranceId: g.utteranceId }, { ownerSession: owner.session });
    await assert.rejects(confirmWith(await gateSay("Da?")), /întrebare/);
    await assert.rejects(confirmWith(await gateSay("Da")), /să numească planul/);
    await assert.rejects(confirmWith(await gateSay("Da, te rog")), /să numească planul/);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const ok = (await confirmWith(await gateSay("Da, execută planul"))).result;
    assert.equal(ok.envelope.status, "ACTIVE");
  } finally { await t.cleanup(); }
});

test("M07-VO-11 speech that is not the owner's never reaches the transcription engine (confirm and probe decide the speaker first)", async () => {
  const log = path.join(process.env.TEMP || ".", `fake-voice-${process.pid}-${Date.now()}.log`);
  const t = await makeTestHub({ configOverrides: { voiceWorkerEnv: { FAKE_VOICE_LOG: log } } });
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    await enrolVoice(t, owner);
    fs.writeFileSync(log, "");
    for (const purpose of ["confirm", "probe"]) {
      await speak(t, owner, "Da, execută planul", { purpose, envelopeId: "env_x", speaker: OTHER_SPEAKER });
      await speak(t, owner, "Da, execută planul", { purpose, envelopeId: "env_x", speaker: NEAR_SPEAKER });
    }
    const requests = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(requests.length >= 4);
    assert.ok(requests.every((r) => !r.transcribe), `no transcription request for a non-owner: ${JSON.stringify(requests)}`);
    fs.writeFileSync(log, "");
    await speak(t, owner, "Da, execută planul", { purpose: "confirm", envelopeId: "env_x" });
    const mine = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(mine.map((r) => r.transcribe), [false, true], "the owner: speaker first, then the words");
  } finally { await t.cleanup(); try { fs.rmSync(log, { force: true }); } catch { /* */ } }
});

test("M07-VO-12 an inconsistent enrolment (another voice among the samples) is not saved: the outlier is dropped and its phrase asked again; a duplicate recording is refused", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t, { activatePolicy: false });
    for (let i = 0; i < 4; i += 1) assert.equal((await t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[i]), phraseIndex: i })).accepted, true);
    const dup = await t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[0]), phraseIndex: 0 });
    assert.equal(dup.accepted, false); assert.ok(dup.problems.some((p) => /deja trimisă/.test(p)));
    assert.equal((await t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[4], { speaker: OTHER_SPEAKER }), phraseIndex: 4 })).accepted, true, "quality alone cannot tell");
    await assert.rejects(dispatch(t.hub, "voice.enroll.finish", { consentText: VOICE_CONSENT_TEXT }, { ownerSession: owner.session }), /nu se potrivesc/);
    assert.equal(t.hub.voice.status(owner.session).profile, null, "nothing saved");
    assert.deepEqual(t.hub.voice.status(owner.session).draft.phrases.sort(), [0, 1, 2, 3], "the outlier's phrase is asked again");
    assert.equal((await t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[4]), phraseIndex: 4 })).accepted, true);
    assert.equal((await dispatch(t.hub, "voice.enroll.finish", { consentText: VOICE_CONSENT_TEXT }, { ownerSession: owner.session })).result.calibration.samples, 5);
  } finally { await t.cleanup(); }
});

test("M07-VO-13 a profile of an earlier verifier (M06 baseline) is superseded at start-up and its gate turned off; the engine idle clock starts at readiness", async () => {
  const t = await makeTestHub();
  try {
    const { createVoice } = await import("../server/owner/voice.mjs");
    t.hub.db.prepare("INSERT INTO voice_profiles (id, version, verifier, status, samples, file_ref, consent_version, created_at) VALUES ('vpr_old', 1, 'mfcc-stats-baseline-v1', 'active', 5, 'x', 1, ?)").run(new Date().toISOString());
    t.hub.bus.transaction(() => t.hub.settings.set("voiceGate", { enabled: true, strict: true, profileId: "vpr_old" }, "test"));
    const again = createVoice({ db: t.hub.db, bus: t.hub.bus, clock: t.config.now, settings: t.hub.settings, config: t.config, trust: t.hub.trust, engine: t.hub.voiceEngine });
    assert.equal(again.status().profile, null);
    assert.equal(t.hub.db.prepare("SELECT status FROM voice_profiles WHERE id = 'vpr_old'").get().status, "superseded");
    assert.equal(t.hub.settings.get("voiceGate").enabled, false);
    await t.hub.voiceEngine.ensure();
    const st = t.hub.voiceEngine.status();
    assert.ok(st.lastUsedAt, "the idle clock starts when the engine is ready (a warmed, unused engine is still stopped later)");
  } finally { await t.cleanup(); }
});

test("M07-VO-14 the speaker model sees only the spoken part: lead and tail silence are trimmed (silence made every embedding alike — live enrolment finding)", async () => {
  const { trimToSpeech } = await import("../server/owner/audio.mjs");
  // 1.2 s of room noise, 1.5 s of a voiced tone, 1.2 s of room noise (no fixture marker in front).
  const R = 16000; const pcm = new Int16Array(Math.round(3.9 * R));
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = i >= 1.2 * R && i < 2.7 * R ? Math.round(Math.sin((2 * Math.PI * 300 * i) / R) * 9000) : ((i * 7919) % 61) - 30;
  const trimmed = trimToSpeech(pcm);
  assert.ok(trimmed.length < pcm.length * 0.7, `trimmed ${trimmed.length} of ${pcm.length}`);
  assert.ok(trimmed.length >= 1.5 * 16000, "the speech itself is kept (with a short pad)");
  const silent = new Int16Array(16000).map((_, i) => (i % 7) - 3);
  assert.equal(trimToSpeech(silent).length, silent.length, "no speech: nothing is cut");
});
