// Milestone 01: command bus + approval policy engine (fake providers only, no inference).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { ACTION_CATALOG, APPROVAL_POLICIES } from "../server/policy/approval-policy.mjs";
import { COMMAND_CHANNELS } from "../server/runtime/commands.mjs";
import { SURFACE_BY_PROVIDER } from "../server/runtime/runs.mjs";
import { transitionTask } from "../server/runtime/state-machine.mjs";

const CODEX_SURFACE = SURFACE_BY_PROVIDER.codex;
const CLAUDE_SURFACE = SURFACE_BY_PROVIDER.claude;
const STRICTNESS_ORDER = ["AUTO_ALLOWED", "ASK_ONCE_FOR_TASK", "ALWAYS_ASK", "DENIED"];

const send = (hub, type, payload = {}, extra = {}) => hub.commands.dispatch({ type, payload, actor: "user", channel: "test", ...extra });

/** Predicate for assert.throws / assert.rejects: a HubError of the given category (and message). */
const hubError = (category, pattern = null) => (error) => {
  assert.equal(error?.name, "HubError", `expected a HubError, got: ${error?.stack || error}`);
  assert.equal(error.category, category, error.message);
  if (pattern) assert.match(error.message, pattern);
  return true;
};

const countRows = (hub, table) => hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const scopeRow = (hub, id) => hub.db.prepare("SELECT * FROM task_approval_scopes WHERE id = ?").get(id);
// Filters by exact type in JS: bus.query's typePrefix is only used with underscore-free prefixes here (see M01-POL-07).
const eventsOfType = (hub, type, filter = {}) => hub.bus.query({ ...filter, typePrefix: `${type.split(".")[0]}.`, limit: 2000 }).filter((e) => e.type === type);
const approveInUi = (hub, approval) => hub.bus.transaction(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: approval.payloadHash, channel: "ui" }));
const finished = (hub, id) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 30000);

async function missionWithTasks(hub, title = "Approval policy mission") {
  const project = hub.projects.hub();
  const { result: mission } = await send(hub, "mission.create", { projectId: project.id, kind: "development", title, objective: "Exercise the approval policy engine" });
  return { project, mission, tasks: hub.missions.tasks(mission.id) };
}

/** Test-only approval-gated command: connector.write is ALWAYS_ASK and can never be loosened. */
function registerConnectorWrite(hub) {
  const calls = [];
  hub.commands.register("test.connector_write", { describe: "Test-only external write",
    schema: { connector: { required: true, max: 40 }, text: { required: true, max: 500 }, maxTokens: { type: "integer", min: 1 } },
    action: (input) => ({ actionKind: "connector.write", target: `connector:${input.connector}` }),
    execute: (input) => {
      calls.push(input);
      hub.bus.append({ type: "test.connector_written", scopeType: "system", scopeId: "connector", source: "test", payload: { connector: input.connector } });
      return { written: input.text.length };
    } });
  return calls;
}

function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, text, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function startServer() {
  const t = await makeTestHub();
  try {
    const { server, token } = createHttpServer(t.hub);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(t.config.port, "127.0.0.1", resolve); });
    return { ...t, token, port: t.config.port, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
  } catch (error) {
    await t.cleanup();
    throw error;
  }
}

// ---------------------------------------------------------------- command bus

test("M01-CMD-01 unknown command types and channels are refused before anything is recorded", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const commandsBefore = countRows(hub, "commands");
    const seq = hub.bus.lastSeq();
    assert.equal(hub.commands.has("no.such_command"), false);
    await assert.rejects(hub.commands.dispatch({ type: "no.such_command", payload: {}, channel: "test" }), hubError("validation", /Unknown command no\.such_command/));
    await assert.rejects(hub.commands.dispatch({ type: "gate.set", payload: { action: "suspend" }, channel: "telepathy" }), hubError("validation", /Unknown channel telepathy/));
    assert.equal(countRows(hub, "commands"), commandsBefore);
    assert.equal(hub.bus.lastSeq(), seq, "no event either");
    // "cli" (M05): local scripts recorded as such; only inference-free checks accept it (M05-T17).
    assert.deepEqual([...COMMAND_CHANNELS].sort(), ["automation", "cli", "companion", "recovery", "schedule", "test", "ui", "voice"]);

    assert.throws(() => hub.commands.register("gate.set", { execute: () => null }), /already registered/);
    assert.throws(() => hub.commands.register("test.masked", { logPayload: () => ({}), action: () => ({ actionKind: "connector.write" }), execute: () => null }),
      /logPayload cannot be combined with an approval action/);
    assert.equal(hub.commands.has("test.masked"), false);
  } finally { await t.cleanup(); }
});

test("M01-CMD-02 channel restrictions: voice may suspend but never open the gate, and cannot decide approvals", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const voice = (type, payload) => hub.commands.dispatch({ type, payload, actor: "voice", channel: "voice" });
    assert.equal(hub.settings.get("executionGate").status, "suspended");

    await assert.rejects(voice("gate.set", { action: "open", confirm: "OPEN GATE" }), hubError("policy", /only be opened from the UI/));
    await assert.rejects(hub.commands.dispatch({ type: "gate.set", channel: "companion", payload: { action: "open", confirm: "OPEN GATE" } }), hubError("policy", /only be opened from the UI/));
    await assert.rejects(hub.commands.dispatch({ type: "gate.set", channel: "automation", payload: { action: "suspend" } }), hubError("policy", /gate\.set cannot be issued through automation/));
    assert.equal(hub.settings.get("executionGate").status, "suspended");
    const refused = hub.commands.list({ type: "gate.set" });
    assert.deepEqual(refused.map((c) => `${c.channel}:${c.status}`).sort(), ["companion:failed", "voice:failed"], "refused attempts stay in the audit log");
    assert.ok(refused.every((c) => /only be opened from the UI/.test(c.error)));

    const opened = await send(hub, "gate.set", { action: "open", confirm: "OPEN GATE", reason: "Opened for the channel test" });
    assert.equal(opened.result.executionGate.status, "open");
    const paused = await voice("gate.set", { action: "suspend", reason: "Voice: pause" });
    assert.equal(paused.command.status, "executed");
    assert.equal(paused.command.channel, "voice");
    assert.equal(hub.settings.get("executionGate").status, "suspended");
    assert.equal(hub.settings.get("executionGate").changedBy, "voice");

    const approval = hub.bus.transaction(() => hub.approvals.request({ actionKind: "connector.write", target: "connector:crm", payload: { note: "channel test" }, codeVersion: "hub",
      permissionTier: "EXTERNAL_ACTIONS", scopeType: "command", scopeId: "cmd_channel_test", requestedBy: "test" }));
    const decision = { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash };
    for (const channel of ["voice", "companion", "automation", "schedule"]) {
      await assert.rejects(hub.commands.dispatch({ type: "approval.decide", channel, actor: channel, payload: decision }),
        hubError("policy", new RegExp(`approval\\.decide cannot be issued through ${channel}`)), channel);
    }
    assert.equal(hub.approvals.get(approval.id).status, "pending");
    assert.equal(hub.commands.list({ type: "approval.decide" }).length, 0, "a refused channel leaves no command row");
    assert.deepEqual(hub.commands.catalog().find((c) => c.type === "approval.decide").channels, ["ui", "test"]);

    const decided = await send(hub, "approval.decide", decision);
    assert.equal(decided.result.status, "approved");
    assert.equal(decided.result.decidedVia, "ui");
  } finally { await t.cleanup(); }
});

