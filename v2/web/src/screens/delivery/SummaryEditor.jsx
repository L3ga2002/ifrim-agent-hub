import { useEffect, useState } from "react";
import { FileText, Pencil, Save, Undo2, Link2, ExternalLink } from "lucide-react";
import { usePref } from "../../store.js";
import { Panel, Chip, Notice, ErrorNotice, Empty, Loading } from "../../components/ui.jsx";
import { Markdown } from "../../components/Markdown.jsx";
import { summaryView, summaryDiff, summaryEditBody, bindableServices, assertedFacts, sessionLabel, sessionGate, sentence, NOT_CONFIGURED_TEXT, SUMMARY_LIMITS } from "../../lib/deliveryLogic.js";
import { DecisionAction, decisionRowFor } from "./DecisionsPanel.jsx";

const DIFF_MARK = { same: " ", del: "−", add: "+" };

/** One section: its heading, where the text comes from, and either the text (safe Markdown) or its editor. */
function Section({ section, draft, editing, disabled, onEdit, onChange, onDiscard }) {
  const value = draft ?? section.text;
  const facts = editing ? assertedFacts(value) : [];
  const helpId = `livrare-sectiune-${section.id}-ajutor`;
  return (
    <li className={`delivery-summary-section${editing ? " is-editing" : ""}`} data-section={section.id}>
      <div className="row wrap between">
        <h3 className="delivery-h3" id={`livrare-sectiune-${section.id}`}>{section.heading}</h3>
        <span className="row wrap">
          <Chip tone={section.source === "owner" ? "info" : "neutral"}>sursă: {section.sourceLabel}</Chip>
          {section.needsReview && <Chip tone="warn">de revăzut: baza s-a schimbat</Chip>}
          {section.notConfigured && <Chip tone="approval">{NOT_CONFIGURED_TEXT}</Chip>}
          {section.editable && !editing && <button type="button" className="btn sm" disabled={disabled} onClick={onEdit} aria-label={`Editează secțiunea ${section.heading}`}><Pencil size={13} aria-hidden="true" />Editează</button>}
        </span>
      </div>
      {editing ? (
        <div className="stack tight">
          <label className="field"><span className="sr-only">Textul secțiunii {section.heading}</span>
            <textarea className="textarea" rows={Math.min(12, Math.max(3, value.split("\n").length + 1))} maxLength={SUMMARY_LIMITS.sectionMax} value={value} aria-describedby={helpId} onChange={(e) => onChange(e.target.value)} />
          </label>
          <p id={helpId} className="faint small">
            {value.length}/{SUMMARY_LIMITS.sectionMax} caractere. Salvarea creează o versiune nouă; cea de acum rămâne păstrată.
            {facts.length > 0 && ` Textul conține ${facts.join(", ")}: rămâne textul tău și apare la „De verificat”.`}
          </p>
          <div className="row wrap"><button type="button" className="btn sm ghost" onClick={onDiscard}><Undo2 size={13} aria-hidden="true" />Renunță la această secțiune</button></div>
        </div>
      ) : <div className="delivery-summary-text"><Markdown text={section.text} /></div>}
      {section.auto && <p className="faint small">{section.autoNote}</p>}
      {section.notConfigured && section.id === "price_terms" && <p className="faint small">Prețul și termenul vin doar dintr-un serviciu configurat în catalog sau din textul tău; Hub-ul nu le inventează.</p>}
    </li>
  );
}

