// Milestone 03 — Browser Workspace with the REAL browser (Playwright 1.61.0 + the cached Chromium 1228, OS sandbox on),
// only against local test servers started here. PASS_LOCAL when Playwright is installed; SKIPPED_ENV otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.mjs";
import { browserStatus, inspectPage, runE2E, validateE2ESteps, browserLaunchOptions } from "../server/tools/browser.mjs";
import { FACTORY_DEMOS } from "../server/factory/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const installed = browserStatus({ hubRoot: HUB_ROOT }).installed;
const skip = installed ? false : "SKIPPED_ENV: Playwright is not installed";

/** Temp folders of this file (evidence, screenshots) are removed after every test. */
const made = [];
const scratch = (label) => { const dir = tempDir(label); made.push(dir); return dir; };
test.afterEach(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a screenshot still open on Windows */ } } });

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) }));
  });
}

test("M03-BR-00 E2E steps are validated (kinds, relative paths, bounded selectors and values); the Chromium OS sandbox is on", () => {
  assert.deepEqual(validateE2ESteps([{ goto: "/" }, { click: "button" }, { expectText: "ok" }]), []);
  for (const bad of [[], [{ goto: "http://example.com/" }], [{ goto: "//evil" }], [{ eval: "x" }], [{ goto: "/", click: "a" }], [{ viewport: { width: 10, height: 10 } }], [{ fill: { selector: "", value: "x" } }],
    // Steps that would run on an empty page (no goto first) are refused: they could "pass" without the preview.
    [{ viewport: { width: 390, height: 844 } }, { noHorizontalOverflow: true }], [{ click: "a" }, { goto: "/" }], [{ viewport: { width: 390, height: 844 } }]]) {
    assert.ok(validateE2ESteps(bad).length, JSON.stringify(bad));
  }
  assert.deepEqual(validateE2ESteps([{ viewport: { width: 390, height: 844 } }, { goto: "/" }, { noHorizontalOverflow: true }]), []);
  assert.equal(browserLaunchOptions("http://127.0.0.1:4000").chromiumSandbox, true);
  assert.deepEqual(validateE2ESteps(FACTORY_DEMOS["service-request"].spec.acceptance.find((a) => a.id === "AC-7").steps), []);
});

