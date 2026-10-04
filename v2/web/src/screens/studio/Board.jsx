import { useState } from "react";
import { Plus, CalendarClock, User, Lightbulb, ArrowRight } from "lucide-react";
import { Panel, ErrorNotice, Loading, Empty, Chip, Notice } from "../../components/ui.jsx";
import { boardColumns, measurableProgress, studioHref, STAGE_LABELS } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy } from "./common.jsx";

const PLATFORMS = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["x", "X"], ["linkedin", "LinkedIn"]];
const READINESS = { READY: ["ok", "pregătit"], NO_GO: ["error", "NO_GO"], NEEDS_CAPTURE: ["warn", "necesită captură"], UNKNOWN: ["neutral", "neevaluat"] };
const fmtDate = (iso) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" }); };

/** One Kanban card: only facts from the API (no invented progress). */
function Card({ card, go }) {
  const progress = measurableProgress(card.progress);
  const [rt, rl] = READINESS[card.readiness] || READINESS.UNKNOWN;
  const deadline = fmtDate(card.deadline);
  return (
    <li className="studio-card">
      {card.previewAssetVersionId && (
        <video className="studio-thumb" src={`/api/media/files/${encodeURIComponent(card.previewAssetVersionId)}#t=0.5`} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} />
      )}
      <a className="studio-card-title" href={`#${studioHref(card.id)}`} onClick={(e) => { e.preventDefault(); go(studioHref(card.id)); }}>{card.title}</a>
      <div className="row wrap studio-card-meta">
        {card.format && <Chip>{card.format}</Chip>}
        {(card.platforms || []).map((p) => <Chip key={p} tone="info">{p}</Chip>)}
        <Chip tone={rt}>{rl}</Chip>
      </div>
      <dl className="kv compact">
        <dt>Etapă</dt><dd>{card.stageLabel || STAGE_LABELS[card.stage] || card.stage}</dd>
        <dt><User size={12} aria-hidden="true" /> Responsabil</dt><dd>{card.responsible || <span className="faint">neatribuit</span>}</dd>
        {deadline && <><dt><CalendarClock size={12} aria-hidden="true" /> Termen</dt><dd className={card.overdue ? "studio-overdue" : undefined}>{deadline}{card.overdue ? " · depășit" : ""}</dd></>}
        {card.models?.length ? <><dt>Model / rută</dt><dd>{card.models.join("; ")}</dd></> : null}
        {card.claims?.total ? <><dt>Afirmații</dt><dd>{card.claims.supported}/{card.claims.total} susținute{card.claims.blocked ? ` · ${card.claims.blocked} blocate` : ""}</dd></> : null}
        {card.releases?.total ? <><dt>Publicări</dt><dd>{card.releases.published}/{card.releases.total}</dd></> : null}
      </dl>
      {progress?.kind === "percent" && <div className="meter" aria-label={`Progres măsurat ${progress.text}`}><span className="bar"><i style={{ width: `${progress.value}%` }} /></span>{progress.text}</div>}
      {progress?.kind === "checklist" && <p className="faint small studio-facts">{progress.text}{progress.next ? ` · următorul: ${progress.next}` : ""}</p>}
    </li>
  );
}

function NewProject({ onDone }) {
  const [form, setForm] = useState({ title: "", format: "short", platforms: [], responsible: "", deadline: "" });
  const b = useBusy();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (p) => set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);
  const submit = (e) => {
    e.preventDefault();
    b.run("create", async () => {
      const fields = { title: form.title.trim(), format: form.format.trim(), platforms: form.platforms, responsible: form.responsible.trim() };
      if (form.deadline) fields.deadline = new Date(form.deadline).toISOString();
      const project = await studioPost("/api/content/projects", { fields }, { toast: "Proiect de conținut creat" });
      setForm({ title: "", format: "short", platforms: [], responsible: "", deadline: "" });
      onDone?.(project);
    });
  };
  return (
    <form className="studio-form" onSubmit={submit} aria-label="Proiect de conținut nou">
      <label className="field"><span>Titlu</span><input className="input" required minLength={3} maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
      <label className="field"><span>Format</span><input className="input" maxLength={60} value={form.format} onChange={(e) => set("format", e.target.value)} placeholder="short, demo, studiu de caz…" /></label>
      <fieldset className="studio-fieldset"><legend>Platforme</legend>
        <div className="row wrap">{PLATFORMS.map(([id, label]) => (
          <label key={id} className="radio-chip"><input type="checkbox" checked={form.platforms.includes(id)} onChange={() => toggle(id)} />{label}</label>
        ))}</div>
      </fieldset>
      <label className="field"><span>Responsabil</span><input className="input" maxLength={80} value={form.responsible} onChange={(e) => set("responsible", e.target.value)} /></label>
      <label className="field"><span>Termen (opțional)</span><input className="input" type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} /></label>
      <div className="row wrap"><button className="btn primary" type="submit" disabled={b.busy || form.title.trim().length < 3}><Plus size={15} aria-hidden="true" />{b.busy ? "Se creează…" : "Creează proiectul"}</button></div>
      <ErrorNotice error={b.error} />
    </form>
  );
}

