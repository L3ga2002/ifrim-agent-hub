// ifrim-env:preview-host v2 — runs INSIDE bwrap in ifrim-runner (M06-A, M07): new network namespace with loopback only, the
// project copy at /work (writable), /usr read-only, a private /tmp and an empty /home. It starts the project's preview command,
// probes the preview URL from inside the namespace (the Windows host cannot reach it, by design), checks its own isolation and
// prints one JSON line per fact, prefixed by "IFRIM ". It never prints file contents. SIGTERM ends the preview process group.
//
// argv: --url <http://127.0.0.1:PORT/…> --wait-ms <n> --fake <0|1> [--pw <Playwright dir>] -- <command argv…>
// stdin (M07), one JSON object per line:
//   {"cmd":"e2e","id":"<id>","url":"<preview URL>","steps":[…],"stepTimeoutMs":n}  → IFRIM {"kind":"e2e","id":…,"status":…}
//   {"cmd":"abort","id":"<id>"}                                                       → that E2E ends INTERRUPTED
//   end of stdin                                                                      → graceful stop (E2E aborted, preview ended)
// The E2E runs the SAME step semantics as the Hub's Browser Workspace (browser-core.mjs, copied next to this file): request
// guard, post-redirect-get, same origin only, refused requests recorded, console errors, one screenshot. Chromium keeps its OWN
// sandbox (chromiumSandbox: true, never --no-sandbox); the sandbox is measured from /proc on every run (renderer seccomp-bpf,
// renderer in its own user namespace, no --no-sandbox) and a run whose sandbox is not measured active is BLOCKED, never PASS.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { runE2ESteps, browserLaunchOptions, validateE2ESteps, measureChromiumSandbox } from "./browser-core.mjs";
import { redactText } from "./redact.mjs";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && (sep < 0 || i < sep) ? args[i + 1] : fallback; };
const url = opt("url", "http://127.0.0.1:4173/");
const waitMs = Math.min(120000, Math.max(2000, Number(opt("wait-ms", "20000")) || 20000));
const fake = opt("fake", "0") === "1";
const pwDir = opt("pw", "");
const command = sep >= 0 ? args.slice(sep + 1) : [];
const say = (kind, data) => process.stdout.write(`IFRIM ${JSON.stringify({ kind, ...data })}\n`);
/** A screenshot travels back as base64 on one line; a larger one is omitted (the steps and the network log still count). */
const SCREENSHOT_MAX_B64 = 1536 * 1024;

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
let ready = false;
let current = null; // the E2E in progress: { id, controller, done }
let stopping = false;
// The preview's process group; the direct child when the group cannot be signalled (a platform without process groups).
const signalPreview = (signal) => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } } };
const stop = () => {
  if (stopping) return;
  stopping = true;
  current?.controller.abort();
  signalPreview("SIGTERM");
  // The browser closes on abort (bounded inside the core); the preview group gets SIGKILL after the grace period.
  const settle = current ? Promise.race([current.done, new Promise((r) => setTimeout(r, 6000))]) : Promise.resolve();
  settle.finally(() => setTimeout(() => { signalPreview("SIGKILL"); process.exit(0); }, 1500).unref());
};
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

/**
 * The Chromium sandbox of the browser this run launched, from /proc (the renderer of the first page exists right after
 * newPage). The fixture has no /proc: its fake browser may describe a sandbox (to exercise the refusal), otherwise it is
 * "simulated" — the Hub accepts that only from a simulated environment.
 */
async function sandboxOf(browser) {
  if (fake) return typeof browser.ifrimFakeSandbox === "function" ? browser.ifrimFakeSandbox() : { simulated: true, active: false };
  let measured = measureChromiumSandbox(fs);
  for (let i = 0; i < 15 && !measured.renderers; i += 1) { await new Promise((r) => setTimeout(r, 200)); measured = measureChromiumSandbox(fs); }
  return measured;
}
const sandboxRefusal = (s) => (s.simulated || s.active ? null : `sandbox-ul Chromium nu e activ: ${s.reason || "nemăsurat"}`);

