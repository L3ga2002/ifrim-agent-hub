import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_APPLY, decideGateApply, gateStateOf, isGateSettingEvent, gateFailClosedText, runGateApply, GATE_START_NO_PROFILE, GATE_LIVE_TEXT, GATE_TOGGLE_RESULT,
  GATE_READ_TIMEOUT_MS } from "../web/src/lib/voiceGateApply.js";
import { faceCommand, faceFromLiveEvent } from "../web/src/lib/cockpitLogic.js";
import { factoryWaitLabel } from "../web/src/lib/uiLogic.js";

// 2.12.2 (L1, L8 web half, R3 leftover) — the web side of three defects seen in the owner's live Lega use on 2026-10-06:
// L1: the local voice filter toggled in Lega → Configurare during a running Lega session had no effect (the session kept filtering after
//     OFF; ON would not have protected — the raw microphone kept flowing). The panel now keeps the RTCRtpSender and swaps the sent track
//     at once (lib/voiceGateApply.js: decideGateApply + runGateApply), fail closed.
// L8: a face sentence the Hub heard by voice („Arată-ți fața”) arrives as the live event `lega.face` and is applied like a typed one.
// R3: the factory's new wait reason "retry" (one automatic re-dispatch after a per-turn timeout) has an owner-facing label.
// Pure logic with fake senders/filters (no browser, no microphone, no Hub, no model), plus source checks of the components using it.
const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const JARGON = /envelope|lease|grant|gate check|acceptance|\bgate\b|\bretry\b/i;
const DIACRITICS = /[ăâîșțĂÂÎȘȚ]/;

/** A fake RTCRtpSender: records every replaceTrack (the track sent from then on) into the shared log; `fail` makes chosen calls throw. */
function fakeSender(log, { fail = () => false } = {}) {
  const s = {
    track: { id: "raw" },
    async replaceTrack(track) {
      log.push(["replaceTrack", track ? track.id : null]);
      if (fail(track)) throw new Error("replaceTrack refuzat");
      s.track = track;
    },
  };
  return s;
}
const fakeGate = (log, id = "gate") => ({ track: { id }, closed: false, close() { this.closed = true; log.push(["close", id]); } });
const RAW = { id: "raw" };
const voiceOn = { gate: { enabled: true, strict: true }, profile: { id: "vp_1" }, verifier: { id: "campplus-local" } };
const voiceOff = { gate: { enabled: false, strict: true }, profile: { id: "vp_1" }, verifier: { id: "campplus-local" } };

test("P0R7-01 decideGateApply: start / stop the filter, nothing, or end the session — never the raw microphone while the filter is on or unknown", () => {
  const d = (o) => decideGateApply(o);
  // No committed session: nothing, whatever the state.
  for (const enabled of [true, false]) for (const gateRunning of [true, false]) assert.equal(d({ sessionActive: false, gateRunning, enabled, hasProfile: true }), "none");
  assert.equal(d({}), GATE_APPLY.NONE);
  assert.equal(d({ sessionActive: "yes", gateRunning: false, enabled: true, hasProfile: true }), "none", "only a real boolean session counts");
  // On.
  assert.equal(d({ sessionActive: true, gateRunning: false, enabled: true, hasProfile: true }), "start_gate");
  assert.equal(d({ sessionActive: true, gateRunning: true, enabled: true, hasProfile: true }), "none");
  // Off.
  assert.equal(d({ sessionActive: true, gateRunning: true, enabled: false, hasProfile: true }), "stop_gate");
  assert.equal(d({ sessionActive: true, gateRunning: false, enabled: false, hasProfile: true }), "none");
  assert.equal(d({ sessionActive: true, gateRunning: true, enabled: false, hasProfile: false }), "stop_gate", "the profile deleted turns the filter off");
  // On without a profile: nothing could be recognised — a running filter keeps holding, the raw microphone is never sent.
  assert.equal(d({ sessionActive: true, gateRunning: false, enabled: true, hasProfile: false }), "stop_session_fail_closed");
  assert.equal(d({ sessionActive: true, gateRunning: true, enabled: true, hasProfile: false }), "none");
  // Unknown state (the read failed): a running filter stays; the raw microphone is never kept on a guess.
  assert.equal(d({ sessionActive: true, gateRunning: false, enabled: null, hasProfile: false, known: false }), "stop_session_fail_closed");
  assert.equal(d({ sessionActive: true, gateRunning: true, enabled: null, hasProfile: false, known: false }), "none");
  // Only the boolean true turns it on.
  assert.equal(d({ sessionActive: true, gateRunning: false, enabled: "true", hasProfile: true }), "none");
  assert.deepEqual(Object.values(GATE_APPLY).sort(), ["none", "start_gate", "stop_gate", "stop_session_fail_closed"]);
});

