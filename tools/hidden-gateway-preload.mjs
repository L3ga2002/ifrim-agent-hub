import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { writeSync } from "node:fs";
import { assertPhysicalIsolationBoundary, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";
import { installHiddenChildWindows } from "../apps/api/src/hidden-child-process.mjs";
import { installCodexTransportDiagnostics } from "../apps/api/src/gateway-rpc-diagnostics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = isolationPaths(root);
if (process.env.OPENCLAW_STATE_DIR !== target.state || process.env.OPENCLAW_CONFIG_PATH !== target.config) {
  throw new Error("Hidden child process policy requires the isolated Hub Gateway");
}
await assertPhysicalIsolationBoundary(root, target.state);
installHiddenChildWindows(childProcess);
const config = JSON.parse(fs.readFileSync(target.config, "utf8"));
const executable = config.plugins?.entries?.codex?.config?.appServer?.command;
if (typeof executable !== "string" || !path.isAbsolute(executable)) throw new Error("Missing isolated Codex executable");
await assertPhysicalIsolationBoundary(root, path.dirname(executable));
installCodexTransportDiagnostics(childProcess, executable, (line) => writeSync(2, line));
syncBuiltinESMExports();
