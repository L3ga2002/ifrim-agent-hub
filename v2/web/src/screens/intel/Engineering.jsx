import { useState } from "react";
import { Siren, Plus, Check, X, ArrowRight, Wrench, PauseCircle, Rocket, ListChecks, Sparkles, Undo2, Play, Trash2 } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice, Chip } from "../../components/ui.jsx";
import { FACTORY_STAGE_RO } from "../../lib/uiLogic.js";
import { INCIDENT_RO, INCIDENT_TONE, ENTRY_RO, ENTRY_STATUS_TONE, OBJECTIVE_RO, OBJECTIVE_TONE, CANDIDATE_RO, CANDIDATE_TONE, intelHref } from "../../lib/intelLogic.js";
import { useIntel, post, useRun, SourceNote, ProjectSelect } from "./common.jsx";

// ---------------------------------------------------------------- War Room
export function WarRoom({ itemId, go }) {
  const list = useIntel("/api/warroom", ["incident."]);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const r = useRun();
  const create = (e) => { e.preventDefault(); r.run("new", async () => { const out = await post("/api/warroom", { projectId, text }, { toast: "Incident PROPUS (nimic oprit sau modificat)", reauth: false }); setText(""); list.reload(); go(intelHref("warroom", out.incident.id)); }); };
  return (
    <div className="intel-grid">
      <div className="stack">
        <Panel title="Raportează o problemă" icon={Siren}>
          <form className="stack tight" onSubmit={create}>
            <ProjectSelect value={projectId} onChange={setProjectId} />
            <label className="field"><span>Ce s-a întâmplat (cuvintele tale)</span><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. Checkout-ul dă eroare 500 de azi-dimineață" /></label>
            <button className="btn primary" disabled={!projectId || text.trim().length < 3 || Boolean(r.busy)}><Plus size={14} />Deschide incidentul</button>
            <ErrorNotice error={r.error} />
          </form>
          <p className="faint small">Raportul tău e un semnal neconfirmat: Hub-ul nu presupune că ceva e offline și nu pornește nicio modificare.</p>
        </Panel>
        <Panel title="Incidente" icon={Siren}>
          {list.loading ? <Loading lines={3} /> : list.data?.incidents?.length ? (
            <ul className="plain intel-list">{list.data.incidents.map((i) => (
              <li key={i.id} className={i.id === itemId ? "is-current" : ""}><a href={`#${intelHref("warroom", i.id)}`}>{i.title}</a> <Chip tone={INCIDENT_TONE[i.status]}>{INCIDENT_RO[i.status]}</Chip>
                {i.priorityRecommended && <Chip tone="neutral" title={i.priorityRecommended.reason}>recomandat {i.priorityRecommended.level}</Chip>}{i.impactConfirmed && <Chip tone="warn">impact confirmat</Chip>}
                <div className="faint small">{fmt.dateTime(i.createdAt)}</div></li>
            ))}</ul>
          ) : <Empty title="Niciun incident" />}
        </Panel>
      </div>
      <div className="span-2">{itemId ? <Incident id={itemId} /> : <Panel title="War Room"><p className="faint">Alege un incident sau raportează unul. Lega deschide unul când spui „X a picat”.</p>{list.data?.needed && <><p className="small">Ce te voi întreba:</p><ul className="small">{list.data.needed.map((n) => <li key={n}>{n}</li>)}</ul></>}</Panel>}</div>
    </div>
  );
}

