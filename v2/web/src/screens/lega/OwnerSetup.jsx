import { useState } from "react";
import { Fingerprint, KeyRound, ShieldCheck, Mic2, Trash2, Lock, LockOpen, ExternalLink, Gauge } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, pushToast } from "../../store.js";
import { Panel, Notice, ErrorNotice, Chip, Loading } from "../../components/ui.jsx";
import { webauthnAvailable, onLocalhost, localhostUrl, registerAuthenticator, unlockSession, lockSession, withReauth } from "../../lib/ownerSession.js";
import { recordSample, ENROLL_SENTENCES } from "../../lib/voiceGate.js";

/**
 * The one-time setup of Lega 2.0, as ONE page of contextual steps (not ten menus): this computer's authenticator, the
 * voice-first policy (exact text, fresh re-authentication), autonomy per project and the local voice profile. Each step says
 * what it changes and how to undo it.
 */
export function OwnerSetup({ owner, reload }) {
  const [setupText, setSetupText] = useState("");
  const [policyText, setPolicyText] = useState("");
  const register = useAction(async () => { await registerAuthenticator({ setupText }); setSetupText(""); await unlockSession("after-register"); pushToast("owner-reg", "ok", "Autentificatorul a fost înregistrat; sesiunea e deschisă"); reload(); });
  const addAnother = useAction(async () => { await withReauth(() => registerAuthenticator({})); pushToast("owner-reg2", "ok", "Autentificator adăugat"); reload(); });
  const unlock = useAction(async () => { await unlockSession(); reload(); });
  const lock = useAction(async () => { await lockSession(); reload(); });
  const activate = useAction(async () => { await withReauth(() => api("/api/owner/policy/activate", { method: "POST", body: { text: policyText } })); setPolicyText(""); pushToast("owner-pol", "ok", "Politica voice-first este activă"); reload(); });
  const deactivate = useAction(async () => { await api("/api/owner/policy/deactivate", { method: "POST", body: { reason: "din configurare" } }); reload(); });
  const revokeCred = useAction(async (id) => { await withReauth(() => api(`/api/owner/credentials/${encodeURIComponent(id)}/revoke`, { method: "POST", body: {} })); reload(); });
  if (!owner) return <Loading lines={4} />;
  const port = owner.webauthnOrigin?.split(":").pop();
  if (!onLocalhost()) {
    return (
      <Panel title="Sesiunea de proprietar" icon={Fingerprint}>
        <Notice tone="warn" title="Deschide Hub-ul pe localhost">WebAuthn (Windows Hello / cheia ta) nu acceptă o adresă IP ca identitate a site-ului. Același Hub, la <a href={localhostUrl(port)}>{owner.webauthnOrigin}</a>.</Notice>
      </Panel>
    );
  }
  return (
    <div className="stack">
      <Panel title="1 · Autentificatorul tău" icon={Fingerprint} actions={owner.session ? <Chip tone="ok" icon={LockOpen}>sesiune deschisă până la {fmt.time(owner.session.expiresAt)}</Chip> : <Chip tone="neutral" icon={Lock}>sesiune blocată</Chip>}>
        {!webauthnAvailable() && <Notice tone="error" title="Browserul nu are WebAuthn">Folosește Edge sau Chrome pe Windows.</Notice>}
        {owner.bootstrapNeeded ? (
          <div className="stack tight">
            <p className="small">Windows îți cere PIN-ul, amprenta sau fața (Windows Hello) sau o cheie de securitate. Hub-ul păstrează doar cheia publică; nici vocea, nici un cod din pagină nu te autentifică.</p>
            <pre className="pre small">{owner.setupText}</pre>
            <textarea className="textarea" rows={2} value={setupText} onChange={(e) => setSetupText(e.target.value)} aria-label="Textul de configurare" />
            <button className="btn primary" disabled={setupText !== owner.setupText || register.pending} onClick={register.run}><KeyRound size={15} />{register.pending ? "Aștept Windows Hello…" : "Înregistrează acest calculator"}</button>
            <ErrorNotice error={register.error} />
          </div>
        ) : (
          <div className="stack tight">
            <ul className="plain small">{owner.credentials.map((c) => <li key={c.id} className="row between"><span>{c.label} <span className="faint mono">{c.short}</span> · înregistrat {fmt.dateTime(c.createdAt)}{c.lastUsedAt ? ` · folosit ${fmt.ago(c.lastUsedAt)}` : ""}</span>
              <button className="btn sm ghost" disabled={revokeCred.pending} onClick={() => revokeCred.run(c.id)}><Trash2 size={13} />Revocă</button></li>)}</ul>
            <div className="row wrap">
              {owner.session ? <button className="btn sm" disabled={lock.pending} onClick={lock.run}><Lock size={13} />Blochează sesiunea</button> : <button className="btn sm primary" disabled={unlock.pending} onClick={unlock.run}><LockOpen size={13} />{unlock.pending ? "Aștept Windows Hello…" : "Deblochează"}</button>}
              <button className="btn sm ghost" disabled={addAnother.pending} onClick={addAnother.run}><KeyRound size={13} />Adaugă un autentificator (cere reautentificare)</button>
            </div>
            <ErrorNotice error={unlock.error || lock.error || addAnother.error || revokeCred.error} />
            <p className="faint small">Sesiunea expiră după {owner.defaults.maxHours} h, se închide după {owner.defaults.idleMinutes} min fără activitate; pașii sensibili (politica, autonomie mai mare, autentificatoare) cer o verificare mai nouă de {owner.defaults.reauthMinutes} min.</p>
          </div>
        )}
      </Panel>

      <Panel title="2 · Politica voice-first" icon={ShieldCheck} actions={<Chip tone={owner.policy.active ? "ok" : "neutral"}>{owner.policy.active ? `activă (v${owner.policy.version})` : "legacy (implicit)"}</Chip>}>
        {owner.policy.active ? (
          <div className="stack tight">
            <p className="small">Confirmi o singură dată planul exact al unei misiuni, în sesiunea ta; Hub-ul derivă intern granturile. Deploy, bani, acces, instalări, ștergeri și trimiteri externe rămân în afara oricărui plan.</p>
            <button className="btn sm danger" disabled={deactivate.pending} onClick={deactivate.run}>Revino la politica legacy</button>
          </div>
        ) : (
          <div className="stack tight">
            <p className="small">Acum fiecare efect cere clicul tău în Aprobări (ca în M01–M05). Activarea cere sesiunea deschisă recent și textul exact; aprobările vechi nu se rescriu.</p>
            <pre className="pre small">{owner.policyText}</pre>
            <textarea className="textarea" rows={3} value={policyText} onChange={(e) => setPolicyText(e.target.value)} aria-label="Textul politicii" />
            <button className="btn approve" disabled={policyText !== owner.policyText || owner.bootstrapNeeded || activate.pending} onClick={activate.run}><ShieldCheck size={15} />Activez politica (cu Windows Hello)</button>
            <ErrorNotice error={activate.error || deactivate.error} />
          </div>
        )}
      </Panel>

      <AutonomyPanel owner={owner} />
      <VoicePanel owner={owner} />
    </div>
  );
}

