import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTestHub, tempDir } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { validateBrowserUrl, browserStatus, browserRequestVerdict, inspectPage, BROWSER_APPROVAL_REQUEST, browserLaunchOptions, launcherFor } from "../server/tools/browser.mjs";
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
  // The "not installed" branch, on a root no node_modules can be found from (Playwright 1.61.0 is a devDependency of the Hub
  // since 2026-10-01, so test hubs inside the repository resolve it: both branches are covered below).
  const outside = path.join(path.parse(process.cwd()).root, `ifrim-no-playwright-${process.pid}`);
  const missing = browserStatus({ hubRoot: outside });
  if (!missing.installed) {
    assert.equal(missing.status, "NEEDS_INSTALL_APPROVAL");
    assert.deepEqual(missing.approvalRequest, BROWSER_APPROVAL_REQUEST);
  }
  const t = await makeTestHub();
  try {
    const installed = browserStatus({ hubRoot: t.projectDir }).installed;
    const def = t.hub.tools.definitions.find((d) => d.id === "browser.inspect");
    if (!installed) {
      assert.equal(def.status, "NEEDS_INSTALL_APPROVAL");
      await assert.rejects(invoke(t.hub, "browser.inspect", { url: "http://127.0.0.1:3004/" }), /Playwright/);
      assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'browser.inspect'").get().n, 0, "no approval is created for a tool that cannot run");
    } else {
      // Installed: still never automatic, an approval bound to the exact local URL is requested and nothing runs yet.
      assert.match(def.status, /approval per URL/);
      const requested = await invoke(t.hub, "browser.inspect", { url: "http://127.0.0.1:3004/" });
      assert.equal(requested.approvalRequired, true);
      assert.equal(requested.approval.target, "http://127.0.0.1:3004/");
      assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE tool = 'browser.inspect'").get().n, 0, "nothing ran before the approval");
    }
  } finally { await t.cleanup(); }
  // The Hub-level refusal without Playwright (Browser Workspace resolved from a root that has none): no approval, nothing runs.
  if (!missing.installed) {
    const bare = await makeTestHub({ configOverrides: { browserRoot: outside } });
    try {
      assert.equal(bare.hub.tools.definitions.find((d) => d.id === "browser.inspect").status, "NEEDS_INSTALL_APPROVAL");
      await assert.rejects(invoke(bare.hub, "browser.inspect", { url: "http://127.0.0.1:3004/" }), /Playwright/);
      assert.equal(bare.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'browser.inspect'").get().n, 0, "no approval is created for a tool that cannot run");
    } finally { await bare.cleanup(); }
  }
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
    assert.equal(browser.status, browser.installed ? "available" : "NEEDS_INSTALL_APPROVAL");
    assert.equal((await s.get("/api/browser/evidence/..%2F..%2Fhub-v2.sqlite")).status, 400);
    const calls = (await s.get("/api/tool-calls?tool=files.list")).json;
    assert.ok(Array.isArray(calls.calls));
  } finally { await s.stop(); }
});

test("M02-RT-05 tool call history records reads with time and redacted arguments; secret-looking process output is redacted in /api/tool-calls", async () => {
  const s = await startServer();
  const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"; // fictive, shaped like a GitHub token
  try {
    const project = s.hub.projects.hub();
    await s.post("/api/tools/files.list", { projectId: project.id, args: { path: ".", apiToken: SECRET } });
    const calls = (await s.get("/api/tool-calls?tool=files.list")).json.calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "completed");
    assert.ok(calls[0].startedAt && calls[0].finishedAt);
    assert.equal(calls[0].args.path, ".");
    assert.equal(calls[0].args.apiToken, "[redacted]", "a sensitive argument is redacted");

    // process.run over HTTP: request → approve with the displayed hash → execute. The supervisor is replaced for this one
    // call (test mode never spawns npm); its stderr tail is deliberately NOT pre-redacted, so the route's redaction is proven.
    const run = await s.post("/api/tools/process.run", { projectId: project.id, args: { script: "test" } });
    const { approval } = run.json;
    assert.equal((await s.post(`/api/approvals/${approval.id}/decide`, { decision: "approved", displayedHash: approval.payloadHash })).status, 200);
    const realStart = s.hub.supervisor.start;
    s.hub.supervisor.start = ({ key, onStdoutLine }) => {
      onStdoutLine(`# pass 1 · token=${SECRET}`);
      onStdoutLine(`Authorization: Bearer ${SECRET}`);
      return { key, stderrTail: [`npm ERR! push failed with ${SECRET}`, "# fail 0"], exit: Promise.resolve({ code: 0, error: null }) };
    };
    let executed;
    try { executed = await s.post(`/api/approvals/${approval.id}/execute`, {}); } finally { s.hub.supervisor.start = realStart; }
    assert.equal(executed.status, 200, executed.text);
    const history = await s.get("/api/tool-calls?tool=process.test");
    const [call] = history.json.calls;
    assert.equal(call.status, "completed");
    assert.equal(call.result.command, "npm run test");
    assert.equal(call.result.exitCode, 0);
    assert.ok(call.result.outputTail.length >= 3, "the output tail is kept");
    assert.ok(!history.text.includes(SECRET), "no secret-looking value survives in the history response");
    assert.ok(call.result.outputTail.some((line) => /npm ERR! push failed with \[redacted:github-token\]/.test(line)), "stderr is redacted by the route");
    assert.ok(call.result.outputTail.some((line) => /token=\[redacted/.test(line)), "stdout is redacted too");
    assert.ok(!(await s.get("/api/tool-calls?tool=files.list")).text.includes(SECRET));
  } finally { await s.stop(); }
});

