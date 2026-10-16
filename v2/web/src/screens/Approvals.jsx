import { useState } from "react";
import { ShieldCheck, Play } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, pushToast } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, DiffView, Notice } from "../components/ui.jsx";
import { isCommandApproval, approvedNotStarted, LOCAL_TOOL_APPROVALS } from "../lib/uiLogic.js";
import { ownerSalesKind, salesApprovalCardText, salesAuthorityLabel, salesApprovalStateText } from "../lib/salesAuthorityLogic.js";
import { approveSales } from "../lib/salesOwnerActions.js";

/** Starts an approved command; a failure is also a toast, because the card may already have left the list (SSE reload). */
async function startApproved(approval) {
  try { return await api(`/api/commands/${approval.scopeId}/execute`, { method: "POST", body: {} }); }
  catch (error) { pushToast(`start-${approval.id}`, "error", `Aprobată, dar nu a pornit: ${error.message}. O găsești în „Aprobate, încă nepornite”.`); throw error; }
}

const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare workspace", DEVELOPMENT_TOOLS: "unelte de dezvoltare", EXTERNAL_ACTIONS: "acțiuni externe", SENSITIVE_ACTIONS: "acțiuni sensibile" };

function ActionView({ approval }) {
  const p = approval.payload || {};
  if (p.command) return <pre className="pre">{typeof p.command === "string" ? p.command : JSON.stringify(p.command, null, 2)}</pre>;
  if (p.changes) {
    const text = Array.isArray(p.changes) ? p.changes.map((c) => c.diff || c.unified_diff || JSON.stringify(c)).join("\n") : typeof p.changes === "string" ? p.changes : JSON.stringify(p.changes, null, 2);
    return <DiffView diff={text} />;
  }
  return <pre className="pre">{JSON.stringify(p, null, 2)}</pre>;
}

export function ApprovalCard({ approval, onDone }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const commandScoped = isCommandApproval(approval);
  const reserved = ownerSalesKind(approval);
  const owner = useResource(reserved ? "/api/owner/status" : null, { reloadOn: e => e.type.startsWith("owner.") });
  // For a proposed command, approving IS the order to run it: one click decides and starts it (found live on 2026-09-30:
  // after "Aprobă" the card left the pending list, the separate start button was never seen and nothing ran).
  const decide = useAction(async (decision) => {
    if (reserved) { await approveSales({ approval, decision, note }); onDone(); return; }
    await api(`/api/approvals/${approval.id}/decide`, { method: "POST", body: { decision, displayedHash: approval.payloadHash, note } });
    if (decision === "approved" && commandScoped) await startApproved(approval);
    onDone();
  });
  const execute = useAction(async () => { setResult(await api(`/api/approvals/${approval.id}/execute`, { method: "POST", body: {} })); onDone(); });
  const runCommand = useAction(async () => { await (reserved ? approveSales({ approval }) : startApproved(approval)); onDone(); });
  const expired = new Date(approval.expiresAt) <= new Date();
  return (
    <Panel className={approval.status === "pending" ? "accent-approval" : ""} title={approval.actionKind} icon={ShieldCheck} actions={<StatusChip status={expired && approval.status === "pending" ? "expired" : approval.status} />}>
      <div className="stack">
        <dl className="kv">
          <dt>Țintă</dt><dd className="mono">{approval.target}</dd>
          <dt>Permisiune</dt><dd>{TIER_RO[approval.permissionTier] || approval.permissionTier}</dd>
          <dt>Scope</dt><dd className="mono">{approval.scopeType}:{approval.scopeId}</dd>
          <dt>Versiune cod</dt><dd className="mono">{String(approval.codeVersion).slice(0, 12)}</dd>
          <dt>Cerut de</dt><dd>{approval.requestedBy} · {fmt.dateTime(approval.createdAt)}</dd>
          <dt>Expiră</dt><dd>{fmt.dateTime(approval.expiresAt)}</dd>
          <dt>Amprentă</dt><dd className="mono">{approval.payloadHash.slice(0, 16)}…</dd>
          {approval.decisionNote && <><dt>Notă</dt><dd>{approval.decisionNote}</dd></>}
        </dl>
        <ActionView approval={approval} />
        {reserved && (salesApprovalStateText(approval)
          ? <Notice tone="warn" title="Cere din nou aprobarea">{salesApprovalStateText(approval)}</Notice>
          : <Notice tone="info" title={salesApprovalCardText(approval)}>{salesAuthorityLabel(owner.data?.session)}</Notice>)}
        {approval.status === "pending" && !expired && (
          <>
            <label className="field"><span>Notă (obligatorie la respingere)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
            <div className="row wrap">
              <button className="btn approve" disabled={decide.pending} onClick={() => decide.run("approved")}>{decide.pending ? "Se pornește…" : reserved ? "Aprob intern" : commandScoped ? "Aprobă și pornește" : "Aprobă exact această acțiune"}</button>
              <button className="btn danger" disabled={decide.pending || note.trim().length < 3} onClick={() => decide.run("rejected")}>Respinge</button>
            </div>
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>Aprobarea este legată de amprenta de mai sus. Dacă acțiunea, ținta, versiunea sau scope-ul se schimbă, aprobarea devine invalidă.</p>
          </>
        )}
        {approval.status === "approved" && LOCAL_TOOL_APPROVALS.includes(approval.actionKind) && !expired && (
          <div className="row"><button className="btn primary" disabled={execute.pending} onClick={execute.run}><Play size={14} />{execute.pending ? "Rulează…" : approval.actionKind === "browser.inspect" ? "Rulează verificarea aprobată" : "Rulează comanda aprobată"}</button></div>
        )}
        {approval.status === "approved" && commandScoped && !expired && (
          <div className="row"><button className="btn primary" disabled={runCommand.pending} onClick={runCommand.run}><Play size={14} />{runCommand.pending ? "Pornește…" : "Pornește acum"}</button></div>
        )}
        {result && result.exitCode !== undefined && <Notice tone={result.exitCode === 0 ? "info" : "error"} title={`Cod ieșire ${result.exitCode}, ${Math.round(result.durationMs / 1000)} s`}><pre className="pre">{(result.outputTail || []).slice(-40).join("\n")}</pre></Notice>}
        {result && result.exitCode === undefined && <Notice tone="info" title={`Pagina a răspuns ${result.status ?? "?"} în ${Math.round((result.durationMs || 0) / 1000)} s`}>{result.title || result.url}{result.network?.blockedCount ? ` · ${result.network.blockedCount} cereri blocate` : ""}</Notice>}
        <ErrorNotice error={decide.error || execute.error || runCommand.error} />
      </div>
    </Panel>
  );
}

