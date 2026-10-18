import { useMemo, useState } from "react";
import { BarChart3, FileSpreadsheet, FlaskConical, Lightbulb } from "lucide-react";
import { Panel, ErrorNotice, Loading, Notice, Chip, Empty } from "../../components/ui.jsx";
import { csvHeaders, suggestMapping } from "../../lib/studioLogic.js";
import { useStudio, studioPost, useBusy } from "./common.jsx";
import { fmt } from "../../api.js";

const EXPERIMENT_TONE = { REGISTERED: "info", RUNNING: "info", CLOSED: "ok", INCONCLUSIVE: "neutral", CANCELLED: "neutral" };
const INSIGHT = { HYPOTHESIS: ["neutral", "ipoteză"], OBSERVED_ASSOCIATION: ["info", "asociere observată (nu cauză)"], EXPERIMENT_SUPPORTED: ["ok", "susținută de experiment"], INCONCLUSIVE: ["neutral", "neconcludentă"], RETIRED: ["neutral", "retrasă"] };
const fmtValue = (m) => (m.value === null || m.value === undefined ? `lipsă${m.unavailableReason ? ` (${m.unavailableReason})` : ""}` : `${Number(m.value).toLocaleString("ro-RO")} ${m.unit === "count" ? "" : m.unit}`.trim());

