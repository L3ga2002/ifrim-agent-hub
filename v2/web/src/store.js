import { useSyncExternalStore, useEffect, useState, useCallback, useRef } from "react";
import { streamStartSeq } from "./lib/uiLogic.js";
import { api, openStream } from "./api.js";

// Global Hub state: the /api/state projection, refreshed on relevant events (debounced).
const listeners = new Set();
let state = { hub: null, loading: true, error: null, connection: "connecting", toasts: [], voicePhase: "idle", legaPhase: "off", lastUpdate: null };
const emit = () => { for (const l of listeners) l(); };
export const setState = (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; emit(); };
/** Current store snapshot for non-React code (e.g. an error boundary deciding whether a reload is safe). */
export const getState = () => state;
export const useHub = (selector = (s) => s) => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(state));

const eventListeners = new Set();
export const onHubEvent = (fn) => { eventListeners.add(fn); return () => eventListeners.delete(fn); };
const liveListeners = new Set();
export const onLive = (fn) => { liveListeners.add(fn); return () => liveListeners.delete(fn); };

let refreshTimer = null;
export async function refresh() {
  try {
    const hub = await api("/api/state");
    setState({ hub, loading: false, error: null, lastUpdate: Date.now() });
  } catch (error) {
    setState({ loading: false, error: error.message });
  }
}
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); };

const TOAST_TYPES = {
  "approval.requested": { level: "approval", text: "Aprobare necesară" },
  "run.failed": { level: "error", text: "Execuție eșuată" },
  "run.blocked": { level: "error", text: "Execuție blocată de poartă" },
  "run.completed": { level: "ok", text: "Execuție terminată (necesită verificare)" },
  "backup.verified": { level: "ok", text: "Backup verificat" },
  "backup.failed": { level: "error", text: "Backup eșuat" },
  "system.stop_all": { level: "error", text: "Stop All executat" },
  "handoff.ready": { level: "ok", text: "Handoff pregătit" },
  "run.stale": { level: "warn", text: "Execuție fără activitate" },
};

export function startHubConnection() {
  let stream = null;
  let stopped = false;
  // Start the live stream at the current sequence so history is not replayed as new notifications;
  // reconnects afterwards resume from the last received event (no gaps, no duplicates). Without a state snapshot
  // the start is unknown (null), never 0: 0 would replay the whole log as fresh toasts; the stream learns the
  // server's lastSeq from its hello instead.
  const start = () => { if (!stopped && !stream) stream = connect(streamStartSeq(state.hub)); };
  refresh().then(start);
  // Release the long-lived connection when the page is hidden in the back/forward cache.
  const onHide = () => { stream?.close(); stream = null; };
  const onShow = (e) => { if (e.persisted && !stopped) refresh().then(start); };
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  return () => { stopped = true; stream?.close(); window.removeEventListener("pagehide", onHide); window.removeEventListener("pageshow", onShow); };
}

function connect(after) {
  return openStream({
    after,
    onEvent(event) {
      setState({ lastUpdate: Date.now() });
      for (const fn of eventListeners) fn(event);
      if (!event.type.startsWith("run.activity") && !event.type.startsWith("backup.progress")) scheduleRefresh();
      const toast = TOAST_TYPES[event.type];
      if (toast) pushToast(event.type, toast.level, toast.text, event);
    },
    onLive(event) { for (const fn of liveListeners) fn(event); },
    onStatus(connection) { setState({ connection }); if (connection === "live") scheduleRefresh(); },
  });
}

// Grouped notifications: events of the same type within 6 s collapse into one toast with a counter.
export function pushToast(key, level, text, event) {
  setState((s) => {
    const existing = s.toasts.find((t) => t.key === key && Date.now() - t.at < 6000);
    const toasts = existing
      ? s.toasts.map((t) => (t === existing ? { ...t, count: t.count + 1, at: Date.now(), event } : t))
      : [...s.toasts.slice(-4), { id: `${key}-${Date.now()}`, key, level, text, count: 1, at: Date.now(), event }];
    return { toasts };
  });
}
export const dismissToast = (id) => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** Data hook: loads `path`, reloads on matching events. */
export function useResource(path, { reloadOn = () => true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const matcher = useRef(reloadOn);
  matcher.current = reloadOn;
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api(path)); setError(null); }
    catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(Boolean(path)); load(); }, [load, ...deps]);
  useEffect(() => {
    let timer = null;
    const off = onHubEvent((event) => { if (matcher.current(event)) { clearTimeout(timer); timer = setTimeout(load, 200); } });
    return () => { off(); clearTimeout(timer); };
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Wraps an async action with pending state and duplicate-click protection. */
export function useAction(fn) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const run = useCallback(async (...args) => {
    if (busy.current) return undefined;
    busy.current = true; setPending(true); setError(null);
    try { return await fn(...args); }
    catch (e) { setError(e); return undefined; }
    finally { busy.current = false; setPending(false); }
  }, [fn]);
  return { run, pending, error, clearError: () => setError(null) };
}

// Local UI preferences (never authoritative state).
export function usePref(key, initial) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(`hub.v2.${key}`); return raw === null ? initial : JSON.parse(raw); } catch { return initial; }
  });
  const update = useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      try { localStorage.setItem(`hub.v2.${key}`, JSON.stringify(v)); } catch { /* storage unavailable */ }
      return v;
    });
  }, [key]);
  return [value, update];
}
