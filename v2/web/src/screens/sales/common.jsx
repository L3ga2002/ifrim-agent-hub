import { useState, useCallback } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ShieldAlert, CircleDashed, Info, FlaskConical, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../api.js";
import { useAction, useResource } from "../../store.js";
import { Notice, ErrorNotice, Chip } from "../../components/ui.jsx";
import { ApprovalCard } from "../Approvals.jsx";
import { statusMeta, approvalFrom, isSalesEvent, OUTREACH_DISABLED_REASON } from "../../lib/salesLogic.js";

// Shared building blocks of the Sales screen. Everything here renders sales data as plain text (React escapes it);
// no raw HTML is ever injected, because imported rows and site excerpts are untrusted input.

const TONE_ICON = { ok: CheckCircle2, error: XCircle, warn: AlertTriangle, approval: ShieldAlert, info: Info, neutral: CircleDashed };

/** Status chip for a Sales lifecycle (org, opp, draft, proposal, batch, row, followup, audit, evidence): icon + Romanian text. */
export function SalesChip({ kind, status, title }) {
  const meta = statusMeta(kind, status);
  return <Chip tone={meta.tone} icon={TONE_ICON[meta.tone] || CircleDashed} title={title || (status ? String(status) : undefined)}>{meta.label}</Chip>;
}

/** The persistent "synthetic" marker on every synthetic record. */
export function SyntheticTag() {
  return <Chip tone="warn" icon={FlaskConical} title="Date fictive, generate pentru test">sintetic</Chip>;
}

/** Banner shown on every Sales tab while synthetic data exists (not dismissible on purpose). */
export function SyntheticBanner({ text }) {
  if (!text) return null;
  return <div className="synthetic-banner" role="note"><FlaskConical size={16} aria-hidden="true" /><span>{text}</span></div>;
}

export function OutreachNotice() {
  return <Notice tone="info" title="Comunicare: doar ciorne">{OUTREACH_DISABLED_REASON}</Notice>;
}

export function Tile({ label, value, tone = "" }) {
  return <div className={`stat-tile ${tone}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

/** Loads a Sales path and reloads it on sales.* events, sales.* commands and approval decisions. */
export function useSalesResource(path, deps = []) {
  return useResource(path, { reloadOn: isSalesEvent, deps });
}

/**
 * Runs a Sales mutation. A 202 answer (ALWAYS_ASK: rollback, proposal approval, …) is kept as `approval` and rendered by
 * <ApprovalGate>; otherwise `onSuccess(result, meta)` runs. Duplicate clicks are ignored while a request is in flight.
 */
export function useSalesCommand(onSuccess) {
  const [approval, setApproval] = useState(null);
  const action = useAction(useCallback(async (path, body = {}, meta) => {
    const result = await api(path, { method: "POST", body });
    const gate = approvalFrom(result);
    if (gate) { setApproval({ ...gate, meta }); return result; }
    await onSuccess?.(result, meta);
    return result;
  }, [onSuccess]));
  return { run: action.run, busy: action.pending, error: action.error, clearError: action.clearError, approval, clearApproval: () => setApproval(null) };
}

/**
 * The approval the Hub asked for, decided here or on the Aprobări screen. Approving starts exactly the stored command
 * (same flow as the Approvals card: decide with the displayed hash, then execute); voice can never approve.
 */
export function ApprovalGate({ gate, onDone, onDismiss }) {
  if (!gate?.approval) return null;
  return (
    <div className="stack tight sales-approval">
      <Notice tone="warn" title="Aprobare necesară">
        Acțiunea cere aprobarea ta de fiecare dată. Aprobarea e legată de amprenta afișată mai jos; o poți decide și din <a href="#/approvals">Aprobări</a>.
      </Notice>
      <ApprovalCard approval={gate.approval} onDone={() => { onDone?.(); }} />
      {onDismiss && <div><button type="button" className="btn sm ghost" onClick={onDismiss}>Ascunde (aprobarea rămâne în Aprobări)</button></div>}
    </div>
  );
}

/** Errors with a Sales-specific explanation for a missing API (server older than M04) or a missing record. */
export function SalesError({ error, onRetry, what = "înregistrarea" }) {
  if (!error) return null;
  if (error.status === 404) {
    // The router answers "Unknown endpoint" for a route that does not exist (a Hub older than M04).
    const missingApi = /unknown endpoint/i.test(error.message || "");
    return (
      <Notice tone="error" title={missingApi ? "Modulul Vânzări nu răspunde" : "Nu există"}>
        {missingApi ? "Serverul Hub nu are încă API-ul /api/sales (versiunea M04). Repornește Hub-ul după actualizare." : `Nu am găsit ${what}. Poate a fost unită cu altă firmă sau anulată la un rollback.`}
        {onRetry && <> <button type="button" className="btn sm ghost" onClick={onRetry}>Reîncearcă</button></>}
      </Notice>
    );
  }
  return <ErrorNotice error={error} onRetry={onRetry} />;
}

/** Previous/next paging with the "1–50 din 230" label. */
export function Pager({ info, onPage, busy = false }) {
  if (!info || info.total <= 0) return null;
  return (
    <nav className="sales-pager" aria-label="Paginare">
      <button type="button" className="btn sm" disabled={!info.hasPrev || busy} onClick={() => onPage(info.prevOffset)}><ChevronLeft size={14} aria-hidden="true" />Înapoi</button>
      <span className="faint small" aria-live="polite">{info.label} · pagina {info.page}/{info.pages}</span>
      <button type="button" className="btn sm" disabled={!info.hasNext || busy} onClick={() => onPage(info.nextOffset)}>Înainte<ChevronRight size={14} aria-hidden="true" /></button>
    </nav>
  );
}

/** A short list of problems (errors in red, warnings in amber), each with an icon so colour is not the only signal. */
export function Problems({ errors = [], warnings = [] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="sales-problems">
      {errors.map((e, i) => <li key={`e${i}`} className="err"><XCircle size={13} aria-hidden="true" /><span><span className="sr-only">Eroare: </span>{e}</span></li>)}
      {warnings.map((w, i) => <li key={`w${i}`} className="warn"><AlertTriangle size={13} aria-hidden="true" /><span><span className="sr-only">Avertisment: </span>{w}</span></li>)}
    </ul>
  );
}

/** Untrusted excerpt (site text, imported cell) shown verbatim as text, never interpreted. */
export function Excerpt({ children, label = "Fragment" }) {
  const text = String(children ?? "");
  if (!text) return null;
  return <blockquote className="sales-excerpt" aria-label={label}>{text}</blockquote>;
}

/** Date-time in Romanian, or a dash. */
export function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("ro-RO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A datetime-local input value for "now" in the browser's time zone. */
export function localNowInput(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local / date value → ISO, or null when empty/invalid. */
export function inputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
