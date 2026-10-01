import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { resolveCodexBinary } from "../providers/codex.mjs";
import { codexIsolationArgs, CODEX_PROFILE_BY_ACCESS } from "../policy/isolation.mjs";
import { redactText } from "../security/redact.mjs";
import { isAllowedCommand, isAllowedPreviewCommand } from "./spec.mjs";

/**
 * The Hub runner for checks, QA and previews (M03 §16, §21). Generated code is NEVER run with the backend's rights: every
 * command runs through `codex sandbox` with the Hub's workspace-write profile (Windows elevated sandbox, protected paths
 * denied, network off), the same OS boundary the writer had — no model is involved. Preconditions are the ones a Codex
 * run has (installed client, sandbox reported ready, the owner's consent to the exact deny list); otherwise the step is
 * BLOCKED with the reason, never run another way. In test mode the client is the fake fixture, which runs the command
 * without any real sandbox: results are PASS_SIMULATED only.
 *
 * Known limit (R2): the sandbox still reads the host outside the denied paths; a test can read other projects by absolute
 * path exactly like the writer could.
 */
export const RUNNER_TIMEOUT_MS = 180000;
const OUTPUT_LINES = 300;

export function commandArgv(command) {
  const parts = String(command).trim().split(/\s+/);
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (parts[0] === "node" && parts[1] === "--test") return [process.execPath, "--test", "--test-reporter=tap", ...parts.slice(2)];
  if (parts[0] === "node") return [process.execPath, ...parts.slice(1)];
  if (parts[0] === "npm" && parts[1] === "test") return [process.execPath, npmCli, "test"];
  if (parts[0] === "npm" && parts[1] === "run") return [process.execPath, npmCli, "run", parts[2]];
  return null;
}

/** Test counts from TAP (`# tests 3`) or the spec reporter (`ℹ tests 3`), plus the names of failing tests. */
export function parseTestOutput(lines) {
  const counts = {};
  const failures = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:#|ℹ)\s*(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/);
    if (m) counts[m[1]] = Number(m[2]);
    const f = line.match(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/);
    if (f && failures.length < 30) failures.push(f[1].slice(0, 200));
  }
  return { counts, failures };
}

/** Raw status of a test command from its exit code and counts; zero tests found is never a pass. */
export function testStatus({ exitCode, counts, timedOut }) {
  if (timedOut) return { status: "FAIL", reason: "timeout" };
  if (exitCode !== 0) return { status: "FAIL", reason: `exit ${exitCode}` };
  if (counts.tests === undefined) return { status: "INCONCLUSIVE", reason: "ieșire fără sumar de teste" };
  if (counts.tests === 0) return { status: "INCONCLUSIVE", reason: "0 teste descoperite" };
  if (counts.fail > 0) return { status: "FAIL", reason: `${counts.fail} teste eșuate` };
  return { status: "PASS", reason: `${counts.pass ?? counts.tests}/${counts.tests} trecute` };
}

