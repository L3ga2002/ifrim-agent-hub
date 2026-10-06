import { useState } from "react";
import { Factory, ShieldCheck, Square, Pause, Play, CheckCircle2, XCircle, FileDiff, ListChecks, Timer, Package, AlertTriangle } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, pushToast } from "../../store.js";
import { FACTORY_STAGE_RO, FACTORY_PATH, factoryWaitLabel, factoryProgress, formatMs, parseCriteriaLines, mergeCriteria } from "../../lib/uiLogic.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Notice, Chip, DiffView, Dialog } from "../../components/ui.jsx";
import { boundaryOf } from "../../lib/environmentLogic.js";

const SEVERITY_TONE = { critical: "error", high: "error", medium: "warn", low: "neutral", info: "neutral" };
const EVIDENCE_TONE = { PASS: "ok", FAIL: "error", INCONCLUSIVE: "warn", BLOCKED: "error", NOT_RUN: "neutral", NEEDS_INSTALL_APPROVAL: "warn" };
const ACTIVE = new Set(["BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW"]);

/** Stage path with the current position; side states (pause, block, decision) shown next to it. */
function StageBar({ view }) {
  const { current, side } = factoryProgress(view);
  return (
    <div className="stack tight">
      <ol className="row wrap" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }} aria-label="Etapele misiunii">
        {FACTORY_PATH.map((stage, i) => (
          <li key={stage}><span className={`chip ${i < current ? "ok" : i === current ? (side ? "warn" : "info") : "neutral"}`} aria-current={i === current ? "step" : undefined}>{FACTORY_STAGE_RO[stage]}</span></li>
        ))}
      </ol>
      {side && <div><Chip tone={side === "CANCELLED" || side === "REJECTED" ? "neutral" : "warn"} icon={AlertTriangle}>{FACTORY_STAGE_RO[side] || side}</Chip></div>}
    </div>
  );
}

/** The exact scope the owner approves; approve + start in one click (the approval is bound to the hash shown). */
function ScopeApproval({ view, reload }) {
  const [pending, setPending] = useState(null);
  const request = useAction(async () => {
    const res = await api(`/api/factory/${view.mission.id}/start`, { method: "POST", body: view.scope });
    if (res.approvalRequired) setPending(res); else reload();
  });
  const approve = useAction(async () => {
    await api(`/api/approvals/${pending.approval.id}/decide`, { method: "POST", body: { decision: "approved", displayedHash: pending.approval.payloadHash, note: "" } });
    // The HTTP layer answers 202 { approvalRequired, approval, commandId } for an approval-gated command.
    await api(`/api/commands/${pending.commandId}/execute`, { method: "POST", body: {} });
    setPending(null); pushToast(`factory-${view.mission.id}`, "ok", "Scope aprobat: misiunea a pornit cu baseline-ul"); reload();
  });
  const s = view.scope;
  if (!s) return null;
  return (
    <Panel title="Aprobă scope-ul" icon={ShieldCheck}>
      <div className="stack tight">
        <p className="muted" style={{ margin: 0 }}>Aprobi exact: specificația v{s.specVersion} (<span className="mono">{s.specSha.slice(0, 12)}</span>), planul (<span className="mono">{s.planSha.slice(0, 12)}</span>),
          writer {s.routes.writer.provider} ({s.routes.writer.access}{s.bindings?.writer ? `, ${s.bindings.writer.resolvedAlias} · ${s.bindings.writer.effort}` : ""}), reviewer {s.routes.reviewer.provider} ({s.routes.reviewer.access}{s.bindings?.reviewer ? `, ${s.bindings.reviewer.resolvedAlias} · ${s.bindings.reviewer.effort}` : ""}), profil {s.limits.profile},
          cel mult {s.limits.maxRepairCycles} cicluri de remediere, {s.limits.maxDurationMin} min. Comenzi: {[...s.commands.checks, ...s.commands.acceptance].join(", ")}{s.commands.preview ? `; preview ${s.commands.preview.command}` : ""}.</p>
        <Notice tone="info">Aprobarea nu creează granturi și nu deschide poarta: fiecare execuție trece prin poartă, cu grantul ei. Vocea nu poate aproba.</Notice>
        {!pending ? <div><button className="btn primary" disabled={request.pending} onClick={request.run} data-lega-target="factory-approve-scope">Cere aprobarea scope-ului</button></div> : (
          <div className="stack tight">
            <div className="faint">Hash afișat: <span className="mono">{pending.approval.payloadHash.slice(0, 16)}…</span></div>
            <div className="row wrap"><button className="btn primary" disabled={approve.pending} onClick={approve.run}>Aprobă și pornește</button><button className="btn ghost" onClick={() => setPending(null)}>Renunță</button></div>
          </div>
        )}
        <ErrorNotice error={request.error || approve.error} />
      </div>
    </Panel>
  );
}

