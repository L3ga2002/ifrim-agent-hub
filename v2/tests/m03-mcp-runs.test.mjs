import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { CODEX_APP_SERVER_OVERRIDES, CODEX_ALLOWED_METHODS, mcpDisableArgs } from "../server/providers/codex.mjs";
import { CODEX_VOICE_EXTRA_ARGS } from "../server/providers/codex-realtime.mjs";

// Found live on 2026-09-30: a Codex workspace-write run called the Computer Use plugin's MCP server (cua_repl/js) three
// times. MCP servers run OUTSIDE the Codex sandbox with the owner's rights, and only Lega had them disabled. Every Hub
// Codex process now has plugins off and each config MCP server disabled by name, the run verifies with
// mcpServerStatus/list that none is active before any turn, and an MCP tool call during a turn stops the run.
// Fake app-server only: no network, no model.
const TERMINAL = ["completed", "failed", "blocked", "interrupted"];

async function codexRun(t, { access = "read-only" } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "codex", access });
  const project = hub.projects.hub();
  const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "MCP" }, "user"));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise the README." }, "user"));
  const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "codex", access });
  return waitFor(() => { const r = hub.runs.getRun(run.id); return TERMINAL.includes(r.status) ? r : null; }, 20000);
}
const methods = (t, name) => t.readLog("codex").filter((e) => e.method === name);
const writeCodexConfig = (t, text) => fs.writeFileSync(path.join(t.homeDir, ".codex", "config.toml"), text);

test("M03-MCP-01 every Hub Codex process: plugins off, config MCP servers disabled by name, none active before the turn", async () => {
  assert.ok(CODEX_APP_SERVER_OVERRIDES.includes("features.plugins=false") && CODEX_APP_SERVER_OVERRIDES.includes("features.remote_plugin=false"), "base overrides, so runs AND Lega get them");
  assert.ok(!CODEX_VOICE_EXTRA_ARGS.includes("features.plugins=false"), "one source of truth (the base overrides)");
  assert.ok(CODEX_ALLOWED_METHODS.has("mcpServerStatus/list"));
  assert.deepEqual(mcpDisableArgs(["node_repl", "cloudflare-api", "bad.name"]), ["-c", "mcp_servers.node_repl.enabled=false", "-c", "mcp_servers.cloudflare-api.enabled=false"]);
  const t = await makeTestHub();
  try {
    writeCodexConfig(t, "[mcp_servers.node_repl]\ncommand = \"fake\"\n\n[mcp_servers.cloudflare-api]\ncommand = \"fake\"\n");
    const run = await codexRun(t, { access: "workspace-write" });
    assert.equal(run.status, "completed", run.errorMessage || "");
    const launch = t.readLog("codex").filter((l) => l.launchArgs).at(-1).launchArgs;
    for (const arg of ["features.plugins=false", "features.remote_plugin=false", "mcp_servers.node_repl.enabled=false", "mcp_servers.cloudflare-api.enabled=false"]) assert.ok(launch.includes(arg), arg);
    // The MCP check runs after thread/start and before turn/start.
    const order = t.readLog("codex").filter((l) => ["thread/start", "mcpServerStatus/list", "turn/start"].includes(l.method)).map((l) => l.method);
    assert.deepEqual(order, ["thread/start", "mcpServerStatus/list", "turn/start"]);
  } finally { await t.cleanup(); }
});

test("M03-MCP-02 a server that stays active (unaddressable name, or a Codex ignoring the override) stops the run before the model", async () => {
  const t = await makeTestHub({ codex: "mcp-active" });
  try {
    const run = await codexRun(t);
    assert.deepEqual([run.status, run.errorCategory, run.preInference], ["blocked", "policy", true], "stopped before the model = blocked");
    assert.match(run.errorMessage, /Servere MCP încă active.*fs/);
    assert.equal(methods(t, "turn/start").length, 0, "no turn, so no inference");
  } finally { await t.cleanup(); }
});

test("M03-MCP-03 an MCP tool call during a turn interrupts it and fails the run (tool violation, after inference)", async () => {
  const t = await makeTestHub({ codex: "mcp-tool" });
  try {
    const run = await codexRun(t);
    assert.deepEqual([run.status, run.errorCategory, run.preInference], ["failed", "tool", false], "the model already ran: a failed run, not a pre-inference block");
    assert.match(run.errorMessage, /node_repl\/js/);
    assert.equal(methods(t, "turn/interrupt").length, 1, "the turn is interrupted at once");
    const notice = t.hub.bus.query({ limit: 200 }).find((e) => e.runId === run.id && /MCP/.test(JSON.stringify(e.payload || {})));
    assert.ok(notice, "the stop is visible in the run's events");
  } finally { await t.cleanup(); }
});

