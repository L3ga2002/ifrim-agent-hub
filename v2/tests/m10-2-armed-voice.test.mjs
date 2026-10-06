// M10.2 U13 — the armed spoken confirmation, server-side (owner decision 8: ONE global local voice gate, nothing written by a Lega
// start). Covered: the pure window rules (classification, timing on the moment the owner spoke, one armed plan per Lega session, three
// confirmation-like refusals, a "no" closes, ordinary conversation is ignored); arming refused unless every condition holds (a live Lega
// session derived from THIS owner session and started with the gate, policy, profile, local transcription, the plan's own state,
// autonomy, freshness); the Hub arms a plan it has just SPOKEN and confirms "Da, execută planul" from the gate segment it bound itself
// (no card on screen, no click, no grant / mode / approval command); one idempotency key per utterance; replay defences; operation
// plans on the same helper (decisions → a fresh session); a restart closes every window; setup and the gate switch. Fixture providers,
// fixture voice worker: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, enableLive, waitFor, tempDir } from "./helpers.mjs";
import { enrolVoice, speak, startDerivedLega, OTHER_SPEAKER } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createArmedWindows, classifyArmedSentence, judgeTiming, ARMED_LIMITS } from "../server/owner/armed-window.mjs";
import { createHub } from "../server/hub.mjs";
import { armedEventEffect } from "../web/src/lib/voiceContext.js";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const MISSION_TITLE = "Numele din spații trebuie refuzat";
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OLD_FLOW_COMMANDS = "SELECT COUNT(*) AS n FROM commands WHERE type IN ('grant.create','mode.set','approval.decide','envelope.confirm','settings.update')";

/** One gate segment as the page sends it; waits for the local transcript (MATCH only) and for the Hub's reaction to it. */
async function gateSay(t, owner, text, opts = {}) {
  const g = await speak(t, owner, text, { purpose: "gate", ...opts });
  if (g.result === "MATCH") await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 5000);
  await sleep(200);
  return g;
}

/**
 * A hub-test factory project at TRUSTED with one SPEC_DRAFT mission, the owner (voice-first policy), the owner's voice enrolled and the
 * global gate ON (before Lega starts, so the session is gated), billing / isolation ok, BUILD_SAFE, no grant.
 */
async function armedHub({ codex = "ok", clock = null, gate = true, level = "TRUSTED" } = {}) {
  const t = await makeTestHub({ queues: true, codex, ...(clock ? { clock } : {}) });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-armed");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t, { activatePolicy: true });
  await enrolVoice(t, owner);
  if (gate) await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, owner, mission };
}
const proposeEnv = async (t, extra = {}) => (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, ...extra })).result.envelope;