test("M01-CMD-03 schema validation reports every problem and records nothing", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const commandsBefore = countRows(hub, "commands");
    const seq = hub.bus.lastSeq();
    await assert.rejects(send(hub, "decision.record", { title: "", decision: 42 }), (error) => {
      hubError("validation", /^decision\.record: /)(error);
      assert.deepEqual(error.details.problems, ["title is required", "decision must be a string"]);
      assert.equal(error.status, 400);
      return true;
    });
    await assert.rejects(send(hub, "decision.record", "not an object"), hubError("validation", /JSON object expected/));
    await assert.rejects(send(hub, "decision.record", ["title"]), hubError("validation", /JSON object expected/));
    await assert.rejects(send(hub, "gate.set", { action: "explode" }), hubError("validation", /action must be one of open, suspend/));
    await assert.rejects(send(hub, "grant.create", { provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 9 }), hubError("validation", /maxAttempts must be <= 5/));
    await assert.rejects(send(hub, "mission.create", { projectId: "prj_x", kind: "unknown_kind", title: "Valid title", objective: "Valid objective" }), hubError("validation", /kind must be one of/));
    await assert.rejects(send(hub, "task.command", { taskId: "task_x", action: "queue", evidence: "not an object" }), hubError("validation", /evidence must be an object/));
    assert.equal(countRows(hub, "commands"), commandsBefore);
    assert.equal(hub.bus.lastSeq(), seq, "a rejected payload appends no event");
    assert.equal(countRows(hub, "decisions"), 0);
    assert.equal(hub.settings.get("executionGate").status, "suspended");
  } finally { await t.cleanup(); }
});

test("M01-CMD-04 an idempotency key returns the original command; reusing it for another type conflicts", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const payload = { title: "Idempotent decision", decision: "Recorded exactly once" };
    const first = await send(hub, "decision.record", payload, { idempotencyKey: "m01-idem-1" });
    assert.equal(first.command.status, "executed");
    assert.equal(first.command.idempotencyKey, "m01-idem-1");
    assert.equal(first.duplicate, undefined);

    const seq = hub.bus.lastSeq();
    const retry = await send(hub, "decision.record", payload, { idempotencyKey: "m01-idem-1" });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.command.id, first.command.id);
    assert.equal(retry.command.status, "executed");
    assert.deepEqual(retry.result, first.result);
    assert.equal(hub.bus.lastSeq(), seq, "a duplicate appends no event");
    assert.equal(countRows(hub, "decisions"), 1, "the handler ran once");

    await assert.rejects(send(hub, "memory.add", { scope: "GLOBAL", type: "FACT", title: "Other command", body: "Same key, different command type" }, { idempotencyKey: "m01-idem-1" }),
      hubError("conflict", /Idempotency key reused for another command/));
    assert.equal(countRows(hub, "memory_items"), 0);
    assert.deepEqual(hub.commands.list({ limit: 500 }).filter((c) => c.idempotencyKey === "m01-idem-1").map((c) => c.id), [first.command.id]);

    const other = await send(hub, "decision.record", payload, { idempotencyKey: "m01-idem-2" });
    assert.notEqual(other.command.id, first.command.id);
    assert.equal(countRows(hub, "decisions"), 2);
  } finally { await t.cleanup(); }
});

test("M01-CMD-05 every event appended while a command runs carries its correlation id", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const check = (fromSeq, correlationId, label) => {
      const emitted = hub.bus.since(fromSeq, 1000);
      assert.ok(emitted.length >= 2, `${label}: events were appended`);
      for (const event of emitted) assert.equal(event.correlationId, correlationId, `${label}: ${event.type} carries the correlation id`);
      const queried = hub.bus.query({ correlationId, limit: 1000 }).map((e) => e.seq).sort((a, b) => a - b);
      assert.deepEqual(queried, emitted.map((e) => e.seq), `${label}: bus.query({ correlationId }) returns exactly these events`);
      return emitted;
    };

    let seq = hub.bus.lastSeq();
    const created = await send(hub, "mission.create", { projectId: project.id, kind: "development", title: "Correlated mission", objective: "Check the event envelope" });
    assert.equal(created.command.correlationId, created.command.id, "defaults to the command id");
    const missionEvents = check(seq, created.command.correlationId, "mission.create (sync)");
    for (const type of ["command.accepted", "conversation.created", "mission.created", "mission.linked", "command.executed"]) assert.ok(missionEvents.some((e) => e.type === type), type);
    assert.equal(missionEvents.find((e) => e.type === "mission.created").missionId, created.result.id);

    seq = hub.bus.lastSeq();
    const stopped = await send(hub, "system.stop_all", { reason: "Correlation check" }, { correlationId: "corr-m01-stop" });
    assert.equal(stopped.command.correlationId, "corr-m01-stop");
    assert.notEqual(stopped.command.id, "corr-m01-stop");
    const stopEvents = check(seq, "corr-m01-stop", "system.stop_all (async)");
    for (const type of ["command.accepted", "settings.changed", "system.stop_all", "command.executed"]) assert.ok(stopEvents.some((e) => e.type === type), type);

    seq = hub.bus.lastSeq();
    await assert.rejects(send(hub, "mode.set", { mode: "LIVE_VALIDATION" }), hubError("validation", /Type LIVE_VALIDATION to confirm/));
    const failed = hub.commands.list({ type: "mode.set" })[0];
    assert.deepEqual(check(seq, failed.correlationId, "failed command").map((e) => e.type), ["command.accepted", "command.failed"]);

    registerConnectorWrite(hub);
    seq = hub.bus.lastSeq();
    const pending = await send(hub, "test.connector_write", { connector: "crm", text: "Correlated approval request" });
    assert.deepEqual(check(seq, pending.command.correlationId, "approval-gated command").map((e) => e.type), ["command.accepted", "approval.requested"]);
  } finally { await t.cleanup(); }
});

