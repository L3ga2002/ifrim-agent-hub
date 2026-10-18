import { useEffect, useState } from "react";
import { Sun, Network, ShieldQuestion, History, Crosshair, HelpCircle, Users, ChevronRight, ChevronLeft, Check, X, Clock, FlaskConical, Trophy, Plus } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice, Chip } from "../../components/ui.jsx";
import { BOARD_ITEM_TONE, BOARD_ITEM_RO, evidenceLabel, fmtHours, fmtWeeks, fmtMoney, parseSimInput, intelHref } from "../../lib/intelLogic.js";
import { useIntel, post, useRun, SimBadge, SourceNote, Unknowns, ProjectSelect } from "./common.jsx";

// ---------------------------------------------------------------- Azi
/** "Ce avem azi?": the deterministic digest (no model) and the plans that wait for you. */
export function Today({ go }) {
  const today = useIntel("/api/today", ["board.", "envelope.", "factory.", "incident.", "autopilot.", "package."]);
  if (today.loading) return <Loading lines={5} />;
  if (today.error) return <ErrorNotice error={today.error} onRetry={today.reload} />;
  const t = today.data;
  return (
    <div className="intel-grid">
      <Panel title="Ce avem azi" icon={Sun} className="span-2">
        {t.headline.length ? (
          <ul className="plain intel-list">
            {t.headline.map((h, i) => (
              <li key={i}><span className="faint small">{h.section}</span> <strong>{h.title}</strong>
                {h.body?.items?.length > 0 && <ul className="plain small">{h.body.items.slice(0, 5).map((x, j) => <li key={j}>{x.mission || x.title || x.missionId || x.bundleId || JSON.stringify(x).slice(0, 80)}{x.stage ? ` · ${x.stage}` : ""}{x.status ? ` · ${x.status}` : ""}</li>)}</ul>}
                {h.body?.stuck?.length > 0 && <ul className="plain small">{h.body.stuck.slice(0, 5).map((x) => <li key={x.missionId}>{x.title} · {x.stage}{x.reason ? ` — ${x.reason}` : ""}</li>)}</ul>}
              </li>
            ))}
          </ul>
        ) : <Empty title="Nimic care să ceară atenția ta azi">Datele Hub-ului nu arată blocaje, decizii sau incidente noi.</Empty>}
        <SourceNote>{t.generatedBy || "Agenda deterministă din datele Hub-ului"} · {fmt.dateTime(t.generatedAt)} · {t.all} subiecte în total (vezi Ședința).</SourceNote>
      </Panel>
      <Panel title="Planuri care așteaptă confirmarea ta">
        {t.pendingPlans.length ? <ul className="plain">{t.pendingPlans.map((p) => <li key={p.envelopeId}><a href={`#/lega/${p.projectId || ""}`}>{p.headline || p.envelopeId}</a></li>)}</ul> : <p className="faint small">Niciun plan în așteptare.</p>}
        <p className="faint small">Pornire: {t.startView === "stage" ? "ecranul mare Lega" : "cockpit-ul proiectului"} (se schimbă din cockpit sau cu „Pornește direct în ecran complet”).</p>
        <button className="btn sm" onClick={() => go(intelHref("board"))}><Users size={13} />Ședința săptămânală</button>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Digital Twin
const KIND_TONE = { OBSERVED: "ok", DECLARED: "info", HYPOTHESIS: "warn" };
const KIND_RO = { OBSERVED: "observat", DECLARED: "declarat de tine", HYPOTHESIS: "ipoteză" };

export function Twin({ itemId }) {
  const [projectId, setProjectId] = useState(itemId || "");
  const graph = useIntel(projectId ? `/api/twin/${projectId}` : "/api/twin/company", ["factory.", "incident.", "twin.", "autopilot."]);
  const blocked = useIntel(projectId ? `/api/twin/${projectId}/blocked` : null, ["factory.", "incident.", "envelope.", "settings."]);
  const changes = useIntel(projectId ? `/api/twin/${projectId}/changes` : null, ["factory.", "envelope.", "incident."]);
  const [impactQ, setImpactQ] = useState("");
  const [impact, setImpact] = useState(null);
  const [whyQ, setWhyQ] = useState("");
  const [why, setWhy] = useState(null);
  const [error, setError] = useState(null);
  const askImpact = async (e) => { e.preventDefault(); setError(null); try { setImpact(await api(`/api/twin/${projectId}/impact?${new URLSearchParams(/[/.]/.test(impactQ) ? { paths: impactQ } : { component: impactQ.trim() })}`)); } catch (er) { setError(er); } };
  const askWhy = async (e) => { e.preventDefault(); setError(null); try { setWhy(await api(`/api/twin/why?${new URLSearchParams({ q: whyQ, ...(projectId ? { projectId } : {}) })}`)); } catch (er) { setError(er); } };
  const g = graph.data;
  return (
    <div className="stack">
      <div className="row wrap"><ProjectSelect value={projectId} onChange={(v) => { setProjectId(v); setImpact(null); setWhy(null); }} allowEmpty inline label="Proiect (gol = compania)" /></div>
      <ErrorNotice error={error || graph.error} />
      <div className="intel-grid">
        <Panel title={projectId ? "Relațiile proiectului" : "Compania"} icon={Network} className="span-2">
          {graph.loading ? <Loading lines={4} /> : g && (
            <>
              <p className="faint small">{g.nodes.length} noduri · {g.edges.length} relații · fiecare relație are sursa ei; culoarea spune dacă e observată, declarată de tine sau doar ipoteză.</p>
              <ul className="plain intel-edges">
                {g.edges.slice(0, 60).map((e, i) => {
                  const from = g.nodes.find((n) => n.id === e.from); const to = g.nodes.find((n) => n.id === e.to);
                  return <li key={i}><Chip tone={KIND_TONE[e.kind] || "neutral"}>{KIND_RO[e.kind] || e.kind}</Chip> <span>{from?.label || e.from}</span> <span className="faint">— {e.type} →</span> <span>{to?.label || e.to}</span>{e.status ? <span className="faint small"> · {e.status}</span> : null} <span className="faint small src">{e.source?.table}{e.at ? ` · ${fmt.dateTime(e.at)}` : ""}</span></li>;
                })}
              </ul>
              {g.edges.length > 60 && <p className="faint small">+{g.edges.length - 60} relații (filtrează pe proiect).</p>}
              {g.shared?.map((s) => <Notice key={s.component} tone="info" title={`Componentă comună: ${s.component.split(":").pop()}`}>{s.note}</Notice>)}
              {g.contradictions?.map((c, i) => <Notice key={i} tone="warn" title="Contradicție între relații">{c.note || JSON.stringify(c).slice(0, 200)}</Notice>)}
              <Unknowns items={g.unknowns} />
            </>
          )}
        </Panel>
        {projectId && (
          <Panel title="De ce e blocat?" icon={ShieldQuestion}>
            {blocked.loading ? <Loading lines={3} /> : blocked.data && (blocked.data.chain.length ? (
              <ol className="intel-chain">{blocked.data.chain.map((c, i) => <li key={i}>{c.kind === "attention" ? <Chip tone="neutral">atenție</Chip> : <Chip tone="warn">blocaj</Chip>} <strong>{c.what}</strong><div className="small">{c.why}</div><div className="faint small">→ {c.next} <span className="src">({c.evidence?.table}{c.evidence?.at ? ` · ${fmt.dateTime(c.evidence.at)}` : ""})</span></div></li>)}</ol>
            ) : <Unknowns items={blocked.data.unknowns} />)}
          </Panel>
        )}
        {projectId && (
          <Panel title="Ce s-a schimbat" icon={History}>
            {changes.loading ? <Loading lines={3} /> : changes.data && (
              <>
                <p className="faint small">De la {fmt.dateTime(changes.data.since)} ({changes.data.sinceSource}) · {changes.data.counts.events} evenimente</p>
                {changes.data.items.length ? <ul className="plain small">{changes.data.items.slice(-12).reverse().map((it, i) => <li key={i}><Chip tone="neutral">{it.kind}</Chip> {it.text} <span className="faint">{fmt.time(it.at)}</span></li>)}</ul> : <p className="faint small">{changes.data.note}</p>}
                {changes.data.offlineNote && <p className="faint small">{changes.data.offlineNote}</p>}
              </>
            )}
          </Panel>
        )}
        {projectId && (
          <Panel title="Ce poate afecta schimbarea?" icon={Crosshair}>
            <form className="row" onSubmit={askImpact}><input className="input" value={impactQ} onChange={(e) => setImpactQ(e.target.value)} placeholder="componentă sau fișiere (separate prin virgulă)" aria-label="Componentă sau fișiere" /><button className="btn sm" disabled={!impactQ.trim()}>Calculează</button></form>
            {impact && (impact.components.length ? (
              <div className="small stack tight">
                <div>Componente: {impact.components.join(", ")}</div>
                <div>Schimbări anterioare: {impact.known.history.length} · incidente: {impact.known.incidents.length} · decizii: {impact.known.decisions.length} · relații declarate: {impact.known.declared.length}</div>
                {impact.known.history.slice(0, 4).map((h) => <div key={h.changeSetId} className="faint">„{h.mission}” · {h.files.join(", ")}</div>)}
                {impact.known.incidents.map((x) => <div key={x.incidentId} className="faint">Incident: {x.title} — {x.note}</div>)}
                <p className="faint">{impact.limits}</p>
                <Unknowns items={impact.unknowns} />
              </div>
            ) : <Unknowns items={impact.unknowns} />)}
          </Panel>
        )}
        {projectId && <DeclareRelation projectId={projectId} onSaved={graph.reload} />}
        <Panel title="De ce am ales…?" icon={HelpCircle}>
          <form className="row" onSubmit={askWhy}><input className="input" value={whyQ} onChange={(e) => setWhyQ(e.target.value)} placeholder="ex. React, Mongo, ruta WSL" aria-label="Întrebare" /><button className="btn sm" disabled={!whyQ.trim()}>Caută</button></form>
          {why && (why.found ? (
            <ul className="plain small">
              {why.decisions.map((d) => <li key={d.decisionId}><strong>{d.title}</strong>: {d.decision}{d.rationale ? <div className="faint">Motiv: {d.rationale}</div> : null}<div className="faint src">decizie {d.status} · {fmt.dateTime(d.at)}{d.sourceRef ? ` · ${d.sourceRef}` : ""}</div></li>)}
              {why.board.map((b) => <li key={b.boardItemId}><strong>{b.title}</strong> (ședință){b.note ? `: ${b.note}` : ""}</li>)}
            </ul>
          ) : <Notice tone="info">{why.note}</Notice>)}
        </Panel>
      </div>
    </div>
  );
}

/** The owner's own knowledge (DECLARED): "checkout depinde de plăți". A model or Lega can only add a hypothesis. */
function DeclareRelation({ projectId, onSaved }) {
  const [rel, setRel] = useState({ subject: "", predicate: "depinde de", object: "", note: "" });
  const r = useRun();
  const save = (e) => { e.preventDefault(); r.run("claim", async () => {
    await post("/api/twin/claims", { projectId, subject: { type: "component", id: rel.subject.trim() }, predicate: rel.predicate.trim(), object: { type: "component", id: rel.object.trim() }, kind: "DECLARED", note: rel.note }, { toast: "Relație declarată (sursa: tu)", reauth: false });
    setRel((x) => ({ ...x, subject: "", object: "", note: "" })); onSaved?.();
  }); };
  return (
    <Panel title="Declară o relație" icon={Plus}>
      <form className="stack tight" onSubmit={save}>
        <div className="row wrap">
          <input className="input" value={rel.subject} onChange={(e) => setRel((x) => ({ ...x, subject: e.target.value }))} placeholder="componentă (ex. checkout)" aria-label="Subiect" />
          <input className="input" value={rel.predicate} onChange={(e) => setRel((x) => ({ ...x, predicate: e.target.value }))} aria-label="Relație" />
          <input className="input" value={rel.object} onChange={(e) => setRel((x) => ({ ...x, object: e.target.value }))} placeholder="componentă (ex. plăți)" aria-label="Obiect" />
        </div>
        <input className="input" value={rel.note} onChange={(e) => setRel((x) => ({ ...x, note: e.target.value }))} placeholder="notă (opțional)" aria-label="Notă" />
        <button className="btn sm" disabled={!rel.subject.trim() || !rel.object.trim() || !rel.predicate.trim() || Boolean(r.busy)}><Plus size={12} />Declară</button>
        <ErrorNotice error={r.error} />
      </form>
      <p className="faint small">Apare în graf ca DECLARAT de tine, cu sursa ei. Contrazicerile între relații sunt semnalate, nu rezolvate automat.</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- Ședința (Board meeting)
export function Board() {
  const cur = useIntel("/api/board/current", ["board."]);
  const r = useRun();
  const m = cur.data?.meeting;
  const open = () => r.run("open", () => post("/api/board", {}, { toast: "Ședința a început (agenda din date; niciun model)" }).then(cur.reload));
  if (cur.loading) return <Loading lines={4} />;
  if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} />;
  if (!m || m.status !== "OPEN") {
    const last = cur.data?.meetings?.find((x) => x.status === "CLOSED");
    return (
      <div className="stack">
        <Panel title="Ședința săptămânală" icon={Users}>
          <p>Agenda se calculează din datele Hub-ului (livrări acceptate și pachete neacceptate separat, misiuni oprite, incidente, vânzări, operațiuni, riscuri, decizii). Nicio rezumare cu model nu e activă.</p>
          <button className="btn primary" disabled={Boolean(r.busy)} onClick={open}><Users size={14} />Deschide ședința</button>
          <ErrorNotice error={r.error} />
        </Panel>
        {last && <Panel title={`Ultima: ${last.title}`} icon={History}><p className="faint small">Închisă {fmt.dateTime(last.closedAt)} · {last.minutes?.length || 0} puncte în minută.</p></Panel>}
      </div>
    );
  }
  const it = m.current;
  const decide = (decision) => r.run(decision, () => post(`/api/board/items/${it.id}/decide`, { decision }, { toast: decision === "defer" ? "Amânat pentru ședința următoare" : "Înregistrat (nimic nu s-a activat)" }).then(cur.reload));
  return (
    <div className="intel-grid">
      <Panel title={m.title} icon={Users} className="span-2" actions={<Chip tone="info">{m.remaining} rămase</Chip>}>
        {it ? (
          <div className="board-item">
            <div className="faint small">{it.sectionLabel} · {it.position + 1}/{m.items.length}{it.carriedFrom ? " · reportat" : ""}</div>
            <h3 className="h3">{it.title}</h3>
            {it.body?.items?.length > 0 && <ul className="plain small">{it.body.items.slice(0, 8).map((x, j) => <li key={j}>{x.mission || x.title || x.missionId || x.bundleId || x.incidentId}{x.status ? ` · ${x.status}` : ""}{x.stage ? ` · ${x.stage}` : ""}</li>)}</ul>}
            {it.body?.note && <p className="faint small">{it.body.note}</p>}
            {it.body?.source && <SourceNote>Sursa: {it.body.source}</SourceNote>}
            <div className="row wrap">
              <Chip tone={BOARD_ITEM_TONE[it.status] || "neutral"}>{BOARD_ITEM_RO[it.status] || it.status}</Chip>
              {it.kind !== "info" && <>
                <button className="btn sm primary" disabled={Boolean(r.busy)} onClick={() => decide("decide")}><Check size={13} />Decid</button>
                <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => decide("defer")}><Clock size={13} />Amână</button>
                <button className="btn sm ghost" disabled={Boolean(r.busy)} onClick={() => decide("reject")}><X size={13} />Resping</button>
              </>}
            </div>
          </div>
        ) : <Empty title="Agenda e goală" />}
        <div className="row between">
          <button className="btn sm ghost" disabled={Boolean(r.busy) || m.cursor === 0} onClick={() => r.run("prev", () => post(`/api/board/${m.id}/move`, { delta: -1 }).then(cur.reload))}><ChevronLeft size={13} />Anterior</button>
          <button className="btn sm ghost" disabled={Boolean(r.busy) || m.cursor >= m.items.length - 1} onClick={() => r.run("next", () => post(`/api/board/${m.id}/move`, { delta: 1 }).then(cur.reload))}>Următorul<ChevronRight size={13} /></button>
        </div>
        <ErrorNotice error={r.error} />
        <p className="faint small">„Decid” și „Resping” cer sesiunea ta (Windows Hello); o decizie se înregistrează, nu activează nimic. „Amână” mută punctul la ședința următoare.</p>
      </Panel>
      <Panel title="Agenda" icon={Users}>
        <ol className="board-agenda">{m.items.map((x) => <li key={x.id} className={x.id === it?.id ? "is-current" : ""}><span className="faint small">{x.sectionLabel}</span> {x.title} <Chip tone={BOARD_ITEM_TONE[x.status] || "neutral"}>{BOARD_ITEM_RO[x.status] || x.status}</Chip></li>)}</ol>
        <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => r.run("close", () => post(`/api/board/${m.id}/close`, {}, { toast: "Ședința s-a închis; minuta e salvată" }).then(cur.reload))}>Închide ședința</button>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Simulare
const SIM_FIELDS = [
  ["currentProjects", "Proiecte în lucru acum", "ex. 3"], ["newProjects", "Proiecte noi (clienți noi)", "ex. 5"], ["effortHoursPerProject", "Efort pe proiect (ore)", "ex. 40 sau 30-60"],
  ["capacityHoursPerWeek", "Capacitate pe săptămână (ore)", "ex. 50"], ["horizonWeeks", "Orizont (săptămâni)", "ex. 8"], ["delayFactor", "Factor de întârziere (opțional)", "ex. 1-1.3"],
  ["pricePerProject", "Preț pe proiect (lei, opțional)", "ex. 8000"], ["costPerHour", "Cost pe oră (lei, opțional)", "ex. 120"],
];
const VERDICT_RO = { "ÎN_CAPACITATE": "în capacitate", "LA_LIMITĂ": "la limită", "PESTE_CAPACITATE": "peste capacitate" };

function SimResult({ sim }) {
  const res = sim.result;
  if (res.status === "INSUFFICIENT_DATA") return <Notice tone="warn" title="Date insuficiente — nu inventez cifre">Lipsesc: {res.missing.map((m) => m.label).join(", ")}{res.invalid?.length ? `; invalide: ${res.invalid.map((m) => m.label).join(", ")}` : ""}.</Notice>;
  const cols = res.result.single ? [["Scenariu", res.result.single, res.verdict.single]] : [["Optimist", res.result.optimistic, res.verdict.optimistic], ["Pesimist", res.result.pessimistic, res.verdict.pessimistic]];
  return (
    <div className="stack tight">
      <div className="sim-cols">{cols.map(([label, r, v]) => (
        <dl key={label} className="kv small sim-col"><dt className="h3">{label}</dt><dd><Chip tone={v === "PESTE_CAPACITATE" ? "error" : v === "LA_LIMITĂ" ? "warn" : "ok"}>{VERDICT_RO[v] || v}</Chip></dd>
          <dt>Proiecte</dt><dd>{r.projects}</dd><dt>Ore totale</dt><dd>{fmtHours(r.totalHours)}</dd><dt>Săptămâni necesare</dt><dd>{fmtWeeks(r.weeksNeeded)}</dd>
          <dt>Utilizare</dt><dd>{r.utilizationPct}%</dd><dt>Terminate în orizont</dt><dd>{r.finishedInHorizon} (rămân {r.backlogAtHorizon})</dd>
          {r.revenueIfAllDelivered !== undefined && <><dt>Venit dacă toate se livrează și se plătesc</dt><dd>{fmtMoney(r.revenueIfAllDelivered)}</dd></>}
          {r.laborCost !== undefined && <><dt>Cost muncă</dt><dd>{fmtMoney(r.laborCost)}</dd></>}
        </dl>
      ))}</div>
      <details className="small"><summary>Formula și presupunerile</summary><ul>{res.formula.map((f) => <li key={f}>{f}</li>)}</ul>{res.assumptions && <ul>{res.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}</details>
      <SourceNote>Model {res.modelVersion} · determinist · nu citește și nu schimbă date reale.</SourceNote>
    </div>
  );
}

export function Simulation({ itemId }) {
  const list = useIntel("/api/simulations", ["simulation."]);
  const one = useResource(itemId ? `/api/simulations/${itemId}` : null);
  const settings = useResource("/api/settings");
  const [vals, setVals] = useState({});
  const [title, setTitle] = useState("");
  const [save, setSave] = useState(false);
  const [last, setLast] = useState(null);
  const r = useRun();
  useEffect(() => { const d = settings.data?.settings?.simulationDefaults; if (d && !Object.keys(vals).length) setVals(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "object" ? `${v.min}-${v.max}` : String(v)]))); }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = Object.fromEntries(SIM_FIELDS.map(([k]) => [k, parseSimInput(vals[k])]).filter(([, v]) => v !== undefined));
  const invalid = Object.entries(parsed).filter(([, v]) => v === null).map(([k]) => SIM_FIELDS.find((f) => f[0] === k)[1]);
  const runSim = (e) => { e.preventDefault(); r.run("run", async () => { const out = await post("/api/simulations", { title: title || "Scenariu", inputs: parsed, saveAsDefaults: save }, { reauth: false }); setLast(out); list.reload(); }); };
  const shown = last || one.data;
  return (
    <div className="intel-grid">
      <Panel title="Ce se întâmplă dacă…" icon={FlaskConical} actions={<SimBadge />}>
        <form className="stack tight" onSubmit={runSim}>
          <label className="field"><span>Titlu</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. încă cinci clienți în 2 luni" /></label>
          <div className="sim-form">{SIM_FIELDS.map(([k, label, ph]) => (
            <label key={k} className="field"><span>{label}</span><input className="input" inputMode="decimal" value={vals[k] || ""} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} placeholder={ph} /></label>
          ))}</div>
          {invalid.length > 0 && <Notice tone="warn">Valori invalide: {invalid.join(", ")} (un număr sau un interval „min-max”).</Notice>}
          <label className="row small"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Păstrează-le ca estimările mele (Lega le folosește la „ce se întâmplă dacă…”)</label>
          <div className="row"><button className="btn primary" disabled={Boolean(r.busy) || invalid.length > 0}><FlaskConical size={14} />Calculează</button></div>
          <ErrorNotice error={r.error} />
        </form>
        {list.data?.observed && <p className="faint small">Din Hub: {list.data.observed.deliveredMissions.realProjects} misiuni livrate pe proiecte reale; {list.data.observed.note}</p>}
      </Panel>
      <Panel title={shown ? shown.title : "Rezultat"} icon={FlaskConical} actions={shown ? <SimBadge /> : null}>
        {shown ? <>
          <SimResult sim={shown} />
          {shown.result.status === "COMPUTED" && !shown.proposalRef && <button className="btn sm" disabled={Boolean(r.busy)} onClick={() => r.run("prop", async () => { await post(`/api/simulations/${shown.id}/propose`, {}, { toast: "Ciornă de decizie creată (nu schimbă nimic)" }); list.reload(); })}><Plus size={13} />Fă din el o propunere</button>}
          {shown.proposalRef && <p className="faint small">Propunere: {shown.proposalRef}</p>}
        </> : <Empty title="Niciun scenariu încă">Completează intrările sau spune-i Lega „Ce se întâmplă dacă luăm încă cinci clienți?”.</Empty>}
      </Panel>
      <Panel title="Scenarii anterioare" icon={History} className="span-2">
        {list.data?.simulations?.length ? <ul className="plain small">{list.data.simulations.slice(0, 12).map((s) => <li key={s.id}><a href={`#${intelHref("simulation", s.id)}`}>{s.title}</a> <SimBadge /> <Chip tone={s.status === "COMPUTED" ? "info" : "warn"}>{s.status === "COMPUTED" ? "calculat" : "date insuficiente"}</Chip> <span className="faint">{fmt.dateTime(s.createdAt)}</span></li>)}</ul> : <p className="faint small">Niciunul.</p>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Liga agenților
export function League() {
  const [includeTest, setIncludeTest] = useState(false);
  const rep = useIntel(`/api/league${includeTest ? "?includeTest=1" : ""}`, ["run.completed", "run.failed", "factory."]);
  const d = rep.data;
  return (
    <div className="stack">
      <label className="row small"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include proiectele de test (marcate)</label>
      <ErrorNotice error={rep.error} />
      {rep.loading ? <Loading lines={4} /> : d && (
        <>
          <Notice tone="info" title="Cum se citește">{d.note}</Notice>
          <Panel title="Pe rol · provider · model · mediu · tip de lucru" icon={Trophy}>
            {d.groups.length ? (
              <div className="table-wrap"><table className="table small"><thead><tr><th>Rol</th><th>Provider / model</th><th>Mediu</th><th>Tip</th><th>Dovezi</th><th>Criterii îndeplinite</th><th>Prima trecere verificată</th><th>Reparații (mediană)</th><th>Intervențiile tale</th></tr></thead>
                <tbody>{d.groups.map((g) => { const ev = evidenceLabel(g, d.minEvidence); return (
                  <tr key={g.key}><td>{g.role}</td><td>{g.provider} · {g.model}</td><td>{g.environment}</td><td>{g.workType}</td><td><Chip tone={ev.tone}>{ev.text}</Chip>{g.testProjects ? <span className="faint"> ({g.testProjects} test)</span> : null}</td>
                    <td>{g.evidence === "SUFFICIENT" && g.metrics.criteriaMetPct !== null ? `${g.metrics.criteriaMetPct}%` : "—"}</td><td>{g.evidence === "SUFFICIENT" && g.metrics.firstPassVerifiedPct !== null ? `${g.metrics.firstPassVerifiedPct}%` : "—"}</td><td>{g.metrics.medianRepairs ?? "—"}</td><td>{g.metrics.ownerInterventions ?? "—"}</td></tr>
                ); })}</tbody></table></div>
            ) : <Empty title="Nicio observație eligibilă">Execuțiile simulate, anulate, cu erori de infrastructură și (implicit) cele pe proiecte de test sunt excluse.</Empty>}
            <p className="faint small">Excluse: {Object.entries(d.exclusions).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"} · total observații {d.totals.observations}, eligibile {d.totals.eligible}.</p>
          </Panel>
          {d.proposals.length > 0 && <Panel title="Propuneri de testat (nimic aplicat)" icon={Trophy}><ul className="plain small">{d.proposals.map((p) => <li key={p.cohort}>{p.proposal}</li>)}</ul></Panel>}
          {d.skills.length > 0 && <Panel title="Pe versiune de skill" icon={Trophy}><ul className="plain small">{d.skills.map((s) => <li key={`${s.skill}@${s.version}`}>{s.skill} v{s.version}: {s.completed}/{s.runs} terminate <Chip tone={s.evidence === "SUFFICIENT" ? "info" : "neutral"}>{s.evidence === "SUFFICIENT" ? "dovezi suficiente" : "date insuficiente"}</Chip></li>)}</ul></Panel>}
        </>
      )}
    </div>
  );
}
