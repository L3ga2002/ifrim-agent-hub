import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, XCircle, PauseCircle, Clock, ShieldAlert, X } from "lucide-react";

// Status vocabulary → (tone, icon, Romanian label). Tone is never the only signal: icon + text always.
const STATUS = {
  DRAFT: ["neutral", CircleDashed, "Ciornă"], QUEUED: ["info", Clock, "În coadă"], PLANNING: ["info", Loader2, "Planificare"],
  RUNNING: ["info", Loader2, "Rulează"], WAITING_APPROVAL: ["approval", ShieldAlert, "Așteaptă aprobare"], WAITING_PROVIDER: ["warn", Clock, "Așteaptă providerul"],
  BLOCKED: ["error", AlertTriangle, "Blocat"], PAUSED: ["neutral", PauseCircle, "Pauză"], VERIFYING: ["info", CircleDashed, "Verificare"],
  COMPLETED: ["ok", CheckCircle2, "Finalizat"], FAILED: ["error", XCircle, "Eșuat"], CANCELLED: ["neutral", XCircle, "Anulat"],
  ACTIVE: ["info", Loader2, "Activă"], ATTENTION: ["warn", AlertTriangle, "Necesită atenție"],
  running: ["info", Loader2, "rulează"], waiting_approval: ["approval", ShieldAlert, "așteaptă aprobare"], completed: ["ok", CheckCircle2, "terminat"],
  failed: ["error", XCircle, "eșuat"], blocked: ["error", AlertTriangle, "blocat"], interrupted: ["neutral", PauseCircle, "întrerupt"],
  interrupted_unknown: ["warn", AlertTriangle, "întrerupt (stare necunoscută)"], orphaned: ["warn", AlertTriangle, "orfan"], legacy: ["neutral", Clock, "istoric V1"],
  pending: ["approval", ShieldAlert, "în așteptare"], approved: ["ok", CheckCircle2, "aprobat"], rejected: ["error", XCircle, "respins"],
  expired: ["neutral", Clock, "expirat"], invalidated: ["error", XCircle, "invalidat"], consumed: ["neutral", CheckCircle2, "folosit"],
  verified: ["ok", CheckCircle2, "verificat"], incomplete: ["error", AlertTriangle, "incomplet"], verification_failed: ["error", XCircle, "verificare eșuată"],
  open: ["ok", CheckCircle2, "deschisă"], suspended: ["warn", PauseCircle, "suspendată"],
  in_progress: ["info", Loader2, "în lucru"], waiting: ["warn", Clock, "așteaptă"], ready: ["ok", CheckCircle2, "pregătit"], cancelled: ["neutral", XCircle, "anulat"],
  active: ["info", CheckCircle2, "activ"], retained: ["warn", AlertTriangle, "reținut"], exhausted: ["neutral", Clock, "epuizat"], revoked: ["neutral", XCircle, "revocat"],
  // Milestone 01: company, goals, objectives, schedules, surfaces, verifications, commands, skills, native sessions.
  planned: ["neutral", CircleDashed, "planificat"], paused: ["warn", PauseCircle, "în pauză"],
  AT_RISK: ["warn", AlertTriangle, "La risc"], ACHIEVED: ["ok", CheckCircle2, "Atins"], ABANDONED: ["neutral", XCircle, "Abandonat"],
  OPEN: ["info", CircleDashed, "Deschis"], IN_PROGRESS: ["info", Loader2, "În lucru"], MET: ["ok", CheckCircle2, "Atins"], MISSED: ["error", XCircle, "Ratat"], DROPPED: ["neutral", XCircle, "Renunțat"],
  RETIRED: ["neutral", XCircle, "Retrasă"], PROPOSED: ["neutral", CircleDashed, "Propusă"], PENDING_USER_SETUP: ["approval", Clock, "Așteaptă configurarea ta"],
  LINKED: ["ok", CheckCircle2, "Legată"], ORPHANED: ["warn", AlertTriangle, "Orfană"], DETACHED: ["neutral", XCircle, "Detașată"],
  available: ["ok", CheckCircle2, "disponibil"], assisted: ["info", Info, "asistat"], unavailable: ["error", XCircle, "indisponibil"], unknown: ["neutral", CircleDashed, "necunoscut"],
  plan_restricted: ["warn", ShieldAlert, "restricționat de plan"], rollout_pending: ["neutral", Clock, "lansare în curs"], needs_setup: ["warn", AlertTriangle, "necesită configurare"],
  PASS_LIVE: ["ok", CheckCircle2, "PASS live"], PASS_LOCAL: ["ok", CheckCircle2, "PASS local"], PASS_SIMULATED: ["info", CheckCircle2, "PASS simulat"], FAIL: ["error", XCircle, "FAIL"], NOT_RUN: ["neutral", CircleDashed, "nerulat"],
  SUPPORTED: ["ok", CheckCircle2, "suportat"], ASSISTED: ["info", Info, "asistat"], PLANNED: ["neutral", Clock, "planificat"], UNSUPPORTED: ["neutral", XCircle, "nesuportat"],
  accepted: ["info", Clock, "acceptată"], pending_approval: ["approval", ShieldAlert, "așteaptă aprobare"], executed: ["ok", CheckCircle2, "executată"],
  invalid: ["error", XCircle, "invalid"], idle: ["neutral", PauseCircle, "inactivă"], ended: ["neutral", CheckCircle2, "încheiată"], connected: ["ok", CheckCircle2, "conectat"],
  starting: ["info", Loader2, "pornește"], lost: ["warn", AlertTriangle, "pierdută"], closed: ["neutral", CheckCircle2, "închisă"],
  unverified: ["warn", AlertTriangle, "neverificat"], proposed: ["neutral", CircleDashed, "propusă"], superseded: ["neutral", Clock, "înlocuită"],
  DOCUMENTED: ["neutral", Info, "documentat"], ACCOUNT_ELIGIBLE: ["info", CheckCircle2, "cont eligibil"], AUTHENTICATED: ["info", CheckCircle2, "autentificat"],
  IMPLEMENTED: ["info", CheckCircle2, "implementat"], TESTED_LIVE: ["ok", CheckCircle2, "testat live"], TESTED_SIMULATED: ["info", CheckCircle2, "testat simulat"], ASSISTED_ONLY: ["warn", Info, "doar asistat"],
};

