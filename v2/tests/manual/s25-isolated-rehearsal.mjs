// Isolated driver. Default CLI mode is fake; imports never launch providers.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { runRehearsal } from "./s25-rehearsal-core.mjs";
export { runRehearsal, createRehearsalCodex, probeRehearsalProviders } from "./s25-rehearsal-core.mjs";
export { S25_WORDS } from "./s25-context.mjs";
const exec = promisify(execFile);
export function trackSupervisedProcess(records, record, requestedAt) {
  const row = { pid: record.pid, key: record.key, root: true, startRequestedAt: record.startRequestedAt || requestedAt,
    startedAt: record.startedAt || new Date().toISOString(), creationDate: record.creationDate || null, exitedAt: record.exitedAt || null };
  Object.defineProperty(row, "supervisorRecord", { value: record }); // exclude child handles from JSON evidence
  records.push(row);
  record.exit.then(() => { row.exitedAt = record.exitedAt || new Date().toISOString(); });
  return row;
}
// CreationDate is the process identity: a reused PID is never a survivor or a cleanup target.
export function recordedProcessTree(records, snapshot) {
  const found = [];
  for (const record of records) {
    const row = snapshot.find((p) => p.pid === record.pid && (record.creationDate
      ? p.creationDate === record.creationDate
      : Date.parse(p.creationDate) >= Date.parse(record.startRequestedAt) && Date.parse(p.creationDate) <= Date.parse(record.startedAt)));
    if (row) {
      record.creationDate = row.creationDate;
      if (record.supervisorRecord) record.supervisorRecord.creationDate = row.creationDate;
      found.push(row);
    }
  }
  // Keep recorded ancestors in the chain even when they exited before this snapshot.
  const parents = [...records];
  for (let i = 0; i < parents.length; i++) {
    const record = parents[i];
    const replacement = snapshot.find((p) => p.pid === record.pid && (record.creationDate ? p.creationDate !== record.creationDate
      : Date.parse(p.creationDate) > Date.parse(record.startedAt)));
    const end = record.exitedAt || replacement?.creationDate;
    for (const row of snapshot) {
      if (row.parentPid !== record.pid || found.some((p) => p.pid === row.pid)
        || Date.parse(row.creationDate) < Date.parse(record.creationDate || record.startRequestedAt)
        || (end && Date.parse(row.creationDate) >= Date.parse(end))) continue;
      found.push(row);
      const child = { ...row, root: false, startedAt: row.creationDate };
      records.push(child); parents.push(child);
    }
  }
  return found;
}

const processSnapshotCommand = "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; creationDate = $_.CreationDate.ToUniversalTime().ToString('o'); name = $_.Name } }) | ConvertTo-Json -Compress";
const normalizeSnapshot = (stdout) => (String(stdout).trim() ? [].concat(JSON.parse(stdout)) : [])
  .map((row) => ({ ...row, creationDate: new Date(row.creationDate).toISOString() }));
