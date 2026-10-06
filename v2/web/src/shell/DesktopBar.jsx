import { Fragment, useEffect, useRef, useState } from "react";
import { MonitorCog, Square, Hand, Play, X } from "lucide-react";
import { api } from "../api.js";
import { useHub, useResource, onLive, pushToast, refresh } from "../store.js";
import { withReauth } from "../lib/ownerSession.js";
import { desktopBarState } from "../lib/opsLogic.js";
import { rearmRequiredOf, rearmOutcome } from "../lib/rearmLogic.js";
import { Notice } from "../components/ui.jsx";
import { RearmCard } from "../screens/lega/RearmCard.jsx";

/**
 * M10: the permanent activity bar of the Desktop Operator. Whenever the operator works in an application (or a plan runs / waits),
 * it says where and what, with Stop and „Preiau eu” always one click away (fail-safe: they work without a session and never close an
 * application). „Continuă” appears only when the operator waits for you, and the Hub verifies the state again before any step.
 * 2.12.1 (D22): what the current Stop All itself paused resumes only after the rearm — the Hub refuses „Continuă” with
 * GATE_REARM_REQUIRED and the same rearm card opens right under the bar (outside its live region); the rearm restarts nothing.
 */
export function DesktopBar({ go }) {
  const status = useResource("/api/desktop/status", { reloadOn: (e) => e.type.startsWith("desktop.") || e.type.startsWith("ops.") });
  const [current, setCurrent] = useState(null);
  const [rearmNeed, setRearmNeed] = useState(null); // { reason, trigger, handled }
  const rearmSeq = useRef(0);
  const gateStatus = useHub((s) => s.hub?.executionGate?.status || null);
  useEffect(() => onLive((e) => { if (e.type === "desktop.activity") setCurrent(e.data || null); }), []);
  useEffect(() => { if (gateStatus === "open") setRearmNeed(null); }, [gateStatus]);
  const data = status.data ? { ...status.data, current: current ?? status.data.current } : null;
  const bar = desktopBarState(data);
  if (!bar.visible) return null;
  const call = async (path, label, reauth = false) => {
    try { await (reauth ? withReauth(() => api(path, { method: "POST", body: {} })) : api(path, { method: "POST", body: { reason: label } })); status.reload(); }
    catch (e) {
      const need = reauth ? rearmRequiredOf(e) : null;
      if (need) { setRearmNeed({ reason: need.reason, trigger: ++rearmSeq.current, handled: 0 }); return; }
      pushToast("desktop-bar", "error", e.message);
    }
  };
  const waitingPlan = (data.plans || []).find((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status));
  return (
    <Fragment>
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
      {rearmNeed && bar.canResume && (
        <div className="desktop-bar-rearm">
          <div className="row"><button className="btn sm icon ghost" onClick={() => setRearmNeed(null)} aria-label="Ascunde cardul de redeschidere"><X size={13} /></button></div>
          <Notice tone="warn" title="Întâi redeschiderea porții">{rearmNeed.reason}</Notice>
          <RearmCard compact trigger={rearmNeed.trigger} handled={rearmNeed.handled}
            onTriggerHandled={(seq) => setRearmNeed((r) => (r ? { ...r, handled: Math.max(r.handled || 0, seq) } : r))}
            onDone={(res) => { pushToast("gate-rearm", "ok", `${rearmOutcome(res).toast} Ce era oprit reiei cu „Continuă”.`); setRearmNeed(null); status.reload(); refresh(); }} />
        </div>
      )}
    </Fragment>
  );
}