test("M01-CMD-06 an action the policy DENIES is rejected before its handler runs, and no rule can unlock it", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    let purchases = 0;
    hub.commands.register("test.buy_credits", { describe: "Test-only credit purchase", schema: { amount: { type: "integer", required: true, min: 1 } },
      action: () => ({ actionKind: "billing.purchase_credits", target: "provider:billing" }),
      execute: () => { purchases += 1; return { bought: true }; } });

    const seq = hub.bus.lastSeq();
    let refusal = null;
    await assert.rejects(send(hub, "test.buy_credits", { amount: 10 }), (error) => { refusal = error; return hubError("policy")(error); });
    assert.equal(purchases, 0);
    assert.equal(refusal.status, 403);
    assert.equal(refusal.details.policy.decision, "deny");
    const row = hub.commands.get(refusal.details.commandId);
    assert.equal(row.status, "rejected");
    assert.equal(row.error, refusal.message);
    assert.ok(row.finishedAt);
    assert.equal(row.policy.actionKind, "billing.purchase_credits");
    assert.equal(row.policy.policy, "DENIED");
    assert.equal(row.policy.locked, true);
    const emitted = hub.bus.since(seq);
    assert.deepEqual(emitted.map((e) => e.type), ["command.accepted", "command.rejected"]);
    assert.ok(emitted.every((e) => e.correlationId === row.correlationId));
    assert.equal(hub.approvals.list().length, 0, "a denied action never becomes an approval request");

    await assert.rejects(send(hub, "policy.set_rule", { actionKind: "billing.purchase_credits", policy: "ALWAYS_ASK", reason: "Try to unlock purchases" }), hubError("policy", /fixed by the Hub policy/));
    await assert.rejects(send(hub, "test.buy_credits", { amount: 1 }), hubError("policy"));
    assert.equal(purchases, 0);
    assert.equal(hub.commands.list({ type: "test.buy_credits", status: "rejected" }).length, 2);
  } finally { await t.cleanup(); }
});

test("M01-CMD-07 an ALWAYS_ASK action waits for an approval bound to its exact payload and runs once after approval", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const calls = registerConnectorWrite(hub);
    const payload = { connector: "crm", text: "Follow-up note for the client" };
    const pending = await send(hub, "test.connector_write", payload, { intentText: "write a follow-up note" });
    assert.equal(pending.approvalRequired, true);
    assert.equal(calls.length, 0);
    const { command, approval } = pending;
    assert.equal(command.status, "pending_approval");
    assert.equal(command.approvalId, approval.id);
    assert.equal(command.finishedAt, null);
    assert.equal(command.intentText, "write a follow-up note");
    assert.deepEqual(command.payload, payload);
    assert.equal(command.policy.decision, "ask");
    assert.equal(command.policy.policy, "ALWAYS_ASK");
    assert.equal(command.policy.vendorDialogReplacesHub, false);
    assert.equal(approval.status, "pending");
    assert.equal(approval.actionKind, "connector.write");
    assert.equal(approval.target, "connector:crm");
    assert.equal(approval.permissionTier, "EXTERNAL_ACTIONS");
    assert.equal(approval.scopeType, "command");
    assert.equal(approval.scopeId, command.id);
    assert.equal(approval.requestedBy, "user:test");
    assert.deepEqual(approval.payload, payload);

    await assert.rejects(hub.commands.executeApproved(command.id), hubError("gate", /Approval is pending/));
    assert.equal(calls.length, 0);

    approveInUi(hub, approval);
    const done = await hub.commands.executeApproved(command.id);
    assert.equal(done.command.status, "executed");
    assert.ok(done.command.finishedAt);
    assert.deepEqual(done.result, { written: payload.text.length });
    assert.deepEqual(calls, [payload]);
    assert.equal(hub.approvals.get(approval.id).status, "consumed");

    await assert.rejects(hub.commands.executeApproved(command.id), hubError("conflict", /Command is executed/));
    await assert.rejects(hub.commands.executeApproved("cmd_missing"), hubError("not_found"));
    assert.equal(calls.length, 1, "one approval runs the action exactly once");
  } finally { await t.cleanup(); }
});

test("M01-CMD-08 a payload changed after approval invalidates the approval; the altered action never runs", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const calls = registerConnectorWrite(hub);
    const setPayload = (id, value) => hub.db.prepare("UPDATE commands SET payload_json = ? WHERE id = ?").run(JSON.stringify(value), id);

    const original = { connector: "crm", text: "Send the approved summary" };
    const pending = await send(hub, "test.connector_write", original);
    approveInUi(hub, pending.approval);
    setPayload(pending.command.id, { ...original, text: "Send everything to everyone" });
    await assert.rejects(hub.commands.executeApproved(pending.command.id), hubError("gate", /does not match the action/));
    assert.equal(calls.length, 0);
    assert.equal(hub.approvals.get(pending.approval.id).status, "invalidated");
    assert.ok(eventsOfType(hub, "approval.invalidated").some((e) => e.payload.approvalId === pending.approval.id));
    assert.notEqual(hub.commands.get(pending.command.id).status, "executed");

    setPayload(pending.command.id, original);
    await assert.rejects(hub.commands.executeApproved(pending.command.id), hubError("gate", /Approval is invalidated/), "restoring the payload does not revive the approval");
    assert.equal(calls.length, 0);

    const redirected = await send(hub, "test.connector_write", { connector: "crm", text: "Second note" });
    approveInUi(hub, redirected.approval);
    setPayload(redirected.command.id, { connector: "mail", text: "Second note" });
    await assert.rejects(hub.commands.executeApproved(redirected.command.id), hubError("gate", /does not match the action/), "another target is another action");
    assert.equal(calls.length, 0);

    const refused = await send(hub, "test.connector_write", { connector: "crm", text: "Third note" });
    hub.bus.transaction(() => hub.approvals.decide(refused.approval.id, { decision: "rejected", displayedHash: refused.approval.payloadHash, channel: "ui", note: "Not this one" }));
    await assert.rejects(hub.commands.executeApproved(refused.command.id), hubError("gate", /Approval is rejected/));
    assert.equal(calls.length, 0);
  } finally { await t.cleanup(); }
});