/**
 * M10.2 (U15): under the voice-first policy the scope of a draft is confirmed as ONE plan (the envelope: the exact spec, models,
 * limits and what never happens) in the cockpit — the Hub derives the grants itself and stays in BUILD_SAFE. This only PROPOSES
 * the plan (nothing starts, no grant) and opens the cockpit, where the card is restored from the Hub and confirmed once.
 */
function PlanFromFactory({ view }) {
  const propose = useAction(async () => {
    const out = await api("/api/envelopes", { method: "POST", body: { projectId: view.mission.projectId, missionIds: [view.mission.id] } });
    if (!out?.envelope) pushToast(`factory-plan-${view.mission.id}`, "warn", `Planul nu e complet: ${(out?.summary?.blockers || []).slice(0, 2).join(" · ") || "vezi cockpit-ul"}`);
    window.location.hash = `#/lega/${encodeURIComponent(view.mission.projectId)}`;
  });
  if (!view.scope) return null;
  return (
    <Panel title="Planul (o singură confirmare)" icon={ShieldCheck}>
      <div className="stack tight">
        <p className="muted" style={{ margin: 0 }}>Îți arăt planul exact în cockpit: specificația v{view.scope.specVersion}, modelele, limitele, ce nu se face niciodată. Îl confirmi o dată (click, Enter sau vocea ta verificată local); granturile tehnice le derivă Hub-ul din plan, iar Hub-ul rămâne în BUILD_SAFE.</p>
        <div><button className="btn primary" disabled={propose.pending} onClick={propose.run} data-lega-target="factory-plan">{propose.pending ? "Pregătesc planul…" : "Arată-mi planul (o confirmare)"}</button></div>
        <ErrorNotice error={propose.error} />
      </div>
    </Panel>
  );
}

