import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, Footprints, ShieldCheck, Network, FileDiff, ListChecks, MessageSquareText, History, MonitorPlay, Newspaper, HelpCircle, Building2, Lock, Check, X, Pin, PinOff, ChevronDown, ChevronRight, Play, Rewind } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, pushToast, refresh } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Notice, Chip, DiffView } from "../../components/ui.jsx";
import { STATE_TONE, missionGraph } from "../../lib/cockpitLogic.js";
import { FACTORY_STAGE_RO } from "../../lib/uiLogic.js";
import { withReauth } from "../../lib/ownerSession.js";

const EVIDENCE_TONE = { PASS: "ok", FAIL: "error", INCONCLUSIVE: "warn", BLOCKED: "error", NOT_RUN: "neutral", NEEDS_INSTALL_APPROVAL: "warn" };
const NODE_TONE = { DONE: "ok", RUNNING: "info", WAITING: "neutral", FAILED: "error", BLOCKED: "warn" };
const Src = ({ children }) => <span className="faint small src">{children}</span>;

function CardShell({ card, title, icon, onPin, onDismiss, children, actions }) {
  return (
    <Panel title={title} icon={icon} className={`cockpit-card size-${card.size || "m"}`} actions={<>
      {actions}
      {onPin && <button className="btn sm icon ghost" onClick={onPin} aria-pressed={Boolean(card.pinned)} aria-label={card.pinned ? "Desprinde cardul" : "Fixează cardul"} title={card.pinned ? "Desprinde" : "Fixează"}>{card.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>}
      {onDismiss && !card.pinned && <button className="btn sm icon ghost" onClick={onDismiss} aria-label="Ascunde cardul"><X size={13} /></button>}
    </>}>{children}</Panel>
  );
}

export function ProjectSummary({ cockpit: c, ...rest }) {
  return (
    <CardShell {...rest} title={c.project.name} icon={FolderGit2}>
      <div className="row wrap">
        <Chip tone={STATE_TONE[c.state.code] || "neutral"}>{c.state.label}</Chip>
        <Chip tone={c.project.kind === "test" ? "info" : "neutral"}>{c.project.kind === "test" ? "proiect de test" : "proiect real"}</Chip>
        <Chip tone="neutral" title={c.autonomy.label}>autonomie {c.autonomy.level}{c.autonomy.source === "default" ? " (implicit)" : ""}</Chip>
        {c.frozen && <Chip tone="warn">înghețat</Chip>}
      </div>
      <div className="cockpit-cols">
        <div>
          <h3 className="h3">Terminat (cu dovezi)</h3>
          {c.done.length ? <ul className="plain">{c.done.slice(0, 5).map((d) => <li key={d.id}><a href={`#/missions/${d.missionId || d.id}`}>{d.title}</a> <Src>{d.evidence} · {fmt.dateTime(d.at)}</Src></li>)}</ul> : <p className="faint small">Nimic terminat cu dovezi în Hub.</p>}
        </div>
        <div>
          <h3 className="h3">Deschis / blocat</h3>
          {[...c.blocked, ...c.open].length ? <ul className="plain">{[...c.blocked, ...c.open].slice(0, 6).map((m) => <li key={m.missionId}><a href={`#/missions/${m.missionId}`}>{m.title}</a> <StatusChip status={m.stage === "BLOCKED" || m.status === "BLOCKED" ? "BLOCKED" : m.stage === "NEEDS_OWNER_DECISION" ? "ATTENTION" : m.status} label={m.stage ? FACTORY_STAGE_RO[m.stage] || m.stage : undefined} />{m.reason && <div className="faint small">{m.reason}</div>}</li>)}</ul> : <p className="faint small">Nicio misiune deschisă.</p>}
        </div>
      </div>
      <dl className="kv small">
        <dt>Ultima sesiune</dt><dd>{c.lastSession.conversation ? <>{c.lastSession.conversation.title} · {fmt.dateTime(c.lastSession.conversation.at)}</> : "—"}{c.lastSession.lastRun && <> · {c.lastSession.lastRun.provider} {c.lastSession.lastRun.status} ({c.lastSession.lastRun.environment})</>}</dd>
        <dt>Repository</dt><dd>{c.repo.available ? <>{c.repo.branch} · {c.repo.head} · {c.repo.dirty} modificate, {c.repo.untracked} noi <Src>{c.repo.source}, citit {fmt.time(c.repo.readAt)}</Src></> : c.repo.reason}</dd>
        <dt>Decizii</dt><dd>{c.decisions.length ? c.decisions.slice(0, 2).map((d) => d.title).join(" · ") : "—"}</dd>
      </dl>
      {c.missing.length > 0 && <p className="faint small">Lipsește: {c.missing.join(" · ")}</p>}
      <Src>Generat {fmt.dateTime(c.generatedAt)} din datele Hub-ului (nimic citit din codul proiectului).</Src>
    </CardShell>
  );
}

export function NextStepCard({ cockpit: c, onPlan, ...rest }) {
  const r = c.next.recommended;
  return (
    <CardShell {...rest} title="Următorul pas" icon={Footprints}>
      <p className="lead">{r.text}</p>
      <p className="faint small">De ce: {r.why} <Src>· sursa: {r.source}</Src></p>
      <div className="row wrap">
        {(r.kind === "confirm_plan" || r.kind === "unblock") && <button className="btn sm primary" onClick={() => onPlan(r.missionId)}>Arată-mi planul</button>}
        {r.missionId && <a className="btn sm ghost" href={`#/missions/${r.missionId}`}>Deschide misiunea</a>}
      </div>
      {c.next.alternatives.length > 0 && (
        <details><summary className="small">Alternative ({c.next.alternatives.length})</summary>
          <ul className="plain small">{c.next.alternatives.map((a, i) => <li key={i}>{a.text} <Src>— {a.why}</Src></li>)}</ul>
        </details>
      )}
      <Src>Ordinea vine din starea misiunilor și din notițele proiectului; nu e o prioritate comercială stabilită de Hub.</Src>
    </CardShell>
  );
}

/**
 * The plan before anything runs, and the ONE confirmation. Under the legacy policy the button says so (Approvals as before);
 * without a session the confirmation opens Windows Hello first. Enter confirms only while this card has focus.
 */
export function DecisionCard({ plan, owner, onConfirmed, onCancel, ...rest }) {
  const env = plan?.envelope;
  const summary = plan?.summary || env?.summary;
  const [details, setDetails] = useState(false);
  const ref = useRef(null);
  const live = useResource(env?.id ? `/api/envelopes/${env.id}` : null, { reloadOn: (e) => e.type.startsWith("envelope.") || e.type === "factory.stage" });
  const current = live.data || env;
  const policyActive = owner?.policy?.active;
  const confirm = useAction(async (modality = "click") => {
    const res = await withReauth(() => api(`/api/envelopes/${env.id}/confirm`, { method: "POST", body: { nonce: env.nonce, displayedHash: env.envelopeHash, modality } }));
    pushToast(`env-${env.id}`, "ok", res.envelope.status === "ACTIVE" ? "Confirmat: misiunea a pornit" : `Confirmat: ${res.envelope.status}`);
    live.reload(); refresh(); onConfirmed?.(res.envelope);
  });
  const revoke = useAction(async () => { await api(`/api/envelopes/${env.id}/revoke`, { method: "POST", body: { reason: "Revocat din cockpit" } }); live.reload(); onCancel?.(); });
  if (!plan) return null;
  if (!env) return <CardShell {...rest} title="Planul" icon={ShieldCheck}><Notice tone="warn" title="Planul nu e complet">{(summary?.blockers || []).join(" · ")}</Notice></CardShell>;
  const awaiting = current?.status === "PROPOSED" && new Date(current.confirmBy) > new Date();
  const eligible = summary?.state === "PLAN_READY";
  const stateLabel = { PROPOSED: awaiting ? "așteaptă confirmarea ta" : "expirat", CONFIRMED: "autorizat · în pregătire", ACTIVE: "autorizat · în execuție", WAITING_OWNER: "așteaptă decizia ta", COMPLETED: "încheiat", REVOKED: "revocat", EXPIRED: "expirat", SUPERSEDED: "înlocuit (s-a schimbat ceva)", FAILED_TO_START: "confirmat, dar nu a pornit", CANCELLED: "anulat" }[current?.status] || current?.status;
  return (
    <CardShell {...rest} title="Arată-mi înainte să faci" icon={ShieldCheck} actions={<Chip tone={current?.status === "ACTIVE" ? "info" : awaiting ? "approval" : "neutral"}>{stateLabel}</Chip>}>
      <div ref={ref} tabIndex={-1} className="decision" onKeyDown={(e) => { if (e.key === "Enter" && awaiting && eligible && policyActive && !confirm.pending && e.target === ref.current) confirm.run("keyboard"); }}>
        <p className="lead">{summary.headline}</p>
        <ul className="plain decision-lines">
          <li>{summary.where}</li><li>{summary.steps}</li><li><strong>{summary.never}</strong></li><li>{summary.stops}</li><li>{summary.cost}</li>
          {summary.mode && <li>{summary.mode}</li>}<li className="faint">{summary.files}</li><li className="faint">Nivel: {summary.autonomy}</li>
        </ul>
        {summary.blockers?.length > 0 && <Notice tone="warn" title={summary.state === "BLOCKED_BY_ISOLATION" ? "Execuție blocată de izolare" : "Nu poate porni acum"}>{summary.blockers.slice(0, 4).join(" · ")}</Notice>}
        <button className="btn sm ghost" onClick={() => setDetails((d) => !d)} aria-expanded={details}>{details ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Detalii tehnice</button>
        {details && (
          <dl className="kv small">
            <dt>Plan</dt><dd className="mono">{env.id} · hash {env.envelopeHash.slice(0, 16)} · confirmare până la {fmt.time(env.confirmBy)}</dd>
            <dt>Misiuni</dt><dd>{env.body.missions.map((m) => `${m.title} (spec v${m.specVersion}, ${m.workType})`).join(" · ")}</dd>
            <dt>Rută</dt><dd>{env.body.workspaceScope.route} · {env.body.attestationRefs.map((a) => a.attestationId ? `atestare ${a.attestationId} ${a.status}` : a.environment).join(", ")}</dd>
            <dt>Repository</dt><dd>{env.body.baseSnapshot.kind === "repository" ? `${env.body.baseSnapshot.branch} @ ${String(env.body.baseSnapshot.head).slice(0, 10)}` : env.body.baseSnapshot.kind} · stare {env.body.baseSnapshot.stateHash || "—"}</dd>
            <dt>Roluri</dt><dd>{env.body.allowedRoles.join(", ")} · {env.body.providers.join(", ")}</dd>
            <dt>Rețea</dt><dd>{Object.entries(env.body.networkScope).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd>
            <dt>Interzis</dt><dd>{env.body.deniedEffects.join(", ")}</dd>
            {current?.derivedGrants?.length > 0 && <><dt>Granturi derivate</dt><dd>{current.derivedGrants.map((g) => `${g.provider} ${g.access} ${g.attemptsUsed}/${g.maxAttempts} (${g.status})`).join(" · ")}</dd></>}
          </dl>
        )}
        {awaiting && (
          <div className="row wrap">
            <button className="btn primary" disabled={!eligible || !policyActive || confirm.pending} onClick={() => confirm.run("click")}><Check size={15} />{confirm.pending ? "Confirm…" : "Da, execută planul"}</button>
            <button className="btn ghost" disabled={revoke.pending} onClick={revoke.run}><X size={15} />Nu acum</button>
            {!policyActive && <span className="faint small"><Lock size={12} /> Politica voice-first nu e activă: confirmarea trece prin Aprobări (legacy). O activezi din Lega → Configurare.</span>}
            {policyActive && !owner?.session && <span className="faint small"><Lock size={12} /> Confirmarea îți cere Windows Hello / cheia (sesiunea e blocată).</span>}
          </div>
        )}
        {current?.status === "ACTIVE" && <p className="small">Autorizat. Granturile tehnice au fost derivate intern; urmărește graful execuției.</p>}
        {current?.closeReason && !awaiting && <p className="faint small">{current.closeReason}</p>}
        <ErrorNotice error={confirm.error || revoke.error} />
      </div>
    </CardShell>
  );
}

export function MissionPlan({ projectId, onPlan, ...rest }) {
  const list = useResource(`/api/cockpit/${projectId}/missions`, { reloadOn: (e) => e.type.startsWith("factory.") });
  const drafts = (list.data?.missions || []).filter((m) => m.stage === "SPEC_DRAFT");
  return (
    <CardShell {...rest} title="Misiuni pregătite" icon={ListChecks}>
      {list.loading ? <Loading lines={2} /> : drafts.length ? <ul className="plain">{drafts.map((m) => <li key={m.missionId} className="row between"><span>{m.title} <Src>{m.workType}</Src></span><button className="btn sm" onClick={() => onPlan(m.missionId)}>Arată planul</button></li>)}</ul>
        : <Empty title="Nicio misiune pregătită">Spune-mi ce vrei să facem; pregătesc specificația ca ciornă.</Empty>}
    </CardShell>
  );
}

function useFactory(missionId) {
  return useResource(missionId ? `/api/factory/${missionId}` : null, { reloadOn: (e) => e.missionId === missionId || (e.scopeType === "mission" && e.scopeId === missionId) });
}

export function AgentGraph({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const nodes = useMemo(() => missionGraph(v.data), [v.data]);
  return (
    <CardShell {...rest} title={v.data ? `Execuție: ${v.data.mission.title}` : "Execuție"} icon={Network}>
      {v.loading ? <Loading lines={3} /> : v.error ? <ErrorNotice error={v.error} /> : (
        <>
          <ol className="agent-graph" aria-label="Etapele execuției">
            {nodes.map((n) => <li key={n.key} className={`ag-node ${NODE_TONE[n.status]}`}><span className="ag-dot" aria-hidden="true" /><strong>{n.label}</strong><span className="small">{n.status === "DONE" ? "gata" : n.status === "RUNNING" ? "rulează" : n.status === "FAILED" ? "a eșuat" : n.status === "BLOCKED" ? "blocat" : "așteaptă"}</span><span className="faint small">{n.where}</span></li>)}
          </ol>
          <p className="small">Etapa: <strong>{FACTORY_STAGE_RO[v.data.factory.stage] || v.data.factory.stage}</strong>{v.data.factory.waitReason ? ` · așteaptă: ${v.data.factory.waitReason}` : ""}</p>
          {v.data.factory.stageReason && <p className="faint small">{v.data.factory.stageReason}</p>}
          <Src>Legăturile se aprind doar pe evenimente reale; un rol configurat nu e un worker activ. Mediul arătat e cel în care etapa A RULAT (din dovezi).</Src>
        </>
      )}
    </CardShell>
  );
}

export function EnvironmentCard({ cockpit: c, ...rest }) {
  const env = c.environments;
  return (
    <CardShell {...rest} title="Medii și izolare" icon={ShieldCheck}>
      {!env ? <p className="faint small">Harta etapelor nu e disponibilă.</p> : (
        <>
          <ul className="plain small">{env.stages.map((s) => <li key={s.stage}><Chip tone={s.boundary === "environment" ? "ok" : s.boundary === "blocked" ? "warn" : "neutral"}>{s.label}</Chip> {s.where}</li>)}</ul>
          <p className="small">{env.realProjectEligible ? "Toate etapele cu cod rulează în granița mediului atestat." : "REAL_PROJECT_ELIGIBLE: nu — " + (env.blockers || []).slice(0, 3).join(" · ")}</p>
        </>
      )}
      <Src>Proiect {c.project.kind === "test" ? "de test: execuția e permisă fără izolarea completă" : "real: execuția cere izolarea verificată și aprobarea (b)"}.</Src>
    </CardShell>
  );
}

export function DiffPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const cs = v.data?.changeSets?.find((c) => c.status === "CURRENT");
  return (
    <CardShell {...rest} title="Ce s-a schimbat" icon={FileDiff}>
      {v.loading ? <Loading lines={3} /> : !cs ? <Empty title="Niciun change set încă">Writer-ul nu a produs modificări pentru această misiune.</Empty> : (
        <>
          <p className="small">Change set {cs.seq} · {cs.changes.length} fișiere · sha {String(cs.sha256).slice(0, 12)}{cs.diffTruncated ? " · diff trunchiat" : ""}</p>
          <ul className="plain small">{cs.changes.slice(0, 12).map((f) => <li key={f.path}><span className="mono">{f.path}</span> <Src>{f.status}</Src></li>)}</ul>
          <DiffView diff={cs.diffText} />
        </>
      )}
    </CardShell>
  );
}

export function TestPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const rows = (v.data?.evidence || []).filter((e) => !e.stale);
  return (
    <CardShell {...rest} title="Teste și verificări" icon={ListChecks}>
      {v.loading ? <Loading lines={3} /> : !rows.length ? <Empty title="Nicio verificare rulată">Nu există rezultate de teste pentru această misiune.</Empty> : (
        <table className="table small"><thead><tr><th>Etapa</th><th>Comanda</th><th>Rezultat</th><th>Număr</th><th>Unde</th></tr></thead>
          <tbody>{rows.map((e) => <tr key={e.id}><td>{e.stage}</td><td className="mono">{e.command}</td><td><Chip tone={EVIDENCE_TONE[e.status] || "neutral"}>{e.status}</Chip></td>
            <td>{e.counts?.tests !== undefined ? `${e.counts.pass ?? "?"}/${e.counts.tests}` : "—"}</td><td className="faint">{e.runner}</td></tr>)}</tbody></table>
      )}
      <Src>Numerele vin din ieșirea testelor (TAP); fără raportare per test, nu inventez progres.</Src>
    </CardShell>
  );
}

export function ReviewPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const reviews = v.data?.reviews || [];
  const findings = v.data?.findings || [];
  return (
    <CardShell {...rest} title="Review (Claude, doar citire)" icon={MessageSquareText}>
      {v.loading ? <Loading lines={3} /> : !reviews.length ? <Empty title="Niciun review încă" /> : (
        <>
          {reviews.slice(-2).map((r) => <div key={r.id} className="stack tight"><div className="row"><Chip tone={r.verdict === "PASS" ? "ok" : r.verdict === "CHANGES_REQUESTED" ? "warn" : "neutral"}>{r.verdict}</Chip><span className="faint small">{r.status} · change set {String(r.changeSetSha).slice(0, 12)}</span></div><p className="small">{r.summary}</p></div>)}
          {findings.length > 0 && <ul className="plain small">{findings.slice(0, 8).map((f) => <li key={f.id}><Chip tone={f.severity === "high" || f.severity === "critical" ? "error" : "neutral"}>{f.code} {f.severity}</Chip> {f.file} — {f.observation} <Src>{f.status}</Src></li>)}</ul>}
        </>
      )}
    </CardShell>
  );
}

/** Read-only, historical replay with a seek slider; "Revino la acum" leaves it without mixing it with live state. */
export function Replay({ missionId, onExit, ...rest }) {
  const r = useResource(missionId ? `/api/missions/${missionId}/replay` : null);
  const [i, setI] = useState(0);
  const frames = r.data?.frames || [];
  useEffect(() => { if (r.data?.firstFailure) setI(Math.max(0, frames.indexOf(frames.find((f) => f.at === r.data.firstFailure.at && f.title === r.data.firstFailure.title)))); }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = frames[i];
  return (
    <CardShell {...rest} title="Reluare (doar citire, istoric)" icon={History} actions={<button className="btn sm" onClick={onExit}><Rewind size={13} />Revino la acum</button>}>
      {r.loading ? <Loading lines={3} /> : !frames.length ? <Empty title="Nimic de reluat" /> : (
        <div className="stack tight replay">
          <Notice tone="info" title="READ_ONLY · HISTORICAL">Nimic nu se re-execută; niciun grant sau unealtă nu e creat.</Notice>
          <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Momentul din reluare" />
          <div className="row between small"><span>{i + 1} / {frames.length}</span><span className="mono">{fmt.dateTime(f.at)}</span></div>
          <p><Chip tone={f.kind === "evidence" && f.refs.status === "FAIL" ? "error" : "neutral"}>{f.kind}</Chip> <strong>{f.title}</strong></p>
          {f.detail && <pre className="pre small">{f.detail}</pre>}
          <div className="row wrap">{["evidence", "finding", "review", "change_set"].map((k) => { const idx = frames.findIndex((x, j) => j > i && x.kind === k); return idx > 0 ? <button key={k} className="btn sm ghost" onClick={() => setI(idx)}>următorul {k}</button> : null; })}</div>
        </div>
      )}
    </CardShell>
  );
}

export function Preview({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const pv = (v.data?.evidence || []).filter((e) => e.stage === "PREVIEW" && !e.stale).slice(-1)[0];
  const e2e = (v.data?.evidence || []).filter((e) => e.stage === "E2E" && !e.stale);
  return (
    <CardShell {...rest} title="Preview și E2E" icon={MonitorPlay}>
      {!pv ? <Empty title="Niciun preview încă" /> : (
        <dl className="kv small">
          <dt>Preview</dt><dd><Chip tone={EVIDENCE_TONE[pv.status]}>{pv.status}</Chip> {pv.detail?.reason}</dd>
          <dt>Unde</dt><dd>{pv.isolation}</dd>
          <dt>URL</dt><dd className="mono">{pv.detail?.url}{/bwrap/.test(pv.isolation || "") ? " (doar în namespace-ul mediului; nu e accesibil din browserul tău, intenționat)" : ""}</dd>
          {e2e.map((e) => <Fragment key={e.id}><dt>{e.command}</dt><dd><Chip tone={EVIDENCE_TONE[e.status]}>{e.status}</Chip> {e.outputTail || e.detail?.error || ""}</dd></Fragment>)}
        </dl>
      )}
    </CardShell>
  );
}

export function Briefing({ projectId, ...rest }) {
  const d = useResource(projectId ? `/api/cockpit/${projectId}/delta` : null);
  return (
    <CardShell {...rest} title="Ce s-a schimbat" icon={Newspaper}>
      {d.loading ? <Loading lines={2} /> : !d.data ? null : d.data.firstVisit ? <p className="small">E prima vizită înregistrată pe acest proiect; de acum îți arăt diferențele.</p> : (
        <ul className="plain small">
          <li>De la {fmt.dateTime(d.data.since)}: {d.data.events} evenimente</li>
          <li>Execuții: {d.data.runs.completed} terminate, {d.data.runs.failed} eșuate, {d.data.runs.interrupted} întrerupte</li>
          <li>Livrări gata: {d.data.deliveries} · blocaje: {d.data.blocked} · acceptate: {d.data.accepted}</li>
        </ul>
      )}
      <Src>{d.data?.timezoneNote}</Src>
    </CardShell>
  );
}

export function Explain({ data, ...rest }) {
  if (!data) return null;
  return (
    <CardShell {...rest} title="Explicație" icon={HelpCircle}>
      {data.runs && (data.idle ? <p className="small">Acum nu rulează nimic.</p> : <ul className="plain small">{data.runs.map((r) => <li key={r.runId}><strong>{r.provider}</strong> · {r.stage || "—"} · {r.environment} · {r.phase} · {r.elapsedS ?? "?"} s{r.stale ? ` · fără activitate de ${r.quietS} s` : ""} <Src>ultimul eveniment: {r.lastConfirmed?.type || "—"} · progres {r.progress}</Src></li>)}{data.missions.map((m) => <li key={m.missionId}>„{m.title}” · {m.stage}{m.reason ? ` — ${m.reason}` : ""}</li>)}</ul>)}
      {data.items && (data.items.length ? <ul className="plain small">{data.items.map((i, k) => <li key={k}><strong>{i.what}</strong>: {i.rule}<div className="faint">→ {i.action}</div></li>)}</ul> : <p className="small">Nimic nu e blocat.</p>)}
      {data.reason && <p className="small">{data.reason}{data.plan ? ` · model ${data.plan.model || "—"}, efort ${data.plan.effort || "—"}` : ""} <Src>{data.source}</Src></p>}
    </CardShell>
  );
}

export function CompanyMap({ departmentKey, onDepartment, ...rest }) {
  const map = useResource("/api/company/map", { reloadOn: (e) => e.type.startsWith("run.") || e.type.startsWith("factory.") });
  const depts = map.data?.departments || [];
  const focus = depts.find((d) => d.key === departmentKey) || null;
  return (
    <CardShell {...rest} title={focus ? `Companie › ${focus.name}` : "Compania"} icon={Building2} actions={focus && <button className="btn sm ghost" onClick={() => onDepartment(null)}>Înapoi</button>}>
      {map.loading ? <Loading lines={3} /> : !focus ? (
        <ul className="plain company-list">{depts.map((d) => <li key={d.key}><button className="link-btn" onClick={() => onDepartment(d.key)}>{d.name}</button> <Src>{d.rolesConfigured} roluri configurate · {d.missions.length} misiuni · {d.activeExecutions} execuții active</Src></li>)}</ul>
      ) : (
        <ul className="plain">{focus.missions.length ? focus.missions.map((m) => <li key={m.id}><a href={`#/missions/${m.id}`}>{m.title}</a> <Src>{m.stage || m.status}{m.waitReason ? ` · așteaptă ${m.waitReason}` : ""}</Src>{m.executions.map((x) => <div key={x.runId} className="small">↳ {x.provider} · {x.environment} · {x.phase}</div>)}</li>) : <li className="faint small">Nicio misiune în departament.</li>}</ul>
      )}
      <Src>{map.data?.note}</Src>
    </CardShell>
  );
}
