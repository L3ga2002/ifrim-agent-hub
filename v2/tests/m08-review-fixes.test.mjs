// Milestone 08 — regressions for the pre-commit adversarial review (24 read-only agents, findings verified independently).
// Each test reproduces one confirmed defect and checks the fix: autopilot rejection, forget without confirmation, board carry-over,
// decrease scenarios, unconfirmed incidents as blockers, session keep-alive, the armed window over HTTP, objective plans shown,
// python unittest in the environment runner, relocation rollback with a WAL, owner channel for factory.prepare, the B4 pilot.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants, tempDir } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
// M09: every factory mission names its models explicitly (without them it is a draft whose scope is incomplete).
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
import { enrolVoice, startDerivedLega } from "./voice-helpers.mjs";
import { activeLessons } from "../server/runtime/prompt.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { parseTestOutput, testStatus, commandArgv } from "../server/factory/runner.mjs";
import { wslCommandArgv } from "../server/environments/wsl-factory-runner.mjs";
import { setExtraCommands } from "../server/factory/spec.mjs";
import { openDatabase } from "../server/storage/db.mjs";
import { apply, rollback } from "../scripts/relocate-data.mjs";
import { TEST_PROJECT_MARKER } from "../server/domain/projects.mjs";
import { PILOT_ACCEPTANCE_PATH, PILOT_ACCEPTANCE_SOURCE } from "../server/intel/pilot-acceptance.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];

async function objectiveHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  fs.mkdirSync(path.join(dir, "acceptance"), { recursive: true });
  fs.writeFileSync(path.join(dir, "acceptance", "limits.mjs"), `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { nameTooLong } from "../src/limits.js";\ntest("AC-1", () => { assert.equal(nameTooLong("x".repeat(81)), true); });\n`);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const bug = demoSpec("bug-demo");
  const input = { projectId: project.id, title: "Două sarcini", criteria: ["ok"], models: { writer: { model: "gpt-fake-sol" }, reviewer: { model: "sonnet" } }, tasks: [
    { key: "t1", title: bug.title, workType: "BUGFIX", objective: bug.objective, inScope: bug.spec.inScope, acceptance: bug.spec.acceptance, verification: bug.spec.verification },
    { key: "t2", title: "Limită nume", workType: "FEATURE", objective: "Detectarea numelui prea lung, cu test.", dependsOn: ["t1"], inScope: ["src/limits.js"], acceptance: [{ id: "AC-1", text: "Numele lung e detectat", verify: "test", testRef: "acceptance/limits.mjs" }], verification: { checks: ["node --test"], acceptance: ["node --test acceptance/limits.mjs"] } },
  ] };
  return { ...t, project, owner, input };
}

