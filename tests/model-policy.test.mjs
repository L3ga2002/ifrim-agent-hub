import test from "node:test";
import assert from "node:assert/strict";
import {
  modelPolicy,
  selectModelForTask,
  validateModelSelection,
  validatePacketModelPolicy,
} from "../apps/api/src/model-policy.mjs";

const routineTask = { title: "Task obișnuit", priority: "normal" };
const selectRoutine = (agentId = "ifrim-frontend") => selectModelForTask(routineTask, agentId);

function currentPacket() {
  const owner = "ifrim-frontend";
  return {
    packetVersion: "current",
    routing: {
      providerPolicy: modelPolicy.providerPolicy,
      modelPolicyVersion: modelPolicy.version,
      ownerAgents: [owner],
      modelSelection: selectRoutine(owner),
    },
    commands: [{ type: "openclaw", command: `openclaw agent --agent ${owner} --model openai/gpt-6-luna --thinking max` }],
  };
}

test("Luna max rămâne modelul implicit pentru ownerii selectați", () => {
  for (const agentId of [
    "ifrim-frontend",
    "ifrim-backend",
    "ifrim-reviewer",
    "ifrim-qa",
    "ifrim-prototype",
  ]) {
    const selection = selectRoutine(agentId);
    assert.equal(selection.effectiveModel, "openai/gpt-6-luna", agentId);
    assert.equal(selection.thinking, "max", agentId);
  }
});

test("rolurile de arhitectură, securitate, migrare și data review nu escaladează taskurile rutine", () => {
  for (const agentId of [
    "ifrim-architect",
    "ifrim-security-reviewer",
    "ifrim-migration",
    "ifrim-data-reviewer",
  ]) {
    const selection = selectModelForTask(routineTask, agentId);
    assert.equal(selection.effectiveModel, "openai/gpt-6-luna", agentId);
    assert.equal(selection.thinking, "max", agentId);
  }
});

test("compiler payload folosește whitelist-ul de risc și ignoră ID-urile owner/reviewer", () => {
  const task = {
    ...routineTask,
    compiler_payload_json: JSON.stringify({
      title: "Task obișnuit",
      goal: "Schimbare limitată și fără risc",
      scope: "un singur modul",
      affectedAreas: ["docs"],
      riskReasons: [],
      acceptanceCriteria: ["Textul rămâne lizibil"],
      riskLevel: "high",
      owner: "ifrim-security-reviewer",
      ownerAgent: "ifrim-architect",
      ownerAgents: ["ifrim-security-reviewer"],
      reviewer: "ifrim-architect",
      reviewerAgent: "ifrim-migration",
      reviewerAgents: ["ifrim-data-reviewer"],
    }),
  };
  const selection = selectModelForTask(task, "ifrim-frontend");
  assert.equal(selection.tier, "complex");
  assert.equal(selection.effectiveModel, "openai/gpt-6-sol");
});

test("compiler JSON malformat rămâne un task Luna de rutină", () => {
  const selection = selectModelForTask({ ...routineTask, compiler_payload_json: "{broken" }, "ifrim-frontend");
  assert.equal(selection.effectiveModel, "openai/gpt-6-luna");
});

test("compiler JSON null este tratat ca payload gol pentru un task Luna de rutină", () => {
  let selection;
  assert.doesNotThrow(() => {
    selection = selectModelForTask({ ...routineTask, compiler_payload_json: "null" }, "ifrim-frontend");
  });
  assert.equal(selection.effectiveModel, "openai/gpt-6-luna");
});

test("taskurile high sau complexe folosesc Sol cu reasoning adaptiv", () => {
  for (const task of [
    { title: "Task obișnuit", priority: "high", expected: "low" },
    { title: "Integrare multi-file", priority: "normal", expected: "high" },
  ]) {
    const selection = selectModelForTask(task, "ifrim-backend");
    assert.equal(selection.effectiveModel, "openai/gpt-6-sol");
    assert.equal(selection.thinking, task.expected);
  }
});

