import { useState } from "react";
import { CirclePause, CircleStop, CircleHelp, Circle, Loader2, ShieldAlert, OctagonAlert, RotateCcw, CheckCircle2, History, TimerOff, Archive, Copy, Check, ChevronRight, ChevronDown } from "lucide-react";
import { STATES, MEANINGS } from "../lib/stateVocab.js";

const ICONS = { ready: Circle, run: Loader2, decide: ShieldAlert, block: OctagonAlert, error: RotateCcw, done: CheckCircle2, stale: History, expired: TimerOff, closed: Archive, paused: CirclePause, stopping: CircleStop, unknown: CircleHelp };

/** M15: one work state — its word, its icon and its colour together (never colour alone). `text` replaces the word, never the state. */
export function StatePill({ state = "ready", status, text, title }) {
  const key = STATES[state] ? state : "unknown";
  const Icon = ICONS[key];
  const showRawStatus = key === "unknown" && status !== undefined;
  return <span className={`state-pill st-${key}`} title={showRawStatus ? STATES[key].hint : title || STATES[key].hint} data-state={key}><Icon size={12} aria-hidden="true" />{showRawStatus ? `${STATES[key].label} · ${String(status || "").slice(0, 40) || "fără stare"}` : text || STATES[key].label}</span>;
}

/** M15: the meaning of a decision already made (approved internally, accepted by the client, …): outlined, never a work state. */
export function MeaningChip({ meaning, text }) {
  const m = MEANINGS[meaning];
  if (!m) return null;
  return <span className={`meaning-chip mn-${meaning}`} title={m.says}><span className="mn-mark" aria-hidden="true" />{text || m.label}</span>;
}

function CopyButton({ value, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }
    catch { /* the clipboard is not available: the value stays selectable */ }
  };
  return <button type="button" className="btn sm icon ghost" onClick={copy} aria-label={`Copiază ${label}`} title={`Copiază ${label}`}>{done ? <Check size={13} /> : <Copy size={13} />}</button>;
}

/**
 * M15: the exact target of a decision, in full, before the confirmation: every id and SHA as text you can select and copy. Showing them
 * changes nothing: the decision's own request still sends the displayed values and the Hub refuses a target that changed.
 */
export function TargetDetails({ items = [], note = "Confirmarea e legată de aceste valori. Dacă ținta se schimbă înainte să confirmi, Hub-ul o refuză și îți arată versiunea nouă.", open = false }) {
  const [expanded, setExpanded] = useState(open);
  const rows = items.filter((x) => x && x.value);
  if (!rows.length) return null;
  return (
    <div className="target-details">
      <button type="button" className="btn sm ghost" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Ținta exactă (ID și SHA complete)</button>
      {expanded && (
        <div className="target-box">
          {rows.map((x) => (
            <div key={`${x.label}:${x.value}`} className="target-row"><span className="faint small">{x.label}</span><code className="mono">{x.value}</code><CopyButton value={String(x.value)} label={x.label} /></div>
          ))}
          {note && <p className="faint small" style={{ margin: 0 }}>{note}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * M15: what a decision is about, in the same four lines everywhere — the object, its version, the action of the button and its
 * consequence — plus what does NOT happen. Read-only text next to the decision's own button.
 */
export function DecisionFacts({ object, version, action, consequence, never }) {
  return (
    <dl className="decision-facts">
      {object && <><dt>Obiect</dt><dd>{object}</dd></>}
      {version && <><dt>Versiune</dt><dd>{version}</dd></>}
      {action && <><dt>Acțiune</dt><dd>{action}</dd></>}
      {consequence && <><dt>Consecință</dt><dd>{consequence}</dd></>}
      {never && <><dt>Nu se întâmplă</dt><dd>{never}</dd></>}
    </dl>
  );
}
