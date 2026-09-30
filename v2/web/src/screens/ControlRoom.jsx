import { useMemo, Fragment } from "react";
import { Target, ShieldCheck, Activity, HardDrive, AlertTriangle, Plug, Gauge, ListChecks, ArrowRight } from "lucide-react";
import { useHub, usePref, useResource } from "../store.js";
import { fmt } from "../api.js";
import { Core, CORE_STATES } from "../components/Core.jsx";
import { Panel, StatusChip, Empty, Chip, ErrorNotice } from "../components/ui.jsx";
import { TaskGraph } from "../components/TaskGraph.jsx";

/** Core state from real signals only, with the reason shown next to it. */
export function deriveCoreState(hub, voicePhase) {
  if (!hub) return ["idle", "Se încarcă starea"];
  if (voicePhase === "listening") return ["listening", "Microfonul este activ (ții apăsat butonul)"];
  if (voicePhase === "transcribing") return ["transcribing", "Se transcrie comanda vocală"];
  if (hub.pendingApprovals > 0) return ["approval", `${hub.pendingApprovals} ${hub.pendingApprovals === 1 ? "aprobare așteaptă" : "aprobări așteaptă"} decizia ta`];
  if (hub.activeRuns?.length) return ["executing", `${hub.activeRuns.length} ${hub.activeRuns.length === 1 ? "execuție activă" : "execuții active"}`];
  if (hub.backupRunning > 0) return ["processing", "Backup în curs, cu verificare de restaurare"];
  if (hub.verifyingTasks > 0) return ["verifying", `${hub.verifyingTasks} ${hub.verifyingTasks === 1 ? "task așteaptă" : "taskuri așteaptă"} verificare`];
  if (hub.recentFailures?.length || Object.values(hub.breakers || {}).some((b) => b.state === "open")) return ["error", `${hub.recentFailures.length} eșecuri în ultimele 30 min`];
  return ["idle", hub.executionGate?.status === "open" ? "Nicio execuție activă" : "Poarta de execuție este suspendată; nimic nu rulează"];
}

