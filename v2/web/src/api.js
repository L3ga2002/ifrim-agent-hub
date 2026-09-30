// API client: per-boot session token on every mutating request, typed errors, SSE with replay.
import { createEventGate } from "./lib/uiLogic.js";

let token = null;
let tokenPromise = null;

export async function ensureToken() {
  if (token) return token;
  if (!tokenPromise) {
    tokenPromise = fetch("/api/session", { credentials: "same-origin" })
      .then((res) => { if (!res.ok) throw new Error("Session unavailable"); return res.json(); })
      .then((data) => { token = data.token; return token; })
      .finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.category = body?.error?.category || "internal";
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = {};
  if (method !== "GET") {
    headers["X-Hub-Token"] = await ensureToken();
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: "same-origin" });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, { error: { message: "Hub server is not reachable (offline)", category: "transport" } });
  }
  if (res.status === 403 && method !== "GET") {
    const body403 = await res.json().catch(() => null);
    if (/session token/i.test(body403?.error?.message || "")) { token = null; return api(path, { method, body, signal }); }
    throw new ApiError(403, body403);
  }
  const type = res.headers.get("content-type") || "";
  const payload = type.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new ApiError(res.status, payload);
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
      const hello = gate.hello(parseData(message));
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
    xhr.open("POST", path);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Hub-Token", tok);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null; try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: { message: "Hub server is not reachable (offline)", category: "transport" } }));
    xhr.onabort = () => reject(Object.assign(new Error("Încărcare anulată"), { name: "AbortError" }));
    xhr.send(JSON.stringify(body));
  }));
  return { promise, abort: () => xhr.abort() };
}
