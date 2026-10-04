import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor } from "./helpers.mjs";

const collect = () => { const events = []; return { events, onEvent: (e) => events.push(e) }; };

test("T08 Codex adapter (simulated): handshake, account check, thread, streamed turn, completion", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { events, onEvent } = collect();
    const handle = hub.providers.codex.startTurn({ runId: "r1", cwd: t.projectDir, prompt: "Say hi", access: "read-only", onEvent, admitUsage: () => ({ ok: true }), requestApproval: async () => "decline" });
    const result = await handle.done;
    assert.equal(result.status, "completed");
    assert.equal(result.threadId, "thr_fake_1");
    assert.equal(result.output, "Codex simulated answer.");
    const methods = t.readLog("codex").map((e) => e.method).filter(Boolean);
    assert.deepEqual(methods.slice(0, 5), ["initialize", "initialized", "account/read", "account/rateLimits/read", "thread/start"]);
    const turn = t.readLog("codex").find((e) => e.method === "turn/start");
    // M02: access comes from the Hub permission profile selected per process, not from legacy sandbox params.
    assert.equal(turn.params.sandboxPolicy, undefined);
    const start = t.readLog("codex").find((e) => e.method === "thread/start");
    assert.equal(start.params.sandbox, undefined);
    const launch = t.readLog("codex").find((e) => Array.isArray(e.launchArgs)).launchArgs;
    assert.ok(launch.includes('default_permissions="ifrim_hub_ro"'), launch.join(" "));
    assert.ok(launch.some((a) => a.startsWith("permissions.ifrim_hub_ro=") && a.includes('".ifrim/private"="deny"') && a.includes("network={enabled=false}")));
    assert.ok(events.some((e) => e.type === "delta"));
    assert.ok(events.some((e) => e.type === "auth" && e.auth.accountType === "chatgpt"));
    assert.ok(!JSON.stringify(events).includes("someone@example.com"), "identity email never leaves the adapter");
  } finally { await t.cleanup(); }
});

test("T07/T09 Codex API-key account fails before inference (billing), no thread or turn", async () => {
  const t = await makeTestHub({ codex: "apikey" });
  try {
    const handle = t.hub.providers.codex.startTurn({ runId: "r2", cwd: t.projectDir, prompt: "x", onEvent: () => {}, admitUsage: () => ({ ok: true }), requestApproval: async () => "decline" });
    const result = await handle.done;
    assert.equal(result.status, "failed");
    assert.equal(result.errorCategory, "billing");
    assert.equal(result.preInference, true);
    const methods = t.readLog("codex").map((e) => e.method);
    assert.ok(!methods.includes("thread/start") && !methods.includes("turn/start"));
  } finally { await t.cleanup(); }
});

test("T12 Codex usage above the reserve ceiling stops before the turn (quota), no fallback", async () => {
  const t = await makeTestHub({ codex: "quota" });
  try {
    const handle = t.hub.providers.codex.startTurn({ runId: "r3", cwd: t.projectDir, prompt: "x", onEvent: () => {},
      admitUsage: (s) => t.hub.usage.admit("codex", s), requestApproval: async () => "decline" });
    const result = await handle.done;
    assert.equal(result.errorCategory, "quota");
    assert.equal(result.preInference, true);
    assert.ok(!t.readLog("codex").some((e) => e.method === "turn/start"));
  } finally { await t.cleanup(); }
});

test("T08 Codex approval requests are relayed to the Hub and declines are sent back", async () => {
  const t = await makeTestHub({ codex: "approval" });
  try {
    const seen = [];
    const handle = t.hub.providers.codex.startTurn({ runId: "r4", cwd: t.projectDir, prompt: "x", onEvent: () => {}, admitUsage: () => ({ ok: true }),
      requestApproval: async (req) => { seen.push(req); return "decline"; } });
    const result = await handle.done;
    assert.equal(result.status, "completed");
    assert.equal(seen[0].kind, "command");
    assert.deepEqual(t.readLog("codex").find((e) => e.approvalReply).approvalReply, { decision: "decline" });
  } finally { await t.cleanup(); }
});

test("T08 Codex interrupt uses turn/interrupt and reports interrupted", async () => {
  const t = await makeTestHub({ codex: "hang" });
  try {
    const handle = t.hub.providers.codex.startTurn({ runId: "r5", cwd: t.projectDir, prompt: "x", onEvent: () => {}, admitUsage: () => ({ ok: true }), requestApproval: async () => "decline" });
    await waitFor(() => t.readLog("codex").some((e) => e.method === "turn/start"));
    await handle.interrupt("user");
    const result = await handle.done;
    assert.equal(result.status, "interrupted");
    assert.ok(t.readLog("codex").some((e) => e.method === "turn/interrupt"));
  } finally { await t.cleanup(); }
});

