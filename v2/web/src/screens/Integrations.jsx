import { useState } from "react";
import { Plug, ShieldCheck, KeyRound, Search as SearchIcon, ExternalLink } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, useHub, refresh } from "../store.js";
import { Panel, Loading, ErrorNotice, Chip, Checks, Notice, StatusChip, Empty } from "../components/ui.jsx";

const STATUS_TONE = { DOCUMENTED: "neutral", ACCOUNT_ELIGIBLE: "info", AUTHENTICATED: "info", IMPLEMENTED: "info", TESTED_LIVE: "ok", TESTED_SIMULATED: "info", ASSISTED_ONLY: "warn", BLOCKED: "error" };

function ProviderCard({ provider, attestationText, onChange }) {
  const inspect = useAction(async () => { await api(`/api/providers/${provider.id}/inspect`, { method: "POST", body: {} }); onChange(); });
  const probe = useAction(async (withModels) => { await api(`/api/providers/${provider.id}/probe`, { method: "POST", body: { withModels } }); onChange(); });
  const [confirmText, setConfirmText] = useState("");
  const attest = useAction(async () => { await api("/api/billing/attest", { method: "POST", body: { provider: provider.id, confirmText } }); setConfirmText(""); onChange(); });
  const attestationCheck = provider.route.checks.find((c) => c.id === "provider_side_overage_setting");
  return (
    <Panel title={provider.displayName} icon={Plug} actions={<Chip tone={provider.route.allowed ? "ok" : "warn"}>{provider.route.allowed ? "rută inclusă verificată" : "blocat"}</Chip>}>
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
        {attestationCheck?.status !== "verified" && (
          <div className="stack tight">
            <div className="section-title"><KeyRound size={12} /> Verificare manuală de facturare</div>
            <p className="muted" style={{ margin: 0 }}>Hub-ul nu poate citi această setare. Verifică-o în contul tău, apoi tastează exact textul de mai jos:</p>
            <pre className="pre" style={{ maxHeight: 120 }}>{attestationText}</pre>
            <textarea className="textarea" rows={2} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Text de confirmare" />
            <button className="btn sm" disabled={confirmText !== attestationText || attest.pending} onClick={attest.run}>Înregistrează verificarea (valabilă 30 de zile)</button>
          </div>
        )}
        <ErrorNotice error={inspect.error || probe.error || attest.error} />
      </div>
    </Panel>
  );
}

function LivePanel({ integrations, onChange }) {
  const hub = useHub((s) => s.hub);
  const [confirm, setConfirm] = useState("");
  const [form, setForm] = useState({ provider: "codex", access: "read-only", maxAttempts: 1, ttlMinutes: 30, maxDurationS: 900, note: "" });
  const mode = useAction(async (next) => { await api("/api/mode", { method: "POST", body: { mode: next, confirm } }); setConfirm(""); refresh(); onChange(); });
  const gate = useAction(async (action) => { await api("/api/gate", { method: "POST", body: { action, confirm, reason: action === "open" ? "Deschisă pentru validare live" : "Suspendată de utilizator" } }); setConfirm(""); refresh(); });
  const grant = useAction(async () => { await api("/api/grants", { method: "POST", body: { ...form, projectId: "ifrim-agent-hub", maxAttempts: Number(form.maxAttempts), ttlMinutes: Number(form.ttlMinutes), maxDurationS: Number(form.maxDurationS) } }); onChange(); });
  const revoke = useAction(async (id) => { await api(`/api/grants/${id}/revoke`, { method: "POST", body: {} }); onChange(); });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Panel title="Validare live (strict delimitată)" icon={ShieldCheck}>
      <div className="stack">
        <dl className="kv"><dt>Mod</dt><dd>{hub?.mode}</dd><dt>Poartă</dt><dd><StatusChip status={hub?.executionGate?.status} /> {hub?.executionGate?.reason}</dd></dl>
        <p className="muted" style={{ margin: 0 }}>O execuție cu model cere toate condițiile: modul LIVE_VALIDATION, poarta deschisă, un grant pentru provider/proiect/acces/încercări/expirare, rută de abonament verificată și backup verificat.</p>
        <label className="field"><span>Confirmare (tastează LIVE_VALIDATION sau OPEN GATE)</span><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <div className="row wrap">
          {hub?.mode === "BUILD_SAFE" ? <button className="btn sm" disabled={confirm !== "LIVE_VALIDATION" || mode.pending} onClick={() => mode.run("LIVE_VALIDATION")}>Activează LIVE_VALIDATION</button>
            : <button className="btn sm" onClick={() => mode.run("BUILD_SAFE")}>Revino la BUILD_SAFE</button>}
          {hub?.executionGate?.status !== "open" ? <button className="btn sm" disabled={confirm !== "OPEN GATE" || gate.pending} onClick={() => gate.run("open")}>Deschide poarta</button>
            : <button className="btn sm danger" onClick={() => gate.run("suspend")}>Suspendă poarta</button>}
        </div>
        {hub?.mode === "LIVE_VALIDATION" && (
          <div className="stack tight">
            <div className="section-title">Grant nou (Agent Hub)</div>
            <div className="grid two">
              <label className="field"><span>Provider</span><select className="select" value={form.provider} onChange={set("provider")}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
              <label className="field"><span>Acces</span><select className="select" value={form.access} onChange={set("access")}><option value="read-only">doar citire</option><option value="workspace-write">scriere în workspace</option></select></label>
              <label className="field"><span>Încercări (1–5)</span><input className="input" type="number" min={1} max={5} value={form.maxAttempts} onChange={set("maxAttempts")} /></label>
              <label className="field"><span>Valabil (minute)</span><input className="input" type="number" min={5} max={480} value={form.ttlMinutes} onChange={set("ttlMinutes")} /></label>
            </div>
            <label className="field"><span>Scop / notă</span><input className="input" value={form.note} onChange={set("note")} placeholder="Ex.: HUB-018 un turn read-only de acceptanță" /></label>
            <button className="btn sm primary" disabled={grant.pending} onClick={grant.run}>Creează grant</button>
          </div>
        )}
        {integrations.grants.length > 0 && (
          <ul className="list">{integrations.grants.slice(0, 8).map((g) => (
            <li key={g.id}><div className="list-row"><div className="grow"><div className="title">{g.provider} · {g.access}</div><div className="sub">{g.attemptsUsed}/{g.maxAttempts} încercări · expiră {fmt.dateTime(g.expiresAt)}{g.note ? ` · ${g.note}` : ""}</div></div><StatusChip status={g.status} />{g.status === "active" && <button className="btn sm ghost" onClick={() => revoke.run(g.id)}>Revocă</button>}</div></li>
          ))}</ul>
        )}
        <ErrorNotice error={mode.error || gate.error || grant.error || revoke.error} />
      </div>
    </Panel>
  );
}

export default function Integrations() {
  const { data, error, loading, reload } = useResource("/api/integrations", { reloadOn: (e) => e.type.startsWith("provider.") || e.type.startsWith("grant.") || e.type === "settings.changed" });
  const [filter, setFilter] = useState("all");
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
      <div style={{ marginTop: 16 }}><LivePanel integrations={data} onChange={reload} /></div>
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
