// 2.12.3 (D1) — UNKNOWN_INTENTS counted provider transcripts the Hub left to Lega's agent on purpose, even when Lega answered them (live
// 2026-10-06). The probe now closes such a sentence when Lega answered it — a lega.tool call or a non-empty assistant transcript in the same
// Lega session, after the owner's sentence, before his next one and within LEGA_ANSWER_WINDOW_MS — read after the fact (ids, roles and
// lengths, never words) and listed apart (breakdown.unknownAnsweredByLega). The intake's owner.intent_outcome carries the link (the Lega
// session and the owner's transcript event, ids only); older rows are linked through the owner.intent command row.
// PASS_SIMULATED: test Hubs (events written the way the Hub writes them, the real intake, the fixture Lega app-server); no model, no live
// Hub, no network. The reader script runs against a test Hub's port (HUB_V2_PORT), never the live Hub.
// D1 review (2.12.3): a bare lega.tool call (the agent's lega.hub_actions pre-check) is no longer an answer — only a delegated turn that SPOKE
// (lega.turn_completed spoke: true, tied to the sentence by its start or a tool call after it) or the voice model's own speech (lega.transcript
// origin "realtime"; a line the Hub spoke through the same channel is tagged hub_bridge / hub_notice and never counts). D1-01 adds U8–U15,
// D1-04 a pre-check followed by silence, D1-04b/c the origin tagging end to end; D1-06 the matching mutations.
// Mutation checks run on temporary copies of probe.mjs (the repository file is never touched). Hand mutation (exact bytes restored),
// recorded here: removing the link spread (`...link`) from the owner.intent_outcome payload in owner/intake.mjs turns D1-03 (payload deepEqual)
// and D1-04 (link assertion) red, while the closure itself still passes through the command-row fallback.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { newId } from "../server/core/ids.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { LEGA_ANSWER_WINDOW_MS } from "../server/owner/probe.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE_PATH = path.join(here, "..", "server", "owner", "probe.mjs");
const ERRORS_PATH = path.join(here, "..", "server", "core", "errors.mjs");
const SCRIPT = path.join(here, "..", "scripts", "probe-m10-2.mjs");
const execFileAsync = promisify(execFile);
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const SESSION = "lega_d1";
const OTHER = "lega_other";
/** Words that must never reach the report. */
const WORDS = ["ce se întâmplă", "Ce-i asta grey global", "Local", "fraza patru", "fraza cinci", "fraza sase", "fraza sapte", "scris de mana", "doi pasi", "pereche", "viitor", "raspuns gol",
  "fraza noua", "fraza zece", "Mai am un minut", "Am deschis Notepad", "fraza doisprezece", "fraza treisprezece", "fraza paisprezece", "fraza cincisprezece"];

const clockHub = async (extra = {}) => {
  const state = { now: Date.parse("2026-10-06T10:00:00.000Z") };
  const t = await makeTestHub({ clock: () => new Date(state.now), ...extra });
  return { t, tick: (ms = 1000) => { state.now += ms; } };
};
/** The owner's final transcript, as runtime/lega.mjs records it. */
const ownerSaid = (hub, text, session = SESSION) => hub.bus.emit({ type: "lega.transcript", scopeType: "system", scopeId: session, source: "user", payload: { role: "user", text } });
/** An assistant transcript; `origin` as runtime/lega.mjs tags it (the voice model's own words, or a line the Hub spoke; null = an older row). */
const legaSaid = (hub, text, session = SESSION, origin = "realtime") => hub.bus.emit({ type: "lega.transcript", scopeType: "system", scopeId: session, source: "lega", payload: { role: "assistant", text, ...(origin ? { origin } : {}) } });
const legaTool = (hub, tool = "hub_actions", session = SESSION, turnId = null) => hub.bus.emit({ type: "lega.tool", scopeType: "system", scopeId: session, source: "lega", payload: { tool, ...(turnId ? { turnId } : {}) } });
let turnN = 0;
/**
 * D1 review: a delegated turn of Lega's agent as runtime/lega.mjs records it — its tool calls (lega.tool with the turn id) and, unless
 * `completed` is false, lega.turn_completed { turnId, status, spoke, startSeq }. Returns the turn_completed event (or the last tool call).
 */
