import { useEffect, useState } from "react";
import { Plug, ShieldCheck, KeyRound, Search as SearchIcon, ExternalLink, Lock } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, useHub, refresh } from "../store.js";
import { Panel, Loading, ErrorNotice, Chip, Checks, Notice, StatusChip, Empty } from "../components/ui.jsx";
import { takeGrantPrefill } from "../lib/legaBridge.js";
import { withReauth } from "../lib/ownerSession.js";
import { gateRearmHint, REARM_SETUP } from "../lib/rearmLogic.js";
import { StopAllButton } from "../shell/Shell.jsx";

/** Only known grant fields with values the form can show; anything else Lega sends is ignored. */
const clampInt = (v, min, max) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : undefined);
function pickGrantFields(v) {
  const out = {
    kind: v.kind === "voice" ? "voice" : "run",
    projectId: typeof v.projectId === "string" ? v.projectId.slice(0, 80) : undefined,
    provider: v.provider === "claude" ? "claude" : v.provider === "codex" ? "codex" : undefined,
    access: v.access === "workspace-write" ? "workspace-write" : v.access === "read-only" ? "read-only" : undefined,
    maxAttempts: clampInt(v.maxAttempts, 1, 5), ttlMinutes: clampInt(v.ttlMinutes, 5, 480), maxDurationS: clampInt(v.maxDurationS, 60, 7200),
    note: typeof v.note === "string" ? v.note.slice(0, 500) : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
}

const STATUS_TONE = { DOCUMENTED: "neutral", ACCOUNT_ELIGIBLE: "info", AUTHENTICATED: "info", IMPLEMENTED: "info", TESTED_LIVE: "ok", TESTED_SIMULATED: "info", ASSISTED_ONLY: "warn", BLOCKED: "error" };

function ProviderCard({ provider, attestationText, onChange }) {
  const inspect = useAction(async () => { await api(`/api/providers/${provider.id}/inspect`, { method: "POST", body: {} }); onChange(); });
  const probe = useAction(async (withModels) => { await api(`/api/providers/${provider.id}/probe`, { method: "POST", body: { withModels } }); onChange(); });
  const [confirmText, setConfirmText] = useState("");
  // M09-A2: the declaration is made in the owner session (Windows Hello re-authentication), bound to the account shown here;
  // withdrawing it is fail-safe and always available.
  const billing = provider.billing || null;
  const declare = useAction(async () => {
    await withReauth(() => api("/api/owner/billing/declare", { method: "POST", body: { provider: provider.id, confirmText, displayedIdentity: billing?.currentIdentity?.value || "" } }));
    setConfirmText(""); onChange();
  });
  const withdraw = useAction(async () => { await api("/api/owner/billing/withdraw", { method: "POST", body: { provider: provider.id, reason: "retrasă din Integrări" } }); onChange(); });
  return (
    <Panel title={provider.displayName} icon={Plug} data-lega-target="billing" actions={<Chip tone={provider.route.allowed ? "ok" : "warn"}>{provider.route.allowed ? "rută inclusă verificată" : "blocat"}</Chip>}>
      <div className="stack">
        <dl className="kv">
          <dt>Instalare</dt><dd>{provider.installation ? (provider.installation.installed ? `${provider.installation.version} · ${provider.installation.source || ""}` : provider.installation.reason) : "neinspectat"}</dd>
          <dt>Autentificare</dt><dd>{provider.auth ? JSON.stringify(provider.auth) : "neverificată"}</dd>
          <dt>Ultima verificare</dt><dd>{provider.probedAt ? `${fmt.dateTime(provider.probedAt)}${provider.probeOk === false ? ` · eroare: ${provider.probeError}` : ""}` : "niciodată"}</dd>
          {Array.isArray(provider.models) && <><dt>Modele raportate</dt><dd>{provider.models.map((m) => m.displayName).join(", ") || "—"}</dd></>}
        </dl>
        <Checks checks={provider.route.checks} />
        <div className="row wrap">
          <button className="btn sm" onClick={inspect.run} disabled={inspect.pending}>Inspectează instalarea</button>
          <button className="btn sm primary" onClick={() => probe.run(false)} disabled={probe.pending}><ShieldCheck size={14} />{probe.pending ? "Verific…" : "Verifică contul"}</button>
          {provider.id === "codex" && <button className="btn sm" onClick={() => probe.run(true)} disabled={probe.pending}><SearchIcon size={14} />+ listă modele</button>}
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          {provider.id === "codex" ? "Verificarea pornește codex app-server local, face handshake și citește account/read și rate limits. Nu pornește niciun turn, deci nu există inferență." : "Rulează comanda oficială „claude auth status --json” cu același mediu controlat folosit la execuții. Nu există inferență."}
        </p>
        <BillingEvidence billing={billing} attestationText={billing?.declarationText || attestationText} confirmText={confirmText} setConfirmText={setConfirmText}
          declare={declare} withdraw={withdraw} providerName={provider.id === "claude" ? "Claude" : "Codex"} />
        <ErrorNotice error={inspect.error || probe.error || declare.error || withdraw.error} />
      </div>
    </Panel>
  );
}

const EVIDENCE_TONE = { valid: "ok", reverify_required: "warn", missing: "error" };
const EVIDENCE_LABEL = { valid: "declarație valabilă", reverify_required: "cere reconfirmare", missing: "fără declarație" };
const SOURCE_LABEL = { "owner_session:webauthn": "sesiunea ta de proprietar", legacy_ui: "declarație veche din UI (nelegată de cont)", simulator: "simulare" };

/**
 * M09-A2: the billing evidence of one provider — what the Hub holds (source, when, until when, which account as a short
 * pseudonym, state and reasons), the re-declaration in the owner session and the withdrawal (always available).
 */
function BillingEvidence({ billing, attestationText, confirmText, setConfirmText, declare, withdraw, providerName }) {
  if (!billing) return null;
  const d = billing.declaration;
  const current = billing.currentIdentity;
  const canDeclare = Boolean(current?.value) && confirmText === attestationText && !declare.pending;
  return (
    <div className="stack tight" data-lega-target="billing-evidence">
      <div className="section-title"><KeyRound size={12} /> Declarația de facturare (setarea peste plan)</div>
      <div className="row wrap">
        <Chip tone={EVIDENCE_TONE[billing.state] || "warn"}>{EVIDENCE_LABEL[billing.state] || billing.state}</Chip>
        {billing.reasonText && billing.state !== "valid" && <span className="muted small">{billing.reasonText}</span>}
      </div>
      <dl className="kv">
        <dt>Sursă</dt><dd>{d ? SOURCE_LABEL[d.source] || d.source : "—"}</dd>
        <dt>Înregistrată</dt><dd>{d ? fmt.dateTime(d.recordedAt) : "—"}</dd>
        <dt>Expiră</dt><dd>{d?.expiresAt ? fmt.dateTime(d.expiresAt) : "—"} <span className="faint small">(cel mult {billing.maxAgeDays} de zile)</span></dd>
        <dt>Cont declarat</dt><dd className="mono">{d?.identity ? `${d.identity.short}${d.identity.basis === "tuple" ? " (pseudonim slab: doar planul)" : ""}` : d ? "nelegată de un cont" : "—"}</dd>
        <dt>Cont verificat acum</dt><dd className="mono">{current ? `${current.short}${current.basis === "tuple" ? " (pseudonim slab: doar planul)" : ""}` : "necunoscut — rulează „Verifică contul”"}</dd>
        {billing.reports?.length > 0 && <><dt>Rapoarte provider</dt><dd>{billing.reports.map((r) => `${fmt.dateTime(r.recordedAt)} ${r.status || ""}${r.errorCode ? ` ${r.errorCode}` : ""}${r.signals?.length ? ` · ${r.signals.join(", ")}` : ""}`).join(" | ")}</dd></>}
      </dl>
      <p className="faint small" style={{ margin: 0 }}>Hub-ul nu poate citi setarea înainte de execuție. Declarația ta e legată de contul verificat (pseudonim, fără e-mail), expiră după cel mult {billing.maxAgeDays} de zile și cade dacă se schimbă contul sau dacă providerul raportează consum peste plan.</p>
      {billing.state !== "valid" && (
        <>
          <p className="muted" style={{ margin: 0 }}>Verifică setarea în contul tău {providerName}, apoi tastează exact textul de mai jos. Confirmi cu Windows Hello (sesiunea de proprietar).</p>
          <pre className="pre" style={{ maxHeight: 120 }}>{attestationText}</pre>
          <textarea className="textarea" rows={2} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Textul declarației de facturare" />
        </>
      )}
      {billing.state === "valid" && (
        <details>
          <summary className="link-btn" style={{ cursor: "pointer" }}>Declară din nou</summary>
          <pre className="pre" style={{ maxHeight: 120, marginTop: 8 }}>{attestationText}</pre>
          <textarea className="textarea" rows={2} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Textul declarației de facturare" />
        </details>
      )}
      <div className="row wrap">
        <button className="btn sm" disabled={!canDeclare} onClick={declare.run} title={current?.value ? "" : "Rulează întâi „Verifică contul”"}>{declare.pending ? "Confirm…" : `Declară din nou (contul ${current?.short || "—"}, ${billing.maxAgeDays} de zile)`}</button>
        <button className="btn sm ghost" disabled={withdraw.pending} onClick={withdraw.run}>{withdraw.pending ? "Retrag…" : "Retrage declarația"}</button>
      </div>
    </div>
  );
}

/** Workspace isolation (M02 §05): what the model's tools cannot read, and the owner's consent to the Codex ACEs. */
function IsolationPanel({ voiceFirst = false }) {
  const iso = useResource("/api/isolation", { reloadOn: (e) => e.type === "settings.changed" || e.type.startsWith("provider.") });
  const [text, setText] = useState("");
  const consent = useAction(async () => { await api("/api/isolation/consent", { method: "POST", body: { provider: "codex", confirmText: text, fingerprint: iso.data.codex.fingerprint } }); setText(""); iso.reload(); refresh(); });
  const revoke = useAction(async () => { await api("/api/isolation/revoke", { method: "POST", body: { provider: "codex" } }); iso.reload(); refresh(); });
  if (iso.loading) return <Loading lines={3} />;
  if (iso.error) return <ErrorNotice error={iso.error} onRetry={iso.reload} />;
  const { codex, claude } = iso.data;
  const Row = ({ label, v }) => <li><div className="list-row"><div className="grow"><div className="title">{label}</div><div className="sub">{v.detail}</div></div><Chip tone={v.ok ? "ok" : /NEEDS_/.test(v.detail) ? "warn" : "error"}>{v.ok ? `permis · ${v.level === "os" ? "limită OS" : "limită unealtă"}` : /NEEDS_/.test(v.detail) ? "necesită aprobare" : "blocat"}</Chip></div></li>;
  return (
    <Panel title="Izolare workspace (ce nu pot citi uneltele modelului)" icon={Lock} data-lega-target="isolation">
      <div className="stack">
        <ul className="list">
          <Row label="Codex · doar citire" v={codex.readOnly} /><Row label="Codex · scriere în workspace" v={codex.workspaceWrite} />
          <Row label="Claude Code · doar citire" v={claude.readOnly} /><Row label="Claude Code · scriere/shell" v={claude.workspaceWrite} />
        </ul>
        <details>
          <summary className="link-btn" style={{ cursor: "pointer" }}>Căile negate pentru Codex pe acest calculator ({codex.paths.length} + .env oriunde în workspace) · amprentă {codex.fingerprint}</summary>
          <pre className="pre" style={{ maxHeight: 220, marginTop: 8 }}>{codex.paths.join("\n")}</pre>
        </details>
        <p className="muted small" style={{ margin: 0 }}>Sandbox-ul Windows al Codex aplică refuzul scriind reguli ACL DENY pentru grupul CodexSandboxUsers. Regulile rămân după rulare și se aplică și în Codex desktop; contul tău nu este afectat. Revenire: <span className="mono">{codex.reversal}</span>. ~/.codex nu este negat întreg (acolo rulează sandbox-ul), doar autentificarea, configurația (config.toml și copiile ei, R3) și istoricul.</p>
        {codex.consentCurrent ? (
          <div className="row wrap"><Chip tone="ok">acord înregistrat {fmt.dateTime(codex.consent.confirmedAt)}</Chip><button className="btn sm ghost" disabled={revoke.pending} onClick={revoke.run}>Retrage acordul</button></div>
        ) : (
          <div className="stack tight">
            {codex.consent && <Notice tone="warn" title="Lista s-a schimbat">Acordul anterior era pentru amprenta {codex.consent.fingerprint}; revizuiește lista și confirmă din nou.</Notice>}
            <p className="muted" style={{ margin: 0 }}>Nicio execuție Codex nu pornește pe Windows fără acest acord. Tastează exact:</p>
            <pre className="pre" style={{ maxHeight: 120 }}>{codex.consentText}</pre>
            <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text de acord pentru izolarea Codex" />
            <button className="btn sm" disabled={text !== codex.consentText || consent.pending} onClick={consent.run}>Înregistrează acordul pentru această listă</button>
          </div>
        )}
        <ErrorNotice error={consent.error || revoke.error} />
        <R2Section r2={iso.data.r2} reload={iso.reload} voiceFirst={voiceFirst} />
      </div>
    </Panel>
  );
}

/**
 * R2 (M03): the Codex sandbox reads the host outside the denied paths. Test projects are admitted (no real data in them);
 * a company project needs your explicit, time-limited acceptance of the open risk (never shown as isolation).
 */
function R2Section({ r2, reload, voiceFirst = false }) {
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [days, setDays] = useState(1);
  const accept = useAction(async () => { await api(`/api/isolation/r2/${projectId}/accept`, { method: "POST", body: { confirmText: text, days: Number(days) } }); setText(""); setProjectId(""); reload(); });
  const revoke = useAction(async (id) => { await api(`/api/isolation/r2/${id}/revoke`, { method: "POST", body: {} }); reload(); });
  if (!r2) return null;
  const real = r2.projects.filter((p) => p.source !== "hub-test");
  // M10.2 (U15): under voice-first the R2 acceptance is an admin escape hatch (risc acceptat, nu izolare): collapsed, never a plan
  // step. Withdrawing an acceptance in force is the fail-safe direction and stays visible, one click.
  const accepted = r2.projects.filter((p) => p.acceptance);
  if (voiceFirst) {
    return (
      <div className="stack tight">
        <div className="section-title">R2 · citire între proiecte (deschis)</div>
        <p className="muted small" style={{ margin: 0 }}>Un proiect real rulează într-un plan doar în mediul izolat ifrim-runner, atestat și aprobat de tine (aprobarea (b)): <a href="#/system?tab=environments">Sistem → Medii</a> (ruta proiectului și atestarea).</p>
        {accepted.length > 0 && <ul className="list">{accepted.map((p) => (
          <li key={p.id}><div className="list-row"><div className="grow"><div className="title">{p.name}</div><div className="sub">{p.codex.detail}</div></div><Chip tone="warn">risc acceptat, nu izolare</Chip>
            <button className="btn sm ghost" disabled={revoke.pending} onClick={() => revoke.run(p.id)}>Retrage</button></div></li>
        ))}</ul>}
        <details className="advanced">
          <summary className="link-btn" style={{ cursor: "pointer" }}>Avansat (cale manuală / diagnostic): R2 — risc acceptat, nu izolare</summary>
          <div className="stack tight" style={{ marginTop: 8 }}>{r2Body()}</div>
        </details>
        <ErrorNotice error={accept.error || revoke.error} />
      </div>
    );
  }
  return (
    <div className="stack tight">
      <div className="section-title">R2 · citire între proiecte (deschis)</div>
      {r2Body()}
      <ErrorNotice error={accept.error || revoke.error} />
    </div>
  );
  function r2Body() {
    return (
    <>
      <p className="muted small" style={{ margin: 0 }}>Sandbox-ul Windows al Codex citește tot calculatorul în afara căilor negate: o comandă a modelului poate deschide alte proiecte (inclusiv .env-urile lor) prin cale absolută. Codex rulează fără restricții suplimentare doar pe proiecte de test; pe un proiect real, numai dacă accepți tu riscul, pentru acel proiect și cel mult {r2.maxDays} zile. Acceptarea nu repară R2: e risc acceptat, nu izolare, și nu face proiectul eligibil pentru planuri (izolarea reală e ruta wsl-runner, în <a href="#/system?tab=environments">Sistem → Medii</a>).</p>
      <ul className="list">{r2.projects.map((p) => (
        <li key={p.id}><div className="list-row"><div className="grow"><div className="title">{p.name}{p.source === "hub-test" ? " (test)" : ""}</div><div className="sub">{p.codex.detail}</div></div>
          <Chip tone={p.codex.ok ? (p.codex.level === "owner-accepted-risk" ? "warn" : "ok") : "error"}>{p.codex.ok ? (p.codex.level === "owner-accepted-risk" ? "risc acceptat" : "proiect de test") : "Codex blocat"}</Chip>
          {p.acceptance && <button className="btn sm ghost" disabled={revoke.pending} onClick={() => revoke.run(p.id)}>Retrage</button>}</div></li>
      ))}</ul>
      {real.length > 0 && (
        <details>
          <summary className="link-btn" style={{ cursor: "pointer" }}>Accept riscul R2 pentru un proiect real (limitat în timp)</summary>
          <div className="stack tight" style={{ marginTop: 8 }}>
            <div className="row wrap">
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proiect"><option value="">Alege proiectul…</option>{real.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <select className="select" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Zile">{Array.from({ length: r2.maxDays }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} {d === 1 ? "zi" : "zile"}</option>)}</select>
            </div>
            <pre className="pre" style={{ maxHeight: 100 }}>{r2.acceptText}</pre>
            <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text de acceptare R2" />
            <button className="btn sm" disabled={!projectId || text !== r2.acceptText || accept.pending} onClick={accept.run}>Accept riscul pentru acest proiect</button>
          </div>
        </details>
      )}
    </>
    );
  }
}