function Incident({ id }) {
  const inc = useIntel(`/api/warroom/${id}`, ["incident.", "factory."]);
  const pause = useResource(`/api/warroom/${id}/suggest-pause`);
  const r = useRun();
  const [entry, setEntry] = useState({ kind: "hypothesis", text: "" });
  const [verify, setVerify] = useState({});
  const [impact, setImpact] = useState({ what: "", who: "", since: "", severity: "" });
  const [components, setComponents] = useState("");
  const [testRef, setTestRef] = useState("");
  if (inc.loading) return <Loading lines={6} />;
  if (inc.error) return <ErrorNotice error={inc.error} onRetry={inc.reload} />;
  const i = inc.data;
  const act = (key, path, body, toast) => r.run(key, async () => { await post(path, body, { toast, reauth: false }); inc.reload(); });
  return (
    <div className="stack">
      <Panel title={i.title} icon={Siren} actions={<Chip tone={INCIDENT_TONE[i.status]}>{INCIDENT_RO[i.status]}</Chip>}>
        <p className="small">„{i.reportedText}” <span className="faint">— {i.reportSource === "lega" ? "prin Lega" : "raportat de tine"}, {fmt.dateTime(i.createdAt)}</span></p>
        <div className="row wrap">
          {i.priorityRecommended && <Chip tone="neutral" title={i.priorityRecommended.reason}>prioritate recomandată {i.priorityRecommended.level} (neconfirmată)</Chip>}
          <Chip tone={i.impactState === "CONFIRMED" ? "warn" : "neutral"}>{i.impactState === "CONFIRMED" ? `impact confirmat: ${i.impactConfirmed.what}` : "impact neconfirmat"}</Chip>
          {i.versionRef?.headRef && <Chip tone="neutral">versiune {String(i.versionRef.headRef).replace("ref: refs/heads/", "").slice(0, 24)}</Chip>}
        </div>
        <div className="row wrap" role="group" aria-label="Schimbă starea">
          {i.allowedNext.map((to) => <button key={to} className="btn sm" disabled={Boolean(r.busy)} onClick={() => act(`t-${to}`, `/api/warroom/${id}/transition`, { to, reason: "din War Room" }, `Incident: ${INCIDENT_RO[to]}`)}><ArrowRight size={12} />{INCIDENT_RO[to]}</button>)}
        </div>
        <p className="faint small">Niciodată automat: {i.neverAutomatic.join(", ")}. „Rezolvat” cere o dovadă confirmată.</p>
        <ErrorNotice error={r.error} />
      </Panel>
      <div className="intel-grid">
        {[["Semnale", i.signals], ["Ipoteze", i.hypotheses], ["Acțiuni", i.actions], ["Dovezi", i.evidence]].map(([title, items]) => (
          <Panel key={title} title={title}>
            {items.length ? <ul className="plain small intel-entries">{items.map((e) => (
              <li key={e.id}><Chip tone={ENTRY_STATUS_TONE[e.status] || "neutral"}>{e.status === "CONFIRMED" ? "confirmat" : e.status === "REFUTED" ? "respins" : "neconfirmat"}</Chip> {e.text}
                <div className="faint">{ENTRY_RO[e.kind]} · {e.sourceKind}{e.sourceRef ? ` · ${e.sourceRef}` : ""} · {fmt.time(e.createdAt)}</div>
                {e.status === "UNCONFIRMED" && (
                  <div className="row wrap">
                    <input className="input sm" value={verify[e.id] || ""} onChange={(ev) => setVerify((v) => ({ ...v, [e.id]: ev.target.value }))} placeholder="dovada (link, log, test)" aria-label="Dovadă" />
                    <button className="btn sm" disabled={!String(verify[e.id] || "").trim() || Boolean(r.busy)} onClick={() => act(`v-${e.id}`, `/api/warroom/entries/${e.id}/verify`, { status: "CONFIRMED", evidenceRef: verify[e.id] }, "Confirmat cu dovadă")}><Check size={12} />Confirmă</button>
                    <button className="btn sm ghost" disabled={!String(verify[e.id] || "").trim() || Boolean(r.busy)} onClick={() => act(`x-${e.id}`, `/api/warroom/entries/${e.id}/verify`, { status: "REFUTED", reason: verify[e.id] }, "Respins")}><X size={12} />Respinge</button>
                  </div>
                )}
              </li>
            ))}</ul> : <p className="faint small">—</p>}
          </Panel>
        ))}
        <Panel title="Adaugă">
          <form className="stack tight" onSubmit={(e) => { e.preventDefault(); act("entry", `/api/warroom/${id}/entries`, entry, "Adăugat (neconfirmat)").then(() => setEntry((x) => ({ ...x, text: "" }))); }}>
            <select className="input" value={entry.kind} onChange={(e) => setEntry((x) => ({ ...x, kind: e.target.value }))} aria-label="Tip">{["signal", "hypothesis", "action", "evidence", "note"].map((k) => <option key={k} value={k}>{ENTRY_RO[k]}</option>)}</select>
            <textarea className="input" rows={2} value={entry.text} onChange={(e) => setEntry((x) => ({ ...x, text: e.target.value }))} aria-label="Text" />
            <button className="btn sm" disabled={entry.text.trim().length < 2 || Boolean(r.busy)}><Plus size={12} />Adaugă</button>
          </form>
        </Panel>
        <Panel title="Impactul confirmat de tine">
          <form className="stack tight" onSubmit={(e) => { e.preventDefault(); act("impact", `/api/warroom/${id}/impact`, { impact }, "Impact confirmat"); }}>
            <input className="input" value={impact.what} onChange={(e) => setImpact((x) => ({ ...x, what: e.target.value }))} placeholder="ce nu merge pentru cine" aria-label="Impact" />
            <div className="row"><input className="input" value={impact.who} onChange={(e) => setImpact((x) => ({ ...x, who: e.target.value }))} placeholder="cine e afectat" aria-label="Cine" />
              <select className="input" value={impact.severity} onChange={(e) => setImpact((x) => ({ ...x, severity: e.target.value }))} aria-label="Severitate"><option value="">severitate</option><option>P1</option><option>P2</option><option>P3</option></select></div>
            <button className="btn sm" disabled={!impact.what.trim() || Boolean(r.busy)}><Check size={12} />Confirmă impactul</button>
          </form>
        </Panel>
        <Panel title="Componente implicate">
          <p className="small">{i.components.length ? i.components.map((c) => `${c.name} (${c.kind === "DECLARED" ? "declarat" : "ipoteză"})`).join(", ") : "—"}</p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); act("comp", `/api/warroom/${id}/components`, { components: components.split(",").map((s) => s.trim()).filter(Boolean) }, "Componente salvate"); }}>
            <input className="input" value={components} onChange={(e) => setComponents(e.target.value)} placeholder="checkout, plăți" aria-label="Componente" /><button className="btn sm" disabled={!components.trim() || Boolean(r.busy)}>Salvează</button>
          </form>
          {i.recentChanges?.length > 0 && <SourceNote>Schimbări recente pe proiect (72 h): {i.recentChanges.length} — o corelație de timp, nu o cauză.</SourceNote>}
        </Panel>
        <Panel title="Remediere" icon={Wrench}>
          {i.remediation ? <p className="small"><a href={`#/missions/${i.remediation.missionId}`}>{i.remediation.title}</a> · {FACTORY_STAGE_RO[i.remediation.stage] || i.remediation.stage}</p> : (
            <form className="stack tight" onSubmit={(e) => { e.preventDefault(); act("rem", `/api/warroom/${id}/remediate`, { testRef }, "Ciornă de remediere creată (nu pornește nimic)"); }}>
              <input className="input" value={testRef} onChange={(e) => setTestRef(e.target.value)} placeholder="testul care reproduce problema (ex. tests/checkout.test.js)" aria-label="Test de reproducere" />
              <button className="btn sm" disabled={Boolean(r.busy)}><Wrench size={12} />Pregătește misiunea de remediere</button>
              <p className="faint small">O misiune BUGFIX ca ciornă; pornește doar după planul confirmat de tine.</p>
            </form>
          )}
          {pause.data?.candidates?.length > 0 && <Notice tone="info" title={`Pot fi puse pe pauză ${pause.data.candidates.length} misiuni`}><PauseCircle size={12} /> {pause.data.note}</Notice>}
        </Panel>
      </div>
      <Panel title="Cronologie">
        <ol className="small intel-timeline">{i.timeline.map((e) => <li key={e.id}><span className="faint">{fmt.dateTime(e.createdAt)}</span> {e.text}</li>)}</ol>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Autopilot
