import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { isInside } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";
import { buildChildEnv } from "../policy/billing.mjs";
import { HubError } from "../core/errors.mjs";
import { drainWithin } from "./shutdown.mjs";

const execFileAsync = promisify(execFile);

// Windows kernel creation stamps can differ from Node's clock by two timer ticks.
export const PROCESS_LAUNCH_TOLERANCE_MS = 32;

/**
 * Owns every child process the Hub starts. Guarantees: controlled environment (allowlist), hidden
 * windows, stdout reserved for the provider protocol, stderr kept in a redacted ring buffer, whole
 * process-tree termination on Windows, and — in test mode — no executable outside the fixtures dir.
 */
export function createSupervisor({ config, onEvent = () => {}, treeKill = killOwnedTree, snapshot = windowsProcesses,
  killHandle = (record) => record.child.kill("SIGKILL") }) {
  const children = new Map();
  const failedStops = new Map();
  let closing = false, closePromise = null, snapshotInFlight = null;
  async function captureFailedTree(record) {
    if (process.platform !== "win32") return;
    try {
      // Concurrent failed stops share one bounded snapshot, before any handle fallback.
      if (!snapshotInFlight) snapshotInFlight = drainWithin(Promise.resolve().then(snapshot), 15000, "process snapshot")
        .finally(() => { snapshotInFlight = null; });
      record.failureTree = ownedProcessTree([record], await snapshotInFlight);
      record.snapshotError = null;
    } catch (error) { record.snapshotError = error.message; }
  }

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
    if (closing) throw new HubError("policy", "Hub-ul se oprește; nicio operație nouă nu pornește", { code: "HUB_SHUTDOWN" });
    if (/\.(cmd|bat)$/i.test(executable)) throw new Error("Refusing to spawn a .cmd/.bat shim; resolve the executable");
    assertSpawnAllowed(executable);
    if (config.testMode && args[0] && /\.(mjs|js)$/.test(args[0])) assertSpawnAllowed(args[0]);
    const startRequestedAt = new Date().toISOString();
    const child = spawn(executable, args, {
      cwd, env: buildChildEnv(env), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    const record = { key, label, pid: child.pid, startRequestedAt, startedAt: new Date().toISOString(), child, stderrTail: [], exited: false, exitCode: null };
    // A write racing the child's death emits 'error' on the pipe; unhandled, it would crash the whole Hub.
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", (error) => { record.pipeError = error.code || error.message; });
    // Preserve fixed-key restart behaviour while retaining every previous live handle for cleanup.
    if (children.has(key) && !children.get(key).exited) {
      const previous = children.get(key);
      previous.key = `${key}:previous:${previous.pid}`;
      children.set(previous.key, previous);
    }
    children.set(key, record);
    const detachOut = splitLines(child.stdout, onStdoutLine);
    const detachErr = splitLines(child.stderr, (line) => {
      const clean = redactText(line).slice(0, 2000);
      record.stderrTail.push(clean);
      if (record.stderrTail.length > 80) record.stderrTail.shift();
      onStderrLine(clean);
    });
    record.detachOutput = () => { record.detached = true; detachOut(); detachErr(); };
    record.exit = new Promise((resolve) => {
      let settled = false;
      const done = (code, error) => {
        if (settled) return;
        settled = true;
        record.exited = true;
        record.exitedAt ||= new Date().toISOString();
        record.exitCode = code;
        if (!record.detached) onEvent({ type: "process.exited", key, pid: child.pid, code, error: error ? error.message : null });
        resolve({ code, error: error ? error.message : null });
      };
      let spawnError = null;
      child.once("error", (error) => { spawnError = error; });
      child.once("exit", () => { record.exitedAt = new Date().toISOString(); });
      child.once("close", (code) => done(spawnError ? -1 : code, spawnError));
    });
    onEvent({ type: "process.started", key, pid: child.pid, label });
    return record;
  }

  /** Terminates the whole process tree. Windows has no POSIX signals for children: taskkill /T is used. */
  function stop(key, { graceMs = 3000 } = {}) {
    const record = children.get(key);
    if (!record || rootExited(record)) return Promise.resolve({ stopped: true, alreadyExited: true, method: "exited", pid: record?.pid ?? null, startedAt: record?.startedAt ?? null });
    if (record.stopping) return record.stopping;
    record.stopping = (async () => {
      const identity = { pid: record.pid, startedAt: record.startedAt };
      try { record.child.stdin.end(); } catch { /* closed pipe */ }
      if (await exitedWithin(record, Math.max(0, Math.min(3000, graceMs)))) return { ...identity, stopped: true, forced: false, method: "stdin" };
      let error = null, method = "taskkill";
      const at = Date.now();
      try {
        const result = await drainWithin(Promise.resolve().then(() => treeKill(record)), 10000, "taskkill");
        record.taskkill = { ok: true, elapsedMs: Date.now() - at, ...result };
      } catch (cause) {
        error = { name: cause.name, code: cause.code ?? null, message: cause.message, timedOut: Boolean(cause.killed) || /exceeded|timed out/i.test(cause.message) };
        record.taskkill = { ok: false, elapsedMs: Date.now() - at, ...error };
        record.treeUnverified = true;
      }
      const fallback = Boolean(error) || !(await exitedWithin(record, 8000));
      if (error) {
        failedStops.set(record.key, record);
        await captureFailedTree(record);
      }
      if (!rootExited(record) && record.child.exitCode === null && record.child.signalCode === null && fallback) {
        method = "handle";
        try { if (!killHandle(record) && !rootExited(record)) throw new Error("Owned process handle refused termination"); }
        catch (cause) { error = { ...error, handle: cause.message }; }
      }
      const stopped = await exitedWithin(record, error ? 8000 : 1000);
      if (!stopped && record.taskkill.ok) await captureFailedTree(record);
      if (error || !stopped) failedStops.set(record.key, record);
      return { ...identity, stopped, forced: true, method, taskkill: record.taskkill, ...(error ? { error } : {}) };
    })().finally(() => { record.stopping = null; });
    return record.stopping;
  }

  // A regular Stop All remains reusable; only close permanently refuses launches.
  async function stopAll() {
    const results = [];
    const until = Date.now() + 15000;
    for (let round = 0; round < 2 && list().length && Date.now() < until; round++) {
      const keys = list().map((r) => r.key);
      results.push(...await Promise.all(keys.map(async (key) => ({ key, ...await stop(key, { graceMs: round ? 0 : 1500 }) }))));
      // Do not spend a second full kill timeout on the same known survivor.
      if (list().every((r) => keys.includes(r.key))) break;
    }
    return results;
  }

  const beginClose = () => { closing = true; };
  function close() {
    beginClose();
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const results = await stopAll();
      let survivors = list();
      const unverified = [];
      let fresh, snapshotError;
      if (failedStops.size) {
        try { fresh = await drainWithin(Promise.resolve().then(snapshot), 15000, "process snapshot"); }
        catch (error) { snapshotError = error.message; }
      }
      // Failure evidence was captured while the root could still identify its descendants.
      for (const record of failedStops.values()) {
        const alive = fresh ? verifiedFailureTree(record.failureTree || [], fresh) : [];
        const root = survivors.find((r) => r.key === record.key);
        // Failure-tree identities are never replaced by a PID-only liveness probe.
        const rootIdentity = alive.find((r) => r.pid === record.pid);
        if (root && rootIdentity) {
          root.creationDate = rootIdentity.creationDate;
          root.descendants = alive.filter((r) => r.pid !== record.pid);
        }
        for (const row of alive) if (row.pid !== record.pid)
          survivors.push({ key: `${record.key}:descendant:${row.pid}`, label: row.name, pid: row.pid,
            startedAt: row.creationDate, creationDate: row.creationDate, parentPid: row.parentPid });
        const unavailable = snapshotError || record.snapshotError;
        if (unavailable) unverified.push({ key: record.key, pid: record.pid, startedAt: record.startedAt, snapshotError: unavailable });
        else if (!root && !alive.length) failedStops.delete(record.key);
      }
      return { results, survivors, unverified };
    })();
    return closePromise;
  }

  const list = () => [...children.values()].filter((r) => !rootExited(r)).map(({ key, label, pid, startedAt }) => ({ key, label, pid, startedAt }));
  const get = (key) => children.get(key) || null;
  const forget = (key) => { const r = children.get(key); if (r?.exited) children.delete(key); };
  const detachSurvivors = () => { for (const record of children.values()) if (!record.exited) record.detachOutput(); };
  return { start, stop, stopAll, beginClose, close, detachSurvivors, list, get, forget };
}