function legaTurn(hub, { tools = ["hub_actions"], spoke = true, status = "completed", session = SESSION, startSeq = null, completed = true, extra = {} } = {}) {
  const turnId = `turn_d1_${++turnN}`;
  const from = startSeq ?? hub.bus.lastSeq();
  let last = null;
  for (const tool of tools) last = legaTool(hub, tool, session, turnId);
  if (!completed) return last;
  return hub.bus.emit({ type: "lega.turn_completed", scopeType: "system", scopeId: session, source: "lega", payload: { turnId, status, spoke, startSeq: from, ...extra } });
}
/** owner.intent + owner.intent_outcome, as owner/intake.mjs writes them (`link` = the outcome's ids; null = an older row without them). */
function sentence(hub, { source = "voice-provider", channel = "voice", steps = ["unknown"], link = null } = {}) {
  const unknown = steps.filter((s) => s === "unknown").length;
  const intent = hub.bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: "global", source: channel === "voice" ? "voice" : "owner:x", payload: { channel, source, steps, clarification: false, refused: 0, outcome: true } });
  hub.bus.emit({ type: "owner.intent_outcome", scopeType: "owner", scopeId: "global", source: "voice", payload: { intentEventId: intent.id, channel, source, unknown, unknownUnanswered: unknown, ...(link || {}) } });
  return intent;
}
const linkTo = (tr, session = SESSION) => ({ legaSessionId: session, transcriptId: tr.id });
const counted = (r) => r.evidence.unknownIntents.items.map((x) => x.id);
const closed = (r) => r.breakdown.unknownAnsweredByLega.items.map((x) => x.id);
const tableCounts = (hub) => Object.fromEntries(["commands", "events", "settings", "owner_sessions", "ops_plans"].map((k) => [k, hub.db.prepare(`SELECT COUNT(*) AS n FROM ${k}`).get().n]));

