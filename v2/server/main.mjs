import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { createHub } from "./hub.mjs";
import { createHttpServer } from "./http/server.mjs";

const config = loadConfig();
const hub = createHub(config);
const report = await hub.boot();
const { server } = createHttpServer(hub);
const pidFile = path.join(config.dataDir, "v2-hub.pid.json");

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[hub] ${signal}: stopping (active runs are interrupted and recorded)`);
  server.close();
  try { if (hub.runs.activeRuns().length) await hub.runs.stopAll("system", `Hub shutdown (${signal})`); } catch { /* recorded by run manager */ }
  await hub.close();
  try { const current = JSON.parse(fs.readFileSync(pidFile, "utf8")); if (current.pid === process.pid) fs.rmSync(pidFile); } catch { /* ignore */ }
  process.exit(0);
}

// Graceful shutdown endpoint for the stop script: refuses while runs are active unless forced.
hub.shutdown = shutdown;
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (error) => {
  console.error(`[hub] cannot listen on ${config.host}:${config.port}: ${error.code || error.message}`);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: config.port, startedAt: new Date().toISOString(), entry: "v2/server/main.mjs" }));
  console.log(`[hub] Ifrim Agent Hub V2 on http://${config.host}:${config.port}  mode=${hub.settings.get("mode")} gate=${hub.settings.get("executionGate").status}`);
  console.log(`[hub] recovery: ${JSON.stringify({ modeReset: report.modeReset, runs: report.runs.length, tasks: report.tasks.length, leasesRetained: report.leases.length })}`);
});
