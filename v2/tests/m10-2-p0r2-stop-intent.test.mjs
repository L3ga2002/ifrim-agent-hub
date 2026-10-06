// 2.12.2 (P0-R2, owner requirement) — an interruption runs only on a clear IMPERATIVE. PASS_SIMULATED: the pure resolver and voice
// grammar, a test Hub (owner.intent typed on the owner channel and as a provider transcript on the voice channel) and the Lega voice
// bridge with the fixture realtime provider (fake app-server); no model, no live Hub, no network.
//  - the real commands, with natural variation, stop at once (typed, voice-local and voice-provider sources; the voice fast path);
//  - a question, a negation, a condition, reported speech or a quotation never stops: explain_stop, a read the Hub answers itself (no
//    administration pointer, no clarification, no unknown step for the probe);
//  - the same rule for the global pause and the other interruptions; D21's rearm phrases keep showing the card;
//  - a real Stop through Lega is still the fast path (no intake round trip before system.stop_all), and the words cost microseconds;
//  - mutation checks: without each new guard the specific phrase stops again (or loses its answer).
// Changed expectation of an older suite: m10-2-p0-round2-intents.test.mjs R2B-01 — „Oprește tot după ce termini testul” is a deferred
// (conditional) stop, so it is explain_stop now, no longer stop_all.
// 2.12.2 review round (R2-F1…F5): ALSO_STOP / ALSO_NOT carry the review's phrasings and P0R2-08's mutations 1, 3 and 4 name the new code
// (the anchored trailing condition, the leading condition on the part as said, the `conjugated` flag); the dedicated regression tests and
// their mutation checks are in m10-2-p0r-review-fixes.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { startDerivedLega } from "./voice-helpers.mjs";
import { resolveIntent, interruptMood, stopTalkAnswer, STOP_EXPLANATION, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { parseVoiceCommand } from "../server/domain/voice.mjs";
import { classOfIntent } from "../server/policy/effect-class.mjs";
import { classifySuspension } from "../server/policy/gate-state.mjs";

const SOURCES = ["typed", "voice-local", "voice-provider"];
/** The commands that MUST stop at once (the owner's list). */
const MUST_STOP = ["Oprește tot.", "Oprește tot!", "Lega, oprește tot", "Te rog oprește tot", "Opriți tot, vă rog", "Oprește totul imediat", "Stop all", "Stop all now",
  "Lega, stop!", "Oprește tot acum", "OPREȘTE TOT"];
/** More natural commands that stop too (interjections, a leading „Nu,” as an answer, an exclamation, a polite tail). */
const ALSO_STOP = ["Stop, oprește tot", "Oprește tot ce rulează", "Te rog frumos, oprește totul", "Oprește toate", "Lega, te rog, oprește tot", "De acum oprește tot",
  "Gata, oprește tot", "Ok Lega, oprește tot", "Vreau să oprești tot", "Oprește imediat tot", "Ce naiba, oprește tot!", "Oprește tot, dacă se poate", "Hei Lega, oprește tot ce rulează",
  "Nu, oprește tot", "Stai, oprește tot", "Nu mai merge nimic, oprește tot",
  // 2.12.2 review round (m10-2-p0r-review-fixes.test.mjs has the dedicated checks): R2-F1 — words that are no condition of the stop;
  "Oprește tot până când verific eu", "Oprește tot până când mă uit pe loguri", "Oprește tot, indiferent dacă termină testul", "Oprește tot chiar dacă pierd munca",
  "Oprește tot imediat ce poți", "Oprește tot când poți", "Oprește tot, a dat eroare când a rulat testele", "Oprește tot, după ce am văzut logurile nu mai am încredere",
  "Oprește tot și când se termină anunță-mă", "Oprește tot, dacă tot nu merge", "Oprește tot ce a pornit după ce am plecat",
  // R2-F3 — a tag or a question of its own after the command, an exclamation or a bare repeated lead-in before it (pending the owner's confirmation);
  "Oprește tot, ce faci?", "Oprește tot, da?", "Oprește tot, ok?", "Oprește tot, m-ai auzit?", "Oprește tot, ce naiba faci?", "Te rog, oprește tot, ce aștepți?",
  "Ce naiba faci, oprește tot!", "Ce faci acolo, oprește tot", "Ce se întâmplă aici, oprește tot!", "Ți-am zis, oprește tot!", "Cum ți-am spus, oprește tot", "Am zis oprește tot!",
  // R2-F4 — a leading interjection without its comma (provider transcripts).
  "Te rog mult oprește tot", "Chiar acum oprește tot", "Lega ascultă oprește tot", "Băi oprește tot", "Măi Lega oprește tot", "Bun oprește tot", "Și acum oprește tot"];
/** The sentences that MUST NOT stop (the owner's list) → the mood the Hub answers. */
const MUST_NOT = Object.freeze({
  "Ce urmează după Stop All?": "question",
  "Ce se întâmplă dacă spun Oprește tot?": "question",
  "Ce face Oprește tot?": "question",
  "Nu opri tot.": "negation",
  "Nu, nu opri nimic": "negation",
  "Când am spus Oprește tot?": "reported",
  "Ieri am spus oprește tot": "reported",
  "Dacă pică testele, oprește tot": "conditional",
  "Am zis „Oprește tot” din greșeală": "reported",
  // Decision (documented in intents.mjs): a polite yes/no question is often a request in Romanian, but a stop must be unambiguous — the
  // Hub answers „Spune „Oprește tot” și opresc imediat.” (one sentence more), never a stop on a question.
  "Poți să oprești tot?": "ask",
});
/** The same rule on neighbouring phrasings (a transcript that lost the „?”, a deferred stop, a quotation alone, a mention). */
const ALSO_NOT = Object.freeze({
  "Oprește tot?": "ask", "Poți să oprești tot": "ask", "Să opresc tot?": "ask", "Lega, stop?": "ask", "Ce urmează după Stop All": "question",
  "Explică-mi Stop All": "question", "Ce înseamnă Stop All": "question", "Oprește tot după ce termini testul": "conditional", "Oprește tot dacă pică testele": "conditional",
  "Dacă pică testele oprește tot": "conditional", "Când pică testele, oprește tot": "conditional", "Am zis oprește tot din greșeală": "reported",
  "Ți-am zis ieri să oprești tot": "reported", "„Oprește tot”": "quote", "Nu vreau să oprești tot": "negation", "Să nu oprești tot": "negation", "Butonul oprește tot": "mention",
  // 2.12.2 review R2-F5: the command's name used in a statement (never the stop); „Stop All-ul nu merge” and the pause: m10-2-p0r-review-fixes.test.mjs.
  "Stop all-ul de ieri a lăsat lease-uri": "reported", "Stop All e butonul roșu": "mention", "Stop All e în bara de sus": "mention", "Oprește tot nu a mers ieri": "reported",
  "Oprește tot n-a eliberat lease-urile": "mention", "Oprește tot e butonul roșu din bara de sus": "mention", "Stop All-ul a oprit și Lega": "mention",
  "Stop all a mers bine ieri": "reported", "Oprește tot a funcționat azi dimineață": "reported", "Imediat ce termini, oprește tot": "conditional",
});
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|Sistem →|#\/system|#\/integrations/;
const intentsOf = (text, extra = {}) => resolveIntent(text, { projects: [{ id: "pd", name: "ProDelivery", slug: "prodelivery" }], currentProjectId: "pd", ...extra }).steps;
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT seq, created_at, payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ seq: e.seq, at: e.created_at, payload: JSON.parse(e.payload_json || "{}") }));
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-01
test("P0R2-01 the resolver: the owner's commands stop (every source); questions, negations, conditions, reports and quotes never — explain_stop, a read, no question", () => {
  assert.equal(INTENT_EFFECTS.explain_stop, "read");
  assert.equal(classOfIntent("explain_stop", INTENT_EFFECTS.explain_stop), "READ_NAVIGATE");
  for (const source of SOURCES) {
    for (const text of MUST_STOP) {
      const r = resolveIntent(text, { source });
      assert.deepEqual(r.steps.map((s) => s.intent), ["stop_all"], `${source} ${text}`);
      assert.equal(r.steps[0].effectClass, "INTERRUPT", `${source} ${text}`);
      assert.equal(r.clarification, null, `${source} ${text}`);
    }
    for (const text of ALSO_STOP) assert.ok(resolveIntent(text, { source }).steps.some((s) => s.intent === "stop_all"), `${source} ${text}`);
    for (const [text, mood] of Object.entries({ ...MUST_NOT, ...ALSO_NOT })) {
      const r = resolveIntent(text, { source });
      assert.ok(r.steps.every((s) => s.intent !== "stop_all" && s.effect !== "interrupt" && s.effectClass !== "INTERRUPT"), `${source} ${text}: ${JSON.stringify(r.steps)}`);
      assert.deepEqual(r.steps.map((s) => [s.intent, s.args.mood, s.args.about]), [["explain_stop", mood, "stop_all"]], `${source} ${text}`);
      assert.equal(r.steps[0].effectClass, "READ_NAVIGATE", `${source} ${text}`);
      assert.equal(r.clarification, null, `${source} ${text}: an answer, not a question`);
      assert.equal(r.refused.length, 0, `${source} ${text}`);
    }
  }
  // The classifier itself (the clause as the resolver sees it: normalized, fillers and „Lega,” removed).
  assert.equal(interruptMood("opreste tot"), "imperative");
  assert.equal(interruptMood("opreste tot", { asks: true }), "ask");
  assert.equal(interruptMood("ce urmeaza dupa stop all"), "question");
  assert.equal(interruptMood("daca pica testele, opreste tot"), "conditional");
  assert.equal(interruptMood("ieri am zis, opreste tot"), "reported");
  // D21 is kept: the rearm phrases show the card (never a Stop All), and the PF-01 defence still holds without the rearm grammar.
  for (const text of ["Redeschide poarta după Stop All", "Rearmează Hub-ul după Stop All", "Poți să redeschizi poarta după Stop All?", "Continuă după Stop All", "După Stop All, redeschide poarta"]) {
    assert.deepEqual(intentsOf(text).map((s) => s.intent), ["gate_rearm"], text);
  }
  for (const text of ["Redeschide, te rog, poarta după Stop All", "Nu redeschide poarta după Stop All", "Reia, te rog, lucrul după oprește tot"]) {
    assert.ok(intentsOf(text).every((s) => s.intent !== "stop_all" && s.effect !== "interrupt"), text);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-02
test("P0R2-02 the Lega voice fast path: the commands are dispatched there (addressed or explicit); a question or a quotation of the same words never is", () => {
  for (const text of MUST_STOP) {
    const v = parseVoiceCommand(text, { legaPrefix: true });
    assert.equal(v.command, "stop_all", text);
    assert.ok(v.addressed || v.explicit, `${text}: lega.mjs dispatches a global command only when addressed or explicit`);
  }
  assert.equal(parseVoiceCommand("Stop all now", { legaPrefix: true }).explicit, true);
  for (const text of Object.keys({ ...MUST_NOT, ...ALSO_NOT })) {
    for (const v of [parseVoiceCommand(text, { legaPrefix: true }), parseVoiceCommand(text)]) {
      assert.notEqual(v.command, "stop_all", `${text}: ${JSON.stringify(v)}`);
      assert.notEqual(v.command, "pause", text);
    }
  }
  // The same for a pause; mute and the fixed screens are unaffected (they only silence or navigate).
  assert.equal(parseVoiceCommand("Pauză?", { legaPrefix: true }).kind, "message");
  assert.equal(parseVoiceCommand("„Pune pe pauză”", { legaPrefix: true }).kind, "message");
  assert.equal(parseVoiceCommand("Pauză", { legaPrefix: true }).command, "pause");
  assert.equal(parseVoiceCommand("Taci?").command, "mute");
  assert.equal(parseVoiceCommand("Arată-mi aprobările?").command, "show_approvals");
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-03
test("P0R2-03 the same rule for the pause and the other interruptions: the commands still run; a negation, a condition or a question never does", () => {
  for (const text of ["Pauză", "Pauză acum", "Lega, ia o pauză", "Pune totul pe pauză", "Lega, pune totul pe pauză", "Ține minte, pune pauză", "Te rog, pune totul pe pauză"]) {
    assert.deepEqual(intentsOf(text).map((s) => s.intent), ["pause"], text);
  }
  const notPause = { "Lega, nu pune totul pe pauză": "negation", "Lega, nu ia o pauză": "negation", "Lega, dacă pică testele, pune totul pe pauză": "conditional",
    "Lega, pune totul pe pauză când termini": "conditional", "Lega, doar dacă trec testele, ia o pauză": "conditional", "Pune totul pe pauză?": "ask" };
  for (const [text, mood] of Object.entries(notPause)) assert.deepEqual(intentsOf(text).map((s) => [s.intent, s.args.mood, s.args.about]), [["explain_stop", mood, "pause"]], text);
  assert.deepEqual(intentsOf("Oprește Codex").map((s) => s.intent), ["stop_worker"]);
  assert.deepEqual(intentsOf("Nu oprește Codex").map((s) => [s.intent, s.args.mood, s.args.about]), [["explain_stop", "negation", "stop_worker"]]);
  assert.deepEqual(intentsOf("Oprește Codex dacă se blochează").map((s) => [s.intent, s.args.mood]), [["explain_stop", "conditional"]]);
  const askClaude = intentsOf("Oprește Claude?")[0];
  assert.deepEqual([askClaude.intent, askClaude.args.mood, askClaude.args.worker], ["explain_stop", "ask", "claude"]);
  assert.deepEqual(intentsOf("Preiau eu").map((s) => s.intent), ["takeover"]);
  assert.deepEqual(intentsOf("Preiau eu dacă se blochează").map((s) => [s.intent, s.args.mood, s.args.about]), [["explain_stop", "conditional", "takeover"]]);
  assert.deepEqual(intentsOf("Preiau eu?").map((s) => [s.intent, s.args.mood]), [["explain_stop", "ask"]]);
  assert.deepEqual(intentsOf("Îngheață ProDelivery").map((s) => s.intent), ["freeze_project"]);
  assert.deepEqual(intentsOf("Îngheață ProDelivery?").map((s) => [s.intent, s.args.mood, s.args.about]), [["explain_stop", "ask", "freeze_project"]]);
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-04
test("P0R2-04 the Hub's answers: Romanian with diacritics, short, honest, never an administration pointer, never a claim that something stopped", () => {
  assert.match(STOP_EXPLANATION, /suspendă poarta de execuție/);
  assert.match(STOP_EXPLANATION, /pe cardul „Redeschide poarta”, cu Windows Hello \(nu prin voce\)/);
  assert.match(STOP_EXPLANATION, /nu repornește nimic singur/);
  assert.match(STOP_EXPLANATION, /Ca să opresc acum, spune „Oprește tot”\.$/);
  assert.equal(stopTalkAnswer({ mood: "question" }), STOP_EXPLANATION);
  assert.equal(stopTalkAnswer({ mood: "negation" }), "Bine, nu opresc nimic.");
  assert.equal(stopTalkAnswer({ mood: "ask" }), "Ai întrebat, așa că nu am oprit nimic. Spune „Oprește tot” și opresc imediat.");
  assert.match(stopTalkAnswer({ mood: "conditional" }), /^Nu pun opriri condiționate, așa că nu am oprit nimic acum\. Spune „Oprește tot” când vrei să opresc\.$/);
  assert.match(stopTalkAnswer({ mood: "quote" }), /între ghilimele/);
  const at = "2026-10-06T03:05:00.000Z";
  assert.match(stopTalkAnswer({ mood: "reported" }, { lastStopAt: at, gate: "stop_all" }),
    /^Ultimul „Oprește tot” a fost pe \d{1,2} (?:octombrie|noiembrie|septembrie), la \d{2}:\d{2}\. Poarta e încă oprită de el: o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello \(nu prin voce\)\. /);
  assert.match(stopTalkAnswer({ mood: "reported" }, { lastStopAt: at, gate: "open" }), /Poarta de execuție e deschisă acum\./);
  assert.match(stopTalkAnswer({ mood: "reported" }, {}), /^Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului\./);
  assert.equal(stopTalkAnswer({ mood: "negation", about: "pause" }), "Bine, nu pun nimic pe pauză.");
  assert.match(stopTalkAnswer({ mood: "ask", about: "stop_worker", worker: "claude" }), /Spune „Oprește Claude”/);
  for (const about of ["stop_all", "pause", "stop_worker", "takeover", "freeze_project"]) {
    for (const mood of ["question", "ask", "negation", "conditional", "reported", "quote", "mention"]) {
      for (const facts of [{}, { lastStopAt: at, gate: "stop_all" }]) {
        const text = stopTalkAnswer({ mood, about }, facts);
        assert.ok(text && text.length <= 600, `${about}/${mood}: short`);
        assert.doesNotMatch(text, ADMIN_POINTERS, `${about}/${mood}: no administration pointer`);
        assert.doesNotMatch(text, /\b(?:[Oo]preste|[Oo]priti|[Ii]ngheata|conditionate|intrebat|pauza|cand|daca|intrerupe|fara|si|in|inca|incat|ca sa)\b/, `${about}/${mood}: diacritics`);
        assert.doesNotMatch(text, /^(?:Am oprit|Opresc acum|Am pus|Am înghețat|Am preluat)/, `${about}/${mood}: never a claim of an effect`);
      }
    }
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-05
test("P0R2-05 through owner.intent (typed in the owner session and as a provider transcript): talk never stops and gets the Hub's answer; the commands stop at once", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    const say = (text) => t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text } }).then((r) => r.result);
    const sayVoice = (text) => t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text } }).then((r) => r.result);
    const stops = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'system.stop_all'");
    const gate = () => t.hub.settings.get("executionGate");
    const m0 = t.hub.probe.mark().seq;
    for (const [text, mood] of Object.entries(MUST_NOT)) {
      for (const via of [say, sayVoice]) {
        const out = await via(text);
        assert.deepEqual(out.resolved.steps.map((s) => s.intent), ["explain_stop"], text);
        const r = out.results[0];
        assert.equal(r.intent, "explain_stop", text);
        assert.equal(r.effectClass, "READ_NAVIGATE", text);
        assert.ok(r.message, `${text}: the Hub answers`);
        assert.equal(r.message, stopTalkAnswer({ mood, about: "stop_all" }, mood === "reported" ? { lastStopAt: null, gate: "open" } : {}), text);
        assert.doesNotMatch(r.message, ADMIN_POINTERS, text);
        assert.equal(r.refused, undefined, text);
        assert.equal(r.interrupt, undefined, `${text}: nothing stopped`);
        assert.equal(r.clarification, undefined, `${text}: no question`);
        assert.equal(stops(), 0, `${text}: no Stop All`);
        assert.equal(gate().status, "open", text);
      }
    }
    // The probe: no clarification counted and no unknown step (R4's unknownIntents counts unanswered unknown steps only).
    const report = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(report.counters.clarifications, 0);
    if (Object.hasOwn(report.counters, "unknownIntents")) assert.equal(report.counters.unknownIntents, 0);
    const intentsLogged = events(t, "owner.intent").filter((e) => e.seq > m0);
    assert.equal(intentsLogged.length, Object.keys(MUST_NOT).length * 2);
    assert.ok(intentsLogged.every((e) => e.payload.steps.join() === "explain_stop" && e.payload.clarification === false), JSON.stringify(intentsLogged.map((e) => e.payload)));
    // A real command stops at once (the same dispatch as before), typed and from the provider.
    const typed = (await say("Oprește tot.")).results[0];
    assert.equal(typed.intent, "stop_all");
    assert.ok(typed.interrupt, JSON.stringify(typed).slice(0, 300));
    assert.equal(gate().status, "suspended");
    assert.equal(stops(), 1);
    assert.equal(classifySuspension(gate()).cls, "stop_all");
    for (const text of ["Lega, stop!", "Stop all now", "Opriți tot, vă rog"]) {
      const before = stops();
      const r = (await sayVoice(text)).results[0];
      assert.equal(r.intent, "stop_all", text);
      assert.equal(stops(), before + 1, `${text}: one Stop All`);
    }
    // Reported speech after a real Stop All: when it was, that it still holds the gate, where the gate is reopened — and no new stop.
    const n = stops();
    const reported = (await say("Când am spus Oprește tot?")).results[0];
    assert.match(reported.message, /^Ultimul „Oprește tot” a fost pe \d{1,2} [a-z]+, la \d{2}:\d{2}\. Poarta e încă oprită de el: o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello \(nu prin voce\)\./);
    assert.equal((await sayVoice("Ce urmează după Stop All?")).results[0].message, STOP_EXPLANATION);
    assert.equal((await sayVoice("Nu, nu opri nimic")).results[0].message, "Bine, nu opresc nimic.");
    assert.equal(stops(), n, "talk after a Stop All adds no Stop All");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-06
test("P0R2-06 through the Lega bridge (fixture realtime provider, a session derived from the owner session): talk never stops and the Hub says its answer; „Oprește tot.” is the fast path", async (ctx) => {
  const talk = ["Ce urmează după Stop All?", "Nu opri tot.", "Dacă pică testele, oprește tot", "Ieri am spus oprește tot", "Oprește tot?", "Am zis „Oprește tot” din greșeală",
    "Poți să oprești tot?", "Ce se întâmplă dacă spun Oprește tot?", "Când am spus Oprește tot?", "Ce face Oprește tot?", "Nu, nu opri nimic"];
  const steps = [{ sleep: 1500 }];
  for (const s of talk) steps.push({ say: s }, { sleep: 500 });
  steps.push({ sleep: 2000 }, { say: "Oprește tot." }, { sleep: 120000 });
  const t = await makeTestHub({ codex: script(steps) });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t, { activatePolicy: true });
    const lega = await startDerivedLega(t, owner);
    await waitFor(() => (t.hub.lega.state()?.status === "ended" ? true : null), 30000);
    const intentCmds = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'voice'");
    assert.equal(intentCmds(), talk.length, "every talk sentence reached the intake through the bridge; the Stop did not");
    // Exactly one Stop All, and it came after every talk sentence was answered.
    const stopEvents = events(t, "system.stop_all");
    assert.equal(stopEvents.length, 1, JSON.stringify(stopEvents));
    const answered = events(t, "lega.hub_action").filter((e) => e.payload.intents?.includes("explain_stop"));
    assert.equal(answered.length, talk.length, "the Hub answered each sentence itself");
    assert.ok(answered.every((e) => e.seq < stopEvents[0].seq), "no talk sentence stopped anything");
    assert.equal(t.hub.lega.state().endReason, "stop-all");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    // The fast path: lega.command (stop_all) only for the real command, and no owner.intent between its transcript and the dispatch.
    const commands = events(t, "lega.command");
    assert.deepEqual(commands.map((e) => e.payload.command), ["stop_all"]);
    const transcript = events(t, "lega.transcript").find((e) => e.payload.role === "user" && e.payload.text === "Oprește tot.");
    assert.ok(transcript, "the stop transcript is recorded");
    const accepted = t.hub.db.prepare("SELECT e.seq AS seq, e.created_at AS at, c.type AS type FROM events e JOIN commands c ON c.id = e.scope_id WHERE e.type = 'command.accepted' AND e.seq > ? ORDER BY e.seq").all(transcript.seq);
    const first = accepted[0];
    assert.equal(first?.type, "system.stop_all", `the first command after the stop transcript is the Stop All itself: ${JSON.stringify(accepted.slice(0, 3))}`);
    assert.ok(commands[0].seq > transcript.seq && commands[0].seq < first.seq, "transcript → lega.command → system.stop_all, nothing in between");
    const elapsedMs = Date.parse(first.at) - Date.parse(transcript.at);
    ctx.diagnostic(`fast path: transcript → system.stop_all accepted in ${elapsedMs} ms`);
    assert.ok(elapsedMs >= 0 && elapsedMs < 1500, `the Stop is dispatched at once (${elapsedMs} ms)`);
    // What the Hub said (its own words, never an administration pointer).
    const spoken = t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
    for (const line of [STOP_EXPLANATION, "Bine, nu opresc nimic.", stopTalkAnswer({ mood: "conditional" }), stopTalkAnswer({ mood: "ask" })]) {
      assert.ok(spoken.includes(line), `said: ${line}\n${JSON.stringify(spoken, null, 1)}`);
    }
    assert.ok(spoken.some((s) => /^Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului\./.test(s)), "reported speech before any Stop All");
    for (const s of spoken) assert.doesNotMatch(s, ADMIN_POINTERS, s);
    assert.ok(lega);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-07
test("P0R2-07 a real Stop stays fast: the words of a command cost microseconds (synchronous, nothing awaits)", (ctx) => {
  for (const text of MUST_STOP) { resolveIntent(text, {}); parseVoiceCommand(text, { legaPrefix: true }); }
  const rounds = 200;
  let t0 = performance.now();
  for (let i = 0; i < rounds; i += 1) for (const text of MUST_STOP) resolveIntent(text, {});
  const resolveMs = (performance.now() - t0) / (rounds * MUST_STOP.length);
  t0 = performance.now();
  for (let i = 0; i < rounds; i += 1) for (const text of MUST_STOP) parseVoiceCommand(text, { legaPrefix: true });
  const voiceMs = (performance.now() - t0) / (rounds * MUST_STOP.length);
  ctx.diagnostic(`resolveIntent ${resolveMs.toFixed(4)} ms, parseVoiceCommand ${voiceMs.toFixed(4)} ms per command`);
  assert.ok(resolveMs < 2, `resolveIntent ${resolveMs.toFixed(4)} ms per command`);
  assert.ok(voiceMs < 0.5, `parseVoiceCommand ${voiceMs.toFixed(4)} ms per command`);
  // Both are plain functions: a command never returns a promise (no await on the way to system.stop_all).
  assert.ok(!(resolveIntent("Oprește tot", {}) instanceof Promise));
  assert.ok(!(parseVoiceCommand("Oprește tot", { legaPrefix: true }) instanceof Promise));
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R2-08
const INTENTS_PATH = fileURLToPath(new URL("../server/owner/intents.mjs", import.meta.url));
const VOICE_PATH = fileURLToPath(new URL("../server/domain/voice.mjs", import.meta.url));
const EFFECT_CLASS_URL = pathToFileURL(fileURLToPath(new URL("../server/policy/effect-class.mjs", import.meta.url))).href;
let mutationN = 0;
/** A copy of a module with ONE guard broken (the repository file is never touched), its relative imports pointed at the real files. */
async function mutated(file, find, replace, imports) {
  const src = fs.readFileSync(file, "utf8");
  assert.ok(src.includes(find), `the mutation must apply: ${find.slice(0, 90)}`);
  let changed = src.replace(find, replace);
  for (const [from, to] of imports) changed = changed.replace(from, to);
  const tmp = path.join(os.tmpdir(), `ifrim-p0r2-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(tmp, changed);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const intentsWith = (find, replace) => mutated(INTENTS_PATH, find, replace, [['from "../policy/effect-class.mjs"', `from ${JSON.stringify(EFFECT_CLASS_URL)}`]]);
const stopsIn = (mod, text) => mod.resolveIntent(text, {}).steps.some((s) => s.intent === "stop_all");

test("P0R2-08 mutation checks: without each new guard the specific phrase stops again (or loses its answer)", async () => {
  // The real modules pass every check below.
  for (const text of ["Ce urmează după Stop All?", "Ieri am spus oprește tot", "Dacă pică testele, oprește tot", "Oprește tot după ce termini testul", "Oprește tot?", "Poți să oprești tot",
    "Lega, stop?", "Butonul oprește tot"]) assert.equal(stopsIn({ resolveIntent }, text), false, text);
  // 1. The rule itself (imperativeOnly) removed: the live defect comes back — a question and a report stop everything.
  // (2.12.2 review: the call also passes `conjugated`, R2-F3; mutations 3 and 4 name the review's anchored condition checks, R2-F1.)
  const noRule = await intentsWith("if (t && !(found && (found.intent === \"gate_rearm\" || found.intent === \"reopen_last\" || found.args?.addressed))) found = imperativeOnly(found, t, { asks, modal, conjugated });", "");
  assert.equal(stopsIn(noRule, "Ce urmează după Stop All?"), true, "without the rule a question stops");
  assert.equal(stopsIn(noRule, "Ieri am spus oprește tot"), true, "without the rule reported speech stops");
  // 2. The split guard removed: „Dacă pică testele, oprește tot” is cut in two and its second half is a bare Stop All.
  const noSplitGuard = await intentsWith("if (rm && INTERRUPT_INTENTS.has(rm.intent) && leadsIntoTalk(left)) continue;", "");
  assert.equal(stopsIn(noSplitGuard, "Dacă pică testele, oprește tot"), true);
  // 3. A condition after the command no longer holds it.
  const noTailCondition = await intentsWith("if (trailingCondition(restSame || parts[at + 1] || \"\")) return \"conditional\";", "");
  assert.equal(stopsIn(noTailCondition, "Oprește tot după ce termini testul"), true);
  // 4. A condition leading into the command (with the split guard present) no longer holds it.
  const noLeadCondition = await intentsWith("if (before.some((x) => leadingCondition(x.raw))) return \"conditional\";", "");
  assert.equal(stopsIn(noLeadCondition, "Dacă pică testele, oprește tot"), true);
  // 5. The question mark no longer counts.
  const noQuestion = await intentsWith("if (asks || modal || MODAL_ASK.test(s)) {", "if (false) {");
  assert.equal(stopsIn(noQuestion, "Oprește tot?"), true);
  // 6. The modal opening the polite-word stripper removes („Poți să…”) no longer counts.
  const noModal = await intentsWith("const modal = (index === 0 && modalLead) || MODAL_ASK.test(softTrim(clause));", "const modal = false;");
  assert.equal(stopsIn(noModal, "Poți să oprești tot"), true);
  // 7. „Lega, stop?” asks: without the check the addressed bare stop runs.
  const noAddressedAsk = await intentsWith("found = asks || modal ? {", "found = false ? {");
  assert.equal(stopsIn(noAddressedAsk, "Lega, stop?"), true);
  // 8. Stop All not strict: a mere mention („Butonul oprește tot”) stops.
  const notStrict = await intentsWith("stop_all: { strict: true,", "stop_all: { strict: false,");
  assert.equal(stopsIn(notStrict, "Butonul oprește tot"), true);
  // 9. The answers: without the negation, report and quotation reads the Hub would answer the wrong sentence (nothing stops either way).
  // (Review F1, 2.12.2: the negation is read in the verb's own part — `vPart` — so the guard's text changed with it.)
  const noNegation = await intentsWith("if (NEGATION.test(v >= 0 ? vPart.slice(0, v) : vPart)) return \"negation\";", "");
  assert.notEqual(noNegation.resolveIntent("Nu opri tot.", {}).steps[0].args.mood, "negation");
  const noReported = await intentsWith("  if (REPORTED.test(s)) return \"reported\";", "");
  assert.notEqual(noReported.resolveIntent("Ieri am spus oprește tot", {}).steps[0].args.mood, "reported");
  const noQuote = await intentsWith("if (quotedStop && steps.every(", "if (false && steps.every(");
  assert.equal(noQuote.resolveIntent("Am zis „Oprește tot” din greșeală", {}).steps[0].intent, "unknown");
  // 10. The voice fast path: without the question / quotation guard „Oprește tot?” is dispatched as Stop All before any intake.
  const noTalkGuard = await mutated(VOICE_PATH, "if (talk && GLOBAL.has(command.id)) continue;", "", [['from "../owner/intents.mjs"', `from ${JSON.stringify(pathToFileURL(INTENTS_PATH).href)}`]]);
  assert.equal(noTalkGuard.parseVoiceCommand("Oprește tot?", { legaPrefix: true }).command, "stop_all");
  assert.equal(noTalkGuard.parseVoiceCommand("„Oprește tot”", { legaPrefix: true }).command, "stop_all");
  assert.equal(parseVoiceCommand("Oprește tot?", { legaPrefix: true }).kind, "message");
});
