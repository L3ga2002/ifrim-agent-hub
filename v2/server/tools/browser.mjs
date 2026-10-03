import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { redactText } from "../security/redact.mjs";
import { createRequestGuard as coreRequestGuard, onOrigin, MAX_MAIN_REDIRECTS, validateE2ESteps, runE2ESteps, browserLaunchOptions } from "./browser-core.mjs";

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
 *   reaches the local preview.
 * - Playwright 1.61.0 is a devDependency since 2026-10-01 (owner-approved, no browser download: it uses the cached Chromium
 *   1228). Without it the status is NEEDS_INSTALL_APPROVAL and nothing runs; no E2E result or screenshot is ever reported
 *   without a real run.
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

/**
 * The request guard, the launch options, the step validator and the E2E loop live in browser-core.mjs (M07): the same file
 * runs in the preview host inside ifrim-runner, without Hub imports. Here they are bound to the Hub's redaction.
 */
export { browserRequestVerdict, browserLaunchOptions, E2E_STEP_KINDS, E2E_MAX_STEPS, E2E_RUN_TOKEN, validateE2ESteps, measureChromiumSandbox } from "./browser-core.mjs";
export const createRequestGuard = (options) => coreRequestGuard({ redact: redactText, ...options });

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

/**
 * Runs E2E steps against a local preview in the same isolated browser as inspectPage (fresh context, request guard, dead
 * proxy for anything but the preview origin, Chromium OS sandbox). Returns { status: PASS|FAIL|INTERRUPTED, steps: [{ i,
 * kind, ok, ms, error? }], consoleErrors, screenshot, network, durationMs }. Stops at the first failed step; a screenshot is
 * taken at the end or at the failure. A goto follows same-origin redirects of the page itself (bounded, checked by the
 * guard) and fails on an HTTP error status. Every step is bounded by `stepTimeoutMs`. `signal` (Stop / Pause of the
 * mission) closes the browser at once and the result is INTERRUPTED, never a product failure. A failure to start the
 * browser throws (an infrastructure problem, not a failed step). `launch` is injectable for tests. The loop itself is
 * runE2ESteps (browser-core.mjs), shared with the preview host in ifrim-runner.
 */
export async function runE2E({ url, steps, hubRoot, evidenceDir, hubPorts = [], stepTimeoutMs = 10000, launch = null, signal = null }) {
  const base = validateBrowserUrl(url, { hubPorts });
  const problems = validateE2ESteps(steps);
  if (problems.length) throw new HubError("validation", `Pași E2E invalizi: ${problems.join("; ")}`);
  if (signal?.aborted) throw new HubError("conflict", "E2E oprit înainte de pornire");
  const start = launch || playwrightLauncher(hubRoot);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const id = newId("e2e");
  const file = path.join(evidenceDir, `${id}.png`);
  return runE2ESteps({ base, steps, launch: start, id, stepTimeoutMs, signal, redact: redactText,
    screenshot: async (page) => { await page.screenshot({ path: file, fullPage: false, timeout: stepTimeoutMs }).catch(() => {}); return fs.existsSync(file) ? `${id}.png` : null; } });
}
