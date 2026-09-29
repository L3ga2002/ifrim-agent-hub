import test from "node:test";
import assert from "node:assert/strict";
import {
  modelPolicy,
  selectModelForTask,
  validatePacketModelPolicy,
} from "../apps/api/src/model-policy.mjs";
import { findReusableWorkflowChild } from "../apps/api/src/workflow-policy.mjs";

function currentPacket() {
  const agentId = "ifrim-reviewer";
  const modelSelection = selectModelForTask(
    { title: "Revizie workflow de rutină", priority: "normal" },
    agentId,
  );
  return {
    packetVersion: "current",
    backup: { status: "created", path: "fixture-backup.zip", manifest: {} },
    routing: {
      providerPolicy: modelPolicy.providerPolicy,
      modelPolicyVersion: modelPolicy.version,
      ownerAgents: [agentId],
      modelSelections: { [agentId]: modelSelection },
      modelSelection,
    },
    commands: [{
      type: "openclaw-reviewer",
      command: `openclaw agent --agent ${agentId} --model ${modelSelection.effectiveModel} --thinking ${modelSelection.thinking}`,
    }],
  };
}

function obsoletePacket() {
  const packet = currentPacket();
  return {
    ...packet,
    routing: {
      ...packet.routing,
      modelPolicyVersion: "gpt5.6-openai-v1",
    },
  };
}

test("reutilizează copilul workflow cu packet curent", () => {
  const child = { id: "run-current", packet: currentPacket() };
  assert.equal(validatePacketModelPolicy(child.packet), "");
  const result = findReusableWorkflowChild("run-parent", (parentId) =>
    parentId === "run-parent" ? child : null,
  );

  assert.deepEqual(result, { existing: child, parentRunId: "run-parent" });
});

test("copilul vechi nu este suprascris și permite append sub el", () => {
  const obsoleteChild = {
    id: "run-obsolete",
    status: "packet_ready",
    workflow_stage: "reviewer",
    workflow_cycle: 4,
    packet_json: JSON.stringify(obsoletePacket()),
  };
  const before = structuredClone(obsoleteChild);
  const result = findReusableWorkflowChild("run-parent", (parentId) =>
    parentId === "run-parent" ? obsoleteChild : null,
  );

  assert.deepEqual(result, { existing: null, parentRunId: obsoleteChild.id });
  assert.deepEqual(obsoleteChild, before);
});

test("după un copil vechi reutilizează copilul curent deja atașat", () => {
  const obsoleteChild = {
    id: "run-obsolete",
    packet_json: JSON.stringify(obsoletePacket()),
  };
  const currentChild = { id: "run-current", packet: currentPacket() };
  const result = findReusableWorkflowChild("run-parent", (parentId) => {
    if (parentId === "run-parent") return obsoleteChild;
    if (parentId === obsoleteChild.id) return currentChild;
    return null;
  });

  assert.deepEqual(result, { existing: currentChild, parentRunId: obsoleteChild.id });
});

test("blochează istoricul workflow care conține un ciclu", () => {
  const first = { id: "run-a", packet_json: JSON.stringify(obsoletePacket()) };
  const second = { id: "run-b", packet_json: JSON.stringify(obsoletePacket()) };
  const children = new Map([["run-a", second], ["run-b", first]]);

  assert.throws(
    () => findReusableWorkflowChild("run-a", (parentId) => children.get(parentId) ?? null),
    /cycle/i,
  );
});

for (const [name, backup] of [
  ["missing", undefined],
  ["failed", { status: "failed" }],
  ["errored", { status: "created", manifest: { error: "fixture error" } }],
]) {
  test(`current-policy child with ${name} backup is preserved but not reused`, () => {
    const child = { id: "run-current-incomplete", packet: { ...currentPacket(), backup } };
    const before = structuredClone(child);
    const result = findReusableWorkflowChild("run-parent", parentId => parentId === "run-parent" ? child : null);
    assert.deepEqual(result, { existing: null, parentRunId: child.id });
    assert.deepEqual(child, before);
  });
}