// ---------------------------------------------------------------- the synthetic matrix (D1-01) and the fallback (D1-02)
function seedMatrix(t, tick) {
  const { hub } = t;
  const ids = {};
  // U1: one agent turn (two tool calls) that spoke, then the voice model's own words → closed by the turn (the first answer).
  let tr = ownerSaid(hub, "ce se întâmplă"); tick(); ids.U1 = sentence(hub, { link: linkTo(tr) }).id; tick();
  const u1Turn = legaTurn(hub, { tools: ["hub_actions", "hub_status"] }); legaSaid(hub, "Totul merge."); tick();
  // U2: the voice model's own assistant transcript only → closed by speech.
  tr = ownerSaid(hub, "Ce-i asta grey global"); tick(); ids.U2 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaSaid(hub, "E o temă de culori."); tick();
  // U3 unanswered, then U4 answered by a turn: the turn started after U3's next sentence, so it closes U4 only.
  tr = ownerSaid(hub, "Local"); tick(); ids.U3 = sentence(hub, { link: linkTo(tr) }).id; tick();
  tr = ownerSaid(hub, "fraza patru"); tick(); ids.U4 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub); tick();
  // U3b unanswered, then U4b answered by the voice model's own words: the speech is after U3b's next sentence, so it closes U4b only.
  tr = ownerSaid(hub, "fraza patru b"); tick(); ids.U3b = sentence(hub, { link: linkTo(tr) }).id; tick();
  tr = ownerSaid(hub, "fraza patru c"); tick(); ids.U4b = sentence(hub, { link: linkTo(tr) }).id; tick(); legaSaid(hub, "Asta e tot."); tick();
  // U5: only an empty assistant transcript before the next sentence → counted.
  tr = ownerSaid(hub, "fraza cinci"); tick(); ids.U5 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaSaid(hub, "   "); tick();
  // U6: the turn that spoke ends 61 s later → counted.
  tr = ownerSaid(hub, "fraza sase"); tick(); ids.U6 = sentence(hub, { link: linkTo(tr) }).id; const u6From = hub.bus.lastSeq(); tick(LEGA_ANSWER_WINDOW_MS + 1000); legaTurn(hub, { startSeq: u6From }); tick();
  // U7: the answer only in another Lega session → counted.
  tr = ownerSaid(hub, "fraza sapte"); tick(); ids.U7 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { tools: ["hub_status"], session: OTHER }); tick();
  // A typed sentence with a (synthetic) link, followed by a turn → counted (only provider transcripts are left to Lega).
  tr = ownerSaid(hub, "scris de mana"); tick(); ids.typed = sentence(hub, { source: "typed", channel: "owner", link: linkTo(tr) }).id; tick(); legaTurn(hub); tick();
  // A two-step unknown sentence closed by a turn → counted as nothing.
  tr = ownerSaid(hub, "doi pasi"); tick(); ids.twoSteps = sentence(hub, { steps: ["unknown", "unknown"], link: linkTo(tr) }).id; tick(); legaTurn(hub); tick();
  // Two intents linked to the same transcript, one answer → one closed, one counted.
  tr = ownerSaid(hub, "pereche"); tick(); ids.pairA = sentence(hub, { link: linkTo(tr) }).id; ids.pairB = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub); tick();
  // A link to a transcript recorded AFTER its intent → counted.
  ids.future = sentence(hub, { link: { legaSessionId: SESSION, transcriptId: "pending" } }).id;
  tr = ownerSaid(hub, "viitor"); tick();
  hub.db.prepare("UPDATE events SET payload_json = json_set(payload_json, '$.transcriptId', ?) WHERE type = 'owner.intent_outcome' AND json_extract(payload_json, '$.intentEventId') = ?").run(tr.id, ids.future);
  legaTurn(hub); tick();
  // D1 review — U8: the agent's lega.hub_actions pre-check, then nothing at all (the turn never reports an end) → counted.
  tr = ownerSaid(hub, "Local"); tick(); ids.U8 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { completed: false }); tick();
  // U9: the pre-check, then the turn ends without speaking (interrupted / empty) → counted.
  tr = ownerSaid(hub, "fraza noua"); tick(); ids.U9 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { spoke: false, status: "interrupted" }); tick();
  // U10: the Hub's own one-minute notice spoken through the same channel 30 s later → counted (a Hub line is never Lega's answer).
  tr = ownerSaid(hub, "fraza zece"); tick(); ids.U10 = sentence(hub, { link: linkTo(tr) }).id; tick(30000); legaSaid(hub, "Mai am un minut din această sesiune, apoi mă opresc singură.", SESSION, "hub_notice"); tick();
  // U11: the Hub's acknowledgement for the other step of a mixed sentence → counted.
  tr = ownerSaid(hub, "fraza unsprezece"); tick(); ids.U11 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaSaid(hub, "Am deschis Notepad.", SESSION, "hub_bridge"); tick();
  // U12: a turn whose answer the Hub withheld (spoke: false) → counted.
  tr = ownerSaid(hub, "fraza doisprezece"); tick(); ids.U12 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { spoke: false, extra: { withheld: true } }); tick();
  // U15: a failed turn that said the Hub's failure line (spoke) → closed.
  tr = ownerSaid(hub, "fraza cincisprezece"); tick(); ids.U15 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { status: "failed" }); tick();
  // (A turn that starts between two sentences belongs to the first one if it is still open: U14 and U13 each follow a closed sentence.)
  // U14: a turn that started before the sentence but called a tool after it → closed (it took the sentence up).
  const u14From = hub.bus.lastSeq();
  tr = ownerSaid(hub, "fraza paisprezece"); tick(); ids.U14 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { startSeq: u14From }); tick();
  // U13: a turn that started BEFORE the sentence (it answers the one before, already closed) with no tool call after it → counted.
  const u13From = hub.bus.lastSeq();
  tr = ownerSaid(hub, "fraza treisprezece"); tick(); ids.U13 = sentence(hub, { link: linkTo(tr) }).id; tick(); legaTurn(hub, { tools: [], startSeq: u13From }); tick();
  return { ids, u1Turn };
}
function checkMatrix(r, { ids, u1Turn }) {
  const expectCounted = [ids.U3, ids.U3b, ids.U5, ids.U6, ids.U7, ids.typed, ids.pairB, ids.future, ids.U8, ids.U9, ids.U10, ids.U11, ids.U12, ids.U13];
  const expectClosed = [ids.U1, ids.U2, ids.U4, ids.U4b, ids.twoSteps, ids.pairA, ids.U15, ids.U14];
  assert.deepEqual(counted(r), expectCounted);
  assert.deepEqual(closed(r), expectClosed);
  const b = r.breakdown.unknownAnsweredByLega;
  assert.deepEqual({ sentences: b.sentences, turn: b.turn, speech: b.speech }, { sentences: 8, turn: 6, speech: 2 });
  assert.equal(b.items[0].answerSeq, u1Turn.seq, "U1 is closed by its turn, the FIRST answer");
  assert.equal(b.items.find((x) => x.id === ids.U2).by, "speech");
  assert.equal(r.ownerList.UNKNOWN_INTENTS, 14);
  assert.equal(r.counters.unknownIntents, 14);
  assert.deepEqual(r.breakdown.unknownIntents.bySource, { "voice-provider": 13, typed: 1 });
}
/** D1-02: rows written before the outcome carried the link — the owner.intent command row the events are correlated with. */
function logIntentCommand(hub, payload, type = "owner.intent") {
  const id = newId("cmd");
  hub.bus.transaction(() => {
    hub.db.prepare(`INSERT INTO commands (id, type, actor, channel, intent_text, payload_json, status, policy_json, correlation_id, created_at)
      VALUES (?, ?, 'voice', 'voice', '', ?, 'executed', '{}', ?, ?)`).run(id, type, JSON.stringify(payload), id, new Date().toISOString());
    hub.bus.append({ type: "command.accepted", scopeType: "command", scopeId: id, source: "voice", payload: { type, channel: "voice", policy: "AUTO_ALLOWED", decision: "allow" } });
  });
  return id;
}
function seedFallback(t, tick) {
  const { hub } = t;
  const ids = {};
  const old = (type, link) => {
    const cmd = logIntentCommand(hub, { text: "x", ...link }, type);
    return hub.bus.withContext({ correlationId: cmd }, () => sentence(hub, { link: null })).id;
  };
  let tr = ownerSaid(hub, "fraza veche"); tick(); ids.linked = old("owner.intent", { legaSessionId: SESSION, transcriptId: tr.id }); tick(); legaTurn(hub); tick();
  tr = ownerSaid(hub, "alt tip"); tick(); ids.otherType = old("lega.session.start", { legaSessionId: SESSION, transcriptId: tr.id }); tick(); legaTurn(hub); tick();
  tr = ownerSaid(hub, "alta sesiune"); tick(); ids.otherSession = old("owner.intent", { legaSessionId: OTHER, transcriptId: tr.id }); tick(); legaTurn(hub); tick();
  return ids;
}
function checkFallback(r, ids) {
  assert.deepEqual(closed(r), [ids.linked]);
  assert.deepEqual(counted(r), [ids.otherType, ids.otherSession]);
}

