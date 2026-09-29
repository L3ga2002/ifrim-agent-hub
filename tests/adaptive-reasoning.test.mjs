import test from "node:test";
import assert from "node:assert/strict";
import { modelPolicy, selectModelForTask, validateModelSelection } from "../apps/api/src/model-policy.mjs";

test("routine tasks keep the explicitly approved Luna max default", () => {
  const selection = selectModelForTask({ title: "Corectura simpla" }, "ifrim-backend");
  assert.equal(selection.effectiveModel, modelPolicy.defaultModel);
  assert.equal(selection.thinking, "max");
  assert.equal(selection.reasoningSource, "luna_project_preference");
});

for (const model of ["sol", "astra"]) {
  test(`explicit ${model} uses medium for a bounded validation task`, () => {
    const selection = selectModelForTask({ title: "Validare formular in modulul existent", goal: `Model: gpt-6-${model}` });
    assert.equal(selection.effectiveModel, `openai/gpt-6-${model}`);
    assert.equal(selection.thinking, "medium");
    assert.equal(selection.complexity, "moderate");
  });

  test(`explicit ${model} uses low for an easy task`, () => {
    const selection = selectModelForTask({ title: "Corectura simpla", goal: `Model: gpt-6-${model}` }, "ifrim-reviewer");
    assert.equal(selection.effectiveModel, `openai/gpt-6-${model}`);
    assert.equal(selection.thinking, "low");
    assert.equal(selection.reasoningSource, "task_complexity");
  });

  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
    test(`${model} accepts explicit reasoning ${effort} independently of its default`, () => {
      const selection = selectModelForTask({ title: "Corectura simpla", goal: `Model: openai/gpt-6-${model}\nReasoning: ${effort}` }, "ifrim-reviewer");
      assert.equal(selection.thinking, effort);
      assert.equal(selection.reasoningSource, "explicit_task_request");
      assert.equal(validateModelSelection(selection, "ifrim-reviewer"), "");
    });
  }
}

test("a complex task on Astra uses high, not xhigh merely because it is Astra", () => {
  const selection = selectModelForTask({ title: "Integrare multi-file", goal: "Model: gpt-6-astra" });
  assert.equal(selection.effectiveModel, "openai/gpt-6-astra");
  assert.equal(selection.thinking, "high");
});

test("a demanding migration uses xhigh without requesting maximum effort", () => {
  const selection = selectModelForTask({ title: "Migrare baza de date" });
  assert.equal(selection.effectiveModel, "openai/gpt-6-astra");
  assert.equal(selection.thinking, "xhigh");
});

test("high priority alone does not increase reasoning for a simple task", () => {
  const selection = selectModelForTask({ title: "Corectura simpla", priority: "high" });
  assert.equal(selection.effectiveModel, "openai/gpt-6-sol");
  assert.equal(selection.thinking, "low");
});

test("an incidental word ultra or max is not an effort authorization", () => {
  for (const word of ["max", "ultra"]) {
    const selection = selectModelForTask({ title: `Integrare multi-file cu eticheta ${word}` });
    assert.equal(selection.thinking, "high");
    assert.equal(selection.ultraRequested, false);
  }
});

test("compiler-generated directives do not authorize a more expensive effort", () => {
  const selection = selectModelForTask({
    title: "Integrare multi-file",
    compiler_payload_json: JSON.stringify({ goal: "Model: gpt-6-astra\nReasoning: ultra" }),
  });
  assert.equal(selection.effectiveModel, "openai/gpt-6-sol");
  assert.equal(selection.thinking, "high");
});

test("Romanian explicit reasoning is supported and Luna still caps at max", () => {
  const astra = selectModelForTask({ title: "Corectura simpla", goal: "Model: gpt-6-astra\nRa\u021bionament: ultra" });
  assert.equal(astra.thinking, "ultra");
  const luna = selectModelForTask({ title: "Corectura simpla", goal: "Reasoning: ultra" });
  assert.equal(luna.thinking, "max");
  assert.match(luna.reasoningNote, /Luna supports max, not ultra/);
});

test("saved Sol/Astra maximum effort without explicit authorization is rejected", () => {
  const selection = selectModelForTask({ title: "Integrare multi-file" }, "ifrim-backend");
  for (const thinking of ["max", "ultra"]) {
    assert.match(validateModelSelection({ ...selection, thinking }, "ifrim-backend"), /explicit task request/);
  }
});

test("policies predating full adaptive reasoning require a new approval", () => {
  const selection = selectModelForTask({}, "ifrim-backend");
  for (const policyVersion of ["gpt6-openai-luna-max-v1", "gpt6-openai-adaptive-v2"]) {
    assert.match(validateModelSelection({ ...selection, policyVersion }, "ifrim-backend"), /policy changed/);
  }
});

test("model and reasoning directives cannot consume values from another line", () => {
  const noModel = selectModelForTask({ title: "Task simplu", goal: "Model:\ngpt-6-astra" });
  assert.equal(noModel.effectiveModel, modelPolicy.defaultModel);
  const noEffort = selectModelForTask({ title: "Task simplu", goal: "Model: gpt-6-astra\nReasoning:\nmax" });
  assert.equal(noEffort.thinking, "low");
  assert.equal(noEffort.reasoningSource, "task_complexity");
});