test("T08 regression: an interrupt requested before the turn id is known is reported as interrupted, not failed", async () => {
  for (let i = 0; i < 3; i += 1) {
    const t = await makeTestHub({ codex: "hang" });
    try {
      const handle = t.hub.providers.codex.startTurn({ runId: `race${i}`, cwd: t.projectDir, prompt: "x", onEvent: () => {}, admitUsage: () => ({ ok: true }), requestApproval: async () => "decline" });
      await new Promise((r) => setTimeout(r, i * 150)); // 0 ms, 150 ms, 300 ms after start
      await handle.interrupt("user");
      const result = await handle.done;
      assert.equal(result.status, "interrupted", `attempt ${i}: ${result.error}`);
      assert.notEqual(result.errorCategory, "transport");
    } finally { await t.cleanup(); }
  }
});

test("T09 Claude adapter (simulated): stdin prompt, pre-assigned session id, no forbidden flags", async () => {
  const t = await makeTestHub();
  try {
    const { events, onEvent } = collect();
    const handle = t.hub.providers.claude.startTurn({ runId: "c1", cwd: t.projectDir, prompt: "Hello from the Hub", access: "read-only", trustedWorkspace: true, onEvent });
    const result = await handle.done;
    assert.equal(result.status, "completed");
    assert.equal(result.sessionId, handle.nativeSessionId);
    const call = t.readLog("claude").find((e) => e.args);
    for (const forbidden of ["--bare", "--fallback-model", "--dangerously-skip-permissions", "--max-budget-usd"]) assert.ok(!call.args.includes(forbidden), forbidden);
    assert.ok(call.args.includes("--session-id"));
    assert.equal(call.args[call.args.indexOf("--permission-mode") + 1], "dontAsk");
    assert.equal(call.args[call.args.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.ok(call.args.includes("--strict-mcp-config"));
    assert.equal(call.promptLength, "Hello from the Hub".length, "prompt was sent on stdin, not argv");
    assert.ok(events.some((e) => e.type === "usage" && e.usage.note.includes("estimate")));
  } finally { await t.cleanup(); }
});

test("T09 Claude authentication failure is classified before inference", async () => {
  const t = await makeTestHub({ claude: "autherror" });
  try {
    const result = await t.hub.providers.claude.startTurn({ runId: "c2", cwd: t.projectDir, prompt: "x", trustedWorkspace: true, onEvent: () => {} }).done;
    assert.equal(result.status, "failed");
    assert.equal(result.errorCategory, "authentication");
  } finally { await t.cleanup(); }
});

test("T07 Claude billing_error retry stops the run immediately", async () => {
  const t = await makeTestHub({ claude: "billing" });
  try {
    const started = Date.now();
    const result = await t.hub.providers.claude.startTurn({ runId: "c3", cwd: t.projectDir, prompt: "x", trustedWorkspace: true, onEvent: () => {} }).done;
    assert.equal(result.errorCategory, "billing");
    assert.ok(Date.now() - started < 4500, "stopped before the fake finished its retry wait");
  } finally { await t.cleanup(); }
});

test("T21 untrusted workspace with startup hooks is refused before launch", async () => {
  const t = await makeTestHub();
  try {
    fs.mkdirSync(path.join(t.projectDir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(t.projectDir, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "curl evil" }] }] } }));
    const result = await t.hub.providers.claude.startTurn({ runId: "c4", cwd: t.projectDir, prompt: "x", trustedWorkspace: false, onEvent: () => {} }).done;
    assert.equal(result.errorCategory, "policy");
    assert.equal(result.preInference, true);
    assert.equal(t.readLog("claude").filter((e) => e.args).length, 0, "Claude was never launched");
  } finally { await t.cleanup(); }
});

test("T08 explicit probes return plan facts without identity", async () => {
  const t = await makeTestHub();
  try {
    const codex = await t.hub.providers.codex.probe({ withModels: true });
    assert.equal(codex.ok, true);
    assert.equal(codex.auth.accountType, "chatgpt");
    assert.equal(codex.models[0].id, "gpt-fake-sol");
    assert.ok(!t.readLog("codex").some((e) => e.method === "turn/start"), "a probe never starts a turn");
    const claude = await t.hub.providers.claude.probe();
    // M09-A2: the four plan facts plus the salted pseudonym of the account (the fake reports an e-mail → basis "email"); the
    // e-mail itself never leaves the adapter.
    const { accountIdentity, ...facts } = claude.auth;
    assert.deepEqual(facts, { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" });
    assert.deepEqual(Object.keys(accountIdentity).sort(), ["basis", "plan", "scheme", "value"]);
    assert.equal(accountIdentity.scheme, "sha256-salted:v1");
    assert.equal(accountIdentity.basis, "email");
    assert.match(accountIdentity.value, /^[0-9a-f]{16}$/);
    assert.equal(codex.auth.accountIdentity.basis, "email");
    assert.notEqual(codex.auth.accountIdentity.value, accountIdentity.value, "different fake accounts → different pseudonyms");
    assert.ok(!JSON.stringify([codex, claude]).includes("example.com"));
  } finally { await t.cleanup(); }
});
