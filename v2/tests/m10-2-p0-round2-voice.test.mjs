// Milestone 10.2.1 — P0 round 2, unit R2a "intake + voice". (REG-01 / D22) „Continuă” holds ONLY what the current suspension's own stop
// stopped (owner/stop-scope.mjs: a Stop All, the shutdown, a security stop, a legacy row) and the missions; work stopped for any other
// reason — a desktop intervention (USER_INPUT), „Preiau eu”, the owner's own „Pauză” — resumes as before P0, also under a palette
// suspension or a legacy row; typed, spoken and through a clarification choice alike. (AS-06) the hold is decided the same way on a
// choice, by a pure credential comparison, without reopening anything. (SM-07) another authenticator's pause is answered with the cockpit
// rearm, never „spune Continuă”. (VOICE-01) Lega's provider copy of a spoken „Continuă” is a VETO only, one answer per sentence;
// (VOICE-02) the provider copy is silenced only while the local filter runs now, and a refused claim is said once; (VOICE-03) a choice the
// voice cannot make points to the cockpit; (VOICE-04) a not-yet answer by voice never promises a reopening; (VOICE-05) the answer quotes
// what was heard, „nothing to resume” is one short line; (VOICE-06) only an affirmative pause is the owner's.
// PASS_SIMULATED: fixture providers (fake app-server), the fixture voice worker, a software authenticator; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { HubError } from "../server/core/errors.mjs";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { enrolVoice, speak, startDerivedLega } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { continueCopyKind } from "../server/owner/voice.mjs";
import { CONTINUE_QUESTION } from "../server/owner/intents.mjs";
import { classifySuspension, credentialTag } from "../server/policy/gate-state.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const gate = (t) => t.hub.settings.get("executionGate");
const clsOf = (t) => classifySuspension(gate(t)).cls;
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json || "{}"));
const asOwner = (t, type, payload = {}, session = t.owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const say = (t, text, extra = {}) => asOwner(t, "owner.intent", { text, ...extra });
const choose = (t, id) => asOwner(t, "owner.intent", { choice: { forIntent: "ops_continue", id } });
const sayVoice = (t, text, extra = {}) => t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text, ...extra } }).then((r) => r.result);
const spoke = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const voiceEvents = (t, outcome = null) => events(t, "owner.continue_voice").filter((e) => !outcome || e.outcome === outcome);
const voiceEventOf = (t, utteranceId) => waitFor(() => voiceEvents(t).find((e) => e.utteranceId === utteranceId) || null, 10000);
const consumedBy = (t, id) => t.hub.db.prepare("SELECT consumed_by FROM voice_utterances WHERE id = ?").get(id)?.consumed_by || null;
const status = (t, id) => t.hub.opsPlans.view(id).status;
const resumesOf = (t, id) => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.resumed' AND scope_id = ?", id);
const transcriptAt = (t, lega, text) => t.hub.db.prepare("SELECT created_at FROM events WHERE type = 'lega.transcript' AND scope_id = ? AND json_extract(payload_json, '$.role') = 'user' AND json_extract(payload_json, '$.text') = ? ORDER BY seq LIMIT 1").get(lega, text)?.created_at || null;
const openGate = (t) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
const paletteSuspend = (t) => t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend", reason: "Pauză (paletă)" } });
/** A suspended gate written before 2.12.1 (no suspendedBy): legacy_unknown. */
const legacySuspend = (t, at = new Date(Date.now() - 5000)) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Stop All", changedAt: at.toISOString(), changedBy: "user" }, "test"));
/** A pause recorded by ANOTHER authenticator of the owner (a credential reference that is not this session's). */
const otherAuthPause = (t) => {
  const at = new Date().toISOString();
  t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: at, changedBy: "x",
    suspendedBy: { kind: "pause", id: `sus_other_${Date.now().toString(36)}`, credential: "0".repeat(24), at, since: at, missions: [] } }, "test"));
};
const ownerStop = async (t) => {
  const out = (await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session })).result;
  await sleep(100); // the stop's deferred reactions run first, as between two real requests
  return out;
};
const rearm = (t, card) => asOwner(t, "gate.rearm", { nonce: card.nonce, hash: card.hash }, t.owner.reauth());

/**
 * Operation-plan executors: one that waits until its key is released — a pause interrupts it (the step is not done, so a resume runs it
 * again, as a real step would) — and one the owner's intervention stops (USER_INPUT → NEEDS_OWNER). The hub's cleanup first ends every
 * wait (`released.all`), so no step outlives its test.
 */
