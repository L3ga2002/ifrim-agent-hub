import { useState, useCallback } from "react";
import { Building2, ChevronLeft, Fingerprint, Contact, FileSearch, Gauge, History, Ban, Target, Plus, ScanSearch, ShieldCheck } from "lucide-react";
import { api } from "../../api.js";
import { useAction, pushToast } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Notice, Dialog } from "../../components/ui.jsx";
import {
  orgView, contactView, evidenceView, evidenceStatusView, orderEvidence, isHistoricalEvidence, auditView, qualificationView, transitionView, oppView, serviceView, listOf, newestFirst,
  fiscalCodeText, DOMAIN_KIND_RO, AUDIT_CHECK_RO, COMPONENT_RO, FINANCIAL_FILTER_RO, CONTACT_KIND_RO, priorityText, statusMeta,
  orgManualTargets, auditReadiness, salesHref, approvalFrom, textExcerpt, formatPrice, REASON_MIN,
} from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource, useSalesCommand, ApprovalGate, SalesError, Excerpt, when } from "./common.jsx";
import { QualificationNotes } from "./QualificationNotes.jsx";

const QUALIFICATION_WEIGHTS = { serviceFit: 50, evidence: 30, completeness: 20 }; // q-v1 (contract §2.4), shown for transparency

function Identity({ org, aliases, unknowns = [], lastVerifiedAt = "" }) {
  const fiscal = fiscalCodeText(org.fiscalCode, org.fiscalCodeValid);
  return (
    <Panel title="Identitate" icon={Fingerprint}>
      <dl className="kv">
        <dt>Denumire</dt><dd>{org.name || "—"}{org.legalForm && <span className="faint"> · {org.legalForm}</span>}</dd>
        <dt>CUI</dt><dd><span className="mono">{org.fiscalCode || "—"}</span> <span className={fiscal.tone === "error" ? "warn-text" : "faint"}>({fiscal.text})</span></dd>
        <dt>Site</dt><dd className="break">{org.website ? <span className="mono">{org.website}</span> : "—"}{org.domainKind && <div className="faint small">{DOMAIN_KIND_RO[org.domainKind] || org.domainKind}{org.domainKind !== "organization_site" ? ": nu se folosește ca identitate" : ""}</div>}</dd>
        <dt>Localitate</dt><dd>{[org.city, org.county].filter(Boolean).join(", ") || "—"}</dd>
        <dt>Adresă</dt><dd>{org.address || "—"}</dd>
        <dt>CAEN</dt><dd className="mono">{org.caen || "—"}</dd>
        <dt>Versiune</dt><dd>v{org.version} · creată {when(org.createdAt)} · actualizată {when(org.updatedAt)}</dd>
        <dt>Ultima verificare</dt><dd>{lastVerifiedAt ? when(lastVerifiedAt) : <span className="faint">nicio dovadă verificată încă</span>}</dd>
        {unknowns.length > 0 && <><dt>Lipsesc</dt><dd className="warn-text">{unknowns.join(", ")}</dd></>}
        {org.mergedInto && <><dt>Unită în</dt><dd><a href={`#${salesHref("org", { id: org.mergedInto })}`}>firma păstrată</a></dd></>}
      </dl>
      {aliases.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title">Alte denumiri</div>
          <ul className="plain-list">{aliases.map((a, i) => <li key={a.id || i} className="break">{a.name || a.normalized || String(a)}{a.source && <span className="faint small"> · {a.source}</span>}</li>)}</ul>
        </div>
      )}
    </Panel>
  );
}