export default function Approvals() {
  const [filter, setFilter] = useState("pending");
  const { data, error, loading, reload } = useResource(`/api/approvals${filter === "all" ? "" : `?status=${filter}`}`, { reloadOn: (e) => e.type.startsWith("approval."), deps: [filter] });
  const list = data?.approvals || [];
  // Approved but never started (e.g. approved before one-click start existed, or the start failed): shown next to the
  // pending ones, so an approved action can never silently stay unexecuted.
  const approvedRes = useResource(filter === "pending" ? "/api/approvals?status=approved" : null, { reloadOn: (e) => e.type.startsWith("approval.") || e.type.startsWith("command."), deps: [filter] });
  const waitingStart = filter === "pending" ? approvedNotStarted(approvedRes.data?.approvals || []) : [];
  const reloadAll = () => { reload(); approvedRes.reload(); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Aprobări</h1><p>Acțiunea exactă, ținta, diff-ul sau comanda și expirarea. Vocea și automatizările nu pot aproba.</p></div>
        <div className="seg" role="group" aria-label="Filtru">
          {[["pending", "În așteptare"], ["approved", "Aprobate"], ["all", "Toate"]].map(([k, v]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{v}</button>)}
        </div>
      </div>
      <div data-lega-target="approvals-list">
        {waitingStart.length > 0 && (
          <div className="stack" style={{ marginBottom: 16 }}>
            <Notice tone="warn" title="Aprobate, încă nepornite">Le-ai aprobat, dar nu au pornit. Apasă „Pornește acum” sau lasă-le să expire.</Notice>
            <div className="grid two">{waitingStart.map((a) => <ApprovalCard key={a.id} approval={a} onDone={reloadAll} />)}</div>
          </div>
        )}
        {loading ? <Loading lines={4} /> : error ? <ErrorNotice error={error} onRetry={reload} /> : list.length ? (
          <div className="grid two">{list.map((a) => <ApprovalCard key={a.id} approval={a} onDone={reloadAll} />)}</div>
        ) : <Panel><Empty title={filter === "pending" ? "Nimic nu așteaptă aprobarea ta" : "Nicio aprobare"}>Cererile apar când un provider cere o comandă sau o modificare, sau când pregătești o comandă locală.</Empty></Panel>}
      </div>
    </div>
  );
}
