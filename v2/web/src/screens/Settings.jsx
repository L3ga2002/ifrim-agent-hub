import { useEffect, useState } from "react";
import { Settings as Cog, Mic, Database, HardDrive, Monitor } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref, refresh } from "../store.js";
import { Panel, Loading, ErrorNotice, Notice, StatusChip, Chip } from "../components/ui.jsx";
import { detectSpeechEngine, speak, LOCAL_STT_STEPS } from "../shell/Voice.jsx";

function VoiceSettings({ settings, onSaved }) {
  const [voice, setVoice] = useState(settings.voice);
  const [voices, setVoices] = useState([]);
  const [devices, setDevices] = useState([]);
  const [engine, setEngine] = useState(null);
  const save = useAction(async (next) => { await api("/api/settings", { method: "PATCH", body: { voice: next } }); setVoice(next); onSaved(); refresh(); });
  useEffect(() => {
    detectSpeechEngine(voice.language).then(setEngine);
    const load = () => setVoices((window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().startsWith("ro") || v.lang?.toLowerCase().startsWith("en")));
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    navigator.mediaDevices?.enumerateDevices?.().then((list) => setDevices(list.filter((d) => d.kind === "audioinput"))).catch(() => {});
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, [voice.language]);
  const roVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("ro"));
  return (
    <Panel title="Voce" icon={Mic}>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={voice.enabled} onChange={(e) => save.run({ ...voice, enabled: e.target.checked })} />Activează microfonul (push-to-talk)</label>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>Dezactivat implicit. Wake word: neimplementat, rămâne oprit. Audio-ul nu este arhivat de Hub.</p>
        <label className="check"><input type="checkbox" checked={voice.strictLocal !== false} onChange={(e) => save.run({ ...voice, strictLocal: e.target.checked })} />Mod local strict: nu folosi servicii de recunoaștere care trimit audio online</label>
        <dl className="kv">
          <dt>Recunoaștere</dt><dd>{engine ? engine.label : "…"}{engine && voice.strictLocal !== false && !engine.local ? " — NEEDS_SETUP în mod local strict" : ""}</dd>
          <dt>Sinteză</dt><dd>{roVoices.length ? `${roVoices.length} voci românești (${roVoices.filter((v) => v.localService).length} locale)` : "Nicio voce românească instalată; se pot folosi voci engleze sau instala pachetul de limbă Windows."}</dd>
        </dl>
        {devices.length > 0 && (
          <label className="field"><span>Microfon</span>
            <select className="select" value={voice.deviceId || ""} onChange={(e) => save.run({ ...voice, deviceId: e.target.value })}>
              <option value="">Implicit</option>{devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microfon (permisiune necesară pentru nume)"}</option>)}
            </select>
          </label>
        )}
        <label className="check"><input type="checkbox" checked={voice.ttsEnabled} onChange={(e) => save.run({ ...voice, ttsEnabled: e.target.checked })} />Răspunsuri vocale scurte pentru comenzile locale</label>
        {voice.ttsEnabled && (
          <label className="field"><span>Voce</span>
            <select className="select" value={voice.voiceURI} onChange={(e) => save.run({ ...voice, voiceURI: e.target.value })}>
              <option value="">Implicită sistem</option>{voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang} · {v.localService ? "locală" : "online"}</option>)}
            </select>
          </label>
        )}
        {voice.ttsEnabled && (
          <div className="grid two">
            <label className="field"><span>Viteză ({Number(voice.rate ?? 1).toFixed(1)})</span><input type="range" min="0.5" max="2" step="0.1" value={voice.rate ?? 1} onChange={(e) => setVoice({ ...voice, rate: Number(e.target.value) })} onMouseUp={() => save.run(voice)} onKeyUp={() => save.run(voice)} /></label>
            <label className="field"><span>Volum ({Math.round((voice.volume ?? 1) * 100)}%)</span><input type="range" min="0" max="1" step="0.05" value={voice.volume ?? 1} onChange={(e) => setVoice({ ...voice, volume: Number(e.target.value) })} onMouseUp={() => save.run(voice)} onKeyUp={() => save.run(voice)} /></label>
          </div>
        )}
        {voice.ttsEnabled && <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => speak("Sistemul este pregătit. Nicio execuție nu este activă.", { voiceURI: voice.voiceURI, rate: voice.rate ?? 1, volume: voice.volume ?? 1 })}>Testează vocea</button>}
        {engine && voice.strictLocal !== false && !engine.local && (
          <Notice tone="warn" title="Recunoaștere vocală: NEEDS_SETUP (mod local strict)"><ol className="plain-list small">{LOCAL_STT_STEPS.map((x) => <li key={x}>{x}</li>)}</ol></Notice>
        )}
        <p className="faint small" style={{ margin: 0 }}>Vocea citește doar rezumate scurte existente; nu citește cod, loguri, tokenuri sau secrete. Rezumarea nouă printr-un model cere autorizarea de inferență.</p>
        <ErrorNotice error={save.error} />
      </div>
    </Panel>
  );
}

