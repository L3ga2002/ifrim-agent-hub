import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactText } from "../security/redact.mjs";
import { isAllowedCommand, isAllowedPreviewCommand } from "../factory/spec.mjs";
import { parseTestOutput, testStatus, RUNNER_TIMEOUT_MS } from "../factory/runner.mjs";
import { resolveWsl, wslArgs, runInDistro, runScript } from "./wsl.mjs";

const OUTPUT_LINES = 300;
const here = path.dirname(fileURLToPath(import.meta.url));
/** The in-namespace preview host (M06-A); written into the run workspace by a versioned script, never edited per run. */
export const PREVIEW_HOST = fs.readFileSync(path.join(here, "scripts", "preview-host.mjs"), "utf8");
export const BWRAP = "/usr/bin/bwrap";

/**
 * The LOCAL-ONLY profile (M06-A), measured in ifrim-runner on 2026-10-02: bwrap 0.9.0 as the unprivileged runner user, new
 * user/pid/ipc/uts/cgroup/NETWORK namespaces (only loopback), /usr read-only, private /tmp, empty /home, the project COPY at
 * /work (writable), the host script read-only at /hub, a clean environment. Loopback works (the preview answers itself);
 * the internet, DNS, the Windows host and the Hub API do not; ~/.codex, /mnt/c and the other workspaces are not visible.
 * Every element is a separate argv entry (no shell).
 */
export function localOnlyArgs({ repo, hostDir, marker }) {
  for (const p of [repo, hostDir]) if (!/^\/home\/runner\/ws\/hub\/[A-Za-z0-9._-]+\/(repo|host)$/.test(p)) throw new Error(`cale de workspace invalidă pentru bwrap: ${String(p).slice(0, 80)}`);
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(marker)) throw new Error("marcaj invalid");
  return ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--symlink", "usr/sbin", "/sbin",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/home",
    "--bind", repo, "/work", "--ro-bind", hostDir, "/hub", "--chdir", "/work",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp", "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8",
    "--setenv", "NODE_ENV", "development", "--setenv", "IFRIM_RUN", marker, "--setenv", "npm_config_cache", "/tmp/npm-cache", "--setenv", "npm_config_update_notifier", "false"];
}

/** The preview command mapped to the environment's own Node/npm (the same shapes the spec accepts). */
export function previewArgv(command, env) {
  const parts = String(command).trim().split(/\s+/);
  if (!isAllowedPreviewCommand(command)) return null;
  if (parts[0] === "node") return [env.node, ...parts.slice(1)];
  if (parts[0] === "npm" && parts[1] === "run") return [env.npm, "run", parts[2]];
  return null;
}

const previewHostScript = () => `# ifrim-env:previewhost v1 — writes the preview host into ONE run workspace (read-only for the sandbox afterwards).
set -eu
D="$1"
case "$D" in /home/runner/ws/hub/?*/host) ;; *) echo "error=host dir outside the Hub root"; exit 2 ;; esac
case "$D" in */../*|*//*) echo "error=invalid path"; exit 2 ;; esac
umask 077
mkdir -p "$D"
cat > "$D/preview-host.mjs" <<'IFRIM_PREVIEW_HOST_EOF'
${PREVIEW_HOST}
IFRIM_PREVIEW_HOST_EOF
chmod 500 "$D"
echo "ok=1"
`;
/**
 * node --test runs every test file in a child process read through a pipe by default, and the network-off Linux sandbox loses
 * that child's output: only "not ok 1 - <file>" came back, without the failure text or the per-test lines (measured in
 * ifrim-runner, 2026-10-02). In-process isolation keeps every line (and an EPERM in its own test). Through NODE_OPTIONS it also
 * covers `npm test` / `npm run`; other node commands ignore it. Difference from Windows: test files share one process.
 */
export const TEST_NODE_OPTIONS = "--test-isolation=none";

/** The allowed factory commands mapped to the environment's own Node/npm (never a Windows binary). */
export function wslCommandArgv(command, env) {
  const parts = String(command).trim().split(/\s+/);
  if (parts[0] === "node" && parts[1] === "--test") return [env.node, "--test", "--test-reporter=tap", ...parts.slice(2)];
  if (parts[0] === "node") return [env.node, ...parts.slice(1)];
  if (parts[0] === "npm" && parts[1] === "test") return [env.npm, "test"];
  if (parts[0] === "npm" && parts[1] === "run") return [env.npm, "run", parts[2]];
  return null;
}

