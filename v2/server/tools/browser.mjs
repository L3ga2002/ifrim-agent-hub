import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Browser Workspace (Milestone 02 §16): a controlled, isolated browser for local previews.
 *
 * - Only http(s) URLs on 127.0.0.1 / localhost / [::1] with an explicit port are accepted, never the Hub's own
 *   port (the admin session is not a test target), never URLs with credentials.
 * - Each check uses a fresh, empty browser context (no profile, no stored cookies, service workers blocked,
 *   downloads refused). The owner's personal browser and profile are never used.
 * - Only the approved local origin is reachable from the page: every request goes through a context route allowlist
 *   (redirect hops are fetched and checked by the Hub, because Playwright never shows them to a route), WebSockets through
 *   routeWebSocket when the installed Playwright has it, and a page that ends up on another origin is refused without a
 *   screenshot. What was blocked is part of the result.
 * - Under the routes, Chromium itself can reach only the approved origin: every other connection, loopback included, goes
 *   to a dead proxy, host names other than localhost do not resolve, and UDP/QUIC are off (browserLaunchOptions). Shared
 *   workers and sockets opened inside workers are not seen by Playwright routes (review 2026-09-30); this layer stops
 *   them. The proxy is a Chromium switch, not Playwright's `proxy` option, so the Hub's own route.fetch (Node side) still
 *   reaches the local preview. Not run live: Playwright is not installed (NEEDS_INSTALL_APPROVAL).
 * - Playwright is NOT a dependency of this repository. Until the owner approves installing it, the status is
 *   NEEDS_INSTALL_APPROVAL and nothing runs; no E2E result or screenshot is ever reported without a real run.
 */
