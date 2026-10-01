import { useState, useRef, useMemo } from "react";
import { Upload, FileSpreadsheet, Table, ListChecks, RotateCcw, X, CheckCircle2 } from "lucide-react";
import { api, uploadWithProgress, fmt } from "../../api.js";
import { useAction, pushToast } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice } from "../../components/ui.jsx";
import {
  batchView, importRowView, listOf, pagedOf, countEntries, batchCounts, validateImportFile, fileToBase64, MAPPING_FIELDS, initialMapping, validateMapping,
  mappingFieldLabel, columnSamples, approvalFrom, salesHref, pageInfo,
} from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource, useSalesCommand, ApprovalGate, SalesError, Pager, Problems, Tile, when } from "./common.jsx";
import { RowsTable } from "./ImportRows.jsx";

// Batch life cycle on the Hub: UPLOADED → MAPPED → PREVIEWED → IMPORTING (chunks, resumable) → IMPORTED → ROLLED_BACK.
const EDITABLE = new Set(["UPLOADED", "MAPPED", "PREVIEWED"]);
const ROW_FILTERS = [["", "Toate"], ["NEEDS_REVIEW", "De revizuit"], ["INVALID", "Invalide"], ["DUPLICATE_IN_FILE", "Duplicate în fișier"], ["SUPPRESSED", "Suprimate"],
  ["CREATED", "Create"], ["MATCHED", "Potrivite"], ["SKIPPED", "Sărite"], ["PENDING", "Neprocesate încă"]];
/** Upper bound of confirm calls in one click: each call imports one chunk (the Hub's default, 500 rows); 100 chunks cover the 50,000-row limit. */
const MAX_CONFIRM_CALLS = 100;

/** Upload: the file's bytes go to the local Hub as base64 (no disk path is ever sent); progress and cancel. */
function UploadPanel({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [synthetic, setSynthetic] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | reading | uploading
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [gate, setGate] = useState(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const check = file ? validateImportFile(file) : null;

  async function start() {
    if (!file || !check?.ok || phase !== "idle") return;
    setError(null); setGate(null); setPhase("reading");
    try {
      const contentBase64 = await fileToBase64(file);
      setPhase("uploading"); setProgress(0);
      const upload = uploadWithProgress("/api/sales/imports", { fileName: file.name, contentBase64, synthetic }, setProgress);
      abortRef.current = upload.abort;
      const result = await upload.promise;
      const pendingApproval = approvalFrom(result);
      if (pendingApproval) { setGate(pendingApproval); return; }
      const batch = batchView(result?.batch ?? result);
      setFile(null); if (inputRef.current) inputRef.current.value = "";
      // The same file again (same SHA-256) returns the open batch instead of a second copy of the rows.
      if (result?.existing) pushToast("sales-import", "info", "Fișierul a mai fost încărcat: am deschis lotul existent (rândurile nu se dublează).");
      else pushToast("sales-import", "ok", `Fișier încărcat${batch.rowCount ? `: ${batch.rowCount} rânduri` : ""}. Verifică maparea coloanelor.`);
      onUploaded(batch);
    } catch (e) {
      if (e?.name === "AbortError") pushToast("sales-import", "warn", "Încărcarea a fost anulată.");
      else setError(e);
    } finally {
      abortRef.current = null; setPhase("idle"); setProgress(0);
    }
  }

  return (
    <Panel title="Import nou" icon={Upload}>
      <div className="stack">
        <div className="sales-upload">
          <label className="field grow">
            <span>Fișier CSV, TSV sau XLSX (cel mult 20 MB)</span>
            <input ref={inputRef} className="input" type="file" accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={phase !== "idle"} onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }} />
          </label>
          <label className="check"><input type="checkbox" checked={synthetic} disabled={phase !== "idle"} onChange={(e) => setSynthetic(e.target.checked)} />Date sintetice (fictive, pentru test)</label>
        </div>
        {file && check && !check.ok && <Notice tone="error">{check.reason}</Notice>}
        {file && check?.ok && <p className="faint small" style={{ margin: 0 }}>{file.name} · {fmt.bytes(file.size)} · {check.kind.toUpperCase()}. Formulele nu se evaluează și macro-urile nu se rulează; valorile rămân text exact.</p>}
        {phase !== "idle" && (
          <div className="sales-progress" role="progressbar" aria-label="Încărcare" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span className="bar"><i style={{ width: `${phase === "reading" ? 3 : Math.max(3, Math.round(progress * 100))}%` }} /></span>
            <span className="small faint">{phase === "reading" ? "Se citește fișierul…" : progress >= 1 ? "Hub-ul analizează fișierul…" : `${Math.round(progress * 100)}%`}</span>
          </div>
        )}
        <div className="row wrap">
          <button type="button" className="btn primary" disabled={!file || !check?.ok || phase !== "idle"} onClick={start}><Upload size={15} aria-hidden="true" />{phase === "idle" ? "Încarcă și analizează" : "Se încarcă…"}</button>
          {phase === "uploading" && <button type="button" className="btn ghost" onClick={() => abortRef.current?.()}><X size={15} aria-hidden="true" />Anulează</button>}
        </div>
        <ErrorNotice error={error} />
        <ApprovalGate gate={gate} onDone={() => setGate(null)} onDismiss={() => setGate(null)} />
      </div>
    </Panel>
  );
}

