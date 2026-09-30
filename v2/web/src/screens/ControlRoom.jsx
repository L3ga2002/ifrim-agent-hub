import { useMemo, useState } from "react";
import { Target, ShieldCheck, AlertTriangle, ArrowRight, MessageSquare, Plus, Building2, HardDrive, Plug, Activity, Network, Layers, Square, CircleDot, Clock } from "lucide-react";
import { useHub, useResource, usePref } from "../store.js";
import { fmt } from "../api.js";
import { Core3D } from "../components/core/Core3D.jsx";
import { Panel, StatusChip, Empty, Chip, ErrorNotice } from "../components/ui.jsx";
import { TaskGraph } from "../components/TaskGraph.jsx";
import { deriveCoreState, CORE_VISUALS } from "../lib/coreState.js";
import { errorStage, missionProgress } from "../lib/uiLogic.js";

const PRIORITY = { WAITING_APPROVAL: 0, BLOCKED: 1, FAILED: 1, WAITING_PROVIDER: 2 };

function DecideColumn({ hub, go }) {
  const blockers = [...(hub.blockedTasks || [])].sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9));
  return (
    <Panel title="Ce trebuie să decid" icon={ShieldCheck} className={hub.pendingApprovals ? "accent-approval" : ""} flush
      actions={<a className="btn sm ghost" href="#/approvals">Aprobări <ArrowRight size={14} /></a>}>
      {hub.approvals.length || blockers.length ? (
        <ul className="list">
          {hub.approvals.map((a) => (
            <li key={a.id}><a className="list-row" href="#/approvals">
              <span className="decide-kind approval" aria-hidden="true"><ShieldCheck size={15} /></span>
              <div className="grow"><div className="title ellipsis">Aprobare: {a.actionKind}</div><div className="sub ellipsis mono">{a.payload?.command || a.payload?.url || a.target}</div></div>
              <span className="faint nowrap small"><Clock size={12} aria-hidden="true" /> expiră {fmt.time(a.expiresAt)}</span>
            </a></li>
          ))}
          {blockers.slice(0, 6).map((t) => (
            <li key={t.id}><a className="list-row" href={t.missionId ? `#/missions/${t.missionId}?task=${t.id}` : "#/missions"}>
              <span className="decide-kind blocked" aria-hidden="true"><AlertTriangle size={15} /></span>
              <div className="grow"><div className="title ellipsis">{t.title}</div><div className="sub ellipsis">{t.statusReason || "fără motiv înregistrat"}</div></div>
              <StatusChip status={t.status} />
            </a></li>
          ))}
        </ul>
      ) : <Empty title="Nimic de decis acum">Aprobările (acțiunea exactă, ținta, expirarea) și blocajele apar aici în ordinea priorității.</Empty>}
    </Panel>
  );
}

function ContinueColumn({ hub, go }) {
  const convs = hub.recentConversations || [];
  const results = hub.recentResults || [];
  return (
    <Panel title="Unde continui" icon={MessageSquare} flush actions={<a className="btn sm ghost" href="#/conversations">Focus <ArrowRight size={14} /></a>}>
      {convs.length ? (
        <ul className="list">{convs.map((c) => (
          <li key={c.id}><a className="list-row" href={`#/conversations/${c.id}`}>
            <MessageSquare size={15} aria-hidden="true" color="var(--text-2)" />
            <div className="grow"><div className="title ellipsis">{c.title}</div><div className="sub ellipsis">{c.projectName || "—"} · {fmt.ago(c.updatedAt)}</div></div>
            {c.status !== "idle" && <StatusChip status={c.status === "running" ? "running" : c.status === "handoff" ? "in_progress" : "waiting"} />}
          </a></li>
        ))}</ul>
      ) : <Empty title="Nicio conversație" action={<button className="btn sm primary" onClick={() => go("/conversations")}><Plus size={14} />Deschide Focus</button>}>Conversațiile păstrează firul complet între provideri.</Empty>}
      {results.length > 0 && (
        <>
          <div className="section-title panel-sub">Rezultate recente</div>
          <ul className="list">{results.map((r) => (
            <li key={r.id}><a className="list-row" href={r.conversationId ? `#/conversations/${r.conversationId}` : "#/conversations"}>
              <div className="grow"><div className="title">{r.provider === "codex" ? "Codex" : "Claude Code"} · {r.stage}{r.model ? ` · ${r.model}` : ""}</div>
                <div className="sub">{fmt.ago(r.finishedAt || r.createdAt)}{r.errorCategory ? ` · ${errorStage(r.errorCategory, { preInference: r.preInference })}` : ""}</div></div>
              <StatusChip status={r.status} />
            </a></li>
          ))}</ul>
        </>
      )}
    </Panel>
  );
}