test("M01-CMD-09 the command log keeps executed, failed, rejected and pending_approval rows", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    registerConnectorWrite(hub);
    hub.commands.register("test.extra_usage", { schema: {}, action: () => ({ actionKind: "billing.enable_extra_usage", target: "provider:billing" }), execute: () => ({}) });

    const executed = await send(hub, "decision.record", { title: "Keep V1 running", decision: "V1 stays on 3004 during the rebuild", rationale: "Rollback path" }, { intentText: "record the decision" });
    await assert.rejects(send(hub, "mode.set", { mode: "LIVE_VALIDATION", confirm: "nope" }), hubError("validation"));
    await assert.rejects(send(hub, "test.extra_usage", {}), hubError("policy"));
    const pending = await send(hub, "test.connector_write", { connector: "crm", text: "Pending note" });

    const byStatus = (status) => hub.commands.list({ status });
    assert.deepEqual(byStatus("executed").map((c) => c.type), ["decision.record"]);
    assert.deepEqual(byStatus("failed").map((c) => c.type), ["mode.set"]);
    assert.deepEqual(byStatus("rejected").map((c) => c.type), ["test.extra_usage"]);
    assert.deepEqual(byStatus("pending_approval").map((c) => c.type), ["test.connector_write"]);
    assert.equal(byStatus("accepted").length, 0, "no command is left half-processed");

    const row = hub.commands.get(executed.command.id);
    assert.equal(row.actor, "user");
    assert.equal(row.channel, "test");
    assert.equal(row.intentText, "record the decision");
    assert.deepEqual(row.payload, { title: "Keep V1 running", decision: "V1 stays on 3004 during the rebuild", rationale: "Rollback path" });
    assert.equal(row.policy.decision, "allow");
    assert.equal(row.policy.policy, "AUTO_ALLOWED");
    assert.ok(row.result.id);
    assert.deepEqual(row.result, executed.result);
    assert.equal(row.error, null);
    assert.ok(row.finishedAt);
    assert.equal(row.correlationId, row.id);

    const [failed] = byStatus("failed");
    assert.match(failed.error, /Type LIVE_VALIDATION to confirm/);
    assert.ok(failed.finishedAt);
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE", "a failed command leaves no partial state");
    const [rejected] = byStatus("rejected");
    assert.equal(rejected.policy.decision, "deny");
    assert.ok(rejected.error);
    const [waiting] = byStatus("pending_approval");
    assert.equal(waiting.approvalId, pending.approval.id);
    assert.equal(waiting.finishedAt, null);
    assert.equal(countRows(hub, "decisions"), 1);
  } finally { await t.cleanup(); }
});

test("M01-CMD-10 events appended while an approved command is executed keep the command's correlation id", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    registerConnectorWrite(hub);
    const pending = await send(hub, "test.connector_write", { connector: "crm", text: "Correlated write" });
    approveInUi(hub, pending.approval);
    const seq = hub.bus.lastSeq();
    await hub.commands.executeApproved(pending.command.id);
    const emitted = hub.bus.since(seq);
    for (const type of ["approval.consumed", "test.connector_written", "command.executed"]) assert.ok(emitted.some((e) => e.type === type), type);
    for (const event of emitted) assert.equal(event.correlationId, pending.command.correlationId, `${event.type} carries the command's correlation id`);
  } finally { await t.cleanup(); }
});

test("M01-CMD-11 an approved command runs with its exact payload even when a field name looks sensitive to the log redactor", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const calls = registerConnectorWrite(hub);
    const payload = { connector: "crm", text: "Summarize the meeting", maxTokens: 800 };
    const pending = await send(hub, "test.connector_write", payload);
    assert.deepEqual(pending.approval.payload, payload, "the user approves the real payload");
    approveInUi(hub, pending.approval);
    const done = await hub.commands.executeApproved(pending.command.id);
    assert.equal(done.command.status, "executed");
    assert.deepEqual(calls, [payload]);
    assert.equal(hub.approvals.get(pending.approval.id).status, "consumed");
  } finally { await t.cleanup(); }
});

test("M01-CMD-12 ASK_ONCE_FOR_TASK through the command bus: one approval per task, then automatic until the task ends", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, tasks: [plan, build] } = await missionWithTasks(hub);
    const reads = [];
    hub.commands.register("test.connector_read", { describe: "Test-only connector read bound to a task", schema: { taskId: { required: true }, query: { required: true, max: 200 } },
      action: (input) => ({ actionKind: "connector.read", target: "connector:drive", taskId: input.taskId, projectId: project.id }),
      execute: (input) => { reads.push(input.query); return { rows: 3 }; } });

    const first = await send(hub, "test.connector_read", { taskId: plan.id, query: "quarterly report" });
    assert.equal(first.approvalRequired, true);
    assert.equal(first.command.policy.policy, "ASK_ONCE_FOR_TASK");
    assert.equal(first.approval.scopeType, "task");
    assert.equal(first.approval.scopeId, plan.id);
    assert.equal(first.approval.permissionTier, "READ_ONLY");
    approveInUi(hub, first.approval);
    assert.equal((await hub.commands.executeApproved(first.command.id)).command.status, "executed");
    const scopes = hub.policy.list().activeTaskScopes;
    assert.equal(scopes.length, 1);
    const [scope] = scopes;
    assert.equal(scope.task_id, plan.id);
    assert.equal(scope.action_kind, "connector.read");
    assert.equal(scope.target, "connector:drive");
    assert.equal(scope.approval_id, first.approval.id);

    const second = await send(hub, "test.connector_read", { taskId: plan.id, query: "budget sheet" });
    assert.equal(second.approvalRequired, undefined);
    assert.equal(second.command.status, "executed");
    assert.equal(second.command.policy.decision, "allow");
    assert.equal(second.command.policy.scopeId, scope.id);
    assert.deepEqual(reads, ["quarterly report", "budget sheet"]);
    assert.equal(hub.approvals.list().length, 1, "no second approval inside the same task");

    const otherTask = await send(hub, "test.connector_read", { taskId: build.id, query: "another task" });
    assert.equal(otherTask.approvalRequired, true, "the consent does not leak to another task");

    await send(hub, "task.command", { taskId: plan.id, action: "cancel", reason: "No longer needed" });
    assert.equal(scopeRow(hub, scope.id).status, "revoked");
    const afterCancel = await send(hub, "test.connector_read", { taskId: plan.id, query: "after cancel" });
    assert.equal(afterCancel.approvalRequired, true);
    assert.deepEqual(reads, ["quarterly report", "budget sheet"]);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- approval policy engine