function loadPlaywright() {
  if (!pwDir) return { error: "Playwright nu este montat în acest profil (E2E neatestat în mediu)" };
  try { return { pw: createRequire(path.join(pwDir, "ifrim-host.js"))("playwright") }; }
  catch (error) { return { error: `Playwright nu se încarcă din ${pwDir}: ${String(error.message).split("\n")[0].slice(0, 160)}` }; }
}

async function e2e(msg) {
  const id = String(msg.id || "");
  const blocked = (error, extra = {}) => say("e2e", { id, status: "BLOCKED", steps: [], consoleErrors: [], error, ...extra });
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) return blocked("identificator E2E invalid");
  if (current) return blocked(`un alt E2E rulează (${current.id})`);
  if (!ready || exited) return blocked("preview-ul nu rulează");
  let base;
  try { base = new URL(String(msg.url)); } catch { return blocked("URL E2E invalid"); }
  if (base.origin !== target.origin || base.username || base.password) return blocked("E2E doar pe originea preview-ului din acest namespace");
  const problems = validateE2ESteps(msg.steps);
  if (problems.length) return blocked(`pași E2E invalizi: ${problems.join("; ").slice(0, 300)}`);
  const stepTimeoutMs = Math.min(60000, Math.max(1000, Number(msg.stepTimeoutMs) || 10000));
  const loaded = loadPlaywright();
  if (!loaded.pw) return blocked(loaded.error);
  const controller = new AbortController();
  let before = null;
  let after = null;
  const run = (async () => {
    try {
      const result = await runE2ESteps({ base: base.href, steps: msg.steps, id: `e2e-${id}`, stepTimeoutMs, signal: controller.signal, redact: redactText,
        launch: (origin) => { const o = browserLaunchOptions(origin); return loaded.pw.chromium.launch({ ...o, chromiumSandbox: true, args: [...o.args, "--disable-dev-shm-usage"] }); },
        beforeSteps: async ({ browser }) => { before = await sandboxOf(browser); return sandboxRefusal(before); },
        afterSteps: async ({ browser }) => { after = await sandboxOf(browser); return sandboxRefusal(after); },
        screenshot: async (page) => page.screenshot({ fullPage: false, timeout: stepTimeoutMs }) });
      const shot = Buffer.isBuffer(result.screenshot) ? result.screenshot.toString("base64") : null;
      const measured = after || before || null;
      say("e2e", { ...result, id, screenshot: undefined, screenshotB64: shot && shot.length <= SCREENSHOT_MAX_B64 ? shot : undefined, screenshotOmitted: Boolean(shot && shot.length > SCREENSHOT_MAX_B64),
        sandbox: measured && { simulated: Boolean(measured.simulated), active: Boolean(measured.active), measuredBeforeSteps: Boolean(before), measuredAfterSteps: Boolean(after),
          rendererSeccomp: measured.rendererSeccomp ?? null, rendererOwnUserNs: measured.rendererOwnUserNs ?? null, rendererNoNewPrivs: measured.rendererNoNewPrivs ?? null,
          noSandboxFlag: measured.noSandboxFlag ?? null, renderers: measured.renderers ?? null, reason: measured.reason || null } });
    } catch (error) {
      blocked(`browserul nu a putut rula în namespace: ${redactText(String(error.message || error)).split("\n")[0].slice(0, 280)}`);
    }
  })();
  current = { id, controller, done: run };
  try { await run; } finally { current = null; }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg?.cmd === "e2e") e2e(msg).catch(() => {});
  else if (msg?.cmd === "abort" && current && String(msg.id) === current.id) current.controller.abort();
});
// The Hub ends stdin to stop the host (graceful: the browser closes, the preview group ends).
rl.on("close", stop);

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
  say(ok ? "ready" : "failed", { check: last, exited, durationMs: Date.now() - started, tail: ok ? [] : tail.slice(-20), e2e: Boolean(pwDir) });
  if (!ok) { stop(); return; }
  ready = true;
  // Stays up until the Hub stops it (stdin end or SIGTERM); a preview that dies on its own is reported once.
  setInterval(() => { if (exited && !stopping) { current?.controller.abort(); say("exited", { exited, tail: tail.slice(-10) }); process.exit(1); } }, 1000);
})();