function Contacts({ contacts }) {
  return (
    <Panel title={`Contacte (${contacts.length})`} icon={Contact} flush>
      {contacts.length ? (
        <ul className="list">{contacts.map((c) => (
          <li key={c.id || `${c.kind}:${c.value}`}>
            <div className="list-row sales-contact">
              <span className="faint small nowrap">{CONTACT_KIND_RO[c.kind] || c.kind}</span>
              <div className="grow">
                <div className="mono break">{c.value || c.raw || "—"}</div>
                {(c.personName || c.role) && <div className="sub">{[c.personName, c.role].filter(Boolean).join(" · ")}</div>}
                {c.warnings.length > 0 && <div className="sub warn-text">{c.warnings.join("; ")}</div>}
              </div>
              <span className="chips">
                {c.generic && <span className="chip neutral" title="Adresă generică (info@, office@…): adresarea din ciornă rămâne generică">generic</span>}
                {c.status && c.status !== "ACTIVE" && <span className="chip warn">{c.status}</span>}
              </span>
            </div>
          </li>
        ))}</ul>
      ) : <Empty title="Fără contacte">Contactele vin din import sau din dovezi. Nu se inventează nume.</Empty>}
    </Panel>
  );
}

/**
 * Evidence with its freshness (computed by the Hub): current, to recheck (with the reason), superseded or from a rolled-back
 * import (kept as history, collapsed and dimmed; the Hub no longer uses them). A contradiction is marked on both items.
 */