test("P0R7-02 gateStateOf reads GET /api/voice; an answer without a boolean gate.enabled is UNKNOWN, never off; isGateSettingEvent matches only the filter's setting", () => {
  assert.deepEqual(gateStateOf(voiceOn), { known: true, enabled: true, hasProfile: true, verifier: "campplus-local" });
  assert.deepEqual(gateStateOf(voiceOff), { known: true, enabled: false, hasProfile: true, verifier: "campplus-local" });
  assert.deepEqual(gateStateOf({ gate: { enabled: true }, profile: null }), { known: true, enabled: true, hasProfile: false, verifier: null });
  for (const bad of [null, undefined, "x", 3, {}, { gate: null }, { gate: {} }, { gate: { enabled: "true" } }, { gate: { enabled: 1 } }]) {
    assert.deepEqual(gateStateOf(bad), { known: false, enabled: null, hasProfile: false, verifier: null }, JSON.stringify(bad));
  }
  assert.equal(isGateSettingEvent({ type: "settings.changed", payload: { key: "voiceGate", reason: "Voice gate settings" } }), true);
  for (const e of [{ type: "settings.changed", payload: { key: "ownerPolicy" } }, { type: "settings.changed" }, { type: "voice.gate_final", payload: { key: "voiceGate" } }, null, {}]) assert.equal(isGateSettingEvent(e), false);
});

test("P0R7-03 runGateApply OFF → ON: the raw microphone is muted FIRST, the state read, the filter started, then sent; nothing raw in between", async () => {
  const log = [];
  const sender = fakeSender(log);
  let created = null;
  const out = await runGateApply({ sender, rawTrack: RAW, gate: null,
    readState: async () => { log.push(["read"]); return voiceOn; },
    createGate: async () => { log.push(["create"]); created = fakeGate(log); return created; } });
  assert.deepEqual(log, [["replaceTrack", null], ["read"], ["create"], ["replaceTrack", "gate"]]);
  assert.equal(out.outcome, "started");
  assert.equal(out.gate, created);
  assert.equal(out.verifier, "campplus-local");
  assert.equal(out.text, GATE_LIVE_TEXT.on);
  assert.equal(sender.track.id, "gate");
  assert.equal(created.closed, false, "the caller keeps the running filter");
});

test("P0R7-04 runGateApply ON → OFF: the raw microphone replaces the filter, THEN the filter closes; a refused swap keeps the filter (safe direction)", async () => {
  const log = [];
  const gate = fakeGate(log);
  const sender = fakeSender(log); sender.track = gate.track;
  const out = await runGateApply({ sender, rawTrack: RAW, gate, readState: async () => { log.push(["read"]); return voiceOff; }, createGate: async () => assert.fail("no new filter") });
  assert.deepEqual(log, [["read"], ["replaceTrack", "raw"], ["close", "gate"]], "never muted first (a filter runs), closed only after the swap");
  assert.deepEqual(out, { outcome: "stopped", text: GATE_LIVE_TEXT.off });
  // The swap refused: the filter stays and is still the sent track.
  const log2 = [];
  const gate2 = fakeGate(log2);
  const sender2 = fakeSender(log2, { fail: (t) => t?.id === "raw" }); sender2.track = gate2.track;
  const kept = await runGateApply({ sender: sender2, rawTrack: RAW, gate: gate2, readState: async () => voiceOff, createGate: async () => assert.fail("no new filter") });
  assert.deepEqual(kept, { outcome: "kept", text: GATE_LIVE_TEXT.keptFailed });
  assert.equal(gate2.closed, false);
  assert.equal(sender2.track.id, "gate");
});

