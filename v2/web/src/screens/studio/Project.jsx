import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardCheck, FileText, Clapperboard, ListVideo, History, MessageSquareText, Activity as ActivityIcon, Plus } from "lucide-react";
import { Panel, ErrorNotice, Loading, Empty, Chip, Notice } from "../../components/ui.jsx";
import { PROJECT_TABS, STAGE_LABELS, STAGE_TRANSITIONS, studioHref, pickPlayable, normFps, measurableProgress, fmtSeconds, shortHash } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy, Limitations, Hash } from "./common.jsx";
import { Player, Correction } from "./Player.jsx";
import { TimelineInspector, ExplainEdit } from "./Timeline.jsx";
import { RendersPanel, QaPanel, Decisions } from "./Renders.jsx";
import { Variants } from "./Variants.jsx";
import { Distribution } from "./Distribution.jsx";
import { Library, AssetRights } from "./Library.jsx";
import { AnalyticsSummary, CsvImport } from "./Analytics.jsx";
import { fmt } from "../../api.js";

const READINESS = { READY: ["ok", "pregătit (READY)"], NO_GO: ["error", "NO_GO"], NEEDS_CAPTURE: ["warn", "necesită captură"], UNKNOWN: ["neutral", "neevaluat"] };
const CLAIM = { SUPPORTED: ["ok", "susținută"], UNCERTAIN: ["warn", "incertă"], BLOCKED: ["error", "blocată"] };
const CHANGE_KIND = { initial: "inițială", patch: "corectură", variant: "variantă", manual_divergence: "modificare manuală" };

/** Proiect tab without a project: pick one (newest first). */
export function ProjectPicker({ go }) {
  const projects = useStudio("/api/content/projects?limit=200", ["content.project"]);
  if (projects.loading && !projects.data) return <Loading lines={4} />;
  if (projects.error) return <ErrorNotice error={projects.error} onRetry={projects.reload} />;
  const list = projects.data?.projects || [];
  if (!list.length) return <Empty title="Niciun proiect de conținut" action={<button className="btn sm" type="button" onClick={() => go(studioHref("board"))}>Mergi la Panou</button>}>Creează unul din Panou.</Empty>;
  return (
    <Panel title="Alege un proiect" icon={Clapperboard} id="studio-pick" flush>
      <ul className="list">{list.map((p) => (
        <li key={p.id}><a className="list-row" href={`#${studioHref(p.id)}`}><span className="grow"><span className="title">{p.title}</span><br /><span className="sub">{p.stageLabel || STAGE_LABELS[p.stage]} · {p.format || "—"} · {(p.platforms || []).join(", ") || "fără platforme"}</span></span></a></li>
      ))}</ul>
    </Panel>
  );
}

