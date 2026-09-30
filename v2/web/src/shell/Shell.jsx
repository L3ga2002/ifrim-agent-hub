import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Square, ShieldCheck, Pause, CircleDot, X, MoreHorizontal, Plus, HardDrive, RefreshCw, WifiOff } from "lucide-react";
import { NAV } from "../nav.js";
import { useHub, dismissToast, refresh, pushToast } from "../store.js";
import { api } from "../api.js";
import { Chip, Dialog } from "../components/ui.jsx";
import { VoiceControl } from "./Voice.jsx";

function StopAllButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const active = useHub((s) => s.hub?.activeRuns?.length || 0);
  const run = async () => {
    setBusy(true);
    try { setResult(await api("/api/stop-all", { method: "POST", body: { reason: "Stop All (UI)" } })); refresh(); }
    catch (error) { setResult({ error: error.message }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn danger sm" onClick={() => { setResult(null); setOpen(true); }} title="Oprește lucrul nou și întrerupe execuțiile controlabile">
        <Square size={14} fill="currentColor" aria-hidden="true" /><span className="hide-mobile">Stop All</span>
      </button>
      {open && (
        <Dialog title="Stop All" onClose={() => setOpen(false)} footer={result ? <button className="btn" onClick={() => setOpen(false)}>Închide</button> : (
          <><button className="btn ghost" onClick={() => setOpen(false)}>Renunță</button><button className="btn danger" disabled={busy} onClick={run}>{busy ? "Se oprește…" : "Oprește tot"}</button></>
        )}>
          {!result && <p className="muted" style={{ margin: 0 }}>Suspendă poarta de execuție, revocă granturile de validare live și întrerupe {active} execuți{active === 1 ? "e activă" : "i active"}. Nu șterge nimic.</p>}
          {result?.error && <p className="muted">{result.error}</p>}
          {result && !result.error && (
            <dl className="kv">
              <dt>Poartă</dt><dd>{result.gate}</dd>
              <dt>Întrerupte</dt><dd>{result.interrupted.length ? result.interrupted.map((r) => `${r.provider} ${r.runId.slice(-6)} (${r.interrupted ? "confirmat" : "neconfirmat"})`).join(", ") : "nicio execuție activă"}</dd>
              <dt>Taskuri cloud</dt><dd>{result.cloudTasksUnconfirmed.length ? result.cloudTasksUnconfirmed.join(", ") : "niciunul pornit de Hub"}</dd>
              <dt>Efecte ireversibile</dt><dd>{result.irreversibleEffects.length ? result.irreversibleEffects.join(", ") : "niciunul înregistrat"}</dd>
            </dl>
          )}
        </Dialog>
      )}
    </>
  );
}

function StatusChips() {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  if (!hub) return null;
  const gate = hub.executionGate?.status;
  return (
    <div className="row" style={{ gap: 6 }}>
      <Chip tone={hub.mode === "BUILD_SAFE" ? "info" : "warn"} icon={CircleDot} title="Modul de lucru al Hub-ului">{hub.mode}</Chip>
      <Chip tone={gate === "open" ? "ok" : "warn"} icon={gate === "open" ? ShieldCheck : Pause} title={hub.executionGate?.reason}><span className="hide-xs">Poartă </span>{gate === "open" ? "deschisă" : "suspendată"}</Chip>
      {hub.providers?.map((p) => (
        <span key={p.id} className="hide-narrow">
          <Chip tone={p.route?.allowed ? "ok" : p.installation?.installed === false ? "error" : "neutral"} title={p.route?.allowed ? "Rută inclusă în abonament verificată" : (p.route?.blockingReasons || []).join("\n")}>
            {p.id === "codex" ? "Codex" : "Claude"} · {p.route?.allowed ? "verificat" : "neverificat"}
          </Chip>
        </span>
      ))}
      {connection !== "live" && <Chip tone="warn" icon={WifiOff} title="Fluxul de evenimente se reconectează; datele se reîncarcă automat"><span className="hide-mobile">{connection === "reconnecting" ? "Reconectare…" : "Conectare…"}</span><span className="sr-only">conexiune în curs</span></Chip>}
    </div>
  );
}

function CommandPalette({ onClose, go }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const items = useMemo(() => {
    const actions = [
      ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Deschide ${n.long}`, icon: n.icon, run: () => go(`/${n.id}`), hint: n.key ? `Alt+${n.key}` : "" })),
      { id: "new-conv", label: "Conversație nouă", icon: Plus, run: () => go("/conversations?new=1") },
      { id: "new-mission", label: "Misiune nouă", icon: Plus, run: () => go("/missions?new=1") },
      { id: "backup", label: "Backup verificat acum (Agent Hub)", icon: HardDrive, run: async () => { try { await api("/api/backups", { method: "POST", body: { projectId: "ifrim-agent-hub" } }); } catch (e) { pushToast("backup-error", "error", e.message); } } },
      { id: "refresh", label: "Reîncarcă starea", icon: RefreshCw, run: () => refresh() },
      ...(query.trim().length > 1 ? [{ id: "memory-search", label: `Caută în memorie: „${query.trim()}”`, icon: Search, run: () => go(`/memory?q=${encodeURIComponent(query.trim())}`) }] : []),
    ];
    const q = query.trim().toLowerCase();
    return q ? actions.filter((a) => a.id === "memory-search" || a.label.toLowerCase().includes(q)) : actions;
  }, [query, go]);
  useEffect(() => setIndex(0), [query]);
  const choose = (item) => { onClose(); item?.run(); };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Command palette">
        <input className="palette-input" autoFocus placeholder="Caută o comandă sau un ecran…" value={query} aria-label="Comandă"
          aria-controls="palette-list" aria-activedescendant={items[index] ? `pal-${items[index].id}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") choose(items[index]);
          }} />
        <ul className="palette-list" id="palette-list" role="listbox">
          {items.map((item, i) => (
            <li key={item.id}>
              <button id={`pal-${item.id}`} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => choose(item)}>
                <item.icon size={16} aria-hidden="true" /><span className="grow">{item.label}</span>{item.hint && <span className="kbd">{item.hint}</span>}
              </button>
            </li>
          ))}
          {!items.length && <li className="empty">Nicio comandă.</li>}
        </ul>
      </div>
    </div>
  );
}