test("M03-MCP-04 a thread that reports externalSandbox (no Codex sandbox, and no outer one) stops before the turn", async () => {
  const t = await makeTestHub({ codex: "external-sandbox" });
  try {
    const run = await codexRun(t);
    assert.deepEqual([run.status, run.errorCategory, run.preInference], ["blocked", "policy", true], "stopped before the model = blocked");
    assert.match(run.errorMessage, /externalSandbox/);
    assert.equal(methods(t, "turn/start").length, 0);
  } finally { await t.cleanup(); }
});

test("M03-MCP-05 refused BEFORE any Codex process starts: a config MCP name that cannot be disabled, or a project .codex/config.toml", async () => {
  let t = await makeTestHub();
  try {
    writeCodexConfig(t, "[mcp_servers.\"my.server\"]\ncommand = \"fake\"\n");
    const run = await codexRun(t);
    assert.deepEqual([run.status, run.errorCategory, run.preInference], ["blocked", "policy", true]);
    assert.match(run.errorMessage, /nu poate fi oprit per proces/);
    assert.equal(run.pid, null, "no app-server process was started for the run");
    assert.equal(methods(t, "thread/start").length, 0);
  } finally { await t.cleanup(); }

  t = await makeTestHub();
  try {
    fs.mkdirSync(path.join(t.projectDir, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(t.projectDir, ".codex", "config.toml"), "[mcp_servers.x]\ncommand = \"powershell\"\n");
    const run = await codexRun(t, { access: "workspace-write" });
    assert.deepEqual([run.status, run.errorCategory], ["blocked", "policy"]);
    assert.match(run.errorMessage, /\.codex\/config\.toml/);
    assert.equal(run.pid, null);
    assert.equal(methods(t, "thread/start").length, 0);
  } finally { await t.cleanup(); }
});

test("M03-MCP-06 the MCP check reads every page and fails closed on an unknown response", async () => {
  for (const [scenario, pattern] of [["mcp-paged", /late_server/], ["mcp-shape", /nu poate confirma/]]) {
    const t = await makeTestHub({ codex: scenario });
    try {
      const run = await codexRun(t);
      assert.deepEqual([run.status, run.errorCategory, run.preInference], ["blocked", "policy", true], scenario);
      assert.match(run.errorMessage, pattern);
      assert.equal(methods(t, "turn/start").length, 0, `${scenario}: no turn`);
      if (scenario === "mcp-paged") assert.deepEqual(methods(t, "mcpServerStatus/list").map((m) => m.params.cursor || null), [null, "page-2"]);
    } finally { await t.cleanup(); }
  }
});

test("M03-MCP-07 Stop while thread/start is in flight: the process ends and no turn is ever sent", async () => {
  const t = await makeTestHub({ codex: "slow-thread" });
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex" });
    const project = hub.projects.hub();
    const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Stop" }, "user"));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise." }, "user"));
    const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "codex" });
    await waitFor(() => (methods(t, "thread/start").length ? true : null), 10000);
    await hub.runs.interrupt(run.id);
    const ended = await waitFor(() => { const r = hub.runs.getRun(run.id); return TERMINAL.includes(r.status) ? r : null; }, 15000);
    assert.equal(ended.status, "interrupted");
    await new Promise((r) => setTimeout(r, 2000)); // the slow thread/start would have answered by now
    assert.equal(methods(t, "turn/start").length, 0, "a Stop is never followed by a model call");
  } finally { await t.cleanup(); }
});

test("M03-MCP-08 an MCP call seen only as a completed item also stops the run", async () => {
  const t = await makeTestHub({ codex: "mcp-tool-completed" });
  try {
    const run = await codexRun(t);
    assert.deepEqual([run.status, run.errorCategory], ["failed", "tool"]);
    assert.equal(methods(t, "turn/interrupt").length, 1);
  } finally { await t.cleanup(); }
});

test("M03-MCP-09 Claude Code: an MCP server or mcp__ tool at session init stops the run before the model", async () => {
  const t = await makeTestHub({ claude: "init-mcp" });
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "claude" });
    const project = hub.projects.hub();
    const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Claude MCP" }, "user"));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise." }, "user"));
    // M09: Claude needs an explicit model (sonnet is echoed at init as claude-sonnet-fake, inside the bound family).
    const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "claude", model: "sonnet" });
    const ended = await waitFor(() => { const r = hub.runs.getRun(run.id); return TERMINAL.includes(r.status) ? r : null; }, 20000);
    assert.deepEqual([ended.status, ended.errorCategory, ended.preInference], ["blocked", "policy", true]);
    assert.match(ended.errorMessage, /servere MCP \(cua, mcp__cua__click\)/);
  } finally { await t.cleanup(); }
});
