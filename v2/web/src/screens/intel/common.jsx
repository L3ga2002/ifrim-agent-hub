import { useState } from "react";
import { api } from "../../api.js";
import { useResource, pushToast, refresh } from "../../store.js";
import { withReauth } from "../../lib/ownerSession.js";
import { Notice } from "../../components/ui.jsx";

/** Reloads on the M08 events of a family (incident.*, autopilot.*, board.*, …) and on the changes they depend on. */
export function useIntel(path, prefixes = []) {
  return useResource(path, { reloadOn: (e) => !e.type.startsWith("run.activity") && (prefixes.some((p) => e.type.startsWith(p)) || e.type === "settings.changed") });
}

/**
 * A POST from the owner's interface. The Hub decides the channel from the session cookie (owner) or treats it as the UI (which
 * refuses what adds authority); when the Hub asks for a fresh Windows Hello check, the ceremony runs once and the call repeats.
 */
export async function post(path, body = {}, { toast = null, reauth = true } = {}) {
  const run = () => api(path, { method: "POST", body });
  const out = reauth ? await withReauth(run) : await run();
  if (toast) pushToast(`intel-${path}`, "ok", toast);
  refresh();
  return out;
}

/** Small async-button state: one click at a time, error kept next to the button. */
export function useRun() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (key, fn) => {
    if (busy) return undefined;
    setBusy(key); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(null); }
  };
  return { busy, error, run, clear: () => setError(null) };
}

export const SimBadge = ({ children = "SIMULARE" }) => <span className="chip info sim-badge" title="Scenariu calculat; nu schimbă nimic real">{children}</span>;

export function SourceNote({ children }) { return <p className="faint small src">{children}</p>; }

/** Unknowns are shown, never filled in. */
export function Unknowns({ items }) {
  if (!items?.length) return null;
  return <Notice tone="info" title="Nu știu (lipsește din date)">{items.join(" · ")}</Notice>;
}

export function ProjectSelect({ value, onChange, label = "Proiect", allowEmpty = false, inline = false }) {
  const projects = useResource("/api/projects");
  return (
    <label className={`field${inline ? " inline" : ""}`}><span>{label}</span>
      <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">— toate / niciunul —</option>}
        {!allowEmpty && !value && <option value="">— alege —</option>}
        {(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.source === "hub-test" ? " (test)" : ""}</option>)}
      </select>
    </label>
  );
}
