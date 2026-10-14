// PASS_SIMULATED only: pure recipes, stream events and fake binaries through the real Factory/supervisor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeTurnLaunch, claudeTurnArgs, CLAUDE_GUARD_ENV, createClaudeAdapter, inspectClaudeConfig } from "../server/providers/claude.mjs";
import { wslClaudeLauncher } from "../server/providers/claude-wsl.mjs";
import { buildChildEnv } from "../server/policy/billing.mjs";
import { classifyText } from "../server/providers/classify.mjs";
import { checkSpec, specSummary } from "../server/factory/spec.mjs";
import { parseAuthorOutput, buildAuthorBrief } from "../server/factory/test-first.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";

const ENV_KEY = "CLAUDE_CODE_MAX_OUTPUT_TOKENS";
const limits = { maxOutputTokens: 64000, provenance: "decizia proprietarului 2026-10-13 21:32 UTC: limită de ieșire 64000 doar pentru autorul testului de la pasul 0" };
const cliError = "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.";
const fixture = fileURLToPath(new URL("./fixtures/fake-output.mjs", import.meta.url));
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-output-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const assistant = (stop_reason, output_tokens = 12) => ({ type: "assistant", message: { stop_reason, usage: { output_tokens }, content: [{ type: "thinking", thinking: "not an answer" }] } });
const result = (is_error = false, text = "") => ({ type: "result", is_error, result: text });
async function stream(t, events, options = {}) {
  const homeDir = options.homeDir || temp(t);
  const host = { environment: options.environment || "windows", resolve: () => ({ executable: "fake", prefixArgs: [] }), startupProblem: () => null, fallbackModelSet: () => false,
    outputTokenLimitOverride: () => inspectClaudeConfig(homeDir).outputTokenLimitOverride,
    deniedReads: () => [], spawn: ({ binary, args, cwd }) => ({ executable: binary.executable, args, cwd, env: CLAUDE_GUARD_ENV }) };
  const supervisor = { start(spec) {
    const exit = Promise.resolve().then(() => {
      spec.onStdoutLine(JSON.stringify({ type: "system", subtype: "init", apiKeySource: "none", tools: [], mcp_servers: [] }));
      for (const event of events) spec.onStdoutLine(JSON.stringify(event));
      return { code: 0 };
    });
    return { exit, stderrTail: options.stderr ? [options.stderr] : [], child: { stdin: { write() {}, end() {} } } };
  }, forget() {}, stop: async () => ({ stopped: true }) };
  return createClaudeAdapter({ config: {}, supervisor, launcher: host, homeDir }).startTurn({ runId: "test", cwd: homeDir, prompt: "test", onEvent() {}, maxOutputTokens: options.maxOutputTokens }).done;
}

test("T-OUT-02 shared launch is byte-identical without the option; only numeric 64000 adds one variable", () => {
  const input = { binary: { executable: "fake.exe", prefixArgs: ["prefix"] }, cwd: "project", deniedReads: ["Read(.env)"], access: "read-only",
    newSession: true, sessionId: "fixed", model: "sonnet", effort: "medium", parentEnv: { PATH: "path", HOME: "home", ANTHROPIC_API_KEY: "discard", [ENV_KEY]: "128000", MAX_THINKING_TOKENS: "bad" } };
  const old = { executable: "fake.exe", args: ["prefix", ...claudeTurnArgs(input)], cwd: "project", env: buildChildEnv(CLAUDE_GUARD_ENV, input.parentEnv) };
  for (const maxOutputTokens of [undefined, 32000, 128000, "64000 ", "64000", null]) assert.equal(JSON.stringify(claudeTurnLaunch({ ...input, maxOutputTokens })), JSON.stringify(old));
  const bounded = claudeTurnLaunch({ ...input, maxOutputTokens: 64000 });
  assert.deepEqual(bounded, { ...old, env: { ...old.env, [ENV_KEY]: "64000" } });
  assert.equal(JSON.stringify(buildChildEnv(old.env, input.parentEnv)), JSON.stringify(old.env), "supervisor rebuild is identical");
  assert.deepEqual(buildChildEnv(bounded.env, input.parentEnv), bounded.env);
  for (const access of ["read-only", "workspace-write"]) for (const newSession of [true, false]) {
    const options = { ...input, access, newSession };
    assert.equal(JSON.stringify(claudeTurnLaunch(options)), JSON.stringify({ ...old, args: ["prefix", ...claudeTurnArgs(options)] }));
  }
  const launcher = wslClaudeLauncher({ config: { hubRoot: "hub", wsl: { executable: "wsl.exe", prefixArgs: [] } }, env: { id: "wsl-runner", distro: "fake", user: "runner", home: "/home/runner" }, state: () => ({ facts: { claude_cli: "fake" } }) });
  const prefix = launcher.spawn({ args: [], cwd: "/home/runner/ws/hub/test/repo", launchVars: { IFRIM_RUN: "test" } });
  const wsl = claudeTurnLaunch({ ...input, binary: { executable: prefix.executable, prefixArgs: prefix.args }, launcherEnv: prefix.env, environment: launcher.environment, maxOutputTokens: 64000 });
  assert.equal(wsl.env[ENV_KEY], undefined); assert.ok(!wsl.args.some((s) => s.includes(ENV_KEY)));
  const previousWsl = launcher.spawn({ args: claudeTurnArgs(input), cwd: "/home/runner/ws/hub/test/repo", launchVars: { IFRIM_RUN: "test" } });
  assert.equal(JSON.stringify(wsl.args), JSON.stringify(previousWsl.args));
  assert.equal(JSON.stringify(wsl.env), JSON.stringify(buildChildEnv(previousWsl.env, input.parentEnv)));
});

