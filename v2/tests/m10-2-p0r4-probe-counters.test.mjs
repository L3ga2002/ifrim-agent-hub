import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { newId } from "../server/core/ids.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { OWNER_PROBE_LIST, PROBE_ALIASES, PROBE_COUNTERS } from "../server/owner/probe.mjs";

// 2.12.2 (R4): the owner's §7 probe list — NAVIGATION_TO_ADVANCED, PLAN_CONFIRMATIONS, EXTRA_SCOPE_CONFIRMATIONS, VOICE_CONFIRMATIONS,
// VOICE_PAUSE, VOICE_CONTINUE, STOP_ALL (per channel), CONTEXTUAL_REARM, UNKNOWN_INTENTS, MANUAL_DEV_DB_API_INTERVENTIONS — computed
// from synthetic events / commands written the way the Hub writes them, plus the real emitters where a test Hub can run them without a
// model (intake on the voice / test channel, gate.set on the voice channel, system.stop_all). Every counter is checked against its
// window (an event at or before sinceSeq is never counted), the GET is shown read-only, and the reader script prints the owner's names.
// No model, no provider process, no network beyond the loopback test servers.
const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const SCRIPT = path.join(here, "..", "scripts", "probe-m10-2.mjs");
const OWNER_NAMES = ["GRANT_FORMS_OPENED", "MANUAL_MODE_CHANGES", "NAVIGATION_TO_APPROVALS", "NAVIGATION_TO_ADVANCED", "PLAN_CONFIRMATIONS",
  "EXTRA_SCOPE_CONFIRMATIONS", "MANUAL_DEV_DB_API_INTERVENTIONS", "VOICE_CONFIRMATIONS", "VOICE_PAUSE", "VOICE_CONTINUE", "STOP_ALL", "CONTEXTUAL_REARM", "UNKNOWN_INTENTS"];

