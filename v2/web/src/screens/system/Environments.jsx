import { useState } from "react";
import { RefreshCw, ShieldCheck, UserCheck, FlaskConical, Flame, Route, Trash2 } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction } from "../../store.js";
import { Panel, Loading, ErrorNotice, Empty, Chip, Notice } from "../../components/ui.jsx";
import { STEP_LABELS, boundaryOf, environmentSummary, policyFormProblem, canaryRows } from "../../lib/environmentLogic.js";

const reloadOn = (e) => e.type.startsWith("environment.") || e.type === "settings.changed" || e.type.startsWith("run.");

/**
 * Execution environments (M05 §24): what is installed, attested and approved, where each stage of a project runs, and the
 * owner's two decisions (the project route, the policy approval (b)). Nothing here starts a model; the checks are
 * inference-free and run only when you click them.
 */
export default function EnvironmentsTab() {
  const res = useResource("/api/environments", { reloadOn });
  if (res.loading && !res.data) return <Loading lines={6} />;
  if (res.error && !res.data) return <ErrorNotice error={res.error} onRetry={res.reload} />;
  const { environments = [], projects = [], policyText, notes = [], warmup } = res.data;
  return (
    <div className="stack">
      {environments.map((env) => <EnvironmentPanel key={env.id} env={env} policyText={policyText} reload={res.reload} />)}
      <ProjectRoutes projects={projects} reload={res.reload} />
      <WarmupPanel warmup={warmup} reload={res.reload} />
      <Notice tone="info" title="Limite care rămân">{notes.map((n) => <div key={n}>{n}</div>)}</Notice>
    </div>
  );
}

