// Preload for the part-A offline verification command, inherited by Node children.
// Test selection still matters: no test here may launch a browser, model or local server.
import net from "node:net";
import child from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const refuse = () => { throw new Error("PART_A_GUARDRAIL: network/browser/model operation refused"); };
net.Server.prototype.listen = refuse;
net.Socket.prototype.connect = refuse;
globalThis.fetch = refuse;
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const original = child[name];
  child[name] = function(command, args, ...rest) {
    const binary = String(command).replaceAll("\\", "/").split("/").at(-1).toLowerCase();
    if (/^(codex|claude|openclaw|chrome|chromium|brave)(\.exe|\.cmd)?$/.test(binary)) refuse();
    if (/^git(\.exe)?$/.test(binary)) throw new Error("PART_A_GUARDRAIL: git subprocess refused");
    return original.call(this, command, args, ...rest);
  };
}
syncBuiltinESMExports();
