import { useEffect, useState } from "react";
import { MonitorCog, Square, Hand, Play } from "lucide-react";
import { api } from "../api.js";
import { useResource, onLive, pushToast } from "../store.js";
import { withReauth } from "../lib/ownerSession.js";
import { desktopBarState } from "../lib/opsLogic.js";

/**
 * M10: the permanent activity bar of the Desktop Operator. Whenever the operator works in an application (or a plan runs / waits),
 * it says where and what, with Stop and „Preiau eu” always one click away (fail-safe: they work without a session and never close an
 * application). „Continuă” appears only when the operator waits for you, and the Hub verifies the state again before any step.
 */
export function DesktopBar({ go }) {
  const status = useResource("/api/desktop/status", { reloadOn: (e) => e.type.startsWith("desktop.") || e.type.startsWith("ops.") });
  const [current, setCurrent] = useState(null);
  useEffect(() => onLive((e) => { if (e.type === "desktop.activity") setCurrent(e.data || null); }), []);
  const data = status.data ? { ...status.data, current: current ?? status.data.current } : null;
  const bar = desktopBarState(data);
  if (!bar.visible) return null;
  const call = async (path, label, reauth = false) => {
    try { await (reauth ? withReauth(() => api(path, { method: "POST", body: {} })) : api(path, { method: "POST", body: { reason: label } })); status.reload(); }
    catch (e) { pushToast("desktop-bar", "error", e.message); }
  };
  const waitingPlan = (data.plans || []).find((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status));
  return (
    <div className={`desktop-bar tone-${bar.tone}`} role="status" aria-live="polite">
      <MonitorCog size={15} aria-hidden="true" />
      <span className="desktop-bar-text">{bar.text}</span>
      <span className="row">
        {bar.canStop && <button className="btn sm danger" onClick={() => call("/api/desktop/stop", "Stop (bara desktop)")}><Square size={12} fill="currentColor" aria-hidden="true" />Stop</button>}
        {bar.canTakeover && <button className="btn sm" onClick={() => call("/api/desktop/takeover", "Preiau eu")}><Hand size={13} aria-hidden="true" />Preiau eu</button>}
        {bar.canResume && <button className="btn sm primary" onClick={() => (waitingPlan ? call(`/api/ops/plans/${waitingPlan.id}/resume`, "Continuă", true) : call("/api/desktop/resume", "Continuă", true))}><Play size={13} aria-hidden="true" />Continuă</button>}
        <button className="btn sm ghost" onClick={() => go("/desktop")}>Detalii</button>
      </span>
    </div>
  );
}
