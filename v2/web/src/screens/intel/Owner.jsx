import { useState } from "react";
import { GraduationCap, Plus, Check, X, Eraser, Scale, Smartphone, KeyRound, Ban, ExternalLink, Lock } from "lucide-react";
import { fmt } from "../../api.js";
import { useResource } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice, Chip } from "../../components/ui.jsx";
import { LESSON_RO, LESSON_TONE, SCOPE_RO, OPTION_STATE_RO, OPTION_STATE_TONE, PACKAGE_INTRO, packageLabel, latestPackages } from "../../lib/intelLogic.js";
import { useIntel, post, useRun, SourceNote, ProjectSelect } from "./common.jsx";

/** M09: a package's model from its structured form ({ provider, model, effort }); a package presented before M09 stored the text. */
const modelText = (m) => (typeof m === "string" ? m : m ? `${m.provider === "codex" ? "Codex" : m.provider === "claude" ? "Claude" : m.provider} ${m.model} · ${m.effort} (abonament)` : "—");

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

// ---------------------------------------------------------------- Decizii (pachetele A / B și MEDIA A / B / C)
/** Body of package A: where the data is and whether it is synced; the voice profile's access list. */
function BodyA({ b }) {
  return <>
    {b.parts && (
      <div className="table-wrap"><table className="table small"><thead><tr><th>Ce</th><th>Unde</th><th>Fișiere</th><th>Mărime</th><th>Sincronizat</th></tr></thead>
        <tbody>{b.parts.map((p) => <tr key={p.name}><td>{p.name}</td><td className="mono">{p.path}</td><td>{p.files}</td><td>{fmt.bytes ? fmt.bytes(p.bytes) : `${Math.round(p.bytes / 1024)} KB`}</td><td>{p.synced ? <Chip tone="warn">OneDrive</Chip> : <Chip tone="ok">local</Chip>}</td></tr>)}</tbody></table></div>
    )}
    {b.voice && <p className="small">Profil vocal: <span className="mono">{b.voice.profilesDir || "—"}</span> · {b.voice.acl?.available ? (b.voice.acl.restricted ? "acces restrâns" : `grupuri largi: ${b.voice.acl.wide.join("; ") || "—"} · intrări moștenite: ${b.voice.acl.inherited}`) : b.voice.acl?.reason}</p>}
  </>;
}
/** Body of package B: the pilot's task, scope, acceptance, models, limits and data exposure. */
function BodyB({ b }) {
  if (b.available === false) return <Notice tone="info" title="Inventarul pilotului lipsește">{b.reason}</Notice>;
  if (!b.task) return null;
  return (
    <div className="small stack tight">
      <div><strong>Sarcina:</strong> {b.task.title}</div><div className="faint">{b.task.why}</div>
      <div><strong>În scope:</strong> {b.task.inScope.join(", ")} · <strong>în afara:</strong> {b.task.outOfScope.join("; ")}</div>
      <div><strong>Acceptare:</strong><ul>{b.task.acceptance.map((a) => <li key={a}>{a}</li>)}</ul></div>
      <div><strong>Verificare:</strong> <span className="mono">{b.task.verification}</span> · <strong>Modele:</strong> {modelText(b.models?.writer)}; {modelText(b.models?.reviewer)}</div>
      <div><strong>Limite:</strong> {b.limits.maxDurationMin} min · {b.limits.maxAttemptsPerStage} încercări · {b.limits.maxRepairCycles} reparare · <strong>Mediu:</strong> {b.environment.id} ({b.environment.attested ? "atestat" : "neatestat"}) · rută acum: {b.route}</div>
      <div className="faint">Date: {b.dataExposure.copiedIntoEnvironment}. Excluse: {b.dataExposure.excluded.join(", ")}.</div>
    </div>
  );
}
/** Body of MEDIA_A: the tools' pins and last verification, OBS (not verifiable), the presets' fonts. */
function BodyMediaA({ b }) {
  return (
    <div className="small stack tight">
      <div className="table-wrap"><table className="table small"><thead><tr><th>Unealtă</th><th>Versiune</th><th>sha256</th><th>Fixată</th><th>Verificată de la pornire</th></tr></thead>
        <tbody>{(b.tools || []).map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.version || "—"}</td><td className="mono">{t.sha256 || "—"}</td>
          <td>{t.pinned ? <Chip tone={t.changed ? "warn" : "ok"}>{t.changed ? "schimbată" : "da"}</Chip> : <Chip tone="neutral">nu</Chip>}</td><td>{t.verifiedSinceBoot ? "da" : "nu"}</td></tr>)}</tbody></table></div>
      {b.toolProblems?.length > 0 && <div className="faint">Probleme: {b.toolProblems.join(", ")}</div>}
      <div><strong>OBS:</strong> {b.obs?.url} · {b.obs?.note}</div>
      <div><strong>Fonturi</strong> ({b.fontsDir}): {(b.fonts || []).map((f) => `${f.id} ${f.ok ? "complet" : `lipsesc ${f.missing.join(", ")}`}`).join(" · ")}</div>
      {b.note && <div className="faint">{b.note}</div>}
    </div>
  );
}
/** Body of MEDIA_B: the live-capture policy now (and its fail-safe) and the AI budget being decided. */
function BodyMediaB({ b, reload }) {
  const r = useRun();
  const off = () => r.run("off", async () => { await post("/api/media/policy/capture-off", { reason: "Decizii → Oprește captura" }, { toast: "Captura live e oprită", reauth: false }); reload(); });
  return (
    <div className="small stack tight">
      <div className="row wrap"><strong>Captura live acum:</strong> {b.liveCapture ? <Chip tone="warn">activă</Chip> : <Chip tone="ok">oprită</Chip>}
        {b.liveCapture && <button className="btn sm" disabled={Boolean(r.busy)} onClick={off}>Oprește captura</button>}</div>
      <div><strong>Buget AI:</strong> {b.budgetText}</div>
      {b.note && <div className="faint">{b.note}</div>}
      <ErrorNotice error={r.error} />
    </div>
  );
}
/** Body of MEDIA_C: per platform, what the upload API is today; the reminder that nothing is applied by a click. */
function BodyMediaC({ b }) {
  return (
    <div className="small stack tight">
      <div className="table-wrap"><table className="table small"><thead><tr><th>Platformă</th><th>API încărcare</th><th>Notă</th></tr></thead>
        <tbody>{(b.platforms || []).map((p) => <tr key={p.key}><td>{p.label}</td><td><Chip tone={p.apiUpload === "COST_BLOCKED" || p.apiUpload === "POLICY_UNSUPPORTED" ? "warn" : "neutral"}>{p.apiUpload || "—"}</Chip></td><td>{p.apiNote}</td></tr>)}</tbody></table></div>
      <div className="faint">Încărcare live: {b.liveUpload ? "activă" : "oprită"} · publicare automată: {b.autoPublish ? "activă" : "oprită"} · sursa: {b.source}</div>
      {b.note && <Notice tone="info">{b.note}</Notice>}
    </div>
  );
}
const PACKAGE_BODIES = { A: BodyA, B: BodyB, MEDIA_A: BodyMediaA, MEDIA_B: BodyMediaB, MEDIA_C: BodyMediaC };
const PACKAGE_NOTES = {
  A: "Aprobarea înregistrează decizia; mutarea datelor și ACL-ul se execută de tine cu scripturile indicate (cu Hub-ul oprit), iar starea „executată” se citește din realitate, nu se declară. Nimic nu se șterge.",
  B: "B1–B3 se aplică la aprobare prin mecanismele obișnuite; B4 pregătește doar ciorna misiunii. Nimic nu pornește fără planul confirmat de tine.",
  MEDIA_A: "Instalările le faci tu; Hub-ul nu instalează și nu descarcă nimic. OBS nu se verifică fără o conexiune, deci rămâne „aprobată”.",
  MEDIA_B: "MB1 pornește doar politica (fiecare captură își cere scopul); „Oprește captura” e oricând disponibil, din orice canal. MB2 înregistrează un buget: nu pornește nimic.",
  MEDIA_C: "Opțiunile sunt externe: aprobarea înregistrează doar decizia; nu se conectează niciun cont și nu se încarcă nimic. Fiecare încărcare cere confirmarea ei separată.",
};

