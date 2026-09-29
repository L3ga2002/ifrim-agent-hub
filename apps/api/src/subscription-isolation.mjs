import path from "node:path";
import fs from "node:fs/promises";
import { configuredAgentEntries, agentRoleDefault } from "./openclaw-config.mjs";

export const isolatedProfileId = "openai:ifrimcatalin30@gmail.com";

export async function assertPhysicalIsolationBoundary(root, target) {
  const base = path.resolve(root), resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Isolation target must be inside the Hub");
  const paths = [];
  for (let current = resolved; ; current = path.dirname(current)) {
    paths.push(current);
    if (path.dirname(current) === current) break;
  }
  for (const current of paths.reverse()) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Isolation path contains a link or non-directory");
      if ((await fs.realpath(current)).toLowerCase() !== current.toLowerCase()) throw new Error("Isolation path differs from its physical location");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function isolationPaths(root) {
  const state = path.join(path.resolve(root), ".ifrim", "private", "openclaw-subscription-runtime");
  return { state, config: path.join(state, "openclaw.json"), port: 18790 };
}

export function buildIsolatedSubscriptionConfig(source, root, token) {
  const entries = configuredAgentEntries(source);
  if (entries.length !== 23 || new Set(entries.map((a) => a.id)).size !== 23
    || entries.some((a) => !/^(main|ifrim-[a-z-]+)$/.test(a.id))) throw new Error("Expected the existing 23 registered roles");
  if (typeof token !== "string" || token.length < 32) throw new Error("Independent Gateway authentication required");
  const command = source.plugins?.entries?.codex?.config?.appServer?.command;
  if (!command || !path.isAbsolute(command)) throw new Error("Native Codex binary must be explicit");
  const { state, port } = isolationPaths(root);
  const models = Object.fromEntries(["luna", "sol", "astra"].map((tier) => [
    `openai/gpt-6-${tier}`, { agentRuntime: { id: "codex" } },
  ]));
  models["anthropic/claude-sonnet-5"] = { agentRuntime: { id: "claude-cli" } };
  return {
    gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token } },
    agents: { ownership: "explicit", defaults: { skipBootstrap: true, workspace: path.join(state, "workspace"),
      model: { primary: "openai/gpt-6-luna", fallbacks: [] }, thinkingDefault: "max",
      models, modelPolicy: { allow: Object.keys(models) } },
      entries: Object.fromEntries(entries.map(({ id }) => {
        const role = agentRoleDefault(id);
        return [id, { workspace: path.join(state, "workspaces", id), agentDir: path.join(state, "agents", id, "agent"),
          model: { primary: role.model, fallbacks: [] }, thinkingDefault: role.reasoning }];
      })) },
    auth: { profiles: { [isolatedProfileId]: { provider: "openai", mode: "oauth" } }, order: { openai: [isolatedProfileId] } },
    plugins: { allow: ["codex", "anthropic"], entries: {
      codex: { enabled: true, config: { sessionCatalog: { enabled: false }, appServer: { command, transport: "stdio", homeScope: "agent" } } },
      anthropic: { enabled: true, config: { sessionCatalog: { enabled: true } } },
    } },
  };
}

export function validateIsolatedPaths(config, root) {
  const { state, port } = isolationPaths(root);
  const inside = (value) => typeof value === "string" && path.resolve(value).startsWith(`${path.resolve(state)}${path.sep}`);
  if (config.gateway?.port !== port || config.gateway?.bind !== "loopback") throw new Error("Isolated loopback Gateway required");
  if (!inside(config.agents?.defaults?.workspace)) throw new Error("Default workspace escapes isolated state");
  const entries = configuredAgentEntries(config);
  if (entries.length !== 23) throw new Error("All registered roles must be isolated");
  if (config.agents.ownership !== "explicit") throw new Error("Explicit multi-agent ownership required");
  if (config.plugins?.entries?.codex?.config?.sessionCatalog?.enabled !== false) throw new Error("Ambient native catalog must be disabled; Hub sessions remain on demand");
  for (const entry of entries) if (!inside(entry.agentDir) || !inside(entry.workspace)) throw new Error("Agent path escapes isolated state");
  if (config.channels || config.secrets || config.env || config.models || config.$include) throw new Error("External configuration is not allowed in isolated state");
  return true;
}
