import { useState, useEffect } from "react";
import { MessageSquare, Plus } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, useHub } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Dialog } from "../components/ui.jsx";

export function NewConversationDialog({ onClose, go, initialTitle = "" }) {
  const projects = useResource("/api/projects");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => { if (!projectId && projects.data?.projects?.length) setProjectId(projects.data.projects[0].id); }, [projects.data, projectId]);
  const create = useAction(async () => {
    const conv = await api("/api/conversations", { method: "POST", body: { projectId, title: title.trim() } });
    onClose();
    go(`/conversations/${conv.id}`);
  });
  return (
    <Dialog title="Conversație nouă" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={create.pending || title.trim().length < 2 || !projectId} onClick={create.run}>{create.pending ? "Se creează…" : "Creează"}</button></>}>
      <label className="field"><span>Titlu</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Ex.: Reparare backup gate" /></label>
      <label className="field"><span>Proiect</span>
        <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.executionAllowed ? "" : " (doar context)"}</option>)}
        </select>
      </label>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Un singur fir logic per conversație. Sesiunile native Codex/Claude se atașează firului, nu îl înlocuiesc.</p>
      <ErrorNotice error={create.error} />
    </Dialog>
  );
}

export default function Conversations({ go, query }) {
  const { data, error, loading, reload } = useResource("/api/conversations", { reloadOn: (e) => e.type.startsWith("conversation.") || e.type === "message.created" });
  const projects = useHub((s) => s.hub);
  const [creating, setCreating] = useState(Boolean(query?.new || query?.voice));
  const voiceDraft = query?.voice ? sessionStorage.getItem("hub.v2.voiceDraft") || "" : "";
  const list = data?.conversations || [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Conversații</h1><p>Istoric persistent: mesajele originale rămân neschimbate; rezumatele și evenimentele sunt separate.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Conversație nouă</button>
      </div>
      {voiceDraft && <div className="notice info" style={{ marginBottom: 16 }}>Transcriere vocală păstrată ca ciornă: „{voiceDraft}”. Deschide o conversație; ciorna se completează în câmpul de mesaj. Nu a fost trimis nimic.</div>}
      <Panel title="Toate conversațiile" icon={MessageSquare} flush>
        {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : list.length ? (
          <ul className="list">
            {list.map((c) => (
              <li key={c.id}>
                <a className="list-row" href={`#/conversations/${c.id}`}>
                  <MessageSquare size={16} aria-hidden="true" color="var(--text-2)" />
                  <div className="grow"><div className="title ellipsis">{c.title}</div><div className="sub">{c.legacyId ? "importată din V1 · " : ""}actualizată {fmt.ago(c.updatedAt)}{c.writerProvider ? ` · writer: ${c.writerProvider}` : ""}</div></div>
                  <StatusChip status={c.status === "idle" ? "ready" : c.status === "attention" ? "waiting" : c.status === "running" ? "running" : c.status === "handoff" ? "in_progress" : c.status} label={c.status === "handoff" ? "handoff" : undefined} />
                </a>
              </li>
            ))}
          </ul>
        ) : <Empty title="Nicio conversație" action={<button className="btn primary sm" onClick={() => setCreating(true)}>Începe una</button>}>{projects?.legacy ? "" : "Datele V1 pot fi importate din Setări → Date V1."}</Empty>}
      </Panel>
      {creating && <NewConversationDialog onClose={() => setCreating(false)} go={go} initialTitle={voiceDraft ? voiceDraft.slice(0, 60) : ""} />}
    </div>
  );
}
