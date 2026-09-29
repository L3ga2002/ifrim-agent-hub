import test from "node:test";
import assert from "node:assert/strict";
import { modelPolicy, selectModelForTask } from "../apps/api/src/model-policy.mjs";
import { agentRoleDefault } from "../apps/api/src/openclaw-config.mjs";

const apiBase = process.env.HUB_API_BASE || "http://127.0.0.1:8004/api";
async function request(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    signal: AbortSignal.timeout(30000),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("agent directory exposes GPT-6 policy without reusing historical entitlement", async () => {
  const { directory } = await request("/agent-directory");
  assert.equal(directory.providerPolicy, "openai_only");
  assert.equal(directory.policyVersion, modelPolicy.version);
  assert.equal(directory.defaultModel, "openai/gpt-6-luna");
  assert.equal(directory.defaultThinking, "max");
  assert.equal(directory.entitlementStatus, "not_verified");
  assert.equal(directory.liveVerification.verifiedAt, "");
  assert.ok(directory.agents.length >= 23);
  for (const agent of directory.agents) {
    assert.ok(Object.hasOwn(modelPolicy.models, agent.model));
    assert.deepEqual({ model: agent.model, reasoning: agent.reasoning }, agentRoleDefault(agent.id));
    assert.equal(agent.routineTaskModel, "openai/gpt-6-luna");
    assert.equal(agent.routineTaskReasoning, "max");
    assert.deepEqual(agent.fallbacks, []);
    assert.equal(typeof agent.runtimeModel, "string");
  }
});

test("model route preview follows the current policy and does not modify project tasks", async () => {
  const before = await request("/tasks");
  assert.ok(before.tasks.length);
  const byProject = new Map(before.tasks.map((task) => [task.projectSlug, task]));
  for (const task of byProject.values()) {
    for (const agentId of ["ifrim-backend", "ifrim-reviewer", "ifrim-qa"]) {
      const { selection } = await request("/model-routing/preview", { taskId: task.id, agentId });
      const expected = selectModelForTask({
        ...task, affected_area: task.affectedArea,
        compiler_payload_json: JSON.stringify(task.compiler || {}),
      }, agentId);
      assert.equal(selection.policyVersion, modelPolicy.version);
      assert.equal(selection.effectiveModel, expected.effectiveModel, `${task.id}/${agentId}`);
      assert.equal(selection.thinking, expected.thinking);
    }
  }
  const after = await request("/tasks");
  assert.deepEqual(after.tasks, before.tasks);
});
