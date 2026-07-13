import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  Bot,
  Camera,
  CheckCircle2,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  HardDriveDownload,
  ListChecks,
  LockKeyhole,
  Palette,
  Plus,
  RefreshCcw,
  Save,
  Server,
  ShieldCheck,
  Star,
  Sparkles,
  Terminal,
  UnlockKeyhole,
  Workflow,
} from "lucide-react";
import "./styles.css";

const API_BASE = "http://127.0.0.1:8004/api";
const TASK_STATUSES = ["draft", "backlog", "ready", "in_progress", "blocked", "review", "qa", "done", "cancelled"];
const LOCK_TYPES = ["advisory", "exclusive"];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `API ${response.status}`);
    error.payload = data;
    throw error;
  }
  return data;
}

function useProjects() {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const load = async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await apiRequest("/projects");
      setProjects(data.projects || []);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca proiectele.");
      setStatus("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { projects, status, error, reload: load };
}

function useHubState() {
  const [state, setState] = useState({ tasks: [], taskDrafts: [], locks: [], agentRuns: [], executionApprovals: [], executionAttempts: [], workflowTransitions: [], backups: [], snapshots: [], events: [] });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const load = async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await apiRequest("/hub-state");
      setState({ tasks: data.tasks || [], taskDrafts: data.taskDrafts || [], locks: data.locks || [], agentRuns: data.agentRuns || [], executionApprovals: data.executionApprovals || [], executionAttempts: data.executionAttempts || [], workflowTransitions: data.workflowTransitions || [], backups: data.backups || [], snapshots: data.snapshots || [], events: data.events || [] });
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca Agent Hub state.");
      setStatus("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { ...state, status, error, reload: load };
}

function useProjectContinuation(projectSlug) {
  const [continuation, setContinuation] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const load = async () => {
    if (!projectSlug) return;
    setStatus("loading");
    setError("");
    try {
      const data = await apiRequest(`/projects/${encodeURIComponent(projectSlug)}/continuation`);
      setContinuation(data.continuation || null);
      setStatus("ready");
    } catch (err) {
      setContinuation(null);
      setError(err instanceof Error ? err.message : "Nu am putut construi continuarea proiectului.");
      setStatus("error");
    }
  };

  useEffect(() => {
    setContinuation(null);
    load();
  }, [projectSlug]);

  return { continuation, status, error, reload: load };
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="stat">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ value, tone = "neutral" }) {
  return <span className={`status-pill ${tone}`}>{value}</span>;
}

function diagnosticTone(status) {
  if (status === "ready") return "success";
  if (status === "blocked") return "danger";
  if (status === "warning" || status === "skipped") return "warning";
  return "neutral";
}

function useBridgeDiagnostics(projectSlug) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const load = async () => {
    if (!projectSlug) return;
    setStatus("loading");
    setError("");
    try {
      const data = await apiRequest(`/bridge-diagnostics?projectSlug=${encodeURIComponent(projectSlug)}`);
      setDiagnostics(data.diagnostics || null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut rula bridge diagnostics.");
      setStatus("error");
    }
  };

  useEffect(() => {
    setDiagnostics(null);
    load();
  }, [projectSlug]);

  return { diagnostics, status, error, reload: load };
}

function useAgentDirectory() {
  const [directory, setDirectory] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const load = async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await apiRequest("/agent-directory");
      setDirectory(data.directory || null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut incarca registrul agentilor.");
      setStatus("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { directory, status, error, reload: load };
}

function useDesignGovernance(projectSlug) {
  const [governance, setGovernance] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setGovernance(null);
    setError("");
    apiRequest(`/design-governance?projectSlug=${encodeURIComponent(projectSlug)}`)
      .then((data) => { if (active) setGovernance(data.governance); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Nu am putut incarca Design System."); });
    return () => { active = false; };
  }, [projectSlug]);

  return { governance, error };
}

function ProjectList({ projects, activeSlug, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p>IfrimDigital</p>
        <h1>Agent Hub</h1>
      </div>
      <nav className="project-list" aria-label="Proiecte">
        {projects.map((project) => (
          <button
            key={project.slug}
            className={`project-row ${project.slug === activeSlug ? "active" : ""}`}
            onClick={() => onSelect(project.slug)}
            type="button"
          >
            <span>{project.name}</span>
            <small>{project.status}</small>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function PromptCompiler({ project, drafts, onReload }) {
  const [requestText, setRequestText] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [compileRequestId, setCompileRequestId] = useState("");

  const projectDrafts = useMemo(
    () => drafts.filter((item) => item.projectSlug === project.slug).slice(0, 5),
    [drafts, project.slug]
  );

  useEffect(() => {
    setDraft(null);
    setRequestText("");
    setMessage("");
    setCompileRequestId("");
  }, [project.slug]);

  const updateCompiled = (field, value) => {
    setDraft((current) => ({ ...current, compiled: { ...current.compiled, [field]: value } }));
  };

  const updateList = (field, value) => {
    updateCompiled(field, value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
  };

  const compile = async () => {
    if (busy || requestText.trim().length < 12) return;
    setBusy("compile");
    setMessage("");
    const clientRequestId = compileRequestId || globalThis.crypto?.randomUUID?.() || `compiler-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (!compileRequestId) setCompileRequestId(clientRequestId);
    try {
      const data = await apiRequest("/task-drafts/compile", {
        method: "POST",
        body: JSON.stringify({ projectSlug: project.slug, requestText, clientRequestId }),
      });
      setDraft(data.draft);
      setCompileRequestId("");
      setMessage(data.reused ? "Am refolosit draftul existent." : "Draft compilat. Revizuieste-l inainte de creare.");
      await onReload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Prompt Compiler nu a putut genera draftul.");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!draft || busy || draft.projectSlug !== project.slug) return null;
    setBusy("save");
    setMessage("");
    try {
      const data = await apiRequest(`/task-drafts/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ compiled: draft.compiled, expectedRevision: draft.revision }),
      });
      setDraft(data.draft);
      setMessage("Draft salvat.");
      await onReload();
      return data.draft;
    } catch (err) {
      if (err?.payload?.draft) setDraft(err.payload.draft);
      setMessage(err instanceof Error ? err.message : "Nu am putut salva draftul.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const createTask = async () => {
    if (!draft || busy || draft.projectSlug !== project.slug || draft.compiled.questions?.length) return;
    setBusy("create");
    setMessage("");
    try {
      const saved = await apiRequest(`/task-drafts/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ compiled: draft.compiled, expectedRevision: draft.revision }),
      });
      setDraft(saved.draft);
      const data = await apiRequest(`/task-drafts/${encodeURIComponent(draft.id)}/create-task`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setDraft(data.draft);
      setMessage(data.reused ? `Task existent: ${data.task.id}` : `Task creat in coada: ${data.task.id}`);
      await onReload();
    } catch (err) {
      if (err?.payload?.draft) setDraft(err.payload.draft);
      setMessage(err instanceof Error ? err.message : "Nu am putut crea taskul din draft.");
    } finally {
      setBusy("");
    }
  };

  const compiled = draft?.compiled;
  const hasQuestions = Boolean(compiled?.questions?.length);

  return (
    <article className="panel wide prompt-compiler-panel">
      <div className="panel-heading split-heading">
        <div>
          <Sparkles size={18} />
          <h3>Prompt Architect</h3>
        </div>
        {draft ? <StatusPill value={draft.status} tone={draft.status === "failed" ? "danger" : hasQuestions ? "warning" : "success"} /> : null}
      </div>

      <p className="compiler-safety">Compilarea creeaza doar un draft local. Nu modifica proiectul, nu creeaza lock sau backup si nu porneste agenti de implementare. Nu introduce parole, tokenuri sau chei API.</p>

      <label className="compiler-request">
        Ce vrei sa facem in {project.name}?
        <textarea
          value={requestText}
          onChange={(event) => { setRequestText(event.target.value); setCompileRequestId(""); }}
          placeholder="Scrie normal, in cuvintele tale. Exemplu: Vreau ca dashboardul sa fie mai clar si sa nu stricăm filtrele existente."
          rows={4}
          maxLength={4000}
        />
      </label>
      <div className="compiler-actions">
        <button className="icon-button primary" type="button" onClick={compile} disabled={Boolean(busy) || requestText.trim().length < 12}>
          <Sparkles size={16} />
          {busy === "compile" ? "Compilez cu Prompt Architect..." : "Compileaza draft"}
        </button>
        <span>{requestText.length}/4000</span>
      </div>

      {projectDrafts.length ? (
        <div className="recent-drafts" aria-label="Drafturi recente">
          <span>Drafturi recente</span>
          {projectDrafts.map((item) => (
            <button type="button" key={item.id} disabled={Boolean(busy)} onClick={() => { setDraft(item); setRequestText(item.sourceRequest); setCompileRequestId(""); setMessage(""); }}>
              {item.compiled?.title || item.status}
            </button>
          ))}
        </div>
      ) : null}

      {compiled ? (
        <fieldset className="compiled-draft" disabled={Boolean(busy) || Boolean(draft.createdTaskId)}>
          <div className="form-grid">
            <label className="span-2">
              Titlu
              <input value={compiled.title || ""} onChange={(event) => updateCompiled("title", event.target.value)} />
            </label>
            <label className="span-2">
              Goal
              <textarea rows={3} value={compiled.goal || ""} onChange={(event) => updateCompiled("goal", event.target.value)} />
            </label>
            <label className="span-2">
              Scope, cate un punct pe rand
              <textarea rows={4} value={(compiled.scope || []).join("\n")} onChange={(event) => updateList("scope", event.target.value)} />
            </label>
            <label className="span-2">
              Non-goals, cate un punct pe rand
              <textarea rows={3} value={(compiled.nonGoals || []).join("\n")} onChange={(event) => updateList("nonGoals", event.target.value)} />
            </label>
            <label className="span-2">
              Presupuneri explicite
              <textarea rows={3} value={(compiled.assumptions || []).join("\n")} onChange={(event) => updateList("assumptions", event.target.value)} />
            </label>
            <label>
              Owner
              <input value={compiled.ownerAgent || ""} onChange={(event) => updateCompiled("ownerAgent", event.target.value)} />
            </label>
            <label>
              Reviewer
              <input value={compiled.reviewerAgent || ""} onChange={(event) => updateCompiled("reviewerAgent", event.target.value)} />
            </label>
            <label>
              QA
              <input value={compiled.qaAgent || ""} onChange={(event) => updateCompiled("qaAgent", event.target.value)} />
            </label>
            <label>
              Risc
              <select value={compiled.riskLevel || "medium"} onChange={(event) => updateCompiled("riskLevel", event.target.value)}>
                {['low', 'medium', 'high', 'critical'].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <label>
              Tip lock
              <select value={compiled.lockType || "advisory"} onChange={(event) => updateCompiled("lockType", event.target.value)}>
                {LOCK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Scope lock
              <input value={compiled.lockScope || ""} onChange={(event) => updateCompiled("lockScope", event.target.value)} />
            </label>
            <label className="span-2">
              Motive de risc
              <textarea rows={3} value={(compiled.riskReasons || []).join("\n")} onChange={(event) => updateList("riskReasons", event.target.value)} />
            </label>
            <label className="span-2">
              Arii afectate, una pe rand
              <textarea rows={2} value={(compiled.affectedAreas || []).join("\n")} onChange={(event) => updateList("affectedAreas", event.target.value)} />
            </label>
            <label className="span-2">
              Criterii de acceptare, unul pe rand
              <textarea rows={5} value={(compiled.acceptanceCriteria || []).join("\n")} onChange={(event) => updateList("acceptanceCriteria", event.target.value)} />
            </label>
            <label className="span-2">
              Regression QA, unul pe rand
              <textarea rows={5} value={(compiled.regressionChecklist || []).join("\n")} onChange={(event) => updateList("regressionChecklist", event.target.value)} />
            </label>
            <label className="span-2">
              Intrebari care blocheaza conversia
              <textarea rows={3} value={(compiled.questions || []).join("\n")} onChange={(event) => updateList("questions", event.target.value)} placeholder="Gol inseamna ca directia este suficient de clara." />
            </label>
          </div>

          <div className="compiler-gates">
            <label className="checkbox-line"><input type="checkbox" checked={Boolean(compiled.backupRequired)} onChange={(event) => updateCompiled("backupRequired", event.target.checked)} /> Backup inainte de implementare</label>
            <label className="checkbox-line"><input type="checkbox" checked={Boolean(compiled.lockRecommended)} onChange={(event) => updateCompiled("lockRecommended", event.target.checked)} /> Lock recomandat</label>
            <label className="checkbox-line"><input type="checkbox" checked={Boolean(compiled.approvalRequired)} onChange={(event) => updateCompiled("approvalRequired", event.target.checked)} /> Aprobare Catalin obligatorie</label>
          </div>

          {hasQuestions ? <p className="compiler-warning">Sterge sau rezolva intrebarile, apoi salveaza draftul pentru a activa crearea taskului.</p> : null}
          <div className="form-actions">
            <button className="icon-button" type="button" onClick={save} disabled={Boolean(busy) || Boolean(draft.createdTaskId)}>
              <Save size={16} />
              {busy === "save" ? "Salvez..." : "Salveaza draft"}
            </button>
            <button className="icon-button primary" type="button" onClick={createTask} disabled={Boolean(busy) || hasQuestions || Boolean(draft.createdTaskId)}>
              <Plus size={16} />
              {busy === "create" ? "Creez task..." : draft.createdTaskId ? `Task creat: ${draft.createdTaskId}` : "Creeaza task in coada"}
            </button>
          </div>
        </fieldset>
      ) : null}

      {message ? <p className="form-message">{message}</p> : null}
    </article>
  );
}

function TaskForm({ projects, activeProject, onCreated }) {
  const [form, setForm] = useState({
    projectSlug: activeProject?.slug || "",
    title: "",
    goal: "",
    stage: "",
    ownerAgent: "Codex",
    reviewerAgent: "ifrim-quality-reviewer",
    qaAgent: "ifrim-qa",
    status: "backlog",
    priority: "normal",
    affectedArea: "",
    approvalRequired: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (activeProject?.slug) {
      setForm((current) => ({ ...current, projectSlug: activeProject.slug }));
    }
  }, [activeProject?.slug]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      await apiRequest("/tasks", { method: "POST", body: JSON.stringify(form) });
      setMessage("Task creat.");
      setForm((current) => ({ ...current, title: "", goal: "", affectedArea: "" }));
      await onCreated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Nu am putut crea taskul.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="panel-heading">
        <Plus size={18} />
        <h3>Task nou</h3>
      </div>
      <div className="form-grid">
        <label>
          Proiect
          <select value={form.projectSlug} onChange={(event) => update("projectSlug", event.target.value)}>
            {projects.map((project) => (
              <option value={project.slug} key={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => update("status", event.target.value)}>
            {TASK_STATUSES.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Titlu
          <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Ex: Inchidere regression QA restaurant panel" />
        </label>
        <label className="span-2">
          Goal
          <textarea value={form.goal} onChange={(event) => update("goal", event.target.value)} placeholder="Ce trebuie livrat, cu criterii clare." rows={3} />
        </label>
        <label>
          Owner
          <input value={form.ownerAgent} onChange={(event) => update("ownerAgent", event.target.value)} />
        </label>
        <label>
          Reviewer
          <input value={form.reviewerAgent} onChange={(event) => update("reviewerAgent", event.target.value)} />
        </label>
        <label>
          QA
          <input value={form.qaAgent} onChange={(event) => update("qaAgent", event.target.value)} />
        </label>
        <label>
          Affected area
          <input value={form.affectedArea} onChange={(event) => update("affectedArea", event.target.value)} placeholder="ex: restaurant-panel" />
        </label>
      </div>
      <label className="checkbox-line">
        <input type="checkbox" checked={form.approvalRequired} onChange={(event) => update("approvalRequired", event.target.checked)} />
        Cere aprobare Catalin inainte de modificari mari
      </label>
      <div className="form-actions">
        <button type="submit" className="icon-button primary" disabled={submitting}>
          <Plus size={16} />
          {submitting ? "Creez..." : "Creeaza task"}
        </button>
        {message ? <span className="form-message">{message}</span> : null}
      </div>
    </form>
  );
}

function LockForm({ projects, activeProject, onCreated }) {
  const [form, setForm] = useState({
    projectSlug: activeProject?.slug || "",
    scope: "",
    reason: "",
    lockType: "advisory",
    owner: "Codex",
    taskId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (activeProject?.slug) {
      setForm((current) => ({ ...current, projectSlug: activeProject.slug }));
    }
  }, [activeProject?.slug]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      await apiRequest("/locks", { method: "POST", body: JSON.stringify(form) });
      setMessage("Lock creat.");
      setForm((current) => ({ ...current, scope: "", reason: "", taskId: "" }));
      await onCreated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Nu am putut crea lockul.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-panel" onSubmit={submit}>
      <div className="panel-heading">
        <LockKeyhole size={18} />
        <h3>Lock nou</h3>
      </div>
      <div className="form-grid">
        <label>
          Proiect
          <select value={form.projectSlug} onChange={(event) => update("projectSlug", event.target.value)}>
            {projects.map((project) => (
              <option value={project.slug} key={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tip
          <select value={form.lockType} onChange={(event) => update("lockType", event.target.value)}>
            {LOCK_TYPES.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <input value={form.scope} onChange={(event) => update("scope", event.target.value)} placeholder="ex: restaurant-panel" />
        </label>
        <label>
          Task ID
          <input value={form.taskId} onChange={(event) => update("taskId", event.target.value)} placeholder="optional" />
        </label>
        <label className="span-2">
          Motiv
          <textarea value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="De ce trebuie protejata zona aceasta." rows={3} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="icon-button primary" disabled={submitting}>
          <LockKeyhole size={16} />
          {submitting ? "Creez..." : "Creeaza lock"}
        </button>
        {message ? <span className="form-message">{message}</span> : null}
      </div>
    </form>
  );
}

function TaskQueue({ tasks, activeSlug, onReload, onCreatePacket, packetBusyId }) {
  const visibleTasks = useMemo(() => tasks.filter((task) => task.projectSlug === activeSlug), [tasks, activeSlug]);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const changeStatus = async (task, status) => {
    if (busyId) return;
    setBusyId(task.id);
    setError("");
    try {
      await apiRequest(`/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut actualiza taskul.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <article className="panel wide">
      <div className="panel-heading split-heading">
        <div>
          <ListChecks size={18} />
          <h3>Task Queue</h3>
        </div>
        <StatusPill value={`${visibleTasks.length} taskuri`} tone="info" />
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      {visibleTasks.length ? (
        <div className="task-stack">
          {visibleTasks.map((task) => (
            <section className="queue-item" key={task.id}>
              <div className="queue-main">
                <strong>{task.id}</strong>
                <h4>{task.title}</h4>
                <p>{task.goal}</p>
              </div>
              <div className="queue-meta">
                <StatusPill value={task.status} tone={task.status === "blocked" ? "danger" : task.status === "done" ? "success" : "neutral"} />
                <span>{task.priority}</span>
                <span>{task.stage || "fara etapa"}</span>
              </div>
              <dl className="task-meta compact">
                <div>
                  <dt>Owner</dt>
                  <dd>{task.ownerAgent}</dd>
                </div>
                <div>
                  <dt>Reviewer</dt>
                  <dd>{task.reviewerAgent || "n/a"}</dd>
                </div>
                <div>
                  <dt>QA</dt>
                  <dd>{task.qaAgent}</dd>
                </div>
                <div>
                  <dt>Arie</dt>
                  <dd>{task.affectedArea || "n/a"}</dd>
                </div>
              </dl>
              <div className="quick-actions">
                <button type="button" className="packet-action" disabled={packetBusyId === task.id} onClick={() => onCreatePacket(task)}>
                  <Bot size={14} />
                  {packetBusyId === task.id ? "Generez..." : "Packet"}
                </button>
                {TASK_STATUSES.map((status) => (
                  <button key={status} type="button" disabled={busyId === task.id || task.status === status} onClick={() => changeStatus(task, status)}>
                    {status}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="muted">Nu exista taskuri pentru proiectul selectat.</p>
      )}
    </article>
  );
}

function LocksPanel({ locks, activeSlug, onReload }) {
  const visibleLocks = useMemo(() => locks.filter((lock) => lock.projectSlug === activeSlug), [locks, activeSlug]);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const release = async (lock) => {
    if (busyId) return;
    setBusyId(lock.id);
    setError("");
    try {
      await apiRequest(`/locks/${encodeURIComponent(lock.id)}/release`, { method: "PATCH", body: JSON.stringify({ reason: "Released from Agent Hub UI" }) });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut elibera lockul.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <article className="panel wide">
      <div className="panel-heading split-heading">
        <div>
          <LockKeyhole size={18} />
          <h3>Locks</h3>
        </div>
        <StatusPill value={`${visibleLocks.filter((lock) => lock.status === "active").length} active`} tone="warning" />
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      {visibleLocks.length ? (
        <div className="lock-grid">
          {visibleLocks.map((lock) => (
            <section className={`lock-item ${lock.status}`} key={lock.id}>
              <div>
                <strong>{lock.scope}</strong>
                <p>{lock.reason}</p>
              </div>
              <div className="lock-meta">
                <StatusPill value={lock.status} tone={lock.status === "active" ? "warning" : "success"} />
                <span>{lock.lockType}</span>
                <span>{lock.taskId || "fara task"}</span>
              </div>
              {lock.status === "active" ? (
                <button className="icon-button" type="button" disabled={busyId === lock.id} onClick={() => release(lock)}>
                  <UnlockKeyhole size={16} />
                  {busyId === lock.id ? "Eliberez..." : "Release"}
                </button>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <p className="muted">Nu exista locks pentru proiectul selectat.</p>
      )}
    </article>
  );
}

function AgentRunsPanel({ agentRuns, activeSlug, selectedRunId, onSelect }) {
  const visibleRuns = useMemo(() => agentRuns.filter((run) => run.projectSlug === activeSlug), [agentRuns, activeSlug]);

  return (
    <article className="panel wide">
      <div className="panel-heading split-heading">
        <div>
          <Bot size={18} />
          <h3>Agent Runs</h3>
        </div>
        <StatusPill value={`${visibleRuns.length} packeturi`} tone="info" />
      </div>
      {visibleRuns.length ? (
        <div className="run-grid">
          {visibleRuns.map((run) => (
            <button
              className={`run-item ${run.id === selectedRunId ? "active" : ""}`}
              type="button"
              key={run.id}
              onClick={() => onSelect(run)}
            >
              <span>{run.taskId} · {run.workflowStage || "owner"}</span>
              <strong>{run.route}</strong>
              <small>Ciclu {run.workflowCycle || 0} · {run.status} · {new Date(run.updatedAt).toLocaleString("ro-RO")}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Nu exista packeturi generate pentru proiectul selectat.</p>
      )}
    </article>
  );
}

function WorkflowTransitionsPanel({ transitions, activeSlug }) {
  const visible = useMemo(() => transitions.filter((item) => item.projectSlug === activeSlug).slice(0, 12), [transitions, activeSlug]);
  return (
    <article className="panel wide workflow-history-panel">
      <div className="panel-heading split-heading"><div><Workflow size={18} /><h3>Istoric workflow</h3></div><StatusPill value={`${visible.length} tranziții`} tone="info" /></div>
      {visible.length ? <div className="workflow-history-list">{visible.map((item) => (
        <section key={item.id} className="workflow-history-item">
          <div><strong>{item.fromStage} → {item.toStage}</strong><span>{item.taskId} · {item.verdict}</span></div>
          <p>{item.evidence || "Fără dovadă rezumată."}</p>
          <StatusPill value={item.status} tone={item.status === "completed" ? "success" : item.status === "blocked" ? "danger" : "warning"} />
        </section>
      ))}</div> : <p className="muted">Nicio tranziție executată încă. Primul rezultat owner va pregăti reviewerul.</p>}
    </article>
  );
}

function SnapshotsPanel({ project, snapshots, tasks, onReload }) {
  const visibleSnapshots = useMemo(() => snapshots.filter((item) => item.projectSlug === project.slug), [snapshots, project.slug]);
  const projectTasks = useMemo(() => tasks.filter((item) => item.projectSlug === project.slug), [tasks, project.slug]);
  const [form, setForm] = useState({ name: "", note: "", taskId: "" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [restorePlan, setRestorePlan] = useState(null);
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    setForm({ name: "", note: "", taskId: "" });
    setMessage("");
    setRestorePlan(null);
    setRequestId("");
  }, [project.slug]);

  const create = async (event) => {
    event.preventDefault();
    if (busy || form.name.trim().length < 4) return;
    const clientRequestId = requestId || globalThis.crypto?.randomUUID?.() || `snapshot-${Date.now()}`;
    if (!requestId) setRequestId(clientRequestId);
    setBusy("create"); setMessage(""); setRestorePlan(null);
    try {
      const data = await apiRequest("/snapshots", { method: "POST", body: JSON.stringify({ projectSlug: project.slug, ...form, clientRequestId }) });
      setMessage(data.reused ? "Snapshotul exista deja." : "Snapshot candidat creat. Il poti aproba dupa ce verifici versiunea.");
      setForm({ name: "", note: "", taskId: "" }); setRequestId("");
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Snapshotul nu a putut fi creat."); }
    finally { setBusy(""); }
  };

  const approve = async (snapshot) => {
    if (busy) return;
    setBusy(snapshot.id); setMessage(""); setRestorePlan(null);
    try {
      await apiRequest(`/snapshots/${encodeURIComponent(snapshot.id)}/approve`, { method: "POST", body: "{}" });
      setMessage(`Versiunea aprobata este acum: ${snapshot.name}`);
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Versiunea nu a putut fi aprobata."); }
    finally { setBusy(""); }
  };

  const previewRestore = async (snapshot) => {
    if (busy) return;
    setBusy(`plan-${snapshot.id}`); setMessage("");
    try {
      const data = await apiRequest(`/snapshots/${encodeURIComponent(snapshot.id)}/restore-plan`);
      setRestorePlan({ ...data.plan, name: snapshot.name });
    } catch (err) { setMessage(err instanceof Error ? err.message : "Planul nu a putut fi generat."); }
    finally { setBusy(""); }
  };

  return (
    <article className="panel wide snapshots-panel">
      <div className="panel-heading split-heading">
        <div><Camera size={18} /><h3>Versiuni și snapshoturi</h3></div>
        <StatusPill value={`${visibleSnapshots.length} versiuni`} tone="info" />
      </div>
      <p className="snapshot-safety">Snapshoturile păstrează versiuni bune. Restaurarea nu este activă și va necesita confirmarea ta explicită.</p>
      <form className="snapshot-form" onSubmit={create}>
        <label>Nume versiune<input value={form.name} maxLength={80} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setRequestId(""); }} placeholder="Exemplu: Restaurant panel aprobat" /></label>
        <label>Task asociat<select value={form.taskId} onChange={(event) => setForm((current) => ({ ...current, taskId: event.target.value }))}><option value="">Fără task</option>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.id} · {task.title}</option>)}</select></label>
        <label className="span-2">De ce păstrăm versiunea?<textarea rows={2} maxLength={1000} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
        <button className="icon-button primary" type="submit" disabled={Boolean(busy) || form.name.trim().length < 4}><Camera size={16} />{busy === "create" ? "Creez backupul..." : "Creează snapshot"}</button>
      </form>
      {visibleSnapshots.length ? <div className="snapshot-list">{visibleSnapshots.map((snapshot) => (
        <section className={`snapshot-item ${snapshot.status}`} key={snapshot.id}>
          <div><strong>{snapshot.name}</strong><p>{snapshot.note || "Fără notă."}</p><small>{snapshot.id} · {new Date(snapshot.createdAt).toLocaleString("ro-RO")}</small></div>
          <div className="snapshot-actions"><StatusPill value={snapshot.status === "approved" ? "Versiune aprobată" : "Candidat"} tone={snapshot.status === "approved" ? "success" : "neutral"} />
            <button className="icon-button" type="button" disabled={Boolean(busy) || snapshot.status === "approved"} onClick={() => approve(snapshot)}><Star size={15} />Aprobă versiunea</button>
            <button className="icon-button" type="button" disabled={Boolean(busy)} onClick={() => previewRestore(snapshot)}><FileText size={15} />Vezi plan restaurare</button>
          </div>
        </section>
      ))}</div> : <p className="muted">Nu există încă versiuni păstrate pentru proiect.</p>}
      {restorePlan ? <section className="restore-plan"><strong>Plan de restaurare: {restorePlan.name}</strong><p>{restorePlan.warning}</p><ol>{restorePlan.steps.map((step) => <li key={step}>{step}</li>)}</ol><StatusPill value="Execuție blocată" tone="warning" /></section> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </article>
  );
}

function BackupsPanel({ backups, activeSlug }) {
  const visibleBackups = useMemo(() => backups.filter((backup) => backup.projectSlug === activeSlug), [backups, activeSlug]);

  return (
    <article className="panel wide">
      <div className="panel-heading split-heading">
        <div>
          <HardDriveDownload size={18} />
          <h3>Backups</h3>
        </div>
        <StatusPill value={`${visibleBackups.length} backupuri`} tone="info" />
      </div>
      {visibleBackups.length ? (
        <div className="backup-list">
          {visibleBackups.slice(0, 6).map((backup) => (
            <section className={`backup-item ${backup.status}`} key={backup.id}>
              <div>
                <strong>{backup.id}</strong>
                <p>{backup.reason || "Backup fara motiv explicit."}</p>
                <small>{backup.path}</small>
              </div>
              <div className="backup-meta">
                <StatusPill value={backup.status} tone={backup.status === "created" ? "success" : "danger"} />
                <span>{backup.taskId || "fara task"}</span>
                <span>{backup.manifest?.fileCount ?? 0} fisiere</span>
                <span>{new Date(backup.createdAt).toLocaleString("ro-RO")}</span>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="muted">Nu exista backupuri pentru proiectul selectat.</p>
      )}
    </article>
  );
}

function ExecutionApprovalGate({ run, approvals, onReload }) {
  const approval = run ? approvals.find((item) => item.agentRunId === run.id) : null;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { setNote(""); setMessage(""); setBusy(""); }, [run?.id]);

  if (!run) return null;

  const requestApproval = async () => {
    if (busy) return;
    setBusy("request"); setMessage("");
    try {
      const data = await apiRequest(`/agent-runs/${encodeURIComponent(run.id)}/approval-request`, { method: "POST", body: JSON.stringify({ note }) });
      setMessage(data.reused ? "Cererea de aprobare exista deja." : "Cererea de aprobare este pregatita.");
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Nu am putut cere aprobarea."); }
    finally { setBusy(""); }
  };

  const decide = async (decision) => {
    if (!approval || busy) return;
    setBusy(decision); setMessage("");
    try {
      const data = await apiRequest(`/execution-approvals/${encodeURIComponent(approval.id)}/decision`, { method: "POST", body: JSON.stringify({ decision, note, expectedRevision: approval.revision }) });
      setMessage(data.executionStarted ? "Execuția a pornit." : "Decizia a fost salvată. Execuția automată rămâne oprită.");
      await onReload();
    } catch (err) { if (err?.payload?.approval) await onReload(); setMessage(err instanceof Error ? err.message : "Decizia nu a putut fi salvată."); }
    finally { setBusy(""); }
  };

  const pending = approval?.status === "pending";
  const tone = approval?.status === "approved" ? "success" : approval?.status === "rejected" ? "danger" : "warning";
  return (
    <article className="panel wide approval-gate-panel">
      <div className="panel-heading split-heading"><div><ShieldCheck size={18} /><h3>Poarta de aprobare</h3></div><StatusPill value={approval?.status || "Neinițiată"} tone={approval ? tone : "neutral"} /></div>
      <div className="approval-context"><span>Task: <strong>{run.taskId}</strong></span><span>Pachet: <strong>{run.id}</strong></span><span>Backup: <strong>{run.packet?.backup?.status || "lipsă"}</strong></span></div>
      <label className="approval-note">Notă / modificări cerute<textarea rows={3} maxLength={1000} value={note} disabled={Boolean(busy) || (approval && !pending)} onChange={(event) => setNote(event.target.value)} placeholder="Obligatorie când ceri modificări sau respingi." /></label>
      {!approval ? <button className="icon-button primary" type="button" disabled={Boolean(busy) || run.packet?.backup?.status !== "created"} onClick={requestApproval}><ShieldCheck size={16} />{busy === "request" ? "Pregătesc..." : "Cere aprobarea lui Cătălin"}</button> : null}
      {pending ? <div className="approval-actions">
        <button className="icon-button approval-yes" type="button" disabled={Boolean(busy)} onClick={() => decide("approved")}>Aprobă</button>
        <button className="icon-button" type="button" disabled={Boolean(busy) || note.trim().length < 4} onClick={() => decide("changes_requested")}>Cere modificări</button>
        <button className="icon-button danger" type="button" disabled={Boolean(busy) || note.trim().length < 4} onClick={() => decide("rejected")}>Respinge</button>
      </div> : null}
      {approval ? <p className="approval-status-copy">Expiră: {new Date(approval.expiresAt).toLocaleString("ro-RO")}{approval.decisionBy ? ` · Decizie: ${approval.decisionBy}` : ""}. Execuția automată este încă dezactivată.</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </article>
  );
}

function ControlledExecutionPanel({ run, approvals, attempts, onReload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [verdictNote, setVerdictNote] = useState("");

  useEffect(() => { setMessage(""); setLatest(null); setBusy(false); setConfirmed(false); setVerdictNote(""); }, [run?.id]);
  const approval = run ? approvals.find((item) => item.agentRunId === run.id) : null;
  const prior = run ? attempts.find((item) => item.agentRunId === run.id) || latest : latest;
  const modelSelection = run?.packet?.routing?.modelSelection;
  const stage = run?.workflowStage || run?.packet?.workflow?.stage || "owner";
  const stageLabel = { owner: "owner", reviewer: "reviewerul", qa: "QA", fix: "agentul de reparare" }[stage] || stage;
  useEffect(() => {
    if (prior?.status !== "running") return undefined;
    const timer = window.setInterval(() => { void onReload(); }, 5000);
    return () => window.clearInterval(timer);
  }, [prior?.status, onReload]);
  if (!run) return null;
  const preflight = async () => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const data = await apiRequest(`/agent-runs/${encodeURIComponent(run.id)}/preflight`, { method: "POST", body: "{}" });
      setLatest(data.attempt);
      setMessage(data.attempt.status === "passed" ? "Preflight trecut. Runnerul rămâne nearmat, deci nu a fost pornit niciun agent." : "Preflight blocat. Vezi condițiile de mai jos.");
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Preflight-ul nu a putut rula."); }
    finally { setBusy(false); }
  };
  const launch = async () => {
    if (busy || !confirmed || approval?.status !== "approved") return;
    setBusy(true); setMessage("");
    try {
      const data = await apiRequest(`/agent-runs/${encodeURIComponent(run.id)}/execute`, {
        method: "POST",
        body: JSON.stringify({ confirmExecution: true, approvalId: approval.id, expectedRevision: approval.revision }),
      });
      setLatest(data.attempt);
      setConfirmed(false);
      setMessage(`Agentul ${data.attempt.agentId} a pornit cu profilul ${data.attempt.executionProfile}. Limita este ${data.attempt.timeoutSeconds / 60} minute.`);
      await onReload();
    } catch (err) {
      if (err?.payload?.preflight) setLatest(err.payload.preflight);
      setMessage(err instanceof Error ? err.message : "Execuția nu a putut porni.");
      await onReload();
    } finally { setBusy(false); }
  };
  const confirmVerdict = async (verdict) => {
    if (busy || run.status !== "awaiting_verdict" || !prior || verdictNote.trim().length < 4) return;
    setBusy(true); setMessage("");
    try {
      const data = await apiRequest(`/execution-attempts/${encodeURIComponent(prior.id)}/workflow-verdict`, {
        method: "POST",
        body: JSON.stringify({ confirmDecision: true, verdict, evidence: verdictNote }),
      });
      setMessage(data.transition ? `Verdict confirmat: ${data.transition.fromStage} → ${data.transition.toStage}.` : "Verdict salvat.");
      setVerdictNote("");
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Verdictul nu a putut fi salvat."); }
    finally { setBusy(false); }
  };
  const retryStage = async () => {
    if (busy || !new Set(["failed", "timed_out", "workflow_error"]).has(run.status)) return;
    setBusy(true); setMessage("");
    try {
      const data = await apiRequest(`/agent-runs/${encodeURIComponent(run.id)}/retry`, { method: "POST", body: JSON.stringify({ confirmRetry: true }) });
      setMessage(data.reused ? "Retry-ul exista deja." : `Pachet nou pregătit pentru etapa ${data.agentRun.workflowStage}.`);
      await onReload();
    } catch (err) { setMessage(err instanceof Error ? err.message : "Retry-ul nu a putut fi pregătit."); }
    finally { setBusy(false); }
  };
  return (
    <article className="panel wide execution-panel">
      <div className="panel-heading split-heading"><div><Terminal size={18} /><h3>Runner controlat</h3></div><StatusPill value={`${stage} · ciclu ${run.workflowCycle || 0}`} tone="warning" /></div>
      <p className="execution-safety">Preflight-ul nu consumă usage. Etapa {stageLabel} pornește numai manual, după aprobare validă și verificarea de siguranță. Următorul pachet poate fi pregătit automat, dar nu este lansat automat.</p>
      {modelSelection ? <div className="execution-model-route"><span>Model</span><strong>{modelSelection.effectiveModel}</strong><span>Raționament</span><strong>{modelSelection.thinking}</strong>{modelSelection.fallbackReason ? <small>{modelSelection.fallbackReason}</small> : null}</div> : null}
      <button className="icon-button primary" type="button" disabled={busy} onClick={preflight}><ShieldCheck size={16} />{busy ? "Verific..." : "Rulează preflight"}</button>
      {prior ? <section className={`preflight-result ${prior.status}`}><div><strong>{prior.status === "passed" ? "Condiții trecute" : "Condiții blocate"}</strong><small>{new Date(prior.createdAt).toLocaleString("ro-RO")}</small></div>
        <ul>{prior.checks.map((check) => <li key={check.name} className={check.passed ? "pass" : "fail"}><strong>{check.name}</strong><span>{check.detail}</span></li>)}</ul>
        {prior.blockers.length ? <div className="preflight-blockers"><strong>Blocări</strong><ul>{prior.blockers.map((blocker) => <li key={blocker.name}>{blocker.detail}</li>)}</ul></div> : null}
      </section> : null}
      <div className="manual-launch-gate">
        <label className="checkbox-line"><input type="checkbox" checked={confirmed} disabled={busy || approval?.status !== "approved" || prior?.status === "running"} onChange={(event) => setConfirmed(event.target.checked)} /> Confirm că vreau să pornesc manual {stageLabel}</label>
        <button className="icon-button approval-yes" type="button" onClick={launch} disabled={busy || !confirmed || approval?.status !== "approved" || prior?.status === "running"}><Terminal size={16} />{prior?.status === "running" ? "Agent în lucru..." : `Pornește ${stageLabel}`}</button>
        {approval?.status !== "approved" ? <small>Lansarea este blocată până când aprobarea acestui pachet are status approved.</small> : null}
      </div>
      {prior?.mode === "manual_launch" ? <section className="execution-output"><div><strong>Execuție {prior.status}</strong><span>{prior.agentId} · {prior.modelId} · {prior.reasoning} · {prior.executionProfile || "normal"} · {Math.round((prior.timeoutSeconds || 0) / 60)} min</span></div>{prior.status === "running" && prior.heartbeatAt ? <small>Proces activ: {new Date(prior.heartbeatAt).toLocaleTimeString("ro-RO")}. Heartbeat-ul confirmă procesul, nu progresul semantic.</small> : null}{prior.output ? <pre>{prior.output}</pre> : null}{prior.error ? <pre className="execution-error">{prior.error}</pre> : null}</section> : null}
      {run.status === "awaiting_verdict" && prior?.status === "completed" ? <section className="workflow-verdict-gate">
        <strong>Verdictul automat nu a fost sigur</strong>
        <p>Verifică rezultatul de mai sus și confirmă manual. Sistemul nu va continua prin presupunere.</p>
        <textarea rows={3} maxLength={4000} value={verdictNote} onChange={(event) => setVerdictNote(event.target.value)} placeholder="Dovada pentru PASS sau problemele care justifică FAIL" />
        <div><button className="icon-button approval-yes" type="button" disabled={busy || verdictNote.trim().length < 4} onClick={() => confirmVerdict("pass")}>Confirmă PASS</button><button className="icon-button danger" type="button" disabled={busy || verdictNote.trim().length < 4} onClick={() => confirmVerdict("fail")}>Confirmă FAIL</button></div>
      </section> : null}
      {new Set(["failed", "timed_out", "workflow_error"]).has(run.status) ? <section className="workflow-verdict-gate">
        <strong>Etapa s-a oprit înainte de verdict</strong>
        <p>Poți pregăti un retry al aceleiași etape. Se creează un pachet și o aprobare noi; ownerul nu este reluat.</p>
        <div><button className="icon-button primary" type="button" disabled={busy} onClick={retryStage}><RefreshCcw size={16} />{busy ? "Pregătesc..." : `Reîncearcă ${stageLabel}`}</button></div>
      </section> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </article>
  );
}

function PacketPreview({ run }) {
  const [copied, setCopied] = useState("");

  if (!run) {
    return (
      <article className="panel wide">
        <div className="panel-heading">
          <FileText size={18} />
          <h3>Packet preview</h3>
        </div>
        <p className="muted">Genereaza sau selecteaza un packet pentru un task.</p>
      </article>
    );
  }

  const packet = run.packet || {};
  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("copy failed");
    }
  };

  return (
    <article className="panel wide packet-panel">
      <div className="panel-heading split-heading">
        <div>
          <FileText size={18} />
          <h3>Packet preview</h3>
        </div>
        <StatusPill value={run.status} tone="success" />
      </div>

      <div className="packet-summary">
        <div>
          <span>Task</span>
          <strong>{run.taskId}</strong>
        </div>
        <div>
          <span>Route</span>
          <strong>{run.route}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{run.ownerAgent || "Codex"}</strong>
        </div>
        <div>
          <span>Reviewer</span>
          <strong>{run.reviewerAgent || "n/a"}</strong>
        </div>
        <div>
          <span>QA</span>
          <strong>{run.qaAgent || "ifrim-qa"}</strong>
        </div>
        {packet.routing?.modelSelection ? <div>
          <span>Model / reasoning</span>
          <strong>{packet.routing.modelSelection.effectiveModel} · {packet.routing.modelSelection.thinking}</strong>
        </div> : null}
      </div>

      {packet.backup ? (
        <section className={`backup-banner ${packet.backup.status}`}>
          <HardDriveDownload size={18} />
          <div>
            <strong>Backup inainte de lucru: {packet.backup.status}</strong>
            <span>{packet.backup.path}</span>
            <small>
              {(packet.backup.manifest?.fileCount ?? 0).toLocaleString("ro-RO")} fisiere · {packet.backup.manifest?.secretsPolicy || "Politica secrete n/a"}
            </small>
          </div>
        </section>
      ) : null}

      <div className="packet-columns">
        <section>
          <h4>Memory checklist</h4>
          <ul>
            {(packet.memoryChecklist || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Verification checklist</h4>
          <ul>
            {(packet.verificationChecklist || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="packet-prompt">
        <div className="packet-toolbar">
          <h4>Prompt packet</h4>
          <button className="icon-button" type="button" onClick={() => copy("prompt", packet.prompt || "")}>
            <Copy size={16} />
            Copy prompt
          </button>
        </div>
        <pre>{packet.prompt || "Packet prompt lipsa."}</pre>
      </section>

      <section className="command-list">
        <h4>Command preview</h4>
        {(packet.commands || []).map((command) => (
          <div className="command-card" key={command.label}>
            <div className="packet-toolbar">
              <strong>
                <Terminal size={16} />
                {command.label}
              </strong>
              <button className="icon-button" type="button" onClick={() => copy(command.label, command.command)}>
                <Copy size={16} />
                Copy
              </button>
            </div>
            <pre>{command.command}</pre>
          </div>
        ))}
        {copied ? <p className="form-message">{copied === "copy failed" ? "Nu am putut copia." : `Copiat: ${copied}`}</p> : null}
      </section>
    </article>
  );
}

function BridgeDiagnosticsPanel({ project }) {
  const { diagnostics, status, error, reload } = useBridgeDiagnostics(project?.slug);
  const [copied, setCopied] = useState("");

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("copy failed");
    }
  };

  return (
    <article className="panel wide bridge-panel">
      <div className="panel-heading split-heading">
        <div>
          <Terminal size={18} />
          <h3>Bridge diagnostics</h3>
        </div>
        <div className="bridge-actions">
          {diagnostics?.status ? <StatusPill value={diagnostics.status} tone={diagnosticTone(diagnostics.status)} /> : null}
          <button className="icon-button" type="button" onClick={reload} disabled={status === "loading"}>
            <RefreshCcw size={16} />
            {status === "loading" ? "Verific..." : "Refresh"}
          </button>
        </div>
      </div>

      <p className="bridge-note">{diagnostics?.approvalGate || "Diagnosticul verifica doar disponibilitatea locala. Executia automata de agenti ramane inchisa."}</p>
      {error ? <p className="inline-error">{error}</p> : null}
      {status === "loading" && !diagnostics ? <p className="muted">Rulez verificari locale sigure...</p> : null}

      {diagnostics ? (
        <>
          <div className="bridge-summary">
            <div>
              <span>Proiect</span>
              <strong>{diagnostics.project?.name}</strong>
            </div>
            <div>
              <span>Execution mode</span>
              <strong>{diagnostics.executionMode}</strong>
            </div>
            <div>
              <span>Auto execution</span>
              <strong>{diagnostics.canExecuteAgentsAutomatically ? "enabled" : "closed"}</strong>
            </div>
            <div>
              <span>Actualizat</span>
              <strong>{new Date(diagnostics.generatedAt).toLocaleString("ro-RO")}</strong>
            </div>
          </div>

          <div className="bridge-grid">
            {(diagnostics.providers || []).map((provider) => (
              <section className={`bridge-provider ${provider.status}`} key={provider.id}>
                <div className="bridge-provider-head">
                  <div>
                    <strong>{provider.label}</strong>
                    <p>{provider.lastBlocker}</p>
                  </div>
                  <StatusPill value={provider.status} tone={diagnosticTone(provider.status)} />
                </div>

                <div className="diagnostic-steps">
                  {(provider.steps || []).map((step) => (
                    <div className="diagnostic-step" key={`${provider.id}-${step.name}`}>
                      <div>
                        <span>{step.name}</span>
                        <p>{step.details || "Fara detalii suplimentare."}</p>
                        {step.path ? <small>{step.path}</small> : null}
                        {step.stderr ? <small>{step.stderr}</small> : null}
                      </div>
                      <StatusPill value={step.status} tone={diagnosticTone(step.status)} />
                    </div>
                  ))}
                </div>

                {provider.metadata ? (
                  <dl className="bridge-metadata">
                    <div>
                      <dt>Profiles</dt>
                      <dd>{provider.metadata.profiles?.join(", ") || "n/a"}</dd>
                    </div>
                    <div>
                      <dt>ANTHROPIC_API_KEY</dt>
                      <dd>{provider.metadata.anthropicApiKeyPresent ? "present" : "not set"}</dd>
                    </div>
                  </dl>
                ) : null}

                <div className="diagnostic-command-list">
                  <h4>Command preview</h4>
                  {(provider.commands || []).map((command) => (
                    <div className="command-card" key={`${provider.id}-${command.label}`}>
                      <div className="packet-toolbar">
                        <strong>
                          <Terminal size={16} />
                          {command.label}
                        </strong>
                        <button className="icon-button" type="button" onClick={() => copy(command.label, command.command)}>
                          <Copy size={16} />
                          Copy
                        </button>
                      </div>
                      <pre>{command.command}</pre>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {copied ? <p className="form-message">{copied === "copy failed" ? "Nu am putut copia." : `Copiat: ${copied}`}</p> : null}
        </>
      ) : null}
    </article>
  );
}

function AgentDirectoryPanel() {
  const { directory, status, error, reload } = useAgentDirectory();
  const lunaLabel = directory?.lunaStatus === "disabled_until_live_probe_passes" ? "Dezactivat" : (directory?.lunaStatus || "Necunoscut");

  return (
    <article className="panel wide agent-directory-panel">
      <div className="panel-heading split-heading">
        <div>
          <Bot size={18} />
          <h3>Echipa de agenti si rutarea modelelor</h3>
        </div>
        <button className="icon-button" type="button" onClick={reload} disabled={status === "loading"}>
          <RefreshCcw size={16} />
          {status === "loading" ? "Verific..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}
      {status === "loading" && !directory ? <p className="muted">Citesc registrul central si configuratia OpenClaw...</p> : null}

      {directory ? (
        <>
          <p className="bridge-note">
            Sol si Terra: verificate live fara fallback
            {directory.liveVerification?.verifiedAt ? ` la ${new Date(directory.liveVerification.verifiedAt).toLocaleString("ro-RO")}` : ""}.
            Directorul nu consuma usage pentru o proba noua.
          </p>
          <div className="agent-directory-summary">
            <div><span>Agenti</span><strong>{directory.totalAgents}</strong></div>
            <div><span>Configurati</span><strong>{directory.configuredAgents}</strong></div>
            <div><span>Drift</span><strong>{directory.driftCount}</strong></div>
            <div title={directory.lunaStatus}><span>Luna</span><strong>{lunaLabel}</strong></div>
          </div>
          <div className="agent-table-wrap">
            <table className="agent-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Rol</th>
                  <th>Model</th>
                  <th>Reasoning</th>
                  <th>Fallback</th>
                  <th>Config</th>
                </tr>
              </thead>
              <tbody>
                {directory.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td><strong>{agent.title}</strong><small>{agent.id}</small></td>
                    <td>{agent.kind}</td>
                    <td>{agent.model.replace("openai/", "")}</td>
                    <td>{agent.reasoning}</td>
                    <td>{agent.failClosed ? "fail-closed" : agent.fallbacks.map((item) => item.replace("openai/", "")).join(", ")}</td>
                    <td><StatusPill value={agent.drift.length ? "drift" : "sync"} tone={agent.drift.length ? "danger" : "success"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small className="registry-version">Registry: {directory.registryVersion} · entitlement: {directory.entitlementStatus}</small>
        </>
      ) : null}
    </article>
  );
}

function DesignGovernancePanel({ project, tasks }) {
  const { governance, error } = useDesignGovernance(project.slug);
  const designTasks = tasks.filter((task) => task.projectSlug === project.slug && task.source === "prompt-compiler" && (
    task.compilerPayload?.ownerAgent === "ifrim-design" ||
    (task.compilerPayload?.affectedAreas || []).some((area) => /ui|ux|front|design|dashboard|screen|page|pagina|ecran|layout|responsive/i.test(area))
  ));

  return (
    <article className="panel wide design-governance-panel">
      <div className="panel-heading split-heading">
        <div><Palette size={18} /><h3>Design System Governance</h3></div>
        <StatusPill value={governance?.available ? "Activ" : "Indisponibil"} tone={governance?.available ? "success" : "danger"} />
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      {!error && !governance ? <p className="muted-copy">Incarc regulile vizuale...</p> : null}
      {governance ? (
        <div className="design-governance-grid">
          <section>
            <span>Directia proiectului</span>
            <strong>{governance.direction}</strong>
          </section>
          <section>
            <span>Ruta obligatorie pentru UI</span>
            <strong>{governance.ownerRoute.join(" + ")}</strong>
            <small>Review: {governance.reviewerRoute.join(", ")} · QA: {governance.qaRoute.join(", ")}</small>
          </section>
          <section className="design-checks">
            <span>Gate de calitate</span>
            <ul>{governance.requiredChecks.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section>
            <span>Taskuri UI compilate</span>
            <strong>{designTasks.length}</strong>
            <small>Guvernanta este injectata automat la generarea pachetului.</small>
          </section>
        </div>
      ) : null}
    </article>
  );
}

function EventsPanel({ events }) {
  return (
    <article className="panel wide">
      <div className="panel-heading">
        <Activity size={18} />
        <h3>Audit trail</h3>
      </div>
      {events.length ? (
        <ul className="event-list">
          {events.slice(0, 12).map((event) => (
            <li key={event.id}>
              <span>{event.summary}</span>
              <small>{new Date(event.createdAt).toLocaleString("ro-RO")}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nu exista evenimente inca.</p>
      )}
    </article>
  );
}

function ContinuationPanel({ project, continuationState }) {
  const [copyStatus, setCopyStatus] = useState("");
  const continuation = continuationState.continuation;
  const workflowSteps = continuation?.workflow?.steps || [];

  const copyTrigger = async () => {
    if (!continuation?.trigger) return;
    try {
      await navigator.clipboard.writeText(continuation.trigger);
      setCopyStatus("Copiat");
    } catch {
      setCopyStatus("Copiere indisponibila");
    }
  };

  return (
    <article className="panel wide continuation-panel">
      <div className="panel-heading panel-heading-actions">
        <span className="panel-heading-title">
          <Workflow size={18} />
          <h3>Continuare coordonata</h3>
        </span>
        <button type="button" className="icon-button" onClick={continuationState.reload} disabled={continuationState.status === "loading"} title="Recalculeaza starea de continuare">
          <RefreshCcw size={16} />
          Actualizeaza
        </button>
      </div>

      {continuationState.status === "loading" ? <p className="muted">Se reconstruieste contextul proiectului...</p> : null}
      {continuationState.error ? <p className="inline-error">{continuationState.error}</p> : null}
      {continuation ? (
        <>
          <div className="task-line">
            <strong>{continuation.task?.id || "Fara task activ"}</strong>
            <span>{continuation.nextAction.label}</span>
            <StatusPill value={continuation.nextAction.code} tone={continuation.nextAction.approvalRequired ? "warning" : "success"} />
          </div>
          <dl className="task-meta compact">
            <div><dt>Owner</dt><dd>{continuation.routing?.owner || "De alocat"}</dd></div>
            <div><dt>Reviewer</dt><dd>{continuation.routing?.reviewer || "De alocat"}</dd></div>
            <div><dt>QA</dt><dd>{continuation.routing?.qa || "De alocat"}</dd></div>
            <div><dt>Backup</dt><dd>{continuation.backup?.status || "lipsa"}</dd></div>
            <div><dt>Aprobare</dt><dd>{continuation.approval?.status || (continuation.task?.approvalRequired ? "neceruta" : "nu este necesara")}</dd></div>
            <div><dt>Executie</dt><dd>{continuation.executionStarted ? "pornita" : "nepornita"}</dd></div>
          </dl>
          {workflowSteps.length ? <div className="workflow-grid" aria-label="Flux owner reviewer QA">
            {workflowSteps.map((step, index) => (
              <section className="workflow-step" key={step.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.agent}</small>
                </div>
                <StatusPill value={step.status} tone={step.status === "complete" ? "success" : step.status === "blocked" ? "danger" : step.status === "ready" || step.status === "running" ? "warning" : "neutral"} />
              </section>
            ))}
          </div> : null}
          <div className="continuation-trigger">
            <code>{continuation.trigger}</code>
            <button type="button" className="icon-button" onClick={copyTrigger} title={`Copiaza comanda pentru ${project.name}`}>
              <Copy size={16} />
              {copyStatus || "Copiaza"}
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function ProjectDetail({ project, projects, hubState }) {
  const [selectedRun, setSelectedRun] = useState(null);
  const continuationState = useProjectContinuation(project?.slug);
  const [packetBusyId, setPacketBusyId] = useState("");
  const [packetError, setPacketError] = useState("");

  useEffect(() => {
    if (selectedRun && project && selectedRun.projectSlug !== project.slug) {
      setSelectedRun(null);
    }
  }, [project?.slug, selectedRun]);

  useEffect(() => {
    if (!selectedRun) return;
    const liveRun = hubState.agentRuns.find((item) => item.id === selectedRun.id);
    if (!liveRun) return;
    const child = hubState.agentRuns.find((item) => item.parentRunId === liveRun.id && item.status === "packet_ready");
    if (child && ["transitioned", "workflow_complete", "failed", "timed_out", "workflow_error"].includes(liveRun.status)) setSelectedRun(child);
    else if (liveRun.updatedAt !== selectedRun.updatedAt || liveRun.status !== selectedRun.status) setSelectedRun(liveRun);
  }, [hubState.agentRuns, selectedRun?.id, selectedRun?.updatedAt, selectedRun?.status]);

  if (!project) {
    return <main className="empty-state">Selecteaza un proiect din lista.</main>;
  }

  const projectTasks = hubState.tasks.filter((task) => task.projectSlug === project.slug);
  const projectDrafts = hubState.taskDrafts.filter((draft) => draft.projectSlug === project.slug);
  const projectLocks = hubState.locks.filter((lock) => lock.projectSlug === project.slug);
  const projectRuns = hubState.agentRuns.filter((run) => run.projectSlug === project.slug);
  const projectBackups = hubState.backups.filter((backup) => backup.projectSlug === project.slug);
  const activeLocks = projectLocks.filter((lock) => lock.status === "active");
  const nextTask = projectTasks.find((task) => !["done", "cancelled"].includes(task.status)) || projectTasks[0];
  const selectedLiveRun = selectedRun ? projectRuns.find((item) => item.id === selectedRun.id) : null;
  const activePacket = selectedLiveRun || projectRuns[0];
  const reloadWorkflow = async () => { await Promise.all([hubState.reload(), continuationState.reload()]); };

  const createPacket = async (task) => {
    if (packetBusyId) return;
    setPacketBusyId(task.id);
    setPacketError("");
    try {
      const data = await apiRequest("/agent-runs", { method: "POST", body: JSON.stringify({ taskId: task.id }) });
      setSelectedRun(data.agentRun);
      await hubState.reload();
    } catch (err) {
      setPacketError(err instanceof Error ? err.message : "Nu am putut genera packetul.");
    } finally {
      setPacketBusyId("");
    }
  };

  return (
    <main className="workspace">
      <section className="topbar">
        <div>
          <p className="eyebrow">{project.priority ? "Prioritar" : "Monitorizat"}</p>
          <h2>{project.name}</h2>
          <span className="path">{project.path}</span>
        </div>
        <div className="actions">
          <a href={project.frontend} target="_blank" rel="noreferrer" className="icon-button" title="Deschide preview frontend">
            <ExternalLink size={18} />
            Frontend
          </a>
          {project.backend !== "n/a" && project.backend !== "TBD" ? (
            <a href={project.backend} target="_blank" rel="noreferrer" className="icon-button" title="Deschide API">
              <Server size={18} />
              API
            </a>
          ) : null}
        </div>
      </section>

      <section className="stats-grid" aria-label="Status">
        <Stat label="Status" value={project.status} icon={Activity} />
        <Stat label="Taskuri" value={projectTasks.length} icon={ListChecks} />
        <Stat label="Drafturi" value={projectDrafts.length} icon={Sparkles} />
        <Stat label="Locks active" value={activeLocks.length} icon={LockKeyhole} />
        <Stat label="Agent packets" value={projectRuns.length} icon={Bot} />
        <Stat label="Backups" value={projectBackups.length} icon={HardDriveDownload} />
      </section>

      <section className="panel-grid">
        <article className="panel wide">
          <div className="panel-heading">
            <ClipboardList size={18} />
            <h3>Urmatorul task</h3>
          </div>
          {nextTask ? (
            <>
              <div className="task-line">
                <strong>{nextTask.id}</strong>
                <span>{nextTask.title}</span>
                <em>{nextTask.status}</em>
              </div>
              <dl className="task-meta">
                <div>
                  <dt>Owner</dt>
                  <dd>{nextTask.ownerAgent}</dd>
                </div>
                <div>
                  <dt>QA</dt>
                  <dd>{nextTask.qaAgent}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="muted">Nu exista taskuri pentru proiectul selectat.</p>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <CheckCircle2 size={18} />
            <h3>Focus curent</h3>
          </div>
          <pre>{project.summary.currentFocus || project.summary.purpose || "Nu exista focus curent in memorie."}</pre>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <ShieldCheck size={18} />
            <h3>Faza / etapa</h3>
          </div>
          <pre>{project.summary.phase || "Nu exista faza explicita in memorie."}</pre>
        </article>

        <ContinuationPanel project={project} continuationState={continuationState} />
        <WorkflowTransitionsPanel transitions={hubState.workflowTransitions} activeSlug={project.slug} />

        {packetError ? <p className="inline-error wide-error">{packetError}</p> : null}
        <PromptCompiler key={project.slug} project={project} drafts={hubState.taskDrafts} onReload={hubState.reload} />
        <DesignGovernancePanel project={project} tasks={hubState.tasks} />
        <TaskQueue tasks={hubState.tasks} activeSlug={project.slug} onReload={hubState.reload} onCreatePacket={createPacket} packetBusyId={packetBusyId} />
        <AgentDirectoryPanel />
        <BridgeDiagnosticsPanel project={project} />
        <AgentRunsPanel agentRuns={hubState.agentRuns} activeSlug={project.slug} selectedRunId={activePacket?.id} onSelect={setSelectedRun} />
        <ExecutionApprovalGate run={activePacket} approvals={hubState.executionApprovals} onReload={reloadWorkflow} />
        <ControlledExecutionPanel run={activePacket} approvals={hubState.executionApprovals} attempts={hubState.executionAttempts} onReload={reloadWorkflow} />
        <PacketPreview run={activePacket} />
        <SnapshotsPanel project={project} snapshots={hubState.snapshots} tasks={hubState.tasks} onReload={hubState.reload} />
        <BackupsPanel backups={hubState.backups} activeSlug={project.slug} />
        <LocksPanel locks={hubState.locks} activeSlug={project.slug} onReload={hubState.reload} />

        <section className="forms-grid">
          <TaskForm projects={projects} activeProject={project} onCreated={hubState.reload} />
          <LockForm projects={projects} activeProject={project} onCreated={hubState.reload} />
        </section>

        <article className="panel wide">
          <div className="panel-heading">
            <Activity size={18} />
            <h3>Open issues</h3>
          </div>
          <pre>{project.summary.openIssues || "Nu exista open issues inregistrate."}</pre>
        </article>

        <article className="panel wide">
          <div className="panel-heading">
            <Archive size={18} />
            <h3>Ultimele rapoarte loop</h3>
          </div>
          {project.reports.length ? (
            <ul className="report-list">
              {project.reports.map((report) => (
                <li key={report.path}>
                  <span>{report.name}</span>
                  <small>{new Date(report.updatedAt).toLocaleString("ro-RO")}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nu exista rapoarte loop pentru proiectul acesta.</p>
          )}
        </article>

        <EventsPanel events={hubState.events} />
      </section>
    </main>
  );
}

function App() {
  const { projects, status, error, reload } = useProjects();
  const hubState = useHubState();
  const [activeSlug, setActiveSlug] = useState("");

  useEffect(() => {
    if (!activeSlug && projects.length) {
      const priority = projects.find((project) => project.name === "ProDelivery") || projects[0];
      setActiveSlug(priority.slug);
    }
  }, [projects, activeSlug]);

  const activeProject = projects.find((project) => project.slug === activeSlug);

  const reloadAll = async () => {
    await Promise.all([reload(), hubState.reload()]);
  };

  return (
    <div className="app-shell">
      <ProjectList projects={projects} activeSlug={activeSlug} onSelect={setActiveSlug} />
      <div className="content-shell">
        <header className="utility-bar">
          <span>
            {status === "ready" ? `${projects.length} proiecte incarcate` : "Se incarca proiectele"} · Hub {hubState.status}
          </span>
          <button className="icon-button" type="button" onClick={reloadAll} title="Reincarca proiectele si Agent Hub state">
            <RefreshCcw size={16} />
            Reincarca
          </button>
        </header>
        {status === "error" || hubState.status === "error" ? (
          <main className="empty-state error">{error || hubState.error}</main>
        ) : (
          <ProjectDetail project={activeProject} projects={projects} hubState={hubState} />
        )}
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
const appRoot = globalThis.__IFRIM_AGENT_HUB_ROOT__ || createRoot(rootElement);
globalThis.__IFRIM_AGENT_HUB_ROOT__ = appRoot;
appRoot.render(<App />);