/** Column → field mapping by column index (as the Hub stores it), with sample values; saving it runs the preview in the same click. */
function MappingStep({ batch, sampleRows, onPreview }) {
  const [mapping, setMapping] = useState(() => initialMapping(batch.headers, batch.mapping, batch.suggested));
  const [gate, setGate] = useState(null);
  const check = validateMapping(mapping, batch.headers);
  const samples = useMemo(() => columnSamples(sampleRows, batch.headers), [sampleRows, batch.headers]);
  const base = `/api/sales/imports/${encodeURIComponent(batch.id)}`;
  const run = useAction(async () => {
    const saved = await api(`${base}/mapping`, { method: "POST", body: { mapping } });
    const g1 = approvalFrom(saved); if (g1) { setGate(g1); return; }
    const preview = await api(`${base}/preview`, { method: "POST", body: {} });
    const g2 = approvalFrom(preview); if (g2) { setGate(g2); return; }
    onPreview(preview);
  });
  if (!batch.headers.length) return <Notice tone="warn" title="Fără antet">Hub-ul nu a găsit un rând de antet în fișier. Verifică fișierul și încarcă-l din nou.</Notice>;
  return (
    <div className="stack">
      {batch.sheets.length > 1 && <p className="faint small" style={{ margin: 0 }}>Fișierul are {batch.sheets.length} foi; se importă foaia „{batch.sheet || batch.sheets[0]}”. Pentru altă foaie, salveaz-o separat și încarc-o.</p>}
      <div className="table-wrap">
        <table className="table table-mobile-cards sales-mapping">
          <thead><tr><th>Coloana din fișier</th><th>Exemple</th><th>Câmp în Hub</th></tr></thead>
          <tbody>{batch.headers.map((h, i) => {
            const key = String(i);
            const suggestion = batch.suggested[key] ?? batch.suggested[h];
            return (
              <tr key={key}>
                <td data-label="Coloana"><strong className="break">{h || `(coloana ${i + 1} fără nume)`}</strong>{suggestion && suggestion !== "ignore" && <div className="sub">sugestie: {mappingFieldLabel(suggestion)}</div>}</td>
                <td data-label="Exemple" className="faint small break">{samples[key]?.length ? samples[key].join(" · ") : "—"}</td>
                <td data-label="Câmp">
                  <select className="select" aria-label={`Câmpul pentru coloana ${h || i + 1}`} value={mapping[key] || "ignore"} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}>
                    {MAPPING_FIELDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <Problems errors={check.errors} warnings={check.warnings} />
      <div className="row wrap">
        <button type="button" className="btn primary" disabled={!check.ok || run.pending} onClick={run.run}><Table size={15} aria-hidden="true" />{run.pending ? "Se previzualizează…" : "Salvează maparea și previzualizează"}</button>
        <span className="faint small">Nimic nu se importă la acest pas.</span>
      </div>
      <ErrorNotice error={run.error} />
      <ApprovalGate gate={gate} onDone={() => setGate(null)} onDismiss={() => setGate(null)} />
    </div>
  );
}

/** Rollback: first the preview of what would be archived/kept, then an ALWAYS_ASK request decided on the approval card. */
function Rollback({ batch, onDone }) {
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState("");
  const base = `/api/sales/imports/${encodeURIComponent(batch.id)}`;
  const look = useAction(async () => setPreview(await api(`${base}/rollback-preview`, { method: "POST", body: {} })));
  const cmd = useSalesCommand(async () => { pushToast("sales-rollback", "ok", "Rollback executat"); setPreview(null); setReason(""); onDone(); });
  const removable = listOf(preview, "removable");
  const conflicts = listOf(preview, "conflicts");
  return (
    <Panel title="Rollback" icon={RotateCcw}>
      <div className="stack tight">
        <p className="muted small" style={{ margin: 0 }}>Rollback-ul arhivează firmele create de acest lot (nu șterge nimic definitiv). Firmele editate după import, cu oportunități, audituri sau date din alte loturi se păstrează. Cere aprobarea ta de fiecare dată.</p>
        <div><button type="button" className="btn sm" disabled={look.pending} onClick={look.run}>{look.pending ? "Se calculează…" : "Vezi ce s-ar anula"}</button></div>
        <ErrorNotice error={look.error} />
        {preview && (
          <div className="stack tight">
            <dl className="stat-tiles">
              <Tile label="se arhivează" value={removable.length} />
              <Tile label="se păstrează" value={conflicts.length} tone={conflicts.length ? "attention" : ""} />
              <Tile label="contacte adăugate la firme existente" value={Number(preview.matchedContacts) || 0} />
            </dl>
            {[["Firme care se arhivează", removable], ["Firme păstrate (atinse după import)", conflicts]].filter(([, items]) => items.length).map(([title, items]) => (
              <div key={title}>
                <div className="section-title">{title} ({items.length})</div>
                <ul className="plain-list small">{items.slice(0, 20).map((it, i) => <li key={it.orgId || i} className="break">{it.name || it.orgId || "—"}{Array.isArray(it.reasons) && it.reasons.length ? <span className="faint"> — {it.reasons.join("; ")}</span> : null}</li>)}</ul>
                {items.length > 20 && <div className="faint small">… și încă {items.length - 20}</div>}
              </div>
            ))}
            {preview.note && <p className="faint small" style={{ margin: 0 }}>{preview.note}</p>}
            <label className="field"><span>Motivul rollback-ului (opțional, se păstrează la lot)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <div><button type="button" className="btn danger" disabled={cmd.busy || !removable.length} onClick={() => cmd.run(`${base}/rollback`, reason.trim() ? { reason: reason.trim() } : {})}>{cmd.busy ? "Se cere…" : "Cere rollback-ul"}</button></div>
          </div>
        )}
        <ErrorNotice error={cmd.error} />
        <ApprovalGate gate={cmd.approval} onDone={() => { cmd.clearApproval(); setPreview(null); onDone(); }} onDismiss={cmd.clearApproval} />
      </div>
    </Panel>
  );
}

/** One batch: mapping → preview → confirm; afterwards the stored rows with review actions and the rollback. */
function BatchDetail({ id, onClose, onChanged }) {
  const [rowStatus, setRowStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState(null);
  const qs = new URLSearchParams({ ...(rowStatus ? { status: rowStatus } : {}), offset: String(offset), limit: "50" }).toString();
  const res = useSalesResource(`/api/sales/imports/${encodeURIComponent(id)}?${qs}`);
  // Confirm imports in chunks until the Hub answers done (idempotent and resumable: a repeated call never doubles a company).
  const confirm = useAction(async () => {
    let result = null;
    for (let i = 0; i < MAX_CONFIRM_CALLS; i += 1) {
      result = await api(`/api/sales/imports/${encodeURIComponent(id)}/confirm`, { method: "POST", body: {} });
      setProgress(countEntries(result?.summary));
      if (result?.done) break;
    }
    const counts = countEntries(result?.summary);
    if (result?.done) pushToast("sales-confirm", "ok", `Import confirmat${counts.length ? `: ${counts.map((c) => `${c.value} ${c.label}`).join(", ")}` : ""}`);
    else pushToast("sales-confirm", "warn", "Importul nu s-a terminat încă; apasă din nou „Continuă importul” (rândurile procesate nu se repetă).");
    setPreview(null); setProgress(null); res.reload(); onChanged();
  });
  if (res.loading && !res.data) return <Panel title="Lot de import" icon={FileSpreadsheet}><Loading lines={4} /></Panel>;
  if (res.error && !res.data) return <Panel title="Lot de import" icon={FileSpreadsheet}><SalesError error={res.error} onRetry={res.reload} what="lotul de import" /></Panel>;
  const batch = batchView(res.data?.batch);
  const page = pagedOf(res.data, "rows");
  const rows = page.items.map(importRowView);
  const editable = EDITABLE.has(batch.status);
  const imported = batch.status === "IMPORTED";
  const resumable = batch.status === "IMPORTING";
  const previewRows = listOf(preview, "rows").map(importRowView);
  const summary = countEntries(preview?.summary);
  const counts = batchCounts(batch);
  const step = imported || batch.status === "ROLLED_BACK" ? 3 : resumable || preview || batch.status === "PREVIEWED" ? 2 : 1;
  const reloadAll = () => { res.reload(); onChanged(); };
  return (
    <div className="stack">
      <Panel title={batch.fileName || "Lot de import"} icon={FileSpreadsheet} actions={<button type="button" className="btn sm ghost" onClick={onClose}><X size={14} aria-hidden="true" />Închide</button>}>
        <div className="stack">
          <div className="row wrap"><SalesChip kind="batch" status={batch.status} />{batch.synthetic && <SyntheticTag />}<span className="faint small">{batch.rowCount} rânduri · {batch.fileKind || "—"}{batch.encoding ? ` · ${batch.encoding}` : ""}{batch.delimiter ? ` · separator „${batch.delimiter === "\t" ? "TAB" : batch.delimiter}”` : ""} · {when(batch.createdAt)}</span></div>
          <ol className="sales-steps" aria-label="Pașii importului">
            {["Mapare", "Previzualizare", "Import"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "done" : step === i + 1 ? "current" : ""}>{step > i + 1 && <CheckCircle2 size={13} aria-hidden="true" />}{label}</li>)}
          </ol>
          {batch.warnings.length > 0 && <Problems warnings={batch.warnings} />}
          {counts.length > 0 && <dl className="stat-tiles">{counts.map((t) => <Tile key={t.key} label={t.label} value={t.value} tone={/NEEDS_REVIEW|INVALID|SUPPRESSED/.test(t.key) && t.value ? "attention" : ""} />)}</dl>}
          {editable && <MappingStep batch={batch} sampleRows={rows.slice(0, 20)} onPreview={(p) => { setPreview(p); res.reload(); }} />}
          {batch.status === "ROLLED_BACK" && <Notice tone="info">Lotul a fost anulat (rollback) {when(batch.rolledBackAt)}: firmele neatinse create de el sunt arhivate, nu șterse, iar dovezile lui nu se mai folosesc.{batch.counts?.rollback?.reason ? ` Motiv: ${batch.counts.rollback.reason}` : ""}</Notice>}
        </div>
      </Panel>

      {preview && (
        <Panel title={`Previzualizare (primele ${previewRows.length} rânduri)`} icon={Table}>
          <div className="stack">
            {summary.length > 0 && <dl className="stat-tiles">{summary.map((t) => <Tile key={t.key} label={t.label} value={t.value} tone={/INVALID|NEEDS_REVIEW|SUPPRESSED/.test(t.key) && t.value ? "attention" : ""} />)}</dl>}
            <RowsTable rows={previewRows} />
          </div>
        </Panel>
      )}

      {((editable && (preview || batch.status === "PREVIEWED")) || resumable) && (
        <Panel title={resumable ? "Import întrerupt" : "Confirmă importul"} icon={ListChecks}>
          <div className="stack tight">
            <p className="muted small" style={{ margin: 0 }}>{resumable ? "O parte din rânduri e deja importată. Reluarea continuă de unde a rămas; rândurile procesate nu se repetă." : "Se creează firmele noi, se leagă potrivirile sigure și rândurile cu dubii rămân „De revizuit”. Importul e idempotent și reluabil: o reluare nu dublează firmele. Nu se contactează nimeni."}</p>
            <div><button type="button" className="btn primary" disabled={confirm.pending} onClick={confirm.run}>{confirm.pending ? "Se importă…" : resumable ? "Continuă importul" : "Confirmă importul"}</button></div>
            {confirm.pending && progress?.length > 0 && <p className="faint small" aria-live="polite" style={{ margin: 0 }}>Până acum: {progress.map((c) => `${c.value} ${c.label}`).join(", ")}</p>}
            <ErrorNotice error={confirm.error} />
          </div>
        </Panel>
      )}

      {!editable && (
        <Panel title={`Rânduri (${page.total})`} icon={Table} actions={
          <select className="select sales-inline-select" aria-label="Filtrează rândurile" value={rowStatus} onChange={(e) => { setRowStatus(e.target.value); setOffset(0); }}>
            {ROW_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>}>
          <div className="stack tight" aria-busy={res.loading}>
            <RowsTable rows={rows} resolvable={imported || resumable} onChanged={reloadAll} />
            <Pager info={pageInfo({ total: page.total, offset, limit: 50 })} onPage={setOffset} busy={res.loading} />
          </div>
        </Panel>
      )}

      {(imported || resumable) && <Rollback batch={batch} onDone={reloadAll} />}
    </div>
  );
}

/** Importuri: upload, the batch being worked on (?batch=) and the list of batches. */
export function Imports({ query, go }) {
  const list = useSalesResource("/api/sales/imports");
  const selected = typeof query?.batch === "string" && query.batch ? query.batch.slice(0, 80) : null;
  const batches = listOf(list.data, "batches").map(batchView);
  const open = (batchId) => go(salesHref("imports", { batch: batchId }));
  return (
    <div className="stack">
      <UploadPanel onUploaded={(batch) => { list.reload(); if (batch.id) open(batch.id); }} />
      {selected && <BatchDetail key={selected} id={selected} onClose={() => go(salesHref("imports"))} onChanged={list.reload} />}
      <Panel title="Loturi de import" icon={FileSpreadsheet} flush>
        {list.loading && !list.data ? <div className="panel-body"><Loading /></div>
          : list.error && !list.data ? <div className="panel-body"><SalesError error={list.error} onRetry={list.reload} what="loturile" /></div>
          : batches.length ? (
            <ul className="list">{batches.map((b) => {
              const counts = batchCounts(b);
              return (
                <li key={b.id}>
                  <button type="button" className="list-row sales-batch-row" aria-current={selected === b.id ? "true" : undefined} onClick={() => open(b.id)}>
                    <div className="grow">
                      <div className="title break">{b.fileName || b.id}</div>
                      <div className="sub">{b.rowCount} rânduri · {when(b.createdAt)}{counts.length ? ` · ${counts.map((c) => `${c.value} ${c.label}`).join(", ")}` : ""}</div>
                    </div>
                    <span className="chips">{b.synthetic && <SyntheticTag />}<SalesChip kind="batch" status={b.status} /></span>
                  </button>
                </li>
              );
            })}</ul>
          ) : <Empty title="Niciun import">Primul lot apare aici după încărcare.</Empty>}
      </Panel>
    </div>
  );
}

