import { useState } from "react";
import { MonitorCog, Search, ShieldCheck, ShieldOff, FolderOpen, ListChecks, History, Play, Square, Hand } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, pushToast, refresh } from "../store.js";
import { Panel, Chip, Notice, ErrorNotice, Loading, Empty } from "../components/ui.jsx";
import { withReauth } from "../lib/ownerSession.js";
import { APP_STATE_LABELS, LEVEL_LABELS, PLAN_STATUS_LABELS, planTone } from "../lib/opsLogic.js";
import { OpsPlanCard } from "./lega/OpsPlanCard.jsx";

/**
 * M10 Desktop Operator page: which applications the operator knows (found → signed → authorized, never merged), what each operation
 * is verified to do, the import folders, the plans and the last actions (targets and results, never document contents). Authorizing an
 * app asks Windows Hello again; revoking, Stop and „Preiau eu” always work. Day-to-day you do not need this page: say it to Lega.
 */
export default function DesktopScreen() {
  const status = useResource("/api/desktop/status", { reloadOn: (e) => e.type.startsWith("desktop.") || e.type.startsWith("ops.") });
  const actions = useResource("/api/desktop/actions?limit=40", { reloadOn: (e) => e.type.startsWith("desktop.") });
  const folders = useResource("/api/media/import-folders", { reloadOn: (e) => e.type.startsWith("media.import") || e.type === "settings.changed" });
  const plans = useResource("/api/ops/plans?limit=12", { reloadOn: (e) => e.type.startsWith("ops.") });
  const [openPlan, setOpenPlan] = useState(null);
  const discover = useAction(async () => { const r = await withReauth(() => api("/api/desktop/apps/discover", { method: "POST", body: {} })); pushToast("desk-discover", "ok", `Căutare făcută: ${r.filter((a) => a.status !== "NOT_FOUND").length} aplicații găsite`); status.reload(); });
  const authorize = useAction(async (id) => { await withReauth(() => api("/api/desktop/apps/authorize", { method: "POST", body: { apps: [id] } })); status.reload(); refresh(); });
  const revoke = useAction(async (id) => { await api("/api/desktop/apps/revoke", { method: "POST", body: { apps: [id], reason: "retras din pagina Operator" } }); status.reload(); });
  const stop = useAction(async (path) => { await api(path, { method: "POST", body: { reason: "pagina Operator" } }); status.reload(); });
  const revokeFolder = useAction(async (id) => { await api(`/api/media/import-folders/${id}/revoke`, { method: "POST", body: {} }); folders.reload(); });
  const s = status.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1><MonitorCog size={20} aria-hidden="true" /> Operator desktop</h1>
        <p>Lega deschide aplicațiile autorizate, le aduce în față, arată folderele aprobate și execută pașii unui plan confirmat — observă, acționează, verifică. Spune-i simplu: „Deschide CapCut”, „Arată folderul exporturilor”, „Importă din folderul acesta”.</p></div>
        <div className="row">
          <button className="btn danger sm" onClick={() => stop.run("/api/desktop/stop")}><Square size={12} fill="currentColor" aria-hidden="true" />Stop</button>
          <button className="btn sm" onClick={() => stop.run("/api/desktop/takeover")}><Hand size={13} aria-hidden="true" />Preiau eu</button>
        </div>
      </div>
      <ErrorNotice error={status.error || discover.error || authorize.error || revoke.error || stop.error} />
      {status.loading && !s ? <Loading lines={4} /> : s && (
        <>
          <Panel title="Helper" icon={MonitorCog} id="desk-helper">
            <div className="row wrap">
              <Chip tone={s.helper.running ? "ok" : "neutral"}>{s.helper.running ? `rulează (pid ${s.helper.pid})` : "oprit (pornește la prima comandă)"}</Chip>
              {s.session && <Chip tone={s.session.status === "PAUSED" ? "warn" : "info"}>sesiune {s.session.status === "PAUSED" ? `pe pauză: ${s.session.endReason || ""}` : "activă"}</Chip>}
              {s.helper.lastError && <Chip tone="warn" title={s.helper.lastError}>ultima eroare</Chip>}
            </div>
            <p className="faint small">Helperul rulează ca utilizatorul tău (fără administrator), primește doar comenzi semnate de Hub, refuză aplicațiile protejate (parole, consolă, dialoguri de sistem) și se oprește la tastatura sau mouse-ul tău. Folderul exporturilor: <span className="mono">{s.exportsDir || "—"}</span></p>
          </Panel>
          <Panel title="Aplicații" icon={ShieldCheck} id="desk-apps" actions={<button className="btn sm" disabled={discover.pending} onClick={() => discover.run()}><Search size={13} aria-hidden="true" />{discover.pending ? "Caut…" : "Caută aplicațiile"}</button>}>
            <div className="op-apps">
              {s.apps.map((a) => (
                <div key={a.id} className="op-app">
                  <div>
                    <strong>{a.name}</strong> {a.version && <span className="faint small">{a.version}</span>} <Chip tone={a.status === "AUTHORIZED_SCOPE" ? "ok" : a.status === "DISCOVERED" ? "attention" : a.status === "INSTALLED" ? "warn" : "neutral"}>{APP_STATE_LABELS[a.status] || a.status}</Chip>
                    <div className="op-caps">{Object.entries(a.capabilities || {}).map(([op, level]) => <Chip key={op} tone={/^VERIFIED/.test(level) ? "ok" : /BLOCKED|UNSUPPORTED/.test(level) ? "warn" : "neutral"} title={LEVEL_LABELS[level] || level}>{op}: {LEVEL_LABELS[level] || level}</Chip>)}</div>
                  </div>
                  <div className="row">
                    {a.status === "DISCOVERED" && <button className="btn sm approve" disabled={authorize.pending} onClick={() => authorize.run(a.id)}><ShieldCheck size={13} aria-hidden="true" />Autorizează (Windows Hello)</button>}
                    {a.status === "AUTHORIZED_SCOPE" && <button className="btn sm ghost" disabled={revoke.pending} onClick={() => revoke.run(a.id)}><ShieldOff size={13} aria-hidden="true" />Retrage</button>}
                  </div>
                </div>
              ))}
            </div>
            <p className="faint small">„Găsită și semnată” = executabilul din sursele standard (App Paths, Start, folderul aplicației), semnat de editorul așteptat. Autorizarea se face o dată; un binar schimbat (actualizare) trebuie autorizat din nou.</p>
          </Panel>
        </>
      )}
      {s && <ObsPanel status={s} reload={status.reload} />}
      <Panel title="Planuri" icon={ListChecks} id="desk-plans">
        {plans.loading && !plans.data ? <Loading lines={2} /> : !(plans.data?.plans || []).length ? <Empty title="Niciun plan încă">Spune-i Lega ce vrei; un plan apare ca un card cu o singură confirmare.</Empty> : (
          <ul className="plain">{plans.data.plans.map((p) => (
            <li key={p.id} className="row wrap between"><span><button className="btn sm ghost" onClick={() => setOpenPlan(p)}>{p.title}</button> <span className="faint small">{fmt.ago(p.createdAt)}</span></span>
              <Chip tone={planTone(p.status)}>{PLAN_STATUS_LABELS[p.status] || p.status}</Chip></li>
          ))}</ul>
        )}
        {openPlan && <OpsPlanCard plan={openPlan} card={{ type: "OpsPlan", size: "l" }} onClose={() => setOpenPlan(null)} />}
      </Panel>
      <Panel title="Foldere de import" icon={FolderOpen} id="desk-folders">
        <p className="small">Aprobate acum: {(folders.data?.roots || []).map((r) => <span key={r} className="mono chip neutral">{r}</span>)}</p>
        {(folders.data?.grants || []).filter((g) => g.status === "ACTIVE").map((g) => (
          <div key={g.id} className="row wrap between"><span className="mono small">{g.folder}</span><span className="row"><Chip tone="neutral">{g.mode === "once" ? `o dată, până la ${fmt.dateTime(g.expiresAt)}` : "permanent"}</Chip>
            <button className="btn sm ghost" onClick={() => revokeFolder.run(g.id)}>Retrage</button></span></div>
        ))}
        <p className="faint small">„Importă din folderul acesta” îți arată folderul și ce s-ar citi (nume, tipuri, mărimi) și îți cere o singură dată accesul pentru acel import. Discul întreg, profilul, Desktop-ul și datele Hub-ului nu devin foldere permanente.</p>
      </Panel>
      <Panel title="Ultimele acțiuni" icon={History} id="desk-actions">
        {!(actions.data?.actions || []).length ? <p className="faint small">Nicio acțiune încă.</p> : (
          <table className="op-actions"><thead><tr><th>Când</th><th>Operație</th><th>Aplicație</th><th>Clasă</th><th>Rezultat</th></tr></thead>
            <tbody>{actions.data.actions.map((a) => <tr key={a.id}><td>{fmt.ago(a.at)}</td><td className="mono">{a.op}</td><td>{a.app || "—"}</td><td>{a.class}</td><td><Chip tone={a.status === "DONE" ? "ok" : a.status === "SUSPENDED" ? "warn" : a.status === "REFUSED" ? "neutral" : "error"}>{a.status}</Chip>{a.error && <span className="faint block">{a.error}</span>}</td></tr>)}</tbody></table>
        )}
      </Panel>
      {s?.session?.status === "PAUSED" && <Notice tone="warn" title="Operatorul așteaptă">Verifică aplicația; apoi spune „Continuă” sau apasă <button className="btn sm primary" onClick={() => withReauth(() => api("/api/desktop/resume", { method: "POST", body: {} })).then(() => status.reload()).catch((e) => pushToast("desk-resume", "error", e.message))}><Play size={12} aria-hidden="true" />Continuă</button></Notice>}
    </div>
  );
}

