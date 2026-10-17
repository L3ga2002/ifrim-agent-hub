import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { scanEnvironment, buildChildEnv, BILLING_RISK_ENV } from "../server/policy/billing.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { openDatabase } from "../server/storage/db.mjs";
import { createEventBus } from "../server/events/bus.mjs";
import { SCHEDULE_COMMANDS } from "../server/runtime/command-catalog.mjs";
import { TOOL_DEFINITIONS } from "../server/tools/registry.mjs";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server");
const HUB_SESSION = "11111111-1111-4111-8111-111111111111"; // fake `claude agents --json`: cwd = the test project
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222"; // fake `claude agents --json`: unregistered folder
const BACKGROUND = "anthropic.claude_code_background";
const CODEX_SURFACE = "openai.codex_app_server";
const CLAUDE_SURFACE = "anthropic.claude_code_headless";
const TERMINAL = ["completed", "failed", "blocked", "interrupted", "interrupted_unknown", "orphaned"];

const dispatch = (hub, type, payload = {}) => hub.commands.dispatch({ type, payload, channel: "test" });
const failureOf = (promise) => promise.then(() => null, (error) => error);
const finished = (hub, id) => waitFor(() => { const r = hub.runs.getRun(id); return TERMINAL.includes(r.status) ? r : null; }, 30000);
const eventsOf = (hub, prefix) => hub.bus.since(0, 100000).filter((e) => e.type.startsWith(prefix));
const claudeTurns = (t) => t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p"));
const codexTurns = (t) => t.readLog("codex").filter((e) => e.method === "turn/start");
const agentsReads = (t) => t.readLog("claude").filter((e) => e.agents !== undefined);

/** Appends fixture-only options to a fake provider command line of this test hub (adapters read prefixArgs at every spawn). */
const addFakeArgs = (t, provider, ...extra) => t.config.providerBinaries[provider].prefixArgs.push(...extra);

/** Lets a test change the fake Claude scenario between invocations (fake-claude `--fake-scenario-file=`). */
function scenarioSwitch(t) {
  const file = path.join(t.dataDir, "claude-scenario.txt");
  addFakeArgs(t, "claude", `--fake-scenario-file=${file}`);
  return (scenario) => fs.writeFileSync(file, scenario);
}

async function conversationWithMessage(hub, projectId, content = "Continue the work") {
  const conversation = (await dispatch(hub, "conversation.create", { projectId, title: "M01 conversation" })).result;
  await dispatch(hub, "conversation.message", { conversationId: conversation.id, content });
  return conversation;
}

const gitOut = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true }).trim();
const gitSnapshot = (dir) => ({
  head: gitOut(dir, "rev-parse", "HEAD"),
  branches: gitOut(dir, "for-each-ref", "--format=%(refname)", "refs/heads"),
  tags: gitOut(dir, "tag", "--list"),
  reflog: gitOut(dir, "reflog", "--format=%H %gs"),
  stash: gitOut(dir, "stash", "list"),
});

function listModules(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listModules(full));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- native session mirror