function GeneralSettings({ settings, onSaved }) {
  const [reserve, setReserve] = useState(settings.usageReservePercent);
  const [core3d, setCore3d] = usePref("core3d", true);
  const save = useAction(async () => { await api("/api/settings", { method: "PATCH", body: { usageReservePercent: Number(reserve) } }); onSaved(); });
  return (
    <Panel title="General" icon={Cog}>
      <div className="stack">
        <label className="field"><span>Rezervă de allowance pentru munca interactivă (%)</span>
          <div className="row"><input className="input" type="number" min={5} max={80} value={reserve} onChange={(e) => setReserve(e.target.value)} style={{ width: 120 }} /><button className="btn sm" onClick={save.run} disabled={save.pending}>Salvează</button></div>
        </label>
        <label className="check"><input type="checkbox" checked={core3d} onChange={(e) => setCore3d(e.target.checked)} /><Monitor size={14} />Nucleu animat (WebGL; dezactivează pentru performanță sau focus)</label>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>Mișcarea respectă setarea sistemului „reduce motion”. Concurență AI: maximum {settings.maxConcurrentAiRuns} execuții.</p>
        <ErrorNotice error={save.error} />
      </div>
    </Panel>
  );
}

function LegacyData() {
  const { data, error, loading, reload } = useResource("/api/legacy", { reloadOn: (e) => e.type.startsWith("legacy.") });
  const [plan, setPlan] = useState(null);
  const snapshot = useAction(async () => { const s = await api("/api/legacy/snapshot", { method: "POST", body: {} }); reload(); return s; });
  const planAction = useAction(async (snapshotPath) => setPlan(await api("/api/legacy/plan", { method: "POST", body: { snapshotPath } })));
  const apply = useAction(async () => { await api("/api/legacy/apply", { method: "POST", body: { snapshotPath: plan.source, sha256: plan.sourceSha256 } }); setPlan(null); reload(); refresh(); });
  const revert = useAction(async (batchId) => { await api("/api/legacy/revert", { method: "POST", body: { batchId } }); reload(); refresh(); });
  if (loading) return <Panel title="Date V1"><Loading /></Panel>;
  return (
    <Panel title="Date V1 (migrare versionată)" icon={Database}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Baza V1 nu este modificată. Importul citește un snapshot consistent, arată planul (dry-run), aplică doar planul revizuit și poate fi anulat pe lot.</p>
        {error && <ErrorNotice error={error} onRetry={reload} />}
        {data?.import && <Notice tone="info" title="Import aplicat">{fmt.dateTime(data.import.importedAt)} · {Object.entries(data.import.created || {}).map(([k, v]) => `${v} ${k}`).join(", ")}</Notice>}
        <div className="row wrap">
          <button className="btn sm" disabled={snapshot.pending} onClick={snapshot.run}>Snapshot nou din V1</button>
          {data?.snapshots?.[0] && <button className="btn sm primary" disabled={planAction.pending} onClick={() => planAction.run(data.snapshots[0])}>Dry-run pe cel mai recent snapshot</button>}
        </div>
        {plan && (
          <div className="stack tight">
            <div className="section-title">Plan (nimic scris încă)</div>
            <dl className="kv">
              <dt>Sursă</dt><dd className="mono">{plan.source.split(/[\\/]/).pop()} · {plan.sourceSha256.slice(0, 12)}</dd>
              <dt>Tabele importate</dt><dd>{plan.imported.map((t) => `${t} (${plan.counts[t]})`).join(", ")}</dd>
              <dt>Doar referință</dt><dd>{plan.keptAsReference.map((t) => `${t} (${plan.counts[t]})`).join(", ")}</dd>
              <dt>Lock-uri V1 active</dt><dd>{plan.activeV1Locks.length ? plan.activeV1Locks.map((l) => `${l.id} (${l.scope}, ${l.owner})`).join(", ") : "niciunul"}</dd>
              <dt>Taskuri deschise</dt><dd>{plan.openTasks.map((t) => `${t.title} [${t.status} → ${t.mappedTo}]`).join("; ") || "niciunul"}</dd>
            </dl>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{plan.rules.map((r) => <li key={r} className="muted">{r}</li>)}</ul>
            <div className="row"><button className="btn sm primary" disabled={apply.pending} onClick={apply.run}>Aplică exact acest plan</button><button className="btn sm ghost" onClick={() => setPlan(null)}>Renunță</button></div>
          </div>
        )}
        {data?.batches?.length > 0 && (
          <ul className="list">{data.batches.map((b) => (
            <li key={b.id}><div className="list-row"><div className="grow"><div className="title mono">{b.id}</div><div className="sub">{fmt.dateTime(b.created_at)} · {b.source_sha256.slice(0, 12)}</div></div><StatusChip status={b.status === "applied" ? "verified" : b.status} label={b.status} />{b.status === "applied" && <button className="btn sm ghost" disabled={revert.pending} onClick={() => { if (window.confirm("Anulezi importul? Se șterg doar rândurile create de acest lot.")) revert.run(b.id); }}>Anulează lotul</button>}</div></li>
          ))}</ul>
        )}
        <ErrorNotice error={snapshot.error || planAction.error || apply.error || revert.error} />
      </div>
    </Panel>
  );
}