test("P0R7-05 runGateApply fails closed: a filter that cannot start, a refused swap, an unreadable state or a missing profile end the session with the sender MUTED (never raw)", async () => {
  // The filter cannot start.
  let log = []; let sender = fakeSender(log);
  let out = await runGateApply({ sender, rawTrack: RAW, readState: async () => voiceOn, createGate: async () => { throw new Error("worklet indisponibil"); } });
  assert.equal(out.outcome, "end");
  assert.equal(out.text, gateFailClosedText({ detail: "worklet indisponibil" }));
  assert.match(out.text, /Filtrul vocal nu a pornit \(worklet indisponibil\)\. Am oprit Lega, ca microfonul să nu ajungă nefiltrat la OpenAI\. Repornește Lega\./);
  assert.equal(sender.track, null, "muted, never the raw microphone");
  assert.ok(!log.some(([op, id]) => op === "replaceTrack" && id === "raw"));
  // The filter started but the sender refused it: the new filter is closed, the sender stays muted.
  log = []; sender = fakeSender(log, { fail: (t) => t?.id === "gate" });
  let made = null;
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => voiceOn, createGate: async () => (made = fakeGate(log)) });
  assert.equal(out.outcome, "end");
  assert.equal(made.closed, true);
  assert.equal(sender.track, null);
  // The state cannot be read while the raw microphone flowed.
  log = []; sender = fakeSender(log);
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => { throw new Error("fără răspuns de la Hub"); }, createGate: async () => assert.fail("no filter on an unknown state") });
  assert.equal(out.outcome, "end");
  assert.match(out.text, /^Nu pot citi setarea filtrului vocal \(fără răspuns de la Hub\)\. Am oprit Lega/);
  assert.equal(sender.track, null);
  // An answer without the filter's state counts the same.
  sender = fakeSender([]);
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => ({ ok: true }), createGate: async () => assert.fail("no filter") });
  assert.equal(out.outcome, "end");
  assert.equal(sender.track, null);
  // On without a profile.
  sender = fakeSender([]);
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => ({ gate: { enabled: true }, profile: null }), createGate: async () => assert.fail("no filter without a profile") });
  assert.equal(out.outcome, "end");
  assert.match(out.text, /profilul tău de voce lipsește/);
  assert.equal(sender.track, null);
  // Even the first mute refused: the session ends (nothing is left to chance).
  sender = fakeSender([], { fail: (t) => t === null });
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => assert.fail("not read"), createGate: async () => assert.fail("no filter") });
  assert.equal(out.outcome, "end");
  // A running filter and an unreadable state: the filter stays (nothing is swapped) and the owner is told.
  log = []; const gate = fakeGate(log); sender = fakeSender(log); sender.track = gate.track;
  out = await runGateApply({ sender, rawTrack: RAW, gate, readState: async () => { throw new Error("x"); }, createGate: async () => assert.fail("no filter") });
  assert.deepEqual(out, { outcome: "kept", text: GATE_LIVE_TEXT.keptUnknown });
  assert.deepEqual(log, []);
  assert.equal(gate.closed, false);
});

