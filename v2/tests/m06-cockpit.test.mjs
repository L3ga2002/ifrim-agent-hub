// Milestone 06 — project cockpit, explanations, read-only replay, delta briefing, contextual layout, company map,
// interruptions and quiet proactivity / recommendations / shadow reviews. PASS_SIMULATED (fixture providers, test projects).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants, enableLive } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
// M09: every factory mission names its models explicitly (without them it is a draft whose scope is incomplete).
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
import { validateLayout, layoutForIntent, defaultLayout } from "../server/owner/layout.mjs";
import { classifyEvent } from "../server/owner/advisor.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const counts = (hub) => ({ events: hub.bus.lastSeq(), grants: hub.grants.list().length, runs: hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, commands: hub.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n });

async function cockpitHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  return { ...t, project, dir, owner };
}

test("M06-CK-01 the cockpit follows the real states: context → plan ready → running → ready for review; nothing invented", async () => {
  const t = await cockpitHub();
  try {
    let c = await t.hub.cockpit.projectCockpit(t.project.id);
    assert.ok(["CONTEXT_AVAILABLE", "NO_CONTEXT"].includes(c.state.code), c.state.code);
    assert.deepEqual(c.done, [], "no done item without evidence");
    assert.equal(c.running.runs.length, 0);
    assert.equal(c.project.kind, "test");
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    c = await t.hub.cockpit.projectCockpit(t.project.id);
    assert.equal(c.state.code, "PLAN_READY");
    assert.equal(c.next.recommended.kind, "confirm_plan");
    const before = counts(t.hub);
    const opened = (await dispatch(t.hub, "owner.intent", { text: "Hai să lucrăm la Factory Demo bug", projectId: t.project.id }, { ownerSession: t.owner.session })).result;
    assert.ok(opened.results[0].cockpit || opened.resolved.clarification || opened.results[0].message, "opening only reads");
    assert.equal(counts(t.hub).runs, before.runs, "opening a project starts nothing");
    assert.equal(counts(t.hub).grants, before.grants);
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    c = await t.hub.cockpit.projectCockpit(t.project.id);
    assert.ok(["RUNNING", "AUTHORIZED"].includes(c.state.code), c.state.code);
    assert.equal(c.approved.envelopeId, envelope.id, "what you approved is shown apart from what is proposed");
    await waitFor(() => SETTLED.includes(t.hub.factory.view(mission.id).factory.stage), 90000, 100);
    c = await t.hub.cockpit.projectCockpit(t.project.id);
    assert.equal(c.state.code, "READY_FOR_REVIEW");
    assert.equal(c.next.recommended.kind, "review_delivery");
    assert.match(c.next.recommended.text, /Verifică livrarea/);
  } finally { await t.cleanup(); }
});

test("M06-CK-02 replay is READ_ONLY and HISTORICAL: frames from the record, nothing re-executed or granted", async () => {
  const t = await cockpitHub();
  try {
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => SETTLED.includes(t.hub.factory.view(mission.id).factory.stage), 90000, 100);
    await new Promise((r) => setTimeout(r, 300));
    const before = counts(t.hub);
    const replay = t.hub.cockpit.replay(mission.id);
    assert.equal(replay.mode, "READ_ONLY"); assert.equal(replay.historical, true);
    assert.ok(replay.frames.some((f) => f.kind === "evidence" && f.refs.status === "FAIL"), "the baseline failure (bug reproduced) is a frame");
    assert.equal(replay.firstFailure.kind, "evidence");
    assert.ok(replay.frames.some((f) => f.kind === "review"));
    assert.deepEqual(counts(t.hub), before, "replay writes nothing: no event, grant, run or command");
  } finally { await t.cleanup(); }
});

test("M06-CK-03 explanations come from telemetry and records; no estimate without enough measured runs", async () => {
  const t = await cockpitHub();
  try {
    const idle = t.hub.cockpit.status({ projectId: t.project.id });
    assert.equal(idle.idle, true);
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    const why = t.hub.cockpit.whyBlocked({ projectId: t.project.id });
    // M10.2.1 (D14): a suspended gate is reopened in the cockpit (rearm card, Windows Hello), never by a typed OPEN GATE pointer.
    assert.ok(why.items.some((i) => /Poarta/.test(i.what) && /Windows Hello/.test(i.action) && !/OPEN GATE/.test(i.action)), JSON.stringify(why.items));
    const route = t.hub.cockpit.whyRoute({ worker: "claude" });
    assert.equal(route.role, "reviewer"); assert.match(route.reason, /independent/);
    const est = t.hub.cockpit.estimate({ stage: "coding", provider: "codex" });
    assert.equal(est.available, false); assert.match(est.text, /Nu există o estimare suficientă/);
  } finally { await t.cleanup(); }
});

