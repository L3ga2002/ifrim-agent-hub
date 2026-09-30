import { useState, useEffect } from "react";
import { Brain, Plus, Download, Search, ArrowLeftRight } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, Chip, Dialog, Notice } from "../components/ui.jsx";

const SCOPE_RO = { GLOBAL: "global", COMPANY: "companie", DEPARTMENT: "departament", CLIENT: "client", PROJECT: "proiect", MISSION: "misiune", TASK: "task", AGENT_ROLE: "rol de agent" };
const SOURCE_RO = { hub: "Hub", user: "tu", claude_native: "Claude (import)", openai_native: "ChatGPT (import)", hermes: "Hermes (import)", import: "import", v1: "V1" };
const TYPE_TONE = { FACT: "ok", USER_PREFERENCE: "info", DECISION: "info", ASSUMPTION: "warn", HYPOTHESIS: "warn", OUTDATED: "neutral" };
const NEEDS_REF = (scope) => scope && scope !== "GLOBAL" && scope !== "COMPANY";

function VendorSync({ onClose, onDone }) {
  const [tab, setTab] = useState("export");
  const [provider, setProvider] = useState("claude");
  const [exported, setExported] = useState(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const load = useAction(async () => setExported(await api(`/api/memory/export/${provider}`)));
  const importIt = useAction(async () => { setResult(await api("/api/memory/import", { method: "POST", body: { sourceKind: provider === "claude" ? "claude_native" : "openai_native", text, scope: "GLOBAL" } })); onDone(); });
  return (
    <Dialog title="Memorie ↔ vendor (asistat)" onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Închide</button>}>
      <div className="row wrap" role="tablist">
        {["export", "import"].map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn sm ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>{t === "export" ? "Export spre vendor" : "Import din vendor"}</button>)}
        <select className="select" style={{ width: "auto", minHeight: 30 }} value={provider} onChange={(e) => { setProvider(e.target.value); setExported(null); }} aria-label="Vendor">
          <option value="claude">Claude</option><option value="openai">ChatGPT</option>
        </select>
      </div>
      {tab === "export" ? (
        <div className="stack tight">
          <p className="muted" style={{ margin: 0 }}>Faptele, preferințele și deciziile active, cu marcajul <span className="mono">hub-memory-id</span>. Le lipești tu în memoria sau instrucțiunile proiectului din aplicația vendorului; Hub-ul nu scrie în contul vendorului.</p>
          <button className="btn sm" disabled={load.pending} onClick={load.run}>Generează textul</button>
          {exported && <><pre className="pre" style={{ maxHeight: 220 }}>{exported.text || "(nimic de exportat)"}</pre><span className="faint">{exported.count} elemente</span></>}
          <ErrorNotice error={load.error} />
        </div>
      ) : (
        <div className="stack tight">
          <p className="muted" style={{ margin: 0 }}>Lipește exportul de memorie din aplicația vendorului. Liniile care provin din Hub (marcaj) sunt ignorate ca ecouri, duplicatele se ignoră, restul intră ca ASSUMPTION până le confirmi.</p>
          <textarea className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text de importat" />
          <button className="btn sm primary" disabled={!text.trim() || importIt.pending} onClick={importIt.run}>Importă ca ipoteze</button>
          {result && <Notice tone="info">{result.created} create · {result.echoes} ecouri Hub ignorate · {result.duplicates} duplicate · {result.rejected} respinse</Notice>}
          <ErrorNotice error={importIt.error} />
        </div>
      )}
    </Dialog>
  );
}

