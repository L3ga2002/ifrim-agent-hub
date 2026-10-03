import { useState } from "react";
import { GraduationCap, Plus, Check, X, Eraser, Scale, Smartphone, KeyRound, Ban, ExternalLink, Lock } from "lucide-react";
import { fmt } from "../../api.js";
import { useResource } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice, Chip } from "../../components/ui.jsx";
import { LESSON_RO, LESSON_TONE, SCOPE_RO, OPTION_STATE_RO, OPTION_STATE_TONE } from "../../lib/intelLogic.js";
import { useIntel, post, useRun, SourceNote, ProjectSelect } from "./common.jsx";

// ---------------------------------------------------------------- Lecții (Teach Lega)
export function Lessons() {
  const list = useIntel("/api/lessons", ["lesson."]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("");
  const [projectId, setProjectId] = useState("");
  const [last, setLast] = useState(null);
  const [forget, setForget] = useState(null);
  const r = useRun();
  const propose = (e) => { e.preventDefault(); r.run("prop", async () => { const out = await post("/api/lessons", { text, source: "typed", ...(scope ? { scope } : {}), ...(projectId ? { projectId } : {}) }, { reauth: false }); setLast(out); setText(""); list.reload(); }); };
  const act = (key, path, body = {}, toast) => r.run(key, async () => { const out = await post(path, body, { toast }); list.reload(); return out; });
  const lessons = list.data?.lessons || [];
  const active = lessons.filter((l) => l.status === "ACTIVE");
  const pending = lessons.filter((l) => ["PROPOSED", "FORGET_PROPOSED"].includes(l.status));
  return (
    <div className="intel-grid">
      <Panel title="Învață-o pe Lega" icon={GraduationCap}>
        <form className="stack tight" onSubmit={propose}>
          <label className="field"><span>Regula sau procedura (cuvintele tale)</span><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. La livrarea unui site de client verifică mobilul, formularele și erorile consolei" /></label>
          <div className="row wrap">
            <label className="field inline"><span>Se aplică la</span><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">din frază</option><option value="GLOBAL">toate proiectele</option><option value="PROJECT">un proiect</option></select></label>
            {scope === "PROJECT" && <ProjectSelect value={projectId} onChange={setProjectId} inline />}
          </div>
          <button className="btn primary" disabled={text.trim().length < 6 || Boolean(r.busy)}><Plus size={14} />Propune</button>
          <ErrorNotice error={r.error} />
        </form>
        {last && (last.refused ? <Notice tone="warn" title="Refuzat">{last.reason}</Notice> : (
          <Notice tone="info" title="Propunere — încă nu e regulă">
            {last.lesson.parsed.trigger && <div><strong>Când:</strong> {last.lesson.parsed.trigger}</div>}
            <div><strong>Pași:</strong> {last.lesson.parsed.steps.join(" · ")}</div>
            <div className="faint small">{last.generalization || `Scope: ${SCOPE_RO[last.lesson.scope]}`}{last.replaces ? ` · înlocuiește „${last.replaces.parsed?.trigger || last.replaces.text.slice(0, 60)}”` : ""}</div>
            {last.securityDecision && <div className="small"><Lock size={12} /> {last.securityDecision.note} ({last.securityDecision.parts.join(", ")})</div>}
          </Notice>
        ))}
        <p className="faint small">Doar cuvintele tale (scrise în sesiunea ta sau spuse și verificate local) devin lecții. Textul dintr-un document, o pagină, un tool sau un review nu devine regulă, chiar dacă sună ca o instrucțiune. Partea care lărgește accesul (deploy, push, fără confirmare) e o decizie de securitate separată.</p>
      </Panel>
      <Panel title="De confirmat" icon={Check}>
        {pending.length ? <ul className="plain intel-list">{pending.map((l) => (
          <li key={l.id}><Chip tone={LESSON_TONE[l.status]}>{LESSON_RO[l.status]}</Chip> {l.parsed?.trigger ? <strong>{l.parsed.trigger}: </strong> : null}{(l.parsed?.steps || []).join(" · ") || l.text}
            <div className="faint small">{SCOPE_RO[l.scope]} · {l.provenance} · {fmt.dateTime(l.createdAt)}</div>
            {l.security?.length > 0 && <Notice tone="warn">Conține o schimbare de securitate ({l.security.join(", ")}); nu poate deveni regulă de lucru.</Notice>}
            <div className="row wrap">
              {l.status === "PROPOSED" && <button className="btn sm primary" disabled={Boolean(r.busy) || l.security?.length > 0} onClick={() => act(`c-${l.id}`, `/api/lessons/${l.id}/confirm`, {}, "Lecție activă (în memorie, în scope-ul ei)")}><Check size={12} />Confirmă</button>}
              {l.status === "PROPOSED" && <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => act(`d-${l.id}`, `/api/lessons/${l.id}/dismiss`, {}, "Renunțat")}><X size={12} />Renunță</button>}
              {l.status === "FORGET_PROPOSED" && <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => act(`f-${l.id}`, `/api/lessons/${l.id}/forget/confirm`, {}, "Regula nu se mai aplică (istoricul rămâne)")}><Eraser size={12} />Confirmă dezactivarea</button>}
              {l.status === "FORGET_PROPOSED" && <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => act(`fc-${l.id}`, `/api/lessons/${l.id}/forget/cancel`, {}, "Regula rămâne activă")}><X size={12} />Păstrează regula</button>}
              {l.status === "FORGET_PROPOSED" && <div className="faint small">Până confirmi, regula se aplică în continuare.</div>}
            </div>
          </li>
        ))}</ul> : <p className="faint small">Nimic de confirmat.</p>}
      </Panel>
      <Panel title="Reguli active" icon={GraduationCap} className="span-2">
        {list.loading ? <Loading lines={3} /> : active.length ? <ul className="plain intel-list">{active.map((l) => (
          <li key={l.id}>{l.parsed?.trigger ? <strong>{l.parsed.trigger}: </strong> : null}{(l.parsed?.steps || []).join(" · ")} <Chip tone="neutral">{SCOPE_RO[l.scope]}</Chip>
            <span className="faint small"> · confirmată {fmt.dateTime(l.decidedAt)}{l.memoryItemId ? ` · memorie ${l.memoryItemId.slice(-6)}` : ""}</span>
            <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={async () => setForget(await act(`fp-${l.id}`, "/api/lessons/forget", { lessonId: l.id }))}><Eraser size={12} />Uită</button></li>
        ))}</ul> : <Empty title="Nicio regulă activă">Spune-i Lega „Ține minte că…” sau scrie aici.</Empty>}
        {forget?.effect && <Notice tone="info">{forget.effect}</Notice>}
        <SourceNote>Regulile active intră în instrucțiunile agenților pentru proiectul lor; regulile Hub-ului rămân deasupra lor.</SourceNote>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Decizii (pachete A / B)
