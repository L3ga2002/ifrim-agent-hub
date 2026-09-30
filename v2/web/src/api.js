// API client: per-boot session token on every mutating request, typed errors, SSE with replay.
let token = null;
let tokenPromise = null;

async function ensureToken() {
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

/**
 * Event stream with automatic reconnect. Persisted events carry `seq`; the browser's EventSource sends
 * Last-Event-ID on reconnect and the server replays from SQLite, so nothing is lost or duplicated.
 * `onEvent` receives persisted events; `onLive` receives transient deltas.
 */
export function openStream({ after = 0, onEvent, onLive, onStatus }) {
  let source = null;
  let closed = false;
  let lastSeq = after;
  let retry = 1000;
  const seen = new Set();
  function connect() {
    if (closed) return;
    source = new EventSource(`/api/stream?after=${lastSeq}`);
    source.addEventListener("hello", () => { retry = 1000; onStatus?.("live"); });
    source.addEventListener("hub", (message) => {
      const event = JSON.parse(message.data);
      if (seen.has(event.seq)) return;
      seen.add(event.seq);
      if (seen.size > 5000) seen.delete(seen.values().next().value);
      lastSeq = Math.max(lastSeq, event.seq);
      onEvent(event);
    });
    source.addEventListener("live", (message) => onLive?.(JSON.parse(message.data)));
    source.onerror = () => {
      onStatus?.("reconnecting");
      source.close();
      if (!closed) setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15000);
    };
  }
  connect();
  return { close() { closed = true; source?.close(); } };
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
