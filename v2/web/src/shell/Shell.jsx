import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Square, ShieldCheck, Pause, CircleDot, X, MoreHorizontal, Plus, HardDrive, RefreshCw, WifiOff, Wifi, FlaskConical, Minimize2, FolderGit2, Target, Keyboard, MessageSquare } from "lucide-react";
import { NAV } from "../nav.js";
import { useHub, dismissToast, refresh, pushToast, usePref, useResource } from "../store.js";
import { api, fmt } from "../api.js";
import { Chip, Dialog, Notice } from "../components/ui.jsx";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { VoiceControl } from "./Voice.jsx";
import { Lega } from "./Lega.jsx";
import { Spotlight } from "./Spotlight.jsx";
import { LegaStage, useStageToggle } from "../screens/stage/LegaStage.jsx";
import { Core3D } from "../components/core/Core3D.jsx";
import { deriveCoreState, CORE_VISUALS } from "../lib/coreState.js";
import { appShortcutKey } from "../lib/uiLogic.js";

/** Stop All: available in the top bar, the mini assistant and the mobile nav; shows only backend-confirmed results. */
export function StopAllButton({ compact = false, className = "" }) {
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
      <button className={`btn danger sm ${className}`} data-lega-target="stop-all" onClick={() => { setResult(null); setOpen(true); }} title="Oprește lucrul nou și întrerupe execuțiile controlabile" aria-label="Stop All">
        <Square size={14} fill="currentColor" aria-hidden="true" />{!compact && <span className="hide-mobile">Stop All</span>}
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
              <dt>Întrerupte</dt><dd>{result.interrupted.length ? result.interrupted.map((r) => `${r.provider} ${r.runId.slice(-6)} (${r.interrupted ? "confirmat" : "neconfirmat — în așteptare"})`).join(", ") : "nicio execuție activă"}</dd>
              <dt>Taskuri cloud</dt><dd>{result.cloudTasksUnconfirmed.length ? result.cloudTasksUnconfirmed.join(", ") : "niciunul pornit de Hub"}</dd>
              <dt>Efecte ireversibile</dt><dd>{result.irreversibleEffects.length ? result.irreversibleEffects.join(", ") : "niciunul înregistrat"}</dd>
            </dl>
          )}
        </Dialog>
      )}
    </>
  );
}

function ConnectionChip() {
  const connection = useHub((s) => s.connection);
  const lastUpdate = useHub((s) => s.lastUpdate);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const last = lastUpdate ? fmt.ago(new Date(lastUpdate).toISOString()) : "niciodată";
  if (connection === "live") return <span className="conn live" title={`Flux de evenimente conectat · ultima actualizare ${last}`}><Wifi size={13} aria-hidden="true" /><span className="hide-mobile">live · {last}</span><span className="sr-only">conectat</span></span>;
  return <span className="conn down" role="status" title="Fluxul se reconectează și reia evenimentele lipsă de la ultimul eveniment primit; indicatorul verde nu apare până la confirmare"><WifiOff size={13} aria-hidden="true" /><span>{connection === "reconnecting" ? "Reconectare…" : "Conectare…"}</span><span className="hide-mobile faint">ultima actualizare {last}</span></span>;
}

function StatusChips() {
  const hub = useHub((s) => s.hub);
  if (!hub) return null;
  const gate = hub.executionGate?.status;
  return (
    <div className="row status-chips">
      <Chip tone={hub.mode === "BUILD_SAFE" ? "info" : "warn"} icon={CircleDot} title="Modul de lucru al Hub-ului">{hub.mode}</Chip>
      <span className="hide-xs"><Chip tone={gate === "open" ? "ok" : "neutral"} icon={gate === "open" ? ShieldCheck : Pause} title={hub.executionGate?.reason}>poartă {gate === "open" ? "deschisă" : "suspendată"}</Chip></span>
      <ConnectionChip />
    </div>
  );
}

function ProjectSwitcher({ go }) {
  const { data } = useResource("/api/projects", { reloadOn: (e) => e.type.startsWith("project.") });
  const [current, setCurrent] = usePref("project.current", "");
  const projects = data?.projects || [];
  const value = current || projects.find((p) => p.executionAllowed)?.id || "";
  return (
    <label className="project-switch hide-mobile" title="Proiectul curent (preferință locală)">
      <FolderGit2 size={14} aria-hidden="true" />
      <span className="sr-only">Proiect</span>
      <select value={value} onChange={(e) => { setCurrent(e.target.value); go(`/projects/${e.target.value}`); }}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.executionAllowed ? "" : " (context)"}</option>)}
      </select>
    </label>
  );
}

