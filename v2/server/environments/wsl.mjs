import path from "node:path";
import { spawn } from "node:child_process";
import { HubError } from "../core/errors.mjs";
import { buildChildEnv } from "../policy/billing.mjs";
import { isInside } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * The wsl-runner environment (M05 §06, §09): the dedicated WSL2 distro `ifrim-runner`, user `runner` (no sudo), Windows
 * drives not mounted, interop off. Every process the Hub starts there goes through `wsl.exe --exec` (no shell parses the
 * arguments) with `env -i` and an explicit variable list: no Windows variable, API key, proxy or WSLENV reaches Linux.
 */
export const WSL_RUNNER = Object.freeze({
  id: "wsl-runner",
  distro: "ifrim-runner",
  user: "runner",
  home: "/home/runner",
  workspaceRoot: "/home/runner/ws/hub",
  codex: "/usr/local/bin/codex",
  node: "/usr/local/bin/node",
  npm: "/usr/local/bin/npm",
  path: "/usr/local/bin:/usr/bin:/bin",
  profiles: { "read-only": "ifrim_runner_ro", "workspace-write": "ifrim_runner_rw" },
});

const DISTRO_RE = /^[A-Za-z0-9._-]{1,64}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const LINUX_PATH_RE = /^\/[A-Za-z0-9._/-]{0,400}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function assertLinuxPath(p, label = "cale") {
  const value = String(p ?? "");
  if (!LINUX_PATH_RE.test(value) || value.split("/").some((s) => s === "..") || value.includes("//")) {
    throw new HubError("validation", `${label} Linux invalidă: ${value.slice(0, 120)}`);
  }
  return value;
}

/** A path strictly under the environment's workspace root (the only place the Hub creates or removes directories). */
export function assertWorkspacePath(p, env = WSL_RUNNER) {
  const value = assertLinuxPath(p, "workspace");
  if (!value.startsWith(`${env.workspaceRoot}/`) || value.length <= env.workspaceRoot.length + 1) throw new HubError("validation", `Workspace în afara ${env.workspaceRoot}`);
  return value;
}

/** The explicit Linux environment of a Hub process in the distro (`env -i` list). */
export function linuxEnv(env = WSL_RUNNER, extra = {}) {
  const vars = { HOME: env.home, USER: env.user, LOGNAME: env.user, LANG: "C.UTF-8", PATH: env.path, NO_UPDATE_NOTIFIER: "1", ...extra };
  return Object.entries(vars).map(([k, v]) => {
    if (!ENV_NAME_RE.test(k)) throw new HubError("validation", `Variabilă de mediu invalidă: ${k}`);
    const value = String(v);
    if (/[\0\n\r]/.test(value)) throw new HubError("validation", `Valoare invalidă pentru ${k}`);
    return `${k}=${value}`;
  });
}

/** Where wsl.exe is (System32), or the test fixture configured as `config.wsl`. */
export function resolveWsl(config) {
  if (config.wsl?.executable) return { executable: config.wsl.executable, prefixArgs: config.wsl.prefixArgs || [], fixture: true };
  if (config.testMode) return null;
  const root = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  return { executable: path.join(root, "System32", "wsl.exe"), prefixArgs: [] };
}

/**
 * argv for one process in the distro: wsl.exe -d <distro> -u <user> --cd <cwd> --exec /usr/bin/env -i VAR=… <argv…>.
 * Every element is passed as its own argument; nothing is joined into a shell string.
 */
export function wslArgs(env, { cwd = env.home, argv, vars = {} }) {
  if (!DISTRO_RE.test(env.distro)) throw new HubError("validation", "Nume de distribuție invalid");
  if (!USER_RE.test(env.user)) throw new HubError("validation", "Utilizator Linux invalid");
  assertLinuxPath(cwd, "cwd");
  if (!Array.isArray(argv) || !argv.length) throw new HubError("validation", "Comandă goală");
  for (const a of argv) if (typeof a !== "string" || a.includes("\0")) throw new HubError("validation", "Argument invalid");
  assertLinuxPath(argv[0], "executabil");
  return ["-d", env.distro, "-u", env.user, "--cd", cwd, "--exec", "/usr/bin/env", "-i", ...linuxEnv(env, vars), ...argv];
}