/**
 * A Playwright-shaped fake browser (Playwright is not installed): newContext → route/routeWebSocket → newPage → goto sends the
 * document and then the page's sub-requests through the registered route handler, exactly as Chromium hands them over, and
 * `server` answers the Hub's route.fetch calls. It records what reached the "network" and what the guard did.
 */
function fakeBrowser({ server, requests = [], webSockets = [], finalUrl = null, withWebSocketRoute = true }) {
  const calls = { launched: 0, contextOptions: null, routeBeforePage: false, fetched: [], fulfilled: [], aborted: [], sockets: [], screenshots: [], closed: false };
  let onRoute = null; let onSocket = null; let navigatedTo = null;
  const route = (url, { navigation = false, type = "script", method = "GET", iframe = false } = {}) => {
    let outcome = null;
    return {
      outcome: () => outcome,
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation, method: () => method,
        frame: () => ({ parentFrame: () => (iframe ? {} : null) }) }),
      fetch: async ({ url: target, maxRedirects }) => {
        assert.equal(maxRedirects, 0, "the browser never follows a redirect on its own");
        calls.fetched.push(target);
        const answer = server(target);
        return { status: () => answer.status, headers: () => answer.headers || {}, url: () => target };
      },
      fulfill: async ({ response }) => { outcome = { status: response.status() }; calls.fulfilled.push(url); },
      abort: async (code) => { outcome = { aborted: code }; calls.aborted.push({ url, code }); },
    };
  };
  const handlers = {};
  const page = {
    on: (event, fn) => { handlers[event] = fn; },
    async goto(url) {
      navigatedTo = url;
      calls.gotos = [...(calls.gotos || []), url];
      const doc = route(url, { navigation: true, type: "document" });
      await onRoute(doc);
      if (doc.outcome()?.aborted) throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${url}`);
      for (const r of requests) await onRoute(route(r.url, r));
      for (const u of webSockets) onSocket?.({ url: () => u, connectToServer: () => calls.sockets.push({ url: u, connected: true }), close: ({ code }) => calls.sockets.push({ url: u, closed: code }) });
      handlers.console?.({ type: () => "error", text: () => `Failed: token=${"ghp_abcdefghijklmnopqrstuvwxyz0123456789"}` });
      return { status: () => doc.outcome().status };
    },
    url: () => finalUrl || navigatedTo,
    async screenshot({ path: file }) { fs.writeFileSync(file, "PNG-FICTIVE"); calls.screenshots.push(file); },
    async title() { return "Preview local"; },
  };
  const context = {
    async route(matcher, handler) { assert.equal(typeof matcher === "function" ? matcher(new URL("https://any.example/")) : true, true, "every URL goes through the guard"); onRoute = handler; },
    async newPage() { calls.routeBeforePage = Boolean(onRoute); return page; },
    async close() {},
    ...(withWebSocketRoute ? { async routeWebSocket(matcher, handler) { onSocket = handler; } } : {}),
  };
  const browser = { async newContext(options) { calls.contextOptions = options; return context; }, async close() { calls.closed = true; } };
  return { calls, launch: async () => { calls.launched += 1; return browser; } };
}

const ORIGIN = "http://127.0.0.1:4173";
const localServer = (routes) => (url) => routes[url.slice(ORIGIN.length)] || { status: 200 };

test("M02-RT-06 browser allowlist verdict: only the approved local origin (ws as its http origin, same-origin blob, inline data); nothing else", () => {
  const ok = (u) => browserRequestVerdict(u, ORIGIN).allowed;
  for (const u of [`${ORIGIN}/`, `${ORIGIN}/assets/app.js?v=1`, "ws://127.0.0.1:4173/hmr", `blob:${ORIGIN}/7c1e`, "data:image/png;base64,iVBORw0KGgo="]) assert.equal(ok(u), true, u);
  for (const u of ["https://cdn.example.com/lib.js", "http://localhost:4173/app.js", "https://127.0.0.1:4173/", "http://127.0.0.1:4174/", "http://127.0.0.1/",
    "wss://evil.example/socket", "blob:https://evil.example/1", "file:///C:/Windows/win.ini", "chrome://settings", "ftp://127.0.0.1:4173/x",
    "http://user:pw@127.0.0.1:4173/", "not a url", "javascript:alert(1)"]) assert.equal(ok(u), false, u);
  assert.equal(browserRequestVerdict("https://cdn.example.com/lib.js", ORIGIN).reason, "outside the approved local origin");
  assert.match(browserRequestVerdict("file:///C:/x", ORIGIN).reason, /scheme file:/);
});

test("M02-RT-07 browser inspection (fake browser): external sub-resources, redirects out and foreign WebSockets are blocked and recorded; same-origin redirects are followed by the Hub", async () => {
  const evidenceDir = tempDir("browser-evidence");
  try {
    const fake = fakeBrowser({
      server: localServer({
        "/old": { status: 302, headers: { location: "/new" } },
        "/pixel": { status: 302, headers: { location: "https://tracker.example/p?token=ghp_abcdefghijklmnopqrstuvwxyz0123456789" } },
        "/loop": { status: 307, headers: { location: "/loop" } },
      }),
      requests: [
        { url: "https://cdn.example.com/lib.js", type: "script" },
        { url: "http://localhost:4173/app.js", type: "script" },
        { url: `${ORIGIN}/old`, type: "image" },
        { url: `${ORIGIN}/pixel`, type: "image" },
        { url: `${ORIGIN}/loop`, type: "fetch" },
        { url: `${ORIGIN}/old`, type: "fetch", method: "POST" },
        { url: `${ORIGIN}/assets/app.js`, type: "script" },
      ],
      webSockets: ["ws://127.0.0.1:4173/hmr", "wss://evil.example/socket"],
    });
    const result = await inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: fake.launch, hubPorts: [8011] });
    const { calls } = fake;
    assert.deepEqual(calls.contextOptions, { serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    assert.equal(calls.routeBeforePage, true, "the guard exists before the first page");
    assert.ok(calls.fetched.length > 0 && calls.fetched.every((u) => u.startsWith(`${ORIGIN}/`)), `only the local origin was ever fetched: ${calls.fetched.join(", ")}`);
    const blocked = result.network.blocked;
    const reasonOf = (prefix) => blocked.find((b) => b.url.startsWith(prefix))?.reason;
    assert.equal(reasonOf("https://cdn.example.com/"), "outside the approved local origin");
    assert.equal(reasonOf("http://localhost:4173/"), "outside the approved local origin", "another name for the same port is another origin");
    assert.equal(reasonOf("https://tracker.example/"), "redirect outside the approved local origin");
    assert.equal(reasonOf(`${ORIGIN}/loop`), "more than 5 redirects");
    assert.equal(reasonOf(`${ORIGIN}/new`), "redirect of a POST request is not followed");
    assert.equal(reasonOf("wss://evil.example/"), "outside the approved local origin");
    assert.equal(result.network.blockedCount, 6);
    assert.equal(result.network.allowedOrigin, ORIGIN);
    assert.deepEqual(result.network.redirects[0], { from: `${ORIGIN}/old`, to: `${ORIGIN}/new` });
    assert.ok(calls.fulfilled.includes(`${ORIGIN}/old`) && calls.fulfilled.includes(`${ORIGIN}/assets/app.js`), "allowed requests get the final response");
    assert.ok(calls.aborted.every((a) => a.code === "blockedbyclient"));
    assert.deepEqual(calls.sockets, [{ url: "ws://127.0.0.1:4173/hmr", connected: true }, { url: "wss://evil.example/socket", closed: 1008 }]);
    assert.equal(result.network.webSockets, "guarded");
    assert.equal(result.status, 200);
    assert.equal(result.finalUrl, `${ORIGIN}/`);
    assert.ok(fs.existsSync(path.join(evidenceDir, result.screenshot)));
    assert.ok(!JSON.stringify(result).includes("ghp_abcdefghijklmnop"), "blocked URLs and console text are redacted");
    assert.equal(calls.closed, true);
  } finally { fs.rmSync(evidenceDir, { recursive: true, force: true }); }
});

test("M02-RT-08 browser inspection (fake browser): a navigation redirected out or a page that ends elsewhere is refused without a screenshot; the URL is checked before any launch", async () => {
  const evidenceDir = tempDir("browser-evidence");
  try {
    const out = fakeBrowser({ server: localServer({ "/": { status: 302, headers: { location: "https://evil.example/landing" } } }) });
    await assert.rejects(inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: out.launch }), (e) => e.category === "policy" && /Navigation stopped by the local allowlist: https:\/\/evil\.example\/landing/.test(e.message));
    assert.deepEqual(out.calls.fetched, [`${ORIGIN}/`], "the external target was never fetched");
    assert.equal(out.calls.screenshots.length, 0);
    assert.equal(out.calls.closed, true, "the browser is closed on refusal");

    const left = fakeBrowser({ server: localServer({}), finalUrl: "https://evil.example/after-script", withWebSocketRoute: false });
    await assert.rejects(inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: left.launch }), (e) => e.category === "policy" && /left the approved origin/.test(e.message));
    assert.equal(left.calls.screenshots.length, 0, "no screenshot of a foreign page");
    const dataPage = fakeBrowser({ server: localServer({}), finalUrl: "data:text/html,<h1>x</h1>" });
    await assert.rejects(inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: dataPage.launch }), /left the approved origin/);

    const old = fakeBrowser({ server: localServer({}), withWebSocketRoute: false });
    assert.equal((await inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: old.launch })).network.webSockets, "not intercepted (this Playwright has no routeWebSocket)", "an unguarded channel is reported, not hidden");

    const never = fakeBrowser({ server: localServer({}) });
    await assert.rejects(inspectPage({ url: "https://example.com/", evidenceDir, launch: never.launch }), (e) => e.category === "policy");
    await assert.rejects(inspectPage({ url: "http://127.0.0.1:8011/", evidenceDir, launch: never.launch, hubPorts: [8011] }), /admin/);
    assert.equal(never.calls.launched, 0, "nothing is launched for a URL that is not allowed");
    assert.equal(fs.readdirSync(evidenceDir).length, 1, "only the one accepted inspection left a screenshot");
  } finally { fs.rmSync(evidenceDir, { recursive: true, force: true }); }
});

test("M02-RT-09 browser (review fixes): the network layer blocks what routes cannot see; a same-origin redirect of the page is a fresh navigation; a blocked iframe is not the page's failure", async () => {
  // Network layer: everything but the approved host:port goes to a dead proxy (loopback too), only localhost resolves,
  // no non-proxied UDP, no QUIC; and NOT Playwright's proxy option, which would also route the Hub's own route.fetch.
  let launched = null;
  await launcherFor({ chromium: { launch: async (options) => { launched = options; return {}; } } })(ORIGIN);
  assert.equal(launched.headless, true);
  assert.equal(launched.proxy, undefined, "no Playwright-level proxy (route.fetch must reach the local preview)");
  assert.ok(launched.args.includes("--proxy-server=http://127.0.0.1:9"));
  assert.ok(launched.args.includes("--proxy-bypass-list=<-loopback>;127.0.0.1:4173"), "only the approved origin bypasses the dead proxy");
  assert.ok(launched.args.some((a) => a.startsWith("--host-resolver-rules=MAP * ~NOTFOUND") && a.includes("EXCLUDE localhost") && a.includes("EXCLUDE ::1")));
  assert.ok(launched.args.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"));
  assert.ok(launched.args.includes("--disable-quic"));
  assert.ok(browserLaunchOptions("http://[::1]:5173").args.includes("--proxy-bypass-list=<-loopback>;[::1]:5173"));

  const evidenceDir = tempDir("browser-evidence");
  try {
    // "/" redirects to "/home": the page is navigated again to the checked target, so it commits at its real URL.
    const moved = fakeBrowser({ server: localServer({ "/": { status: 302, headers: { location: "/home" } } }) });
    const result = await inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: moved.launch });
    assert.deepEqual(moved.calls.gotos, [`${ORIGIN}/`, `${ORIGIN}/home`]);
    assert.equal(result.finalUrl, `${ORIGIN}/home`);
    assert.deepEqual(result.network.redirects[0], { from: `${ORIGIN}/`, to: `${ORIGIN}/home` });
    assert.ok(!moved.calls.fulfilled.includes(`${ORIGIN}/`), "the first URL is never served the redirected body");
    // A redirect loop of the page itself is bounded.
    const loop = fakeBrowser({ server: localServer({ "/": { status: 302, headers: { location: "/" } } }) });
    await assert.rejects(inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: loop.launch }), (e) => e.category === "policy" && /redirects of the page/.test(e.message));
    // An iframe navigating outside is blocked and recorded, but it is not reported as the page's own navigation failure.
    const framed = fakeBrowser({ server: localServer({}), requests: [{ url: "https://ads.example/frame", type: "document", navigation: true, iframe: true }] });
    const withFrame = await inspectPage({ url: `${ORIGIN}/`, evidenceDir, launch: framed.launch });
    assert.equal(withFrame.status, 200);
    const frameBlock = withFrame.network.blocked.find((b) => b.url.startsWith("https://ads.example/"));
    assert.deepEqual([frameBlock.navigation, frameBlock.mainFrame], [true, false]);
  } finally { fs.rmSync(evidenceDir, { recursive: true, force: true }); }
});
