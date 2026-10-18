// Milestone 10.2.1 — G2 (D18 spoken „Continuă”, D19 the addressed bridged pause). The owner's locally verified „Continuă” (CAM++ MATCH,
// a final LOCAL whisper transcript, the WHOLE sentence) in a Lega session derived from the owner session and started with the local
// voice filter runs the SAME executor as the typed one, as the owner session, consumed once; the provider's transcript of the same word
// never resumes (silent when the local segment decides, an honest line otherwise); owner.intent {utteranceId} carries a resume only as
// the whole sentence, once. A pause said to Lega through the bridge is the owner's (credential) only when addressed or explicit.
// PASS_SIMULATED: fixture providers (fake app-server), the fixture voice worker, a software authenticator; no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { enrolVoice, speak, startDerivedLega } from "./voice-helpers.mjs";
import { classifyContinueSentence } from "../server/owner/voice.mjs";
import { classifyArmedSentence } from "../server/owner/armed-window.mjs";
import { classifySuspension, credentialTag } from "../server/policy/gate-state.mjs";

const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const gate = (t) => t.hub.settings.get("executionGate");
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json || "{}"));
const asOwner = (t, type, payload = {}) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const say = (t, text, extra = {}) => asOwner(t, "owner.intent", { text, ...extra });
const sayVoice = (t, text, extra = {}) => t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text, ...extra } }).then((r) => r.result);
const spoke = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const consumedBy = (t, id) => t.hub.db.prepare("SELECT consumed_by FROM voice_utterances WHERE id = ?").get(id)?.consumed_by || null;
const voiceEvents = (t, outcome = null) => events(t, "owner.continue_voice").filter((e) => !outcome || e.outcome === outcome);
/** The fields a „Continuă” result is compared by (typed vs. spoken): what reopened, what was said, which plan resumed and how. */
const summaryOf = (r) => ({ reopened: Boolean(r.interrupt?.reopened), summary: r.interrupt?.summary || null, message: r.message || null, planTitle: r.plan?.title || null,
  note: r.note || null, refused: r.refused || null, card: Boolean(r.gateRearm), stopped: r.gateStopped?.code || null });

/** One gate segment as the page sends it; waits for its local transcript (MATCH only) and for the Hub's reaction. */
async function gateSay(t, text, opts = {}) {
  const g = await speak(t, t.owner, text, { purpose: "gate", ...opts });
  if (g.result === "MATCH") await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 5000);
  await sleep(250);
  return g;
}

/** The owner (voice-first policy) with the voice enrolled; the global local voice gate on or off; BUILD_SAFE, the gate open. */
async function voiceHub({ gateOn = true, codex = script([{ sleep: 120000 }]) } = {}) {
  const t = await makeTestHub({ queues: true, codex });
  await prepareLiveWithoutGrants(t.hub);
  const owner = await enrolOwner(t, { activatePolicy: true });
  await enrolVoice(t, owner);
  if (gateOn) await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
  return { ...t, owner };
}

/** An operation plan that waits until released, confirmed in the owner session and RUNNING (the m10-ops-plans pattern). */
async function runningOpsPlan(t, title = "Randare de test") {
  const release = { open: false };
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!release.open && !abort.aborted) await sleep(15); return { result: { waited: true } }; },
  };
  const plan = await asOwner(t, "ops.plan.propose", { kind: "continue.voice.test", title, steps: [{ kind: "test.wait", params: {} }], limits: {} });
  await asOwner(t, "ops.plan.confirm", { planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash });
  await waitFor(() => t.hub.opsPlans.view(plan.id).steps.some((s) => s.status === "RUNNING"));
  return { plan, release };
}
const isPaused = (t, id) => t.hub.opsPlans.view(id).status === "PAUSED";