function testExecutors(t) {
  const released = new Set();
  released.all = false;
  const free = (k) => released.all || released.has(k);
  const cleanup = t.cleanup;
  t.cleanup = async () => { released.all = true; await sleep(50); return cleanup(); };
  t.hub.executors["test.wait"] = {
    describe: ({ k = "x" } = {}) => ({ title: `Așteaptă ${k}`, params: { k }, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ params, authorize, abort }) => {
      authorize({ op: "media.render" });
      while (!free(params.k) && !abort.aborted) await sleep(15);
      if (!free(params.k)) throw new HubError("conflict", "Pasul a fost oprit", { code: "PAUSED" });
      return { result: { k: params.k } };
    },
  };
  t.hub.executors["test.intervene"] = {
    describe: () => ({ title: "Intervenție", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); throw new HubError("conflict", "Ai intervenit (tastatură/mouse)", { code: "USER_INPUT" }); },
  };
  return released;
}
/** A confirmed operation plan: RUNNING (test.wait, key = title) or stopped by the owner's intervention (test.intervene → NEEDS_OWNER). */
async function opsPlan(t, title, kind = "test.wait") {
  const p = await asOwner(t, "ops.plan.propose", { kind: "r2a.test", title, steps: [{ kind, params: kind === "test.wait" ? { k: title } : {} }], limits: {} });
  await asOwner(t, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash });
  if (kind === "test.wait") await waitFor(() => t.hub.opsPlans.view(p.id).steps.some((s) => s.status === "RUNNING"));
  else await waitFor(() => (status(t, p.id) === "NEEDS_OWNER" ? true : null));
  return p;
}
/** Leaves nothing stopped: a waiting step is released (the plan completes), a stopped plan is cancelled. */
async function settle(t, released, p) {
  released.add(p.title);
  await t.hub.opsPlans.idle(p.id);
  if (["PAUSED", "NEEDS_OWNER"].includes(status(t, p.id))) t.hub.opsPlans.cancel(p.id, { reason: "test", actor: "test" });
  await t.hub.opsPlans.idle(p.id);
}

/** The owner (voice-first), a factory test project with one mission draft, BUILD_SAFE, the gate open. */
async function ownerHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "r2a-alfa");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Voce Alfa" })).result;
  const owner = await enrolOwner(t);
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, owner, mission };
}
/** The owner (voice-first) with the voice enrolled; the local voice filter on or off; BUILD_SAFE, the gate open. */
async function voiceHub({ gateOn = true, codex = script([{ sleep: 120000 }]) } = {}) {
  const t = await makeTestHub({ queues: true, codex });
  await prepareLiveWithoutGrants(t.hub);
  const owner = await enrolOwner(t, { activatePolicy: true });
  await enrolVoice(t, owner);
  if (gateOn) await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
  return { ...t, owner };
}
/** One gate segment as the page sends it; waits for its local transcript (MATCH only). */
async function gateSay(t, text, opts = {}) {
  const g = await speak(t, t.owner, text, { purpose: "gate", ...opts });
  if (g.result === "MATCH") await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 8000);
  return g;
}
/** Holds the next LOCAL transcriptions (the speaker decision is not held) until released: the order of the two copies is the test's. */
function holdTranscription(t) {
  const engine = t.hub.voiceEngine;
  const real = engine.analyze;
  let open = false;
  let wake = null;
  const opened = new Promise((resolve) => { wake = resolve; });
  let reached = 0;
  engine.analyze = async (buffer, opts = {}) => {
    if (opts.transcribe && !opts.embed && !open) { reached += 1; await opened; }
    return real.call(engine, buffer, opts);
  };
  return { reached: () => reached, release: () => { open = true; wake(); }, restore: () => { engine.analyze = real; } };
}

// ------------------------------------------------------------------------------------------------------------------------------ pure
test("R2V-00 (VOICE-01) the provider copy's kind: only a question about resuming or a resume among other words can veto; unrelated words never", () => {
  for (const s of ["Continuă", "Continuă.", "Lega, continuă", "Ok, continuă", "Reia"]) assert.equal(continueCopyKind(s), "continue", s);
  for (const s of ["Continuă?", "Lega, continuă?", "Pot să continui?", "Ce urmează? Continuă", "Continuă dacă trec testele"]) assert.equal(continueCopyKind(s), "question", s);
  for (const s of ["Continuă. Mulțumesc.", "Da. Continuă."]) assert.equal(continueCopyKind(s), "mixed", s);
  for (const s of ["", "Ce urmează?", "Bună ziua", "Lega, un moment", "Arată-mi testele"]) assert.equal(continueCopyKind(s), null, s);
});

