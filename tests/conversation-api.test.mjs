import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(root, "apps", "api", "src", "server.mjs");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test("conversation API persists messages and creates a local handoff without execution", async () => {
  const temporary = await mkdtemp(path.join(root, ".ifrim", "tmp", "conversation-api-"));
  const port = await freePort();
  const child = spawn(process.execPath, [apiEntry], { cwd: root, windowsHide: true,
    env: { ...process.env, NODE_ENV: "test", HUB_TEST_DB_PATH: path.join(temporary, "hub.sqlite"), PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const request = async (route, method = "GET", body = undefined) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { ready = (await request("/health")).status === 200; if (ready) break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, output);
    const created = await request("/conversations", "POST", { projectSlug: "ifrim-agent-hub", title: "Shared task" });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.conversation.id;
    assert.equal((await request(`/conversations/${id}/messages`, "POST", { content: "Original text" })).status, 201);
    assert.equal((await request(`/conversations/${id}/decisions`, "POST", { content: "Keep data" })).status, 201);
    assert.equal((await request(`/conversations/${id}/task-state`, "PATCH", { completedSteps: ["Read code"] })).status, 200);
    const handoff = await request(`/conversations/${id}/handoff`, "POST", { provider: "claude" });
    assert.equal(handoff.status, 200, JSON.stringify(handoff.data));
    assert.equal(handoff.data.execution, "not_started");
    assert.ok(handoff.data.checkpointId);
    assert.equal("envelope" in handoff.data, false);
    const detail = await request(`/conversations/${id}`);
    assert.equal(detail.data.messages[0].content, "Original text");
    assert.equal(detail.data.conversation.preferredProvider, "claude");
    assert.equal(detail.data.decisions[0].content, "Keep data");
    assert.equal("envelope" in detail.data.checkpoint, false);
    assert.equal(detail.data.runs.length, 0);
    assert.equal(detail.data.taskState.completedSteps[0], "Read code");
    const route = await request(`/conversations/${id}/route`, "POST", { provider: "codex", message: "simple status", model: "openai/gpt-6-astra", accessMode: "read-only" });
    assert.equal(route.status, 200);
    assert.equal(route.data.route.model, "openai/gpt-6-astra");
    assert.equal(route.data.route.reasoning, "low");
    assert.equal(route.data.route.transport, "openclaw");
    assert.equal(route.data.execution, "not_started");
    assert.equal(route.data.preflight.ready, false);
    assert.match(route.data.preflight.blocker, /disabled in test mode/);
    assert.equal((await request(`/conversations/${id}/route`, "POST", { provider: "codex", model: "old-model" })).status, 400);
    const missingConfirmation = await request(`/conversations/${id}/execute`, "POST", { provider: "codex" });
    assert.equal(missingConfirmation.status, 400);
    const disabledInTests = await request(`/conversations/${id}/execute`, "POST", { provider: "codex", confirm: "RUN_APPROVED_PROVIDER" });
    assert.equal(disabledInTests.status, 409);
    assert.equal((await request(`/conversations/${id}`)).data.runs.length, 0);
    const otherProject = await request("/conversations", "POST", { projectSlug: "prodelivery", title: "Scope guard" });
    assert.equal(otherProject.status, 201);
    const blocked = await request(`/conversations/${otherProject.data.conversation.id}/execute`, "POST", { provider: "claude", confirm: "RUN_APPROVED_PROVIDER" });
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.error, /only for Ifrim Agent Hub/);
    assert.equal((await request(`/conversations/${otherProject.data.conversation.id}`)).data.runs.length, 0);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
  }
});
