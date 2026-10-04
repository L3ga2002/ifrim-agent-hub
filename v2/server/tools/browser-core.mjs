// ifrim-env:browser-core v1 — the E2E core of the Browser Workspace without any Hub import (M07). The Hub uses it through
// tools/browser.mjs (Windows, the project's Playwright); the preview host runs the SAME file inside the local-only namespace
// of ifrim-runner (scripts/preview-host.mjs, Playwright from /pw/pkg). Only node: built-ins may be imported here, because the
// file is copied verbatim next to the host. Redaction and file output are injected by the caller.

/** ws(s) is judged as the http(s) origin it upgrades from; anything without a network origin is not in this map. */
const NETWORK_SCHEMES = Object.freeze({ "http:": "http:", "https:": "https:", "ws:": "http:", "wss:": "https:" });
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Statuses after which a browser re-requests the target with GET (a form POST answered this way is post-redirect-get). */
const GET_AFTER_REDIRECT = new Set([301, 302, 303]);
const MAX_BLOCKED_RECORDED = 50;
export const MAX_MAIN_REDIRECTS = 5;
const identity = (s) => s;

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
export const onOrigin = (raw, allowedOrigin) => {
  try { const url = new URL(String(raw)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === allowedOrigin; }
  catch { return false; }
};

/**
 * The network guard of one inspection: a context.route handler and a routeWebSocket handler that let through only the
 * approved origin and remember what they refused (redacted, capped). Playwright auto-continues redirect hops without
 * calling the route, so an allowed request is fetched here with maxRedirects 0: each same-origin hop is followed by the Hub
 * (GET/HEAD only), a hop elsewhere aborts the request, and only the final response is handed to the browser.
 */
export function createRequestGuard({ allowedOrigin, fetchTimeoutMs = 20000, maxRedirects = 5, redact = identity, streamPaths = [] }) {
  // M09: a server-sent event stream never ends, so it cannot be fetched and fulfilled; a caller may name EXACT same-origin
  // stream paths (the Hub's own /api/stream) that are continued natively. Nothing else changes: any other request, any other
  // path and any other origin still goes through the checked fetch below.
  const streams = new Set((Array.isArray(streamPaths) ? streamPaths : []).filter((p) => typeof p === "string" && p.startsWith("/") && !p.startsWith("//")));
  const blocked = [];
  const redirects = [];
  let blockedCount = 0;
  let mainRedirect = null; // a checked same-origin redirect of the navigation inspectPage started, re-navigated by it
  let pageRedirect = null; // RT-07: a checked same-origin redirect of a main-frame navigation the PAGE started (form, link)
  let expected = null; // the URL inspectPage's page.goto is navigating to right now
  let navMark = 0; // blocked entries before this index belong to earlier navigations
  // Redacted before it is shortened, so a token cut in half never survives; bounded before redaction for huge data: URLs.
  const clip = (url) => redact(String(url).slice(0, 2000)).slice(0, 300);
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
    if (streams.size && method === "GET" && !navigation && (type === "eventsource" || /text\/event-stream/i.test(read(() => request.headers().accept || "", "")))) {
      let pathname = null;
      try { const u = new URL(first); pathname = onOrigin(first, allowedOrigin) ? u.pathname : null; } catch { pathname = null; }
      if (pathname && streams.has(pathname)) return settle(() => r.continue());
    }
    let current = first;
    try {
      for (let hop = 0; ; hop += 1) {
        const response = await r.fetch({ url: current, maxRedirects: 0, timeout: fetchTimeoutMs });
        const location = REDIRECT_STATUSES.has(response.status()) ? response.headers().location : "";
        if (!location) return await r.fulfill({ response });
        let next;
        try { next = new URL(location, current).href; } catch { next = String(location); }
        // RT-07: the main document's form POST answered with 301/302/303 is post-redirect-get — a browser follows it with
        // a GET of the same-origin target. A method-preserving 307/308 of a POST (a re-POST), a POST from fetch/XHR and any
        // target outside the approved origin stay refused.
        const prg = mainFrame && !forGoto && GET_AFTER_REDIRECT.has(response.status());
        const refusal = !onOrigin(next, allowedOrigin) ? `redirect ${browserRequestVerdict(next, allowedOrigin).reason || "to a non-http target"}`
          : !["GET", "HEAD"].includes(method) && !prg ? `redirect of a ${method} request is not followed`
            : hop >= maxRedirects ? `more than ${maxRedirects} redirects` : "";
        if (refusal) { note(next, refusal, type, navigation, mainFrame, forGoto); return await r.abort("blockedbyclient"); }
        if (redirects.length < MAX_BLOCKED_RECORDED) redirects.push({ from: clip(current), to: clip(next), ...(method !== "GET" ? { method, status: response.status() } : {}) });
        // The main document must commit at its real URL (relative links resolve against it): instead of serving the final
        // body under the first URL, the checked target is handed back and the caller navigates to it afresh with a GET.
        if (forGoto) { mainRedirect = next; return await r.abort("aborted"); }
        if (mainFrame) { pageRedirect = next; return await r.abort("aborted"); }
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
  const takePageRedirect = () => { const next = pageRedirect; pageRedirect = null; return next; };
  /** Called right before each page.goto: what follows belongs to this navigation only. */
  const expectNavigation = (url) => { expected = String(url); mainRedirect = null; navMark = blocked.length; };
  /** Called once a goto settled: a later click or form GET to the same URL is not that goto's request. */
  const endNavigation = () => { expected = null; mainRedirect = null; pageRedirect = null; };
  return { route, webSocket, summary, takeMainRedirect, takePageRedirect, expectNavigation, endNavigation, blockedNavigation: () => blocked.slice(navMark).find((b) => b.forGoto) || null };
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
    // The renderer runs generated page code: keep Chromium's OS sandbox on (Playwright's default is off). Verified on this
    // Windows with Playwright 1.61.0 / Chromium 1228 (2026-10-01) and inside bwrap in ifrim-runner (renderer seccomp 2 in
    // its own user namespace, 2026-10-02).
    chromiumSandbox: true,
    args: [
      "--proxy-server=http://127.0.0.1:9",
      `--proxy-bypass-list=<-loopback>;${target.hostname}:${target.port}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1, EXCLUDE [::1]",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-quic",
    ],
  };
}

/**
 * Declarative browser E2E steps (Software Factory criteria `verify: "e2e"`, M03 §21). The steps are part of the approved
 * specification (so the writer cannot change them) and are checked again here. Each step is ONE of:
 *   { viewport: { width, height } }   { goto: "/path" }   { fill: { selector, value } }   { select: { selector, value } }
 *   { click: "selector" }   { expectText: "text" }   { expectSelector: "selector" }   { noHorizontalOverflow: true }
 * Paths are relative to the preview origin; selectors are CSS, values fictive text. No scripts, no URLs. The first step
 * after the optional viewport steps is a goto (otherwise the steps would run on an empty page). `{run}` inside a fill value
 * or an expectText becomes a token unique to the run, so a re-run never collides with data an earlier run saved
 * (deduplication, unique keys) and the page can be checked for exactly what this run submitted.
 */
export const E2E_STEP_KINDS = Object.freeze(["viewport", "goto", "fill", "select", "click", "expectText", "expectSelector", "noHorizontalOverflow"]);
export const E2E_MAX_STEPS = 25;
export const E2E_RUN_TOKEN = "{run}";

export function validateE2ESteps(steps) {
  const problems = [];
  if (!Array.isArray(steps) || !steps.length) return ["cel puțin un pas E2E"];
  if (steps.length > E2E_MAX_STEPS) problems.push(`cel mult ${E2E_MAX_STEPS} pași E2E`);
  const selector = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
  const text = (value) => typeof value === "string" && value.length <= 500;
  steps.slice(0, E2E_MAX_STEPS).forEach((step, i) => {
    const keys = step && typeof step === "object" ? Object.keys(step) : [];
    if (keys.length !== 1 || !E2E_STEP_KINDS.includes(keys[0])) { problems.push(`pasul ${i + 1}: un singur tip dintre ${E2E_STEP_KINDS.join(", ")}`); return; }
    const [kind] = keys;
    const v = step[kind];
    const ok = {
      viewport: () => Number.isInteger(v?.width) && Number.isInteger(v?.height) && v.width >= 280 && v.width <= 2560 && v.height >= 400 && v.height <= 1600,
      goto: () => typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && v.length <= 300 && !/[\s\\]/.test(v),
      fill: () => selector(v?.selector) && text(v?.value),
      select: () => selector(v?.selector) && text(v?.value),
      click: () => selector(v),
      expectText: () => typeof v === "string" && v.length > 0 && v.length <= 300,
      expectSelector: () => selector(v),
      noHorizontalOverflow: () => v === true,
    }[kind]();
    if (!ok) problems.push(`pasul ${i + 1} (${kind}): valoare invalidă`);
  });
  const firstPageStep = steps.find((step) => !(step && typeof step === "object" && Object.keys(step)[0] === "viewport"));
  if (firstPageStep && !(typeof firstPageStep === "object" && Object.keys(firstPageStep)[0] === "goto")) {
    problems.push("primul pas după viewport trebuie să fie goto (altfel pașii rulează pe o pagină goală)");
  }
  if (!firstPageStep) problems.push("cel puțin un pas goto");
  return problems;
}

/** A browser call that has no timeout of its own (evaluate, viewport, close) must not hold the mission forever. */
export function bounded(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: fără răspuns în ${ms} ms (pagina blochează renderer-ul?)`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export const E2E_ISOLATED = "context nou fără profil, service workers blocate, descărcări refuzate, doar originea preview-ului, sandbox OS Chromium";

/**
 * Runs validated E2E steps against `base` (an already validated local URL) in a browser from `launch(allowedOrigin)`: fresh
 * context, request guard, dead proxy for anything but the preview origin (the launcher's options), Chromium OS sandbox.
 * Returns { id, status: PASS|FAIL|INTERRUPTED|BLOCKED, url, steps: [{ i, kind, ok, ms, error? }], consoleErrors, screenshot,
 * durationMs, network, isolated }. Stops at the first failed step; `screenshot(page)` is called at the end or at the
 * failure, only while the page is on the approved origin (its return value is the result's `screenshot`). A goto follows
 * same-origin redirects of the page itself (bounded, checked by the guard) and fails on an HTTP error status. Every step is
 * bounded by `stepTimeoutMs`. `signal` (Stop / Pause of the mission) closes the browser at once and the result is
 * INTERRUPTED, never a product failure. `beforeSteps` / `afterSteps` ({ browser, page }) may return a reason that makes the
 * result BLOCKED (the preview host refuses to report a run whose Chromium sandbox it could not measure as active). A failure
 * to start the browser, or a browser that dies during the steps, throws (an infrastructure problem, not a failed step).
 */
export async function runE2ESteps({ base, steps, launch, id, stepTimeoutMs = 10000, signal = null, redact = identity, screenshot = async () => null, beforeSteps = null, afterSteps = null }) {
  const allowedOrigin = new URL(base).origin;
  const runToken = String(id).slice(-10);
  const started = Date.now();
  const guard = createRequestGuard({ allowedOrigin, fetchTimeoutMs: stepTimeoutMs * 2, redact });
  const browser = await launch(allowedOrigin);
  const closeBrowser = () => bounded(Promise.resolve().then(() => browser.close()), 5000, "browser.close").catch(() => {});
  const onAbort = () => { closeBrowser(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const results = [];
  const consoleErrors = [];
  let status = "PASS";
  const result = (extra) => ({ id, status, url: base, steps: results, consoleErrors: consoleErrors.slice(0, 50), screenshot: null, durationMs: Date.now() - started,
    network: guard.summary(), isolated: E2E_ISOLATED, ...extra });
  try {
    // Desktop size until a viewport step changes it (a spec may check desktop first, then mobile).
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    await context.route(() => true, guard.route);
    if (typeof context.routeWebSocket === "function") await context.routeWebSocket(() => true, guard.webSocket);
    const page = await context.newPage();
    page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleErrors.push({ type: msg.type(), text: redact(msg.text()).slice(0, 500) }); });
    page.on("pageerror", (error) => consoleErrors.push({ type: "pageerror", text: redact(String(error.message)).slice(0, 500) }));
    if (beforeSteps) {
      const refusal = await beforeSteps({ browser, context, page });
      if (refusal) return result({ status: "BLOCKED", error: String(refusal).slice(0, 400) });
    }
    /** The bounded goto loop: same-origin redirects are re-navigated (at most MAX_MAIN_REDIRECTS), anything else refused. */
    const navigate = async (start, label) => {
      let goal = start;
      let response = null;
      for (let hops = 0; ;) {
        guard.expectNavigation(goal);
        try { response = await page.goto(goal, { timeout: stepTimeoutMs * 2, waitUntil: "load" }); break; }
        catch (error) {
          const next = guard.takeMainRedirect();
          if (next && hops < MAX_MAIN_REDIRECTS) { hops += 1; goal = next; continue; }
          if (next) throw new Error(`mai mult de ${MAX_MAIN_REDIRECTS} redirecționări ale paginii`);
          const stopped = guard.blockedNavigation();
          if (stopped) throw new Error(`navigare oprită de allowlist: ${stopped.url} (${stopped.reason})`);
          throw error;
        }
      }
      guard.endNavigation();
      if (!onOrigin(page.url(), allowedOrigin)) throw new Error(`pagina a părăsit originea aprobată (${redact(page.url()).slice(0, 120)})`);
      if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()} la ${label}`);
      return response;
    };
    /**
     * RT-07: a click/fill/select may submit a form whose answer is a redirect; the guard handed back the checked target and
     * the page now shows an aborted navigation. The page continues at the real target with a GET (one POST, then a GET).
     */
    let followed = 0;
    const followPageRedirect = async () => {
      const next = guard.takePageRedirect();
      if (!next) return;
      if (++followed > 20) throw new Error("prea multe redirecționări după acțiuni în pagină");
      await navigate(next, `redirecționarea după acțiune (${redact(next).slice(0, 120)})`);
    };
    for (const [i, step] of steps.entries()) {
      if (signal?.aborted) break;
      const [kind] = Object.keys(step);
      const value = step[kind];
      const t0 = Date.now();
      try {
        if (kind !== "goto") await followPageRedirect();
        if (kind === "viewport") await bounded(page.setViewportSize(value), stepTimeoutMs, "viewport");
        else if (kind === "goto") await navigate(new URL(value, base).href, value);
        else if (kind === "fill") await page.fill(value.selector, value.value.split(E2E_RUN_TOKEN).join(runToken), { timeout: stepTimeoutMs });
        else if (kind === "select") await page.selectOption(value.selector, value.value, { timeout: stepTimeoutMs });
        else if (kind === "click") { await page.click(value, { timeout: stepTimeoutMs }); await followPageRedirect(); }
        else if (kind === "expectSelector") await page.waitForSelector(value, { state: "visible", timeout: stepTimeoutMs });
        else if (kind === "expectText") await page.waitForFunction((needle) => document.body && document.body.innerText.includes(needle), value.split(E2E_RUN_TOKEN).join(runToken), { timeout: stepTimeoutMs });
        else if (kind === "noHorizontalOverflow") {
          const widths = await bounded(page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth })), stepTimeoutMs, "noHorizontalOverflow");
          if (widths.scroll > widths.view + 1) throw new Error(`depășire orizontală: ${widths.scroll}px > ${widths.view}px`);
        }
        results.push({ i: i + 1, kind, ok: true, ms: Date.now() - t0 });
      } catch (error) {
        if (signal?.aborted) break;
        // Chromium gone (crash, killed) is not a failure of the page: the caller reports an infrastructure problem.
        if (typeof browser.isConnected === "function" && !browser.isConnected()) throw new Error(`browserul s-a oprit în timpul E2E (pasul ${i + 1}): ${redact(String(error.message || error)).split("\n")[0].slice(0, 200)}`);
        results.push({ i: i + 1, kind, ok: false, ms: Date.now() - t0, error: redact(String(error.message || error)).split("\n")[0].slice(0, 300) });
        status = "FAIL";
        break;
      }
    }
    if (signal?.aborted) return result({ status: "INTERRUPTED" });
    if (afterSteps) {
      const refusal = await afterSteps({ browser, context, page });
      if (refusal) return result({ status: "BLOCKED", error: String(refusal).slice(0, 400) });
    }
    const shot = onOrigin(page.url(), allowedOrigin) ? await Promise.resolve().then(() => screenshot(page)).catch(() => null) : null;
    await bounded(context.close(), stepTimeoutMs, "context.close").catch(() => {});
    return result({ screenshot: shot ?? null });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await closeBrowser();
  }
}

/**
 * The Chromium sandbox as the kernel reports it (Linux only), read from /proc inside the namespace the browser runs in:
 * every renderer must be in seccomp-bpf mode (2) and in a user namespace of its own (Chromium's namespace sandbox), and no
 * Chromium process may carry --no-sandbox. Zygote-forked processes rewrite their command line into one space-separated
 * string, so the flags are read from the joined command line (exact tokens: --no-zygote-sandbox is not --no-sandbox).
 * `fsImpl` is node:fs (injected: this file imports nothing). Measured, never assumed: no renderer means not active.
 */
export function measureChromiumSandbox(fsImpl, procRoot = "/proc") {
  const procs = [];
  let names = [];
  try { names = fsImpl.readdirSync(procRoot); } catch (error) { return { measured: false, active: false, reason: `${procRoot} nu poate fi citit (${error.code || "eroare"})` }; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let cmdline = "";
    try { cmdline = fsImpl.readFileSync(`${procRoot}/${name}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); } catch { continue; }
    if (!/(?:^|\/)(?:chrome-headless-shell|chrome|chromium|headless_shell)(?:\s|$)/.test(cmdline)) continue;
    let status = "";
    try { status = fsImpl.readFileSync(`${procRoot}/${name}/status`, "utf8"); } catch { /* gone meanwhile */ }
    let userNs = null;
    try { userNs = fsImpl.readlinkSync(`${procRoot}/${name}/ns/user`); } catch { /* not readable */ }
    procs.push({ pid: Number(name), type: (cmdline.match(/(?:^|\s)--type=([a-z-]+)/) || [])[1] || "browser",
      seccomp: Number((status.match(/^Seccomp:\s*(\d+)/m) || [])[1] ?? -1), noNewPrivs: Number((status.match(/^NoNewPrivs:\s*(\d+)/m) || [])[1] ?? -1),
      userNs, noSandbox: /(?:^|\s)--no-sandbox(?:\s|=|$)/.test(cmdline) });
  }
  const browser = procs.find((p) => p.type === "browser") || null;
  const renderers = procs.filter((p) => p.type === "renderer");
  const rendererSeccomp = renderers.length > 0 && renderers.every((r) => r.seccomp === 2);
  const rendererNoNewPrivs = renderers.length > 0 && renderers.every((r) => r.noNewPrivs === 1);
  const rendererOwnUserNs = Boolean(browser?.userNs) && renderers.length > 0 && renderers.every((r) => r.userNs && r.userNs !== browser.userNs);
  const noSandboxFlag = procs.some((p) => p.noSandbox);
  const active = rendererSeccomp && rendererOwnUserNs && !noSandboxFlag;
  return { measured: procs.length > 0, active, processes: procs.length, renderers: renderers.length, rendererSeccomp, rendererNoNewPrivs, rendererOwnUserNs, noSandboxFlag,
    reason: active ? null : !procs.length ? "niciun proces Chromium vizibil în /proc" : !renderers.length ? "niciun renderer Chromium vizibil" : noSandboxFlag ? "un proces Chromium rulează cu --no-sandbox"
      : !rendererSeccomp ? "un renderer nu e în modul seccomp-bpf (2)" : "un renderer nu are namespace-ul de utilizator propriu (sandbox-ul Chromium)" };
}