test("M01-POL-01 catalog defaults: reads are automatic, provider commands always ask, billing is denied and locked", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const evaluate = (actionKind, extra = {}) => hub.policy.evaluate({ actionKind, surfaceId: CODEX_SURFACE, projectId: project.id, ...extra });

    const read = evaluate("files.read");
    assert.equal(read.policy, "AUTO_ALLOWED");
    assert.equal(read.decision, "allow");
    assert.equal(read.source, "catalog");
    assert.equal(read.tier, "READ_ONLY");
    const command = evaluate("provider.command");
    assert.equal(command.policy, "ALWAYS_ASK");
    assert.equal(command.decision, "ask");
    assert.equal(command.tier, "DEVELOPMENT_TOOLS");
    assert.equal(evaluate("provider.command", { taskId: "task_any", target: project.path }).decision, "ask", "ALWAYS_ASK also asks inside a task");

    const billing = ACTION_CATALOG.filter((a) => a.actionKind.startsWith("billing.")).map((a) => a.actionKind);
    assert.deepEqual(billing.sort(), ["billing.enable_extra_usage", "billing.paid_api_route", "billing.plan_upgrade", "billing.purchase_credits"]);
    for (const actionKind of [...billing, "credentials.enter"]) {
      const decision = evaluate(actionKind);
      assert.equal(decision.policy, "DENIED", actionKind);
      assert.equal(decision.decision, "deny", actionKind);
      assert.equal(decision.locked, true, actionKind);
    }

    assert.deepEqual([...APPROVAL_POLICIES], STRICTNESS_ORDER);
    for (const entry of ACTION_CATALOG) {
      assert.ok(STRICTNESS_ORDER.indexOf(entry.policy) >= STRICTNESS_ORDER.indexOf(entry.loosest), `${entry.actionKind}: default ${entry.policy} is looser than its floor ${entry.loosest}`);
      assert.equal(evaluate(entry.actionKind).vendorDialogReplacesHub, false, entry.actionKind);
      assert.equal(evaluate(entry.actionKind, { taskId: "task_any" }).vendorDialogReplacesHub, false, entry.actionKind);
    }
    assert.equal(evaluate("never.heard.of").vendorDialogReplacesHub, false);
  } finally { await t.cleanup(); }
});

test("M01-POL-02 rules can tighten but never loosen past the catalog floor; locked and unknown kinds cannot be changed", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const setRule = (rule) => hub.bus.transaction(() => hub.policy.setRule({ reason: "M01 policy test", ...rule }, "test"));

    assert.throws(() => setRule({ actionKind: "provider.command", policy: "AUTO_ALLOWED" }), hubError("policy", /cannot be looser than ASK_ONCE_FOR_TASK/));
    assert.throws(() => setRule({ actionKind: "connector.write", policy: "ASK_ONCE_FOR_TASK" }), hubError("policy", /cannot be looser than ALWAYS_ASK/));
    assert.throws(() => setRule({ actionKind: "git.push", surfaceId: CODEX_SURFACE, projectId: project.id, policy: "AUTO_ALLOWED" }), hubError("policy", /cannot be looser than ALWAYS_ASK/));
    for (const policy of APPROVAL_POLICIES) {
      assert.throws(() => setRule({ actionKind: "billing.purchase_credits", policy }), hubError("policy", /fixed by the Hub policy/), policy);
      assert.throws(() => setRule({ actionKind: "credentials.enter", policy }), hubError("policy", /fixed by the Hub policy/), policy);
    }
    assert.throws(() => setRule({ actionKind: "made.up.kind", policy: "DENIED" }), hubError("validation", /Unknown action kind/));
    assert.throws(() => setRule({ actionKind: "files.read", policy: "SOMETIMES" }), hubError("validation", /Unknown approval policy/));
    assert.throws(() => setRule({ actionKind: "files.read", policy: "DENIED", reason: " " }), hubError("validation", /needs a reason/));
    assert.equal(hub.policy.list().rules.length, 0, "nothing was stored");

    await assert.rejects(send(hub, "policy.set_rule", { actionKind: "provider.command", policy: "AUTO_ALLOWED", reason: "Loosen it" }), hubError("policy", /cannot be looser/));
    await assert.rejects(send(hub, "policy.set_rule", { actionKind: "billing.enable_extra_usage", policy: "ALWAYS_ASK", reason: "Unlock it" }), hubError("policy", /fixed by the Hub policy/));
    await assert.rejects(send(hub, "policy.set_rule", { actionKind: "provider.command", policy: "NEVER", reason: "Bad value" }), hubError("validation", /policy must be one of/));
    assert.equal(hub.commands.list({ type: "policy.set_rule", status: "failed" }).length, 2);
    assert.equal(hub.policy.list().rules.length, 0);

    const once = await send(hub, "policy.set_rule", { actionKind: "provider.command", policy: "ASK_ONCE_FOR_TASK", reason: "One consent per task" });
    assert.equal(once.result.policy, "ASK_ONCE_FOR_TASK");
    assert.equal(hub.policy.resolve({ actionKind: "provider.command" }).policy, "ASK_ONCE_FOR_TASK");
    const again = await send(hub, "policy.set_rule", { actionKind: "provider.command", policy: "ALWAYS_ASK", reason: "Back to every time" });
    assert.equal(again.result.id, once.result.id, "same key updates the rule in place");
    assert.equal(again.result.version, 2);
    const frozen = await send(hub, "policy.set_rule", { actionKind: "files.read", projectId: project.id, policy: "DENIED", reason: "Freeze reads for this project" });
    const denied = hub.policy.evaluate({ actionKind: "files.read", projectId: project.id });
    assert.equal(denied.decision, "deny");
    assert.equal(denied.locked, false);
    assert.equal(denied.ruleId, frozen.result.id);
    assert.equal(hub.policy.evaluate({ actionKind: "files.read", projectId: "prj_other" }).decision, "allow");
    await send(hub, "policy.remove_rule", { ruleId: frozen.result.id });
    const restored = hub.policy.evaluate({ actionKind: "files.read", projectId: project.id });
    assert.equal(restored.decision, "allow");
    assert.equal(restored.source, "catalog");

    const now = new Date().toISOString();
    const forge = hub.db.prepare("INSERT INTO approval_policies (id, action_kind, surface_id, project_id, policy, reason, source, created_at, updated_at) VALUES (?, ?, '*', '*', 'AUTO_ALLOWED', 'forged', 'user', ?, ?)");
    forge.run("pol_forged_write", "connector.write", now, now);
    forge.run("pol_forged_billing", "billing.purchase_credits", now, now);
    const clamped = hub.policy.evaluate({ actionKind: "connector.write" });
    assert.equal(clamped.policy, "ALWAYS_ASK", "a too-loose stored rule is clamped to the floor");
    assert.equal(clamped.decision, "ask");
    assert.equal(clamped.ruleId, "pol_forged_write");
    const locked = hub.policy.evaluate({ actionKind: "billing.purchase_credits" });
    assert.equal(locked.decision, "deny", "locked kinds ignore stored rules");
    assert.equal(locked.source, "catalog");
    assert.equal(locked.ruleId, null);
  } finally { await t.cleanup(); }
});