test("P0R7-06 runGateApply with no change: a muted raw microphone comes back; a running filter is untouched; a lost restore ends the session", async () => {
  let log = []; let sender = fakeSender(log);
  let out = await runGateApply({ sender, rawTrack: RAW, readState: async () => voiceOff, createGate: async () => assert.fail("no filter") });
  assert.deepEqual(out, { outcome: "unchanged" });
  assert.deepEqual(log, [["replaceTrack", null], ["replaceTrack", "raw"]]);
  assert.equal(sender.track.id, "raw");
  log = []; const gate = fakeGate(log); sender = fakeSender(log); sender.track = gate.track;
  out = await runGateApply({ sender, rawTrack: RAW, gate, readState: async () => voiceOn, createGate: async () => assert.fail("a running filter is not doubled") });
  assert.deepEqual(out, { outcome: "unchanged" });
  assert.deepEqual(log, []);
  sender = fakeSender([], { fail: (t) => t?.id === "raw" });
  out = await runGateApply({ sender, rawTrack: RAW, readState: async () => voiceOff, createGate: async () => assert.fail("no filter") });
  assert.deepEqual(out, { outcome: "end", text: GATE_LIVE_TEXT.micLost });
});

test("P0R7-07 runGateApply when the session ends meanwhile: nothing more is sent, a filter made for it is closed, never kept", async () => {
  let alive = true;
  let log = []; let sender = fakeSender(log);
  let out = await runGateApply({ sender, rawTrack: RAW, same: () => alive, readState: async () => { alive = false; return voiceOn; }, createGate: async () => assert.fail("not after the end") });
  assert.deepEqual(out, { outcome: "gone" });
  assert.deepEqual(log, [["replaceTrack", null]]);
  alive = true; log = []; sender = fakeSender(log);
  let made = null;
  out = await runGateApply({ sender, rawTrack: RAW, same: () => alive, readState: async () => voiceOn, createGate: async () => { alive = false; return (made = fakeGate(log)); } });
  assert.deepEqual(out, { outcome: "gone" });
  assert.equal(made.closed, true);
  assert.ok(!log.some(([op, id]) => op === "replaceTrack" && id === "gate"), "never sent");
  alive = true; log = []; sender = fakeSender(log);
  out = await runGateApply({ sender, rawTrack: RAW, same: () => alive, readState: async () => voiceOn, createGate: async () => (made = fakeGate(log)) });
  assert.equal(out.outcome, "started");
  // The session ends while the new filter is being put on the sender: the filter is closed, never handed back.
  alive = true; log = []; made = null;
  const sent = { replaceTrack: async (t) => { if (t?.id === "gate") alive = false; } };
  out = await runGateApply({ sender: sent, rawTrack: RAW, same: () => alive, readState: async () => voiceOn, createGate: async () => (made = fakeGate(log)) });
  assert.deepEqual(out, { outcome: "gone" });
  assert.equal(made.closed, true);
});

test("P0R7-08 the owner-facing texts: Romanian with diacritics, short, no jargon; the toggle says it applies at once, also to a running session", () => {
  const texts = [...Object.values(GATE_LIVE_TEXT), ...Object.values(GATE_TOGGLE_RESULT), GATE_START_NO_PROFILE,
    gateFailClosedText({}), gateFailClosedText({ known: false }), gateFailClosedText({ hasProfile: false }), factoryWaitLabel("retry")];
  for (const t of texts) {
    assert.match(t, DIACRITICS, t);
    assert.doesNotMatch(t, JARGON, t);
    assert.ok(t.length <= 260, `short: ${t}`);
  }
  // Review F4 (2.12.2, intentional): ON no longer promises a session that started without the filter — the Hub closes that one.
  assert.match(GATE_TOGGLE_RESULT.on, /de acum fiecare propoziție trece întâi prin el\. O sesiune Lega pornită fără filtru se închide acum/);
  assert.match(GATE_TOGGLE_RESULT.off, /Se aplică imediat, și sesiunii Lega care rulează/);
  assert.match(GATE_TOGGLE_RESULT.off, /tot ce aude microfonul ajunge la OpenAI/);
  for (const t of [gateFailClosedText({}), gateFailClosedText({ known: false }), gateFailClosedText({ hasProfile: false })]) assert.match(t, /Am oprit Lega, ca microfonul să nu ajungă nefiltrat la OpenAI/);
  assert.equal(gateFailClosedText({ detail: "x".repeat(500) }).includes("x".repeat(161)), false, "a long technical cause is clipped");
  assert.ok(GATE_READ_TIMEOUT_MS > 0 && GATE_READ_TIMEOUT_MS <= 10000, "a read that never answers is bounded");
});

