// 2.12.3 (D4) — „Deschide Notepad” (live 2026-10-06): Notepad opened, the Hub said „Am deschis Notepad.”, and Lega's agent ALSO said it has
// no tool to open apps and sent the owner to the Start menu. Three causes: lega.hub_actions answered „nothing done” while the sentence was
// still executing (the desktop operator waits for the window), the voice-first texts never said the Hub opens authorized apps itself, and
// nothing kept two answers to one sentence from both being spoken.
// PASS_SIMULATED: the fake app-server (lega-script) and the fake desktop operator (m10-helpers), latency added by wrapping
// t.hub.desktop.openApp; no model, no live Hub, no network.
//  - D4-01: the policy texts and the timing relations (pure);
//  - D4-02: the live shape — hub_actions waits for the sentence and reports the verified local result; the agent's answer to the same
//    sentence is withheld (one answer per sentence), audited as lega.answer_withheld;
//  - D4-03: a sentence slower than the tool's wait is reported „în curs” (never „nothing”, never a provider timeout); the answer waits;
//  - D4-04: no over-suppression — a read is answered by the agent, and a later turn is never tied to an earlier sentence;
//  - D4-05: the Hub says the verified result (a folder, an unconfirmed focus or open) through announceResults.
// Hand mutations (break one piece → the named test turns red → exact bytes restored → green), recorded here:
//  M1 the bounded wait in hubActionsReply → D4-02 · M2 the „în curs” lines → D4-03 · M3 the withhold branch in turn.completed → D4-02, D4-03
//  M4 the entry.localOnly condition → D4-04 · M5 the SAME_SENTENCE_MS bound → D4-04 · M6 the DESKTOP line → D4-01
//  M7 the folder branch in describeResults → D4-05 · M8 the old focus line → D4-05.
// D4 review (2.12.3): D4-06 a compound sentence keeps the agent's answer (wholeSentenceLocal), D4-07 a late turn for an earlier question
// keeps its answer (the turn is tied by its handoff words, fixture `heard`), D4-08 nothing done is said plainly after the wait, D4-09 a
// handoff with other words is spoken. Hand mutations: M9 `&& wholeSentenceLocal(words)` → `&& true` → D4-06 · M10 drop the handoff match in
// hubAnsweredLocally → D4-07 · M11 no „nimic” lines in hubActionsReply → D4-08.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop } from "./m10-helpers.mjs";
import { LEGA_CONSENT_VERSION, legaAgentInstructions, legaVoicePrompt, legaDynamicTools } from "../server/policy/lega-policy.mjs";
import { TOOL_REPLY_TIMEOUT_MS } from "../server/providers/codex-realtime.mjs";
import { HUB_ACTIONS_WAIT_MS, LOCAL_ANSWER_WAIT_MS, SAME_SENTENCE_MS, HANDOFF_LINK_MS } from "../server/runtime/lega.mjs";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => JSON.parse(e.payload_json || "{}"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function consent(hub) {
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.refreshCodexConfig();
}
async function startLega(t, owner) {
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  assert.equal(s.authority, "owner_session");
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return s;
}
/** A derived Lega session on the desktop fixture (Notepad authorized), the bridge's openApp slowed by `delayMs`. */
async function desktopLega(steps, { delayMs = 0, apps = ["notepad", "explorer"] } = {}) {
  const t = await makeDesktopHub({ hub: { codex: script(steps) } });
  const owner = await readyDesktop(t, apps);
  await prepareLiveWithoutGrants(t.hub);
  consent(t.hub);
  if (delayMs) {
    const open = t.hub.desktop.openApp.bind(t.hub.desktop);
    t.hub.desktop.openApp = async (...args) => { await sleep(delayMs); return open(...args); };
  }
  const s = await startLega(t, owner);
  return { t, owner, s };
}
const launches = (t) => t.opLog().filter((e) => e.op === "launch").length;

test("D4-01 policy: the voice-first texts say the Hub opens authorized apps itself; hub_actions reports „în curs”; timing relations; legacy unchanged", () => {
  const ctx = { projects: [{ id: "p1", name: "Hub" }], allProjects: [{ id: "p1", name: "Hub" }], missionKinds: ["eng_bugfix"] };
  assert.match(legaAgentInstructions({ ...ctx, voiceFirst: true }), /DESKTOP: .*Never say you have no tool to open apps.*Start menu/);
  assert.match(legaVoicePrompt({ voiceFirst: true }), /nu spune niciodată că nu poți deschide aplicații și nu-l trimite în meniul Start/);
  const hubActions = legaDynamicTools({ ...ctx, voiceFirst: true })[0].tools.find((x) => x.name === "hub_actions");
  assert.match(hubActions.description, /„în curs”/);
  assert.doesNotMatch(legaAgentInstructions(ctx), /DESKTOP:|meniul Start/, "the legacy instructions are unchanged");
  assert.doesNotMatch(legaVoicePrompt({ voiceFirst: false }), /DESKTOP:|meniul Start/, "the legacy persona is unchanged");
  assert.ok(HUB_ACTIONS_WAIT_MS <= TOOL_REPLY_TIMEOUT_MS - 1000, "the reply always arrives before the provider's tool timeout");
  assert.ok(LOCAL_ANSWER_WAIT_MS > 20000, "longer than the operator's window wait");
  assert.ok(SAME_SENTENCE_MS > 0 && SAME_SENTENCE_MS < 5000);
  assert.ok(HANDOFF_LINK_MS > 0 && HANDOFF_LINK_MS <= SAME_SENTENCE_MS);
  // D4 review: the „don't deny” rules cover only what the Hub opened or reported; nothing done → an honest „not yet”, never a promise.
  assert.match(legaAgentInstructions({ ...ctx, voiceFirst: true }), /DESKTOP: .*did nothing from his words and nothing is running.*„Hub-ul nu poate face asta încă” and never promise/);
  assert.match(legaVoicePrompt({ voiceFirst: true }), /Dacă Hub-ul nu a făcut nimic din cuvintele lui .*spune sincer că Hub-ul nu poate face asta încă și nu promite/);
});

test("D4-02 the live shape: hub_actions waits for the sentence and reports the verified result; the agent's answer to it is withheld", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Deschide Notepad" }, { tool: "hub_actions", heard: "Deschide Notepad" }, { sleep: 2500 }], { delayMs: 1200 });
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => events(t, "lega.answer_withheld").length >= 1, 5000);
    const reply = replies(t).find((x) => x.tool === "hub_actions");
    assert.equal(reply.ok, true, reply.text);
    assert.ok(reply.text.includes("„Deschide Notepad” → local"), reply.text);
    assert.ok(reply.text.includes("Am deschis Notepad."), reply.text);
    assert.doesNotMatch(reply.text, /nu a (făcut|raportat) încă/);
    const said = spoken(t);
    assert.equal(said.filter((x) => /Am deschis Notepad/.test(x)).length, 1, JSON.stringify(said));
    assert.ok(!said.some((x) => /^Rezultat simulat pentru hub_actions|instrument|Start/.test(x)), JSON.stringify(said));
    const withheld = events(t, "lega.answer_withheld");
    assert.equal(withheld.length, 1);
    assert.deepEqual(withheld[0], { reason: "hub_answered_local", intents: ["desktop_open"], status: "completed" });
    assert.equal(events(t, "lega.hub_action").length, 1);
    assert.equal(launches(t), 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-03 a sentence slower than the tool's wait: „în curs”, never „nothing” or a provider timeout; the answer waits for it and is withheld", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Deschide Notepad" }, { tool: "hub_actions", heard: "Deschide Notepad" }, { sleep: 500 }], { delayMs: 4800 });
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((x) => /Am deschis Notepad/.test(x)), 15000);
    await waitFor(() => events(t, "lega.answer_withheld").length >= 1, 5000);
    await sleep(300);
    const reply = replies(t).find((x) => x.tool === "hub_actions");
    assert.equal(reply.ok, true, reply.text);
    assert.ok(reply.text.includes("în curs"), reply.text);
    assert.ok(reply.text.includes("„Deschide Notepad”"), reply.text);
    assert.doesNotMatch(reply.text, /Eroare Hub|nu a (făcut|raportat) încă/);
    const said = spoken(t);
    assert.equal(said.filter((x) => x === "Am deschis Notepad.").length, 1, JSON.stringify(said));
    assert.ok(!said.some((x) => /Rezultat simulat/.test(x)), JSON.stringify(said));
    assert.equal(events(t, "lega.answer_withheld").length, 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-04 no over-suppression: a read is answered by the agent; a later turn is never tied to the earlier local sentence", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Lega, ce se întâmplă?" }, { tool: "hub_status" }, { sleep: 300 }, { say: "Deschide Notepad" }, { sleep: 5000 }, { tool: "hub_status" }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 40000);
    await waitFor(() => spoken(t).filter((x) => /^Rezultat simulat pentru hub_status/.test(x)).length >= 2, 5000);
    await sleep(300);
    const said = spoken(t);
    assert.equal(said.filter((x) => /^Rezultat simulat pentru hub_status/.test(x)).length, 2, JSON.stringify(said));
    assert.equal(said.filter((x) => x === "Am deschis Notepad.").length, 1, JSON.stringify(said));
    assert.equal(events(t, "lega.answer_withheld").length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-05 the verified result is said: a folder (never its path), an unconfirmed focus or open; a verified open unchanged", async () => {
  const t = await makeTestHub({ codex: script([{ sleep: 20 }]) });
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await prepareLiveWithoutGrants(t.hub);
    consent(t.hub);
    const s = await startLega(t, owner);
    const say = (results, intents) => t.hub.lega.announceResults(s.sessionId, results, { intents, heard: "test" });
    const folder = await say([{ intent: "desktop_folder", effectClass: "SIMPLE_LOCAL_ACTION", desktop: { folder: "C:\\Users\\x\\Videos\\Ifrim Studio\\exports", verified: true } }], ["desktop_folder"]);
    assert.equal(folder.said, "Am deschis folderul în Explorer.");
    assert.equal(folder.outcome, "local");
    assert.doesNotMatch(folder.said, /Users|exports|:\\/);
    const unseen = await say([{ intent: "desktop_folder", effectClass: "SIMPLE_LOCAL_ACTION", desktop: { folder: "C:\\x", verified: false } }], ["desktop_folder"]);
    assert.match(unseen.said, /nu i-am văzut fereastra/);
    const focus = await say([{ intent: "desktop_focus", effectClass: "SIMPLE_LOCAL_ACTION", desktop: { app: { id: "notepad", name: "Notepad" }, verified: false } }], ["desktop_focus"]);
    assert.match(focus.said, /nu a confirmat/);
    assert.notEqual(focus.said, "Am adus Notepad în față.");
    const open = await say([{ intent: "desktop_open", effectClass: "SIMPLE_LOCAL_ACTION", desktop: { app: { id: "notepad", name: "Notepad" }, verified: true, note: "Notepad e în prim-plan." } }], ["desktop_open"]);
    assert.equal(open.said, "Am deschis Notepad.");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- D4 review (2.12.3): compound sentences, the late-turn race, nothing done
test("D4-06 a compound sentence („Deschide Notepad și spune-mi ce misiuni am”): the Hub's open AND the agent's answer to the second request are both spoken", async () => {
  const S = "Deschide Notepad și spune-mi ce misiuni am";
  const { t } = await desktopLega([{ sleep: 1500 }, { say: S }, { tool: "list_missions", heard: S }, { sleep: 2500 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((x) => /^Rezultat simulat pentru list_missions/.test(x)), 8000);
    await sleep(300);
    const said = spoken(t);
    assert.equal(said.filter((x) => x === "Am deschis Notepad.").length, 1, JSON.stringify(said));
    assert.equal(said.filter((x) => /^Rezultat simulat pentru list_missions/.test(x)).length, 1, JSON.stringify(said));
    assert.equal(events(t, "lega.answer_withheld").length, 0);
    assert.equal(launches(t), 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-07 the late-turn race: a turn for an earlier question that starts as „Deschide Notepad” is bridged keeps its answer (tied by its handoff)", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Lega, ce se întâmplă?" }, { sleep: 2500 }, { say: "Deschide Notepad" }, { tool: "hub_status", heard: "Lega, ce se întâmplă?" }, { sleep: 2500 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((x) => /^Rezultat simulat pentru hub_status/.test(x)), 8000);
    await sleep(300);
    const said = spoken(t);
    assert.equal(said.filter((x) => /^Rezultat simulat pentru hub_status/.test(x)).length, 1, JSON.stringify(said));
    assert.equal(said.filter((x) => x === "Am deschis Notepad.").length, 1, JSON.stringify(said));
    assert.equal(events(t, "lega.answer_withheld").length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-08 nothing done („Închide Notepad”, an unknown action): hub_actions says so plainly after the wait — no promise that the Hub will speak, no „don't say it can't”", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Închide Notepad" }, { sleep: 800 }, { tool: "hub_actions", heard: "Închide Notepad" }, { sleep: 500 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => replies(t).some((x) => x.tool === "hub_actions"), 5000);
    const reply = replies(t).find((x) => x.tool === "hub_actions");
    assert.equal(reply.ok, true, reply.text);
    assert.match(reply.text, /Hub-ul nu a făcut nimic din cuvintele proprietarului/);
    assert.match(reply.text, /„Închide Notepad” → nimic/);
    assert.match(reply.text, /Hub-ul nu poate face asta încă/);
    assert.doesNotMatch(reply.text, /spune singur rezultatul|nu spune că nu se poate|în curs/);
    assert.equal(events(t, "lega.hub_action").length, 0);
    assert.equal(launches(t), 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D4-09 a turn whose handoff names other words than the Notepad sentence (or none matches) is spoken, even right next to it", async () => {
  const { t } = await desktopLega([{ sleep: 1500 }, { say: "Deschide Notepad" }, { tool: "hub_actions", heard: "Ce misiuni am?" }, { sleep: 2500 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((x) => /^Rezultat simulat pentru hub_actions/.test(x)), 8000);
    assert.equal(events(t, "lega.answer_withheld").length, 0);
    assert.equal(spoken(t).filter((x) => x === "Am deschis Notepad.").length, 1, JSON.stringify(spoken(t)));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
