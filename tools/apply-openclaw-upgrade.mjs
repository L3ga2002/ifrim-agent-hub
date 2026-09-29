import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { buildGpt6ConfigPatch } from "../apps/api/src/openclaw-config.mjs";
const patchPath = process.argv[2];
if (!patchPath || process.argv[3] !== "--approved-hub-018") throw new Error("Explicit HUB-018 approval argument required");
const raw = await fs.readFile(patchPath, "utf8");
const patch = JSON.parse(raw);
if (Object.keys(patch.agents?.entries || {}).length !== 23) throw new Error("Invalid patch scope");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await fs.readFile(path.join(process.env.USERPROFILE, ".openclaw", "openclaw.json"), "utf8"));
const registry = JSON.parse(await fs.readFile(path.join(root, "..", ".ifrim-system", "AGENT_TEAM_V2.json"), "utf8"));
const claudeBinary = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
assert.deepEqual(patch, buildGpt6ConfigPatch(config, registry.agents.map((agent) => agent.id), { claudeBinary }),
  "Patch is stale or differs from the approved adaptive role policy; regenerate and review it");
const client = await connectOpenClaw();
try {
  const snapshot = await client.request("config.get", {}, { timeoutMs: 30000 });
  if (!snapshot.hash) throw new Error("Missing config revision");
  const replacePaths = ["agents.defaults.modelPolicy.allow", ...Object.keys(patch.agents.entries)
    .map((id) => `agents.entries.${id}.model.fallbacks`)];
  const result = await client.request("config.patch", { raw, baseHash: snapshot.hash,
    replacePaths, note: "Approved HUB-018 GPT6 and Claude CLI integration; no delivery", restartDelayMs: 2000 }, { timeoutMs: 60000 });
  console.log(JSON.stringify({ ok: result.ok, restartScheduled: Boolean(result.restart), patchPath }));
} finally { await client.stopAndWait(); }