test("P0R7-09 L8 faceFromLiveEvent: a `lega.face` of THIS tab's session gives exactly faceCommand()'s shape; anything else is ignored", () => {
  for (const intent of ["face_show", "face_core", "face_discreet", "face_hide", "show_company", "zoom"]) {
    const command = faceCommand([{ intent }]);
    assert.deepEqual(faceFromLiveEvent({ type: "lega.face", sessionId: "lgs_a", command }, "lgs_a"), command, intent);
  }
  const ev = (command, sessionId = "lgs_a", type = "lega.face") => ({ type, sessionId, command });
  // Another session, no session here, no session on the event, another event type.
  assert.equal(faceFromLiveEvent(ev({ shape: "FACE", hidden: false }), "lgs_b"), null);
  assert.equal(faceFromLiveEvent(ev({ shape: "FACE", hidden: false }), null), null);
  assert.equal(faceFromLiveEvent({ type: "lega.face", command: { shape: "FACE", hidden: false } }, "lgs_a"), null, "no session on the event");
  assert.equal(faceFromLiveEvent(ev({ shape: "FACE", hidden: false }, null), null), null, "two missing ids never match");
  assert.equal(faceFromLiveEvent(ev({ shape: "FACE", hidden: false }, "lgs_a", "lega.navigate"), "lgs_a"), null);
  // Invalid shapes.
  for (const bad of [null, undefined, "FACE", 3, [], {}, { shape: "EVIL", hidden: false }, { shape: "FACE", hidden: true }, { shape: "FACE" }, { shape: 1, hidden: false },
    { discreet: "yes" }, { hidden: "true" }, { discreet: false }, { hidden: false }]) {
    assert.equal(faceFromLiveEvent(ev(bad), "lgs_a"), null, JSON.stringify(bad));
  }
  // Only the known fields are carried.
  assert.deepEqual(faceFromLiveEvent(ev({ shape: "GRAPH", hidden: false, path: "/system", authority: "owner" }), "lgs_a"), { shape: "GRAPH", hidden: false });
  assert.deepEqual(faceFromLiveEvent(ev({ hidden: true, navigate: "/x" }), "lgs_a"), { hidden: true });
  assert.equal(faceFromLiveEvent(null, "lgs_a"), null);
});

test("P0R7-10 R3 factoryWaitLabel(\"retry\"): the owner reads what happens (one automatic retry after at least a minute, Pause/Stop available), never „—” or the raw word", () => {
  const label = factoryWaitLabel("retry");
  assert.equal(label, "Tura a depășit limita pe tură; o reiau automat o singură dată, după cel puțin un minut (Pauză și Stop rămân disponibile)");
  for (const stage of ["IMPLEMENTING", "REVIEWING", "REPAIRING", undefined]) assert.equal(factoryWaitLabel("retry", stage), label, String(stage));
  assert.notEqual(label, "—");
  assert.doesNotMatch(label, /retry|Modelul lucrează/);
});