// ------------------------------------------------------------------------------------------------------------------------------ CV-01
test("CV-01 the spoken-resume classifier: only the WHOLE ops_continue sentence; a question, a quotation, a mixed sentence, a mission or a condition never; independent of the plan window", () => {
  for (const s of ["Continuă", "Continuă.", "Lega, continuă", "Hei Lega, continuă", "Ok, continuă", "Gata, continuă", "Continuă acum", "Te rog, continuă", "Reia"]) {
    assert.equal(classifyContinueSentence(s), "continue", s);
  }
  for (const s of ["Continuă?", "Pot să continui?", "Continui?", "Lega, continuă?"]) assert.equal(classifyContinueSentence(s), "question", s);
  for (const s of ["Da. Continuă.", "Da, continuă", "„Continuă”", "\"Continuă\"", "Continuă misiunea Alfa", "Continuă dacă trec testele", "Continuă. Mulțumesc.", "Continuă, fără deploy",
    "Nu continua", "Da", "Ok", "Nu", "Stai", "Da, execută planul", "", "„Continuă” îl iau scris în cockpit sau cu vocea ta verificată local; filtrul vocal e oprit acum."]) {
    assert.equal(classifyContinueSentence(s), "other", s);
  }
  // A plan's „Da” is never a resume and a resume is never a plan confirmation (the two windows never share a sentence).
  for (const s of ["Da", "Da, execută planul", "Confirm planul"]) { assert.equal(classifyArmedSentence(s), "confirm", s); assert.notEqual(classifyContinueSentence(s), "continue", s); }
  for (const s of ["Continuă", "Lega, continuă", "Ok, continuă"]) assert.equal(classifyArmedSentence(s), "other", s);
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-02
test("CV-02 gated derived session: a pause said to Lega, then the owner's verified „Lega, continuă” segment — the same result as the typed „Continuă”, the gate reopened and the plan resumed, the utterance consumed once, replay refused, audited, said by the Hub", async () => {
  const t = await voiceHub();
  const releases = [];
  try {
    const lega = await startDerivedLega(t, t.owner);
    assert.equal(t.hub.lega.state().gated, true);
    // The typed cycle: „Pauză” → typed „Continuă” (the reference result).
    const a = await runningOpsPlan(t, "Plan A");
    releases.push(a.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(a.plan.id);
    const typed = (await say(t, "Continuă")).results[0];
    assert.equal(typed.interrupt?.reopened, true, JSON.stringify(typed).slice(0, 400));
    assert.equal(typed.plan?.id, a.plan.id);
    // The spoken cycle: the pause said to Lega (D19, through the bridge), then the owner's own verified „Lega, continuă”.
    const b = await runningOpsPlan(t, "Plan A");
    releases.push(b.release);
    const paused = (await sayVoice(t, "Lega, pune totul pe pauză", { legaSessionId: lega })).results[0];
    assert.equal(paused.intent, "pause");
    assert.equal(classifySuspension(gate(t)).cls, "owner_pause", "the addressed pause is the owner's (credential recorded)");
    await t.hub.opsPlans.idle(b.plan.id);
    assert.ok(isPaused(t, b.plan.id));
    const g = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    assert.equal(g.result, "MATCH");
    await waitFor(() => (gate(t).status === "open" ? true : null), 10000);
    await waitFor(() => (voiceEvents(t, "resumed").length === 1 ? true : null), 5000);
    const audit = voiceEvents(t, "resumed")[0];
    assert.deepEqual([audit.utteranceId, audit.legaSessionId, audit.sessionId], [g.utteranceId, lega, t.owner.session.id]);
    assert.equal(consumedBy(t, g.utteranceId), `continue:${g.utteranceId}`, "consumed once, by the resume");
    await waitFor(() => (!isPaused(t, b.plan.id) ? true : null), 5000);
    // The SAME executor: the result equals the typed one (the memoized answer of the same utterance; nothing runs twice).
    const again = await t.hub.intake.continueFromVoice({ utteranceId: g.utteranceId, ownerSessionId: t.owner.session.id, legaSessionId: lega });
    assert.equal(again.duplicate, true);
    assert.equal(again.outcome, "resumed");
    assert.deepEqual(summaryOf(again.result), summaryOf(typed));
    assert.equal(voiceEvents(t, "resumed").length, 1, "idempotent per utterance");
    // The Hub said it, in its own words (never model text), quoting what it heard (2.12.1, VOICE-05: the owner said „Lega, continuă”).
    await waitFor(() => (spoke(t).some((s) => /^Am auzit „Lega, continuă” \(vocea ta, verificată local\): Am redeschis poarta după pauza ta\./.test(s)) ? true : null), 5000);
    assert.ok(spoke(t).some((s) => /Am reluat planul „Plan A” în aceleași limite/.test(s)), JSON.stringify(spoke(t)));
    // The same recording replayed: never released, never transcribed, never a resume; the used row refuses the page path too.
    await say(t, "Pauză");
    const replay = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    assert.equal(replay.result, "UNCERTAIN");
    assert.match(replay.reason, /reluare/);
    const page = (await say(t, "", { utteranceId: g.utteranceId })).results.find((r) => r.intent === "ops_continue");
    assert.match(String(page?.refused), /deja folosită/);
    await sleep(300);
    assert.equal(gate(t).status, "suspended", "nothing reopened by a replay or a used segment");
    assert.equal(voiceEvents(t, "resumed").length, 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set' OR type = 'gate.rearm'"), 0, "no gate command");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { for (const r of releases) r.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-03
test("CV-03 the provider's „Continuă” alone never resumes: silent in a gated derived session (the local segment decides), the honest line when the filter is off; never the intake", async () => {
  // Each Lega session hears the owner's „Lega, continuă” from the provider 5 s after it starts (Lega starts only with the gate open:
  // the pause comes right after the start).
  const t = await voiceHub({ codex: script([{ sleep: 5000 }, { say: "Lega, continuă" }, { sleep: 120000 }]) });
  const releases = [];
  try {
    // Gated: the owner's segment just before it is ordinary talk (it releases the provider's words; it is not a resume).
    const lega = await startDerivedLega(t, t.owner);
    const p = await runningOpsPlan(t);
    releases.push(p.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p.plan.id);
    await gateSay(t, "Lega, un moment", { legaSessionId: lega });
    await waitFor(() => (t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lega.transcript' AND scope_id = ? AND json_extract(payload_json, '$.role') = 'user'").get(lega).n ? true : null), 15000);
    await sleep(600);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'lega.voice_gate_bypass'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'voice'"), 0, "the provider's „Continuă” never reaches the intake");
    assert.ok(!spoke(t).some((s) => /Continuă/.test(s)), `silent: ${JSON.stringify(spoke(t))}`);
    assert.equal(gate(t).status, "suspended");
    assert.ok(isPaused(t, p.plan.id));
    assert.equal(voiceEvents(t).length, 0);
    await t.hub.lega.stopAll("test");
    await waitFor(() => !t.hub.lega.active(), 10000);
    // Not gated (the filter is off): the Hub says how „Continuă” is taken; nothing resumes.
    assert.equal((await say(t, "Continuă")).results[0].interrupt?.reopened, true);
    await dispatch(t.hub, "voice.gate", { enabled: false }, { ownerSession: t.owner.session });
    const second = await startDerivedLega(t, t.owner);
    assert.ok(second);
    assert.equal(t.hub.lega.state().gated, false);
    const p2 = await runningOpsPlan(t);
    releases.push(p2.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p2.plan.id);
    await waitFor(() => (spoke(t).some((s) => /„Continuă” îl iau scris în cockpit sau cu vocea ta verificată local; filtrul vocal e oprit acum\./.test(s)) ? true : null), 15000);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'voice'"), 0);
    assert.equal(gate(t).status, "suspended");
    assert.ok(isPaused(t, p2.plan.id));
    assert.ok(t.hub.lega.hubActions().some((x) => x.intents.includes("ops_continue") && x.outcome === "refused"), JSON.stringify(t.hub.lega.hubActions()));
    assert.equal(voiceEvents(t).length, 0);
  } finally { for (const r of releases) r.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-04
test("CV-04 refused evidence: Lega's voice in the microphone (UNCERTAIN), a partial transcript, a media transcript id, a probe segment, another Lega session, a used row — nothing resumes", async () => {
  const t = await voiceHub();
  const releases = [];
  try {
    const lega = await startDerivedLega(t, t.owner);
    const p = await runningOpsPlan(t);
    releases.push(p.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p.plan.id);
    const owner = t.owner.session.id;
    const still = () => { assert.equal(gate(t).status, "suspended"); assert.ok(isPaused(t, p.plan.id)); assert.equal(voiceEvents(t, "resumed").length, 0); };
    // Lega's own voice in the microphone: UNCERTAIN, never transcribed, never a resume.
    const echo = await gateSay(t, "Lega, continuă", { legaSessionId: lega, flags: { legaOverlap: 0.6 } });
    assert.equal(echo.result, "UNCERTAIN");
    await sleep(200);
    assert.equal(voiceEvents(t).length, 0, "nothing reaches the intake");
    still();
    // A transcript that is not final (partial / pending): refused by the claim.
    const pending = await gateSay(t, "Lega, un moment", { legaSessionId: lega });
    t.hub.db.prepare("UPDATE voice_utterances SET transcript = 'Lega, continuă', transcript_status = 'pending' WHERE id = ?").run(pending.utteranceId);
    const partial = await t.hub.intake.continueFromVoice({ utteranceId: pending.utteranceId, ownerSessionId: owner, legaSessionId: lega });
    assert.equal(partial.outcome, "refused");
    assert.match(partial.reason, /transcriere locală finală/);
    // A media transcript id is never an utterance.
    const media = await t.hub.intake.continueFromVoice({ utteranceId: "mtr_clip_test_1", ownerSessionId: owner, legaSessionId: lega });
    assert.equal(media.outcome, "refused");
    assert.match(media.reason, /nu există/);
    // A probe segment (the check after enrolment) is not a sentence said to the Hub — through Lega or owner.intent.
    const probe = await speak(t, t.owner, "Continuă", { purpose: "probe", legaSessionId: lega });
    assert.equal(probe.result, "MATCH");
    const probed = await t.hub.intake.continueFromVoice({ utteranceId: probe.utteranceId, ownerSessionId: owner, legaSessionId: lega });
    assert.match(probed.reason, /scop „probe”/);
    const viaIntent = (await say(t, "", { utteranceId: probe.utteranceId })).results.find((r) => r.intent === "ops_continue");
    assert.match(String(viaIntent?.refused), /scop „probe”/);
    // A segment of another Lega session (a forged or old id): the derived session check refuses before the utterance is read.
    const other = await gateSay(t, "Continuă", { legaSessionId: "lega_alta" });
    assert.equal(other.result, "MATCH");
    await waitFor(() => (voiceEvents(t).some((e) => e.utteranceId === other.utteranceId) ? true : null), 5000);
    assert.equal(voiceEvents(t).find((e) => e.utteranceId === other.utteranceId).outcome, "refused");
    assert.equal(consumedBy(t, other.utteranceId), null, "a refused segment is not consumed");
    // Another owner session than the one Lega was derived from (a fresh segment of this Lega session, its final text a resume).
    const fresh = await gateSay(t, "Lega, ascultă", { legaSessionId: lega });
    t.hub.db.prepare("UPDATE voice_utterances SET transcript = 'Continuă' WHERE id = ?").run(fresh.utteranceId);
    const forged = await t.hub.intake.continueFromVoice({ utteranceId: fresh.utteranceId, ownerSessionId: "osn_altcineva", legaSessionId: lega });
    assert.equal(forged.outcome, "refused");
    assert.match(forged.reason, /derivată din sesiunea ta/);
    assert.equal(consumedBy(t, fresh.utteranceId), null);
    still();
    // A used row: consumed by its first resume; the same utterance is answered once (memo), the row refuses any other path.
    const ok = await gateSay(t, "Continuă", { legaSessionId: lega });
    await waitFor(() => (gate(t).status === "open" ? true : null), 10000);
    assert.equal(consumedBy(t, ok.utteranceId), `continue:${ok.utteranceId}`);
    await say(t, "Pauză");
    const reused = await t.hub.intake.continueFromVoice({ utteranceId: ok.utteranceId, ownerSessionId: owner, legaSessionId: lega });
    assert.equal(reused.duplicate, true, "the same utterance is answered once");
    const page = (await say(t, "", { utteranceId: ok.utteranceId })).results.find((r) => r.intent === "ops_continue");
    assert.match(String(page?.refused), /deja folosită/);
    assert.equal(gate(t).status, "suspended");
    assert.equal(voiceEvents(t, "resumed").length, 1);
  } finally { for (const r of releases) r.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-05
test("CV-05 a gate stopped by anything but the owner's own pause: the spoken „Continuă” reopens nothing (the honest reason, never a card) — a plan the owner's own pause stopped still resumes (D22); after Stop All the ended Lega session cannot resume; the typed one shows the card", async () => {
  const t = await voiceHub();
  const releases = [];
  try {
    const lega = await startDerivedLega(t, t.owner);
    const p = await runningOpsPlan(t);
    releases.push(p.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p.plan.id);
    // A palette „Pauză” over it (gate.set suspend, stronger than a pause): no longer the owner's own pause.
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend", reason: "Palette pause" } });
    assert.equal(classifySuspension(gate(t)).cls, "suspend");
    // 2.12.1 (D22 / REG-01): the plan was stopped by the owner's own pause, not by a stop — it resumes as before; the gate stays suspended.
    const g = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    await waitFor(() => (voiceEvents(t).some((e) => e.utteranceId === g.utteranceId) ? true : null), 8000);
    assert.equal(voiceEvents(t).find((e) => e.utteranceId === g.utteranceId).outcome, "resumed");
    await waitFor(() => (!isPaused(t, p.plan.id) ? true : null), 5000);
    assert.equal(classifySuspension(gate(t)).cls, "suspend", "the palette suspension is not reopened by „Continuă”");
    // Nothing stopped any more: the spoken „Continuă” is held — what ends first (Lega) and where the gate is reopened (VOICE-04).
    const g2 = await gateSay(t, "Ok, continuă", { legaSessionId: lega });
    await waitFor(() => (voiceEvents(t).some((e) => e.utteranceId === g2.utteranceId) ? true : null), 8000);
    const held = voiceEvents(t).find((e) => e.utteranceId === g2.utteranceId);
    assert.equal(held.outcome, "held");
    const memo = await t.hub.intake.continueFromVoice({ utteranceId: g2.utteranceId, ownerSessionId: t.owner.session.id, legaSessionId: lega });
    assert.equal(memo.result.gateRearm, undefined, "never a card by voice");
    assert.equal(memo.result.gateStopped?.code, "LEGA_ACTIVE", JSON.stringify(memo.result.gateStopped));
    assert.match(memo.result.message, /^Poarta e oprită printr-o suspendare a porții; nu e nimic pe pauză de reluat\. După ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur\.$/);
    assert.doesNotMatch(memo.result.message, ADMIN_POINTERS);
    await waitFor(() => (spoke(t).some((s) => /^Am auzit „Ok, continuă” \(vocea ta, verificată local\): Poarta e oprită printr-o suspendare a porții/.test(s)) ? true : null), 5000);
    assert.equal(gate(t).status, "suspended");
    // Stop All ends Lega (and pauses a running plan: the stop's own, held until the rearm — M10-OP-12 lets it start under the suspended
    // gate): a later segment of that session never resumes anything.
    const q = await runningOpsPlan(t, "Plan Q");
    releases.push(q.release);
    await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });
    await waitFor(() => !t.hub.lega.active(), 10000);
    await t.hub.opsPlans.idle(q.plan.id);
    await sleep(100);
    assert.ok(isPaused(t, q.plan.id));
    const late = await gateSay(t, "Continuă", { legaSessionId: lega });
    await waitFor(() => (voiceEvents(t).some((e) => e.utteranceId === late.utteranceId) ? true : null), 5000);
    assert.equal(voiceEvents(t).find((e) => e.utteranceId === late.utteranceId).outcome, "refused");
    assert.equal(consumedBy(t, late.utteranceId), null);
    assert.equal(gate(t).status, "suspended");
    assert.ok(isPaused(t, q.plan.id));
    // The typed „Continuă”: the card (owner session), nothing resumed.
    const typed = (await say(t, "Continuă")).results[0];
    assert.equal(typed.gateRearm?.kind, "gate_rearm", JSON.stringify(typed).slice(0, 400));
    assert.match(typed.message, /de Stop All/);
    assert.ok(isPaused(t, q.plan.id));
    assert.equal(voiceEvents(t, "resumed").length, 1, "only the resume before the Stop All");
  } finally { for (const r of releases) r.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-06
test("CV-06 owner.intent {utteranceId}: „Da. Continuă.” never resumes (the whole sentence only); a pure „Continuă” resumes once and is consumed; a replay is refused", async () => {
  const t = await voiceHub({ gateOn: false });
  const releases = [];
  try {
    const p = await runningOpsPlan(t);
    releases.push(p.release);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p.plan.id);
    const mixed = await gateSay(t, "Da. Continuă.");
    const m = await say(t, "", { utteranceId: mixed.utteranceId });
    assert.equal(m.source, "voice-local");
    const step = m.results.find((r) => r.intent === "ops_continue");
    assert.match(String(step?.refused), /propoziție întreagă/, JSON.stringify(m.results));
    assert.ok(m.results.every((r) => !r.confirmed));
    assert.equal(consumedBy(t, mixed.utteranceId), null);
    assert.equal(gate(t).status, "suspended");
    assert.ok(isPaused(t, p.plan.id));
    const pure = await gateSay(t, "Continuă");
    const ok = await say(t, "", { utteranceId: pure.utteranceId });
    assert.deepEqual(ok.resolved.steps.map((s) => s.intent), ["ops_continue"]);
    const r = ok.results[0];
    assert.equal(r.interrupt?.reopened, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.plan?.id, p.plan.id);
    assert.equal(consumedBy(t, pure.utteranceId), `continue:${pure.utteranceId}`);
    assert.equal(gate(t).status, "open");
    await say(t, "Pauză");
    const twice = (await say(t, "", { utteranceId: pure.utteranceId })).results[0];
    assert.match(String(twice.refused), /deja folosită/);
    assert.equal(gate(t).status, "suspended");
    const replay = await gateSay(t, "Continuă");
    assert.equal(replay.result, "UNCERTAIN");
    await assert.rejects(say(t, "", { utteranceId: replay.utteranceId }), /nu a fost recunoscută/);
    assert.equal(gate(t).status, "suspended");
  } finally { for (const r of releases) r.open = true; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-08
test("CV-08 a plan armed in the same Lega session is answered first: the spoken „Continuă” resumes nothing and leaves the plan's window open; „Da, execută planul” still confirms it", async () => {
  const t = await voiceHub();
  const releases = [];
  try {
    const lega = await startDerivedLega(t, t.owner);
    const running = await runningOpsPlan(t);
    releases.push(running.release);
    const calls = [];
    t.hub.executors["test.probe"] = {
      describe: ({ n = 1 }) => ({ title: `Sondă ${n}`, params: { n }, ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: [`rezultat ${n}`] }),
      run: async ({ params, authorize }) => { authorize({ op: "media.render" }); calls.push(params.n); return { result: { n: params.n } }; },
    };
    const plan = await t.hub.opsPlans.propose({ kind: "test.armed.continue", title: "Plan armat", steps: [{ kind: "test.probe", params: { n: 1 } }], actor: "lega", via: "voice" });
    assert.equal(t.hub.opsPlans.armForLega({ planId: plan.id, legaSessionId: lega }).armed, true);
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(running.plan.id);
    const g = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    assert.equal(g.boundPlanId, plan.id, "the segment is bound to the armed plan by the server");
    await waitFor(() => (voiceEvents(t).some((e) => e.utteranceId === g.utteranceId) ? true : null), 5000);
    assert.equal(voiceEvents(t).find((e) => e.utteranceId === g.utteranceId).outcome, "plan_waiting");
    await waitFor(() => (spoke(t).some((s) => /planul afișat așteaptă întâi răspunsul tău/.test(s)) ? true : null), 5000);
    assert.equal(gate(t).status, "suspended", "nothing resumed");
    assert.ok(isPaused(t, running.plan.id));
    assert.ok(t.hub.armedWindows.open().some((w) => w.planId === plan.id && w.failures === 0), "the plan's window is untouched (no failure counted, not closed)");
    assert.equal(t.hub.opsPlans.view(plan.id).status, "PROPOSED");
    const yes = await gateSay(t, "Da, execută planul", { legaSessionId: lega });
    assert.equal(yes.boundPlanId, plan.id);
    const done = await waitFor(async () => { const v = await t.hub.opsPlans.idle(plan.id); return v.status === "DONE" ? v : null; }, 15000);
    assert.equal(done.consent.modality, "voice");
    assert.deepEqual(calls, [1]);
    assert.equal(gate(t).status, "suspended", "a plan's confirmation is not a resume");
  } finally { for (const r of releases) r.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ CV-07
test("CV-07 D19: a pause said to Lega through the bridge („Lega, pune totul pe pauză”, or the explicit form) in a derived session is the owner's; an unaddressed phrasing or no derived session stays unowned", async () => {
  const t = await voiceHub({ gateOn: false, codex: script([{ sleep: 2500 }, { say: "Lega, pune totul pe pauză" }, { sleep: 120000 }]) });
  try {
    const tag = credentialTag(t.owner.session.credentialId);
    const lega = await startDerivedLega(t, t.owner);
    // The real bridge path: the provider's transcript → owner.intent on the voice channel with this Lega session.
    await waitFor(() => (gate(t).status === "suspended" ? true : null), 15000);
    assert.equal(gate(t).suspendedBy.kind, "pause");
    assert.equal(gate(t).suspendedBy.credential, tag, "the owner's credential reference");
    assert.equal(gate(t).suspendedBy.channel, "voice");
    assert.ok(events(t, "lega.owner_pause").some((e) => e.via === "bridge" && e.ownerSessionId === t.owner.session.id));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'voice'"), 1);
    assert.equal((await say(t, "Continuă")).results[0].interrupt?.reopened, true, "the owner's own pause: „Continuă” reopens it");
    // The explicit form without the name: the owner's too (like the fast path's „pune pe pauză”).
    await sayVoice(t, "Pune totul pe pauză", { legaSessionId: lega });
    assert.equal(gate(t).suspendedBy.credential, tag);
    assert.equal((await say(t, "Continuă")).results[0].interrupt?.reopened, true);
    // Addressed, in a phrasing that is not the explicit form: the name makes it the owner's.
    await sayVoice(t, "Lega, ia o pauză", { legaSessionId: lega });
    assert.equal(gate(t).suspendedBy.credential, tag);
    assert.equal((await say(t, "Continuă")).results[0].interrupt?.reopened, true);
    // Unaddressed, not explicit: a pause without the owner's session (a TV in the room); „Continuă” does not reopen it.
    await sayVoice(t, "Pauză acum", { legaSessionId: lega });
    assert.equal(gate(t).suspendedBy.kind, "pause");
    assert.equal(gate(t).suspendedBy.credential, null);
    assert.equal(classifySuspension(gate(t)).cls, "pause_unowned");
    const held = (await say(t, "Continuă")).results[0];
    assert.notEqual(held.interrupt?.reopened, true);
    assert.equal(gate(t).status, "suspended");
    assert.match(held.message, /printr-o pauză fără sesiunea ta de proprietar/);
    // Addressed but with no derived Lega session behind it (no legaSessionId: a claim, not an authority): unowned.
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    await sayVoice(t, "Lega, pune totul pe pauză");
    assert.equal(classifySuspension(gate(t)).cls, "pause_unowned");
    assert.equal(events(t, "lega.owner_pause").filter((e) => e.via === "bridge").length, 3, "only the derived, addressed / explicit pauses");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
