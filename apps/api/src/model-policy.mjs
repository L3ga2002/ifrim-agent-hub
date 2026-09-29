export const modelPolicy = Object.freeze({
  version: "gpt6-openai-adaptive-v3",
  provider: "openai",
  providerPolicy: "openai_only",
  defaultModel: "openai/gpt-6-luna",
  defaultThinking: "max",
  moderateThinking: "medium",
  complexModel: "openai/gpt-6-sol",
  complexThinking: "high",
  criticalModel: "openai/gpt-6-astra",
  criticalThinking: "xhigh",
  // These are Codex runtime capabilities, not the separate API effort enum.
  models: Object.freeze({
    "openai/gpt-6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
    "openai/gpt-6-sol": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
    "openai/gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  }),
});

export function selectModelForTask(task = {}, agentId = "") {
  let compiler = {};
  try { compiler = JSON.parse(task.compiler_payload_json || "{}"); } catch {}
  if (!compiler || typeof compiler !== "object" || Array.isArray(compiler)) compiler = {};
  const request = [task.title, task.goal].filter(Boolean).join("\n")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Only standalone directives in user-authored task fields authorize overrides.
  const requestedModel = request.match(/^[\t ]*model[\t ]*:[\t ]*(?:openai\/)?(gpt-6-(?:luna|sol|astra))[\t ]*\r?$/m)?.[1];
  const requestedThinking = request.match(/^[\t ]*(?:reasoning|rationament)[\t ]*:[\t ]*(low|medium|high|xhigh|max|ultra)[\t ]*\r?$/m)?.[1];
  const riskContext = [compiler.title, compiler.goal, compiler.scope, compiler.affectedAreas, compiler.riskReasons, compiler.acceptanceCriteria];
  const text = [task.title, task.goal, task.affected_area, task.acceptance, task.risks, ...riskContext]
    .filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const critical = task.priority === "critical" || compiler.riskLevel === "critical" || /\bp0\b|critical|critic|destructive|distructiv/.test(text);
  const deepRisk = /security|securitate|privacy|gdpr|migration|migrar|migrat|database|baza de date|data integrity|integritate|architect|arhitect/.test(text);
  const complex = task.priority === "high" || compiler.riskLevel === "high" || /multi-module|multi-file|integration|integrare|debug|design system/.test(text);
  const tier = critical || deepRisk ? "critical" : complex ? "complex" : "routine";
  const effectiveModel = requestedModel ? `openai/${requestedModel}`
    : tier === "critical" ? modelPolicy.criticalModel : tier === "complex" ? modelPolicy.complexModel : modelPolicy.defaultModel;
  const bounded = /\b(?:simple|easy|simplu|simpla|usor|usoara|typo|typos)\b/.test(text);
  const complexWork = /multi-module|multi-file|integration|integrare|debug|design system/.test(text);
  const moderateWork = /single-module|single-file|bugfix|bug fix|unit tests?|regression tests?|validare|validari|validation|teste unitare|refactorizare locala|local refactor/.test(text);
  const destructiveWork = /destructive|distructiv|data integrity|integritate/.test(text);
  const demandingWork = destructiveWork || (!bounded && (critical || deepRisk));
  const complexity = demandingWork ? "critical" : complexWork ? "complex" : moderateWork && !bounded ? "moderate" : "routine";
  const adaptiveThinking = complexity === "critical" ? modelPolicy.criticalThinking
    : complexity === "complex" ? modelPolicy.complexThinking
    : complexity === "moderate" ? modelPolicy.moderateThinking : "low";
  const isLuna = effectiveModel === modelPolicy.defaultModel;
  const ultraRequested = requestedThinking === "ultra";
  const thinking = isLuna ? modelPolicy.defaultThinking : requestedThinking || adaptiveThinking;
  const reasoningNote = isLuna && ultraRequested
    ? "GPT-6 Luna supports max, not ultra. No model escalation was requested for effort alone."
    : isLuna ? "Luna uses max by explicit project preference."
    : requestedThinking ? "Reasoning was explicitly requested in the task."
    : `Adaptive reasoning: ${complexity} task; model capability alone does not increase effort.`;
  return {
    source: "task-router-v4",
    policyVersion: modelPolicy.version,
    providerPolicy: modelPolicy.providerPolicy,
    agentId,
    desiredModel: effectiveModel,
    effectiveModel,
    thinking,
    tier,
    complexity,
    modelSource: requestedModel ? "explicit_task_request" : "task_router",
    reasoningSource: isLuna ? "luna_project_preference" : requestedThinking ? "explicit_task_request" : "task_complexity",
    ultraRequested,
    reasoningNote,
    strict: critical || deepRisk || /payment|plata|auth/.test(text),
    lunaStatus: "configured_not_runtime_verified",
    entitlementStatus: "not_verified",
    fallbackReason: "",
    fallbacks: [],
  };
}

export function validateModelSelection(selection, agentId) {
  if (!selection || selection.policyVersion !== modelPolicy.version) return "Model policy changed. Prepare a new packet and approval.";
  if (selection.providerPolicy !== modelPolicy.providerPolicy) return "Only OpenAI models are allowed.";
  if (selection.agentId !== agentId) return "Model selection does not belong to this agent.";
  const efforts = Object.hasOwn(modelPolicy.models, selection.effectiveModel || "") ? modelPolicy.models[selection.effectiveModel] : null;
  if (!efforts) return "Model is not allowed by the GPT-6 OpenAI-only policy.";
  if (!efforts.includes(selection.thinking)) return "Reasoning effort is not supported by the selected model.";
  if (selection.effectiveModel !== modelPolicy.defaultModel && ["max", "ultra"].includes(selection.thinking)
    && selection.reasoningSource !== "explicit_task_request") return "Max/ultra reasoning requires an explicit task request for Sol/Astra.";
  if (!Array.isArray(selection.fallbacks) || selection.fallbacks.length) return "Automatic model fallback is disabled.";
  return "";
}

export function validatePacketModelPolicy(packet) {
  if (packet?.routing?.providerPolicy !== modelPolicy.providerPolicy) return "Packet provider policy is obsolete. Prepare a new packet and approval.";
  if (packet.routing.modelPolicyVersion !== modelPolicy.version) return "Packet model policy is obsolete. Prepare a new packet and approval.";
  const owners = packet.routing.ownerAgents || [];
  if (!Array.isArray(owners) || !owners.length || owners.some((id) => typeof id !== "string")) return "Packet has no executable OpenAI agent.";
  const error = validateModelSelection(packet.routing.modelSelection, owners[0]);
  if (error) return error;
  if (!Array.isArray(packet.commands) || !packet.commands.length) return "Packet has no model command.";
  for (const command of packet.commands) {
    if (!command || typeof command.command !== "string") return "Packet model command is invalid.";
    if (!["openclaw", "openclaw-owner", "openclaw-review", "openclaw-reviewer", "openclaw-qa", "openclaw-fix"].includes(command.type)) return "Non-OpenAI command is disabled by the current policy.";
    // Check the CLI invocation, not model names quoted inside the task prompt.
    const script = String(command.command || "").replace(/\r/g, "").trim();
    const promptEnd = script.lastIndexOf("\n'@\n");
    const invocation = (promptEnd < 0 ? script : script.slice(promptEnd + 4)).replace(/`\n[\t ]*/g, " ");
    if (/--fallback(?:-models?)?\b/i.test(invocation)) return "Command fallback overrides are disabled.";
    if (/--provider\b|\bclaude\b|\banthropic\b/i.test(invocation)) return "Non-OpenAI command is disabled by the current policy.";
    const tokens = invocation.split(/\s+/);
    if (tokens.shift() !== "openclaw" || tokens.shift() !== "agent") return "Command invocation is not supported.";
    const options = new Map();
    while (tokens.length) {
      const flag = tokens.shift();
      if (options.has(flag)) return "Duplicate command model/option is not allowed.";
      if (flag === "--json") { options.set(flag, true); continue; }
      const value = tokens.shift();
      const validators = { "--agent": /^[a-z0-9-]+$/, "--model": /^openai\/gpt-6-(luna|sol|astra)$/, "--thinking": /^(low|medium|high|xhigh|max|ultra)$/, "--message": /^\$task$/, "--timeout": /^\d+$/ };
      if (!Object.hasOwn(validators, flag) || !value || !validators[flag].test(value)) return "Command model/option is not allowed by the current policy.";
      options.set(flag, value);
    }
    const models = [...invocation.matchAll(/(?:^|\s)--model\s+(\S+)/g)];
    const efforts = [...invocation.matchAll(/(?:^|\s)--thinking\s+(\S+)/g)];
    if (models.length !== 1 || efforts.length !== 1 || !Object.hasOwn(modelPolicy.models, models[0][1])
      || !modelPolicy.models[models[0][1]].includes(efforts[0][1])) return "Command model or reasoning is not allowed by the current policy.";
    const agentId = options.get("--agent");
    const allowedAgents = [...owners, ...(packet.routing.reviewerAgents || []), ...(packet.routing.qaAgents || [])];
    if (!agentId || !allowedAgents.includes(agentId)) return "Command agent does not belong to the packet routing.";
    const selection = packet.routing.modelSelections?.[agentId] || (agentId === owners[0] ? packet.routing.modelSelection : null);
    const selectionError = validateModelSelection(selection, agentId);
    if (selectionError) return selectionError;
    if (options.get("--model") !== selection.effectiveModel || options.get("--thinking") !== selection.thinking) {
      return "Command model/reasoning does not match the approved agent selection.";
    }
  }
  return "";
}

export function validateExecutionModel(envelope, selection) {
  const meta = envelope?.result?.meta || envelope?.meta;
  const agent = meta?.agentMeta;
  const trace = meta?.executionTrace;
  const modelId = (provider, model) => `${provider}/${String(model || "").replace(/^openai\//, "")}`;
  if (meta?.aborted) return "Model execution was aborted.";
  if (agent?.provider !== "openai" || modelId(agent.provider, agent.model) !== selection.effectiveModel) {
    return "Execution did not verify the requested OpenAI model.";
  }
  if (agent.agentHarnessId !== "codex") return "Execution did not verify the approved Codex harness.";
  if (!trace || trace.fallbackUsed !== false || !Array.isArray(trace.attempts) || !trace.attempts.length) {
    return "Execution fallback evidence is missing or reports a fallback.";
  }
  if (modelId(trace.winnerProvider, trace.winnerModel) !== selection.effectiveModel
    || trace.attempts.some((attempt) => modelId(attempt?.provider, attempt?.model) !== selection.effectiveModel)) {
    return "Execution used an unapproved model or fallback attempt.";
  }
  if (meta.requestShaping?.thinking !== selection.thinking) return "Execution did not verify the requested reasoning effort.";
  return "";
}
