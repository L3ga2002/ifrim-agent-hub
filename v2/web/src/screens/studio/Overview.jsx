import { Gauge, HardDrive, MonitorSmartphone, Ratio } from "lucide-react";
import { Panel, ErrorNotice, Loading, Notice, Chip, Empty } from "../../components/ui.jsx";
import { STAGE_LABELS, BOARD_STAGES, OPERATION_STATUS, OPERATION_LABEL, ATTEMPT_STATUS } from "../../lib/studioLogic.js";
import { useStudio, Limitations } from "./common.jsx";
import { fmt } from "../../api.js";
import { ProjectImport } from "./ProjectImport.jsx";

const Tile = ({ n, label, tone }) => <div className={`stat-tile${tone ? ` ${tone}` : ""}`}><dt>{label}</dt><dd>{n}</dd></div>;

/** Command Center: real counts from the database; „not enough data” instead of invented conclusions. */
export function CommandCenter({ status, go }) {
  const cc = useStudio("/api/content/command-center");
  if (cc.loading && !cc.data) return <Loading lines={5} />;
  if (cc.error) return <ErrorNotice error={cc.error} onRetry={cc.reload} />;
  const d = cc.data || {};
  const projects = d.projects || {};
  const releases = Object.entries(d.releases || {});
  return (
    <div className="stack">
      {/* M10: import a whole Studio project (bundle or an older delivery), not just an MP4. */}
      <ProjectImport go={go} />
      <Panel title="Producție" icon={Gauge} id="studio-cc">
        <dl className="stat-tiles">
          <Tile n={d.ideas?.open ?? 0} label="idei deschise" />
          <Tile n={d.renders?.active ?? 0} label="randări active" tone={d.renders?.active ? "live" : null} />
          <Tile n={d.renders?.failed ?? 0} label="randări eșuate" tone={d.renders?.failed ? "alert" : null} />
          <Tile n={d.reviews?.open ?? 0} label="corecturi deschise" tone={d.reviews?.open ? "attention" : null} />
          <Tile n={d.manifests?.draft ?? 0} label="manifeste ciornă" />
          <Tile n={d.manifests?.approved ?? 0} label="manifeste aprobate" tone={d.manifests?.approved ? "good" : null} />
          <Tile n={d.measuredPublications ?? 0} label="publicări măsurate" />
        </dl>
      </Panel>
      <Panel title="Proiecte pe etape" id="studio-cc-stages">
        <dl className="stat-tiles">{[...BOARD_STAGES, "ARCHIVED"].map((s) => <Tile key={s} n={projects[s] || 0} label={STAGE_LABELS[s]} />)}</dl>
      </Panel>
      <Panel title="Distribuție" id="studio-cc-releases">
        {!releases.length ? <p className="faint small">Nicio încercare de distribuție încă.</p>
          : <div className="row wrap">{releases.map(([k, n]) => { const [tone, label] = ATTEMPT_STATUS[k] || ["neutral", k]; return <Chip key={k} tone={tone}>{label}: {n}</Chip>; })}</div>}
      </Panel>
      <Panel title="Concluzii" id="studio-cc-insights">
        {d.insights?.status === "INSUFFICIENT_DATA"
          ? <Notice tone="info" title="Date insuficiente">Nu avem încă suficiente publicații măsurate ({d.measuredPublications ?? 0}). {d.insights.text}</Notice>
          : <p className="small">Concluzii susținute de experimente: <strong>{d.insights?.supported ?? 0}</strong> · asocieri observate (nu cauze): <strong>{d.insights?.observed ?? 0}</strong></p>}
      </Panel>
      <Limitations items={d.limitations} />
      {status && (
        <Panel title="Stocare și politică" icon={HardDrive} id="studio-cc-storage">
          <dl className="kv compact">
            <dt>Spațiu folosit</dt><dd>{fmt.bytes(status.quota?.usedBytes)}{status.quota?.freeBytes !== undefined ? ` · ${fmt.bytes(status.quota.freeBytes)} liberi pe disc` : ""}</dd>
            <dt>Sincronizat în cloud</dt><dd>{status.storage?.synced ? "da — mută biblioteca într-un folder local" : "nu"}</dd>
            <dt>Randări în paralel</dt><dd>{status.policy?.renderConcurrency ?? 1}{status.policy?.interactivePriority ? " · cedează lucrului interactiv" : ""}</dd>
            <dt>Publicare automată</dt><dd>{status.policy?.autoPublish ? "pornită" : "oprită"}</dd>
            <dt>Încărcare pe platforme</dt><dd>{status.policy?.liveUpload ? "pornită" : "oprită"}</dd>
            <dt>Captură live</dt><dd>{status.policy?.liveCapture ? "pornită" : "oprită"}</dd>
          </dl>
        </Panel>
      )}
    </div>
  );
}