test("M01-POL-03 the most specific rule wins: surface+project, then surface, then project, then global", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const P = hub.projects.hub().id;
    const rule = async (scope, policy) => (await send(hub, "policy.set_rule", { actionKind: "connector.read", reason: `Specificity ${policy}`, policy, ...scope })).result;
    const global = await rule({}, "AUTO_ALLOWED");
    const byProject = await rule({ projectId: P }, "ALWAYS_ASK");
    const bySurface = await rule({ surfaceId: CLAUDE_SURFACE }, "DENIED");
    const exact = await rule({ surfaceId: CLAUDE_SURFACE, projectId: P }, "ASK_ONCE_FOR_TASK");
    const at = (surfaceId, projectId) => hub.policy.evaluate({ actionKind: "connector.read", surfaceId, projectId });
    const cases = [
      [CLAUDE_SURFACE, P, exact, "ASK_ONCE_FOR_TASK"],
      [CLAUDE_SURFACE, "prj_other", bySurface, "DENIED"],
      [CODEX_SURFACE, P, byProject, "ALWAYS_ASK"],
      [CODEX_SURFACE, "prj_other", global, "AUTO_ALLOWED"],
      ["*", "*", global, "AUTO_ALLOWED"],
    ];
    for (const [surfaceId, projectId, expectedRule, expectedPolicy] of cases) {
      const decision = at(surfaceId, projectId);
      assert.equal(decision.ruleId, expectedRule.id, `${surfaceId} / ${projectId}`);
      assert.equal(decision.policy, expectedPolicy, `${surfaceId} / ${projectId}`);
      assert.equal(decision.source, "user");
    }
    await send(hub, "policy.remove_rule", { ruleId: exact.id });
    assert.equal(at(CLAUDE_SURFACE, P).ruleId, bySurface.id, "without the exact rule the surface rule is next");
  } finally { await t.cleanup(); }
});

test("M01-POL-04 an unknown action kind falls back to ALWAYS_ASK, also through the command bus", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const decision = hub.policy.evaluate({ actionKind: "quantum.teleport", surfaceId: CODEX_SURFACE, projectId: "prj_x", taskId: null });
    assert.equal(decision.policy, "ALWAYS_ASK");
    assert.equal(decision.decision, "ask");
    assert.equal(decision.source, "fallback");
    assert.equal(decision.tier, "SENSITIVE_ACTIONS");
    assert.equal(decision.locked, false);
    assert.equal(decision.vendorDialogReplacesHub, false);

    const now = new Date().toISOString();
    hub.db.prepare("INSERT INTO approval_policies (id, action_kind, surface_id, project_id, policy, reason, source, created_at, updated_at) VALUES ('pol_unknown', 'quantum.teleport', '*', '*', 'AUTO_ALLOWED', 'forged', 'user', ?, ?)").run(now, now);
    const forged = hub.policy.evaluate({ actionKind: "quantum.teleport" });
    assert.equal(forged.policy, "ALWAYS_ASK", "a stored rule cannot loosen an unknown kind");
    assert.equal(forged.decision, "ask");

    let ran = 0;
    hub.commands.register("test.unknown_action", { schema: {}, action: () => ({ actionKind: "quantum.teleport", target: "somewhere" }), execute: () => { ran += 1; return {}; } });
    const pending = await send(hub, "test.unknown_action", {});
    assert.equal(pending.approvalRequired, true);
    assert.equal(pending.approval.permissionTier, "SENSITIVE_ACTIONS");
    assert.equal(ran, 0);
  } finally { await t.cleanup(); }
});

test("M01-POL-05 ASK_ONCE_FOR_TASK asks without a task, asks once per task, then allows until the scope ends", async () => {
  let offsetMs = 0;
  const t = await makeTestHub({ clock: () => new Date(Date.now() + offsetMs) });
  try {
    const { hub } = t;
    const { project, tasks: [plan, build] } = await missionWithTasks(hub);
    await send(hub, "policy.set_rule", { actionKind: "provider.command", projectId: project.id, policy: "ASK_ONCE_FOR_TASK", reason: "One consent per task" });
    const evaluate = (extra = {}) => hub.policy.evaluate({ actionKind: "provider.command", surfaceId: CODEX_SURFACE, projectId: project.id, target: project.path, ...extra });
    const grant = (extra = {}) => hub.bus.transaction(() => hub.policy.grantTaskScope({ taskId: plan.id, actionKind: "provider.command", target: project.path, surfaceId: CODEX_SURFACE, approvalId: "apr_m01_once", ...extra }));

    const noTask = evaluate();
    assert.equal(noTask.policy, "ASK_ONCE_FOR_TASK");
    assert.equal(noTask.decision, "ask");
    assert.equal(evaluate({ taskId: plan.id }).decision, "ask", "first action of its kind in the task");

    const scopeId = grant();
    const allowed = evaluate({ taskId: plan.id });
    assert.equal(allowed.decision, "allow");
    assert.equal(allowed.scopeId, scopeId);
    assert.match(allowed.reason, /apr_m01_once/);
    assert.equal(allowed.vendorDialogReplacesHub, false);
    assert.equal(evaluate().decision, "ask", "still asks outside a task");
    assert.equal(evaluate({ taskId: build.id }).decision, "ask", "bound to the task");
    assert.equal(evaluate({ taskId: plan.id, target: `${project.path}-elsewhere` }).decision, "ask", "bound to the target");
    assert.equal(evaluate({ taskId: plan.id, surfaceId: CLAUDE_SURFACE }).decision, "ask", "bound to the surface");
    assert.equal(evaluate({ taskId: plan.id, projectId: "prj_other" }).decision, "ask", "the project rule does not apply elsewhere");

    const anySurface = grant({ taskId: build.id, surfaceId: "*" });
    assert.equal(evaluate({ taskId: build.id, surfaceId: CLAUDE_SURFACE }).scopeId, anySurface, "a '*' scope covers every surface of the task");

    const renewed = grant();
    assert.notEqual(renewed, scopeId);
    assert.equal(scopeRow(hub, scopeId).status, "expired", "one active scope per task/action/target/surface");
    assert.equal(evaluate({ taskId: plan.id }).scopeId, renewed);

    offsetMs = 8 * 3600000 + 60000;
    assert.equal(evaluate({ taskId: plan.id }).decision, "ask", "a scope expires after its TTL");
    offsetMs = 0;
    assert.equal(evaluate({ taskId: plan.id }).decision, "allow");

    assert.equal(hub.bus.transaction(() => hub.policy.revokeTaskScopes(plan.id, "test revocation")), 1);
    assert.equal(evaluate({ taskId: plan.id }).decision, "ask");
    assert.equal(evaluate({ taskId: build.id }).decision, "allow", "other tasks keep their scopes");
  } finally { await t.cleanup(); }
});

