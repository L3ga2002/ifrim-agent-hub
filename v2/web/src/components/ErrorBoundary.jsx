import { Component } from "react";
import { getState } from "../store.js";
import { Notice } from "./ui.jsx";

const RELOAD_KEY = "hub.chunkReloadAt";
const RELOAD_GUARD_MS = 60000;

/**
 * After the UI is rebuilt while a page is open, the old page asks for code files that no longer exist
 * ("Failed to fetch dynamically imported module", Vite chunk hashes). Only a reload fixes it.
 */
export function isChunkLoadError(error) {
  const text = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(text);
}

/** Reloads once for a stale build, never while a Lega voice session runs (a reload would cut the owner off mid-sentence). */
function tryAutoReload() {
  const lega = getState()?.legaStatus;
  if (lega && lega !== "off") return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false; // already tried: show the button instead of a reload loop
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { return false; }
  window.location.reload();
  return true;
}

/**
 * Contains a render/effect error to one part of the UI so the shell (navigation, Stop All, connection state) keeps
 * working. `resetKey` clears the error when it changes (e.g. the route); `fallback(error, reset)` renders instead.
 * Found in M02 visual review: without a boundary, one thrown error blanked the whole application.
 * A stale-build error (see isChunkLoadError) reloads the page once, or offers the reload when that is not safe now.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: props.resetKey };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error) {
    // The message only: component stacks can be long and never contain more than the thrown text we already show.
    console.error(`[ui] ${this.props.label || "component"} failed: ${error?.message || error}`);
    if (isChunkLoadError(error) && tryAutoReload()) return;
    this.props.onError?.(error);
  }

  render() {
    const { error } = this.state;
    if (error && isChunkLoadError(error) && this.props.label === "screen") {
      return (
        <div className="page"><Notice tone="info" title="Hub-ul a fost actualizat">
          Pagina folosește încă versiunea veche a interfeței.{" "}
          <button className="btn sm primary" onClick={() => window.location.reload()}>Reîncarcă pagina</button>
          {getState()?.legaStatus && getState().legaStatus !== "off" ? <span className="faint small"> Reîncărcarea oprește sesiunea Lega activă.</span> : null}
        </Notice></div>
      );
    }
    if (error) return this.props.fallback ? this.props.fallback(error, this.reset) : null;
    return this.props.children;
  }
}