for (const scenario of [
  { name: "prioritate critică", task: { title: "Revizie critică", priority: "critical" } },
  { name: "cuvânt critic cu diacritice", task: { title: "Analiză critică a schimbării" } },
  { name: "migrare", task: { title: "Migrare bază de date" } },
  { name: "migrație cu diacritice", task: { title: "Plan pentru migrație" } },
  { name: "securitate", task: { title: "Audit de securitate" } },
]) {
  test(`Astra xhigh este ales pentru ${scenario.name}`, () => {
    const selection = selectModelForTask(scenario.task, "ifrim-frontend");
    assert.equal(selection.effectiveModel, "openai/gpt-6-astra");
    assert.equal(selection.thinking, "xhigh");
  });
}

test("cererea ultra nu ridică Luna peste max și explică limita", () => {
  const selection = selectModelForTask({ title: "Task obișnuit", goal: "Reasoning: ultra" }, "ifrim-frontend");
  assert.equal(selection.effectiveModel, "openai/gpt-6-luna");
  assert.equal(selection.thinking, "max");
  assert.match(selection.reasoningNote, /Luna supports max, not ultra/i);
});

test("Sol și Astra permit ultra când este cerut explicit", () => {
  const sol = selectModelForTask({ title: "Integrare multi-file", goal: "Reasoning: ultra" }, "ifrim-backend");
  const astra = selectModelForTask({ title: "Revizie critică", goal: "Reasoning: ultra" }, "ifrim-reviewer");
  assert.equal(sol.effectiveModel, "openai/gpt-6-sol");
  assert.equal(sol.thinking, "ultra");
  assert.equal(astra.effectiveModel, "openai/gpt-6-astra");
  assert.equal(astra.thinking, "ultra");
});

test("respinge selecția salvată sub o versiune veche de policy", () => {
  const stale = { ...selectRoutine(), policyVersion: "gpt5.6-openai-v1" };
  assert.match(validateModelSelection(stale, "ifrim-frontend"), /policy changed/i);
});

test("respinge providerii și modelele care nu sunt OpenAI GPT-6", () => {
  const selection = selectRoutine();
  assert.match(
    validateModelSelection({ ...selection, providerPolicy: "openai_anthropic" }, "ifrim-frontend"),
    /Only OpenAI/i,
  );
  assert.match(
    validateModelSelection({ ...selection, effectiveModel: "anthropic/claude" }, "ifrim-frontend"),
    /GPT-6 OpenAI-only/i,
  );
  assert.match(
    validateModelSelection({ ...selection, effectiveModel: "openai/gpt-5.6-terra" }, "ifrim-frontend"),
    /GPT-6 OpenAI-only/i,
  );
});

test("respinge efortul nepermis pentru Luna", () => {
  const selection = { ...selectRoutine(), thinking: "ultra" };
  assert.match(validateModelSelection(selection, "ifrim-frontend"), /Reasoning effort/i);
});

test("respinge selecția asociată altui agent", () => {
  assert.match(validateModelSelection(selectRoutine("ifrim-backend"), "ifrim-frontend"), /does not belong/i);
});

test("respinge fallback-ul declarat explicit", () => {
  const selection = { ...selectRoutine(), fallbacks: ["openai/gpt-6-sol"] };
  assert.match(validateModelSelection(selection, "ifrim-frontend"), /fallback/i);
});

test("respinge fallback-ul mascat într-o comandă de packet", () => {
  const packet = currentPacket();
  packet.commands[0].command = [
    "Set-Location -LiteralPath 'C:\\Ifrim Agent Hub'",
    "$task = @'",
    "Review the isolated test fixture only.",
    "'@",
    "openclaw agent --agent ifrim-frontend `",
    "  --model openai/gpt-6-luna `",
    "  --thinking max `",
    "  --fallback-model openai/gpt-6-sol `",
    "  --message $task --json --timeout 60",
  ].join("\n");
  assert.match(validatePacketModelPolicy(packet), /fallback/i);
});