function Evidence({ evidence, status }) {
  const [showOld, setShowOld] = useState(false);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const ordered = orderEvidence(evidence);
  const live = ordered.filter((e) => !isHistoricalEvidence(e));
  const old = ordered.filter(isHistoricalEvidence);
  const rows = showOld ? [...live, ...old] : live;
  return (
    <Panel title={`Dovezi (${evidence.length})`} icon={FileSearch} flush>
      {evidence.length ? (
        <>
          <div className="panel-body">
            <ul className="sales-count-list" aria-label="Actualitatea dovezilor">
              <li><span className="row"><SalesChip kind="freshness" status="CURRENT" /><span className="n">{status.current}</span></span></li>
              <li><span className="row"><SalesChip kind="freshness" status="NEEDS_RECHECK" /><span className="n">{status.needsRecheck}</span></span></li>
              <li><span className="row"><SalesChip kind="freshness" status="SUPERSEDED" /><span className="n">{status.superseded}</span></span></li>
              {status.rolledBack > 0 && <li><span className="row"><SalesChip kind="freshness" status="ROLLED_BACK" /><span className="n">{status.rolledBack}</span></span></li>}
            </ul>
            {status.contradictions.length > 0 && <p className="warn-text small" style={{ margin: "8px 0 0" }}>{status.contradictions.length} dovezi se contrazic: ambele rămân, marcate mai jos; decide tu care e corectă.</p>}
          </div>
          <div className="table-wrap">
            <table className="table table-mobile-cards">
              <thead><tr><th>Afirmație</th><th>Valoare</th><th>Etichetă</th><th>Actualitate</th><th>Sursă</th><th>Fragment</th></tr></thead>
              <tbody>{rows.map((e) => (
                <tr key={e.id} className={isHistoricalEvidence(e) ? "sales-evidence-old" : undefined}>
                  <td data-label="Afirmație" className="break">{e.claim || "—"}<div className="sub mono">{e.id}</div></td>
                  <td data-label="Valoare" className="break">{textExcerpt(e.value, 160) || "—"}</td>
                  <td data-label="Etichetă"><SalesChip kind="evidence" status={e.label} /></td>
                  <td data-label="Actualitate" className="small break">
                    <SalesChip kind="freshness" status={e.freshness} />
                    {e.freshnessReason && <div className="faint">{e.freshnessReason}</div>}
                    {e.conflictsWith.length > 0 && <div className="warn-text">Contrazice {e.conflictsWith.length === 1 ? "dovada" : "dovezile"} {e.conflictsWith.map((id) => (byId.has(id) ? `„${textExcerpt(byId.get(id).claim || id, 60)}” (${id})` : id)).join(", ")}</div>}
                  </td>
                  <td data-label="Sursă" className="small break">{e.sourceKind || "—"}{e.sourceRef && <div className="mono faint">{textExcerpt(e.sourceRef, 120)}</div>}<div className="faint">{when(e.verifiedAt || e.retrievedAt || e.createdAt)}</div></td>
                  <td data-label="Fragment">{e.excerpt ? <Excerpt>{textExcerpt(e.excerpt, 200)}</Excerpt> : <span className="faint">—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {old.length > 0 && (
            <div className="panel-body">
              <button type="button" className="btn sm ghost" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>{showOld ? "Ascunde istoricul" : `Arată istoricul (${old.length} dovezi înlocuite sau anulate)`}</button>
            </div>
          )}
        </>
      ) : <Empty title="Fără dovezi">Fiecare afirmație folosită la calificare, audit sau propunere are o dovadă cu etichetă și sursă.</Empty>}
    </Panel>
  );
}

function Audit({ audit, readiness, onRun, busy, locked }) {
  return (
    <Panel title="Audit de site" icon={ScanSearch}
      actions={<button type="button" className="btn sm" disabled={!readiness.ok || locked} title={readiness.ok ? `Fixture local: ${readiness.host}` : readiness.reason} onClick={onRun}>{busy ? "Se auditează…" : audit ? "Audit nou (fixture)" : "Audit (fixture)"}</button>}>
      <div className="stack tight">
        {!readiness.ok && <p className="faint small" style={{ margin: 0 }}>{readiness.reason}</p>}
        {!audit ? <Empty title="Niciun audit">Auditul citește HTML static dintr-un fixture local, nu execută nimic din pagină și tratează textul paginii ca dată, nu ca instrucțiuni.</Empty> : (
          <>
            <div className="faint small break">{audit.url || "—"} · {audit.sourceKind || "—"} · {audit.version || "—"} · {when(audit.createdAt)}</div>
            <ul className="sales-checks">{audit.checks.map((c) => (
              <li key={c.id}>
                <div className="row wrap"><SalesChip kind="audit" status={c.status} /><strong>{AUDIT_CHECK_RO[c.id] || c.id}</strong>{c.label && <SalesChip kind="evidence" status={c.label} />}</div>
                {c.observation && <div className="small">{c.observation}</div>}
                {c.evidence.excerpt && <Excerpt label="Fragment din pagină">{textExcerpt(c.evidence.excerpt, 200)}</Excerpt>}
                {c.evidence.selector && <div className="faint small mono break">{c.evidence.selector}{c.evidence.method ? ` · ${c.evidence.method}` : ""}</div>}
              </li>
            ))}</ul>
            {audit.opportunities.length > 0 && (
              <div>
                <div className="section-title">Ce s-ar putea îmbunătăți</div>
                <ul className="plain-list small">{audit.opportunities.map((o, i) => (
                  <li key={o.checkId || i} className="break">{o.observation || o.checkId}{o.possibleEffect && <span className="faint"> — {o.possibleEffect}</span>}
                    <span className="faint"> · {o.serviceId ? `serviciu: ${o.serviceName || o.serviceId}` : "niciun serviciu configurat"}</span>
                    {Array.isArray(o.conditionsToConfirm) && o.conditionsToConfirm.length > 0 && <div className="faint">De confirmat: {o.conditionsToConfirm.join("; ")}</div>}</li>
                ))}</ul>
              </div>
            )}
            {audit.limits.length > 0 && <p className="faint small" style={{ margin: 0 }}>Limite: {audit.limits.join("; ")}</p>}
          </>
        )}
      </div>
    </Panel>
  );
}

function Qualification({ q, orgId, onRun, busy, locked, onChanged }) {
  const [priority, setPriority] = useState("");
  const [reason, setReason] = useState("");
  const override = useSalesCommand(useCallback(async () => { setPriority(""); setReason(""); pushToast("sales-override", "ok", "Prioritatea a fost suprascrisă, cu motiv"); onChanged(); }, [onChanged]), { owner: true });
  const p = Number(priority);
  const validPriority = priority !== "" && Number.isInteger(p) && p >= 0 && p <= 100;
  return (
    <Panel title="Calificare" icon={Gauge} actions={<button type="button" className="btn sm" disabled={locked} onClick={onRun}>{busy ? "Se calculează…" : q ? "Recalculează" : "Calificare"}</button>}>
      {!q ? <Empty title="Necalificată">Calificarea e o formulă explicabilă (fără model): potrivire cu serviciile, dovezi și completitudine. Ce nu se știe rămâne necunoscut, nu zero.</Empty> : (
        <div className="stack">
          <div className="row wrap">
            <span className="sales-priority">{priorityText(q.priority)}</span>
            <span className="faint small">prioritate internă (nu e probabilitate de vânzare) · formula {q.version || "—"} · {when(q.createdAt)}</span>
          </div>
          {q.override && <Notice tone="warn" title="Suprascrisă">{priorityText(q.override.priority ?? q.priority)} față de {priorityText(q.computedPriority)} calculat de formulă · motiv: {q.override.reason || "—"}{q.override.actor ? ` · ${q.override.actor}` : ""}{q.override.at ? ` · ${when(q.override.at)}` : ""}</Notice>}
          <div className="sales-components">
            {Object.entries(q.components).map(([key, c]) => (
              <div key={key} className="sales-component">
                <div className="row between"><strong>{COMPONENT_RO[key] || key}</strong><span className="faint small">pondere {QUALIFICATION_WEIGHTS[key] ?? "?"}%</span></div>
                <div className={c.score === null ? "faint" : "sales-score"}>{c.score === null ? "necunoscut (exclus din calcul)" : `${Math.round(c.score)}/100`}</div>
                {c.contributions.length > 0 && <ul className="plain-list small">{c.contributions.map((x, i) => <li key={i} className="break">{x.points >= 0 ? "+" : ""}{x.points} · {x.factor}{x.evidenceIds.length ? <span className="faint mono"> [{x.evidenceIds.join(", ")}]</span> : ""}</li>)}</ul>}
              </div>
            ))}
          </div>
          {q.unknowns.length > 0 && <div><div className="section-title">Necunoscute</div><ul className="plain-list small">{q.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
          {q.explanation.length > 0 && <div><div className="section-title">Explicație</div><ul className="plain-list small">{q.explanation.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
          {q.financialFilter?.status && <p className="small" style={{ margin: 0 }}>Filtru financiar: <strong>{FINANCIAL_FILTER_RO[q.financialFilter.status] || q.financialFilter.status}</strong>{q.financialFilter.reason ? ` — ${q.financialFilter.reason}` : ""}</p>}
          {q.history.length > 0 && <div><div className="section-title">Istoricul suprascrierilor</div><ul className="plain-list small">{q.history.map((h, i) => <li key={i}>{h.previousPriority !== undefined ? `${priorityText(h.previousPriority)} → ` : ""}{priorityText(h.priority)} · {h.reason} · {h.actor || "—"} · {when(h.at)}</li>)}</ul></div>}
          <form className="sales-inline-form" onSubmit={(e) => { e.preventDefault(); if (validPriority && reason.trim().length >= REASON_MIN.override) override.run(`/api/sales/orgs/${encodeURIComponent(orgId)}/qualification/override`, { priority: p, reason: reason.trim(), displayedQualificationId: q.id }); }}>
            <label className="field"><span>Prioritate manuală (0–100)</span><input className="input" type="number" min={0} max={100} step={1} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} /></label>
            <label className="field grow"><span>Motiv (obligatoriu, min. 5 caractere)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="submit" className="btn sm" disabled={!validPriority || reason.trim().length < REASON_MIN.override || override.busy}>Suprascrie</button>
          </form>
          <ErrorNotice error={override.error} />
          <ApprovalGate gate={override.approval} onDone={() => { override.clearApproval(); onChanged(); }} onDismiss={override.clearApproval} />
        </div>
      )}
    </Panel>
  );
}

function Transitions({ org, transitions, onChanged }) {
  const targets = orgManualTargets(org.status);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const cmd = useSalesCommand(useCallback(async () => { setTo(""); setReason(""); onChanged(); }, [onChanged]));
  return (
    <Panel title="Istoric de stări" icon={History}>
      <div className="stack">
        {transitions.length ? (
          <ul className="list">{transitions.map((t) => (
            <li key={t.id || `${t.at}${t.to}`}><div className="list-row sales-transition">
              <span className="nowrap small">{t.from ? statusMeta("org", t.from).label : "—"} → <strong>{statusMeta("org", t.to).label}</strong></span>
              <span className="grow faint small break">{t.reason}</span><span className="faint small nowrap">{t.actor} · {when(t.at)}</span>
            </div></li>
          ))}</ul>
        ) : <p className="faint" style={{ margin: 0 }}>Nicio tranziție înregistrată.</p>}
        {targets.length > 0 && (
          <form className="sales-inline-form" onSubmit={(e) => { e.preventDefault(); if (to && reason.trim().length >= REASON_MIN.transition) cmd.run(`/api/sales/orgs/${encodeURIComponent(org.id)}/transition`, { to, reason: reason.trim() }); }}>
            <label className="field"><span>Stare nouă</span><select className="select" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Alege…</option>{targets.map((s) => <option key={s} value={s}>{statusMeta("org", s).label}</option>)}</select></label>
            <label className="field grow"><span>Motiv (min. {REASON_MIN.transition} caractere)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="submit" className="btn sm" disabled={!to || reason.trim().length < REASON_MIN.transition || cmd.busy}>Schimbă starea</button>
          </form>
        )}
        <ErrorNotice error={cmd.error} />
        <ApprovalGate gate={cmd.approval} onDone={() => { cmd.clearApproval(); onChanged(); }} onDismiss={cmd.clearApproval} />
      </div>
    </Panel>
  );
}

/**
 * Do-not-contact: setting it is immediate (it only stops things); lifting it is the owner's decision with a reason and
 * an ALWAYS_ASK approval (the org goes to ON_HOLD, nothing restarts by itself).
 */
function Suppression({ org, suppression, onChanged }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [liftReason, setLiftReason] = useState("");
  const cmd = useSalesCommand(useCallback(async () => { setReason(""); setOpen(false); pushToast("sales-suppress", "ok", "Firma e marcată „Nu contacta”"); onChanged(); }, [onChanged]));
  const lift = useSalesCommand(useCallback(async () => { setLiftReason(""); pushToast("sales-lift", "ok", "Interdicția a fost ridicată; firma e „În așteptare”"); onChanged(); }, [onChanged]), { owner: true });
  const blocked = org.status === "DO_NOT_CONTACT" || Boolean(suppression);
  return (
    <Panel title="Suprimare (Nu contacta)" icon={Ban}>
      <div className="stack tight">
        {suppression ? (
          <p className="small break" style={{ margin: 0 }}>Activă ({suppression.kind === "org" ? "firmă" : suppression.kind}{suppression.value && suppression.kind !== "org" ? `: ${suppression.value}` : ""}) · motiv: {suppression.reason || "—"}</p>
        ) : <p className="faint small" style={{ margin: 0 }}>Nicio suprimare activă.</p>}
        {!blocked && !open && <div><button type="button" className="btn sm danger" onClick={() => setOpen(true)}><Ban size={14} aria-hidden="true" />Marchează „Nu contacta”</button></div>}
        {!blocked && open && (
          <form className="sales-inline-form" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= REASON_MIN.suppress) cmd.run(`/api/sales/orgs/${encodeURIComponent(org.id)}/suppress`, { reason: reason.trim() }); }}>
            <label className="field grow"><span>Motiv (ex.: a cerut să nu fie contactată)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="submit" className="btn sm danger" disabled={reason.trim().length < REASON_MIN.suppress || cmd.busy}>Confirmă suprimarea</button>
            <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Renunță</button>
          </form>
        )}
        {blocked && (
          <form className="sales-inline-form" onSubmit={(e) => { e.preventDefault(); if (liftReason.trim().length >= REASON_MIN.lift) lift.run(`/api/sales/orgs/${encodeURIComponent(org.id)}/suppression/lift`, { reason: liftReason.trim() }); }}>
            <label className="field grow"><span>Motivul ridicării (min. {REASON_MIN.lift} caractere; cere aprobarea ta)</span><input className="input" value={liftReason} maxLength={300} onChange={(e) => setLiftReason(e.target.value)} /></label>
            <button type="submit" className="btn sm" disabled={liftReason.trim().length < REASON_MIN.lift || lift.busy}><ShieldCheck size={14} aria-hidden="true" />{lift.busy ? "Se cere…" : "Cere ridicarea interdicției"}</button>
          </form>
        )}
        <ErrorNotice error={cmd.error || lift.error} />
        <ApprovalGate gate={cmd.approval} onDone={() => { cmd.clearApproval(); onChanged(); }} onDismiss={cmd.clearApproval} />
        <ApprovalGate gate={lift.approval} onDone={() => { lift.clearApproval(); onChanged(); }} onDismiss={lift.clearApproval} />
      </div>
    </Panel>
  );
}

function NewOpportunity({ org, onClose, go }) {
  const services = useSalesResource("/api/sales/services");
  const list = listOf(services.data, "services").map(serviceView).filter((s) => s.active);
  const [form, setForm] = useState({ title: `Site pentru ${org.name}`.slice(0, 160), need: "", serviceId: "" });
  const [gate, setGate] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useAction(async () => {
    const res = await api("/api/sales/opportunities", { method: "POST", body: { orgId: org.id, title: form.title.trim(), need: form.need.trim(), ...(form.serviceId ? { serviceId: form.serviceId } : {}) } });
    const g = approvalFrom(res); if (g) { setGate(g); return; }
    const opp = oppView(res?.opportunity ?? res);
    onClose();
    if (opp.id) go(salesHref("opp", { id: opp.id }));
  });
  const valid = form.title.trim().length >= 3;
  return (
    <Dialog title="Oportunitate nouă" onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Renunță</button><button type="button" className="btn primary" disabled={!valid || create.pending} onClick={create.run}>{create.pending ? "Se creează…" : "Creează"}</button></>}>
      <p className="muted small" style={{ margin: 0 }}>Pentru {org.name}. Oportunitatea pornește în starea „{statusMeta("opp", "IDENTIFIED").label}”; nimic nu se trimite.</p>
      <label className="field"><span>Titlu</span><input className="input" value={form.title} maxLength={160} onChange={set("title")} /></label>
      <label className="field"><span>Nevoia observată (cu dovezi în fișă)</span><textarea className="textarea" rows={3} value={form.need} maxLength={2000} onChange={set("need")} /></label>
      <label className="field"><span>Serviciu din catalog</span>
        <select className="select" value={form.serviceId} onChange={set("serviceId")} disabled={services.loading && !services.data}>
          <option value="">Fără serviciu ales încă</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatPrice(s.price)}</option>)}
        </select>
      </label>
      {services.error && <ErrorNotice error={services.error} onRetry={services.reload} />}
      <ErrorNotice error={create.error} />
      <ApprovalGate gate={gate} onDone={() => { setGate(null); onClose(); }} onDismiss={() => setGate(null)} />
    </Dialog>
  );
}

