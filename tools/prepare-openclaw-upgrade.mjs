import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { buildGpt6ConfigPatch } from "../apps/api/src/openclaw-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(process.env.USERPROFILE, ".openclaw", "openclaw.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const privateDir = path.join(process.env.LOCALAPPDATA, "IfrimDigital", "OpenClawBackups", `hub-018-${stamp}`);
await fs.mkdir(privateDir, { recursive: true });
const original = await fs.readFile(configPath);
const config = JSON.parse(original.toString("utf8"));
const registry = JSON.parse(await fs.readFile(path.join(root, "..", ".ifrim-system", "AGENT_TEAM_V2.json"), "utf8"));
const claudeBinary = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
await fs.access(claudeBinary);
const patch = buildGpt6ConfigPatch(config, registry.agents.map((agent) => agent.id), { claudeBinary });
const configBackup = path.join(privateDir, "openclaw-pre-gpt6.json");
await fs.writeFile(configBackup, original, { flag: "wx" });
const hash = (data) => createHash("sha256").update(data).digest("hex");
if (hash(await fs.readFile(configBackup)) !== hash(original)) throw new Error("Config backup mismatch");
const sqlitePath = path.join(root, ".ifrim", "BACKUPS", `hub-018-${stamp}.sqlite`);
const db = new DatabaseSync(path.join(root, ".ifrim", "private", "agent-hub.sqlite"), { readOnly: true });
try { await backup(db, sqlitePath); } finally { db.close(); }
const copy = new DatabaseSync(sqlitePath, { readOnly: true });
try { if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Invalid checkpoint"); }
finally { copy.close(); }
const patchPath = path.join(privateDir, "gpt6-patch.json");
await fs.writeFile(patchPath, JSON.stringify(patch, null, 2), { flag: "wx" });
console.log(JSON.stringify({ configBackup, configSha256: hash(original), sqlitePath, patchPath, agents: 23 }));
