import { useState } from "react";
import { ClipboardList, Play, Check, Undo2 } from "lucide-react";
import { api } from "../../api.js";
import { useAction, useResource } from "../../store.js";
import { Chip, ErrorNotice, Loading, Notice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";
import { approveSales } from "../../lib/salesOwnerActions.js";
import { salesAuthorityLabel } from "../../lib/salesAuthorityLogic.js";
import { rearmRequiredOf } from "../../lib/rearmLogic.js";
import { DESK_CLASS_RO, ITEM_RO, deskDecision, deskNext, deskOverview, deskReload, deskTone, exportWordText, latestArtifact, latestExport } from "../../lib/deskLogic.js";
import { OpsPlanCard } from "./OpsPlanCard.jsx";

/**
 * M13 „Birou intern” in the one L3ga screen: the newest record of each flow (Operations start dossier, support case, deviz) with its state,
 * its next action, the exact document waiting for the owner („Aprob … intern” in the owner session, on the id and full SHA shown), the
 * exports (folder, manifest, Word level) and, when it stopped, ONE continuation card. Everything is read from the server (GET), so it is
 * the same after a reload. Nothing here sends, publishes, issues or starts anything.
 */
export function DeskPanel() {
  const res = useResource("/api/desk/records?limit=60", { reloadOn: deskReload });
  const sections = deskOverview(res.data?.records || []);
  return (
    <section className="panel lega-desk" aria-label="Birou intern">
      <div className="stage-title"><ClipboardList size={13} aria-hidden="true" /> Birou intern (Operations · Suport · Finance-Admin)</div>
      {res.loading && !res.data ? <Loading lines={3} /> : (
        <div className="stack">
          {sections.map((s) => (
            <div key={s.kind} className="stack tight lega-desk-section">
              <strong className="small">{s.title}{s.older ? ` · încă ${s.older} în istoric` : ""}</strong>
              {s.current ? <DeskRecord key={s.current.id} id={s.current.id} onChange={res.reload} />
                : <p className="faint small break" style={{ margin: 0 }}>Nimic încă. Spune sau scrie, de exemplu: „{s.example}”.</p>}
            </div>
          ))}
        </div>
      )}
      <ErrorNotice error={res.error} onRetry={res.reload} />
    </section>
  );
}

function DeskRecord({ id, onChange }) {
  const res = useResource(`/api/desk/records/${encodeURIComponent(id)}`, { reloadOn: deskReload });
  const d = res.data;
  if (res.loading && !d) return <Loading lines={2} />;
  if (!d) return <ErrorNotice error={res.error} onRetry={res.reload} />;
  const r = d.record;
  const reload = () => { res.reload(); onChange?.(); };
  return (
    <article className="stack tight lega-desk-record" aria-label={`${r.departmentTitle} ${r.internalNo}`}>
      <div className="row wrap"><Chip tone={deskTone(r.status)}>{r.statusText}</Chip><strong className="break">{r.internalNo} · {r.title}</strong><Chip tone="neutral">SINTETIC</Chip></div>
      <p className="small break" style={{ margin: 0 }}><strong>Următoarea acțiune:</strong> {deskNext(d)}</p>
      <p className="faint small break" style={{ margin: 0 }}>Responsabil: {r.owner}{r.authority ? ` · cardul confirmat ca ${r.authority === "local_dev_profile" ? "profil local de dezvoltare" : "Windows Hello"}` : ""}{d.inputsCurrent === false ? " · intrările s-au schimbat (depășit)" : ""}</p>
      {r.kind === "ops_start" && <OpsState record={r} onChange={reload} />}
      {r.kind === "support_case" && <SupportState record={r} detail={d} />}
      {r.kind === "finance_doc" && <FinanceState detail={d} />}
      <Decision detail={d} onChange={reload} />
      <Exports detail={d} />
      <Continue detail={d} onChange={reload} />
    </article>
  );
}

function OpsState({ record, onChange }) {
  const s = record.state || {};
  const [error, setError] = useState(null);
  const canUpdate = ["READY", "STALE"].includes(record.status);
  const mark = useAction(async (itemId, status) => {
    setError(null);
    try { await withReauth(() => api(`/api/desk/records/${encodeURIComponent(record.id)}/items`, { method: "POST", body: { itemId, status } })); onChange(); }
    catch (e) { setError(e); }
  });
  if (!s.offer) return <p className="faint small" style={{ margin: 0 }}>Se pregătește din oferta aprobată (după confirmarea cardului).</p>;
  return (
    <div className="stack tight">
      <span className="faint small break">Oferta aprobată intern {s.offer.proposalId} v{s.offer.version} · SHA <code className="mono" style={{ overflowWrap: "anywhere" }}>{s.offer.contentSha}</code> · nu e acceptarea clientului</span>
      <div className="section-title">Materiale de la client (primit {s.received?.length || 0} / {s.checklist?.length || 0})</div>
      <ul className="plain-list small">{(s.checklist || []).map((i) => (
        <li key={i.id} className="row wrap">
          <Chip tone={i.status === "RECEIVED" ? "ok" : "warn"}>{ITEM_RO[i.status] || i.status}</Chip><span className="break">{i.id}. {i.text}</span>
          {canUpdate && (i.status === "RECEIVED"
            ? <button type="button" className="btn sm ghost" disabled={mark.pending} onClick={() => mark.run(i.id, "MISSING")}><Undo2 size={12} aria-hidden="true" />Marchează lipsă</button>
            : <button type="button" className="btn sm" disabled={mark.pending} onClick={() => mark.run(i.id, "RECEIVED")}><Check size={12} aria-hidden="true" />Marchează primit</button>)}
        </li>
      ))}</ul>
      {s.questions?.length > 0 && <><div className="section-title">Întrebări deschise</div><ul className="plain-list small">{s.questions.map((q, k) => <li key={k} className="break">{q.text}</li>)}</ul></>}
      {s.risks?.length > 0 && <><div className="section-title">Riscuri</div><ul className="plain-list small">{s.risks.map((x, k) => <li key={k} className="break">{x.text}</li>)}</ul></>}
      {s.deadlines?.length > 0 && <><div className="section-title">Termene</div><ul className="plain-list small">{s.deadlines.map((x, k) => <li key={k} className="break">{x.what}: {x.value}{x.status === "UNKNOWN" ? " (necunoscut)" : ""}</li>)}</ul></>}
      <ErrorNotice error={error} />
    </div>
  );
}

function SupportState({ record, detail }) {
  const s = record.state || {};
  const a = latestArtifact(detail);
  return (
    <div className="stack tight">
      <span className="small break">Cererea (sintetică): „{record.request}”</span>
      {s.classification && <span className="faint small break">Clasificare: {DESK_CLASS_RO[s.classification.class] || s.classification.class} — regula: {s.classification.rule}</span>}
      {s.sources?.delivery && <span className="faint small break">Surse (doar citire): pachetul acceptat {s.sources.delivery.bundleId} · {s.sources.criteria?.length || 0} criterii verificate · proiectul {s.sources.project?.name}</span>}
      {s.caseStatusText && <span className="faint small break">Cazul: {s.caseStatusText}</span>}
      {a && <div className="stack tight"><div className="section-title">Răspunsul v{a.version} · {a.status === "APPROVED_INTERNAL" ? "aprobat intern, NETRIMIS" : a.status === "DRAFT" ? "ciornă, NETRIMIS" : a.status}</div>
        <div className="prewrap small sales-draft-body">{a.content?.body}</div></div>}
      {s.specDraft && <span className="faint small break">Propunere de corecție SPEC_DRAFT (text, necreată în Fabrică, nepornită): {s.specDraft.title}</span>}
    </div>
  );
}

function FinanceState({ detail }) {
  const a = latestArtifact(detail);
  if (!a) return <p className="faint small" style={{ margin: 0 }}>Devizul se pregătește din oferta aprobată (după confirmarea cardului).</p>;
  const c = a.content || {};
  return (
    <div className="stack tight">
      <span className="faint small break">{c.docType} {c.internalNo} (număr intern, nu fiscal) · v{a.version} · {a.status === "APPROVED_INTERNAL" ? "aprobat intern" : a.status === "DRAFT" ? "ciornă" : a.status} · din oferta {c.source?.proposalId} v{c.source?.version}</span>
      <div className="table-wrap"><table className="table small"><thead><tr><th>Serviciu</th><th>Preț unitar</th><th>Termen</th><th>Valoare</th></tr></thead>
        <tbody>{(c.lines || []).map((l) => <tr key={l.no}><td className="break">{l.service}</td><td>{l.unitPrice?.text}</td><td>{l.term?.text}</td><td>{l.lineTotal?.text}</td></tr>)}</tbody></table></div>
      <span className="small">Total: {c.total?.text} <span className="faint">({c.total?.reason})</span></span>
    </div>
  );
}

function Decision({ detail, onChange }) {
  const dec = deskDecision(detail);
  const owner = useResource(dec.ok ? "/api/owner/status" : null, { reloadOn: (e) => e.type.startsWith("owner.") });
  const action = useAction(async () => { await approveSales({ path: dec.path, body: { displayedSha: dec.sha } }); onChange(); });
  if (!dec.ok) return dec.reason ? <p className="faint small" style={{ margin: 0 }}>{dec.reason}</p> : null;
  return (
    <div className="stack tight lega-desk-decision">
      <strong>Ținta exactă: documentul v{dec.version}</strong>
      <code className="mono break" style={{ overflowWrap: "anywhere" }}>{dec.artifactId}</code>
      <code className="mono break" style={{ overflowWrap: "anywhere" }}>{dec.sha}</code>
      <p className="faint small" style={{ margin: 0 }}>{salesAuthorityLabel(owner.data?.session)} {dec.says}</p>
      <div><button type="button" className="btn approve sm" disabled={action.pending} onClick={action.run}>{action.pending ? "Se aprobă…" : dec.label}</button></div>
      <ErrorNotice error={action.error} />
    </div>
  );
}

function Exports({ detail }) {
  const list = Array.isArray(detail?.exports) ? detail.exports : [];
  if (!list.length) return null;
  const x = latestExport(detail);
  return (
    <div className="stack tight">
      <div className="section-title">Export (revizia {x.revision}, {x.status === "READY" ? "curent" : x.status})</div>
      <span className="faint small break">Folderul: {x.folderName} · {x.files?.length || 0} fișiere · manifest SHA <code className="mono" style={{ overflowWrap: "anywhere" }}>{x.manifestSha256 || "—"}</code></span>
      {exportWordText(x) && <span className="faint small break">{exportWordText(x)}</span>}
      {list.length > 1 && <span className="faint small">Revizii anterioare păstrate: {list.slice(1).map((e) => `${e.revision} (${e.status})`).join(", ")}</span>}
    </div>
  );
}

function Continue({ detail, onChange }) {
  const [card, setCard] = useState(null);
  const [rearm, setRearm] = useState(null);
  const ask = useAction(async () => {
    setRearm(null);
    try { const out = await withReauth(() => api(`/api/desk/records/${encodeURIComponent(detail.record.id)}/continue`, { method: "POST", body: {} })); setCard(out?.plan || null); onChange(); }
    catch (e) { const need = rearmRequiredOf(e); if (!need) throw e; setRearm(need.reason); }
  });
  if (card) return <OpsPlanCard plan={card} card={{ type: "OpsPlan", size: "l" }} onClose={() => { setCard(null); onChange(); }} />;
  if (!detail.continuable) return null;
  return (
    <div className="stack tight">
      {rearm && <Notice tone="warn" title="Întâi redeschiderea porții">{rearm}</Notice>}
      <div><button type="button" className="btn primary sm" disabled={ask.pending || detail.waitsForRearm} onClick={() => ask.run()}><Play size={14} aria-hidden="true" />{ask.pending ? "Pregătesc cardul…" : "Pregătește continuarea"}</button></div>
      <ErrorNotice error={ask.error} />
    </div>
  );
}
