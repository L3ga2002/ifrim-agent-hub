import { execFileSync } from "node:child_process";

/** One OS snapshot for all requested identities; an unreadable snapshot is never proof of exit. */
export function windowsProcessSnapshot(pids) {
  try {
    if (process.platform !== "win32") throw new Error("Win32_Process is required");
    if (!pids.length || pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error("Invalid PID inventory");
    const filter = [...new Set(pids)].map((pid) => `ProcessId=${pid}`).join(" OR ");
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; creationDate = $_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`],
    { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const rows = output.trim() ? [].concat(JSON.parse(output)) : [];
    return { rows: rows.map((row) => ({ pid: row.pid, creationDate: new Date(row.creationDate).toISOString() })), error: null };
  } catch (error) { return { rows: [], error: error.code || error.message }; }
}

/** Compare PID AND OS creation time. A replacement process is not the recorded child. */
export function compareProcessIdentity(record, snapshot) {
  if (snapshot.error) return { gone: false, verificationError: snapshot.error };
  if (record.identityError || record.startTimeSource !== "Win32_Process.CreationDate" || !record.creationDate || !Number.isFinite(Date.parse(record.creationDate))) {
    return { gone: false, verificationError: record.identityError || "Missing OS process identity" };
  }
  const current = snapshot.rows.find((row) => row.pid === record.pid);
  if (current && !Number.isFinite(Date.parse(current.creationDate))) return { gone: false, verificationError: "Invalid OS creation time" };
  return { gone: !current || Date.parse(current.creationDate) !== Date.parse(record.creationDate), verificationError: null };
}