test("M06-CK-04 delta since the last visit counts only what happened after it", async () => {
  const t = await cockpitHub();
  try {
    const first = t.hub.cockpit.delta(t.project.id);
    assert.equal(first.firstVisit, true);
    await dispatch(t.hub, "owner.visit", { projectId: t.project.id });
    assert.equal(t.hub.cockpit.delta(t.project.id).events, 0);
    await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const after = t.hub.cockpit.delta(t.project.id);
    assert.ok(after.events > 0); assert.equal(after.firstVisit, false); assert.match(after.timezoneNote, /UTC/);
  } finally { await t.cleanup(); }
});

test("M06-CK-05 layout: only catalog components and references to this project's data; intents change it deterministically", async () => {
  const t = await cockpitHub();
  try {
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    const exists = (kind, id) => (kind === "mission" ? t.hub.missions.get(id)?.projectId === t.project.id : kind === "project" ? id === t.project.id : false);
    const ok = validateLayout({ cards: [{ type: "TestPanel", ref: { kind: "mission", id: mission.id } }, { type: "ProjectSummary" }] }, { projectId: t.project.id, exists });
    assert.equal(ok.cards.length, 2);
    assert.throws(() => validateLayout({ cards: [{ type: "Html", ref: { kind: "project", id: t.project.id } }] }, { projectId: t.project.id, exists }), /tip necunoscut/);
    assert.throws(() => validateLayout({ cards: [{ type: "TestPanel", ref: { kind: "mission", id: mission.id }, html: "<script>x</script>" }] }, { projectId: t.project.id, exists }), /nepermise/);
    assert.throws(() => validateLayout({ cards: [{ type: "TestPanel", ref: { kind: "mission", id: "mis_aaaaaa_0123456789" } }] }, { projectId: t.project.id, exists }), /inexistent/);
    assert.throws(() => validateLayout({ cards: Array.from({ length: 9 }, () => ({ type: "ProjectSummary" })) }, { projectId: t.project.id, exists }), /Cel mult/);
    const c = await t.hub.cockpit.projectCockpit(t.project.id);
    const base = defaultLayout(c);
    const tests = layoutForIntent({ intent: "show_tests", args: { missionId: mission.id } }, c, base);
    assert.equal(tests.cards[0].type, "TestPanel");
    const focus = layoutForIntent({ intent: "focus", args: {} }, c, tests);
    assert.equal(focus.focus, true);
    assert.ok(focus.cards.every((x) => ["ProjectSummary", "NextStepCard", "DecisionCard"].includes(x.type) || x.pinned));
  } finally { await t.cleanup(); }
});

test("M06-CK-06 company map: configured roles are not active workers; executions only from running runs", async () => {
  const t = await cockpitHub();
  try {
    const map = t.hub.cockpit.companyMap();
    assert.ok(map.departments.length > 0);
    assert.equal(map.activeRuns, 0);
    assert.ok(map.departments.every((d) => d.activeExecutions === 0));
    assert.ok(map.departments.some((d) => d.rolesConfigured > 0));
    assert.match(map.note, /nu e un worker activ/);
  } finally { await t.cleanup(); }
});

test("M06-CK-07 interruptions: freeze blocks new steps (gate), voice cannot unfreeze, takeover releases only after a confirmed stop", async () => {
  const t = await cockpitHub();
  try {
    await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const frozen = (await dispatch(t.hub, "owner.interrupt", { kind: "freeze", projectId: t.project.id }, { channel: "voice" })).result;
    assert.match(frozen.summary, /înghețat/);
    const gate = t.hub.gate.evaluate({ provider: "codex", projectId: t.project.id, access: "workspace-write" });
    assert.equal(gate.checks.find((c) => c.id === "project_frozen").ok, false);
    const plan = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    assert.ok(plan.readiness.blockers.some((b) => b.id === "frozen"));
    await assert.rejects(t.hub.commands.dispatch({ type: "owner.unfreeze", channel: "voice", actor: "lega", payload: { projectId: t.project.id } }), /cannot be issued through voice/);
    assert.match((await dispatch(t.hub, "owner.unfreeze", { projectId: t.project.id }, { channel: "ui" })).result.summary, /nu mai e înghețat/);
    const pause = (await dispatch(t.hub, "owner.interrupt", { kind: "pause" }, { channel: "voice" })).result;
    assert.match(pause.summary, /Nicio misiune activă/);
    assert.equal(t.hub.settings.get("executionGate").status, "suspended", "a global pause also stops new runs");
    const stop = (await dispatch(t.hub, "owner.interrupt", { kind: "stop_worker", provider: "codex" })).result;
    assert.match(stop.summary, /nu rulează/);
    const take = (await dispatch(t.hub, "owner.interrupt", { kind: "takeover", projectId: t.project.id })).result;
    assert.equal(take.released, true);
    assert.ok(take.checkpoint?.id, "a checkpoint is recorded when control is handed over");
  } finally { await t.cleanup(); }
});