test("T-OUT-03 terminal signals only, last assistant wins, context/billing/quota/transport stay distinct", async (t) => {
  const terminal = await stream(t, [assistant("max_tokens", 32000), result(true, cliError)], { maxOutputTokens: 64000 });
  assert.equal(terminal.errorCategory, "output_token_limit"); assert.equal(terminal.authorOutputLimit.effective, 32000); assert.equal(terminal.status, "failed");
  const usage = await stream(t, [assistant("max_tokens", 41000), result()], { maxOutputTokens: 64000 });
  assert.equal(usage.errorCategory, "output_token_limit"); assert.equal(usage.authorOutputLimit.effective, 41000); assert.match(usage.authorOutputLimit.evidence, /at least 41000/);
  const partial = await stream(t, [{ type: "stream_event", event: { type: "message_start", message: {} } },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "```js\npartial" } } },
    { type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 42000 } } }, result()], { maxOutputTokens: 64000 });
  assert.equal(partial.errorCategory, "output_token_limit"); assert.equal(partial.authorOutputLimit.effective, 42000);
  for (const events of [[assistant("end_turn"), result()], [assistant("max_tokens"), assistant("end_turn"), result()]]) {
    const empty = await stream(t, events); assert.equal(empty.status, "completed"); assert.equal(empty.output, ""); assert.equal(empty.errorCategory, undefined);
    assert.equal(parseAuthorOutput(empty.output).ok, false, "empty answers still go to the existing unreadable parser");
  }
  const onlyError = await stream(t, [result(true, cliError)]); assert.equal(onlyError.errorCategory, "output_token_limit");
  const errors = await stream(t, [{ type: "result", is_error: true, errors: [cliError] }]); assert.equal(errors.errorCategory, "output_token_limit"); assert.equal(errors.authorOutputLimit.effective, 32000);
  const stderr = await stream(t, [], { stderr: cliError }); assert.equal(stderr.errorCategory, "model");
  for (const [text, category] of [[cliError, "output_token_limit"], ["timed out", "transport"], ["usage limit", "quota"], ["overloaded 503", "transport"], ["HTTP 500", "transport"], ["billing error", "billing"], ["prompt is too long", "model"], ["context window exceeded", "model"], ["context length", "model"]]) {
    assert.equal(classifyText(text), category, text);
    const run = await stream(t, [assistant("end_turn"), result(true, text)]); assert.equal(run.errorCategory, category, text);
  }
  const unknown = await stream(t, [assistant("max_tokens"), result()]); assert.equal(unknown.authorOutputLimit.effective, null); assert.equal(unknown.authorOutputLimit.evidence, "nedemonstrat");
  const aggregate = await stream(t, [assistant("max_tokens", 32000), assistant("end_turn", 32000), { ...result(), usage: { output_tokens: 129000 } }]);
  assert.equal(aggregate.status, "completed"); assert.equal(aggregate.authorOutputLimit.effective, null, "turn totals never demonstrate a per-message maximum");
});