function LivePanel({ integrations, onChange, voiceFirst = false }) {
  const hub = useHub((s) => s.hub);
  const [confirm, setConfirm] = useState("");
  const [form, setForm] = useState({ kind: "run", projectId: "ifrim-agent-hub", provider: "codex", access: "read-only", maxAttempts: 1, ttlMinutes: 30, maxDurationS: 900, note: "" });
  const [prefilled, setPrefilled] = useState(false); // true while the form holds values Lega filled in and the owner has not edited
  const projectList = useResource("/api/projects", { reloadOn: (e) => e.type.startsWith("project.") });
  const executable = (projectList.data?.projects || []).filter((p) => p.executionAllowed);
  // M10: the one-click Lega start exists only under the voice-first policy; under the legacy policy the old path is the way.
  // M10.2 (U15): the policy is read once by the page (Integrations) and passed in; under it the manual path is "advanced".
  const plans = (hub?.liveScopes || []).filter((s) => s.scoped !== false).length;
  // M10.2.1: while the gate is suspended, where the owner reopens it (the cockpit's rearm card, or „Continuă” after their own pause).
  const gateHint = gateRearmHint(hub?.executionGate);
  const mode = useAction(async (next) => { await api("/api/mode", { method: "POST", body: { mode: next, confirm } }); setConfirm(""); refresh(); onChange(); });
  const gate = useAction(async (action) => { await api("/api/gate", { method: "POST", body: { action, confirm, reason: action === "open" ? "Deschisă pentru validare live" : "Suspendată de utilizator" } }); setConfirm(""); refresh(); });
  // A Lega (voice) grant is always Codex, read-only, on the Hub project; attempts = voice sessions, duration = session cap.
  const grant = useAction(async () => {
    setPrefilled(false);
    const voice = form.kind === "voice";
    await api("/api/grants", { method: "POST", body: { ...form, projectId: voice ? "ifrim-agent-hub" : form.projectId, provider: voice ? "codex" : form.provider, access: voice ? "read-only" : form.access,
      maxAttempts: Number(form.maxAttempts), ttlMinutes: Number(form.ttlMinutes), maxDurationS: voice ? Math.min(1800, Number(form.maxDurationS)) : Number(form.maxDurationS) } });
    onChange();
  });
  const revoke = useAction(async (id) => { await api(`/api/grants/${id}/revoke`, { method: "POST", body: {} }); onChange(); });
  const set = (k) => (e) => { setPrefilled(false); setForm((f) => ({ ...f, [k]: e.target.value })); };
  // Lega can fill this form in (values only); the grant is created only when the owner presses "Creează grant".
  useEffect(() => {
    const apply = () => {
      const values = takeGrantPrefill();
      if (!values) return;
      setForm((f) => ({ ...f, ...pickGrantFields(values) }));
      setPrefilled(true);
    };
    apply();
    window.addEventListener("lega:prefill-grant", apply);
    return () => window.removeEventListener("lega:prefill-grant", apply);
  }, []);
  // The manual path: typed mode / gate confirmations and the grant form. Under voice-first it is the admin / diagnostic path
  // (collapsed), and the fail-safe direction (back to BUILD_SAFE, suspend the gate, revoke, Stop All) is shown above it, always one
  // click; under the legacy policy everything is laid out as before.
  const manual = (
    <>
      <div className="stack tight" data-lega-target="live-mode">
        <label className="field"><span>Confirmare (tastează LIVE_VALIDATION sau OPEN GATE)</span><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <div className="row wrap">
          {hub?.mode === "BUILD_SAFE" ? <button className="btn sm" disabled={confirm !== "LIVE_VALIDATION" || mode.pending} onClick={() => mode.run("LIVE_VALIDATION")}>Activează LIVE_VALIDATION</button>
            : !voiceFirst && <button className="btn sm" onClick={() => mode.run("BUILD_SAFE")}>Revino la BUILD_SAFE</button>}
          <span data-lega-target="gate">{hub?.executionGate?.status !== "open" ? <button className="btn sm" disabled={confirm !== "OPEN GATE" || gate.pending} onClick={() => gate.run("open")}>{voiceFirst ? "Deschide poarta (diagnostic)" : "Deschide poarta"}</button>
            : !voiceFirst && <button className="btn sm danger" onClick={() => gate.run("suspend")}>Suspendă poarta</button>}</span>
        </div>
        {/* M10.2.1 (D14): under voice-first the typed opening is the legacy administration / diagnostic path only (no owner session, no
            Windows Hello, no binding to the stop it reopens); the owner's way is the rearm card in the cockpit. It keeps working. */}
        {voiceFirst && <p className="faint small" style={{ margin: 0 }}>Deschiderea porții de aici e calea veche, de administrare / diagnostic: nu cere sesiunea ta și nici Windows Hello și nu e legată de oprirea pe care o anulează. Redeschiderea obișnuită e cardul „Redeschide poarta” din cockpit.</p>}
      </div>
      {hub?.mode === "LIVE_VALIDATION" && (
          <div className="stack tight" data-lega-target="grant-form">
            <div className="section-title">Grant nou{prefilled && <Chip tone="approval">completat de Lega · verifică</Chip>}</div>
            <div className="grid two">
              <label className="field"><span>Tip</span><select className="select" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, maxDurationS: e.target.value === "voice" ? 1200 : 900 }))}>
                <option value="run">Execuție agent</option><option value="voice">Lega (voce)</option></select></label>
              {form.kind === "run" ? <>
                <label className="field"><span>Proiect</span><select className="select" value={form.projectId} onChange={set("projectId")}>{(executable.length ? executable : [{ id: "ifrim-agent-hub", slug: "ifrim-agent-hub", name: "Ifrim Agent Hub" }]).map((p) => <option key={p.id} value={p.slug || p.id}>{p.name}</option>)}</select></label>
                <label className="field"><span>Provider</span><select className="select" value={form.provider} onChange={set("provider")}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
                <label className="field"><span>Acces</span><select className="select" value={form.access} onChange={set("access")}><option value="read-only">doar citire</option><option value="workspace-write">scriere în workspace</option></select></label>
              </> : <label className="field"><span>Durată maximă sesiune (secunde, ≤1800)</span><input className="input" type="number" min={60} max={1800} value={form.maxDurationS} onChange={set("maxDurationS")} /></label>}
              <label className="field"><span>{form.kind === "voice" ? "Sesiuni (1–5)" : "Încercări (1–5)"}</span><input className="input" type="number" min={1} max={5} value={form.maxAttempts} onChange={set("maxAttempts")} /></label>
              <label className="field"><span>Valabil (minute)</span><input className="input" type="number" min={5} max={480} value={form.ttlMinutes} onChange={set("ttlMinutes")} /></label>
            </div>
            <label className="field"><span>Scop / notă</span><input className="input" value={form.note} onChange={set("note")} placeholder="Ex.: HUB-018 un turn read-only de acceptanță" /></label>
            <button className="btn sm primary" data-lega-target="grant-create" disabled={grant.pending} onClick={grant.run}>Creează grant</button>
          </div>
      )}
    </>
  );
  return (
    <Panel title="Validare live (strict delimitată)" icon={ShieldCheck}>
      <div className="stack">
        <dl className="kv"><dt>Mod</dt><dd>{hub?.mode}{plans ? ` + ${plans} ${plans === 1 ? "plan activ" : "planuri active"} (doar pașii lor rulează live)` : ""}</dd><dt>Poartă</dt><dd><StatusChip status={hub?.executionGate?.status} /> {hub?.executionGate?.reason}</dd></dl>
        {voiceFirst
          ? <p className="muted" style={{ margin: 0 }}>Munca reală e un plan pe care îl confirmi o singură dată în cockpit: pașii lui rulează live cu granturile derivate din plan, iar Hub-ul rămâne în BUILD_SAFE. Poarta oprită o redeschizi tot în cockpit, cu Windows Hello. Calea manuală (mod, grant; poarta doar ca diagnostic) rămâne pentru administrare și execuții ad-hoc.</p>
          : <p className="muted" style={{ margin: 0 }}>O execuție cu model cere toate condițiile: modul LIVE_VALIDATION, poarta deschisă, un grant pentru provider/proiect/acces/încercări/expirare, rută de abonament verificată și backup verificat.</p>}
        {voiceFirst
          ? <p className="muted small" style={{ margin: 0 }}>Lega (voce) nu mai cere mod sau grant: pornește din sesiunea ta de proprietar (o autorizare de o sesiune, derivată și revocată automat). Grantul „Lega (voce)” din calea manuală e doar pentru folosirea fără sesiune.</p>
          : <p className="muted small" style={{ margin: 0 }}>Lega (voce) pornește fără mod sau grant după ce activezi politica voice-first (Lega → Configurare); până atunci cere LIVE_VALIDATION și un grant „Lega (voce)”.</p>}
        {voiceFirst && gateHint && (
          <Notice tone={gateHint.kind === "rearm" ? "warn" : "info"} title="Poarta e suspendată">
            {gateHint.kind === "rearm" ? "O redeschizi în cockpit, cu Windows Hello (cardul „Redeschide poarta”), legată de oprirea exactă: nimic vechi nu repornește singur și Hub-ul rămâne în BUILD_SAFE." : gateHint.text}
            <div className="row wrap" style={{ marginTop: 6 }}><a className="btn sm" href="#/lega">Deschide cockpit-ul</a></div>
          </Notice>
        )}
        {voiceFirst && (
          <div className="row wrap" role="group" aria-label="Comenzi de siguranță">
            {hub?.mode !== "BUILD_SAFE" && <button className="btn sm" disabled={mode.pending} onClick={() => mode.run("BUILD_SAFE")}>Revino la BUILD_SAFE</button>}
            {hub?.executionGate?.status === "open" && <button className="btn sm danger" disabled={gate.pending} onClick={() => gate.run("suspend")}>Suspendă poarta</button>}
            <StopAllButton />
            <span className="faint small">sensul sigur: un click, oricând</span>
          </div>
        )}
        {voiceFirst ? (
          <details className="advanced">
            <summary className="link-btn" style={{ cursor: "pointer" }}>Avansat (cale manuală / diagnostic): mod, poartă, grant nou</summary>
            <div className="stack" style={{ marginTop: 8 }}>{manual}</div>
          </details>
        ) : manual}
        {integrations.grants.length > 0 && (
          <ul className="list" data-lega-target="grants-list">{integrations.grants.slice(0, 8).map((g) => (
            <li key={g.id}><div className="list-row"><div className="grow"><div className="title">{g.kind === "voice" ? "Lega (voce)" : `${g.provider} · ${g.access}`}</div><div className="sub">{g.attemptsUsed}/{g.maxAttempts} încercări · expiră {fmt.dateTime(g.expiresAt)}{g.note ? ` · ${g.note}` : ""}</div></div><StatusChip status={g.status} />{g.status === "active" && <button className="btn sm ghost" onClick={() => revoke.run(g.id)}>Revocă</button>}</div></li>
          ))}</ul>
        )}
        <ErrorNotice error={mode.error || gate.error || grant.error || revoke.error} />
        {/* 2.12.1 (REG-02): the typed opening refused around security events with no authenticator enrolled — the Hub names the step
            (enrol it, then reopen from the cockpit with Windows Hello) and returns its link as data; the link goes there, nowhere else. */}
        {gate.error?.details?.bootstrapNeeded === true && gate.error.details.setup?.href === REARM_SETUP.href && (
          <div className="row wrap"><a className="btn sm" href={REARM_SETUP.href}>Deschide {REARM_SETUP.label}</a></div>
        )}
      </div>
    </Panel>
  );
}