/** wsl.exe prints its own messages (distro missing, service errors) as UTF-16LE; Linux programs print bytes. */
export const cleanWslText = (text) => String(text || "").replace(/\0/g, "").replace(/\r/g, "");

function assertFixture(config, invocation) {
  if (!config.testMode) return;
  const exe = path.resolve(invocation.executable);
  const isNode = exe.toLowerCase() === process.execPath.toLowerCase();
  if (!isNode && !isInside(config.allowedTestBinaryDir, exe)) throw new Error(`Test mode refuses to spawn ${exe}`);
  const script = invocation.prefixArgs[0];
  if (isNode && (!script || !isInside(config.allowedTestBinaryDir, path.resolve(script)))) throw new Error("Test mode: the wsl fixture must live in tests/fixtures");
}

/**
 * Runs one short process in the distro with binary stdin/stdout. `input`: Buffer, or a function(stdin) that writes and
 * ends it (a tar stream). `onStdout(chunk)` receives raw bytes instead of collecting them. Output is capped; on cap or
 * timeout the process tree is killed. Returns { code, stdout: Buffer, stderr: string, timedOut, capped, durationMs }.
 */
export function runInDistro(config, env, { cwd, argv, vars = {}, input = null, onStdout = null, timeoutMs = 120000, maxStdout = 8 * 1024 * 1024, signal = null }) {
  const invocation = resolveWsl(config);
  if (!invocation) return Promise.reject(new HubError("transport", "wsl.exe nu este disponibil"));
  assertFixture(config, invocation);
  const args = [...invocation.prefixArgs, ...wslArgs(env, { cwd, argv, vars })];
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(invocation.executable, args, { env: buildChildEnv(), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { reject(new HubError("transport", `wsl.exe nu a pornit: ${error.message}`)); return; }
    const out = [];
    let outBytes = 0;
    let err = "";
    let timedOut = false;
    let capped = false;
    let settled = false;
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    timer.unref?.();
    const onAbort = () => kill();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (onStdout) { try { if (onStdout(chunk) === false) { capped = true; kill(); } } catch { capped = true; kill(); } return; }
      outBytes += chunk.length;
      if (outBytes > maxStdout) { capped = true; kill(); return; }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => { if (err.length < 64 * 1024) err += chunk.toString("utf8"); });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", () => { /* reported by exit */ });
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(new HubError("transport", `wsl.exe: ${error.message}`)); } });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve({ code, stdout: Buffer.concat(out), stderr: redactText(cleanWslText(err)).slice(-8000), timedOut, capped, durationMs: Date.now() - started });
    });
    if (typeof input === "function") Promise.resolve().then(() => input(child.stdin)).catch(() => kill());
    else if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const SCRIPT_ARG_RE = /^[A-Za-z0-9._/:=-]{1,400}$/;

/** Runs one of the Hub's versioned in-distro scripts (bash reads it from stdin; arguments are validated plain tokens). */
export async function runScript(config, env, script, args = [], { timeoutMs = 120000, signal = null } = {}) {
  for (const a of args) if (!SCRIPT_ARG_RE.test(String(a)) || String(a).includes("..")) throw new HubError("validation", `Argument de script invalid: ${String(a).slice(0, 80)}`);
  const result = await runInDistro(config, env, { cwd: env.home, argv: ["/bin/bash", "-s", "--", ...args], input: Buffer.from(script, "utf8"), timeoutMs, maxStdout: 2 * 1024 * 1024, signal });
  return { ...result, text: cleanWslText(result.stdout.toString("utf8")) };
}

/** KEY=VALUE lines (as printed by the inspect/reap scripts) → object; unknown keys are kept, values capped. */
export function parseKeyValues(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_.-]{1,64})=(.*)$/);
    if (m) out[m[1]] = m[2].slice(0, 400);
  }
  return out;
}