test("M03-BR-01 real browser: an isolated inspection loads the local page, blocks every other origin and writes one screenshot", { skip }, async () => {
  const other = await serve((req, res) => { res.writeHead(200); res.end("other origin"); });
  const page = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>Pagina locală</title><h1>Salut</h1><img src="${other.url}x.png"><script>fetch("http://example.com/").catch(() => {}); fetch("${other.url}data").catch(() => {});</script>`);
  });
  const evidenceDir = scratch("browser-evidence");
  try {
    const result = await inspectPage({ url: page.url, hubRoot: HUB_ROOT, evidenceDir, hubPorts: [8011, 8012] });
    assert.equal(result.status, 200);
    assert.equal(result.title, "Pagina locală");
    assert.ok(fs.existsSync(path.join(evidenceDir, result.screenshot)), "screenshot written");
    assert.ok(result.network.blockedCount >= 2 || result.network.blocked?.length >= 2, `other origins blocked: ${JSON.stringify(result.network).slice(0, 300)}`);
    assert.match(result.network.networkLayer, /dead proxy/);
  } finally { await page.close(); await other.close(); }
});

test("M03-BR-02 real browser E2E on the Demo B form (mobile 390 px): valid submit → success + list; empty submit → field errors; no horizontal overflow", { skip }, async () => {
  const dir = scratch("e2e-demo-b");
  fs.mkdirSync(path.join(dir, "public"), { recursive: true });
  fs.copyFileSync(path.join(here, "fixtures", "factory-solutions", "service-request", "index.html"), path.join(dir, "public", "index.html"));
  const { createApp } = await import("./fixtures/factory-solutions/service-request/server-app.js");
  const app = createApp({ dbFile: path.join(dir, "data", "e2e.sqlite"), publicDir: path.join(dir, "public") });
  const site = await serve(app.handle);
  try {
    const steps = FACTORY_DEMOS["service-request"].spec.acceptance.find((a) => a.id === "AC-7").steps;
    const result = await runE2E({ url: site.url, steps, hubRoot: HUB_ROOT, evidenceDir: path.join(dir, "evidence"), hubPorts: [8011, 8012] });
    assert.equal(result.status, "PASS", JSON.stringify(result.steps.filter((s) => !s.ok)));
    assert.equal(result.steps.length, steps.length);
    assert.ok(result.screenshot && fs.existsSync(path.join(dir, "evidence", result.screenshot)));
    assert.equal(result.consoleErrors.filter((e) => e.type === "pageerror").length, 0);
  } finally { await site.close(); app.close(); }
});

test("M03-BR-03 real browser E2E reports the exact failing step (missing text, horizontal overflow) and never claims a pass", { skip }, async () => {
  const site = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Lat</title><div style="width:900px">prea lat</div><button id="b">Ok</button>');
  });
  const dir = scratch("e2e-fail");
  try {
    const missing = await runE2E({ url: site.url, steps: [{ goto: "/" }, { click: "#b" }, { expectText: "Text care nu există" }], hubRoot: HUB_ROOT, evidenceDir: dir, stepTimeoutMs: 1500 });
    assert.equal(missing.status, "FAIL");
    assert.deepEqual(missing.steps.map((s) => s.ok), [true, true, false]);
    const wide = await runE2E({ url: site.url, steps: [{ viewport: { width: 390, height: 844 } }, { goto: "/" }, { noHorizontalOverflow: true }], hubRoot: HUB_ROOT, evidenceDir: dir });
    assert.equal(wide.status, "FAIL");
    assert.match(wide.steps.at(-1).error, /depășire orizontală/);
  } finally { await site.close(); }
});

test("M03-BR-04 real browser: goto follows a same-origin redirect, fails on HTTP 404, and {run} makes every run's data unique", { skip }, async () => {
  const received = [];
  const site = await serve((req, res) => {
    if (req.url === "/") { res.writeHead(302, { Location: "/home" }); res.end(); return; }
    if (req.url === "/home") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><title>Acasă</title><input id="m"><button id="b">Trimite</button><p id="o"></p>'
        + '<script>document.getElementById("b").onclick = async () => { const r = await fetch("/api", { method: "POST", body: document.getElementById("m").value }); document.getElementById("o").textContent = await r.text(); };</script>');
      return;
    }
    if (req.url === "/api" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { received.push(body); res.writeHead(200); res.end(`Primit: ${body}`); });
      return;
    }
    res.writeHead(404); res.end("nu există");
  });
  const dir = scratch("e2e-redirect");
  try {
    const steps = [{ goto: "/" }, { fill: { selector: "#m", value: "mesaj {run}" } }, { click: "#b" }, { expectText: "Primit: mesaj {run}" }];
    const first = await runE2E({ url: site.url, steps, hubRoot: HUB_ROOT, evidenceDir: dir, stepTimeoutMs: 5000 });
    assert.equal(first.status, "PASS", JSON.stringify(first.steps));
    assert.ok(first.network.redirects.some((r) => /\/home$/.test(r.to)), "the redirect is part of the evidence");
    const second = await runE2E({ url: site.url, steps, hubRoot: HUB_ROOT, evidenceDir: dir, stepTimeoutMs: 5000 });
    assert.equal(second.status, "PASS");
    assert.equal(received.length, 2);
    assert.ok(received.every((v) => /^mesaj \S+$/.test(v) && !v.includes("{run}")), JSON.stringify(received));
    assert.notEqual(received[0], received[1], "each run submits its own data");
    const missing = await runE2E({ url: site.url, steps: [{ goto: "/nu-exista" }, { noHorizontalOverflow: true }], hubRoot: HUB_ROOT, evidenceDir: dir, stepTimeoutMs: 5000 });
    assert.equal(missing.status, "FAIL");
    assert.match(missing.steps[0].error, /HTTP 404/);
  } finally { await site.close(); }
});

/** A fake browser with Playwright's surface whose page hangs where asked (no Playwright needed). */
function fakeBrowser({ hangEvaluate = false, hangWait = false } = {}) {
  const calls = { launched: 0, closed: 0 };
  let failPending = null;
  const page = {
    on() {}, url: () => "http://127.0.0.1:4599/",
    goto: async () => ({ status: () => 200 }),
    setViewportSize: async () => {},
    evaluate: () => (hangEvaluate ? new Promise(() => {}) : Promise.resolve({ scroll: 390, view: 390 })),
    waitForFunction: () => (hangWait ? new Promise((_, reject) => { failPending = reject; }) : Promise.resolve()),
    screenshot: async () => {},
  };
  const context = { route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page, close: async () => {} };
  const browser = { newContext: async () => context, close: async () => { calls.closed += 1; failPending?.(new Error("Target page, context or browser has been closed")); } };
  return { calls, launch: async () => { calls.launched += 1; return browser; } };
}

test("M03-BR-05 a page that blocks the renderer cannot hold the E2E: the step fails within its timeout and the browser is closed", { timeout: 15000 }, async () => {
  const fake = fakeBrowser({ hangEvaluate: true });
  const started = Date.now();
  const result = await runE2E({ url: "http://127.0.0.1:4599/", steps: [{ goto: "/" }, { noHorizontalOverflow: true }], evidenceDir: scratch("e2e-hang"), stepTimeoutMs: 300, launch: fake.launch });
  assert.equal(result.status, "FAIL");
  assert.match(result.steps[1].error, /fără răspuns în 300 ms/);
  assert.ok(Date.now() - started < 5000, "bounded");
  assert.equal(fake.calls.closed, 1);
});

test("M03-BR-06 Stop / Pause (abort signal) closes the browser at once and the result is INTERRUPTED, never a failed step", { timeout: 15000 }, async () => {
  const fake = fakeBrowser({ hangWait: true });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const result = await runE2E({ url: "http://127.0.0.1:4599/", steps: [{ goto: "/" }, { expectText: "niciodată" }], evidenceDir: scratch("e2e-abort"), stepTimeoutMs: 30000, launch: fake.launch, signal: controller.signal });
  assert.equal(result.status, "INTERRUPTED");
  assert.ok(result.steps.every((s) => s.ok), "the interrupted step is not reported as failed");
  assert.ok(fake.calls.closed >= 1);
  await assert.rejects(runE2E({ url: "http://127.0.0.1:4599/", steps: [{ goto: "/" }], evidenceDir: scratch("e2e-abort2"), launch: fake.launch, signal: AbortSignal.abort() }), /oprit/);
});

test("M03-BR-07 a browser that dies during the run is an infrastructure failure (the factory blocks), never a failed step of the page", { timeout: 15000 }, async () => {
  const page = { on() {}, url: () => "http://127.0.0.1:4599/", goto: async () => ({ status: () => 200 }), click: async () => { throw new Error("Target page, context or browser has been closed"); }, screenshot: async () => {} };
  const context = { route: async () => {}, routeWebSocket: async () => {}, newPage: async () => page, close: async () => {} };
  const browser = { connected: true, isConnected() { return this.connected; }, newContext: async () => context, close: async () => {} };
  page.click = async () => { browser.connected = false; throw new Error("Target page, context or browser has been closed"); };
  await assert.rejects(runE2E({ url: "http://127.0.0.1:4599/", steps: [{ goto: "/" }, { click: "#b" }], evidenceDir: scratch("e2e-lost"), launch: async () => browser }), /browserul s-a oprit în timpul E2E \(pasul 2\)/);
});