function HappeningPanel({ hub, core, go }) {
  const mission = hub.missions?.[0] || null;
  const detail = useResource(mission ? `/api/missions/${mission.id}` : null, { reloadOn: (e) => e.type.startsWith("task.") || e.type.startsWith("mission."), deps: [mission?.id] });
  const p = detail.data ? missionProgress(detail.data.tasks) : null;
  return (
    <div className="happening">
      <div className="happening-runs">
        <div className="section-title">Execuții active</div>
        {hub.activeRuns.length ? (
          <ul className="list">{hub.activeRuns.map((r) => (
            <li key={r.runId}><a className="list-row" href={`#/conversations/${r.conversationId}`}>
              <span className={`pulse-dot ${r.phase === "streaming" ? "" : "wait"}`} aria-hidden="true" />
              <div className="grow"><div className="title">{r.provider === "codex" ? "Codex" : "Claude Code"}</div><div className="sub">{r.phase === "streaming" ? "primește răspuns" : "așteaptă primul răspuns (nu este progres)"} · pornit {fmt.ago(r.startedAt)}</div></div>
              <StatusChip status="running" />
            </a></li>
          ))}</ul>
        ) : (
          <div className="none-active">
            <strong>Nicio execuție activă</strong>
            <span className="faint small">{hub.mode === "BUILD_SAFE" ? "BUILD_SAFE: poți pregăti conversații și misiuni; execuția cu model cere autorizare." : hub.executionGate.status === "open" ? "Poți porni o execuție dintr-o conversație." : `Poarta este suspendată: ${hub.executionGate.reason}`}</span>
            <div className="row wrap"><button className="btn sm" onClick={() => go("/conversations")}><MessageSquare size={14} />Conversație</button><button className="btn sm" onClick={() => go("/missions?new=1")}><Target size={14} />Misiune nouă</button></div>
          </div>
        )}
      </div>
      <div className="happening-mission">
        <div className="section-title">Misiunea curentă</div>
        {mission ? (
          <a className="mission-card" href={`#/missions/${mission.id}`}>
            <div className="row"><strong className="ellipsis grow">{mission.title}</strong><StatusChip status={mission.status} /></div>
            {p && <div className="counts small"><span>{p.completed}/{p.total} finalizate</span>{p.blocked > 0 && <span className="warn">{p.blocked} blocate</span>}{p.waitingApproval > 0 && <span className="approval">{p.waitingApproval} așteaptă aprobare</span>}</div>}
            {p && p.total > 0 && <div className="bar" role="progressbar" aria-label="Taskuri finalizate" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.completed}><i style={{ width: `${(p.completed / p.total) * 100}%` }} /></div>}
          </a>
        ) : <Empty title="Nicio misiune activă" action={<button className="btn sm primary" onClick={() => go("/missions?new=1")}>Creează o misiune</button>}>Misiunile au criterii, owner → reviewer → QA și dovezi.</Empty>}
        {detail.data?.tasks?.length > 0 && <div className="mini-graph"><TaskGraph tasks={detail.data.tasks} onOpen={() => go(`/missions/${mission.id}`)} /></div>}
      </div>
    </div>
  );
}

function CompanyStrip({ hub }) {
  const depts = (hub.company?.departments || []).filter((d) => d.status === "active");
  return (
    <Panel title="Companie" icon={Building2} actions={<a className="btn sm ghost" href="#/company">Structură <ArrowRight size={14} /></a>}>
      <div className="dept-strip">
        {depts.map((d) => <a key={d.key} className="dept-pill" href={`#/company?dept=${d.key}`}><span>{d.name}</span><span className="faint small">{d.roles} roluri</span></a>)}
      </div>
      <p className="faint small" style={{ margin: "8px 0 0" }}>{depts.length} departamente active și {hub.company?.roles ?? "—"} roluri configurate (structură, nu muncă făcută). Execuții active: {hub.activeRuns.length}.</p>
    </Panel>
  );
}