export function createFactoryRunner({ config, supervisor, settings, providerState, codexIsolation, homeDir = os.homedir() }) {
  const profile = CODEX_PROFILE_BY_ACCESS["workspace-write"];

  /** Whether the sandboxed runner may run on this machine now (never a fallback to an unsandboxed process). */
  function readiness() {
    const binary = resolveCodexBinary(config);
    if (!binary) return { ok: false, isolation: "none", detail: "Clientul Codex nu e instalat: runner-ul sandbox nu poate porni (BLOCKED)" };
    if (config.testMode) return { ok: true, binary, isolation: "SIMULATED: fixture fake-codex, fără sandbox real" };
    if (process.platform === "win32") {
      const sandbox = providerState.get("codex")?.sandbox;
      if (sandbox?.readiness !== "ready") return { ok: false, isolation: "none", detail: `Sandbox-ul Windows al Codex nu e raportat „ready” (${sandbox?.readiness || "neverificat"}); rulează „Verifică contul” în Integrări` };
      const consent = settings.get("isolationConsent")?.codex;
      if (!consent?.confirmedAt || consent.fingerprint !== codexIsolation().fingerprint) {
        return { ok: false, isolation: "none", detail: "NEEDS_LIVE_APPROVAL: acordul pentru lista exactă de căi protejate (ACL Codex) lipsește sau e pentru altă listă; aprobă-l în Integrări → Izolare" };
      }
    }
    return { ok: true, binary, isolation: `Codex sandbox ${process.platform === "win32" ? "Windows elevated" : ""}, profil ${profile}, rețea oprită (R2: host-ul rămâne citibil în afara căilor refuzate)` };
  }

  function sandboxArgs(binary, ws, argv) {
    return [...binary.prefixArgs, "sandbox", ...codexIsolationArgs("workspace-write", { homeDir, extra: [config.dataDir, config.backupDir] }), "-P", profile, "-C", ws, "--", ...argv];
  }

  /**
   * Runs one allowed command in `ws`. Returns { status, reason, exitCode, counts, failures, durationMs, outputTail, isolation,
   * runner, command }. `key` names the supervised process (Stop kills it).
   */
  function run({ key, ws, command, timeoutMs = RUNNER_TIMEOUT_MS }) {
    const started = Date.now();
    const base = { command, runner: "codex-sandbox", durationMs: 0, exitCode: null, counts: {}, failures: [], outputTail: "" };
    if (!isAllowedCommand(command)) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comandă în afara listei acceptate", isolation: "none" });
    const ready = readiness();
    if (!ready.ok) return Promise.resolve({ ...base, status: "BLOCKED", reason: ready.detail, isolation: ready.isolation });
    const argv = commandArgv(command);
    const binary = ready.binary; // the Codex client: the same provider binary every run uses
    return new Promise((resolve) => {
      const out = [];
      let timedOut = false;
      let record;
      try {
        record = supervisor.start({ key, label: `runner: ${command}`, executable: binary.executable, args: sandboxArgs(binary, ws, argv), cwd: ws,
          env: { NODE_ENV: "test", CI: "1" }, onStdoutLine: (line) => { out.push(redactText(line).slice(0, 500)); if (out.length > OUTPUT_LINES) out.shift(); } });
      } catch (error) {
        resolve({ ...base, status: "BLOCKED", reason: `runner-ul nu a pornit: ${error.message}`, isolation: ready.isolation });
        return;
      }
      const timer = setTimeout(() => { timedOut = true; supervisor.stop(key, { graceMs: 500 }).catch(() => {}); }, timeoutMs);
      timer.unref?.();
      record.exit.then((exit) => {
        clearTimeout(timer);
        supervisor.forget(key);
        const lines = [...out, ...record.stderrTail.map((l) => `[stderr] ${l}`)];
        const { counts, failures } = parseTestOutput(lines);
        const verdict = testStatus({ exitCode: exit.code, counts, timedOut });
        resolve({ ...base, ...verdict, exitCode: exit.code, counts, failures, durationMs: Date.now() - started, outputTail: lines.slice(-120).join("\n"), isolation: ready.isolation,
          stopped: record.stoppedByHub || false });
      });
    });
  }

  /** Starts a long-running preview inside the same sandbox (on a free port) and waits until `url` answers (or `waitMs` passes). */
  async function startPreview({ key, ws, command, url, waitMs = 20000 }) {
    if (!isAllowedPreviewCommand(command)) return { status: "BLOCKED", reason: "comandă de preview neacceptată" };
    const ready = readiness();
    if (!ready.ok) return { status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
    // The port must be free: otherwise the preview evidence and the E2E would be about someone else's server (another dev
    // app, V1). The mission's own previous preview was stopped just before; its port may take a moment to close.
    for (let waited = 0; ; waited += 300) {
      const busy = await portInUse(url);
      if (!busy) break;
      if (waited >= 3000) return { status: "BLOCKED", reason: `portul din ${url} e ocupat de alt proces (${busy}): preview-ul nu pornește peste un server străin`, isolation: ready.isolation };
      await new Promise((r) => setTimeout(r, 300));
    }
    const out = [];
    const binary = ready.binary;
    let record;
    try {
      record = supervisor.start({ key, label: `preview: ${command}`, executable: binary.executable, args: sandboxArgs(binary, ws, commandArgv(command)), cwd: ws,
        env: { NODE_ENV: "development" }, onStdoutLine: (line) => { out.push(redactText(line).slice(0, 300)); if (out.length > 60) out.shift(); } });
    } catch (error) { return { status: "BLOCKED", reason: `preview-ul nu a pornit: ${error.message}`, isolation: ready.isolation }; }
    const started = Date.now();
    let check = null;
    while (Date.now() - started < waitMs && !record.exited) {
      check = await probeUrl(url);
      if (check.status >= 200 && check.status < 500) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const ok = check && check.status >= 200 && check.status < 400;
    return { status: ok ? "PASS" : "FAIL", reason: ok ? `HTTP ${check.status}${check.title ? ` · ${check.title}` : ""}` : record.exited ? `procesul de preview s-a oprit (${record.exitCode})` : `URL-ul nu răspunde (${check?.error || check?.status || "—"})`,
      url, pid: record.pid, key, check, isolation: ready.isolation, outputTail: [...out, ...record.stderrTail].slice(-40).join("\n"), durationMs: Date.now() - started };
  }

  return { readiness, run, startPreview, stop: (key) => supervisor.stop(key, { graceMs: 500 }) };
}

/**
 * Whether something already listens on the URL's port (any protocol: HTTP, HTTPS, a hung or non-HTTP server). Only a
 * refused connection means free; an accepted connection or no answer at all means busy. Returns the reason or null.
 */
export function portInUse(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { resolve(null); return; }
    const socket = net.connect({ host: target.hostname.replace(/^\[|\]$/g, ""), port: Number(target.port) });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done("nu răspunde, dar ține portul"));
    socket.once("connect", () => done("acceptă conexiuni"));
    socket.once("error", (error) => done(error.code === "ECONNREFUSED" ? null : `eroare ${error.code || error.message}`));
  });
}

/** Local HTTP GET with the <title> (preview evidence). */
export function probeUrl(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    let parsed;
    try { parsed = new URL(url); } catch { resolve({ status: 0, error: "invalid url" }); return; }
    const req = http.get(parsed, { timeout: 4000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 65536) body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, latencyMs: Date.now() - started, title: (body.match(/<title>([^<]{0,200})<\/title>/i)?.[1] || "").trim() }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    req.on("error", (error) => resolve({ status: 0, error: error.code || error.message }));
  });
}
