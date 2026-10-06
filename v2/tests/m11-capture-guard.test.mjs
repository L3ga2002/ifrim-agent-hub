// Milestone 11 — the delivery capture guard (v2/server/delivery/capture-guard.mjs): Hub ports refused regardless of test mode, the
// synthetic hub-test project rule, the supervised preview target, the not-a-Hub probe against local servers on random loopback
// ports started here, and the page guard (fake pages for every refusal; one check with the REAL Playwright Chromium on a local page,
// SKIPPED_ENV when Playwright or Chromium is absent). No Hub, no model, no request to a Hub port (a refusal sends nothing).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkDemoOrigin } from "../server/media/capture.mjs";
import { browserLaunchOptions } from "../server/tools/browser-core.mjs";
import {
  LIVE_PORTS, HUB_HEADERS, PROBE_PATHS, SYNTHETIC_BANNER, livePorts, isLivePort, assertCaptureOrigin, syntheticProjectProblems, assertSyntheticProject,
  previewKeys, checkPreviewTarget, probeNotHub, textViolations, pageGuard,
} from "../server/delivery/capture-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");

const code = (fn, expected, category = null) => assert.throws(fn, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); if (category) assert.equal(e.category, category); return true; });
const rejectsCode = (promise, expected) => assert.rejects(promise, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); return true; });

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
  });
}
function closedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// LIVE_PORTS
// ---------------------------------------------------------------------------------------------------------------------------

test("M11-CG-01 LIVE_PORTS: the fixed Hub ports plus the configured port and every allowed origin's port — test mode changes nothing", () => {
  assert.deepEqual([...LIVE_PORTS].sort((a, b) => a - b), [3004, 3011, 8004, 8011, 8012]);
  // Three independent sources: the fixed list, config.port (45123 — in no allowed origin here) and the allowed origins (45124, 45999).
  const config = { testMode: true, port: 45123, allowedOrigins: new Set(["http://127.0.0.1:45124", "http://localhost:45124", "http://127.0.0.1:45999"]) };
  const ports = livePorts(config);
  for (const p of [8011, 8012, 3011, 3004, 8004, 45123, 45124, 45999]) assert.ok(ports.has(p), `port ${p}`);
  assert.equal(ports.size, 8);
  assert.equal(ports.has(4620), false);
  // The same set with test mode off: the flag is not consulted.
  assert.deepEqual([...livePorts({ ...config, testMode: false })].sort(), [...ports].sort());
  assert.equal(isLivePort("45123", config), true);
  assert.deepEqual([...livePorts({ allowedOrigins: ["http://localhost:46001", "not an origin"] })].includes(46001), true);
  assert.deepEqual([...livePorts()].sort((a, b) => a - b), [3004, 3011, 8004, 8011, 8012]);
});

test("M11-CG-02 a Hub port is refused as a capture origin even with testMode=true (the relaxation of media/capture.mjs is closed here)", () => {
  const config = { testMode: true, port: 45123, allowedOrigins: new Set(["http://127.0.0.1:45124", "http://localhost:45124", "http://localhost:45999"]) };
  // The Studio's own filter does not call the test Hub's port or its dev origins live in test mode — that is the gap.
  assert.equal(checkDemoOrigin("http://127.0.0.1:45123", { config }).liveHub, false);
  assert.equal(checkDemoOrigin("http://127.0.0.1:45124", { config }).liveHub, false);
  assert.equal(checkDemoOrigin("http://127.0.0.1:45999", { config }).liveHub, false);
  assert.equal(checkDemoOrigin("http://127.0.0.1:8012", { config }).liveHub, false);
  for (const port of [8011, 8012, 3011, 3004, 8004, 45123, 45124, 45999]) {
    for (const host of ["127.0.0.1", "localhost"]) code(() => assertCaptureOrigin(`http://${host}:${port}`, { config }), "CAPTURE_ORIGIN_LIVE", "policy");
  }
  // Without any configuration the fixed ports are still refused.
  for (const port of LIVE_PORTS) code(() => assertCaptureOrigin(`http://127.0.0.1:${port}`), "CAPTURE_ORIGIN_LIVE");
  assert.deepEqual(assertCaptureOrigin("http://127.0.0.1:4620/", { config }), { origin: "http://127.0.0.1:4620", host: "127.0.0.1", port: 4620 });
  assert.equal(assertCaptureOrigin("http://localhost:4620", { config }).origin, "http://localhost:4620");
});