function EnvironmentPanel({ env, policyText, reload }) {
  const [text, setText] = useState("");
  const post = (path, body = {}) => api(`/api/environments/${env.id}/${path}`, { method: "POST", body });
  const inspect = useAction(async () => { await post("inspect"); reload(); });
  const probe = useAction(async () => { await post("probe"); reload(); });
  const attest = useAction(async () => { await post("attest", { allowRestart: true }); reload(); });
  const approve = useAction(async () => { await post("policy", { confirmText: text, fingerprintHash: env.inspection?.fingerprint?.hash }); setText(""); reload(); });
  const revoke = useAction(async () => { await post("policy/revoke"); reload(); });
  const reconcile = useAction(async () => { await post("reconcile"); reload(); });
  const release = useAction(async (id) => { await api(`/api/environments/${env.id}/workspaces/${encodeURIComponent(id)}/release`, { method: "POST", body: {} }); reload(); });
  const summary = environmentSummary(env);
  const fp = env.inspection?.fingerprint;
  const problem = policyFormProblem({ text, policyText, fingerprintHash: fp?.hash, attestationValid: env.attestation?.valid });
  const busy = inspect.pending || probe.pending || attest.pending;
  return (
    <Panel title={`Mediu de execuție · ${env.label} — ${env.covers || "writer, verificări, QA"}`} icon={ShieldCheck}
      actions={<button className="btn sm ghost" disabled={busy} onClick={inspect.run}><RefreshCw size={14} />{inspect.pending ? "Se inspectează…" : "Inspectează"}</button>}>
      <div className="stack">
        <Notice tone={summary.tone} title={summary.text}>Fiecare treaptă are starea ei; niciuna nu o implică pe următoarea. Atestarea e locală, fără model (nu e o probă live).</Notice>
        <ol className="list" aria-label="Trepte de pregătire">
          {env.ladder.map((l) => (
            <li key={l.step}><div className="list-row"><div className="grow"><div className="title">{STEP_LABELS[l.step] || l.label}</div><div className="sub">{l.detail}</div></div>
              <Chip tone={l.informational ? "neutral" : l.ok ? "ok" : l.step === "policy" || l.step === "live" ? "neutral" : "warn"}>{l.informational ? "info" : l.ok ? "da" : "nu"}</Chip></div></li>
          ))}
        </ol>
        {env.inspection && (
          <details>
            <summary className="link-btn" style={{ cursor: "pointer" }}>Inspecție {fmt.ago(env.inspection.inspectedAt)} · {env.inspection.durationMs ?? "—"} ms · amprentă {fp?.hash || "—"}</summary>
            <div className="stack tight" style={{ marginTop: 8 }}>
              {fp && <pre className="pre" style={{ maxHeight: 80 }}>{fp.line}</pre>}
              <dl className="kv">{Object.entries(env.inspection.facts || {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v ?? "—"}</dd></div>)}</dl>
              {(env.inspection.problems || []).map((p) => <Notice key={p.code + p.detail} tone={p.blocking ? "error" : "warn"} title={p.code}>{p.detail}</Notice>)}
              {env.inspection.error && <Notice tone="error" title="Inspecția a eșuat">{env.inspection.error}</Notice>}
            </div>
          </details>
        )}
        <div className="row wrap">
          <button className="btn sm" disabled={busy || !env.inspection?.installed} onClick={probe.run}><UserCheck size={14} />{probe.pending ? "Se verifică…" : "Verifică contul prin mediu (C16)"}</button>
          <button className="btn sm" disabled={busy || !env.inspection?.installed || env.inUse?.length > 0} onClick={attest.run} title={env.inUse?.length ? "Mediul e folosit acum" : ""}>
            <FlaskConical size={14} />{attest.pending ? "Atestarea rulează (câteva minute)…" : "Rulează atestarea C1–C17"}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Verificarea contului și atestarea nu pornesc niciun model: handshake, cont, limite, profiluri, lista de modele; canary-ul folosește fișiere fictive și repornește distribuția la C15 (doar când nu rulează nimic în ea).</p>
        {env.account && (
          <details>
            <summary className="link-btn" style={{ cursor: "pointer" }}>Cont prin mediu: {env.account.accountType || "—"} · {env.account.planType || "—"} · {env.account.models.length} modele · {fmt.ago(env.account.probedAt)}</summary>
            <pre className="pre" style={{ maxHeight: 140, marginTop: 8 }}>{env.account.c16.join("\n")}</pre>
          </details>
        )}
        {env.attestation?.latest ? (
          <details>
            <summary className="link-btn" style={{ cursor: "pointer" }}>Atestare {env.attestation.latest.status} · {fmt.ago(env.attestation.latest.finishedAt)} · {env.attestation.latest.summary}</summary>
            <div className="row wrap" style={{ marginTop: 8 }}>{canaryRows(env.attestation.latest.byId).map((r) => <Chip key={r.id} tone={r.status === "PASS" ? "ok" : r.status === "FAIL" ? "error" : "neutral"}>{r.id} {r.status}</Chip>)}</div>
            <pre className="pre" style={{ maxHeight: 200, marginTop: 8 }}>{env.attestation.latest.lines.map((l) => `${l.sub} ${l.status} ${l.detail}`).join("\n")}</pre>
            <p className="muted small">Etape acoperite de această atestare: {(env.attestation.latest.stages || []).join(", ") || "niciuna"} (preview, E2E, review și vocea nu sunt acoperite).</p>
          </details>
        ) : <Empty title="Neatestat">Canary-ul C1–C17 nu a rulat prin Hub pe acest mediu.</Empty>}
        <div className="section-title">Aprobarea (b): host_isolation = environment pentru proiecte reale</div>
        {env.policy.valid ? (
          <div className="row wrap"><Chip tone="ok">aprobat {fmt.dateTime(env.policy.approval.approvedAt)} · amprenta {env.policy.approval.fingerprintHash}</Chip>
            <button className="btn sm ghost" disabled={revoke.pending} onClick={revoke.run}>Retrage aprobarea</button></div>
        ) : (
          <div className="stack tight">
            {env.policy.approval && <Notice tone="warn" title="Aprobarea nu mai corespunde">A fost dată pentru amprenta {env.policy.approval.fingerprintHash}; mediul are acum {fp?.hash || "—"}.</Notice>}
            <p className="muted small" style={{ margin: 0 }}>Doar tu decizi. Proiectele de test nu au nevoie de ea. Tastează exact textul de mai jos (amprenta afișată: {fp?.hash || "—"}):</p>
            <pre className="pre" style={{ maxHeight: 140 }}>{policyText}</pre>
            <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Textul aprobării (b)" />
            <button className="btn sm" disabled={Boolean(problem) || approve.pending} onClick={approve.run} title={problem || ""}>Aprob pentru această amprentă</button>
            {problem && text && <span className="faint small">{problem}</span>}
          </div>
        )}
        {env.workspaces?.length > 0 && (
          <details>
            <summary className="link-btn" style={{ cursor: "pointer" }}>Workspace-uri recente în mediu ({env.workspaces.length})</summary>
            <div className="table-wrap" style={{ marginTop: 8 }}><table className="table"><thead><tr><th>Id</th><th>Scop</th><th>Stare</th><th>Fișiere</th><th>Export</th><th /></tr></thead><tbody>
              {env.workspaces.map((w) => (
                <tr key={w.id}><td className="mono small">{w.id}</td><td>{w.purpose}</td><td><Chip tone={["released", "applied"].includes(w.status) ? "ok" : ["refused", "conflict", "orphaned", "retained", "failed"].includes(w.status) ? "warn" : "info"}>{w.status}</Chip></td>
                  <td>{w.files ?? "—"}</td><td className="small">{w.export ? `${w.export.ok ? "valid" : "refuzat"} · +${w.export.added} ~${w.export.modified} -${w.export.deleted}${w.export.refused ? ` · ${w.export.refused} refuzuri` : ""}${w.export.conflicts ? ` · ${w.export.conflicts} conflicte` : ""}${w.export.ignoredByProject ? ` · ${w.export.ignoredByProject} lăsate deoparte (.gitignore)` : ""}${w.export.ignoreRulesError ? " · regulile .gitignore necitite" : ""}` : "—"}</td>
                  <td>{["orphaned", "retained"].includes(w.status) && <button className="btn sm ghost" disabled={release.pending} onClick={() => release.run(w.id)} aria-label={`Șterge ${w.id}`}><Trash2 size={13} /></button>}</td></tr>
              ))}
            </tbody></table></div>
            <button className="btn sm ghost" disabled={reconcile.pending} onClick={reconcile.run} style={{ marginTop: 8 }}>Oprește procesele rămase în workspace-urile orfane</button>
          </details>
        )}
        <ErrorNotice error={inspect.error || probe.error || attest.error || approve.error || revoke.error || reconcile.error || release.error} />
      </div>
    </Panel>
  );
}

