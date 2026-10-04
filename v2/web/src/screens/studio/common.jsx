import { useState } from "react";
import { api } from "../../api.js";
import { useResource, pushToast } from "../../store.js";
import { withReauth } from "../../lib/ownerSession.js";
import { Notice, Chip } from "../../components/ui.jsx";
import { limitationTone } from "../../lib/studioLogic.js";

/** Reloads on the media / content events (and settings changes such as mediaPolicy); live progress comes separately (onLive). */
export function useStudio(path, prefixes = ["media.", "content."]) {
  return useResource(path, { reloadOn: (e) => !e.type.startsWith("run.activity") && (prefixes.some((p) => e.type.startsWith(p)) || e.type === "settings.changed") });
}

/**
 * A POST from the Studio. The Hub decides the channel from the owner-session cookie (owner) or treats it as the UI; owner-only
 * decisions (`owner: true`) run the Windows Hello ceremony once when the Hub asks for a (fresh) session, then repeat the call.
 * Everything else is sent as is: a refusal is shown, never retried with more authority.
 */
export async function studioPost(path, body = {}, { owner = false, toast = null } = {}) {
  const run = () => api(path, { method: "POST", body });
  const out = owner ? await withReauth(run) : await run();
  if (toast) pushToast(`studio-${path}`, "ok", toast);
  return out;
}

/** One action at a time per component; the error stays next to the buttons. */
export function useBusy() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (key, fn) => {
    if (busy) return undefined;
    setBusy(key); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(null); }
  };
  return { busy, error, run, clear: () => setError(null) };
}

/** What the Studio cannot do right now, from /api/media/status (or a detail that carries `limitations`). Never hidden. */
export function Limitations({ items, compact = false }) {
  if (!Array.isArray(items) || !items.length) return null;
  if (compact) {
    return (
      <ul className="studio-limits compact" aria-label="Limitări active">
        {items.map((l) => <li key={l.code}><Chip tone={limitationTone(l.code)} title={l.text}>{l.code}</Chip></li>)}
      </ul>
    );
  }
  // One notice for all of them (warn when any is a warning), each limitation on its own line with its code.
  const tone = items.some((l) => limitationTone(l.code) === "warn") ? "warn" : "info";
  return (
    <div className="studio-limits" aria-label="Limitări active">
      <Notice tone={tone} title="Ce nu face Studio acum">
        <ul className="studio-limit-list">{items.map((l) => <li key={l.code}><code className="mono">{l.code}</code> {l.text}</li>)}</ul>
      </Notice>
    </div>
  );
}

/** A hash prefix that names its kind (sha256 shown short, full value on hover and for screen readers). */
export function Hash({ value, n = 12 }) {
  if (!value) return <span className="faint">—</span>;
  return <code className="mono studio-hash" title={value} aria-label={`sha256 ${value}`}>{String(value).slice(0, n)}…</code>;
}

/** Tone + label maps from studioLogic rendered as a chip (icon-free; the text always says the state). */
export function StateChip({ map, value }) {
  const [tone, label] = map[value] || ["neutral", value || "—"];
  return <Chip tone={tone}>{label}</Chip>;
}

export const errText = (e) => (e ? String(e.message || e) : "");