const dispatch = (hub, type, payload, { channel = "test", actor = "test", ownerSession = null } = {}) => hub.commands.dispatch({ type, payload, actor, channel, ownerSession });
/** A command as the command bus logs it: the commands row + its command.accepted event (the seq that places it in a window). */
function logCommand(hub, { type, channel = "ui", actor = "user", payload = {}, status = "executed" }) {
  const id = newId("cmd");
  hub.bus.transaction(() => {
    hub.db.prepare(`INSERT INTO commands (id, type, actor, channel, intent_text, payload_json, status, policy_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, '', ?, ?, '{}', ?, ?)`).run(id, type, actor, channel, JSON.stringify(payload), status, id, new Date().toISOString());
    hub.bus.append({ type: "command.accepted", scopeType: "command", scopeId: id, source: actor, payload: { type, channel, policy: "AUTO_ALLOWED", decision: "allow" } });
  });
  return id;
}
/** An event with the scope and source its real emitter uses. */
const emit = (hub, type, { scopeType = "system", scopeId = "probe-r4", source = "test", payload = {} } = {}) => hub.bus.emit({ type, scopeType, scopeId, source, payload });
const seq = (hub) => hub.bus.lastSeq();
const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r.counters[k]]));
const tableCounts = (hub) => Object.fromEntries(["commands", "events", "settings", "owner_sessions", "mission_envelopes", "ops_plans", "live_grants", "approvals"]
  .map((t) => [t, hub.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const snapshot = (hub) => ({ counts: tableCounts(hub),
  settings: hub.db.prepare("SELECT group_concat(key || '=' || value_json || '@' || updated_at, '|') AS s FROM settings").get().s,
  sessions: hub.db.prepare("SELECT group_concat(id || '@' || last_seen_at || '@' || status, '|') AS s FROM owner_sessions").get().s,
  lastSeq: hub.bus.lastSeq(), listeners: hub.bus.listenerCount() });
/** A minimal mission_envelopes row (status SUPERSEDED: outside the one-authority-per-project index) with the body the planner wrote. */
function envelopeRow(hub, id, body) {
  const at = new Date().toISOString();
  hub.db.prepare(`INSERT INTO mission_envelopes (id, schema_version, project_id, mission_ids_json, plan_hash, envelope_hash, body_json, summary_json, autonomy_level, status, nonce,
    proposed_by, proposed_via, issued_at, confirm_by, expires_at, created_at, updated_at) VALUES (?, 1, 'prj_r4', '[]', 'h', 'h', ?, '{}', 'SUPERVISED', 'SUPERSEDED', ?, 'test', 'test', ?, ?, ?, ?, ?)`)
    .run(id, typeof body === "string" ? body : JSON.stringify(body), `nonce-${id}`, at, at, at, at, at);
}

/** Loopback HTTP helper against a test Hub's server (GET carries no token: the probe needs none). */
function caller(t, token) {
  const host = `localhost:${t.config.port}`;
  return (method, p, { body } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

test("R4-01 NAVIGATION_TO_ADVANCED: entering Integrations → Validare live counts there, never as a grant form; the window bounds it", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await dispatch(hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" }); // before the window
    const m0 = seq(hub);
    await dispatch(hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" });
    await dispatch(hub, "owner.nav", { screen: "integrations.isolation" }, { channel: "ui", actor: "user" });
    await dispatch(hub, "owner.nav", { screen: "approvals" }, { channel: "ui", actor: "user" });
    // A navigation the command bus refused (not executed) is not an entry.
    logCommand(hub, { type: "owner.nav", payload: { screen: "integrations.live" }, status: "failed" });
    const m1 = seq(hub);
    await dispatch(hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" }); // after the window
    const r = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    assert.deepEqual(pick(r, ["navigationToAdvanced", "grantFormsOpened", "approvalsNavigations"]), { navigationToAdvanced: 1, grantFormsOpened: 0, approvalsNavigations: 1 });
    assert.equal(r.evidence.navigationToAdvanced.items[0].screen, "integrations.live");
    assert.ok(r.evidence.navigationToAdvanced.items[0].seq > m0 && r.evidence.navigationToAdvanced.items[0].seq <= m1);
    assert.equal(r.ownerList.NAVIGATION_TO_ADVANCED, 1);
    assert.equal(r.ownerList.GRANT_FORMS_OPENED, 0);
    // Lega preparing a grant / pointing at the form is still a grant form (the meaning of GRANT_FORMS_OPENED is unchanged).
    const m2 = seq(hub);
    emit(hub, "lega.grant_prepared", { payload: { kind: "run", provider: "codex" } });
    emit(hub, "lega.pointed", { payload: { target: "grant-form" } });
    assert.deepEqual(pick(hub.probe.report({ sinceSeq: m2 }), ["grantFormsOpened", "navigationToAdvanced"]), { grantFormsOpened: 2, navigationToAdvanced: 0 });
    assert.equal(hub.probe.report({ sinceSeq: 0 }).counters.navigationToAdvanced, 3, "the whole log: every executed entry");
  } finally { await t.cleanup(); }
});

test("R4-02 PLAN / EXTRA_SCOPE / VOICE confirmations: one per plan, every further one inside a plan is extra, spoken ones from the modality", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const confirmed = (id, modality, type = "envelope.confirmed") => emit(hub, type, { scopeType: type === "ops.plan.consent" ? "ops_plan" : "envelope", scopeId: id, source: "owner",
      payload: type === "ops.plan.consent" ? { modality, session: "ses_x", decisions: 0, hash: "h" } : { channel: "owner_session", modality, session: "ses_x", hash: "h" } });
    envelopeRow(hub, "env_b", { kind: "mission", limits: {} });
    envelopeRow(hub, "env_cont", { kind: "mission", continuation: { fromEnvelopeId: "env_b", stage: "PAUSED" } });
    envelopeRow(hub, "env_bad", "{not json");
    confirmed("env_a", "click"); // before the window: never counted
    emit(hub, "envelope.delta_confirmed", { scopeType: "envelope", scopeId: "env_a", source: "owner", payload: { missionId: "mis_a", kind: "cycle", modality: "click" } });
    const m0 = seq(hub);
    confirmed("env_a", "voice"); // the SAME plan confirmed again inside the window: extra (repeat), and spoken
    confirmed("env_b", "voice");
    confirmed("opp_c", "voice", "ops.plan.consent");
    confirmed("opp_d", "click", "ops.plan.consent");
    confirmed("opp_e", "keyboard", "ops.plan.consent");
    confirmed("env_bad", "voice-local"); // an unreadable body loses only the continuation detail; voice-local is spoken too
    emit(hub, "envelope.delta_confirmed", { scopeType: "envelope", scopeId: "env_b", source: "owner", payload: { missionId: "mis_b", kind: "attempt", modality: "voice", channel: "owner_session" } });
    emit(hub, "ops.plan.reconfirmed", { scopeType: "ops_plan", scopeId: "opp_d", source: "owner", payload: { session: "ses_y", previousSession: "ses_x", modality: "click" } });
    confirmed("env_cont", "typed"); // a continuation of env_b's work
    const m1 = seq(hub);
    confirmed("env_f", "voice"); // after the window
    const r = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    assert.deepEqual(pick(r, ["planConfirmations", "extraScopeConfirmations", "voiceConfirmations", "scopeConfirmations"]),
      { planConfirmations: 5, extraScopeConfirmations: 4, voiceConfirmations: 4, scopeConfirmations: 8 }, JSON.stringify(r.evidence));
    assert.deepEqual(r.evidence.planConfirmations.items.map((i) => i.seq).every((s) => s > m0 && s <= m1), true);
    assert.deepEqual(r.breakdown.extraScopeConfirmations, { delta: 1, reconfirm: 1, repeat: 1, continuation: 1, continuationChecked: true });
    assert.deepEqual(r.evidence.extraScopeConfirmations.items.map((i) => i.reason), ["repeat", "delta", "reconfirm", "continuation"]);
    assert.equal(r.evidence.extraScopeConfirmations.items.find((i) => i.reason === "continuation").from, "env_b");
    assert.deepEqual(r.breakdown.voiceConfirmations, { envelope: 3, ops: 1 });
    assert.deepEqual(r.evidence.voiceConfirmations.items.map((i) => i.modality), ["voice", "voice", "voice", "voice-local"]);
    assert.deepEqual([r.ownerList.PLAN_CONFIRMATIONS, r.ownerList.EXTRA_SCOPE_CONFIRMATIONS, r.ownerList.VOICE_CONFIRMATIONS], [5, 4, 4]);
    // A window that starts before the first confirmation of env_a counts it as that plan's one confirmation.
    const whole = hub.probe.report({ sinceSeq: 0, untilSeq: m1 });
    assert.equal(whole.counters.planConfirmations, 6);
    assert.equal(whole.counters.extraScopeConfirmations, 5, "+ the delta before the window");
    // A window holding only the later events never sees the earlier ones.
    const later = hub.probe.report({ sinceSeq: m1 });
    assert.deepEqual(pick(later, ["planConfirmations", "extraScopeConfirmations", "voiceConfirmations"]), { planConfirmations: 1, extraScopeConfirmations: 0, voiceConfirmations: 1 });
  } finally { await t.cleanup(); }
});

test("R4-03 VOICE_PAUSE: the owner's spoken pause once (lega.owner_pause + its interrupt), other spoken pauses, the voice gate suspension; nothing else", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const interrupt = (source, kind = "pause") => emit(hub, "owner.interrupt", { scopeType: "owner", scopeId: "all", source, payload: { kind, missions: 0, confirmed: 0, unconfirmed: 0, plansPaused: 0 } });
    interrupt("voice"); // before the window
    const m0 = seq(hub);
    emit(hub, "lega.owner_pause", { scopeId: "lega_1", source: "voice", payload: { ownerSessionId: "ses_1" } });
    interrupt("voice:lega_1"); // the same pause: counted once, as the owner's
    interrupt("voice"); // a spoken pause outside the owner's session
    interrupt("owner:ses_1"); // the cockpit's pause: not spoken
    interrupt("user");
    interrupt("voice", "stop_worker"); // „Oprește Codex” is not a pause
    logCommand(hub, { type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend", reason: "Lega: pauză (fără execuții noi)" } });
    logCommand(hub, { type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend" } });
    logCommand(hub, { type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend" }, status: "failed" });
    emit(hub, "lega.owner_pause", { scopeId: "lega_2", source: "voice", payload: { ownerSessionId: "ses_1", via: "bridge" } }); // its interrupt never came
    const m1 = seq(hub);
    interrupt("voice"); // after the window
    const r = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    assert.equal(r.counters.voicePause, 4, JSON.stringify(r.evidence.voicePause));
    assert.deepEqual(r.breakdown.voicePause, { owner: 2, other: 2 });
    assert.deepEqual(r.evidence.voicePause.items.map((i) => [i.owner, i.via]).sort(), [[false, "gate"], [false, "interrupt"], [true, "interrupt"], [true, "owner_pause"]]);
    assert.equal(r.ownerList.VOICE_PAUSE, 4);
    // A window that holds only the interrupt of a pause announced before it: still one spoken pause (not the owner's: no marker inside).
    const m2 = seq(hub);
    emit(hub, "lega.owner_pause", { scopeId: "lega_3", source: "voice", payload: { ownerSessionId: "ses_1" } });
    const m3 = seq(hub);
    interrupt("voice:lega_3");
    assert.deepEqual(hub.probe.report({ sinceSeq: m3 }).breakdown.voicePause, { owner: 0, other: 1 });
    assert.deepEqual(hub.probe.report({ sinceSeq: m2 }).breakdown.voicePause, { owner: 1, other: 0 });
  } finally { await t.cleanup(); }
});

test("R4-03b VOICE_PAUSE from the real emitters: a spoken pause through the intake (voice channel) and Lega's gate suspension", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const m0 = seq(hub);
    const out = (await dispatch(hub, "owner.intent", { text: "Pune totul pe pauză" }, { channel: "voice", actor: "voice" })).result;
    assert.ok(out.results.some((x) => x.intent === "pause" && x.interrupt?.kind === "pause"), JSON.stringify(out.results));
    await dispatch(hub, "gate.set", { action: "suspend", reason: "Lega: pauză (fără execuții noi)" }, { channel: "voice", actor: "voice" });
    // The same words typed in the UI are a pause, but not a spoken one.
    await dispatch(hub, "owner.intent", { text: "Pune totul pe pauză" }, { channel: "ui", actor: "user" });
    const r = hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.voicePause, 2, JSON.stringify(r.evidence.voicePause));
    assert.deepEqual(r.breakdown.voicePause, { owner: 0, other: 2 });
    assert.deepEqual(r.evidence.voicePause.items.map((i) => i.via).sort(), ["gate", "interrupt"]);
  } finally { await t.cleanup(); }
});

test("R4-04 VOICE_CONTINUE: only a verified spoken „Continuă” that resumed counts; the other outcomes are listed, the window bounds it", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const heard = (outcome) => emit(hub, "owner.continue_voice", { scopeType: "owner", scopeId: "lega_1", source: "voice-local", payload: { utteranceId: newId("utt"), legaSessionId: "lega_1", outcome } });
    heard("resumed"); // before the window
    const m0 = seq(hub);
    for (const outcome of ["resumed", "executed", "vetoed", "refused", "duplicate", "plan_waiting", "held", "nothing", "question", "something-new"]) heard(outcome);
    const m1 = seq(hub);
    heard("resumed"); // after the window
    const r = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    assert.equal(r.counters.voiceContinue, 2);
    assert.deepEqual(r.evidence.voiceContinue.items.map((i) => i.outcome), ["resumed", "executed"]);
    assert.equal(r.breakdown.voiceContinue.heard, 10);
    assert.deepEqual(r.breakdown.voiceContinue.byOutcome, { resumed: 1, executed: 1, vetoed: 1, refused: 1, duplicate: 1, plan_waiting: 1, held: 1, nothing: 1, question: 1, other: 1 });
    assert.equal(r.ownerList.VOICE_CONTINUE, 2);
    // A typed „Continuă” (an owner.interrupt continue) is not a spoken one.
    const m2 = seq(hub);
    emit(hub, "owner.interrupt", { scopeType: "owner", scopeId: "all", source: "owner:ses_1", payload: { kind: "continue", missions: 1 } });
    assert.equal(hub.probe.report({ sinceSeq: m2 }).counters.voiceContinue, 0);
  } finally { await t.cleanup(); }
});

// 2.12.2 review R4-F8 (P0-R6): STOP_ALL is the owner's „Oprește tot” only — read from the stop's own kind (payload.stopKind, runs.stopAll),
// never from the suspension record's precedence kind; a stop recorded without stopKind counts unless the Hub's shutdown wrote it (source
// "system"). The shutdown is listed on its own line (breakdown.stopAll.shutdowns), never in the owner's number. Changed expectation: the
// shutdown is no longer one of the six (5 owner Stop Alls).
test("R4-05 STOP_ALL: the owner's Stop Alls in the window, with the channel each came from; the Hub's shutdown listed apart, never counted (real Stop All on ui, voice, owner, test)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const owner = await enrolOwner(t);
    await dispatch(hub, "system.stop_all", {}, { channel: "test", actor: "test" }); // before the window
    const m0 = seq(hub);
    await dispatch(hub, "system.stop_all", { reason: "Stop All" }, { channel: "ui", actor: "user" });
    await dispatch(hub, "system.stop_all", { reason: "Lega: Oprește tot" }, { channel: "voice", actor: "voice" });
    await dispatch(hub, "system.stop_all", {}, { channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session });
    await dispatch(hub, "system.stop_all", {}, { channel: "test", actor: "test" });
    // The Hub's shutdown with work in flight (owner/stop-scope.mjs) and a phone's Stop All, as their events record them.
    emit(hub, "system.stop_all", { scopeId: "hub", source: "system", payload: { reason: "Hub shutdown (SIGTERM)", kind: "shutdown", interrupted: 1 } });
    emit(hub, "system.stop_all", { scopeId: "hub", source: "device:dev_1", payload: { reason: "Stop All", kind: "stop_all" } });
    const m1 = seq(hub);
    emit(hub, "system.stop_all", { scopeId: "hub", source: "voice", payload: { kind: "stop_all" } }); // after the window
    const r = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    assert.equal(r.counters.stopAll, 5, JSON.stringify(r.evidence.stopAll));
    assert.deepEqual(r.breakdown.stopAll.byChannel, { ui: 1, voice: 1, owner: 1, test: 1, companion: 1 });
    assert.deepEqual(r.breakdown.stopAll.byKind, { stop_all: 5, shutdown: 1 });
    assert.equal(r.breakdown.stopAll.shutdowns, 1, "the shutdown on its own line");
    assert.ok(r.evidence.stopAll.items.every((i) => i.seq > m0 && i.seq <= m1 && i.stopKind === "stop_all"));
    assert.ok(!JSON.stringify(r.evidence.stopAll).includes(owner.session.id), "the channel, never the session id");
    assert.equal(r.ownerList.STOP_ALL, 5);
    // R4-F8: the stop's OWN kind decides, never the suspension's precedence kind: an owner Stop All landing on a security record (kind
    // "security") is the owner's; a shutdown landing on an unrearmed Stop All (kind "stop_all") is not.
    const m2 = seq(hub);
    emit(hub, "system.stop_all", { scopeId: "hub", source: "voice", payload: { kind: "security", stopKind: "stop_all" } });
    emit(hub, "system.stop_all", { scopeId: "hub", source: "system", payload: { kind: "stop_all", stopKind: "shutdown" } });
    emit(hub, "system.stop_all", { scopeId: "hub", source: "user", payload: { kind: "stop_all", stopKind: "security" } });
    const k = hub.probe.report({ sinceSeq: m2 });
    assert.equal(k.counters.stopAll, 1, JSON.stringify(k.evidence.stopAll));
    assert.deepEqual(k.breakdown.stopAll, { byChannel: { voice: 1 }, byKind: { stop_all: 1, shutdown: 1, security: 1 }, shutdowns: 1 });
    // Stop All is not a manual mode change and not a spoken pause.
    assert.deepEqual(pick(r, ["manualModeChanges", "voicePause"]), { manualModeChanges: 0, voicePause: 0 });
  } finally { await t.cleanup(); }
});

test("R4-06 CONTEXTUAL_REARM and MANUAL_DEV_DB_API_INTERVENTIONS are the old counters under the owner's names: same bucket, old keys kept", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.deepEqual(PROBE_ALIASES, { contextualRearm: "gateRearms", manualDevDbApiInterventions: "developerInterventions" });
    emit(hub, "gate.rearmed", { scopeId: "gate", source: "owner:ses_1", payload: { cls: "stop_all", modeReset: false } }); // before the window
    logCommand(hub, { type: "environment.inspect", channel: "cli", actor: "cli" });
    const m0 = seq(hub);
    emit(hub, "gate.rearmed", { scopeId: "gate", source: "owner:ses_1", payload: { cls: "stop_all", modeReset: true } });
    emit(hub, "gate.rearmed", { scopeId: "gate", source: "owner:ses_1", payload: { cls: "security", modeReset: false } });
    logCommand(hub, { type: "environment.inspect", channel: "cli", actor: "cli" });
    logCommand(hub, { type: "backup.run", channel: "agent", actor: "agent" });
    const r = hub.probe.report({ sinceSeq: m0 });
    assert.deepEqual(pick(r, ["gateRearms", "contextualRearm", "developerInterventions", "manualDevDbApiInterventions"]),
      { gateRearms: 2, contextualRearm: 2, developerInterventions: 2, manualDevDbApiInterventions: 2 });
    assert.deepEqual(r.evidence.contextualRearm.items, r.evidence.gateRearms.items);
    assert.equal(r.evidence.contextualRearm.aliasOf, "gateRearms");
    assert.equal(r.evidence.gateRearms.aliasOf, undefined, "the old key is the counter itself");
    assert.deepEqual(r.evidence.manualDevDbApiInterventions.items, r.evidence.developerInterventions.items);
    assert.deepEqual([r.ownerList.CONTEXTUAL_REARM, r.ownerList.MANUAL_DEV_DB_API_INTERVENTIONS], [2, 2]);
    assert.deepEqual(r.aliases, PROBE_ALIASES);
    // A rearm is still never a manual mode change.
    assert.equal(r.counters.manualModeChanges, 0);
  } finally { await t.cleanup(); }
});