// The detail stays mounted while the sub-tab changes: a sub-tab chosen with the keyboard keeps the focus.
function ProjectTabs({ projectId, value, go }) {
  const refs = useRef({});
  const onKeyDown = (e, index) => {
    const n = PROJECT_TABS.length;
    const next = e.key === "ArrowRight" ? (index + 1) % n : e.key === "ArrowLeft" ? (index - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    go(studioHref(projectId, { sub: PROJECT_TABS[next][0] }));
    refs.current[PROJECT_TABS[next][0]]?.focus();
  };
  return (
    <div className="tabs studio-subtabs" role="tablist" aria-label="Secțiunile proiectului">
      {PROJECT_TABS.map(([id, label], i) => (
        <button key={id} type="button" role="tab" id={`studio-sub-${id}`} aria-controls="studio-sub-panel" aria-selected={value === id} tabIndex={value === id ? 0 : -1}
          ref={(el) => { refs.current[id] = el; }} onClick={() => go(studioHref(projectId, { sub: id }))} onKeyDown={(e) => onKeyDown(e, i)}>{label}</button>
      ))}
    </div>
  );
}

function StageBar({ project }) {
  const b = useBusy();
  const next = STAGE_TRANSITIONS[project.stage] || [];
  return (
    <div className="stack tight">
      <div className="row wrap">
        {next.map((s) => (
          <button key={s} className={`btn sm${s === "ARCHIVED" ? " ghost" : ""}`} type="button" disabled={Boolean(b.busy)}
            onClick={() => b.run(s, () => studioPost(`/api/content/projects/${encodeURIComponent(project.id)}/stage`, { stage: s, expectedVersion: project.version }, { toast: `Mutat în ${STAGE_LABELS[s]}` }))}>
            {s === "ARCHIVED" ? "Arhivează" : `→ ${STAGE_LABELS[s]}`}</button>
        ))}
        <button className="btn sm ghost" type="button" disabled={Boolean(b.busy) || project.stage === "ARCHIVED"} onClick={() => b.run("ready", () => studioPost(`/api/content/projects/${encodeURIComponent(project.id)}/readiness`, {}, { toast: "Pregătirea a fost evaluată" }))}>
          <ClipboardCheck size={14} aria-hidden="true" />Evaluează pregătirea</button>
      </div>
      <ErrorNotice error={b.error} />
    </div>
  );
}

// ---------- editorial tabs ----------

function BriefForm({ projectId, brief, platforms }) {
  const body = brief?.body || {};
  const [form, setForm] = useState({ objective: body.objective || "", technical: body.angles?.technical || "", business: body.angles?.business || "", keyMessage: body.keyMessage || "", cta: body.cta || "", durationTargetS: body.durationTargetS || "" });
  const b = useBusy();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e) => {
    e.preventDefault();
    b.run("brief", () => studioPost(`/api/content/projects/${encodeURIComponent(projectId)}/brief`, { body: { objective: form.objective.trim(), angles: { technical: form.technical.trim(), business: form.business.trim() },
      keyMessage: form.keyMessage.trim(), cta: form.cta.trim(), platforms, ...(form.durationTargetS ? { durationTargetS: Number(form.durationTargetS) } : {}) } }, { toast: "Brief salvat (versiune nouă)" }));
  };
  return (
    <form className="studio-form" onSubmit={submit} aria-label="Brief">
      <label className="field span-all"><span>Obiectiv</span><textarea className="textarea" rows={2} required minLength={10} maxLength={1000} value={form.objective} onChange={(e) => set("objective", e.target.value)} /></label>
      <label className="field"><span>Unghi tehnic</span><textarea className="textarea" rows={2} maxLength={1500} value={form.technical} onChange={(e) => set("technical", e.target.value)} /></label>
      <label className="field"><span>Unghi de business</span><textarea className="textarea" rows={2} maxLength={1500} value={form.business} onChange={(e) => set("business", e.target.value)} /></label>
      <label className="field"><span>Mesaj cheie</span><input className="input" maxLength={300} value={form.keyMessage} onChange={(e) => set("keyMessage", e.target.value)} /></label>
      <label className="field"><span>Îndemn (CTA)</span><input className="input" maxLength={200} value={form.cta} onChange={(e) => set("cta", e.target.value)} /></label>
      <label className="field"><span>Durată țintă (s)</span><input className="input" type="number" min={3} max={3600} value={form.durationTargetS} onChange={(e) => set("durationTargetS", e.target.value)} /></label>
      <div className="row wrap span-all"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || form.objective.trim().length < 10}>{b.busy ? "Se salvează…" : brief ? "Salvează versiune nouă" : "Salvează brief-ul"}</button></div>
      <ErrorNotice error={b.error} />
    </form>
  );
}

