// Optional test-process preload. No git is launched, including indirect runtime gitState calls.
// Real rehearsal NEVER imports this: simulated git absence is labelled in fake evidence.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
export const blockedGitCalls = [];
globalThis[Symbol.for("s25.fake.gitGuard")] = blockedGitCalls;
for (const method of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const original = childProcess[method];
  childProcess[method] = function(file, ...args) {
    if (/(?:^|[\\/])git(?:\.exe)?$/i.test(String(file))) {
      blockedGitCalls.push({ method, args: args[0] });
      throw Object.assign(new Error("S25 test guard: git unavailable (no command executed)"), { code: "ENOENT" });
    }
    return original.call(this, file, ...args);
  };
  // Preserve Node's stdout/stderr promisify argument metadata; never bypass the wrapper.
  for (const symbol of Object.getOwnPropertySymbols(original)) {
    if (Array.isArray(original[symbol])) Object.defineProperty(childProcess[method], symbol, Object.getOwnPropertyDescriptor(original, symbol));
  }
  if (original[promisify.custom]) childProcess[method][promisify.custom] = async function(file, ...args) {
    if (/(?:^|[\\/])git(?:\.exe)?$/i.test(String(file))) {
      blockedGitCalls.push({ method, args: args[0] });
      throw Object.assign(new Error("S25 test guard: git unavailable (no command executed)"), { code: "ENOENT" });
    }
    return original[promisify.custom](file, ...args);
  };
}
syncBuiltinESMExports();
