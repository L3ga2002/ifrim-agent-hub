export function configuredAgentEntries(config = {}) {
  if (config.agents?.entries && typeof config.agents.entries === "object" && !Array.isArray(config.agents.entries)) {
    return Object.entries(config.agents.entries).map(([id, value]) => ({ ...value, id }));
  }
  return Array.isArray(config.agents?.list) ? config.agents.list : [];
}

export function agentRoleDefault(id) {
  const critical = new Set(["ifrim-architect", "ifrim-security", "ifrim-security-reviewer", "ifrim-data", "ifrim-data-reviewer", "ifrim-migration"]);
  const complex = new Set(["ifrim-backend", "ifrim-frontend", "ifrim-fullstack", "ifrim-devops", "ifrim-devops-reviewer", "ifrim-integrations", "ifrim-mobile", "ifrim-desktop", "ifrim-ai-engineer", "ifrim-reviewer", "ifrim-backend-reviewer", "ifrim-frontend-reviewer", "ifrim-quality-reviewer", "ifrim-performance-reviewer"]);
  const tier = critical.has(id) ? "astra" : complex.has(id) ? "sol" : "luna";
  return { model: `openai/gpt-6-${tier}`, reasoning: tier === "astra" ? "xhigh" : tier === "sol" ? "high" : "max" };
}

export function buildGpt6ConfigPatch(config, agentIds, { claudeBinary = "" } = {}) {
  const entries = configuredAgentEntries(config);
  if (agentIds.length !== 23 || new Set(agentIds).size !== 23) throw new Error("Expected 23 distinct registered agents");
  if (agentIds.some((id) => !entries.some((entry) => entry.id === id))) throw new Error("Registered agent missing from runtime");
  const models = Object.fromEntries(["luna", "sol", "astra"].map((name) => [
    `openai/gpt-6-${name}`, { agentRuntime: { id: "codex" } },
  ]));
  if (claudeBinary) models["anthropic/claude-sonnet-5"] = { agentRuntime: { id: "claude-cli" } };
  const agents = Object.fromEntries(agentIds.map((id) => {
    const role = agentRoleDefault(id);
    return [id, { model: { primary: role.model, fallbacks: [] }, thinkingDefault: role.reasoning }];
  }));
  const patch = { agents: { defaults: { models, modelPolicy: {
    allow: [...new Set([...(config.agents?.defaults?.modelPolicy?.allow || []), ...Object.keys(models)])],
  } }, entries: agents } };
  if (claudeBinary) {
    patch.plugins = { allow: [...new Set([...(config.plugins?.allow || []), "anthropic"])],
      entries: { anthropic: { enabled: true, config: { sessionCatalog: { enabled: true } } } } };
  }
  return patch;
}
