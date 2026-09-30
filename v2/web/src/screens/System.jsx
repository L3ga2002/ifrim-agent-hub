import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Lock, History, CalendarClock, Scale, ScrollText, Workflow, BookOpen, Radar, Building2, Briefcase, ShieldCheck, Network, Brain, Gauge, HardDrive, CircleDot, Pause, RefreshCw, ChevronDown, ChevronRight, Plus, Trash2, Link2, Package, Monitor, Filter, X, Timer, ArrowRightLeft, ListTree } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref, useHub } from "../store.js";
import { Panel, Loading, ErrorNotice, Empty, Chip, StatusChip, Notice, Dialog } from "../components/ui.jsx";

const TABS = [
  { id: "runs", label: "Execuții & telemetrie", icon: Activity },
  { id: "locks", label: "Lock-uri & computer", icon: Lock },
  { id: "checkpoints", label: "Checkpointuri & handoff-uri", icon: History },
  { id: "schedules", label: "Programări", icon: CalendarClock },
  { id: "policies", label: "Politici", icon: Scale },
  { id: "commands", label: "Comenzi & evenimente", icon: ScrollText },
  { id: "lifecycles", label: "Stări", icon: Workflow },
  { id: "skills", label: "Skills", icon: BookOpen },
  { id: "native", label: "Sesiuni native", icon: Radar },
];
const NEVER = () => false;
const EMPTY = [];
const quiet = (e) => !e.type.startsWith("run.activity") && !e.type.startsWith("backup.progress");

const DIAG_GROUPS = [
  { id: "company", label: "Companie", icon: Building2, keys: [["departments", "departamente"], ["activeDepartments", "departamente active"], ["roles", "roluri"], ["managerRelationships", "relații de raportare"], ["goals", "obiective"], ["objectives", "rezultate-cheie"], ["clients", "clienți"]] },
  { id: "work", label: "Lucru", icon: Briefcase, keys: [["projects", "proiecte"], ["conversations", "conversații"], ["missions", "misiuni"], ["tasks", "taskuri"], ["dependencies", "dependențe"], ["runs", "execuții"], ["activeRuns", "execuții active", "live"], ["handoffs", "handoff-uri"], ["checkpoints", "checkpointuri"], ["artifacts", "artefacte"], ["routeDecisions", "decizii de rutare"]] },
  { id: "control", label: "Control", icon: ShieldCheck, keys: [["pendingApprovals", "aprobări în așteptare", "attention"], ["policyRules", "reguli de politică"], ["taskScopes", "acorduri per task active"], ["locks", "lock-uri"], ["retainedLocks", "lock-uri reținute", "alert"], ["grantsActive", "granturi active", "attention"], ["commands", "comenzi"]] },
  { id: "ecosystem", label: "Ecosistem", icon: Network, keys: [["surfaces", "suprafețe"], ["capabilities", "capabilități"], ["verifications", "verificări"], ["integrations", "integrări"], ["computerEnvironments", "medii computer"], ["nativeSessions", "sesiuni native"]] },
  { id: "knowledge", label: "Cunoaștere", icon: Brain, keys: [["memory", "memorie activă"], ["skills", "skill-uri"], ["skillVersions", "versiuni skill"], ["decisions", "decizii"], ["leads", "lead-uri"]] },
  { id: "operations", label: "Operațiuni", icon: Gauge, keys: [["schedules", "programări"], ["activeSchedules", "programări active"], ["backups", "backup-uri"], ["verifiedBackups", "backup-uri verificate"], ["telemetry", "telemetrie"], ["events", "evenimente"], ["schemaVersion", "versiune schemă"]] },
];
const SOURCE_RO = { MEASURED: "măsurat de Hub", PROVIDER_REPORTED: "raportat de provider", DERIVED: "derivat de Hub", UNKNOWN: "necunoscut" };
const SOURCE_SHORT = { MEASURED: "M", PROVIDER_REPORTED: "P", DERIVED: "D", UNKNOWN: "?" };
const OUTCOME_RO = { verified: "verificat", rejected: "respins", unverified: "neverificat" };
const CONTROL_MODE_RO = { structured_api: "API structurat", dom: "DOM în browser", visual: "control vizual" };
const CHECKPOINT_KIND_RO = { operational: "operațional", handoff: "handoff", milestone: "milestone" };
const BACKEND_RO = { LOCAL_HUB: "Hub local", CLAUDE_NATIVE: "Claude nativ", OPENAI_NATIVE: "OpenAI nativ", OPENCLAW: "OpenClaw (retras)" };
const SCHEDULE_ACTION_RO = { ACTIVE: "Activează", PAUSED: "Pune pe pauză", RETIRED: "Retrage" };
const SCHEDULE_RO = { DRAFT: "Ciornă", ACTIVE: "Activă", PAUSED: "În pauză", RETIRED: "Retrasă" };
const LOCAL_COMMAND_RO = { "backup.run": "Backup verificat (fără modele)", "native.mirror": "Oglindește sesiunile Claude (read-only)", "surface.refresh": "Reîmprospătează suprafețele",
  "briefing.generate": "Generează briefingul (Markdown local)", "checkpoint.create": "Checkpoint operațional" };
const CADENCE_PRESETS = ["hourly", "every 30m", "daily 09:00", "weekdays 08:30", "weekly mon 09:00"];
const POLICY_RO = { AUTO_ALLOWED: "automat", ASK_ONCE_FOR_TASK: "o dată per task", ALWAYS_ASK: "de fiecare dată", DENIED: "interzis" };
const POLICY_TONE = { AUTO_ALLOWED: "ok", ASK_ONCE_FOR_TASK: "info", ALWAYS_ASK: "approval", DENIED: "error" };
const STRICTNESS = { AUTO_ALLOWED: 0, ASK_ONCE_FOR_TASK: 1, ALWAYS_ASK: 2, DENIED: 3 };
const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare workspace", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "acțiuni externe", SENSITIVE_ACTIONS: "sensibile" };
const EFFECTS_RO = { none: "fără efecte", local: "local", external: "extern" };
const COMMAND_STATUS_RO = { accepted: "acceptată", pending_approval: "așteaptă aprobare", executed: "executată", rejected: "respinsă", failed: "eșuată" };
const DECISION_RO = { allow: "permisă", ask: "cere aprobare", deny: "refuzată" };
const DECISION_TONE = { allow: "ok", ask: "approval", deny: "error" };
const MACHINE_RO = { task: "Task", goal: "Obiectiv", objective: "Rezultat-cheie", mission: "Misiune", agentRun: "Execuție (AgentRun)", providerSession: "Sesiune provider",
  handoff: "Handoff", approval: "Aprobare", schedule: "Programare", nativeScheduleRef: "Referință programare nativă" };
const SESSION_RO = { active: "activă", idle: "inactivă", unknown: "necunoscută", ended: "încheiată" };

function fmtDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return "—";
  const n = Number(ms);
  if (n < 1000) return `${Math.round(n)} ms`;
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
const runDuration = (r) => (r.startedAt && r.finishedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : null);
const json = (value) => JSON.stringify(value ?? null, null, 2);
const hasKeys = (o) => o && typeof o === "object" && Object.keys(o).length > 0;
/** " (n)" once the resource has loaded; nothing while loading, so a count is never shown as a fake 0. */
const countOf = (resource, n) => (resource.data ? ` (${n})` : "");

/** Provider-reported usage in words: tokens, plan windows and client-side estimates (never summed). */
function usageSummary(usage) {
  if (!hasKeys(usage)) return null;
  const parts = [];
  const tokens = usage.tokens?.total || usage.tokens;
  if (tokens && typeof tokens === "object") {
    const input = tokens.inputTokens ?? tokens.input_tokens;
    const output = tokens.outputTokens ?? tokens.output_tokens;
    if (input !== undefined || output !== undefined) parts.push(`${input ?? "?"} tokeni intrare / ${output ?? "?"} ieșire`);
  }
  const windows = usage.rateLimits?.windows;
  if (Array.isArray(windows) && windows.length) parts.push(`ferestre plan: ${windows.map((w) => `${w.usedPercent}%${w.windowMinutes ? ` / ${Math.round(w.windowMinutes / 60)} h` : ""}`).join(", ")}`);
  if (usage.clientEstimateUsd !== undefined && usage.clientEstimateUsd !== null) parts.push(`estimare client ${usage.clientEstimateUsd} USD (nu este cost de abonament)`);
  return parts.length ? parts.join(" · ") : JSON.stringify(usage).slice(0, 160);
}

