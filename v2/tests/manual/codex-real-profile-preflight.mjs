// Live-validation PRE-FLIGHT, no model: runs plain commands under the real Codex Windows sandbox with the Hub's REAL
// profile (real home, real Hub paths), exactly as a Hub run would. It proves that the sandbox runner still works with
// the deny list and that the protected paths are refused on this machine.
//
// IT CHANGES THE SYSTEM: the elevated sandbox writes persistent DENY ACEs for CodexSandboxUsers on every listed path.
// Run it only after you recorded the consent in Integrations → Izolare, passing that list's fingerprint:
//   node v2/tests/manual/codex-real-profile-preflight.mjs --consent-fingerprint=<fingerprint shown in Integrations>
// It prints ALLOWED/DENIED per check and never prints file names or contents from protected paths.
// Reversal for any path: icacls "<path>" /remove:d CodexSandboxUsers
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { codexIsolationArgs, codexDeniedPaths, denyListFingerprint, CODEX_PROFILE_BY_ACCESS } from "../../server/policy/isolation.mjs";
import { resolveCodexBinary } from "../../server/providers/codex.mjs";
import { loadConfig, HUB_ROOT } from "../../server/config.mjs";

const config = loadConfig({});
const extra = [config.dataDir, config.backupDir];
const paths = codexDeniedPaths({ extra });
const fingerprint = denyListFingerprint(paths);
const given = (process.argv.find((a) => a.startsWith("--consent-fingerprint=")) || "").split("=")[1];
console.log(`Deny list (${paths.length}), fingerprint ${fingerprint}:`);
for (const p of paths) console.log(`  ${p}`);
if (process.platform !== "win32") { console.log("NOT_RUN: Windows-only pre-flight"); process.exit(0); }
if (given !== fingerprint) {
  console.log(given ? `REFUSED: fingerprint ${given} does not match the current list ${fingerprint}; review the list again in Integrations.` : "REFUSED: pass --consent-fingerprint=<fingerprint> after recording the consent in Integrations → Izolare.");
  process.exit(2);
}
const binary = resolveCodexBinary({ providerBinaries: {} });
if (!binary) { console.log("NOT_RUN: Codex binary not found"); process.exit(0); }

const home = os.homedir();
const quiet = (target, verb) => `${verb} "${target}" >nul 2>&1 && echo ALLOWED || echo DENIED`;
const checks = [
  ["runner works (echo)", "echo PREFLIGHT_OK", (out) => /PREFLIGHT_OK/.test(out), true],
  ["read Hub README.md", quiet(path.join(HUB_ROOT, "README.md"), "type"), (out) => /ALLOWED/.test(out), true],
  ["list .ifrim/private", quiet(path.join(HUB_ROOT, ".ifrim", "private"), "dir /b"), (out) => /ALLOWED/.test(out), false],
  ["list .ifrim/BACKUPS", quiet(path.join(HUB_ROOT, ".ifrim", "BACKUPS"), "dir /b"), (out) => /ALLOWED/.test(out), false],
  ["read ~/.codex/auth.json", quiet(path.join(home, ".codex", "auth.json"), "type"), (out) => /ALLOWED/.test(out), false],
  ["list ~/.ssh", quiet(path.join(home, ".ssh"), "dir /b"), (out) => /ALLOWED/.test(out), false],
  ["list ~/.codex/.sandbox-bin (runner dir stays readable)", quiet(path.join(home, ".codex", ".sandbox-bin"), "dir /b"), (out) => /ALLOWED/.test(out), true],
];
let failed = 0;
for (const access of ["read-only"]) {
  const args = [...binary.prefixArgs, "sandbox", ...codexIsolationArgs(access, { extra }), "-P", CODEX_PROFILE_BY_ACCESS[access], "-C", HUB_ROOT, "--"];
  for (const [label, command, allowedWhen, expected] of checks) {
    const r = spawnSync(binary.executable, [...args, "cmd", "/c", command], { encoding: "utf8", timeout: 120000, windowsHide: true });
    const actual = allowedWhen(r.stdout || "");
    const ok = actual === expected;
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${access.padEnd(10)} ${actual ? "ALLOWED" : "DENIED "} ${label}`);
  }
}
console.log(failed ? `FAIL: ${failed} unexpected result(s) — keep the Codex route blocked` : "PASS_LOCAL: real profile pre-flight (no model)");
if (!fs.existsSync(path.join(HUB_ROOT, "README.md"))) console.log("note: Hub README.md not found; the read check is not meaningful");
process.exit(failed ? 1 : 0);
