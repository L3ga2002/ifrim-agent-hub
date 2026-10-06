// 2.12.2 — P0-R9: the review findings of the Lega fixes batch (units A–D), each with the reviewer's reproduction turned into a test.
//  - F1 (critical): „Nu mai deschide ProDelivery, dar oprește tot” ran the request the owner negated and said „nu opresc nimic”; a real
//    Stop All after „dar” never stopped. A contrast word now opens a part of its own (the command after it is judged as a command), a
//    negation counts only inside the verb's own part, a request said under its own negation is never kept or split off next to a stop,
//    „Repară testul de login, dar oprește tot” is the request AND the stop, and „oprește doar Codex” is a worker stop.
//  - F2: the L4 „tests found” question is answerable without naming a file: its choices are drawn as buttons (clarificationOf) and a
//    plain pick of the ONE offered test („Alege-l”, „Folosește-l”, „Primul”, its name) is that choice — a plan card, nothing started.
//  - F3: a lease retained while the Hub runs (gate open, no Stop All) had no owner path until a restart. When the reconciler's bounded
//    follow-up ends with the lease unproven, the gate is suspended ("suspend", „automat, de Hub”) so the rearm card releases it.
//  - F4: the „filter on” toggle no longer claims it applies to a session that started without the filter (the Hub closes that one);
//    the panel mutes it and closes it too, never starting a filter the Hub would not count.
//  - F5: a conditional or reported stop next to a navigation is answered (explain_stop) and the project reference carries no stop words.
//  - F6: the raw wait reason ("retry") never reaches a Lega or cockpit surface: the same labels on the server and the web.
//  - F7: a face heard by voice while the Lega screen is not on display is stored and the Lega screen opens — the face the Hub reports.
// PASS_SIMULATED: the pure resolver and web helpers, test Hubs (owner.intent typed and as a provider transcript, the engineering planner on
// bug-demo copies, seeded run rows, a private lease reconciler with short follow-up delays), fixture providers only — no model, no live
// Hub, no network. Mutation checks of intents.mjs run on temporary copies (the repository file is never touched); the server modules a Hub
// imports were mutation-checked by hand (break → the named test fails → exact bytes restored → green).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { resolveIntent, stopTalkAnswer } from "../server/owner/intents.mjs";
import { createLeaseReconciler } from "../server/runtime/lease-reconcile.mjs";
import { RUNTIME_LEASE_SUSPENSION, runtimeLeasesReason } from "../server/runtime/recovery.mjs";
import { classifySuspension, CHANNEL_LABELS } from "../server/policy/gate-state.mjs";
import { factoryWaitText, FACTORY_WAIT_REASONS } from "../server/policy/factory-wait.mjs";
import { factoryWaitLabel, factoryWaitSuffix, isCockpitHash } from "../web/src/lib/uiLogic.js";
import { clarificationOf, faceElsewhere, faceCommand } from "../web/src/lib/cockpitLogic.js";
import { runGateApply, GATE_LIVE_TEXT, GATE_TOGGLE_RESULT } from "../web/src/lib/voiceGateApply.js";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const SOURCES = ["typed", "voice-local", "voice-provider"];
const PROJECTS = [{ id: "pd", name: "ProDelivery", slug: "prodelivery" }, { id: "fd", name: "Factory Demo M10.2", slug: "factory-demo-m10-2" }];
const MISSIONS = [{ id: "m1", title: "login" }];
const stepsOf = (mod, text, extra = {}) => mod.resolveIntent(text, { projects: PROJECTS, missions: MISSIONS, currentProjectId: null, ...extra }).steps;
const REAL = { resolveIntent };
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const onVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const gate = (hub) => hub.settings.get("executionGate") || {};
const stopAlls = (t) => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'");

// ------------------------------------------------------------------------------------------------------------------------------ R9-01
/** F1: every sentence of the finding — the stop runs, the request the owner negated never does. */
const NEGATED_THEN_STOP = ["Nu mai deschide ProDelivery, dar oprește tot", "Nu mai deschide ProDelivery dar oprește tot", "Nu pregăti planul, dar oprește tot",
  "Nu mai arăta testele, dar oprește tot", "Nu mai deschide ProDelivery, oprește tot", "Nu mai repara nimic dar oprește tot", "Nu repara testul de login, dar oprește tot",
  "Nu mai face clipul, dar oprește tot", "Nu deschide ProDelivery, ci oprește tot", "Nu mai deschide ProDelivery, însă oprește tot", "Nu mai lucra la ProDelivery dar oprește tot"];