test("M01-POL-06 task scopes are revoked when the task completes, is cancelled or fails, and by runs.stopAll", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, tasks: [plan, build, review, qa] } = await missionWithTasks(hub);
    await send(hub, "policy.set_rule", { actionKind: "provider.command", policy: "ASK_ONCE_FOR_TASK", reason: "One consent per task" });
    const move = (taskId, to) => hub.bus.transaction(() => transitionTask(hub.db, hub.bus, hub.config.now, { taskId, to, reason: `M01 simulated ${to}`, actor: "test" }));
    const grant = (taskId, target = project.path) => hub.bus.transaction(() => hub.policy.grantTaskScope({ taskId, actionKind: "provider.command", target, surfaceId: "*", approvalId: `apr_${taskId}` }));
    const decisionFor = (taskId, target = project.path) => hub.policy.evaluate({ actionKind: "provider.command", surfaceId: CODEX_SURFACE, projectId: project.id, taskId, target }).decision;
    const revocations = (taskId) => eventsOfType(hub, "policy.task_scopes_revoked", { taskId });

    const planScope = grant(plan.id);
    const buildScope = grant(build.id);
    await send(hub, "task.command", { taskId: plan.id, action: "queue" });
    move(plan.id, "RUNNING");
    move(plan.id, "VERIFYING");
    assert.equal(decisionFor(plan.id), "allow", "VERIFYING does not end the consent");
    await send(hub, "task.command", { taskId: plan.id, action: "verify", evidence: { manualVerification: "Checked the plan against every criterion" } });
    assert.equal(hub.missions.task(plan.id).status, "COMPLETED");
    assert.equal(scopeRow(hub, planScope).status, "revoked");
    assert.ok(scopeRow(hub, planScope).revoked_at);
    assert.equal(decisionFor(plan.id), "ask");
    assert.equal(revocations(plan.id).length, 1);
    assert.equal(revocations(plan.id)[0].payload.count, 1);
    assert.match(revocations(plan.id)[0].payload.reason, /completed/);
    assert.equal(scopeRow(hub, buildScope).status, "active", "other tasks keep their scopes");

    await send(hub, "task.command", { taskId: build.id, action: "cancel", reason: "Superseded by another mission" });
    assert.equal(scopeRow(hub, buildScope).status, "revoked");
    assert.match(revocations(build.id)[0].payload.reason, /cancelled/);
    assert.equal(decisionFor(build.id), "ask");

    const reviewScope = grant(review.id);
    move(review.id, "PLANNING");
    move(review.id, "FAILED");
    assert.equal(scopeRow(hub, reviewScope).status, "revoked");

    const qaScopes = [grant(qa.id), grant(qa.id, `${project.path}/packages`)];
    assert.equal(decisionFor(qa.id), "allow");
    const stop = await hub.runs.stopAll("test", "M01 Stop All");
    assert.equal(stop.gate, "suspended");
    for (const id of qaScopes) assert.equal(scopeRow(hub, id).status, "revoked");
    const systemRevocation = eventsOfType(hub, "policy.task_scopes_revoked").find((e) => e.scopeType === "system");
    assert.equal(systemRevocation.payload.count, 2);
    assert.equal(systemRevocation.payload.reason, "M01 Stop All");
    assert.equal(hub.policy.list().activeTaskScopes.length, 0);
    assert.equal(decisionFor(qa.id), "ask");
  } finally { await t.cleanup(); }
});

test("M01-POL-07 diagnostics: bus.query typePrefix finds policy events whose type contains an underscore", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, tasks: [plan] } = await missionWithTasks(hub);
    hub.bus.transaction(() => hub.policy.grantTaskScope({ taskId: plan.id, actionKind: "provider.command", target: project.path, surfaceId: "*", approvalId: "apr_m01_diag" }));
    assert.equal(eventsOfType(hub, "policy.task_scope_granted").length, 1, "the event exists");
    const byPrefix = hub.bus.query({ typePrefix: "policy.task_scope_granted" });
    assert.deepEqual(byPrefix.map((e) => e.type), ["policy.task_scope_granted"]);
    assert.equal(byPrefix[0].taskId, plan.id);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- integration with a run (fake Codex)

test("M01-RUN-01 ASK_ONCE_FOR_TASK in a run: one approval via approval.decide, the next run of the task is allowed automatically", async () => {
  const t = await makeTestHub({ codex: "approval" });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { provider: "codex", attempts: 3 });
    const rule = await send(hub, "policy.set_rule", { actionKind: "provider.command", projectId: project.id, policy: "ASK_ONCE_FOR_TASK", reason: "One consent per task for this project" });
    assert.equal(rule.result.projectId, project.id);
    const { result: mission } = await send(hub, "mission.create", { projectId: project.id, kind: "development", title: "Ask once mission", objective: "Run the test suite twice on one task" });
    const [plan] = hub.missions.tasks(mission.id);
    await send(hub, "task.command", { taskId: plan.id, action: "queue" });
    await send(hub, "conversation.message", { conversationId: mission.conversationId, content: "Run the tests", clientMessageId: "m01-run-1" });

    const first = await hub.runs.start({ conversationId: mission.conversationId, provider: "codex", taskId: plan.id, stage: plan.stage, roleId: plan.roleId });
    const approval = await waitFor(() => hub.approvals.list("pending").find((a) => a.scopeType === "run" && a.scopeId === first.run.id), 20000);
    assert.equal(approval.actionKind, "provider.command");
    assert.equal(approval.target, project.path);
    assert.equal(approval.payload.command, "npm test");
    assert.equal(hub.missions.task(plan.id).status, "WAITING_APPROVAL");
    assert.equal(hub.runs.getRun(first.run.id).status, "waiting_approval");
    assert.equal(hub.policy.list().activeTaskScopes.length, 0, "nothing is granted before the decision");

    const decided = await hub.commands.dispatch({ type: "approval.decide", channel: "test", actor: "user",
      payload: { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash } });
    assert.equal(decided.command.status, "executed");
    const scopes = hub.policy.list().activeTaskScopes;
    assert.equal(scopes.length, 1, "the approval opened a task scope");
    const [scope] = scopes;
    assert.equal(scope.task_id, plan.id);
    assert.equal(scope.action_kind, "provider.command");
    assert.equal(scope.target, project.path);
    assert.equal(scope.surface_id, CODEX_SURFACE);
    assert.equal(scope.approval_id, approval.id);
    const decideEvents = hub.bus.query({ correlationId: decided.command.correlationId, limit: 500 }).map((e) => e.type);
    for (const type of ["command.accepted", "approval.approved", "approval.consumed", "policy.task_scope_granted", "command.executed"]) assert.ok(decideEvents.includes(type), type);

    const run1 = await finished(hub, first.run.id);
    assert.equal(run1.status, "completed");
    assert.equal(hub.approvals.get(approval.id).status, "consumed");
    assert.equal(hub.missions.task(plan.id).status, "VERIFYING");

    await send(hub, "task.command", { taskId: plan.id, action: "reject", reason: "Run the suite once more" });
    await send(hub, "conversation.message", { conversationId: mission.conversationId, content: "Run the tests again", clientMessageId: "m01-run-2" });
    const approvalsBefore = hub.approvals.list().length;
    const second = await hub.runs.start({ conversationId: mission.conversationId, provider: "codex", taskId: plan.id, stage: plan.stage, roleId: plan.roleId });
    const run2 = await finished(hub, second.run.id);
    assert.equal(run2.status, "completed");
    const allowed = eventsOfType(hub, "approval.policy_allowed", { runId: second.run.id });
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].payload.actionKind, "provider.command");
    assert.equal(allowed[0].payload.policy, "ASK_ONCE_FOR_TASK");
    assert.equal(allowed[0].payload.scopeId, scope.id);
    assert.equal(hub.approvals.list().length, approvalsBefore, "no new approval inside the same task");
    assert.equal(hub.approvals.list("pending").length, 0);
    assert.equal(hub.missions.transitions(plan.id).filter((tr) => tr.to_status === "WAITING_APPROVAL").length, 1, "the second run never waited");
    assert.equal(scopeRow(hub, scope.id).uses, 1);
    assert.deepEqual(t.readLog("codex").filter((e) => e.approvalReply).map((e) => e.approvalReply.decision), ["accept", "accept"]);

    const stop = await send(hub, "system.stop_all", { reason: "M01 end of run test" });
    assert.equal(stop.result.gate, "suspended");
    assert.equal(scopeRow(hub, scope.id).status, "revoked");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- HTTP adapter