test("D1-01 synthetic matrix: Lega's turn that spoke or her own speech closes the sentence it follows (a bare tool call or a Hub line never does); every bound holds; no words in the report; read-only", async () => {
  const { t, tick } = await clockHub();
  try {
    const m0 = t.hub.bus.lastSeq();
    const seeded = seedMatrix(t, tick);
    const before = { counts: tableCounts(t.hub), lastSeq: t.hub.bus.lastSeq(), listeners: t.hub.bus.listenerCount() };
    const r = t.hub.probe.report({ sinceSeq: m0 });
    checkMatrix(r, seeded);
    const text = JSON.stringify(r);
    for (const w of WORDS) assert.ok(!text.includes(w), `no words in the report: ${w}`);
    assert.deepEqual({ counts: tableCounts(t.hub), lastSeq: t.hub.bus.lastSeq(), listeners: t.hub.bus.listenerCount() }, before, "the report writes nothing");
  } finally { await t.cleanup(); }
});

test("D1-02 older rows: the owner.intent command row links the sentence; another command type or another session leaves it counted", async () => {
  const { t, tick } = await clockHub();
  try {
    const m0 = t.hub.bus.lastSeq();
    const ids = seedFallback(t, tick);
    checkFallback(t.hub.probe.report({ sinceSeq: m0 }), ids);
  } finally { await t.cleanup(); }
});

