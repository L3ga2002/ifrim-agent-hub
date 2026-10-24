// API client: per-boot session token on every mutating request, typed errors, SSE with replay.
import { createEventGate } from "./lib/uiLogic.js";

let token = null;
let tokenPromise = null;

/**
 * M07 UI–API contract. The build carries the contract it was made for (vite define); the server reports its own on
 * /api/session, the SSE hello and every /api response. A mutating request is refused here, before it is sent, when they
 * differ — except the fail-safe ones (stop, pause, revoke, log out), which must always work.
 */
/* global __UI_VERSION__, __UI_CONTRACT__ */
export const UI_BUILD = Object.freeze({
  version: typeof __UI_VERSION__ === "string" ? __UI_VERSION__ : "dev",
  contract: typeof __UI_CONTRACT__ === "number" ? __UI_CONTRACT__ : null,
});
const FAILSAFE = ["/api/stop-all", "/api/runs/*/interrupt", "/api/lega/sessions/*/stop", "/api/owner/interrupt", "/api/owner/policy/deactivate",
  "/api/owner/logout", "/api/owner/sessions/revoke-all", "/api/envelopes/*/revoke", "/api/factory/*/stop", "/api/factory/*/pause", "/api/grants/*/revoke",
  // M08: the phone's stop/forget, revoking a phone and rolling a skill back always work (same list as the server).
  "/api/m/command", "/api/m/forget", "/api/skills/candidates/*/rollback", "/api/devices/*/revoke",
  // M09: withdrawing a billing declaration and stopping media work (same list as the server).
  "/api/owner/billing/withdraw", "/api/media/renders/*/cancel", "/api/media/captures/*/cancel", "/api/media/captures/*/obs/stop", "/api/media/transcripts/*/cancel",
  "/api/content/releases/*/cancel", "/api/media/rights/*/revoke", "/api/media/policy/capture-off",
  // M10: desktop Stop / Preiau eu, pausing / cancelling a plan, withdrawing an app or an import folder (same list as the server).
  "/api/desktop/stop", "/api/desktop/takeover", "/api/desktop/apps/revoke", "/api/ops/plans/*/pause", "/api/ops/plans/*/cancel", "/api/media/import-folders/*/revoke"];
