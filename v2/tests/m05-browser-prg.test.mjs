// Milestone 05 — RT-07 with the REAL browser (Playwright 1.61.0 + cached Chromium, OS sandbox on), local test servers only.
// PASS_LOCAL when Playwright is installed; SKIPPED_ENV otherwise. Windows Chromium: this is not a Linux/WSL probe.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.mjs";
import { browserStatus, runE2E } from "../server/tools/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const skip = browserStatus({ hubRoot: HUB_ROOT }).installed ? false : "SKIPPED_ENV: Playwright is not installed";
const made = [];
const scratch = (label) => { const dir = tempDir(label); made.push(dir); return dir; };
test.afterEach(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* screenshot held */ } } });

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

/** A classic form: POST /submit → `status` Location `target`; GET /done shows the stored value. */
function formSite({ status = 303, target = "/done" } = {}) {
  const posts = [];
  const gets = [];
  return serve((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/form")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><title>Formular</title><form method="post" action="/submit"><input id="nume" name="nume"><button id="trimite">Trimite</button></form>');
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { posts.push(decodeURIComponent(body.replace(/^nume=/, "").replace(/\+/g, " "))); res.writeHead(status, { Location: typeof target === "function" ? target() : target }); res.end(); });
      return;
    }
    if (req.method === "GET" && req.url === "/done") {
      gets.push(req.url);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Gata</title><p id="r">Înregistrat: ${posts.at(-1) || "—"}</p><a id="inapoi" href="/form">Înapoi</a>`);
      return;
    }
    res.writeHead(404); res.end("nu există");
  }).then((site) => ({ ...site, posts, gets }));
}

const STEPS = [{ goto: "/" }, { fill: { selector: "#nume", value: "Ana {run}" } }, { click: "#trimite" }, { expectText: "Înregistrat: Ana" }, { click: "#inapoi" }, { expectSelector: "#nume" }];

test("M05-BR-01 RT-07: a form POST answered 303 (post-redirect-get) reaches the result page; exactly one POST, the redirect is evidence", { skip }, async () => {
  const site = await formSite();
  try {
    const result = await runE2E({ url: site.url, steps: STEPS, hubRoot: HUB_ROOT, evidenceDir: scratch("prg"), stepTimeoutMs: 6000 });
    assert.equal(result.status, "PASS", JSON.stringify({ steps: result.steps, net: result.network }));
    assert.equal(site.posts.length, 1, "the form was submitted once (the Hub never re-POSTs)");
    assert.match(site.posts[0], /^Ana \S+$/);
    assert.ok(result.network.redirects.some((r) => /\/submit$/.test(r.from) && /\/done$/.test(r.to) && r.method === "POST" && r.status === 303), JSON.stringify(result.network.redirects));
    assert.equal(result.network.blockedCount, 0, JSON.stringify(result.network.blocked));
  } finally { await site.close(); }
});

test("M05-BR-02 RT-07 stays bounded: a 307 re-POST and a 303 to another origin are refused and recorded", { skip }, async () => {
  const repost = await formSite({ status: 307 });
  const other = await serve((req, res) => { res.writeHead(200); res.end("alt server"); });
  const out = await formSite({ status: 303, target: () => `${other.url}done` });
  try {
    const r1 = await runE2E({ url: repost.url, steps: STEPS.slice(0, 4), hubRoot: HUB_ROOT, evidenceDir: scratch("prg-307"), stepTimeoutMs: 4000 });
    assert.equal(r1.status, "FAIL");
    assert.ok(r1.network.blocked.some((b) => /redirect of a POST request is not followed/.test(b.reason)), JSON.stringify(r1.network.blocked));
    assert.equal(repost.posts.length, 1);
    const r2 = await runE2E({ url: out.url, steps: STEPS.slice(0, 4), hubRoot: HUB_ROOT, evidenceDir: scratch("prg-out"), stepTimeoutMs: 4000 });
    assert.equal(r2.status, "FAIL");
    assert.ok(r2.network.blocked.some((b) => /redirect outside the approved local origin/.test(b.reason)), JSON.stringify(r2.network.blocked));
    assert.equal(out.posts.length, 1);
  } finally { await repost.close(); await other.close(); await out.close(); }
});