/** A new spec version (the approved one is never edited). */
function SpecEditor({ view, onClose, reload }) {
  const spec = view.spec.spec;
  const [form, setForm] = useState({
    objective: spec.objective, criteria: spec.acceptance.map((a) => `${a.text} | ${a.verify}${a.testRef ? ` | ${a.testRef}` : ""}`).join("\n"),
    checks: spec.verification.checks.join("\n"), acceptance: spec.verification.acceptance.join("\n"),
    previewCommand: spec.verification.preview?.command || "", previewUrl: spec.verification.preview?.url || "",
    inScope: spec.inScope.join("\n"), outOfScope: spec.outOfScope.join("\n"), constraints: spec.constraints.join("\n"), ignore: (spec.workspace?.ignore || []).join("\n"),
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const lines = (t) => t.split("\n").map((s) => s.trim()).filter(Boolean);
  const save = useAction(async () => {
    await api(`/api/factory/${view.mission.id}/spec`, { method: "POST", body: { spec: { objective: form.objective, acceptance: mergeCriteria(parseCriteriaLines(form.criteria), spec.acceptance),
      verification: { checks: lines(form.checks), acceptance: lines(form.acceptance), ...(form.previewCommand.trim() ? { preview: { command: form.previewCommand.trim(), url: form.previewUrl.trim() } } : {}) },
      inScope: lines(form.inScope), outOfScope: lines(form.outOfScope), constraints: lines(form.constraints), workspace: { ignore: lines(form.ignore) } } } });
    onClose(); reload();
  });
  return (
    <Dialog title={`Specificația v${view.spec.version + 1}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={save.pending} onClick={save.run}>Salvează versiunea nouă</button></>}>
      <label className="field"><span>Obiectiv</span><textarea className="textarea" rows={3} value={form.objective} onChange={set("objective")} /></label>
      <label className="field"><span>Criterii (text | test/review/manual/e2e/preview | cale test); pașii E2E și eșecul așteptat al criteriilor existente se păstrează</span><textarea className="textarea mono" rows={5} value={form.criteria} onChange={set("criteria")} /></label>
      <div className="grid two">
        <label className="field"><span>Verificări locale (comenzi)</span><textarea className="textarea mono" rows={2} value={form.checks} onChange={set("checks")} placeholder="node --test" /></label>
        <label className="field"><span>Teste de acceptanță (comenzi)</span><textarea className="textarea mono" rows={2} value={form.acceptance} onChange={set("acceptance")} placeholder="node --test test/acceptance.test.mjs" /></label>
        <label className="field"><span>Preview: comandă (opțional)</span><input className="input mono" value={form.previewCommand} onChange={set("previewCommand")} placeholder="node server.js" /></label>
        <label className="field"><span>Preview: URL local</span><input className="input mono" value={form.previewUrl} onChange={set("previewUrl")} placeholder="http://127.0.0.1:4610/" /></label>
        <label className="field"><span>În scope</span><textarea className="textarea" rows={2} value={form.inScope} onChange={set("inScope")} /></label>
        <label className="field"><span>În afara scope-ului</span><textarea className="textarea" rows={2} value={form.outOfScope} onChange={set("outOfScope")} /></label>
        <label className="field"><span>Restricții</span><textarea className="textarea" rows={2} value={form.constraints} onChange={set("constraints")} /></label>
        <label className="field"><span>Foldere de date generate la rulare (ignorate)</span><textarea className="textarea mono" rows={2} value={form.ignore} onChange={set("ignore")} placeholder="data" /></label>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Comenzi acceptate: node --test [căi], npm test, npm run build|lint|typecheck|test. Testele numite în criterii trebuie să existe înainte de aprobare: devin protejate.</p>
      <ErrorNotice error={save.error} />
    </Dialog>
  );
}

function RunTimeline({ run }) {
  const t = run.timeline;
  const max = Math.max(1, ...t.segments.map((s) => s.ms));
  return (
    <div className="stack tight">
      <div className="row wrap" style={{ gap: 8 }}>
        <StatusChip status={run.status} /><span className="mono">{run.provider}</span><span>{run.stage}</span>
        <span>model <span className="mono">{run.model || "—"}</span></span><span>efort <span className="mono">{run.effort || "—"}</span> ({run.plan?.effortSource || "—"}{run.plan?.reported?.effort ? `; raportat ${run.plan.reported.effort}` : ""})</span>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>Admitere Hub {formatMs(t.keySpans.hubAdmissionMs)} · turn → prima comandă {formatMs(t.keySpans.turnToFirstCommandMs)} · prima comandă {formatMs(t.keySpans.firstCommandExecutionMs)} · total {formatMs(t.keySpans.totalMs)}</div>
      <ul className="plain-list" style={{ fontSize: 12 }}>
        {t.segments.map((s) => (
          <li key={`${s.from}-${s.to}`} className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span style={{ width: 180, maxWidth: "100%" }} className="ellipsis">{s.label}</span>
            <span aria-hidden="true" style={{ display: "inline-block", height: 6, borderRadius: 3, width: `${Math.max(2, (s.ms / max) * 160)}px`, background: s.owner === "human" ? "var(--approval)" : s.owner === "hub" ? "var(--info, #3b82f6)" : "var(--warn, #f59e0b)" }} />
            <span className="mono">{formatMs(s.ms)}</span><span className="faint">{s.owner}</span>
          </li>
        ))}
      </ul>
      {run.errorMessage && <div className="faint" style={{ fontSize: 12 }}>{run.errorCategory}: {run.errorMessage}</div>}
    </div>
  );
}

function FindingRow({ finding, missionId, reload }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const mark = useAction(async (status) => { await api(`/api/factory/${missionId}/findings/${finding.code}`, { method: "POST", body: { status, note } }); setEditing(false); reload(); });
  return (
    <li>
      <div className="stack tight" style={{ padding: "8px 0" }}>
        <div className="row wrap" style={{ gap: 8 }}><span className="mono">{finding.code}</span><Chip tone={SEVERITY_TONE[finding.severity] || "neutral"}>{finding.severity}</Chip><Chip>{finding.status}</Chip><span className="faint">{finding.source}</span><span className="mono ellipsis">{finding.file}</span></div>
        <div>{finding.observation}</div>
        {finding.evidence && <div className="faint mono" style={{ fontSize: 12 }}>{finding.evidence}</div>}
        {finding.status === "OPEN" && !editing && <div><button className="btn sm ghost" onClick={() => setEditing(true)}>Marchează (fals pozitiv / contestat)</button></div>}
        {editing && (
          <div className="row wrap">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivul (obligatoriu)" />
            <button className="btn sm" disabled={note.trim().length < 5 || mark.pending} onClick={() => mark.run("FALSE_POSITIVE")}>Fals pozitiv</button>
            <button className="btn sm" disabled={note.trim().length < 5 || mark.pending} onClick={() => mark.run("DISPUTED")}>Contestat</button>
            <button className="btn sm ghost" onClick={() => setEditing(false)}>Renunță</button>
          </div>
        )}
        <ErrorNotice error={mark.error} />
      </div>
    </li>
  );
}

const EFFORT_CHOICES = ["", "low", "medium", "high", "xhigh", "max"];
const REVIEWER_CHOICES = ["sonnet", "opus", "haiku"];

/**
 * M09: the models of a draft mission, chosen explicitly (writer: a Codex model from model/list; reviewer: sonnet/opus/haiku). Until
 * both are set and resolvable the scope is incomplete — no approval, no plan; the account default is never used in their place.
 */
function ModelEditor({ view, reload }) {
  const l = view.factory.limits;
  const [form, setForm] = useState({ writerModel: l.writerModel || "", writerEffort: l.writerEffort || "", reviewerModel: l.reviewerModel || "", reviewerEffort: l.reviewerEffort || "" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const save = useAction(async () => {
    await api(`/api/factory/${view.mission.id}/limits`, { method: "POST", body: { limits: { writerModel: form.writerModel.trim(), writerEffort: form.writerEffort, reviewerModel: form.reviewerModel, reviewerEffort: form.reviewerEffort } } });
    pushToast(`factory-models-${view.mission.id}`, "ok", "Modelele au fost fixate în ciornă"); reload();
  });
  const changed = form.writerModel.trim() !== (l.writerModel || "") || form.writerEffort !== (l.writerEffort || "") || form.reviewerModel !== (l.reviewerModel || "") || form.reviewerEffort !== (l.reviewerEffort || "");
  return (
    <Panel title="Modele (explicite)" icon={ShieldCheck}>
      <div className="stack tight">
        {view.scopeProblems?.length > 0 && <Notice tone="warn" title="Planul nu e complet">{view.scopeProblems.join(" · ")}</Notice>}
        <div className="grid two">
          <label className="field"><span>Writer (Codex): modelul din model/list</span><input className="input mono" value={form.writerModel} onChange={set("writerModel")} maxLength={80} placeholder="ex. gpt-6.1-sol" /></label>
          <label className="field"><span>Efort writer</span><select className="select" value={form.writerEffort} onChange={set("writerEffort")}>{EFFORT_CHOICES.map((e) => <option key={e} value={e}>{e || `din profil (${l.profile})`}</option>)}</select></label>
          <label className="field"><span>Reviewer (Claude)</span><select className="select" value={form.reviewerModel} onChange={set("reviewerModel")}><option value="">— alege —</option>{REVIEWER_CHOICES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label className="field"><span>Efort reviewer</span><select className="select" value={form.reviewerEffort} onChange={set("reviewerEffort")}>{EFFORT_CHOICES.map((e) => <option key={e} value={e}>{e || `din profil (${l.profile})`}</option>)}</select></label>
        </div>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>Ce fixezi aici e exact ce se trimite: verificat din nou înainte de fiecare pornire (o schimbare a listei de modele sau a versiunii Claude Code oprește execuția înainte de model). Fable, „best” și variantele [1m] sunt refuzate.</p>
        <div><button className="btn" disabled={!changed || save.pending} onClick={save.run}>{save.pending ? "Se salvează…" : "Fixează modelele"}</button></div>
        <ErrorNotice error={save.error} />
      </div>
    </Panel>
  );
}

/** Software Factory view of one engineering mission (stage, wait reason, spec, scope, runs, change sets, findings, evidence, bundle). */
export function FactoryPanel({ missionId }) {
  const { data: view, error, loading, reload } = useResource(`/api/factory/${missionId}`, { reloadOn: (e) => e.scopeId === missionId || e.type.startsWith("run.") || e.type.startsWith("approval.") || e.type.startsWith("factory.") });
  const [editingSpec, setEditingSpec] = useState(false);
  const [note, setNote] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const act = useAction(async (path, body = {}) => { await api(`/api/factory/${missionId}/${path}`, { method: "POST", body }); reload(); });
  const [reviewerModel, setReviewerModel] = useState(""); // the owner may pick an allowed reviewer model when resuming
  // M10.2 (U15): under voice-first the draft's scope is ONE plan in the cockpit; the M03 scope approval stays reachable, collapsed.
  const ownerStatus = useResource("/api/owner/status", { reloadOn: (e) => e.type === "settings.changed" && e.payload?.key === "ownerPolicy" });
  const voiceFirst = Boolean(ownerStatus.data?.policy?.active);
  if (loading) return <Panel title="Software Factory" icon={Factory}><Loading /></Panel>;
  if (error) return <Panel title="Software Factory" icon={Factory}><ErrorNotice error={error} onRetry={reload} /></Panel>;
  const f = view.factory;
  const cs = view.changeSets.find((c) => c.status === "CURRENT");
  const latestBundle = view.bundles.at(-1);
  const problems = view.specs.at(-1)?.problems || [];
  return (
    <div className="stack" style={{ overflowWrap: "anywhere", minWidth: 0 }}>
      <Panel title={`Software Factory · ${f.workType}`} icon={Factory} data-lega-target="factory-panel"
        actions={<div className="row wrap">
          {ACTIVE.has(f.stage) && <button className="btn sm" disabled={act.pending} onClick={() => act.run("pause")}><Pause size={14} />Pauză</button>}
          {!["ACCEPTED", "REJECTED", "CANCELLED", "SPEC_DRAFT"].includes(f.stage) && <button className="btn sm danger" disabled={act.pending} onClick={() => act.run("stop", { reason: "Oprit din UI" })}><Square size={14} />Stop</button>}
        </div>}>
        <div className="stack">
          <StageBar view={view} />
          <dl className="kv">
            <dt>Etapa</dt><dd><strong>{FACTORY_STAGE_RO[f.stage] || f.stage}</strong> — {f.stageReason || "—"}</dd>
            <dt>Așteaptă</dt><dd>{factoryWaitLabel(f.waitReason, f.stage)}</dd>
            <dt>Cicluri de remediere</dt><dd>{f.repairCycles}/{f.limits.maxRepairCycles}</dd>
            <dt>Limite</dt><dd>{f.limits.maxDurationMin} min · {f.limits.maxAttemptsPerStage} încercări/etapă · profil {f.limits.profile}{f.deadlineAt ? ` · termen ${fmt.dateTime(f.deadlineAt)}` : ""}</dd>
            <dt>Runner</dt><dd>{view.runnerReadiness.ok ? view.runnerReadiness.isolation : <span className="warn">{view.runnerReadiness.detail}</span>}</dd>
            {view.stageEnvironments && <><dt>Unde rulează</dt><dd>
              <span className="row wrap">{view.stageEnvironments.stages.map((s) => { const b = boundaryOf(s.boundary); return <Chip key={s.stage} tone={b.tone} title={s.where}>{s.label}: {b.label}</Chip>; })}</span>
              {!view.stageEnvironments.realProjectEligible && <span className="faint small">Nu este eligibil pentru date reale: {view.stageEnvironments.blockers.join(" · ")}</span>}
            </dd></>}
            {/* M09: the bound models (approved with the scope) or the draft's resolution; never a placeholder for the account default. */}
            <dt>Modele</dt><dd>writer: {view.models?.writer?.label || <span className="warn">nefixat</span>} · reviewer: {view.models?.reviewer?.label || <span className="warn">nefixat</span>}
              {view.models?.writer?.approved ? <span className="faint small"> (aprobate cu scope-ul; verificate din nou la fiecare pornire)</span> : <span className="faint small"> (ciornă: se fixează la aprobarea scope-ului)</span>}</dd>
            <dt>{voiceFirst ? "Granturi pe care planul le derivă" : "Granturi necesare"}</dt><dd>{view.grantsNeeded.map((g) => `${g.provider} ${g.access} × ${g.attempts} (${g.why})`).join(" · ")}</dd>
          </dl>
          {["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(f.stage) && f.approvedSpecVersion && (
            <div className="row wrap">
              <select className="select" aria-label="Modelul reviewer-ului la reluare" value={reviewerModel} onChange={(e) => setReviewerModel(e.target.value)}>
                <option value="">Reviewer: {f.bindings?.reviewer?.resolvedAlias || f.limits.reviewerModel || "nefixat"} (aprobat)</option>
                {REVIEWER_CHOICES.filter((m) => m !== (f.bindings?.reviewer?.resolvedAlias || f.limits.reviewerModel)).map((m) => <option key={m} value={m}>Reviewer: {m} (în afara unui plan confirmat)</option>)}
              </select>
              <button className="btn primary" disabled={act.pending} onClick={() => act.run("resume", reviewerModel ? { reviewerModel } : {})}><Play size={14} />Reia</button>
              {f.stage === "NEEDS_OWNER_DECISION" && <button className="btn" disabled={act.pending} onClick={() => act.run("resume", { allowExtraCycle: true, ...(reviewerModel ? { reviewerModel } : {}) })}>Încă un ciclu de remediere</button>}
              {f.stage === "NEEDS_OWNER_DECISION" && view.reviews.at(-1)?.verdict === "INCONCLUSIVE" && <button className="btn" disabled={act.pending} onClick={() => act.run("resume", { proceedToQa: true, ...(reviewerModel ? { reviewerModel } : {}) })}>Continuă la QA (decizia mea)</button>}
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      </Panel>

      <Panel title={`Specificația v${view.spec.version} · ${view.spec.status}`} icon={ListChecks}
        actions={f.stage === "SPEC_DRAFT" && !f.approvedSpecVersion ? <button className="btn sm" onClick={() => setEditingSpec(true)}>Versiune nouă</button> : null}>
        <div className="stack tight">
          <p style={{ margin: 0 }}>{view.spec.spec.objective}</p>
          <ul className="plain-list">{view.spec.spec.acceptance.map((a) => <li key={a.id}><span className="mono">{a.id}</span> [{a.verify}{a.testRef ? `: ${a.testRef}` : ""}] {a.text}</li>)}</ul>
          <div className="faint" style={{ fontSize: 12 }}>Verificări: {view.spec.spec.verification.checks.join(", ") || "—"} · Acceptanță: {view.spec.spec.verification.acceptance.join(", ") || "—"}{view.spec.spec.verification.preview ? ` · Preview: ${view.spec.spec.verification.preview.url}` : ""}</div>
          {problems.length > 0 && <Notice tone="warn" title="De completat înainte de aprobare">{problems.join("; ")}</Notice>}
          {view.spec.spec.sources?.assumptions?.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Presupuneri (nu cerințe): {view.spec.spec.sources.assumptions.join("; ")}</div>}
        </div>
      </Panel>
      {f.stage === "SPEC_DRAFT" && !f.approvedSpecVersion && <ModelEditor key={`${f.limits.writerModel || ""}|${f.limits.reviewerModel || ""}|${f.limits.writerEffort || ""}|${f.limits.reviewerEffort || ""}`} view={view} reload={reload} />}
      {f.stage === "SPEC_DRAFT" && !problems.length && (ownerStatus.data || ownerStatus.error) && (voiceFirst ? (
        <>
          <PlanFromFactory view={view} />
          <details className="advanced">
            <summary className="link-btn" style={{ cursor: "pointer" }}>Avansat: aprobare fără plan (calea M03: aprobare prin click, apoi grant pe execuție)</summary>
            <div style={{ marginTop: 8 }}><ScopeApproval view={view} reload={reload} /></div>
          </details>
        </>
      ) : <ScopeApproval view={view} reload={reload} />)}

      {view.runs.length > 0 && (
        <Panel title="Execuții și timpul pe etape" icon={Timer}>
          <ul className="list">{view.runs.map((r) => <li key={r.id} style={{ padding: "8px 0" }}><RunTimeline run={r} /></li>)}</ul>
        </Panel>
      )}

      {view.changeSets.length > 0 && (
        <Panel title={`Change set-uri (${view.changeSets.length})`} icon={FileDiff} actions={cs ? <button className="btn sm ghost" onClick={() => setShowDiff((v) => !v)}>{showDiff ? "Ascunde diff" : "Arată diff"}</button> : null}>
          <ul className="list">{view.changeSets.map((c) => (
            <li key={c.id}><div className="list-row" style={{ flexWrap: "wrap" }}><span className="mono">#{c.seq} {c.sha256.slice(0, 12)}</span><Chip tone={c.status === "CURRENT" ? "info" : "neutral"}>{c.status}</Chip>
              <span className="grow faint ellipsis">{c.changes.map((x) => `${x.status} ${x.path}`).join(", ")}</span>{c.integrity?.findings > 0 && <Chip tone="warn">{c.integrity.findings} integritate</Chip>}</div></li>
          ))}</ul>
          {showDiff && cs && <DiffView diff={cs.diffText} />}
        </Panel>
      )}

      {(view.reviews.length > 0 || view.findings.length > 0) && (
        <Panel title="Review și findings">
          {view.reviews.map((r) => <div key={r.id} className="row wrap" style={{ gap: 8, padding: "4px 0" }}><Chip tone={r.verdict === "PASS" ? "ok" : r.verdict === "CHANGES_REQUESTED" ? "error" : "warn"}>{r.verdict}</Chip><Chip>{r.status}</Chip><span className="mono">{r.changeSetSha.slice(0, 12)}</span><span className="faint grow">{r.summary}{r.validation?.problems?.length ? ` — ${r.validation.problems.join("; ")}` : ""}</span></div>)}
          {view.findings.length ? <ul className="list">{view.findings.map((x) => <FindingRow key={x.id} finding={x} missionId={missionId} reload={reload} />)}</ul> : <Empty title="Fără findings" />}
        </Panel>
      )}

      {view.evidence.length > 0 && (
        <Panel title="Dovezi (runner Hub)">
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Etapă</th><th>Comandă</th><th>Rezultat</th><th>Teste</th><th>Izolare</th><th>Durată</th></tr></thead>
            <tbody>{view.evidence.map((e) => (
              <tr key={e.id} style={e.stale ? { opacity: 0.55 } : undefined}><td>{e.stage}{e.stale ? " (veche)" : ""}</td><td className="mono">{e.command}</td><td><Chip tone={EVIDENCE_TONE[e.status] || "neutral"}>{e.status}</Chip></td>
                <td>{e.counts?.tests !== undefined ? `${e.counts.pass ?? "?"}/${e.counts.tests}${e.counts.skipped ? `, ${e.counts.skipped} sărite` : ""}` : e.detail?.reason || "—"}</td><td className="faint" style={{ fontSize: 12 }}>{e.isolation}</td><td>{formatMs(e.durationMs)}</td></tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {latestBundle && (
        <Panel title="Pachet de livrare" icon={Package}>
          <div className="stack tight">
            <div className="row wrap" style={{ gap: 8 }}><Chip tone={latestBundle.status === "OWNER_ACCEPTED" ? "ok" : latestBundle.status === "READY_FOR_OWNER_ACCEPTANCE" ? "info" : "neutral"}>{latestBundle.status}</Chip><span className="mono">{latestBundle.sha256.slice(0, 16)}</span><span className="faint" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{latestBundle.file_path}</span></div>
            <Notice tone="info">READY_FOR_OWNER_ACCEPTANCE nu înseamnă publicat: commit, push, merge și deploy rămân acțiuni separate, cu aprobarea ta.</Notice>
            {f.stage === "DELIVERY_READY" && (
              <div className="row wrap">
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notă (opțional la acceptare, obligatorie la respingere)" />
                <button className="btn primary" disabled={act.pending} onClick={() => act.run("accept", { note })} data-lega-target="factory-accept"><CheckCircle2 size={14} />Accept local</button>
                <button className="btn" disabled={act.pending || note.trim().length < 3} onClick={() => act.run("reject", { note })}><XCircle size={14} />Resping</button>
              </div>
            )}
          </div>
        </Panel>
      )}
      {editingSpec && <SpecEditor view={view} onClose={() => setEditingSpec(false)} reload={reload} />}
    </div>
  );
}

/** New engineering work: the owner's request becomes a mission with spec v1 (draft; nothing runs). */
export function NewFactoryMission({ onClose, go }) {
  const projects = useResource("/api/projects");
  const enabled = (projects.data?.projects || []).filter((p) => p.executionAllowed && p.slug !== "ifrim-agent-hub");
  const [form, setForm] = useState({ projectId: "", workType: "BUGFIX", title: "", objective: "", criteria: "", acceptance: "node --test", checks: "node --test", writerModel: "", reviewerModel: "" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const lines = (t) => t.split("\n").map((s) => s.trim()).filter(Boolean);
  const create = useAction(async () => {
    // M09: the models travel with the request (both explicit; without them the draft's scope stays incomplete until fixed).
    const limits = { ...(form.writerModel.trim() ? { writerModel: form.writerModel.trim() } : {}), ...(form.reviewerModel ? { reviewerModel: form.reviewerModel } : {}) };
    const view = await api("/api/factory", { method: "POST", body: { projectId: form.projectId || enabled[0]?.id, workType: form.workType, title: form.title.trim(), objective: form.objective.trim(),
      spec: { acceptance: parseCriteriaLines(form.criteria), verification: { checks: lines(form.checks), acceptance: lines(form.acceptance) } }, limits } });
    onClose(); go(`/missions/${view.mission.id}`);
  });
  const valid = form.title.trim().length >= 3 && form.objective.trim().length >= 10 && (form.projectId || enabled[0]);
  return (
    <Dialog title="Lucrare de engineering (Software Factory)" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Renunță</button><button className="btn primary" disabled={!valid || create.pending} onClick={create.run}>{create.pending ? "Se pregătește…" : "Pregătește misiunea"}</button></>}>
      {!enabled.length && <Notice tone="warn">Niciun proiect activat pentru execuții (în afară de Hub). Software Factory nu lucrează pe Hub-ul însuși.</Notice>}
      <div className="grid two">
        <label className="field"><span>Tip</span><select className="select" value={form.workType} onChange={set("workType")}><option value="BUGFIX">Bugfix</option><option value="FEATURE">Feature</option><option value="REFACTOR">Refactor</option></select></label>
        <label className="field"><span>Proiect</span><select className="select" value={form.projectId || enabled[0]?.id || ""} onChange={set("projectId")}>{enabled.map((p) => <option key={p.id} value={p.id}>{p.name}{p.source === "hub-test" ? " (test)" : ""}</option>)}</select></label>
      </div>
      <label className="field"><span>Titlu</span><input className="input" value={form.title} onChange={set("title")} maxLength={160} /></label>
      <label className="field"><span>Cerința (ce trebuie să facă / ce e greșit)</span><textarea className="textarea" rows={3} value={form.objective} onChange={set("objective")} /></label>
      <label className="field"><span>Criterii de acceptanță (text | test/review/manual/e2e | cale test)</span><textarea className="textarea mono" rows={4} value={form.criteria} onChange={set("criteria")} placeholder="Numele din spații e refuzat | test | test/acceptance.test.mjs" /></label>
      <div className="grid two">
        <label className="field"><span>Comenzi de verificare</span><textarea className="textarea mono" rows={2} value={form.checks} onChange={set("checks")} /></label>
        <label className="field"><span>Comenzi de acceptanță</span><textarea className="textarea mono" rows={2} value={form.acceptance} onChange={set("acceptance")} /></label>
        <label className="field"><span>Model writer (Codex, din model/list)</span><input className="input mono" value={form.writerModel} onChange={set("writerModel")} maxLength={80} placeholder="ex. gpt-6.1-sol" /></label>
        <label className="field"><span>Model reviewer (Claude)</span><select className="select" value={form.reviewerModel} onChange={set("reviewerModel")}><option value="">— alege —</option>{REVIEWER_CHOICES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Se creează specificația v1 (ciornă) și planul: writer Codex, reviewer Claude doar-citire, runner Hub pentru teste. Modelele sunt explicite (fără modelul implicit al contului); nimic nu rulează până aprobi scope-ul.</p>
      <ErrorNotice error={create.error} />
    </Dialog>
  );
}