test("M08-RF-01 rejecting a delivered task while the next one runs closes the plan and pauses the dependent task; the objective is not 'stopped' while authority is open; amend waits", async () => {
  const t = await objectiveHub();
  try {
    // The owner's real session (channel owner) prepares: factory.prepare must accept the owner channel (review M08).
    const o = (await dispatch(t.hub, "autopilot.draft", t.input)).result;
    await t.hub.commands.dispatch({ type: "autopilot.prepare", channel: "owner", actor: "owner:t", ownerSession: t.owner.session, payload: { objectiveId: o.id } });
    const { plan } = (await dispatch(t.hub, "autopilot.propose", { objectiveId: o.id }, { ownerSession: t.owner.session })).result;
    const [m1, m2] = plan.envelope.missionIds;
    t.queue("codex", "factory-write:bug-fix", "hang");
    t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: plan.envelope.id, nonce: plan.envelope.nonce, displayedHash: plan.envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => t.hub.factory.view(m1).factory.stage === "DELIVERY_READY", 120000, 100);
    await waitFor(() => !["SPEC_DRAFT"].includes(t.hub.factory.view(m2).factory.stage), 30000, 100);
    assert.equal(t.hub.autopilot.view(o.id).status, "RUNNING");
    await assert.rejects(dispatch(t.hub, "autopilot.amend", { objectiveId: o.id, changes: { title: "x y z" } }), /rulează/);
    await dispatch(t.hub, "factory.reject", { missionId: m1, note: "nu e bun" });
    const closed = await waitFor(() => (t.hub.envelopes.get(plan.envelope.id).status === "CANCELLED" ? t.hub.envelopes.view(plan.envelope.id) : null), 30000, 50);
    assert.match(closed.closeReason, /sarcină anterioară/);
    assert.ok(t.hub.grants.ofEnvelope(plan.envelope.id).every((g) => g.status !== "active"));
    await waitFor(() => ["PAUSED", "CANCELLED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(t.hub.factory.view(m2).factory.stage), 30000, 100);
    assert.equal(t.hub.autopilot.view(o.id).status, "STOPPED");
    // A dependent task built on a rejected one cannot be offered again as if nothing happened.
    await dispatch(t.hub, "system.stop_all", { reason: "test" });
  } finally { await t.cleanup(); }
});

test("M08-RF-02 'Uită regula' keeps the rule in worker prompts until the owner confirms; the proposal can be cancelled", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const pid = t.hub.projects.hub().id;
    const l = (await dispatch(t.hub, "lesson.propose", { text: "La livrare verifică mobilul și formularele", source: "typed", scope: "PROJECT", projectId: pid })).result;
    await dispatch(t.hub, "lesson.confirm", { lessonId: l.lesson.id }, { ownerSession: owner.session });
    assert.equal(activeLessons(t.hub.db, pid).length, 1);
    // A forget proposal from Lega's voice (no session): the rule still applies.
    const f = await t.hub.commands.dispatch({ type: "lesson.forget", channel: "voice", actor: "lega", payload: { ref: "mobilul formularele" } }).then((r) => r.result);
    assert.equal(f.matches[0].status, "FORGET_PROPOSED");
    assert.equal(activeLessons(t.hub.db, pid).length, 1, "a proposal does not take the rule out");
    assert.equal(t.hub.teach.rulesFor({ projectId: pid }).length, 1);
    const kept = (await dispatch(t.hub, "lesson.forget.cancel", { lessonId: l.lesson.id })).result;
    assert.equal(kept.status, "ACTIVE");
    await dispatch(t.hub, "lesson.forget", { lessonId: l.lesson.id });
    await dispatch(t.hub, "lesson.forget.confirm", { lessonId: l.lesson.id }, { ownerSession: owner.session });
    assert.equal(activeLessons(t.hub.db, pid).length, 0, "only the confirmation removes it");
  } finally { await t.cleanup(); }
});

test("M08-RF-03 a deferred board item is carried once; decided in the next meeting, it never comes back", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const pid = t.hub.projects.hub().id;
    t.hub.bus.transaction(() => t.hub.db.prepare("INSERT INTO decisions (id, project_id, title, decision, rationale, source_ref, author, status, created_at) VALUES ('dec_rf', ?, 'Ciornă RF', 'De decis', '', 'x', 'owner', 'draft', ?)").run(pid, new Date().toISOString()));
    const m1 = (await dispatch(t.hub, "board.open", {})).result;
    const item = m1.items.find((i) => i.kind !== "info");
    await dispatch(t.hub, "board.decide", { itemId: item.id, decision: "defer" });
    await dispatch(t.hub, "board.close", { meetingId: m1.id });
    const m2 = (await dispatch(t.hub, "board.open", {})).result;
    const carried = m2.items.find((i) => i.carriedFrom === item.id);
    assert.ok(carried);
    await dispatch(t.hub, "board.decide", { itemId: carried.id, decision: "decide" }, { ownerSession: owner.session });
    await dispatch(t.hub, "board.close", { meetingId: m2.id });
    const m3 = (await dispatch(t.hub, "board.open", {})).result;
    assert.equal(m3.items.filter((i) => i.carriedFrom === item.id || i.carriedFrom === carried.id).length, 0, "decided → not carried again");
  } finally { await t.cleanup(); }
});

