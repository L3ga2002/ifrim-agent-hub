import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { HubError, toPublicError } from "../core/errors.mjs";
import { registerRoutes } from "./routes.mjs";
import { HUB_VERSION, API_CONTRACT } from "../config.mjs";

/**
 * Fail-safe requests are never refused for a stale UI (M07): stopping, pausing, revoking and logging out must always work,
 * whatever build the page runs.
 */
export const FAILSAFE_PATHS = Object.freeze(["/api/stop-all", "/api/runs/*/interrupt", "/api/lega/sessions/*/stop", "/api/owner/interrupt",
  "/api/owner/policy/deactivate", "/api/owner/logout", "/api/owner/sessions/revoke-all", "/api/envelopes/*/revoke",
  "/api/factory/*/stop", "/api/factory/*/pause", "/api/grants/*/revoke"]);
/**
 * Segment-wise match ("*" is exactly one segment), so no pattern can widen into another route. /api/gate is a fail-safe only
 * when it SUSPENDS the gate (opening it is not; review M07), so it needs the body.
 */
export const isFailsafe = (pathname, body = null) => {
  if (pathname === "/api/gate") return body?.action === "suspend";
  const parts = String(pathname).split("/");
  return FAILSAFE_PATHS.some((pattern) => {
    const want = pattern.split("/");
    return want.length === parts.length && want.every((w, i) => (w === "*" ? parts[i].length > 0 : w === parts[i]));
  });
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

/** Minimal router: `add(method, "/api/things/:id", handler)`. */
function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler, options = {}) {
      const keys = [];
      const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return "([^/]+)"; })}$`);
      routes.push({ method, regex, keys, handler, options });
    },
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = pathname.match(route.regex);
        if (m) return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

/**
 * Loopback-only HTTP server. Protections: Host allowlist (DNS rebinding), Origin allowlist for CORS,
 * per-boot token required on every state-changing request, JSON body limits, no directory listing.
 */
export function createHttpServer(hub) {
  const { config } = hub;
  const token = crypto.randomBytes(32).toString("hex");
  const router = createRouter();
  registerRoutes(router, hub, { token });
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "invalid"}`);
    try {
      if (!allowedHosts.has(String(req.headers.host || "").toLowerCase())) throw new HubError("policy", "Host not allowed");
      const origin = req.headers.origin;
      if (origin) {
        if (!config.allowedOrigins.has(origin)) throw new HubError("policy", "Origin not allowed");
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Token, Last-Event-ID");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (url.pathname.startsWith("/api/")) {
        res.setHeader("X-Hub-Version", HUB_VERSION);
        res.setHeader("X-Hub-Contract", String(API_CONTRACT));
        const found = router.match(req.method, url.pathname);
        if (!found) throw new HubError("not_found", "Unknown endpoint");
        if (req.method !== "GET" && req.headers["x-hub-token"] !== token) throw new HubError("policy", "Missing or invalid session token");
        // M07: audio segments arrive as raw bytes (application/octet-stream), never as JSON (and never into a command log).
        const body = req.method === "GET" ? {} : found.route.options.raw ? await readRaw(req, found.route.options.maxBytes || 1024 * 1024) : await readJson(req, found.route.options.maxBytes || 1024 * 1024);
        // A page built for another contract cannot drive this server (scripts and tests send no header and are unaffected).
        const uiContract = req.headers["x-hub-ui-contract"];
        if (req.method !== "GET" && uiContract !== undefined && String(uiContract) !== String(API_CONTRACT) && !isFailsafe(url.pathname, Buffer.isBuffer(body) ? null : body)) {
          throw new HubError("conflict", `Interfața (contract ${String(uiContract).slice(0, 8)}) nu se potrivește cu serverul ${HUB_VERSION} (contract ${API_CONTRACT}): reîncarcă pagina sau repornește Hub-ul`,
            { code: "UI_STALE", data: { uiContract: String(uiContract).slice(0, 8), serverContract: API_CONTRACT, serverVersion: HUB_VERSION } });
        }
        const result = await found.route.handler({ req, res, url, params: found.params, body, query: Object.fromEntries(url.searchParams) });
        if (result === undefined || res.writableEnded || res.headersSent) return;
        if (result && result.__raw) { res.writeHead(200, { "Content-Type": result.contentType }); res.end(result.body); return; }
        res.writeHead(result?.__status || 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(result?.__status ? result.body : result));
        return;
      }
      // M07: the canonical origin for page navigations (the owner session and WebAuthn live on localhost only).
      if (config.canonicalRedirect && (req.method === "GET" || req.method === "HEAD") && String(req.headers.host || "").toLowerCase() === `127.0.0.1:${config.port}`
        && req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document") {
        res.writeHead(307, { Location: `${config.canonicalOrigin}${url.pathname}${url.search}`, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      serveStatic(config.webDist, url.pathname, res);
    } catch (error) {
      if (!(error instanceof HubError)) console.error(`[hub] ${req.method} ${url.pathname}:`, error?.stack || error);
      const { status, body } = toPublicError(error);
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      if (!res.writableEnded) res.end(JSON.stringify(body));
    }
  });
  return { server, token };
}

function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!/^application\/octet-stream\b/i.test(String(req.headers["content-type"] || ""))) { reject(new HubError("validation", "Content-Type must be application/octet-stream")); return; }
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new HubError("validation", "Request body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new HubError("validation", "Request body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HubError("validation", "Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(root, pathname, res) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  let file = path.resolve(root, rel || "index.html");
  if (!file.startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("V2 UI is not built yet. Run: npm run build:v2");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'self'",
  });
  fs.createReadStream(file).pipe(res);
}