export async function windowsProcesses({ execute = exec } = {}) {
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", processSnapshotCommand],
    { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  // Normalize sub-millisecond CIM precision to the JS timestamps recorded before/after spawn.
  return normalizeSnapshot(stdout);
}

// Only an already recorded, still-live identity can be a kill target or survivor.
export function recordedSurvivors(records, snapshot) {
  return snapshot.filter((row) => records.some((record) => !record.exitedAt && record.creationDate
    && record.pid === row.pid && record.creationDate === row.creationDate));
}

export function emergencyKillRecorded(records, { execSync = execFileSync } = {}) {
  const results = [];
  // A crash can happen before the first phase scan. Resolve uncaptured roots by supervisor launch window.
  if (records.some((r) => !r.creationDate && r.startRequestedAt)) {
    try {
      const stdout = execSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", processSnapshotCommand],
        { windowsHide: true, timeout: 10000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      recordedProcessTree(records, normalizeSnapshot(stdout));
    } catch (error) { results.push({ kind: "snapshot", error: error.message }); }
  }
  for (const record of records) {
    if (record.exitedAt || !record.creationDate || !Number.isSafeInteger(record.pid) || record.pid <= 0) {
      results.push({ pid: record.pid, skipped: record.exitedAt ? "supervisor observed exit" : "unverified identity" });
      continue;
    }
    try {
      const output = execSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`],
      { windowsHide: true, timeout: 10000, encoding: "utf8" });
      const date = String(output).trim();
      if (!date || !recordedSurvivors([record], [{ pid: record.pid, creationDate: new Date(date).toISOString() }]).length) {
        results.push({ pid: record.pid, skipped: "original identity absent or replaced" }); continue;
      }
      execSync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, timeout: 10000, stdio: "ignore" });
      results.push({ pid: record.pid, method: "taskkill", ok: true });
    } catch (error) { results.push({ pid: record.pid, method: "taskkill", ok: false, error: error.message }); }
  }
  return results;
}

export async function cleanupRecordedProcesses(records, { exec: execute = exec, snapshot = windowsProcesses } = {}) {
  const results = [];
  const current = await snapshot();
  for (const record of records) {
    if (!recordedSurvivors([record], current).length) {
      results.push({ pid: record.pid, root: record.root, skipped: "original process absent (CreationDate checked)" });
      continue;
    }
    try {
      // Recheck identity inside the same bounded cleanup command; no full snapshot per PID.
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}'; if ($p -and ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() -eq ${Date.parse(record.creationDate)}) { & taskkill /PID ${record.pid} /T /F; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`],
        { windowsHide: true, timeout: 10000 });
      results.push({ pid: record.pid, root: record.root, method: "CreationDate-checked taskkill", exitCode: 0, output: stdout || "" });
    } catch (error) { results.push({ pid: record.pid, root: record.root, exitCode: error.code ?? null }); }
  }
  return results;
}

export function createRehearsalStop({ controller, emergencyKill, exit = (code) => process.exit(code) }) {
  let stopping = false;
  return () => {
    if (stopping) {
      try { emergencyKill(); } finally { exit(130); }
      return;
    }
    stopping = true;
    controller.abort(new Error("Stop cerut din terminal"));
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const switches = new Set(["--real", "--fake", "--preflight-only"]);
  const values = new Set(["--parent", "--out", "--commit", "--manifest-sha256", "--isolation-consent", "--home-acl-change-approved", "--claude-headroom-checked", "--scenario"]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag) || (!switches.has(flag) && !values.has(flag))) throw new Error(`Unknown or repeated argument: ${flag}`);
    seen.add(flag);
    if (values.has(flag) && (!args[++i] || args[i].startsWith("--"))) throw new Error(`Missing value for ${flag}`);
  }
  const value = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes("--real") && args.includes("--fake")) throw new Error("Choose one mode");
  const controller = new AbortController(), realProcesses = [];
  const emergencyKill = () => emergencyKillRecorded(realProcesses);
  const stop = createRehearsalStop({ controller, emergencyKill });
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  process.on("SIGBREAK", stop); process.on("SIGHUP", stop);
  try {
    const evidence = await runRehearsal({ mode: args.includes("--real") ? "real" : "fake", out: value("--out"), parent: value("--parent"),
      commit: value("--commit"), manifestSha256: value("--manifest-sha256"), isolationConsent: value("--isolation-consent"),
      homeAclChangeApproved: value("--home-acl-change-approved"), claudeHeadroomChecked: value("--claude-headroom-checked"),
      scenario: value("--scenario") || "success", preflightOnly: args.includes("--preflight-only"), signal: controller.signal, realProcesses });
    console.log(JSON.stringify({ classification: evidence.classification, out: evidence.out }));
    if (!["INTENTIONAL_STOP_BEFORE_WRITER", "PREFLIGHT_ONLY_PASSED"].includes(evidence.classification) || (!evidence.preflightOnly && !evidence.rehearsalGate)) process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  finally { for (const name of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.removeListener(name, stop); }
}
