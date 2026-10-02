// ifrim-env:preview-host v1 — runs INSIDE bwrap in ifrim-runner (M06-A): new network namespace with loopback only, the
// project copy at /work (writable), /usr read-only, a private /tmp and an empty /home. It starts the project's preview command,
// probes the preview URL from inside the namespace (the Windows host cannot reach it, by design), checks its own isolation and
// prints one JSON line per fact, prefixed by "IFRIM ". It never prints file contents. SIGTERM ends the preview process group.
//
// argv: --url <http://127.0.0.1:PORT/…> --wait-ms <n> --fake <0|1> -- <command argv…>
import { spawn } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && i < sep ? args[i + 1] : fallback; };
const url = opt("url", "http://127.0.0.1:4173/");
const waitMs = Math.min(120000, Math.max(2000, Number(opt("wait-ms", "20000")) || 20000));
const fake = opt("fake", "0") === "1";
const command = sep >= 0 ? args.slice(sep + 1) : [];
const say = (kind, data) => process.stdout.write(`IFRIM ${JSON.stringify({ kind, ...data })}\n`);

let target;
try { target = new URL(url); } catch { say("error", { reason: "URL invalid" }); process.exit(2); }
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) { say("error", { reason: "preview-ul trebuie să fie pe loopback" }); process.exit(2); }
if (!command.length) { say("error", { reason: "comandă lipsă" }); process.exit(2); }

const tail = [];
const child = spawn(command[0], command.slice(1), { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
const keep = (chunk) => { for (const line of String(chunk).split("\n")) if (line.trim()) { tail.push(line.slice(0, 300)); if (tail.length > 40) tail.shift(); } };
child.stdout.on("data", keep); child.stderr.on("data", keep);
let exited = null;
child.on("exit", (code, signal) => { exited = { code, signal }; });
const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } process.exit(0); }, 1500).unref(); };
process.on("SIGTERM", stop); process.on("SIGINT", stop); process.on("SIGHUP", stop);

async function probe() {
  const started = Date.now();
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
    const res = await fetch(target, { signal: c.signal, redirect: "manual" }); clearTimeout(t);
    const body = (await res.text()).slice(0, 65536);
    return { status: res.status, latencyMs: Date.now() - started, title: (body.match(/<title>([^<]{0,200})<\/title>/i)?.[1] || "").trim() };
  } catch (error) { return { status: 0, error: error.cause?.code || error.name || "error" }; }
}

/** What this namespace can reach: measured, not assumed (skipped in the fixture, which has no namespace). */
async function isolation() {
  if (fake) return { simulated: true };
  const out = {};
  for (const [k, u] of [["internet", "http://1.1.1.1/"], ["dns", "http://example.com/"]]) {
    try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2000); await fetch(u, { signal: c.signal }); clearTimeout(t); out[k] = "REACHED"; }
    catch (e) { out[k] = e.cause?.code || e.name || "blocked"; }
  }
  for (const p of ["/home/runner/.codex", "/mnt/c", "/home/runner/ws"]) { try { fs.readdirSync(p); out[p] = "VISIBLE"; } catch (e) { out[p] = e.code; } }
  try { fs.writeFileSync("/usr/.ifrim-probe", "x"); out.usrWritable = true; fs.rmSync("/usr/.ifrim-probe"); } catch { out.usrWritable = false; }
  out.ok = out.internet !== "REACHED" && out.dns !== "REACHED" && out["/home/runner/.codex"] !== "VISIBLE" && out["/mnt/c"] !== "VISIBLE" && out["/home/runner/ws"] !== "VISIBLE" && out.usrWritable === false;
  return out;
}

(async () => {
  say("isolation", await isolation());
  const started = Date.now();
  let last = null;
  while (Date.now() - started < waitMs && !exited) {
    last = await probe();
    if (last.status >= 200 && last.status < 500) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const ok = last && last.status >= 200 && last.status < 400;
  say(ok ? "ready" : "failed", { check: last, exited, durationMs: Date.now() - started, tail: ok ? [] : tail.slice(-20) });
  if (!ok) { stop(); return; }
  // Stays up until the Hub stops it. A browser E2E against it would have to run inside this same namespace (Chromium for
  // Linux in ifrim-runner, not installed: an install decision of the owner); the Windows browser cannot reach it, by design.
  setInterval(() => { if (exited) { say("exited", { exited, tail: tail.slice(-10) }); process.exit(1); } }, 1000);
})();