/**
 * The Linux sandbox with the network off refuses every socket (TCP and Unix, listen and connect) and loses the output of a
 * child process read through a socket pair (measured on Codex 0.159.2, M05). A test that needs one of those is an
 * environment limit, not a product failure: it is reported BLOCKED with the reason, so it never starts a repair cycle.
 */
export const SOCKET_REFUSAL = /\b(EPERM|EACCES)\b[^\n]{0,120}\b(listen|connect|bind|socket|spawn|pipe)\b|\b(listen|connect|bind|spawn)\b[^\n]{0,80}\b(EPERM|EACCES)\b|operation not permitted[^\n]{0,60}socket/i;

/**
 * Whether a failed command failed ONLY because of the sandbox's socket refusal. Each failing TAP test is one block (from its
 * "not ok" line to the next result line); a parent that failed only because its subtests failed is skipped. BLOCKED needs
 * at least one failing block and every failing block showing the refusal: a real product failure next to a socket test stays
 * a FAIL (it must reach the repair loop). Without itemized failures (a crash before any TAP line), any refusal line decides.
 */
export function environmentBlocked(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const result = line.match(/^(?:\[stderr\] )?\s*(not ok|ok) \d+ - /);
    if (result) { current = result[1] === "not ok" ? { lines: [line] } : null; if (current) blocks.push(current); continue; }
    if (/^\s*# (tests|suites|pass|fail)\b/.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  const failing = blocks.filter((b) => !b.lines.some((l) => /failureType: 'subtestsFailed'/.test(l)));
  if (!failing.length) return lines.some((l) => SOCKET_REFUSAL.test(l));
  return failing.every((b) => b.lines.some((l) => SOCKET_REFUSAL.test(l)));
}

/**
 * Factory runner (checks, QA) inside the wsl-runner environment (M05 §13). Each command gets a fresh copy of the project's
 * current files in a new workspace, runs through `codex sandbox -P ifrim_runner_rw` (the attested profile, network off),
 * then the workspace's processes are reaped and the workspace removed. Nothing from the run comes back to the project:
 * checks only produce evidence. Preview is not offered here (no socket inside the sandbox): it stays on the Windows route.
 */
export function createWslFactoryRunner({ config, supervisor, environment, settings }) {
  const env = environment.env;
  const profile = env.profiles["workspace-write"];
  const owned = new Map(); // supervisor key → workspace id
  const previews = new Map(); // supervisor key → preview workspace id (M06-A local-only profile)
  const aborts = new Map(); // supervisor key → AbortController of a copy in progress

  function readiness(project = null) {
    const state = environment.state();
    if (!state?.installed) return { ok: false, isolation: "none", detail: `Mediul ${env.id} nu a fost inspectat sau nu există (Sistem → Medii)` };
    if (!state.ok) return { ok: false, isolation: "none", detail: `Mediul ${env.id} raportează probleme de graniță: ${(state.problems || []).filter((p) => p.blocking).map((p) => p.detail).slice(0, 2).join("; ")}` };
    const attestation = environment.attestationStatus();
    if (!attestation.valid) return { ok: false, isolation: "none", detail: `ENV_NOT_ATTESTED: ${attestation.reason}` };
    if (project && project.source !== "hub-test") {
      const policy = settings.get("environmentPolicy")?.[env.id];
      if (!policy?.approvedAt || policy.fingerprintHash !== state.fingerprint?.hash) return { ok: false, isolation: "none", detail: "NEEDS_OWNER_APPROVAL: proiectele reale cer aprobarea (b) pentru amprenta curentă a mediului" };
    }
    return { ok: true, isolation: `${environment.simulated ? "SIMULATED: fixture fake-wsl, fără sandbox real · " : ""}${env.id}: sandbox Linux + profil ${profile} (amprenta ${state.fingerprint.hash}), copie a proiectului, rețea și socket-uri oprite` };
  }

  function run({ key, ws: projectRoot, command, project = null, timeoutMs = RUNNER_TIMEOUT_MS, shouldStop = () => false }) {
    const started = Date.now();
    const base = { command, runner: `codex-sandbox@${env.id}`, durationMs: 0, exitCode: null, counts: {}, failures: [], outputTail: "" };
    if (!isAllowedCommand(command)) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comandă în afara listei acceptate", isolation: "none" });
    const argv = wslCommandArgv(command, env);
    const binary = resolveWsl(config); // wsl.exe (or the test fixture): the environment's launcher
    if (!argv || !binary) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comanda sau wsl.exe nu pot fi pregătite", isolation: "none" });
    const wsId = `rn-${crypto.createHash("sha256").update(`${key}:${started}`).digest("hex").slice(0, 16)}`;
    return (async () => {
      // The environment as it is now (an inspection older than 10 min is repeated): a changed fingerprint blocks the command.
      const last = environment.state();
      if (!last?.inspectedAt || Date.now() - new Date(last.inspectedAt).getTime() > 10 * 60000) await environment.inspect().catch(() => {});
      const ready = readiness(project);
      if (!ready.ok) return { ...base, status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
      let prepared;
      const copyAbort = new AbortController();
      aborts.set(key, copyAbort);
      try { prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId: project?.id || "", purpose: "runner", signal: copyAbort.signal }); }
      catch (error) { return { ...base, status: "BLOCKED", reason: `copia proiectului în ${env.id} a eșuat: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation, durationMs: Date.now() - started }; }
      finally { aborts.delete(key); }
      owned.set(key, wsId);
      // A Stop / Pause during the copy: the command never starts (the caller records it as interrupted).
      if (shouldStop() || copyAbort.signal.aborted) {
        owned.delete(key);
        await environment.release(wsId).catch(() => {});
        return { ...base, status: "BLOCKED", reason: "oprit înainte de pornirea comenzii", isolation: ready.isolation, durationMs: Date.now() - started };
      }
      const out = [];
      let timedOut = false;
      try {
        const vars = { TMPDIR: prepared.tmp, IFRIM_RUN: wsId, NODE_ENV: "test", CI: "1", NODE_OPTIONS: TEST_NODE_OPTIONS, npm_config_cache: `${prepared.tmp}/npm-cache`, npm_config_update_notifier: "false" };
        let record;
        try {
          record = supervisor.start({ key, label: `runner@${env.id}: ${command}`, executable: binary.executable,
            args: [...binary.prefixArgs, ...wslArgs(env, { cwd: prepared.repo, argv: [env.codex, "sandbox", "-P", profile, "-C", prepared.repo, "--", ...argv], vars })],
            cwd: config.hubRoot, onStdoutLine: (line) => { out.push(redactText(line).slice(0, 500)); if (out.length > OUTPUT_LINES) out.shift(); } });
        } catch (error) { return { ...base, status: "BLOCKED", reason: `runner-ul nu a pornit: ${error.message}`, isolation: ready.isolation }; }
        const timer = setTimeout(() => { timedOut = true; supervisor.stop(key, { graceMs: 500 }).catch(() => {}); }, timeoutMs);
        timer.unref?.();
        const exit = await record.exit;
        clearTimeout(timer);
        supervisor.forget(key);
        const lines = [...out, ...record.stderrTail.map((l) => `[stderr] ${l}`)];
        const { counts, failures } = parseTestOutput(lines);
        let verdict = testStatus({ exitCode: exit.code, counts, timedOut });
        if (verdict.status !== "PASS" && environmentBlocked(lines)) {
          verdict = { status: "BLOCKED", reason: `sandbox-ul Linux din ${env.id} refuză socket-urile și procesele copil cu pipe-uri (rețea oprită); testul are nevoie de ele — decizie separată (profil doar-local sau runner dedicat)` };
        }
        return { ...base, ...verdict, exitCode: exit.code, counts, failures, durationMs: Date.now() - started, outputTail: lines.slice(-120).join("\n"), isolation: ready.isolation };
      } finally {
        owned.delete(key);
        await environment.release(wsId).catch(() => {});
      }
    })();
  }

  /**
   * Whether the local-only profile may run project code here: the environment as for checks, plus an attestation whose
   * canary measured the profile (C18) and bwrap present in the fingerprint. Without it the preview is not offered here.
   */
  function localOnlyReadiness(project = null) {
    const base = readiness(project);
    if (!base.ok) return base;
    const att = environment.attestationStatus();
    const byId = att.latest?.checks?.byId || {};
    if (byId.C18 !== "PASS") return { ok: false, isolation: "none", detail: `Profilul doar-local (bwrap, rețea doar loopback) nu e atestat: canary C18 ${byId.C18 || "NOT_RUN"}; refă atestarea mediului` };
    if (!environment.state()?.fingerprint?.bwrap) return { ok: false, isolation: "none", detail: "bwrap lipsește din amprenta mediului" };
    return { ok: true, isolation: `${environment.simulated ? "SIMULATED: fixture fake-wsl, fără namespace real · " : ""}${env.id}: bwrap ${environment.state().fingerprint.bwrap}, namespace de rețea propriu (doar loopback), /usr doar-citire, copie a proiectului (atestat C18)` };
  }

  /** E2E needs a browser INSIDE the same namespace (the Windows browser cannot reach it). Not installed: BLOCKED, never Windows. */
  function e2eReadiness() {
    const facts = environment.state()?.facts || {};
    if (!facts.pw_chromium) return { ok: false, detail: `Chromium pentru Linux nu este instalat în ${env.id}: E2E nu poate rula în namespace-ul preview-ului (instalare cerută în pachetul M06-A; nu se trece pe browserul Windows)` };
    return { ok: false, detail: `Chromium ${facts.pw_chromium} există, dar pornirea lui în bwrap (cu sandbox-ul propriu, fără --no-sandbox) nu a fost încă măsurată; E2E rămâne blocat până la proba aprobată` };
  }

  /**
   * Preview of the verified version inside the local-only profile: a fresh copy, the host script, bwrap. The preview is
   * probed from INSIDE the namespace; the result (HTTP status, title) and the measured isolation are the evidence.
   */
  async function startPreview({ key, ws: projectRoot, command, url, waitMs = 20000, project = null }) {
    const started = Date.now();
    if (!isAllowedPreviewCommand(command)) return { status: "BLOCKED", reason: "comandă de preview neacceptată", isolation: "none" };
    const ready = localOnlyReadiness(project);
    if (!ready.ok) return { status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
    const argv = previewArgv(command, env);
    const binary = resolveWsl(config);
    if (!argv || !binary) return { status: "BLOCKED", reason: "comanda sau wsl.exe nu pot fi pregătite", isolation: "none" };
    const wsId = `pv-${crypto.createHash("sha256").update(`${key}:${started}`).digest("hex").slice(0, 16)}`;
    let prepared;
    try { prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId: project?.id || "", purpose: "preview" }); }
    catch (error) { return { status: "BLOCKED", reason: `copia proiectului în ${env.id} a eșuat: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation }; }
    owned.set(key, wsId);
    previews.set(key, wsId);
    const hostDir = `${prepared.ws}/host`;
    try {
      const host = await runScript(config, env, previewHostScript(), [hostDir], { timeoutMs: 60000 });
      if (host.code !== 0) throw new Error(host.text.slice(0, 200) || host.stderr.slice(0, 200));
    } catch (error) {
      await stop(key).catch(() => {});
      return { status: "BLOCKED", reason: `gazda preview-ului nu a putut fi scrisă în mediu: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation };
    }
    const facts = [];
    const out = [];
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let record;
    try {
      record = supervisor.start({ key, label: `preview@${env.id} (doar-local): ${command}`, executable: binary.executable,
        args: [...binary.prefixArgs, ...wslArgs(env, { cwd: prepared.repo, vars: { IFRIM_RUN: wsId },
          argv: [BWRAP, ...localOnlyArgs({ repo: prepared.repo, hostDir, marker: wsId }), env.node, "/hub/preview-host.mjs", "--url", url, "--wait-ms", String(waitMs), "--fake", environment.simulated ? "1" : "0", "--", ...argv] })],
        cwd: config.hubRoot,
        onStdoutLine: (line) => {
          const m = String(line).match(/^IFRIM (\{.*\})$/);
          if (m) { try { const fact = JSON.parse(m[1]); facts.push(fact); if (["ready", "failed", "error"].includes(fact.kind)) resolveDone(fact); } catch { /* ignored */ } return; }
          out.push(redactText(line).slice(0, 300)); if (out.length > 60) out.shift();
        } });
    } catch (error) {
      await stop(key).catch(() => {});
      return { status: "BLOCKED", reason: `preview-ul nu a pornit: ${error.message}`, isolation: ready.isolation };
    }
    record.exit.then((exit) => resolveDone({ kind: "exited", exited: exit }));
    const timer = setTimeout(() => resolveDone({ kind: "timeout" }), waitMs + 30000);
    timer.unref?.();
    const result = await done;
    clearTimeout(timer);
    const iso = facts.find((f) => f.kind === "isolation") || null;
    const ok = result.kind === "ready" && result.check?.status >= 200 && result.check?.status < 400;
    const isolationOk = iso?.simulated || iso?.ok === true;
    if (!ok || !isolationOk) await stop(key).catch(() => {});
    const tail = [...out, ...(result.tail || []), ...(record.stderrTail || [])].slice(-40).join("\n");
    if (ok && !isolationOk) return { status: "BLOCKED", reason: `izolarea măsurată în namespace nu corespunde profilului: ${JSON.stringify(iso).slice(0, 200)}`, url, key, isolation: ready.isolation, outputTail: tail, durationMs: Date.now() - started, inEnvironment: true };
    return { status: ok ? "PASS" : result.kind === "error" ? "BLOCKED" : "FAIL", url, key, inEnvironment: true, isolationCheck: iso,
      reason: ok ? `HTTP ${result.check.status}${result.check.title ? ` · ${result.check.title}` : ""} (verificat din namespace-ul preview-ului)` : result.kind === "timeout" ? "preview-ul nu a răspuns la timp" : result.kind === "exited" ? `gazda preview-ului s-a oprit (${result.exited?.code ?? "?"})` : result.reason || `URL-ul nu răspunde (${result.check?.error || result.check?.status || "—"})`,
      check: result.check || null, isolation: ready.isolation, outputTail: tail, durationMs: Date.now() - started };
  }

  async function e2e() {
    const r = e2eReadiness();
    return { status: "BLOCKED", steps: [], error: r.detail, isolated: `${env.id}: namespace-ul preview-ului (browser nedisponibil)` };
  }

  async function stop(key) {
    aborts.get(key)?.abort();
    const result = await supervisor.stop(key, { graceMs: 500 });
    const wsId = owned.get(key);
    if (wsId) await environment.reap(wsId, { marker: wsId }).catch(() => {});
    // A preview workspace is removed when its preview stops (a checks workspace is removed by its own run).
    if (previews.has(key)) { previews.delete(key); owned.delete(key); await environment.release(wsId).catch(() => {}); }
    return result;
  }

  /** Warm-up / preflight (M05 §21): a trivial command through the same sandbox in an empty workspace; no project code, no model. */
  async function preflight() {
    const started = Date.now();
    const state = environment.state();
    if (!state?.installed) return { ok: false, environment: env.id, reason: "mediul nu a fost inspectat" };
    const binary = resolveWsl(config);
    const id = `pf-${crypto.randomBytes(6).toString("hex")}`;
    const ws = `${env.workspaceRoot}/${id}`;
    try {
      const prep = await runInDistro(config, env, { cwd: env.home, argv: ["/bin/mkdir", "-p", "-m", "700", `${ws}/repo`], timeoutMs: 120000 });
      if (prep.code !== 0) return { ok: false, environment: env.id, reason: prep.stderr.slice(0, 200), durationMs: Date.now() - started };
      const t0 = Date.now();
      const r = await runInDistro(config, env, { cwd: `${ws}/repo`, argv: [env.codex, "sandbox", "-P", env.profiles["read-only"], "-C", `${ws}/repo`, "--", "/bin/true"], timeoutMs: 300000 });
      return { ok: r.code === 0, environment: env.id, sandboxMs: Date.now() - t0, durationMs: Date.now() - started, reason: r.code === 0 ? null : `exit ${r.code}: ${r.stderr.slice(0, 160)}`, launcher: Boolean(binary) };
    } finally {
      await runInDistro(config, env, { cwd: env.home, argv: ["/bin/rm", "-rf", "--", ws], timeoutMs: 60000 }).catch(() => {});
    }
  }

  return { environment: env.id, readiness, run, startPreview, stop, preflight, localOnlyReadiness, e2eReadiness, e2e };
}