test("R4-07 UNKNOWN_INTENTS: a sentence with an unknown step that got no question and no explanation; exact when the intake says so", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const intent = (payload) => emit(hub, "owner.intent", { scopeType: "owner", scopeId: "global", source: "user", payload: { channel: "ui", source: "typed", clarification: false, refused: 0, ...payload } });
    intent({ steps: ["unknown"] }); // before the window
    const m0 = seq(hub);
    // The real intake: nonsense words (an unknown step, nothing said back), a resume asked as a question (one clarification), a bare
    // „Da” with no plan waiting (a refusal reason: an explanation).
    const nonsense = (await dispatch(hub, "owner.intent", { text: "zbrrt flonk qwyx" })).result;
    assert.deepEqual(nonsense.resolved.steps.map((s) => s.intent), ["unknown"]);
    const asked = (await dispatch(hub, "owner.intent", { text: "Continuă?" })).result;
    assert.ok(asked.resolved.clarification, JSON.stringify(asked.resolved));
    const yes = (await dispatch(hub, "owner.intent", { text: "Da" })).result;
    assert.ok(yes.resolved.refused.length >= 1 && yes.resolved.steps.some((s) => s.intent === "unknown"), JSON.stringify(yes.resolved));
    const mReal = seq(hub);
    let r = hub.probe.report({ sinceSeq: m0, untilSeq: mReal });
    assert.equal(r.counters.unknownIntents, 1, JSON.stringify(r.evidence.unknownIntents));
    // 2.12.2 (P0-R6): the intake now records, after the steps ran, how many unknown steps it left unanswered (owner.intent_outcome), so
    // the real intake's count is exact (changed expectation: it was the estimate).
    assert.deepEqual(r.evidence.unknownIntents.items.map((i) => [i.steps, i.source, i.exact]), [[1, "typed", true]]);
    assert.equal(r.breakdown.unknownIntents.estimated, 0);
    assert.ok(!JSON.stringify(r).includes("zbrrt"), "never the sentence's words");
    // Synthetic payloads: the intake's exact number when it records one; otherwise the estimate (each refusal answers one unknown step).
    intent({ steps: ["unknown"], unknownUnanswered: 1, source: "voice-provider", channel: "voice" });
    intent({ steps: ["unknown"], unknownUnanswered: 0 }); // the intake says it was answered
    intent({ steps: ["unknown", "unknown"], refused: 1 }); // one of two explained
    intent({ steps: ["unknown"], clarification: true }); // the resolver asked
    intent({ steps: ["open_project", "unknown"], unknownUnanswered: 1, source: "voice-local", channel: "owner" });
    intent({ steps: ["status"] });
    const m1 = seq(hub);
    intent({ steps: ["unknown"] }); // after the window
    r = hub.probe.report({ sinceSeq: mReal, untilSeq: m1 });
    assert.equal(r.counters.unknownIntents, 3, JSON.stringify(r.evidence.unknownIntents));
    assert.deepEqual(r.evidence.unknownIntents.items.map((i) => [i.steps, i.source, i.exact]), [[1, "voice-provider", true], [1, "typed", false], [1, "voice-local", true]]);
    assert.deepEqual(r.breakdown.unknownIntents, { bySource: { "voice-provider": 1, typed: 1, "voice-local": 1 }, estimated: 1 });
    assert.equal(r.ownerList.UNKNOWN_INTENTS, 3);
    assert.equal(hub.probe.report({ sinceSeq: m0, untilSeq: m1 }).counters.unknownIntents, 4);
  } finally { await t.cleanup(); }
});