/** Latest value per metric, per platform and attempt; missing stays missing; test data labelled; no cross-platform totals. */
export function AnalyticsSummary({ contentProjectId }) {
  const data = useStudio(`/api/content/analytics/${encodeURIComponent(contentProjectId)}`, ["content.metrics", "content.release"]);
  if (data.loading && !data.data) return <Loading lines={3} />;
  if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
  const s = data.data?.summary || {};
  const items = s.items || [];
  return (
    <div className="stack tight">
      {s.note && <p className="faint small">{s.note}</p>}
      {!items.length ? <Empty title="Nicio metrică">Importă exportul platformei (CSV) după ce ai postat; valorile lipsă nu devin zero.</Empty> : items.map((g) => (
        <div key={`${g.platform}-${g.attemptId || "proiect"}`} className="stack tight studio-metrics">
          <div className="row wrap"><strong>{g.platform}</strong>{g.attemptId && <span className="faint small">încercarea {fmt.short(g.attemptId)}</span>}</div>
          <div className="table-wrap">
            <table className="table table-mobile-cards">
              <thead><tr><th>Metrică</th><th>Valoare</th><th>Observat</th><th>Definiție</th></tr></thead>
              <tbody>
                {[...Object.entries(g.metrics || {}).map(([k, m]) => [k, m, false]), ...Object.entries(g.fixtureMetrics || {}).map(([k, m]) => [k, m, true])].map(([k, m, fixture]) => (
                  <tr key={`${k}-${fixture}`}>
                    <td data-label="Metrică">{m.definition?.label || k}{fixture && <> <Chip tone="warn">date de test</Chip></>}</td>
                    <td data-label="Valoare">{fmtValue(m)}{m.uncertainty?.stale ? <div className="sub">mai veche de 48 h</div> : null}</td>
                    <td data-label="Observat">{fmt.dateTime(m.observedAt)}{m.window ? <div className="sub">fereastră {m.window}</div> : null}</td>
                    <td data-label="Definiție" className="small">{m.definition?.definition || "nedefinită"} · {m.uncertainty?.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Manual CSV import with an explicit column mapping (the server refuses unknown metrics and never mixes platforms). */
export function CsvImport({ contentProjectId }) {
  const registry = useStudio("/api/content/metrics/registry", []);
  const platforms = registry.data?.registry?.platforms || {};
  const [platform, setPlatform] = useState("");
  const [csvText, setCsv] = useState("");
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const b = useBusy();
  const { headers, delimiter } = useMemo(() => csvHeaders(csvText), [csvText]);
  const metrics = platforms[platform] || {};
  const load = (text, plat = platform) => { setCsv(text); const h = csvHeaders(text).headers; setMapping(suggestMapping(h, platforms[plat] || {})); setResult(null); };
  const submit = (e) => {
    e.preventDefault();
    b.run("import", async () => {
      const out = await studioPost("/api/content/metrics/import", { platform, csvText, mapping, contentProjectId }, { toast: "Metrici importate" });
      setResult(out);
    });
  };
  return (
    <form className="stack tight" onSubmit={submit} aria-label="Import metrici CSV">
      <div className="studio-form">
        <label className="field"><span>Platformă</span>
          <select className="select" required value={platform} onChange={(e) => { setPlatform(e.target.value); setMapping(suggestMapping(headers, platforms[e.target.value] || {})); }}>
            <option value="">— alege —</option>{Object.keys(platforms).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field"><span>Fișier CSV (exportul platformei)</span>
          <input className="input" type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); e.target.value = ""; }} />
        </label>
      </div>
      <label className="field"><span>Sau lipește conținutul</span><textarea className="textarea mono" rows={4} value={csvText} onChange={(e) => load(e.target.value)} /></label>
      {headers.length > 0 && (
        <fieldset className="studio-fieldset"><legend>Maparea coloanelor (separator „{delimiter === "\t" ? "tab" : delimiter}”)</legend>
          <div className="studio-form">
            {headers.map((h) => (
              <label key={h} className="field"><span>{h}</span>
                <select className="select" value={mapping[h] || "@ignore"} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Metrica pentru coloana ${h}`}>
                  <option value="@ignore">ignoră</option><option value="@date">dată</option>
                  {Object.entries(metrics).map(([k, d]) => <option key={k} value={k}>{d.label} ({k})</option>)}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="row wrap"><button className="btn primary" type="submit" disabled={Boolean(b.busy) || !platform || !csvText.trim() || !Object.values(mapping).some((v) => !v.startsWith("@"))}>
        <FileSpreadsheet size={15} aria-hidden="true" />{b.busy ? "Se importă…" : "Importă metricile"}</button></div>
      <ErrorNotice error={b.error} />
      {result && <Notice tone="info">{result.duplicate ? "Același fișier a fost deja importat; nimic nou." : `Importat: ${result.values ?? 0} valori, ${result.unavailable ?? 0} lipsă (rămân lipsă), ${result.rows ?? 0} rânduri.`}{(result.warnings || []).length ? ` Avertismente: ${result.warnings.join("; ")}` : ""}</Notice>}
    </form>
  );
}

function ExperimentsAndInsights() {
  const ex = useStudio("/api/content/experiments", ["content.experiment"]);
  const ins = useStudio("/api/content/insights", ["content.insight"]);
  return (
    <div className="grid two studio-grid">
      <Panel title="Experimente" icon={FlaskConical} id="studio-experiments">
        {ex.error ? <ErrorNotice error={ex.error} /> : !(ex.data?.experiments || []).length ? <Empty title="Niciun experiment">Un experiment se înregistrează înainte de rezultate și nu se mai schimbă.</Empty> : (
          <ul className="intel-list">{ex.data.experiments.map((e) => (
            <li key={e.id} className="stack tight"><div className="row wrap between"><strong>{e.title}</strong><Chip tone={EXPERIMENT_TONE[e.status] || "neutral"}>{e.status}</Chip></div>
              <span className="faint small">variabilă: {e.variable} · metrică: {e.primaryMetric} · {e.design === "observational" ? "observațional (doar asociere)" : "randomizat nativ"}</span>
              {e.result?.decision && <span className="small">Rezultat: {e.result.decision}{e.result.label ? ` (${e.result.label})` : ""}{e.result.interpretation ? ` — ${e.result.interpretation}` : ""}</span>}</li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="Concluzii" icon={Lightbulb} id="studio-insights">
        {ins.error ? <ErrorNotice error={ins.error} /> : !(ins.data?.insights || []).length ? <Empty title="Nicio concluzie">Concluziile cer eșantion, definiție și bază; până atunci rămân ipoteze.</Empty> : (
          <ul className="intel-list">{ins.data.insights.map((i) => { const [tone, label] = INSIGHT[i.status] || ["neutral", i.status]; return (
            <li key={i.id} className="stack tight"><div className="row wrap between"><span className="small">{i.hypothesis}</span><Chip tone={tone}>{label}</Chip></div>
              {i.sample?.n !== undefined && <span className="faint small">eșantion: {i.sample.n}{i.units ? ` ${i.units}` : ""}</span>}</li>
          ); })}</ul>
        )}
      </Panel>
    </div>
  );
}

/** Analytics: per-project summary + CSV import, experiments and insights with their statuses. */
export function Analytics() {
  const projects = useStudio("/api/content/projects?limit=200", ["content.project"]);
  const [projectId, setProjectId] = useState("");
  const list = projects.data?.projects || [];
  return (
    <div className="stack">
      <Panel title="Rezultate pe proiect" icon={BarChart3} id="studio-analytics" actions={
        <label className="field inline"><span>Proiect</span><select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">— alege —</option>{list.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}>
        {projects.error && <ErrorNotice error={projects.error} />}
        {!projectId ? <p className="faint small">Alege un proiect de conținut pentru metricile lui.</p> : (
          <div className="stack">
            <AnalyticsSummary contentProjectId={projectId} />
            <details className="studio-details"><summary>Importă metrici (CSV)</summary><CsvImport contentProjectId={projectId} /></details>
          </div>
        )}
      </Panel>
      <ExperimentsAndInsights />
    </div>
  );
}
