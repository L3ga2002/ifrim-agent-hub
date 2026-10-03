import { PORT, readPid, health, pidAlive } from "./common.mjs";

const h = await health();
const pid = readPid();
if (h?.ok) {
  console.log(JSON.stringify({ running: true, url: `http://localhost:${PORT}/`, apiContract: h.apiContract, pid: pid?.pid, startedAt: pid?.startedAt, mode: h.mode, gate: h.gate, version: h.version }, null, 2));
} else {
  console.log(JSON.stringify({ running: false, pidFile: pid, pidAlive: pid?.pid ? pidAlive(pid.pid) : false }, null, 2));
  process.exitCode = 1;
}