test("acceptă packetul cu versiunea curentă și rutare OpenAI validă", () => {
  const packet = currentPacket();
  assert.equal(packet.routing.modelPolicyVersion, modelPolicy.version);
  assert.equal(validatePacketModelPolicy(packet), "");
});

test("acceptă tipurile workflow OpenClaw cu model și thinking explicite", () => {
  const packet = currentPacket();
  packet.commands = ["openclaw-owner", "openclaw-reviewer", "openclaw-qa", "openclaw-fix"].map((type) => ({
    type,
    command: `openclaw agent --agent ifrim-frontend --model ${modelPolicy.defaultModel} --thinking ${modelPolicy.defaultThinking}`,
  }));

  for (const command of packet.commands) {
    assert.match(command.command, /(?:^|\s)--model\s+\S+/);
    assert.match(command.command, /(?:^|\s)--thinking\s+\S+/);
  }
  assert.equal(validatePacketModelPolicy(packet), "");
});

test("respinge un model non-OpenAI ascuns în comanda packetului", () => {
  const packet = currentPacket();
  packet.commands[0].command = "openclaw agent --model anthropic/claude --thinking max";
  assert.match(validatePacketModelPolicy(packet), /Non-OpenAI command/i);
});

test("respinge Luna ultra ascuns în comanda packetului", () => {
  const packet = currentPacket();
  packet.commands[0].command = "openclaw agent --model openai/gpt-6-luna --thinking ultra";
  assert.match(validatePacketModelPolicy(packet), /Command model or reasoning/i);
});

test("respinge packetul care conține o comandă Claude", () => {
  const packet = currentPacket();
  packet.commands.push({ type: "claude-review", command: "claude review" });
  assert.match(validatePacketModelPolicy(packet), /Non-OpenAI command/i);
});

test("respinge packetul cu versiune de model policy veche", () => {
  const packet = currentPacket();
  packet.routing.modelPolicyVersion = "gpt5.6-openai-v1";
  assert.match(validatePacketModelPolicy(packet), /policy|packet|obsolete/i);
});

test("command model and effort must match the selection for that agent", () => {
  const packet = currentPacket();
  packet.commands[0].command = "openclaw agent --agent ifrim-frontend --model openai/gpt-6-astra --thinking max";
  assert.match(validatePacketModelPolicy(packet), /does not match/);
});

test("reviewer command cannot borrow owner authorization for maximum effort", () => {
  const packet = currentPacket();
  packet.routing.reviewerAgents = ["ifrim-reviewer"];
  packet.routing.modelSelections = { "ifrim-reviewer": selectRoutine("ifrim-reviewer") };
  packet.commands.push({ type: "openclaw-reviewer", command: "openclaw agent --agent ifrim-reviewer --model openai/gpt-6-astra --thinking ultra" });
  assert.match(validatePacketModelPolicy(packet), /does not match/);
  packet.routing.modelSelections["ifrim-reviewer"] = { ...selectRoutine("ifrim-reviewer"), effectiveModel: "openai/gpt-6-astra", thinking: "ultra" };
  assert.match(validatePacketModelPolicy(packet), /explicit task request/);
});

test("reviewer explicit maximum effort is accepted only with its matching selection", () => {
  const packet = currentPacket();
  packet.routing.reviewerAgents = ["ifrim-reviewer"];
  packet.routing.modelSelections = {
    "ifrim-reviewer": selectModelForTask({ title: "Task simplu", goal: "Model: gpt-6-astra\nReasoning: max" }, "ifrim-reviewer"),
  };
  packet.commands.push({ type: "openclaw-reviewer", command: "openclaw agent --agent ifrim-reviewer --model openai/gpt-6-astra --thinking max" });
  assert.equal(validatePacketModelPolicy(packet), "");
});

test("command agents must be bound to the packet routing", () => {
  const packet = currentPacket();
  packet.commands[0].command = packet.commands[0].command.replace("--agent ifrim-frontend", "--agent other-agent");
  assert.match(validatePacketModelPolicy(packet), /does not belong/);
});