/** „Leagă un serviciu din catalog”: only services with something CONFIGURED; binding creates a new summary version. */
function ServiceBinder({ room, disabled }) {
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  // The catalog is read only when the owner opens this block (and again on „Reîncearcă”); a late answer after closing is ignored.
  const [list, setList] = useState({ data: null, error: null, loading: false });
  const [attempt, setAttempt] = useState(0);
  const { client } = room;
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setList((s) => ({ ...s, loading: true, error: null }));
    client.services().then((data) => { if (alive) setList({ data, error: null, loading: false }); }, (error) => { if (alive) setList((s) => ({ ...s, error, loading: false })); });
    return () => { alive = false; };
  }, [open, attempt, client]);
  const services = list.data ? bindableServices(list.data) : [];
  const chosen = services.find((s) => s.id === serviceId && s.bindable) || null;
  const gate = sessionGate(room.session);
  const bind = async () => {
    const out = await room.run("summary-service", () => room.client.act(room.id, "summaryService", { serviceId: chosen.id, serviceVersion: chosen.version }),
      { owner: true, toast: "Serviciul a fost legat: rezumatul are o versiune nouă" });
    if (out !== undefined) setServiceId("");
  };
  return (
    <details className="studio-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><Link2 size={13} aria-hidden="true" /> Leagă un serviciu din catalog (preț și termen configurate)</summary>
      <div className="stack tight">
        {list.loading && !list.data ? <Loading lines={2} /> : list.error && !list.data ? <ErrorNotice error={list.error} onRetry={() => setAttempt((n) => n + 1)} />
          : !list.data ? <Loading lines={2} />
          : !services.length ? <p className="small">Catalogul nu are servicii active. <a href="#/sales?tab=services">Adaugă unul în Vânzări → Servicii</a>; până atunci rezumatul spune „{NOT_CONFIGURED_TEXT}”.</p> : (
            <>
              <label className="field"><span>Serviciul</span>
                <select className="select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  <option value="">— alege —</option>
                  {services.map((s) => <option key={s.id} value={s.id} disabled={!s.bindable}>{s.label}{s.bindable ? "" : ` — ${s.reason}`}</option>)}
                </select>
              </label>
              <div className="row wrap">
                <button type="button" className="btn sm primary" disabled={disabled || !chosen || gate.blocked} onClick={bind}>{room.busy === "summary-service" ? "Se leagă…" : sessionLabel("Leagă serviciul (versiune nouă)", room.session)}</button>
                {gate.blocked && <span className="small delivery-reason">{gate.reason}</span>}
              </div>
              <p className="faint small">Rezumatul preia doar câmpurile configurate ale serviciului (ce include, ce nu include, preț, termen). Nimic nu este trimis clientului.</p>
            </>
          )}
        <ErrorNotice error={room.errorOf("summary-service")} />
      </div>
    </details>
  );
}

