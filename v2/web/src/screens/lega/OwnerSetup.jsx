import { useEffect, useRef, useState } from "react";
import { Fingerprint, KeyRound, ShieldCheck, Mic2, Trash2, Lock, LockOpen, Gauge, PlayCircle, CheckCircle2, CircleDashed, AlertTriangle, Hand, Loader2, RotateCcw, Square } from "lucide-react";
import { api, apiRaw, fmt, UI_BUILD } from "../../api.js";
import { useResource, useAction, pushToast } from "../../store.js";
import { Panel, Notice, ErrorNotice, Chip, Loading } from "../../components/ui.jsx";
import { webauthnAvailable, onLocalhost, localhostUrl, registerAuthenticator, unlockSession, lockSession, withReauth } from "../../lib/ownerSession.js";
import { recordSegment, listMicrophones, sendSegment } from "../../lib/voiceGate.js";
import { preferredMic, setPreferredMic } from "../../lib/voiceContext.js";

/**
 * The resumable setup of Lega 2.0 (M07 §07, §21): the REAL steps, in order, from the Hub's own state (a refresh shows the
 * same list; a finished step is not repeated), one button for everything the Hub can do by itself, and the few moments that
 * need you — Windows Hello, your voice — grouped below. Consent stays explicit: the text is shown and your Windows Hello
 * gesture accepts it (the Hub still checks the exact, versioned text).
 */
const STATUS = {
  DONE_AUTO: { label: "făcut automat", tone: "ok", icon: CheckCircle2 },
  DONE_OWNER: { label: "făcut de tine", tone: "ok", icon: CheckCircle2 },
  IN_PROGRESS: { label: "în curs", tone: "info", icon: Loader2 },
  AUTO_PENDING: { label: "automat (în așteptare)", tone: "neutral", icon: CircleDashed },
  NEEDS_OWNER: { label: "necesită prezența ta", tone: "warn", icon: Hand },
  BLOCKED: { label: "după pasul anterior", tone: "neutral", icon: CircleDashed },
  RECOVERABLE_ERROR: { label: "eroare remediabilă", tone: "error", icon: AlertTriangle },
  OPTIONAL: { label: "opțional", tone: "neutral", icon: CircleDashed },
};

export function SetupSteps({ onPanel }) {
  const setup = useResource(`/api/setup?ui=${UI_BUILD.contract ?? ""}`, { reloadOn: (e) => /^(owner\.|voice\.|environment\.|backup\.|setup\.|envelope\.)/.test(e.type) || e.type === "settings.changed" });
  const run = useAction(async () => { await api("/api/setup/run", { method: "POST", body: {} }); setup.reload(); });
  const s = setup.data;
  // While the Hub runs the automatic steps, the list follows the real operations (no timer pretends progress).
  useEffect(() => {
    if (!s?.automatic || s.automatic.finishedAt) return undefined;
    const t = setInterval(() => setup.reload(), 2000);
    return () => clearInterval(t);
  }, [s?.automatic?.startedAt, s?.automatic?.finishedAt]);
  if (!s) return <Panel title="Pașii" icon={PlayCircle}><Loading lines={4} /><ErrorNotice error={setup.error} /></Panel>;
  const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0;
  const running = s.automatic && !s.automatic.finishedAt;
  return (
    <Panel title={`Pașii · ${s.progress.done}/${s.progress.total}`} icon={PlayCircle}
      actions={s.pendingAutomatic.length ? <button className="btn sm primary" disabled={running || run.pending} onClick={run.run}>{running ? <><Loader2 size={13} className="spin" />Rulează…</> : <><PlayCircle size={13} />Rulează pașii automați ({s.pendingAutomatic.length})</>}</button> : null}>
      <div className="setup-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <ol className="setup-steps">
        {s.steps.map((step) => {
          const st = STATUS[step.status] || STATUS.OPTIONAL;
          const Icon = st.icon;
          return (
            <li key={step.id} className={`setup-step${s.next === step.id ? " is-next" : ""}`} data-status={step.status}>
              <Icon size={18} aria-hidden="true" className={step.status === "IN_PROGRESS" ? "spin" : ""} />
              <div><div className="step-title">{step.title}</div><div className="step-detail">{step.detail}</div></div>
              <div className="step-action"><span className="step-state">{st.label}</span>
                {step.action?.kind === "ui_panel" && <button className="btn sm ghost" onClick={() => onPanel?.(step.action.panel)}>Mergi</button>}
                {step.action?.kind === "ui_link" && <a className="btn sm ghost" href={step.action.href}>Deschide</a>}
                {step.action?.kind === "reload" && <button className="btn sm ghost" onClick={() => location.reload()}>Reîncarcă</button>}
              </div>
            </li>
          );
        })}
      </ol>
      <ErrorNotice error={run.error || setup.error} />
      <p className="faint small">Starea vine din Hub (baza de date, mediul, fișierele); pașii făcuți nu se repetă la reîncărcare. Pașii automați rulează ca operațiile obișnuite ale Hub-ului, înregistrate cu cine le-a cerut.</p>
    </Panel>
  );
}