test("R4-08 read-only: report, mark and GET /api/owner/probe write nothing (no command, event, setting, session or plan) and add no listener", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const call = caller(t, token);
  try {
    const { hub } = t;
    const owner = await enrolOwner(t);
    const m0 = seq(hub);
    envelopeRow(hub, "env_cont", { continuation: { fromEnvelopeId: "env_prev" } });
    emit(hub, "envelope.confirmed", { scopeType: "envelope", scopeId: "env_cont", source: "owner", payload: { modality: "voice" } });
    emit(hub, "lega.owner_pause", { scopeId: "lega_1", source: "voice", payload: { ownerSessionId: owner.session.id } });
    emit(hub, "owner.continue_voice", { scopeType: "owner", scopeId: "lega_1", source: "voice-local", payload: { outcome: "resumed" } });
    await dispatch(hub, "system.stop_all", {}, { channel: "ui", actor: "user" });
    emit(hub, "owner.intent", { scopeType: "owner", scopeId: "global", source: "user", payload: { channel: "ui", source: "typed", steps: ["unknown"], clarification: false, refused: 0 } });
    const before = snapshot(hub);
    for (const w of [{ sinceSeq: 0 }, { sinceSeq: m0 }, { sinceSeq: m0, untilSeq: m0 }]) hub.probe.report(w);
    hub.probe.mark();
    const got = await call("GET", `/api/owner/probe?sinceSeq=${m0}`);
    assert.equal(got.status, 200);
    assert.deepEqual(pick({ counters: got.json.counters }, ["extraScopeConfirmations", "voiceConfirmations", "voicePause", "voiceContinue", "stopAll", "unknownIntents"]),
      { extraScopeConfirmations: 1, voiceConfirmations: 1, voicePause: 1, voiceContinue: 1, stopAll: 1, unknownIntents: 1 });
    assert.equal((await call("GET", "/api/owner/probe?mark=1")).status, 200);
    assert.deepEqual(snapshot(hub), before, "nothing written, no listener added");
    // The POST verbs of the probe stay refused (the probe has no write path): only GET is routed.
    assert.equal((await call("POST", "/api/owner/probe", { body: { sinceSeq: 0 } })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});

test("R4-09 the reader script prints the owner's names exactly, in his order, with the details; --json carries ownerList; an older Hub prints „?”", async () => {
  assert.deepEqual(OWNER_PROBE_LIST.map(([name]) => name), OWNER_NAMES, "the owner's §7 names, in his order");
  assert.ok(OWNER_PROBE_LIST.every(([, key]) => PROBE_COUNTERS.includes(key)));
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const env = { ...process.env, HUB_V2_PORT: String(t.config.port) };
  try {
    const { hub } = t;
    const m0 = seq(hub);
    await dispatch(hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" });
    emit(hub, "envelope.confirmed", { scopeType: "envelope", scopeId: "env_1", source: "owner", payload: { modality: "voice" } });
    emit(hub, "envelope.delta_confirmed", { scopeType: "envelope", scopeId: "env_1", source: "owner", payload: { kind: "cycle", modality: "click" } });
    emit(hub, "lega.owner_pause", { scopeId: "lega_1", source: "voice", payload: { ownerSessionId: "ses_1" } });
    emit(hub, "owner.interrupt", { scopeType: "owner", scopeId: "all", source: "voice:lega_1", payload: { kind: "pause" } });
    emit(hub, "owner.continue_voice", { scopeType: "owner", scopeId: "lega_1", source: "voice-local", payload: { outcome: "resumed" } });
    emit(hub, "owner.continue_voice", { scopeType: "owner", scopeId: "lega_1", source: "voice-local", payload: { outcome: "vetoed" } });
    emit(hub, "system.stop_all", { scopeId: "hub", source: "voice", payload: { kind: "stop_all" } });
    emit(hub, "gate.rearmed", { scopeId: "gate", source: "owner:ses_1", payload: { cls: "stop_all" } });
    emit(hub, "owner.intent", { scopeType: "owner", scopeId: "global", source: "user", payload: { channel: "ui", source: "typed", steps: ["unknown"], clarification: false, refused: 0 } });
    logCommand(hub, { type: "environment.inspect", channel: "cli", actor: "cli" });

    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, "--since", String(m0)], { env, timeout: 30000 });
    const lines = stdout.split(/\r?\n/);
    const ownerLines = lines.filter((l) => /^[A-Z_]{6,}\s+\d+\s{2}/.test(l));
    assert.deepEqual(ownerLines.map((l) => l.split(/\s+/)[0]), OWNER_NAMES, stdout);
    const value = (name) => Number(ownerLines.find((l) => l.startsWith(`${name} `)).trim().split(/\s+/)[1]);
    assert.deepEqual(Object.fromEntries(OWNER_NAMES.map((n) => [n, value(n)])), { GRANT_FORMS_OPENED: 0, MANUAL_MODE_CHANGES: 0, NAVIGATION_TO_APPROVALS: 0,
      NAVIGATION_TO_ADVANCED: 1, PLAN_CONFIRMATIONS: 1, EXTRA_SCOPE_CONFIRMATIONS: 1, MANUAL_DEV_DB_API_INTERVENTIONS: 1, VOICE_CONFIRMATIONS: 1, VOICE_PAUSE: 1,
      VOICE_CONTINUE: 1, STOP_ALL: 1, CONTEXTUAL_REARM: 1, UNKNOWN_INTENTS: 1 });
    assert.match(stdout, /^Lista proprietarului \(§7\):$/m);
    // 2.12.2 (R4-F8): STOP_ALL counts the owner's Stop Alls only; its kinds are no longer printed next to it (changed expectation).
    assert.match(stdout, /^STOP_ALL\s+1 {2}Stop All \(canal: voice 1\)$/m);
    assert.ok(!/^Alte opriri/m.test(stdout), "no other stop in this window");
    assert.match(stdout, /^VOICE_CONTINUE\s+1 {2}„Continuă” rostit care a reluat \(fraze verificate local: 2 — resumed 1, vetoed 1\)$/m);
    assert.match(stdout, /^EXTRA_SCOPE_CONFIRMATIONS\s+1 {2}Confirmări suplimentare în același plan \(diferență 1\)$/m);
    assert.match(stdout, /^VOICE_PAUSE\s+1 {2}Pauze spuse cu vocea \(a ta 1\)$/m);
    // 2.12.2 (P0-R6): the intake gives the exact number now; only an event written before that is estimated (changed label).
    assert.match(stdout, /^UNKNOWN_INTENTS\s+1 {2}Fraze neînțelese \(fără întrebare sau explicație\) \(sursă: typed 1; 1 estimată din refuzuri \(frază înregistrată înainte de numărarea exactă\)\)$/m);
    // The owner's names for the two old counters keep the old labels; the other existing counters follow, as before.
    assert.match(stdout, /^MANUAL_DEV_DB_API_INTERVENTIONS\s+1 {2}Intervenții de dezvoltator \(agent\/cli\/test, drift setări\)$/m);
    assert.match(stdout, /^CONTEXTUAL_REARM\s+1 {2}Redeschideri ale porții din cockpit \(Windows Hello\)$/m);
    assert.match(stdout, /^Alte contoare:$/m);
    for (const label of ["Grant-uri create manual", "Confirmări de plan \\(scope\\)", "Întrebări de clarificare", "Autentificări suplimentare", "Pași automați de pregătire", "Indicații Lega spre fluxul vechi"]) {
      assert.match(stdout, new RegExp(`^\\s+\\d+ {2}${label}$`, "m"), label);
    }
    assert.match(stdout, /^Hash setări: [0-9a-f]{16}$/m);
    assert.ok(!/„\?”/.test(stdout), "a 2.12.2 Hub serves every counter");

    const json = JSON.parse((await execFileAsync(process.execPath, [SCRIPT, "--since", String(m0), "--json"], { env, timeout: 30000 })).stdout);
    assert.deepEqual(Object.keys(json.ownerList), OWNER_NAMES);
    assert.equal(json.ownerList.MANUAL_DEV_DB_API_INTERVENTIONS, json.counters.developerInterventions);
    assert.equal(json.counters.manualDevDbApiInterventions, json.counters.developerInterventions);
  } finally {
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }

  // An older Hub (2.12.1: the eleven counters only): the owner's new names print „?”, the two aliases fall back to the old keys, and the
  // grant-form line says what it still includes. A loopback stub on an ephemeral port, never the live Hub.
  const old = { window: { sinceSeq: 7, untilSeq: 9, fromAt: null, toAt: null, testMode: false },
    counters: { grantFormsOpened: 1, manualGrantCreates: 0, manualModeChanges: 0, approvalsNavigations: 0, scopeConfirmations: 1, clarifications: 0,
      extraAuthentications: 0, developerInterventions: 3, automaticReadinessSteps: 0, legaOldFlowPointers: 0, gateRearms: 1 }, settings: { tableHash: "0123456789abcdef", drift: [] } };
  const stub = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(old)); });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  try {
    const port = stub.address().port;
    assert.notEqual(port, 8011);
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, "--since", "7"], { env: { ...process.env, HUB_V2_PORT: String(port) }, timeout: 30000 });
    assert.match(stdout, /^GRANT_FORMS_OPENED\s+1 {2}Formulare de grant deschise$/m);
    assert.match(stdout, /^NAVIGATION_TO_ADVANCED\s+\? {2}/m);
    assert.match(stdout, /^STOP_ALL\s+\? {2}Stop All$/m);
    assert.match(stdout, /^MANUAL_DEV_DB_API_INTERVENTIONS\s+3 {2}/m);
    assert.match(stdout, /^CONTEXTUAL_REARM\s+1 {2}/m);
    assert.match(stdout, /„\?” = Hub-ul servit nu are încă aceste contoare/);
    assert.match(stdout, /GRANT_FORMS_OPENED include și intrările în Integrări → Validare live/);
  } finally { await new Promise((r) => stub.close(r)); }
});