test("M11-CG-03 the capture origin is http on 127.0.0.1 or localhost with an explicit port and nothing else", () => {
  code(() => assertCaptureOrigin("nu este un url"), "CAPTURE_ORIGIN_INVALID", "validation");
  code(() => assertCaptureOrigin(null), "CAPTURE_ORIGIN_INVALID");
  code(() => assertCaptureOrigin("https://127.0.0.1:4620"), "CAPTURE_ORIGIN_REFUSED", "policy");
  code(() => assertCaptureOrigin("file:///C:/demo/index.html"), "CAPTURE_ORIGIN_REFUSED");
  code(() => assertCaptureOrigin("http://192.168.1.10:4620"), "CAPTURE_ORIGIN_REFUSED");
  code(() => assertCaptureOrigin("http://example.com:4620"), "CAPTURE_ORIGIN_REFUSED");
  code(() => assertCaptureOrigin("http://[::1]:4620"), "CAPTURE_ORIGIN_REFUSED");
  code(() => assertCaptureOrigin("http://user:pw@127.0.0.1:4620"), "CAPTURE_ORIGIN_REFUSED");
  code(() => assertCaptureOrigin("http://127.0.0.1"), "CAPTURE_ORIGIN_INVALID");
  code(() => assertCaptureOrigin("http://127.0.0.1:80"), "CAPTURE_ORIGIN_INVALID"); // the default port is not explicit
  code(() => assertCaptureOrigin("http://127.0.0.1:4620/admin"), "CAPTURE_ORIGIN_INVALID");
  code(() => assertCaptureOrigin("http://127.0.0.1:4620/?x=1"), "CAPTURE_ORIGIN_INVALID");
  code(() => assertCaptureOrigin("http://127.0.0.1:4620/#/lega"), "CAPTURE_ORIGIN_INVALID");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Synthetic hub-test project
// ---------------------------------------------------------------------------------------------------------------------------

const ROOT = path.resolve(HUB_ROOT, "..", "m11-guard-projects-root"); // never created: the checks are lexical
const CONFIG = { projectsRoot: ROOT, hubRoot: path.join(ROOT, "Ifrim Agent Hub"), dataDir: path.join(path.resolve(HUB_ROOT, ".."), "m11-guard-data", "private"),
  backupDir: path.join(path.resolve(HUB_ROOT, ".."), "m11-guard-data", "backups", "v2"), workDir: path.join(path.resolve(HUB_ROOT, ".."), "m11-guard-data", "work") };
const PROJECT = { id: "prj_demo", name: "Demo Livrare — Detailing (programări)", slug: "demo-livrare-detailing-programari", source: "hub-test", path: path.join(ROOT, "ifrim-delivery-demo-detailing") };
const MARKER = { createdBy: "ifrim-agent-hub", purpose: "live-validation", name: "Demo Livrare", stack: "Node.js", fixture: "booking-demo", data: "synthetic", createdAt: "2026-10-05T10:00:00.000Z" };
const KNOWN = { config: CONFIG, knownFixtures: ["bug-demo", "service-request", "booking-demo"] };
const problemCodes = (project, marker, options = KNOWN) => syntheticProjectProblems(project, marker, options).map((p) => p.code);

test("M11-CG-04 assertSyntheticProject accepts only a hub-test project with a Hub marker, a known fixture and data: synthetic", () => {
  assert.deepEqual(assertSyntheticProject(PROJECT, MARKER, KNOWN), { ok: true, fixture: "booking-demo", path: path.resolve(PROJECT.path) });
  assert.deepEqual(problemCodes(PROJECT, MARKER), []);
  // A real project: refused with the MB1 sentence.
  code(() => assertSyntheticProject({ ...PROJECT, source: "registry" }, MARKER, KNOWN), "DELIVERY_PROJECT_NOT_TEST", "policy");
  assert.match(syntheticProjectProblems({ ...PROJECT, source: "registry" }, MARKER, KNOWN)[0].message, /captura unui proiect real cere decizia MB1 și o verificare a datelor — nu în M11/);
  // A marker without data: "synthetic" (every fixture created before M11).
  const { data, ...oldMarker } = MARKER;
  code(() => assertSyntheticProject(PROJECT, oldMarker, KNOWN), "DELIVERY_DATA_NOT_SYNTHETIC", "policy");
  code(() => assertSyntheticProject(PROJECT, { ...MARKER, data: "real" }, KNOWN), "DELIVERY_DATA_NOT_SYNTHETIC");
  code(() => assertSyntheticProject(PROJECT, null, KNOWN), "DELIVERY_MARKER_INVALID");
  code(() => assertSyntheticProject(PROJECT, { ...MARKER, createdBy: "altcineva" }, KNOWN), "DELIVERY_MARKER_INVALID");
  code(() => assertSyntheticProject(PROJECT, { ...MARKER, fixture: "necunoscut" }, KNOWN), "DELIVERY_FIXTURE_UNKNOWN");
  // By default only the registered factory demos are known.
  code(() => assertSyntheticProject(PROJECT, MARKER, { config: CONFIG }), "DELIVERY_FIXTURE_UNKNOWN");
  assert.deepEqual(problemCodes(PROJECT, { ...MARKER, fixture: "service-request" }, { config: CONFIG }), []);
  // Every problem is listed, not only the first.
  assert.deepEqual(problemCodes({ ...PROJECT, source: "registry" }, { ...MARKER, data: undefined }), ["DELIVERY_PROJECT_NOT_TEST", "DELIVERY_DATA_NOT_SYNTHETIC"]);
});

test("M11-CG-05 the project folder is a direct child of the projects root and never the Hub or a Hub data folder", () => {
  const at = (p) => ({ ...PROJECT, path: p });
  code(() => assertSyntheticProject(at(CONFIG.hubRoot), MARKER, KNOWN), "DELIVERY_PROJECT_PATH", "policy");
  // Windows paths are compared without case: another spelling of the Hub folder is still the Hub.
  if (process.platform === "win32") code(() => assertSyntheticProject(at(path.join(ROOT, "IFRIM AGENT HUB")), MARKER, KNOWN), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(at(path.join(CONFIG.hubRoot, "v2")), MARKER, KNOWN), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(at(path.join(ROOT, "alt-proiect", "demo")), MARKER, KNOWN), "DELIVERY_PROJECT_PATH"); // nested, not a direct child
  code(() => assertSyntheticProject(at(ROOT), MARKER, KNOWN), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(at(path.resolve(ROOT, "..", "in-afara", "demo")), MARKER, KNOWN), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(at("demo-relativ"), MARKER, KNOWN), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(PROJECT, MARKER, { knownFixtures: KNOWN.knownFixtures }), "DELIVERY_PROJECT_PATH"); // no projects root: cannot verify
  // A data folder itself, or a folder that holds one.
  const dataAsChild = { ...CONFIG, dataDir: path.join(ROOT, "hub-data") };
  code(() => assertSyntheticProject(at(path.join(ROOT, "hub-data")), MARKER, { ...KNOWN, config: dataAsChild }), "DELIVERY_PROJECT_PATH");
  code(() => assertSyntheticProject(PROJECT, MARKER, { ...KNOWN, config: { ...CONFIG, workDir: path.join(PROJECT.path, "work") } }), "DELIVERY_PROJECT_PATH");
  // The test harness layout (projects root = data folder) stays usable: the project is a sibling of the data sub-folders.
  const harness = { projectsRoot: ROOT, hubRoot: path.join(ROOT, "project"), dataDir: ROOT, backupDir: path.join(ROOT, "backups"), workDir: path.join(ROOT, "work") };
  assert.deepEqual(problemCodes(PROJECT, MARKER, { ...KNOWN, config: harness }), []);
  code(() => assertSyntheticProject(at(path.join(ROOT, "work")), MARKER, { ...KNOWN, config: harness }), "DELIVERY_PROJECT_PATH");
  // A link or junction resolved by the caller to another place.
  code(() => assertSyntheticProject(PROJECT, MARKER, { ...KNOWN, realPath: path.join(ROOT, "altundeva") }), "DELIVERY_PROJECT_PATH");
  assert.equal(assertSyntheticProject(PROJECT, MARKER, { ...KNOWN, realPath: PROJECT.path }).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Preview target
// ---------------------------------------------------------------------------------------------------------------------------

const DELIVERY = { id: "dlv_mux1abcd_0123456789", missionId: "mis_mux1abcd_aaaaaaaaaa", template: { preview: { origin: "http://127.0.0.1:4620", command: "node server.js" } }, startUrl: "http://127.0.0.1:4620/" };
const supervisorOf = (records) => { const calls = []; return { calls, get: (key) => { calls.push(key); return records[key] || null; } }; };

test("M11-CG-06 checkPreviewTarget: the confirmed origin, the bundle's start.url and a preview the Hub supervises — all three", () => {
  const keys = previewKeys(DELIVERY);
  assert.deepEqual(keys, { factory: "factory-preview-mis_mux1abcd_aaaaaaaaaa", delivery: "delivery-preview-dlv_mux1abcd_0123456789" });
  const factory = supervisorOf({ [keys.factory]: { key: keys.factory, pid: 4242, exited: false } });
  assert.deepEqual(checkPreviewTarget({ origin: "http://127.0.0.1:4620", delivery: DELIVERY, supervisor: factory, config: { port: 8011 } }), { origin: "http://127.0.0.1:4620", port: 4620, key: keys.factory, pid: 4242 });
  // After an acceptance stopped the factory preview, the delivery-scoped one counts.
  const scoped = supervisorOf({ [keys.factory]: { key: keys.factory, pid: 1, exited: true }, [keys.delivery]: { key: keys.delivery, pid: 777, exited: false } });
  assert.equal(checkPreviewTarget({ origin: "http://127.0.0.1:4620", delivery: DELIVERY, supervisor: scoped }).key, keys.delivery);
  // Refusals.
  const args = (over) => ({ origin: "http://127.0.0.1:4620", delivery: DELIVERY, supervisor: factory, ...over });
  code(() => checkPreviewTarget(args({ origin: "http://127.0.0.1:4621" })), "CAPTURE_ORIGIN_MISMATCH", "policy");
  code(() => checkPreviewTarget(args({ origin: "http://localhost:4620" })), "CAPTURE_ORIGIN_MISMATCH"); // exactly the template origin
  code(() => checkPreviewTarget(args({ delivery: { ...DELIVERY, startUrl: "http://127.0.0.1:4700/" } })), "CAPTURE_ORIGIN_MISMATCH");
  code(() => checkPreviewTarget(args({ delivery: { ...DELIVERY, startUrl: null } })), "CAPTURE_ORIGIN_MISMATCH");
  code(() => checkPreviewTarget(args({ delivery: { ...DELIVERY, template: {} } })), "CAPTURE_ORIGIN_MISMATCH");
  code(() => checkPreviewTarget(args({ supervisor: supervisorOf({}) })), "CAPTURE_PREVIEW_NOT_SUPERVISED", "policy");
  code(() => checkPreviewTarget(args({ supervisor: supervisorOf({ [keys.factory]: { pid: 1, exited: true } }) })), "CAPTURE_PREVIEW_NOT_SUPERVISED");
  code(() => checkPreviewTarget(args({ supervisor: null })), "CAPTURE_PREVIEW_NOT_SUPERVISED");
  code(() => checkPreviewTarget(args({ supervisor: { get: () => { throw new Error("x"); } } })), "CAPTURE_PREVIEW_NOT_SUPERVISED");
  // Another mission's preview is not this delivery's.
  code(() => checkPreviewTarget(args({ supervisor: supervisorOf({ "factory-preview-mis_other_bbbbbbbbbb": { pid: 9, exited: false } }) })), "CAPTURE_PREVIEW_NOT_SUPERVISED");
  // A Hub port stays refused even when a template names it and something is supervised there (test mode included).
  const live = { ...DELIVERY, template: { preview: { origin: "http://127.0.0.1:45123" } }, startUrl: "http://127.0.0.1:45123/" };
  code(() => checkPreviewTarget({ origin: "http://127.0.0.1:45123", delivery: live, supervisor: factory, config: { testMode: true, port: 45123 } }), "CAPTURE_ORIGIN_LIVE");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Not a Hub
// ---------------------------------------------------------------------------------------------------------------------------

test("M11-CG-07 probeNotHub: a plain preview passes; a server answering with X-Hub-Version or X-Hub-Contract is refused", async () => {
  assert.deepEqual([...HUB_HEADERS], ["x-hub-version", "x-hub-contract"]);
  assert.deepEqual([...PROBE_PATHS], ["/", "/api/session"]);
  const seen = [];
  const preview = await serve((req, res) => { seen.push(`${req.method} ${req.url}`); if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>Demo</title>"); } else { res.writeHead(404); res.end("nu"); } });
  // Any Hub sets both headers on /api/* (http/server.mjs), also on a 404 or a 401.
  const hub = await serve((req, res) => { if (req.url.startsWith("/api/")) { res.setHeader("X-Hub-Version", "2.13.0-m11"); res.setHeader("X-Hub-Contract", "13"); res.writeHead(401); res.end("{}"); } else { res.writeHead(200); res.end("ui"); } });
  const contractOnly = await serve((req, res) => { if (req.url.startsWith("/api/")) res.setHeader("X-Hub-Contract", "13"); res.writeHead(200); res.end("x"); });
  const onRoot = await serve((req, res) => { res.setHeader("x-hub-version", "0"); res.writeHead(200); res.end("x"); });
  try {
    const ok = await probeNotHub(preview.origin, { config: { testMode: true, port: 45123 } });
    assert.deepEqual(ok, { ok: true, origin: preview.origin, checked: [{ path: "/", status: 200 }, { path: "/api/session", status: 404 }] });
    assert.deepEqual(seen, ["GET /", "GET /api/session"]);
    await rejectsCode(probeNotHub(hub.origin), "CAPTURE_TARGET_IS_HUB");
    await rejectsCode(probeNotHub(contractOnly.origin), "CAPTURE_TARGET_IS_HUB");
    await rejectsCode(probeNotHub(onRoot.origin), "CAPTURE_TARGET_IS_HUB");
    await assert.rejects(probeNotHub(hub.origin), (e) => e.category === "policy" && /nu filmează niciun Hub/.test(e.message));
  } finally { await Promise.all([preview, hub, contractOnly, onRoot].map((s) => s.close())); }
});

test("M11-CG-08 probeNotHub fails closed: no answer, a redirect to another origin, a Hub port (no request is sent at all)", async () => {
  const port = await closedPort();
  await rejectsCode(probeNotHub(`http://127.0.0.1:${port}`, { timeoutMs: 1500 }), "CAPTURE_TARGET_UNREACHABLE");
  const away = await serve((req, res) => { res.writeHead(307, { location: "http://localhost:59999/" }); res.end(); });
  const within = await serve((req, res) => { if (req.url === "/") { res.writeHead(302, { location: "/start" }); res.end(); } else { res.writeHead(200); res.end("ok"); } });
  try {
    await rejectsCode(probeNotHub(away.origin), "CAPTURE_TARGET_REDIRECTS");
    // A same-origin redirect is not followed and is not a refusal.
    assert.deepEqual((await probeNotHub(within.origin)).checked, [{ path: "/", status: 302 }, { path: "/api/session", status: 200 }]);
  } finally { await Promise.all([away.close(), within.close()]); }
  // Hub ports: refused BEFORE any request (the injected fetch is never called) — also the test Hub's own port in test mode.
  let calls = 0;
  const fetchSpy = async () => { calls += 1; return { status: 200, headers: new Headers() }; };
  for (const origin of ["http://127.0.0.1:8011", "http://localhost:3011", "http://127.0.0.1:8012", "http://127.0.0.1:45123"]) {
    await rejectsCode(probeNotHub(origin, { fetch: fetchSpy, config: { testMode: true, port: 45123 } }), "CAPTURE_ORIGIN_LIVE");
  }
  await rejectsCode(probeNotHub("https://127.0.0.1:4620", { fetch: fetchSpy }), "CAPTURE_ORIGIN_REFUSED");
  assert.equal(calls, 0);
  // The injected fetch is what is used: both paths, GET, redirects not followed, no credentials.
  const requests = [];
  const fake = async (url, init) => { requests.push({ url, method: init.method, redirect: init.redirect, credentials: init.credentials }); return { status: 204, headers: { "Content-Type": "text/plain" } }; };
  assert.deepEqual((await probeNotHub("http://127.0.0.1:4620", { fetch: fake })).checked, [{ path: "/", status: 204 }, { path: "/api/session", status: 204 }]);
  assert.deepEqual(requests, [{ url: "http://127.0.0.1:4620/", method: "GET", redirect: "manual", credentials: "omit" }, { url: "http://127.0.0.1:4620/api/session", method: "GET", redirect: "manual", credentials: "omit" }]);
  await rejectsCode(probeNotHub("http://127.0.0.1:4620", { fetch: async () => ({ status: 200, headers: { "X-Hub-Version": "2.12.1-m10.2" } }) }), "CAPTURE_TARGET_IS_HUB");
  await rejectsCode(probeNotHub("http://127.0.0.1:4620", { fetch: async () => { throw new Error("ECONNREFUSED"); } }), "CAPTURE_TARGET_UNREACHABLE");
  await rejectsCode(probeNotHub("http://127.0.0.1:4620", { fetch: null }), "CAPTURE_PROBE_UNAVAILABLE");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Page guard
// ---------------------------------------------------------------------------------------------------------------------------

test("M11-CG-09 textViolations: secrets, absolute user paths and foreign e-mails — and nothing else", () => {
  assert.deepEqual(textViolations("Programări detailing — demo\nClient Demo A · Autoturism test\nana.test@example.ro, contact@demo.test, x@sub.example.com"), []);
  assert.deepEqual(textViolations(""), []);
  assert.deepEqual(textViolations(null), []);
  assert.deepEqual(textViolations("cheie: sk-ant-abcdefghijklmnop1234").map((v) => v.code), ["SECRET_LIKE"]);
  assert.deepEqual(textViolations("password = hunter2hunter2").map((v) => v.code), ["SECRET_LIKE"]);
  assert.deepEqual(textViolations("Fișier: C:\\Users\\mihai\\Desktop\\clienti.xlsx").map((v) => v.code), ["USER_PATH"]);
  assert.deepEqual(textViolations("log la /home/mihai/app/data.db și /Users/ana/x").map((v) => [v.code, v.count]), [["USER_PATH", 2]]);
  assert.deepEqual(textViolations("scrie la ion.popescu@gmail.com sau la ana@firma.ro").map((v) => [v.code, v.count]), [["FOREIGN_EMAIL", 2]]);
  // A URL path that merely contains "home" is not a user path.
  assert.deepEqual(textViolations("vezi http://127.0.0.1:4620/api/home/slots"), []);
});

const SNAP = { bannerFound: true, bannerVisible: true, bannerText: SYNTHETIC_BANNER, text: "Programări detailing — demo\nDate sintetice · demo local\nClient Demo Prezentare", truncated: false };
const fakePage = (snapshot) => { const calls = []; return { calls, evaluate: async (fn, arg) => { calls.push({ fn: typeof fn, arg }); if (snapshot instanceof Error) throw snapshot; return snapshot; } }; };
async function refusedWith(snapshot, expected) {
  const guard = pageGuard({ bannerSelector: "[data-demo-banner]" });
  await assert.rejects(guard(fakePage(snapshot)), (e) => {
    assert.equal(e.code, "CAPTURE_PRIVACY_REFUSED", e.message);
    assert.equal(e.category, "policy");
    assert.deepEqual(e.details.violations.map((v) => v.code), expected);
    return true;
  });
}

test("M11-CG-10 pageGuard passes a synthetic page and refuses a missing banner, a secret, an absolute user path and a foreign e-mail", async () => {
  const guard = pageGuard({ bannerSelector: "[data-demo-banner]" });
  const page = fakePage(SNAP);
  assert.deepEqual(await guard(page), { ok: true, chars: SNAP.text.length });
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].fn, "function"); // a fixed function is evaluated, never a string of page code
  assert.equal(page.calls[0].arg.bannerSelector, "[data-demo-banner]");
  await refusedWith({ ...SNAP, bannerFound: false, bannerVisible: false, bannerText: "" }, ["BANNER_MISSING"]);
  await refusedWith({ ...SNAP, bannerVisible: false }, ["BANNER_MISSING"]); // present but hidden
  await refusedWith({ ...SNAP, bannerText: "Date reale · producție" }, ["BANNER_TEXT"]);
  await refusedWith({ ...SNAP, text: `${SNAP.text}\ntoken=abcd1234efgh5678` }, ["SECRET_LIKE"]);
  await refusedWith({ ...SNAP, text: `${SNAP.text}\nC:\\Users\\mihai\\OneDrive\\clienti` }, ["USER_PATH"]);
  await refusedWith({ ...SNAP, text: `${SNAP.text}\n/home/mihai/.config` }, ["USER_PATH"]);
  await refusedWith({ ...SNAP, text: `${SNAP.text}\nclient.real@gmail.com` }, ["FOREIGN_EMAIL"]);
  await refusedWith({ ...SNAP, truncated: true }, ["PAGE_TOO_LARGE"]);
  await refusedWith(new Error("Execution context was destroyed"), ["PAGE_UNREADABLE"]);
  await refusedWith(null, ["PAGE_UNREADABLE"]);
  await refusedWith({ ...SNAP, bannerVisible: false, text: "x@gmail.com C:\\Users\\a\\b" }, ["BANNER_MISSING", "USER_PATH", "FOREIGN_EMAIL"]);
  // The refusal names the kind of problem, never the text that caused it.
  await assert.rejects(guard(fakePage({ ...SNAP, text: "secretul este client.real@gmail.com" })), (e) => !/client\.real|gmail/.test(e.message) && !/client\.real|gmail/.test(JSON.stringify(e.details)) && /Niciun cadru nu se păstrează/.test(e.message));
  // A banner without diacritics still counts; another expected text can be given.
  assert.equal((await guard(fakePage({ ...SNAP, bannerText: "DATE SINTETICE - demo" }))).ok, true);
  await assert.rejects(pageGuard({ bannerSelector: "#b", bannerText: /fictiv/i })(fakePage(SNAP)), (e) => e.details.violations[0].code === "BANNER_TEXT");
  // The selector is validated when the guard is built.
  for (const bad of [undefined, "", "a{b}", "x;y", "<script>", "a".repeat(201)]) code(() => pageGuard({ bannerSelector: bad }), "CAPTURE_BANNER_SELECTOR_INVALID", "validation");
  code(() => pageGuard({ bannerSelector: "#b", bannerText: "sintetic" }), "CAPTURE_BANNER_TEXT_INVALID");
});

let chromiumCheck = null;
function chromiumAvailable() {
  if (chromiumCheck) return chromiumCheck;
  chromiumCheck = (async () => {
    let pw;
    try { pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); } catch { return { reason: "Playwright is not installed" }; }
    try { const b = await pw.chromium.launch(browserLaunchOptions("http://127.0.0.1:9")); await b.close(); return { pw }; }
    catch (error) { return { reason: `Chromium cannot start (${String(error.message).split("\n")[0].slice(0, 120)})` }; }
  })();
  return chromiumCheck;
}

const page = (body) => `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Programări detailing — demo</title></head><body>${body}</body></html>`;
test("M11-CG-11 pageGuard in the real Chromium: the banner's rendered state and the values of visible fields are what is checked", async (t) => {
  const env = await chromiumAvailable();
  if (env.reason) { t.skip(`SKIPPED_ENV: ${env.reason}`); return; }
  const pages = {
    "/": page(`<p data-demo-banner>Date sintetice · demo local</p><h1>Alege o oră</h1><input name="name" value="Client Demo Prezentare"><input type="password" value="token=abcd1234efgh5678"><p>contact: ana.test@example.ro</p>`),
    "/hidden": page(`<p data-demo-banner style="display:none">Date sintetice · demo local</p><h1>Alege o oră</h1>`),
    "/none": page(`<h1>Alege o oră</h1>`),
    "/field": page(`<p data-demo-banner>Date sintetice · demo local</p><input name="email" value="client.real@gmail.com">`),
    "/path": page(`<p data-demo-banner>Date sintetice · demo local</p><pre>Eroare la C:\\Users\\mihai\\demo\\server.js</pre>`),
  };
  const server = await serve((req, res) => { const html = pages[req.url]; res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }); res.end(html || "nu"); });
  const browser = await env.pw.chromium.launch(browserLaunchOptions(server.origin));
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    const guard = pageGuard({ bannerSelector: "[data-demo-banner]" });
    const violationsAt = async (route) => {
      await tab.goto(`${server.origin}${route}`, { waitUntil: "load" });
      try { await guard(tab); return []; } catch (e) { assert.equal(e.code, "CAPTURE_PRIVACY_REFUSED", e.message); return e.details.violations.map((v) => v.code); }
    };
    // The password field's value is not read (the capture masks it); the visible field's value is.
    assert.deepEqual(await violationsAt("/"), []);
    assert.deepEqual(await violationsAt("/hidden"), ["BANNER_MISSING"]);
    assert.deepEqual(await violationsAt("/none"), ["BANNER_MISSING"]);
    assert.deepEqual(await violationsAt("/field"), ["FOREIGN_EMAIL"]);
    assert.deepEqual(await violationsAt("/path"), ["USER_PATH"]);
  } finally { await browser.close().catch(() => {}); await server.close(); }
});