/** The editor of ONE document version. Drafts are kept locally (per document) until saved or discarded. */
function SummaryBody({ room, sv }) {
  const [drafts, setDrafts] = usePref(`delivery.summaryDraft:${sv.documentId}`, {});
  const safeDrafts = drafts && typeof drafts === "object" && !Array.isArray(drafts) ? drafts : {};
  const [open, setOpen] = useState(() => Object.keys(safeDrafts));
  const diff = summaryDiff(sv.sections, safeDrafts);
  // Drafts left from before the document went old are kept on this computer but are not offered for saving on it.
  const dirty = sv.current && diff.changed > 0;
  const { setSummaryDirty } = room;
  // The decision row „gata de prezentare” must not approve a text the owner is still changing.
  useEffect(() => { setSummaryDirty(dirty); return () => setSummaryDirty(false); }, [dirty, setSummaryDirty]);
  const edit = (id) => setOpen((ids) => (ids.includes(id) ? ids : [...ids, id]));
  const discard = (id) => { setOpen((ids) => ids.filter((x) => x !== id)); setDrafts((d) => { const next = { ...(d && typeof d === "object" ? d : {}) }; delete next[id]; return next; }); };
  const discardAll = () => { setOpen([]); setDrafts({}); };
  const gate = sessionGate(room.session);
  const save = async () => {
    const body = summaryEditBody(room.view, safeDrafts);
    if (!body) return;
    const out = await room.run("summary-edit", () => room.client.act(room.id, "summaryEdit", body), { owner: true, toast: "Rezumat salvat ca versiune nouă; versiunea veche e păstrată" });
    if (out !== undefined) discardAll();
  };
  const approveRow = decisionRowFor(room, "summaryReady");
  const busy = Boolean(room.busy);
  return (
    <div className="stack">
      {room.view.summary?.basis?.correction && <Notice tone="info">v{sv.version} corectează citările criteriilor; v{sv.version - 1} rămâne în istoric.</Notice>}
      {room.view.summary?.versions?.length > 0 && <details><summary>Versiunile rezumatului</summary><ul>{room.view.summary.versions.map(v => <li key={v.version}>v{v.version} · {v.approval ? 'aprobată de tine' : 'neaprobată'} · {v.status} · {v.createdBy}</li>)}</ul></details>}
      {sv.sections.filter(s => s.needsReview && s.reviewReason).map(s => <Notice key={s.id} tone="warn">{s.heading}: {s.reviewReason}</Notice>)}
      <ul className="delivery-summary" aria-label="Secțiunile rezumatului">
        {sv.sections.map((s) => (
          <Section key={s.id} section={s} draft={typeof safeDrafts[s.id] === "string" ? safeDrafts[s.id] : null} editing={s.editable && open.includes(s.id)} disabled={busy}
            onEdit={() => edit(s.id)} onChange={(text) => setDrafts((d) => ({ ...(d && typeof d === "object" ? d : {}), [s.id]: text }))} onDiscard={() => discard(s.id)} />
        ))}
      </ul>

      {dirty && (
        <div className="delivery-savebar" role="region" aria-label="Modificări nesalvate în rezumat">
          <p><strong>Ce se schimbă la salvare</strong> ({diff.changed} {diff.changed === 1 ? "secțiune" : "secțiuni"}) — devine v{Number(sv.version || 0) + 1}; aprobarea, dacă există, nu se mută pe versiunea nouă.</p>
          <ul className="plain">
            {diff.changes.map((c) => (
              <li key={c.id}>
                <strong className="small">{c.heading}</strong>
                {c.error ? <p className="small delivery-reason">{c.error}</p> : (
                  <pre className="pre diff delivery-diff" aria-label={`Diferența pentru ${c.heading}`}>
                    {c.lines.filter((l) => l.op !== "same").map((l, i) => <div key={i} className={l.op === "add" ? "add" : "del"}>{DIFF_MARK[l.op]} {l.text || " "}</div>)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <button type="button" className="btn primary" disabled={busy || !diff.valid || gate.blocked} onClick={save}><Save size={15} aria-hidden="true" />{room.busy === "summary-edit" ? "Se salvează…" : sessionLabel(`Salvează ca versiune nouă (v${Number(sv.version || 0) + 1})`, room.session)}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={discardAll}><Undo2 size={15} aria-hidden="true" />Renunță la toate</button>
          </div>
          {gate.blocked && <p className="small delivery-reason">{gate.reason}</p>}
          <ErrorNotice error={room.errorOf("summary-edit")} />
        </div>
      )}

      {sv.warnings.length > 0 && <Notice tone="warn" title="Atenție"><ul className="plain-list">{sv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
      {sv.claimsToVerify.length > 0 && (
        <section aria-labelledby="livrare-de-verificat">
          <h3 id="livrare-de-verificat" className="delivery-h3">De verificat de tine înainte de prezentare</h3>
          <ul className="plain-list small">{sv.claimsToVerify.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}

      <dl className="kv small">
        <dt>Baza rezumatului</dt><dd>{sv.basisLines.map((l, i) => <div key={i}>{l}</div>)}</dd>
        <dt>Fișiere exportate</dt>
        <dd>{sv.exports.length ? sv.exports.map((e) => (
          <div key={e.format}><a href={e.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} aria-hidden="true" /> {e.file}</a>{e.shaPrefix && <span className="faint"> · sha <code className="mono">{e.shaPrefix}</code></span>}</div>
        )) : <span className="faint">niciun fișier pentru această versiune</span>}</dd>
      </dl>
      {sv.current && <ServiceBinder room={room} disabled={busy || dirty} />}

      <section aria-labelledby="livrare-rezumat-aprobare" className="delivery-approve">
        <h3 id="livrare-rezumat-aprobare" className="delivery-h3">„Gata de prezentare”</h3>
        <p className="small"><Chip tone={approveRow?.chip.tone || "neutral"}>{approveRow?.chip.text || "—"}</Chip> Aprobarea se leagă de versiunea afișată: v{sv.version ?? "?"} · sha <code className="mono">{sv.shaPrefix || "—"}</code>. Nu trimite nimic nimănui.</p>
        <DecisionAction room={room} row={approveRow} place="rezumat" />
      </section>
    </div>
  );
}

/**
 * 5 · Rezumatul comercial. Sections are edited one by one; saving creates a NEW version (the old one is kept), price and term read
 * „De stabilit (neconfigurat)” until a configured catalog service is bound or the owner writes them, and „Gata de prezentare” is bound
 * to the sha that is displayed. A summary that describes an older software version is shown read-only, as old.
 */
export function SummaryEditor({ room }) {
  const sv = summaryView(room.view);
  return (
    <Panel title="5 · Rezumat comercial" icon={FileText} id="livrare-rezumat-panel"
      actions={sv.present ? <span className="row wrap"><Chip tone="neutral">v{sv.version ?? "?"}</Chip><Chip tone={sv.current ? "ok" : "error"}>{sv.current ? "versiunea curentă" : "versiune veche"}</Chip></span> : null}>
      {!sv.present ? <Empty title="Rezumatul nu a fost generat încă">Apare la sfârșitul pachetului de livrare, din faptele verificate (fără model).</Empty> : (
        <div className="stack">
          {!sv.current && <Notice tone="error" title="Rezumat pentru versiunea veche">{sv.why?.text ? `${sentence(sv.why.text)} ` : ""}Îl poți citi, dar editarea, exportul și aprobarea așteaptă o versiune nouă.</Notice>}
          <SummaryBody key={sv.documentId} room={room} sv={sv} />
        </div>
      )}
    </Panel>
  );
}