test("R9-01 (F1) a Stop All after „dar / însă / ci” stops; the request the owner negated is never run, kept or split off; „nu opresc nimic” is never said for it", () => {
  for (const source of SOURCES) {
    for (const text of NEGATED_THEN_STOP) {
      const steps = stepsOf(REAL, text, { source });
      assert.ok(steps.some((s) => s.intent === "stop_all"), `${source}: ${text} → ${JSON.stringify(steps.map((s) => s.intent))}`);
      assert.ok(!steps.some((s) => ["open_project", "show_plan", "show_tests", "engineering_request", "studio_create", "explain_stop"].includes(s.intent)), `${source}: ${text} → ${JSON.stringify(steps.map((s) => s.intent))}`);
    }
    // „Nu, dar oprește tot” is „Nu, oprește tot”: the no (nothing starts) and the stop.
    assert.deepEqual(stepsOf(REAL, "Nu, dar oprește tot", { source }).map((s) => s.intent), stepsOf(REAL, "Nu, oprește tot", { source }).map((s) => s.intent));
    assert.ok(stepsOf(REAL, "Nu, dar oprește tot", { source }).some((s) => s.intent === "stop_all"));
    // The request AND the stop, the request's words clean.
    for (const text of ["Repară testul de login, dar oprește tot", "Repară testul de login dar oprește tot"]) {
      const steps = stepsOf(REAL, text, { source });
      assert.deepEqual(steps.map((s) => s.intent), ["engineering_request", "stop_all"], `${source}: ${text}`);
      assert.equal(steps[0].args.request, "repara testul de login");
    }
    // „Deschide ProDelivery, nu opri tot, oprește doar Codex”: the project (its own name only), no Stop All, Codex stopped.
    const codex = stepsOf(REAL, "Deschide ProDelivery, nu opri tot, oprește doar Codex", { source });
    assert.deepEqual(codex.map((s) => [s.intent, s.args.projectRef ?? s.args.mood ?? s.args.worker]), [["open_project", "prodelivery"], ["explain_stop", "negation"], ["stop_worker", "codex"]], source);
    assert.equal(codex[1].args.partial, true, "next to a narrower stop the answer is „nu opresc tot”");
    for (const text of ["Nu opri tot, oprește doar Codex", "Oprește Codex, dar nu opri tot", "Oprește numai Claude"]) {
      const steps = stepsOf(REAL, text, { source });
      assert.ok(steps.some((s) => s.intent === "stop_worker"), `${source}: ${text}`);
      assert.ok(!steps.some((s) => s.intent === "stop_all"), `${source}: ${text}`);
    }
    // A negated request next to a negated stop: nothing runs, only the answer.
    for (const text of ["Nu mai deschide ProDelivery, nu opri tot", "Nu mai deschide ProDelivery nu opri tot", "Nu mai deschide ProDelivery, butonul oprește tot"]) {
      assert.deepEqual(stepsOf(REAL, text, { source }).map((s) => s.intent), ["explain_stop"], `${source}: ${text}`);
    }
    // A bare „Nu,” before the command is not a negated stop (the negation counts in the verb's own part only).
    assert.ok(stepsOf(REAL, "Nu, bre oprește tot", { source }).some((s) => s.intent === "stop_all"));
  }
  // The R2-F6 cases keep their requests unchanged (P0R6-05), and a negation, a question, a condition still never stop.
  const KEPT = { "Deschide ProDelivery, nu opri tot": [["open_project", "pd"], ["explain_stop", "negation"]], "Nu opri tot, deschide ProDelivery": [["open_project", "pd"], ["explain_stop", "negation"]],
    "Repară testul de login, dar nu opri tot": [["engineering_request", null], ["explain_stop", "negation"]], "Pornește misiunea de login, nu opri tot": [["start_mission", null], ["explain_stop", "negation"]],
    "Fă un clip despre ce se întâmplă când oprești tot": [["studio_create", null]], "Ce s-a executat înainte de Stop All?": [["last_run", null]] };
  for (const [text, want] of Object.entries(KEPT)) assert.deepEqual(stepsOf(REAL, text).map((s) => [s.intent, s.intent === "explain_stop" ? s.args.mood : s.args.projectId ?? null]), want, text);
  assert.equal(stepsOf(REAL, "Repară testul de login, dar nu opri tot")[0].args.request, "repara testul de login");
  for (const text of ["Nu opri tot.", "Nu, nu opri nimic", "Poți să oprești tot?", "Dacă pică testele, oprește tot", "Oprește tot dar doar dacă pică testele", "Ieri am spus oprește tot"]) {
    assert.ok(!stepsOf(REAL, text).some((s) => s.intent === "stop_all"), text);
  }
  // The answers.
  assert.equal(stopTalkAnswer({ mood: "negation", about: "stop_all" }), "Bine, nu opresc nimic.");
  assert.equal(stopTalkAnswer({ mood: "negation", about: "stop_all", partial: true }), "Bine, nu opresc tot; fac doar ce ai cerut.");
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-02
test("R9-02 (F1) end to end: by voice „Nu mai deschide <proiect>, dar oprește tot” stops everything and opens nothing; „…, nu opri tot, oprește doar Codex” stops nothing global and says so", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const pd = t.hub.projects.list().find((p) => p.id !== t.hub.projects.hub().id) || t.hub.projects.hub();
    // „…, nu opri tot, oprește doar Codex” (typed): the project opens, the honest answer, no Stop All, the gate stays open.
    const partial = await asOwner(t, { text: `Deschide ${pd.name}, nu opri tot, oprește doar Codex` });
    assert.deepEqual(partial.results.map((r) => r.intent), ["open_project", "explain_stop", "stop_worker"], JSON.stringify(partial.results).slice(0, 400));
    assert.equal(partial.results[1].message, "Bine, nu opresc tot; fac doar ce ai cerut.");
    assert.deepEqual([stopAlls(t), gate(t.hub).status], [0, "open"]);
    // The finding's sentence as a provider transcript: one Stop All, the gate suspended, the project NOT opened, never „nu opresc nimic”.
    const out = await onVoice(t, { text: `Nu mai deschide ${pd.name}, dar oprește tot` });
    assert.deepEqual(out.results.map((r) => r.intent), ["stop_all"], JSON.stringify(out.results).slice(0, 400));
    assert.ok(!out.results.some((r) => r.cockpit?.project?.id === pd.id), "the project the owner said not to open stays closed");
    assert.ok(!out.results.some((r) => /nu opresc nimic/.test(String(r.message || ""))));
    await waitFor(() => stopAlls(t) === 1, 10000);
    assert.equal(gate(t.hub).status, "suspended");
    assert.equal(classifySuspension(gate(t.hub)).cls, "stop_all");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-03
test("R9-03 (F5) a conditional or reported stop next to a navigation: the request with its own name only, plus the answer that nothing was stopped; a described stop keeps its topic", async () => {
  for (const source of SOURCES) {
    for (const text of ["Deschide ProDelivery după ce oprești tot", "Deschide ProDelivery dacă oprești tot", "Deschide ProDelivery când oprești tot"]) {
      const steps = stepsOf(REAL, text, { source });
      assert.deepEqual(steps.map((s) => [s.intent, s.args.projectRef ?? s.args.mood]), [["open_project", "prodelivery"], ["explain_stop", "conditional"]], `${source}: ${text}`);
      assert.equal(steps[0].args.projectId, "pd");
      assert.equal(steps[0].args.rest, undefined, "no stop words left over in the reference");
    }
    assert.deepEqual(stepsOf(REAL, "Deschide ProDelivery, ieri am zis oprește tot", { source }).map((s) => [s.intent, s.args.projectRef ?? s.args.mood]), [["open_project", "prodelivery"], ["explain_stop", "reported"]]);
    assert.deepEqual(stepsOf(REAL, "Deschide ProDelivery nu opri tot", { source }).map((s) => [s.intent, s.args.projectRef ?? s.args.mood]), [["open_project", "prodelivery"], ["explain_stop", "negation"]]);
    // The condition is the stop's, never a request of its own („…, dar doar dacă pică testele” is no test read).
    assert.deepEqual(stepsOf(REAL, "Oprește tot dar doar dacă pică testele", { source }).map((s) => [s.intent, s.args.mood]), [["explain_stop", "conditional"]]);
    const clip = stepsOf(REAL, "Fă un clip despre ce se întâmplă când oprești tot", { source });
    assert.deepEqual(clip.map((s) => s.intent), ["studio_create"]);
    assert.equal(clip[0].args.topic, "ce se intampla cand opresti tot");
  }
  // Through owner.intent: the project opens and the Hub says nothing was stopped.
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const pd = t.hub.projects.list().find((p) => p.id !== t.hub.projects.hub().id) || t.hub.projects.hub();
    const out = await onVoice(t, { text: `Deschide ${pd.name} după ce oprești tot` });
    assert.deepEqual(out.results.map((r) => r.intent), ["open_project", "explain_stop"]);
    assert.equal(out.results[0].cockpit?.project?.id, pd.id);
    assert.equal(out.results[1].message, stopTalkAnswer({ mood: "conditional", about: "stop_all" }));
    assert.deepEqual([stopAlls(t), gate(t.hub).status], [0, "open"]);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-04
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
async function oneTestHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-r9");
  materializeFixture("bug-demo", dir);
  fs.rmSync(path.join(dir, "test", "unit.test.mjs"));
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Factory Demo R9" })).result;
  t.owner = await enrolOwner(t, { activatePolicy: true });
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
  t.project = project;
  t.dir = dir;
  return t;
}
test("R9-04 (F2) the single test the planner found is picked in plain words („Alege-l”, „Folosește-l”, „Primul”, its name) or by its button; a bare „Da” never picks; a plan card, nothing started", async () => {
  // The cockpit draws the planner's choices (not only the resolver's).
  const planner = { question: "Pe X am găsit un singur test automat…", options: [{ id: "test/acceptance.test.mjs", label: "test/acceptance.test.mjs" }], forIntent: "engineering" };
  assert.equal(clarificationOf({ resolved: { clarification: null }, results: [{ intent: "engineering_request", clarification: planner }] }), planner);
  const resolverQ = { question: "Care?", options: [{ id: "a", label: "A" }], forIntent: "open_project" };
  assert.equal(clarificationOf({ resolved: { clarification: resolverQ }, results: [{ clarification: planner }] }), resolverQ, "the resolver's choices first");
  const noOptions = { question: "Ai pus o condiție…", options: [], forIntent: "confirm" };
  assert.equal(clarificationOf({ resolved: { clarification: noOptions }, results: [{ clarification: planner }] }), planner, "a question without choices never hides the planner's buttons");
  assert.equal(clarificationOf({ resolved: { clarification: noOptions }, results: [] }), noOptions);
  assert.equal(clarificationOf({ resolved: { clarification: null }, results: [{ clarification: { question: "?", options: [] } }] }), null);
  assert.match(source("web/src/screens/Lega.jsx"), /clarification: clarificationOf\(res\), blocker/);
  assert.match(source("web/src/screens/Lega.jsx"), /send\(o\.label, "typed", \{ choice: \{ forIntent: m\.clarification\.forIntent, id: o\.id \} \}\)/);

  const t = await oneTestHub();
  try {
    const counts = () => [count(t, "SELECT COUNT(*) AS n FROM agent_runs"), count(t, "SELECT COUNT(*) AS n FROM live_grants"), count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE')"), stopAlls(t)];
    const before = counts();
    const ask = async () => {
      const first = await asOwner(t, { text: "Adaugă validarea emailului în formular", projectId: t.project.id });
      const step = first.results.find((x) => x.intent === "engineering_request");
      assert.deepEqual(step.clarification?.options?.map((o) => o.id), ["test/acceptance.test.mjs"], JSON.stringify(step).slice(0, 300));
      assert.equal(clarificationOf(first)?.forIntent, "engineering", "the button the cockpit draws");
      return first;
    };
    // „Da” alone is no pick (it is the plan confirmation word): nothing planned, the question still open.
    await ask();
    const yes = await asOwner(t, { text: "Da", projectId: t.project.id });
    assert.ok(!yes.results.some((x) => x.plan?.envelope?.id), JSON.stringify(yes.results).slice(0, 300));
    for (const said of ["Alege-l", "Folosește-l", "Primul", "Da, alege-l", "testul acceptance", "acceptance.test.mjs"]) {
      await ask();
      const r = await asOwner(t, { text: said, projectId: t.project.id });
      const planned = r.results.find((x) => x.plan?.envelope?.id);
      assert.ok(planned, `${said}: ${JSON.stringify(r.results).slice(0, 400)}`);
      assert.equal(planned.plan.envelope.status, "PROPOSED", said);
      const view = t.hub.factory.view(planned.plan.envelope.missionIds[0]);
      assert.equal(view.spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs", said);
      assert.match(view.spec.spec.objective, /validarea emailului/, `${said}: the original request, never the pick's words`);
    }
    // The button (choice with the offered id) does the same.
    await ask();
    const clicked = await asOwner(t, { text: "test/acceptance.test.mjs", choice: { forIntent: "engineering", id: "test/acceptance.test.mjs" }, projectId: t.project.id });
    assert.ok(clicked.results.some((x) => x.plan?.envelope?.status === "PROPOSED"));
    // With no question open, a plain „Alege-l” picks nothing (it is no request of its own).
    const none = await asOwner(t, { text: "Alege-l", projectId: t.project.id });
    assert.ok(!none.results.some((x) => x.plan?.envelope?.id));
    // Two tests found: a plain „Alege-l” / „Primul” is ambiguous and picks nothing (the buttons, or the test's own name, choose).
    fs.writeFileSync(path.join(t.dir, "test", "unit.test.mjs"), "import test from \"node:test\";\ntest(\"unit\", () => {});\n");
    const two = await asOwner(t, { text: "Adaugă validarea emailului în formular", projectId: t.project.id });
    assert.equal(clarificationOf(two)?.options?.length, 2, JSON.stringify(two.results).slice(0, 300));
    for (const said of ["Alege-l", "Primul"]) {
      const r = await asOwner(t, { text: said, projectId: t.project.id });
      assert.ok(!r.results.some((x) => x.plan?.envelope?.id), `${said} picks nothing among two`);
    }
    assert.deepEqual(counts(), before, "nothing started, no grant, no confirmed plan, no stop");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-05
let seeded = 0;
function seedRun(hub, { status = "interrupted", environment = "wsl-runner", evidence = {} } = {}) {
  const id = `run_r9_${Date.now().toString(36)}_${++seeded}`;
  const now = new Date().toISOString();
  hub.db.prepare(`INSERT INTO agent_runs (id, provider, status, pid, pid_started_at, started_at, created_at, environment, evidence_json, finished_at)
    VALUES (?, 'codex', ?, NULL, NULL, ?, ?, ?, ?, ?)`).run(id, status, now, now, environment, JSON.stringify(evidence), now);
  return id;
}
/** What runs.finalize leaves after a run whose exit was not confirmed (leases.retain at runtime, the gate open, no Stop All). */
function retainAtRuntime(hub, runId, resource) {
  const lease = hub.bus.transaction(() => hub.leases.acquire({ resource, holder: `codex:${runId}`, runId, ttlSeconds: 600 }));
  hub.bus.transaction(() => hub.leases.retain(lease.id, "provider process did not confirm exit", { environment: "wsl-runner" }));
  return lease.id;
}
const FAILED_REAP = { environment: { reap: { ok: false, remaining: 1 } } };
const leaseStatus = (t, id) => t.hub.db.prepare("SELECT status FROM leases WHERE id = ?").get(id)?.status;
const card = (t, session) => t.hub.commands.dispatch({ type: "gate.rearm.card", payload: {}, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const rearm = (t, session, c, extra = {}) => t.hub.commands.dispatch({ type: "gate.rearm", payload: { nonce: c.nonce, hash: c.hash, ...extra }, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);

test("R9-05 (F3) a lease retained at runtime with the gate OPEN: when the follow-up ends unproven the gate is suspended (suspend, „automat, de Hub”); the card releases it with the acknowledgement and reopens in BUILD_SAFE; nothing relaunched", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    assert.equal(gate(t.hub).status, "open");
    const runId = seedRun(t.hub, { evidence: FAILED_REAP });
    const lease = retainAtRuntime(t.hub, runId, "workspace:r9-runtime");
    // A private reconciler with short delays (the Hub's own follows the same lease with the real 2 s / 10 s / 30 s).
    const rec = createLeaseReconciler(t.hub, { subscribe: false });
    assert.equal(rec.followUp(lease, { delaysMs: [5, 20] }), true);
    await waitFor(() => gate(t.hub).status === "suspended", 10000);
    const g = gate(t.hub);
    assert.deepEqual([g.suspendedBy.kind, g.suspendedBy.channel, g.suspendedBy.actor], [RUNTIME_LEASE_SUSPENSION.kind, "automation", "lease-reconcile"]);
    assert.equal(CHANNEL_LABELS[g.suspendedBy.channel], "automat, de Hub");
    assert.equal(g.reason, "Execuția „Codex (wsl-runner)” s-a încheiat fără să confirme că procesele ei s-au oprit; am suspendat poarta până verifici spațiul ei de lucru.");
    assert.doesNotMatch(g.reason, /lease|grant|envelope/i);
    assert.deepEqual(g.suspendedBy.retained, { runs: [runId], leases: [lease], count: 1 });
    assert.equal(leaseStatus(t, lease), "retained");
    const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'lease.gate_suspended'").all().map((e) => JSON.parse(e.payload_json));
    assert.deepEqual(ev.map((e) => [e.kind, e.channel, e.leases]), [["suspend", "automation", [lease]]]);
    assert.equal(stopAlls(t), 0, "not a Stop All");
    // A second escalation (another follow-up, the tick) keeps the record.
    assert.deepEqual([rec.escalate(lease).suspended, rec.escalate(lease).reason], [false, "gate_suspended"]);
    assert.equal(gate(t.hub).suspendedBy.id, g.suspendedBy.id);
    // The owner's card: the unknown step with the acknowledgement; without it refused, with it released and reopened in BUILD_SAFE.
    const c = await card(t, t.owner.session);
    assert.deepEqual([c.eligible, c.cls, c.leases?.total, c.leases?.ackRequired], [true, "suspend", 1, true], JSON.stringify(c).slice(0, 500));
    assert.deepEqual([c.leases.steps[0].leaseId, c.leases.steps[0].verdict], [lease, "unknown"]);
    assert.match(c.headline, /^Poarta de execuție e suspendată \(.+, automat, de Hub\)\. O redeschid aici, cu Windows Hello\?$/);
    await assert.rejects(rearm(t, t.owner.reauth(), c), (e) => (e?.details?.code || e?.data?.code) === "LEASES_ACK");
    assert.deepEqual([gate(t.hub).status, leaseStatus(t, lease)], ["suspended", "retained"]);
    const out = await rearm(t, t.owner.reauth(), c, { ackLeases: true });
    assert.equal(out.reopened, true);
    assert.deepEqual([gate(t.hub).status, leaseStatus(t, lease), t.hub.settings.get("mode")], ["open", "released", "BUILD_SAFE"]);
    assert.equal(t.hub.runs.getRun(runId).status, "interrupted", "never marked completed, never relaunched");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('starting','running','waiting_approval')"), 0);
  } finally { await t.cleanup(); }
});

test("R9-06 (F3) no suspension when the follow-up proves the lease free or the gate is already suspended; the tick escalates a retained lease nothing follows", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const rec = createLeaseReconciler(t.hub, { subscribe: false });
    // Reaped: the follow-up releases it; the gate stays open.
    const free = retainAtRuntime(t.hub, seedRun(t.hub, { evidence: { environment: { reap: { ok: true, remaining: 0 } } } }), "workspace:r9-free");
    rec.followUp(free, { delaysMs: [5, 10] });
    await waitFor(() => leaseStatus(t, free) === "released", 10000);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(gate(t.hub).status, "open");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'lease.gate_suspended'"), 0);
    // A lease of a run that still looks live is never a reason to close the gate (its own turn ends it).
    const live = retainAtRuntime(t.hub, seedRun(t.hub, { status: "running", evidence: FAILED_REAP }), "workspace:r9-live");
    assert.deepEqual(rec.escalate(live), { suspended: false, reason: "still_held" });
    assert.equal(gate(t.hub).status, "open");
    t.hub.db.prepare("UPDATE leases SET status = 'released', released_at = ?, release_reason = 'test' WHERE id = ?").run(new Date().toISOString(), live);
    // The tick: a retained, unproven lease this reconciler does not follow → the same suspension.
    const stuck = retainAtRuntime(t.hub, seedRun(t.hub, { evidence: FAILED_REAP }), "workspace:r9-tick");
    await rec.tick();
    assert.equal(gate(t.hub).status, "suspended");
    assert.equal(gate(t.hub).suspendedBy.kind, "suspend");
    assert.equal(leaseStatus(t, stuck), "retained");
  } finally { await t.cleanup(); }
  // Already suspended by the owner's Stop All: the stronger record is kept, nothing written.
  const u = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(u.hub);
    u.owner = await enrolOwner(u);
    await u.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${u.owner.session.id}`, ownerSession: u.owner.session });
    const before = gate(u.hub).suspendedBy.id;
    const lease = retainAtRuntime(u.hub, seedRun(u.hub, { evidence: FAILED_REAP }), "workspace:r9-stopped");
    const rec = createLeaseReconciler(u.hub, { subscribe: false });
    const out = rec.escalate(lease);
    assert.deepEqual([out.suspended, out.reason, out.cls], [false, "gate_suspended", "stop_all"]);
    assert.equal(gate(u.hub).suspendedBy.id, before);
    assert.equal(count(u, "SELECT COUNT(*) AS n FROM events WHERE type = 'lease.gate_suspended'"), 0);
  } finally { await u.cleanup(); }
  // The reason's words for several runs.
  assert.match(runtimeLeasesReason([{ run_id: "a", provider: "codex", environment: "wsl-runner" }, { run_id: "b", provider: "claude", environment: "windows", project_name: "X" }]), /^2 execuții s-au încheiat fără să confirme/);
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-07
const fakeSender = (log) => { const s = { track: { id: "raw" }, async replaceTrack(track) { log.push(["replaceTrack", track ? track.id : null]); s.track = track; } }; return s; };
const voiceOn = { gate: { enabled: true, strict: true }, profile: { id: "vp_1" }, verifier: { id: "campplus-local" } };
test("R9-07 (F4) the filter turned on for a session that started WITHOUT it: no filter is started there, the microphone stays muted and the session closes; the toggle text says so", async () => {
  const log = [];
  const sender = fakeSender(log);
  const out = await runGateApply({ sender, rawTrack: { id: "raw" }, gate: null, readState: async () => voiceOn, createGate: async () => assert.fail("no filter for a session the Hub closes"), startedGated: false });
  assert.deepEqual(out, { outcome: "close", text: GATE_LIVE_TEXT.closeUnfiltered });
  assert.equal(sender.track, null, "muted, never the raw microphone");
  assert.deepEqual(log, [["replaceTrack", null]]);
  assert.notEqual(out.text, GATE_LIVE_TEXT.on);
  // A session that started with the filter (then OFF, now ON again) still switches at once.
  const again = await runGateApply({ sender: fakeSender([]), rawTrack: { id: "raw" }, gate: null, readState: async () => voiceOn, createGate: async () => ({ track: { id: "gate" }, close() {} }), startedGated: true });
  assert.equal(again.outcome, "started");
  // The texts: the toggle no longer promises the running session; the closing words match the Hub's own notice.
  assert.doesNotMatch(GATE_TOGGLE_RESULT.on, /Se aplică imediat, și sesiunii Lega care rulează/);
  assert.match(GATE_TOGGLE_RESULT.on, /pornită fără filtru se închide/);
  assert.match(source("server/runtime/lega.mjs"), new RegExp(GATE_LIVE_TEXT.closeUnfiltered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // The panel passes the Hub's flag and closes the session on "close"; the Hub returns the flag with the start.
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /r\.startedGated = typeof result\.gated === "boolean" \? result\.gated : Boolean\(gate\);/);
  assert.match(panel, /same, startedGated: r\.startedGated === true \}\);/);
  assert.match(panel, /if \(out\.outcome === "close"\) \{ if \(same\(\)\) \{ sessionLine\(out\.text\); await stop\("voice-gate-enabled"\); \} return; \}/);
  assert.match(source("server/runtime/lega.mjs"), /authority: current\.authority, gated: Boolean\(current\.gated\) \};/);
  // The Hub's start answer carries the flag (a session started with the filter off → false; the panel then never starts it live).
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const { LEGA_CONSENT_VERSION } = await import("../server/policy/lega-policy.mjs");
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.refreshCodexConfig();
    const LEGA_OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
    const started = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session, payload: { sdp: LEGA_OFFER } })).result;
    assert.equal(started.gated, false, JSON.stringify(Object.keys(started)));
    assert.equal(t.hub.lega.state().gated, false);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-08
test("R9-08 (F6) no Lega or cockpit surface shows or says the raw wait reason: the server labels equal the web's; the cockpit's „De ce e blocat?” uses them", async () => {
  for (const reason of FACTORY_WAIT_REASONS) for (const stage of [undefined, "BLOCKED", "SPEC_DRAFT", "IMPLEMENTING"]) {
    assert.equal(factoryWaitText(reason, stage), factoryWaitLabel(reason, stage), `${reason}/${stage}`);
  }
  assert.equal(factoryWaitText("retry"), "Tura a depășit limita pe tură; o reiau automat o singură dată, după cel puțin un minut (Pauză și Stop rămân disponibile)");
  assert.equal(factoryWaitText("something_new"), null, "an unknown value is never printed");
  assert.equal(factoryWaitText(null), null);
  assert.equal(factoryWaitSuffix("retry", "IMPLEMENTING"), ` · ${factoryWaitLabel("retry")}`);
  assert.equal(factoryWaitSuffix("something_new"), "");
  assert.equal(factoryWaitSuffix(""), "");
  // Source: no template interpolates a bare waitReason on the Lega / cockpit surfaces.
  const RAW = /\$\{\s*[\w.?]*waitReason\s*(?:\|\|\s*"[^"]*")?\s*\}/;
  for (const rel of ["web/src/screens/lega/cards.jsx", "web/src/screens/Lega.jsx", "server/owner/cockpit.mjs", "server/runtime/lega.mjs"]) assert.doesNotMatch(source(rel), RAW, rel);
  assert.match(source("server/runtime/lega.mjs"), /const waits = factoryWaitText\(factory\.waitReason, factory\.stage\);/);
  // The cockpit's answer for a mission waiting for its automatic retry.
  const t = await makeTestHub({ queues: true });
  try {
    fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-r9-wait");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Factory Demo R9 wait" })).result;
    const { demoSpec } = await import("../server/factory/fixtures.mjs");
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    t.hub.db.prepare("UPDATE factory_missions SET wait_reason = 'retry' WHERE mission_id = ?").run(mission.id);
    const why = t.hub.cockpit.whyBlocked({ missionId: mission.id });
    assert.match(why.items[0].what, /\(Tura a depășit limita pe tură; o reiau automat o singură dată/);
    assert.doesNotMatch(why.items[0].what, /\bretry\b/);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-09
test("R9-09 (F7) a face heard by voice while the Lega screen is not on display: the view is stored and the Lega screen opens for a face or the core; on the cockpit the cockpit applies it", () => {
  const ev = (intent, sessionId = "lgs_a") => ({ type: "lega.face", sessionId, command: faceCommand([{ intent }]) });
  assert.deepEqual(faceElsewhere(ev("face_show"), "lgs_a", { onCockpit: false }), { prefs: [["lega.face", "FACE"], ["lega.faceHidden", false]], navigate: "/lega" });
  assert.deepEqual(faceElsewhere(ev("face_core"), "lgs_a"), { prefs: [["lega.face", "CORE"], ["lega.faceHidden", false]], navigate: "/lega" });
  assert.deepEqual(faceElsewhere(ev("face_hide"), "lgs_a"), { prefs: [["lega.faceHidden", true]], navigate: null });
  assert.deepEqual(faceElsewhere(ev("face_discreet"), "lgs_a"), { prefs: [["lega.discreet", true]], navigate: null });
  assert.deepEqual(faceElsewhere(ev("show_company"), "lgs_a"), { prefs: [["lega.face", "GRAPH"], ["lega.faceHidden", false]], navigate: null }, "the company map has its own view");
  assert.equal(faceElsewhere(ev("face_show"), "lgs_a", { onCockpit: true }), null, "the cockpit applies it itself");
  assert.equal(faceElsewhere(ev("face_show", "lgs_b"), "lgs_a"), null, "another session's face never moves this tab");
  assert.equal(faceElsewhere({ type: "lega.face", sessionId: "lgs_a", command: { shape: "EVIL", hidden: false } }, "lgs_a"), null);
  for (const hash of ["#/studio", "#/projects", "#/lega/setup", "#/company-map"]) assert.equal(isCockpitHash(hash), false, hash);
  for (const hash of ["", "#/", "#/lega", "#/lega/prj_1"]) assert.equal(isCockpitHash(hash), true, hash);
  // The panel stores the preferences under the cockpit's own keys (usePref: "hub.v2.<key>", JSON) and opens the screen.
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /const fx = faceElsewhere\(e, sid, \{ onCockpit: isCockpitHash\(window\.location\.hash\) \}\);/);
  assert.match(panel, /localStorage\.setItem\(`hub\.v2\.\$\{key\}`, JSON\.stringify\(value\)\)/);
  assert.match(panel, /if \(fx\.navigate\) \{ go\(fx\.navigate\); setAnnounce\("Lega își arată fața pe ecranul Lega\."\); \}/);
  assert.match(source("web/src/store.js"), /localStorage\.getItem\(`hub\.v2\.\$\{key\}`\)/);
  const cockpit = source("web/src/screens/Lega.jsx");
  for (const key of ["lega.face", "lega.faceHidden", "lega.discreet"]) assert.match(cockpit, new RegExp(`usePref\\("${key.replace(".", "\\.")}"`), key);
});

// ------------------------------------------------------------------------------------------------------------------------------ R9-10
const INTENTS_PATH = fileURLToPath(new URL("../server/owner/intents.mjs", import.meta.url));
const EFFECT_CLASS_URL = pathToFileURL(fileURLToPath(new URL("../server/policy/effect-class.mjs", import.meta.url))).href;
let mutationN = 0;
async function intentsWith(...pairs) {
  let changed = fs.readFileSync(INTENTS_PATH, "utf8");
  for (const [find, replace] of pairs) {
    assert.ok(changed.includes(find), `the mutation must apply: ${find.slice(0, 100)}`);
    changed = changed.replace(find, replace);
  }
  changed = changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(EFFECT_CLASS_URL)}`);
  const tmp = path.join(os.tmpdir(), `ifrim-r9-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(tmp, changed);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const intents = (mod, text) => stepsOf(mod, text).map((s) => s.intent);
test("R9-10 mutation checks: each new intents.mjs guard, broken alone, brings its defect back", async () => {
  // F1: a contrast word no longer opens a part → „Nu mai repara nimic dar oprește tot” is a negated stop again (no Stop All).
  const noContrastPart = await intentsWith(["const PART = /\\s*[,;:]\\s*|\\s+-\\s+|\\s+(?=(?:dar|insa|ci)\\s)/;", "const PART = /\\s*[,;:]\\s*|\\s+-\\s+/;"]);
  assert.ok(!intents(noContrastPart, "Nu mai repara nimic dar oprește tot").includes("stop_all"));
  // F1: the negation read across the whole clause again → „Nu, bre oprește tot” answers „nu opresc nimic”.
  const wideNegation = await intentsWith(["if (NEGATION.test(v >= 0 ? vPart.slice(0, v) : vPart)) return \"negation\";", "if (NEGATION.test(s.slice(0, Math.max(0, s.search(form.verb))))) return \"negation\";"]);
  assert.deepEqual(intents(wideNegation, "Nu, bre oprește tot"), ["explain_stop"]);
  // F1: without the split guard the negated request becomes a step of its own next to the stop (the review's defect).
  const noSplitGuard = await intentsWith(["if (rm && INTERRUPT_INTENTS.has(rm.intent) && lm && negatedRequest(lm.intent, l)) continue;", ""]);
  assert.ok(intents(noSplitGuard, "Nu mai deschide ProDelivery, dar oprește tot").includes("open_project"));
  // F1: without the negation check of the cut words, the negated request is kept next to the negated stop.
  const keepNegated = await intentsWith(["const other = said && !negatedRequest(said.intent, rest) ? said : null;", "const other = said;"]);
  assert.ok(intents(keepNegated, "Nu mai deschide ProDelivery, nu opri tot").includes("open_project"));
  // F1: without the check of the clause's own match, a one-part negated request is kept.
  const keepFound = await intentsWith(["if (found && !INTERRUPT_INTENTS.has(found.intent) && negatedRequest(found.intent, t)) found = null;", ""]);
  assert.ok(intents(keepFound, "Nu mai deschide ProDelivery nu opri tot").includes("open_project"));
  // F1: without the contrast separators „Repară testul de login, dar oprește tot” loses the request again.
  const noContrastSplit = await intentsWith(["/\\s*,\\s*(?:(?:si|dar|insa|ci)\\s+)?|\\s+(?:si|dar|insa|ci)\\s+/g", "/\\s*,\\s*(?:si\\s+)?|\\s+si\\s+/g"]);
  assert.deepEqual(intents(noContrastSplit, "Repară testul de login, dar oprește tot"), ["stop_all"]);
  // F1: „oprește doar Codex” is no worker stop without „doar / numai”.
  const noOnly = await intentsWith(["[\"stop_worker\", /\\bopreste (?:(?:doar|numai) )?(?<who>", "[\"stop_worker\", /\\bopreste (?<who>"]);
  assert.ok(!intents(noOnly, "Deschide ProDelivery, nu opri tot, oprește doar Codex").includes("stop_worker"));
  // F1: the partial answer: without it the owner hears „nu opresc nimic” while Codex is stopped.
  const noPartial = await intentsWith(["s.args = { ...s.args, partial: true };", "void 0;"]);
  assert.equal(stepsOf(noPartial, "Nu opri tot, oprește doar Codex").find((s) => s.intent === "explain_stop").args.partial, undefined);
  // F5: without the inline cut the project reference carries the stop words and no answer is given.
  const noInline = await intentsWith(["const rest = withoutStopTalk(t) ?? inlineRequest(t);", "const rest = withoutStopTalk(t);"]);
  const polluted = stepsOf(noInline, "Deschide ProDelivery după ce oprești tot");
  assert.match(polluted[0].args.projectRef, /opresti tot/);
  assert.ok(!polluted.some((s) => s.intent === "explain_stop"));
  // F5: without the second read the conditional stop next to a request is silent again.
  const noAlso = await intentsWith(["if (rest && mood !== \"negation\") also.alsoExplain = { mood, about: intent };", ""]);
  assert.deepEqual(intents(noAlso, "Deschide ProDelivery, ieri am zis oprește tot"), ["open_project"]);
  // F5: without dropping the condition part, the stop's condition is read as a request (a test read).
  const keepCondition = await intentsWith(["const kept = parts.filter((p) => !STOP_MENTION.test(p) && !STOP_COND_LEAD.test(softTrim(p)));", "const kept = parts.filter((p) => !STOP_MENTION.test(p));"]);
  assert.ok(intents(keepCondition, "Oprește tot dar doar dacă pică testele").includes("show_tests"));
});
