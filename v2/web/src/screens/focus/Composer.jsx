import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, Play, ShieldCheck, X, Lock, FileText, Target, ArrowRightLeft, History } from "lucide-react";
import { api, fmt, uploadWithProgress } from "../../api.js";
import { useAction, usePref, useHub } from "../../store.js";
import { ErrorNotice, Checks, Notice, Chip } from "../../components/ui.jsx";
import { validateAttachment, composerOptions } from "../../lib/uiLogic.js";

const PROVIDERS = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude Code" }];
const TOOLS_BY_ACCESS = {
  "read-only": { claude: "Read · Glob · Grep (fără shell)", codex: "comenzi în sandbox read-only (profil ifrim_hub_ro)" },
  "workspace-write": { claude: "Edit · Write · Bash limitat — blocat pe Windows nativ (SECURITY_BLOCKER)", codex: "scriere în proiect (profil ifrim_hub_rw)" },
};

function readAsBase64(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
}

export function Composer({ conversation, project, handoffReady, onSent }) {
  const hub = useHub((s) => s.hub);
  const [draft, setDraft] = usePref(`draft:${conversation.id}`, "");
  const [provider, setProvider] = usePref("composer.provider", "codex");
  const [access, setAccess] = usePref("composer.access", "read-only");
  // Phone: route options fold behind a summary button so the conversation keeps the height (desktop always shows them).
  const [optsOpen, setOptsOpen] = useState(false);
  const [effort, setEffort] = usePref("composer.effort", "");
  const [model, setModel] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploads, setUploads] = useState([]); // { id, name, progress, abort, error }
  const [refusal, setRefusal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const providerState = hub?.providers?.find((p) => p.id === provider);
  // Model/effort choices with their source: Codex from model/list (verified), Claude aliases labelled unverified.
  // `options.effort` is the stored choice only when this provider/model offers it; otherwise nothing is sent.
  const options = composerOptions({ provider, providerState, model, effort });
  const models = options.models;
  const buildSafe = hub?.mode === "BUILD_SAFE";

  useEffect(() => {
    const voice = sessionStorage.getItem("hub.v2.voiceDraft");
    if (voice) { setDraft((d) => (d ? `${d}\n${voice}` : voice)); sessionStorage.removeItem("hub.v2.voiceDraft"); }
  }, [setDraft]);
  useEffect(() => { setModel(""); }, [provider]);

  const addFiles = (files) => {
    for (const file of files) {
      const verdict = validateAttachment({ name: file.name, size: file.size, type: file.type });
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (!verdict.ok) { setUploads((u) => [...u, { id, name: file.name, progress: 0, error: verdict.reason }]); continue; }
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      readAsBase64(file).then((base64) => {
        const { promise, abort } = uploadWithProgress(`/api/conversations/${conversation.id}/attachments`, { filename: file.name, mime: verdict.mime, base64 },
          (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, abort } : x)));
        return promise;
      }).then((saved) => {
        setAttachments((a) => [...a, saved]);
        setUploads((u) => u.filter((x) => x.id !== id));
      }).catch((error) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: error.name === "AbortError" ? "Anulat" : error.message, abort: null } : x))));
    }
  };

  const send = useAction(async (andRun) => {
    setRefusal(null); setPreview(null);
    const content = draft.trim();
    if (content) {
      await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: { content, clientMessageId: `${conversation.id}:${Date.now()}`, attachmentIds: attachments.map((a) => a.id) } });
      setDraft(""); setAttachments([]);
    }
    if (andRun) {
      if (buildSafe) {
        // BUILD_SAFE: show exactly what would block the run instead of attempting it.
        setPreview(await api(`/api/gate/preview?provider=${provider}&access=${access}&projectId=${project.id}`));
      } else {
        try {
          await api(`/api/conversations/${conversation.id}/runs`, { method: "POST", body: { provider, access, ...(model ? { model } : {}), ...(options.effort ? { effort: options.effort } : {}), ...(conversation.activeTaskId ? { taskId: conversation.activeTaskId } : {}) } });
        } catch (error) {
          if (error.category === "gate") setRefusal(error.details?.checks || [{ id: "gate", ok: false, detail: error.message }]);
          else throw error;
        }
      }
    }
    onSent?.();
  });
  const checkGate = useAction(async () => setPreview(await api(`/api/gate/preview?provider=${provider}&access=${access}&projectId=${project.id}`)));

  const busyUploads = uploads.some((u) => u.abort && !u.error);
  return (
    <div className={`composer m02 ${dragOver ? "drag" : ""}${optsOpen ? " opts-open" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles([...(e.dataTransfer?.files || [])]); }}>
      <div className="composer-context" aria-label="Context și rută">
        <Chip tone="neutral" icon={FileText}>{project?.name}</Chip>
        <Chip tone={providerState?.route?.allowed ? "ok" : "warn"} icon={providerState?.route?.allowed ? ShieldCheck : Lock} title={(providerState?.route?.blockingReasons || []).join("\n")}>
          {provider === "codex" ? "Codex" : "Claude Code"} · {providerState?.route?.allowed ? "rută de abonament verificată" : "rută neverificată"}
        </Chip>
        <Chip tone={access === "read-only" ? "info" : "warn"} title="Unelte cerute">{TOOLS_BY_ACCESS[access][provider]}</Chip>
        <span className="context-sep" aria-hidden="true" />
        <span className="faint small">Context:</span>
        <Chip icon={History} title="Mesajele acestei conversații, construite de Hub">conversația</Chip>
        {conversation.activeMissionId && <Chip icon={Target} title="Misiunea și taskul legat">misiunea</Chip>}
        {handoffReady && <Chip tone="ok" icon={ArrowRightLeft} title="Pachetul de handoff pregătit se include la primul turn al țintei">pachet handoff</Chip>}
        {attachments.map((a) => (
          <span key={a.id} className="attachment"><Paperclip size={12} />{a.filename} · {fmt.bytes(a.size)}
            <button className="btn sm icon ghost" aria-label={`Elimină ${a.filename} din context`} onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}><X size={12} /></button></span>
        ))}
      </div>
      {uploads.length > 0 && (
        <ul className="uploads" aria-label="Încărcări">
          {uploads.map((u) => (
            <li key={u.id} className={u.error ? "error" : ""}>
              <span className="ellipsis">{u.name}</span>
              {u.error ? <span className="small">{u.error}</span> : <progress max="1" value={u.progress} aria-label={`Încărcare ${u.name}`} />}
              {u.abort && !u.error ? <button className="btn sm ghost" onClick={() => u.abort()}>Anulează</button> : <button className="btn sm icon ghost" aria-label="Ascunde" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}><X size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor="composer-text">Mesaj</label>
      <textarea id="composer-text" className="textarea" data-lega-target="focus-composer" value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder={buildSafe ? "Scrie și salvează. În BUILD_SAFE nu pornește niciun model; ciorna rămâne locală până o trimiți." : "Scrie cererea. Ciorna se păstrează local până o trimiți."}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send.run(false); } }} />
      <div className="composer-bar">
        <input type="file" ref={fileRef} hidden multiple onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = ""; }} accept=".txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp,.pdf,.log" />
        <button className="btn sm icon ghost" onClick={() => fileRef.current?.click()} aria-label="Atașează fișiere (sau trage-le aici)"><Paperclip size={16} /></button>
        <button className="btn sm ghost composer-opt-toggle" aria-expanded={optsOpen} aria-controls="composer-options" onClick={() => setOptsOpen((v) => !v)}>
          {PROVIDERS.find((p) => p.id === provider)?.label} · {access === "read-only" ? "doar citire" : "scriere"}{model ? ` · ${model}` : ""}
        </button>
        <div className="seg composer-opt" id="composer-options" role="group" aria-label="Provider">{PROVIDERS.map((p) => <button key={p.id} aria-pressed={provider === p.id} onClick={() => setProvider(p.id)}>{p.label}</button>)}</div>
        <div className="seg composer-opt" role="group" aria-label="Acces">
          <button aria-pressed={access === "read-only"} onClick={() => setAccess("read-only")}>Doar citire</button>
          <button aria-pressed={access === "workspace-write"} onClick={() => setAccess("workspace-write")}>Scriere</button>
        </div>
        <select className="select compact composer-opt" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" title={options.modelNote}>
          <option value="">{options.modelSource === "unread" ? "Model implicit (listă necitită)" : options.modelSource === "unverified" ? "Model implicit (CLI)" : "Model implicit"}</option>
          {(models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select className="select compact composer-opt" value={options.effort} onChange={(e) => setEffort(e.target.value)} aria-label="Efort" title={options.effortNote}
          disabled={!options.efforts.length}>
          <option value="">{options.effortSource === "unsupported" ? "efort indisponibil" : "efort: profil Echilibrat (medium, trimis explicit)"}</option>
          {options.efforts.map((x) => <option key={x} value={x}>{options.effortSource === "verified" ? `efort ${x}` : `efort ${x} (nevalidat)`}</option>)}
        </select>
        <div className="grow" />
        <button className="btn sm ghost composer-opt" onClick={checkGate.run} disabled={checkGate.pending}><ShieldCheck size={14} />Verifică poarta</button>
        <button className="btn sm" onClick={() => send.run(false)} disabled={send.pending || busyUploads || !draft.trim()}><Send size={14} />Trimite<span className="kbd hide-mobile">Ctrl ↵</span></button>
        <button className={`btn sm ${buildSafe ? "" : "primary"}`} onClick={() => send.run(true)} disabled={send.pending || busyUploads}
          title={buildSafe ? "BUILD_SAFE: arată verificările porții; nu pornește niciun model" : "Trece prin poarta de execuție"}>
          {buildSafe ? <Lock size={14} /> : <Play size={14} />}{buildSafe ? "Rulează · necesită autorizare" : draft.trim() ? "Trimite și rulează" : "Rulează"}
        </button>
      </div>
      <ErrorNotice error={send.error || checkGate.error} />
      {refusal && <Notice tone="warn" title="Poarta a refuzat execuția; modelul nu a fost pornit"><Checks checks={refusal} /></Notice>}
      {preview && !refusal && (
        <Notice tone={preview.allowed ? "info" : "warn"} title={preview.allowed ? "Poarta ar admite execuția" : buildSafe ? "Execuția necesită autorizare (BUILD_SAFE)" : "Poarta ar refuza execuția"}>
          <Checks checks={preview.checks} /><button className="btn sm ghost" onClick={() => setPreview(null)}>Ascunde</button>
        </Notice>
      )}
      {dragOver && <div className="drop-hint" aria-hidden="true">Eliberează pentru a atașa (se verifică tipul și dimensiunea; nimic nu pleacă la un provider)</div>}
    </div>
  );
}