test("D1-03 the real intake: a bridged sentence's outcome names its Lega session and transcript (ids only); typed has none; Lega's turn that spoke closes it", async () => {
  const { t, tick } = await clockHub();
  try {
    const owner = await enrolOwner(t);
    const m0 = t.hub.bus.lastSeq();
    const outcomes = () => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'owner.intent_outcome' ORDER BY seq").all().map((e) => JSON.parse(e.payload_json));
    const intents = () => t.hub.db.prepare("SELECT id FROM events WHERE type = 'owner.intent' ORDER BY seq").all().map((e) => e.id);
    const voice = (text, tr) => t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text, legaSessionId: SESSION, transcriptId: tr.id } });
    const tr1 = ownerSaid(t.hub, "zbrrt flonk qwyx"); tick();
    await voice("zbrrt flonk qwyx", tr1); tick();
    assert.deepEqual(outcomes()[0], { intentEventId: intents()[0], channel: "voice", source: "voice-provider", unknown: 1, unknownUnanswered: 1, legaSessionId: SESSION, transcriptId: tr1.id });
    legaTurn(t.hub); tick();
    const tr2 = ownerSaid(t.hub, "blorp gnarf"); tick();
    await voice("blorp gnarf", tr2); tick();
    await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "plimf quarx", source: "typed" } });
    const typed = outcomes()[2];
    assert.equal(typed.source, "typed");
    assert.ok(!("legaSessionId" in typed) && !("transcriptId" in typed), "a typed sentence carries no link");
    const r = t.hub.probe.report({ sinceSeq: m0 });
    const [first, second, third] = intents();
    assert.deepEqual(closed(r), [first], "closed by Lega's turn that spoke");
    assert.deepEqual(counted(r), [second, third], "no answer → counted; typed → counted");
  } finally { await t.cleanup(); }
});

/** A derived Lega session on a test Hub with the fixture app-server playing `steps`. */
async function fixtureLega(steps) {
  const t = await makeTestHub({ codex: script(steps) });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  const m0 = t.hub.bus.lastSeq();
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return { t, s, m0 };
}
const payloads = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => JSON.parse(e.payload_json));