function splitLines(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  const data = (chunk) => {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) buffer = buffer.slice(-1024 * 1024); // protocol lines are never this large
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
  const end = () => { if (buffer.trim()) onLine(buffer.trim()); };
  stream.on("data", data);
  stream.on("end", end);
  return () => { buffer = ""; stream.off("data", data); stream.off("end", end); stream.resume(); };
}

// 'exit' can precede stdio closure while an owned descendant still holds a pipe.
const rootExited = (record) => record.exited;

async function exitedWithin(record, ms) {
  if (rootExited(record)) return true;
  let timer;
  try { return await Promise.race([record.exit.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), ms); })]); }
  finally { clearTimeout(timer); }
}

// Check the owned root immediately before taskkill; Node can release its handle during taskkill startup.
// This narrows, but does not eliminate, PID reuse races. WMI diagnostics never gate a normal tree kill.
export async function killOwnedTree(record) {
  if (record.exited || record.child.exitCode !== null || record.child.signalCode !== null) return { alreadyExited: true };
  if (process.platform !== "win32") { record.child.kill("SIGTERM"); return { method: "handle" }; }
  const { stderr } = await execFileAsync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, timeout: 9500 });
  return { exitCode: 0, stderr: stderr || "" };
}

export async function windowsProcesses() {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; creationDate=$_.CreationDate.ToUniversalTime().ToString('o'); name=$_.Name } }) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 14500, maxBuffer: 4 * 1024 * 1024 });
  return (stdout.trim() ? [].concat(JSON.parse(stdout)) : []).map((r) => ({ ...r, creationDate: new Date(r.creationDate).toISOString() }));
}

