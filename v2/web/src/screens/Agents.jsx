import { useState } from "react";
import { Bot, Activity, BookOpen } from "lucide-react";
import { fmt } from "../api.js";
import { useResource } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Chip } from "../components/ui.jsx";

const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "externe", SENSITIVE_ACTIONS: "sensibile" };

export default function Agents() {
  const { data, error, loading, reload } = useResource("/api/agents", { reloadOn: (e) => e.type.startsWith("run.") });
  const skills = useResource("/api/skills");
  const [open, setOpen] = useState(null);
  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Agenți</h1><p>Rolurile configurate, execuțiile active și cele recente sunt afișate separat. Un rol nu este un proces, iar un provider autentificat nu înseamnă un task reușit.</p></div></div>
      <div className="split-main">
        <div className="stack">
          <Panel title={`Roluri configurate (${data.roles.length})`} icon={Bot} flush>
            <div className="table-wrap">
              <table className="table table-mobile-cards">
                <thead><tr><th>Rol</th><th>Departament</th><th>Raportează la</th><th>Autoritate</th><th>Preferințe model</th><th>Roluri V1</th></tr></thead>
                <tbody>{data.roles.map((r) => (
                  <tr key={r.id}>
                    <td><button className="btn sm ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}><strong>{r.name}</strong></button>
                      {open === r.id && <div className="stack tight" style={{ marginTop: 8 }}>
                        <div><div className="section-title">Responsabilități</div><ul style={{ margin: 0, paddingLeft: 18 }}>{r.responsibilities.map((x) => <li key={x}>{x}</li>)}</ul></div>
                        <div><div className="section-title">Criterii de succes</div><ul style={{ margin: 0, paddingLeft: 18 }}>{r.successCriteria.map((x) => <li key={x}>{x}</li>)}</ul></div>
                        <div className="muted">Unelte: {r.tools.join(", ")} · Memorie: {r.memoryScopes.join(", ")} · Limite: {r.limits.maxRuntimeMin} min, {r.limits.maxAttempts} încercări</div>
                      </div>}
                    </td>
                    <td>{r.department || "—"}</td>
                    <td className="muted">{r.reportsTo === "owner" ? "Cătălin (owner)" : r.reportsTo || "—"}</td>
                    <td><Chip tone={r.authority === "READ_ONLY" ? "neutral" : "info"}>{TIER_RO[r.authority]}</Chip></td>
                    <td className="muted">Codex: {r.modelHints.codex.join(" / ")} · Claude: {r.modelHints.claude.join(" / ")}</td>
                    <td className="faint">{r.legacy.length ? r.legacy.join(", ") : "nou"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Skills (format Agent Skills)" icon={BookOpen} flush>
            {skills.error ? <div className="panel-body"><ErrorNotice error={skills.error} onRetry={skills.reload} /></div> : skills.data ? <ul className="list">{skills.data.skills.map((s) => (
              <li key={s.id}><div className="list-row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div className="title">{s.id} <span className="faint mono">v{s.currentVersion} · {String(s.sha256 || "").slice(0, 10)}</span></div>
                  <div className="sub">{s.description}</div>
                  <div className="faint" style={{ fontSize: 12 }}>Roluri: {s.metadata["hub-roles"] || "—"} · Teste: {s.metadata["hub-tests"] || "—"}</div>
                  {s.validation?.warnings?.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Nu adaugă permisiuni: {s.validation.warnings.length} restricții aplicate pe roluri</div>}
                </div>
                <div className="stack tight" style={{ alignItems: "flex-end" }}><StatusChip status={s.status === "active" ? "active" : "invalidated"} label={s.status} /><Chip>{TIER_RO[s.metadata["hub-permission"]] || s.metadata["hub-permission"]}</Chip></div>
              </div></li>
            ))}</ul> : <div className="panel-body"><Loading /></div>}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Execuții active" icon={Activity} flush>
            {data.activeRuns.length ? <ul className="list">{data.activeRuns.map((r) => <li key={r.runId}><a className="list-row" href={`#/conversations/${r.conversationId}`}><span className="pulse-dot" /><span className="grow">{r.provider} · pid {r.pid}</span><StatusChip status="running" /></a></li>)}</ul>
              : <Empty title="Nicio execuție activă">Concurență maximă: 2 execuții AI independente.</Empty>}
          </Panel>
          <Panel title="Providers" flush>
            <ul className="list">{data.providers.map((p) => (
              <li key={p.id}><div className="list-row"><div className="grow"><div className="title">{p.displayName}</div><div className="sub">{p.installation ? (p.installation.installed ? p.installation.version : p.installation.reason) : "neinspectat"}{p.probedAt ? ` · verificat ${fmt.ago(p.probedAt)}` : ""}</div></div>
                <Chip tone={p.route.allowed ? "ok" : "warn"}>{p.route.allowed ? "rută verificată" : "blocat până la verificare"}</Chip></div></li>
            ))}</ul>
          </Panel>
          <Panel title="Execuții recente" flush>
            {data.recentRuns.length ? <ul className="list">{data.recentRuns.slice(0, 15).map((r) => (
              <li key={r.id}><a className="list-row" href={r.conversationId ? `#/conversations/${r.conversationId}` : "#/agents"}><div className="grow"><div className="title">{r.provider} · {r.stage}</div><div className="sub">{fmt.dateTime(r.createdAt)}{r.errorCategory ? ` · ${r.errorCategory}` : ""}</div></div><StatusChip status={r.status} /></a></li>
            ))}</ul> : <Empty title="Nicio execuție încă" />}
          </Panel>
          <Panel title="Principii"><ul style={{ margin: 0, paddingLeft: 18 }}>{data.principles.map((p) => <li key={p}>{p}</li>)}</ul></Panel>
        </div>
      </div>
    </div>
  );
}