test("T-OUT-03 successful max_tokens stays completed except for the Windows author requesting 64000", async (t) => {
  const output = "Răspunsul CLI păstrat.";
  const events = [assistant("max_tokens"), result(false, output)];
  for (const options of [{}, { maxOutputTokens: 32000 }, { maxOutputTokens: "64000" }, { environment: "wsl-runner", maxOutputTokens: 64000 }]) {
    const run = await stream(t, events, options);
    assert.equal(run.status, "completed");
    assert.equal(run.errorCategory, undefined);
    assert.equal(run.output, output);
  }
  const author = await stream(t, events, { maxOutputTokens: 64000 });
  assert.equal(author.status, "failed");
  assert.equal(author.errorCategory, "output_token_limit");
  assert.equal(author.output, output);
  const failed = await stream(t, [assistant("max_tokens"), result(true, "usage limit")]);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCategory, "quota");
  assert.equal(failed.output, "usage limit");
});

test("T-OUT-04 requested, user-settings override and demonstrated maximum remain separate", async (t) => {
  const homeDir = temp(t), settingsDir = path.join(homeDir, ".claude"); fs.mkdirSync(settingsDir);
  const file = path.join(settingsDir, "settings.json"), contents = JSON.stringify({ env: { [ENV_KEY]: "32000" } }); fs.writeFileSync(file, contents);
  fs.writeFileSync(path.join(settingsDir, "settings.local.json"), JSON.stringify({ env: { [ENV_KEY]: "999" } }));
  assert.equal(inspectClaudeConfig(homeDir).outputTokenLimitOverride, "32000");
  const run = await stream(t, [assistant("end_turn"), result()], { homeDir, maxOutputTokens: 64000 });
  assert.deepEqual(run.authorOutputLimit, { requested: 64000, settingsOverride: "32000", effective: null,
    evidence: "nedemonstrat; env din setările utilizatorului poate suprascrie variabila procesului" });
  assert.equal(fs.readFileSync(file, "utf8"), contents);
  for (const [value, expected] of [[{ limit: 32000 }, "invalid"], ["x".repeat(10 * 1024), "invalid"],
    [true, "invalid"], [null, "invalid"], [[32000], "invalid"], [" 32000 ", "32000"], [32000, 32000],
    ["1".repeat(20), "1".repeat(20)], ["1".repeat(21), "invalid"]]) {
    const json = JSON.stringify({ env: { [ENV_KEY]: value } }); fs.writeFileSync(file, json);
    assert.equal(inspectClaudeConfig(homeDir).outputTokenLimitOverride, expected);
    const bounded = await stream(t, [result()], { homeDir, maxOutputTokens: 64000 });
    assert.equal(bounded.authorOutputLimit.settingsOverride, expected);
    assert.equal(fs.readFileSync(file, "utf8"), json);
  }
  fs.unlinkSync(file); assert.equal(inspectClaudeConfig(homeDir).outputTokenLimitOverride, null);
});

test("T-OUT-06 planner provenance, strict validation, old spec unchanged", (t) => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, "src")); fs.writeFileSync(path.join(dir, "src/app.js"), "export const answer = 42;\n");
  const built = buildEngineeringSpec({ text: "Corectează suma calculată greșit: totalul pentru 2 și 3 trebuie să fie 5.", project: { id: "test", source: "hub-test", path: dir } });
  assert.deepEqual(built.input.spec.authoring.authorLimits, limits);
  const demo = demoSpec("bug-demo-test-first", { projectId: "test" });
  const input = { ...demo.spec, workType: demo.workType, title: demo.title, objective: demo.objective };
  const old = checkSpec(input); assert.deepEqual(old.problems, []); assert.equal(old.spec.authoring.authorLimits, undefined);
  const next = checkSpec({ ...input, authoring: { ...input.authoring, authorLimits: limits } }); assert.deepEqual(next.problems, []); assert.deepEqual(next.spec.authoring.authorLimits, limits);
  const { authorLimits, ...rest } = next.spec.authoring; assert.deepEqual({ ...next.spec, authoring: rest }, old.spec);
  assert.equal(buildAuthorBrief({ spec: next.spec }), buildAuthorBrief({ spec: old.spec }), "the author prompt/brief is unchanged");
  assert.match(specSummary(next.spec), /64000/); assert.ok(!specSummary(old.spec).includes("64000"));
  for (const value of [null, [], {}, { maxOutputTokens: 64000 }, { ...limits, maxOutputTokens: 32000 }, { ...limits, maxOutputTokens: 128000 }, { ...limits, maxOutputTokens: "64000" }, { ...limits, provenance: "" }, { ...limits, provenance: "x".repeat(301) }, { ...limits, MAX_THINKING_TOKENS: 1 }]) {
    const invalid = checkSpec({ ...input, authoring: { ...input.authoring, authorLimits: value } }); assert.ok(invalid.problems.some((p) => p.includes("authorLimits")));
    assert.ok(checkSpec(invalid.spec).problems.some((p) => p.includes("authorLimits")), "invalid saved drafts stay invalid");
  }
});