function HealthStrip({ hub }) {
  const b = hub.backup;
  return (
    <div className="health-strip" role="list" aria-label="Sănătate">
      <div role="listitem"><HardDrive size={15} aria-hidden="true" /><span>Backup</span><strong className={b?.ok ? "ok" : "warn"}>{b?.ok ? `verificat ${fmt.ago(b.backup.createdAt)}` : "se creează înainte de execuție"}</strong></div>
      {(hub.providers || []).map((p) => (
        <div role="listitem" key={p.id}><Plug size={15} aria-hidden="true" /><span>{p.id === "codex" ? "Codex" : "Claude"}</span><strong className={p.route?.allowed ? "ok" : "warn"}>{p.route?.allowed ? "rută verificată" : "rută neverificată"}</strong></div>
      ))}
      <div role="listitem"><Network size={15} aria-hidden="true" /><span>Suprafețe</span><strong>{hub.surfaces?.available ?? "—"} disponibile · {hub.surfaces?.assisted ?? "—"} asistate</strong></div>
      <div role="listitem"><Layers size={15} aria-hidden="true" /><span>Sesiuni native</span><strong>{hub.nativeSessions ?? 0} oglindite</strong></div>
      <div role="listitem"><Activity size={15} aria-hidden="true" /><span>Programări</span><strong>{hub.schedules?.active ?? 0} active</strong></div>
    </div>
  );
}

export default function ControlRoom({ go }) {
  const hub = useHub((s) => s.hub);
  const error = useHub((s) => s.error);
  const connection = useHub((s) => s.connection);
  const voicePhase = useHub((s) => s.voicePhase);
  const [coreOn] = usePref("core3d", true);
  const [renderer, setRenderer] = useState("webgl");
  const core = useMemo(() => deriveCoreState({ hub, connection, voicePhase }), [hub, connection, voicePhase]);
  if (!hub) return <div className="page"><ErrorNotice error={error ? { message: error, status: 0 } : null} /></div>;
  const v = CORE_VISUALS[core.state];
  return (
    <div className="page control-room">
      <section className="cr-hero" aria-label="Ce se întâmplă">
        <div className={`cr-core state-${core.state}`}>
          <Core3D state={core.state} disabled={!coreOn} onRenderer={setRenderer} />
        </div>
        <div className="cr-status">
          <div className="cr-kicker"><CircleDot size={13} aria-hidden="true" />IFRIM DIGITAL AGENT HUB</div>
          <h1 className="cr-state" aria-live="polite">{v.label}</h1>
          <p className="cr-reason">{core.reason}</p>
          <div className="row wrap cr-chips">
            <Chip tone={hub.mode === "BUILD_SAFE" ? "info" : "warn"}>{hub.mode}</Chip>
            <Chip tone={hub.executionGate.status === "open" ? "ok" : "neutral"}>poartă {hub.executionGate.status === "open" ? "deschisă" : "suspendată"}</Chip>
            {hub.pendingApprovals > 0 && <Chip tone="approval">{hub.pendingApprovals} aprobări</Chip>}
            <span className="faint small">nucleu: {renderer === "webgl" ? "3D (WebGL2)" : "2D (SVG)"}{coreOn ? "" : " · dezactivat din setări"}</span>
          </div>
          <HappeningPanel hub={hub} core={core} go={go} />
        </div>
      </section>
      <div className="cr-grid">
        <DecideColumn hub={hub} go={go} />
        <ContinueColumn hub={hub} go={go} />
      </div>
      <div className="cr-grid">
        <CompanyStrip hub={hub} />
        <Panel title="Sănătate" icon={Activity}><HealthStrip hub={hub} /></Panel>
      </div>
      {hub.recentFailures?.length > 0 && (
        <Panel title="Eșecuri recente (30 min)" icon={AlertTriangle} flush>
          <ul className="list">{hub.recentFailures.map((f) => (
            <li key={f.id}><div className="list-row"><AlertTriangle size={15} color="var(--danger)" aria-hidden="true" /><div className="grow"><div className="title">{f.provider} · {errorStage(f.category, { preInference: f.preInference })}</div><div className="sub ellipsis">{f.message}</div></div><span className="faint nowrap small">{fmt.ago(f.createdAt)}</span></div></li>
          ))}</ul>
        </Panel>
      )}
      <p className="faint small cr-foot"><Square size={10} aria-hidden="true" /> Stop All este mereu în bara de sus; confirmă ce s-a oprit și ce rămâne în așteptare.</p>
    </div>
  );
}