test("M08-RF-04 intents: decreases are never guessed into numbers; interruptions beat a teach prefix; a question is not a lesson; 'de ieri' means yesterday", async () => {
  const one = (s) => resolveIntent(s, {}).steps[0];
  for (const s of ["Ce se întâmplă dacă pierdem doi clienți?", "Ce se întâmplă dacă un client renunță?", "Ce se întâmplă dacă amânăm un proiect?", "Ce se întâmplă dacă lucrăm cu 10 ore pe săptămână mai puțin?"]) {
    const st = one(s); assert.equal(st.intent, "simulate", s); assert.equal(st.args.unsupported, true, s); assert.equal(st.args.newProjects, undefined, s);
  }
  const h = one("Ce se întâmplă dacă luăm 2 clienți cu 30 de ore pe săptămână în 4 săptămâni?");
  assert.deepEqual([h.args.newProjects, h.args.capacityHoursPerWeek, h.args.horizonWeeks], [2, 30, 4]);
  assert.equal(one("De acum oprește tot").intent, "stop_all");
  assert.equal(one("Ține minte, pune pauză").intent, "pause");
  assert.notEqual(one("De acum înainte ce faci?").intent, "teach");
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const pid = t.hub.projects.hub().id;
    const out = (await dispatch(t.hub, "owner.intent", { text: "Ce se întâmplă dacă pierdem doi clienți?", projectId: pid }, { ownerSession: owner.session, channel: "owner" })).result;
    assert.match(out.results[0].message, /nu le ghicesc/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM simulations").get().n, 0, "no invented scenario");
    t.hub.bus.transaction(() => t.hub.db.prepare("INSERT INTO owner_visits (project_id, last_seen_at, last_seq) VALUES (?, ?, 0)").run(pid, new Date().toISOString()));
    const ch = (await dispatch(t.hub, "owner.intent", { text: "Ce s-a schimbat de ieri?", projectId: pid }, { ownerSession: owner.session, channel: "owner" })).result;
    assert.equal(ch.results[0].changes.sinceSource, "explicit", "since yesterday, not since the last visit");
  } finally { await t.cleanup(); }
});

test("M08-RF-05 an unconfirmed incident is shown for attention, never as a blocker", async () => {
  const t = await makeTestHub();
  try {
    const pid = t.hub.projects.hub().id;
    t.hub.bus.transaction(() => t.hub.settings.set("projectFreeze", {}, "test"));
    await dispatch(t.hub, "incident.propose", { projectId: pid, text: "Nu merge login-ul" });
    const b = t.hub.twin.blocked(pid);
    const inc = b.chain.find((c) => /Incident deschis/.test(c.what));
    assert.equal(inc.kind, "attention");
    assert.match(inc.why, /neconfirmat/);
    assert.equal(b.chain.filter((c) => c.kind === "blocker").length > 0, b.blocked, "blocked only by real blockers");
  } finally { await t.cleanup(); }
});

async function httpHub(opts = {}) {
  const t = await makeTestHub(opts);
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = "", headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, call, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("M08-RF-06 HTTP: reads never extend the owner session; a malformed cookie never breaks the phone route; owner-only writes without a session ask for Windows Hello; the pairing code is masked in the log", async () => {
  const s = await httpHub();
  try {
    const owner = await enrolOwner(s);
    const cookie = `ifrim_owner=${owner.token}`;
    const seen = () => s.hub.db.prepare("SELECT last_seen_at FROM owner_sessions WHERE id = ?").get(owner.session.id).last_seen_at;
    const before = seen();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await s.call("GET", "/api/m/state", { cookie })).status, 200);
    assert.equal(seen(), before, "a poll does not keep the session alive");
    assert.equal((await s.call("POST", "/api/m/command", { cookie: "x=%; ifrim_device=%E0%A4%A", body: { type: "stop_all" } })).status, 401, "a bad cookie is a refusal, not a 500");
    const locked = await s.call("POST", "/api/devices/pairing", { body: {} });
    assert.equal(locked.status, 401);
    assert.equal(locked.json.error.details?.needSession, true);
    const p = await s.call("POST", "/api/devices/pairing", { cookie, body: {} });
    assert.match(p.json.code, /^\d{6}$/);
    const logged = s.hub.db.prepare("SELECT result_json FROM commands WHERE type = 'device.pairing.start' ORDER BY created_at DESC").get();
    assert.doesNotMatch(String(logged.result_json), new RegExp(p.json.code), "the code is not in the command log");
  } finally { await s.stop(); }
});