function cadenceProblem(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t === "hourly") return null;
  const every = t.match(/^every (\d{1,4})m$/);
  if (every) return Number(every[1]) >= 5 && Number(every[1]) <= 1440 ? null : "every Nm: N între 5 și 1440";
  if (/^(daily|weekdays) ([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  if (/^weekly (sun|mon|tue|wed|thu|fri|sat) ([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  return "Format: hourly · every 30m · daily 09:00 · weekdays 08:30 · weekly mon 09:00";
}

/** Tab state: ?tab= in the hash is the source of truth; the last tab is remembered locally. */
function usePageTabs(screen, tabs, query, go) {
  const ids = tabs.map((t) => t.id);
  const [remembered, setRemembered] = usePref(`${screen}.tab`, ids[0]);
  const tab = ids.includes(query?.tab) ? query.tab : ids.includes(remembered) ? remembered : ids[0];
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => { setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab))); }, [tab]);
  const select = useCallback((id) => { setRemembered(id); go(`/${screen}?tab=${id}`); }, [screen, go, setRemembered]);
  return { tab, select, visited };
}

function Tabs({ tabs, value, onChange, label, idPrefix }) {
  const refs = useRef({});
  const onKeyDown = (e, index) => {
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return (
    <div className="tabs page-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} type="button" role="tab" id={`${idPrefix}-tab-${t.id}`} aria-controls={`${idPrefix}-panel-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          ref={(el) => { refs.current[t.id] = el; }} onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, i)}>
          <t.icon size={14} aria-hidden="true" />{t.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, tone = "" }) {
  return <div className={`stat-tile ${tone}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function Chevron({ open }) {
  return open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />;
}

function Src({ source, legend = false }) {
  const s = SOURCE_RO[source] ? source : "UNKNOWN";
  if (legend) return <span className={`src-tag ${s}`} aria-hidden="true">{SOURCE_SHORT[s]}</span>;
  return <span className={`src-tag ${s}`} title={SOURCE_RO[s]}><span aria-hidden="true">{SOURCE_SHORT[s]}</span><span className="sr-only">({SOURCE_RO[s]})</span></span>;
}

function Json({ value, max = 260 }) {
  return <pre className="pre" style={{ maxHeight: max }}>{json(value)}</pre>;
}

function ApprovalRequired({ result, onDone }) {
  const exec = useAction(async () => { const r = await api(`/api/commands/${encodeURIComponent(result.commandId)}/execute`, { method: "POST", body: {} }); onDone?.(r?.result ?? r); });
  return (
    <>
      <Notice tone="warn" title="Aprobare necesară">
        O regulă de politică cere aprobare pentru {result.approval?.actionKind || "această comandă"}. Aprobă exact acțiunea în <a href="#/approvals">Aprobări</a>, apoi execută comanda aprobată.{" "}
        <button className="btn sm" disabled={exec.pending} onClick={exec.run}>{exec.pending ? "Se execută…" : "Execută după aprobare"}</button>
      </Notice>
      <ErrorNotice error={exec.error} />
    </>
  );
}

// ---------------------------------------------------------------- diagnostic header

function DiagnosticsHeader() {
  const { data, error, loading, reload } = useResource("/api/diagnostics", { reloadOn: quiet });
  const [expanded, setExpanded] = usePref("system.counters", true);
  if (loading && !data) return <div style={{ marginBottom: 16 }}><Loading lines={4} /></div>;
  if (error && !data) return <div style={{ marginBottom: 16 }}><ErrorNotice error={error} onRetry={reload} /></div>;
  const gate = data.gate || {};
  const backup = data.backupGate;
  const control = data.control || {};
  const work = data.work || {};
  return (
    <section className="stack" aria-label="Diagnostic" style={{ marginBottom: 16 }}>
      <div className="diag-summary">
        <Chip tone={data.mode === "BUILD_SAFE" ? "info" : "warn"} icon={CircleDot} title="Modul de lucru al Hub-ului">{data.mode}</Chip>
        <Chip tone={gate.status === "open" ? "ok" : "warn"} icon={gate.status === "open" ? ShieldCheck : Pause} title={gate.reason || ""}>Poartă {gate.status === "open" ? "deschisă" : "suspendată"}</Chip>
        <Chip tone={backup?.ok ? "ok" : "warn"} icon={HardDrive} title={backup?.reason || ""}>{backup?.ok ? `Backup verificat ${fmt.ago(backup.backup?.createdAt)}` : "Backup: nu este proaspăt"}</Chip>
        {control.pendingApprovals > 0 && <a className="chip approval" href="#/approvals">{control.pendingApprovals} {control.pendingApprovals === 1 ? "aprobare" : "aprobări"}</a>}
        {work.activeRuns > 0 && <Chip tone="info" icon={Activity}>{work.activeRuns} {work.activeRuns === 1 ? "execuție activă" : "execuții active"}</Chip>}
        {control.retainedLocks > 0 && <Chip tone="error" icon={Lock}>{control.retainedLocks} lock-uri reținute</Chip>}
        <span className="faint small">generat {fmt.time(data.generatedAt)}</span>
        <span className="grow" />
        <button className="btn sm ghost" onClick={reload}><RefreshCw size={14} />Reîncarcă</button>
        <button className="btn sm ghost" aria-expanded={expanded} aria-controls={expanded ? "system-diag-groups" : undefined} onClick={() => setExpanded(!expanded)}>{expanded ? "Ascunde contoarele" : "Arată contoarele"}</button>
      </div>
      {gate.reason && <p className="faint small" style={{ margin: 0 }}>Poartă: {gate.reason}{gate.changedAt ? ` · ${fmt.dateTime(gate.changedAt)}` : ""}{gate.changedBy ? ` · ${gate.changedBy}` : ""}</p>}
      {!backup?.ok && <Notice tone="warn" title="Poarta de backup">{backup?.reason || "Proiectul Hub nu este înregistrat"}. Nicio execuție cu model nu pornește fără un backup complet, restaurat și verificat în ultimele 30 de minute.</Notice>}
      <ErrorNotice error={error} onRetry={reload} />
      {expanded && (
        <div className="diag-groups" id="system-diag-groups">
          {DIAG_GROUPS.map((g) => (
            <Panel key={g.id} title={g.label} icon={g.icon}>
              <dl className="stat-tiles">{g.keys.map(([key, label, tone]) => <Tile key={key} label={label} value={data[g.id]?.[key]} tone={tone && data[g.id]?.[key] > 0 ? tone : ""} />)}</dl>
            </Panel>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- runs & telemetry

function RunsTab() {
  const runs = useResource("/api/runs", { reloadOn: (e) => e.type.startsWith("run.") && quiet(e) });
  const telemetry = useResource("/api/telemetry", { reloadOn: (e) => (e.type.startsWith("run.") && quiet(e)) || e.type.startsWith("task.") });
  const [limit, setLimit] = useState(40);
  const list = runs.data?.runs || [];
  const active = runs.data?.active || [];
  const rows = telemetry.data?.runs || [];
  const outcomes = telemetry.data?.outcomes || [];
  return (
    <div className="stack">
      <Panel title={`Execuții${countOf(runs, list.length)}`} icon={Activity} flush>
        {runs.loading && !runs.data ? <div className="panel-body"><Loading /></div> : runs.error && !runs.data ? <div className="panel-body"><ErrorNotice error={runs.error} onRetry={runs.reload} /></div> : (
          <>
            {active.length > 0 && (
              <ul className="list" aria-label="Execuții active">{active.map((r) => (
                <li key={r.runId}><a className="list-row" href={`#/conversations/${encodeURIComponent(r.conversationId)}`}><span className="pulse-dot" aria-hidden="true" /><span className="grow">{r.provider} · run <span className="mono">{fmt.short(r.runId)}</span> · pid {r.pid || "—"}</span><StatusChip status="running" /></a></li>
              ))}</ul>
            )}
            {list.length ? (
              <div className="table-wrap"><table className="table table-mobile-cards">
                <thead><tr><th>Creată</th><th>Provider · etapă</th><th>Model</th><th>Acces</th><th>Stare</th><th>Eroare</th><th>Durată</th></tr></thead>
                <tbody>{list.slice(0, limit).map((r) => (
                  <tr key={r.id}>
                    <td data-label="Creată"><span className="nowrap">{fmt.dateTime(r.createdAt)}</span><div className="sub mono">{fmt.short(r.id)}</div></td>
                    <td data-label="Provider · etapă">{r.conversationId ? <a href={`#/conversations/${encodeURIComponent(r.conversationId)}`}>{r.provider} · {r.stage}</a> : `${r.provider} · ${r.stage}`}</td>
                    <td data-label="Model">{r.model || <span className="faint">implicit</span>}{r.effort ? <div className="sub">efort {r.effort}</div> : null}</td>
                    <td data-label="Acces">{r.access}</td>
                    <td data-label="Stare"><StatusChip status={r.status} /></td>
                    <td data-label="Eroare">{r.errorCategory ? <><Chip tone={r.preInference ? "warn" : "error"}>{r.errorCategory}{r.preInference ? " · înainte de model" : ""}</Chip>{r.errorMessage && <div className="sub break">{r.errorMessage}</div>}</> : <span className="faint">—</span>}</td>
                    <td data-label="Durată" className="nowrap">{fmtDuration(runDuration(r))}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title="Nicio execuție">Execuțiile apar după ce trec (sau sunt refuzate) de poarta de execuție.</Empty>}
            {list.length > limit && <div className="panel-body"><button className="btn sm" onClick={() => setLimit((n) => n + 40)}>Arată mai multe ({list.length - limit})</button></div>}
          </>
        )}
      </Panel>
      <Panel title={`Telemetrie per execuție${countOf(telemetry, rows.length)}`} icon={Timer} flush>
        <div className="panel-body" style={{ paddingBottom: 8 }}>
          <div className="ops-legend" aria-label="Sursa fiecărei valori">{Object.keys(SOURCE_RO).map((s) => <span key={s}><Src source={s} legend />{SOURCE_RO[s]}</span>)}</div>
        </div>
        {telemetry.loading && !telemetry.data ? <div className="panel-body"><Loading /></div> : telemetry.error && !telemetry.data ? <div className="panel-body"><ErrorNotice error={telemetry.error} onRetry={telemetry.reload} /></div> : rows.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Execuție</th><th>Tip task</th><th>Suprafață · model</th><th>Durată</th><th>Încercări</th><th>Întreruperi</th><th>Intervenții</th><th>Eșec</th><th>Rezultat</th><th>Utilizare</th></tr></thead>
            <tbody>{rows.map((t) => {
              const s = t.sources || {};
              return (
                <tr key={t.id}>
                  <td data-label="Execuție"><span className="mono">{fmt.short(t.runId)}</span><div className="sub">{t.provider} · {fmt.dateTime(t.startedAt)}</div></td>
                  <td data-label="Tip task" className="mono">{t.taskType || "—"}</td>
                  <td data-label="Suprafață · model"><span className="mono break">{t.surfaceId || "—"}</span><Src source={s.surface} /><div className="sub">{t.model || "necunoscut"}<Src source={s.model} /></div></td>
                  <td data-label="Durată" className="nowrap">{fmtDuration(t.durationMs)}<Src source={s.duration} /></td>
                  <td data-label="Încercări">{t.attempts ?? "—"}<Src source={s.attempts} /></td>
                  <td data-label="Întreruperi">{t.interruptions ?? "—"}<Src source={s.interruptions} /></td>
                  <td data-label="Intervenții umane">{t.humanInterventions ?? "—"} · {t.handoffs ?? 0} handoff<Src source={s.humanInterventions} /></td>
                  <td data-label="Eșec">{t.failureCategory || <span className="faint">—</span>}<Src source={s.failure} /></td>
                  <td data-label="Rezultat verificat"><StatusChip status={t.verifiedOutcome} label={OUTCOME_RO[t.verifiedOutcome]} /><Src source={s.verifiedOutcome} /></td>
                  <td data-label="Utilizare">{hasKeys(t.usage) ? <span className="small break">{usageSummary(t.usage)}</span> : <span className="faint">necunoscută</span>}<Src source={s.usage} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="Nicio telemetrie">Fiecare AgentRun primește un rând cu sursa fiecărui câmp; nimic nu este estimat.</Empty>}
      </Panel>
      <Panel title={`Rezultate agregate${countOf(telemetry, outcomes.length)}`} icon={Gauge} flush>
        {telemetry.loading && !telemetry.data ? <div className="panel-body"><Loading /></div> : telemetry.error && !telemetry.data ? <div className="panel-body"><ErrorNotice error={telemetry.error} onRetry={telemetry.reload} /></div> : outcomes.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Tip task</th><th>Suprafață</th><th>Execuții</th><th>Verificate</th><th>Respinse</th><th>Eșecuri</th><th>Rată de succes</th><th>Durată medie</th></tr></thead>
            <tbody>{outcomes.map((o) => (
              <tr key={`${o.taskType}-${o.surfaceId}-${o.provider}`}>
                <td data-label="Tip task" className="mono">{o.taskType || "—"}</td>
                <td data-label="Suprafață"><span className="mono break">{o.surfaceId || "—"}</span><div className="sub">{o.provider}</div></td>
                <td data-label="Execuții">{o.runs}</td>
                <td data-label="Verificate">{o.verified}</td>
                <td data-label="Respinse">{o.rejected}</td>
                <td data-label="Eșecuri">{o.failures}</td>
                <td data-label="Rată de succes">{o.successRate === null || o.successRate === undefined ? <span className="faint">insuficient</span> : `${Math.round(o.successRate * 100)}%`}<Src source={o.source} /></td>
                <td data-label="Durată medie">{fmtDuration(o.avgDurationMs)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Niciun rezultat agregat">Doar rezultatele verificate sau respinse contează; execuțiile neverificate sunt raportate separat.</Empty>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- locks & computer

function LeaseTable({ leases }) {
  return (
    <div className="table-wrap"><table className="table table-mobile-cards">
      <thead><tr><th>Resursă</th><th>Deținător</th><th>Stare</th><th>Achiziționat</th><th>Heartbeat</th><th>Expiră</th><th>Task · run</th></tr></thead>
      <tbody>{leases.map((l) => (
        <tr key={l.id}>
          <td data-label="Resursă"><span className="mono break">{l.resource}</span>{l.release_reason && <div className="sub">{l.release_reason}</div>}</td>
          <td data-label="Deținător" className="break">{l.holder}</td>
          <td data-label="Stare"><StatusChip status={l.status} /></td>
          <td data-label="Achiziționat" className="nowrap">{fmt.dateTime(l.acquired_at)}</td>
          <td data-label="Heartbeat" className="nowrap">{fmt.ago(l.heartbeat_at)}</td>
          <td data-label="Expiră" className="nowrap">{fmt.dateTime(l.expires_at)}</td>
          <td data-label="Task · run" className="mono small">{l.task_id ? fmt.short(l.task_id) : "—"} · {l.run_id ? fmt.short(l.run_id) : "—"}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function UseCasePlan({ useCase }) {
  const { data, error, loading, reload } = useResource(`/api/computer/plan/${encodeURIComponent(useCase.id)}`, { reloadOn: (e) => e.type.startsWith("computer.") });
  if (loading && !data) return <Loading lines={2} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  return (
    <div className="stack tight">
      <dl className="kv">
        <dt>Mediu principal</dt><dd>{data.primary ? <>{data.primary.name} <Chip>{CONTROL_MODE_RO[data.primary.controlMode] || data.primary.controlMode}</Chip> <StatusChip status={data.primary.status} /></> : <span className="muted">niciun mediu utilizabil acum</span>}</dd>
        <dt>Alternative</dt><dd>{data.fallbacks?.length ? data.fallbacks.map((e) => `${e.name} (${CONTROL_MODE_RO[e.controlMode] || e.controlMode})`).join(", ") : "—"}</dd>
        <dt>Excluse</dt><dd>{data.excluded?.length ? <ul className="plain-list">{data.excluded.map((e) => <li key={e.id}><span className="mono">{e.id}</span> · {e.status}{e.reason ? ` — ${e.reason}` : ""}</li>)}</ul> : "—"}</dd>
      </dl>
      {data.useCase?.note && <p className="muted small" style={{ margin: 0 }}>{data.useCase.note}</p>}
      <p className="faint small" style={{ margin: 0 }}>{data.rule}</p>
    </div>
  );
}

function LocksTab() {
  const leases = useHub((s) => s.hub?.leases) || EMPTY;
  const hubLoaded = useHub((s) => Boolean(s.hub));
  const computer = useResource("/api/computer", { reloadOn: (e) => e.type.startsWith("computer.") || e.type.startsWith("lease.") });
  const [openPlan, setOpenPlan] = useState(null);
  const envs = computer.data?.environments || [];
  const useCases = computer.data?.useCases || [];
  const locks = computer.data?.locks || [];
  return (
    <div className="stack">
      <Panel title={`Lock-uri active și reținute${hubLoaded ? ` (${leases.length})` : ""}`} icon={Lock} flush>
        {!hubLoaded ? <div className="panel-body"><Loading /></div> : leases.length ? <LeaseTable leases={leases} />
          : <Empty title="Niciun lock activ">Un singur scriitor per workspace; lock-urile reținute (stare necunoscută după o oprire) cer reconciliere explicită.</Empty>}
        {leases.some((l) => l.status === "retained") && <div className="panel-body"><Notice tone="warn" title="Lock-uri reținute">Poarta de execuție nu se poate deschide până nu sunt reconciliate.</Notice></div>}
      </Panel>
      {computer.loading && !computer.data ? <Loading lines={4} /> : computer.error && !computer.data ? <ErrorNotice error={computer.error} onRetry={computer.reload} /> : (
        <>
          <Panel title={`Medii computer (${envs.length})`} icon={Monitor} flush>
            <div className="panel-body" style={{ paddingBottom: 0 }}><p className="muted" style={{ margin: 0 }}>Ordinea de preferință: connector/API structurat → DOM în browser → control vizual. Computer use-ul vendorilor este asistat: îl rulezi tu în aplicația lor; Hub-ul înregistrează lock-ul și rezultatul.</p></div>
            {envs.length ? (
              <div className="table-wrap"><table className="table table-mobile-cards">
                <thead><tr><th>Mediu</th><th>Provider</th><th>Control</th><th>Izolare</th><th>Stare</th><th>Cazuri de utilizare</th></tr></thead>
                <tbody>{envs.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Mediu"><strong>{e.name}</strong><div className="sub mono break">{e.id} · {e.kind}</div>{e.safety?.length > 0 && <div className="sub">{e.safety.join(" · ")}</div>}</td>
                    <td data-label="Provider">{e.provider}{e.ownerSurfaceId && <div className="sub mono break">{e.ownerSurfaceId}</div>}</td>
                    <td data-label="Control">{CONTROL_MODE_RO[e.controlMode] || e.controlMode}</td>
                    <td data-label="Izolare">{e.isolation}</td>
                    <td data-label="Stare"><StatusChip status={e.status} />{e.statusReason && <div className="sub">{e.statusReason}</div>}</td>
                    <td data-label="Cazuri de utilizare">{e.useCases?.length ? <div className="chips">{e.useCases.map((u) => <Chip key={u}>{u}</Chip>)}</div> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title="Niciun mediu înregistrat">Fișierul v2/config/ecosystem/computer.json lipsește sau este gol.</Empty>}
          </Panel>
          <Panel title={`Planuri pe cazuri de utilizare (${useCases.length})`} icon={ListTree} flush>
            {useCases.length ? <ul className="list">{useCases.map((u) => {
              const isOpen = openPlan === u.id;
              return (
                <li key={u.id}>
                  <div className="list-row">
                    <div className="grow">
                      <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `plan-${u.id}` : undefined} onClick={() => setOpenPlan(isOpen ? null : u.id)}><Chevron open={isOpen} /><span>{u.label || u.id}</span></button>
                      <div className="sub"><span className="mono">{u.id}</span>{u.preference?.length ? ` · preferință: ${u.preference.join(" → ")}` : ""}</div>
                    </div>
                  </div>
                  {isOpen && <div className="expand-body" id={`plan-${u.id}`}><UseCasePlan useCase={u} /></div>}
                </li>
              );
            })}</ul> : <Empty title="Niciun caz de utilizare configurat" />}
          </Panel>
          <Panel title={`Lock-uri computer și ferestre (${locks.length})`} icon={Lock} flush>
            {locks.length ? <LeaseTable leases={locks} /> : <Empty title="Niciun lock de computer">Niciodată două sisteme pe același mediu sau aceeași fereastră.</Empty>}
          </Panel>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- checkpoints & handoffs

function CheckpointDialog({ onClose, onDone }) {
  const [form, setForm] = useState({ label: "", nextAction: "", kind: "operational" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useAction(async () => {
    const body = { kind: form.kind };
    if (form.label.trim()) body.label = form.label.trim();
    if (form.nextAction.trim()) body.nextAction = form.nextAction.trim();
    await api("/api/checkpoints", { method: "POST", body });
    onDone(); onClose();
  });
  return (
    <Dialog title="Checkpoint nou (Agent Hub)" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={save.pending} onClick={save.run}>{save.pending ? "Se creează…" : "Creează checkpoint"}</button></>}>
      <p className="muted" style={{ margin: 0 }}>Capturează misiunile, aprobările, lock-urile, execuțiile active, testele, artefactele și starea Git, și referențiază sesiunile native (fără să le copieze). Checkpoint ≠ backup ≠ commit: se leagă de ultimul backup verificat.</p>
      <div className="field"><span>Tip</span>
        <div className="seg" role="group" aria-label="Tip checkpoint">{["operational", "milestone"].map((k) => <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => setForm((f) => ({ ...f, kind: k }))}>{CHECKPOINT_KIND_RO[k]}</button>)}</div>
      </div>
      <label className="field"><span>Etichetă</span><input className="input" value={form.label} onChange={set("label")} maxLength={200} placeholder="Ex.: Înainte de validarea live HUB-018" /></label>
      <label className="field"><span>Următorul pas (opțional; implicit primul task deschis)</span><textarea className="textarea" rows={2} value={form.nextAction} onChange={set("nextAction")} maxLength={500} /></label>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function CheckpointDetail({ checkpoint: c }) {
  const hs = c.hubState || {};
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Următorul pas</dt><dd>{c.nextAction || "—"}</dd>
        <dt>Git</dt><dd className="mono break">{c.gitBranch || "—"} @ {c.gitHead ? c.gitHead.slice(0, 12) : "—"} · {c.dirty?.length || 0} modificate · {c.manifest?.untracked?.length || 0} netrackuite</dd>
        <dt>Backup legat</dt><dd className="mono break">{c.backupId || "niciun backup verificat"}</dd>
        <dt>Misiuni</dt><dd>{hs.missions?.length ? <ul className="plain-list">{hs.missions.map((m) => <li key={m.id}>{m.title} · {m.status} · {m.tasks?.length || 0} taskuri</li>)}</ul> : "—"}</dd>
        <dt>Aprobări în așteptare</dt><dd>{hs.pendingApprovals?.length ? hs.pendingApprovals.map((a) => a.actionKind).join(", ") : "niciuna"}</dd>
        <dt>Lock-uri</dt><dd>{hs.locks?.length ? hs.locks.map((l) => `${l.resource} (${l.status})`).join(", ") : "niciunul"}</dd>
        <dt>Execuții active</dt><dd>{hs.activeRuns?.length ? hs.activeRuns.map((r) => `${r.provider} ${fmt.short(r.id)}`).join(", ") : "niciuna"}</dd>
        <dt>Teste recente</dt><dd>{hs.tests?.length ? hs.tests.map((t) => `${t.tool}: ${t.status}`).join(", ") : "—"}</dd>
        <dt>Artefacte</dt><dd>{hs.artifacts?.length || 0}</dd>
        <dt>Efecte externe</dt><dd>{hs.externalEffects?.length ? hs.externalEffects.map((x) => `${x.tool} (${x.effects})`).join(", ") : "niciunul înregistrat"}</dd>
      </dl>
      <div>
        <div className="section-title">Referințe native ({c.nativeRefs?.length || 0})</div>
        {c.nativeRefs?.length ? <ul className="list">{c.nativeRefs.map((r, i) => (
          <li key={`${r.nativeId}-${i}`}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}>
            <Chip>{r.kind}</Chip><div className="grow"><span className="mono break">{r.nativeId || "—"}</span>{r.name ? ` · ${r.name}` : ""}{r.status ? ` · ${r.status}` : ""}<div className="sub">{r.note}</div></div>
          </div></li>
        ))}</ul> : <p className="faint small" style={{ margin: 0 }}>Nicio sesiune nativă legată de acest scope.</p>}
      </div>
    </div>
  );
}

function CheckpointsTab() {
  const checkpoints = useResource("/api/checkpoints", { reloadOn: (e) => e.type === "checkpoint.created" });
  const handoffs = useResource("/api/handoffs", { reloadOn: (e) => e.type.startsWith("handoff.") });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const list = checkpoints.data?.checkpoints || [];
  const hlist = handoffs.data?.handoffs || [];
  return (
    <div className="stack">
      <Panel title={`Checkpointuri${countOf(checkpoints, list.length)}`} icon={History} flush>
        <div className="panel-body row wrap between" style={{ paddingBottom: 8 }}>
          <span className="muted">Checkpoint operațional cross-provider; checkpointurile Claude Code (/rewind) și firele Codex doar se referențiază.</span>
          <button className="btn sm primary" onClick={() => setCreating(true)}><Plus size={14} />Checkpoint nou</button>
        </div>
        {checkpoints.loading && !checkpoints.data ? <div className="panel-body"><Loading /></div> : checkpoints.error && !checkpoints.data ? <div className="panel-body"><ErrorNotice error={checkpoints.error} onRetry={checkpoints.reload} /></div> : list.length ? (
          <ul className="list">{list.map((c) => {
            const isOpen = open === c.id;
            return (
              <li key={c.id}>
                <div className="list-row surface-row">
                  <div className="grow">
                    <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `ckpt-${c.id}` : undefined} onClick={() => setOpen(isOpen ? null : c.id)}><Chevron open={isOpen} /><span>{c.label || "(fără etichetă)"}</span></button>
                    <div className="sub">{fmt.dateTime(c.createdAt)} · {c.createdBy} · {c.scopeType}:{fmt.short(c.scopeId)} · {c.gitBranch || "—"}@{c.gitHead ? c.gitHead.slice(0, 8) : "—"}</div>
                  </div>
                  <div className="chips">
                    <Chip>{CHECKPOINT_KIND_RO[c.kind] || c.kind}</Chip>
                    <Chip tone={c.nativeRefs?.length ? "info" : "neutral"}>{c.nativeRefs?.length || 0} referințe native</Chip>
                    <Chip tone={c.backupId ? "ok" : "warn"} icon={HardDrive}>{c.backupId ? "backup legat" : "fără backup"}</Chip>
                  </div>
                </div>
                {isOpen && <div className="expand-body" id={`ckpt-${c.id}`}><CheckpointDetail checkpoint={c} /></div>}
              </li>
            );
          })}</ul>
        ) : <Empty title="Niciun checkpoint" action={<button className="btn sm primary" onClick={() => setCreating(true)}>Creează primul checkpoint</button>}>Un checkpoint permite reluarea exactă a lucrului după un handoff sau o repornire.</Empty>}
      </Panel>
      <Panel title={`Handoff-uri${countOf(handoffs, hlist.length)}`} icon={ArrowRightLeft} flush>
        {handoffs.loading && !handoffs.data ? <div className="panel-body"><Loading /></div> : handoffs.error && !handoffs.data ? <div className="panel-body"><ErrorNotice error={handoffs.error} onRetry={handoffs.reload} /></div> : hlist.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Creat</th><th>Direcție</th><th>Pas</th><th>Stare</th><th>Pachet</th><th>Checkpoint</th></tr></thead>
            <tbody>{hlist.map((h) => (
              <tr key={h.id}>
                <td data-label="Creat"><span className="nowrap">{fmt.dateTime(h.createdAt)}</span><div className="sub"><a href={`#/conversations/${encodeURIComponent(h.conversationId)}`}>conversația</a></div></td>
                <td data-label="Direcție">{h.fromProvider || "—"} → {h.toProvider}{(h.fromSurface || h.toSurface) && <div className="sub mono break">{h.fromSurface || "—"} → {h.toSurface || "—"}</div>}</td>
                <td data-label="Pas">{h.step}{h.error && <div className="sub break">{h.error}</div>}</td>
                <td data-label="Stare"><StatusChip status={h.status} /></td>
                <td data-label="Pachet" className="mono small">{h.packageSha256 ? `${h.packageSha256.slice(0, 12)}…` : "—"}</td>
                <td data-label="Checkpoint" className="mono small">{h.checkpointId ? fmt.short(h.checkpointId) : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Niciun handoff">Handoff-ul Codex ↔ Claude pornește din panoul contextual al unei conversații.</Empty>}
      </Panel>
      {creating && <CheckpointDialog onClose={() => setCreating(false)} onDone={checkpoints.reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- schedules

function ScheduleCreateDialog({ backends, localCommands, departments, projects, onClose, onDone }) {
  const allowedBackends = backends.filter((b) => b !== "OPENCLAW");
  const execProjects = projects.filter((p) => p.executionAllowed);
  const [form, setForm] = useState({ name: "", description: "", cadence: "daily 09:00", backend: "LOCAL_HUB", command: localCommands[0] || "", projectId: execProjects[0]?.id || "",
    hours: "24", label: "", prompt: "", departmentKey: "", externalEffects: false });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const native = form.backend !== "LOCAL_HUB";
  const cadenceError = cadenceProblem(form.cadence);
  const hours = Number(form.hours);
  const commandProblem = native ? (form.prompt.trim().length < 5 ? "Descrie instrucțiunile programării (minimum 5 caractere)." : null)
    : !localCommands.includes(form.command) ? "Alege o comandă locală permisă."
      : form.command === "backup.run" && !form.projectId ? "Alege un proiect activat pentru execuție V2."
        : form.command === "briefing.generate" && !(Number.isInteger(hours) && hours >= 1 && hours <= 168) ? "Fereastra briefingului: 1–168 ore." : null;
  const valid = form.name.trim().length >= 3 && !cadenceError && !commandProblem;
  const save = useAction(async () => {
    const prompt = form.prompt.trim();
    const payload = form.command === "backup.run" ? { projectId: form.projectId } : form.command === "briefing.generate" ? { hours } : form.command === "checkpoint.create" && form.label.trim() ? { label: form.label.trim() } : {};
    const body = { name: form.name.trim(), description: form.description.trim(), cadence: form.cadence.trim().toLowerCase(), backend: form.backend,
      action: native ? { command: "native.prompt", prompt, payload: { prompt } } : { command: form.command, payload }, usesAi: native, externalEffects: native ? form.externalEffects : false };
    if (form.departmentKey) body.departmentKey = form.departmentKey;
    await api("/api/schedules", { method: "POST", body });
    onDone(); onClose();
  });
  return (
    <Dialog title="Programare nouă" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se creează…" : "Creează (DRAFT)"}</button></>}>
      <div className="field"><span>Proprietar (un singur scheduler per intenție)</span>
        <div className="seg wrap" role="group" aria-label="Backend">{allowedBackends.map((b) => <button key={b} type="button" aria-pressed={form.backend === b} onClick={() => setForm((f) => ({ ...f, backend: b }))}>{BACKEND_RO[b] || b}</button>)}</div>
      </div>
      <label className="field"><span>Nume (minimum 3 caractere)</span><input className="input" value={form.name} onChange={set("name")} maxLength={120} /></label>
      <div className="grid two">
        <label className="field"><span>Cadență (ora locală)</span>
          <input className="input" list="system-cadence-presets" value={form.cadence} onChange={set("cadence")} aria-invalid={Boolean(cadenceError)} aria-describedby="system-cadence-help" />
          <datalist id="system-cadence-presets">{CADENCE_PRESETS.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="field"><span>Departament (opțional)</span>
          <select className="select" value={form.departmentKey} onChange={set("departmentKey")}><option value="">Fără departament</option>{departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</select>
        </label>
      </div>
      <span id="system-cadence-help" className="small" style={{ color: cadenceError ? "var(--danger)" : "var(--text-3)" }}>{cadenceError || "hourly · every 30m · daily 09:00 · weekdays 08:30 · weekly mon 09:00"}</span>
      {native ? (
        <>
          <label className="field"><span>Instrucțiuni pentru programarea nativă</span><textarea className="textarea" rows={3} value={form.prompt} onChange={set("prompt")} maxLength={2000} placeholder="Ex.: Rezumatul zilnic al taskurilor blocate din Ifrim Agent Hub" /></label>
          <label className="check"><input type="checkbox" checked={form.externalEffects} onChange={set("externalEffects")} />Poate avea efecte externe (trimiteri, publicări)</label>
          <Notice tone="info">Hub-ul nu creează programarea nativă. După salvare primești pașii; o creezi tu în produsul vendorului, apoi legi ID-ul aici. Rularea nativă consumă din planul vendorului.</Notice>
        </>
      ) : (
        <>
          <label className="field"><span>Comandă locală (fără modele, fără efecte externe)</span>
            <select className="select" value={form.command} onChange={set("command")}>{localCommands.map((c) => <option key={c} value={c}>{LOCAL_COMMAND_RO[c] || c} ({c})</option>)}</select>
          </label>
          {form.command === "backup.run" && (
            <label className="field"><span>Proiect</span>
              <select className="select" value={form.projectId} onChange={set("projectId")}>{execProjects.length ? execProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">Niciun proiect activat pentru execuție</option>}</select>
            </label>
          )}
          {form.command === "briefing.generate" && <label className="field"><span>Fereastră (ore, 1–168)</span><input className="input" type="number" min={1} max={168} value={form.hours} onChange={set("hours")} /></label>}
          {form.command === "checkpoint.create" && <label className="field"><span>Etichetă checkpoint (opțional)</span><input className="input" value={form.label} onChange={set("label")} maxLength={200} /></label>}
          <p className="faint small" style={{ margin: 0 }}>Rulează cel mult o dată per slot; după o repornire se recuperează doar ultimul slot ratat, fără rafale. Activarea nu declanșează o rulare imediată.</p>
        </>
      )}
      <label className="field"><span>Descriere (opțional)</span><textarea className="textarea" rows={2} value={form.description} onChange={set("description")} maxLength={2000} /></label>
      {commandProblem && form.name.trim().length >= 3 && <span className="small" style={{ color: "var(--approval)" }}>{commandProblem}</span>}
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function ScheduleTransitionDialog({ schedule, to, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const save = useAction(async () => {
    await api(`/api/schedules/${encodeURIComponent(schedule.id)}/transition`, { method: "POST", body: { to, reason: reason.trim() } });
    onDone(); onClose();
  });
  return (
    <Dialog title={`${SCHEDULE_ACTION_RO[to] || to}: ${schedule.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className={`btn ${to === "RETIRED" ? "danger" : "primary"}`} disabled={reason.trim().length < 3 || save.pending} onClick={save.run}>{save.pending ? "Se salvează…" : "Confirmă"}</button></>}>
      <p className="muted" style={{ margin: 0 }}>{SCHEDULE_RO[schedule.status] || schedule.status} → {SCHEDULE_RO[to] || to}.{to === "ACTIVE" && schedule.backend !== "LOCAL_HUB" ? " Activarea cere ID-ul programării native legat." : ""}{to === "ACTIVE" && schedule.backend === "LOCAL_HUB" ? " Primul slot rulat este următorul; nu există rulare imediată." : ""}{to === "RETIRED" ? " Retragerea este finală." : ""}</p>
      <label className="field"><span>Motiv (obligatoriu, minimum 3 caractere)</span><textarea className="textarea" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function LinkNativeDialog({ schedule, onClose, onDone }) {
  const [form, setForm] = useState({ nativeId: "", nativeLabel: "" });
  const save = useAction(async () => {
    await api(`/api/schedules/${encodeURIComponent(schedule.id)}/link`, { method: "POST", body: { nativeId: form.nativeId.trim(), nativeLabel: form.nativeLabel.trim() } });
    onDone(); onClose();
  });
  return (
    <Dialog title={`Leagă ID nativ: ${schedule.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={form.nativeId.trim().length < 3 || save.pending} onClick={save.run}>{save.pending ? "Se leagă…" : "Leagă"}</button></>}>
      <p className="muted" style={{ margin: 0 }}>Introdu ID-ul sau numele programării pe care ai creat-o în {BACKEND_RO[schedule.backend] || schedule.backend}. Hub-ul doar o referențiază; nu o pornește și nu o modifică.</p>
      <label className="field"><span>ID nativ (minimum 3 caractere)</span><input className="input mono" value={form.nativeId} onChange={(e) => setForm((f) => ({ ...f, nativeId: e.target.value }))} maxLength={200} /></label>
      <label className="field"><span>Etichetă (opțional)</span><input className="input" value={form.nativeLabel} onChange={(e) => setForm((f) => ({ ...f, nativeLabel: e.target.value }))} maxLength={200} /></label>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function ScheduleDetail({ schedule }) {
  const { data, error, loading, reload } = useResource(`/api/schedules/${encodeURIComponent(schedule.id)}`, { reloadOn: (e) => e.scopeId === schedule.id });
  if (loading && !data) return <Loading lines={3} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const { refs = [], runs = [], setup } = data || {};
  return (
    <div className="stack">
      <dl className="kv">
        <dt>Acțiune</dt><dd><span className="mono">{schedule.action?.command}</span>{hasKeys(schedule.action?.payload) ? <span className="mono small break"> {JSON.stringify(schedule.action.payload)}</span> : null}</dd>
        {schedule.description && <><dt>Descriere</dt><dd>{schedule.description}</dd></>}
        <dt>Intenție</dt><dd className="mono small break">{schedule.intentKey}</dd>
        <dt>Motivul stării</dt><dd>{schedule.statusReason || "—"}</dd>
        <dt>Creată</dt><dd>{fmt.dateTime(schedule.createdAt)} · v{schedule.version}</dd>
      </dl>
      {setup?.steps?.length > 0 && (
        <div>
          <div className="section-title">Configurare</div>
          <ol className="plain-list">{setup.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {setup.usageNote && <p className="faint small" style={{ margin: "6px 0 0" }}>{setup.usageNote}</p>}
        </div>
      )}
      {refs.length > 0 && (
        <div>
          <div className="section-title">Referințe native ({refs.length})</div>
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>ID nativ</th><th>Stare</th><th>Motiv</th><th>Văzută</th></tr></thead>
            <tbody>{refs.map((r) => (
              <tr key={r.id}><td data-label="ID nativ" className="mono break">{r.nativeId || "—"}{r.nativeLabel && <div className="sub">{r.nativeLabel}</div>}</td><td data-label="Stare"><StatusChip status={r.state} /></td><td data-label="Motiv">{r.stateReason || "—"}</td><td data-label="Văzută" className="nowrap">{r.lastSeenAt ? fmt.dateTime(r.lastSeenAt) : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      <div>
        <div className="section-title">Rulări ({runs.length})</div>
        {runs.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Slot</th><th>Stare</th><th>Început</th><th>Terminat</th><th>Rezultat</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}><td data-label="Slot" className="nowrap">{fmt.dateTime(r.slot)}</td><td data-label="Stare"><StatusChip status={r.status} /></td><td data-label="Început" className="nowrap">{fmt.dateTime(r.startedAt)}</td><td data-label="Terminat" className="nowrap">{fmt.dateTime(r.finishedAt)}</td><td data-label="Rezultat">{hasKeys(r.result) ? <span className="mono small break">{JSON.stringify(r.result).slice(0, 240)}</span> : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="faint small" style={{ margin: 0 }}>{schedule.backend === "LOCAL_HUB" ? "Nicio rulare încă." : "Rulările native nu sunt observate de Hub; apar doar rulările locale."}</p>}
      </div>
    </div>
  );
}

function SchedulesTab() {
  const { data, error, loading, reload } = useResource("/api/schedules", { reloadOn: (e) => e.type.startsWith("schedule.") });
  const lifecycles = useResource("/api/lifecycles", { reloadOn: NEVER });
  const company = useResource("/api/company", { reloadOn: NEVER });
  const projects = useResource("/api/projects", { reloadOn: NEVER });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [transition, setTransition] = useState(null);
  const [linking, setLinking] = useState(null);
  const machine = (lifecycles.data?.lifecycles || []).find((l) => l.id === "schedule");
  const list = data?.schedules || [];
  const departments = company.data?.departments || [];
  const deptName = (id) => departments.find((d) => d.id === id)?.name || null;
  // Auxiliary lists only fill selects: wait while they load, but a failed load must not block creation.
  const ready = Boolean(data) && !(projects.loading && !projects.data) && !(company.loading && !company.data);
  return (
    <div className="stack">
      <Panel title={`Programări${data ? ` (${list.length})` : ""}`} icon={CalendarClock} flush>
        <div className="panel-body row wrap between" style={{ paddingBottom: 8 }}>
          <span className="muted">Un singur proprietar per intenție: Hub local (doar comenzi locale fără modele) sau o programare nativă Claude/OpenAI creată de tine și legată aici.</span>
          <button className="btn sm primary" disabled={!ready} onClick={() => setCreating(true)}><Plus size={14} />Programare nouă</button>
        </div>
        {loading && !data ? <div className="panel-body"><Loading /></div> : error && !data ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : list.length ? (
          <ul className="list">{list.map((s) => {
            const isOpen = open === s.id;
            const allowed = machine?.transitions?.[s.status] || [];
            const canLink = s.backend !== "LOCAL_HUB" && ["PENDING_USER_SETUP", "ORPHANED"].includes(s.nativeRef?.state);
            return (
              <li key={s.id}>
                <div className="list-row surface-row">
                  <div className="grow">
                    <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `schedule-${s.id}` : undefined} onClick={() => setOpen(isOpen ? null : s.id)}><Chevron open={isOpen} /><span>{s.name}</span></button>
                    <div className="sub"><span className="mono">{s.cadence}</span> · {BACKEND_RO[s.backend] || s.backend} · <span className="mono">{s.action?.command}</span>{deptName(s.departmentId) ? ` · ${deptName(s.departmentId)}` : ""}</div>
                    <div className="sub">Următoarea: {s.status === "ACTIVE" && s.nextRunAt ? fmt.dateTime(s.nextRunAt) : "—"} · ultima rulare: {s.lastRunAt && s.lastResult ? `${fmt.dateTime(s.lastRunAt)} (${s.lastResult === "completed" ? "reușită" : s.lastResult === "failed" ? "eșuată" : s.lastResult})` : s.lastRunAt ? `niciuna (slot de referință la activare: ${fmt.dateTime(s.lastRunAt)})` : "niciuna"}</div>
                    <div className="chips" style={{ marginTop: 6 }}>
                      <StatusChip status={s.status} label={SCHEDULE_RO[s.status]} />
                      {s.nativeRef && <StatusChip status={s.nativeRef.state} />}
                      {s.nativeRef?.nativeId && <Chip title="ID nativ legat"><span className="mono">{s.nativeRef.nativeId}</span></Chip>}
                      {s.usesAi && <Chip tone="warn">folosește modele</Chip>}
                      {s.externalEffects && <Chip tone="error">efecte externe</Chip>}
                    </div>
                  </div>
                  <div className="row wrap">
                    {allowed.map((to) => <button key={to} className={`btn sm ${to === "RETIRED" ? "ghost" : ""}`} onClick={() => setTransition({ schedule: s, to })}>{SCHEDULE_ACTION_RO[to] || to}</button>)}
                    {canLink && <button className="btn sm primary" onClick={() => setLinking(s)}><Link2 size={14} />Leagă ID nativ</button>}
                  </div>
                </div>
                {isOpen && <div className="expand-body" id={`schedule-${s.id}`}><ScheduleDetail schedule={s} /></div>}
              </li>
            );
          })}</ul>
        ) : <Empty title="Nicio programare" action={<button className="btn sm primary" disabled={!ready} onClick={() => setCreating(true)}>Creează o programare</button>}>Exemple: backup verificat zilnic, oglindirea sesiunilor Claude la 30 de minute, briefing în zilele lucrătoare.</Empty>}
      </Panel>
      <ErrorNotice error={lifecycles.error || company.error || projects.error} />
      {creating && data && (
        <ScheduleCreateDialog backends={data.backends || []} localCommands={data.localCommands || []} departments={departments} projects={projects.data?.projects || []}
          onClose={() => setCreating(false)} onDone={reload} />
      )}
      {transition && <ScheduleTransitionDialog schedule={transition.schedule} to={transition.to} onClose={() => setTransition(null)} onDone={reload} />}
      {linking && <LinkNativeDialog schedule={linking} onClose={() => setLinking(null)} onDone={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- policies

function PolicyRuleForm({ catalog, policies, surfaces, projects, onDone }) {
  const editable = catalog.filter((c) => !c.locked);
  const [form, setForm] = useState({ actionKind: editable[0]?.actionKind || "", surfaceId: "*", projectId: "*", policy: "", reason: "" });
  const entry = catalog.find((c) => c.actionKind === form.actionKind);
  const allowed = policies.filter((p) => STRICTNESS[p] >= STRICTNESS[entry?.loosest || "ALWAYS_ASK"]);
  const policy = allowed.includes(form.policy) ? form.policy : allowed.includes(entry?.policy) ? entry.policy : allowed[0] || "";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.actionKind && policy && form.reason.trim().length >= 3;
  const save = useAction(async () => {
    await api("/api/policies", { method: "POST", body: { actionKind: form.actionKind, surfaceId: form.surfaceId.trim() || "*", projectId: form.projectId.trim() || "*", policy, reason: form.reason.trim() } });
    setForm((f) => ({ ...f, reason: "" }));
    onDone();
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) save.run(); }}>
      <div className="grid two">
        <label className="field"><span>Acțiune</span>
          <select className="select" value={form.actionKind} onChange={set("actionKind")}>{editable.map((c) => <option key={c.actionKind} value={c.actionKind}>{c.actionKind} — {c.label}</option>)}</select>
        </label>
        <label className="field"><span>Politică (cea mai permisivă posibilă: {POLICY_RO[entry?.loosest] || "—"})</span>
          <select className="select" value={policy} onChange={set("policy")}>{allowed.map((p) => <option key={p} value={p}>{POLICY_RO[p] || p} ({p})</option>)}</select>
        </label>
        <label className="field"><span>Suprafață („*” = toate)</span>
          <input className="input mono" list="system-policy-surfaces" value={form.surfaceId} onChange={set("surfaceId")} maxLength={80} />
          <datalist id="system-policy-surfaces"><option value="*" />{surfaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</datalist>
        </label>
        <label className="field"><span>Proiect („*” = toate)</span>
          <input className="input mono" list="system-policy-projects" value={form.projectId} onChange={set("projectId")} maxLength={80} />
          <datalist id="system-policy-projects"><option value="*" />{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</datalist>
        </label>
      </div>
      <label className="field"><span>Motiv (obligatoriu, minimum 3 caractere)</span><input className="input" value={form.reason} onChange={set("reason")} maxLength={300} /></label>
      <div className="row wrap"><button type="submit" className="btn sm primary" disabled={!valid || save.pending}><Plus size={14} />{save.pending ? "Se salvează…" : "Salvează regula"}</button><span className="faint small">O regulă poate fi oricând mai strictă; niciodată mai permisivă decât permite catalogul. Regula cea mai specifică (suprafață + proiect) câștigă.</span></div>
      <ErrorNotice error={save.error} />
    </form>
  );
}

function PoliciesTab() {
  const { data, error, loading, reload } = useResource("/api/policies", { reloadOn: (e) => e.type.startsWith("policy.") });
  const surfaces = useResource("/api/surfaces", { reloadOn: NEVER });
  const projects = useResource("/api/projects", { reloadOn: NEVER });
  const remove = useAction(async (rule) => { await api(`/api/policies/${encodeURIComponent(rule.id)}`, { method: "DELETE" }); reload(); });
  const [q, setQ] = useState("");
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const catalog = data.catalog || [];
  const rules = data.rules || [];
  const scopes = data.activeTaskScopes || [];
  const needle = q.trim().toLowerCase();
  const shownCatalog = catalog.filter((c) => !needle || `${c.actionKind} ${c.label}`.toLowerCase().includes(needle));
  return (
    <div className="stack">
      <Notice tone="info">Politica Hub se aplică și când acțiunea este executată de o suprafață a vendorului (computer use, connectori, Claude in Chrome, pluginuri OpenAI). Dialogul de permisiuni al vendorului este un strat suplimentar și nu înlocuiește decizia Hub.</Notice>
      <Panel title={`Regulile tale (${rules.length})`} icon={Scale}>
        <div className="stack">
          {rules.length ? (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>Acțiune</th><th>Suprafață</th><th>Proiect</th><th>Politică</th><th>Motiv</th><th><span className="sr-only">Acțiuni</span></th></tr></thead>
              <tbody>{rules.map((r) => (
                <tr key={r.id}>
                  <td data-label="Acțiune" className="mono break">{r.actionKind}</td>
                  <td data-label="Suprafață" className="mono break">{r.surfaceId}</td>
                  <td data-label="Proiect" className="mono break">{r.projectId}</td>
                  <td data-label="Politică"><Chip tone={POLICY_TONE[r.policy] || "neutral"}>{POLICY_RO[r.policy] || r.policy}</Chip></td>
                  <td data-label="Motiv">{r.reason}<div className="sub">{r.source} · {fmt.dateTime(r.updatedAt)} · v{r.version}</div></td>
                  <td>{r.source === "user" && <button className="btn sm ghost" disabled={remove.pending} onClick={() => { if (window.confirm(`Ștergi regula pentru ${r.actionKind}? Se revine la politica implicită din catalog.`)) remove.run(r); }}><Trash2 size={14} />Șterge</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted" style={{ margin: 0 }}>Nicio regulă proprie: se aplică politicile implicite din catalog.</p>}
          <ErrorNotice error={remove.error} />
          <div className="section-title">Regulă nouă</div>
          <PolicyRuleForm catalog={catalog} policies={data.policies || []} surfaces={surfaces.data?.surfaces || []} projects={projects.data?.projects || []} onDone={reload} />
        </div>
      </Panel>
      <Panel title={`Catalog de acțiuni (${shownCatalog.length}/${catalog.length})`} icon={ShieldCheck} flush>
        <div className="panel-body" style={{ paddingBottom: 8 }}><div className="filters"><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută acțiune…" aria-label="Caută în catalog" /></div></div>
        <div className="table-wrap"><table className="table table-mobile-cards">
          <thead><tr><th>Acțiune</th><th>Nivel</th><th>Efecte</th><th>Implicit</th><th>Cel mai permisiv</th><th>Regula ta</th></tr></thead>
          <tbody>{shownCatalog.map((c) => {
            const own = rules.filter((r) => r.actionKind === c.actionKind);
            return (
              <tr key={c.actionKind}>
                <td data-label="Acțiune"><span className="mono break">{c.actionKind}</span><div className="sub">{c.label}</div></td>
                <td data-label="Nivel">{TIER_RO[c.tier] || c.tier}</td>
                <td data-label="Efecte">{EFFECTS_RO[c.effects] || c.effects}</td>
                <td data-label="Implicit"><Chip tone={POLICY_TONE[c.policy] || "neutral"}>{POLICY_RO[c.policy] || c.policy}</Chip></td>
                <td data-label="Cel mai permisiv">{c.locked ? <Chip tone="error" icon={Lock}>blocat de Hub</Chip> : <Chip tone={POLICY_TONE[c.loosest] || "neutral"}>{POLICY_RO[c.loosest] || c.loosest}</Chip>}</td>
                <td data-label="Regula ta">{own.length ? <div className="chips">{own.map((r) => <Chip key={r.id} tone={POLICY_TONE[r.policy] || "neutral"} title={`${r.surfaceId} · ${r.projectId}`}>{POLICY_RO[r.policy] || r.policy}</Chip>)}</div> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>
      <Panel title={`Acorduri „o dată per task” active (${scopes.length})`} icon={Timer} flush>
        {scopes.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Task</th><th>Acțiune</th><th>Țintă</th><th>Suprafață</th><th>Acordat</th><th>Expiră</th><th>Utilizări</th></tr></thead>
            <tbody>{scopes.map((s) => (
              <tr key={s.id}>
                <td data-label="Task" className="mono">{fmt.short(s.task_id)}</td>
                <td data-label="Acțiune" className="mono break">{s.action_kind}</td>
                <td data-label="Țintă" className="mono break">{s.target || "—"}</td>
                <td data-label="Suprafață" className="mono break">{s.surface_id}</td>
                <td data-label="Acordat" className="nowrap">{fmt.dateTime(s.granted_at)}</td>
                <td data-label="Expiră" className="nowrap">{fmt.dateTime(s.expires_at)}</td>
                <td data-label="Utilizări">{s.uses ?? 0}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Niciun acord activ">Un acord „o dată per task” durează cel mult 8 ore și se revocă la finalizarea taskului sau la Stop All.</Empty>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- commands & events

function CommandsTab() {
  const [status, setStatus] = useState("");
  const commands = useResource(`/api/commands?limit=100${status ? `&status=${encodeURIComponent(status)}` : ""}`, { reloadOn: (e) => e.type.startsWith("command.") });
  const catalog = useResource("/api/commands/catalog", { reloadOn: NEVER });
  const [draft, setDraft] = useState({ type: "", correlationId: "" });
  const [filters, setFilters] = useState({ type: "", correlationId: "" });
  const [selected, setSelected] = useState(null);
  const [openEvent, setOpenEvent] = useState(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const eventsRef = useRef(null);
  const params = new URLSearchParams({ limit: "200" });
  if (filters.type) params.set("type", filters.type);
  if (filters.correlationId) params.set("correlationId", filters.correlationId);
  const events = useResource(`/api/events/query?${params}`, {
    reloadOn: (e) => quiet(e) && (!filters.type || e.type.startsWith(filters.type)) && (!filters.correlationId || e.correlationId === filters.correlationId),
  });
  const applyFilters = (next) => { setDraft(next); setFilters(next); setOpenEvent(null); };
  const selectCommand = (c) => {
    if (selected === c.id) { setSelected(null); return; }
    setSelected(c.id);
    if (c.correlationId) applyFilters({ type: "", correlationId: c.correlationId });
  };
  const showEvents = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    eventsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const list = commands.data?.commands || [];
  const eventList = events.data?.events || [];
  const catalogList = catalog.data?.commands || [];
  return (
    <div className="stack">
      <Panel title={`Comenzi${countOf(commands, list.length)}`} icon={ScrollText} flush>
        <div className="panel-body row wrap between" style={{ paddingBottom: 8 }}>
          <span className="muted">Fiecare schimbare de stare este o comandă validată, evaluată de politică și jurnalizată. Selectează o comandă pentru a-i filtra evenimentele după corelare.</span>
          <select className="select" style={{ width: "auto", minHeight: 32 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtru stare comenzi">
            <option value="">Toate stările</option>{Object.entries(COMMAND_STATUS_RO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {commands.loading && !commands.data ? <div className="panel-body"><Loading /></div> : commands.error && !commands.data ? <div className="panel-body"><ErrorNotice error={commands.error} onRetry={commands.reload} /></div> : list.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Comandă</th><th>Canal · actor</th><th>Politică</th><th>Stare</th><th>Când</th></tr></thead>
            <tbody>{list.map((c) => {
              const isSel = selected === c.id;
              return (
                <Fragment key={c.id}>
                  <tr className={isSel ? "is-open row-selected" : undefined}>
                    <td data-label="Comandă"><button className="link-btn" aria-expanded={isSel} aria-controls={isSel ? `cmd-${c.id}` : undefined} onClick={() => selectCommand(c)}><Chevron open={isSel} /><span className="mono">{c.type}</span></button><div className="sub mono">{fmt.short(c.id)}{c.approvalId ? ` · aprobare ${fmt.short(c.approvalId)}` : ""}</div></td>
                    <td data-label="Canal · actor">{c.channel} · {c.actor}</td>
                    <td data-label="Politică">{c.policy?.decision ? <Chip tone={DECISION_TONE[c.policy.decision] || "neutral"} title={c.policy.reason || ""}>{DECISION_RO[c.policy.decision] || c.policy.decision}</Chip> : "—"}</td>
                    <td data-label="Stare"><StatusChip status={c.status} label={COMMAND_STATUS_RO[c.status]} />{c.error && <div className="sub break">{c.error}</div>}</td>
                    <td data-label="Când" className="nowrap">{fmt.dateTime(c.createdAt)}{c.finishedAt && <div className="sub">{fmtDuration(new Date(c.finishedAt) - new Date(c.createdAt))}</div>}</td>
                  </tr>
                  {isSel && (
                    <tr className="detail-row" id={`cmd-${c.id}`}><td colSpan={5}>
                      <div className="stack tight">
                        <dl className="kv">
                          <dt>Corelare</dt><dd className="mono break">{c.correlationId || "—"}</dd>
                          <dt>Politică</dt><dd>{c.policy?.policy || "—"}{c.policy?.reason ? ` · ${c.policy.reason}` : ""}</dd>
                          {c.intentText && <><dt>Intenție</dt><dd>{c.intentText}</dd></>}
                          {c.routeDecisionId && <><dt>Rutare</dt><dd className="mono">{c.routeDecisionId}</dd></>}
                          {c.idempotencyKey && <><dt>Idempotență</dt><dd className="mono break">{c.idempotencyKey}</dd></>}
                        </dl>
                        <div className="grid two">
                          <div><div className="section-title">Payload (redactat)</div><Json value={c.payload} /></div>
                          <div><div className="section-title">Rezultat</div><Json value={c.result} /></div>
                        </div>
                        {c.correlationId && <div className="row"><button className="btn sm" onClick={showEvents}><Filter size={14} />Vezi evenimentele corelate</button></div>}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="Nicio comandă">{status ? "Nicio comandă cu această stare." : "Comenzile apar când UI-ul, vocea sau programările schimbă starea."}</Empty>}
      </Panel>

      <div ref={eventsRef} style={{ scrollMarginTop: 56 }}>
        <Panel title={`Evenimente${countOf(events, eventList.length)}`} icon={Activity} flush>
          <div className="panel-body stack tight" style={{ paddingBottom: 8 }}>
            <form className="filters" onSubmit={(e) => { e.preventDefault(); applyFilters({ type: draft.type.trim(), correlationId: draft.correlationId.trim() }); }}>
              <input className="input" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} placeholder="Prefix tip (ex.: goal. sau run.)" aria-label="Prefix tip eveniment" maxLength={80} />
              <input className="input mono" value={draft.correlationId} onChange={(e) => setDraft((d) => ({ ...d, correlationId: e.target.value }))} placeholder="Correlation ID" aria-label="Correlation ID" maxLength={120} />
              <button type="submit" className="btn sm"><Filter size={14} />Filtrează</button>
              {(filters.type || filters.correlationId) && <button type="button" className="btn sm ghost" onClick={() => { applyFilters({ type: "", correlationId: "" }); setSelected(null); }}><X size={14} />Resetează</button>}
            </form>
            {(filters.type || filters.correlationId) && (
              <div className="chips">
                {filters.type && <Chip tone="info">tip: {filters.type}*</Chip>}
                {filters.correlationId && <Chip tone="info">corelare: <span className="mono">{filters.correlationId.length > 24 ? `${filters.correlationId.slice(0, 24)}…` : filters.correlationId}</span></Chip>}
                {events.loading && <span className="faint small" role="status">se încarcă…</span>}
              </div>
            )}
          </div>
          {events.error && !events.data ? <div className="panel-body"><ErrorNotice error={events.error} onRetry={events.reload} /></div> : events.loading && !events.data ? <div className="panel-body"><Loading /></div> : eventList.length ? (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>#</th><th>Tip</th><th>Scope</th><th>Sursă</th><th>Corelare</th><th>Când</th></tr></thead>
              <tbody>{eventList.map((e) => {
                const isOpen = openEvent === e.seq;
                return (
                  <Fragment key={e.seq}>
                    <tr className={isOpen ? "is-open" : undefined}>
                      <td data-label="#" className="mono">{e.seq}</td>
                      <td data-label="Tip"><button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `evt-${e.seq}` : undefined} onClick={() => setOpenEvent(isOpen ? null : e.seq)}><Chevron open={isOpen} /><span className="mono">{e.type}</span></button></td>
                      <td data-label="Scope" className="mono small break">{e.scopeType}:{String(e.scopeId).length > 22 ? `…${String(e.scopeId).slice(-12)}` : e.scopeId}</td>
                      <td data-label="Sursă">{e.source}</td>
                      <td data-label="Corelare">{e.correlationId ? (filters.correlationId === e.correlationId ? <span className="mono small">{fmt.short(e.correlationId)}</span> : <button className="btn sm ghost" title={e.correlationId} onClick={() => applyFilters({ type: "", correlationId: e.correlationId })}><Filter size={12} /><span className="mono">{fmt.short(e.correlationId)}</span></button>) : <span className="faint">—</span>}</td>
                      <td data-label="Când" className="nowrap">{fmt.dateTime(e.createdAt)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row" id={`evt-${e.seq}`}><td colSpan={6}>
                        <div className="stack tight">
                          <dl className="kv compact">
                            {[["Proiect", e.projectId], ["Companie", e.companyId], ["Departament", e.departmentId], ["Misiune", e.missionId], ["Task", e.taskId], ["Execuție", e.runId], ["Referință brută", e.rawRef], ["Schema", e.schemaVersion]].filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono break">{String(v)}</dd></Fragment>)}
                          </dl>
                          <Json value={e.payload} />
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}</tbody>
            </table></div>
          ) : <Empty title="Niciun eveniment pentru filtrul curent" />}
          {events.error && events.data && <div className="panel-body"><ErrorNotice error={events.error} onRetry={events.reload} /></div>}
        </Panel>
      </div>

      <Panel title={`Catalog de comenzi${countOf(catalog, catalogList.length)}`} icon={Package} flush actions={<button className="btn sm ghost" aria-expanded={showCatalog} aria-controls={showCatalog ? "system-command-catalog" : undefined} onClick={() => setShowCatalog(!showCatalog)}>{showCatalog ? "Ascunde" : "Arată"}</button>}>
        {showCatalog && (catalog.loading && !catalog.data ? <div className="panel-body"><Loading /></div> : catalog.error && !catalog.data ? <div className="panel-body"><ErrorNotice error={catalog.error} onRetry={catalog.reload} /></div> : (
          <div id="system-command-catalog">
            <div className="panel-body" style={{ paddingBottom: 8 }}>
              <p className="faint small" style={{ margin: 0 }}>Canale: {(catalog.data?.channels || []).join(", ")} · comenzi permise programărilor locale: {(catalog.data?.scheduleCommands || []).join(", ")}</p>
            </div>
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>Comandă</th><th>Descriere</th><th>Canale</th><th>Execuție</th></tr></thead>
              <tbody>{catalogList.map((c) => (
                <tr key={c.type}>
                  <td data-label="Comandă" className="mono break">{c.type}</td>
                  <td data-label="Descriere">{c.describe || "—"}</td>
                  <td data-label="Canale"><div className="chips">{(c.channels || []).map((ch) => <Chip key={ch}>{ch}</Chip>)}</div></td>
                  <td data-label="Execuție">{c.async ? "asincronă" : "în tranzacție"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- lifecycles

function LifecyclesTab() {
  const { data, error, loading, reload } = useResource("/api/lifecycles", { reloadOn: NEVER });
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const machines = data?.lifecycles || [];
  if (!machines.length) return <Panel><Empty title="Nicio mașină de stări" /></Panel>;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Fiecare entitate cu stare are tranziții explicite, stări finale și un motiv obligatoriu pentru fiecare schimbare. Aceste tabele sunt citite din server, nu desenate manual.</p>
      <div className="grid two">
        {machines.map((m) => (
          <Panel key={m.id} title={MACHINE_RO[m.id] || m.id} icon={Workflow} flush actions={<span className="faint small">{m.states.length} stări · {m.terminal.length} finale</span>}>
            <div className="table-wrap"><table className="table lifecycle-table">
              <thead><tr><th>Stare</th><th>Tranziții permise</th></tr></thead>
              <tbody>{m.states.map((s) => {
                const next = m.transitions?.[s] || [];
                return (
                  <tr key={s}>
                    <td><span className="mono">{s}</span>{m.terminal.includes(s) && <div style={{ marginTop: 4 }}><Chip>finală</Chip></div>}</td>
                    <td>{next.length ? <div className="chips">{next.map((t) => <Chip key={t}>{t}</Chip>)}</div> : <span className="faint">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- skills

function SkillVersions({ skillId }) {
  const { data, error, loading, reload } = useResource(`/api/skills/${encodeURIComponent(skillId)}/versions`, { reloadOn: (e) => e.scopeId === skillId });
  if (loading && !data) return <Loading lines={2} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const versions = data?.versions || [];
  if (!versions.length) return <p className="faint small" style={{ margin: 0 }}>Nicio versiune.</p>;
  return (
    <div className="table-wrap"><table className="table table-mobile-cards">
      <thead><tr><th>Versiune</th><th>SHA-256</th><th>Validare</th><th>Creată</th></tr></thead>
      <tbody>{versions.map((v) => (
        <tr key={v.version}>
          <td data-label="Versiune" className="mono">v{v.version}</td>
          <td data-label="SHA-256" className="mono">{String(v.sha256).slice(0, 16)}…</td>
          <td data-label="Validare">{v.validation?.ok ? <Chip tone="ok">validă</Chip> : <Chip tone="error">{v.validation?.errors?.length || 0} erori</Chip>}{v.validation?.warnings?.length ? <Chip tone="warn">{v.validation.warnings.length} avertismente</Chip> : null}</td>
          <td data-label="Creată" className="nowrap">{fmt.dateTime(v.createdAt)} · {v.createdBy}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function SkillsTab() {
  const { data, error, loading, reload } = useResource("/api/skills", { reloadOn: (e) => e.type.startsWith("skill.") && e.type !== "skill.exported" });
  const [format, setFormat] = useState("claude-code-plugin");
  const [exported, setExported] = useState(null);
  const [imported, setImported] = useState(null);
  const [open, setOpen] = useState(null);
  const exportBundle = useAction(async () => { setExported(await api("/api/skills/export", { method: "POST", body: { format } })); });
  const rescan = useAction(async () => { setImported(await api("/api/skills/import", { method: "POST", body: {} })); reload(); });
  const skills = data?.skills || [];
  const invalid = skills.filter((s) => s.status !== "active").length;
  return (
    <div className="stack">
      <Panel title={`Agent Skills${data ? ` (${skills.length})` : ""}`} icon={BookOpen}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Format canonic: Agent Skills (<span className="mono">SKILL.md</span> + scripts/references/assets) în <span className="mono">{data?.directory || "v2/skills"}</span>. Fiecare schimbare de conținut creează o versiune imutabilă (SHA-256). Un skill nu acordă permisiuni: unealta și nivelul efectiv sunt intersecția cu rolul.</p>
          <div className="row wrap">
            <div className="seg" role="group" aria-label="Format export">
              {[["claude-code-plugin", "Plugin Claude Code"], ["agent-skills", "Agent Skills"]].map(([k, v]) => <button key={k} type="button" aria-pressed={format === k} onClick={() => setFormat(k)}>{v}</button>)}
            </div>
            <button className="btn sm primary" disabled={exportBundle.pending || !skills.length} onClick={exportBundle.run}><Package size={14} />{exportBundle.pending ? "Se exportă…" : "Exportă pachetul"}</button>
            <button className="btn sm" disabled={rescan.pending} onClick={rescan.run}><RefreshCw size={14} />{rescan.pending ? "Se scanează…" : "Rescanează directorul"}</button>
          </div>
          {exported && <Notice tone="info" title={`Pachet ${exported.format} creat (${exported.skills?.length || 0} skill-uri)`}><span className="mono break">{exported.path}</span><div style={{ marginTop: 4 }}>{exported.note}</div></Notice>}
          {imported && <Notice tone="info" title="Director rescanat">{imported.imported} skill-uri citite · {imported.versions} versiuni noi · {imported.invalid} invalide</Notice>}
          <ErrorNotice error={exportBundle.error || rescan.error} />
          {invalid > 0 && <Notice tone="warn" title="Skill-uri invalide">{invalid} {invalid === 1 ? "skill nu trece" : "skill-uri nu trec"} validarea și nu sunt folosite de niciun rol.</Notice>}
        </div>
      </Panel>
      <Panel title="Registru" icon={ListTree} flush>
        {loading && !data ? <div className="panel-body"><Loading /></div> : error && !data ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : skills.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Skill</th><th>Stare</th><th>Versiune</th><th>SHA</th><th>Validare</th><th>Roluri · permisiune</th></tr></thead>
            <tbody>{skills.map((s) => {
              const isOpen = open === s.id;
              const v = s.validation || {};
              const errors = v.errors || [];
              const warnings = v.warnings || [];
              const roles = String(s.metadata?.["hub-roles"] || "").split(/\s+/).filter(Boolean);
              return (
                <Fragment key={s.id}>
                  <tr className={isOpen ? "is-open" : undefined}>
                    <td data-label="Skill"><button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `skill-${s.id}` : undefined} onClick={() => setOpen(isOpen ? null : s.id)}><Chevron open={isOpen} /><span className="mono">{s.id}</span></button>{s.description && <div className="sub">{s.description}</div>}</td>
                    <td data-label="Stare"><StatusChip status={s.status} /></td>
                    <td data-label="Versiune" className="mono">v{s.currentVersion} <span className="faint">/ {s.versions}</span></td>
                    <td data-label="SHA" className="mono small">{s.sha256 ? s.sha256.slice(0, 12) : "—"}</td>
                    <td data-label="Validare"><div className="chips">{errors.length ? <Chip tone="error">{errors.length} erori</Chip> : <Chip tone="ok">validă</Chip>}{warnings.length > 0 && <Chip tone="warn">{warnings.length} avertismente</Chip>}</div></td>
                    <td data-label="Roluri · permisiune">{roles.length ? roles.join(", ") : <span className="faint">niciun rol</span>}<div className="sub">{TIER_RO[s.metadata?.["hub-permission"]] || s.metadata?.["hub-permission"] || TIER_RO.READ_ONLY}</div></td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row" id={`skill-${s.id}`}><td colSpan={6}>
                      <div className="stack">
                        <dl className="kv">
                          <dt>Director</dt><dd className="mono break">{s.directory}</dd>
                          {s.compatibility && <><dt>Compatibilitate</dt><dd>{s.compatibility}</dd></>}
                          {s.license && <><dt>Licență</dt><dd>{s.license}</dd></>}
                          <dt>Unelte declarate</dt><dd className="mono break">{s.metadata?.["hub-tools"] || "—"}</dd>
                          <dt>Teste</dt><dd>{v.hub?.tests?.length ? <ul className="plain-list">{v.hub.tests.map((t) => <li key={t}>{t}</li>)}</ul> : "—"}</dd>
                          <dt>Actualizat</dt><dd>{fmt.dateTime(s.updatedAt)}</dd>
                        </dl>
                        {errors.length > 0 && <div><div className="section-title">Erori de validare</div><ul className="plain-list">{errors.map((x) => <li key={x} style={{ color: "var(--danger)" }}>{x}</li>)}</ul></div>}
                        {warnings.length > 0 && <div><div className="section-title">Avertismente</div><ul className="plain-list">{warnings.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                        {hasKeys(v.hub?.effective) && (
                          <div><div className="section-title">Permisiuni efective per rol</div>
                            <ul className="plain-list">{Object.entries(v.hub.effective).map(([role, eff]) => <li key={role}><strong>{role}</strong>: {TIER_RO[eff.permission] || eff.permission} · unelte {eff.tools?.length ? eff.tools.join(", ") : "niciuna"}{eff.droppedTools?.length ? ` · ignorate: ${eff.droppedTools.join(", ")}` : ""}</li>)}</ul>
                          </div>
                        )}
                        <div><div className="section-title">Versiuni</div><SkillVersions skillId={s.id} /></div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="Niciun skill">Adaugă un director cu SKILL.md în v2/skills și rescanează.</Empty>}
      </Panel>
      {data?.proposals?.length > 0 && (
        <Panel title={`Propuneri de skill (${data.proposals.length})`} icon={BookOpen} flush>
          <ul className="list">{data.proposals.map((p) => <li key={p.id}><div className="list-row"><div className="grow"><div className="title">{p.name || p.skill_id || p.id}</div><div className="sub">{p.status || "—"} · {fmt.dateTime(p.created_at)}</div></div></div></li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- native sessions

function NativeTab() {
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useResource(`/api/native-sessions${all ? "?all=1" : ""}`, { reloadOn: (e) => e.type.startsWith("provider.native") });
  const projects = useResource("/api/projects", { reloadOn: NEVER });
  const [outcome, setOutcome] = useState(null);
  const refresh = useAction(async () => { setOutcome(await api("/api/native-sessions/refresh", { method: "POST", body: {} })); reload(); });
  const projectName = (id) => projects.data?.projects?.find((p) => p.id === id)?.name || id || "—";
  const sessions = data?.sessions || [];
  const last = data?.last;
  return (
    <div className="stack">
      <Panel title="Oglinda sesiunilor Claude Code" icon={Radar}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Citește lista oficială <span className="mono">claude agents --json</span> (fără TTY, fără model) și păstrează o copie read-only doar pentru sesiunile din proiecte înregistrate. Hub-ul nu conduce, nu reia și nu oprește aceste sesiuni.</p>
          <div className="row wrap">
            <button className="btn sm primary" disabled={refresh.pending} onClick={refresh.run}><RefreshCw size={14} />{refresh.pending ? "Se citește…" : "Reîmprospătează oglinda"}</button>
            <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Include sesiunile încheiate</label>
          </div>
          {outcome?.approvalRequired ? <ApprovalRequired result={outcome} onDone={(result) => { setOutcome(result); reload(); }} />
            : outcome ? (outcome.ok === false ? <Notice tone="warn" title="Oglindirea a eșuat">{outcome.error}</Notice>
              : <Notice tone="info" title="Oglindă actualizată">{outcome.sessions ?? 0} în proiecte înregistrate · {outcome.unregisteredCount ?? 0} ignorate (foldere neînregistrate) · {outcome.changes ?? 0} schimbări</Notice>) : null}
          <ErrorNotice error={refresh.error} />
          <dl className="kv">
            <dt>Ultima citire</dt><dd>{last ? `${fmt.dateTime(last.observedAt)} · ${last.ok ? `${last.sessions} sesiuni, ${last.unregisteredCount} ignorate` : `eșuată: ${last.error}`}` : "nicio citire de la pornirea Hub-ului"}</dd>
            <dt>Codex</dt><dd>{data?.codex ? (data.codex.supported ? "suportat" : data.codex.reason) : "—"}</dd>
          </dl>
        </div>
      </Panel>
      <Panel title={`Sesiuni${data ? ` (${sessions.length})` : ""}`} icon={ListTree} flush>
        {loading && !data ? <div className="panel-body"><Loading /></div> : error && !data ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : sessions.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Sesiune</th><th>Proiect</th><th>Stare</th><th>PID</th><th>Pornită</th><th>Văzută ultima dată</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}>
                <td data-label="Sesiune"><strong>{s.name || "(fără nume)"}</strong><div className="sub mono break">{s.nativeSessionId}{s.kind ? ` · ${s.kind}` : ""}</div></td>
                <td data-label="Proiect">{projectName(s.projectId)}</td>
                <td data-label="Stare"><StatusChip status={s.status} label={SESSION_RO[s.status]} /></td>
                <td data-label="PID" className="mono">{s.pid ?? "—"}</td>
                <td data-label="Pornită" className="nowrap">{s.startedAt ? fmt.dateTime(s.startedAt) : "—"}</td>
                <td data-label="Văzută ultima dată" className="nowrap">{fmt.dateTime(s.lastSeenAt)}<div className="sub">{s.observedVia}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title={all ? "Nicio sesiune oglindită" : "Nicio sesiune activă"}>Sesiunile apar după o citire a oglinzii; finalizarea unei sesiuni nu înseamnă verificare.</Empty>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- screen

const PANELS = { runs: RunsTab, locks: LocksTab, checkpoints: CheckpointsTab, schedules: SchedulesTab, policies: PoliciesTab, commands: CommandsTab, lifecycles: LifecyclesTab, skills: SkillsTab, native: NativeTab };

export default function System({ query, go }) {
  const { tab, select, visited } = usePageTabs("system", TABS, query, go);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Sistem</h1><p>Diagnostic din starea persistată: contoare, execuții cu telemetrie etichetată, lock-uri, checkpointuri, programări, politici, comenzi și evenimente corelate. Nimic de aici nu pornește modele.</p></div></div>
      <DiagnosticsHeader />
      <Tabs tabs={TABS} value={tab} onChange={select} label="Secțiuni sistem" idPrefix="system" />
      {TABS.map((t) => {
        const Content = PANELS[t.id];
        return (
          <div key={t.id} role="tabpanel" id={`system-panel-${t.id}`} aria-labelledby={`system-tab-${t.id}`} hidden={t.id !== tab}>
            {(visited.has(t.id) || t.id === tab) && <Content />}
          </div>
        );
      })}
    </div>
  );
}