export function OwnerSetup({ owner, reload }) {
  const refs = { identity: useRef(null), policy: useRef(null), autonomy: useRef(null), voice: useRef(null) };
  const goPanel = (name) => refs[name]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const register = useAction(async () => { await registerAuthenticator({ setupText: owner.setupText }); await unlockSession("after-register"); pushToast("owner-reg", "ok", "Autentificatorul a fost înregistrat; sesiunea e deschisă"); reload(); });
  const addAnother = useAction(async () => { await withReauth(() => registerAuthenticator({})); pushToast("owner-reg2", "ok", "Autentificator adăugat"); reload(); });
  const unlock = useAction(async () => { await unlockSession(); reload(); });
  const lock = useAction(async () => { await lockSession(); reload(); });
  const activate = useAction(async () => { await withReauth(() => api("/api/owner/policy/activate", { method: "POST", body: { text: owner.policyText } })); pushToast("owner-pol", "ok", "Politica voice-first este activă"); reload(); });
  const deactivate = useAction(async () => { await api("/api/owner/policy/deactivate", { method: "POST", body: { reason: "din configurare" } }); reload(); });
  const revokeCred = useAction(async (id) => { await withReauth(() => api(`/api/owner/credentials/${encodeURIComponent(id)}/revoke`, { method: "POST", body: {} })); reload(); });
  if (!owner) return <Loading lines={4} />;
  const port = owner.webauthnOrigin?.split(":").pop();
  if (!onLocalhost()) {
    return (
      <div className="stack">
        <SetupSteps />
        <Panel title="Sesiunea de proprietar" icon={Fingerprint}>
          <Notice tone="warn" title="Deschide Hub-ul pe localhost">Windows Hello (WebAuthn) nu acceptă o adresă IP ca identitate a site-ului. Același Hub, la <a href={localhostUrl(port)}>{owner.webauthnOrigin}</a>.</Notice>
        </Panel>
      </div>
    );
  }
  return (
    <div className="stack">
      <SetupSteps onPanel={goPanel} />
      <div ref={refs.identity}>
        <Panel title="1 · Autentificatorul tău" icon={Fingerprint} actions={owner.session ? <Chip tone="ok" icon={LockOpen}>sesiune deschisă până la {fmt.time(owner.session.expiresAt)}</Chip> : <Chip tone="neutral" icon={Lock}>sesiune blocată</Chip>}>
          {!webauthnAvailable() && <Notice tone="error" title="Browserul nu are WebAuthn">Folosește Edge sau Chrome pe Windows.</Notice>}
          {owner.bootstrapNeeded ? (
            <div className="stack tight">
              <p className="small">Windows îți cere PIN-ul, amprenta sau fața (Windows Hello). Hub-ul păstrează doar cheia publică; nici vocea, nici un cod din pagină nu te autentifică. Două ferestre Windows Hello: înregistrarea, apoi deschiderea sesiunii.</p>
              <blockquote className="small">{owner.setupText}</blockquote>
              <button className="btn primary" disabled={register.pending || !webauthnAvailable()} onClick={register.run}><KeyRound size={15} />{register.pending ? "Aștept Windows Hello…" : "Înregistrează acest calculator (Windows Hello)"}</button>
              <ErrorNotice error={register.error} />
            </div>
          ) : (
            <div className="stack tight">
              <ul className="plain small">{owner.credentials.map((c) => <li key={c.id} className="row between"><span>{c.label} <span className="faint mono">{c.short}</span> · înregistrat {fmt.dateTime(c.createdAt)}{c.lastUsedAt ? ` · folosit ${fmt.ago(c.lastUsedAt)}` : ""}</span>
                <button className="btn sm ghost" disabled={revokeCred.pending} onClick={() => revokeCred.run(c.id)}><Trash2 size={13} />Revocă</button></li>)}</ul>
              <div className="row wrap">
                {owner.session ? <button className="btn sm" disabled={lock.pending} onClick={lock.run}><Lock size={13} />Blochează sesiunea</button> : <button className="btn sm primary" disabled={unlock.pending} onClick={unlock.run}><LockOpen size={13} />{unlock.pending ? "Aștept Windows Hello…" : "Deblochează (Windows Hello)"}</button>}
                <button className="btn sm ghost" disabled={addAnother.pending} onClick={addAnother.run}><KeyRound size={13} />Adaugă un autentificator</button>
              </div>
              <ErrorNotice error={unlock.error || lock.error || addAnother.error || revokeCred.error} />
              <p className="faint small">Sesiunea expiră după {owner.defaults.maxHours} h și se închide după {owner.defaults.idleMinutes} min fără activitate; pașii sensibili cer o verificare mai nouă de {owner.defaults.reauthMinutes} min.</p>
            </div>
          )}
        </Panel>
      </div>

      <div ref={refs.policy}>
        <Panel title="2 · Politica voice-first" icon={ShieldCheck} actions={<Chip tone={owner.policy.active ? "ok" : "neutral"}>{owner.policy.active ? `activă (v${owner.policy.version})` : "legacy (implicit)"}</Chip>}>
          {owner.policy.active ? (
            <div className="stack tight">
              <p className="small">Confirmi o singură dată planul exact al unei misiuni, în sesiunea ta; Hub-ul derivă intern granturile. Deploy, bani, acces, instalări, ștergeri și trimiteri externe rămân în afara oricărui plan.</p>
              <button className="btn sm danger" disabled={deactivate.pending} onClick={deactivate.run}>Revino la politica legacy</button>
            </div>
          ) : (
            <div className="stack tight">
              <p className="small">Acum fiecare efect cere clicul tău în Aprobări. Activarea acceptă textul de mai jos (versiunea {owner.policyVersion}) cu gestul tău Windows Hello; aprobările vechi nu se rescriu.</p>
              <blockquote className="small">{owner.policyText}</blockquote>
              <button className="btn approve" disabled={owner.bootstrapNeeded || activate.pending} onClick={activate.run}><ShieldCheck size={15} />{activate.pending ? "Aștept Windows Hello…" : "Accept și activez (Windows Hello)"}</button>
              <ErrorNotice error={activate.error || deactivate.error} />
            </div>
          )}
        </Panel>
      </div>

      <div ref={refs.autonomy}><AutonomyPanel owner={owner} /></div>
      <div ref={refs.voice}><VoicePanel owner={owner} /></div>
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
  // Test projects first: TRUSTED is meant for them in this phase; real projects stay where you put them.
  runnable.sort((a, b) => (a.source === "hub-test" ? 0 : 1) - (b.source === "hub-test" ? 0 : 1));
  return (
    <Panel title="3 · Autonomie pe proiect" icon={Gauge}>
      <p className="small">Niciun nivel nu trece peste izolare, cheltuieli noi sau alte proiecte și nu crește singur. Ridicarea cere politica activă și Windows Hello recent; coborârea e imediată. Pentru probele M07: TRUSTED doar pe proiectele de test.</p>
      <ul className="plain small">{levels.map((l) => <li key={l.level}><strong>{l.level}</strong>: {l.label}</li>)}</ul>
      <table className="table small"><thead><tr><th>Proiect</th><th>Tip</th><th>Nivel</th></tr></thead>
        <tbody>{runnable.map((p) => <ProjectAutonomyRow key={p.id} project={p} levels={levels} busy={busy === p.id} onSet={set} />)}</tbody></table>
      <ErrorNotice error={error} />
    </Panel>
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

/** One recording → the Hub; shows a level meter while listening and lets the owner stop early. */
function useRecorder(deviceId) {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const handle = useRef(null);
  const record = async (maxSeconds = 8) => {
    setActive(true);
    try { handle.current = recordSegment({ deviceId, maxSeconds, onLevel: setLevel }); return await handle.current.promise; }
    finally { handle.current = null; setActive(false); setLevel(0); }
  };
  return { level, active, record, stop: () => handle.current?.cancel() };
}

function VoicePanel({ owner }) {
  const voice = useResource("/api/voice", { reloadOn: (e) => e.type.startsWith("voice.") || e.type === "settings.changed" });
  const [mics, setMics] = useState([]);
  const [deviceId, setDeviceIdState] = useState(preferredMic());
  const setDeviceId = (id) => { setDeviceIdState(id); setPreferredMic(id); }; // Lega and the plan's mic use the same one
  const [busy, setBusy] = useState(false); // recording + the Hub's analysis of that sample
  const [last, setLast] = useState(null); // the Hub's answer to the last sample
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState(null);
  const rec = useRecorder(deviceId || null);
  useEffect(() => { listMicrophones().then(setMics); }, []);
  const finish = useAction(async () => { await withReauth(() => api("/api/voice/enroll/finish", { method: "POST", body: { consentText: voice.data.consentText } })); setLast(null); voice.reload(); });
  const reset = useAction(async () => { await api("/api/voice/enroll/reset", { method: "POST", body: {} }); setLast(null); voice.reload(); });
  const remove = useAction(async () => { await withReauth(() => api("/api/voice/delete", { method: "POST", body: { reason: "din configurare" } })); setProbe(null); voice.reload(); });
  const gate = useAction(async (enabled) => { await withReauth(() => api("/api/voice/gate", { method: "POST", body: { enabled } })); voice.reload(); });
  const v = voice.data;
  if (!v) return <Panel title="4 · Vocea ta (local)" icon={Mic2}><Loading lines={2} /><ErrorNotice error={voice.error} /></Panel>;
  const recorded = v.draft?.phrases || [];
  const nextIndex = v.enroll.phrases.findIndex((_, i) => !recorded.includes(i));
  const phrase = nextIndex >= 0 ? v.enroll.phrases[nextIndex] : null;
  const sample = async () => {
    setError(null); setLast(null); setBusy(true);
    try {
      const r = await rec.record(8);
      if (!r) return;
      setLast({ ...(await apiRawSample(r.bytes, nextIndex)), flags: r.flags });
      voice.reload();
      listMicrophones().then(setMics);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const runProbe = async () => {
    setError(null); setProbe(null); setBusy(true);
    try { const r = await rec.record(6); if (!r) return; setProbe(await sendSegment(r.bytes, { purpose: "probe", flags: r.flags })); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const engine = v.engine || {};
  return (
    <Panel title="4 · Vocea ta (local)" icon={Mic2} actions={<Chip tone={v.gate.enabled ? "ok" : "neutral"}>{v.gate.enabled ? "filtru strict activ" : "filtru oprit"}</Chip>}>
      <Notice tone="info" title="Ce face și ce nu face">Pe acest calculator: transcrierea în română ({engine.components?.stt || "—"}) și verificarea vorbitorului ({engine.components?.sv || "—"}). Doar propozițiile recunoscute ca ale tale pleacă spre Lega și doar ele sunt transcrise; audio-ul nu se păstrează. Vocea nu te autentifică (Windows Hello o face) și se poate imita: e un filtru și forma vorbită a confirmării din sesiunea ta.</Notice>
      {!v.localTranscription.available && <Notice tone="warn" title="Motorul vocal local nu e gata">{v.localTranscription.reason}</Notice>}
      <div className="row wrap">
        <label className="small">Microfon&nbsp;
          <select className="select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Microfonul folosit">
            <option value="">implicit (Windows)</option>
            {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select></label>
        {engine.engine && <span className="faint small">motor: {engine.engine}{engine.gpu ? " · GPU" : ""}{engine.detail ? ` · ${engine.detail}` : ""}</span>}
      </div>
      {v.profile ? (
        <div className="stack tight">
          <p className="small">Profil v{v.profile.version} · {v.profile.samples} mostre · {fmt.dateTime(v.profile.createdAt)} · prag {v.profile.calibration.matchAt ?? "—"} (calibrat pe mostrele tale; {v.profile.calibration.negatives}).</p>
          <div className="row wrap">
            <button className="btn sm primary" disabled={rec.active || busy} onClick={runProbe}><Mic2 size={13} />{rec.active ? "Te ascult…" : busy ? "Verific local…" : "Probă: spune orice frază"}</button>
            {rec.active && <button className="btn sm ghost" onClick={rec.stop}><Square size={13} />Gata</button>}
            <button className="btn sm" disabled={gate.pending} onClick={() => gate.run(!v.gate.enabled)}>{v.gate.enabled ? "Oprește filtrul" : "Pornește filtrul (strict)"}</button>
            <button className="btn sm danger" disabled={remove.pending} onClick={remove.run}><Trash2 size={13} />Șterge profilul</button>
          </div>
          {rec.active && <div className="mic-level" aria-hidden="true"><span style={{ width: `${Math.round(rec.level * 100)}%` }} /></div>}
          {probe && <p className="small">Rezultat: <strong>{probe.result}</strong> ({probe.reason}){probe.transcript ? <> · am auzit: <b>„{probe.transcript}”</b></> : null}</p>}
        </div>
      ) : (
        <div className="stack tight">
          <p className="small">Citește, pe rând, {v.enroll.minSamples} fraze cu vocea ta obișnuită, la distanța de lucru. Hub-ul verifică pe loc calitatea și ce a auzit; o mostră respinsă o repeți.</p>
          {phrase && <p className="enroll-phrase">„{phrase}”</p>}
          <div className="row wrap">
            {phrase && <button className="btn sm primary" disabled={rec.active || busy || !v.localTranscription.available} onClick={sample}><Mic2 size={13} />{rec.active ? "Te ascult… (se oprește singur)" : busy ? "Verific local…" : `Înregistrează fraza (${recorded.length + 1}/${v.enroll.minSamples})`}</button>}
            {rec.active && <button className="btn sm ghost" onClick={rec.stop}><Square size={13} />Anulează</button>}
            {recorded.length > 0 && <button className="btn sm ghost" disabled={reset.pending} onClick={reset.run}><RotateCcw size={13} />Reia de la zero</button>}
          </div>
          {rec.active && <div className="mic-level" aria-hidden="true"><span style={{ width: `${Math.round(rec.level * 100)}%` }} /></div>}
          {last && (
            <p className="small">{last.accepted ? <Chip tone="ok">acceptată</Chip> : <Chip tone="warn">respinsă</Chip>} am auzit: <b>„{last.heard || "—"}”</b> · {last.quality?.speechMs} ms vorbire · SNR {last.quality?.snrDb} dB{last.problems?.length ? ` · ${last.problems.join("; ")}` : ""}{last.flags?.virtualDevice ? " · DISPOZITIV VIRTUAL" : ""}</p>
          )}
          {recorded.length >= v.enroll.minSamples && (
            <div className="stack tight">
              <blockquote className="small">{v.consentText}</blockquote>
              <button className="btn approve" disabled={finish.pending} onClick={finish.run}>{finish.pending ? "Aștept Windows Hello…" : "Accept și salvez profilul local"}</button>
            </div>
          )}
        </div>
      )}
      <ErrorNotice error={error || finish.error || reset.error || remove.error || gate.error} />
    </Panel>
  );
}

/** One enrolment sample to the Hub (raw PCM, owner session). */
const apiRawSample = (bytes, phraseIndex) => apiRaw(`/api/voice/enroll/sample?phrase=${phraseIndex}`, bytes);