// ---------------------------------------------------------------- pure rules
test("AV-01 window rules: classification, timing on the spoken moment, one plan per Lega session, failures, 'no', ordinary talk", async () => {
  // M10.2 review #14/#16 (deliberate change): "Da, dar nu porni planul" was a counted attempt; a negated plan verb now closes the window.
  const yes = ["Da?", "Da", "Ok.", "Confirm!", "Executați planul", "Da, execută planul", "Confirm planul", "Ok, pornește planul", "Te rog, execută planul", "Lega, da, execută planul"];
  for (const s of yes) assert.equal(classifyArmedSentence(s), "confirm", s);
  for (const s of ["Nu acum", "Nu confirma", "Anulează planul", "Nu execută planul", "Lega, nu acum", "Renunță",
    "Stai, nu executa planul", "Te rog nu executa planul", "Mai bine nu execut planul acum", "Da, dar nu porni planul", "Da, dar nu porni încă planul", "Te rog nu-l executa", "Așteaptă puțin"]) assert.equal(classifyArmedSentence(s), "negative", s);
  for (const s of ["ce modele folosește?", "și cât durează?", "Cât costă?", "", "Arată-mi diferențele",
    "Ok, și cât durează?", "Da, ce modele folosește?", "Ok, mulțumesc", "Da, arată-mi testele", "Execută testele"]) assert.equal(classifyArmedSentence(s), "other", s);
  const w = { armedAt: 1_000_000, expiresAt: 1_000_000 + ARMED_LIMITS.windowMs };
  assert.equal(judgeTiming(w, { createdAtMs: w.armedAt + 85_000, nowMs: w.armedAt + 95_000 }).ok, true, "spoken at T+85 s, transcript at T+95 s");
  assert.equal(judgeTiming(w, { createdAtMs: w.armedAt + 95_000, nowMs: w.armedAt + 96_000 }).code, "after_window", "spoken at T+95 s");
  assert.equal(judgeTiming(w, { createdAtMs: w.armedAt - 1, nowMs: w.armedAt + 1000 }).code, "before_arm");
  assert.equal(judgeTiming(w, { createdAtMs: w.armedAt + 10_000, nowMs: w.armedAt + 41_000 }).code, "transcript_late");

  // The registry over a fake clock, fake utterances and a fake confirm that accepts only a clean "Da, execută planul".
  let now = Date.parse("2026-10-05T10:00:00.000Z");
  const events = [];
  const utterances = new Map();
  const waiting = new Set(["env_a", "env_b"]);
  const bus = { emit: (e) => events.push(e), subscribe: () => () => {} };
  const reg = createArmedWindows({ clock: () => new Date(now), bus, readUtterance: (id) => utterances.get(id) || null,
    verifyLega: (lega, owner) => (lega === "lega_1" ? { ok: true, ownerSessionId: owner || "osn_1" } : { ok: false, reason: "nu" }) });
  reg.registerKind("envelope", { waiting: (id) => waiting.has(id) });
  let n = 0;
  const say = (text, at = now) => { const id = `utt_${(n += 1)}`; utterances.set(id, { id, ownerSessionId: "osn_1", legaSessionId: "lega_1", transcript: text, transcriptStatus: "final", createdAt: new Date(at).toISOString() }); return id; };
  const confirmed = [];
  const confirmFn = (id) => async () => { const u = utterances.get(id); if (u.transcript !== "Da, execută planul") throw new Error(`nu e o confirmare clară: ${u.transcript}`); confirmed.push(id); return { ok: true }; };
  const from = (planId, id) => reg.confirmFrom({ planId, utteranceId: id, sessionId: "osn_1", legaSessionId: "lega_1" }, confirmFn(id));
  assert.equal(reg.lega("lega_x").ok, false);
  assert.equal(reg.lega("lega_1", "osn_other").ok, true, "the fake check echoes; the registry compares owner sessions itself");

  const early = say("Da, execută planul");
  now += 1000;
  reg.arm({ kind: "envelope", planId: "env_a", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  assert.equal(reg.planFor({ ownerSessionId: "osn_1", legaSessionId: "lega_1" }), "env_a");
  assert.equal(reg.planFor({ ownerSessionId: "osn_2", legaSessionId: "lega_1" }), null, "another owner session never binds");
  assert.equal((await from("env_a", early)).ignored, true, "said before the window: ignored, never confirms");
  // Ordinary conversation does not count; three confirmation-like refusals close the window.
  for (const s of ["ce modele folosește?", "și cât durează?"]) assert.equal((await from("env_a", say(s))).ignored, true, s);
  const r1 = await from("env_a", say("Da?"));
  const r2 = await from("env_a", say("Da"));
  assert.deepEqual([r1.failures, r2.failures, r2.closed], [1, 2, false]);
  const r3 = await from("env_a", say("Confirm planul"));
  assert.equal(r3.closed, true);
  assert.equal(reg.planFor({ ownerSessionId: "osn_1", legaSessionId: "lega_1" }), null, "closed after 3");
  assert.equal((await from("env_a", say("Da, execută planul"))).confirmed, false, "a closed window confirms nothing");
  assert.ok(events.filter((e) => e.type === "envelope.armed_refused").length === 3);

  // One armed plan per Lega session: arming B closes A.
  reg.arm({ kind: "envelope", planId: "env_a", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  reg.arm({ kind: "envelope", planId: "env_b", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  assert.equal(reg.armedFor("env_a", "osn_1"), null);
  assert.ok(reg.armedFor("env_b", "osn_1"));
  assert.ok(events.some((e) => e.type === "envelope.confirmation_disarmed" && e.scopeId === "env_a"));
  // "Nu acum" closes at once (no failure counted).
  const no = await from("env_b", say("Nu acum"));
  assert.equal(no.disarmed, true);
  assert.equal(reg.armedFor("env_b", "osn_1"), null);

  // T+85 spoken, transcript at T+95: confirms; spoken at T+95: not bound, not confirmed.
  const t0 = now;
  reg.arm({ kind: "envelope", planId: "env_a", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  now = t0 + 85_000;
  const late = say("Da, execută planul");
  assert.equal(reg.planFor({ ownerSessionId: "osn_1", legaSessionId: "lega_1" }), "env_a", "still bound at T+85");
  now = t0 + 95_000;
  assert.equal(reg.planFor({ ownerSessionId: "osn_1", legaSessionId: "lega_1" }), null, "nothing is bound after the 90 s");
  const ok = await from("env_a", late);
  assert.equal(ok.confirmed, true, JSON.stringify(ok));
  assert.deepEqual(confirmed, [late]);
  assert.equal(reg.armedFor("env_a", "osn_1"), null, "single use");
  reg.arm({ kind: "envelope", planId: "env_b", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  now += 95_000;
  assert.equal((await from("env_b", say("Da, execută planul"))).code, "after_window");
  // A plan that stopped waiting (confirmed by click, revoked) has no window any more.
  reg.arm({ kind: "envelope", planId: "env_b", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  waiting.delete("env_b");
  assert.equal(reg.armedUntil("env_b"), null);
  // Page side: the Hub's events say which plan is armed (pure).
  assert.deepEqual(armedEventEffect({ type: "envelope.confirmation_armed", scopeId: "env_x", payload: { expiresAt: "2026-10-05T10:01:30.000Z" } }), { id: "env_x", until: "2026-10-05T10:01:30.000Z" });
  assert.deepEqual(armedEventEffect({ type: "ops.plan.confirmation_disarmed", scopeId: "opp_x", payload: {} }), { id: "opp_x", until: null });
  assert.deepEqual(armedEventEffect({ type: "envelope.status", scopeId: "env_x", payload: { status: "ACTIVE" } }), { id: "env_x", until: null });
  assert.equal(armedEventEffect({ type: "envelope.armed_refused", scopeId: "env_x", payload: { closed: false } }), null);
});

// M10.2 review #14 / #16: replies that merely START with da/ok are conversation (never counted, never announced, the window stays);
// a refusal that does not start with "nu" closes the window at once instead of counting as an attempt.
test("AV-01b review #14/#16: 'Ok, și cât durează?' is ignored; 'Stai, nu executa planul' closes the window", async () => {
  const now = Date.parse("2026-10-05T10:00:00.000Z");
  const events = [];
  const utterances = new Map();
  const bus = { emit: (e) => events.push(e), subscribe: () => () => {} };
  const reg = createArmedWindows({ clock: () => new Date(now), bus, readUtterance: (id) => utterances.get(id) || null,
    verifyLega: () => ({ ok: true, ownerSessionId: "osn_1" }) });
  reg.registerKind("envelope", { waiting: () => true });
  let n = 0;
  const say = (text) => { const id = `utt_${(n += 1)}`; utterances.set(id, { id, ownerSessionId: "osn_1", legaSessionId: "lega_1", transcript: text, transcriptStatus: "final", createdAt: new Date(now).toISOString() }); return id; };
  let calls = 0;
  const from = (planId, id) => reg.confirmFrom({ planId, utteranceId: id, sessionId: "osn_1", legaSessionId: "lega_1" }, async () => { calls += 1; throw new Error("refuzat"); });
  reg.arm({ kind: "envelope", planId: "env_a", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
  for (const s of ["Ok, și cât durează?", "Da, ce modele folosește?", "Ok, mulțumesc", "Ok, și cât durează?"]) {
    const r = await from("env_a", say(s));
    assert.equal(r.ignored, true, `${s}: ${JSON.stringify(r)}`);
  }
  assert.equal(calls, 0, "conversation never reaches the plan's confirm()");
  assert.equal(events.filter((e) => e.type === "envelope.armed_refused").length, 0, "no refusal is announced over the conversation");
  assert.ok(reg.armedFor("env_a", "osn_1"), "four ordinary replies later the window is still open");
  for (const s of ["Stai, nu executa planul", "Te rog nu executa planul", "Mai bine nu execut planul acum"]) {
    reg.arm({ kind: "envelope", planId: "env_a", ownerSessionId: "osn_1", legaSessionId: "lega_1", hash: "h", nonce: "n" });
    const r = await from("env_a", say(s));
    assert.equal(r.disarmed, true, `${s}: ${JSON.stringify(r)}`);
    assert.equal(r.failures, undefined, `${s}: not counted as an attempt`);
    assert.equal(reg.armedFor("env_a", "osn_1"), null, `${s}: the window closed at once`);
  }
  assert.equal(calls, 0, "a refusal never reaches the plan's confirm()");
});

// ---------------------------------------------------------------- the Hub's own path: spoken plan → armed → spoken yes
test("AV-02 Lega says the plan, the Hub arms it after speaking and confirms the owner's 'Da, execută planul' from the segment it bound (no card, no click)", async () => {
  const t = await armedHub({ codex: script([{ sleep: 2500 }, { say: `Pornește misiunea ${MISSION_TITLE}` }, { sleep: 60000 }]) });
  try {
    const live = []; t.hub.live.subscribe((e) => live.push(e));
    const lega = await startDerivedLega(t, t.owner);
    assert.equal(t.hub.lega.state().gated, true, "the session started with the global gate on");
    assert.equal(t.hub.settings.get("voiceGate").enabled, true);
    const gateWrites = count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'voiceGate'");
    // The owner's sentence passes the local filter first (released for Lega), then the provider transcribes it.
    await gateSay(t, t.owner, `Pornește misiunea ${MISSION_TITLE}`, { legaSessionId: lega });
    const armed = await waitFor(() => t.hub.armedWindows.open().find((w) => w.legaSessionId === lega) || null, 15000);
    const env = t.hub.envelopes.get(armed.planId);
    assert.equal(env.status, "PROPOSED");
    assert.equal(env.proposedVia, "voice");
    const spoke = t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
    assert.ok(spoke.some((s) => /Am pregătit planul/.test(s) && /Da, execută planul/.test(s)), `the Hub said the plan and the cue: ${JSON.stringify(spoke)}`);
    assert.ok(live.some((e) => e.type === "lega.plan_armed" && e.planId === env.id && e.sessionId === lega));
    assert.ok(t.hub.envelopes.view(env.id).armedUntil, "the view exposes armedUntil");
    assert.equal(t.hub.envelopes.view(env.id).windowNonce, undefined);
    // Lega TTS in the microphone, a virtual device, playback, another voice: never MATCH, never confirm.
    for (const flags of [{ legaOverlap: 0.5 }, { envelopeCorrelation: 0.9 }, { virtualDevice: true }, { playbackLike: true }]) {
      const g = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega, flags });
      assert.notEqual(g.result, "MATCH", JSON.stringify(flags));
    }
    const other = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega, speaker: OTHER_SPEAKER });
    assert.equal(other.result, "NON_MATCH");
    assert.equal(t.hub.db.prepare("SELECT transcript FROM voice_utterances WHERE id = ?").get(other.utteranceId).transcript, null, "another speaker is never transcribed");
    // A page tag for ANOTHER plan conflicts with the armed one: flagged, binds no plan.
    const conflict = await gateSay(t, t.owner, "Lega, ce face Codex acum", { legaSessionId: lega, envelopeId: "env_altul" });
    assert.equal(conflict.boundPlanId, null);
    assert.ok(conflict.flags.some((f) => /diferă de planul armat/.test(f)));
    // Ordinary conversation in the window: no failure.
    await gateSay(t, t.owner, "Și cât durează?", { legaSessionId: lega });
    assert.equal(t.hub.armedWindows.open()[0]?.failures, 0);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    // The card is NOT on screen (no page tag): the server binds the segment to the armed plan and confirms it.
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const yes = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega });
    assert.equal(yes.armed, true); assert.equal(yes.boundPlanId, env.id);
    const active = await waitFor(() => (["ACTIVE", "COMPLETED", "WAITING_OWNER"].includes(t.hub.envelopes.get(env.id).status) ? t.hub.envelopes.view(env.id) : null), 15000);
    assert.equal(active.consent.modality, "voice");
    assert.equal(active.consent.voice.transcriptSource, "local");
    assert.equal(active.consent.idempotencyKey, `voice:${yes.utteranceId}`);
    assert.equal(count(t, OLD_FLOW_COMMANDS), 0, "no grant, mode, approval, confirm click or settings command");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'voiceGate'"), gateWrites, "Lega never writes the gate setting");
    await waitFor(() => t.readLog("codex").some((l) => l.spoke && /Am auzit „Da, execută planul”/.test(l.spoke)), 5000);
    // The page path with the same utterance (POST /api/envelopes/:id/confirm, modality voice) is the same confirmation: duplicate.
    const page = (await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, modality: "voice", utteranceId: yes.utteranceId }, { ownerSession: t.owner.session })).result;
    assert.equal(page.duplicate, true);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.confirmed' AND scope_id = ?", env.id), 1);
    // The same recording replayed: neither released nor transcribed, and it cannot confirm anything again.
    const replay = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega });
    assert.equal(replay.result, "UNCERTAIN");
    assert.match(replay.reason, /reluare/);
    await waitFor(() => ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(t.hub.factory.view(t.mission.id).factory.stage), 120000, 100);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- arming refusals
test("AV-03 arming is refused unless every condition holds (session, owner session, gate, transcription, plan, autonomy)", async () => {
  const t = await armedHub();
  try {
    const env = await proposeEnv(t);
    assert.equal(env.summary.state, "PLAN_READY", (env.summary.blockers || []).join("; "));
    const arm = (legaSessionId, session = t.owner.session) => dispatch(t.hub, "envelope.arm", { envelopeId: env.id, legaSessionId }, { ownerSession: session });
    // No Lega session at all / a forged id: refused (the id is a claim, not an authority).
    await assert.rejects(arm("lega_forged"), /sesiune Lega activă/);
    const noLega = await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id });
    assert.equal(noLega.results[0].armed.armed, false);
    const lega = await startDerivedLega(t, t.owner);
    const env2 = noLega.results[0].plan.envelope; // the newest plan (the older preview was superseded)
    const arm2 = (extra = {}) => t.hub.envelopes.armForLega({ envelopeId: env2.id, legaSessionId: lega, ...extra });
    // Another owner session than the one Lega was derived from.
    assert.throws(() => arm2({ session: { id: "osn_altcineva" } }), /altei sesiuni de proprietar/);
    // Gate off → refused; on again → the running session started WITH the gate, so arming works.
    await dispatch(t.hub, "voice.gate", { enabled: false }, { ownerSession: t.owner.session });
    assert.throws(() => arm2(), /filtrul vocal local nu rulează/);
    // Local transcription unavailable (engine not usable) → refused.
    const status = t.hub.voice.status;
    t.hub.voice.status = (...a) => ({ ...status(...a), gate: { enabled: true, strict: true }, localTranscription: { available: false, reason: "test" } });
    assert.throws(() => arm2(), /transcrierea locală/);
    t.hub.voice.status = status;
    t.hub.bus.transaction(() => t.hub.settings.set("voiceGate", { ...t.hub.settings.get("voiceGate"), enabled: true }, "test"));
    // The plan itself: not PLAN_READY, above the project's level, OBSERVE.
    const summary = t.hub.db.prepare("SELECT summary_json FROM mission_envelopes WHERE id = ?").get(env2.id).summary_json;
    t.hub.db.prepare("UPDATE mission_envelopes SET summary_json = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(summary), state: "PLAN_INCOMPLETE" }), env2.id);
    assert.throws(() => arm2(), /nu e eligibil/);
    t.hub.db.prepare("UPDATE mission_envelopes SET summary_json = ? WHERE id = ?").run(summary, env2.id);
    // Lowering the project's level withdraws the wider plan shown (fail-safe), so nothing is left to arm; a plan shown at OBSERVE never arms.
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "ASSISTED" }, { ownerSession: t.owner.session });
    assert.throws(() => arm2(), /nu mai așteaptă|peste nivelul proiectului/);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "OBSERVE" }, { ownerSession: t.owner.session });
    const observed = await proposeEnv(t);
    assert.throws(() => t.hub.envelopes.armForLega({ envelopeId: observed.id, legaSessionId: lega }), /OBSERVE|nu e eligibil/);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
    // Everything holds now: the cockpit's owner.intent with the LIVE Lega session arms (the client id checked against Lega itself).
    const shown = await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id, legaSessionId: lega });
    assert.equal(shown.results[0].armed.armed, true, shown.results[0].armed.reason);
    // A segment of another Lega session never uses this window; nothing confirmed.
    await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: "lega_alta", envelopeId: shown.results[0].plan.envelope.id });
    assert.equal(t.hub.envelopes.get(shown.results[0].plan.envelope.id).status, "PROPOSED");
    // The Lega session ends: its windows close with it.
    await t.hub.lega.stopAll("test");
    await waitFor(() => !t.hub.lega.active(), 10000);
    assert.equal(t.hub.envelopes.armedFor(shown.results[0].plan.envelope.id, t.owner.session.id), null);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("AV-04 HIGH_AUTONOMY_BOUNDED arms only right after Windows Hello; T+85 s spoken with the transcript at T+95 s confirms; T+95 s spoken does not; a pre-arm sentence never confirms", async () => {
  let offset = 0; // the Hub clock runs with real time, shifted by the test (billing evidence stays in the past)
  const t = await armedHub({ clock: () => new Date(Date.now() + offset) });
  try {
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "HIGH_AUTONOMY_BOUNDED" }, { ownerSession: t.owner.reauth() });
    const lega = await startDerivedLega(t, t.owner);
    const env = await proposeEnv(t, { level: "HIGH_AUTONOMY_BOUNDED" });
    assert.equal(env.summary.state, "PLAN_READY", (env.summary.blockers || []).join("; "));
    // A sentence said while the plan was shown but before any window: kept by the page tag only, never confirms.
    const pre = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega, envelopeId: env.id });
    assert.equal(pre.armed, false);
    offset += 6 * 60000; // the Windows Hello of the raise is older than 5 minutes
    assert.throws(() => t.hub.envelopes.armForLega({ envelopeId: env.id, legaSessionId: lega }), (e) => e.details?.reauth === true);
    t.owner.reauth();
    const w = t.hub.envelopes.armForLega({ envelopeId: env.id, legaSessionId: lega });
    assert.equal(w.armed, true);
    const ignored = await t.hub.envelopes.confirmFromArmed({ utteranceId: pre.utteranceId, envelopeId: env.id, sessionId: t.owner.session.id, legaSessionId: lega });
    assert.equal(ignored.confirmed, false);
    assert.match(ignored.reason, /înainte să se deschidă/);
    // T+85 s: spoken (bound), its transcript "arrives" at T+95 s (the automatic reaction is held to move the clock first).
    const T = Date.parse(w.armedAt);
    const held = [];
    const original = t.hub.envelopes.confirmFromArmed;
    t.hub.envelopes.confirmFromArmed = (q) => { held.push(q); return Promise.resolve({ confirmed: false, held: true }); };
    offset = T + 85_000 - Date.now();
    const yes = await gateSay(t, t.owner, "Da, execută planul.", { legaSessionId: lega });
    assert.equal(yes.boundPlanId, env.id);
    await waitFor(() => held.length === 1, 5000);
    t.hub.envelopes.confirmFromArmed = original;
    offset = T + 95_000 - Date.now();
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const out = await t.hub.envelopes.confirmFromArmed(held[0]);
    assert.equal(out.confirmed, true, JSON.stringify(out));
    assert.equal(t.hub.envelopes.view(env.id).consent.modality, "voice");
    await t.hub.lega.stopAll("test").catch(() => {});
    await waitFor(() => ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(t.hub.factory.view(t.mission.id).factory.stage), 120000, 100);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("AV-05 a sentence spoken after the 90 s is not bound and confirms nothing; a grant-path (legacy) Lega session never arms", async () => {
  let offset = 0; // the Hub clock runs with real time, shifted by the test (billing evidence stays in the past)
  const t = await armedHub({ clock: () => new Date(Date.now() + offset) });
  try {
    const lega = await startDerivedLega(t, t.owner);
    const env = await proposeEnv(t);
    const w = t.hub.envelopes.armForLega({ envelopeId: env.id, legaSessionId: lega });
    offset = Date.parse(w.armedAt) + 95_000 - Date.now();
    const late = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega });
    assert.equal(late.armed, false); assert.equal(late.boundPlanId, null);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "the card is still clickable");
    assert.equal(t.hub.envelopes.view(env.id).armedUntil, null);
    await t.hub.lega.stopAll("test");
    await waitFor(() => !t.hub.lega.active(), 10000);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }

  // The old path: a voice grant + LIVE_VALIDATION, no owner session behind the Lega session.
  const g = await makeTestHub({ queues: true });
  try {
    const owner = await enrolOwner(g, { activatePolicy: true });
    await enrolVoice(g, owner);
    await dispatch(g.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
    await enableLive(g.hub, { provider: "codex" });
    g.hub.bus.transaction(() => g.hub.grants.create({ provider: "codex", projectId: g.hub.projects.hub().id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    const { LEGA_CONSENT_VERSION } = await import("../server/policy/lega-policy.mjs");
    g.hub.bus.transaction(() => g.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    g.hub.refreshCodexConfig();
    const s = (await g.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" } })).result;
    assert.equal(s.authority, "grant");
    await g.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    const check = g.hub.armedWindows.lega(s.sessionId);
    assert.equal(check.ok, false);
    assert.match(check.reason, /nu e pornită din sesiunea ta/);
  } finally { await g.hub.lega.stopAll("test").catch(() => {}); await g.cleanup(); }
});

// ---------------------------------------------------------------- operation plans
test("AV-06 operation plans use the same window: spoken confirmation through plans.confirm (modality voice); a plan with a decision arms only with a fresh session", async () => {
  let offset = 0; // the Hub clock runs with real time, shifted by the test (billing evidence stays in the past)
  const t = await armedHub({ clock: () => new Date(Date.now() + offset) });
  try {
    const calls = [];
    t.hub.executors["test.probe"] = {
      describe: ({ n = 1, folder = null }) => ({ title: `Sondă ${n}`, params: { n, folder }, folders: folder ? [folder] : [], ops: folder ? [{ op: "media.import", path: folder }] : [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: [`rezultat ${n}`] }),
      run: async ({ params, authorize }) => { authorize(params.folder ? { op: "media.import", path: params.folder } : { op: "media.render" }); calls.push(params.n); return { result: { n: params.n } }; },
    };
    const lega = await startDerivedLega(t, t.owner);
    const plan = await t.hub.opsPlans.propose({ kind: "test.armed", title: "Plan de test", steps: [{ kind: "test.probe", params: { n: 1 } }], actor: "lega", via: "voice" });
    const w = t.hub.opsPlans.armForLega({ planId: plan.id, legaSessionId: lega });
    assert.equal(w.armed, true);
    assert.ok(t.hub.opsPlans.view(plan.id).armedUntil);
    const yes = await gateSay(t, t.owner, "Da, execută planul", { legaSessionId: lega });
    assert.equal(yes.boundPlanId, plan.id);
    const done = await waitFor(async () => { const p = await t.hub.opsPlans.idle(plan.id); return p.status === "DONE" ? p : null; }, 15000);
    assert.equal(done.consent.modality, "voice");
    assert.equal(done.consent.idempotencyKey, `voice:${yes.utteranceId}`);
    assert.deepEqual(calls, [1]);
    // A new folder is a decision in the card: by voice only right after Windows Hello.
    const folder = path.join(tempDir("m10-2-armed-folder"), "nou"); // outside the Hub data (a protected folder is refused)
    fs.mkdirSync(folder, { recursive: true });
    offset += 6 * 60000;
    const withDecision = await t.hub.opsPlans.propose({ kind: "test.armed2", title: "Plan cu folder nou", steps: [{ kind: "test.probe", params: { n: 2, folder } }], actor: "lega", via: "voice" });
    assert.equal(withDecision.body.decisions.length, 1);
    assert.throws(() => t.hub.opsPlans.armForLega({ planId: withDecision.id, legaSessionId: lega }), (e) => e.details?.reauth === true);
    t.owner.reauth();
    assert.equal(t.hub.opsPlans.armForLega({ planId: withDecision.id, legaSessionId: lega }).armed, true);
    assert.equal(count(t, OLD_FLOW_COMMANDS), 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- restart, setup, the gate switch
test("AV-07 a restart closes every window: nothing confirms and the plan stays clickable", async () => {
  const t = await armedHub();
  let hub2 = null;
  try {
    const lega = await startDerivedLega(t, t.owner);
    const env = await proposeEnv(t);
    t.hub.envelopes.armForLega({ envelopeId: env.id, legaSessionId: lega });
    const pre = await gateSay(t, t.owner, "Lega, un moment", { legaSessionId: lega });
    assert.equal(pre.boundPlanId, env.id);
    await t.hub.close();
    hub2 = createHub(t.config, { homeDir: t.homeDir });
    await hub2.boot();
    const view = hub2.envelopes.view(env.id);
    assert.equal(view.status, "PROPOSED");
    assert.equal(view.awaitingConfirmation, true, "the card is still confirmable by click");
    assert.equal(view.armedUntil, null);
    assert.deepEqual(hub2.armedWindows.open(), []);
    const out = await hub2.envelopes.confirmFromArmed({ utteranceId: pre.utteranceId, envelopeId: env.id, sessionId: t.owner.session.id, legaSessionId: lega });
    assert.equal(out.confirmed, false);
    assert.equal(hub2.envelopes.get(env.id).status, "PROPOSED");
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    try { fs.rmSync(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold a file briefly */ }
  }
});

test("AV-08 setup asks for the gate under voice-first (NEEDS_OWNER); the gate refuses without local transcription; enabling it mid-session restarts Lega with a clear notice", async () => {
  const t = await armedHub({ gate: false });
  try {
    const step = () => t.hub.setup.steps({ session: t.owner.session }).steps.find((s) => s.id === "voice_gate");
    assert.equal(step().status, "NEEDS_OWNER");
    assert.equal(step().action?.panel, "voice");
    // The engine not usable: the switch refuses (turning off is always allowed).
    const engineStatus = t.hub.voiceEngine.status;
    t.hub.voiceEngine.status = () => ({ ...engineStatus(), installed: false, missing: ["whisper"] });
    await assert.rejects(dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: t.owner.session }), /transcrierea locală/);
    assert.equal(step().status, "BLOCKED");
    t.hub.voiceEngine.status = engineStatus;
    // A session started WITHOUT the gate: no window can be armed for it…
    const live = []; t.hub.live.subscribe((e) => live.push(e));
    const lega = await startDerivedLega(t, t.owner);
    assert.equal(t.hub.lega.state().gated, false);
    assert.match(t.hub.armedWindows.lega(lega).reason, /filtrul vocal local nu rulează/);
    // …and turning the gate on stops it at once with the reason (not a silent voice_gate_bypass on the next sentence).
    await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: t.owner.session });
    await waitFor(() => !t.hub.lega.active(), 10000);
    assert.equal(t.hub.lega.state().endReason, "voice-gate-enabled");
    assert.ok(live.some((e) => e.type === "lega.notice" && /Repornește Lega/.test(e.text || "")));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'lega.voice_gate_bypass'"), 0);
    assert.equal(step().status, "DONE_OWNER");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