function ProjectRoutes({ projects, reload }) {
  const set = useAction(async ({ id, environment }) => { await api(`/api/projects/${encodeURIComponent(id)}/environment`, { method: "POST", body: { environment } }); reload(); });
  if (!projects.length) return null;
  return (
    <Panel title="Ruta Codex pe proiect și harta etapelor" icon={Route}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Ruta e decizia ta pentru fiecare proiect. „wsl-runner” nu slăbește poarta: dacă mediul nu e atestat (și, pentru proiecte reale, aprobat), execuția e refuzată, nu mutată pe Windows.</p>
        {projects.map((p) => (
          <details key={p.id}>
            <summary style={{ cursor: "pointer" }}>
              <span className="title">{p.name}{p.source === "hub-test" ? " (test)" : ""}</span>{" "}
              <Chip tone={p.route === "windows" ? "neutral" : p.host?.ok ? "info" : "warn"}>{p.route}{p.stageMap && p.route !== "windows" ? ` · ${p.stageMap.inEnvironment}/${p.stageMap.total} etape în mediu` : ""}</Chip>{" "}
              {p.stageMap && <Chip tone={p.stageMap.realProjectEligible ? "ok" : "neutral"}>{p.stageMap.realProjectEligible ? "REAL_PROJECT_ELIGIBLE" : "nu e eligibil pentru date reale"}</Chip>}
            </summary>
            <div className="stack tight" style={{ marginTop: 8 }}>
              {p.host && <Notice tone={p.host.ok ? "info" : "warn"} title="Poarta pe această rută">{p.host.detail}</Notice>}
              {p.stageMap && (
                <ul className="list">{p.stageMap.stages.map((s) => {
                  const b = boundaryOf(s.boundary);
                  return <li key={s.stage}><div className="list-row"><div className="grow"><div className="title">{s.label}</div><div className="sub">{s.where}{s.detail ? ` · ${s.detail}` : ""}</div></div><Chip tone={b.tone}>{b.label}</Chip></div></li>;
                })}</ul>
              )}
              <div className="row wrap">
                <button className="btn sm ghost" disabled={set.pending || p.route === "windows"} onClick={() => set.run({ id: p.id, environment: "windows" })}>Ruta Windows</button>
                <button className="btn sm" disabled={set.pending || p.route === "wsl-runner"} onClick={() => set.run({ id: p.id, environment: "wsl-runner" })}>Ruta wsl-runner</button>
              </div>
            </div>
          </details>
        ))}
        <ErrorNotice error={set.error} />
      </div>
    </Panel>
  );
}

function WarmupPanel({ warmup, reload }) {
  const [result, setResult] = useState(null);
  const run = useAction(async (route) => { setResult(await api("/api/environments/warmup", { method: "POST", body: { route } })); reload(); });
  const configure = useAction(async (onBoot) => { await api("/api/environments/warmup/configure", { method: "POST", body: { onBoot } }); reload(); });
  return (
    <Panel title="Pregătirea sandbox-ului (fără model)" icon={Flame}>
      <div className="stack tight">
        <p className="muted small" style={{ margin: 0 }}>După o repornire a calculatorului, prima comandă în sandbox-ul Windows a durat ~145 s (măsurat 2026-10-01). Pregătirea rulează o comandă banală într-un folder gol și arată cât durează; nu rulează cod de proiect.</p>
        <div className="row wrap">
          <button className="btn sm" disabled={run.pending} onClick={() => run.run("windows")}>Pregătește Windows</button>
          <button className="btn sm" disabled={run.pending} onClick={() => run.run("wsl-runner")}>Pregătește wsl-runner</button>
          <label className="row small"><input type="checkbox" checked={Boolean(warmup?.onBoot)} disabled={configure.pending} onChange={(e) => configure.run(e.target.checked)} /> la pornirea Hub-ului (Windows)</label>
        </div>
        {result && <Notice tone={result.ok ? "ok" : "warn"} title={result.ok ? `Sandbox ${result.environment}: ${result.sandboxMs} ms` : `Pregătirea ${result.environment} a eșuat`}>{result.reason || "Măsurat acum; prima rulare după repornire e mai lentă decât următoarele."}</Notice>}
        <ErrorNotice error={run.error || configure.error} />
      </div>
    </Panel>
  );
}
