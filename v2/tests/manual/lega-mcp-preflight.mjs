// Manual pre-flight for Lega, no model and no voice: starts ONE codex app-server with exactly the Lega process arguments
// (Hub overrides + plugins/subagents off + every config MCP server disabled by name + read-only profile), initializes it
// and asks `mcpServerStatus/list`. No thread is started (so no sandbox setup and no Responses prewarm), no turn, no audio.
// Prints only server names and their runtime status. Usage: node v2/tests/manual/lega-mcp-preflight.mjs
import os from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { CODEX_APP_SERVER_OVERRIDES, inspectCodexConfig, resolveCodexBinary } from "../../server/providers/codex.mjs";
import { CODEX_VOICE_EXTRA_ARGS, mcpDisableArgs } from "../../server/providers/codex-realtime.mjs";
import { codexIsolationArgs } from "../../server/policy/isolation.mjs";
import { buildChildEnv } from "../../server/policy/billing.mjs";
import { loadConfig } from "../../server/config.mjs";

const config = loadConfig({});
const binary = resolveCodexBinary({ providerBinaries: {}, testMode: false });
if (!binary) { console.log("NOT_RUN: Codex binary not found"); process.exit(0); }
const inspected = inspectCodexConfig(os.homedir()).realtime || { mcpServerNames: [] };
const args = [...binary.prefixArgs, ...CODEX_APP_SERVER_OVERRIDES, ...CODEX_VOICE_EXTRA_ARGS, ...mcpDisableArgs(inspected.mcpServerNames),
  ...codexIsolationArgs("read-only", { extra: [config.dataDir, config.backupDir] }), "app-server"];
console.log(`config MCP servers disabled by name: ${inspected.mcpServerNames.length}; risky keys: ${(inspected.riskyKeys || []).join(", ") || "none"}`);

const child = spawn(binary.executable, args, { cwd: os.tmpdir(), env: buildChildEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
child.stdin.on("error", () => {}); child.stderr.on("data", () => {});
const pending = new Map(); let nextId = 1;
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
});
const request = (method, params, ms = 30000) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, ms);
});

let exitCode = 0;
try {
  await request("initialize", { clientInfo: { name: "ifrim_agent_hub", title: "Ifrim Agent Hub (Lega MCP pre-flight)", version: "preflight" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  const listed = await request("mcpServerStatus/list", { detail: "toolsAndAuthOnly" }, 60000);
  const servers = listed?.data || [];
  // Without a thread Codex lists configured servers with no runtime status (null); the enabled/disabled verdict only exists
  // inside a thread (Lega checks it there). What this pre-flight CAN prove: which servers exist at all for the Lega process.
  const disabledByName = new Set(inspected.mcpServerNames);
  const unexpected = servers.filter((s) => !disabledByName.has(s.name) && s.runtimeStatus !== "disabled");
  for (const s of servers) console.log(`${disabledByName.has(s.name) ? "OFF(by name)" : s.runtimeStatus === "disabled" ? "OFF         " : "NOT DISABLED"} ${s.name} (${s.runtimeStatus || "no thread"})`);
  console.log(unexpected.length ? `FAIL: ${unexpected.length} server(s) not covered by the Lega overrides: ${unexpected.map((s) => s.name).join(", ")}` : `PASS_LOCAL: ${servers.length} server(s) present, all disabled by name for Lega; no plugin server present`);
  exitCode = unexpected.length ? 1 : 0;
} catch (error) {
  console.log(`ERROR: ${error.message}`); exitCode = 2;
} finally {
  child.stdin.end();
  setTimeout(() => { try { child.kill(); } catch { /* gone */ } process.exit(exitCode); }, 1500);
}