function PackageCard({ kind, pkg, reload }) {
  const [choice, setChoice] = useState({});
  const r = useRun();
  const present = () => r.run("present", async () => { await post("/api/packages", { kind }, { toast: `Pachetul ${kind} prezentat`, reauth: false }); reload(); });
  if (!pkg) return (
    <Panel title={kind === "A" ? "A · Protecția datelor și a profilului vocal" : "B · Pilotul real pe ProDelivery"} icon={Scale}>
      <p className="faint small">{kind === "A" ? "Inventarul datelor sincronizate (OneDrive) și al accesului la profilul vocal, cu opțiuni reversibile." : "Pilotul finit pregătit; se decide după pachetul A."}</p>
      <button className="btn sm" disabled={Boolean(r.busy)} onClick={present}>Pregătește pachetul</button>
      <ErrorNotice error={r.error} />
    </Panel>
  );
  const decide = () => r.run("decide", async () => { await post(`/api/packages/${pkg.id}/decide`, { decisions: choice }, { toast: "Decizia ta a fost înregistrată" }); setChoice({}); reload(); });
  const b = pkg.body || {};
  return (
    <Panel title={`${pkg.kind} · ${pkg.title}`} icon={Scale} actions={<Chip tone={pkg.status === "PRESENTED" ? "approval" : "neutral"}>{pkg.status === "PRESENTED" ? "așteaptă decizia ta" : pkg.status}</Chip>}>
      {pkg.kind === "A" && b.parts && (
        <div className="table-wrap"><table className="table small"><thead><tr><th>Ce</th><th>Unde</th><th>Fișiere</th><th>Mărime</th><th>Sincronizat</th></tr></thead>
          <tbody>{b.parts.map((p) => <tr key={p.name}><td>{p.name}</td><td className="mono">{p.path}</td><td>{p.files}</td><td>{fmt.bytes ? fmt.bytes(p.bytes) : `${Math.round(p.bytes / 1024)} KB`}</td><td>{p.synced ? <Chip tone="warn">OneDrive</Chip> : <Chip tone="ok">local</Chip>}</td></tr>)}</tbody></table></div>
      )}
      {pkg.kind === "A" && b.voice && <p className="small">Profil vocal: <span className="mono">{b.voice.profilesDir || "—"}</span> · {b.voice.acl?.available ? (b.voice.acl.restricted ? "acces restrâns" : `grupuri largi: ${b.voice.acl.wide.join("; ") || "—"} · intrări moștenite: ${b.voice.acl.inherited}`) : b.voice.acl?.reason}</p>}
      {pkg.kind === "B" && b.available === false && <Notice tone="info" title="Inventarul pilotului lipsește">{b.reason}</Notice>}
      {pkg.kind === "B" && b.task && (
        <div className="small stack tight">
          <div><strong>Sarcina:</strong> {b.task.title}</div><div className="faint">{b.task.why}</div>
          <div><strong>În scope:</strong> {b.task.inScope.join(", ")} · <strong>în afara:</strong> {b.task.outOfScope.join("; ")}</div>
          <div><strong>Acceptare:</strong><ul>{b.task.acceptance.map((a) => <li key={a}>{a}</li>)}</ul></div>
          <div><strong>Verificare:</strong> <span className="mono">{b.task.verification}</span> · <strong>Modele:</strong> {b.models.writer}; {b.models.reviewer}</div>
          <div><strong>Limite:</strong> {b.limits.maxDurationMin} min · {b.limits.maxAttemptsPerStage} încercări · {b.limits.maxRepairCycles} reparare · <strong>Mediu:</strong> {b.environment.id} ({b.environment.attested ? "atestat" : "neatestat"}) · rută acum: {b.route}</div>
          <div className="faint">Date: {b.dataExposure.copiedIntoEnvironment}. Excluse: {b.dataExposure.excluded.join(", ")}.</div>
        </div>
      )}
      {pkg.blockedBy?.length > 0 && <Notice tone="warn" title="Se decide după pachetul A">{pkg.blockedBy.join(" · ")}</Notice>}
      <ul className="plain pkg-options">{pkg.options.map((o) => (
        <li key={o.key}>
          <div className="row between wrap"><strong>{o.key} · {o.title}</strong><Chip tone={OPTION_STATE_TONE[o.state]}>{OPTION_STATE_RO[o.state] || o.state}</Chip></div>
          <div className="small">{o.changes.join(" · ")}</div>
          <details className="small"><summary>Execuție, revenire, limite</summary>
            <div><strong>Execuție:</strong><ol>{o.execution.map((x) => <li key={x} className="mono">{x}</li>)}</ol></div>
            <div><strong>Revenire:</strong> {o.rollback.join(" · ")}</div>
            {o.limits && <div><strong>Limite:</strong> {o.limits.join(" · ")}</div>}
          </details>
          {pkg.status === "PRESENTED" && o.applicable !== false && !pkg.blockedBy?.length && (
            <div className="row wrap" role="radiogroup" aria-label={`Decizia pentru ${o.key}`}>
              {[["approve", "Aprob"], ["reject", "Resping"], ["defer", "Amân"]].map(([v, label]) => (
                <label key={v} className="radio-chip"><input type="radio" name={`${pkg.id}-${o.key}`} checked={choice[o.key] === v} onChange={() => setChoice((c) => ({ ...c, [o.key]: v }))} />{label}</label>
              ))}
            </div>
          )}
        </li>
      ))}</ul>
      {pkg.status === "PRESENTED" && <div className="row wrap"><button className="btn primary" disabled={!Object.keys(choice).length || Boolean(r.busy) || pkg.blockedBy?.length > 0} onClick={decide}><Check size={14} />Înregistrează decizia (Windows Hello)</button><button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={present}>Reîmprospătează inventarul</button></div>}
      <ErrorNotice error={r.error} />
      <SourceNote>Aprobarea înregistrează decizia; mutarea datelor și ACL-ul se execută de tine cu scripturile indicate (cu Hub-ul oprit), iar starea „executată” se citește din realitate, nu se declară. Nimic nu se șterge.</SourceNote>
    </Panel>
  );
}