function AutonomyPanel({ owner }) {
  const projects = useResource("/api/projects", { reloadOn: (e) => e.type === "settings.changed" || e.type.startsWith("project.") });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const set = async (projectId, level) => {
    setBusy(projectId); setError(null);
    try { await withReauth(() => api("/api/owner/autonomy", { method: "POST", body: { projectId, level } })); projects.reload(); }
    catch (e) { setError(e); } finally { setBusy(""); }
  };
  const levels = owner.autonomyLevels || [];
  const runnable = (projects.data?.projects || []).filter((p) => p.executionAllowed);
  return (
    <Panel title="3 · Autonomie pe proiect" icon={Gauge}>
      <p className="small">Niciun nivel nu trece peste izolare, cheltuieli noi sau alte proiecte și nu crește singur. Ridicarea îți cere Windows Hello; coborârea e imediată.</p>
      <ul className="plain small">{levels.map((l) => <li key={l.level}><strong>{l.level}</strong>: {l.label}</li>)}</ul>
      <AutonomyRows projects={runnable} levels={levels} busy={busy} onSet={set} />
      <ErrorNotice error={error} />
    </Panel>
  );
}

function AutonomyRows({ projects, levels, busy, onSet }) {
  const autonomy = useResource("/api/owner/status", { reloadOn: (e) => e.type === "settings.changed" });
  return (
    <table className="table small"><thead><tr><th>Proiect</th><th>Tip</th><th>Nivel</th></tr></thead>
      <tbody>{projects.map((p) => <ProjectAutonomyRow key={p.id} project={p} levels={levels} busy={busy === p.id} onSet={onSet} stamp={autonomy.data?.policy?.activatedAt} />)}</tbody></table>
  );
}

function ProjectAutonomyRow({ project, levels, busy, onSet }) {
  const c = useResource(`/api/cockpit/${project.id}`, { reloadOn: (e) => e.type === "settings.changed" });
  const current = c.data?.autonomy?.level;
  return (
    <tr><td>{project.name}</td><td>{project.source === "hub-test" ? "test" : "real"}</td>
      <td><select className="select" value={current || ""} disabled={busy || !current} onChange={(e) => onSet(project.id, e.target.value)} aria-label={`Autonomia pentru ${project.name}`}>
        {levels.map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}</select></td></tr>
  );
}