export function StatusChip({ status, label }) {
  const [tone, Icon, text] = STATUS[status] || (String(status || "").startsWith("legacy") ? ["neutral", Clock, `V1: ${String(status).replace("legacy_", "")}`] : ["neutral", Info, status || "—"]);
  return <span className={`chip ${tone}`}><Icon aria-hidden="true" />{label || text}</span>;
}

export function Chip({ tone = "neutral", icon: Icon, children, title }) {
  return <span className={`chip ${tone}`} title={title}>{Icon && <Icon aria-hidden="true" />}{children}</span>;
}

export function Empty({ title, children, action }) {
  return <div className="empty"><strong>{title}</strong>{children && <span>{children}</span>}{action}</div>;
}

export function Notice({ tone = "info", children, title }) {
  const Icon = tone === "error" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}><Icon size={16} aria-hidden="true" /><div>{title && <strong>{title}. </strong>}{children}</div></div>;
}

export function ErrorNotice({ error, onRetry }) {
  if (!error) return null;
  const offline = error.status === 0;
  return (
    <Notice tone="error" title={offline ? "Offline" : error.category === "gate" ? "Refuzat de poartă" : error.category === "policy" ? "Permisiune refuzată" : "Eroare"}>
      {error.message}{onRetry && <> <button className="btn sm ghost" onClick={onRetry}>Reîncearcă</button></>}
    </Notice>
  );
}

export function Loading({ lines = 3 }) {
  return <div className="stack tight" aria-busy="true" aria-label="Se încarcă">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 18}%` }} />)}</div>;
}

export function Panel({ title, icon: Icon, actions, children, flush, className = "", id }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={id ? `${id}-h` : undefined}>
      {(title || actions) && (
        <header className="panel-head">
          <h2 id={id ? `${id}-h` : undefined}>{Icon && <Icon size={16} aria-hidden="true" />}{title}</h2>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Dialog({ title, onClose, children, footer, labelledBy = "dialog-title" }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // Runs once per opening: focus the first field, trap Tab, restore focus on close.
    const previous = document.activeElement;
    const node = ref.current;
    node?.querySelector("input, textarea, select, button:not([data-close])")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && node) {
        const focusable = [...node.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled);
        if (!focusable.length) return;
        const first = focusable[0]; const last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="dialog-head"><h2 id={labelledBy}>{title}</h2><button className="btn icon ghost" data-close onClick={onClose} aria-label="Închide"><X size={18} /></button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Gate/billing check list with pass/fail icon + text. */
export function Checks({ checks = [] }) {
  return (
    <ul className="checks">
      {checks.map((c) => {
        const ok = c.ok ?? c.status === "verified";
        const unverified = c.status === "unverified";
        return (
          <li key={c.id}>
            {ok ? <CheckCircle2 size={15} color="var(--ok)" aria-label="trecut" /> : unverified ? <AlertTriangle size={15} color="var(--approval)" aria-label="neverificat" /> : <XCircle size={15} color="var(--danger)" aria-label="eșuat" />}
            <span className="id">{c.id}</span>
            <span className="detail">{c.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DiffView({ diff }) {
  if (!diff) return <Empty title="Fără modificări">Arborele de lucru nu are diferențe urmărite.</Empty>;
  return (
    <pre className="pre diff" aria-label="Diff">
      {diff.split("\n").slice(0, 3000).map((line, i) => (
        <div key={i} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : undefined}>{line || " "}</div>
      ))}
    </pre>
  );
}