function PackageCard({ kind, pkg, reload }) {
  const [choice, setChoice] = useState({});
  const r = useRun();
  const present = () => r.run("present", async () => { await post("/api/packages", { kind }, { toast: `Pachetul ${packageLabel(kind)} prezentat`, reauth: false }); reload(); });
  if (!pkg) return (
    <Panel title={`${packageLabel(kind)} · ${PACKAGE_INTRO[kind]?.title || kind}`} icon={Scale}>
      <p className="faint small">{PACKAGE_INTRO[kind]?.text || ""}</p>
      <button className="btn sm" disabled={Boolean(r.busy)} onClick={present}>Pregătește pachetul</button>
      <ErrorNotice error={r.error} />
    </Panel>
  );
  const decide = () => r.run("decide", async () => { await post(`/api/packages/${pkg.id}/decide`, { decisions: choice }, { toast: "Decizia ta a fost înregistrată" }); setChoice({}); reload(); });
  const Body = PACKAGE_BODIES[pkg.kind];
  return (
    <Panel title={`${packageLabel(pkg.kind)} · ${pkg.title}`} icon={Scale} actions={<Chip tone={pkg.status === "PRESENTED" ? "approval" : "neutral"}>{pkg.status === "PRESENTED" ? "așteaptă decizia ta" : pkg.status}</Chip>}>
      {Body ? <Body b={pkg.body || {}} reload={reload} /> : <Notice tone="info">Tip de pachet necunoscut în această interfață: {pkg.kind}</Notice>}
      {pkg.blockedBy?.length > 0 && <Notice tone="warn" title={`Se decide după pachetul ${packageLabel(pkg.prerequisite || "A")}`}>{pkg.blockedBy.join(" · ")}</Notice>}
      <ul className="plain pkg-options">{pkg.options.map((o) => (
        <li key={o.key}>
          <div className="row between wrap"><strong>{o.key} · {o.title}</strong><span className="row">{o.external && <Chip tone="neutral" title="Doar decizie: nu se aplică dintr-un click">extern · doar decizie</Chip>}<Chip tone={OPTION_STATE_TONE[o.state]}>{OPTION_STATE_RO[o.state] || o.state}</Chip></span></div>
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
      <SourceNote>{PACKAGE_NOTES[pkg.kind] || "Aprobarea înregistrează decizia; starea „executată” se citește din realitate, nu se declară."} Decizia se înregistrează din sesiunea ta (Windows Hello), prin click.</SourceNote>
    </Panel>
  );
}

export function Decisions() {
  const list = useIntel("/api/packages", ["package.", "settings."]);
  if (list.loading) return <Loading lines={4} />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const rows = latestPackages(list.data.packages || []);
  return (
    <div className="stack">
      <Notice tone="info" title="Fiecare pachet își așteaptă predecesorul">A (protecția datelor) înaintea lui B (pilotul ProDelivery); în Studio, MEDIA A (mediul) înaintea lui MEDIA B (captură, buget AI), iar MEDIA B înaintea lui MEDIA C (conturi, încărcare). Un pachet aprobat nu îl autorizează pe următorul.</Notice>
      <div className="intel-grid">
        {rows.map(({ kind, pkg }) => <PackageCard key={kind} kind={kind} pkg={pkg} reload={list.reload} />)}
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
