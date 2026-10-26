// 2.19.1 (the owner's L3ga session of 2026-10-25: „Poți să o mărești?”, „vreau … acest chat … să-l pot minimiza ca să văd harta
// completă”): the company map on the L3ga screen and the conversation next to it. Pure view state (no DOM, no React), kept per browser;
// covered by v2/tests/l3ga-fix-2191-ui.test.mjs. Nothing here reaches the Hub: a view never authorises or starts anything.

export const MAP_ZOOM = Object.freeze({ min: 0.6, max: 2.5, step: 0.25, base: 1 });
export const MAP_CLOSED = Object.freeze({ open: false, full: false, zoom: 1 });
const ACTIONS = new Set(["open", "bigger", "smaller", "full", "reset", "close", "zoom_in", "zoom_out"]);
const round = (z) => Math.round(z * 100) / 100;
const clampZoom = (z) => round(Math.min(MAP_ZOOM.max, Math.max(MAP_ZOOM.min, Number.isFinite(z) ? z : MAP_ZOOM.base)));

/** A stored or received map state, made valid (an old or edited value never breaks the screen). */
export function normalizeMapState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...MAP_CLOSED };
  const open = value.open === true;
  return { open, full: open && value.full === true, zoom: open ? clampZoom(Number(value.zoom)) : 1 };
}

/**
 * The next map state for one action. „Mărește” goes step by step: the map opens on the screen, then fills the screen, then zooms in;
 * „Micșorează” goes back the same way. zoom_in / zoom_out are the +/− buttons and the mouse wheel (the zoom only, never the layout).
 */
export function nextMapState(state, action) {
  const s = normalizeMapState(state);
  if (!ACTIONS.has(action)) return s;
  switch (action) {
    case "open": return s.open ? s : { open: true, full: false, zoom: 1 };
    case "bigger": return !s.open ? { open: true, full: false, zoom: 1 } : !s.full ? { ...s, full: true } : { ...s, zoom: clampZoom(s.zoom + MAP_ZOOM.step) };
    case "smaller":
      if (!s.open) return s;
      if (s.zoom > MAP_ZOOM.base) return { ...s, zoom: clampZoom(Math.max(MAP_ZOOM.base, s.zoom - MAP_ZOOM.step)) };
      if (s.full) return { ...s, full: false };
      return { ...s, zoom: clampZoom(s.zoom - MAP_ZOOM.step) };
    case "full": return { open: true, full: true, zoom: s.open ? s.zoom : 1 };
    case "reset": return { open: true, full: false, zoom: 1 };
    case "close": return { ...MAP_CLOSED };
    case "zoom_in": return s.open ? { ...s, zoom: clampZoom(s.zoom + MAP_ZOOM.step) } : s;
    case "zoom_out": return s.open ? { ...s, zoom: clampZoom(s.zoom - MAP_ZOOM.step) } : s;
    default: return s;
  }
}

/** Whether the conversation is on screen: hidden on request, and always minimized while the map fills the screen. */
export const conversationShown = (map, chatHidden) => !chatHidden && !normalizeMapState(map).full;

/**
 * The view changes in the Hub's answer to a typed sentence: the map actions (show_company opens the map) and the conversation
 * (hidden true / false), in the order of the results. → { map: [action…], chat: boolean | null }.
 */
export function viewChangesOf(results = []) {
  const out = { map: [], chat: null };
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || r.refused || r.error) continue;
    if (r.intent === "show_company" || r.intent === "zoom") out.map.push("open");
    if (r.mapView && ACTIONS.has(r.mapView.action)) out.map.push(r.mapView.action);
    if (r.chatView && typeof r.chatView.hidden === "boolean") out.chat = r.chatView.hidden;
  }
  return out;
}

/**
 * A view sentence the Hub heard from the owner in THIS tab's Lega session comes as { type: "lega.view", sessionId, map?: { action },
 * chat?: { hidden } }. Only this session counts and only the exact shapes the Hub sends (a fresh object, nothing else carried).
 */
export function viewFromLiveEvent(event, currentSessionId) {
  if (!event || event.type !== "lega.view") return null;
  if (typeof currentSessionId !== "string" || !currentSessionId || event.sessionId !== currentSessionId) return null;
  const out = {};
  if (event.map && typeof event.map === "object" && ACTIONS.has(event.map.action)) out.map = event.map.action;
  if (event.chat && typeof event.chat === "object" && typeof event.chat.hidden === "boolean") out.chat = event.chat.hidden;
  return Object.keys(out).length ? out : null;
}

/** The zoom shown on the buttons, in percent. */
export const zoomLabel = (map) => `${Math.round(normalizeMapState(map).zoom * 100)}%`;

/** The L3ga screen is on display with its company map open (the per-browser preference `lega.map` of screens/Lega.jsx). Reads the browser. */
export function legaMapOnScreen() {
  if (typeof location === "undefined" || !String(location.hash || "").startsWith("#/lega")) return false;
  try { return normalizeMapState(JSON.parse(localStorage.getItem("hub.v2.lega.map") || "null")).open; } catch { return false; }
}