export function ownedProcessTree(records, snapshot) {
  const found = [], parents = records.map((r) => ({ ...r, rootKey: r.key }));
  for (const record of records) {
    const row = snapshot.find((p) => p.pid === record.pid && (record.creationDate ? p.creationDate === record.creationDate
      : Date.parse(p.creationDate) >= Date.parse(record.startRequestedAt) - PROCESS_LAUNCH_TOLERANCE_MS
        && Date.parse(p.creationDate) <= Date.parse(record.startedAt) + PROCESS_LAUNCH_TOLERANCE_MS));
    if (row) found.push({ ...row, rootKey: record.key });
  }
  for (const parent of parents) {
    const replacement = snapshot.find((p) => p.pid === parent.pid && (parent.creationDate ? p.creationDate !== parent.creationDate
      : Date.parse(p.creationDate) > Date.parse(parent.startedAt) + PROCESS_LAUNCH_TOLERANCE_MS));
    const end = parent.exitedAt || replacement?.creationDate;
    for (const row of snapshot) {
      if (row.parentPid !== parent.pid || found.some((p) => p.pid === row.pid)
        || Date.parse(row.creationDate) < (parent.creationDate ? Date.parse(parent.creationDate)
          : Date.parse(parent.startRequestedAt) - PROCESS_LAUNCH_TOLERANCE_MS)
        || (end && Date.parse(row.creationDate) >= Date.parse(end))) continue;
      const child = { ...row, startRequestedAt: row.creationDate, startedAt: row.creationDate, rootKey: parent.rootKey };
      found.push(child); parents.push(child);
    }
  }
  return found;
}

/** A missing or replaced descendant is gone; its exit bound prevents later PID reuse attribution. */
export function verifiedFailureTree(tree, snapshot, at = new Date().toISOString()) {
  return tree.filter((row) => {
    if (row.exitedAt) return false;
    if (snapshot.some((p) => p.pid === row.pid && p.creationDate === row.creationDate)) return true;
    row.exitedAt = at;
    return false;
  });
}

/** Checks whether a PID from a previous boot is still alive (used by recovery; never kills). */
export async function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
