import { useState } from "react";
import { Factory, ShieldCheck, Square, Pause, Play, CheckCircle2, XCircle, FileDiff, ListChecks, Timer, Package, AlertTriangle } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, pushToast } from "../../store.js";
import { FACTORY_STAGE_RO, FACTORY_PATH, factoryWaitLabel, factoryProgress, formatMs, parseCriteriaLines, mergeCriteria } from "../../lib/uiLogic.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Notice, Chip, DiffView, Dialog } from "../../components/ui.jsx";

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
          writer {s.routes.writer.provider} ({s.routes.writer.access}), reviewer {s.routes.reviewer.provider} ({s.routes.reviewer.access}), profil {s.limits.profile},
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

/** Software Factory view of one engineering mission (stage, wait reason, spec, scope, runs, change sets, findings, evidence, bundle). */
export function FactoryPanel({ missionId }) {
  const { data: view, error, loading, reload } = useResource(`/api/factory/${missionId}`, { reloadOn: (e) => e.scopeId === missionId || e.type.startsWith("run.") || e.type.startsWith("approval.") || e.type.startsWith("factory.") });
  const [editingSpec, setEditingSpec] = useState(false);
  const [note, setNote] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const act = useAction(async (path, body = {}) => { await api(`/api/factory/${missionId}/${path}`, { method: "POST", body }); reload(); });
  const [reviewerModel, setReviewerModel] = useState(""); // the owner may pick an allowed reviewer model when resuming
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
            <dt>Modele</dt><dd>writer: {f.limits.writerModel || "implicitul din model/list"} · reviewer: {f.limits.reviewerModel || "implicitul contului Claude Code (Fable/1M refuzate)"}</dd>
            <dt>Granturi necesare</dt><dd>{view.grantsNeeded.map((g) => `${g.provider} ${g.access} × ${g.attempts} (${g.why})`).join(" · ")}</dd>
          </dl>
          {["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(f.stage) && f.approvedSpecVersion && (
            <div className="row wrap">
              <select className="select" aria-label="Modelul reviewer-ului la reluare" value={reviewerModel} onChange={(e) => setReviewerModel(e.target.value)}>
                <option value="">Reviewer: {f.limits.reviewerModel || "implicitul contului"}</option>
                {["sonnet", "opus", "haiku"].filter((m) => m !== f.limits.reviewerModel).map((m) => <option key={m} value={m}>Reviewer: {m}</option>)}
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
      {f.stage === "SPEC_DRAFT" && !problems.length && <ScopeApproval view={view} reload={reload} />}

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
  const [form, setForm] = useState({ projectId: "", workType: "BUGFIX", title: "", objective: "", criteria: "", acceptance: "node --test", checks: "node --test" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const lines = (t) => t.split("\n").map((s) => s.trim()).filter(Boolean);
  const create = useAction(async () => {
    const view = await api("/api/factory", { method: "POST", body: { projectId: form.projectId || enabled[0]?.id, workType: form.workType, title: form.title.trim(), objective: form.objective.trim(),
      spec: { acceptance: parseCriteriaLines(form.criteria), verification: { checks: lines(form.checks), acceptance: lines(form.acceptance) } } } });
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
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>Se creează specificația v1 (ciornă) și planul: writer Codex, reviewer Claude doar-citire, runner Hub pentru teste. Nimic nu rulează până aprobi scope-ul.</p>
      <ErrorNotice error={create.error} />
    </Dialog>
  );
}