test("M08-RF-07 HTTP: /api/owner/intent forwards the Lega session, so a plan shown in Lega arms the voice window; an objective plan is shown as the decision card", async () => {
  const s = await httpHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(s.hub);
    const dir = path.join(s.dataDir, "factory-arm");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(s.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(s, { activatePolicy: true });
    await enrolVoice(s, owner);
    await dispatch(s.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
    await dispatch(s.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    await dispatch(s.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    // M10.2 U13: the forwarded id must be the LIVE Lega session derived from this owner session (a bare id arms nothing).
    const legaHttp = await startDerivedLega(s, owner);
    const r = await s.call("POST", "/api/owner/intent", { cookie: `ifrim_owner=${owner.token}`, body: { text: "Arată-mi planul", projectId: project.id, legaSessionId: legaHttp } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.results[0].armed.armed, true, r.json.results[0].armed.reason);
    // objective_plan → the layout carries the DecisionCard of the new plan.
    const step = { intent: "objective_plan", args: { envelopeId: "env_x" } };
    const { layoutForIntent } = await import("../server/owner/layout.mjs");
    const next = layoutForIntent(step, { project: { id: project.id }, running: { missions: [] }, readyForReview: [], blocked: [], open: [] }, { cards: [] });
    assert.equal(next.cards[0].type, "DecisionCard");
  } finally { await s.stop(); }
});

test("M08-RF-08 python3 -m unittest: mapped in the environment runner only when allowed, refused with a reason on Windows, and its output is parsed (stderr included)", () => {
  setExtraCommands([]);
  assert.equal(wslCommandArgv("python3 -m unittest backend/tests/test_a.py", {}), null, "not allowed by default");
  setExtraCommands(["python-unittest"]);
  try {
    assert.deepEqual(wslCommandArgv("python3 -m unittest backend/tests/test_a.py", {}), ["/usr/bin/python3", "-m", "unittest", "-v", "backend/tests/test_a.py"]);
    assert.equal(wslCommandArgv("python3 -m unittest ../x.py", {}), null);
    assert.equal(commandArgv("python3 -m unittest backend/tests/test_a.py"), null, "no Windows mapping (refused with a reason by the runner)");
    const ok = parseTestOutput(["[stderr] test_a (t.T.test_a) ... ok", "[stderr] Ran 1 test in 0.001s", "[stderr] ", "[stderr] OK"]);
    assert.equal(testStatus({ exitCode: 0, counts: ok.counts }).status, "PASS");
    const bad = parseTestOutput(["[stderr] test_b (t.T.test_b) ... FAIL", "[stderr] Ran 2 tests in 0.001s", "[stderr] FAILED (failures=1)"]);
    assert.deepEqual([bad.counts.tests, bad.counts.fail], [2, 1]);
    assert.deepEqual(bad.failures, ["test_b (t.T.test_b)"]);
  } finally { setExtraCommands([]); }
});

test("M08-RF-09 relocation rollback sees rows still in the WAL, refuses when the old database is gone, and --copy-back always brings the current data back", async () => {
  const root = tempDir("reloc-rf");
  const loc = { source: "test", dataDir: path.join(root, "old", "private"), backupDir: path.join(root, "old", "b"), workDir: path.join(root, "old", "w"), dataRoot: null };
  for (const d of [loc.dataDir, loc.backupDir, loc.workDir]) fs.mkdirSync(d, { recursive: true });
  const db0 = openDatabase(path.join(loc.dataDir, "hub-v2.sqlite"));
  db0.prepare("INSERT INTO backups (id, project_id, reason, status, created_at) VALUES ('bkp_before', 'p', 'r', 's', 't')").run();
  db0.close();
  const pointer = path.join(root, "data-location.json");
  const target = path.join(root, "new");
  await apply({ location: loc, target, test: true, port: 1, locationFile: pointer, hubRoot: root });
  // A Hub that exits without closing leaves committed rows in the WAL (simulated by a child that never closes its connection).
  const newDb = path.join(target, "private", "hub-v2.sqlite");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import { DatabaseSync } from "node:sqlite"; const d = new DatabaseSync(${JSON.stringify(newDb)}); d.exec("PRAGMA journal_mode=WAL"); d.exec("PRAGMA wal_autocheckpoint=0"); d.prepare("INSERT INTO backups (id, project_id, reason, status, created_at) VALUES ('bkp_after', 'p', 'r', 's', 't')").run(); process.exit(0);`], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  await assert.rejects(rollback({ port: 1, locationFile: pointer, hubRoot: root }), /s-a schimbat după mutare/, "the WAL rows count as a change");
  const out = await rollback({ copyBack: true, port: 1, locationFile: pointer, hubRoot: root });
  assert.equal(out.copiedBack, true);
  const back = new DatabaseSync(path.join(loc.dataDir, "hub-v2.sqlite"), { readOnly: true });
  assert.deepEqual(back.prepare("SELECT id FROM backups ORDER BY id").all().map((r) => r.id), ["bkp_after", "bkp_before"]);
  back.close();
  // Old database removed after a move: a plain rollback is refused (the Hub would start on an empty database).
  const root2 = tempDir("reloc-rf2");
  const loc2 = { source: "test", dataDir: path.join(root2, "old", "private"), backupDir: path.join(root2, "old", "b"), workDir: path.join(root2, "old", "w"), dataRoot: null };
  for (const d of [loc2.dataDir, loc2.backupDir, loc2.workDir]) fs.mkdirSync(d, { recursive: true });
  openDatabase(path.join(loc2.dataDir, "hub-v2.sqlite")).close();
  const pointer2 = path.join(root2, "data-location.json");
  await apply({ location: loc2, target: path.join(root2, "new"), test: true, port: 1, locationFile: pointer2, hubRoot: root2 });
  for (const f of fs.readdirSync(loc2.dataDir).filter((n) => n.startsWith("hub-v2.sqlite"))) fs.rmSync(path.join(loc2.dataDir, f));
  await assert.rejects(rollback({ port: 1, locationFile: pointer2, hubRoot: root2 }), /nu mai are baza/);
});

test("M08-RF-10 package B4: the owner's decision writes only the independent acceptance test, routes the pilot to wsl-runner, enables python unittest and prepares a complete draft mission (nothing runs)", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const owner = await enrolOwner(t);
    // A synthetic "ProDelivery" test project (never the real one): the module path the pilot names, nothing else.
    const dir = path.join(t.dataDir, "prodelivery");
    fs.mkdirSync(path.join(dir, "backend", "utils"), { recursive: true });
    fs.writeFileSync(path.join(dir, "backend", "utils", "driver_ranking.py"), "def get_tier_for_score(s):\n    return 'gold' if s >= 10 else 'silver'\n");
    fs.writeFileSync(path.join(dir, TEST_PROJECT_MARKER), JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name: "ProDelivery" }));
    const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "ProDelivery" })).result;
    assert.equal(project.slug, "prodelivery");
    const d = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: "owner:t", ownerSession: owner.reauth(), ...extra }).then((r) => r.result);
    const a = await d("package.present", { kind: "A" });
    await d("package.decide", { packageId: a.id, decisions: { A1: "reject", A2: "reject", A3: "approve" } });
    const b = await d("package.present", { kind: "B" });
    assert.deepEqual(b.blockedBy, []);
    assert.match(b.options.find((o) => o.key === "B4").changes.join(" "), /un singur fișier: testul de acceptanță/);
    const decided = await d("package.decide", { packageId: b.id, decisions: { B1: "approve", B2: "approve", B3: "approve", B4: "approve" } });
    assert.deepEqual(decided.applied.sort(), ["B1", "B2", "B3", "B4"]);
    assert.equal(fs.readFileSync(path.join(dir, PILOT_ACCEPTANCE_PATH), "utf8"), PILOT_ACCEPTANCE_SOURCE);
    assert.equal(t.hub.environments.routeFor(project.id, "codex"), "wsl-runner");
    assert.ok(t.hub.settings.get("factoryExtraCommands").includes("python-unittest"));
    const mission = t.hub.db.prepare("SELECT m.id FROM missions m JOIN factory_missions fm ON fm.mission_id = m.id WHERE m.project_id = ?").get(project.id);
    let v = t.hub.factory.view(mission.id);
    assert.equal(v.factory.stage, "SPEC_DRAFT");
    assert.equal(v.spec.protected?.problems?.length || 0, 0, `the spec is complete: ${JSON.stringify(v.spec?.protected?.problems || [])}`);
    // M09: the pilot carries the package's models explicitly (M08 promised them in text only and the reviewer ran on the default).
    assert.deepEqual([v.factory.limits.writerModel, v.factory.limits.writerEffort, v.factory.limits.reviewerModel, v.factory.limits.reviewerEffort], ["gpt-6.1-sol", "medium", "sonnet", "medium"]);
    assert.match(b.options.find((o) => o.key === "B4").changes.join(" "), /modele: Codex gpt-6\.1-sol · medium \(abonament\); Claude sonnet · medium \(abonament\)/);
    // With the routes' provider facts (the writer's model/list in wsl-runner lists gpt-6.1-sol; Claude inspected) the scope is complete
    // and binds exactly those models — nothing ran to learn them.
    const ctx = (provider) => t.hub.runs.bindingContext(project.id, provider);
    t.hub.providerState.set(ctx("codex").stateKey, { ...(ctx("codex").providerState || {}), models: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: false, efforts: ["low", "medium", "high"] }, { id: "gpt-fake-sol", model: "gpt-fake-sol", isDefault: true, efforts: ["medium"] }] });
    t.hub.providerState.set(ctx("claude").stateKey, { ...(ctx("claude").providerState || {}), installation: { installed: true, version: "2.1.175 (Claude Code)", flags: ["--effort", "--model"] } });
    v = t.hub.factory.view(mission.id);
    assert.ok(v.scope, `scope: ${JSON.stringify(v.scopeProblems)}`);
    assert.deepEqual([v.scope.bindings.writer.resolvedAlias, v.scope.bindings.writer.environment, v.scope.bindings.reviewer.resolvedAlias, v.scope.bindings.reviewer.effort], ["gpt-6.1-sol", "wsl-runner", "sonnet", "medium"]);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing runs");
    assert.equal(t.hub.packages.view(b.id).options.find((o) => o.key === "B4").state, "EXECUTED");
    // A draft whose models differ from the package's is not "executed": B4 waits; deciding B4 again puts the package's models back.
    await d("factory.limits", { missionId: mission.id, limits: { reviewerModel: "" } });
    assert.equal(t.hub.packages.view(b.id).options.find((o) => o.key === "B4").state, "APPROVED_PENDING_EXECUTION");
    const b2 = await d("package.present", { kind: "B" });
    const again = await d("package.decide", { packageId: b2.id, decisions: { B1: "approve", B2: "approve", B3: "approve", B4: "approve" } });
    assert.ok(again.applied.includes("B4"));
    assert.equal(t.hub.factory.view(mission.id).factory.limits.reviewerModel, "sonnet");
    assert.equal(t.hub.packages.view(b2.id).options.find((o) => o.key === "B4").state, "EXECUTED");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM missions m JOIN factory_missions fm ON fm.mission_id = m.id WHERE m.project_id = ?").get(project.id).n, 1, "the same draft, not a second mission");
  } finally { setExtraCommands([]); await t.cleanup(); }
});

// ---------- round 2 (verification of the fixes) ----------

test("M08-RF-11 rejecting an earlier task that the running one does NOT depend on leaves the running task and the plan alone", async () => {
  const t = await objectiveHub();
  try {
    const input = { ...t.input, title: "Două sarcini independente", tasks: [t.input.tasks[0], { ...t.input.tasks[1], key: "t2", dependsOn: [] }] };
    const o = (await dispatch(t.hub, "autopilot.draft", input)).result;
    await dispatch(t.hub, "autopilot.prepare", { objectiveId: o.id }, { ownerSession: t.owner.session });
    const { plan } = (await dispatch(t.hub, "autopilot.propose", { objectiveId: o.id }, { ownerSession: t.owner.session })).result;
    const [m1, m2] = plan.envelope.missionIds;
    t.queue("codex", "factory-write:bug-fix", "hang");
    t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: plan.envelope.id, nonce: plan.envelope.nonce, displayedHash: plan.envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => t.hub.factory.view(m1).factory.stage === "DELIVERY_READY", 120000, 100);
    await waitFor(() => t.hub.factory.view(m2).factory.stage !== "SPEC_DRAFT", 30000, 100);
    await dispatch(t.hub, "factory.reject", { missionId: m1, note: "respins în test" });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(t.hub.envelopes.get(plan.envelope.id).status, "ACTIVE", "an independent task keeps its plan");
    assert.notEqual(t.hub.factory.view(m2).factory.stage, "PAUSED");
    await dispatch(t.hub, "system.stop_all", { reason: "test" });
  } finally { await t.cleanup(); }
});

test("M08-RF-12 a new objective plan never starts a task whose dependency is only paused or blocked", async () => {
  const t = await objectiveHub();
  try {
    const o = (await dispatch(t.hub, "autopilot.draft", t.input)).result;
    await dispatch(t.hub, "autopilot.prepare", { objectiveId: o.id }, { ownerSession: t.owner.session });
    const { plan } = (await dispatch(t.hub, "autopilot.propose", { objectiveId: o.id }, { ownerSession: t.owner.session })).result;
    const [m1] = plan.envelope.missionIds;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: plan.envelope.id, nonce: plan.envelope.nonce, displayedHash: plan.envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => t.hub.db.prepare("SELECT 1 FROM agent_runs WHERE status IN ('running','starting')").get(), 30000, 100);
    await dispatch(t.hub, "factory.pause", { missionId: m1 });
    await waitFor(() => t.hub.factory.view(m1).factory.stage === "PAUSED", 30000, 100);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: plan.envelope.id, reason: "test" }, { ownerSession: t.owner.session });
    await waitFor(() => t.hub.envelopes.get(plan.envelope.id).status === "REVOKED", 10000, 50);
    await assert.rejects(dispatch(t.hub, "autopilot.propose", { objectiveId: o.id }, { ownerSession: t.owner.session }), /depinde de t1/);
    await dispatch(t.hub, "system.stop_all", { reason: "test" });
  } finally { await t.cleanup(); }
});

test("M08-RF-13 lessons round 2: a mentioned interruption stays a lesson; negation only near the verb; inflected confirmations; items keep their own verbs", async () => {
  const { securityParts, parseLesson } = await import("../server/intel/teach.mjs");
  const one = (s) => resolveIntent(s, {}).steps[0];
  assert.equal(one("Ține minte: dacă testele pică, oprește tot").intent, "teach");
  assert.equal(one("Uită regula: oprește tot la erori").intent, "forget");
  assert.equal(one("De acum oprește tot").intent, "stop_all");
  for (const w of ["Fă push fără confirmarea mea", "Nu uita să dai push la final", "Nu fă deploy, dă push pe main", "Urcă pe server după teste", "Trimite factura clientului", "Nu e nevoie de aprobare pentru deploy"]) assert.ok(securityParts(w).length, w);
  for (const ok of ["Nu face niciodată push singur", "Nu publica niciodată direct pe producție", "Nu face deploy fără confirmare", "Nu citi .env"]) assert.deepEqual(securityParts(ok), [], ok);
  assert.deepEqual(parseLesson("Nu face deploy, rulează testele").steps, ["Nu face deploy", "rulează testele"]);
  assert.equal(one("Ce se întâmplă dacă luăm doi clienți, apoi pierdem unul?").args.unsupported, true);
});

test("M08-RF-14 B4 does nothing without B1 and B3: no file in the project, no mission, and it says what is missing", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const owner = await enrolOwner(t);
    const dir = path.join(t.dataDir, "prodelivery");
    fs.mkdirSync(path.join(dir, "backend", "utils"), { recursive: true });
    fs.writeFileSync(path.join(dir, "backend", "utils", "driver_ranking.py"), "def get_tier_for_score(s):\n    return 'gold'\n");
    fs.writeFileSync(path.join(dir, TEST_PROJECT_MARKER), JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name: "ProDelivery" }));
    const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "ProDelivery" })).result;
    const d = (type, payload) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: "owner:t", ownerSession: owner.reauth() }).then((r) => r.result);
    const a = await d("package.present", { kind: "A" });
    await d("package.decide", { packageId: a.id, decisions: { A1: "reject", A2: "reject", A3: "approve" } });
    const b = await d("package.present", { kind: "B" });
    const out = await d("package.decide", { packageId: b.id, decisions: { B1: "reject", B2: "approve", B3: "reject", B4: "approve" } });
    assert.ok(out.applied.some((x) => /B4 neexecutat: lipsește B3.*B1/.test(x)), JSON.stringify(out.applied));
    assert.equal(fs.existsSync(path.join(dir, PILOT_ACCEPTANCE_PATH)), false);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM missions WHERE project_id = ?").get(project.id).n, 0);
  } finally { setExtraCommands([]); await t.cleanup(); }
});

test("M08-RF-15 integrity: a writer-made module that shadows the Python standard library stops the mission; TAP counts win over a stray unittest summary; owner routes survive a malformed cookie", async () => {
  const { integrityFindings } = await import("../server/factory/integrity.mjs");
  const f = integrityFindings({ changes: [{ path: "unittest/__init__.py", status: "added" }, { path: "sitecustomize.py", status: "added" }, { path: "types/index.d.ts", status: "added" }], protectedRefs: [] });
  assert.deepEqual(f.filter((x) => x.severity === "critical").map((x) => x.file).sort(), ["sitecustomize.py", "unittest/__init__.py"]);
  assert.deepEqual(parseTestOutput(["# tests 3", "# pass 3", "# fail 0", "[stderr] Ran 1 test in 0.0s", "[stderr] FAILED (failures=1)"]).counts, { tests: 3, pass: 3, fail: 0 });
  const s = await httpHub();
  try {
    assert.notEqual((await s.call("GET", "/api/owner/status", { cookie: "x=%; ifrim_owner=%E0%A4" })).status, 500);
    assert.notEqual((await s.call("POST", "/api/owner/interrupt", { cookie: "x=%", body: { kind: "mute" } })).status, 500);
  } finally { await s.stop(); }
});

test("M08-RF-16 relocation round 2: an unreadable new database still allows --discard-new and refuses --copy-back", async () => {
  const root = tempDir("reloc-rf16");
  const loc = { source: "test", dataDir: path.join(root, "old", "private"), backupDir: path.join(root, "old", "b"), workDir: path.join(root, "old", "w"), dataRoot: null };
  for (const d of [loc.dataDir, loc.backupDir, loc.workDir]) fs.mkdirSync(d, { recursive: true });
  openDatabase(path.join(loc.dataDir, "hub-v2.sqlite")).close();
  const pointer = path.join(root, "data-location.json");
  const target = path.join(root, "new");
  await apply({ location: loc, target, test: true, port: 1, locationFile: pointer, hubRoot: root });
  fs.writeFileSync(path.join(target, "private", "hub-v2.sqlite"), Buffer.alloc(4096, 0));
  await assert.rejects(rollback({ copyBack: true, port: 1, locationFile: pointer, hubRoot: root }), /nu poate fi citită/);
  await assert.rejects(rollback({ port: 1, locationFile: pointer, hubRoot: root }), /s-a schimbat/);
  const out = await rollback({ discardNew: true, port: 1, locationFile: pointer, hubRoot: root });
  assert.equal(out.ok, true);
  assert.ok(fs.existsSync(path.join(loc.dataDir, "hub-v2.sqlite")));
});