function Ideas({ go }) {
  const ideas = useStudio("/api/content/ideas?limit=50", ["content.idea", "content.project"]);
  const b = useBusy();
  const open = (ideas.data?.ideas || []).filter((i) => i.status === "NEW" || i.status === "SHORTLISTED");
  return (
    <Panel title="Idei deschise" icon={Lightbulb} id="studio-ideas">
      {ideas.loading && !ideas.data ? <Loading lines={2} /> : ideas.error ? <ErrorNotice error={ideas.error} onRetry={ideas.reload} />
        : !open.length ? <Empty title="Nicio idee deschisă">Ideile din livrări acceptate apar aici automat, cu dovezile lor.</Empty>
          : (
            <ul className="intel-list">
              {open.map((i) => (
                <li key={i.id} className="stack tight">
                  <div className="row wrap between"><strong>{i.title}</strong><Chip tone={i.publicEligible ? "ok" : "neutral"}>{i.publicEligible ? "poate deveni public" : "intern"}</Chip></div>
                  {i.reason && <span className="faint small">{i.reason}</span>}
                  <div className="row wrap">
                    <button className="btn sm" type="button" disabled={Boolean(b.busy)} onClick={() => b.run(i.id, async () => {
                      const out = await studioPost(`/api/content/ideas/${encodeURIComponent(i.id)}/promote`, {}, { toast: "Idee transformată în proiect" });
                      if (out?.project?.id) go(studioHref(out.project.id));
                    })}><ArrowRight size={14} aria-hidden="true" />Fă proiect</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      <ErrorNotice error={b.error} />
    </Panel>
  );
}

/** Panou: the Kanban over real states (GET /api/content/board). */
export function Board({ go }) {
  const board = useStudio("/api/content/board");
  const [creating, setCreating] = useState(false);
  if (board.loading && !board.data) return <Loading lines={5} />;
  if (board.error) return <ErrorNotice error={board.error} onRetry={board.reload} />;
  const view = boardColumns(board.data);
  return (
    <div className="stack">
      <div className="row wrap between">
        <p className="faint small studio-note">{board.data?.note || "Progresul este o listă de fapte verificate, nu un procent estimat."}{view.archived ? ` · ${view.archived} arhivate` : ""}</p>
        <button className="btn sm" type="button" aria-expanded={creating} onClick={() => setCreating((c) => !c)}><Plus size={14} aria-hidden="true" />Proiect nou</button>
      </div>
      {creating && <Panel title="Proiect de conținut nou" id="studio-new"><NewProject onDone={(p) => { setCreating(false); if (p?.id) go(studioHref(p.id)); }} /></Panel>}
      {!view.total && <Notice tone="info" title="Panoul e gol">Creează un proiect sau transformă o idee într-un proiect. Nimic nu se generează singur.</Notice>}
      <div className="studio-board" role="list" aria-label="Etapele proiectelor de conținut">
        {view.columns.map((col) => (
          <section key={col.stage} className="studio-col" role="listitem" aria-labelledby={`col-${col.stage}`}>
            <h2 id={`col-${col.stage}`} className="studio-col-head"><span>{col.label}</span><span className="badge" aria-label={`${col.count} proiecte`}>{col.count}</span></h2>
            {col.cards.length ? <ul className="studio-cards">{col.cards.map((c) => <Card key={c.id} card={c} go={go} />)}</ul> : <p className="faint small studio-empty-col">—</p>}
          </section>
        ))}
      </div>
      <Ideas go={go} />
    </div>
  );
}