function Toasts({ go }) {
  const toasts = useHub((s) => s.toasts);
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = setTimeout(() => { const oldest = toasts[0]; if (Date.now() - oldest.at > 7000 && oldest.level !== "approval") dismissToast(oldest.id); }, 7500);
    return () => clearTimeout(timer);
  }, [toasts]);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`}>
          <div className="grow">
            <strong>{t.text}{t.count > 1 ? ` ×${t.count}` : ""}</strong>
            {t.event?.payload?.message && <div className="muted ellipsis">{t.event.payload.message}</div>}
            {t.level === "approval" && <button className="btn sm approve" style={{ marginTop: 8 }} onClick={() => { go("/approvals"); dismissToast(t.id); }}>Vezi aprobările</button>}
          </div>
          <button className="btn sm icon ghost" onClick={() => dismissToast(t.id)} aria-label="Închide notificarea"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

const NO_RUNS = [];

function ActiveControl({ go }) {
  const runs = useHub((s) => s.hub?.activeRuns) || NO_RUNS;
  const [busy, setBusy] = useState(false);
  if (!runs.length) return null;
  const first = runs[0];
  return (
    <div className="control-indicator" role="status">
      <span className="pulse-dot" aria-hidden="true" />
      <span><strong>{first.provider === "codex" ? "Codex" : "Claude"}</strong> lucrează{runs.length > 1 ? ` (+${runs.length - 1})` : ""}</span>
      <button className="btn sm" onClick={() => go(`/conversations/${first.conversationId}`)}>Deschide</button>
      <button className="btn sm danger" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/runs/${first.runId}/interrupt`, { method: "POST", body: {} }); } catch (e) { pushToast("interrupt", "error", e.message); } finally { setBusy(false); } }}>Întrerupe</button>
    </div>
  );
}

export function Shell({ route, go, children }) {
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const pending = useHub((s) => s.hub?.pendingApprovals || 0);
  const mainRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
      if (e.altKey && /^[1-9]$/.test(e.key)) { const item = NAV.find((n) => n.key === e.key); if (item) { e.preventDefault(); go(`/${item.id}`); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  const current = route.name === "focus" ? "conversations" : route.name;
  const mobileNav = ["control", "conversations", "missions", "approvals"];
  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Sari la conținut</a>
      <header className="topbar">
        <div className="brand"><img src="/favicon.svg" alt="" className="brand-mark" /><span className="hide-mobile">Ifrim Agent Hub</span></div>
        <StatusChips />
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => setPalette(true)} aria-label="Căutare și comenzi (Ctrl+K)"><Search size={15} /><span className="hide-mobile">Caută</span><span className="kbd hide-mobile">Ctrl K</span></button>
        <VoiceControl go={go} />
        <StopAllButton />
      </header>
      <nav className="rail" aria-label="Navigare principală">
        {NAV.map((item) => (
          <a key={item.id} href={`#/${item.id}`} aria-current={current === item.id ? "page" : undefined} title={item.key ? `${item.long} (Alt+${item.key})` : item.long}>
            <item.icon size={19} aria-hidden="true" />{item.label}
            {item.id === "approvals" && pending > 0 && <span className="badge" aria-label={`${pending} în așteptare`}>{pending}</span>}
          </a>
        ))}
      </nav>
      <main className="main" id="main" tabIndex={-1} ref={mainRef}>{children}</main>
      <nav className="bottom-nav" aria-label="Navigare mobilă">
        {mobileNav.map((id) => { const item = NAV.find((n) => n.id === id); return (
          <a key={id} href={`#/${id}`} aria-current={current === id ? "page" : undefined}>
            <item.icon size={20} aria-hidden="true" />{item.label}
            {id === "approvals" && pending > 0 && <span className="badge">{pending}</span>}
          </a>
        ); })}
        <button onClick={() => setMore(true)} aria-label="Mai multe ecrane"><MoreHorizontal size={20} aria-hidden="true" />Mai mult</button>
      </nav>
      {more && (
        <Dialog title="Ecrane" onClose={() => setMore(false)}>
          <ul className="list">
            {NAV.filter((n) => !mobileNav.includes(n.id)).map((n) => (
              <li key={n.id}><a className="list-row" href={`#/${n.id}`} onClick={() => setMore(false)}><n.icon size={18} aria-hidden="true" /><span className="title">{n.long}</span></a></li>
            ))}
          </ul>
        </Dialog>
      )}
      {palette && <CommandPalette onClose={() => setPalette(false)} go={go} />}
      <ActiveControl go={go} />
      <Toasts go={go} />
    </div>
  );
}