export default function ControlRoom({ go }) {
  const hub = useHub((s) => s.hub);
  const error = useHub((s) => s.error);
  const voicePhase = useHub((s) => s.voicePhase);
  const [core3d] = usePref("core3d", true);
  const [state, why] = deriveCoreState(hub, voicePhase);
  const mission = hub?.missions?.[0] || null;
  const missionDetail = useResource(mission ? `/api/missions/${mission.id}` : null, { reloadOn: (e) => e.type.startsWith("task.") || e.type.startsWith("mission."), deps: [mission?.id] });
  const hubBackup = hub?.backup;

  const providerRows = useMemo(() => (hub?.providers || []).map((p) => ({
    id: p.id, name: p.id === "codex" ? "Codex" : "Claude Code",
    installed: p.installation ? (p.installation.installed ? p.installation.version : "nu este instalat") : "neinspectat",
    route: p.route?.allowed, probedAt: p.probedAt,
  })), [hub]);

  if (!hub) return <div className="page"><ErrorNotice error={error ? { message: error, status: 0 } : null} /></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Control Room</h1><p>Misiunea curentă, blocajele, aprobările și sănătatea sistemului, din starea persistată a Hub-ului.</p></div>
      </div>
      <div className="control">
        <div className="col left">
          <section className="panel core-panel" aria-label="Nucleu">
            <div className="core-canvas"><Core state={state} disabled={!core3d} /></div>
            <div className="core-state" aria-live="polite"><div className="label">{CORE_STATES[state].label}</div><div className="why">{why}</div></div>
            <div className="stat-row">
              <a href="#/approvals"><span className="n">{hub.pendingApprovals}</span><span className="l">aprobări</span></a>
              <a href="#/missions"><span className="n">{hub.blockedTasks.filter((t) => ["BLOCKED", "FAILED"].includes(t.status)).length}</span><span className="l">blocate</span></a>
              <a href="#/agents"><span className="n">{hub.activeRuns.length}</span><span className="l">execuții</span></a>
            </div>
          </section>
          <Panel title="Blocaje" icon={AlertTriangle} flush>
            {hub.blockedTasks.length ? (
              <ul className="list">
                {hub.blockedTasks.slice(0, 6).map((t) => (
                  <li key={t.id}><a className="list-row" href={t.missionId ? `#/missions/${t.missionId}` : "#/missions"}>
                    <div className="grow"><div className="title ellipsis">{t.title}</div><div className="sub ellipsis">{t.statusReason}</div></div>
                    <StatusChip status={t.status} />
                  </a></li>
                ))}
              </ul>
            ) : <Empty title="Niciun blocaj">Taskurile blocate, eșuate sau în așteptare apar aici cu motivul lor.</Empty>}
          </Panel>
        </div>

        <div className="col">
          <Panel title="Misiunea curentă" icon={Target} actions={<a className="btn sm ghost" href="#/missions">Toate <ArrowRight size={14} /></a>}>
            {mission ? (
              <div className="stack">
                <div className="mission-head">
                  <div className="grow">
                    <div className="row"><strong className="ellipsis" style={{ fontSize: 16 }}>{mission.title}</strong><StatusChip status={mission.status} /></div>
                    <p className="muted" style={{ margin: "4px 0 0" }}>{mission.objective}</p>
                  </div>
                  <div className="progress" title={mission.progress.method}>
                    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={mission.progress.total} aria-valuenow={mission.progress.completed}><i style={{ width: `${mission.progress.total ? (mission.progress.completed / mission.progress.total) * 100 : 0}%` }} /></div>
                    <span className="nowrap">{mission.progress.completed}/{mission.progress.total} taskuri</span>
                  </div>
                </div>
                {missionDetail.data?.tasks ? <TaskGraph tasks={missionDetail.data.tasks} onOpen={() => go(`/missions/${mission.id}`)} /> : null}
                <p className="faint" style={{ margin: 0, fontSize: 12 }}>Progres = taskuri finalizate / taskuri neanulate. Graful arată doar dependențe reale.</p>
              </div>
            ) : (
              <Empty title="Nicio misiune activă" action={<button className="btn primary sm" onClick={() => go("/missions?new=1")}>Creează o misiune</button>}>
                Misiunile au criterii de acceptanță și traseu owner → reviewer → QA.
              </Empty>
            )}
          </Panel>
          <Panel title="Execuții și handoff" icon={Activity} flush>
            {hub.activeRuns.length ? (
              <ul className="list">{hub.activeRuns.map((r) => (
                <li key={r.runId}><a className="list-row" href={`#/conversations/${r.conversationId}`}>
                  <span className="pulse-dot" aria-hidden="true" /><div className="grow"><div className="title">{r.provider === "codex" ? "Codex" : "Claude Code"}</div><div className="sub mono">run {fmt.short(r.runId)} · pid {r.pid || "—"}</div></div><StatusChip status="running" />
                </a></li>
              ))}</ul>
            ) : <Empty title="Nicio execuție activă">{hub.executionGate.status === "open" ? "Pornește o execuție dintr-o conversație." : `Poarta este suspendată: ${hub.executionGate.reason}`}</Empty>}
            {hub.recentFailures?.length > 0 && (
              <ul className="list" aria-label="Eșecuri recente">{hub.recentFailures.map((f) => (
                <li key={f.id}><div className="list-row"><AlertTriangle size={16} color="var(--danger)" aria-hidden="true" /><div className="grow"><div className="title">{f.provider} · {f.category}{f.preInference ? " · înainte de model" : ""}</div><div className="sub ellipsis">{f.message}</div></div><span className="faint nowrap">{fmt.ago(f.createdAt)}</span></div></li>
              ))}</ul>
            )}
          </Panel>
        </div>

        <div className="col right">
          <Panel title="Aprobări" icon={ShieldCheck} className={hub.pendingApprovals ? "accent-approval" : ""} actions={<a className="btn sm ghost" href="#/approvals">Deschide</a>} flush>
            {hub.approvals.length ? (
              <ul className="list">{hub.approvals.map((a) => (
                <li key={a.id}><a className="list-row" href="#/approvals"><div className="grow"><div className="title ellipsis">{a.actionKind}</div><div className="sub ellipsis mono">{a.payload?.command || a.target}</div></div><span className="faint nowrap">expiră {fmt.time(a.expiresAt)}</span></a></li>
              ))}</ul>
            ) : <Empty title="Nimic de aprobat">Cererile arată acțiunea exactă, ținta și expirarea.</Empty>}
          </Panel>
          <Panel title="Sănătate" icon={Gauge}>
            <dl className="kv">
              <dt>Mod</dt><dd>{hub.mode}</dd>
              <dt>Poartă</dt><dd><StatusChip status={hub.executionGate.status} /> <span className="muted">{hub.executionGate.reason}</span></dd>
              <dt>Backup Hub</dt><dd>{hubBackup?.ok ? `verificat ${fmt.ago(hubBackup.backup.createdAt)}` : hubBackup?.reason || "—"}</dd>
              <dt>Lease-uri</dt><dd>{hub.leases.length ? hub.leases.map((l) => `${l.holder} (${l.status})`).join(", ") : "niciunul"}</dd>
              {providerRows.map((p) => (<Fragment key={p.id}>
                <dt>{p.name}</dt>
                <dd><span className="row wrap"><Chip tone={p.route ? "ok" : "neutral"} icon={Plug}>{p.route ? "rută verificată" : "rută neverificată"}</Chip><span className="muted">{p.installed}</span></span></dd>
              </Fragment>))}
            </dl>
          </Panel>
          <Panel title="Briefing" icon={ListChecks} actions={<a className="btn sm ghost" href="#/company?tab=leads">Detalii</a>}>
            <dl className="kv">
              <dt>Conversații</dt><dd>{hub.counts.conversations}</dd>
              <dt>Misiuni</dt><dd>{hub.counts.missions}</dd>
              <dt>De verificat</dt><dd>{hub.verifyingTasks}</dd>
              <dt>Memorie activă</dt><dd>{hub.counts.memory} înregistrări</dd>
              {hub.legacy && <><dt>Date V1</dt><dd>importate {fmt.dateTime(hub.legacy.importedAt)}</dd></>}
            </dl>
          </Panel>
          {!hubBackup?.ok && <Panel title="Backup" icon={HardDrive}><p className="muted" style={{ margin: 0 }}>Nicio execuție cu model nu pornește fără un backup complet, restaurat și verificat în ultimele 30 de minute. Hub-ul îl creează automat înainte de admitere.</p></Panel>}
        </div>
      </div>
    </div>
  );
}