async function factory(t, { bounded = true, signal = "", maxAttemptsPerStage = 2, clock } = {}) {
  const dir = temp(t), envLog = path.join(dir, "env.jsonl"), signalFile = path.join(dir, "signal"); fs.writeFileSync(signalFile, signal);
  const queues = { claude: path.join(dir, "claude.queue"), codex: path.join(dir, "codex.queue") };
  const binaries = Object.fromEntries(["claude", "codex"].map((provider) => [provider, { executable: process.execPath, prefixArgs: [fixture,
    `--output-provider=${provider}`, `--output-log=${envLog}`, `--output-signal=${signalFile}`,
    provider === "claude" ? `--fake-scenario-queue=${queues.claude}` : `--scenario-queue=${queues.codex}`] }]));
  const h = await makeTestHub({ ...(clock ? { clock } : {}), configOverrides: { providerBinaries: binaries } }); t.after(() => h.cleanup());
  const dispatch = (type, payload) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
  await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const projectDir = path.join(h.dataDir, "output-project"); materializeFixture("bug-demo-test-first", projectDir);
  const project = (await dispatch("project.register_test", { path: projectDir })).result;
  h.hub.bus.transaction(() => { for (const provider of ["claude", "codex"]) h.hub.grants.create({ provider, projectId: project.id, access: provider === "claude" ? "read-only" : "workspace-write", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 480 }, "test"); });
  const input = demoSpec("bug-demo-test-first", { projectId: project.id }); if (bounded) input.spec.authoring.authorLimits = limits;
  const mission = (await dispatch("factory.prepare", { projectId: project.id, ...input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet", maxAttemptsPerStage } })).result.mission;
  const view = () => h.hub.factory.view(mission.id);
  const queue = (provider, ...items) => fs.appendFileSync(queues[provider], items.join("\n") + "\n");
  const start = async () => { const r = await dispatch("factory.start", view().scope); await dispatch("approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash }); await h.hub.commands.executeApproved(r.command.id, "user"); };
  const records = () => fs.readFileSync(envLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = () => h.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.author_output_limit' AND scope_id = ? ORDER BY seq").all(mission.id).map((r) => JSON.parse(r.payload_json));
  const settled = () => waitFor(() => ["DELIVERY_READY", "BLOCKED", "NEEDS_OWNER_DECISION", "CANCELLED"].includes(view().factory.stage) && view(), 120000);
  return { ...h, mission, project, dispatch, view, queue, start, records, events, settled, signalFile };
}

test("T-OUT-01 real Factory child env: author only, all other stages/chat/old plan unchanged", { timeout: 180000 }, async (t) => {
  const originalEnv = { ...process.env };
  const h = await factory(t);
  h.queue("claude", "author:bug-ok", "review:pass"); h.queue("codex", "test-review:pass", "factory-write:bug-fix");
  const settings = path.join(h.homeDir, ".claude/settings.json"); assert.equal(fs.existsSync(settings), false);
  await h.start(); const done = await h.settled(); assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  for (const d of done.dispatches.filter((d) => d.runId)) {
    const run = h.hub.runs.getRun(d.runId), record = h.records().find((r) => r.pid === run.pid);
    assert.ok(record, d.stage); assert.equal(record.env[ENV_KEY], d.stage === "TEST_AUTHORING" ? "64000" : undefined, d.stage);
    assert.equal(record.env.MAX_THINKING_TOKENS, undefined);
  }
  assert.ok(done.evidence.some((e) => e.stage === "QA"));
  assert.ok(h.records().filter((r) => r.provider === "codex").every((r) => r.env[ENV_KEY] === undefined), "writer, test reviewer and all runner/QA processes");
  const conv = h.hub.bus.transaction(() => h.hub.conversations.create({ projectId: h.project.id, title: "Lega chat" }, "test"));
  h.hub.bus.transaction(() => h.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Salut" }, "test"));
  const chat = await h.hub.runs.start({ conversationId: conv.id, provider: "claude", model: "sonnet", access: "read-only", maxOutputTokens: 64000 });
  await waitFor(() => h.hub.runs.getRun(chat.run.id).status === "completed");
  assert.equal(h.records().find((r) => r.pid === h.hub.runs.getRun(chat.run.id).pid).env[ENV_KEY], undefined, "manual option cannot reach a chat process");
  assert.equal(h.events().length, 1); const e = h.events()[0]; assert.deepEqual(e, { requested: 64000, settingsOverride: null, effective: null, evidence: "nedemonstrat", runId: e.runId });
  assert.deepEqual(h.hub.runs.getRun(e.runId).evidence.authorOutputLimit, { requested: 64000, settingsOverride: null, effective: null, evidence: "nedemonstrat" });
  assert.equal(fs.existsSync(settings), false); assert.deepEqual({ ...process.env }, originalEnv);
  const old = await factory(t, { bounded: false, signal: "limit", maxAttemptsPerStage: 1 }); await old.start(); await old.settled();
  assert.equal(old.records().find((r) => r.args.includes("-p")).env[ENV_KEY], undefined); assert.equal(old.events()[0].requested, null);
});

test("T-OUT-05 limit consumes ordinary attempts, no automatic retry or extra attempt; override event", { timeout: 120000 }, async (t) => {
  const h = await factory(t, { signal: "limit" });
  const file = path.join(h.homeDir, ".claude/settings.json"), contents = JSON.stringify({ env: { [ENV_KEY]: "32000" } }); fs.writeFileSync(file, contents);
  await h.start(); let done = await h.settled(); assert.equal(done.factory.stage, "BLOCKED", done.factory.stageReason);
  assert.equal(done.dispatches.length, 1); assert.equal(done.dispatches[0].request.counted, 1);
  assert.equal(h.hub.runs.getRun(done.dispatches[0].runId).errorCategory, "output_token_limit");
  await h.hub.factory.tick(); await h.hub.factory.idle(h.mission.id); assert.equal(h.view().dispatches.length, 1);
  await h.dispatch("factory.resume", { missionId: h.mission.id }); done = await h.settled();
  assert.equal(done.factory.stage, "NEEDS_OWNER_DECISION", done.factory.stageReason); assert.match(done.factory.stageReason, /întregul buget de ieșire.*2 încercări folosite din 2/);
  assert.deepEqual(done.dispatches.map((d) => d.request.counted), [1, 2]); assert.equal(done.factory.limits.maxAttemptsPerStage, 2);
  assert.equal(done.authoring.cycle, 0); assert.equal(done.authoring.candidate, null);
  for (const e of h.events()) { assert.equal(e.requested, 64000); assert.equal(e.settingsOverride, "32000"); assert.equal(e.effective, 32000); assert.match(e.evidence, /CLI:.*suprascrie/); }
  assert.equal(h.events().length, 2); assert.equal(fs.readFileSync(file, "utf8"), contents);
});

for (const stop of ["owner", "deadline"]) test(`T-OUT-05 ${stop} stops the bounded author; timeout/counters unchanged`, { timeout: 120000 }, async (t) => {
  let offset = 0;
  const h = await factory(t, { signal: "hang", clock: () => new Date(Date.now() + offset) });
  await h.start();
  const run = await waitFor(() => h.hub.runs.activeRuns().map((r) => h.hub.runs.getRun(r.runId)).find((r) => r.provider === "claude" && r.timeline?.turn_sent), 60000)
    .catch((error) => { throw new Error(`${error.message}: ${h.view().factory.stage} ${h.view().factory.stageReason}`); });
  const before = h.view(); assert.equal(h.records().find((r) => r.pid === run.pid).env[ENV_KEY], "64000");
  assert.equal(run.plan.turnTimeoutMs, before.dispatches[0].request.turnTimeoutMin * 60000);
  if (stop === "owner") await h.dispatch("factory.stop", { missionId: h.mission.id });
  else { offset += 181 * 60000; await h.hub.factory.tick(); }
  await waitFor(() => h.hub.runs.activeRuns().length === 0); await h.hub.factory.idle(h.mission.id);
  const after = h.view(); assert.equal(after.factory.deadlineAt, before.factory.deadlineAt); assert.deepEqual(after.factory.limits, before.factory.limits);
  assert.equal(after.dispatches.length, 1); assert.equal(after.dispatches[0].request.counted, 1); assert.equal(h.hub.runs.getRun(run.id).status, "interrupted");
  assert.equal(after.factory.stage, stop === "owner" ? "CANCELLED" : "NEEDS_OWNER_DECISION");
  assert.throws(() => process.kill(run.pid, 0), "supervisor terminated the child");
});
