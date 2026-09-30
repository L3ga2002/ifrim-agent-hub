import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, Users, Download, Upload, Building2, Target, Compass, Network, Plus, ChevronDown, ChevronRight, Crown, BadgeCheck, Sparkles, Flag, AlertTriangle, ShieldAlert } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref } from "../store.js";
import { Panel, Loading, ErrorNotice, Empty, Chip, StatusChip, Notice, Dialog } from "../components/ui.jsx";

const TABS = [
  { id: "structure", label: "Structură", icon: Building2 },
  { id: "goals", label: "Obiective", icon: Target },
  { id: "cos", label: "Chief of Staff", icon: Compass },
  { id: "leads", label: "Lead-uri & briefing", icon: Users },
];
const NEVER = () => false;
const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "externe", SENSITIVE_ACTIONS: "sensibile" };
const DEPT_STATUS_RO = { active: "activ", planned: "planificat", paused: "în pauză", unknown: "necunoscut" };
const GOAL_RO = { DRAFT: "Ciornă", ACTIVE: "Activ", AT_RISK: "La risc", BLOCKED: "Blocat", ACHIEVED: "Atins", ABANDONED: "Abandonat" };
const GOAL_ACTION_RO = { DRAFT: "Înapoi la ciornă", ACTIVE: "Activează", AT_RISK: "Marchează la risc", BLOCKED: "Marchează blocat", ACHIEVED: "Marchează atins", ABANDONED: "Abandonează" };
const OBJ_RO = { OPEN: "Deschis", IN_PROGRESS: "În lucru", MET: "Atins", MISSED: "Ratat", DROPPED: "Renunțat" };
const GOAL_TERMINAL = ["ACHIEVED", "ABANDONED"];
const PRIORITY_RO = { 1: "P1 · ridicată", 2: "P2 · normală", 3: "P3 · scăzută" };
const LEAD_RO = { new: "nou", researching: "în cercetare", qualified: "calificat", not_a_fit: "nepotrivit", contacted_manually: "contactat manual", archived: "arhivat" };
const OBJECTIVE_MAX = 4000;
const companyEvent = (e) => /^(company|department|goal|objective|mission|task)\./.test(e.type) || (e.type.startsWith("run.") && !e.type.startsWith("run.activity"));

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
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

function Meter({ value, total, label }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <span className="meter">
      <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total || 0} aria-valuenow={value} aria-label={label}><i style={{ width: `${pct}%` }} /></span>
      {label}
    </span>
  );
}

const roleNameFrom = (departments) => {
  const names = new Map();
  for (const d of departments || []) for (const r of d.roles || []) names.set(r.id, r.name);
  return (id) => (id ? names.get(id) || id : "—");
};

// ---------------------------------------------------------------- Structură

function OrgTree({ org, departments }) {
  const deptName = (key) => departments.find((d) => d.key === key)?.name || key || "fără departament";
  const byManager = useMemo(() => {
    const map = new Map();
    for (const role of org.roles) { const key = role.reportsTo || ""; if (!map.has(key)) map.set(key, []); map.get(key).push(role); }
    return map;
  }, [org]);
  const known = new Set(org.roles.map((r) => r.id));
  const underOwner = org.roles.filter((r) => r.reportsTo === "owner");
  const detached = org.roles.filter((r) => r.reportsTo !== "owner" && (!r.reportsTo || !known.has(r.reportsTo)));
  const node = (role, seen) => {
    if (seen.has(role.id)) return null;
    const path = new Set(seen).add(role.id);
    const reports = (byManager.get(role.id) || []).filter((r) => !path.has(r.id));
    return (
      <li key={role.id}>
        <div className="org-node">
          <span className="title">{role.name}</span>
          <span className="meta">{deptName(role.department)}</span>
          <Chip title="Autoritatea rolului">{TIER_RO[role.authority] || role.authority}</Chip>
          {reports.length > 0 && <span className="meta">{reports.length} {reports.length === 1 ? "subordonat" : "subordonați"}</span>}
        </div>
        {reports.length > 0 && <ul>{reports.map((r) => node(r, path))}</ul>}
      </li>
    );
  };
  return (
    <div className="stack">
      <ul className="org-tree" aria-label="Organigramă">
        <li>
          <div className="org-node owner"><Crown size={15} aria-hidden="true" /><span className="title">{org.owner}</span><span className="meta">fondator · decide și aprobă</span></div>
          {underOwner.length > 0 && <ul>{underOwner.map((r) => node(r, new Set()))}</ul>}
        </li>
        {detached.map((r) => node(r, new Set()))}
      </ul>
      {detached.length > 0 && <p className="faint small" style={{ margin: 0 }}>{detached.length} {detached.length === 1 ? "rol nu are" : "roluri nu au"} manager în organigramă.</p>}
      <p className="faint small" style={{ margin: 0 }}>{org.note}</p>
    </div>
  );
}

