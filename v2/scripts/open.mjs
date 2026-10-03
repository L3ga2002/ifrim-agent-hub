// M07 launcher: makes sure the V2 Hub runs and is healthy, then opens Lega on the canonical origin in the default browser.
// Usage (Hub root): node v2/scripts/open.mjs [--no-browser] [--path "#/lega/setup"]
// - Starts the Hub only when it is not running (the same detached start as `npm run v2`; it never stops or restarts one).
// - Checks /api/health and the API contract; a running server of another version is reported, not replaced.
// - Opens http://localhost:8011 (the owner session and Windows Hello live there). It never opens the microphone, starts a
//   model, a mission or a background task, and it registers nothing to run at logon.
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { HUB_ROOT, PORT, health, sleep } from "./common.mjs";
import { API_CONTRACT, HUB_VERSION } from "../server/config.mjs";

const args = process.argv.slice(2);
const noBrowser = args.includes("--no-browser");
const pathArg = (() => { const i = args.indexOf("--path"); return i >= 0 ? String(args[i + 1] || "") : "#/lega"; })();
if (!/^#\/[A-Za-z0-9/_-]{0,80}$/.test(pathArg)) { console.error("--path must look like #/lega or #/lega/setup"); process.exit(2); }
const url = `http://localhost:${PORT}/${pathArg}`;

let h = await health();
if (!h?.ok) {
  console.log("Hub-ul nu rulează; îl pornesc…");
  const r = spawnSync(process.execPath, [path.join(HUB_ROOT, "v2", "scripts", "start.mjs")], { cwd: HUB_ROOT, stdio: "inherit", windowsHide: true });
  if (r.status !== 0) { console.error("Pornirea a eșuat; vezi .ifrim/private/v2-hub.log"); process.exit(1); }
  for (let i = 0; i < 20 && !h?.ok; i += 1) { h = await health(); if (!h?.ok) await sleep(500); }
}
if (!h?.ok) { console.error("Hub-ul nu răspunde pe /api/health."); process.exit(1); }
const sameContract = h.apiContract === API_CONTRACT;
console.log(`Hub ${h.version} · mod ${h.mode} · gate ${h.gate} · contract ${h.apiContract ?? "—"}${sameContract ? "" : ` (codul de pe disc: ${HUB_VERSION}, contract ${API_CONTRACT})`}`);
if (!sameContract) console.log("Serverul pornit e altă versiune decât codul de pe disc: repornește-l cu v2\\scripts\\restart.ps1 când nu rulează nimic.");
if (noBrowser) { console.log(url); process.exit(0); }
// `start "" <url>` hands the URL to the default browser; nothing else is launched.
const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
child.unref();
console.log(`Deschis: ${url}`);