function Backups() {
  const { data, loading, reload } = useResource("/api/backups", { reloadOn: (e) => e.type.startsWith("backup.") });
  const run = useAction(async () => { await api("/api/backups", { method: "POST", body: { projectId: "ifrim-agent-hub" } }); reload(); });
  return (
    <Panel title="Backup și restaurare" icon={HardDrive}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Arhivă ZIP cu hash SHA-256 per fișier, snapshot-uri SQLite prin API-ul oficial de backup și restaurare de test într-un director privat, fără provideri.</p>
        <button className="btn sm primary" style={{ alignSelf: "flex-start" }} disabled={run.pending} onClick={run.run}>{run.pending ? "Backup + verificare restaurare…" : "Backup verificat acum"}</button>
        {loading ? <Loading /> : (data?.backups || []).filter((b) => !b.legacyId).slice(0, 5).map((b) => (
          <div key={b.id} className="row wrap"><StatusChip status={b.status} /><span>{fmt.dateTime(b.createdAt)}</span><span className="muted">{b.fileCount} fișiere · {fmt.bytes(b.archiveBytes)} · {(b.durationMs / 1000).toFixed(1)} s</span>{b.databases?.map((d) => <Chip key={d.label}>{d.label}: {d.integrity}</Chip>)}</div>
        ))}
        <ErrorNotice error={run.error} />
      </div>
    </Panel>
  );
}

export default function Settings() {
  const { data, error, loading, reload } = useResource("/api/settings", { reloadOn: (e) => e.type === "settings.changed" });
  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Setări</h1><p>Securitate, voce, backup și date. Autentificarea rămâne în fluxurile oficiale ale clienților Codex și Claude; Hub-ul nu stochează credențiale.</p></div></div>
      <div className="grid two">
        <GeneralSettings settings={data.settings} onSaved={reload} />
        <VoiceSettings settings={data.settings} onSaved={reload} />
        <Backups />
        <LegacyData />
      </div>
    </div>
  );
}
