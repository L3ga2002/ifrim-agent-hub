import { useState, useCallback } from "react";
import { pushToast } from "../../store.js";
import { Empty, ErrorNotice } from "../../components/ui.jsx";
import { salesHref, MATCH_STRENGTH_RO, textExcerpt } from "../../lib/salesLogic.js";
import { SalesChip, useSalesCommand, ApprovalGate, Problems } from "./common.jsx";

/** Candidates of a row (STRONG / CANDIDATE / CONFLICT) with the reasons and conflicts the Hub found. */
export function Matches({ matches = [] }) {
  if (!matches.length) return <span className="faint">—</span>;
  return (
    <ul className="plain-list small">
      {matches.slice(0, 4).map((m, i) => (
        <li key={`${m.existingId || i}`}>
          <span className={m.strength === "CONFLICT" ? "warn-text" : undefined}>{MATCH_STRENGTH_RO[m.strength] || m.strength}</span>
          {m.existingId && <> · <a href={`#${salesHref("org", { id: m.existingId })}`}>fișa</a></>}
          {Array.isArray(m.reasons) && m.reasons.length > 0 && <span className="faint"> · {m.reasons.join("; ")}</span>}
          {Array.isArray(m.conflicts) && m.conflicts.length > 0 && <span className="warn-text"> · {m.conflicts.join("; ")}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Resolution of a NEEDS_REVIEW row (POST /api/sales/import-rows/:id/resolve): new organisation, a candidate, or skip. */
export function ResolveRow({ row, onDone }) {
  const candidates = row.matches.filter((m) => m.existingId);
  const [orgId, setOrgId] = useState(candidates[0]?.existingId || "");
  const cmd = useSalesCommand(useCallback(async () => { pushToast("sales-resolve", "ok", "Rând rezolvat"); onDone?.(); }, [onDone]));
  const path = `/api/sales/import-rows/${encodeURIComponent(row.id)}/resolve`;
  return (
    <div className="stack tight">
      <div className="row wrap">
        <button type="button" className="btn sm" disabled={cmd.busy} onClick={() => cmd.run(path, { action: "create", reason: "firmă diferită (decizia ta)" })}>Firmă nouă</button>
        {candidates.length > 0 && (
          <>
            <select className="select sales-inline-select" aria-label="Firma existentă" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {candidates.map((m, i) => <option key={m.existingId} value={m.existingId}>{`${i + 1}. ${MATCH_STRENGTH_RO[m.strength] || m.strength}${Array.isArray(m.reasons) && m.reasons[0] ? ` · ${textExcerpt(m.reasons[0], 40)}` : ""}`}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={cmd.busy || !orgId} onClick={() => cmd.run(path, { action: "match", orgId, reason: "aceeași firmă (decizia ta)" })}>Leagă de existentă</button>
          </>
        )}
        <button type="button" className="btn sm ghost" disabled={cmd.busy} onClick={() => cmd.run(path, { action: "skip", reason: "sărit (decizia ta)" })}>Sari peste</button>
      </div>
      <ErrorNotice error={cmd.error} />
      <ApprovalGate gate={cmd.approval} onDone={() => { cmd.clearApproval(); onDone?.(); }} onDismiss={cmd.clearApproval} />
    </div>
  );
}

/**
 * Rows with status, normalised identity, errors, warnings and matches: preview rows (record at top level) or stored rows
 * (record under `normalized.record`), both read through importRowView. The row number is the spreadsheet row.
 */
export function RowsTable({ rows, resolvable = false, onChanged, showFile = null }) {
  if (!rows.length) return <Empty title="Niciun rând">Schimbă filtrul sau reîncarcă.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table table-mobile-cards sales-rows">
        <thead><tr><th>Rând</th><th>Stare</th><th>Firmă</th><th>Identitate</th><th>Probleme</th><th>Potriviri</th></tr></thead>
        <tbody>{rows.map((r) => {
          const rec = r.record || {};
          const fiscal = rec.fiscalCode || rec.fiscalRaw;
          return (
            <tr key={r.id || `${r.rowIndex}`}>
              <td data-label="Rând" className="mono">{r.sheetRow}{showFile && <div className="sub break">{showFile(r)}</div>}</td>
              <td data-label="Stare"><SalesChip kind="row" status={r.status} /></td>
              <td data-label="Firmă" className="break">{textExcerpt(rec.name, 120) || "—"}{rec.city ? <div className="sub">{textExcerpt(rec.city, 60)}</div> : null}
                {r.orgId && <div className="sub"><a href={`#${salesHref("org", { id: r.orgId })}`}>Fișa firmei</a></div>}</td>
              <td data-label="Identitate" className="small break">
                {fiscal ? <div>CUI <span className="mono">{textExcerpt(fiscal, 20)}</span>{rec.fiscalCodeValid === false ? " (invalid)" : rec.fiscalCodeValid === true ? " (valid)" : ""}</div> : <div className="faint">fără CUI</div>}
                {(rec.domain || rec.website) && <div className="mono">{textExcerpt(rec.domain || rec.website, 60)}</div>}
              </td>
              <td data-label="Probleme"><Problems errors={r.errors} warnings={r.warnings} />{!r.errors.length && !r.warnings.length && <span className="faint">—</span>}</td>
              <td data-label="Potriviri"><Matches matches={r.matches} />{resolvable && r.status === "NEEDS_REVIEW" && r.id && <div style={{ marginTop: 6 }}><ResolveRow row={r} onDone={onChanged} /></div>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
