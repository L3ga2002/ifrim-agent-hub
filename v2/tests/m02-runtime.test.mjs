import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTestHub } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { validateBrowserUrl, browserStatus, BROWSER_APPROVAL_REQUEST } from "../server/tools/browser.mjs";
import { searchFiles } from "../server/tools/registry.mjs";

function request(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, json, text }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
async function startServer() {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  const post = (p, body) => request(t.config.port, { method: "POST", path: p, headers: { "X-Hub-Token": token }, body });
  const get = (p) => request(t.config.port, { path: p });
  return { ...t, get, post, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}
const invoke = async (hub, toolId, args) => (await hub.commands.dispatch({ type: "tool.invoke", payload: { toolId, projectId: hub.projects.hub().id, args }, actor: "user", channel: "test" })).result;

test("M02-RT-01 files.read pages large files instead of refusing them; binaries are not shown", async () => {
  const t = await makeTestHub();
  try {
    const big = "line of text\n".repeat(30000); // ~390 KB
    fs.writeFileSync(path.join(t.projectDir, "big.log"), big);
    const first = await invoke(t.hub, "files.read", { path: "big.log", limit: 100000 });
    assert.equal(first.size, Buffer.byteLength(big));
    assert.equal(first.offset, 0);
    assert.equal(first.truncated, true);
    assert.equal(first.nextOffset, 100000);
    const last = await invoke(t.hub, "files.read", { path: "big.log", offset: first.size - 13, limit: 4096 });
    assert.equal(last.nextOffset, null);
    assert.equal(last.content, "line of text\n");
    fs.writeFileSync(path.join(t.projectDir, "blob.bin"), Buffer.from([1, 2, 0, 3]));
    await assert.rejects(invoke(t.hub, "files.read", { path: "blob.bin" }), /Binary/);
  } finally { await t.cleanup(); }
});

test("M02-RT-02 files.search finds literal text, redacts secrets and never enters protected paths or secret files", async () => {
  const t = await makeTestHub();
  try {
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(t.projectDir, rel)), { recursive: true }); fs.writeFileSync(path.join(t.projectDir, rel), text); };
    put("src/contact.js", "const NEEDLE_MARK = 1;\nconst token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';\n");
    put(".ifrim/private/leak.txt", "NEEDLE_MARK private");
    put(".ifrim/BACKUPS/leak.txt", "NEEDLE_MARK backup");
    put(".env", "NEEDLE_MARK=secret");
    put("node_modules/pkg/index.js", "NEEDLE_MARK dependency");
    const result = searchFiles(t.projectDir, { query: "needle_mark" });
    assert.deepEqual(result.matches.map((m) => m.path), ["src/contact.js"]);
    const tokenLine = searchFiles(t.projectDir, { query: "const token" }).matches[0];
    assert.doesNotMatch(tokenLine.text, /ghp_abcdefghijklmnop/, "secret values are redacted in results");
    assert.throws(() => searchFiles(t.projectDir, { query: "x" }), /2–200/);
    assert.throws(() => searchFiles(t.projectDir, { query: "NEEDLE_MARK", path: ".ifrim/private" }), /protected/);
    const viaTool = await invoke(t.hub, "files.search", { query: "NEEDLE_MARK" });
    assert.equal(viaTool.matches.length, 1);
  } finally { await t.cleanup(); }
});

test("M02-RT-03 browser workspace: only local URLs with a port, never the Hub itself; without Playwright the status is NEEDS_INSTALL_APPROVAL", async () => {
  assert.equal(validateBrowserUrl("http://127.0.0.1:3004/"), "http://127.0.0.1:3004/");
  assert.equal(validateBrowserUrl("http://localhost:5173/contact"), "http://localhost:5173/contact");
  for (const bad of ["https://example.com/", "http://127.0.0.1/", "file:///C:/x", "http://user:pw@127.0.0.1:3004/", "http://10.0.0.5:3004/", "javascript:alert(1)"]) {
    assert.throws(() => validateBrowserUrl(bad), undefined, bad);
  }
  assert.throws(() => validateBrowserUrl("http://127.0.0.1:8011/", { hubPorts: [8011] }), /admin/);
  const t = await makeTestHub();
  try {
    const status = browserStatus({ hubRoot: t.projectDir });
    assert.equal(status.status, "NEEDS_INSTALL_APPROVAL");
    assert.deepEqual(status.approvalRequest, BROWSER_APPROVAL_REQUEST);
    const def = t.hub.tools.definitions.find((d) => d.id === "browser.inspect");
    assert.equal(def.status, "NEEDS_INSTALL_APPROVAL");
    await assert.rejects(invoke(t.hub, "browser.inspect", { url: "http://127.0.0.1:3004/" }), /Playwright/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'browser.inspect'").get().n, 0, "no approval is created for a tool that cannot run");
  } finally { await t.cleanup(); }
});

test("M02-RT-04 HTTP: state carries simulation flag, recent conversations/results and company structure; /api/sim is 404 outside the simulator", async () => {
  const s = await startServer();
  try {
    const health = (await s.get("/api/health")).json;
    assert.equal(health.simulation, false);
    const state = (await s.get("/api/state")).json;
    assert.equal(state.simulation, false);
    assert.ok(Array.isArray(state.recentConversations) && Array.isArray(state.recentResults));
    assert.equal(state.company.roles, 18);
    assert.equal(state.company.departments.filter((d) => d.status === "active").length, 4);
    assert.ok(state.serverTime);
    assert.equal((await s.get("/api/sim")).status, 404);
    assert.equal((await s.post("/api/sim/execute", {})).status, 404);
    const browser = (await s.get("/api/browser/status")).json;
    assert.equal(browser.status, "NEEDS_INSTALL_APPROVAL");
    assert.equal((await s.get("/api/browser/evidence/..%2F..%2Fhub-v2.sqlite")).status, 400);
    const calls = (await s.get("/api/tool-calls?tool=files.list")).json;
    assert.ok(Array.isArray(calls.calls));
  } finally { await s.stop(); }
});

test("M02-RT-05 tool call history records reads with time and redacted arguments", async () => {
  const s = await startServer();
  try {
    await s.post("/api/tools/files.list", { projectId: s.hub.projects.hub().id, args: { path: "." } });
    const calls = (await s.get("/api/tool-calls?tool=files.list")).json.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "completed");
    assert.ok(calls[0].startedAt && calls[0].finishedAt);
  } finally { await s.stop(); }
});
