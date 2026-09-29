import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelPolicy } from "../apps/api/src/model-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(projectRoot, "apps", "api", "src", "server.mjs");
const checkpointPath = path.join(projectRoot, ".ifrim", "tmp", "missing-legacy-backup.zip");

async function findFreePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi(baseUrl, child, getOutput) {
  const deadline = Date.now() + 20_000;
  let lastError = "API did not become ready";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated API exited before readiness (${child.exitCode}): ${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json();
      lastError = `Health endpoint returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  throw new Error(`Isolated API readiness timeout: ${lastError}; ${getOutput()}`);
}

async function requestJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(130_000),
  });
  return { status: response.status, payload: await response.json() };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit").catch(() => {}), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([once(child, "exit").catch(() => {}), delay(5_000)]);
  }
}

function obsoleteReviewerPacket(checkpoint) {
  const modelSelection = {
    policyVersion: "gpt5.6-openai-v1",
    providerPolicy: "openai_only",
    agentId: "ifrim-reviewer",
    effectiveModel: "openai/gpt-5.6-sol",
    thinking: "max",
    fallbacks: [],
  };
  return {
    packetVersion: "workflow-orchestrator-v2-gpt5.6",
    backup: { status: "failed", path: checkpoint },
    routing: {
      providerPolicy: "openai_only",
      modelPolicyVersion: "gpt5.6-openai-v1",
      ownerAgents: ["ifrim-reviewer"],
      reviewerAgents: ["ifrim-reviewer"],
      qaAgents: ["ifrim-qa"],
      workflowOwnerAgents: ["ifrim-backend"],
      modelSelection,
      modelSelections: { "ifrim-reviewer": modelSelection },
    },
    commands: [{
      type: "openclaw-reviewer",
      command: "openclaw agent --agent ifrim-reviewer --model openai/gpt-5.6-sol --thinking max",
    }],
  };
}

function assertCommandBindings(packet) {
  assert.ok(Array.isArray(packet.commands) && packet.commands.length > 0);
  for (const { command } of packet.commands) {
    const agentId = command.match(/(?:^|\s)--agent\s+(\S+)/)?.[1];
    const model = command.match(/(?:^|\s)--model\s+(\S+)/)?.[1];
    const thinking = command.match(/(?:^|\s)--thinking\s+(\S+)/)?.[1];
    assert.ok(agentId, "every command must bind an explicit agent");
    const selection = packet.routing.modelSelections?.[agentId];
    assert.ok(selection, `routing.modelSelections must contain ${agentId}`);
    assert.equal(selection.agentId, agentId);
    assert.equal(model, selection.effectiveModel);
    assert.equal(thinking, selection.thinking);
    if (agentId === packet.routing.modelSelection?.agentId) {
      assert.deepEqual(selection, packet.routing.modelSelection);
    }
  }
}

test("retry-ul workflow reîmprospătează packetul vechi o singură dată în DB izolată", { timeout: 180_000 }, async () => {
  const tmpRoot = path.join(projectRoot, ".ifrim", "tmp");
  await mkdir(tmpRoot, { recursive: true });
  const isolatedDir = await mkdtemp(path.join(tmpRoot, "hub016-workflow-refresh-"));
  const dbPath = path.resolve(path.join(isolatedDir, "agent-hub.sqlite"));
  const relativeDbPath = path.relative(tmpRoot, dbPath);
  assert.ok(relativeDbPath && !relativeDbPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeDbPath));

  const fixtureName = `.env.hub016-${randomUUID()}`;
  const fixturePath = path.join(projectRoot, fixtureName);
  await mkdir(fixturePath);
  await writeFile(path.join(fixturePath, "marker.txt"), "Hub archive exclusion fixture; no secrets.\n", "utf8");
  execFileSync("git", ["check-ignore", "--quiet", "--", fixtureName], {
    cwd: projectRoot,
    stdio: "ignore",
  });

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [apiEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HUB_TEST_DB_PATH: dbPath,
      PORT: String(port),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { stderr += `${error.stack || error}\n`; });
  const getOutput = () => `${stdout}\n${stderr}`.trim();

  try {
    const health = await waitForApi(baseUrl, child, getOutput);
    assert.equal(health.ok, true);
    assert.equal(path.resolve(health.database), dbPath);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const taskId = `HUB016-${suffix}`;
    const taskResponse = await requestJson(baseUrl, "/api/tasks", {
      id: taskId,
      projectSlug: "ifrim-agent-hub",
      title: `HUB-016 workflow refresh ${suffix}`,
      goal: "Verify isolated workflow refresh and packet reuse without external execution.",
      status: "review",
      priority: "normal",
      ownerAgent: "ifrim-backend",
      reviewerAgent: "ifrim-reviewer",
      qaAgent: "ifrim-qa",
      acceptance: "The isolated refresh packet is current and remains unexecuted.",
    });
    assert.equal(taskResponse.status, 201, JSON.stringify(taskResponse.payload));
    const task = taskResponse.payload.task;
    assert.equal(task.id, taskId);

    const parentId = `run-hub016-parent-${suffix}`;
    const obsoleteChildId = `run-hub016-obsolete-${suffix}`;
    const timestamp = new Date().toISOString();
    const legacyPacketJson = JSON.stringify(obsoleteReviewerPacket(checkpointPath));
    let originalRows;
    {
      const db = new DatabaseSync(dbPath);
      const insertRun = db.prepare(`INSERT INTO agent_runs (
        id, task_id, project_slug, project_name, route, owner_agent, reviewer_agent, qa_agent,
        status, packet_json, command_preview, workflow_stage, parent_run_id, workflow_cycle, created_at, updated_at
      ) VALUES (?, ?, 'ifrim-agent-hub', ?, 'workflow-reviewer', 'ifrim-reviewer', 'ifrim-reviewer', 'ifrim-qa', ?, ?, ?, 'reviewer', ?, 7, ?, ?)`);
      insertRun.run(parentId, taskId, task.projectName, "failed", legacyPacketJson, "legacy failed run", "", timestamp, timestamp);
      insertRun.run(obsoleteChildId, taskId, task.projectName, "packet_ready", legacyPacketJson, "legacy stale child", parentId, timestamp, timestamp);
      originalRows = db.prepare("SELECT * FROM agent_runs WHERE id IN (?, ?) ORDER BY id").all(parentId, obsoleteChildId);
      db.close();
    }

    const retryPath = `/api/agent-runs/${encodeURIComponent(parentId)}/retry`;
    const firstRetry = await requestJson(baseUrl, retryPath, { confirmRetry: true });
    assert.equal(firstRetry.status, 201, JSON.stringify(firstRetry.payload));
    assert.equal(firstRetry.payload.reused, false);
    const refreshed = firstRetry.payload.agentRun;
    assert.notEqual(refreshed.id, obsoleteChildId);
    assert.equal(refreshed.status, "packet_ready");
    assert.equal(refreshed.workflowStage, "reviewer");
    assert.equal(refreshed.parentRunId, obsoleteChildId);
    assert.equal(refreshed.workflowCycle, 7);
    assert.equal(refreshed.modelPolicyCurrent, true);
    assert.equal(refreshed.packet.routing.modelPolicyVersion, modelPolicy.version);
    assert.equal(refreshed.packet.routing.modelSelection.agentId, "ifrim-reviewer");
    assert.equal(refreshed.packet.routing.modelSelection.effectiveModel, "openai/gpt-6-luna");
    assertCommandBindings(refreshed.packet);
    assert.equal(refreshed.packet.backup.status, "created");
    assert.notEqual(path.resolve(refreshed.packet.backup.path), checkpointPath);
    await access(refreshed.packet.backup.path);

    const tarExe = path.join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe");
    const archiveListing = execFileSync(tarExe, ["-tf", refreshed.packet.backup.path], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const archiveEntries = archiveListing.split(/\r?\n/).filter(Boolean).map((entry) => entry.replaceAll("\\", "/"));
    assert.ok(archiveEntries.includes("apps/api/src/server.mjs"), "backup must include the OneDrive API source");
    assert.ok(archiveEntries.includes("src/main.jsx"), "backup must include the OneDrive frontend source");
    for (const entry of archiveEntries) {
      const segments = entry.split("/");
      assert.ok(!segments.some((segment) => segment.toLowerCase().startsWith(".env")), `secret-like path included: ${entry}`);
      assert.ok(!segments.some((segment) => segment.toLowerCase() === "node_modules"), `node_modules included: ${entry}`);
      assert.ok(!segments.some((segment) => segment.toLowerCase() === "tmp"), `tmp path included: ${entry}`);
      assert.ok(!entry.includes(fixtureName), `archive fixture included: ${entry}`);
    }

    const secondRetry = await requestJson(baseUrl, retryPath, { confirmRetry: true });
    assert.equal(secondRetry.status, 200, JSON.stringify(secondRetry.payload));
    assert.equal(secondRetry.payload.reused, true);
    assert.equal(secondRetry.payload.agentRun.id, refreshed.id);

    const executeAttempt = await requestJson(
      baseUrl,
      `/api/agent-runs/${encodeURIComponent(refreshed.id)}/execute`,
      { confirmExecution: true },
    );
    assert.equal(executeAttempt.status, 409);
    assert.match(executeAttempt.payload.error, /nu este armat/i);

    {
      const db = new DatabaseSync(dbPath);
      const preservedRows = db.prepare("SELECT * FROM agent_runs WHERE id IN (?, ?) ORDER BY id").all(parentId, obsoleteChildId);
      assert.deepEqual(preservedRows, originalRows, "legacy parent and child rows must remain byte-for-byte equivalent at the column level");
      const appendedChildren = db.prepare(`SELECT id FROM agent_runs
        WHERE parent_run_id = ? AND workflow_stage = 'reviewer' AND workflow_cycle = 7`)
        .all(obsoleteChildId)
        .map((row) => ({ id: row.id }));
      assert.deepEqual(appendedChildren, [{ id: refreshed.id }]);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM execution_approvals WHERE agent_run_id = ?").get(refreshed.id).count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM execution_attempts WHERE task_id = ?").get(taskId).count, 0);
      db.close();
    }
  } finally {
    await stopServer(child);
  }
});