function DepartmentStatusDialog({ department, onClose, onDone }) {
  const [status, setStatus] = useState(department.status);
  const [reason, setReason] = useState("");
  const save = useAction(async () => {
    await api(`/api/company/departments/${encodeURIComponent(department.key)}/status`, { method: "POST", body: { status, reason: reason.trim() } });
    onDone(); onClose();
  });
  const valid = status !== department.status && reason.trim().length >= 3;
  return (
    <Dialog title={`Stare: ${department.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se salvează…" : "Salvează starea"}</button></>}>
      <div className="field"><span>Stare nouă (acum: {DEPT_STATUS_RO[department.status] || department.status})</span>
        <div className="seg wrap" role="group" aria-label="Stare nouă">
          {["active", "planned", "paused"].map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{DEPT_STATUS_RO[s]}</button>)}
        </div>
      </div>
      <label className="field"><span>Motiv (obligatoriu, minimum 3 caractere)</span><textarea className="textarea" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <p className="faint small" style={{ margin: 0 }}>Starea nu pornește și nu oprește modele. Propunerile Chief of Staff către un departament planificat sau în pauză primesc un avertisment, iar misiunile rămân DRAFT.</p>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function DepartmentCard({ department: d, roleName, onEdit }) {
  return (
    <Panel className={`dept-${d.status}`} title={d.name} actions={<StatusChip status={d.status} label={DEPT_STATUS_RO[d.status]} />}>
      <div className="stack tight">
        <p className="muted" style={{ margin: 0 }}>{d.purpose}</p>
        <div className="chips">
          {d.milestoneValidated ? <Chip tone="ok" icon={BadgeCheck} title="Validat în Milestone 01">validat M01</Chip> : <Chip title="Structură planificată, încă nevalidată">nevalidat</Chip>}
          <Chip icon={Crown} title="Rol-șef al departamentului">{d.headRoleId ? roleName(d.headRoleId) : "fără rol-șef"}</Chip>
          <span className="faint mono small">{d.key}</span>
        </div>
        <div>
          <div className="section-title">Roluri ({d.roles.length})</div>
          {d.roles.length ? <div className="chips">{d.roles.map((r) => <Chip key={r.id} title={`Autoritate: ${TIER_RO[r.authority] || r.authority}`}>{r.name}</Chip>)}</div>
            : <p className="faint" style={{ margin: 0 }}>Niciun rol atribuit încă.</p>}
        </div>
        <dl className="stat-tiles four">
          <Tile label="obiective deschise" value={d.counts.goals} />
          <Tile label="misiuni deschise" value={d.counts.missions} />
          <Tile label="necesită atenție" value={d.counts.attention} tone={d.counts.attention ? "attention" : ""} />
          <Tile label="execuții active" value={d.counts.activeRuns} tone={d.counts.activeRuns ? "live" : ""} />
        </dl>
        <div className="row"><button className="btn sm ghost" onClick={() => onEdit(d)}>Schimbă starea</button></div>
      </div>
    </Panel>
  );
}

function Structure() {
  const overview = useResource("/api/company", { reloadOn: companyEvent });
  const org = useResource("/api/company/org", { reloadOn: (e) => e.type.startsWith("company.") || e.type.startsWith("department.") });
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  if (overview.loading && !overview.data) return <Loading lines={6} />;
  if (overview.error && !overview.data) return <ErrorNotice error={overview.error} onRetry={overview.reload} />;
  const { company, departments = [], goals = [], clients = [] } = overview.data || {};
  const roleName = roleNameFrom(departments);
  const count = (s) => departments.filter((d) => d.status === s).length;
  const shown = departments.filter((d) => filter === "all" || d.status === filter);
  const rolesTotal = org.data?.roles?.length ?? departments.reduce((n, d) => n + d.roles.length, 0);
  return (
    <div className="stack">
      <ErrorNotice error={overview.error} onRetry={overview.reload} />
      <Panel title={company?.name || "Companie"} icon={Building2} actions={company?.slug ? <span className="faint mono small">{company.slug}</span> : null}>
        {company ? (
          <div className="stack">
            <p style={{ margin: 0 }}>{company.mission}</p>
            <dl className="stat-tiles">
              <Tile label="departamente" value={departments.length} />
              <Tile label="active" value={count("active")} tone="good" />
              <Tile label="validate în M01" value={departments.filter((d) => d.milestoneValidated).length} />
              <Tile label="roluri definite" value={rolesTotal} />
              <Tile label="obiective deschise" value={goals.filter((g) => !GOAL_TERMINAL.includes(g.status)).length} />
              <Tile label="clienți" value={clients.length} />
            </dl>
            <p className="faint small" style={{ margin: 0 }}>Fondator: {company.owner} · creată {fmt.dateTime(company.createdAt)}. Rolurile sunt definiții (AgentRole); un rol nu înseamnă un model pornit.</p>
          </div>
        ) : <Empty title="Compania nu este încă inițializată">Seed-ul rulează la pornirea Hub-ului.</Empty>}
      </Panel>
      <div className="split-main">
        <div className="stack">
          <div className="row between wrap">
            <h2 className="block-title"><Building2 size={16} aria-hidden="true" />Departamente</h2>
            <div className="seg wrap" role="group" aria-label="Filtru departamente">
              {[["all", `Toate (${departments.length})`], ["active", `Active (${count("active")})`], ["planned", `Planificate (${count("planned")})`], ["paused", `În pauză (${count("paused")})`]].map(([k, v]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{v}</button>
              ))}
            </div>
          </div>
          {shown.length ? <div className="grid two">{shown.map((d) => <DepartmentCard key={d.id} department={d} roleName={roleName} onEdit={setEditing} />)}</div>
            : <Panel><Empty title="Niciun departament în această stare" /></Panel>}
        </div>
        <Panel title="Organigramă" icon={Network}>
          {org.loading && !org.data ? <Loading lines={6} /> : org.error && !org.data ? <ErrorNotice error={org.error} onRetry={org.reload} /> : org.data ? <OrgTree org={org.data} departments={departments} /> : null}
        </Panel>
      </div>
      {editing && <DepartmentStatusDialog department={editing} onClose={() => setEditing(null)} onDone={overview.reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- Obiective

function GoalCreateDialog({ departments, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", departmentKey: "", priority: 2, dueAt: "", metrics: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const metrics = form.metrics.split("\n").map((s) => s.trim()).filter(Boolean);
  const valid = form.title.trim().length >= 3 && metrics.length <= 20 && metrics.every((m) => m.length <= 2000);
  const save = useAction(async () => {
    const body = { title: form.title.trim(), description: form.description.trim(), priority: Number(form.priority), successMetrics: metrics };
    if (form.departmentKey) body.departmentKey = form.departmentKey;
    if (form.dueAt) body.dueAt = form.dueAt;
    const goal = await api("/api/goals", { method: "POST", body });
    onCreated(goal); onClose();
  });
  return (
    <Dialog title="Obiectiv nou" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se creează…" : "Creează obiectivul"}</button></>}>
      <label className="field"><span>Titlu (minimum 3 caractere)</span><input className="input" value={form.title} onChange={set("title")} maxLength={200} /></label>
      <label className="field"><span>Descriere</span><textarea className="textarea" rows={3} value={form.description} onChange={set("description")} maxLength={4000} /></label>
      <div className="grid two">
        <label className="field"><span>Departament</span>
          <select className="select" value={form.departmentKey} onChange={set("departmentKey")}>
            <option value="">Fără departament (Chief of Staff)</option>
            {departments.map((d) => <option key={d.key} value={d.key}>{d.name} ({DEPT_STATUS_RO[d.status] || d.status})</option>)}
          </select>
        </label>
        <label className="field"><span>Prioritate</span>
          <select className="select" value={form.priority} onChange={set("priority")}>{[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY_RO[p]}</option>)}</select>
        </label>
        <label className="field"><span>Termen (opțional)</span><input className="input" type="date" value={form.dueAt} onChange={set("dueAt")} /></label>
      </div>
      <label className="field"><span>Metrici de succes (câte una pe rând, maximum 20)</span><textarea className="textarea" rows={3} value={form.metrics} onChange={set("metrics")} /></label>
      <p className="faint small" style={{ margin: 0 }}>Obiectivul pornește ca DRAFT. Progresul se măsoară doar prin rezultate-cheie marcate MET; nu se estimează procente.</p>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function GoalTransitionDialog({ goal, to, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState("");
  const counted = goal.objectives.filter((o) => o.status !== "DROPPED");
  const allMet = counted.length > 0 && counted.every((o) => o.status === "MET");
  const needsManual = to === "ACHIEVED" && !allMet;
  const valid = reason.trim().length >= 3 && (!needsManual || manual.trim().length >= 10);
  const save = useAction(async () => {
    const body = { to, reason: reason.trim(), expectedVersion: goal.version };
    if (needsManual) body.evidence = { manualVerification: manual.trim() };
    await api(`/api/goals/${encodeURIComponent(goal.id)}/transition`, { method: "POST", body });
    onDone(); onClose();
  });
  return (
    <Dialog title={`${GOAL_ACTION_RO[to] || to}: ${goal.title}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className={`btn ${to === "ABANDONED" ? "danger" : "primary"}`} disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se salvează…" : "Confirmă"}</button></>}>
      <p className="muted" style={{ margin: 0 }}>{GOAL_RO[goal.status] || goal.status} → {GOAL_RO[to] || to}. Tranziția se înregistrează cu motivul tău și versiunea v{goal.version}; dacă obiectivul s-a schimbat între timp, cererea este refuzată.</p>
      <label className="field"><span>Motiv (obligatoriu, minimum 3 caractere)</span><textarea className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {needsManual && (
        <>
          <Notice tone="warn" title="Rezultate-cheie neatinse">{counted.length ? `${counted.filter((o) => o.status === "MET").length}/${counted.length} sunt MET.` : "Nu există rezultate-cheie."} Un obiectiv este atins doar cu toate rezultatele-cheie MET sau cu o verificare manuală descrisă.</Notice>
          <label className="field"><span>Ce ai verificat (minimum 10 caractere)</span><textarea className="textarea" rows={3} maxLength={2000} value={manual} onChange={(e) => setManual(e.target.value)} /></label>
        </>
      )}
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function ObjectiveCreateDialog({ goal, departments, onClose, onDone }) {
  const [form, setForm] = useState({ title: "", keyResult: "", targetValue: "", unit: "", departmentKey: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const target = form.targetValue === "" ? undefined : Number(form.targetValue);
  const valid = form.title.trim().length >= 3 && (target === undefined || Number.isFinite(target));
  const save = useAction(async () => {
    const body = { title: form.title.trim(), keyResult: form.keyResult.trim(), unit: form.unit.trim() };
    if (target !== undefined) body.targetValue = target;
    if (form.departmentKey) body.departmentKey = form.departmentKey;
    await api(`/api/goals/${encodeURIComponent(goal.id)}/objectives`, { method: "POST", body });
    onDone(); onClose();
  });
  return (
    <Dialog title="Rezultat-cheie nou" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se adaugă…" : "Adaugă"}</button></>}>
      <p className="muted" style={{ margin: 0 }}>Pentru: {goal.title}</p>
      <label className="field"><span>Titlu (minimum 3 caractere)</span><input className="input" value={form.title} onChange={set("title")} maxLength={200} /></label>
      <label className="field"><span>Rezultat-cheie măsurabil</span><input className="input" value={form.keyResult} onChange={set("keyResult")} maxLength={500} placeholder="Ex.: 10 audituri livrate cu dovezi" /></label>
      <div className="grid two">
        <label className="field"><span>Țintă (număr, opțional)</span><input className="input" type="number" inputMode="decimal" value={form.targetValue} onChange={set("targetValue")} /></label>
        <label className="field"><span>Unitate</span><input className="input" value={form.unit} onChange={set("unit")} maxLength={40} placeholder="Ex.: audituri" /></label>
      </div>
      <label className="field"><span>Departament</span>
        <select className="select" value={form.departmentKey} onChange={set("departmentKey")}>
          <option value="">Departamentul obiectivului</option>
          {departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
        </select>
      </label>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function ObjectiveUpdateDialog({ objective, machine, onClose, onDone }) {
  const [value, setValue] = useState(objective.currentValue ?? "");
  const [status, setStatus] = useState(objective.status);
  const [reason, setReason] = useState("");
  const options = [objective.status, ...(machine?.transitions?.[objective.status] || [])];
  const raw = String(value).trim();
  const numeric = raw === "" ? undefined : Number(raw);
  const valueInvalid = raw !== "" && !Number.isFinite(numeric);
  const effective = numeric ?? objective.currentValue;
  const belowTarget = status === "MET" && objective.targetValue !== null && objective.targetValue !== undefined && !(Number(effective) >= objective.targetValue);
  const minReason = belowTarget ? 10 : status !== objective.status ? 3 : 0;
  const changed = status !== objective.status || (numeric !== undefined && numeric !== objective.currentValue);
  const valid = changed && !valueInvalid && reason.trim().length >= minReason;
  const save = useAction(async () => {
    const body = { reason: reason.trim() };
    if (numeric !== undefined) body.currentValue = numeric;
    if (status !== objective.status) body.status = status;
    await api(`/api/objectives/${encodeURIComponent(objective.id)}`, { method: "POST", body });
    onDone(); onClose();
  });
  return (
    <Dialog title={`Actualizează: ${objective.title}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || save.pending} onClick={save.run}>{save.pending ? "Se salvează…" : "Salvează"}</button></>}>
      {objective.keyResult && <p className="muted" style={{ margin: 0 }}>{objective.keyResult}</p>}
      <div className="grid two">
        <label className="field"><span>Valoare măsurată{objective.targetValue !== null && objective.targetValue !== undefined ? ` (țintă ${objective.targetValue} ${objective.unit || ""})` : ""}</span>
          <input className="input" type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={valueInvalid} />
        </label>
        <label className="field"><span>Stare</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{options.map((s) => <option key={s} value={s}>{OBJ_RO[s] || s}</option>)}</select>
        </label>
      </div>
      <label className="field"><span>{minReason ? `Motiv (obligatoriu, minimum ${minReason} caractere)` : "Motiv (opțional)"}</span><textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {belowTarget && <Notice tone="warn">MET sub țintă cere o justificare de minimum 10 caractere.</Notice>}
      {options.length === 1 && <p className="faint small" style={{ margin: 0 }}>Stare finală: doar valoarea măsurată mai poate fi corectată.</p>}
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function GoalDetail({ goal, departments, machines, roleName, onChanged }) {
  const detail = useResource(`/api/goals/${encodeURIComponent(goal.id)}`, { reloadOn: (e) => e.scopeId === goal.id || /^(mission|task)\./.test(e.type) });
  const [transition, setTransition] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const allowed = machines.goal?.transitions?.[goal.status] || [];
  const terminal = GOAL_TERMINAL.includes(goal.status);
  const deptName = (id) => departments.find((d) => d.id === id)?.name || "—";
  const done = () => { onChanged(); detail.reload(); };
  return (
    <div className="expand-body" id={`goal-${goal.id}`}>
      {goal.description && <p className="prewrap" style={{ margin: 0 }}>{goal.description}</p>}
      <dl className="kv">
        <dt>Motivul stării</dt><dd>{goal.statusReason || "—"}</dd>
        <dt>Responsabil</dt><dd>{roleName(goal.ownerRoleId)}</dd>
        <dt>Sursă</dt><dd>{goal.source === "chief-of-staff" ? "propus de Chief of Staff" : goal.source} · creat de {goal.createdBy} · {fmt.dateTime(goal.createdAt)} · v{goal.version}</dd>
        {goal.successMetrics?.length > 0 && <><dt>Metrici de succes</dt><dd><ul className="plain-list">{goal.successMetrics.map((m) => <li key={m}>{m}</li>)}</ul></dd></>}
      </dl>
      <div className="row wrap">
        {allowed.map((to) => <button key={to} className={`btn sm ${to === "ABANDONED" ? "danger" : to === "ACHIEVED" ? "primary" : ""}`} onClick={() => setTransition(to)}>{GOAL_ACTION_RO[to] || to}</button>)}
        {!terminal && <button className="btn sm" onClick={() => setAdding(true)}><Plus size={14} />Rezultat-cheie</button>}
        {!machines.goal && <span className="faint small">Se încarcă tranzițiile permise…</span>}
      </div>
      <div>
        <div className="section-title">Rezultate-cheie ({goal.objectives.length})</div>
        {goal.objectives.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Rezultat-cheie</th><th>Progres măsurat</th><th>Departament</th><th>Stare</th><th><span className="sr-only">Acțiuni</span></th></tr></thead>
            <tbody>{goal.objectives.map((o) => {
              const hasTarget = o.targetValue !== null && o.targetValue !== undefined;
              return (
                <tr key={o.id}>
                  <td data-label="Rezultat-cheie"><strong>{o.title}</strong>{o.keyResult && <div className="sub">{o.keyResult}</div>}{o.statusReason && <div className="sub">Motiv: {o.statusReason}</div>}</td>
                  <td data-label="Progres măsurat">{hasTarget ? <Meter value={Number(o.currentValue) || 0} total={o.targetValue} label={`${o.currentValue ?? "—"} / ${o.targetValue} ${o.unit || ""}`} /> : <span>{o.currentValue ?? "—"} {o.unit}</span>}</td>
                  <td data-label="Departament">{deptName(o.departmentId)}</td>
                  <td data-label="Stare"><StatusChip status={o.status} label={OBJ_RO[o.status]} /></td>
                  <td><button className="btn sm ghost" onClick={() => setEditing(o)} disabled={!machines.objective}>Actualizează</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="faint" style={{ margin: 0 }}>Niciun rezultat-cheie. Fără rezultate-cheie MET, obiectivul poate fi marcat atins doar cu verificare manuală.</p>}
      </div>
      <div>
        <div className="section-title">Misiuni legate</div>
        {detail.loading && !detail.data ? <Loading lines={2} /> : detail.error && !detail.data ? <ErrorNotice error={detail.error} onRetry={detail.reload} /> : detail.data?.missions?.length ? (
          <ul className="list">{detail.data.missions.map((m) => (
            <li key={m.id}><a className="list-row" href={`#/missions/${encodeURIComponent(m.id)}`} style={{ padding: "8px 0" }}>
              <div className="grow"><div className="title">{m.title}</div><div className="sub">{m.department} · {m.progress.completed}/{m.progress.total} taskuri finalizate{m.verified?.length ? ` · verificate: ${m.verified.join(", ")}` : ""}</div></div>
              <StatusChip status={m.status} />
            </a></li>
          ))}</ul>
        ) : <p className="faint" style={{ margin: 0 }}>Nicio misiune legată. Chief of Staff poate propune misiuni DRAFT pentru acest obiectiv.</p>}
        {detail.data?.method && <p className="faint small" style={{ margin: "6px 0 0" }}>{detail.data.method}</p>}
      </div>
      {transition && <GoalTransitionDialog goal={goal} to={transition} onClose={() => setTransition(null)} onDone={done} />}
      {adding && <ObjectiveCreateDialog goal={goal} departments={departments} onClose={() => setAdding(false)} onDone={done} />}
      {editing && <ObjectiveUpdateDialog objective={editing} machine={machines.objective} onClose={() => setEditing(null)} onDone={done} />}
    </div>
  );
}

function Goals() {
  const goals = useResource("/api/goals", { reloadOn: (e) => /^(goal|objective)\./.test(e.type) });
  const company = useResource("/api/company", { reloadOn: (e) => e.type.startsWith("department.") });
  const lifecycles = useResource("/api/lifecycles", { reloadOn: NEVER });
  const [show, setShow] = useState("open");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const departments = company.data?.departments || [];
  const roleName = roleNameFrom(departments);
  const machines = useMemo(() => Object.fromEntries((lifecycles.data?.lifecycles || []).map((l) => [l.id, l])), [lifecycles.data]);
  const all = goals.data?.goals || [];
  const list = all.filter((g) => show === "all" || !GOAL_TERMINAL.includes(g.status));
  const deptName = (id) => departments.find((d) => d.id === id)?.name || "Fără departament";
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="seg" role="group" aria-label="Filtru obiective">
          <button type="button" aria-pressed={show === "open"} onClick={() => setShow("open")}>Deschise{goals.data ? ` (${all.filter((g) => !GOAL_TERMINAL.includes(g.status)).length})` : ""}</button>
          <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>Toate{goals.data ? ` (${all.length})` : ""}</button>
        </div>
        <button className="btn primary sm" onClick={() => setCreating(true)}><Plus size={14} />Obiectiv nou</button>
      </div>
      <ErrorNotice error={lifecycles.error} onRetry={lifecycles.reload} />
      <ErrorNotice error={company.error} onRetry={company.reload} />
      <Panel title="Obiective și rezultate-cheie" icon={Target} flush>
        {goals.loading && !goals.data ? <div className="panel-body"><Loading /></div> : goals.error && !goals.data ? <div className="panel-body"><ErrorNotice error={goals.error} onRetry={goals.reload} /></div> : list.length ? (
          <ul className="list">{list.map((g) => {
            const counted = g.objectives.filter((o) => o.status !== "DROPPED");
            const met = counted.filter((o) => o.status === "MET").length;
            const isOpen = open === g.id;
            return (
              <li key={g.id}>
                <div className="list-row goal-row">
                  <div className="grow">
                    <button className="link-btn" aria-expanded={isOpen} aria-controls={`goal-${g.id}`} onClick={() => setOpen(isOpen ? null : g.id)}>
                      {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}<span>{g.title}</span>
                    </button>
                    <div className="sub">{deptName(g.departmentId)} · {PRIORITY_RO[g.priority] || `P${g.priority}`} · {g.dueAt ? `termen ${fmtDate(g.dueAt)}` : "fără termen"}{g.source === "chief-of-staff" ? " · Chief of Staff" : ""}</div>
                  </div>
                  <div className="side-meta">
                    <Meter value={met} total={counted.length} label={`${met}/${counted.length} MET`} />
                    <StatusChip status={g.status} label={GOAL_RO[g.status]} />
                  </div>
                </div>
                {isOpen && <GoalDetail goal={g} departments={departments} machines={machines} roleName={roleName} onChanged={goals.reload} />}
              </li>
            );
          })}</ul>
        ) : <Empty title={show === "open" ? "Niciun obiectiv deschis" : "Niciun obiectiv"} action={<button className="btn sm primary" onClick={() => setCreating(true)}>Creează un obiectiv</button>}>Obiectivele pot fi create direct sau din Chief of Staff, care propune și rezultatele-cheie.</Empty>}
      </Panel>
      {goals.error && goals.data && <ErrorNotice error={goals.error} onRetry={goals.reload} />}
      {creating && <GoalCreateDialog departments={departments} onClose={() => setCreating(false)} onCreated={(goal) => { goals.reload(); if (goal?.id) { setShow("open"); setOpen(goal.id); } }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Chief of Staff

/** Keeps the preview request line well under the server header limit (Romanian diacritics triple when encoded). */
function previewText(text) {
  let value = text.slice(0, 2000);
  while (value.length > 200 && encodeURIComponent(value).length > 6000) value = value.slice(0, Math.floor(value.length * 0.8));
  return { value, truncated: value.length < text.length };
}

function ProposalList({ plan, choices, onChoice, editable }) {
  return (
    <div className="stack">
      <div className="chips"><Chip icon={Sparkles}>{plan.method}</Chip></div>
      <p className="faint small" style={{ margin: 0 }}>{plan.note}</p>
      <dl className="kv"><dt>Obiectiv</dt><dd>{plan.goal?.title}</dd></dl>
      <div>
        <div className="section-title">Rutare pe departamente ({plan.missions.length})</div>
        <ul className="list">{plan.missions.map((m) => {
          const choice = choices?.[m.departmentKey];
          return (
            <li key={m.departmentKey}>
              <div className="list-row" style={{ alignItems: "flex-start", padding: "10px 0" }}>
                {editable && <input type="checkbox" style={{ marginTop: 4, width: 16, height: 16, flex: "none", accentColor: "var(--accent)" }} checked={Boolean(choice?.selected)} onChange={(e) => onChoice(m.departmentKey, { selected: e.target.checked })} aria-label={`Include misiunea pentru ${m.departmentName}`} />}
                <div className="grow stack tight">
                  <div className="row wrap"><strong>{m.departmentName}</strong><StatusChip status={m.departmentStatus} label={DEPT_STATUS_RO[m.departmentStatus]} /><Chip>{m.missionLabel}</Chip><span className="faint small">{m.taskCount} taskuri · responsabil {m.ownerRoleId}</span></div>
                  {editable ? (
                    <label className="field"><span className="sr-only">Titlul misiunii pentru {m.departmentName}</span>
                      <input className="input" value={choice?.title ?? m.title} maxLength={160} disabled={!choice?.selected} onChange={(e) => onChoice(m.departmentKey, { title: e.target.value })} />
                    </label>
                  ) : <div>{m.title}</div>}
                  {m.matchedKeywords?.length ? <div className="chips">{m.matchedKeywords.map((k) => <Chip key={k} tone="info">{k}</Chip>)}</div> : <span className="faint small">Niciun cuvânt-cheie recunoscut: rutare implicită către Executive.</span>}
                  {m.warning && <Notice tone="warn">{m.warning}</Notice>}
                </div>
              </div>
            </li>
          );
        })}</ul>
      </div>
      {plan.objectives?.length > 0 && (
        <div>
          <div className="section-title">Rezultate-cheie propuse</div>
          <ul className="plain-list">{plan.objectives.map((o) => <li key={`${o.departmentKey}-${o.title}`}>{o.title} — {o.keyResult} (țintă {o.targetValue} {o.unit})</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function CosOverview() {
  const { data, error, loading, reload } = useResource("/api/cos/overview", { reloadOn: (e) => /^(goal|objective|mission|task|approval|lease)\./.test(e.type) });
  if (loading && !data) return <Panel title="Priorități" icon={Flag}><Loading /></Panel>;
  if (error && !data) return <Panel title="Priorități" icon={Flag}><ErrorNotice error={error} onRetry={reload} /></Panel>;
  const { priorities = [], blockers = {}, escalations = {} } = data || {};
  const groups = Object.entries(blockers.byDepartment || {});
  const approvals = escalations.approvals || [];
  const atRisk = escalations.goalsAtRisk || [];
  const drafts = escalations.draftPlans || [];
  return (
    <div className="stack">
      <Panel title={`Priorități (${priorities.length})`} icon={Flag} flush>
        {priorities.length ? <ul className="list">{priorities.slice(0, 12).map((p) => (
          <li key={p.id}><a className="list-row" href="#/company?tab=goals">
            <div className="grow"><div className="title">{p.title}</div><div className="sub">{p.department || "Fără departament"} · P{p.priority}{p.dueAt ? ` · termen ${fmtDate(p.dueAt)}` : ""} · {p.openMissions} misiuni deschise{p.attention ? ` · ${p.attention} necesită atenție` : ""}</div></div>
            <StatusChip status={p.status} label={GOAL_RO[p.status]} />
          </a></li>
        ))}</ul> : <Empty title="Nicio prioritate deschisă">Obiectivele deschise apar ordonate după prioritate, termen și atenție.</Empty>}
      </Panel>
      <Panel title="Blocaje" icon={AlertTriangle} flush>
        {groups.length || blockers.retainedLeases?.length ? (
          <div className="stack" style={{ padding: "8px 16px 16px" }}>
            {groups.map(([dept, tasks]) => (
              <div key={dept}>
                <div className="section-title">{dept} ({tasks.length})</div>
                <ul className="list">{tasks.slice(0, 8).map((t) => <li key={t.id}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}><div className="grow"><div className="title">{t.title}</div>{t.reason && <div className="sub">{t.reason}</div>}</div><StatusChip status={t.status} /></div></li>)}</ul>
              </div>
            ))}
            {blockers.retainedLeases?.length > 0 && <Notice tone="warn" title="Lock-uri reținute">{blockers.retainedLeases.map((l) => `${l.resource} (${l.holder})`).join(", ")}</Notice>}
          </div>
        ) : <Empty title="Niciun blocaj">Taskurile blocate, eșuate sau în așteptare apar grupate pe departamente.</Empty>}
      </Panel>
      <Panel title="Escaladări" icon={ShieldAlert} className={approvals.length ? "accent-approval" : ""} flush>
        {approvals.length || atRisk.length || drafts.length ? (
          <div className="stack" style={{ padding: "8px 16px 16px" }}>
            {approvals.length > 0 && <div><div className="section-title">Aprobări ({approvals.length})</div><ul className="list">{approvals.slice(0, 6).map((a) => <li key={a.id}><a className="list-row" href="#/approvals" style={{ padding: "6px 0" }}><span className="grow mono small break">{a.actionKind}</span><span className="faint small nowrap">expiră {fmt.time(a.expiresAt)}</span></a></li>)}</ul></div>}
            {atRisk.length > 0 && <div><div className="section-title">Obiective la risc sau blocate</div><ul className="list">{atRisk.map((g) => <li key={g.id}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}><div className="grow"><div className="title">{g.title}</div>{g.reason && <div className="sub">{g.reason}</div>}</div><StatusChip status={g.status} label={GOAL_RO[g.status]} /></div></li>)}</ul></div>}
            {drafts.length > 0 && <div><div className="section-title">Planuri Chief of Staff în DRAFT</div><ul className="plain-list">{drafts.map((g) => <li key={g.id}>{g.title}</li>)}</ul></div>}
          </div>
        ) : <Empty title="Nimic de escaladat">Aprobările, obiectivele la risc și planurile DRAFT apar aici.</Empty>}
      </Panel>
    </div>
  );
}

function ChiefOfStaff() {
  const [draft, setDraft] = usePref("company.cos.draft", "");
  const [options, setOptions] = useState({ departmentKey: "", projectId: "", priority: 2, dueAt: "" });
  const [preview, setPreview] = useState({ loading: false, data: null, error: null, truncated: false });
  const [intake, setIntake] = useState(null);
  const [lockedText, setLockedText] = useState("");
  const [choices, setChoices] = useState({});
  const [applied, setApplied] = useState(null);
  const company = useResource("/api/company", { reloadOn: (e) => e.type.startsWith("department.") });
  const projects = useResource("/api/projects", { reloadOn: NEVER });
  const departments = company.data?.departments || [];
  const text = draft.trim();
  const setOption = (k) => (e) => setOptions((o) => ({ ...o, [k]: e.target.value }));

  useEffect(() => {
    if (intake) return undefined;
    if (text.length < 5) { setPreview({ loading: false, data: null, error: null, truncated: false }); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const { value, truncated } = previewText(text);
      setPreview((p) => ({ ...p, loading: true }));
      try {
        const params = new URLSearchParams({ objective: value });
        if (options.departmentKey) params.set("department", options.departmentKey);
        if (options.projectId) params.set("projectId", options.projectId);
        const data = await api(`/api/cos/analyze?${params}`, { signal: controller.signal });
        setPreview({ loading: false, data, error: null, truncated });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setPreview({ loading: false, data: null, error, truncated: false });
      }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, options.departmentKey, options.projectId, intake]);

  const createIntake = useAction(async () => {
    const body = { objective: text, priority: Number(options.priority) };
    if (options.departmentKey) body.departmentKey = options.departmentKey;
    if (options.projectId) body.projectId = options.projectId;
    if (options.dueAt) body.dueAt = options.dueAt;
    const result = await api("/api/cos/intake", { method: "POST", body });
    setLockedText(text);
    setIntake(result);
    setChoices(Object.fromEntries((result.proposal?.missions || []).map((m) => [m.departmentKey, { selected: m.departmentStatus === "active", title: m.title }])));
    setDraft("");
  });
  const selected = intake ? (intake.proposal?.missions || []).filter((m) => choices[m.departmentKey]?.selected) : [];
  const titlesValid = selected.every((m) => (choices[m.departmentKey]?.title || "").trim().length >= 3);
  const applyPlan = useAction(async () => {
    const missions = selected.map((m) => ({ departmentKey: m.departmentKey, missionKind: m.missionKind, title: choices[m.departmentKey].title.trim().slice(0, 160), ...(m.projectId ? { projectId: m.projectId } : {}) }));
    setApplied(await api("/api/cos/apply", { method: "POST", body: { goalId: intake.goal.id, missions } }));
  });
  const onChoice = (key, patch) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const reset = () => { setIntake(null); setApplied(null); setChoices({}); setLockedText(""); createIntake.clearError(); applyPlan.clearError(); };
  const shownText = intake ? lockedText : draft;
  const tooLong = text.length > OBJECTIVE_MAX;

  return (
    <div className="split-main">
      <div className="stack">
        <Panel title="Obiectiv pentru Chief of Staff" icon={Compass}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>Chief of Staff este un rol cu flux și politici, nu un model pornit permanent. În BUILD_SAFE propunerea este deterministă (cuvinte-cheie → departament → șablon de misiune) și nimic nu pornește fără confirmarea ta.</p>
            <label className="field"><span>Ce vrei să obții</span>
              <textarea className="textarea" rows={5} value={shownText} readOnly={Boolean(intake)} onChange={(e) => setDraft(e.target.value)} aria-invalid={tooLong}
                placeholder="Ex.: Audit de site și ofertă pentru 10 firme din Iași, apoi landing page nou pentru clientul care acceptă." />
            </label>
            <div className="row between wrap"><span className={`small ${tooLong ? "" : "faint"}`} style={tooLong ? { color: "var(--danger)" } : undefined}>{shownText.trim().length}/{OBJECTIVE_MAX} caractere</span>{!intake && text.length > 0 && text.length < 5 && <span className="faint small">Minimum 5 caractere pentru analiză.</span>}</div>
            <div className="grid two">
              <label className="field"><span>Departament</span>
                <select className="select" value={options.departmentKey} onChange={setOption("departmentKey")} disabled={Boolean(intake)}>
                  <option value="">Automat (după cuvinte-cheie)</option>
                  {departments.map((d) => <option key={d.key} value={d.key}>{d.name} ({DEPT_STATUS_RO[d.status] || d.status})</option>)}
                </select>
              </label>
              <label className="field"><span>Proiect pentru misiuni</span>
                <select className="select" value={options.projectId} onChange={setOption("projectId")} disabled={Boolean(intake)}>
                  <option value="">Implicit (Ifrim Agent Hub)</option>
                  {(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.executionAllowed ? "" : " (doar context)"}</option>)}
                </select>
              </label>
              <label className="field"><span>Prioritate</span>
                <select className="select" value={options.priority} onChange={setOption("priority")} disabled={Boolean(intake)}>{[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY_RO[p]}</option>)}</select>
              </label>
              <label className="field"><span>Termen (opțional)</span><input className="input" type="date" value={options.dueAt} onChange={setOption("dueAt")} disabled={Boolean(intake)} /></label>
            </div>
            {!intake && (
              <div className="row wrap">
                <button className="btn primary" disabled={text.length < 5 || tooLong || createIntake.pending} onClick={createIntake.run}>{createIntake.pending ? "Se creează…" : "Creează obiectivul DRAFT"}</button>
                <span className="faint small">Creează obiectivul și rezultatele-cheie propuse; misiunile rămân doar propuse până le confirmi.</span>
              </div>
            )}
            <ErrorNotice error={company.error || projects.error} onRetry={() => { company.reload(); projects.reload(); }} />
            <ErrorNotice error={createIntake.error} />
          </div>
        </Panel>

        {!intake && (
          <Panel title="Previzualizare live" icon={Sparkles} actions={preview.loading ? <span className="faint small" role="status">se analizează…</span> : null}>
            {preview.error ? <ErrorNotice error={preview.error} />
              : preview.data && text.length >= 5 ? (
                <div className="stack">
                  {preview.truncated && <Notice tone="info">Previzualizarea folosește începutul textului; propunerea finală analizează textul complet.</Notice>}
                  <ProposalList plan={preview.data} editable={false} />
                </div>
              ) : preview.loading ? <Loading lines={3} /> : <Empty title="Descrie obiectivul">Propunerea apare pe măsură ce scrii: departamentele implicate, șabloanele de misiune și avertismentele. Nimic nu se creează la previzualizare.</Empty>}
          </Panel>
        )}

        {intake && (
          <Panel title="Misiuni propuse" icon={Target}>
            <div className="stack">
              <Notice tone="info" title="Obiectiv DRAFT creat">{intake.goal.title} · {intake.objectives?.length || 0} rezultate-cheie. <a href="#/company?tab=goals">Vezi în Obiective</a></Notice>
              <ProposalList plan={intake.proposal} choices={choices} onChoice={onChoice} editable={!applied} />
              {!applied && (
                <div className="row wrap">
                  <button className="btn primary" disabled={!selected.length || !titlesValid || applyPlan.pending} onClick={applyPlan.run}>{applyPlan.pending ? "Se creează…" : `Creează misiunile DRAFT (${selected.length})`}</button>
                  {!selected.length && <span className="faint small">Bifează cel puțin o misiune.</span>}
                  {selected.length > 0 && !titlesValid && <span className="faint small">Fiecare titlu are minimum 3 caractere.</span>}
                </div>
              )}
              <ErrorNotice error={applyPlan.error} />
              {applied && (
                <Notice tone="info" title={`${applied.missions?.length || 0} misiuni DRAFT create`}>
                  <ul className="plain-list">{(applied.missions || []).map((m) => <li key={m.id}><a href={`#/missions/${encodeURIComponent(m.id)}`}>{m.title}</a></li>)}</ul>
                  <div style={{ marginTop: 6 }}>{applied.note}</div>
                </Notice>
              )}
              <div className="row wrap">
                <button className="btn ghost" onClick={reset}>Obiectiv nou</button>
                {!applied && <span className="faint small">Obiectivul DRAFT rămâne creat; îl poți activa sau abandona din Obiective.</span>}
              </div>
            </div>
          </Panel>
        )}
      </div>
      <CosOverview />
    </div>
  );
}

// ---------------------------------------------------------------- Lead-uri & briefing (unchanged components)

function Briefing() {
  const { data, error, loading, reload } = useResource("/api/briefing", { reloadOn: (e) => e.type.startsWith("task.") || e.type.startsWith("approval.") || e.type.startsWith("run.") });
  if (loading) return <Loading lines={5} />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  return (
    <div className="grid three">
      <Panel title="Terminat (24 h)" icon={ListChecks}>
        {data.completed.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{data.completed.map((t) => <li key={t.id}>{t.title}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nimic finalizat cu dovadă în această fereastră.</p>}
      </Panel>
      <Panel title="Blocat">
        {data.blocked.length ? <ul className="list">{data.blocked.map((t) => <li key={t.id}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}><div className="grow"><div className="title">{t.title}</div><div className="sub">{t.reason}</div></div><StatusChip status={t.status} /></div></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nimic blocat.</p>}
      </Panel>
      <Panel title="Necesită aprobarea ta">
        {data.approvalsNeeded.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{data.approvalsNeeded.map((a) => <li key={a.id}>{a.action_kind} — expiră {fmt.dateTime(a.expires_at)}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nicio aprobare în așteptare.</p>}
        <div className="row" style={{ marginTop: 12 }}><a className="btn sm" href="/api/briefing?format=md" download="briefing.md"><Download size={14} />Markdown</a></div>
      </Panel>
    </div>
  );
}

function ImportLeads({ onClose, onDone }) {
  const [text, setText] = useState("");
  const [demo, setDemo] = useState(false);
  const [result, setResult] = useState(null);
  const run = useAction(async () => { setResult(await api("/api/leads/import", { method: "POST", body: { text, demo, source: "manual-import" } })); onDone(); });
  return (
    <Dialog title="Import lead-uri" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Închide</button><button className="btn primary" disabled={!text.trim() || run.pending} onClick={run.run}>Importă</button></>}>
      <p className="muted" style={{ margin: 0 }}>Câte o firmă pe rând: „Nume firmă; domeniu”. Deduplicarea folosește domeniul, apoi numele normalizat. Nu se inventează date despre firme.</p>
      <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Firma Exemplu SRL; exemplu.ro\nAltă Firmă; altafirma.ro"} />
      <label className="check"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />Date demonstrative (etichetate separat)</label>
      {result && <Notice tone="info">{result.created} create · {result.duplicates.length} duplicate ignorate · {result.rejected.length} rânduri respinse</Notice>}
      <ErrorNotice error={run.error} />
    </Dialog>
  );
}

function LeadEvidence({ lead, onDone }) {
  const [form, setForm] = useState({ claim: "", sourceUrl: "", observedAt: new Date().toISOString().slice(0, 10) });
  const add = useAction(async () => { await api(`/api/leads/${lead.id}/evidence`, { method: "POST", body: form }); setForm((f) => ({ ...f, claim: "", sourceUrl: "" })); onDone(); });
  const status = useAction(async (s) => { await api(`/api/leads/${lead.id}/status`, { method: "POST", body: { status: s } }); onDone(); });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="stack tight" style={{ padding: "8px 16px 16px" }}>
      {lead.evidence.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{lead.evidence.map((e, i) => <li key={i}>{e.claim} — <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener">{e.sourceUrl}</a> ({e.observedAt})</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nicio dovadă încă.</p>}
      <div className="grid three">
        <input className="input" value={form.claim} onChange={set("claim")} placeholder="Afirmație verificată" aria-label="Afirmație" />
        <input className="input" value={form.sourceUrl} onChange={set("sourceUrl")} placeholder="https://sursa" aria-label="URL sursă" />
        <input className="input" type="date" value={form.observedAt} onChange={set("observedAt")} aria-label="Data observării" />
      </div>
      <div className="row wrap">
        <button className="btn sm" disabled={add.pending || !form.claim || !form.sourceUrl} onClick={add.run}>Adaugă dovadă</button>
        <select className="select" style={{ width: "auto", minHeight: 30 }} value={lead.status} onChange={(e) => status.run(e.target.value)} aria-label="Stare lead">
          {Object.entries(LEAD_RO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <ErrorNotice error={add.error || status.error} />
    </div>
  );
}

function Leads() {
  const { data, error, loading, reload } = useResource("/api/leads");
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState(null);
  return (
    <Panel title="Lead-uri" icon={Users} actions={<button className="btn sm" onClick={() => setImporting(true)}><Upload size={14} />Import</button>} flush>
      {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : data.leads.length ? (
        <ul className="list">{data.leads.map((l) => (
          <li key={l.id}>
            <button className="list-row" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
              <div className="grow"><div className="title">{l.company}</div><div className="sub">{l.domain || "domeniu necunoscut"} · {l.evidence.length} dovezi</div></div>
              {l.demo && <Chip tone="warn">demo</Chip>}<Chip>{LEAD_RO[l.status]}</Chip>
            </button>
            {open === l.id && <LeadEvidence lead={l} onDone={reload} />}
          </li>
        ))}</ul>
      ) : <Empty title="Niciun lead" action={<button className="btn sm primary" onClick={() => setImporting(true)}>Importă</button>}>Outreach-ul generează doar ciorne; nimic nu se trimite automat.</Empty>}
      {importing && <ImportLeads onClose={() => setImporting(false)} onDone={reload} />}
    </Panel>
  );
}

// ---------------------------------------------------------------- screen

const PANELS = { structure: Structure, goals: Goals, cos: ChiefOfStaff, leads: () => <div className="stack"><Briefing /><Leads /></div> };

export default function Company({ query, go }) {
  const { tab, select, visited } = usePageTabs("company", TABS, query, go);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Companie</h1><p>Ifrim Digital ca organizație de agenți: departamente, roluri, obiective cu rezultate-cheie măsurate și Chief of Staff. Inboxul, calendarul și documentele nu sunt conectate.</p></div></div>
      <Tabs tabs={TABS} value={tab} onChange={select} label="Secțiuni companie" idPrefix="company" />
      {TABS.map((t) => {
        const Content = PANELS[t.id];
        return (
          <div key={t.id} role="tabpanel" id={`company-panel-${t.id}`} aria-labelledby={`company-tab-${t.id}`} hidden={t.id !== tab}>
            {(visited.has(t.id) || t.id === tab) && <Content />}
          </div>
        );
      })}
    </div>
  );
}