test("M01-HTTP-01 POST /api/commands requires the session token and records the command", async () => {
  const s = await startServer();
  try {
    const { hub } = s;
    const body = { type: "decision.record", payload: { title: "HTTP decision", decision: "Recorded through the command endpoint" }, intentText: "record a decision" };
    const commandsBefore = countRows(hub, "commands");
    const missing = await request(s.port, { method: "POST", path: "/api/commands", body });
    assert.equal(missing.status, 403);
    assert.equal(missing.json.error.category, "policy");
    const forged = await request(s.port, { method: "POST", path: "/api/commands", headers: { "X-Hub-Token": "f".repeat(64) }, body });
    assert.equal(forged.status, 403);
    assert.equal(countRows(hub, "commands"), commandsBefore, "nothing is recorded without the token");
    assert.equal(countRows(hub, "decisions"), 0);

    const headers = { "X-Hub-Token": s.token, "Idempotency-Key": "m01-http-1" };
    const ok = await request(s.port, { method: "POST", path: "/api/commands", headers, body });
    assert.equal(ok.status, 200, ok.text);
    const { command, result } = ok.json;
    assert.equal(command.type, "decision.record");
    assert.equal(command.status, "executed");
    assert.equal(command.channel, "ui");
    assert.equal(command.actor, "user");
    assert.equal(command.intentText, "record a decision");
    assert.equal(command.idempotencyKey, "m01-http-1");
    assert.deepEqual(hub.commands.get(command.id).result, result);
    assert.equal(countRows(hub, "decisions"), 1);
    const listed = await request(s.port, { path: "/api/commands?type=decision.record" });
    assert.deepEqual(listed.json.commands.map((c) => c.id), [command.id]);

    const retried = await request(s.port, { method: "POST", path: "/api/commands", headers, body });
    assert.equal(retried.status, 200);
    assert.equal(retried.json.duplicate, true);
    assert.equal(retried.json.command.id, command.id);
    assert.equal(countRows(hub, "decisions"), 1);

    const token = { "X-Hub-Token": s.token };
    const unknown = await request(s.port, { method: "POST", path: "/api/commands", headers: token, body: { type: "no.such_command" } });
    assert.equal(unknown.status, 400);
    const invalid = await request(s.port, { method: "POST", path: "/api/commands", headers: token, body: { type: "decision.record", payload: { title: "" } } });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.json.error.details.problems.includes("title is required"));
    assert.equal(hub.commands.list({ type: "decision.record" }).length, 1);
  } finally { await s.stop(); }
});

test("M01-HTTP-02 an approval-gated command over HTTP answers 202 and runs only after the decision with the displayed hash", async () => {
  const s = await startServer();
  try {
    const { hub } = s;
    const calls = registerConnectorWrite(hub);
    const h = { "X-Hub-Token": s.token };
    const payload = { connector: "crm", text: "Send the weekly summary" };
    const accepted = await request(s.port, { method: "POST", path: "/api/commands", headers: h, body: { type: "test.connector_write", payload } });
    assert.equal(accepted.status, 202, accepted.text);
    assert.equal(accepted.json.approvalRequired, true);
    const { command, approval } = accepted.json;
    assert.equal(command.status, "pending_approval");
    assert.equal(command.channel, "ui");

    const early = await request(s.port, { method: "POST", path: `/api/commands/${command.id}/execute`, headers: h, body: {} });
    assert.equal(early.status, 409);
    const wrongHash = await request(s.port, { method: "POST", path: `/api/approvals/${approval.id}/decide`, headers: h, body: { decision: "approved", displayedHash: "0".repeat(64) } });
    assert.equal(wrongHash.status, 409);
    assert.equal(hub.approvals.get(approval.id).status, "pending");
    const decided = await request(s.port, { method: "POST", path: `/api/approvals/${approval.id}/decide`, headers: h, body: { decision: "approved", displayedHash: approval.payloadHash } });
    assert.equal(decided.status, 200, decided.text);
    assert.equal(decided.json.status, "approved");
    const noToken = await request(s.port, { method: "POST", path: `/api/commands/${command.id}/execute`, body: {} });
    assert.equal(noToken.status, 403);
    assert.equal(calls.length, 0);

    const executed = await request(s.port, { method: "POST", path: `/api/commands/${command.id}/execute`, headers: h, body: {} });
    assert.equal(executed.status, 200, executed.text);
    assert.equal(executed.json.command.status, "executed");
    assert.deepEqual(calls, [payload]);
    const twice = await request(s.port, { method: "POST", path: `/api/commands/${command.id}/execute`, headers: h, body: {} });
    assert.equal(twice.status, 409);
    assert.equal(calls.length, 1);
  } finally { await s.stop(); }
});

test("M01-HTTP-03 replaying the idempotency key of a failed command does not answer with success", async () => {
  const s = await startServer();
  try {
    const headers = { "X-Hub-Token": s.token, "Idempotency-Key": "m01-http-mode-1" };
    const first = await request(s.port, { method: "POST", path: "/api/mode", headers, body: { mode: "LIVE_VALIDATION" } });
    assert.equal(first.status, 400);
    assert.equal(s.hub.commands.list({ type: "mode.set" })[0].status, "failed");
    const replay = await request(s.port, { method: "POST", path: "/api/mode", headers, body: { mode: "LIVE_VALIDATION" } });
    assert.ok(replay.status >= 400, `a replayed failure must not look successful (got ${replay.status} ${replay.text})`);
    assert.equal(s.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await s.stop(); }
});
