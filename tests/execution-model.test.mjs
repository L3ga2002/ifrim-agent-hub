import test from "node:test";
import assert from "node:assert/strict";
import { selectModelForTask, validateExecutionModel } from "../apps/api/src/model-policy.mjs";

const selection = selectModelForTask({}, "ifrim-qa");
function envelope() {
  return { result: { meta: {
    agentMeta: { provider: "openai", model: "gpt-6-luna", agentHarnessId: "codex" },
    executionTrace: { winnerProvider: "openai", winnerModel: "gpt-6-luna", fallbackUsed: false,
      attempts: [{ provider: "openai", model: "gpt-6-luna", result: "success" }] },
    requestShaping: { thinking: "max" },
  } } };
}

test("accepts matching OpenAI Codex execution evidence", () => {
  assert.equal(validateExecutionModel(envelope(), selection), "");
});
for (const [name, mutate] of [
  ["missing metadata", (meta) => { delete meta.agentMeta; }],
  ["other provider", (meta) => { meta.agentMeta.provider = "anthropic"; }],
  ["older model", (meta) => { meta.agentMeta.model = "gpt-5.6-luna"; }],
  ["non-Codex harness", (meta) => { meta.agentMeta.agentHarnessId = "openclaw"; }],
  ["fallback", (meta) => { meta.executionTrace.fallbackUsed = true; }],
  ["missing fallback evidence", (meta) => { delete meta.executionTrace.fallbackUsed; }],
  ["wrong winner", (meta) => { meta.executionTrace.winnerModel = "gpt-6-sol"; }],
  ["unapproved attempt", (meta) => { meta.executionTrace.attempts.unshift({ provider: "openai", model: "gpt-5.5" }); }],
  ["reduced reasoning", (meta) => { meta.requestShaping.thinking = "high"; }],
  ["aborted execution", (meta) => { meta.aborted = true; }],
]) {
  test(`fails closed for ${name}`, () => {
    const result = envelope();
    mutate(result.result.meta);
    assert.notEqual(validateExecutionModel(result, selection), "");
  });
}
