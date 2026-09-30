import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { isInside } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";
import { buildChildEnv } from "../policy/billing.mjs";

const execFileAsync = promisify(execFile);

/**
 * Owns every child process the Hub starts. Guarantees: controlled environment (allowlist), hidden
 * windows, stdout reserved for the provider protocol, stderr kept in a redacted ring buffer, whole
 * process-tree termination on Windows, and — in test mode — no executable outside the fixtures dir.
 */
export function createSupervisor({ config, onEvent = () => {} }) {
  const children = new Map();

  function assertSpawnAllowed(executable) {
    if (!config.testMode) return;
    const resolved = path.resolve(executable);
    const isNode = resolved.toLowerCase() === process.execPath.toLowerCase();
    if (!isNode && !isInside(config.allowedTestBinaryDir, resolved)) {
      throw new Error(`Test mode refuses to spawn ${resolved}: only fixture binaries are allowed`);
    }
  }

  /**
   * Spawns `executable args`. `.cmd`/`.bat` shims are refused (quoting through cmd.exe is unsafe);
   * callers must resolve the real .exe or run `node script.js`.
   */
  function start({ key, executable, args = [], cwd, env = {}, label = "process", onStdoutLine = () => {}, onStderrLine = () => {} }) {
    if (/\.(cmd|bat)$/i.test(executable)) throw new Error("Refusing to spawn a .cmd/.bat shim; resolve the executable");
    assertSpawnAllowed(executable);
    if (config.testMode && args[0] && /\.(mjs|js)$/.test(args[0])) assertSpawnAllowed(args[0]);
    const child = spawn(executable, args, {
      cwd, env: buildChildEnv(env), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    const record = { key, label, pid: child.pid, startedAt: new Date().toISOString(), child, stderrTail: [], exited: false, exitCode: null };
    children.set(key, record);
    splitLines(child.stdout, onStdoutLine);
    splitLines(child.stderr, (line) => {
      const clean = redactText(line).slice(0, 2000);
      record.stderrTail.push(clean);
      if (record.stderrTail.length > 80) record.stderrTail.shift();
      onStderrLine(clean);
    });
    record.exit = new Promise((resolve) => {
      let settled = false;
      const done = (code, error) => {
        if (settled) return;
        settled = true;
        record.exited = true;
        record.exitCode = code;
        onEvent({ type: "process.exited", key, pid: child.pid, code, error: error ? error.message : null });
        resolve({ code, error: error ? error.message : null });
      };
      child.once("error", (error) => done(-1, error));
      child.once("close", (code) => done(code, null));
    });
    onEvent({ type: "process.started", key, pid: child.pid, label });
    return record;
  }

  /** Terminates the whole process tree. Windows has no POSIX signals for children: taskkill /T is used. */
  async function stop(key, { graceMs = 3000 } = {}) {
    const record = children.get(key);
    if (!record || record.exited) return { stopped: true, alreadyExited: true };
    try { record.child.stdin.end(); } catch { /* ignore */ }
    const graceful = await Promise.race([record.exit.then(() => true), delay(graceMs).then(() => false)]);
    if (!graceful) {
      if (process.platform === "win32") {
        await execFileAsync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }).catch(() => {});
      } else {
        try { process.kill(-record.pid, "SIGTERM"); } catch { try { record.child.kill("SIGTERM"); } catch { /* ignore */ } }
      }
    }
    const exited = await Promise.race([record.exit.then(() => true), delay(8000).then(() => false)]);
    return { stopped: exited, forced: !graceful };
  }

  async function stopAll() {
    const results = [];
    for (const key of [...children.keys()]) results.push({ key, ...(await stop(key, { graceMs: 1500 })) });
    return results;
  }

  const list = () => [...children.values()].filter((r) => !r.exited).map(({ key, label, pid, startedAt }) => ({ key, label, pid, startedAt }));
  const get = (key) => children.get(key) || null;
  const forget = (key) => { const r = children.get(key); if (r?.exited) children.delete(key); };
  return { start, stop, stopAll, list, get, forget };
}

function splitLines(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) buffer = buffer.slice(-1024 * 1024); // protocol lines are never this large
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on("end", () => { if (buffer.trim()) onLine(buffer.trim()); });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

/** Checks whether a PID from a previous boot is still alive (used by recovery; never kills). */
export async function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