const emptyTask = (n) => ({ key: `t${n}`, title: "", workType: "FEATURE", acceptance: "", dependsOn: "", inScope: "", estimateMinutes: 45 });

export function Autopilot({ itemId, go }) {
  const list = useIntel("/api/autopilot", ["autopilot.", "factory.", "envelope."]);
  const [form, setForm] = useState({ projectId: "", title: "", criteria: "", tasks: [emptyTask(1)] });
  const [check, setCheck] = useState(null);
  const r = useRun();
  const body = () => ({ projectId: form.projectId, title: form.title, criteria: form.criteria.split("\n").map((s) => s.trim()).filter(Boolean),
    tasks: form.tasks.map((t) => ({ key: t.key, title: t.title, workType: t.workType, acceptance: t.acceptance.split("\n").map((s) => s.trim()).filter(Boolean), dependsOn: t.dependsOn.split(",").map((s) => s.trim()).filter(Boolean),
      inScope: t.inScope.split(",").map((s) => s.trim()).filter(Boolean), maxDurationMin: Math.min(120, Number(t.estimateMinutes) || 45) })) });
  const setTask = (i, patch) => setForm((f) => ({ ...f, tasks: f.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const validate = () => r.run("val", async () => setCheck(await api("/api/autopilot/validate", { method: "POST", body: body() })));
  const draft = () => r.run("draft", async () => { const o = await post("/api/autopilot", body(), { toast: "Obiectiv salvat ca ciornă (nimic nu pornește)", reauth: false }); list.reload(); go(intelHref("autopilot", o.id)); });
  return (
    <div className="intel-grid">
      <div className="stack">
        <Panel title="Obiective" icon={Rocket}>
          {list.loading ? <Loading lines={3} /> : list.data?.objectives?.length ? <ul className="plain intel-list">{list.data.objectives.map((o) => (
            <li key={o.id} className={o.id === itemId ? "is-current" : ""}><a href={`#${intelHref("autopilot", o.id)}`}>{o.title}</a> <Chip tone={OBJECTIVE_TONE[o.status]}>{OBJECTIVE_RO[o.status] || o.status}</Chip> <span className="faint small">{o.progress.delivered}/{o.progress.total}</span></li>
          ))}</ul> : <Empty title="Niciun obiectiv">Un obiectiv = câteva sarcini dependente, cu criterii și limite, executate sub un singur plan confirmat de tine.</Empty>}
        </Panel>
        <Panel title="Obiectiv nou" icon={Plus}>
          <div className="stack tight">
            <ProjectSelect value={form.projectId} onChange={(v) => setForm((f) => ({ ...f, projectId: v }))} />
            <label className="field"><span>Titlu</span><input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></label>
            <label className="field"><span>Criterii de reușită (unul pe rând)</span><textarea className="input" rows={2} value={form.criteria} onChange={(e) => setForm((f) => ({ ...f, criteria: e.target.value }))} /></label>
            {form.tasks.map((t, i) => (
              <fieldset key={i} className="task-box"><legend>Sarcina {t.key}</legend>
                <input className="input" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} placeholder="titlu" aria-label="Titlu sarcină" />
                <div className="row"><select className="input" value={t.workType} onChange={(e) => setTask(i, { workType: e.target.value })} aria-label="Tip">{["FEATURE", "BUGFIX", "REFACTOR"].map((w) => <option key={w}>{w}</option>)}</select>
                  <input className="input" value={t.dependsOn} onChange={(e) => setTask(i, { dependsOn: e.target.value })} placeholder="depinde de (ex. t1)" aria-label="Dependențe" />
                  <input className="input" type="number" min={5} max={120} value={t.estimateMinutes} onChange={(e) => setTask(i, { estimateMinutes: e.target.value })} aria-label="Minute estimate" /></div>
                <textarea className="input" rows={2} value={t.acceptance} onChange={(e) => setTask(i, { acceptance: e.target.value })} placeholder="criterii de acceptare (unul pe rând)" aria-label="Criterii de acceptare" />
                <input className="input" value={t.inScope} onChange={(e) => setTask(i, { inScope: e.target.value })} placeholder="fișiere/foldere permise (ex. src/cart/)" aria-label="Scope" />
                {form.tasks.length > 1 && <button type="button" className="btn sm ghost" onClick={() => setForm((f) => ({ ...f, tasks: f.tasks.filter((_, j) => j !== i) }))}><Trash2 size={12} />Elimină</button>}
              </fieldset>
            ))}
            <div className="row wrap">
              <button type="button" className="btn sm ghost" disabled={form.tasks.length >= 5} onClick={() => setForm((f) => ({ ...f, tasks: [...f.tasks, emptyTask(f.tasks.length + 1)] }))}><Plus size={12} />Sarcină (max 5)</button>
              <button type="button" className="btn sm" disabled={Boolean(r.busy)} onClick={validate}><ListChecks size={12} />Validează</button>
              <button type="button" className="btn sm primary" disabled={Boolean(r.busy) || !form.projectId || !form.title.trim()} onClick={draft}>Salvează ciorna</button>
            </div>
            {check && (check.ok ? <Notice tone="info">Plan valid: ordinea {check.order.join(" → ")}, ~{check.totalMinutes} min.</Notice> : <Notice tone="warn" title="De corectat">{check.problems.join(" · ")}</Notice>)}
            <ErrorNotice error={r.error} />
          </div>
        </Panel>
      </div>
      <div className="span-2">{itemId ? <Objective id={itemId} go={go} /> : <Panel title="Autopilot"><p className="faint">Alege un obiectiv. Autopilotul nu are drept de reluare propriu: merge doar în limitele planului confirmat, se oprește la condițiile de oprire și îți cere decizia la orice diferență.</p></Panel>}</div>
    </div>
  );
}

function Objective({ id, go }) {
  const o = useIntel(`/api/autopilot/${id}`, ["autopilot.", "factory.", "envelope."]);
  const r = useRun();
  const [note, setNote] = useState(null);
  if (o.loading) return <Loading lines={5} />;
  if (o.error) return <ErrorNotice error={o.error} onRetry={o.reload} />;
  const v = o.data;
  const prepare = () => r.run("prep", async () => { const out = await post(`/api/autopilot/${id}/prepare`, {}, { reauth: false }); setNote(out.note); o.reload(); });
  const propose = () => r.run("prop", async () => { const out = await post(`/api/autopilot/${id}/propose`, {}, { reauth: false }); setNote(out.plan?.summary ? `Plan: ${out.plan.summary.headline}. Îl confirmi în cockpit.` : out.plan?.error || "Plan pregătit"); o.reload(); if (out.plan?.envelope?.id) go(`/lega/${v.projectId}`); });
  return (
    <Panel title={v.title} icon={Rocket} actions={<Chip tone={OBJECTIVE_TONE[v.status]}>{OBJECTIVE_RO[v.status] || v.status}</Chip>}>
      {v.criteria.length > 0 && <><h3 className="h3">Criterii</h3><ul className="small">{v.criteria.map((c, i) => <li key={i}>{typeof c === "string" ? c : c.text}</li>)}</ul></>}
      <h3 className="h3">Sarcini (în ordinea dependențelor)</h3>
      <ol className="intel-tasks">{v.tasks.map((t) => (
        <li key={t.key}><strong>{t.key}</strong> {t.title} <Chip tone="neutral">{t.workType}</Chip> {t.stage ? <Chip tone={["DELIVERY_READY", "ACCEPTED"].includes(t.stage) ? "ok" : ["BLOCKED", "NEEDS_OWNER_DECISION"].includes(t.stage) ? "warn" : "info"}>{FACTORY_STAGE_RO[t.stage] || t.stage}</Chip> : <Chip tone="neutral">nepregătită</Chip>}
          {t.dependsOn.length > 0 && <span className="faint small"> · după {t.dependsOn.join(", ")}</span>}{t.waitingOn.length > 0 && <span className="faint small"> · așteaptă {t.waitingOn.join(", ")}</span>}
          {t.missionId && <> · <a className="small" href={`#/missions/${t.missionId}`}>misiunea</a></>}{t.stageReason && <div className="faint small">{t.stageReason}</div>}</li>
      ))}</ol>
      <dl className="kv small"><dt>Limite</dt><dd>~{v.plan.totalMinutes} min total · {v.limits.maxAttemptsPerStage} încercări/etapă · {v.limits.maxRepairCycles} cicluri de reparare</dd>
        <dt>Oprire</dt><dd>{(v.plan.stopConditions || []).slice(0, 5).join(" · ")}</dd>
        <dt>Plan</dt><dd>{v.envelope ? `${v.envelope.id} · ${v.envelope.status} · ${v.envelope.autonomyLevel}` : "—"}</dd></dl>
      <div className="row wrap">
        {v.status === "DRAFT" && <button className="btn sm" disabled={Boolean(r.busy)} onClick={prepare}><ListChecks size={12} />Pregătește sarcinile (ciorne)</button>}
        {v.status === "PREPARED" && <button className="btn sm primary" disabled={Boolean(r.busy)} onClick={propose}><Play size={12} />Arată-mi planul</button>}
      </div>
      {note && <Notice tone="info">{note}</Notice>}
      <ErrorNotice error={r.error} />
      <SourceNote>Starea e derivată din misiuni și din plan (niciun client nu o setează). Un scope schimbat = o versiune nouă care cere o nouă confirmare.</SourceNote>
    </Panel>
  );
}

// ---------------------------------------------------------------- Skill Evolution
export function Skills({ itemId, go }) {
  const list = useIntel("/api/skills/candidates", ["skill."]);
  const skills = useResource("/api/skills");
  const [form, setForm] = useState({ skillId: "", reason: "", evidence: "", body: "" });
  const r = useRun();
  const propose = (e) => { e.preventDefault(); r.run("prop", async () => { const c = await post("/api/skills/candidates", { skillId: form.skillId, reason: form.reason, body: form.body, evidence: form.evidence.split("\n").map((s) => s.trim()).filter(Boolean) }, { toast: "Candidat propus", reauth: false }); list.reload(); go(intelHref("skills", c.id)); }); };
  return (
    <div className="intel-grid">
      <div className="stack">
        <Panel title="Candidați" icon={Sparkles}>
          {list.data?.candidates?.length ? <ul className="plain intel-list">{list.data.candidates.map((c) => <li key={c.id} className={c.id === itemId ? "is-current" : ""}><a href={`#${intelHref("skills", c.id)}`}>{c.skillId} v{c.baseVersion} → {c.candidateVersion ? `v${c.candidateVersion}` : "nou"}</a> <Chip tone={CANDIDATE_TONE[c.status]}>{CANDIDATE_RO[c.status] || c.status}</Chip></li>)}</ul> : <Empty title="Niciun candidat">Un skill se schimbă doar prin propunere → evaluare → aprobarea ta → activare limitată, cu revenire.</Empty>}
        </Panel>
        <Panel title="Propune o modificare" icon={Plus}>
          <form className="stack tight" onSubmit={propose}>
            <select className="input" value={form.skillId} onChange={(e) => { const skillId = e.target.value; setForm((f) => ({ ...f, skillId })); if (skillId) api(`/api/skills/candidates/base/${skillId}`).then((b) => setForm((f) => (f.skillId === skillId ? { ...f, body: b.body || "" } : f))).catch(() => {}); }} aria-label="Skill"><option value="">— skill —</option>{(skills.data?.skills || []).map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}</select>
            <input className="input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="de ce (problema observată)" aria-label="Motiv" />
            <textarea className="input" rows={2} value={form.evidence} onChange={(e) => setForm((f) => ({ ...f, evidence: e.target.value }))} placeholder="dovezi: execuții, review-uri, misiuni (una pe rând)" aria-label="Dovezi" />
            <textarea className="input mono" rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="corpul nou al skill-ului (fără frontmatter)" aria-label="Corp" />
            <button className="btn sm primary" disabled={!form.skillId || !form.reason.trim() || !form.body.trim() || Boolean(r.busy)}>Propune</button>
            <ErrorNotice error={r.error} />
          </form>
        </Panel>
      </div>
      <div className="span-2">{itemId ? <Candidate id={itemId} /> : <Panel title="Skill Evolution"><p className="faint">Alege un candidat. Execuțiile care rulează deja rămân pe versiunea lor; activarea poate fi limitată la câteva proiecte.</p></Panel>}</div>
    </div>
  );
}

function Candidate({ id }) {
  const c = useIntel(`/api/skills/candidates/${id}`, ["skill."]);
  const r = useRun();
  const [projectId, setProjectId] = useState("");
  if (c.loading) return <Loading lines={5} />;
  if (c.error) return <ErrorNotice error={c.error} onRetry={c.reload} />;
  const v = c.data;
  const act = (key, action, body = {}, toast) => r.run(key, async () => { await post(`/api/skills/candidates/${id}/${action}`, body, { toast }); c.reload(); });
  const ev = v.evaluation;
  return (
    <Panel title={`${v.skillId}: v${v.baseVersion} → ${v.candidateVersion ? `v${v.candidateVersion}` : "candidat"}`} icon={Sparkles} actions={<Chip tone={CANDIDATE_TONE[v.status]}>{CANDIDATE_RO[v.status] || v.status}</Chip>}>
      <p className="small"><strong>Motiv:</strong> {v.reason}</p>
      {v.evidence.length > 0 && <ul className="small">{v.evidence.map((e, i) => <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>)}</ul>}
      <details><summary className="small">Diferența ({v.diff.length} linii)</summary><pre className="diff small">{v.diff.slice(0, 200).map((d) => `${d.op === "+" ? "+" : d.op === "-" ? "-" : " "} ${d.line ?? d.text ?? ""}`).join("\n")}</pre></details>
      {ev && (
        <div className="small stack tight">
          <Chip tone={ev.pass ? "ok" : "error"}>{ev.pass ? "evaluare trecută" : "evaluare picată"}</Chip>
          {ev.static.problems.length > 0 && <Notice tone="warn">{ev.static.problems.join(" · ")}</Notice>}
          {ev.cases.length > 0 && <ul className="plain">{ev.cases.map((x) => <li key={x.name}>{x.name}: bază {x.onBase ? "✓" : "✗"} · candidat {x.onCandidate ? "✓" : "✗"}{x.regression ? " — REGRESIE" : ""}</li>)}</ul>}
          <p className="faint">{ev.compatibility} · evaluare cu model: {ev.modelEvaluation}</p>
        </div>
      )}
      <div className="row wrap">
        {["PROPOSED", "EVALUATED"].includes(v.status) && <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => act("eval", "evaluate", {}, "Evaluat (determinist)")}><ListChecks size={12} />Evaluează</button>}
        {v.status === "EVALUATED" && ev?.pass && <button className="btn sm primary" disabled={Boolean(r.busy)} onClick={() => act("appr", "approve", {}, "Aprobat (încă inactiv)")}><Check size={12} />Aprobă</button>}
        {v.status === "APPROVED" && <>
          <ProjectSelect value={projectId} onChange={setProjectId} inline label="Activează doar pe" />
          <button className="btn sm" disabled={!projectId || Boolean(r.busy)} onClick={() => act("actl", "activate", { projectIds: [projectId] }, "Activ limitat")}><Play size={12} />Activare limitată</button>
          <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => act("acta", "activate", { all: true }, "Activ peste tot")}>Peste tot</button>
        </>}
        {["ACTIVE", "ACTIVE_LIMITED"].includes(v.status) && <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => act("rb", "rollback", { reason: "revenire din UI" }, "Revenit la versiunea de bază")}><Undo2 size={12} />Revino la bază</button>}
        {["PROPOSED", "EVALUATED", "APPROVED"].includes(v.status) && <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => act("rej", "reject", { reason: "respins din UI" }, "Respins")}><X size={12} />Respinge</button>}
      </div>
      <ErrorNotice error={r.error} />
      <SourceNote>Git rămâne sursa de adevăr pentru fișierele skill. Activarea înregistrează versiunea aprobată în registrul Hub-ului (limitat la proiectele alese, cu revenire imediată); conținutul skill-urilor nu e încă injectat în instrucțiunile agenților, așa că activarea nu schimbă singură ce face un agent, iar efectul nu se măsoară automat.</SourceNote>
    </Panel>
  );
}