// ------------------------------------------------------------------------------------------------------------------------------ REG-01
test("R2V-01 (REG-01 / D22) a palette suspension or a legacy row: the typed „Continuă” resumes a plan a desktop intervention (USER_INPUT), „Preiau eu” or the owner's own „Pauză” stopped — as before P0; the gate is not touched, no card", async () => {
  const t = await ownerHub();
  try {
    const released = testExecutors(t);
    for (const kind of ["suspend", "legacy_unknown"]) {
      for (const cause of ["user_input", "takeover", "pause"]) {
        const label = `${kind}/${cause}`;
        openGate(t);
        if (kind === "suspend") await paletteSuspend(t); else legacySuspend(t);
        assert.equal(clsOf(t), kind, label);
        const p = await opsPlan(t, `Plan ${label}`, cause === "user_input" ? "test.intervene" : "test.wait");
        if (cause === "takeover") assert.ok(((await say(t, "Preiau eu")).results[0].plansPaused || []).includes(p.id), label);
        if (cause === "pause") assert.ok(((await say(t, "Pauză")).results[0].plansPaused || []).includes(p.id), label);
        await t.hub.opsPlans.idle(p.id);
        assert.ok(["PAUSED", "NEEDS_OWNER"].includes(status(t, p.id)), `${label}: ${status(t, p.id)}`);
        assert.equal(clsOf(t), kind, `${label}: stopping the plan does not change the suspension`);
        const before = resumesOf(t, p.id);
        const r = (await say(t, "Continuă")).results[0];
        assert.equal(r.plan?.id, p.id, `${label}: ${JSON.stringify(r).slice(0, 400)}`);
        assert.equal(r.gateRearm, undefined, label);
        assert.equal(r.stopHold, undefined, label);
        assert.notEqual(r.interrupt?.reopened, true, label);
        await waitFor(() => (resumesOf(t, p.id) > before ? true : null), 5000);
        assert.equal(gate(t).status, "suspended", `${label}: the gate is not reopened`);
        assert.equal(clsOf(t), kind, label);
        await settle(t, released, p);
      }
    }
    assert.equal(events(t, "gate.rearmed").length, 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'"), 0);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ D22
test("R2V-02 (D22) after Stop All the typed „Continuă” resumes a plan stopped later for its own reason and holds what the stop itself paused (a plan, the desktop session) — said once, with the card; the rearm restarts nothing; „Continuă” afterwards resumes them", async () => {
  const t = await ownerHub();
  try {
    const released = testExecutors(t);
    const a = await opsPlan(t, "Plan Alfa");
    const desk = t.hub.desktop.ensureSession({ controller: "owner" });
    const stopped = await ownerStop(t);
    await t.hub.opsPlans.idle(a.id);
    assert.deepEqual(stopped.plansPaused, [a.id]);
    assert.equal(stopped.scope?.desktopSessionId, desk.id);
    let desktopResumes = 0;
    t.hub.desktop.resume = async () => { desktopResumes += 1; return { resumed: true }; };
    // M10-OP-12: a new plan after Stop All is allowed; the owner's own intervention stops it — not the stop's.
    const b = await opsPlan(t, "Plan Beta", "test.intervene");
    const r = (await say(t, "Continuă")).results[0];
    assert.equal(r.plan?.id, b.id, JSON.stringify(r).slice(0, 500));
    assert.equal(status(t, a.id), "PAUSED", "the stop's plan waits for the rearm");
    assert.equal(desktopResumes, 0, "the stop's desktop session waits for the rearm");
    assert.equal(r.gateRearm?.kind, "gate_rearm", JSON.stringify(r).slice(0, 500));
    assert.match(r.message, /^Ce a rămas oprit \(un plan de operare, sesiunea desktop\) așteaptă redeschiderea porții, oprită de Stop All\. O redeschizi aici, cu Windows Hello \(cardul „Redeschide poarta”\); după aceea spui din nou „Continuă”\.$/);
    assert.doesNotMatch(r.message, ADMIN_POINTERS);
    await settle(t, released, b);
    // Only the stop's own work is left: nothing resumes, the card and what stays (one answer).
    const h = (await say(t, "Continuă")).results[0];
    assert.equal(h.plan, undefined);
    assert.equal(h.gateRearm?.kind, "gate_rearm");
    assert.match(h.message, /^Poarta e oprită de Stop All, așa că „Continuă” nu reia nimic acum: ce e pe pauză rămâne pe pauză \(un plan de operare, sesiunea desktop\)\. O redeschizi aici, cu Windows Hello \(cardul „Redeschide poarta”\); după aceea spui din nou „Continuă”\.$/);
    assert.equal(status(t, a.id), "PAUSED");
    assert.equal(desktopResumes, 0);
    assert.equal((await rearm(t, h.gateRearm)).reopened, true);
    await sleep(200);
    assert.equal(status(t, a.id), "PAUSED", "the rearm restarts nothing");
    assert.equal(desktopResumes, 0);
    const before = resumesOf(t, a.id);
    const after = (await say(t, "Continuă")).results[0];
    assert.equal(after.plan?.id, a.id, JSON.stringify(after).slice(0, 400));
    assert.equal(after.gateRearm, undefined);
    assert.equal(desktopResumes, 1);
    await waitFor(() => (resumesOf(t, a.id) > before ? true : null), 5000);
    await settle(t, released, a);
  } finally { await t.cleanup(); }
});

test("R2V-03 (D22) the spoken paths hold the same: owner.intent {utteranceId} after Stop All holds the stop's plan (card) and resumes one paused later for its own reason; in a gated Lega session a legacy row holds what was paused before it (Lega's not-yet answer) and resumes what was paused after it", async () => {
  // The page path (owner.intent {utteranceId}), no Lega: Stop All ends any voice session anyway.
  const t = await voiceHub({ gateOn: false });
  try {
    const released = testExecutors(t);
    const a = await opsPlan(t, "Plan Alfa");
    await ownerStop(t);
    await t.hub.opsPlans.idle(a.id);
    const g1 = await gateSay(t, "Continuă");
    const held = (await say(t, "", { utteranceId: g1.utteranceId })).results.find((x) => x.intent === "ops_continue");
    assert.equal(held.gateRearm?.kind, "gate_rearm", JSON.stringify(held).slice(0, 400));
    assert.match(held.message, /^Poarta e oprită de Stop All, așa că „Continuă” nu reia nimic acum: ce e pe pauză rămâne pe pauză \(un plan de operare\)/);
    assert.equal(consumedBy(t, g1.utteranceId), `continue:${g1.utteranceId}`);
    assert.equal(status(t, a.id), "PAUSED");
    const b = await opsPlan(t, "Plan Beta");
    t.hub.opsPlans.pause(b.id, { reason: "Pauză", actor: "owner" });
    await t.hub.opsPlans.idle(b.id);
    const g2 = await gateSay(t, "Ok, continuă");
    const r = (await say(t, "", { utteranceId: g2.utteranceId })).results.find((x) => x.intent === "ops_continue");
    assert.equal(r.plan?.id, b.id, JSON.stringify(r).slice(0, 400));
    assert.match(r.message, /^Ce a rămas oprit \(un plan de operare\) așteaptă redeschiderea porții, oprită de Stop All\./);
    assert.equal(status(t, a.id), "PAUSED", "the stop's plan stays held");
    assert.equal(gate(t).status, "suspended");
    await settle(t, released, b);
  } finally { await t.cleanup(); }

  // The Lega path (continueFromVoice) under a legacy row: what was paused at or before it is the stop's (fail-closed evidence).
  const v = await voiceHub();
  try {
    const released = testExecutors(v);
    const lega = await startDerivedLega(v, v.owner);
    const c = await opsPlan(v, "Plan Gama");
    v.hub.opsPlans.pause(c.id, { reason: "Pauză", actor: "owner" });
    await v.hub.opsPlans.idle(c.id);
    await sleep(20);
    legacySuspend(v, new Date());
    assert.equal(clsOf(v), "legacy_unknown");
    const g = await gateSay(v, "Lega, continuă", { legaSessionId: lega });
    const audit = await voiceEventOf(v, g.utteranceId);
    assert.equal(audit.outcome, "held");
    assert.equal(audit.gate?.code, "LEGA_ACTIVE", JSON.stringify(audit));
    const memo = await v.hub.intake.continueFromVoice({ utteranceId: g.utteranceId, ownerSessionId: v.owner.session.id, legaSessionId: lega });
    assert.equal(memo.result.gateRearm, undefined, "never a card by voice");
    assert.match(memo.result.message, /^Poarta e oprită fără o origine înregistrată, așa că „Continuă” nu reia nimic acum: ce e pe pauză rămâne pe pauză \(un plan de operare\)\. După ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur\.$/);
    assert.equal(status(v, c.id), "PAUSED");
    // A plan paused AFTER the legacy row is not the stop's: the spoken „Continuă” resumes it; the held one stays.
    const d = await opsPlan(v, "Plan Delta");
    v.hub.opsPlans.pause(d.id, { reason: "Pauză", actor: "owner" });
    await v.hub.opsPlans.idle(d.id);
    const g2 = await gateSay(v, "Ok, continuă", { legaSessionId: lega });
    assert.equal((await voiceEventOf(v, g2.utteranceId)).outcome, "resumed");
    await waitFor(() => (resumesOf(v, d.id) ? true : null), 5000);
    assert.equal(status(v, c.id), "PAUSED");
    await waitFor(() => (spoke(v).some((s) => /^Am auzit „Ok, continuă” \(vocea ta, verificată local\): Am reluat planul „Plan Delta” în aceleași limite\. Ce a rămas oprit \(un plan de operare\) așteaptă redeschiderea porții/.test(s)) ? true : null), 5000);
    assert.equal(gate(v).status, "suspended");
    await settle(v, released, d);
  } finally { await v.hub.lega.stopAll("test").catch(() => {}); await v.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ AS-06
test("R2V-04 (AS-06 / D22) a clarification choice is held exactly like the typed „Continuă”, decided without reopening anything: the stop's plan → GATE_REARM_REQUIRED and the card; another authenticator's pause → a plan stopped for its own reason resumes, a mission waits (the card); the own pause is never reopened by a choice", async () => {
  const t = await ownerHub();
  try {
    const released = testExecutors(t);
    let ownPauseCalls = 0;
    let resumeStoppedCalls = 0;
    const realOwn = t.hub.interrupts.resumeOwnPause;
    const realStopped = t.hub.interrupts.resumeStopped;
    t.hub.interrupts.resumeOwnPause = (...args) => { ownPauseCalls += 1; return realOwn(...args); };
    t.hub.interrupts.resumeStopped = (...args) => { resumeStoppedCalls += 1; return realStopped(...args); };
    // (a) The choice is offered (two plans the owner stopped); one is resumed from its own card, then Stop All pauses it: the stop's.
    const a = await opsPlan(t, "Plan Alfa");
    const b = await opsPlan(t, "Plan Beta");
    for (const p of [a, b]) { t.hub.opsPlans.pause(p.id, { reason: "Pauză", actor: "owner" }); await t.hub.opsPlans.idle(p.id); }
    const q = (await say(t, "Continuă")).results[0];
    assert.deepEqual((q.clarification?.options || []).map((o) => o.id).sort(), [a.id, b.id].sort(), JSON.stringify(q).slice(0, 400));
    await t.hub.opsPlans.resume(a.id, { session: t.owner.session, actor: `owner:${t.owner.session.id}` });
    await waitFor(() => t.hub.opsPlans.view(a.id).steps.some((s) => s.status === "RUNNING"));
    await ownerStop(t);
    await t.hub.opsPlans.idle(a.id);
    assert.equal(status(t, a.id), "PAUSED");
    const callsBefore = ownPauseCalls;
    const heldChoice = (await choose(t, a.id)).results[0];
    assert.equal(heldChoice.stopHold?.code, "GATE_REARM_REQUIRED", JSON.stringify(heldChoice).slice(0, 400));
    assert.equal(heldChoice.gateRearm?.kind, "gate_rearm");
    assert.match(heldChoice.message, /^Planul de operare „Plan Alfa” a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta/);
    assert.equal(heldChoice.plan, undefined);
    assert.equal(status(t, a.id), "PAUSED");
    assert.equal(ownPauseCalls, callsBefore, "a choice never runs the reopening");
    // B was stopped by the owner before the stop: not the stop's — the typed „Continuă” resumes it, the gate stays stopped.
    const rb = (await say(t, "Continuă")).results[0];
    assert.equal(rb.plan?.id, b.id, JSON.stringify(rb).slice(0, 400));
    assert.equal(status(t, a.id), "PAUSED");
    await settle(t, released, b);
    const card = (await say(t, "Continuă")).results[0].gateRearm;
    await rearm(t, card);
    assert.equal((await say(t, "Continuă")).results[0].plan?.id, a.id);
    await settle(t, released, a);

    // (b) Another authenticator's pause lands while a choice is open: the chosen plan (stopped for its own reason) resumes, nothing reopens.
    const c = await opsPlan(t, "Plan Gama");
    const d = await opsPlan(t, "Plan Delta");
    for (const p of [c, d]) { t.hub.opsPlans.pause(p.id, { reason: "Pauză", actor: "owner" }); await t.hub.opsPlans.idle(p.id); }
    assert.ok((await say(t, "Continuă")).results[0].clarification, "the choice is offered");
    otherAuthPause(t);
    const ownBefore = ownPauseCalls;
    const rd = (await choose(t, d.id)).results[0];
    assert.equal(rd.plan?.id, d.id, JSON.stringify(rd).slice(0, 400));
    assert.equal(ownPauseCalls, ownBefore, "the credential comparison is pure: nothing reopened");
    assert.equal(clsOf(t), "owner_pause");
    assert.equal(gate(t).status, "suspended");
    await settle(t, released, d);

    // (c) A mission offered by the same question (the Hub's own option, server-held) waits for the open gate: the card, no resume.
    const conv = t.hub.intake.conversationOf(`owner:${t.owner.session.id}`);
    conv.clarification = { question: `Care misiune reiau: „${t.mission.title}”?`, forIntent: "ops_continue", options: [{ id: t.mission.id, label: t.mission.title }],
      step: { intent: "ops_continue", effect: "effect", effectClass: "SENSITIVE_OR_SCOPE_CHANGE", args: {}, constraints: {}, text: "continua" }, projectId: null, at: Date.now() };
    const stoppedBefore = resumeStoppedCalls;
    const rm = (await choose(t, t.mission.id)).results[0];
    assert.equal(rm.gateRearm?.kind, "gate_rearm", JSON.stringify(rm).slice(0, 400));
    assert.equal(rm.gateRearm.cls, "owner_pause");
    assert.match(rm.message, /^Poarta e oprită printr-o pauză din altă sesiune a ta \(alt autentificator\), așa că alegerea nu reia nimic acum: ce e pe pauză rămâne pe pauză \(un plan de operare\)\. O redeschizi aici, cu Windows Hello/);
    assert.doesNotMatch(rm.message, /spune sau scrie „Continuă”/);
    assert.equal(resumeStoppedCalls, stoppedBefore, "the mission is not resumed under the stopped gate");
    assert.equal(ownPauseCalls, ownBefore);

    // (d) The owner's OWN pause while a choice is open: the chosen plan resumes, the gate stays on the owner's pause (only „Continuă" reopens it).
    openGate(t);
    const e = await opsPlan(t, "Plan Epsilon");
    t.hub.opsPlans.pause(e.id, { reason: "Pauză", actor: "owner" });
    await t.hub.opsPlans.idle(e.id);
    assert.ok((await say(t, "Continuă")).results[0].clarification, "C and E: the choice is offered");
    await say(t, "Pauză");
    assert.equal(clsOf(t), "owner_pause");
    assert.equal(gate(t).suspendedBy.credential, credentialTag(t.owner.session.credentialId));
    const ownCalls = ownPauseCalls;
    const re = (await choose(t, e.id)).results[0];
    assert.equal(re.plan?.id, e.id, JSON.stringify(re).slice(0, 400));
    assert.equal(ownPauseCalls, ownCalls);
    assert.equal(gate(t).status, "suspended", "a choice never reopens the owner's pause");
    await settle(t, released, e);
    await settle(t, released, c);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ SM-07, VOICE-04
test("R2V-05 (SM-07 / VOICE-04) by voice: another authenticator's pause is answered with what ends first (Lega) and the cockpit card — never „spune Continuă”; a palette suspension or a stop still being confirmed never promises a reopening", async () => {
  const t = await voiceHub();
  try {
    const lega = await startDerivedLega(t, t.owner);
    otherAuthPause(t);
    const g = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    const audit = await voiceEventOf(t, g.utteranceId);
    assert.equal(audit.outcome, "held");
    const memo = await t.hub.intake.continueFromVoice({ utteranceId: g.utteranceId, ownerSessionId: t.owner.session.id, legaSessionId: lega });
    assert.equal(memo.result.gateRearm, undefined);
    assert.equal(memo.result.gateStopped?.code, "LEGA_ACTIVE", JSON.stringify(memo.result.gateStopped));
    assert.equal(memo.result.message, "Poarta e oprită printr-o pauză din altă sesiune a ta (alt autentificator); nu e nimic pe pauză de reluat. După ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur.");
    assert.doesNotMatch(memo.result.message, /Ai pus Hub-ul pe pauză|spune sau scrie „Continuă”|„Continuă” îl reia/);
    await waitFor(() => (spoke(t).some((s) => /^Am auzit „Lega, continuă” \(vocea ta, verificată local\): Poarta e oprită printr-o pauză din altă sesiune a ta/.test(s)) ? true : null), 5000);
    assert.ok(t.hub.lega.hubActions().some((x) => x.intents.includes("ops_continue") && /altă sesiune a ta/.test(x.said)), "the Hub's line is kept for lega.hub_actions");
    // The bridged „Lega, redeschide poarta” is judged with the derived session too.
    const ask = (await sayVoice(t, "Lega, redeschide poarta", { legaSessionId: lega })).results[0];
    assert.equal(ask.intent, "gate_rearm");
    assert.equal(ask.gateRearm, undefined, "never a card on the voice route");
    assert.equal(ask.gateStopped?.code, "LEGA_ACTIVE");
    assert.equal(ask.message, "Poarta e oprită printr-o pauză din altă sesiune a ta (alt autentificator): după ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur.");
    // A palette suspension: the same shape; a stop still being confirmed names that first. Never „apoi redeschid poarta”.
    openGate(t);
    await paletteSuspend(t);
    const pal = (await sayVoice(t, "Lega, redeschide poarta", { legaSessionId: lega })).results[0];
    assert.equal(pal.gateStopped?.code, "LEGA_ACTIVE");
    assert.equal(pal.message, "Poarta e oprită printr-o suspendare a porții: după ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur.");
    const realAdmitting = t.hub.runs.admittingCount;
    t.hub.runs.admittingCount = () => 1;
    try {
      const busy = (await sayVoice(t, "Lega, redeschide poarta", { legaSessionId: lega })).results[0];
      assert.equal(busy.gateStopped?.code, "RUNS_ACTIVE");
      assert.equal(busy.message, "Poarta e oprită printr-o suspendare a porții: după ce oprirea e confirmată și închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur.");
    } finally { t.hub.runs.admittingCount = realAdmitting; }
    for (const r of [memo.result, ask, pal]) { assert.doesNotMatch(r.message, /apoi redeschid poarta/); assert.doesNotMatch(r.message, ADMIN_POINTERS); }
    assert.equal(gate(t).status, "suspended");
    assert.equal(events(t, "gate.rearmed").length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ VOICE-01
/** A gated derived Lega session whose provider says „Bună ziua” (the time anchor) and later „Continuă?”; a plan paused by the owner. */
async function vetoHub(gapMs, after = []) {
  const t = await voiceHub({ codex: script([{ sleep: 1500 }, { say: "Bună ziua" }, { sleep: gapMs }, { say: "Continuă?" }, ...after, { sleep: 120000 }]) });
  const released = testExecutors(t);
  const lega = await startDerivedLega(t, t.owner);
  // The anchor's own segment (the provider hears only what the local filter released).
  await speak(t, t.owner, "Bună ziua", { purpose: "gate", legaSessionId: lega });
  const p = await opsPlan(t, "Plan Alfa");
  await say(t, "Pauză");
  await t.hub.opsPlans.idle(p.id);
  assert.equal(clsOf(t), "owner_pause");
  const anchor = Date.parse(await waitFor(() => transcriptAt(t, lega, "Bună ziua"), 10000));
  return { t, released, lega, p, anchor };
}

test("R2V-06 (VOICE-01) provider copy first: the owner asked „Continuă?” (the provider kept the „?”, the local transcript „Continuă.” lost it) — nothing resumes, the utterance is used up, exactly ONE line is spoken (the question's answer)", async () => {
  const { t, lega, p } = await vetoHub(2500);
  const hold = holdTranscription(t);
  try {
    const n0 = spoke(t).length;
    const g = await speak(t, t.owner, "Continuă.", { purpose: "gate", legaSessionId: lega });
    assert.equal(g.result, "MATCH");
    await waitFor(() => (hold.reached() ? true : null), 5000);
    await waitFor(() => transcriptAt(t, lega, "Continuă?"), 10000);
    await waitFor(() => (spoke(t).slice(n0).some((s) => /Ai întrebat dacă să continui/.test(s)) ? true : null), 8000);
    hold.release();
    const audit = await voiceEventOf(t, g.utteranceId);
    assert.equal(audit.outcome, "vetoed", JSON.stringify(audit));
    assert.equal(audit.copy, "question");
    await sleep(600);
    assert.equal(gate(t).status, "suspended", "D20: a question never resumes");
    assert.equal(status(t, p.id), "PAUSED");
    assert.equal(consumedBy(t, g.utteranceId), `continue:${g.utteranceId}`);
    const lines = spoke(t).slice(n0);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.match(lines[0], /^Ai întrebat dacă să continui, așa că nu reiau nimic acum/);
    assert.equal(lines[0].startsWith(CONTINUE_QUESTION.slice(0, 40)), true);
    // Positive control: the owner's clean typed „Continuă” still reopens it.
    assert.equal((await say(t, "Continuă")).results[0].interrupt?.reopened, true);
  } finally { hold.restore(); await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("R2V-07 (VOICE-01) local copy first: „Continuă.” verified locally, the provider's „Continuă?” arrives within the short wait — vetoed, nothing resumes, ONE line", async () => {
  const { t, lega, p, anchor } = await vetoHub(3000);
  const hold = holdTranscription(t);
  try {
    const n0 = spoke(t).length;
    const g = await speak(t, t.owner, "Continuă.", { purpose: "gate", legaSessionId: lega });
    await waitFor(() => (hold.reached() ? true : null), 5000);
    // Released ~1.3 s before the provider's copy: the intake's bounded wait (2.5 s) sees it arrive.
    await waitFor(() => (Date.now() >= anchor + 3000 - 1300 ? true : null), 10000, 10);
    assert.equal(transcriptAt(t, lega, "Continuă?"), null, "the local copy is first");
    hold.release();
    const audit = await voiceEventOf(t, g.utteranceId);
    assert.equal(audit.outcome, "vetoed", JSON.stringify(audit));
    await sleep(800);
    assert.equal(gate(t).status, "suspended");
    assert.equal(status(t, p.id), "PAUSED");
    const lines = spoke(t).slice(n0);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.match(lines[0], /^Ai întrebat dacă să continui/);
    assert.equal(voiceEvents(t, "resumed").length, 0);
  } finally { hold.restore(); await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("R2V-08 (VOICE-01) a resume already said: the provider's late „Continuă?” of the same sentence is not answered again (no „nu reiau nimic” after „Am redeschis…”); a later, separate question still is", async () => {
  // After the late copy, the owner asks a separate question (2 s later): that one is answered as usual.
  const { t, lega, p, anchor } = await vetoHub(4500, [{ sleep: 2000 }, { say: "Pot să continui?" }]);
  try {
    const n0 = spoke(t).length;
    const g = await gateSay(t, "Continuă.", { legaSessionId: lega });
    assert.ok(Date.now() < anchor + 4500, "the local copy is first");
    const audit = await voiceEventOf(t, g.utteranceId);
    assert.equal(audit.outcome, "resumed", JSON.stringify(audit));
    await waitFor(() => (gate(t).status === "open" ? true : null), 5000);
    await waitFor(() => transcriptAt(t, lega, "Continuă?"), 10000);
    await sleep(800);
    const lines = spoke(t).slice(n0);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.match(lines[0], /^Am auzit „Continuă” \(vocea ta, verificată local\): Am redeschis poarta după pauza ta\. Am reluat planul „Plan Alfa” în aceleași limite\./);
    assert.ok(!lines.some((s) => /Ai întrebat dacă să continui/.test(s)));
    assert.notEqual(status(t, p.id), "PAUSED");
    await waitFor(() => transcriptAt(t, lega, "Pot să continui?"), 10000);
    await waitFor(() => (spoke(t).length > n0 + 1 ? true : null), 5000);
    const later = spoke(t).slice(n0);
    assert.equal(later.length, 2, JSON.stringify(later));
    assert.match(later[1], /^Ai întrebat dacă să continui, așa că nu reiau nimic acum/, "a separate question is answered");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ VOICE-02
test("R2V-09 (VOICE-02) the provider's „Continuă” is silenced only while the local filter runs NOW; a refused local claim is said once (never total silence)", async () => {
  // (a) The filter turned off mid-session: the session stays, the provider copy gets the honest line; nothing resumes.
  const a = await voiceHub({ codex: script([{ sleep: 4000 }, { say: "Lega, continuă" }, { sleep: 120000 }]) });
  try {
    const released = testExecutors(a);
    const lega = await startDerivedLega(a, a.owner);
    assert.equal(a.hub.lega.state().gated, true);
    const p = await opsPlan(a, "Plan Alfa");
    await say(a, "Pauză");
    await a.hub.opsPlans.idle(p.id);
    await dispatch(a.hub, "voice.gate", { enabled: false }, { ownerSession: a.owner.session });
    assert.equal(a.hub.lega.active(), true);
    await waitFor(() => (spoke(a).some((s) => /„Continuă” îl iau scris în cockpit sau cu vocea ta verificată local; filtrul vocal e oprit acum\./.test(s)) ? true : null), 15000);
    assert.ok(a.hub.lega.hubActions().some((x) => x.intents.includes("ops_continue") && x.outcome === "refused"));
    assert.equal(gate(a).status, "suspended");
    assert.equal(status(a, p.id), "PAUSED");
    assert.equal(lega, a.hub.lega.state().id);
    released.add("Plan Alfa");
  } finally { await a.hub.lega.stopAll("test").catch(() => {}); await a.cleanup(); }

  // (b) A local segment the claim refuses (the page tagged another plan than the one armed: flagged) — said once, then not repeated.
  const t = await voiceHub();
  try {
    const released = testExecutors(t);
    const lega = await startDerivedLega(t, t.owner);
    const p = await opsPlan(t, "Plan Beta");
    await say(t, "Pauză");
    await t.hub.opsPlans.idle(p.id);
    t.hub.executors["test.probe"] = { describe: () => ({ title: "Sondă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }), run: async ({ authorize }) => { authorize({ op: "media.render" }); return { result: {} }; } };
    const armed = await t.hub.opsPlans.propose({ kind: "test.armed", title: "Plan armat", steps: [{ kind: "test.probe", params: {} }], actor: "lega", via: "voice" });
    assert.equal(t.hub.opsPlans.armForLega({ planId: armed.id, legaSessionId: lega }).armed, true);
    const n0 = spoke(t).length;
    const g1 = await gateSay(t, "Continuă", { legaSessionId: lega, envelopeId: "opp_alt_plan" });
    assert.ok(g1.flags.length, "flagged by the server");
    assert.equal((await voiceEventOf(t, g1.utteranceId)).outcome, "refused");
    const g2 = await gateSay(t, "Ok, continuă", { legaSessionId: lega, envelopeId: "opp_alt_plan" });
    assert.equal((await voiceEventOf(t, g2.utteranceId)).outcome, "refused");
    await sleep(500);
    const lines = spoke(t).slice(n0);
    assert.equal(lines.filter((s) => /^„Continuă” spus nu se ia în seamă: semnale suspecte la înregistrare/.test(s)).length, 1, JSON.stringify(lines));
    assert.ok(/Scrie „Continuă” în cockpit sau repetă-l\.$/.test(lines.find((s) => /semnale suspecte/.test(s)) || ""));
    assert.ok(t.hub.lega.hubActions().some((x) => x.intents.includes("ops_continue") && x.outcome === "refused" && /semnale suspecte/.test(x.said)));
    assert.equal(consumedBy(t, g1.utteranceId), null, "a refused segment is not used up");
    assert.equal(gate(t).status, "suspended");
    assert.equal(status(t, p.id), "PAUSED");
    assert.equal(t.hub.opsPlans.view(armed.id).status, "PROPOSED", "the armed plan is untouched");
    released.add("Plan Beta");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ VOICE-03, VOICE-05
test("R2V-10 (VOICE-03 / VOICE-05) by voice: nothing stopped → one short line quoting what was heard; two stopped plans → the reopened gate, then a pointer to the cockpit choice (never a question the voice cannot answer)", async () => {
  const t = await voiceHub();
  try {
    const released = testExecutors(t);
    const lega = await startDerivedLega(t, t.owner);
    const n0 = spoke(t).length;
    const r0 = await gateSay(t, "Reia", { legaSessionId: lega });
    assert.equal((await voiceEventOf(t, r0.utteranceId)).outcome, "nothing");
    await waitFor(() => (spoke(t).length > n0 ? true : null), 5000);
    assert.deepEqual(spoke(t).slice(n0), ["Am auzit „Reia” (vocea ta, verificată local): nu e nimic oprit de reluat."]);
    const a = await opsPlan(t, "Plan Alfa");
    const b = await opsPlan(t, "Plan Beta");
    await say(t, "Pauză");
    for (const p of [a, b]) await t.hub.opsPlans.idle(p.id);
    const n1 = spoke(t).length;
    const g = await gateSay(t, "Lega, continuă", { legaSessionId: lega });
    assert.equal((await voiceEventOf(t, g.utteranceId)).outcome, "question");
    await waitFor(() => (spoke(t).length > n1 ? true : null), 5000);
    const lines = spoke(t).slice(n1);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    assert.match(lines[0], /^Am auzit „Lega, continuă” \(vocea ta, verificată local\): Am redeschis poarta după pauza ta\. Am 2 planuri de operare oprite \(„Plan (Alfa|Beta)”, „Plan (Alfa|Beta)”\); pe care îl reiau alegi în cockpit, cu butonul „Continuă” al planului\.$/);
    assert.doesNotMatch(lines[0], /Care plan/);
    assert.equal(gate(t).status, "open");
    assert.deepEqual([status(t, a.id), status(t, b.id)], ["PAUSED", "PAUSED"], "the choice is the owner's, in the cockpit");
    for (const p of [a, b]) await settle(t, released, p);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ VOICE-06
test("R2V-11 (VOICE-06) a negated or conditional pause said to Lega is never recorded as the owner's credential-bound pause; the affirmative one is", async () => {
  const t = await voiceHub({ gateOn: false });
  try {
    const lega = await startDerivedLega(t, t.owner);
    const tag = credentialTag(t.owner.session.credentialId);
    for (const sentence of ["Lega, nu pune totul pe pauză", "Lega, nu ia o pauză", "Lega, dacă pică testele, pune totul pe pauză", "Lega, pune totul pe pauză când termini", "Lega, doar dacă trec testele, ia o pauză"]) {
      openGate(t);
      await sayVoice(t, sentence, { legaSessionId: lega });
      if (gate(t).status !== "open") {
        assert.equal(gate(t).suspendedBy?.credential || null, null, sentence);
        assert.notEqual(clsOf(t), "owner_pause", sentence);
      }
    }
    assert.equal(events(t, "lega.owner_pause").length, 0, "never attributed to the owner");
    openGate(t);
    await sayVoice(t, "Lega, pune totul pe pauză", { legaSessionId: lega });
    assert.equal(gate(t).suspendedBy?.credential, tag, "the affirmative, addressed pause is the owner's (D19)");
    assert.equal(events(t, "lega.owner_pause").filter((e) => e.via === "bridge").length, 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