test("P0R7-11 source: the Lega panel keeps the sender, applies the filter's setting live through runGateApply, fails closed at start and live", () => {
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /const sender = pc\.addTrack\(sendTrack, new MediaStream\(\[sendTrack\]\)\);/);
  assert.match(panel, /r\.mic = mic; r\.pc = pc; r\.gate = gate; r\.sender = sender; r\.sessionId = result\.sessionId;/);
  assert.match(panel, /r\.pc = null; r\.mic = null; r\.gate = null; r\.sender = null;/, "closeLocal forgets the sender");
  // Start and live apply share the filter's options (context + decisions).
  assert.equal((panel.match(/createVoiceGate\(mic, gateOptions\(refs, setGateLog\)\)/g) || []).length, 2);
  assert.doesNotMatch(panel, /voice\?\.gate\?\.enabled && voice\.profile/, "the start decides through decideGateApply");
  // Start: unknown state or no profile → Lega does not start (never the raw microphone).
  assert.match(panel, /const gateStart = decideGateApply\(\{ sessionActive: true, gateRunning: false, \.\.\.gateState \}\);/);
  assert.match(panel, /if \(gateStart === GATE_APPLY\.FAIL_CLOSED\) throw new Error\(/);
  assert.match(panel, /try \{ voice = await readVoiceState\(\); \}/);
  // Live: the Hub's settings.changed (key voiceGate) → one queued application; a change during the start is applied once committed.
  assert.match(panel, /useEffect\(\(\) => onHubEvent\(\(e\) => \{ if \(isGateSettingEvent\(e\)\) gateApplyRef\.current\?\.\(\); \}\), \[\]\);/);
  assert.match(panel, /if \(r\.gateDirty\) gateApplyRef\.current\?\.\(\);/);
  assert.match(panel, /const out = await runGateApply\(\{ sender, rawTrack: mic\.getAudioTracks\(\)\[0\] \|\| null, gate: r\.gate, readState: readVoiceState,/);
  // Fail closed live: the session stops with the reason shown.
  assert.match(panel, /if \(out\.outcome === "end"\) \{ await endSession\(out\.text\); return; \}/);
  assert.match(panel, /showFailure\(new Error\(text\), "Lega s-a oprit"\); await stop\("voice-gate-unavailable"\);/);
  assert.match(panel, /if \(!same\(\)\) \{ if \(out\.outcome === "started"\) out\.gate\.close\(\); return; \}/);
  assert.match(panel, /if \(out\.outcome === "started"\) \{ r\.gate = out\.gate; setGateInfo\(\{ enabled: true, strict: true, verifier: out\.verifier \}\);/);
  assert.match(panel, /else if \(out\.outcome === "stopped"\) \{ r\.gate = null; setGateInfo\(\{ enabled: false \}\);/);
  // The read is bounded in time.
  assert.match(panel, /Promise\.race\(\[api\("\/api\/voice"\), timeout\]\)/);
  // "stop" reasons stay within the command's 80 characters.
  assert.ok("voice-gate-unavailable".length <= 80);
});

test("P0R7-12 source: the cockpit applies `lega.face` of the current Lega session like a typed face command; Configurare says the toggle applies at once", () => {
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /useEffect\(\(\) => onLive\(\(e\) => \{ const face = faceFromLiveEvent\(e, faceLive\.current\.sessionId\); if \(face\) faceLive\.current\.apply\(face\); \}\), \[\]\);/);
  assert.match(cockpit, /faceLive\.current = \{ sessionId: legaStatus !== "off" \? legaSessionId : null, apply: applyFace \};/);
  assert.match(cockpit, /applyFace\(faceCommand\(res\.resolved\.steps\)\);/, "the typed path uses the same function");
  assert.equal((cockpit.match(/setFaceShape\(face\.shape\)/g) || []).length, 1, "one place applies a face command");
  const setup = source("web/src/screens/lega/OwnerSetup.jsx");
  assert.match(setup, /import \{ GATE_TOGGLE_RESULT \} from "\.\.\/\.\.\/lib\/voiceGateApply\.js";/);
  assert.match(setup, /setGateSet\(Boolean\(enabled\)\)/);
  assert.match(setup, /gateSet !== null && gateSet === v\.gate\.enabled && <p className="small" role="status">\{gateSet \? GATE_TOGGLE_RESULT\.on : GATE_TOGGLE_RESULT\.off\}<\/p>/);
});
