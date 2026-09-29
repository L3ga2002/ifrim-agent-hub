export const hubAcceptanceScopes = Object.freeze({
  codex: Object.freeze({ acceptanceConversationId: "conversation-e6fbedfd-3b88-4bb5-8808-0b18cf4ccb29",
    acceptanceProvider: "codex", acceptanceModel: "openai/gpt-6-luna", acceptanceReasoning: "max", acceptanceAccessMode: "read-only" }),
  claude: Object.freeze({ acceptanceConversationId: "conversation-e6fbedfd-3b88-4bb5-8808-0b18cf4ccb29",
    acceptanceProvider: "claude", acceptanceModel: "anthropic/claude-sonnet-5", acceptanceReasoning: "medium", acceptanceAccessMode: "read-only" }),
});

export function exactHubAcceptanceScope(gate) {
  return Object.values(hubAcceptanceScopes).find((scope) => Object.entries(scope).every(([key, value]) => gate?.[key] === value)) || null;
}

export function targetHubAcceptanceCertificate(gate, provider) {
  const scope = typeof provider === "string" && Object.hasOwn(hubAcceptanceScopes, provider) ? hubAcceptanceScopes[provider] : null;
  if (!scope || gate?.status !== "suspended") throw new Error("Suspend admission before changing acceptance scope");
  const scoped = Object.keys(hubAcceptanceScopes.codex).some((key) => Object.hasOwn(gate, key));
  if (scoped && !exactHubAcceptanceScope(gate)) throw new Error("Unknown or mixed previous acceptance scope");
  return { ...gate, ...scope, status: "suspended" };
}