function ItemEditor({ item, onClose, onSaved, scopes, types }) {
  const [form, setForm] = useState(item ? { title: item.title, body: item.body, type: item.type, sourceRef: item.sourceRef } : { scope: "PROJECT", scopeRef: "", type: "FACT", title: "", body: "", sourceRef: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useAction(async () => {
    if (item) await api(`/api/memory/${item.id}/revise`, { method: "POST", body: { title: form.title, body: form.body, type: form.type, sourceRef: form.sourceRef } });
    else await api("/api/memory", { method: "POST", body: form });
    onSaved(); onClose();
  });
  return (
    <Dialog title={item ? "Corectează (versiune nouă)" : "Înregistrare nouă"} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={save.pending || !form.title.trim() || !form.body.trim() || (!item && NEEDS_REF(form.scope) && !form.scopeRef.trim())} onClick={save.run}>Salvează</button></>}>
      {!item && <div className="grid two">
        <label className="field"><span>Scope</span><select className="select" value={form.scope} onChange={set("scope")}>{scopes.map((s) => <option key={s} value={s}>{SCOPE_RO[s]}</option>)}</select></label>
        <label className="field"><span>Referință scope {NEEDS_REF(form.scope) ? "(obligatorie: id proiect/client/misiune/task/rol)" : "(opțională)"}</span><input className="input" value={form.scopeRef} onChange={set("scopeRef")} /></label>
      </div>}
      <label className="field"><span>Tip</span><select className="select" value={form.type} onChange={set("type")}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label className="field"><span>Titlu</span><input className="input" value={form.title} onChange={set("title")} maxLength={200} /></label>
      <label className="field"><span>Conținut</span><textarea className="textarea" rows={5} value={form.body} onChange={set("body")} /></label>
      <label className="field"><span>Sursă (document, mesaj, URL, dată)</span><input className="input" value={form.sourceRef} onChange={set("sourceRef")} maxLength={500} /></label>
      {item && <p className="faint" style={{ margin: 0, fontSize: 12 }}>Versiunea veche se păstrează, marcată OUTDATED.</p>}
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

export default function Memory({ query }) {
  const [q, setQ] = useState(query?.q || "");
  const [scope, setScope] = useState("");
  const [debounced, setDebounced] = useState(q);
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useResource(`/api/memory?q=${encodeURIComponent(debounced)}${scope ? `&scope=${scope}` : ""}`, { reloadOn: (e) => e.type.startsWith("memory."), deps: [debounced, scope] });
  const remove = useAction(async (id) => { await api(`/api/memory/${id}`, { method: "DELETE" }); reload(); });
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Memorie</h1><p>Memoria canonică a Hub-ului: independentă de provider, pe scope, cu sursă. Memoria Claude/ChatGPT rămâne a vendorului; schimbul este asistat și fără bucle.</p></div>
        <div className="row wrap"><a className="btn" href="/api/memory/export" download="memorie-hub.json"><Download size={15} />Export JSON</a><button className="btn" onClick={() => setSyncing(true)}><ArrowLeftRight size={15} />Vendor</button><button className="btn primary" onClick={() => setEditing({})}><Plus size={15} />Adaugă</button></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <label className="field grow" style={{ maxWidth: 520 }}><span className="sr-only">Caută</span>
          <div className="row"><Search size={16} color="var(--text-2)" aria-hidden="true" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută în memorie…" aria-label="Caută în memorie" /></div>
        </label>
        <select className="select" style={{ width: "auto" }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">
          <option value="">Toate scope-urile</option>{(data?.scopes || []).map((s) => <option key={s} value={s}>{SCOPE_RO[s]}</option>)}
        </select>
      </div>
      {data?.contradictions?.length > 0 && <div style={{ marginBottom: 16 }}><Notice tone="warn" title="Contradicții">{data.contradictions.length} perechi de înregistrări active au același titlu și conținut diferit. Verifică sursele și corectează.</Notice></div>}
      <Panel title="Înregistrări" icon={Brain} flush>
        {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : data.items.length ? (
          <ul className="list">{data.items.map((m) => (
            <li key={m.id}><div className="list-row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div className="row wrap"><span className="title">{m.title}</span><Chip tone={TYPE_TONE[m.type]}>{m.type}</Chip><Chip>{SCOPE_RO[m.scope] || m.scope}{m.scopeRef ? `: ${m.scopeRef}` : ""}</Chip>{m.sourceKind && m.sourceKind !== "hub" && m.sourceKind !== "user" && <Chip tone="warn">{SOURCE_RO[m.sourceKind] || m.sourceKind}</Chip>}<span className="faint mono">v{m.version}</span></div>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.body}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Sursă: {m.sourceRef || "nespecificată"} · autor {m.author} · {fmt.dateTime(m.updatedAt)}</div>
              </div>
              <div className="row"><button className="btn sm" onClick={() => setEditing(m)}>Corectează</button><button className="btn sm ghost" disabled={remove.pending} onClick={() => { if (window.confirm(`Ștergi „${m.title}”? Rămâne o înregistrare de audit fără conținut.`)) remove.run(m.id); }}>Șterge</button></div>
            </div></li>
          ))}</ul>
        ) : <Empty title={debounced ? "Niciun rezultat" : "Memoria este goală"}>Adaugă fapte, preferințe, decizii sau proceduri cu sursă și scope. Secretele sunt refuzate.</Empty>}
      </Panel>
      {editing && <ItemEditor item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} scopes={data?.scopes || []} types={data?.types || []} />}
      {syncing && <VendorSync onClose={() => setSyncing(false)} onDone={reload} />}
    </div>
  );
}