test("D1-04 end to end with the fixture Lega: the sentence Lega's turn answered aloud is not counted; a pre-check followed by silence is", async () => {
  const t = await makeTestHub({ codex: script([{ sleep: 700 }, { say: "zbrrt flonk qwyx" }, { sleep: 300 }, { tool: "hub_actions" }, { sleep: 300 }, { say: "Local" }, { sleep: 300 },
    { tool: "hub_actions", silent: true }, { sleep: 300 }]) });
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await prepareLiveWithoutGrants(t.hub);
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.refreshCodexConfig();
    const m0 = t.hub.bus.lastSeq();
    const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'owner.intent_outcome'").get().n >= 2, 5000);
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lega.turn_completed'").get().n >= 2, 5000);
    const r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.ownerList.UNKNOWN_INTENTS, 1, JSON.stringify(r.breakdown.unknownIntents));
    const b = r.breakdown.unknownAnsweredByLega;
    assert.deepEqual({ sentences: b.sentences, turn: b.turn, speech: b.speech }, { sentences: 1, turn: 1, speech: 0 });
    // D1 review: the turn records how it ended (flags only) and its tool calls name it; nothing of the words.
    const turns = payloads(t, "lega.turn_completed");
    assert.deepEqual(turns.map((x) => [x.turnId, x.status, x.spoke]), [["turn_lega_1", "completed", true], ["turn_lega_2", "interrupted", false]]);
    assert.ok(turns.every((x) => Number.isSafeInteger(x.startSeq) && Object.keys(x).every((k) => ["turnId", "status", "spoke", "startSeq"].includes(k))), JSON.stringify(turns));
    assert.deepEqual(payloads(t, "lega.tool").map((x) => x.turnId), ["turn_lega_1", "turn_lega_2"]);
    const first = t.hub.db.prepare("SELECT id FROM events WHERE type = 'lega.transcript' AND scope_id = ? AND json_extract(payload_json, '$.role') = 'user' ORDER BY seq LIMIT 1").get(s.sessionId);
    const link = JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'owner.intent_outcome' ORDER BY seq LIMIT 1").get().payload_json);
    assert.deepEqual([link.legaSessionId, link.transcriptId], [s.sessionId, first.id]);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D1-04b end to end: a line the Hub speaks through the voice is tagged with its origin; its transcript never closes an unanswered sentence", async () => {
  const NOTE = "nu era nimic oprit de reluat.";
  const { t, s, m0 } = await fixtureLega([{ sleep: 700 }, { say: "Local" }, { sleep: 2500 }, { say: NOTE, role: "assistant" }, { sleep: 300 }, { say: "Bine ai venit.", role: "assistant" }, { sleep: 300 }]);
  try {
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'owner.intent_outcome'").get().n >= 1, 10000);
    // The Hub's own spoken result (announceResults → speak with origin hub_bridge), before the provider's transcript of it arrives.
    const said = await t.hub.lega.announceResults(s.sessionId, [], { heard: "test" });
    assert.equal(said.said, NOTE);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lega.transcript' AND json_extract(payload_json, '$.role') = 'assistant'").get().n >= 2, 5000);
    const origins = payloads(t, "lega.transcript").filter((x) => x.role === "assistant").map((x) => x.origin);
    assert.deepEqual(origins, ["hub_bridge", "realtime"]);
    assert.ok(payloads(t, "lega.transcript").filter((x) => x.role === "user").every((x) => !("origin" in x)), "the owner's transcripts carry no origin");
    const r = t.hub.probe.report({ sinceSeq: m0 });
    // The Hub's line (30 s window, before the next sentence) does not close „Local”; the voice model's own words after it do.
    assert.equal(r.breakdown.unknownAnsweredByLega.speech, 1);
    const closedBy = r.breakdown.unknownAnsweredByLega.items[0].answerSeq;
    const realtimeSeq = t.hub.db.prepare("SELECT seq FROM events WHERE type = 'lega.transcript' AND json_extract(payload_json, '$.origin') = 'realtime'").get().seq;
    assert.equal(closedBy, realtimeSeq, "closed by Lega's own words, never by the Hub's line");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D1-04c end to end: only the Hub's line follows the unanswered sentence → it stays counted", async () => {
  const NOTE = "nu era nimic oprit de reluat.";
  const { t, s, m0 } = await fixtureLega([{ sleep: 700 }, { say: "Local" }, { sleep: 2500 }, { say: NOTE, role: "assistant" }, { sleep: 300 }]);
  try {
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'owner.intent_outcome'").get().n >= 1, 10000);
    await t.hub.lega.announceResults(s.sessionId, [], { heard: "test" });
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => payloads(t, "lega.transcript").some((x) => x.role === "assistant"), 5000);
    const r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.ownerList.UNKNOWN_INTENTS, 1, JSON.stringify(r.breakdown));
    assert.equal(r.breakdown.unknownAnsweredByLega.sentences, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D1-05 GET /api/owner/probe writes nothing; the reader script names the sentences Lega answered next to UNKNOWN_INTENTS", async () => {
  const { t, tick } = await clockHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  try {
    const m0 = t.hub.bus.lastSeq();
    let tr = ownerSaid(t.hub, "ce se întâmplă"); tick(); sentence(t.hub, { link: linkTo(tr) }); tick(); legaTurn(t.hub); tick();
    tr = ownerSaid(t.hub, "Local"); tick(); sentence(t.hub, { link: linkTo(tr) }); tick();
    const before = { counts: tableCounts(t.hub), lastSeq: t.hub.bus.lastSeq(), listeners: t.hub.bus.listenerCount() };
    const got = await new Promise((resolve, reject) => {
      const host = `localhost:${t.config.port}`;
      http.get({ host: "127.0.0.1", port: t.config.port, path: `/api/owner/probe?sinceSeq=${m0}`, headers: { Host: host, Origin: `http://${host}` } }, (res) => {
        const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      }).on("error", reject);
    });
    assert.equal(got.status, 200);
    assert.equal(got.json.ownerList.UNKNOWN_INTENTS, 1);
    assert.equal(got.json.breakdown.unknownAnsweredByLega.sentences, 1);
    assert.deepEqual({ counts: tableCounts(t.hub), lastSeq: t.hub.bus.lastSeq(), listeners: t.hub.bus.listenerCount() }, before, "the GET writes nothing");
    const env = { ...process.env, HUB_V2_PORT: String(t.config.port), HUB_V2_DATA_DIR: t.dataDir };
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, "--since", String(m0)], { env, timeout: 30000 });
    assert.match(stdout, /^UNKNOWN_INTENTS\s+1 .*\(sursă: voice-provider 1; o frază la care a răspuns Lega \(neinclusă\)\)$/m, stdout);
  } finally {
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});