/** A safe-area sketch: the profile's canvas with the areas covered by the platform's interface (an estimate, labelled as such). */
function SafeArea({ profile }) {
  const { width = 1080, height = 1920 } = profile.canvas || {};
  const s = profile.safeArea || {};
  const ratio = width / height;
  const box = ratio >= 1 ? { w: 112, h: Math.round(112 / ratio) } : { h: 112, w: Math.round(112 * ratio) };
  const p = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
  return (
    <div className="studio-safe" style={{ width: box.w, height: box.h }} role="img"
      aria-label={`Zona sigură ${width}×${height}: sus ${p(s.top)}, jos ${p(s.bottom)}, stânga ${p(s.left)}, dreapta ${p(s.right)}`}>
      <span className="studio-safe-inner" style={{ top: p(s.top), bottom: p(s.bottom), left: p(s.left), right: p(s.right) }} />
    </div>
  );
}

/** Platforme: the documented status per operation (nothing VERIFIED_LIVE) and the variant profiles with their safe areas. */
export function Platforms() {
  const reg = useStudio("/api/content/platforms", []);
  const prof = useStudio("/api/media/profiles", []);
  if ((reg.loading && !reg.data) || (prof.loading && !prof.data)) return <Loading lines={5} />;
  const registry = reg.data?.platforms || {};
  const profiles = prof.data?.profiles || {};
  return (
    <div className="stack">
      <ErrorNotice error={reg.error || prof.error} />
      <Notice tone="info" title="Sursă">{registry.source || "estimare internă — verifică regulile actuale"} · verificat live: {registry.verifiedAt ? fmt.dateTime(registry.verifiedAt) : "niciodată"}</Notice>
      <Panel title="Platforme și operații" icon={MonitorSmartphone} id="studio-platforms">
        {!Object.keys(registry.platforms || {}).length ? <Empty title="Registrul platformelor lipsește" /> : (
          <div className="table-wrap">
            <table className="table table-mobile-cards">
              <thead><tr><th>Platformă</th><th>Operație</th><th>Stare</th><th>Sursă</th><th>Note</th></tr></thead>
              <tbody>
                {Object.values(registry.platforms).flatMap((p) => Object.entries(p.operations || {}).map(([op, o]) => {
                  const [tone, label] = OPERATION_STATUS[o.status] || ["neutral", o.status];
                  return (
                    <tr key={`${p.id}-${op}`}>
                      <td data-label="Platformă">{p.label}</td>
                      <td data-label="Operație">{OPERATION_LABEL[op] || op}</td>
                      <td data-label="Stare"><Chip tone={tone}>{label}</Chip></td>
                      <td data-label="Sursă">{o.docRef || "—"}</td>
                      <td data-label="Note" className="small">{o.notes}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Profiluri de variantă" icon={Ratio} id="studio-profiles">
        <ul className="studio-profiles">
          {Object.values(profiles).map((p) => (
            <li key={p.key} className="studio-profile">
              <SafeArea profile={p} />
              <div className="stack tight">
                <strong>{p.label || p.key}</strong>
                <span className="small">{p.canvas?.width}×{p.canvas?.height} · {p.fpsPreferred} fps · durată maximă {p.maxDurationS ? `${p.maxDurationS} s` : "necunoscută"}</span>
                <span className="faint small">{p.source} · {p.verifiedAt ? `verificat ${fmt.dateTime(p.verifiedAt)}` : "NOT_TESTED · neverificat pe platformă"}</span>
                {(p.notes || []).map((n, i) => <span key={i} className="faint small">{n}</span>)}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