/** OBS for the Hub's capture steps: the recordings folder and the local WebSocket address (never the password, never the network). */
function ObsPanel({ status, reload }) {
  const [root, setRoot] = useState(status.obs?.recordingRoot || "");
  const [url, setUrl] = useState(status.obs?.url || "ws://127.0.0.1:4455");
  const [scene, setScene] = useState(status.obs?.scene || "");
  const save = useAction(async () => { await withReauth(() => api("/api/media/policy/obs", { method: "POST", body: { recordingRoot: root.trim(), url: url.trim(), scene: scene.trim() || undefined } })); pushToast("desk-obs", "ok", "Configurarea OBS a fost salvată (fără parolă)"); reload(); });
  return (
    <Panel title="OBS (captură)" icon={MonitorCog} id="desk-obs">
      <div className="row wrap"><Chip tone={status.liveCapture ? "ok" : "neutral"}>{status.liveCapture ? "captura live permisă (MB1)" : "captura live oprită — decizia MB1"}</Chip>
        {status.obs && <Chip tone="neutral">înregistrări: {status.obs.recordingRoot}</Chip>}</div>
      <form className="studio-form inline" onSubmit={(e) => { e.preventDefault(); if (root.trim()) save.run(); }}>
        <label className="field grow"><span>Folderul înregistrărilor OBS (Settings → Output → Recording Path)</span><input className="input mono" value={root} onChange={(e) => setRoot(e.target.value)} /></label>
        <label className="field"><span>Adresa locală</span><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="field"><span>Scena dedicată (opțional, trebuie să existe)</span><input className="input" value={scene} onChange={(e) => setScene(e.target.value)} /></label>
        <button className="btn" type="submit" disabled={save.pending || !root.trim()}>{save.pending ? "Salvez…" : "Salvează (Windows Hello)"}</button>
      </form>
      <ErrorNotice error={save.error} />
      <p className="faint small">Parola OBS WebSocket nu se salvează: o scrii în cardul planului, la confirmare, și rămâne în memorie cât rulează planul. Hub-ul se conectează la OBS doar într-un plan confirmat, doar local.</p>
    </Panel>
  );
}
