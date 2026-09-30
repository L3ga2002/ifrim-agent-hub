import { useState, useEffect } from "react";
import { Target, Plus, MessageSquare, ChevronLeft } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref } from "../store.js";
import { missionProgress } from "../lib/uiLogic.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Dialog, Notice } from "../components/ui.jsx";
import { TaskGraph } from "../components/TaskGraph.jsx";

const KIND_RO = { development: "Development", incident: "Incident", site_premium: "Site premium", site_audit: "Audit site", leads: "Lead-uri", outreach: "Outreach (doar ciorne)", project_management: "Project management", briefing: "Briefing" };

function NewMission({ onClose, go }) {
  const projects = useResource("/api/projects");
  const [form, setForm] = useState({ projectId: "", kind: "development", title: "", objective: "", acceptance: "", constraints: "" });
  useEffect(() => { if (!form.projectId && projects.data?.projects?.length) setForm((f) => ({ ...f, projectId: projects.data.projects[0].id })); }, [projects.data, form.projectId]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
  const create = useAction(async () => {
    const mission = await api("/api/missions", { method: "POST", body: { projectId: form.projectId, kind: form.kind, title: form.title.trim(), objective: form.objective.trim(), acceptance: lines(form.acceptance), constraints: lines(form.constraints) } });
    onClose(); go(`/missions/${mission.id}`);
  });
  const valid = form.title.trim().length >= 3 && form.objective.trim().length >= 5 && form.projectId;
  return (
    <Dialog title="Misiune nouă" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || create.pending} onClick={create.run}>{create.pending ? "Se creează…" : "Creează misiunea"}</button></>}>
      <div className="grid two">
        <label className="field"><span>Tip</span><select className="select" value={form.kind} onChange={set("kind")}>{Object.entries(KIND_RO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Proiect</span><select className="select" value={form.projectId} onChange={set("projectId")}>{(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label className="field"><span>Titlu</span><input className="input" value={form.title} onChange={set("title")} maxLength={160} /></label>
      <label className="field"><span>Obiectiv</span><textarea className="textarea" rows={3} value={form.objective} onChange={set("objective")} /></label>
      <label className="field"><span>Criterii de acceptanță (câte unul pe rând)</span><textarea className="textarea" rows={3} value={form.acceptance} onChange={set("acceptance")} /></label>
      <label className="field"><span>Restricții (câte una pe rând)</span><textarea className="textarea" rows={2} value={form.constraints} onChange={set("constraints")} /></label>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Misiunea creează taskuri cu roluri separate (owner → reviewer → QA) și o conversație dedicată. Nimic nu pornește automat.</p>
      <ErrorNotice error={create.error} />
    </Dialog>
  );
}

function TaskActions({ task, onDone }) {
  const [verifyNote, setVerifyNote] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const cmd = useAction(async (action, extra = {}) => { await api(`/api/tasks/${task.id}/command`, { method: "POST", body: { action, ...extra } }); onDone(); });
  const s = task.status;
  return (
    <div className="stack tight">
      <div className="row wrap">
        {["DRAFT", "BLOCKED", "FAILED", "PAUSED"].includes(s) && <button className="btn sm" disabled={cmd.pending || (!task.dependenciesMet && s === "DRAFT")} title={!task.dependenciesMet ? "Dependențele nu sunt finalizate" : ""} onClick={() => cmd.run(s === "PAUSED" ? "resume" : s === "DRAFT" ? "queue" : "retry")}>{s === "PAUSED" ? "Reia" : "Pune în coadă"}</button>}
        {["QUEUED", "RUNNING", "WAITING_PROVIDER"].includes(s) && <button className="btn sm" disabled={cmd.pending} onClick={() => cmd.run("pause")}>Pauză</button>}
        {s === "VERIFYING" && <button className="btn sm primary" onClick={() => setShowVerify(true)}>Marchează verificat</button>}
        {s === "VERIFYING" && <button className="btn sm" disabled={cmd.pending} onClick={() => cmd.run("reject", { reason: "Verificarea a găsit probleme" })}>Respinge</button>}
        {!["COMPLETED", "CANCELLED"].includes(s) && <button className="btn sm ghost" disabled={cmd.pending} onClick={() => cmd.run("cancel", { reason: "Anulat de utilizator" })}>Anulează</button>}
      </div>
      {showVerify && (
        <div className="stack tight">
          <label className="field"><span>Ce ai verificat (dovadă)</span><textarea className="textarea" rows={2} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="Ex.: am rulat npm run test:v2, 49/49; am verificat UI la 390 px" /></label>
          <div className="row"><button className="btn sm primary" disabled={verifyNote.trim().length < 10 || cmd.pending} onClick={() => cmd.run("verify", { evidence: { manualVerification: verifyNote.trim() } })}>Confirmă</button><button className="btn sm ghost" onClick={() => setShowVerify(false)}>Renunță</button></div>
        </div>
      )}
      <ErrorNotice error={cmd.error} />
    </div>
  );
}

function MissionDetail({ id, go, query }) {
  const { data, error, loading, reload } = useResource(`/api/missions/${id}`, { reloadOn: (e) => e.type.startsWith("task.") || e.scopeId === id || e.type.startsWith("run.") });
  const [selected, setSelected] = useState(query?.task || null);
  const [view, setView] = usePref("missions.view", "graph");
  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  const { mission, tasks, progress, events } = data;
  const task = tasks.find((t) => t.id === selected) || null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a className="btn sm ghost" href="#/missions"><ChevronLeft size={14} />Misiuni</a>
          <h1 style={{ marginTop: 8 }}>{mission.title}</h1>
          <p>{KIND_RO[mission.kind]} · {mission.objective}</p>
        </div>
        <div className="row wrap"><StatusChip status={mission.status} />{mission.conversationId && <button className="btn" onClick={() => go(`/conversations/${mission.conversationId}`)}><MessageSquare size={15} />Conversația misiunii</button>}</div>
      </div>
      <div className="split-main">
        <div className="stack">
          <Panel title={`Taskuri · ${progress.completed}/${progress.total} finalizate`} icon={Target}
            actions={<div className="seg" role="group" aria-label="Vedere"><button aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graf</button><button aria-pressed={view === "list"} onClick={() => setView("list")}>Listă</button></div>}>
            {(() => { const p = missionProgress(tasks); return <div className="counts small" style={{ marginBottom: 8 }}><span>{p.completed}/{p.total} finalizate</span>{p.blocked > 0 && <span className="warn">{p.blocked} blocate</span>}{p.waitingApproval > 0 && <span className="approval">{p.waitingApproval} așteaptă aprobare</span>}{p.verifying > 0 && <span>{p.verifying} în verificare</span>}<span className="faint">({p.method})</span></div>; })()}
            {view === "graph" && <div className="hide-phone"><TaskGraph tasks={tasks} onOpen={(t) => setSelected(t.id)} /></div>}
            <div className={`table-wrap ${view === "graph" ? "show-phone" : ""}`} style={{ marginTop: 12 }}>
              <table className="table table-mobile-cards">
                <thead><tr><th>Task</th><th>Rol</th><th>Etapă</th><th>Acces</th><th>Stare</th><th>Încercări</th></tr></thead>
                <tbody>{tasks.map((t) => (
                  <tr key={t.id} onClick={() => setSelected(t.id)} style={{ cursor: "pointer" }} aria-selected={selected === t.id}>
                    <td><button className="btn sm ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => setSelected(t.id)}>{t.title}</button><div className="faint" style={{ fontSize: 12 }}>{t.statusReason}</div></td>
                    <td>{t.roleId}</td><td>{t.stage}</td><td>{t.access}</td><td><StatusChip status={t.status} /></td><td>{t.attempts}/{t.maxAttempts}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Cronologie" flush>
            {events.length ? <ul className="list">{events.slice().reverse().slice(0, 40).map((e) => (
              <li key={e.seq}><div className="list-row"><span className="faint mono nowrap">{fmt.dateTime(e.createdAt)}</span><span className="grow ellipsis">{e.type}{e.payload?.reason ? ` — ${e.payload.reason}` : ""}</span><span className="faint">{e.source}</span></div></li>
            ))}</ul> : <Empty title="Fără evenimente" />}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Criterii și restricții">
            <div className="section-title">Criterii de acceptanță</div>
            {mission.acceptance.length ? <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>{mission.acceptance.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="muted">Niciun criteriu definit.</p>}
            <div className="section-title">Restricții</div>
            {mission.constraints.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{mission.constraints.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nicio restricție specifică.</p>}
          </Panel>
          {task ? (
            <Panel title={task.title} actions={<button className="btn sm ghost" onClick={() => setSelected(null)}>Închide</button>}>
              <div className="stack">
                <dl className="kv">
                  <dt>Stare</dt><dd><StatusChip status={task.status} /></dd><dt>Motiv</dt><dd>{task.statusReason || "—"}</dd>
                  <dt>Rol · etapă</dt><dd>{task.roleId} · {task.stage}</dd><dt>Dependențe</dt><dd>{task.dependsOn.length ? (task.dependenciesMet ? "finalizate" : "în așteptare") : "niciuna"}</dd>
                  <dt>Owner → Reviewer → QA</dt><dd>{["owner", "reviewer", "qa"].map((st) => tasks.filter((x) => x.stage === st).map((x) => x.roleId).join(", ") || "—").join(" → ")}</dd>
                  <dt>Ultima activitate</dt><dd>{task.lastActivityAt ? fmt.dateTime(task.lastActivityAt) : "nicio activitate înregistrată"}</dd>
                  {task.evidence && Object.keys(task.evidence).length > 0 && <><dt>Dovezi</dt><dd>{task.evidence.manualVerification || JSON.stringify(task.evidence).slice(0, 300)}</dd></>}
                </dl>
                {task.acceptance?.length > 0 && <div><div className="section-title">Criterii</div><ul className="plain-list">{task.acceptance.map((a) => <li key={a}>{a}</li>)}</ul></div>}
                <TaskActions task={task} onDone={reload} />
                {task.runs.length > 0 && <div><div className="section-title">Execuții (dovezi separate)</div><ul className="list">{task.runs.map((r) => <li key={r.id}><div className="list-row" style={{ padding: "6px 0" }}><span className="grow">{r.provider} · {r.stage} · {fmt.dateTime(r.createdAt)}</span><StatusChip status={r.status} /></div></li>)}</ul></div>}
                <div><div className="section-title">Tranziții</div><ul className="list">{task.transitions.map((tr) => <li key={tr.id}><div className="list-row" style={{ padding: "6px 0", flexWrap: "wrap" }}><span className="mono nowrap">{tr.from_status} → {tr.to_status}</span><span className="faint grow">{tr.reason}</span></div></li>)}</ul></div>
                {task.status === "VERIFYING" && <Notice tone="info">Un răspuns terminat de model nu înseamnă COMPLETED. Finalizarea cere dovadă de verificare.</Notice>}
              </div>
            </Panel>
          ) : <Panel><Empty title="Selectează un task">Din graf sau din tabel.</Empty></Panel>}
        </div>
      </div>
    </div>
  );
}

export default function Missions({ id, go, query }) {
  const { data, error, loading, reload } = useResource(id ? null : "/api/missions", { reloadOn: (e) => e.type.startsWith("mission.") || e.type.startsWith("task.") });
  const [creating, setCreating] = useState(Boolean(query?.new));
  if (id) return <MissionDetail id={id} go={go} query={query} />;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Misiuni</h1><p>Fluxuri utilizabile pentru Ifrim Digital, fiecare cu criterii, dependențe și dovezi. Progresul se calculează din taskuri finalizate.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Misiune nouă</button>
      </div>
      <Panel title="Toate misiunile" icon={Target} flush>
        {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : data.missions.length ? (
          <ul className="list">{data.missions.map((m) => (
            <li key={m.id}><a className="list-row" href={`#/missions/${m.id}`}>
              <div className="grow"><div className="title ellipsis">{m.title}</div><div className="sub ellipsis">{KIND_RO[m.kind]} · {m.objective}</div></div>
              <span className="muted nowrap hide-mobile">{m.progress.completed}/{m.progress.total}</span><StatusChip status={m.status} />
            </a></li>
          ))}</ul>
        ) : <Empty title="Nicio misiune" action={<button className="btn primary sm" onClick={() => setCreating(true)}>Creează prima misiune</button>}>Tipuri: development, incident, site premium, audit site, lead-uri, outreach, project management, briefing.</Empty>}
      </Panel>
      {creating && <NewMission onClose={() => setCreating(false)} go={go} />}
    </div>
  );
}
