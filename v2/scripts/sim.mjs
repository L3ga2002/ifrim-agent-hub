// Starts the SIMULATOR (separate process, port 8012, own data in .ifrim/tmp/v2-sim, demo project, fixture providers only).
// It never touches the real Hub's database, gate or providers. The data directory is recreated on every start.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIM_ROOT = path.join(HUB_ROOT, ".ifrim", "tmp", "v2-sim");
const DATA_DIR = path.join(SIM_ROOT, "data");
const PORT = Number(process.env.HUB_V2_SIM_PORT || 8012);
process.env.HUB_V2_PORT = String(PORT);
process.env.HUB_V2_DATA_DIR = DATA_DIR;
const { health, sleep } = await import("./common.mjs");
const { prepareDemoProject } = await import("./sim-demo.mjs");

const running = await health();
if (running?.ok) {
  console.log(running.simulation ? `Simulator already running: http://127.0.0.1:${PORT}/` : `Port ${PORT} is used by a non-simulator Hub; not starting.`);
  process.exit(running.simulation ? 0 : 1);
}
if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.mkdirSync(DATA_DIR, { recursive: true });
prepareDemoProject(path.join(DATA_DIR, "demo-project"));
const out = fs.openSync(path.join(SIM_ROOT, "sim.log"), "w");
const child = spawn(process.execPath, [path.join(HUB_ROOT, "v2", "server", "main.mjs")], {
  cwd: HUB_ROOT, detached: true, windowsHide: true, stdio: ["ignore", out, out],
  env: { ...process.env, HUB_V2_SIMULATION: "1", HUB_V2_PORT: String(PORT), HUB_V2_DATA_DIR: DATA_DIR },
});
child.unref();
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  const h = await health();
  if (h?.ok && h.simulation) { console.log(`SIMULARE — FĂRĂ MODELE REALE: http://127.0.0.1:${PORT}/  pid ${child.pid}  (log .ifrim/tmp/v2-sim/sim.log)`); process.exit(0); }
}
console.error("Simulator did not become healthy; see .ifrim/tmp/v2-sim/sim.log");
process.exit(1);