test("M06-CK-08 attention: aggregated, with a reason; 'only decisions' and quiet hours filter interruptions, not the record", async () => {
  const t = await cockpitHub();
  try {
    assert.equal(classifyEvent({ type: "factory.stage", scopeId: "m", payload: { stage: "DELIVERY_READY" } }).reason, "MISSION_COMPLETE");
    assert.equal(classifyEvent({ type: "run.activity", scopeId: "r", payload: {} }), null, "no interruption for every file or test");
    const seq = t.hub.bus.lastSeq();
    for (const stage of ["BLOCKED", "BLOCKED", "NEEDS_OWNER_DECISION"]) t.hub.bus.emit({ type: "factory.stage", scopeType: "mission", scopeId: "mis_x", source: "test", payload: { stage, reason: "r" } });
    const a = t.hub.advisor.attention({ afterSeq: seq });
    assert.equal(a.items.filter((i) => i.key === "mission:mis_x").length, 1, "one row per mission");
    assert.equal(a.items[0].count, 3);
    t.hub.bus.emit({ type: "factory.stage", scopeType: "mission", scopeId: "mis_y", source: "test", payload: { stage: "BLOCKED", reason: "r" } });
    await dispatch(t.hub, "owner.intent", { text: "Nu mă deranja până termini, decât pentru o decizie" }, { channel: "voice" });
    const filtered = t.hub.advisor.attention({ afterSeq: seq });
    assert.equal(filtered.items.find((i) => i.key === "mission:mis_y").interrupt, false, "a BLOCKED notice waits while only decisions may interrupt");
    assert.equal(filtered.items.find((i) => i.key === "mission:mis_x").interrupt, true, "a decision still interrupts");
  } finally { await t.cleanup(); }
});

test("M06-CK-09 recommendations come from the owner's recorded decisions and are never applied automatically", async () => {
  const t = await cockpitHub();
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i += 1) t.hub.db.prepare(`INSERT INTO approvals (id, action_kind, target, payload_json, payload_hash, code_version, permission_tier, scope_type, scope_id, status, requested_by, single_use, expires_at, created_at, decided_at, decided_by, decided_via)
      VALUES (?, 'process.run', 'npm test', '{}', ?, 'hub', 'DEVELOPMENT_TOOLS', 'task', 'tsk', 'consumed', 'test', 1, ?, ?, ?, 'user', 'ui')`).run(`apr_rec_${i}`, `h${i}`, now, now, now);
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM approval_policies").get().n;
    const rec = t.hub.advisor.recommendations();
    const r = rec.items.find((x) => x.kind === "policy_rule" && x.change.payload.actionKind === "process.run");
    assert.ok(r, JSON.stringify(rec.items));
    assert.equal(r.change.payload.policy, "ASK_ONCE_FOR_TASK", "never looser than the catalog allows");
    assert.equal(r.evidence.approved, 5);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approval_policies").get().n, before, "nothing applied");
  } finally { await t.cleanup(); }
});

test("M06-CK-10 Shadow Mode needs an authorization; its verdict is stored apart and never moves the mission", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { project: hubProject } = await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const dir = path.join(t.dataDir, "f"); materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    assert.ok(hubProject);
    t.hub.bus.transaction(() => {
      t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test");
      t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const scope = t.hub.factory.view(mission.id).scope;
    const requested = await dispatch(t.hub, "factory.start", scope);
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await t.hub.commands.executeApproved(requested.command.id, "user");
    await waitFor(() => SETTLED.includes(t.hub.factory.view(mission.id).factory.stage), 90000, 100);
    const stageBefore = t.hub.factory.view(mission.id).factory.stage;
    // The reviewer's only attempt is spent: shadow is refused without a new authorization.
    // M09: a shadow review names its Claude model explicitly (the account default is never used).
    await assert.rejects(dispatch(t.hub, "shadow.review", { missionId: mission.id, provider: "claude", model: "sonnet" }), /grant/);
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 900, ttlMinutes: 30 }, "test"));
    t.queue("claude", "review:pass");
    const shadow = (await dispatch(t.hub, "shadow.review", { missionId: mission.id, provider: "claude", model: "sonnet" })).result;
    assert.equal(shadow.status, "RUNNING");
    const done = await waitFor(() => { const s = t.hub.advisor.shadowsOf(mission.id)[0]; return s && s.status !== "RUNNING" ? s : null; }, 30000, 100);
    assert.equal(done.status, "DONE", JSON.stringify(done.metrics));
    assert.equal(done.metrics.primaryVerdict, "PASS");
    assert.equal(typeof done.metrics.verdictAgrees, "boolean");
    assert.equal(t.hub.factory.view(mission.id).factory.stage, stageBefore, "the mission did not move");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_reviews WHERE mission_id = ?").get(mission.id).n, 1, "the shadow verdict is not a mission review");
  } finally { await t.cleanup(); }
});