function ConceptTab({ detail }) {
  const p = detail.project;
  const progress = measurableProgress(detail.card?.progress);
  const brief = detail.brief;
  return (
    <div className="grid two studio-grid">
      <Panel title="Proiect" icon={Clapperboard} id="studio-concept">
        <dl className="kv">
          <dt>Format</dt><dd>{p.format || "—"}</dd>
          <dt>Platforme</dt><dd>{(p.platforms || []).join(", ") || "—"}</dd>
          <dt>Public</dt><dd>{{ technical: "tehnic", business: "business", both: "tehnic + business" }[p.audience] || p.audience}</dd>
          <dt>Responsabil</dt><dd>{p.responsible || "neatribuit"}</dd>
          <dt>Termen</dt><dd>{p.deadline ? fmt.dateTime(p.deadline) : "—"}</dd>
          <dt>Preset vizual</dt><dd>{p.presetId ? `${p.presetId} v${p.presetVersion || 1}` : "—"}</dd>
        </dl>
        {progress?.kind === "checklist" && (
          <ul className="studio-checklist" aria-label={progress.text}>{progress.steps.map((s) => <li key={s.key} className={s.done ? "is-done" : undefined}><span aria-hidden="true">{s.done ? "✓" : "○"}</span> {s.label}<span className="sr-only">{s.done ? " — făcut" : " — de făcut"}</span></li>)}</ul>
        )}
        {(detail.tasks || []).length > 0 && (
          <><h3 className="block-title small">Sarcini planificate (nimic nu pornește de aici)</h3>
            <ul className="intel-list">{detail.tasks.map((t) => <li key={t.id} className="row wrap"><strong>{t.title}</strong><Chip>{t.role}</Chip><span className="faint small">{t.binding.provider} · {t.binding.model} · {t.binding.effort}</span><Chip tone="neutral">{t.status}</Chip></li>)}</ul></>
        )}
      </Panel>
      <Panel title={brief ? `Brief v${brief.version}` : "Brief"} icon={FileText} id="studio-brief">
        {detail.idea && <p className="small faint">Din ideea „{detail.idea.title}”{detail.idea.reason ? ` — ${detail.idea.reason}` : ""}</p>}
        {brief && <p className="faint small">sha <Hash value={brief.sha256} /> · {brief.authorKind} · {fmt.dateTime(brief.createdAt)}</p>}
        <BriefForm key={brief?.id || "new"} projectId={p.id} brief={brief} platforms={p.platforms || []} />
      </Panel>
    </div>
  );
}

function EvidenceTab({ detail }) {
  const p = detail.project;
  const r = p.readinessDetail || {};
  const [text, setText] = useState("");
  const b = useBusy();
  const [rt, rl] = READINESS[p.readiness] || READINESS.UNKNOWN;
  return (
    <div className="grid two studio-grid">
      <Panel title="Afirmații și dovezi" icon={ClipboardCheck} id="studio-claims">
        {!(detail.claims || []).length ? <Empty title="Nicio afirmație">Fiecare afirmație din scenariu se leagă de o dovadă (run, test, bundle, commit…).</Empty> : (
          <ul className="intel-list">{detail.claims.map((c) => { const [tone, label] = CLAIM[c.status] || ["neutral", c.status]; return (
            <li key={c.id} className="stack tight"><div className="row wrap between"><span>{c.text}</span><Chip tone={tone}>{label}</Chip></div>
              {(c.evidence || []).length > 0 ? <span className="faint small">dovezi: {c.evidence.map((e) => `${e.kind}:${shortHash(e.ref, 18)}`).join(", ")}</span> : <span className="faint small">fără dovezi</span>}</li>
          ); })}</ul>
        )}
        <form className="studio-form inline" onSubmit={(e) => { e.preventDefault(); b.run("claim", async () => { await studioPost(`/api/content/projects/${encodeURIComponent(p.id)}/claims`, { claim: { text: text.trim() } }, { toast: "Afirmație adăugată (incertă până la dovezi)" }); setText(""); }); }}>
          <label className="field grow"><span>Afirmație nouă</span><input className="input" minLength={5} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button className="btn" type="submit" disabled={Boolean(b.busy) || text.trim().length < 5}><Plus size={14} aria-hidden="true" />Adaugă</button>
        </form>
        <ErrorNotice error={b.error} />
      </Panel>
      <Panel title="Pregătire" id="studio-readiness">
        <div className="row wrap"><Chip tone={rt}>{rl}</Chip>{r.evaluatedAt && <span className="faint small">{fmt.dateTime(r.evaluatedAt)}</span>}</div>
        {(r.reasons || []).length > 0 && <ul className="small">{r.reasons.map((x, i) => <li key={i}>{x.message || x.code}</li>)}</ul>}
        {(r.captureTasks || []).length > 0 && <><h3 className="block-title small">De înregistrat</h3><ul className="small">{r.captureTasks.map((t, i) => <li key={i}>{t.title}{t.description ? ` — ${t.description}` : ""}</li>)}</ul></>}
        {(r.warnings || []).length > 0 && <ul className="faint small">{r.warnings.map((w, i) => <li key={i}>{typeof w === "string" ? w : w.message}</li>)}</ul>}
        {!p.readinessDetail?.status && <p className="faint small">Neevaluat încă: folosește „Evaluează pregătirea”.</p>}
      </Panel>
    </div>
  );
}