test("M01-NS1 native.mirror stores only sessions inside registered projects and publishes provider.native_task_started with rawRef", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const [a, b] = await Promise.all([dispatch(hub, "native.mirror"), dispatch(hub, "native.mirror")]);
    assert.equal(agentsReads(t).length, 1, "concurrent mirror commands share one `claude agents --json` read");
    assert.deepEqual(agentsReads(t)[0].args, ["agents", "--json"]);
    assert.deepEqual(a.result, b.result);
    assert.equal(a.result.ok, true);
    assert.equal(a.result.sessions, 1);
    assert.equal(a.result.unregisteredCount, 1);
    assert.equal(a.result.changes, 1);
    assert.equal(a.command.status, "executed");
    assert.equal(a.command.policy.policy, "AUTO_ALLOWED", "reading the native listing is a read-only action");

    const sessions = hub.nativeSessions.list();
    assert.equal(sessions.length, 1);
    const [s] = sessions;
    assert.equal(s.nativeSessionId, HUB_SESSION);
    assert.equal(s.projectId, project.id);
    assert.equal(s.provider, "claude");
    assert.equal(s.surfaceId, BACKGROUND);
    assert.equal(s.status, "active", "busy is mirrored as active");
    assert.equal(s.name, "Hub project session");
    assert.equal(s.kind, "interactive");
    assert.equal(s.pid, 111);
    assert.equal(s.startedAt, new Date(1790000000000).toISOString());
    assert.equal(s.observedVia, "claude agents --json");
    assert.equal(s.firstSeenAt, a.result.observedAt);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM native_sessions").get().n, 1, "the unregistered session is counted, never stored");

    const started = eventsOf(hub, "provider.native_task_started");
    assert.equal(started.length, 1);
    const [ev] = started;
    assert.equal(ev.schemaVersion, 2);
    assert.equal(ev.scopeType, "native_session");
    assert.equal(ev.scopeId, HUB_SESSION);
    assert.equal(ev.projectId, project.id);
    assert.equal(ev.source, "claude-native");
    assert.equal(ev.rawRef, `claude agents --json @ ${a.result.observedAt}`);
    assert.equal(ev.correlationId, a.command.correlationId, "the event carries the correlation id of the command that observed it");
    assert.equal(ev.payload.provider, "claude");
    assert.equal(ev.payload.surface, BACKGROUND);
    assert.equal(ev.payload.sessionId, HUB_SESSION);
    assert.equal(ev.payload.status, "active");

    for (const [table, column] of [["events", "payload_json"], ["events", "raw_ref"], ["commands", "result_json"], ["capability_verifications", "evidence_json"],
      ["capability_verifications", "summary"], ["execution_surfaces", "evidence_json"], ["native_sessions", "name"]]) {
      const leaked = hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE ? OR ${column} LIKE ? OR ${column} LIKE ?`)
        .get(`%${OTHER_SESSION}%`, "%private-project%", "%Other project%").n;
      assert.equal(leaked, 0, `${table}.${column} must not mention the unregistered session`);
    }

    const surface = hub.surfaces.get(BACKGROUND);
    assert.equal(surface.availability, "available");
    assert.ok(surface.verifiedAt);
    assert.equal(surface.evidence.sessions, 1);
    assert.equal(surface.evidence.unregistered, 1);
    const verification = hub.surfaces.verifications({ surfaceId: BACKGROUND })[0];
    assert.equal(verification.label, "PASS_LOCAL");
    assert.equal(verification.method, "local_cli");

    const again = await dispatch(hub, "native.mirror");
    assert.equal(again.result.changes, 0);
    assert.equal(eventsOf(hub, "provider.native_task").length, 1, "an unchanged session publishes no new event");
    assert.equal(hub.nativeSessions.list()[0].lastSeenAt, again.result.observedAt);
    assert.equal(hub.nativeSessions.list()[0].firstSeenAt, a.result.observedAt);
    assert.equal(claudeTurns(t).length, 0, "mirroring never runs inference");
  } finally { await t.cleanup(); }
});

test("M01-NS2 native session lifecycle: idle → active (updated) → gone (ended, native_task_completed) → seen again (started)", async () => {
  const t = await makeTestHub({ claude: "agents-idle" });
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const setScenario = scenarioSwitch(t);
    const first = await dispatch(hub, "native.mirror");
    assert.equal(first.result.ok, true);
    assert.equal(hub.nativeSessions.list()[0].status, "idle", "a first-seen idle session is stored as idle");
    const [firstEvent] = eventsOf(hub, "provider.native_task_started");
    assert.equal(firstEvent.payload.status, "idle");

    setScenario("ok");
    const busy = await dispatch(hub, "native.mirror");
    assert.equal(busy.result.changes, 1);
    assert.equal(hub.nativeSessions.list()[0].status, "active");
    const updated = eventsOf(hub, "provider.native_task_updated");
    assert.equal(updated.length, 1);
    assert.equal(updated[0].scopeId, HUB_SESSION);
    assert.equal(updated[0].payload.status, "active");
    assert.equal(updated[0].payload.previous, "idle");
    assert.equal(updated[0].rawRef, `claude agents --json @ ${busy.result.observedAt}`);

    setScenario("agents-empty");
    const empty = await dispatch(hub, "native.mirror");
    assert.equal(empty.result.ok, true);
    assert.equal(empty.result.sessions, 0);
    assert.equal(empty.result.changes, 1);
    assert.deepEqual(hub.nativeSessions.list(), [], "ended sessions are hidden by default");
    const all = hub.nativeSessions.list({ includeEnded: true });
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "ended");
    assert.equal(all[0].lastSeenAt, empty.result.observedAt);
    const completed = eventsOf(hub, "provider.native_task_completed");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].scopeId, HUB_SESSION);
    assert.equal(completed[0].projectId, project.id);
    assert.equal(completed[0].payload.status, "ended");
    assert.equal(completed[0].rawRef, `claude agents --json @ ${empty.result.observedAt}`);
    assert.equal(hub.surfaces.get(BACKGROUND).availability, "available", "an empty listing is still a successful read");

    const emptyAgain = await dispatch(hub, "native.mirror");
    assert.equal(emptyAgain.result.changes, 0);
    assert.equal(eventsOf(hub, "provider.native_task_completed").length, 1, "an ended session is completed once");

    setScenario("ok");
    await dispatch(hub, "native.mirror");
    const started = eventsOf(hub, "provider.native_task_started");
    assert.equal(started.length, 2);
    assert.equal(started[1].payload.previous, "ended");
    assert.equal(hub.nativeSessions.list()[0].status, "active");
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM native_sessions").get().n, 1, "a native session keeps one row for its whole life");
    assert.equal(claudeTurns(t).length, 0);
  } finally { await t.cleanup(); }
});

test("M01-NS3 unreadable or non-list `claude agents --json` output publishes provider.native_mirror_failed and changes no rows", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const setScenario = scenarioSwitch(t);
    await dispatch(hub, "native.mirror");
    const snapshot = () => hub.db.prepare("SELECT * FROM native_sessions ORDER BY id").all().map((row) => ({ ...row }));
    const before = snapshot();
    assert.equal(before.length, 1);
    const nativeTaskEvents = eventsOf(hub, "provider.native_task").length;

    for (const [scenario, message] of [["agents-broken", /JSON/], ["agents-object", /nu este listă/]]) {
      setScenario(scenario);
      const r = await dispatch(hub, "native.mirror");
      assert.equal(r.result.ok, false, scenario);
      assert.match(r.result.error, message);
      assert.deepEqual(snapshot(), before, `${scenario}: no native session row changed`);
      const failed = eventsOf(hub, "provider.native_mirror_failed").at(-1);
      assert.equal(failed.scopeType, "provider");
      assert.equal(failed.scopeId, "claude");
      assert.equal(failed.payload.error, r.result.error);
      assert.equal(hub.surfaces.get(BACKGROUND).availability, "unknown", scenario);
      assert.ok(hub.surfaces.verifications({ surfaceId: BACKGROUND }).some((v) => v.label === "FAIL" && v.method === "local_cli"));
    }
    assert.equal(eventsOf(hub, "provider.native_mirror_failed").length, 2);
    assert.equal(eventsOf(hub, "provider.native_task").length, nativeTaskEvents, "a failed read never ends or updates a session");

    setScenario("ok");
    const recovered = await dispatch(hub, "native.mirror");
    assert.equal(recovered.result.ok, true);
    assert.equal(recovered.result.changes, 0);
    assert.equal(hub.surfaces.get(BACKGROUND).availability, "available");
  } finally { await t.cleanup(); }
});

test("M01-NS4 provider-native events are found by their type family through the diagnostics query", () => {
  const db = openDatabase(":memory:");
  try {
    const bus = createEventBus(db);
    bus.emit({ type: "provider.native_task_started", scopeType: "native_session", scopeId: HUB_SESSION, source: "claude-native",
      rawRef: "claude agents --json @ 2026-09-30T00:00:00.000Z", payload: { provider: "claude", surface: BACKGROUND, sessionId: HUB_SESSION, status: "active" } });
    bus.emit({ type: "provider.native_mirror_failed", scopeType: "provider", scopeId: "claude", source: "user", payload: { error: "Ieșirea nu este JSON valid" } });
    assert.equal(bus.query({ typePrefix: "provider.native" }).length, 2, "control: both events are stored");
    // Same filter as GET /api/events/query?type=provider.native_task
    const found = bus.query({ typePrefix: "provider.native_task" });
    assert.deepEqual(found.map((e) => e.type), ["provider.native_task_started"]);
    assert.equal(found[0].rawRef, "claude agents --json @ 2026-09-30T00:00:00.000Z");
  } finally { db.close(); }
});

// ---------------------------------------------------------------- checkpoints

test("M01-CK1 checkpoint.create stores hub state, native references and the latest verified backup", async () => {
  const t = await makeTestHub({ codex: "hang" });
  let codexRunId = null;
  try {
    const { hub, projectDir } = t;
    const project = hub.projects.hub();
    const setScenario = scenarioSwitch(t);

    const early = (await dispatch(hub, "checkpoint.create", { label: "before any backup" })).result;
    assert.equal(early.scopeType, "project");
    assert.equal(early.scopeId, project.id);
    assert.equal(early.backupId, null, "no verified backup exists yet");
    assert.deepEqual(early.nativeRefs, []);
    assert.deepEqual(early.hubState.activeRuns, []);
    const earlyEvent = eventsOf(hub, "checkpoint.created").find((e) => e.payload.checkpointId === early.id);
    assert.equal(earlyEvent.payload.backupId, null);
    assert.equal(earlyEvent.payload.backupFresh, false);

    await enableLive(hub, { provider: "claude" });
    hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const mission = (await dispatch(hub, "mission.create", { projectId: project.id, kind: "development", title: "Checkpoint mission", objective: "Exercise the checkpoint capture" })).result;
    const conversationId = mission.conversationId;
    await dispatch(hub, "conversation.message", { conversationId, content: "Please review the repository" });
    const claudeRun = (await dispatch(hub, "run.start", { conversationId, provider: "claude", model: "sonnet" })).result.run;
    assert.equal((await finished(hub, claudeRun.id)).status, "completed");
    const claudeSession = hub.conversations.providerSessions(conversationId).find((s) => s.provider === "claude").nativeSessionId;
    const call = claudeTurns(t)[0];
    assert.equal(call.args[call.args.indexOf("--session-id") + 1], claudeSession, "the referenced session is the one the CLI used");
    const verifiedBackups = hub.backups.list(project.id).filter((bkp) => bkp.status === "verified");
    assert.equal(verifiedBackups.length, 1);

    await dispatch(hub, "native.mirror");
    const pending = (await dispatch(hub, "tool.invoke", { toolId: "process.run", projectId: project.id, args: { script: "build" } })).result.approval;
    const testApproval = (await dispatch(hub, "tool.invoke", { toolId: "process.run", projectId: project.id, args: { script: "test" } })).result.approval;
    await dispatch(hub, "approval.decide", { approvalId: testApproval.id, decision: "approved", displayedHash: testApproval.payloadHash });
    await failureOf(dispatch(hub, "approval.execute_script", { approvalId: testApproval.id })); // test mode never spawns npm; the attempt is recorded
    await dispatch(hub, "tool.invoke", { toolId: "preview.check", projectId: project.id, args: { url: "http://127.0.0.1:9/" } });
    await dispatch(hub, "tool.invoke", { toolId: "git.status", projectId: project.id });
    const lock = (await dispatch(hub, "computer.acquire", { envId: "hub.preview_http", holder: "checkpoint-test" })).result;
    const artifact = (await dispatch(hub, "artifact.register", { projectId: project.id, missionId: mission.id, kind: "report", title: "Native report",
      source: "claude_artifact", nativeRef: "https://claude.ai/artifacts/fake-123" })).result;
    const hanging = await conversationWithMessage(hub, project.id, "Long running task");
    codexRunId = (await dispatch(hub, "run.start", { conversationId: hanging.id, provider: "codex" })).result.run.id;
    await waitFor(() => codexTurns(t).length === 1);

    const created = await dispatch(hub, "checkpoint.create", { scopeType: "conversation", scopeId: conversationId, label: "mid-flight", nextAction: "Review the Claude answer" });
    const ckpt = created.result;
    assert.equal(ckpt.kind, "operational");
    assert.equal(ckpt.scopeType, "conversation");
    assert.equal(ckpt.scopeId, conversationId);
    assert.equal(ckpt.label, "mid-flight");
    assert.equal(ckpt.nextAction, "Review the Claude answer");
    assert.equal(ckpt.createdBy, "user");
    assert.equal(ckpt.gitHead, gitOut(projectDir, "rev-parse", "HEAD"));
    assert.equal(ckpt.gitBranch, gitOut(projectDir, "rev-parse", "--abbrev-ref", "HEAD"));
    assert.deepEqual(ckpt.dirty, []);

    const state = ckpt.hubState;
    for (const key of ["missions", "pendingApprovals", "locks", "activeRuns", "tests", "artifacts", "externalEffects", "git"]) assert.ok(key in state, key);
    const m = state.missions.find((x) => x.id === mission.id);
    assert.ok(m, "mission captured");
    assert.equal(m.title, "Checkpoint mission");
    assert.deepEqual(m.tasks.map((x) => x.id).sort(), hub.missions.tasks(mission.id).map((x) => x.id).sort());
    assert.ok(m.tasks.every((x) => x.title && x.status && x.roleId));
    const approvalIds = state.pendingApprovals.map((x) => x.id);
    assert.ok(approvalIds.includes(pending.id), "pending approval captured");
    assert.ok(!approvalIds.includes(testApproval.id), "consumed approvals are not pending");
    assert.equal(state.pendingApprovals.find((x) => x.id === pending.id).actionKind, "process.run");
    const computerLock = state.locks.find((l) => l.id === lock.envLease.id);
    assert.equal(computerLock?.resource, "computer:hub.preview_http");
    assert.equal(computerLock.holder, "checkpoint-test");
    assert.ok(state.locks.some((l) => l.holder === `codex:${codexRunId}`), "the running provider's workspace lease is captured");
    assert.deepEqual(state.activeRuns.map((r) => ({ ...r })), [{ id: codexRunId, provider: "codex", status: "running", surfaceId: CODEX_SURFACE }]);
    assert.ok(state.tests.some((x) => x.tool === "process.test"), "test tool calls captured");
    const art = state.artifacts.find((x) => x.id === artifact.id);
    assert.deepEqual({ ...art }, { id: artifact.id, kind: "report", title: "Native report", source: "claude_artifact", nativeRef: "https://claude.ai/artifacts/fake-123", version: 1 });
    const effects = state.externalEffects.map((x) => x.tool);
    assert.ok(effects.includes("preview.check") && effects.includes("process.test"), "tool calls with effects captured");
    assert.ok(!effects.includes("git.status"), "effect-free reads are not external effects");
    assert.equal(state.git.untrackedCount, 0);

    const refs = ckpt.nativeRefs;
    const claudeRef = refs.find((r) => r.kind === "claude_code_session");
    assert.equal(claudeRef?.nativeId, claudeSession);
    assert.equal(claudeRef.provider, "claude");
    assert.equal(claudeRef.conversationId, conversationId);
    const mirrored = refs.find((r) => r.kind === "claude_native_session");
    assert.equal(mirrored?.nativeId, HUB_SESSION);
    assert.equal(mirrored.status, "active");
    assert.ok(!refs.some((r) => r.kind === "codex_thread"), "only sessions linked to the checkpoint scope are referenced");
    assert.ok(!JSON.stringify(ckpt).includes("Claude simulated answer"), "native content is referenced, never copied");

    assert.equal(ckpt.backupId, verifiedBackups[0].id, "links the latest verified backup");
    assert.equal(hub.runs.getRun(claudeRun.id).backupId, ckpt.backupId);
    const ev = eventsOf(hub, "checkpoint.created").find((e) => e.payload.checkpointId === ckpt.id);
    assert.equal(ev.payload.backupId, ckpt.backupId);
    assert.equal(ev.payload.backupFresh, true);
    assert.equal(ev.payload.nativeRefs, refs.length);
    assert.equal(ev.correlationId, created.command.correlationId);
    assert.deepEqual(hub.checkpoints.get(ckpt.id), ckpt, "persisted exactly as returned");
    const row = hub.db.prepare("SELECT hub_state_json, native_refs_json, backup_id FROM checkpoints WHERE id = ?").get(ckpt.id);
    assert.deepEqual(JSON.parse(row.hub_state_json), JSON.parse(JSON.stringify(state)));
    assert.deepEqual(JSON.parse(row.native_refs_json), JSON.parse(JSON.stringify(refs)));
    assert.equal(row.backup_id, ckpt.backupId);

    const missionCkpt = (await dispatch(hub, "checkpoint.create", { scopeType: "mission", scopeId: mission.id })).result;
    assert.deepEqual(missionCkpt.hubState.missions.map((x) => x.id), [mission.id]);
    assert.ok(missionCkpt.nativeRefs.some((r) => r.kind === "claude_code_session" && r.nativeId === claudeSession));
    assert.ok(hub.missions.tasks(mission.id).map((x) => x.title).includes(missionCkpt.nextAction), "default next action is the next open task");

    await hub.runs.stopAll("test", "checkpoint test cleanup");
    assert.equal((await finished(hub, codexRunId)).status, "interrupted");
    setScenario("agents-empty");
    await dispatch(hub, "native.mirror");
    const later = (await dispatch(hub, "checkpoint.create", {})).result;
    assert.ok(!later.nativeRefs.some((r) => r.kind === "claude_native_session"), "ended native sessions are no longer referenced");
    assert.deepEqual(later.nativeRefs.map((r) => r.kind).sort(), ["claude_code_session", "codex_thread"]);
    assert.deepEqual(later.hubState.activeRuns, []);
    assert.equal(later.backupId, ckpt.backupId);
  } finally {
    if (codexRunId && !TERMINAL.includes(t.hub.runs.getRun(codexRunId)?.status)) {
      await t.hub.runs.stopAll("test", "cleanup").catch(() => {});
      await finished(t.hub, codexRunId).catch(() => {});
    }
    await t.cleanup();
  }
});

test("M01-CK2 checkpoint.create reports invalid and unknown scopes as client errors and writes nothing", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal((await failureOf(dispatch(hub, "checkpoint.create", { scopeType: "galaxy", scopeId: "x" })))?.category, "validation");
    assert.equal((await failureOf(dispatch(hub, "checkpoint.create", { kind: "handoff" })))?.category, "validation", "handoff checkpoints belong to the handoff runtime");
    const categories = {};
    for (const scopeType of ["conversation", "mission", "task", "project"]) {
      const error = await failureOf(dispatch(hub, "checkpoint.create", { scopeType, scopeId: `${scopeType}_missing` }));
      categories[scopeType] = error ? (error.category || `${error.name}: ${error.message}`) : "created";
    }
    assert.deepEqual(categories, { conversation: "not_found", mission: "not_found", task: "not_found", project: "not_found" });
    assert.equal(hub.checkpoints.list().length, 0);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- handoff surfaces

test("M01-HO1 handoff Codex → Claude → Codex records execution surfaces, native checkpoint refs and a verifiable package", async () => {
  const t = await makeTestHub();
  try {
    const { hub, projectDir } = t;
    const { project } = await enableLive(hub, { provider: "codex" });
    hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const gitBefore = gitSnapshot(projectDir);
    fs.writeFileSync(path.join(projectDir, "notes.txt"), "untracked working note\n");

    const conv = await conversationWithMessage(hub, project.id, "Implement the greeting");
    const codexRun = (await dispatch(hub, "run.start", { conversationId: conv.id, provider: "codex" })).result.run;
    assert.equal((await finished(hub, codexRun.id)).status, "completed");
    assert.equal(hub.db.prepare("SELECT surface_id FROM agent_runs WHERE id = ?").get(codexRun.id).surface_id, CODEX_SURFACE);
    assert.equal(hub.db.prepare("SELECT surface_id FROM provider_sessions WHERE conversation_id = ? AND provider = 'codex'").get(conv.id).surface_id, CODEX_SURFACE);

    const h = (await dispatch(hub, "handoff.begin", { conversationId: conv.id, toProvider: "claude" })).result;
    assert.equal(h.status, "ready");
    assert.equal(h.fromProvider, "codex");
    assert.equal(h.toProvider, "claude");
    assert.equal(h.fromSurface, CODEX_SURFACE);
    assert.equal(h.toSurface, CLAUDE_SURFACE);
    const row = hub.db.prepare("SELECT from_surface, to_surface FROM handoffs WHERE id = ?").get(h.id);
    assert.deepEqual({ ...row }, { from_surface: CODEX_SURFACE, to_surface: CLAUDE_SURFACE });
    assert.equal(hub.surfaces.get(h.fromSurface).provider, "openai");
    assert.equal(hub.surfaces.get(h.toSurface).provider, "anthropic");

    const pkg = h.package;
    assert.deepEqual({ ...pkg.source_session }, { provider: "codex", surface: CODEX_SURFACE, native_session_id: "thr_fake_1", last_run_id: codexRun.id });
    assert.equal(pkg.target_provider, "claude");
    assert.equal(pkg.target_surface, CLAUDE_SURFACE);
    assert.ok(Array.isArray(pkg.native_checkpoint_refs));
    assert.deepEqual(pkg.native_checkpoint_refs.map((r) => `${r.kind}:${r.provider}:${r.nativeId}:${r.conversationId}`), [`codex_thread:codex:thr_fake_1:${conv.id}`]);
    assert.equal(hashCanonical(pkg), h.packageSha256, "the stored package matches its hash");
    const ckpt = hub.checkpoints.get(h.checkpointId);
    assert.equal(ckpt.kind, "handoff");
    assert.equal(ckpt.scopeType, "conversation");
    assert.equal(ckpt.scopeId, conv.id);
    assert.equal(ckpt.label, `handoff ${h.id}`);
    assert.deepEqual(ckpt.nativeRefs, pkg.native_checkpoint_refs, "package and checkpoint reference the same native sessions");
    assert.equal(pkg.context_references.checkpoint_id, ckpt.id);
    assert.ok(pkg.untracked_manifest.find((u) => u.path === "notes.txt")?.sha256, "untracked work travels in the manifest");
    assert.equal(claudeTurns(t).length, 0, "beginning a handoff never starts the target model");

    const claudeRun = (await dispatch(hub, "run.start", { conversationId: conv.id, provider: "claude", model: "sonnet" })).result.run;
    assert.equal((await finished(hub, claudeRun.id)).status, "completed");
    assert.equal((await waitFor(() => { const x = hub.handoffs.get(h.id); return x.status === "completed" ? x : null; })).step, "continued");
    assert.equal(hub.db.prepare("SELECT surface_id FROM agent_runs WHERE id = ?").get(claudeRun.id).surface_id, CLAUDE_SURFACE);
    const claudeSession = hub.conversations.providerSessions(conv.id).find((s) => s.provider === "claude").nativeSessionId;

    await dispatch(hub, "conversation.message", { conversationId: conv.id, content: "Back to Codex" });
    const back = (await dispatch(hub, "handoff.begin", { conversationId: conv.id, toProvider: "codex" })).result;
    assert.equal(back.status, "ready");
    assert.equal(back.fromSurface, CLAUDE_SURFACE);
    assert.equal(back.toSurface, CODEX_SURFACE);
    assert.equal(back.package.source_session.surface, CLAUDE_SURFACE);
    assert.equal(back.package.source_session.native_session_id, claudeSession);
    assert.equal(back.package.source_session.last_run_id, claudeRun.id);
    assert.equal(back.package.target_surface, CODEX_SURFACE);
    assert.deepEqual(back.package.native_checkpoint_refs.map((r) => `${r.kind}:${r.nativeId}`).sort(), [`claude_code_session:${claudeSession}`, "codex_thread:thr_fake_1"].sort());
    assert.equal(hashCanonical(back.package), back.packageSha256);
    await dispatch(hub, "handoff.cancel", { handoffId: back.id });
    assert.equal(codexTurns(t).length, 1, "the handoff back did not start Codex");

    const fresh = (await dispatch(hub, "conversation.create", { projectId: project.id, title: "No writer yet" })).result;
    const orphan = (await dispatch(hub, "handoff.begin", { conversationId: fresh.id, toProvider: "codex" })).result;
    assert.equal(orphan.fromProvider, "none");
    assert.equal(orphan.fromSurface, null);
    assert.equal(orphan.toSurface, CODEX_SURFACE);
    assert.equal(orphan.package.source_session.surface, null);
    assert.deepEqual(orphan.package.native_checkpoint_refs, []);
    await dispatch(hub, "handoff.cancel", { handoffId: orphan.id });

    assert.deepEqual(gitSnapshot(projectDir), gitBefore, "runs, checkpoints and handoffs leave Git history untouched");
    assert.ok(fs.existsSync(path.join(projectDir, "notes.txt")), "untracked files survive (no git clean)");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- billing contamination

test("M01-BC1 scanEnvironment reports billing-risk names only; buildChildEnv drops them and refuses them as extras", () => {
  const scan = scanEnvironment({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" });
  assert.deepEqual([...scan.riskyVariablesPresent].sort(), ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  assert.deepEqual(Object.keys(scan).sort(), ["note", "riskyVariablesPresent"]);
  assert.equal(scanEnvironment({ OPENAI_API_KEY: "" }).riskyVariablesPresent.length, 0, "an empty value selects no route");
  const secrets = Object.fromEntries(BILLING_RISK_ENV.map((name, i) => [name, `fake-secret-value-${i}-zz`]));
  const full = scanEnvironment({ ...secrets, PATH: "C:\\bin" });
  // Windows variable names are case-insensitive: HTTP_PROXY and http_proxy are one variable, reported once.
  const uniqueByCase = BILLING_RISK_ENV.filter((n, i, all) => all.findIndex((m) => m.toUpperCase() === n.toUpperCase()) === i);
  assert.deepEqual([...full.riskyVariablesPresent].sort(), [...uniqueByCase].sort());
  assert.ok(!JSON.stringify(full).includes("fake-secret-value"), "values are never reported");

  const child = buildChildEnv({}, { ...secrets, PATH: "C:\\bin", SystemRoot: "C:\\Windows", NODE_OPTIONS: "--require x" });
  assert.deepEqual(Object.keys(child).sort(), ["NO_UPDATE_NOTIFIER", "PATH", "SystemRoot"]);
  assert.ok(!JSON.stringify(child).includes("fake-secret-value"));
  for (const name of BILLING_RISK_ENV) assert.throws(() => buildChildEnv({ [name]: "x" }, {}), /billing-risk/, name);
  assert.equal(buildChildEnv({ CI: "1" }, {}).CI, "1", "harmless extras still pass");
});

test("M01-BC2 on Windows, case variants of billing-risk names are refused as extras (environment names are case-insensitive)",
  { skip: process.platform !== "win32" && "environment variable names are case-sensitive on this platform" }, () => {
    for (const name of ["openai_api_key", "Anthropic_Api_Key", "anthropic_base_url"]) {
      assert.throws(() => buildChildEnv({ [name]: "x" }, {}), /billing-risk/, name);
    }
  });

test("M01-BC3 provider processes never receive billing-risk variables present in the Hub process", async () => {
  const injected = { OPENAI_API_KEY: "sk-fake-openai-000000000000000000", ANTHROPIC_API_KEY: "sk-ant-fake-00000000000000000", ANTHROPIC_BASE_URL: "http://127.0.0.1:9/fake-billing-proxy" };
  const saved = Object.fromEntries(Object.keys(injected).map((name) => [name, process.env[name]]));
  Object.assign(process.env, injected);
  let t = null;
  try {
    t = await makeTestHub();
    const { hub } = t;
    addFakeArgs(t, "codex", "--log-env");
    addFakeArgs(t, "claude", "--fake-log-env");
    const scan = scanEnvironment();
    for (const name of Object.keys(injected)) assert.ok(scan.riskyVariablesPresent.includes(name), name);
    for (const value of Object.values(injected)) assert.ok(!JSON.stringify(scan).includes(value));

    for (const id of ["codex", "claude"]) {
      assert.equal((await hub.providers[id].inspectInstallation()).installed, true, id);
      assert.equal((await hub.providers[id].probe({ withUsage: true })).ok, true, id);
    }
    const codexTurn = await hub.providers.codex.startTurn({ runId: "bc3-codex", cwd: t.projectDir, prompt: "Say hi", access: "read-only", onEvent: () => {},
      admitUsage: () => ({ ok: true }), requestApproval: async () => "decline" }).done;
    assert.equal(codexTurn.status, "completed");
    const claudeTurn = await hub.providers.claude.startTurn({ runId: "bc3-claude", cwd: t.projectDir, prompt: "Say hi", access: "read-only", trustedWorkspace: true, onEvent: () => {} }).done;
    assert.equal(claudeTurn.status, "completed");
    await dispatch(hub, "native.mirror");

    const codexEnv = t.readLog("codex").filter((e) => Array.isArray(e.envNames));
    const claudeEnv = t.readLog("claude").filter((e) => Array.isArray(e.envNames));
    for (const invocation of ["--version", "app-server"]) assert.ok(codexEnv.some((e) => e.invocation === invocation), `codex ${invocation}`);
    for (const invocation of ["--version", "--help", "auth status", "-p --output-format", "agents --json"]) assert.ok(claudeEnv.some((e) => e.invocation === invocation), `claude ${invocation}`);
    assert.ok(codexEnv.filter((e) => e.invocation === "app-server").length >= 2, "probe and turn processes");
    const risky = new Set(BILLING_RISK_ENV.map((name) => name.toUpperCase()));
    for (const entry of [...codexEnv, ...claudeEnv]) {
      assert.deepEqual(entry.envNames.filter((name) => risky.has(name.toUpperCase())), [], entry.invocation);
      assert.ok(entry.envNames.includes("NO_UPDATE_NOTIFIER"), `${entry.invocation}: the controlled child environment was used`);
    }
    const logs = fs.readFileSync(t.logs.codex, "utf8") + fs.readFileSync(t.logs.claude, "utf8");
    for (const value of Object.values(injected)) assert.ok(!logs.includes(value), "fixtures log names only");
  } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await t?.cleanup();
  }
});

test("M01-BC4 the router never admits surfaces billed as API (routing, preferences, overrides, forced availability)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const paid = new Set(["api", "paid_plan", "cloud_provider"]);
    const apiSurfaces = hub.surfaces.list().filter((s) => s.billingMode === "api");
    assert.ok(apiSurfaces.length >= 1, "the registry declares API-billed surfaces");
    const billingOf = (id) => hub.surfaces.get(id)?.billingMode;
    const routeAll = async () => {
      let chosen = 0;
      for (const { id: taskType } of hub.router.taskTypes()) {
        for (const preferredProvider of [null, "openai", "anthropic"]) {
          const route = (await dispatch(hub, "route.adhoc", { taskType, ...(preferredProvider ? { preferredProvider } : {}) })).result;
          if (route.surfaceId) { chosen += 1; assert.ok(!paid.has(billingOf(route.surfaceId)), `${taskType} → ${route.surfaceId}`); }
          for (const alt of route.alternatives.filter((x) => paid.has(billingOf(x.surfaceId)))) {
            assert.equal(alt.excluded, true, `${taskType}: ${alt.surfaceId}`);
            assert.ok(alt.factors.some((f) => f.id === "billing" && f.effect === "exclude"));
          }
        }
      }
      return chosen;
    };
    assert.ok(await routeAll() > 0, "the router still admits included surfaces");

    const project = hub.projects.hub();
    const mission = (await dispatch(hub, "mission.create", { projectId: project.id, kind: "development", title: "Routing mission", objective: "Route a task" })).result;
    const [task] = hub.missions.tasks(mission.id);
    for (const surface of apiSurfaces) {
      const error = await failureOf(dispatch(hub, "route.task", { taskId: task.id, override: { surfaceId: surface.id, reason: "force a paid route" } }));
      assert.equal(error?.category, "policy", surface.id);
    }
    // Even if a vendor reported these surfaces available, BillingPolicy keeps them out.
    hub.db.prepare("UPDATE execution_surfaces SET availability = 'available' WHERE billing_mode = 'api'").run();
    for (const surface of apiSurfaces) {
      const error = await failureOf(dispatch(hub, "route.task", { taskId: task.id, override: { surfaceId: surface.id, reason: "force a paid route" } }));
      assert.equal(error?.category, "policy", surface.id);
      assert.match(error.message, /BillingPolicy/);
    }
    assert.equal(hub.router.list({ subjectId: task.id }).length, 0, "refused overrides persist no route decision");
    await routeAll();
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- no inference in BUILD_SAFE

test("M01-NI1 BUILD_SAFE: run.start through the command bus fails at the gate and no provider process is contacted", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    const conv = await conversationWithMessage(hub, hub.projects.hub().id, "Please change the code");
    for (const provider of ["codex", "claude"]) {
      // M09: Claude needs an explicit model (an empty one would add a run_plan refusal of its own).
      const error = await failureOf(dispatch(hub, "run.start", { conversationId: conv.id, provider, ...(provider === "claude" ? { model: "sonnet" } : {}) }));
      assert.equal(error?.category, "gate", provider);
      const mode = error.details.checks.find((c) => c.id === "mode");
      assert.equal(mode.ok, false);
      assert.match(mode.detail, /BUILD_SAFE/);
    }
    const runs = hub.runs.listRuns({ conversationId: conv.id });
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(run.status, "blocked");
      assert.equal(run.preInference, true);
      assert.equal(run.errorCategory, "gate");
    }
    assert.deepEqual(hub.commands.list({ type: "run.start" }).map((c) => c.status), ["failed", "failed"]);
    assert.deepEqual(t.readLog("codex"), [], "Codex was never launched");
    assert.deepEqual(t.readLog("claude"), [], "Claude was never launched");
    assert.equal(hub.leases.list().length, 0);
    assert.equal(hub.backups.list().length, 0, "a refused run takes no backup");
  } finally { await t.cleanup(); }
});

test("M01-NI2 BUILD_SAFE blocks inference even when every other gate check passes; other channels cannot start runs", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { provider: "codex" });
    hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    await dispatch(hub, "mode.set", { mode: "BUILD_SAFE" });
    const conv = await conversationWithMessage(hub, project.id, "Please change the code");
    for (const provider of ["codex", "claude"]) {
      // M09: Claude needs an explicit model (an empty one would add a run_plan refusal of its own).
      const error = await failureOf(dispatch(hub, "run.start", { conversationId: conv.id, provider, ...(provider === "claude" ? { model: "sonnet" } : {}) }));
      assert.equal(error?.category, "gate", provider);
      assert.deepEqual(error.details.checks.filter((c) => !c.ok).map((c) => c.id), ["mode"], `${provider}: only BUILD_SAFE blocks`);
    }
    assert.ok(hub.grants.list().every((g) => g.attemptsUsed === 0), "no grant attempt consumed");
    const codexMethods = t.readLog("codex").map((e) => e.method).filter(Boolean);
    assert.ok(codexMethods.includes("account/read"), "the account probe ran");
    assert.ok(!codexMethods.includes("thread/start") && !codexMethods.includes("turn/start"));
    assert.equal(claudeTurns(t).length, 0);

    const route = (await dispatch(hub, "route.adhoc", { taskType: "coding" })).result;
    assert.ok([CODEX_SURFACE, CLAUDE_SURFACE].includes(route.surfaceId), route.reason);
    assert.equal(route.executionMode, "planned_only", "model surfaces are only planned in BUILD_SAFE");

    for (const channel of ["schedule", "voice", "automation", "companion"]) {
      const error = await failureOf(hub.commands.dispatch({ type: "run.start", channel, payload: { conversationId: conv.id, provider: "codex" } }));
      assert.equal(error?.category, "policy", channel);
    }
    assert.ok(!SCHEDULE_COMMANDS.has("run.start") && !SCHEDULE_COMMANDS.has("handoff.begin"));
    assert.equal(hub.runs.listRuns({ conversationId: conv.id }).length, 2, "refused channels create no run record");
    assert.equal(codexTurns(t).length, 0);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- no git side effects

test("M01-NG1 static scan: v2/server never spawns git with commit/push/tag/reset/checkout/clean; only tools/git.mjs runs git, read-only", () => {
  const files = listModules(SERVER_DIR);
  assert.ok(files.length > 30, "server sources found");
  const MUTATING = "commit|push|tag|reset|checkout|clean";
  const Q = "[\"'`]";
  const gitLiteral = new RegExp(`${Q}git(?:\\.exe)?${Q}`, "g");
  const argvForm = new RegExp(`${Q}git(?:\\.exe)?${Q}\\s*,\\s*\\[[^\\]]*${Q}(?:${MUTATING})${Q}`);
  const shellForm = new RegExp(`\\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync|execFileAsync)\\s*\\(\\s*${Q}git(?:\\.exe)?\\s+(?:-\\S+\\s+)*(?:${MUTATING})\\b`);
  const helperForm = new RegExp(`\\bgit\\s*\\(\\s*[^,()]+,\\s*\\[[^\\]]*${Q}(?:${MUTATING})${Q}`);
  const offenders = [];
  const gitSpawners = [];
  const supervisorExecutables = new Set();
  for (const file of files) {
    const rel = path.relative(SERVER_DIR, file).replaceAll("\\", "/");
    const src = fs.readFileSync(file, "utf8");
    if ((src.match(gitLiteral) || []).length) gitSpawners.push(rel);
    for (const [label, re] of [["argv", argvForm], ["shell", shellForm], ["helper", helperForm]]) if (re.test(src)) offenders.push(`${rel}: ${label}`);
    if (/\bshell\s*:\s*true/.test(src)) offenders.push(`${rel}: shell:true`);
    for (const m of src.matchAll(/supervisor\.start\(\{[\s\S]{0,400}?executable:\s*([^,}\s]+)/g)) supervisorExecutables.add(m[1]);
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(gitSpawners, ["tools/git.mjs"], "only tools/git.mjs names the git executable");
  // M07: the Claude adapter spawns what its launcher resolved (spec.executable): the Claude binary on Windows, or wsl.exe for
  // claude@wsl-runner. Both launchers are pinned below, so the set still means "provider binaries or node".
  // M09: the media tools (ffmpeg/ffprobe, launcher.executable) and the media transcription (whisper-cli, launch.executable) are
  // pinned below too: production resolves only those named binaries; test mode uses the fixture launchers from the config.
  assert.deepEqual([...supervisorExecutables].sort(), ["binary.executable", "launch.executable", "launcher.executable", "process.execPath", "spec.executable"], "supervised processes are provider binaries, pinned media tools or node");
  const mediaToolsSrc = fs.readFileSync(path.join(SERVER_DIR, "media", "tools.mjs"), "utf8");
  assert.match(mediaToolsSrc, /MEDIA_TOOL_NAMES = Object\.freeze\(\["ffmpeg", "ffprobe"\]\)/, "media tools are only ffmpeg and ffprobe");
  assert.match(mediaToolsSrc, /return file \? \{ executable: file, prefixArgs: \[\], env: \{\}, identityFile: file \} : null;/, "production spawns the resolved (pinned) tool binary itself");
  const transcribeSrc = fs.readFileSync(path.join(SERVER_DIR, "media", "transcribe.mjs"), "utf8");
  assert.match(transcribeSrc, /path\.basename\(exe\)\.toLowerCase\(\) !== VOICE_COMPONENTS\.whisper\.cli\.toLowerCase\(\)/, "media transcription spawns only whisper-cli");
  assert.match(transcribeSrc, /isInside\(enginePaths\.release, exe\)/, "from the integrity-checked whisper.cpp folder");
  const claudeSrc = fs.readFileSync(path.join(SERVER_DIR, "providers", "claude.mjs"), "utf8");
  assert.match(claudeSrc, /spawn: \(\{ binary, args, cwd \}\) => \(\{ executable: binary\.executable,/, "the Windows launcher returns the resolved Claude binary");
  const claudeWslSrc = fs.readFileSync(path.join(SERVER_DIR, "providers", "claude-wsl.mjs"), "utf8");
  assert.match(claudeWslSrc, /resolveWsl\(/, "the environment launcher resolves wsl.exe");
  assert.match(claudeWslSrc, /executable: invocation\.executable/, "and returns only that");

  const gitSrc = fs.readFileSync(path.join(SERVER_DIR, "tools", "git.mjs"), "utf8");
  assert.equal((gitSrc.match(gitLiteral) || []).length, 1, "one git spawn site");
  const callSites = [...gitSrc.matchAll(/(?<!function )\bgit\(/g)].length;
  const subcommands = [...gitSrc.matchAll(/(?<!function )\bgit\(\s*cwd\s*,\s*\[\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(subcommands.length, callSites, "every git call names a literal subcommand");
  const READ_ONLY = new Set(["rev-parse", "status", "diff", "log", "show", "ls-files", "cat-file", "for-each-ref", "rev-list"]);
  assert.deepEqual(subcommands.filter((s) => !READ_ONLY.has(s)), []);
  // M05: the synchronous helper used by the factory snapshot is held to the same rule.
  const syncCalls = [...gitSrc.matchAll(/(?<!function )\bgitSync\(/g)].length;
  const syncSubcommands = [...gitSrc.matchAll(/(?<!function )\bgitSync\(\s*cwd\s*,\s*\[\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(syncSubcommands.length, syncCalls, "every gitSync call names a literal subcommand");
  assert.deepEqual(syncSubcommands.filter((s) => !READ_ONLY.has(s)), []);
});

test("M01-NG2 no command or tool commits, pushes, tags or deploys; commit preparation is a proposal that leaves Git untouched", async () => {
  const t = await makeTestHub();
  try {
    const { hub, projectDir } = t;
    const types = hub.commands.catalog().map((c) => c.type);
    assert.ok(types.length > 40);
    const forbidden = /commit|push|deploy|publish|^git\./i;
    assert.deepEqual(types.filter((type) => forbidden.test(type)), []);
    assert.deepEqual([...SCHEDULE_COMMANDS].filter((type) => forbidden.test(type)), []);
    const gitTools = TOOL_DEFINITIONS.filter((d) => d.id.startsWith("git."));
    assert.ok(gitTools.length >= 1);
    for (const tool of gitTools) {
      assert.equal(tool.tier, "READ_ONLY", tool.id);
      assert.match(tool.effects, /^none/, tool.id);
    }
    for (const actionKind of ["git.commit", "git.push", "deploy"]) {
      assert.equal(hub.policy.resolve({ actionKind }).policy, "ALWAYS_ASK", actionKind);
      const error = await failureOf(dispatch(hub, "policy.set_rule", { actionKind, policy: "AUTO_ALLOWED", reason: "try to loosen" }));
      assert.equal(error?.category, "policy", actionKind);
    }

    const project = hub.projects.hub();
    const before = gitSnapshot(projectDir);
    fs.writeFileSync(path.join(projectDir, "src", "app.js"), "export const answer = 43;\n");
    for (const toolId of ["git.commit", "git.push", "git.tag", "git.reset", "git.checkout", "git.clean", "deploy"]) {
      assert.equal((await failureOf(dispatch(hub, "tool.invoke", { toolId, projectId: project.id })))?.category, "validation", toolId);
    }
    const proposal = (await dispatch(hub, "tool.invoke", { toolId: "git.prepareCommit", projectId: project.id, args: { summary: "Change the answer" } })).result;
    assert.equal(proposal.executable, false);
    assert.ok(proposal.files.includes("src/app.js"));
    assert.deepEqual(gitSnapshot(projectDir), before);
    assert.match(gitOut(projectDir, "status", "--porcelain"), /src\/app\.js/, "the change is still uncommitted");
  } finally { await t.cleanup(); }
});
