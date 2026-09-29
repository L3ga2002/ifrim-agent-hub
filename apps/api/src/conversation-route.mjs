import { selectModelForTask, modelPolicy } from "./model-policy.mjs";

export function selectConversationRoute(provider, task = {}, message = "", overrides = {}) {
  if (!["codex", "claude"].includes(provider)) throw new Error("Invalid provider");
  const accessMode = overrides.accessMode || "read-only";
  if (!["read-only", "workspace"].includes(accessMode)) throw new Error("Invalid access mode");
  const agentId = /^ifrim-[a-z-]+$/.test(task.ownerAgent || task.owner_agent || "")
    ? task.ownerAgent || task.owner_agent : "ifrim-backend";
  if (provider === "claude") {
    if (overrides.model && overrides.model !== "anthropic/claude-sonnet-5") throw new Error("Unsupported Claude model");
    const reasoning = overrides.reasoning || "medium";
    if (!["low", "medium", "high", "xhigh", "max"].includes(reasoning)) throw new Error("Unsupported Claude effort");
    return { provider, agentId, model: "anthropic/claude-sonnet-5", reasoning, accessMode, runtime: "claude-cli", transport: "openclaw" };
  }
  if (overrides.model && !Object.hasOwn(modelPolicy.models, overrides.model)) throw new Error("Unsupported Codex model");
  if (overrides.reasoning && !["low", "medium", "high", "xhigh", "max", "ultra"].includes(overrides.reasoning)) throw new Error("Unsupported Codex effort");
  const directives = [overrides.model ? `Model: ${overrides.model}` : "", overrides.reasoning ? `Reasoning: ${overrides.reasoning}` : ""].filter(Boolean);
  const selection = selectModelForTask({ ...task, title: task.title || "", goal: [task.goal, message, ...directives].filter(Boolean).join("\n") }, agentId);
  return { provider, agentId, model: selection.effectiveModel, reasoning: selection.thinking, accessMode, runtime: "codex", transport: "openclaw", selection };
}