function ScriptTab({ detail }) {
  const [lang, setLang] = useState("ro");
  const current = (detail.scripts || []).find((s) => s.language === lang);
  const [text, setText] = useState("");
  const b = useBusy();
  useEffect(() => { setText((current?.body?.segments || []).map((s) => `${s.vo}${s.onScreen ? ` | ${s.onScreen}` : ""}`).join("\n")); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (e) => {
    e.preventDefault();
    const segments = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => { const [vo, onScreen = ""] = l.split("|").map((x) => x.trim()); return { id: `s${i + 1}`, vo, onScreen, captions: vo }; });
    b.run("script", () => studioPost(`/api/content/projects/${encodeURIComponent(detail.project.id)}/script`, { language: lang, segments }, { toast: "Scenariu salvat (versiune nouă)" }));
  };
  return (
    <Panel title="Scenariu" icon={FileText} id="studio-script" actions={
      <div className="seg" role="group" aria-label="Limba scenariului">{["ro", "en"].map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</div>}>
      {current ? (
        <div className="table-wrap">
          <p className="faint small">v{current.version} · sha <Hash value={current.sha256} /> · {current.authorKind} · {fmt.dateTime(current.createdAt)}</p>
          <table className="table table-mobile-cards">
            <thead><tr><th>#</th><th>Voce</th><th>Text pe ecran</th><th>Subtitrare</th></tr></thead>
            <tbody>{current.body.segments.map((s) => <tr key={s.id}><td data-label="#">{s.id}</td><td data-label="Voce">{s.vo || "—"}</td><td data-label="Text pe ecran">{s.onScreen || "—"}</td><td data-label="Subtitrare">{s.captions || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="faint small">Niciun scenariu în {lang === "ro" ? "română" : "engleză"} încă.</p>}
      <form className="stack tight" onSubmit={save} aria-label="Editează scenariul">
        <label className="field"><span>Un segment pe rând: voce | text pe ecran</span><textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !text.trim()}>{b.busy ? "Se salvează…" : "Salvează versiune nouă"}</button></div>
        <ErrorNotice error={b.error} />
      </form>
    </Panel>
  );
}

function StoryboardTab({ detail }) {
  const sb = detail.storyboard;
  const [text, setText] = useState("");
  const b = useBusy();
  const save = (e) => {
    e.preventDefault();
    const shots = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const [purpose, seconds = "3", acceptance = ""] = l.split("|").map((x) => x.trim());
      return { id: `sh${i + 1}`, purpose, source: { kind: "text_only", description: "" }, durationMs: Math.round(Number(String(seconds).replace(",", ".")) * 1000) || 3000, acceptance: acceptance || `Se înțelege: ${purpose}` };
    });
    b.run("sb", () => studioPost(`/api/content/projects/${encodeURIComponent(detail.project.id)}/storyboard`, { shots }, { toast: "Storyboard salvat (versiune nouă)" }));
  };
  return (
    <Panel title={sb ? `Storyboard v${sb.version}` : "Storyboard"} icon={ListVideo} id="studio-storyboard">
      {sb ? (
        <div className="table-wrap">
          <table className="table table-mobile-cards">
            <thead><tr><th>Cadru</th><th>Scop</th><th>Sursă</th><th>Durată</th><th>Mișcare / text</th><th>Acceptare</th></tr></thead>
            <tbody>{sb.body.shots.map((s) => (
              <tr key={s.id}><td data-label="Cadru">{s.id}</td><td data-label="Scop">{s.purpose}</td><td data-label="Sursă">{s.source?.kind}{s.source?.description ? ` — ${s.source.description}` : ""}</td>
                <td data-label="Durată">{fmtSeconds(s.durationMs, 1)}</td><td data-label="Mișcare / text">{[s.framing, s.motion, ...(s.overlays || [])].filter(Boolean).join(" · ") || "—"}</td><td data-label="Acceptare">{s.acceptance}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="faint small">Niciun storyboard încă.</p>}
      <details className="studio-details"><summary>Storyboard nou (versiune nouă)</summary>
        <form className="stack tight" onSubmit={save}>
          <label className="field"><span>Un cadru pe rând: scop | durată (s) | criteriu de acceptare</span><textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !text.trim()}>{b.busy ? "Se salvează…" : "Salvează"}</button></div>
          <ErrorNotice error={b.error} />
        </form>
      </details>
    </Panel>
  );
}

// ---------- edit plans ----------

const CANVASES = { "9x16": { width: 1080, height: 1920, label: "9:16 (1080×1920)" }, "16x9": { width: 1920, height: 1080, label: "16:9 (1920×1080)" }, "1x1": { width: 1080, height: 1080, label: "1:1 (1080×1080)" } };

/** A first edit plan from chosen library videos, in order (each full length at 30 fps); everything else is refined by corrections. */
function NewEdit({ projectId, assets }) {
  const videos = (assets || []).filter((a) => a.kind === "video" && a.current?.status === "READY" && a.current?.durationMs);
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState("Montaj");
  const [canvas, setCanvas] = useState("9x16");
  const b = useBusy();
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = (e) => {
    e.preventDefault();
    let start = 0;
    const clips = picked.map((id, i) => {
      const a = videos.find((v) => v.id === id);
      const frames = Math.max(1, Math.floor((a.current.durationMs / 1000) * 30) - 1);
      const clip = { id: `c${i + 1}`, assetVersionId: a.current.id, sourceIn: 0, sourceOut: frames, start, fit: "cover" };
      if (a.captureLabel && !["NOT_APPLICABLE", "ORIGINAL_RECORDING"].includes(a.captureLabel)) clip.label = a.captureLabel;
      start += frames;
      return clip;
    });
    const labels = [...new Set(clips.map((c) => c.label).filter(Boolean))];
    const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: CANVASES[canvas].width, height: CANVASES[canvas].height, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
      tracks: [{ id: "v1", kind: "video", clips }], markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: title.trim(), labels, author: "owner", notes: "" } };
    b.run("edit", () => studioPost("/api/media/edits", { contentProjectId: projectId, title: title.trim(), ir }, { toast: "Plan de montaj creat (versiunea 1)" }));
  };
  if (!videos.length) return <Empty title="Niciun video gata în materialele proiectului">Importă sau încarcă materiale în tabul Materiale, apoi revino.</Empty>;
  return (
    <form className="stack tight" onSubmit={submit} aria-label="Plan de montaj nou">
      <div className="studio-form">
        <label className="field"><span>Titlu</span><input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Format</span><select className="select" value={canvas} onChange={(e) => setCanvas(e.target.value)}>{Object.entries(CANVASES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></label>
      </div>
      <fieldset className="studio-fieldset"><legend>Clipuri, în ordinea alegerii</legend>
        <ul className="studio-pick-list">{videos.map((a) => (
          <li key={a.id}><label className="check"><input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} /> {picked.includes(a.id) ? `${picked.indexOf(a.id) + 1}. ` : ""}{a.title || a.id} <span className="faint small">({fmtSeconds(a.current.durationMs, 1)}{a.captureLabel && a.captureLabel !== "NOT_APPLICABLE" ? ` · ${a.captureLabel}` : ""})</span></label></li>
        ))}</ul>
      </fieldset>
      <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !picked.length || !title.trim()}>{b.busy ? "Se validează…" : "Creează planul de montaj"}</button></div>
      <ErrorNotice error={b.error} />
      {b.error?.details?.errors && <ul className="faint small">{b.error.details.errors.slice(0, 8).map((x, i) => <li key={i}>{x.path}: {x.message}</li>)}</ul>}
    </form>
  );
}

/** Edit project + version selectors (main line and variants are versions of the same edit project). */
function EditPicker({ edits, editId, setEditId, versions, versionId, setVersionId }) {
  return (
    <div className="studio-form inline studio-pickers">
      <label className="field"><span>Plan de montaj</span>
        <select className="select" value={editId || ""} onChange={(e) => setEditId(e.target.value)}>{edits.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
      <label className="field"><span>Versiune</span>
        <select className="select" value={versionId || ""} onChange={(e) => setVersionId(e.target.value)}>
          {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} · {CHANGE_KIND[v.changeKind] || v.changeKind}{v.variantKey ? ` (${v.variantKey})` : ""}</option>)}
        </select></label>
    </div>
  );
}

function VersionsTab({ versions, versionId, setVersionId }) {
  if (!versions.length) return <Empty title="Nicio versiune" />;
  return (
    <Panel title="Versiuni (nicio versiune nu se modifică pe loc)" icon={History} id="studio-versions" flush>
      <div className="table-wrap">
        <table className="table table-mobile-cards">
          <thead><tr><th>Versiune</th><th>Tip</th><th>Ce s-a schimbat</th><th>IR</th><th>Creată</th><th><span className="sr-only">Acțiuni</span></th></tr></thead>
          <tbody>{[...versions].reverse().map((v) => (
            <tr key={v.id} className={v.id === versionId ? "row-selected" : undefined}>
              <td data-label="Versiune">v{v.version}{v.variantKey ? <div className="sub">{v.variantKey}</div> : null}</td>
              <td data-label="Tip">{CHANGE_KIND[v.changeKind] || v.changeKind}</td>
              <td data-label="Ce s-a schimbat" className="small">{(v.change?.diff?.summary || []).slice(0, 4).join(" ") || v.change?.reason || (v.change?.changes ? `${Array.isArray(v.change.changes) ? v.change.changes.length : v.change.changes} modificări de platformă` : "—")}</td>
              <td data-label="IR"><Hash value={v.irSha256} n={10} /></td>
              <td data-label="Creată">{fmt.dateTime(v.createdAt)}</td>
              <td data-label="Acțiuni"><button className="btn sm" type="button" aria-pressed={v.id === versionId} onClick={() => setVersionId(v.id)}>{v.id === versionId ? "Selectată" : "Selectează"}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function ProposalsList({ reviews, onSeek }) {
  const proposals = (reviews || []).filter((r) => r.status !== "RECORDED");
  if (!proposals.length) return <p className="faint small">Nicio corectură propusă pentru această versiune.</p>;
  const tone = { OPEN: "approval", APPLIED: "ok", DISMISSED: "neutral" };
  return (
    <ul className="intel-list">{proposals.map((r) => (
      <li key={r.id} className="row wrap">
        <Chip tone={tone[r.status] || "neutral"}>{r.status === "OPEN" ? "deschisă" : r.status === "APPLIED" ? "aplicată" : r.status === "DISMISSED" ? "renunțată" : r.status}</Chip>
        {Number.isFinite(r.timecodeMs) && <button type="button" className="link-btn mono small" onClick={() => onSeek?.(r.timecodeMs)}>{fmtSeconds(r.timecodeMs)}</button>}
        <span className="small">{r.text}</span><span className="faint small">{r.provenance}</span>
      </li>
    ))}</ul>
  );
}

function ActivityTab({ ids }) {
  const content = useStudio("/api/events/query?type=content.&limit=300", ["content."]);
  const media = useStudio("/api/events/query?type=media.&limit=300", ["media."]);
  const events = useMemo(() => [...(content.data?.events || []), ...(media.data?.events || [])]
    .filter((e) => ids.has(e.scopeId) || ids.has(e.payload?.contentProjectId) || ids.has(e.payload?.editVersionId) || ids.has(e.payload?.manifestId) || ids.has(e.payload?.masterVersionId))
    .sort((a, b) => b.seq - a.seq).slice(0, 200), [content.data, media.data, ids]);
  if ((content.loading && !content.data) || (media.loading && !media.data)) return <Loading lines={4} />;
  return (
    <Panel title="Activitate" icon={ActivityIcon} id="studio-activity">
      <ErrorNotice error={content.error || media.error} />
      {!events.length ? <Empty title="Nicio activitate înregistrată" /> : (
        <ol className="studio-activity">{events.map((e) => (
          <li key={e.seq}><span className="faint small mono">{fmt.dateTime(e.createdAt)}</span> <code className="mono small">{e.type}</code> <span className="faint small">{String(e.source || "").slice(0, 40)}</span></li>
        ))}</ol>
      )}
    </Panel>
  );
}

/**
 * The project detail: header, limitations, sub-tabs. Selection of the edit plan / version and the player time live here.
 * D7: `reviewId` (the cockpit's `?review=` deep link) opens the correction panel on that proposal; when a plan is bound to it, the panel
 * shows that plan's card (its ONE confirmation applies, renders and runs QA).
 */
export function ProjectDetail({ projectId, sub, tMs, versionId: routeVersionId, reviewId = null, go, status }) {
  const detail = useStudio(`/api/content/projects/${encodeURIComponent(projectId)}`);
  const profiles = useStudio("/api/media/profiles", []);
  const edits = detail.data?.edits || [];
  const [editId, setEditId] = useState(null);
  const [versionId, setVersionId] = useState(routeVersionId || null);
  const [playId, setPlayId] = useState(null);
  const [currentMs, setCurrentMs] = useState(tMs || 0);
  const player = useRef(null);
  useEffect(() => { if (!editId && edits.length) setEditId(edits[0].id); }, [edits, editId]);
  const edit = useStudio(editId ? `/api/media/edits/${encodeURIComponent(editId)}` : null, ["media.edit.", "media.review.", "media.variant."]);
  const versions = edit.data?.edit?.versions || [];
  useEffect(() => {
    if (!versions.length) return;
    if (!versionId || !versions.some((v) => v.id === versionId)) setVersionId(edit.data?.edit?.current?.id || versions[versions.length - 1].id);
  }, [versions, versionId, edit.data]);
  // D7: "ops.plan." keeps each review's bound plan (review.plan) current while its card is confirmed, runs or is superseded.
  const version = useStudio(versionId ? `/api/media/edit-versions/${encodeURIComponent(versionId)}` : null, ["media.render.", "media.review.", "media.qa.", "ops.plan."]);
  const v = version.data?.version || null;
  const fps = normFps(v?.ir?.fps);
  const playable = pickPlayable(version.data?.renders);
  useEffect(() => { setPlayId(null); }, [versionId]);
  const playAsset = playId || playable?.outputAssetVersionId || null;
  const seek = useCallback((ms) => { player.current?.seek(ms); setCurrentMs(ms); }, []);
  // A new ?t= in the address (same project, no remount) seeks the player too.
  useEffect(() => { if (tMs !== null && tMs !== undefined) seek(tMs); }, [tMs, seek]);
  const ids = useMemo(() => new Set([projectId, ...edits.map((e) => e.id), ...versions.map((x) => x.id), ...(detail.data?.manifests || []).map((m) => m.id), ...(version.data?.renders || []).map((r) => r.id)]), [projectId, edits, versions, detail.data, version.data]);
  if (detail.loading && !detail.data) return <Loading lines={6} />;
  if (detail.error) return <div className="stack"><ErrorNotice error={detail.error} onRetry={detail.reload} /><button className="btn sm" type="button" onClick={() => go(studioHref("board"))}><ArrowLeft size={14} aria-hidden="true" />Înapoi la Panou</button></div>;
  const d = detail.data;
  const p = d.project;
  const [rt, rl] = READINESS[p.readiness] || READINESS.UNKNOWN;
  const needEdit = ["timeline", "versions", "variants", "review"].includes(sub);
  const workspace = (
    <>
      <EditPicker edits={edits} editId={editId} setEditId={(id) => { setEditId(id); setVersionId(null); }} versions={versions} versionId={versionId} setVersionId={setVersionId} />
      {version.error && <ErrorNotice error={version.error} onRetry={version.reload} />}
      <Player ref={player} key={playAsset || "none"} assetVersionId={playAsset} fps={fps} initialMs={tMs} onTime={setCurrentMs} label={p.title} />
    </>
  );
  return (
    <div className="stack studio-project">
      <div className="studio-project-head">
        <button className="btn sm ghost" type="button" onClick={() => go(studioHref("board"))}><ArrowLeft size={14} aria-hidden="true" />Panou</button>
        <h2 className="studio-project-title">{p.title}</h2>
        <div className="row wrap"><Chip tone="info">{p.stageLabel || STAGE_LABELS[p.stage]}</Chip><Chip tone={rt}>{rl}</Chip><span className="faint small">v{p.version} · actualizat {fmt.ago(p.updatedAt)}</span></div>
      </div>
      <Limitations items={d.limitations} />
      <StageBar project={p} />
      <ProjectTabs projectId={projectId} value={sub} go={go} />
      <div id="studio-sub-panel" role="tabpanel" aria-labelledby={`studio-sub-${sub}`} className="stack">
        {sub === "concept" && <ConceptTab detail={d} />}
        {sub === "evidence" && <EvidenceTab detail={d} />}
        {sub === "script" && <ScriptTab detail={d} />}
        {sub === "storyboard" && <StoryboardTab detail={d} />}
        {sub === "assets" && <Library status={status} contentProjectId={projectId} />}
        {needEdit && !edits.length && <Panel title="Plan de montaj nou" icon={Clapperboard} id="studio-new-edit"><NewEdit projectId={projectId} assets={d.assets} /></Panel>}
        {needEdit && edits.length > 0 && edit.loading && !edit.data && <Loading lines={3} />}
        {needEdit && edit.error && <ErrorNotice error={edit.error} onRetry={edit.reload} />}
        {sub === "timeline" && edits.length > 0 && v && (
          <>
            {workspace}
            <Panel title="Corectură la timecode" icon={MessageSquareText} id="studio-correction">
              <Correction editVersionId={v.id} fps={fps} currentMs={currentMs} projectId={projectId} ir={v.ir} onApplied={(id) => setVersionId(id)}
                reviews={version.data?.reviews || []} deepReviewId={reviewId} />
            </Panel>
            <Panel title={`Timeline · v${v.version}`} icon={ListVideo} id="studio-timeline"><TimelineInspector ir={v.ir} currentMs={currentMs} onSeek={seek} /></Panel>
            <Panel title="Ce face montajul" id="studio-explain"><ExplainEdit explain={version.data?.explain} onSeek={seek} /></Panel>
          </>
        )}
        {sub === "versions" && edits.length > 0 && <VersionsTab versions={versions} versionId={versionId} setVersionId={setVersionId} />}
        {sub === "variants" && edits.length > 0 && v && <Variants editProjectId={editId} masterVersion={v} profiles={profiles.data?.profiles || {}} />}
        {sub === "review" && edits.length > 0 && v && (
          <>
            {workspace}
            <RendersPanel editVersionId={v.id} renders={version.data?.renders || []} onPlay={setPlayId} playingId={playAsset} />
            <QaPanel editVersionId={v.id} onSeek={seek} />
            <Panel title="Corecturi propuse" icon={MessageSquareText} id="studio-proposals"><ProposalsList reviews={version.data?.reviews} onSeek={seek} /></Panel>
            <Panel title="Decizia creativă" id="studio-decision"><Decisions editVersionId={v.id} reviews={version.data?.reviews || []} /></Panel>
          </>
        )}
        {sub === "rights" && (
          !(d.assets || []).length ? <Empty title="Niciun material în proiect">Drepturile se înregistrează pe fiecare material.</Empty> : (
            <ul className="stack">{d.assets.map((a) => (
              <li key={a.id}><details className="studio-details panel"><summary><strong>{a.title || a.id}</strong> <span className="faint small">{a.kind} · {a.origin}</span></summary><div className="panel-body"><AssetRights assetId={a.id} /></div></details></li>
            ))}</ul>
          )
        )}
        {sub === "distribution" && <Distribution projectId={projectId} editProjectId={editId} manifests={d.manifests || []} profiles={profiles.data?.profiles || {}} limitations={d.limitations} />}
        {sub === "analytics" && (
          <Panel title="Analytics" id="studio-project-analytics">
            <AnalyticsSummary contentProjectId={projectId} />
            <details className="studio-details"><summary>Importă metrici (CSV)</summary><CsvImport contentProjectId={projectId} /></details>
          </Panel>
        )}
        {sub === "activity" && <ActivityTab ids={ids} />}
        {needEdit && edits.length > 0 && !v && !version.loading && !edit.loading && <Notice tone="info">Alege o versiune a planului de montaj.</Notice>}
      </div>
    </div>
  );
}