export function isFailsafePath(path, body = null) {
  if (String(path).split("?")[0] === "/api/gate") return body?.action === "suspend"; // suspending is fail-safe, opening is not
  const parts = String(path).split("?")[0].split("/");
  return FAILSAFE.some((p) => { const w = p.split("/"); return w.length === parts.length && w.every((x, i) => (x === "*" ? parts[i].length > 0 : x === parts[i])); });
}
let server = null; // { version, apiContract, bootId } as last reported by the server
const listeners = new Set();
/** Subscribes to server-info changes (a restart, another version); returns the unsubscribe function. */
export function onServerInfo(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const serverInfo = () => server;
/** "ok" | "ui_older" | "server_older" | "unknown" (no contract known yet, or a dev build without one). */
export function contractState(info = server) {
  if (!info || UI_BUILD.contract === null) return "unknown";
  // A server that reports no contract predates M07: it is older than any page that has one.
  if (typeof info.apiContract !== "number") return info.version ? "server_older" : "unknown";
  if (info.apiContract === UI_BUILD.contract) return "ok";
  return info.apiContract > UI_BUILD.contract ? "ui_older" : "server_older";
}
export function noteServer(info) {
  if (!info || typeof info !== "object") return;
  const restarted = Boolean(info.bootId && server?.bootId && info.bootId !== server.bootId);
  const next = restarted
    ? { version: info.version ?? null, apiContract: typeof info.apiContract === "number" ? info.apiContract : null, bootId: info.bootId }
    : { version: info.version ?? server?.version ?? null, apiContract: typeof info.apiContract === "number" ? info.apiContract : server?.apiContract ?? null, bootId: info.bootId ?? server?.bootId ?? null };
  const changed = !server || next.version !== server.version || next.apiContract !== server.apiContract || next.bootId !== server.bootId;
  if (server && next.bootId && next.bootId !== server.bootId) token = null; // a restart rotates the per-boot token
  server = next;
  if (changed) for (const fn of listeners) { try { fn(server); } catch { /* a listener's problem */ } }
}

export async function ensureToken() {
  if (token) return token;
  if (!tokenPromise) {
    tokenPromise = fetch("/api/session", { credentials: "same-origin" })
      .then((res) => { if (!res.ok) throw new Error("Session unavailable"); return res.json(); })
      .then((data) => { noteServer(data); token = data.token; return token; })
      .finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

function staleRefusal(path, body = null, method = "POST") {
  if (isFailsafePath(path, body)) return null;
  const state = contractState();
  if (state !== "ui_older" && state !== "server_older") return null;
  const message = state === "ui_older"
    ? `Interfața (${UI_BUILD.version}) e mai veche decât serverul (${server.version}): reîncarcă pagina.`
    : `Serverul rulează ${server.version}, interfața e ${UI_BUILD.version}: repornește Hub-ul (v2\\scripts\\restart.ps1).`;
  const error = new ApiError(409, { error: { category: "conflict", code: "UI_STALE", message, details: { ui: UI_BUILD, server } } });
  error.method = method;
  error.notSent = true;
  return error;
}

export class ApiError extends Error {
  constructor(status, body, method) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.method = method;
    this.category = body?.error?.category || "internal";
    this.code = body?.error?.code || null;
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = {};
  if (method !== "GET") {
    headers["X-Hub-Token"] = await ensureToken();
    headers["Content-Type"] = "application/json";
    if (UI_BUILD.contract !== null) headers["X-Hub-UI-Contract"] = String(UI_BUILD.contract);
    const stale = staleRefusal(path, body, method);
    if (stale) throw stale;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: "same-origin" });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, { error: { message: "Hub server is not reachable (offline)", category: "transport" } }, method);
  }
  if (res.status === 403 && method !== "GET") {
    const body403 = await res.json().catch(() => null);
    if (/session token/i.test(body403?.error?.message || "")) { token = null; return api(path, { method, body, signal }); }
    throw new ApiError(403, body403, method);
  }
  const contract = Number(res.headers.get("x-hub-contract"));
  if (Number.isFinite(contract) && contract > 0 && server && contract !== server.apiContract) noteServer({ ...server, apiContract: contract, version: res.headers.get("x-hub-version") || server.version });
  const type = res.headers.get("content-type") || "";
  const payload = type.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (payload?.error?.code === "UI_STALE") noteServer({ ...server, apiContract: payload.error.details?.serverContract, version: payload.error.details?.serverVersion });
    throw new ApiError(res.status, payload, method);
  }
  return payload;
}

/**
 * M07: raw bytes (an audio segment, PCM16 16 kHz) to a session-bound route. Same token, contract and stale-page refusal as
 * api(); the owner's session cookie goes with it (same origin). Extra headers are plain ASCII (e.g. X-Voice-Flags JSON).
 */
