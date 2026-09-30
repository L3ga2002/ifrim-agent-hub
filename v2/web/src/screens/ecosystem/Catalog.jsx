import { useMemo, useState } from "react";
import { LayoutGrid, ExternalLink, Search } from "lucide-react";
import { useResource, usePref } from "../../store.js";
import { Panel, Loading, ErrorNotice, Empty, Chip } from "../../components/ui.jsx";
import { classifyCapability } from "../../lib/uiLogic.js";

const NEVER = () => false;
const BUCKETS = [["usable", "Pot folosi acum"], ["setup", "Necesită setup"], ["assisted", "Doar nativ / asistat"], ["blocked", "Risc de cost / blocat"], ["all", "Toate"]];
const KIND = (r) => (r.category === "models" ? "model" : ["plans", "identity"].includes(r.category) ? "plan / cont" : ["computer", "browser"].includes(r.category) ? "mediu"
  : /codex_cli|claude_code_interactive|codex_desktop|claude_chat|chatgpt_chat/.test(r.executionSurface || "") ? "client" : "suprafață / funcție");
const Fact = ({ value, title }) => {
  const tone = value === true || value === "da" ? "ok" : value === "nu" || value === false ? "neutral" : value === "asistat" ? "info" : "warn";
  const text = value === true ? "da" : value === false ? "nu" : value;
  return <span className={`fact ${tone}`} title={title}>{text}</span>;
};

/** Filterable OpenAI/Anthropic catalog: what can be used now, what needs setup, what is native-only, what carries cost risk. */
export function CatalogTab() {
  const caps = useResource("/api/capabilities", { reloadOn: NEVER });
  const surfaces = useResource("/api/surfaces", { reloadOn: NEVER });
  const verifs = useResource("/api/capabilities/verifications", { reloadOn: NEVER });
  const [bucket, setBucket] = usePref("catalog.bucket", "usable");
  const [provider, setProvider] = usePref("catalog.provider", "all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const surfaceById = new Map((surfaces.data?.surfaces || []).map((s) => [s.id, s]));
    const verByCap = new Map();
    for (const v of verifs.data?.verifications || []) { if (!verByCap.has(v.capabilityId)) verByCap.set(v.capabilityId, []); verByCap.get(v.capabilityId).push(v); }
    return (caps.data?.capabilities || []).filter((r) => r.provider !== "standard").map((r) => ({ r, ...classifyCapability(r, { surface: surfaceById.get(r.executionSurface) || null, verifications: verByCap.get(r.id) || [] }) }));
  }, [caps.data, surfaces.data, verifs.data]);
  const counts = useMemo(() => Object.fromEntries(BUCKETS.map(([id]) => [id, rows.filter((x) => (id === "all" || x.bucket === id) && (provider === "all" || x.r.provider === provider)).length])), [rows, provider]);
  const shown = rows.filter((x) => (bucket === "all" || x.bucket === bucket) && (provider === "all" || x.r.provider === provider)
    && (!q.trim() || `${x.r.feature} ${x.r.id}`.toLowerCase().includes(q.trim().toLowerCase())));
  if (caps.loading) return <Loading lines={6} />;
  return (
    <Panel title={`Catalog OpenAI + Anthropic (${rows.length})`} icon={LayoutGrid} flush>
      <div className="panel-body stack">
        <div className="row wrap">
          <div className="seg" role="group" aria-label="Provider">{[["all", "Ambele"], ["openai", "OpenAI"], ["anthropic", "Anthropic"]].map(([id, l]) => <button key={id} aria-pressed={provider === id} onClick={() => setProvider(id)}>{l}</button>)}</div>
          <label className="sr-only" htmlFor="cat-q">Caută</label>
          <div className="row grow"><Search size={14} aria-hidden="true" /><input id="cat-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută o funcție…" /></div>
        </div>
        <div className="seg wrap" role="group" aria-label="Categorie">{BUCKETS.map(([id, l]) => <button key={id} aria-pressed={bucket === id} onClick={() => setBucket(id)}>{l} <span className="faint">{counts[id]}</span></button>)}</div>
        <p className="faint small" style={{ margin: 0 }}>Coloanele sunt fapte separate: documentat public ≠ eligibil pe plan ≠ autentificat local ≠ implementat în Hub ≠ verificat live ≠ verificat simulat. Nicio funcție nu este activată de aici; blocările de facturare rămân.</p>
        <ErrorNotice error={caps.error || surfaces.error} onRetry={caps.reload} />
      </div>
      {shown.length ? (
        <div className="table-wrap"><table className="table table-mobile-cards catalog">
          <thead><tr><th>Funcție</th><th>Tip</th><th>Eligibil</th><th>Autentificat</th><th>Implementat</th><th>Live</th><th>Simulat</th><th>Cost</th><th>Sursă</th></tr></thead>
          <tbody>{shown.slice(0, 300).map(({ r, facts, cost }) => (
            <tr key={r.id}>
              <td><div className="title">{r.feature}</div><div className="sub mono faint">{r.provider} · {r.id} · {r.status}</div></td>
              <td data-label="Tip">{KIND(r)}</td>
              <td data-label="Eligibil"><Fact value={facts.eligible} title={r.planRequired} /></td>
              <td data-label="Autentificat"><Fact value={facts.authenticated} title={r.executionSurface} /></td>
              <td data-label="Implementat"><Fact value={facts.implemented} title={r.hubDecision} /></td>
              <td data-label="Live"><Fact value={facts.verifiedLive} /></td>
              <td data-label="Simulat"><Fact value={facts.verifiedSimulated} /></td>
              <td data-label="Cost"><Chip tone={cost === "inclus" ? "ok" : cost === "risc de cost" ? "error" : "warn"}>{cost}</Chip></td>
              <td data-label="Sursă">{r.officialSource ? <a href={r.officialSource} target="_blank" rel="noreferrer noopener" className="link-btn"><ExternalLink size={12} />sursă</a> : "—"}<div className="faint small">{r.verification?.verdict || ""}</div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="panel-body"><Empty title="Nimic în această categorie">Schimbă filtrul sau caută altceva.</Empty></div>}
    </Panel>
  );
}
