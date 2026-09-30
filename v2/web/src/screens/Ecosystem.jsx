import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Orbit, Sparkles, Scale, Table2, Layers, Boxes, Route, Plug, ChevronDown, ChevronRight, RefreshCw, Radar, Check, Hand, Clock, Minus, Search, ShieldCheck } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref } from "../store.js";
import { Panel, Loading, ErrorNotice, Empty, Chip, StatusChip, Notice } from "../components/ui.jsx";

const TABS = [
  { id: "openai", label: "Audit OpenAI", icon: Orbit },
  { id: "anthropic", label: "Audit Anthropic", icon: Sparkles },
  { id: "standards", label: "Standarde", icon: Scale },
  { id: "matrix", label: "Matrice", icon: Table2 },
  { id: "surfaces", label: "Suprafețe de execuție", icon: Layers },
  { id: "frameworks", label: "Frameworkuri", icon: Boxes },
  { id: "routing", label: "Rutare", icon: Route },
  { id: "integrations", label: "Integrări", icon: Plug },
];
const NEVER = () => false;

const FIELD_RO = {
  id: "ID", provider: "Provider", feature: "Funcționalitate", name: "Nume", title: "Titlu", category: "Categorie", status: "Stare", statuses: "Stări",
  executionSurface: "Suprafață de execuție", surface: "Suprafață", surfaces: "Suprafețe", plan: "Plan", plans: "Planuri", planRequired: "Plan necesar",
  planRequirement: "Plan necesar", subscriptionIncluded: "Inclus în abonament", included: "Inclus", apiBillingRisk: "Risc facturare API",
  programmaticIntegration: "Integrare programatică", programmatic: "Programatic", hubDecision: "Decizie Hub", decision: "Decizie", hubRelevance: "Relevanță Hub",
  relevance: "Relevanță", description: "Descriere", summary: "Rezumat", why: "De ce", note: "Notă", notes: "Note", sources: "Surse", source: "Sursă",
  sourceRead: "Sursă citită", verification: "Verificare", verifiedOn: "Verificat la", verifiedAt: "Verificat la", verified: "Verificat", rollout: "Lansare",
  platform: "Platformă", limitations: "Limitări", nextStep: "Pasul următor", risks: "Riscuri", risk: "Risc", evidence: "Dovezi", billing: "Facturare",
  billingMode: "Mod de facturare", permissions: "Permisiuni", authMode: "Autentificare", auth: "Autentificare", accountEligibility: "Eligibilitate cont",
  integrationRoute: "Traseu de integrare", test: "Test", tests: "Teste", license: "Licență", url: "URL", docs: "Documentație", version: "Versiune",
  maturity: "Maturitate", role: "Rol", replacement: "Înlocuire", alternatives: "Alternative", pros: "Avantaje", cons: "Dezavantaje", capability: "Capabilitate",
  capabilities: "Capabilități", openai: "OpenAI", anthropic: "Anthropic", hub: "Hub", standard: "Standard", owner: "Proprietar", updatedAt: "Actualizat",
  taskType: "Tip de task", label: "Etichetă", method: "Metodă", date: "Dată", checkedOn: "Verificat la", accessed: "Accesat",
};
const STATUS_WORDS = new Set(["available", "assisted", "unavailable", "unknown", "plan_restricted", "rollout_pending", "needs_setup", "blocked", "active", "planned", "paused", "connected", "verified"]);
const PROVIDER_RO = { openai: "OpenAI", anthropic: "Anthropic", hub: "Hub local", openclaw: "OpenClaw", third_party: "Terți" };
const PROVIDER_ORDER = ["hub", "openai", "anthropic", "openclaw", "third_party"];
const OPS = ["start", "resume", "sendInput", "streamEvents", "interrupt", "stop", "prepareHandoff", "getStatus", "getArtifacts"];
const OP_RO = { start: "pornire", resume: "reluare", sendInput: "input în turn", streamEvents: "flux de evenimente", interrupt: "întrerupere", stop: "oprire", prepareHandoff: "pregătire handoff", getStatus: "stare", getArtifacts: "artefacte" };
const SUPPORT_ICON = { SUPPORTED: Check, ASSISTED: Hand, PLANNED: Clock, UNSUPPORTED: Minus };
const SUPPORT_RO = { SUPPORTED: "suportat", ASSISTED: "asistat", PLANNED: "planificat", UNSUPPORTED: "nesuportat" };
const CONTROL_RO = { PROGRAMMATIC: "programatic", ASSISTED: "asistat", NATIVE_INTERACTIVE: "nativ interactiv", MIRROR: "oglindă read-only", NONE: "fără control" };
const CONTROL_TONE = { PROGRAMMATIC: "ok", ASSISTED: "info", NATIVE_INTERACTIVE: "info", MIRROR: "neutral", NONE: "neutral" };
const BILLING_RO = { subscription: "abonament", none: "fără cost", api: "API plătit", paid_plan: "plan plătit", cloud_provider: "cloud plătit", unknown: "facturare necunoscută" };
const BILLING_TONE = { subscription: "ok", none: "ok", api: "error", paid_plan: "error", cloud_provider: "error", unknown: "warn" };
const METHOD_RO = { doc_read: "documentație citită", local_cli: "CLI local", account_probe: "verificare cont", live_run: "execuție live", simulated_test: "test simulat", manual: "manual" };
const EXEC_RO = { programmatic: "programatic", assisted: "asistat", planned_only: "doar planificat (BUILD_SAFE)", blocked: "blocat", none: "fără execuție" };
const EXEC_TONE = { programmatic: "ok", assisted: "info", planned_only: "warn", blocked: "error", none: "neutral" };
const FACTOR_RO = { surface: "Suprafață", availability: "Disponibilitate", adapter: "Adaptor Hub", control: "Nivel de control", billing: "Facturare", billing_route: "Rută de facturare",
  usage_reserve: "Rezervă de utilizare", project: "Proiect", data_sensitivity: "Sensibilitatea datelor", history: "Istoric verificat", preference: "Preferință" };
const SENSITIVITY_RO = { normal: "normale", confidential: "confidențiale (fără cloud)", secret: "secrete (fără modele)" };
const CONTROL_MODE_RO = { structured_api: "API structurat", dom: "DOM în browser", visual: "control vizual" };
const KIND_RO = { hub_tool: "Unealtă Hub", mcp_server: "Server MCP", mcp_tool: "Unealtă MCP", claude_connector: "Connector Claude", claude_skill: "Skill Claude", claude_plugin: "Plugin Claude",
  codex_plugin: "Plugin Codex", openai_plugin: "Plugin OpenAI", openclaw_integration: "Integrare OpenClaw", native_capability: "Capabilitate nativă" };
