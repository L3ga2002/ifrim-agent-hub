import fs from "node:fs";
import { drainWithin, SHUTDOWN_PREPARE_MS } from "./shutdown.mjs";

/** Shared by signal/API shutdown: cleanup errors never bypass pid removal or the historical exit(0). */
export async function finishShutdown({ hub, prepare, pidFile, pid = process.pid, exit = (code) => process.exit(code), log = console.error }) {
  const report = (error) => {
    for (const cause of error instanceof AggregateError ? error.errors : [error])
      log(`[hub] Eroare la oprirea Hub-ului: ${cause.message}`);
  };
  try {
    try { await drainWithin(Promise.resolve().then(prepare), SHUTDOWN_PREPARE_MS, "pregătirea opririi"); } catch (error) { report(error); }
    try { await hub.close(); } catch (error) { report(error); }
  } finally {
    try { const current = JSON.parse(fs.readFileSync(pidFile, "utf8")); if (current.pid === pid) fs.rmSync(pidFile); } catch { /* absent or no longer ours */ }
    exit(0);
  }
}
