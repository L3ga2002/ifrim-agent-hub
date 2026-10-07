// 2.12.2 (P0-R6) — plain answers in the intake and the engineering planner, from the owner's own live session (2026-10-06, defects L4, L7,
// L11), plus the leftover review findings of the P0-R2/R4 batch (R2-F6, R2-F7, R4-F8) and the exact UNKNOWN_INTENTS count.
// PASS_SIMULATED: the pure resolver, test Hubs (owner.intent typed on the owner channel and as a provider transcript on the voice channel,
// the engineering planner on bug-demo copies); fixture providers only — no model, no live Hub, no network.
//  - L4 (since M11 L5 wave B): a request with no test to bind gets ONE test-first plan — the Hub writes the acceptance test at step 0
//    (nothing to choose, nothing kept, the owner never writes, names or picks a file); a programmer's bare test path still completes it;
//  - L7: „Arată-mi planul” with no project asks ONE question with the projects; naming one (or the button) proposes the plan THERE — no start,
//    no grant; after the clarification TTL the name only opens the project;
//  - L11: a request to change the Hub's mode is explain_mode (answered, nothing written); a mode question and „Ce a rămas în <proiect>?”
//    are status reads (generic name matching, „pro-delivery” included); none of them is an unknown intent for the probe;
//  - R2-F6: a request in the same clause as a negated / conditional / asked stop mention keeps the request (a negation adds its answer);
//  - R2-F7: „Oprește agentul?”, „Redeschide poarta după ce ai oprit tot”, „De ce ai oprit tot?” get fitting answers;
//  - R4-F8: „the last Oprește tot” is the owner's (the stop's own kind, never the Hub's shutdown or the suspension's precedence kind);
//  - UNKNOWN_INTENTS: the intake records after the steps ran how many unknown steps it left unanswered (owner.intent_outcome).
// Mutation checks of the intents.mjs guards run on a temporary copy (the repository file is never touched); the intake / probe / planner
// guards were mutation-checked by hand (break → the named test fails → exact bytes restored → green).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { resolveIntent, stopTalkAnswer, modeAnswer, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { classOfIntent } from "../server/policy/effect-class.mjs";
import { INTAKE_LIMITS } from "../server/owner/intake.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SOURCES = ["typed", "voice-local", "voice-provider"];
const PROJECTS = [{ id: "pd", name: "ProDelivery", slug: "prodelivery" }, { id: "fd", name: "Factory Demo M10.2", slug: "factory-demo-m10-2" }];
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const onVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT id, seq, source, payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ id: e.id, seq: e.seq, source: e.source, payload: JSON.parse(e.payload_json || "{}") }));
const gate = (hub) => hub.settings.get("executionGate") || {};
/** What a sentence must never change: grants, runs, the mode, the gate, Stop Alls. */
const untouched = (t) => ({ grants: count(t, "SELECT COUNT(*) AS n FROM live_grants"), runs: count(t, "SELECT COUNT(*) AS n FROM agent_runs"),
  stops: count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'"), modeSets: count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'mode.set'"),
  mode: t.hub.settings.get("mode") ?? null, gate: gate(t.hub).status });
const intentsOf = (mod, text, extra = {}) => mod.resolveIntent(text, { projects: PROJECTS, currentProjectId: null, ...extra }).steps;
const REAL = { resolveIntent };