export const BROWSER_APPROVAL_REQUEST = Object.freeze({
  what: "Pachetul npm `playwright` ca devDependency a proiectului (nu global).",
  why: "Browser Workspace: context izolat pentru preview-ul local, capturi de ecran și erori de consolă.",
  browsers: "Fără descărcare nouă dacă versiunea se potrivește cu Chromium deja prezent în %LOCALAPPDATA%\\ms-playwright; altfel doar `chromium` (headless shell), nu toate browserele.",
  install: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --save-dev playwright@<versiunea potrivită revizei Chromium existente>",
  license: "Apache-2.0",
  storage: "node_modules al proiectului; browserele rămân în %LOCALAPPDATA%\\ms-playwright (existent).",
  effects: "Rulează un browser headless local doar pe URL-uri locale aprobate; fără conturi, fără profil personal.",
});

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Validates a browser target: local host, explicit port, no credentials, not the Hub itself. */
export function validateBrowserUrl(raw, { hubPorts = [] } = {}) {
  let url;
  try { url = new URL(String(raw)); } catch { throw new HubError("validation", "Invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new HubError("policy", "Only http(s) URLs");
  if (!LOCAL_HOSTS.has(url.hostname)) throw new HubError("policy", "Only local previews (127.0.0.1, localhost) without external approval");
  if (url.username || url.password) throw new HubError("policy", "URLs with credentials are refused");
  if (!url.port) throw new HubError("validation", "An explicit port is required");
  if (hubPorts.map(String).includes(url.port)) throw new HubError("policy", "The Hub's own admin interface is not a browser test target");
  return url.toString();
}

function loadPlaywright(root) {
  try { return createRequire(path.join(root, "package.json"))("playwright"); } catch { return null; }
}

function cachedChromium() {
  const dir = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  try { return fs.readdirSync(dir).filter((n) => /^chromium(?:_headless_shell)?-\d+$/.test(n)).sort(); } catch { return []; }
}

export function browserStatus({ hubRoot }) {
  const pw = loadPlaywright(hubRoot);
  const cached = cachedChromium();
  if (!pw) {
    return { status: "NEEDS_INSTALL_APPROVAL", installed: false, cachedBrowsers: cached,
      reason: "Playwright nu este instalat în proiect; Browser Workspace nu rulează nimic până la aprobarea instalării.", approvalRequest: BROWSER_APPROVAL_REQUEST };
  }
  let version = null;
  try { version = createRequire(path.join(hubRoot, "package.json"))("playwright/package.json").version; } catch { /* unknown */ }
  return { status: "available", installed: true, version, cachedBrowsers: cached };
}

/** ws(s) is judged as the http(s) origin it upgrades from; anything without a network origin is not in this map. */
const NETWORK_SCHEMES = Object.freeze({ "http:": "http:", "https:": "https:", "ws:": "http:", "wss:": "https:" });
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_BLOCKED_RECORDED = 50;
const MAX_MAIN_REDIRECTS = 5;

/**
 * Whether a URL the inspected page asks for may be reached (pure, so it is tested without Playwright). Only the approved
 * local origin is: ws(s) counts as its http(s) origin, a blob: URL carries its creator's origin, a data: URL never leaves
 * the page (inline images and fonts). Other hosts, ports or schemes (file:, chrome:, ftp:…) and URLs with credentials are
 * refused with a short reason that ends up in the result.
 */
export function browserRequestVerdict(raw, allowedOrigin) {
  let url;
  try { url = new URL(String(raw)); } catch { return { allowed: false, reason: "invalid URL" }; }
  if (url.protocol === "data:") return { allowed: true };
  if (url.protocol === "blob:") return url.origin === allowedOrigin ? { allowed: true } : { allowed: false, reason: "blob from another origin" };
  const scheme = NETWORK_SCHEMES[url.protocol];
  if (!scheme) return { allowed: false, reason: `scheme ${url.protocol} not allowed` };
  if (url.username || url.password) return { allowed: false, reason: "credentials in URL" };
  return `${scheme}//${url.host}` === allowedOrigin ? { allowed: true } : { allowed: false, reason: "outside the approved local origin" };
}

/** True only for an http(s) URL on exactly the approved origin (a redirect hop or the final page must be a real local page). */
const onOrigin = (raw, allowedOrigin) => {
  try { const url = new URL(String(raw)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === allowedOrigin; }
  catch { return false; }
};

/**
 * The network guard of one inspection: a context.route handler and a routeWebSocket handler that let through only the
 * approved origin and remember what they refused (redacted, capped). Playwright auto-continues redirect hops without
 * calling the route, so an allowed request is fetched here with maxRedirects 0: each same-origin hop is followed by the Hub
 * (GET/HEAD only), a hop elsewhere aborts the request, and only the final response is handed to the browser.
 */
export function createRequestGuard({ allowedOrigin, fetchTimeoutMs = 20000, maxRedirects = 5 }) {
  const blocked = [];
  const redirects = [];
  let blockedCount = 0;
  let mainRedirect = null; // a checked same-origin redirect of the navigation inspectPage started, re-navigated by it
  let expected = null; // the URL inspectPage's page.goto is navigating to right now
  let navMark = 0; // blocked entries before this index belong to earlier navigations
  // Redacted before it is shortened, so a token cut in half never survives; bounded before redaction for huge data: URLs.
  const clip = (url) => redactText(String(url).slice(0, 2000)).slice(0, 300);
  const note = (url, reason, type, navigation, mainFrame = navigation, forGoto = false) => {
    blockedCount += 1;
    if (blocked.length < MAX_BLOCKED_RECORDED) blocked.push({ url: clip(url), reason, type, navigation, mainFrame, forGoto });
  };
  // The route may already be settled (context closing, page gone); that is never an error of the inspection.
  const settle = (fn) => Promise.resolve().then(fn).catch(() => {});
  const read = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  async function route(r) {
    const request = r.request();
    const first = request.url();
    const type = read(() => request.resourceType(), "other");
    const navigation = read(() => request.isNavigationRequest(), false);
    // iframes, popups and script navigations navigate too; only the request of the page.goto in flight decides how that
    // navigation failed or is redirected (a popup to the same URL has no frame yet and is not the goto's request).
    const mainFrame = navigation && read(() => request.frame().parentFrame() === null, false);
    const forGoto = navigation && expected !== null && first === expected && read(() => request.frame().parentFrame() === null, true);
    const verdict = browserRequestVerdict(first, allowedOrigin);
    if (!verdict.allowed) { note(first, verdict.reason, type, navigation, mainFrame, forGoto); return settle(() => r.abort("blockedbyclient")); }
    const method = String(read(() => request.method(), "GET")).toUpperCase();
    let current = first;
    try {
      for (let hop = 0; ; hop += 1) {
        const response = await r.fetch({ url: current, maxRedirects: 0, timeout: fetchTimeoutMs });
        const location = REDIRECT_STATUSES.has(response.status()) ? response.headers().location : "";
        if (!location) return await r.fulfill({ response });
        let next;
        try { next = new URL(location, current).href; } catch { next = String(location); }
        const refusal = !onOrigin(next, allowedOrigin) ? `redirect ${browserRequestVerdict(next, allowedOrigin).reason || "to a non-http target"}`
          : !["GET", "HEAD"].includes(method) ? `redirect of a ${method} request is not followed`
            : hop >= maxRedirects ? `more than ${maxRedirects} redirects` : "";
        if (refusal) { note(next, refusal, type, navigation, mainFrame, forGoto); return await r.abort("blockedbyclient"); }
        if (redirects.length < MAX_BLOCKED_RECORDED) redirects.push({ from: clip(current), to: clip(next) });
        // The main document must commit at its real URL (relative links resolve against it): instead of serving the final
        // body under the first URL, the checked target is handed back and inspectPage navigates to it afresh.
        if (forGoto) { mainRedirect = next; return await r.abort("aborted"); }
        current = next;
      }
    } catch {
      return settle(() => r.abort("failed"));
    }
  }

  function webSocket(ws) {
    const url = read(() => ws.url(), "");
    const verdict = browserRequestVerdict(url, allowedOrigin);
    try {
      if (verdict.allowed && /^wss?:/i.test(url)) { ws.connectToServer(); return; }
      note(url, verdict.reason || "not a WebSocket URL", "websocket", false);
      ws.close({ code: 1008, reason: "Blocked by the Hub local allowlist" });
    } catch { /* the page closed the socket first */ }
  }

  const summary = () => ({ allowedOrigin, blockedCount, blocked: blocked.slice(), redirects: redirects.slice() });
  const takeMainRedirect = () => { const next = mainRedirect; mainRedirect = null; return next; };
  /** Called right before each page.goto: what follows belongs to this navigation only. */
  const expectNavigation = (url) => { expected = String(url); mainRedirect = null; navMark = blocked.length; };
  return { route, webSocket, summary, takeMainRedirect, expectNavigation, blockedNavigation: () => blocked.slice(navMark).find((b) => b.forGoto) || null };
}

/**
 * Network-layer isolation for one inspection (below the Playwright routes), built for the approved origin. Chromium sends
 * every connection to a proxy that does not exist, loopback included (`<-loopback>` removes Chromium's implicit loopback
 * bypass), except the exact approved host:port; it resolves no host name except localhost (IPv4 and IPv6); it drops UDP
 * that would not go through the proxy (WebRTC) and never uses QUIC. Chromium applies the last copy of a switch and user
 * args come after Playwright's own.
 */
export function browserLaunchOptions(allowedOrigin) {
  const target = new URL(allowedOrigin);
  return {
    headless: true,
    args: [
      "--proxy-server=http://127.0.0.1:9",
      `--proxy-bypass-list=<-loopback>;${target.hostname}:${target.port}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1, EXCLUDE [::1]",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-quic",
    ],
  };
}

/** A launcher for a loaded Playwright module (exported so the launch options are tested without installing Playwright). */
export const launcherFor = (pw) => (allowedOrigin) => pw.chromium.launch(browserLaunchOptions(allowedOrigin));

/** The default browser: Playwright's headless Chromium from the project, or the install-approval refusal. */
function playwrightLauncher(hubRoot) {
  const pw = loadPlaywright(hubRoot);
  if (!pw) throw new HubError("policy", "Playwright is not installed (NEEDS_INSTALL_APPROVAL)");
  return launcherFor(pw);
}

/**
 * One isolated inspection: navigate, collect console errors, take one screenshot. Requires Playwright unless `launch` is
 * given (tests inject a fake browser with the same newContext/route/newPage surface). The URL is validated again here, the
 * guard is installed before the first page exists (popups and the first navigation included), and a page whose final URL
 * is not on the approved origin is refused before any screenshot is written.
 */
export async function inspectPage({ url, hubRoot, evidenceDir, timeoutMs = 20000, hubPorts = [], launch = null }) {
  const target = validateBrowserUrl(url, { hubPorts });
  const allowedOrigin = new URL(target).origin;
  const start = launch || playwrightLauncher(hubRoot);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const id = newId("shot");
  const started = Date.now();
  const guard = createRequestGuard({ allowedOrigin, fetchTimeoutMs: timeoutMs });
  const browser = await start(allowedOrigin);
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    await context.route(() => true, guard.route);
    const webSockets = typeof context.routeWebSocket === "function";
    if (webSockets) await context.routeWebSocket(() => true, guard.webSocket);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleErrors.push({ type: msg.type(), text: redactText(msg.text()).slice(0, 500) }); });
    page.on("pageerror", (error) => consoleErrors.push({ type: "pageerror", text: redactText(String(error.message)).slice(0, 500) }));
    let response;
    // Same-origin redirects of the main document become fresh navigations (checked by the guard), bounded.
    for (let goal = target, hops = 0; ;) {
      guard.expectNavigation(goal);
      try { response = await page.goto(goal, { timeout: timeoutMs, waitUntil: "load" }); break; }
      catch (error) {
        const next = guard.takeMainRedirect();
        if (next && hops < MAX_MAIN_REDIRECTS) { hops += 1; goal = next; continue; }
        if (next) throw new HubError("policy", `More than ${MAX_MAIN_REDIRECTS} redirects of the page itself`);
        const stopped = guard.blockedNavigation();
        if (stopped) throw new HubError("policy", `Navigation stopped by the local allowlist: ${stopped.url} (${stopped.reason})`);
        throw error;
      }
    }
    const finalUrl = page.url();
    if (!onOrigin(finalUrl, allowedOrigin)) {
      throw new HubError("policy", `The page left the approved origin ${allowedOrigin} (now ${redactText(String(finalUrl)).slice(0, 200)}); no screenshot was taken`);
    }
    const file = path.join(evidenceDir, `${id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const title = await page.title();
    await context.close();
    return { id, url: target, finalUrl: redactText(finalUrl).slice(0, 300), status: response?.status() ?? null, title: redactText(title).slice(0, 200),
      consoleErrors: consoleErrors.slice(0, 50), screenshot: `${id}.png`, durationMs: Date.now() - started,
      network: { ...guard.summary(), webSockets: webSockets ? "guarded" : "not intercepted (this Playwright has no routeWebSocket)",
        networkLayer: launch ? "injected browser (test)" : "dead proxy for everything but the approved host:port, DNS only for localhost, no non-proxied UDP, no QUIC" },
      isolated: "fresh context, no profile, service workers blocked, downloads refused, only the approved local origin reachable" };
  } finally {
    await browser.close();
  }
}
