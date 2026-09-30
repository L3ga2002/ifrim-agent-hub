// Manual, inference-free check of the Hub's Codex isolation profile on THIS machine (M02 SECURITY READINESS).
// `codex sandbox` runs plain commands under the native sandbox with the exact profile the Hub passes to every
// app-server (v2/server/policy/isolation.mjs). Canary files contain FICTIVE markers only; nothing is sent to a model.
//
// Everything lives in a throw-away tree in the system temp directory: a FAKE Hub root, a FAKE home and a workspace
// that is NOT inside the fake Hub (as for a separate test project). The Windows sandbox writes persistent DENY ACEs on
// denied paths, so the real Hub and the real home are never passed here; the tree is deleted at the end.
// Usage: node v2/tests/manual/codex-sandbox-canary.mjs      (prints READ/DENIED per path; never file contents)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { codexIsolationArgs, CODEX_PROFILE_BY_ACCESS } from "../../server/policy/isolation.mjs";
import { resolveCodexBinary } from "../../server/providers/codex.mjs";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-canary-"));
const fakeHub = path.join(base, "hub");
const fakeData = path.join(base, "hub-data");
const ws = path.join(base, "workspace");
const fakeHome = path.join(base, "home");
const BS = String.fromCharCode(92);
const write = (dir, rel, text) => { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
for (const [rel, text] of [["README.md", "PUBLIC-OK"], [".ifrim/private/canary.txt", "CANARY-PRIVATE-FICTIVE"], [".ifrim/BACKUPS/canary.txt", "CANARY-BACKUP-FICTIVE"],
  [".ifrim/tmp/canary.txt", "CANARY-TMP-FICTIVE"], [".env", "CANARY_ENV=fictive"], ["app/.env.local", "CANARY_ENV_LOCAL=fictive"]]) write(ws, rel, text);
for (const [rel, text] of [["README.md", "PUBLIC-HUB"], [".ifrim/private/hub-v2.sqlite", "CANARY-HUB-DB-FICTIVE"], [".ifrim/BACKUPS/v2/b.zip", "CANARY-HUB-BACKUP-FICTIVE"],
  [".ifrim/tmp/x.txt", "CANARY-HUB-TMP-FICTIVE"], [".env", "CANARY_HUB_ENV=fictive"], [".env.production", "CANARY_HUB_ENV_PROD=fictive"]]) write(fakeHub, rel, text);
write(fakeData, "canary.txt", "CANARY-DATA-FICTIVE");
for (const [rel, text] of [[".ssh/id_canary", "CANARY-SSH-FICTIVE"], [".codex/auth.json", "CANARY-CODEX-AUTH-FICTIVE"], [".codex/sessions/s.jsonl", "CANARY-CODEX-SESSION-FICTIVE"],
  [".codex/.sandbox-bin/runner-canary.txt", "PUBLIC-RUNNER"], [".codex/config.toml", "PUBLIC-CODEX-CONFIG"], [".claude/.credentials.json", "CANARY-CLAUDE-FICTIVE"],
  [".config/gh/hosts.yml", "CANARY-GH-FICTIVE"]]) write(fakeHome, rel, text);
if (process.platform === "win32") execFileSync("cmd", ["/c", "mklink", "/J", path.join(ws, "linked-private"), path.join(ws, ".ifrim", "private")], { stdio: "ignore" });

const binary = resolveCodexBinary({ providerBinaries: {} });
if (!binary) { fs.rmSync(base, { recursive: true, force: true }); console.log("NOT_RUN: Codex binary not found"); process.exit(0); }
const label = (target) => (target.startsWith(fakeHome) ? `~${target.slice(fakeHome.length)}` : target.startsWith(fakeData) ? `<data>${target.slice(fakeData.length)}`
  : target.startsWith(fakeHub) ? `<hub>${target.slice(fakeHub.length)}` : target).split(BS).join("/");
const expectations = [];
try {
  for (const access of ["read-only", "workspace-write"]) {
    const isolation = codexIsolationArgs(access, { homeDir: fakeHome, hubRoot: fakeHub, extra: [fakeData] });
    const args = [...binary.prefixArgs, "sandbox", ...isolation, "-P", CODEX_PROFILE_BY_ACCESS[access], "-C", ws, "--"];
    const run = (cmd) => spawnSync(binary.executable, [...args, ...cmd], { encoding: "utf8", timeout: 90000, windowsHide: true });
    const reads = [["README.md", true], [".ifrim/private/canary.txt", false], [".ifrim/BACKUPS/canary.txt", false], [".ifrim/tmp/canary.txt", false], [".env", false],
      ["app/.env.local", false], ...(process.platform === "win32" ? [["linked-private/canary.txt", false]] : []),
      [path.join(fakeHub, "README.md"), true], [path.join(fakeHub, ".ifrim", "private", "hub-v2.sqlite"), false], [path.join(fakeHub, ".ifrim", "BACKUPS", "v2", "b.zip"), false],
      [path.join(fakeHub, ".ifrim", "tmp", "x.txt"), false], [path.join(fakeHub, ".env"), false], [path.join(fakeHub, ".env.production"), false], [path.join(fakeData, "canary.txt"), false],
      [path.join(fakeHome, ".ssh", "id_canary"), false], [path.join(fakeHome, ".codex", "auth.json"), false], [path.join(fakeHome, ".codex", "sessions", "s.jsonl"), false],
      [path.join(fakeHome, ".codex", ".sandbox-bin", "runner-canary.txt"), true], [path.join(fakeHome, ".codex", "config.toml"), true],
      [path.join(fakeHome, ".claude", ".credentials.json"), false], [path.join(fakeHome, ".config", "gh", "hosts.yml"), false]];
    for (const [target, allowed] of reads) {
      const r = run(process.platform === "win32" ? ["cmd", "/c", "type", target.split("/").join(BS)] : ["cat", target]);
      const read = /PUBLIC-|CANARY/.test(r.stdout || "");
      expectations.push({ access, op: "read", target: path.isAbsolute(target) ? label(target) : target, expected: allowed, actual: read });
    }
    for (const [target, allowed] of [["write-test.txt", access === "workspace-write"], [".ifrim/private/write-test.txt", false]]) {
      run(process.platform === "win32" ? ["cmd", "/c", `echo x> ${target.split("/").join(BS)}`] : ["sh", "-c", `echo x > ${target}`]);
      const written = fs.existsSync(path.join(ws, target));
      expectations.push({ access, op: "write", target, expected: allowed, actual: written });
    }
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
let failed = 0;
for (const e of expectations) {
  const ok = e.expected === e.actual;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${e.access.padEnd(15)} ${e.op.padEnd(5)} ${e.actual ? "ALLOWED" : "DENIED "} ${e.target}`);
}
console.log(failed ? `FAIL: ${failed} unexpected result(s)` : `PASS_LOCAL: ${expectations.length} checks (binary ${path.basename(path.dirname(binary.executable))})`);
console.log(`tree removed: ${!fs.existsSync(base)}`);
process.exit(failed ? 1 : 0);