export function Decisions() {
  const list = useIntel("/api/packages", ["package.", "settings."]);
  if (list.loading) return <Loading lines={4} />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const latest = (kind) => (list.data.packages || []).filter((p) => p.kind === kind && ["PRESENTED", "DECIDED"].includes(p.status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  const a = latest("A"); const b = latest("B");
  return (
    <div className="stack">
      <Notice tone="info" title="Cel mult două pachete">A (protecția datelor) se decide întâi; B (pilotul ProDelivery) rămâne blocat până când opțiunile aprobate din A sunt executate și verificate.</Notice>
      <div className="intel-grid">
        <PackageCard kind="A" pkg={a ? (list.data.packages.find((p) => p.id === a.id)) : null} reload={list.reload} />
        <PackageCard kind="B" pkg={b ? (list.data.packages.find((p) => p.id === b.id)) : null} reload={list.reload} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Telefon (Personal Mission Control)
export function Devices() {
  const devices = useResource("/api/devices", { reloadOn: (e) => e.type.startsWith("device.") });
  const [pairing, setPairing] = useState(null);
  const r = useRun();
  const start = () => r.run("pair", async () => setPairing(await post("/api/devices/pairing", {})));
  const revoke = (id) => r.run(`rv-${id}`, async () => { await post(`/api/devices/${id}/revoke`, {}, { toast: "Dispozitiv revocat" }); devices.reload(); });
  return (
    <div className="intel-grid">
      <Panel title="Asociază telefonul" icon={Smartphone}>
        <p className="small">Telefonul primește doar: vizualizarea stării, Stop tot, pauză și oprire de misiune. Confirmările și pachetele cer sesiunea ta pe PC (Windows Hello).</p>
        <button className="btn primary" disabled={Boolean(r.busy)} onClick={start}><KeyRound size={14} />Generează un cod (10 minute)</button>
        {pairing && <div className="pair-code" aria-live="polite"><span className="mono">{pairing.code}</span><div className="faint small">expiră la {fmt.time(pairing.expiresAt)} · {pairing.note}</div></div>}
        <Notice tone="warn" title="Fără expunere în rețea">Hub-ul ascultă doar pe 127.0.0.1: un telefon real nu îl poate atinge fără o conexiune autorizată separat (nu e configurată). Testul pe un telefon real rămâne BLOCKED până la decizia ta.</Notice>
        <a className="btn sm" href="#/m"><ExternalLink size={13} />Previzualizează ecranul de telefon</a>
        <ErrorNotice error={r.error || devices.error} />
      </Panel>
      <Panel title="Dispozitive asociate" icon={Smartphone}>
        {devices.loading ? <Loading lines={2} /> : devices.data?.devices?.length ? <ul className="plain intel-list">{devices.data.devices.map((d) => (
          <li key={d.id}><strong>{d.label}</strong> {d.revokedAt ? <Chip tone="neutral">revocat</Chip> : <Chip tone="ok">activ</Chip>}
            <div className="faint small">asociat {fmt.dateTime(d.createdAt)} · ultima dată {d.lastSeenAt ? fmt.dateTime(d.lastSeenAt) : "—"} · {d.permissions.join(", ")}</div>
            {!d.revokedAt && <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => revoke(d.id)}><Ban size={12} />Revocă</button>}</li>
        ))}</ul> : <Empty title="Niciun dispozitiv" />}
      </Panel>
    </div>
  );
}
