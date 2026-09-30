// Manual PASS_LOCAL check against the REAL codex.exe with an EMPTY CODEX_HOME (no credentials):
// validates JSONL framing, the initialize handshake and the account/read response shape of the
// installed version. No login, no network credentials, no thread or turn, therefore no inference.
// Run: node v2/tests/manual/codex-handshake-fresh-home.mjs
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../server/config.mjs";
import { createSupervisor } from "../../server/runtime/supervisor.mjs";
import { createJsonRpcPeer } from "../../server/providers/jsonrpc.mjs";
import { resolveCodexBinary, CODEX_ALLOWED_METHODS, normalizeAccount } from "../../server/providers/codex.mjs";

const config = loadConfig({ testMode: false });
const binary = resolveCodexBinary(config);
if (!binary) { console.log(JSON.stringify({ result: "BLOCKED", reason: "codex.exe not found" })); process.exit(0); }
const home = path.join(config.hubRoot, ".ifrim", "tmp", `codex-fresh-home-${Date.now()}`);
fs.mkdirSync(home, { recursive: true });
const supervisor = createSupervisor({ config });
const started = Date.now();
let peer;
const record = supervisor.start({ key: "fresh", label: "codex app-server (fresh home)", executable: binary.executable, args: ["app-server"], cwd: home,
  env: { CODEX_HOME: home }, onStdoutLine: (line) => peer.handleLine(line) });
peer = createJsonRpcPeer({ write: (t) => record.child.stdin.write(`${t}\n`), allowedMethods: CODEX_ALLOWED_METHODS, onNotification: () => {} });
const out = { binary: binary.executable, codexHome: "fresh temp dir (no credentials)" };
try {
  const init = await peer.request("initialize", { clientInfo: { name: "ifrim_agent_hub", title: "Ifrim Agent Hub", version: "2.0.0-build" }, capabilities: { experimentalApi: false } }, 30000);
  peer.notify("initialized", {});
  out.initializeMs = Date.now() - started;
  out.initializeKeys = Object.keys(init || {}).sort();
  const account = await peer.request("account/read", {}, 30000);
  out.accountRaw = { hasAccount: Boolean(account?.account), requiresOpenaiAuth: account?.requiresOpenaiAuth };
  out.normalized = normalizeAccount(account);
  try { await peer.request("account/rateLimitResetCredit/consume", {}, 1000); out.creditMethod = "SENT (unexpected)"; }
  catch (error) { out.creditMethod = `refused client-side: ${error.message}`; }
  out.result = out.normalized.accountType === "none" ? "PASS_LOCAL" : "UNEXPECTED";
} catch (error) {
  out.result = "FAIL";
  out.error = error.message;
  out.stderr = record.stderrTail.slice(-5);
} finally {
  await supervisor.stop("fresh", { graceMs: 1500 });
  fs.rmSync(home, { recursive: true, force: true });
}
out.totalMs = Date.now() - started;
console.log(JSON.stringify(out, null, 2));
