// Graceful stop through the authenticated local API. Refuses while runs are active unless --force.
import { PORT, readPid, request, sleep, pidAlive } from "./common.mjs";

const force = process.argv.includes("--force");
const session = await request("GET", "/api/session");
if (!session.json?.token) {
  const pid = readPid();
  if (pid?.pid && pidAlive(pid.pid)) {
    console.error(`API on ${PORT} does not answer but pid ${pid.pid} is alive. Not killing it blindly; inspect it (entry ${pid.entry}).`);
    process.exit(1);
  }
  console.log("Ifrim Agent Hub V2 is not running.");
  process.exit(0);
}
const result = await request("POST", "/api/system/shutdown", { body: { force }, token: session.json.token });
if (result.status !== 200) {
  console.error(result.json?.error?.message || `Shutdown refused (${result.status})`);
  if (result.json?.error?.details?.active) console.error("Active runs:", result.json.error.details.active.map((r) => `${r.provider}:${r.runId}`).join(", "), "\nUse --force to interrupt them.");
  process.exit(1);
}
const pid = readPid()?.pid;
for (let i = 0; i < 30; i += 1) {
  await sleep(300);
  if (!pid || !pidAlive(pid)) { console.log(`Stopped${result.json.activeRunsInterrupted ? ` (${result.json.activeRunsInterrupted} runs interrupted)` : ""}.`); process.exit(0); }
}
console.error("Shutdown requested but the process is still alive.");
process.exit(1);