// ---------------------------------------------------------------- D1-06 mutation checks (temp copies of probe.mjs)
let mutationN = 0;
async function mutatedProbe(mutate) {
  const src = fs.readFileSync(PROBE_PATH, "utf8");
  const changed = mutate(src);
  assert.notEqual(changed, src, "the mutation must apply");
  const file = path.join(os.tmpdir(), `ifrim-d1-probe-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(file, changed.replace('from "../core/errors.mjs"', `from ${JSON.stringify(pathToFileURL(ERRORS_PATH).href)}`));
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}
const MUTATIONS = [
  ["claimed", (s) => s.replace("if (!answer || claimed.has(answer.id)) continue;", "if (!answer) continue;"), "matrix"],
  ["next sentence bound (speech)", (s) => s.replace("firstSpeech.get(link.s, tr.seq, next, windowEnd)", "firstSpeech.get(link.s, tr.seq, Number.MAX_SAFE_INTEGER, windowEnd)"), "matrix"],
  ["next sentence bound (turn)", (s) => s.replace("firstTurn.get(link.s, tr.seq, windowEnd, next, tr.seq, tr.seq, next)", "firstTurn.get(link.s, tr.seq, windowEnd, Number.MAX_SAFE_INTEGER, tr.seq, tr.seq, Number.MAX_SAFE_INTEGER)"), "matrix"],
  ["time window", (s) => s.replace("new Date(until + LEGA_ANSWER_WINDOW_MS).toISOString()", "\"9999-12-31T00:00:00.000Z\""), "matrix"],
  ["same Lega session", (s) => s.replace("FROM events e WHERE e.scope_type = 'system' AND e.scope_id = ? AND e.type = 'lega.turn_completed'", "FROM events e WHERE e.scope_type = 'system' AND (e.scope_id = ? OR 1) AND e.type = 'lega.turn_completed'"), "matrix"],
  // D1 review: a turn closes a sentence only when it spoke, only when it is tied to it, and a Hub line is never Lega's speech.
  ["spoke only", (s) => s.replace(" AND json_extract(e.payload_json, '$.spoke') = 1", ""), "matrix"],
  ["turn tied to the sentence", (s) => s.replace("COALESCE(json_extract(e.payload_json, '$.startSeq'), -1) >= ?", "? IS NOT NULL"), "matrix"],
  ["Hub lines excluded", (s) => s.replace("AND COALESCE(json_extract(payload_json, '$.origin'), 'realtime') = 'realtime'", ""), "matrix"],
  ["bare tool call is an answer (the old rule)", (s) => s.replace("AND type = 'lega.transcript' AND json_extract(payload_json, '$.role') = 'assistant'\n", "AND (type = 'lega.tool' OR type = 'lega.transcript') AND (type = 'lega.tool' OR json_extract(payload_json, '$.role') = 'assistant')\n").replace("        AND LENGTH(TRIM(COALESCE(json_extract(payload_json, '$.text'), ''))) > 0\n        AND COALESCE(", "        AND (type = 'lega.tool' OR LENGTH(TRIM(COALESCE(json_extract(payload_json, '$.text'), ''))) > 0)\n        AND (type = 'lega.tool' OR COALESCE(").replace("= 'realtime' ORDER BY seq LIMIT 1", "= 'realtime') ORDER BY seq LIMIT 1"), "matrix"],
  ["non-empty speech", (s) => s.replace("\n        AND LENGTH(TRIM(COALESCE(json_extract(payload_json, '$.text'), ''))) > 0", ""), "matrix"],
  ["provider transcripts only", (s) => s.replace("e.payload.source === \"voice-provider\" && ", ""), "matrix"],
  ["transcript before its intent", (s) => s.replace("if (!tr || !(tr.seq < e.seq)) continue;", "if (!tr) continue;"), "matrix"],
  ["command-row fallback", (s) => s.replace("if (!link && e.correlationId) {", "if (false) {"), "fallback"],
  ["closure in the report", (s) => s.replace("const byLega = unknown ? answers.get(e.id) : null;", "const byLega = null;"), "matrix"],
];

test("D1-06 mutation checks: each bound of the closure is what keeps D1-01 / D1-02 green", async () => {
  const { t, tick } = await clockHub();
  try {
    const m0 = t.hub.bus.lastSeq();
    const matrix = seedMatrix(t, tick);
    const m1 = t.hub.bus.lastSeq();
    const fallback = seedFallback(t, tick);
    const run = (mod) => {
      const probe = mod.createProbe({ db: t.hub.db, bus: t.hub.bus, config: t.config });
      try { return { matrix: probe.report({ sinceSeq: m0, untilSeq: m1 }), fallback: probe.report({ sinceSeq: m1 }) }; } finally { probe.close(); }
    };
    // The unmutated copy passes both (the harness itself is sound).
    const real = run(await mutatedProbe((s) => `${s}\n// copy\n`));
    checkMatrix(real.matrix, matrix);
    checkFallback(real.fallback, fallback);
    for (const [label, mutate, which] of MUTATIONS) {
      const r = run(await mutatedProbe(mutate));
      const check = which === "matrix" ? () => checkMatrix(r.matrix, matrix) : () => checkFallback(r.fallback, fallback);
      assert.throws(check, undefined, `mutation „${label}” must turn the ${which} check red`);
    }
  } finally { await t.cleanup(); }
});