const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare workspace", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "acțiuni externe", SENSITIVE_ACTIONS: "sensibile" };
const POLICY_RO = { AUTO_ALLOWED: "automat", ASK_ONCE_FOR_TASK: "o dată per task", ALWAYS_ASK: "de fiecare dată", DENIED: "interzis" };
const POLICY_TONE = { AUTO_ALLOWED: "ok", ASK_ONCE_FOR_TASK: "info", ALWAYS_ASK: "approval", DENIED: "error" };
const EFFECTS_RO = { none: "fără efecte", local: "local", external: "extern", unknown: "necunoscut" };
const EFFECTS_TONE = { none: "ok", local: "info", external: "warn", unknown: "neutral" };

const humanize = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
const fieldLabel = (key) => FIELD_RO[key] || humanize(key);
const isUrl = (s) => typeof s === "string" && /^https?:\/\/[^\s<>"]+$/i.test(s.trim());
const looksLikeStatus = (s) => typeof s === "string" && (/^[A-Z][A-Z0-9_]{1,39}$/.test(s) || STATUS_WORDS.has(s));
const asText = (v) => (v === null || v === undefined || v === "" ? "" : Array.isArray(v) ? v.map(asText).filter(Boolean).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Tab state: ?tab= in the hash is the source of truth; the last tab is remembered locally. */
function usePageTabs(screen, tabs, query, go) {
  const ids = tabs.map((t) => t.id);
  const [remembered, setRemembered] = usePref(`${screen}.tab`, ids[0]);
  const tab = ids.includes(query?.tab) ? query.tab : ids.includes(remembered) ? remembered : ids[0];
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => { setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab))); }, [tab]);
  const select = useCallback((id) => { setRemembered(id); go(`/${screen}?tab=${id}`); }, [screen, go, setRemembered]);
  return { tab, select, visited };
}