export default function Integrations({ query = {} }) {
  const { data, error, loading, reload } = useResource("/api/integrations", { reloadOn: (e) => e.type.startsWith("provider.") || e.type.startsWith("grant.") || e.type === "settings.changed" });
  const [filter, setFilter] = useState("all");
  // M10.2 (U15): under the voice-first policy the manual live path and the R2 risk acceptance are "advanced" (collapsed); the
  // fail-safe controls stay visible. Read once here for both panels.
  const ownerStatus = useResource("/api/owner/status", { reloadOn: (e) => e.type.startsWith("owner.") || (e.type === "settings.changed" && e.payload?.key === "ownerPolicy") });
  const voiceFirst = Boolean(ownerStatus.data?.policy?.active);
  // #/integrations?panel=isolation (a blocker's „Deschide”, Lega's arrow) brings the isolation panel into view.
  useEffect(() => {
    if (loading || query.panel !== "isolation") return;
    document.querySelector('[data-lega-target="isolation"]')?.scrollIntoView({ block: "start" });
  }, [loading, query.panel]);
  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  const items = data.capabilities.items.filter((i) => filter === "all" || i.statuses.includes(filter));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Integrări și abonamente</h1><p>Politica de facturare este aplicată în backend: doar rutele incluse în abonament. Fiecare beneficiu are stări separate, nu un singur indicator „connected”.</p></div></div>
      <Notice tone="info" title="BillingPolicy">{Object.entries(data.billingPolicy).map(([k, v]) => `${k}: ${v}`).join(" · ")}</Notice>
      {data.environment.riskyVariablesPresent.length > 0 && <div style={{ marginTop: 12 }}><Notice tone="warn" title="Variabile de mediu cu risc de facturare">{data.environment.riskyVariablesPresent.join(", ")}. {data.environment.note}</Notice></div>}
      <div className="grid two" style={{ marginTop: 16 }}>
        {data.providers.map((p) => <ProviderCard key={p.id} provider={p} attestationText={data.attestationText[p.id]} onChange={() => { reload(); refresh(); }} />)}
      </div>
      <div style={{ marginTop: 16 }}><IsolationPanel voiceFirst={voiceFirst} /></div>
      <div style={{ marginTop: 16 }}><LivePanel integrations={data} onChange={reload} voiceFirst={voiceFirst} /></div>
      <div style={{ marginTop: 16 }}>
        <Panel title={`Registru capabilități · verificat ${data.capabilities.verifiedOn}`} icon={Plug} actions={
          <select className="select" style={{ width: "auto", minHeight: 30 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtru stare">
            <option value="all">Toate</option>{data.capabilities.statusVocabulary.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>} flush>
          {items.length ? <ul className="list">{items.map((i) => (
            <li key={i.id}><details className="list-row" style={{ display: "block" }}>
              <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{i.feature}</strong>{i.statuses.map((s) => <Chip key={s} tone={STATUS_TONE[s]}>{s}</Chip>)}{!i.sourceRead && <Chip tone="warn">sursă necitită</Chip>}
              </summary>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Sursă</dt><dd className="mono">{i.source}</dd><dt>Platformă</dt><dd>{i.platform}</dd><dt>Plan</dt><dd>{i.planRequired}</dd><dt>Rollout</dt><dd>{i.rollout}</dd>
                <dt>Eligibilitate cont</dt><dd>{i.accountEligibility}</dd><dt>Traseu</dt><dd>{i.integrationRoute}</dd><dt>Facturare</dt><dd>{i.billing}</dd>
                <dt>Permisiuni</dt><dd>{i.permissions}</dd><dt>Test</dt><dd>{i.test}</dd><dt>Limitări</dt><dd>{i.limitations}</dd><dt>Pasul următor</dt><dd>{i.nextStep}</dd>
              </dl>
            </details></li>
          ))}</ul> : <Empty title="Nicio intrare cu această stare" />}
        </Panel>
      </div>
      <p className="faint" style={{ fontSize: 12 }}><ExternalLink size={12} /> {data.capabilities.note}</p>
    </div>
  );
}