/** Fișă firmă: identity, contacts, evidence, audit, qualification, history, suppression and actions. */
export function OrgSheet({ id, go, backHref }) {
  const res = useSalesResource(`/api/sales/orgs/${encodeURIComponent(id)}`);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(null); // which action is in flight: "audit" | "qualify"
  const reload = res.reload;
  const act = useSalesCommand(useCallback(async (_result, meta) => {
    pushToast(`sales-${meta}`, "ok", meta === "audit" ? "Audit salvat (fixture local)" : "Calificare recalculată");
    reload();
  }, [reload]));
  const runAction = async (kind, path, body) => { setRunning(kind); try { await act.run(path, body, kind); } finally { setRunning(null); } };
  if (res.loading && !res.data) return <Loading lines={8} />;
  if (res.error && !res.data) return <div className="stack"><a className="btn sm ghost sales-back" href={`#${backHref}`}><ChevronLeft size={14} aria-hidden="true" />Firme</a><SalesError error={res.error} onRetry={reload} what="firma" /></div>;
  const d = res.data || {};
  const org = orgView(d.org ?? d);
  const aliases = listOf(d, "aliases");
  const contacts = listOf(d, "contacts").map(contactView);
  const evidence = listOf(d, "evidence").map(evidenceView);
  const evidenceStatus = evidenceStatusView(d.evidenceStatus);
  const audits = newestFirst(listOf(d, "audits")).map(auditView);
  const audit = d.audit ? auditView(d.audit) : audits[0] || null;
  const qualification = qualificationView(d.qualification ?? newestFirst(listOf(d, "qualifications"))[0] ?? null);
  const opportunities = listOf(d, "opportunities").map(oppView);
  const transitions = newestFirst(listOf(d, "transitions")).map(transitionView);
  const suppression = d.suppression && typeof d.suppression === "object" ? d.suppression : null;
  const unknowns = Array.isArray(d.unknowns) ? d.unknowns.map(String) : [];
  const readiness = auditReadiness(org);
  const base = `/api/sales/orgs/${encodeURIComponent(org.id || id)}`;
  const blocked = org.status === "DO_NOT_CONTACT";
  return (
    <div className="stack">
      <div className="sales-sheet-head">
        <a className="btn sm ghost sales-back" href={`#${backHref}`}><ChevronLeft size={14} aria-hidden="true" />Firme</a>
        <h2 className="block-title break"><Building2 size={18} aria-hidden="true" />{org.name || "(fără nume)"}</h2>
        <div className="chips"><SalesChip kind="org" status={org.status} />{org.synthetic && <SyntheticTag />}{org.needsReview && <SalesChip kind="row" status="NEEDS_REVIEW" />}</div>
        <div className="row wrap">
          <button type="button" className="btn sm primary" disabled={blocked} title={blocked ? "Firma e marcată „Nu contacta”" : ""} onClick={() => setCreating(true)}><Plus size={14} aria-hidden="true" />Oportunitate nouă</button>
        </div>
      </div>
      {blocked && <Notice tone="error" title="Nu contacta">Firma e suprimată: nu se creează ciorne sau oportunități noi pentru ea.</Notice>}
      <ErrorNotice error={act.error} />
      <ApprovalGate gate={act.approval} onDone={() => { act.clearApproval(); reload(); }} onDismiss={act.clearApproval} />
      <div className="split-main sales-sheet">
        <div className="stack">
          <Identity org={org} aliases={aliases} unknowns={unknowns} lastVerifiedAt={typeof d.lastVerifiedAt === "string" ? d.lastVerifiedAt : ""} />
          <Audit audit={audit} readiness={readiness} busy={running === "audit"} locked={running !== null} onRun={() => runAction("audit", `${base}/audit`, { sourceKind: "fixture" })} />
          <Qualification q={qualification} orgId={org.id || id} busy={running === "qualify"} locked={running !== null} onRun={() => runAction("qualify", `${base}/qualify`, {})} onChanged={reload} />
          <QualificationNotes raw={d.qualification ?? newestFirst(listOf(d, "qualifications"))[0] ?? null} />
          <Evidence evidence={evidence} status={evidenceStatus} />
        </div>
        <div className="stack">
          <Contacts contacts={contacts} />
          <Panel title={`Oportunități (${opportunities.length})`} icon={Target} flush>
            {opportunities.length ? <ul className="list">{opportunities.map((o) => (
              <li key={o.id}><a className="list-row" href={`#${salesHref("opp", { id: o.id })}`}><div className="grow"><div className="title break">{o.title}</div>{o.nextAction && <div className="sub">{o.nextAction}</div>}</div><SalesChip kind="opp" status={o.status} /></a></li>
            ))}</ul> : <Empty title="Nicio oportunitate">Creeaz-o după audit și calificare.</Empty>}
          </Panel>
          <Transitions org={org} transitions={transitions} onChanged={reload} />
          <Suppression org={org} suppression={suppression} onChanged={reload} />
        </div>
      </div>
      {creating && <NewOpportunity org={org} onClose={() => setCreating(false)} go={go} />}
    </div>
  );
}
