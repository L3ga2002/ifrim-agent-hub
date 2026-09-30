import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

export const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// HUB_V2_DATA_DIR lets the simulator (npm run v2:sim) keep its own pid/log inside .ifrim/tmp.
export const DATA_DIR = process.env.HUB_V2_DATA_DIR ? path.resolve(process.env.HUB_V2_DATA_DIR) : path.join(HUB_ROOT, ".ifrim", "private");
export const PID_FILE = path.join(DATA_DIR, "v2-hub.pid.json");
export const LOG_FILE = path.join(DATA_DIR, "v2-hub.log");
export const PORT = Number(process.env.HUB_V2_PORT || 8011);

export function readPid() {
  try { return JSON.parse(fs.readFileSync(PID_FILE, "utf8")); } catch { return null; }
}

export function request(method, pathName, { body, token } = {}) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: pathName, timeout: 5000,
      headers: { Host: `127.0.0.1:${PORT}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(token ? { "X-Hub-Token": token } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0 }); });
    req.on("error", () => resolve({ status: 0 }));
    if (data) req.write(data);
    req.end();
  });
}

export const health = async () => (await request("GET", "/api/health")).json;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
