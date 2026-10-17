import fs from "node:fs";

/** Shared by signal/API shutdown: cleanup errors never bypass pid removal or the historical exit(0). */
export async function finishShutdown({ hub, prepare, pidFile, pid = process.pid, exit = (code) => process.exit(code), log = console.error }) {
  const report = (error) => {
    for (const cause of error instanceof AggregateError ? error.errors : [error])
      log(`[hub] Eroare la oprirea Hub-ului: ${cause.message}`);
  };
  try {
    try { await prepare(); } catch (error) { report(error); }
    try { await hub.close(); } catch (error) { report(error); }
  } finally {
    try { const current = JSON.parse(fs.readFileSync(pidFile, "utf8")); if (current.pid === pid) fs.rmSync(pidFile); } catch { /* absent or no longer ours */ }
    exit(0);
  }
}