function Tabs({ tabs, value, onChange, label, idPrefix }) {
  const refs = useRef({});
  const onKeyDown = (e, index) => {
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return (
    <div className="tabs page-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} type="button" role="tab" id={`${idPrefix}-tab-${t.id}`} aria-controls={`${idPrefix}-panel-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          ref={(el) => { refs.current[t.id] = el; }} onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, i)}>
          <t.icon size={14} aria-hidden="true" />{t.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, tone = "" }) {
  return <div className={`stat-tile ${tone}`}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function Chevron({ open }) {
  return open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />;
}

/** Renders any config value honestly: text, links (http/https only), lists, nested maps. */
function Value({ value, depth = 0 }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  if (typeof value === "boolean") return <span>{value ? "da" : "nu"}</span>;
  if (typeof value === "number") return <span>{String(value)}</span>;
  if (typeof value === "string") return isUrl(value) ? <a className="break" href={value.trim()} target="_blank" rel="noreferrer noopener">{value}</a> : <span className="prewrap">{value}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="faint">—</span>;
    const simple = value.every((v) => v === null || typeof v !== "object");
    if (simple && !value.some(isUrl) && value.join(", ").length <= 160) return <span>{value.join(", ")}</span>;
    return <ul className="plain-list">{value.map((v, i) => <li key={i}><Value value={v} depth={depth + 1} /></li>)}</ul>;
  }
  if (typeof value === "object") {
    const link = value.url || value.href;
    if (isUrl(link)) {
      const when = value.date || value.accessed || value.checkedOn || value.verifiedOn || value.observedAt;
      return <span><a className="break" href={link.trim()} target="_blank" rel="noreferrer noopener">{value.title || value.label || value.name || link}</a>{when ? <span className="faint"> ({String(when)})</span> : null}{value.note ? <span className="muted"> — {String(value.note)}</span> : null}</span>;
    }
    if (depth >= 3) return <pre className="pre" style={{ maxHeight: 200 }}>{JSON.stringify(value, null, 2)}</pre>;
    const entries = Object.entries(value);
    if (!entries.length) return <span className="faint">—</span>;
    return <dl className="kv compact">{entries.map(([k, v]) => <Fragment key={k}><dt>{fieldLabel(k)}</dt><dd><Value value={v} depth={depth + 1} /></dd></Fragment>)}</dl>;
  }
  return <span>{String(value)}</span>;
}

function DetailList({ record, skip = [] }) {
  const skipped = new Set(skip);
  const entries = Object.entries(record || {}).filter(([k]) => !skipped.has(k));
  const tail = new Set(["sources", "source", "verification", "verifiedOn", "verifiedAt", "evidence"]);
  const ordered = [...entries.filter(([k]) => !tail.has(k)), ...entries.filter(([k]) => tail.has(k))];
  return <dl className="kv">{ordered.map(([k, v]) => <Fragment key={k}><dt>{fieldLabel(k)}</dt><dd><Value value={v} /></dd></Fragment>)}</dl>;
}

function MissingDoc({ name, label }) {
  return (
    <Panel>
      <Empty title={`${label}: document indisponibil`}>
        Fișierul <span className="mono">v2/config/ecosystem/{name}.json</span> lipsește. Hub-ul nu inventează intrări; secțiunea rămâne goală până când documentul verificat este adăugat.
      </Empty>
    </Panel>
  );
}

const lower = (v) => String(v ?? "").trim().toLowerCase();
function IncludedChip({ value }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  const s = lower(value);
  if (value === true || ["yes", "true", "included", "da", "inclus"].includes(s)) return <Chip tone="ok">inclus</Chip>;
  if (value === false || ["no", "false", "not_included", "excluded", "nu"].includes(s)) return <Chip tone="error">nu</Chip>;
  if (["partial", "limited", "partially", "parțial"].includes(s)) return <Chip tone="warn">parțial</Chip>;
  if (["unknown", "unclear", "necunoscut"].includes(s)) return <Chip>necunoscut</Chip>;
  return <Chip>{asText(value)}</Chip>;
}
function RiskChip({ value }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  const map = { none: ["ok", "niciunul"], low: ["ok", "scăzut"], medium: ["warn", "mediu"], high: ["error", "ridicat"], unknown: ["neutral", "necunoscut"] };
  const [tone, text] = map[lower(value)] || ["neutral", asText(value)];
  return <Chip tone={tone}>{text}</Chip>;
}
function RelevanceChip({ value }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  const map = { high: ["info", "ridicată"], medium: ["neutral", "medie"], low: ["neutral", "scăzută"], none: ["neutral", "niciuna"] };
  const [tone, text] = map[lower(value)] || ["neutral", asText(value)];
  return <Chip tone={tone}>{text}</Chip>;
}
function DecisionChip({ value }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  const text = asText(value);
  const tone = /reject|block|deny|forbid|exclude/i.test(text) ? "error" : /wrap|reimplement|adopt|integrat|use|keep|build/i.test(text) ? "info" : /assist|defer|later|watch|monitor|retire/i.test(text) ? "warn" : "neutral";
  return <Chip tone={tone}>{text}</Chip>;
}

function countBy(list, pick) {
  const counts = new Map();
  for (const item of list) { const v = pick(item); if (v === null || v === undefined || v === "") continue; const k = asText(v); counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function ApprovalRequired({ result, onDone }) {
  const exec = useAction(async () => { const r = await api(`/api/commands/${encodeURIComponent(result.commandId)}/execute`, { method: "POST", body: {} }); onDone?.(r?.result ?? r); });
  return (
    <>
      <Notice tone="warn" title="Aprobare necesară">
        O regulă de politică cere aprobare pentru {result.approval?.actionKind || "această comandă"}. Aprobă exact acțiunea în <a href="#/approvals">Aprobări</a>, apoi execută comanda aprobată.{" "}
        <button className="btn sm" disabled={exec.pending} onClick={exec.run}>{exec.pending ? "Se execută…" : "Execută după aprobare"}</button>
      </Notice>
      <ErrorNotice error={exec.error} />
    </>
  );
}

// ---------------------------------------------------------------- audit (OpenAI / Anthropic / standards)

function auditFields(r) {
  return {
    feature: r.feature || r.name || r.title || r.id || "—",
    status: r.status ?? (Array.isArray(r.statuses) ? r.statuses.join(", ") : null),
    plan: r.plan ?? r.planRequired ?? r.planRequirement ?? r.plans ?? null,
    included: r.subscriptionIncluded ?? r.included ?? null,
    apiBillingRisk: r.apiBillingRisk ?? null,
    programmatic: r.programmaticIntegration ?? r.programmatic ?? null,
    hubDecision: r.hubDecision ?? r.decision ?? null,
    relevance: r.hubRelevance ?? r.relevance ?? null,
  };
}

function Verifications({ capabilityId }) {
  const { data, error, loading, reload } = useResource(capabilityId ? `/api/capabilities/verifications?capabilityId=${encodeURIComponent(capabilityId)}` : null, { reloadOn: (e) => e.type === "capability.verified" });
  if (!capabilityId) return null;
  if (loading && !data) return <Loading lines={2} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const list = data?.verifications || [];
  if (!list.length) return <p className="faint small" style={{ margin: 0 }}>Nicio verificare înregistrată în Hub; rămâne valabilă eticheta din audit.</p>;
  return (
    <ul className="list">{list.map((v) => (
      <li key={v.id}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}>
        <StatusChip status={v.label} />
        <div className="grow"><div>{v.summary}</div><div className="sub">{METHOD_RO[v.method] || v.method} · {v.verifiedBy} · {fmt.dateTime(v.verifiedAt)}</div></div>
      </div></li>
    ))}</ul>
  );
}

function AuditTab({ name, label, icon }) {
  const { data, error, loading, reload } = useResource(`/api/ecosystem/${name}`, { reloadOn: NEVER });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [relevance, setRelevance] = useState("");
  const [decision, setDecision] = useState("");
  const [open, setOpen] = useState(null);
  const records = useMemo(() => (Array.isArray(data?.records) ? data.records : []), [data]);
  const statusOptions = useMemo(() => countBy(records, (r) => auditFields(r).status), [records]);
  const relevanceOptions = useMemo(() => countBy(records, (r) => auditFields(r).relevance), [records]);
  const decisionOptions = useMemo(() => countBy(records, (r) => auditFields(r).hubDecision), [records]);
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data || data.missing) return <MissingDoc name={name} label={label} />;
  const needle = q.trim().toLowerCase();
  const shown = records.filter((r) => {
    const f = auditFields(r);
    return (!status || asText(f.status) === status) && (!relevance || asText(f.relevance) === relevance) && (!decision || asText(f.hubDecision) === decision)
      && (!needle || JSON.stringify(r).toLowerCase().includes(needle));
  });
  const Icon = icon;
  return (
    <Panel title={`${label} · ${shown.length}/${records.length}`} icon={Icon} flush actions={<span className="faint small">verificat {data.verifiedOn || "—"}{data.version ? ` · v${data.version}` : ""}</span>}>
      <div className="panel-body stack tight">
        {data.note && <p className="faint small" style={{ margin: 0 }}>{data.note}</p>}
        <div className="filters">
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută funcționalitate, ID, sursă…" aria-label="Caută în audit" />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtru stare"><option value="">Toate stările</option>{statusOptions.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select>
          <select className="select" value={relevance} onChange={(e) => setRelevance(e.target.value)} aria-label="Filtru relevanță"><option value="">Orice relevanță</option>{relevanceOptions.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select>
          <select className="select" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Filtru decizie Hub"><option value="">Orice decizie Hub</option>{decisionOptions.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select>
        </div>
      </div>
      {!records.length ? <Empty title="Documentul nu conține înregistrări">Câmpul „records” lipsește sau este gol.</Empty> : shown.length ? (
        <div className="table-wrap"><table className="table table-mobile-cards">
          <thead><tr><th>Funcționalitate</th><th>Stare</th><th>Plan</th><th>Inclus</th><th>Risc API</th><th>Programatic</th><th>Decizie Hub</th><th>Relevanță</th></tr></thead>
          <tbody>{shown.map((r, index) => {
            const f = auditFields(r);
            const key = `${r.id || "rec"}-${index}`;
            const isOpen = open === key;
            const detailId = `audit-${name}-${index}`;
            return (
              <Fragment key={key}>
                <tr className={isOpen ? "is-open" : undefined}>
                  <td data-label="Funcționalitate">
                    <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} onClick={() => setOpen(isOpen ? null : key)}><Chevron open={isOpen} /><span>{f.feature}</span></button>
                    <div className="sub mono break">{[r.id, r.category, r.executionSurface].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td data-label="Stare" className="chip-fluid">{f.status ? (looksLikeStatus(asText(f.status)) ? <StatusChip status={asText(f.status)} /> : <span>{asText(f.status)}</span>) : <span className="faint">—</span>}</td>
                  <td data-label="Plan">{asText(f.plan) || <span className="faint">—</span>}</td>
                  <td data-label="Inclus în abonament" className="chip-fluid"><IncludedChip value={f.included} /></td>
                  <td data-label="Risc facturare API" className="chip-fluid"><RiskChip value={f.apiBillingRisk} /></td>
                  <td data-label="Programatic" className="chip-fluid">{f.programmatic ? <Chip>{asText(f.programmatic)}</Chip> : <span className="faint">—</span>}</td>
                  <td data-label="Decizie Hub" className="chip-fluid"><DecisionChip value={f.hubDecision} /></td>
                  <td data-label="Relevanță" className="chip-fluid"><RelevanceChip value={f.relevance} /></td>
                </tr>
                {isOpen && (
                  <tr className="detail-row" id={detailId}><td colSpan={8}>
                    <div className="stack">
                      <DetailList record={r} />
                      <div><div className="section-title">Verificări înregistrate în Hub</div><Verifications capabilityId={r.id} /></div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table></div>
      ) : <Empty title="Nicio înregistrare pentru filtrele alese" action={<button className="btn sm" onClick={() => { setQ(""); setStatus(""); setRelevance(""); setDecision(""); }}>Resetează filtrele</button>} />}
    </Panel>
  );
}

// ---------------------------------------------------------------- matrix & frameworks (generic, config-driven)

function firstArray(data, preferred) {
  if (!data || typeof data !== "object") return [];
  for (const key of preferred) if (Array.isArray(data[key])) return data[key];
  const found = Object.values(data).find((v) => Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x)));
  return found || [];
}

function MatrixCell({ value }) {
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  if (typeof value === "string") return looksLikeStatus(value) ? <StatusChip status={value} /> : <span className="prewrap">{value}</span>;
  if (typeof value === "boolean") return value ? <Chip tone="ok">da</Chip> : <Chip>nu</Chip>;
  if (typeof value === "object" && !Array.isArray(value) && (value.status || value.label || value.support)) {
    const s = asText(value.status || value.label || value.support);
    const rest = Object.fromEntries(Object.entries(value).filter(([k]) => !["status", "label", "support"].includes(k)));
    return <div className="stack tight">{looksLikeStatus(s) ? <StatusChip status={s} /> : <strong>{s}</strong>}{Object.keys(rest).length > 0 && <div className="small muted"><Value value={rest} depth={1} /></div>}</div>;
  }
  return <Value value={value} depth={1} />;
}

function MatrixTab() {
  const { data, error, loading, reload } = useResource("/api/ecosystem/matrix", { reloadOn: NEVER });
  const [q, setQ] = useState("");
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data || data.missing) return <MissingDoc name="matrix" label="Matricea cross-ecosistem" />;
  const rows = firstArray(data, ["rows", "matrix", "records"]);
  const columns = Array.isArray(data.columns) && data.columns.length
    ? data.columns.map((c) => (typeof c === "string" ? { id: c, label: fieldLabel(c) } : { id: c.id ?? c.key, label: c.label ?? fieldLabel(c.id ?? c.key) })).filter((c) => c.id)
    : [...new Set(rows.flatMap((r) => Object.keys(r || {})))].filter((k) => k !== "missing").map((k) => ({ id: k, label: fieldLabel(k) }));
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || JSON.stringify(r).toLowerCase().includes(needle));
  const missingRows = rows.filter((r) => r?.missing).length;
  return (
    <Panel title={`Matrice cross-ecosistem · ${shown.length}/${rows.length}`} icon={Table2} flush actions={<span className="faint small">verificat {data.verifiedOn || "—"}</span>}>
      <div className="panel-body stack tight">
        {data.note && <p className="faint small" style={{ margin: 0 }}>{data.note}</p>}
        {missingRows > 0 && <Notice tone="warn">{missingRows} {missingRows === 1 ? "rând nu are" : "rânduri nu au"} încă date verificate (marcate „lipsește”).</Notice>}
        <div className="filters"><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută în matrice…" aria-label="Caută în matrice" /></div>
      </div>
      {!rows.length ? <Empty title="Matricea nu conține rânduri" /> : shown.length ? (
        <div className="table-wrap"><table className="table table-mobile-cards">
          <thead><tr>{columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => (
            <tr key={r?.id || i}>
              {columns.map((c, ci) => (
                <td key={c.id} data-label={c.label} className="chip-fluid">
                  <MatrixCell value={r?.[c.id]} />
                  {ci === 0 && r?.missing && <div style={{ marginTop: 4 }}><Chip tone="warn">lipsește</Chip></div>}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty title="Niciun rând pentru căutarea curentă" />}
    </Panel>
  );
}

function FrameworksTab() {
  const { data, error, loading, reload } = useResource("/api/ecosystem/frameworks", { reloadOn: NEVER });
  // OpenAI, Anthropic and Agent Hub V1 are evaluated on the same fields and listed first.
  const systemsRes = useResource("/api/ecosystem/systems", { reloadOn: NEVER });
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data || data.missing) return <MissingDoc name="frameworks" label="Evaluarea frameworkurilor" />;
  const systems = systemsRes.data && !systemsRes.data.missing ? firstArray(systemsRes.data, ["systems"]) : [];
  const items = [...systems, ...firstArray(data, ["frameworks", "records", "items", "entries", "evaluations", "rows"])];
  return (
    <Panel title={`Sisteme și frameworkuri evaluate (${items.length})`} icon={Boxes} flush actions={<span className="faint small">verificat {data.verifiedOn || "—"}</span>}>
      {data.note && <div className="panel-body" style={{ paddingBottom: 0 }}><p className="faint small" style={{ margin: 0 }}>{data.note}</p></div>}
      {items.length ? (
        <ul className="list">{items.map((item, i) => {
          const key = `${item.id || item.name || "fw"}-${i}`;
          const isOpen = open === key;
          const name = item.name || item.title || item.id || `#${i + 1}`;
          const decision = item.decision ?? item.hubDecision ?? item.verdict ?? item.status ?? null;
          const summary = item.summary ?? item.description ?? item.why ?? item.role ?? item.note ?? "";
          return (
            <li key={key}>
              <div className="list-row surface-row">
                <div className="grow">
                  <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `fw-${i}` : undefined} onClick={() => setOpen(isOpen ? null : key)}><Chevron open={isOpen} /><span>{name}</span></button>
                  {summary && <div className="sub">{asText(summary)}</div>}
                </div>
                {decision !== null && decision !== undefined && decision !== "" && <div className="chip-fluid"><DecisionChip value={decision} /></div>}
              </div>
              {isOpen && <div className="expand-body" id={`fw-${i}`}><DetailList record={item} /></div>}
            </li>
          );
        })}</ul>
      ) : <Empty title="Documentul nu conține frameworkuri" />}
    </Panel>
  );
}

// ---------------------------------------------------------------- execution surfaces

function OpsStrip({ operations = {} }) {
  return (
    <ul className="ops-strip" aria-label="Operații ExecutionSurfaceAdapter">
      {OPS.map((op) => {
        const support = operations[op]?.support || "UNSUPPORTED";
        const Icon = SUPPORT_ICON[support] || Minus;
        const text = `${OP_RO[op]}: ${SUPPORT_RO[support] || support}${operations[op]?.note ? ` (${operations[op].note})` : ""}`;
        return <li key={op} className={support} title={text}><Icon aria-hidden="true" /><span className="sr-only">{text}</span></li>;
      })}
    </ul>
  );
}

function SurfaceDetail({ surface }) {
  const detail = useResource(`/api/surfaces/${encodeURIComponent(surface.id)}`, { reloadOn: (e) => e.type === "capability.verified" || e.type.startsWith("artifact.") });
  const evidence = surface.evidence && Object.keys(surface.evidence).length ? surface.evidence : null;
  return (
    <div className="expand-body" id={`surface-${surface.id}`}>
      {surface.description && <p className="muted" style={{ margin: 0 }}>{surface.description}</p>}
      <dl className="kv">
        <dt>Disponibilitate</dt><dd><StatusChip status={surface.availability} /> {surface.availabilityReason}</dd>
        <dt>Tip · locație</dt><dd>{surface.surfaceType} · {surface.location === "cloud" ? "cloud" : "local"}</dd>
        <dt>Platformă</dt><dd>{surface.platform || "—"}</dd>
        <dt>Plan necesar</dt><dd>{surface.planRequirement || "—"}</dd>
        <dt>Autentificare</dt><dd>{surface.authMode || "—"}</dd>
        <dt>Facturare</dt><dd>{BILLING_RO[surface.billingMode] || surface.billingMode}</dd>
        <dt>Control</dt><dd>{CONTROL_RO[surface.programmaticControl] || surface.programmaticControl} · adaptor <span className="mono">{surface.adapter}</span></dd>
        <dt>Decizie Hub</dt><dd>{surface.hubDecision || "—"}</dd>
        <dt>Capabilități</dt><dd>{surface.capabilities?.length ? <div className="chips">{surface.capabilities.map((c) => <Chip key={c}>{c}</Chip>)}</div> : "—"}</dd>
        <dt>Verificat</dt><dd>{surface.verifiedAt ? `${fmt.dateTime(surface.verifiedAt)} (inspecție locală)` : "doar linia de bază din audit"}{surface.configVersion ? ` · config v${surface.configVersion}` : ""}</dd>
        {evidence && <><dt>Dovezi</dt><dd><Value value={evidence} /></dd></>}
      </dl>
      <div>
        <div className="section-title">Operații ExecutionSurfaceAdapter</div>
        <div className="table-wrap"><table className="table table-mobile-cards">
          <thead><tr><th>Operație</th><th>Suport</th><th>Notă</th></tr></thead>
          <tbody>{OPS.map((op) => {
            const o = surface.operations?.[op] || { support: "UNSUPPORTED", note: "" };
            return <tr key={op}><td data-label="Operație"><strong>{OP_RO[op]}</strong> <span className="faint mono small">{op}</span></td><td data-label="Suport"><StatusChip status={o.support} /></td><td data-label="Notă" className="muted">{o.note || "—"}</td></tr>;
          })}</tbody>
        </table></div>
      </div>
      {surface.safetyConstraints?.length > 0 && <div><div className="section-title">Constrângeri de siguranță</div><ul className="plain-list">{surface.safetyConstraints.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      <div>
        <div className="section-title">Verificări</div>
        {detail.loading && !detail.data ? <Loading lines={2} /> : detail.error && !detail.data ? <ErrorNotice error={detail.error} onRetry={detail.reload} /> : detail.data?.verifications?.length ? (
          <ul className="list">{detail.data.verifications.map((v) => (
            <li key={v.id}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}>
              <StatusChip status={v.label} />
              <div className="grow"><div>{v.summary}</div><div className="sub">{METHOD_RO[v.method] || v.method} · {v.verifiedBy} · {fmt.dateTime(v.verifiedAt)}</div></div>
            </div></li>
          ))}</ul>
        ) : <p className="faint small" style={{ margin: 0 }}>Nicio verificare înregistrată pentru această suprafață.</p>}
      </div>
      {detail.data?.capabilities?.length > 0 && (
        <div><div className="section-title">Capabilități din registru ({detail.data.capabilities.length})</div>
          <div className="chips">{detail.data.capabilities.map((c) => <Chip key={c.id} title={c.hubDecision || ""}>{c.feature} · {c.status}</Chip>)}</div>
        </div>
      )}
      {detail.data?.artifacts?.length > 0 && (
        <div><div className="section-title">Artefacte ({detail.data.artifacts.length})</div>
          <ul className="plain-list">{detail.data.artifacts.map((a) => <li key={a.id}>{a.title} · {a.kind} · v{a.version} · {fmt.dateTime(a.createdAt)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function RefreshOutcome({ outcome, onApproved }) {
  if (!outcome) return null;
  const { kind, result } = outcome;
  if (result?.approvalRequired) return <ApprovalRequired result={result} onDone={onApproved} />;
  if (kind === "surfaces") {
    const updates = result?.updates || [];
    return <Notice tone="info" title="Disponibilitate reîmprospătată">{updates.length ? updates.map((u) => `${u.id} → ${u.availability} (${u.label})`).join(" · ") : "Nicio suprafață nu are încă o inspecție locală. Rulează „Verifică contul” în Integrări; restul suprafețelor păstrează linia de bază din audit."}</Notice>;
  }
  if (result?.ok === false) return <Notice tone="warn" title="Oglindirea sesiunilor Claude a eșuat">{result.error}</Notice>;
  return <Notice tone="info" title="Sesiuni Claude oglindite (read-only)">{result?.sessions ?? 0} în proiecte înregistrate · {result?.unregisteredCount ?? 0} ignorate (foldere neînregistrate) · {result?.changes ?? 0} schimbări · {fmt.dateTime(result?.observedAt)}</Notice>;
}

function SurfacesTab() {
  const { data, error, loading, reload } = useResource("/api/surfaces", { reloadOn: (e) => e.type === "capability.verified" || e.type.startsWith("surfaces.") || e.type.startsWith("provider.") });
  const [provider, setProvider] = useState("all");
  const [availability, setAvailability] = useState("");
  const [open, setOpen] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const refresh = useAction(async () => { const result = await api("/api/surfaces/refresh", { method: "POST", body: {} }); setOutcome({ kind: "surfaces", result }); reload(); });
  const mirror = useAction(async () => { const result = await api("/api/native-sessions/refresh", { method: "POST", body: {} }); setOutcome({ kind: "mirror", result }); reload(); });
  const surfaces = data?.surfaces || [];
  const providers = [...PROVIDER_ORDER.filter((p) => surfaces.some((s) => s.provider === p)), ...[...new Set(surfaces.map((s) => s.provider))].filter((p) => !PROVIDER_ORDER.includes(p))];
  const availabilityOptions = countBy(surfaces, (s) => s.availability);
  const shown = surfaces.filter((s) => (provider === "all" || s.provider === provider) && (!availability || s.availability === availability));
  const n = (a) => surfaces.filter((s) => s.availability === a).length;
  return (
    <div className="stack">
      <Panel title="Suprafețe de execuție" icon={Layers}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Același provider oferă mai multe suprafețe. Disponibilitatea este linia de bază din audit până la o inspecție locală (verificare cont, <span className="mono">claude agents --json</span>); nicio acțiune de aici nu pornește un model.</p>
          <div className="row wrap">
            <button className="btn sm" disabled={refresh.pending} onClick={refresh.run}><RefreshCw size={14} />{refresh.pending ? "Se reîmprospătează…" : "Reîmprospătează"}</button>
            <button className="btn sm" disabled={mirror.pending} onClick={mirror.run}><Radar size={14} />{mirror.pending ? "Se citește…" : "Oglindește sesiunile Claude"}</button>
          </div>
          <dl className="stat-tiles">
            <Tile label="suprafețe" value={surfaces.length} />
            <Tile label="disponibile" value={n("available")} tone="good" />
            <Tile label="asistate" value={n("assisted")} />
            <Tile label="necesită configurare" value={n("needs_setup")} tone={n("needs_setup") ? "attention" : ""} />
            <Tile label="necunoscute" value={n("unknown")} />
            <Tile label="blocate / indisponibile" value={n("blocked") + n("unavailable")} tone={n("blocked") + n("unavailable") ? "alert" : ""} />
          </dl>
          <div className="ops-legend" aria-label="Legendă operații">
            {Object.entries(SUPPORT_RO).map(([k, v]) => { const Icon = SUPPORT_ICON[k]; return <span key={k}><Icon size={13} aria-hidden="true" />{v}</span>; })}
            <span>· ordine: {OPS.map((op) => OP_RO[op]).join(", ")}</span>
          </div>
          <RefreshOutcome outcome={outcome} onApproved={(result) => { setOutcome({ kind: "mirror", result }); reload(); }} />
          <ErrorNotice error={refresh.error || mirror.error} />
        </div>
      </Panel>
      <div className="row wrap between">
        <div className="seg wrap" role="group" aria-label="Filtru provider">
          <button type="button" aria-pressed={provider === "all"} onClick={() => setProvider("all")}>Toți ({surfaces.length})</button>
          {providers.map((p) => <button key={p} type="button" aria-pressed={provider === p} onClick={() => setProvider(p)}>{PROVIDER_RO[p] || p} ({surfaces.filter((s) => s.provider === p).length})</button>)}
        </div>
        <select className="select" style={{ width: "auto", minHeight: 32 }} value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="Filtru disponibilitate">
          <option value="">Orice disponibilitate</option>{availabilityOptions.map(([v, count]) => <option key={v} value={v}>{v} ({count})</option>)}
        </select>
      </div>
      {loading && !data ? <Loading lines={6} /> : error && !data ? <ErrorNotice error={error} onRetry={reload} /> : !surfaces.length ? (
        <Panel><Empty title="Registrul suprafețelor este gol">Fișierul v2/config/ecosystem/surfaces.json lipsește sau nu conține suprafețe.</Empty></Panel>
      ) : !shown.length ? <Panel><Empty title="Nicio suprafață pentru filtrele alese" /></Panel> : providers.filter((p) => shown.some((s) => s.provider === p)).map((p) => (
        <Panel key={p} title={`${PROVIDER_RO[p] || p} (${shown.filter((s) => s.provider === p).length})`} flush>
          <ul className="list">{shown.filter((s) => s.provider === p).map((s) => {
            const isOpen = open === s.id;
            return (
              <li key={s.id}>
                <div className="list-row surface-row">
                  <div className="grow">
                    <button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `surface-${s.id}` : undefined} onClick={() => setOpen(isOpen ? null : s.id)}><Chevron open={isOpen} /><span>{s.name}</span></button>
                    <div className="sub"><span className="mono break">{s.id}</span> · {s.surfaceType} · {s.location === "cloud" ? "cloud" : "local"}</div>
                    <div className="chips" style={{ marginTop: 6 }}>
                      <StatusChip status={s.availability} />
                      <Chip tone={CONTROL_TONE[s.programmaticControl] || "neutral"}>{CONTROL_RO[s.programmaticControl] || s.programmaticControl}</Chip>
                      <Chip tone={BILLING_TONE[s.billingMode] || "neutral"}>{BILLING_RO[s.billingMode] || s.billingMode}</Chip>
                    </div>
                  </div>
                  <OpsStrip operations={s.operations} />
                </div>
                {isOpen && <SurfaceDetail surface={s} />}
              </li>
            );
          })}</ul>
        </Panel>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- routing

function EffectChip({ effect }) {
  const e = String(effect ?? "");
  if (e === "exclude") return <Chip tone="error">exclus</Chip>;
  if (e.startsWith("-")) return <Chip tone="warn">{e}</Chip>;
  if (e.startsWith("+")) return <Chip tone="ok">{e}</Chip>;
  return <Chip>{e === "0" ? "neutru" : e || "—"}</Chip>;
}

function FactorList({ factors = [] }) {
  if (!factors.length) return <p className="faint small" style={{ margin: 0 }}>Niciun factor: nicio suprafață nu a fost aleasă.</p>;
  return (
    <ul className="list">{factors.map((f, i) => (
      <li key={`${f.id}-${i}`}><div className="list-row" style={{ padding: "6px 0", alignItems: "flex-start" }}>
        <EffectChip effect={f.effect} /><div className="grow"><strong>{FACTOR_RO[f.id] || f.id}</strong><div className="sub">{f.detail}</div></div>
      </div></li>
    ))}</ul>
  );
}

function RouteDecisionView({ decision: d, surfaceName, deptName }) {
  const alternatives = d.alternatives || [];
  const plan = d.computerPlan;
  return (
    <div className="stack">
      <div className="chips">
        <Chip tone={EXEC_TONE[d.executionMode] || "neutral"}>{EXEC_RO[d.executionMode] || d.executionMode}</Chip>
        {d.manualOverride && <Chip tone="warn">override manual{d.overrideBy ? ` · ${d.overrideBy}` : ""}</Chip>}
        {d.status && <StatusChip status={d.status} />}
        {d.createdAt && <span className="faint small">{fmt.dateTime(d.createdAt)}</span>}
      </div>
      <dl className="kv">
        <dt>Suprafață</dt><dd>{d.surfaceId ? <>{surfaceName(d.surfaceId)} <span className="faint mono small break">{d.surfaceId}</span></> : "nicio suprafață eligibilă"}</dd>
        <dt>Provider</dt><dd>{d.provider || "—"}</dd>
        <dt>Model</dt><dd>{d.model || "implicit"}{d.modelNote && <div className="faint small">{d.modelNote}</div>}</dd>
        <dt>Rol · departament</dt><dd>{d.roleId || "—"} · {deptName(d.departmentId)}</dd>
        <dt>Unelte</dt><dd>{d.tools?.length ? <div className="chips">{d.tools.map((t) => <Chip key={t}>{t}</Chip>)}</div> : "—"}</dd>
        {d.computerEnvId && <><dt>Mediu computer</dt><dd className="mono break">{d.computerEnvId}</dd></>}
        <dt>Motiv</dt><dd>{d.reason}</dd>
      </dl>
      <div><div className="section-title">Factori pentru suprafața aleasă</div><FactorList factors={d.factors} /></div>
      <div>
        <div className="section-title">Alternative evaluate ({alternatives.length})</div>
        {alternatives.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Suprafață</th><th>Scor</th><th>Stare</th><th>Factori decisivi</th></tr></thead>
            <tbody>{alternatives.map((a) => {
              const decisive = (a.factors || []).filter((f) => (a.excluded ? f.effect === "exclude" : f.effect !== "0"));
              return (
                <tr key={a.surfaceId} className={a.surfaceId === d.surfaceId ? "row-selected" : undefined}>
                  <td data-label="Suprafață">{surfaceName(a.surfaceId)}<div className="sub mono break">{a.surfaceId}</div></td>
                  <td data-label="Scor" className="mono">{a.score ?? "—"}</td>
                  <td data-label="Stare">{a.excluded ? <Chip tone="error">exclusă</Chip> : a.surfaceId === d.surfaceId ? <Chip tone="ok">aleasă</Chip> : <Chip>eligibilă</Chip>}</td>
                  <td data-label="Factori decisivi">{decisive.length ? <ul className="plain-list">{decisive.map((f, i) => <li key={`${f.id}-${i}`}><strong>{FACTOR_RO[f.id] || f.id}</strong> ({f.effect === "exclude" ? "exclus" : f.effect}): {f.detail}</li>)}</ul> : <span className="faint">fără penalizări</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <p className="faint small" style={{ margin: 0 }}>Nicio alternativă înregistrată.</p>}
      </div>
      {plan && (
        <div>
          <div className="section-title">Plan computer: {plan.useCase?.label || plan.useCase?.id}</div>
          <dl className="kv">
            <dt>Mediu principal</dt><dd>{plan.primary ? <>{plan.primary.name} · {CONTROL_MODE_RO[plan.primary.controlMode] || plan.primary.controlMode} <StatusChip status={plan.primary.status} /></> : "niciun mediu utilizabil"}</dd>
            <dt>Alternative</dt><dd>{plan.fallbacks?.length ? plan.fallbacks.map((e) => `${e.name} (${CONTROL_MODE_RO[e.controlMode] || e.controlMode})`).join(", ") : "—"}</dd>
            <dt>Excluse</dt><dd>{plan.excluded?.length ? plan.excluded.map((e) => `${e.id} (${e.status})`).join(", ") : "—"}</dd>
          </dl>
          <p className="faint small" style={{ margin: "6px 0 0" }}>{plan.rule}</p>
        </div>
      )}
    </div>
  );
}

function RoutingTab() {
  const routes = useResource("/api/routes", { reloadOn: (e) => e.type === "route.decided" });
  const surfaces = useResource("/api/surfaces", { reloadOn: NEVER });
  const company = useResource("/api/company", { reloadOn: NEVER });
  const [form, setForm] = useState({ taskType: "", dataSensitivity: "normal", preferredProvider: "" });
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(null);
  const taskTypes = routes.data?.taskTypes || [];
  const decisions = routes.data?.decisions || [];
  useEffect(() => { if (!form.taskType && taskTypes.length) setForm((f) => ({ ...f, taskType: taskTypes[0].id })); }, [taskTypes, form.taskType]);
  const surfaceMap = useMemo(() => new Map((surfaces.data?.surfaces || []).map((s) => [s.id, s.name])), [surfaces.data]);
  const departments = company.data?.departments || [];
  const surfaceName = (id) => surfaceMap.get(id) || id || "—";
  const deptName = (id) => departments.find((d) => d.id === id)?.name || "—";
  const deptByKey = (key) => departments.find((d) => d.key === key)?.name || key || "—";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const explain = useAction(async () => {
    const body = { taskType: form.taskType, dataSensitivity: form.dataSensitivity };
    if (form.preferredProvider) body.preferredProvider = form.preferredProvider;
    setResult(await api("/api/routes/explain", { method: "POST", body }));
  });
  if (routes.loading && !routes.data) return <Loading lines={6} />;
  if (routes.error && !routes.data) return <ErrorNotice error={routes.error} onRetry={routes.reload} />;
  return (
    <div className="stack">
      <Panel title="Explică o rutare" icon={Route}>
        {taskTypes.length ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (form.taskType) explain.run(); }}>
            <p className="muted" style={{ margin: 0 }}>Routerul alege departament, rol, provider, model, suprafață și unelte din tabelul de rutare și din fapte verificate: disponibilitate, control, facturare, rezervă de utilizare, sensibilitatea datelor și istoric. Decizia se înregistrează ca propunere; nu pornește nicio execuție.</p>
            <div className="grid three">
              <label className="field"><span>Tip de task</span><select className="select" value={form.taskType} onChange={set("taskType")}>{taskTypes.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.id})</option>)}</select></label>
              <label className="field"><span>Date</span><select className="select" value={form.dataSensitivity} onChange={set("dataSensitivity")}>{Object.entries(SENSITIVITY_RO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="field"><span>Provider preferat</span><select className="select" value={form.preferredProvider} onChange={set("preferredProvider")}><option value="">Fără preferință</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
            </div>
            <div className="row wrap"><button type="submit" className="btn primary" disabled={!form.taskType || explain.pending}><Search size={14} />{explain.pending ? "Se evaluează…" : "Explică rutarea"}</button></div>
          </form>
        ) : <Empty title="Tabelul de rutare este gol">Fișierul v2/config/ecosystem/routing.json lipsește sau nu are tipuri de task.</Empty>}
        <ErrorNotice error={surfaces.error || company.error} onRetry={() => { surfaces.reload(); company.reload(); }} />
        <ErrorNotice error={explain.error} />
        {result && <div style={{ marginTop: 16 }}><RouteDecisionView decision={result} surfaceName={surfaceName} deptName={deptName} /></div>}
      </Panel>
      <Panel title={`Tipuri de task (${taskTypes.length})`} icon={Table2} flush>
        {taskTypes.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Tip</th><th>Departament</th><th>Automatizare</th><th>Candidați</th><th>De ce</th></tr></thead>
            <tbody>{taskTypes.map((t) => (
              <tr key={t.id}>
                <td data-label="Tip"><strong>{t.label}</strong><div className="sub mono">{t.id}</div></td>
                <td data-label="Departament">{deptByKey(t.department)}</td>
                <td data-label="Automatizare">{t.requiresAutomation ? <Chip tone="info">cere automatizare</Chip> : <Chip>asistat permis</Chip>}</td>
                <td data-label="Candidați"><div className="chips">{t.candidates.map((c) => <Chip key={c} title={c}>{surfaceName(c)}</Chip>)}</div></td>
                <td data-label="De ce" className="muted">{t.why || "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Niciun tip de task" />}
      </Panel>
      <Panel title={`Decizii recente (${decisions.length})`} icon={ShieldCheck} flush>
        {decisions.length ? (
          <div className="table-wrap"><table className="table table-mobile-cards">
            <thead><tr><th>Când</th><th>Tip task</th><th>Suprafață</th><th>Model</th><th>Mod</th><th>Stare</th></tr></thead>
            <tbody>{decisions.slice(0, 60).map((d) => {
              const isOpen = open === d.id;
              return (
                <Fragment key={d.id}>
                  <tr className={isOpen ? "is-open" : undefined}>
                    <td data-label="Când"><button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `route-${d.id}` : undefined} onClick={() => setOpen(isOpen ? null : d.id)}><Chevron open={isOpen} /><span>{fmt.dateTime(d.createdAt)}</span></button><div className="sub">{d.subjectType === "task" ? `task ${fmt.short(d.subjectId)}` : "explicație ad-hoc"}</div></td>
                    <td data-label="Tip task" className="mono">{d.taskType}</td>
                    <td data-label="Suprafață">{d.surfaceId ? surfaceName(d.surfaceId) : <span className="faint">niciuna</span>}</td>
                    <td data-label="Model">{d.model || <span className="faint">implicit</span>}</td>
                    <td data-label="Mod"><Chip tone={EXEC_TONE[d.executionMode] || "neutral"}>{EXEC_RO[d.executionMode] || d.executionMode}</Chip>{d.manualOverride && <Chip tone="warn">override</Chip>}</td>
                    <td data-label="Stare"><StatusChip status={d.status} /></td>
                  </tr>
                  {isOpen && <tr className="detail-row" id={`route-${d.id}`}><td colSpan={6}><RouteDecisionView decision={d} surfaceName={surfaceName} deptName={deptName} /></td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table></div>
        ) : <Empty title="Nicio decizie de rutare">Deciziile apar când explici o rutare sau când un task este rutat.</Empty>}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- integrations registry

function IntegrationsTab() {
  const { data, error, loading, reload } = useResource("/api/integrations/registry", { reloadOn: (e) => e.type.startsWith("integrations.") });
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading lines={6} />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;
  const list = data?.integrations || [];
  const kinds = countBy(list, (i) => i.kind);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((i) => (!kind || i.kind === kind) && (!needle || `${i.id} ${i.name} ${i.description} ${i.source}`.toLowerCase().includes(needle)));
  return (
    <Panel title={`Registru integrări · ${shown.length}/${list.length}`} icon={Plug} flush>
      <div className="panel-body stack tight">
        <p className="muted" style={{ margin: 0 }}>O singură listă a tot ce poate acționa: unelte Hub, servere MCP, connectori, skill-uri și pluginuri. Politica de aprobare vine din catalogul Hub; dialogul de permisiuni al vendorului nu o înlocuiește. Hub-ul nu instalează și nu conectează nimic singur.</p>
        <div className="filters">
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută nume, ID, sursă…" aria-label="Caută integrări" />
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtru tip"><option value="">Toate tipurile</option>{kinds.map(([k, n]) => <option key={k} value={k}>{KIND_RO[k] || k} ({n})</option>)}</select>
        </div>
      </div>
      {!list.length ? <Empty title="Registrul este gol">Nicio unealtă Hub și nicio intrare din integrations.json.</Empty> : shown.length ? (
        <div className="table-wrap"><table className="table table-mobile-cards">
          <thead><tr><th>Integrare</th><th>Tip</th><th>Efecte</th><th>Nivel</th><th>Politică aprobare</th><th>Stare</th></tr></thead>
          <tbody>{shown.map((i) => {
            const isOpen = open === i.id;
            const policy = i.approvalPolicy || {};
            return (
              <Fragment key={i.id}>
                <tr className={isOpen ? "is-open" : undefined}>
                  <td data-label="Integrare"><button className="link-btn" aria-expanded={isOpen} aria-controls={isOpen ? `integration-${i.id}` : undefined} onClick={() => setOpen(isOpen ? null : i.id)}><Chevron open={isOpen} /><span>{i.name}</span></button><div className="sub mono break">{i.id} · {i.source}</div></td>
                  <td data-label="Tip">{KIND_RO[i.kind] || i.kind}</td>
                  <td data-label="Efecte"><Chip tone={EFFECTS_TONE[i.sideEffects] || "neutral"}>{EFFECTS_RO[i.sideEffects] || i.sideEffects}</Chip></td>
                  <td data-label="Nivel">{TIER_RO[i.permissionTier] || i.permissionTier}</td>
                  <td data-label="Politică aprobare"><Chip tone={POLICY_TONE[policy.policy] || "neutral"}>{POLICY_RO[policy.policy] || policy.policy || "—"}</Chip><div className="sub mono">{policy.actionKind}</div></td>
                  <td data-label="Stare"><StatusChip status={i.status} />{i.statusReason && <div className="sub">{i.statusReason}</div>}</td>
                </tr>
                {isOpen && (
                  <tr className="detail-row" id={`integration-${i.id}`}><td colSpan={6}>
                    <dl className="kv">
                      <dt>Descriere</dt><dd>{i.description || "—"}</dd>
                      <dt>Scope</dt><dd>{i.scope}</dd>
                      <dt>Suprafață proprietar</dt><dd className="mono break">{i.ownerSurfaceId || "—"}</dd>
                      <dt>Capabilitate</dt><dd className="mono break">{i.capabilityId || "—"}</dd>
                      <dt>Politică</dt><dd>{POLICY_RO[policy.policy] || policy.policy} · cel mai permisiv posibil: {POLICY_RO[policy.loosest] || policy.loosest} · promptul vendorului {policy.vendorPromptReplacesHub ? "înlocuiește" : "nu înlocuiește"} decizia Hub</dd>
                      <dt>Descoperit prin</dt><dd>{i.discoveredVia} · {fmt.dateTime(i.discoveredAt)}</dd>
                      {i.permissions?.length > 0 && <><dt>Permisiuni</dt><dd><Value value={i.permissions} /></dd></>}
                      {i.data && Object.keys(i.data).length > 0 && <><dt>Date</dt><dd><Value value={i.data} /></dd></>}
                      {i.schema && Object.keys(i.schema).length > 0 && <><dt>Schemă</dt><dd><pre className="pre" style={{ maxHeight: 220 }}>{JSON.stringify(i.schema, null, 2)}</pre></dd></>}
                    </dl>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table></div>
      ) : <Empty title="Nicio integrare pentru filtrele alese" />}
    </Panel>
  );
}

// ---------------------------------------------------------------- screen

const PANELS = {
  openai: () => <AuditTab name="openai" label="Audit OpenAI" icon={Orbit} />,
  anthropic: () => <AuditTab name="anthropic" label="Audit Anthropic" icon={Sparkles} />,
  standards: () => <AuditTab name="standards" label="Standarde deschise" icon={Scale} />,
  matrix: MatrixTab,
  surfaces: SurfacesTab,
  frameworks: FrameworksTab,
  routing: RoutingTab,
  integrations: IntegrationsTab,
};

export default function Ecosystem({ query, go }) {
  const { tab, select, visited } = usePageTabs("ecosystem", TABS, query, go);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Ecosisteme AI</h1><p>Auditul OpenAI, Anthropic și al standardelor deschise, suprafețele de execuție cu nivelul lor real de control, rutarea explicabilă și registrul de integrări. Doar rutele incluse în abonament sunt permise.</p></div></div>
      <Tabs tabs={TABS} value={tab} onChange={select} label="Secțiuni ecosisteme" idPrefix="ecosystem" />
      {TABS.map((t) => {
        const Content = PANELS[t.id];
        return (
          <div key={t.id} role="tabpanel" id={`ecosystem-panel-${t.id}`} aria-labelledby={`ecosystem-tab-${t.id}`} hidden={t.id !== tab}>
            {(visited.has(t.id) || t.id === tab) && <Content />}
          </div>
        );
      })}
    </div>
  );
}
