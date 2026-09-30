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

/** One isolated inspection: navigate, collect console errors, take one screenshot. Requires Playwright. */
export async function inspectPage({ url, hubRoot, evidenceDir, timeoutMs = 20000 }) {
  const pw = loadPlaywright(hubRoot);
  if (!pw) throw new HubError("policy", "Playwright is not installed (NEEDS_INSTALL_APPROVAL)");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const id = newId("shot");
  const started = Date.now();
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleErrors.push({ type: msg.type(), text: redactText(msg.text()).slice(0, 500) }); });
    page.on("pageerror", (error) => consoleErrors.push({ type: "pageerror", text: redactText(String(error.message)).slice(0, 500) }));
    const response = await page.goto(url, { timeout: timeoutMs, waitUntil: "load" });
    const file = path.join(evidenceDir, `${id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const title = await page.title();
    await context.close();
    return { id, url, status: response?.status() ?? null, title: redactText(title).slice(0, 200), consoleErrors: consoleErrors.slice(0, 50),
      screenshot: `${id}.png`, durationMs: Date.now() - started, isolated: "fresh context, no profile, service workers blocked, downloads refused" };
  } finally {
    await browser.close();
  }
}
