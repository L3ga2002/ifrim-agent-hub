import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { createHub } from "./hub.mjs";
import { createHttpServer } from "./http/server.mjs";
import { simulationOverrides, assertDemoProject, createSimulation } from "./sim/simulation.mjs";

// HUB_V2_SIMULATION=1: separate simulator process (own DB in .ifrim/tmp, demo project, fixture providers only).
const simulation = process.env.HUB_V2_SIMULATION === "1";
const overrides = simulation ? simulationOverrides() : {};
if (simulation) { fs.mkdirSync(path.join(overrides.dataDir, "home", ".codex"), { recursive: true }); assertDemoProject(overrides.hubRoot); }
const config = loadConfig(overrides);
const hub = createHub(config, simulation ? { homeDir: path.join(config.dataDir, "home") } : {});
const report = await hub.boot();
if (simulation) {
  hub.simulation = createSimulation(hub);
  hub.simulation.seed().then((r) => console.log(`[sim] seeded ${JSON.stringify(r)}`)).catch((e) => console.error(`[sim] seed failed: ${e.message}`));
}
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
  console.log(`[hub] Ifrim Agent Hub V2${config.simulation ? " (SIMULARE)" : ""} on http://${config.host}:${config.port}  mode=${hub.settings.get("mode")} gate=${hub.settings.get("executionGate").status}`);
  console.log(`[hub] recovery: ${JSON.stringify({ modeReset: report.modeReset, runs: report.runs.length, tasks: report.tasks.length, leasesRetained: report.leases.length })}`);
});
