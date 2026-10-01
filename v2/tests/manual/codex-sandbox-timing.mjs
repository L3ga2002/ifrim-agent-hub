// Inference-free timing of the Codex Windows sandbox with the Hub profile (M03 §08): how long does `codex sandbox` take
// to run a trivial command, cold and warm? No model, no network, no prompt. It answers whether the ~5–8 minutes before the
// first command of a live run are sandbox set-up (ACL sync over the denied paths) or model reasoning.
//
//   node v2/tests/manual/codex-sandbox-timing.mjs --fictive        a throw-away tree in %TEMP% (no real path is touched)
//   node v2/tests/manual/codex-sandbox-timing.mjs --real-profile   the REAL Hub profile on a throw-away workspace: the
//       sandbox (re)applies the DENY ACEs you consented to on the real protected paths. OWNER ONLY, in your own terminal.
//
// Prints durations and exit codes only (never file contents). Each mode runs 3 cold+warm pairs (N is small: read the
// values as observations, not percentiles).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { codexIsolationArgs, CODEX_PROFILE_BY_ACCESS } from "../../server/policy/isolation.mjs";
import { resolveCodexBinary } from "../../server/providers/codex.mjs";
import { HUB_ROOT } from "../../server/config.mjs";

const real = process.argv.includes("--real-profile");
if (!real && !process.argv.includes("--fictive")) { console.log("Choose --fictive or --real-profile (owner only)."); process.exit(2); }
const binary = resolveCodexBinary({ providerBinaries: {} });
if (!binary) { console.log("NOT_RUN: Codex binary not found"); process.exit(0); }

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-sbx-timing-"));
const ws = path.join(base, "workspace");
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "README.md"), "timing workspace\n");
const fakeHome = path.join(base, "home");
const fakeHub = path.join(base, "hub");
if (!real) { fs.mkdirSync(path.join(fakeHome, ".codex"), { recursive: true }); fs.mkdirSync(path.join(fakeHub, ".ifrim", "private"), { recursive: true }); }
const isolation = real
  ? codexIsolationArgs("workspace-write", { extra: [path.join(HUB_ROOT, ".ifrim", "private"), path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2")] })
  : codexIsolationArgs("workspace-write", { homeDir: fakeHome, hubRoot: fakeHub });
const args = [...binary.prefixArgs, "sandbox", ...isolation, "-P", CODEX_PROFILE_BY_ACCESS["workspace-write"], "-C", ws, "--"];
const commands = process.platform === "win32" ? [["cmd", "/c", "echo", "ok"], [process.execPath, "--version"]] : [["true"], [process.execPath, "--version"]];

const results = [];
try {
  for (let round = 1; round <= 3; round += 1) {
    for (const command of commands) {
      const started = process.hrtime.bigint();
      const r = spawnSync(binary.executable, [...args, ...command], { encoding: "utf8", timeout: 15 * 60 * 1000, windowsHide: true });
      const ms = Number((process.hrtime.bigint() - started) / 1000000n);
      results.push({ round, command: command.slice(0, 2).join(" "), exit: r.status, timedOut: r.error?.code === "ETIMEDOUT", ms });
      console.log(`${real ? "real-profile" : "fictive"} round ${round} · ${command.slice(0, 2).join(" ").padEnd(14)} · exit ${r.status} · ${(ms / 1000).toFixed(1)} s`);
    }
  }
} finally {
  // The sandbox may still hold a handle for a moment after the last command: retry, and never lose the results over it.
  try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch (error) { console.log(`temporary tree not removed yet (${error.code}): ${base} — delete it later`); }
}
const first = results[0]?.ms ?? null;
const rest = results.slice(1).map((r) => r.ms);
console.log(`\nfirst command: ${first === null ? "—" : `${(first / 1000).toFixed(1)} s`} · later commands: ${rest.length ? rest.map((ms) => `${(ms / 1000).toFixed(1)}`).join(", ") : "—"} s`);
console.log(`binary ${path.basename(path.dirname(binary.executable))} · N=${results.length} observations (cold = round 1, warm = rounds 2–3)`);
console.log("Paste these lines into the Hub's M03 performance report (.ifrim/M03_PERFORMANCE_REPORT.md).");
