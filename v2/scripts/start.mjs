// Starts the V2 Hub in the background (loopback only), with a size-capped log. Not a Windows service.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { HUB_ROOT, DATA_DIR, LOG_FILE, PORT, readPid, health, sleep, pidAlive } from "./common.mjs";

// M07: the canonical origin (the owner session and Windows Hello live on localhost only); the API client in common.mjs keeps 127.0.0.1.
const url = `http://localhost:${PORT}/`;
const running = await health();
if (running?.ok) {
  console.log(`Ifrim Agent Hub V2 already running: ${url} (mode ${running.mode}, gate ${running.gate})`);
  process.exit(0);
}
const stale = readPid();
if (stale?.pid && pidAlive(stale.pid)) {
  console.error(`PID ${stale.pid} from the pid file is alive but the API does not answer on ${PORT}. Check it before starting another instance.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(HUB_ROOT, "v2", "web", "dist", "index.html"))) {
  console.log("UI not built yet; run: npm run build:v2 (the API still starts).");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
// Log retention: rotate at 5 MB, keep 3 files.
try {
  if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
    for (let i = 2; i >= 1; i -= 1) { try { fs.renameSync(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`); } catch { /* none */ } }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  }
} catch { /* no log yet */ }
const out = fs.openSync(LOG_FILE, "a");
const child = spawn(process.execPath, [path.join(HUB_ROOT, "v2", "server", "main.mjs")], {
  cwd: HUB_ROOT, detached: true, windowsHide: true, stdio: ["ignore", out, out], env: { ...process.env, HUB_V2_PORT: String(PORT) },
});
child.unref();

for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  const h = await health();
  if (h?.ok) {
    console.log(`Ifrim Agent Hub V2 started: ${url}  pid ${child.pid}  mode ${h.mode}  gate ${h.gate}`);
    console.log(`Log: ${path.relative(HUB_ROOT, LOG_FILE)}`);
    process.exit(0);
  }
  if (!pidAlive(child.pid)) break;
}
console.error(`Hub did not become healthy. See ${LOG_FILE}`);
process.exit(1);
