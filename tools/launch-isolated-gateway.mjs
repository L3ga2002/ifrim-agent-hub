import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { isolationPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";

const [root, entry] = process.argv.slice(2);
const target = isolationPaths(root);
if (process.env.OPENCLAW_STATE_DIR !== target.state || process.env.OPENCLAW_CONFIG_PATH !== target.config) throw new Error("Isolated launch environment mismatch");
await assertPhysicalIsolationBoundary(root, target.state);
const logs = path.join(target.state, "gateway-logs");
fs.mkdirSync(logs, { recursive: true });
await assertPhysicalIsolationBoundary(target.state, logs);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stdoutPath = path.join(logs, `${stamp}.stdout.log`);
const stderrPath = path.join(logs, `${stamp}.stderr.log`);
const out = fs.openSync(stdoutPath, "wx");
const err = fs.openSync(stderrPath, "wx");
try {
  const preload = path.join(root, "tools", "hidden-gateway-preload.mjs");
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, entry, "gateway", "run", "--port", "18790"], {
    cwd: target.state, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", out, err],
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  console.log(JSON.stringify({ pid: child.pid, stdoutPath, stderrPath }));
} finally { fs.closeSync(out); fs.closeSync(err); }