function VoicePanel({ owner }) {
  const voice = useResource("/api/voice", { reloadOn: (e) => e.type.startsWith("voice.") || e.type === "settings.changed" });
  const [samples, setSamples] = useState([]);
  const [recording, setRecording] = useState(false);
  const [consent, setConsent] = useState("");
  const [error, setError] = useState(null);
  const enroll = useAction(async () => { await withReauth(() => api("/api/voice/enroll", { method: "POST", body: { samples: samples.map((s) => s.features), consentText: consent } })); setSamples([]); setConsent(""); voice.reload(); });
  const remove = useAction(async () => { await withReauth(() => api("/api/voice/delete", { method: "POST", body: { reason: "din configurare" } })); voice.reload(); });
  const gate = useAction(async (enabled, strict) => { await withReauth(() => api("/api/voice/gate", { method: "POST", body: { enabled, strict } })); voice.reload(); });
  const record = async () => {
    setRecording(true); setError(null);
    try { const s = await recordSample(4); setSamples((list) => [...list, s]); } catch (e) { setError(e); } finally { setRecording(false); }
  };
  const v = voice.data;
  if (!v) return <Panel title="4 · Vocea ta (filtru local)" icon={Mic2}><Loading lines={2} /></Panel>;
  const next = ENROLL_SENTENCES[samples.length % ENROLL_SENTENCES.length];
  return (
    <Panel title="4 · Vocea ta (filtru local)" icon={Mic2} actions={<Chip tone={v.gate.enabled ? "ok" : "neutral"}>{v.gate.enabled ? (v.gate.strict ? "filtru strict activ" : "filtru activ") : "filtru oprit"}</Chip>}>
      <Notice tone="info" title="Ce face și ce nu face">Filtrare locală: microfonul e analizat pe acest calculator și numai propozițiile recunoscute ca ale tale pleacă spre Lega. Nu e autentificare (Windows Hello te autentifică), nu separă perfect mai multe voci și verificatorul de bază ({v.verifier.id}) nu are rate de eroare măsurate. Confirmarea vocală a misiunilor rămâne blocată: {v.localTranscription.reason}.</Notice>
      {v.profile ? (
        <div className="stack tight">
          <p className="small">Profil v{v.profile.version} · {v.profile.samples} mostre · {fmt.dateTime(v.profile.createdAt)} · calibrare: {v.profile.calibration.method}; rate pe populație: {v.profile.calibration.populationErrorRates}.</p>
          <div className="row wrap">
            <button className="btn sm" disabled={gate.pending || !owner.credentials.length} onClick={() => gate.run(!v.gate.enabled, true)}>{v.gate.enabled ? "Oprește filtrul" : "Pornește filtrul (strict)"}</button>
            <button className="btn sm danger" disabled={remove.pending} onClick={remove.run}><Trash2 size={13} />Șterge profilul</button>
          </div>
        </div>
      ) : (
        <div className="stack tight">
          <p className="small">Citește cu voce normală {v.enroll.minSamples}–{v.enroll.maxSamples} propoziții (câte 4 secunde). Audio-ul rămâne în browser doar cât se calculează rezumatul și se șterge imediat.</p>
          <p className="lead">„{next}”</p>
          <div className="row wrap">
            <button className="btn sm primary" disabled={recording} onClick={record}><Mic2 size={13} />{recording ? "Înregistrez 4 s…" : `Înregistrează mostra ${samples.length + 1}`}</button>
            {samples.length > 0 && <button className="btn sm ghost" onClick={() => setSamples([])}>Reia</button>}
            <span className="faint small">{samples.length} mostre · ultima: {samples.length ? `${Math.round(samples[samples.length - 1].features.speechMs)} ms vorbire, SNR ${samples[samples.length - 1].features.snrDb} dB${samples[samples.length - 1].virtualDevice ? ", DISPOZITIV VIRTUAL" : ""}` : "—"}</span>
          </div>
          {samples.length >= v.enroll.minSamples && (
            <div className="stack tight">
              <pre className="pre small">{v.consentText}</pre>
              <textarea className="textarea" rows={2} value={consent} onChange={(e) => setConsent(e.target.value)} aria-label="Acordul pentru profilul vocal" />
              <button className="btn approve" disabled={consent !== v.consentText || enroll.pending} onClick={enroll.run}>Salvează profilul local</button>
            </div>
          )}
        </div>
      )}
      <ErrorNotice error={error || enroll.error || remove.error || gate.error} />
      <p className="faint small"><ExternalLink size={11} /> Un verificator mai bun (model local ECAPA/WeSpeaker) și transcrierea locală (whisper.cpp) sunt în pachetul de instalare care îți cere aprobarea.</p>
    </Panel>
  );
}