/** A factory test project (bug-demo) with one SPEC_DRAFT mission at TRUSTED and the owner (voice-first policy). */
async function factoryHub({ name = "Factory Demo R6", clock = null, noTestDir = false } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-r6");
  materializeFixture("bug-demo", dir);
  // L4: the same project with its tests outside the usual test folders — the planner finds no candidate (a programmer may still name one).
  if (noTestDir) fs.renameSync(path.join(dir, "test"), path.join(dir, "checks"));
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
  const owner = await enrolOwner(t, { activatePolicy: true });
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  return { ...t, project, owner, dir };
}

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-01
// M11 L5 (wave B, design .ifrim/M11_L5_DESIGN.md §2, §8 „Teste existente actualizate deliberat”): the L4 message („pasul în care Hub-ul scrie
// singur testul vine curând (M11)”, :70 and :84) and the „alege unul din testele găsite” question (:95, :100) are gone — owner decision Q3.
// The same requests now get ONE test-first plan: the Hub writes the acceptance test at step 0, the owner names or picks nothing. Kept from
// L4: no question he cannot answer, no file name in the main lines, nothing kept as a request, a programmer's bare path still completes the
// request (and replaces the test-first plan, critique B10), and D21 still binds the ONLY acceptance test.
test("P0R6-01 (L4 → M11 L5) no test to bind → ONE test-first plan (no file to name, write or pick; nothing kept); a programmer's path still completes the request and replaces it; tests found are never offered as choices", async () => {
  const t = await factoryHub({ noTestDir: true });
  try {
    const ctx = { channel: "owner", ownerSession: t.owner.session, actor: "owner" };
    const plan = (input) => t.hub.intake.plan({ kind: "engineering", projectId: t.project.id, ...input }, ctx);
    const r = await plan({ text: "Adaugă validarea numelui: spațiile trec de verificare" });
    assert.equal(r.clarification, undefined, "not a question the owner cannot answer");
    const env = r.plan?.envelope;
    assert.ok(env?.body?.testFirst, JSON.stringify(r).slice(0, 400));
    assert.doesNotMatch(String(r.message || ""), /vine curând|M11/, "the L4 message is gone");
    assert.doesNotMatch(`${r.note} ${r.plan.summary.headline} ${r.plan.summary.steps} ${r.plan.summary.models}`, /numește|test\/|\.mjs|adaugă-l/, "no file to name in the main lines");
    assert.equal(r.workRequest, undefined, "nothing kept");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 0);
    // The request stays open for a programmer: the path said alone (an existing test file outside the usual folders) builds the plan with
    // THAT file, and the test-first plan is replaced.
    const done = await plan({ text: "checks/acceptance.test.mjs" });
    assert.ok(done.plan?.envelope?.id, JSON.stringify(done).slice(0, 400));
    const view = t.hub.factory.view(done.plan.envelope.missionIds[0]);
    assert.equal(view.spec.spec.acceptance[0].testRef, "checks/acceptance.test.mjs");
    assert.match(view.spec.spec.objective, /spațiile trec de verificare/, "the original words are the objective");
    assert.equal(t.hub.envelopes.get(env.id).status, "SUPERSEDED");
    // Through the intake (the owner typed it): ONE test-first plan reaches him — no message, no question, nothing kept.
    const typed = await asOwner(t, { text: "Adaugă validarea emailului în formular", projectId: t.project.id });
    const step = typed.results.find((x) => x.intent === "engineering_request");
    assert.ok(step, JSON.stringify(typed.results).slice(0, 400));
    assert.ok(step.plan?.envelope?.body?.testFirst, JSON.stringify(step).slice(0, 400));
    assert.equal(step.clarification, undefined);
    assert.equal(step.workRequest, undefined);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 0);
  } finally { await t.cleanup(); }

  // Tests found (two, then one): never offered as choices — the Hub writes the test (route H); D21 still binds a described bug.
  const u = await factoryHub();
  try {
    const ctx = { channel: "owner", ownerSession: u.owner.session, actor: "owner" };
    const q = await u.hub.intake.plan({ kind: "engineering", projectId: u.project.id, text: "Adaugă validarea numelui: spațiile trec de verificare" }, ctx);
    assert.equal(q.clarification, undefined, JSON.stringify(q).slice(0, 300));
    assert.ok(q.plan?.envelope?.body?.testFirst);
    assert.doesNotMatch(JSON.stringify(q.plan.summary), /unit\.test\.mjs|Pe care îl folosesc|Alege-l/);
    fs.rmSync(path.join(u.dir, "test", "unit.test.mjs"));
    const one = await u.hub.intake.plan({ kind: "engineering", projectId: u.project.id, text: "Adaugă validarea emailului în formular" }, ctx);
    assert.equal(one.clarification, undefined, JSON.stringify(one).slice(0, 300));
    assert.ok(one.plan?.envelope?.body?.testFirst, "one test found: still the Hub's own test, never „Alege-l”");
    // D21 unchanged: a described bug binds the ONLY acceptance test with no question (no step 0).
    const bound = await u.hub.intake.plan({ kind: "engineering", projectId: u.project.id, text: "Repară validarea numelui: spațiile trec de verificare" }, ctx);
    assert.ok(bound.plan?.envelope?.id, JSON.stringify(bound).slice(0, 300));
    assert.equal(bound.plan.envelope.body.testFirst, undefined);
    assert.equal(u.hub.factory.view(bound.plan.envelope.missionIds[0]).spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");
  } finally { await u.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-02
test("P0R6-02 (L7) „Arată-mi planul” with no project → ONE question with the projects; naming the project (typed, by voice, or the button) proposes the plan there; after the TTL the name only opens it; nothing starts", async () => {
  let now = Date.now();
  const t = await factoryHub({ clock: () => new Date(now) });
  try {
    await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const before = untouched(t);
    const questions = () => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'intake.question'");
    // Typed in the owner session, no project open.
    const q0 = questions();
    const asked = await asOwner(t, { text: "Arată-mi planul" });
    const r = asked.results[0];
    assert.equal(r.intent, "show_plan");
    assert.equal(r.message, "Pe ce proiect să-ți arăt planul?");
    assert.equal(r.plan, undefined, "no plan on a guessed project");
    assert.deepEqual([r.clarification.forIntent, r.clarification.about], ["show_plan", "project"]);
    assert.ok(r.clarification.options.some((o) => o.id === t.project.id && o.label === "Factory Demo R6"), JSON.stringify(r.clarification.options));
    assert.ok(!r.clarification.options.some((o) => o.id === t.hub.projects.hub().id), "the Hub itself is not offered");
    assert.equal(questions(), q0 + 1, "the question is counted once");
    // The next sentence only names the project: the plan is shown THERE (not just the cockpit opened).
    const named = await asOwner(t, { text: "Factory Demo R6" });
    const p = named.results[0];
    assert.equal(p.intent, "show_plan", JSON.stringify(named.results).slice(0, 300));
    assert.equal(p.plan?.envelope?.status, "PROPOSED", JSON.stringify(p).slice(0, 300));
    assert.equal(p.plan.envelope.projectId, t.project.id);
    assert.equal(named.projectId, t.project.id);
    assert.deepEqual(untouched(t), before, "nothing started, no grant, no mode or gate change");
    // Answered once: the same name again only opens the project.
    const again = await asOwner(t, { text: "Factory Demo R6" });
    assert.deepEqual([again.results[0].intent, again.results[0].plan], ["open_project", undefined]);

    // By voice (a provider transcript): the question, then „Hai la …” proposes the plan on that project.
    const vq = await onVoice(t, { text: "Arată-mi planul" });
    assert.equal(vq.results[0].message, "Pe ce proiect să-ți arăt planul?");
    const vp = await onVoice(t, { text: "Hai la Factory Demo R6" });
    assert.equal(vp.results[0].intent, "show_plan");
    assert.equal(vp.results[0].plan?.envelope?.status, "PROPOSED", JSON.stringify(vp.results[0]).slice(0, 300));

    // The button: the project id the Hub offered (never read as a mission id).
    const bq = await asOwner(t, { text: "Arată-mi planul" });
    const choice = await asOwner(t, { choice: { forIntent: "show_plan", id: bq.results[0].clarification.options.find((o) => o.id === t.project.id).id } });
    assert.equal(choice.results[0].plan?.envelope?.projectId, t.project.id, JSON.stringify(choice.results[0]).slice(0, 300));
    // „Ce a rămas?” with no project: the same question, completed by naming it.
    const rq = await onVoice(t, { text: "Ce a mai rămas?" });
    assert.equal(rq.results[0].message, "Pe ce proiect să mă uit?");
    const rp = await onVoice(t, { text: "Factory Demo R6" });
    assert.deepEqual([rp.results[0].intent, Boolean(rp.results[0].explain), rp.results[0].cockpit?.project?.id], ["status", true, t.project.id]);

    // After the clarification TTL the name only opens the project.
    await onVoice(t, { text: "Arată-mi planul" });
    now += INTAKE_LIMITS.clarificationTtlMs + 1000;
    const late = await onVoice(t, { text: "Factory Demo R6" });
    assert.deepEqual([late.results[0].intent, late.results[0].plan], ["open_project", undefined]);
    assert.deepEqual({ ...untouched(t), mode: before.mode }, before, "still nothing started, no grant");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE')"), 0, "no plan confirmed");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-03
const MODE_CHANGE = ["Pune-l pe live activation", "Treci pe live", "Pune Hub-ul în modul live", "Activează LIVE_VALIDATION", "Schimbă modul pe live",
  "Pune-l pe live activation.", "Pune hub-ul in modul live", "Activeaza live validation", "Schimba modul pe live", "Lega, treci pe live", "Poți să treci pe live?",
  "Treci în modul live", "Comută pe LIVE_VALIDATION", "Treci pe build safe", "Intră în modul live acum"];
const NOT_MODE = { "Pornește căutarea pe live": null, "Pune căutarea pe live": null, "Activează căutarea live": null, "Web search live": null, "Pune Lega pe live": null,
  "Pornește Lega": "lega_start", "Redeschide poarta": "gate_rearm", "Revino la live": "live", "Mod live": "live", "Treci pe Live Demo": "open_project", "Hai la live": "open_project" };
const MODE_QUESTIONS = ["Ești în build safe?", "Suntem în BUILD_SAFE?", "În ce mod e Hub-ul?", "Esti in build safe", "Ești pe live?", "Hub-ul e în build safe?", "Care e modul Hub-ului?", "Ce mod e acum?"];
test("P0R6-03 (L11) the resolver: a mode change → explain_mode (a read, every source); the Lega web search, Lega's start, the rearm and a name with „live” never; mode questions and „Ce a rămas în X” → status", () => {
  assert.equal(INTENT_EFFECTS.explain_mode, "none");
  assert.equal(classOfIntent("explain_mode", INTENT_EFFECTS.explain_mode), "READ_NAVIGATE");
  for (const source of SOURCES) {
    for (const text of MODE_CHANGE) {
      const r = REAL.resolveIntent(text, { projects: PROJECTS, source });
      assert.deepEqual(r.steps.map((s) => [s.intent, s.effectClass]), [["explain_mode", "READ_NAVIGATE"]], `${source}: ${text}`);
      assert.equal(r.clarification, null, `${source}: ${text}`);
    }
    for (const [text, want] of Object.entries(NOT_MODE)) {
      const got = intentsOf(REAL, text, { source }).map((s) => s.intent);
      assert.ok(!got.includes("explain_mode"), `${source}: ${text} → ${got}`);
      if (want) assert.deepEqual(got, [want], `${source}: ${text}`);
    }
    for (const text of MODE_QUESTIONS) assert.deepEqual(intentsOf(REAL, text, { source }).map((s) => [s.intent, s.args.modeQuestion]), [["status", true]], `${source}: ${text}`);
  }
  // A project called exactly so is the project, never the mode.
  assert.deepEqual(intentsOf(REAL, "Treci pe live", { projects: [...PROJECTS, { id: "lv", name: "Live", slug: "live" }] }).map((s) => [s.intent, s.args.projectId]), [["open_project", "lv"]]);
  // „Ce a rămas în <proiect>?”: status for that project — diacritics, „Ce-a mai … de făcut”, the provider's „pro-delivery”, ONE question for a missing numbered name.
  for (const text of ["Ce a rămas în ProDelivery?", "Ce-a mai rămas de făcut la pro-delivery?", "ce a ramas in prodelivery", "Ce a mai rămas la Pro Delivery?", "Lega, ce a rămas de făcut pe ProDelivery?"]) {
    assert.deepEqual(intentsOf(REAL, text).map((s) => [s.intent, s.args.remaining, s.args.projectId]), [["status", true, "pd"]], text);
  }
  assert.deepEqual(intentsOf(REAL, "Ce a rămas în Factory Demo M10.2?").map((s) => s.args.projectId), ["fd"]);
  const missing = REAL.resolveIntent("Ce a rămas în Factory Demo M10.3?", { projects: PROJECTS });
  assert.match(missing.clarification?.question || "", /^Nu găsesc proiectul „factory demo m10\.3”\. Te referi la Factory Demo M10\.2\?$/);
  assert.equal(intentsOf(REAL, "Ce a rămas în Atlantis?")[0].args.unknownRef, "atlantis");
  assert.deepEqual(intentsOf(REAL, "Ce a mai rămas?").map((s) => [s.intent, s.args.remaining, s.args.projectId]), [["status", true, undefined]]);
  // The Hub's own texts („Ce a rămas oprit (…) așteaptă…”) are not this question.
  assert.ok(!intentsOf(REAL, "Ce a rămas oprit?").some((s) => s.args?.remaining));
  // The answers: plain, speakable, the mode the server reads; never an administration pointer, never a promise to change it.
  assert.equal(modeAnswer({}, { mode: "BUILD_SAFE" }), "Modul Hub-ului nu se schimbă prin voce și nici nu e nevoie: un plan pornește din BUILD_SAFE după ce îl confirmi o dată în cockpit.");
  assert.equal(modeAnswer({}, { mode: "BUILD_SAFE", spoken: false }), "Modul Hub-ului nu se schimbă dintr-o frază și nici nu e nevoie: un plan pornește din BUILD_SAFE după ce îl confirmi o dată în cockpit.");
  assert.match(modeAnswer({}, { mode: "LIVE_VALIDATION" }), / Acum Hub-ul e în LIVE_VALIDATION\.$/);
  assert.equal(modeAnswer({ question: true }, { mode: "BUILD_SAFE" }), "Hub-ul e în BUILD_SAFE, modul obișnuit: un plan pornește de aici după ce îl confirmi o dată în cockpit.");
  assert.equal(modeAnswer({ question: true }, { mode: "LIVE_VALIDATION" }), "Hub-ul e în LIVE_VALIDATION. Pentru un plan nu trebuie schimbat nimic: pornește după ce îl confirmi o dată în cockpit.");
  assert.equal(modeAnswer({ question: true }, { mode: null }), "Nu pot citi acum modul Hub-ului.");
  for (const m of ["BUILD_SAFE", "LIVE_VALIDATION", "OPERATIONAL", null]) for (const q of [true, false]) {
    const a = modeAnswer({ question: q }, { mode: m });
    assert.doesNotMatch(a, /Integrări|Avansat|Sistem|OPEN GATE|mă ocup|în regulă|am schimbat|am trecut/i, a);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-04
test("P0R6-04 (L11) through owner.intent: the mode request is answered and nothing is written; the mode question says the mode; „Ce a rămas în X” shows X's status; no unknown intent for the probe", async () => {
  const t = await factoryHub({ name: "ProDelivery" });
  try {
    const m0 = t.hub.bus.lastSeq();
    const before = untouched(t);
    const settingsChanged = () => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed'");
    const s0 = settingsChanged();
    const mode = t.hub.settings.get("mode");
    const typed = await asOwner(t, { text: "Pune-l pe live activation" });
    assert.deepEqual(typed.results.map((x) => [x.intent, x.effectClass]), [["explain_mode", "READ_NAVIGATE"]]);
    assert.equal(typed.results[0].message, modeAnswer({}, { mode, spoken: false }));
    const spoken = await onVoice(t, { text: "Treci pe live" });
    assert.equal(spoken.results[0].message, modeAnswer({}, { mode, spoken: true }));
    assert.equal(spoken.results[0].refused, undefined, "a read: allowed from a provider transcript");
    const q = await onVoice(t, { text: "Ești în build safe?" });
    assert.deepEqual([q.results[0].intent, q.results[0].message], ["status", modeAnswer({ question: true }, { mode })]);
    const left = await onVoice(t, { text: "Ce-a mai rămas de făcut la pro-delivery?" });
    assert.equal(left.results[0].intent, "status");
    assert.ok(left.results[0].explain && Array.isArray(left.results[0].explain.missions), JSON.stringify(left.results[0]).slice(0, 300));
    assert.equal(left.results[0].cockpit?.project?.id, t.project.id, "the project it names");
    assert.equal(left.projectId, t.project.id);
    const unknownProject = await asOwner(t, { text: "Ce a rămas în Atlantis?" });
    assert.equal(unknownProject.results[0].message, "Nu găsesc proiectul „atlantis”.");
    assert.deepEqual(untouched(t), before, "no mode change, no gate change, no grant, no run, no Stop All");
    assert.equal(settingsChanged(), s0, "no setting written");
    const r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.unknownIntents, 0, JSON.stringify(r.evidence.unknownIntents));
    assert.equal(r.counters.manualModeChanges, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-05
test("P0R6-05 (R2-F6) a request in the same clause as a negated, conditional or asked stop mention keeps the request; a negation adds „Bine, nu opresc nimic.”; nothing ever stops", async () => {
  const KEPT = {
    "Deschide ProDelivery, nu opri tot": [["open_project", "pd"], ["explain_stop", "negation"]],
    "Repară testul de login, dar nu opri tot": [["engineering_request", null], ["explain_stop", "negation"]],
    "Repară testul de login dar nu opri tot": [["engineering_request", null], ["explain_stop", "negation"]],
    "Pornește misiunea de login, nu opri tot": [["start_mission", null], ["explain_stop", "negation"]],
    "Nu opri tot, deschide ProDelivery": [["open_project", "pd"], ["explain_stop", "negation"]],
    "Fă un clip despre ce se întâmplă când oprești tot": [["studio_create", null]],
    "Ce s-a executat înainte de Stop All?": [["last_run", null]],
    "Ce teste au picat după Stop All?": [["show_tests", null]],
  };
  for (const source of SOURCES) {
    for (const [text, want] of Object.entries(KEPT)) {
      const got = intentsOf(REAL, text, { source });
      assert.deepEqual(got.map((s) => [s.intent, s.intent === "explain_stop" ? s.args.mood : s.args.projectId ?? null]), want, `${source}: ${text}`);
      assert.ok(got.every((s) => s.intent !== "stop_all" && s.effectClass !== "INTERRUPT"), `${source}: ${text}`);
    }
  }
  // Clean arguments: the negated part never joins a mission's name or the request's words.
  assert.equal(intentsOf(REAL, "Pornește misiunea de login, nu opri tot")[0].args.missionRef, "de login");
  assert.equal(intentsOf(REAL, "Repară testul de login, dar nu opri tot")[0].args.request, "repara testul de login");
  // The stop as the subject of a question stays the Hub's explanation (never another read, never a plan proposal).
  for (const [text, mood] of Object.entries({ "Ce urmează după Stop All?": "question", "Ce urmează după ce opresc tot?": "question", "Ce se întâmplă cu planul dacă opresc tot?": "question",
    "Explică-mi Stop All": "question", "Poți să oprești tot și să-mi arăți testele?": "ask", "Nu, nu opri nimic": "negation", "Nu opri tot.": "negation" })) {
    assert.deepEqual(intentsOf(REAL, text).map((s) => [s.intent, s.args.mood]), [["explain_stop", mood]], text);
  }
  // Consent is never read out of a sentence about the stop: „Da, nu opri tot” with a plan waiting confirms nothing.
  const waiting = { pendingEnvelopes: [{ id: "env_w", title: "Plan" }], awaiting: "envelope_confirmation" };
  assert.ok(intentsOf(REAL, "Da, nu opri tot", waiting).every((s) => s.intent !== "confirm" && !s.args.envelopeId), JSON.stringify(intentsOf(REAL, "Da, nu opri tot", waiting)));
  // Through owner.intent (typed and as a provider transcript): the project opens, the answer is said, nothing stops.
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const pd = t.hub.projects.list().find((p) => p.id !== t.hub.projects.hub().id) || t.hub.projects.hub();
    for (const out of [await asOwner(t, { text: `Deschide ${pd.name}, nu opri tot` }), await onVoice(t, { text: `Deschide ${pd.name}, nu opri tot` })]) {
      assert.deepEqual(out.results.map((x) => x.intent), ["open_project", "explain_stop"], JSON.stringify(out.results).slice(0, 300));
      assert.equal(out.results[0].cockpit?.project?.id, pd.id);
      assert.equal(out.results[1].message, "Bine, nu opresc nimic.");
    }
    assert.deepEqual([count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'"), gate(t.hub).status], [0, "open"]);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-06
test("P0R6-06 (R2-F7) the answers fit: a deferred stop gets the conditional answer, „Oprește agentul?” names „Oprește agentul”, the rearm after „ai oprit tot” shows the card, „De ce ai oprit tot?” says when and from where", async () => {
  for (const source of SOURCES) {
    assert.deepEqual(intentsOf(REAL, "Imediat ce termini, oprește tot", { source }).map((s) => [s.intent, s.args.mood]), [["explain_stop", "conditional"]]);
    assert.deepEqual(intentsOf(REAL, "Oprește agentul?", { source }).map((s) => [s.intent, s.args.mood, s.args.worker]), [["explain_stop", "ask", "any"]]);
    for (const text of ["Redeschide poarta după ce ai oprit tot", "Redeschide poarta după ce am oprit tot", "Poți să redeschizi poarta după ce am oprit tot?", "După ce am oprit tot, redeschide poarta", "Continuă după ce am oprit tot"]) {
      assert.deepEqual(intentsOf(REAL, text, { source }).map((s) => s.intent), ["gate_rearm"], `${source}: ${text}`);
    }
    for (const text of ["De ce ai oprit tot?", "De ce s-a oprit tot?", "Dar de ce ai oprit totul?"]) {
      assert.deepEqual(intentsOf(REAL, text, { source }).map((s) => [s.intent, s.args.mood, s.args.why]), [["explain_stop", "reported", true]], `${source}: ${text}`);
    }
  }
  assert.equal(stopTalkAnswer({ mood: "conditional", about: "stop_all" }), "Nu pun opriri condiționate, așa că nu am oprit nimic acum. Spune „Oprește tot” când vrei să opresc.");
  assert.equal(stopTalkAnswer({ mood: "ask", about: "stop_worker", worker: "any" }), "Nu am făcut nimic: ai întrebat. Spune „Oprește agentul” când vrei și o fac imediat.");
  assert.match(stopTalkAnswer({ mood: "ask", about: "stop_worker", worker: "codex" }), /„Oprește Codex”/);
  const at = "2026-10-06T12:00:00.000Z";
  assert.match(stopTalkAnswer({ mood: "reported", about: "stop_all", why: true }, { lastStopAt: at, lastStopVia: "voice", gate: "stop_all" }),
    /^Ultimul „Oprește tot” a fost pe \d{1,2} octombrie, la \d{2}:\d{2}, cerut prin voce\. Poarta e încă oprită de el: o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello \(nu prin voce\)\.$/);
  assert.equal(stopTalkAnswer({ mood: "reported", about: "stop_all", why: true }, { lastStopAt: null, gate: "open" }), "Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului. Poarta de execuție e deschisă acum.");
  assert.match(stopTalkAnswer({ mood: "reported", about: "stop_all", why: true }, { lastStopAt: at, lastStopVia: null, gate: "other" }), /, cerut printr-o comandă\. Poarta de execuție e oprită acum din alt motiv; îl vezi în cockpit\.$/);
  // Through owner.intent after a real Stop All from the Hub's interface: when, from where, and the gate it still holds.
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    await dispatch(t.hub, "system.stop_all", { reason: "Stop All" }, { channel: "ui", actor: "user" });
    const stops = count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'");
    const out = await asOwner(t, { text: "De ce ai oprit tot?" });
    assert.deepEqual(out.results.map((x) => x.intent), ["explain_stop"]);
    assert.match(out.results[0].message, /^Ultimul „Oprește tot” a fost pe \d{1,2} [a-z]+, la \d{2}:\d{2}, cerut din interfața Hub-ului\. Poarta e încă oprită de el: o redeschizi în cockpit/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'"), stops, "a question about the stop stops nothing");
    // The rearm phrase shows the card's answer (the gate is suspended), never a conditional-stop answer.
    const rearm = await asOwner(t, { text: "Redeschide poarta după ce ai oprit tot" });
    assert.equal(rearm.results[0].intent, "gate_rearm");
    assert.doesNotMatch(String(rearm.results[0].message || ""), /condiționate/);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-07
test("P0R6-07 (R4-F8) „the last Oprește tot” is the owner's: the stop's own kind (stopKind) decides, never the suspension's precedence kind; the Hub's shutdown never answers it", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const stop = (source, payload) => t.hub.bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source, payload: { reason: "r", ...payload } });
    const why = async () => (await asOwner(t, { text: "De ce ai oprit tot?" })).results[0].message;
    const reported = async () => (await asOwner(t, { text: "Ieri am spus oprește tot" })).results[0].message;
    // Only the Hub's shutdown in the log (with and without stopKind): no owner Stop All.
    stop("system", { kind: "shutdown" });
    stop("system", { kind: "stop_all", stopKind: "shutdown" }); // a shutdown landing on an unrearmed Stop All (precedence kind "stop_all")
    assert.match(await why(), /^Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului\./);
    assert.match(await reported(), /^Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului\./);
    // An owner Stop All recorded before stopKind existed, landing on a security record (precedence kind "security"): the owner's.
    stop("device:dev_1", { kind: "security" });
    assert.match(await why(), /, cerut de pe telefon\. Poarta de execuție e deschisă acum\.$/);
    // The newest owner stop (stopKind), then a shutdown on top of it: still the owner's, from the voice.
    stop("voice", { kind: "security", stopKind: "stop_all" });
    stop("system", { kind: "stop_all", stopKind: "shutdown" });
    assert.match(await why(), /, cerut prin voce\./);
    assert.match(await reported(), /^Ultimul „Oprește tot” a fost pe /);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-08
test("P0R6-08 UNKNOWN_INTENTS exact: the intake records after the steps ran how many unknown steps it left unanswered (owner.intent_outcome, no words); the probe counts that; older events stay estimated", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const m0 = t.hub.bus.lastSeq();
    await asOwner(t, { text: "zbrrt flonk qwyx" }); // unknown, nothing said back
    await asOwner(t, { text: "Da" }); // unknown with the refusal reason (no plan waiting): answered
    await asOwner(t, { text: "zbrrt flonk. Da" }); // one unanswered, one answered
    await onVoice(t, { text: "Pune-l pe live activation" }); // explain_mode: never unknown
    await onVoice(t, { text: "Continuă?" }); // the D20 question: answered
    const intents = events(t, "owner.intent").filter((e) => e.seq > m0);
    const outcomes = events(t, "owner.intent_outcome").filter((e) => e.seq > m0);
    assert.deepEqual(intents.map((e) => e.payload.outcome === true), [true, true, true, false, true]);
    assert.deepEqual(outcomes.map((e) => [e.payload.intentEventId, e.payload.unknown, e.payload.unknownUnanswered]),
      [[intents[0].id, 1, 1], [intents[1].id, 1, 0], [intents[2].id, 2, 1], [intents[4].id, 1, 0]]);
    assert.ok(outcomes.every((e, i) => e.seq > [intents[0], intents[1], intents[2], intents[4]][i].seq), "written after the sentence");
    assert.ok(!JSON.stringify(outcomes).includes("zbrrt"), "never the sentence's words");
    let r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.unknownIntents, 2, JSON.stringify(r.evidence.unknownIntents));
    assert.deepEqual(r.evidence.unknownIntents.items.map((i) => [i.steps, i.source, i.exact]), [[1, "typed", true], [1, "typed", true]]);
    assert.deepEqual(r.breakdown.unknownIntents, { bySource: { typed: 2 }, estimated: 0 });
    // A sentence that announced its outcome but never wrote it (it failed before the Hub answered): every unknown step counts, exactly.
    const m1 = t.hub.bus.lastSeq();
    t.hub.bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: "global", source: "user", payload: { channel: "ui", source: "typed", steps: ["unknown", "unknown"], clarification: false, refused: 0, outcome: true } });
    // An event from before 2.12.2 (no outcome announced): still the estimate.
    t.hub.bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: "global", source: "user", payload: { channel: "ui", source: "typed", steps: ["unknown"], clarification: false, refused: 0 } });
    r = t.hub.probe.report({ sinceSeq: m1 });
    assert.deepEqual(r.evidence.unknownIntents.items.map((i) => [i.steps, i.exact]), [[2, true], [1, false]]);
    assert.equal(r.breakdown.unknownIntents.estimated, 1);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ P0R6-09
const INTENTS_PATH = fileURLToPath(new URL("../server/owner/intents.mjs", import.meta.url));
const EFFECT_CLASS_URL = pathToFileURL(fileURLToPath(new URL("../server/policy/effect-class.mjs", import.meta.url))).href;
let mutationN = 0;
/** A copy of intents.mjs with ONE guard broken (the repository file is never touched), its relative import pointed at the real file. */
async function intentsWith(...pairs) {
  let changed = fs.readFileSync(INTENTS_PATH, "utf8");
  for (const [find, replace] of pairs) {
    assert.ok(changed.includes(find), `the mutation must apply: ${find.slice(0, 100)}`);
    changed = changed.replace(find, replace);
  }
  changed = changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(EFFECT_CLASS_URL)}`);
  const tmp = path.join(os.tmpdir(), `ifrim-r6-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(tmp, changed);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
test("P0R6-09 mutation checks: each new intents.mjs guard, broken alone, brings its defect back", async () => {
  // L11: the object between the verb and the target is the Hub or its mode only — open it, and the Lega web-search setting is read as the mode.
  const anyObject = await intentsWith(["(?: (?:hub-ul|hubul|hub|sistemul|totul|tot))?(?: (?:modul|mod|regimul|regim)(?: (?:hub-ului|hubului))?)?", "(?: [a-z-]+)?(?: (?:modul|mod|regimul|regim)(?: (?:hub-ului|hubului))?)?"]);
  assert.ok(intentsOf(anyObject, "Pune căutarea pe live").some((s) => s.intent === "explain_mode"), "without the object list „căutarea pe live” is the mode");
  // L11: without the explain_mode pattern the owner's sentence is unknown again (the live defect); „Treci pe live” a project named „live”.
  const noMode = await intentsWith(['  ["explain_mode", MODE_CHANGE, (m) => ({ target: m.groups.target })],\n', ""]);
  assert.deepEqual(intentsOf(noMode, "Pune-l pe live activation").map((s) => s.intent), ["unknown"]);
  assert.deepEqual(intentsOf(noMode, "Treci pe live").map((s) => s.intent), ["open_project"]);
  // L11: a project named exactly „Live” is the project.
  const noProjectFirst = await intentsWith(['if (found?.intent === "explain_mode" && (context.projects || []).some(', 'if (false && (context.projects || []).some(']);
  assert.deepEqual(intentsOf(noProjectFirst, "Treci pe live", { projects: [{ id: "lv", name: "Live", slug: "live" }] }).map((s) => s.intent), ["explain_mode"]);
  // L11: the mode question and „Ce a rămas în X” fall to unknown without their status lines.
  const noModeQuestion = await intentsWith(['  ["status", MODE_QUESTION, () => ({ modeQuestion: true })],\n', ""]);
  assert.deepEqual(intentsOf(noModeQuestion, "Ești în build safe?").map((s) => s.intent), ["unknown"]);
  const noRemaining = await intentsWith(['  ["status", REMAINING, (m) => ({ remaining: true, ...(m.groups.ref ? { projectRef: m.groups.ref.trim() } : {}) })],\n', ""]);
  assert.deepEqual(intentsOf(noRemaining, "Ce a rămas în ProDelivery?").map((s) => s.intent), ["unknown"]);
  // L11: without status in the project references, „pro-delivery” is never resolved to its project.
  const noStatusRef = await intentsWith(['((step.intent === "autonomy" || step.intent === "status") && step.args.projectRef)', '(step.intent === "autonomy" && step.args.projectRef)']);
  assert.equal(intentsOf(noStatusRef, "Ce-a mai rămas de făcut la pro-delivery?")[0].args.projectId, undefined);
  // R2-F6: without the kept request the owner's request is replaced by the explanation again (the review's defect).
  const noKeep = await intentsWith(['if (found && keepsRequest(found.intent, mood)) return { intent: found.intent, args: found.args, ...also };', ""],
    ['    if (other && keepsRequest(other.intent, mood)) return { intent: other.intent, args: other.args, ...also };\n', ""]);
  assert.deepEqual(intentsOf(noKeep, "Deschide ProDelivery, nu opri tot").map((s) => s.intent), ["explain_stop"]);
  assert.deepEqual(intentsOf(noKeep, "Fă un clip despre ce se întâmplă când oprești tot").map((s) => s.intent), ["explain_stop"]);
  // R2-F6: without the negated part cut away, the mission's name carries „nu opri tot”.
  const noCut = await intentsWith(["  if (parts.length < 2) return null;\n", "  return null;\n"]);
  assert.notEqual(intentsOf(noCut, "Pornește misiunea de login, nu opri tot")[0].args.missionRef, "de login");
  // R2-F6: a question keeps only the reads with their own subject; any read would turn „Ce urmează după Stop All?” into next_step.
  const anyRead = await intentsWith(['&& (STOP_TIME_READS.has(intent) || (mood !== "question" && mood !== "ask" && ["navigate", "plan", "local"].includes(INTENT_EFFECTS[intent])));', "&& true;"]);
  assert.deepEqual(intentsOf(anyRead, "Ce urmează după Stop All?").map((s) => s.intent), ["next_step"]);
  // R2-F6: consent is never kept from a sentence about the stop. The class guard (a navigation, a plan, a local action or a read; never
  // NEVER_A_HALF) keeps the confirmation out of the step list altogether; broken, only the later mixed-confirmation rule still refuses it;
  // broken together with the negation's second step, „Da, nu opri tot” confirms the waiting plan.
  const waiting = { pendingEnvelopes: [{ id: "env_w", title: "Plan" }], awaiting: "envelope_confirmation" };
  const classGuard = ['!NEVER_A_HALF.has(intent)\n  && (STOP_TIME_READS.has(intent) || (mood !== "question" && mood !== "ask" && ["navigate", "plan", "local"].includes(INTENT_EFFECTS[intent])));', "true;"];
  assert.deepEqual(intentsOf(REAL, "Da, nu opri tot", waiting).map((s) => [s.intent, s.args.mood]), [["explain_stop", "negation"]]);
  const noClassGuard = await intentsWith(classGuard);
  assert.ok(intentsOf(noClassGuard, "Da, nu opri tot", waiting).some((s) => s.args?.refusedConfirmation), "without the class guard the yes reaches the confirmation rules");
  const consent = await intentsWith(classGuard, ['const also = mood === "negation" ? { alsoExplain: { mood, about: intent } } : {};', "const also = {};"]);
  assert.ok(intentsOf(consent, "Da, nu opri tot", waiting).some((s) => s.intent === "confirm" && s.args.envelopeId === "env_w"), "without both a stop sentence confirms the plan");
  // R2-F7: „De ce ai oprit tot?” is the definition again without WHY_STOPPED; the rearm after „ai oprit tot” a conditional stop without STOP_NAME's form.
  const noWhy = await intentsWith(['if (intent === "stop_all" && (mood === "question" || mood === "ask") && WHY_STOPPED.test(softTrim(t)))', "if (false)"]);
  assert.deepEqual(intentsOf(noWhy, "De ce ai oprit tot?").map((s) => [s.intent, s.args.mood, s.args.why]), [["explain_stop", "question", undefined]]);
  const noAfterStopped = await intentsWith(["|opreste tot|ce (?:am|ai|ati|a|au) oprit (?:tot|totul|toate))`;", "|opreste tot)`;"]);
  // (Review F5: the request in front of a deferred stop is kept with its own answer, so the broken form now shows the rearm AND the
  // conditional-stop answer; the defect — a conditional answer to a rearm sentence — is the same.)
  assert.ok(intentsOf(noAfterStopped, "Redeschide poarta după ce ai oprit tot").some((s) => s.intent === "explain_stop" && s.args.mood === "conditional"));
  assert.deepEqual(intentsOf(REAL, "Redeschide poarta după ce ai oprit tot").map((s) => [s.intent, s.args.mood]), [["gate_rearm", undefined]]);
  const codexForAny = await intentsWith(['worker === "codex" ? "Codex" : "agentul"', '"Codex"']);
  assert.match(codexForAny.stopTalkAnswer({ mood: "ask", about: "stop_worker", worker: "any" }), /„Oprește Codex”/);
});