const SHORTCUTS = [["Ctrl K", "paleta de comenzi"], ["Alt 1–9", "ecranele principale"], ["Alt M", "mini-asistent"], ["Ctrl ↵", "trimite mesajul"], ["Esc", "închide dialogul"]];

function CommandPalette({ onClose, go, onMini }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const projects = useResource("/api/projects");
  const missions = useResource("/api/missions");
  const hub = useHub((s) => s.hub);
  const items = useMemo(() => {
    const act = async (fn, label) => { try { await fn(); pushToast(`pal-${label}`, "ok", label); } catch (e) { pushToast("palette-error", "error", e.message); } };
    const actions = [
      ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Deschide ${n.long}`, icon: n.icon, run: () => go(`/${n.id}`), hint: n.key ? `Alt+${n.key}` : "" })),
      { id: "focus", label: "Intră în Focus", icon: MessageSquare, run: () => go("/conversations") },
      { id: "new-mission", label: "Misiune nouă", icon: Plus, run: () => go("/missions?new=1") },
      { id: "mini", label: "Mini-asistent (compact)", icon: Minimize2, run: onMini, hint: "Alt+M" },
      { id: "pause", label: "Pauză: suspendă poarta (execuțiile active continuă)", icon: Pause, run: () => act(() => api("/api/gate", { method: "POST", body: { action: "suspend", reason: "Pauză din paleta de comenzi" } }), "Poartă suspendată") },
      ...(hub?.mode !== "BUILD_SAFE" ? [{ id: "safe", label: "Mod: revino la BUILD_SAFE", icon: ShieldCheck, run: () => act(() => api("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" } }), "BUILD_SAFE activ") }] : []),
      { id: "backup", label: "Backup verificat acum (proiectul Hub)", icon: HardDrive, run: () => act(() => api("/api/backups", { method: "POST", body: { projectId: "ifrim-agent-hub" } }), "Backup pornit") },
      { id: "refresh", label: "Reîncarcă starea", icon: RefreshCw, run: () => refresh() },
      ...(projects.data?.projects || []).map((p) => ({ id: `prj-${p.id}`, label: `Proiect: ${p.name}`, icon: FolderGit2, run: () => go(`/projects/${p.id}`) })),
      ...(missions.data?.missions || []).slice(0, 20).map((m) => ({ id: `mis-${m.id}`, label: `Misiune: ${m.title}`, icon: Target, run: () => go(`/missions/${m.id}`) })),
      ...(query.trim().length > 1 ? [{ id: "memory-search", label: `Caută în memorie: „${query.trim()}”`, icon: Search, run: () => go(`/memory?q=${encodeURIComponent(query.trim())}`) }] : []),
    ];
    const q = query.trim().toLowerCase();
    return q ? actions.filter((a) => a.id === "memory-search" || a.label.toLowerCase().includes(q)) : actions;
  }, [query, go, onMini, projects.data, missions.data, hub?.mode]);
  useEffect(() => setIndex(0), [query]);
  const choose = (item) => { onClose(); item?.run(); };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Paleta de comenzi">
        <input className="palette-input" autoFocus placeholder="Caută o comandă, un ecran, un proiect sau o misiune…" value={query} aria-label="Comandă"
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
        <div className="palette-foot"><Keyboard size={13} aria-hidden="true" />{SHORTCUTS.map(([k, v]) => <span key={k}><span className="kbd">{k}</span> {v}</span>)}</div>
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

/**
 * Mini assistant: a compact in-app panel (state, microphone, mission, approvals, Stop). It is NOT a global
 * always-on-top overlay — that would need a native shell, which this web app does not pretend to have.
 */
function MiniAssistant({ go, onClose }) {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const voicePhase = useHub((s) => s.voicePhase);
  const legaPhase = useHub((s) => s.legaPhase);
  const core = deriveCoreState({ hub, connection, voicePhase, legaPhase });
  const mission = hub?.missions?.[0];
  return (
    <aside className="mini-assistant" aria-label="Mini-asistent">
      <div className="mini-core"><Core3D state={core.state} compact /></div>
      <div className="mini-body">
        <div className="row between"><strong>{core.label}</strong><button className="btn sm icon ghost" onClick={onClose} aria-label="Închide mini-asistentul"><X size={14} /></button></div>
        <div className="faint small mini-reason">{core.reason}</div>
        {mission && <a className="mini-link ellipsis" href={`#/missions/${mission.id}`}><Target size={12} aria-hidden="true" />{mission.title}</a>}
        <div className="row wrap">
          <button className="btn sm approve" onClick={() => go("/approvals")} disabled={!hub?.pendingApprovals}><ShieldCheck size={13} />{hub?.pendingApprovals || 0} aprobări</button>
          <VoiceControl go={go} compact />
          <StopAllButton compact />
        </div>
      </div>
    </aside>
  );
}

function ActiveControl({ go }) {
  const runs = useHub((s) => s.hub?.activeRuns) || NO_RUNS;
  const [busy, setBusy] = useState(false);
  if (!runs.length) return null;
  const first = runs[0];
  return (
    <div className="control-indicator" role="status">
      <span className={`pulse-dot ${first.phase === "streaming" ? "" : "wait"}`} aria-hidden="true" />
      <span><strong>{first.provider === "codex" ? "Codex" : "Claude"}</strong> {first.phase === "streaming" ? "lucrează" : "așteaptă providerul"}{runs.length > 1 ? ` (+${runs.length - 1})` : ""}</span>
      <button className="btn sm" onClick={() => go(`/conversations/${first.conversationId}`)}>Deschide</button>
      <button className="btn sm danger" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/runs/${first.runId}/interrupt`, { method: "POST", body: {} }); } catch (e) { pushToast("interrupt", "error", e.message); } finally { setBusy(false); } }}>Întrerupe</button>
    </div>
  );
}
const NO_RUNS = [];

const SIM_ACTIONS = [["lega", "Lega M06 (plan)"], ["execute", "Execuție"], ["approval", "Aprobare"], ["quota", "Cotă"], ["error", "Eroare auth"], ["handoff", "Handoff"], ["drop-stream", "Deconectare"],
  ["factory-a", "Fabrica A (bug)"], ["factory-b", "Fabrica B (feature)"], ["factory-c", "Fabrica C (review)"], ["sales", "Vânzări"]];

/** Persistent simulator banner with scenario triggers (only in the simulator process; the real Hub answers 404). */
function SimBanner() {
  const [busy, setBusy] = useState("");
  const trigger = async (id, label) => {
    setBusy(id);
    try {
      const result = await api(`/api/sim/${id}`, { method: "POST", body: {} });
      pushToast(`sim-${id}`, "info", result?.missionId ? `${label}: misiunea e pregătită; aprobă scope-ul în Misiuni` : `Scenariu simulat pornit: ${label}`);
      if (id === "lega" && result?.projectId) window.location.hash = `#/lega/${result.projectId}`;
      else if (result?.missionId) window.location.hash = `#/missions/${result.missionId}`;
      else if (id === "sales") window.location.hash = "#/sales";
    }
    catch (e) { pushToast(`sim-${id}`, "error", e.message); } finally { setBusy(""); }
  };
  return (
    <div className="sim-banner" role="status">
      <FlaskConical size={14} aria-hidden="true" /><span>SIMULARE — FĂRĂ MODELE REALE<span className="hide-mobile"> · instanță separată, date sintetice, doar fixture-uri</span></span>
      <span className="sim-actions hide-mobile" role="group" aria-label="Scenarii simulate">{SIM_ACTIONS.map(([id, label]) => (
        <button key={id} className="sim-action" disabled={Boolean(busy)} onClick={() => trigger(id, label)}>{busy === id ? "…" : label}</button>
      ))}</span>
    </div>
  );
}

export function Shell({ route, go, children }) {
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const [mini, setMini] = usePref("mini.open", false);
  const pending = useHub((s) => s.hub?.pendingApprovals || 0);
  const simulation = useHub((s) => s.hub?.simulation);
  // The floating run indicator must never cover the end of a page: main gets extra bottom room while it shows.
  const activeRunCount = useHub((s) => s.hub?.activeRuns?.length || 0);
  const mainRef = useRef(null);
  const [stageOpen, setStageOpen] = useStageToggle();
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
      // Plain Alt only: AltGr (Ctrl+Alt on Windows) types characters on the Romanian layout and must not switch screens.
      const key = appShortcutKey(e);
      if (key && /^[1-9]$/.test(key)) { const item = NAV.find((n) => n.key === key); if (item) { e.preventDefault(); go(`/${item.id}`); } }
      if (key === "m") { e.preventDefault(); setMini((m) => !m); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, setMini]);
  const current = route.name === "focus" ? "conversations" : route.name;
  const mobileNav = ["lega", "missions", "approvals"];
  return (
    <div className={`app ${simulation ? "is-sim" : ""}`}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Sari la conținut</a>
      {simulation && <SimBanner />}
      <header className="topbar">
        <a className="brand" href="#/control" aria-label="Control Room"><img src="/favicon.svg" alt="" className="brand-mark" /><span className="hide-mobile brand-name">IFRIM DIGITAL <b>AGENT HUB</b></span></a>
        <ProjectSwitcher go={go} />
        <StatusChips />
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => setPalette(true)} aria-label="Căutare și comenzi (Ctrl+K)"><Search size={15} /><span className="hide-mobile">Caută</span><span className="kbd hide-mobile">Ctrl K</span></button>
        <button className="btn sm ghost hide-mobile" onClick={() => setMini((m) => !m)} aria-pressed={mini} aria-label="Mini-asistent (Alt+M)"><Minimize2 size={15} /></button>
        <ErrorBoundary label="lega" fallback={() => <span className="chip error" title="Lega a întâmpinat o eroare; sesiunea a fost oprită">Lega: eroare</span>}><Lega go={go} /></ErrorBoundary>
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
      {stageOpen && <ErrorBoundary label="stage" fallback={() => null}><LegaStage onClose={() => setStageOpen(false)} go={go} /></ErrorBoundary>}
      <ErrorBoundary label="spotlight" fallback={() => null}><Spotlight /></ErrorBoundary>
      <main className={`main${activeRunCount ? " has-indicator" : ""}`} id="main" tabIndex={-1} ref={mainRef}>
        {/* A failing screen never takes the shell down: navigation, Stop All and the connection state keep working. */}
        <ErrorBoundary label="screen" resetKey={`${route.name}:${route.id || ""}`} fallback={(error, reset) => (
          <div className="page"><Notice tone="error" title="Ecranul a întâmpinat o eroare">
            {String(error?.message || error)}. Bara de sus, navigarea și Stop All funcționează în continuare.{" "}
            <button className="btn sm" onClick={reset}>Reîncearcă ecranul</button>
          </Notice></div>
        )}>{children}</ErrorBoundary>
      </main>
      <nav className="bottom-nav" aria-label="Navigare mobilă">
        {mobileNav.map((id) => { const item = NAV.find((n) => n.id === id); return (
          <a key={id} href={`#/${id}`} aria-current={current === id ? "page" : undefined}>
            <item.icon size={20} aria-hidden="true" />{item.label}
            {id === "approvals" && pending > 0 && <span className="badge">{pending}</span>}
          </a>
        ); })}
        <div className="bottom-stop"><StopAllButton compact /><span>Stop</span></div>
        <button onClick={() => setMore(true)} aria-label="Mai multe ecrane"><MoreHorizontal size={20} aria-hidden="true" />Mai mult</button>
      </nav>
      {more && (
        <Dialog title="Ecrane" onClose={() => setMore(false)}>
          <ul className="list">
            {NAV.filter((n) => !mobileNav.includes(n.id)).map((n) => (
              <li key={n.id}><a className="list-row" href={`#/${n.id}`} onClick={() => setMore(false)}><n.icon size={18} aria-hidden="true" /><span className="title">{n.long}</span></a></li>
            ))}
            <li><button className="list-row" onClick={() => { setMore(false); setMini(true); }}><Minimize2 size={18} aria-hidden="true" /><span className="title">Mini-asistent</span></button></li>
          </ul>
        </Dialog>
      )}
      {palette && <CommandPalette onClose={() => setPalette(false)} go={go} onMini={() => setMini(true)} />}
      {mini && <MiniAssistant go={go} onClose={() => setMini(false)} />}
      <ActiveControl go={go} />
      <Toasts go={go} />
    </div>
  );
}