export async function apiRaw(path, bytes, { headers = {}, signal } = {}) {
  const method = "POST";
  const stale = staleRefusal(path, null, method);
  if (stale) throw stale;
  const send = async () => fetch(path, { method: "POST", body: bytes, signal, credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-Hub-Token": await ensureToken(), ...(UI_BUILD.contract !== null ? { "X-Hub-UI-Contract": String(UI_BUILD.contract) } : {}), ...headers } });
  let res;
  try { res = await send(); } catch (error) { if (error.name === "AbortError") throw error; throw new ApiError(0, { error: { message: "Hub server is not reachable (offline)", category: "transport" } }, method); }
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (/session token/i.test(body?.error?.message || "")) { token = null; res = await send(); }
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload, method);
  return payload;
}

const parseData = (message) => { try { return JSON.parse(message?.data); } catch { return null; } };

/**
 * Event stream with reconnect and replay. Persisted events carry `seq` (also their SSE id). Every (re)connect is a NEW
 * EventSource opened with `?after=<last accepted seq>`: a new object never sends Last-Event-ID (only the browser's own
 * retry of the same object would, and that retry is cancelled here to own the backoff), so `?after` is what makes the
 * server replay the gap from SQLite. One tested gate (createEventGate, lib/uiLogic.js) decides what reaches `onEvent`:
 * duplicates, stale and out-of-order sequences are dropped, and a `hello` showing the server's log behind our mark
 * (reset database, or an unknown start) moves the mark there and reopens the stream from it.
 * `onEvent` receives persisted events in order; `onLive` receives transient deltas; `onStatus` gets "live" / "reconnecting".
 * `EventSourceImpl` and `timers` are injectable so M02-UI-10 drives this exact code without a browser.
 */
export function openStream({ after = null, onEvent, onLive, onStatus, EventSourceImpl = globalThis.EventSource, timers = globalThis }) {
  const gate = createEventGate({ after });
  let source = null;
  let closed = false;
  let retry = 1000;
  let timer = null;
  let resyncs = 0; // consecutive resyncs without a usable hello: past 3 they wait for the backoff instead of looping
  // Handlers ignore anything from a source that is no longer current (a message queued before close()).
  const current = (es) => es === source && !closed;
  function scheduleReconnect() {
    onStatus?.("reconnecting");
    timer = timers.setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  }
  function drop(es) { es.close(); if (source === es) source = null; }
  function connect() {
    timer = null;
    if (closed) return;
    const es = new EventSourceImpl(`/api/stream?after=${gate.lastSeq}`);
    source = es;
    es.addEventListener("hello", (message) => {
      if (!current(es)) return;
      const helloData = parseData(message);
      noteServer(helloData); // M07: a restart or another server version is noticed here, before the next command
      const hello = gate.hello(helloData);
      if (hello.resync) { drop(es); if (++resyncs > 3) scheduleReconnect(); else connect(); return; }
      if (!gate.known) { drop(es); scheduleReconnect(); return; } // a hello without the server's lastSeq: retry with backoff
      retry = 1000; resyncs = 0;
      onStatus?.("live");
    });
    es.addEventListener("hub", (message) => {
      if (!current(es)) return;
      const event = parseData(message);
      if (gate.accept(event)) onEvent(event);
    });
    es.addEventListener("live", (message) => {
      if (!current(es)) return;
      const event = parseData(message);
      if (event && typeof event === "object") onLive?.(event);
    });
    es.onerror = () => {
      if (!current(es)) return;
      drop(es);
      scheduleReconnect();
    };
  }
  connect();
  return {
    close() { closed = true; if (timer !== null) timers.clearTimeout(timer); timer = null; source?.close(); source = null; },
    /** Last sequence accepted (diagnostics). */
    get lastSeq() { return gate.known ? gate.lastSeq : null; },
  };
}

export const fmt = {
  time(iso) { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }); },
  dateTime(iso) { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleString("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); },
  ago(iso) {
    if (!iso) return "—";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return "acum";
    if (s < 3600) return `acum ${Math.round(s / 60)} min`;
    if (s < 86400) return `acum ${Math.round(s / 3600)} h`;
    return `acum ${Math.round(s / 86400)} z`;
  },
  bytes(n) { if (!n && n !== 0) return "—"; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; },
  short(id) { return id ? String(id).split("_").slice(-1)[0].slice(0, 8) : "—"; },
};

/**
 * Upload with progress and cancel (XHR; fetch has no upload progress). Returns { promise, abort }.
 * The file only goes to the local Hub; attaching never sends anything to a provider.
 */
export function uploadWithProgress(path, body, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = ensureToken().then((tok) => new Promise((resolve, reject) => {
    const stale = staleRefusal(path);
    if (stale) { reject(stale); return; }
    xhr.open("POST", path);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Hub-Token", tok);
    if (UI_BUILD.contract !== null) xhr.setRequestHeader("X-Hub-UI-Contract", String(UI_BUILD.contract));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null; try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data, "POST"));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: { message: "Hub server is not reachable (offline)", category: "transport" } }, "POST"));
    xhr.onabort = () => reject(Object.assign(new Error("Încărcare anulată"), { name: "AbortError" }));
    xhr.send(JSON.stringify(body));
  }));
  return { promise, abort: () => xhr.abort() };
}
