import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { createHub } from "./hub.mjs";
import { createHttpServer } from "./http/server.mjs";
import { simulationOverrides, assertDemoProject, createSimulation } from "./sim/simulation.mjs";
import { stopForShutdown, closeProposalsFromBeforeStop } from "./owner/stop-scope.mjs";

// HUB_V2_SIMULATION=1: separate simulator process (own DB in .ifrim/tmp, demo project, fixture providers only).
const simulation = process.env.HUB_V2_SIMULATION === "1";
const overrides = simulation ? simulationOverrides() : {};
if (simulation) { fs.mkdirSync(path.join(overrides.dataDir, "home", ".codex"), { recursive: true }); assertDemoProject(overrides.hubRoot); }
const config = loadConfig(overrides);
const hub = createHub(config, simulation ? { homeDir: path.join(config.dataDir, "home") } : {});
const report = await hub.boot();
// 2.12.1 (SM-05, D15): a plan still waiting for its confirmation that was proposed before the stop which still holds the gate is closed
// now, before any request is served — the stop's own deferred closure may have been lost with the previous process.
try { report.stopProposals = closeProposalsFromBeforeStop(hub); } catch (error) { report.stopProposals = { error: String(error?.message || error).slice(0, 300) }; }
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
  // M10.2.1 (D17): the suspension records its origin as the Hub's own shutdown (a Stop All or a security record already there is kept).
  // 2.12.1: also with a start still being admitted (AS-01: it never reaches its model); the operation plans left running are recorded
  // as interrupted by this stop (D22); and the reactions the stop queued (the closure of plans waiting for a confirmation, D15 / SM-05)
  // run before the services close.
  try { await stopForShutdown(hub, signal); } catch { /* recorded by run manager */ }
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
  console.log(`[hub] recovery: ${JSON.stringify({ modeReset: report.modeReset, runs: report.runs.length, tasks: report.tasks.length, leasesRetained: report.leases.length, stopProposalsClosed: report.stopProposals?.closed?.length || 0 })}`);
});
