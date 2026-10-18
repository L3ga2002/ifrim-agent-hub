import { useState } from "react";
import { Tags, Plus, Pencil } from "lucide-react";
import { api } from "../../api.js";
import { withReauth } from "../../lib/ownerSession.js";
import { useAction, pushToast } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, Dialog } from "../../components/ui.jsx";
import {
  serviceView, serviceToForm, serviceFormToPayload, listOf, formatPrice, formatLeadTime, CURRENCIES, PRICE_UNITS, KNOWN_SERVICE_TAGS,
  NOT_CONFIGURED_TEXT, approvalFrom, splitTags, SERVICE_LIMITS,
} from "../../lib/salesLogic.js";
import { SyntheticTag, useSalesResource, ApprovalGate, SalesError, Problems, when } from "./common.jsx";

/** Create or edit a catalog service. Price and lead time exist only when CONFIGURED; proposals never invent them. */
function ServiceEditor({ service, onClose, onSaved }) {
  const [form, setForm] = useState(() => serviceToForm(service || {}));
  const [gate, setGate] = useState(null);
  const [touched, setTouched] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const check = serviceFormToPayload(form);
  const save = useAction(async () => {
    setTouched(true);
    if (!check.ok) return;
    const path = service?.id ? `/api/sales/services/${encodeURIComponent(service.id)}` : "/api/sales/services";
    // 2.15.2: the catalog is written only in the owner session (the page unlocks with Windows Hello / the key when needed).
    const res = await withReauth(() => api(path, { method: "POST", body: check.payload }));
    const g = approvalFrom(res); if (g) { setGate(g); return; }
    pushToast("sales-service", "ok", service?.id ? "Serviciu actualizat" : "Serviciu adăugat");
    onSaved(); onClose();
  });
  const unknownTags = splitTags(form.tags).filter((t) => !KNOWN_SERVICE_TAGS.includes(t));
  return (
    <Dialog title={service?.id ? `Editează: ${service.name}` : "Serviciu nou"} onClose={onClose}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Renunță</button><button type="button" className="btn primary" disabled={save.pending || (touched && !check.ok)} onClick={save.run}>{save.pending ? "Se salvează…" : "Salvează"}</button></>}>
      <label className="field"><span>Nume (minimum {SERVICE_LIMITS.nameMin} caractere)</span><input className="input" value={form.name} maxLength={SERVICE_LIMITS.nameMax} onChange={set("name")} /></label>
      <label className="field"><span>Descriere</span><textarea className="textarea" rows={3} maxLength={SERVICE_LIMITS.description} value={form.description} onChange={set("description")} /></label>
      <div className="grid two">
        <label className="field"><span>Ce include (câte un rând, cel mult {SERVICE_LIMITS.lines})</span><textarea className="textarea" rows={4} value={form.scope} onChange={set("scope")} /></label>
        <label className="field"><span>Ce nu include (câte un rând, cel mult {SERVICE_LIMITS.lines})</span><textarea className="textarea" rows={4} value={form.exclusions} onChange={set("exclusions")} /></label>
      </div>
      <label className="field"><span>Etichete (separate prin virgulă)</span><input className="input" value={form.tags} onChange={set("tags")} placeholder={KNOWN_SERVICE_TAGS.join(", ")} /></label>
      <p className="faint small" style={{ margin: 0 }}>Etichetele leagă serviciul de constatările auditului: {KNOWN_SERVICE_TAGS.join(", ")}.{unknownTags.length ? ` Etichete fără efect în audit: ${unknownTags.join(", ")}.` : ""}</p>
      <fieldset className="sales-fieldset">
        <legend>Preț</legend>
        <div className="seg" role="group" aria-label="Starea prețului">
          <button type="button" aria-pressed={form.priceStatus === "NOT_CONFIGURED"} onClick={() => setForm((f) => ({ ...f, priceStatus: "NOT_CONFIGURED" }))}>Neconfigurat</button>
          <button type="button" aria-pressed={form.priceStatus === "CONFIGURED"} onClick={() => setForm((f) => ({ ...f, priceStatus: "CONFIGURED" }))}>Configurat</button>
        </div>
        {form.priceStatus === "CONFIGURED" ? (
          <div className="grid three">
            <label className="field"><span>Sumă</span><input className="input" inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="1.500" /></label>
            <label className="field"><span>Monedă</span><select className="select" value={form.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="field"><span>Unitate</span><select className="select" value={form.unit} onChange={set("unit")}>{PRICE_UNITS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          </div>
        ) : <p className="faint small" style={{ margin: 0 }}>În propuneri apare „{NOT_CONFIGURED_TEXT}”.</p>}
      </fieldset>
      <fieldset className="sales-fieldset">
        <legend>Termen de livrare</legend>
        <div className="seg" role="group" aria-label="Starea termenului">
          <button type="button" aria-pressed={form.leadStatus === "NOT_CONFIGURED"} onClick={() => setForm((f) => ({ ...f, leadStatus: "NOT_CONFIGURED" }))}>Neconfigurat</button>
          <button type="button" aria-pressed={form.leadStatus === "CONFIGURED"} onClick={() => setForm((f) => ({ ...f, leadStatus: "CONFIGURED" }))}>Configurat</button>
        </div>
        {form.leadStatus === "CONFIGURED" ? (
          <label className="field"><span>Termenul, așa cum apare în propunere</span><input className="input" value={form.leadText} maxLength={SERVICE_LIMITS.leadText} placeholder="ex.: 10 zile lucrătoare de la primirea materialelor" onChange={set("leadText")} /></label>
        ) : <p className="faint small" style={{ margin: 0 }}>În propuneri apare „{NOT_CONFIGURED_TEXT}”.</p>}
      </fieldset>
      <label className="check"><input type="checkbox" checked={form.active} onChange={set("active")} />Activ (apare la oportunități noi)</label>
      {touched && <Problems errors={check.errors} />}
      <ErrorNotice error={save.error} />
      <ApprovalGate gate={gate} onDone={() => { setGate(null); onSaved(); onClose(); }} onDismiss={() => setGate(null)} />
    </Dialog>
  );
}

/** Servicii: the catalog proposals draw from (scope, exclusions, tags, price and lead time with explicit status). */
export function Services() {
  const res = useSalesResource("/api/sales/services");
  const [editing, setEditing] = useState(null); // null | {} (new) | service
  const services = listOf(res.data, "services").map(serviceView);
  return (
    <Panel title={`Servicii (${services.length})`} icon={Tags} flush actions={<button type="button" className="btn sm primary" onClick={() => setEditing({})}><Plus size={14} aria-hidden="true" />Serviciu nou</button>}>
      {res.loading && !res.data ? <div className="panel-body"><Loading lines={4} /></div>
        : res.error && !res.data ? <div className="panel-body"><SalesError error={res.error} onRetry={res.reload} what="catalogul" /></div>
        : services.length ? (
          <ul className="list">{services.map((s) => (
            <li key={s.id}>
              <div className="list-row sales-service">
                <div className="grow">
                  <div className="title break">{s.name}{!s.active && <span className="faint small"> (inactiv)</span>}</div>
                  {s.description && <div className="sub break">{s.description}</div>}
                  <div className="sub">Preț: <strong>{formatPrice(s.price)}</strong> · Termen: <strong>{formatLeadTime(s.leadTime)}</strong></div>
                  {(s.scope.length > 0 || s.exclusions.length > 0) && <div className="sub break">{s.scope.length ? `Include: ${s.scope.join("; ")}` : ""}{s.scope.length && s.exclusions.length ? " · " : ""}{s.exclusions.length ? `Nu include: ${s.exclusions.join("; ")}` : ""}</div>}
                  <div className="chips" style={{ marginTop: 4 }}>{s.tags.map((t) => <span key={t} className="chip neutral">{t}</span>)}{s.synthetic && <SyntheticTag />}</div>
                  <div className="faint small">v{s.version} · {when(s.updatedAt)}</div>
                </div>
                <button type="button" className="btn sm" onClick={() => setEditing(s)} aria-label={`Editează ${s.name}`}><Pencil size={14} aria-hidden="true" />Editează</button>
              </div>
            </li>
          ))}</ul>
        ) : <Empty title="Catalogul e gol" action={<button type="button" className="btn sm primary" onClick={() => setEditing({})}>Adaugă primul serviciu</button>}>Fără servicii, auditul spune „niciun serviciu configurat” și propunerile nu pot recomanda nimic concret.</Empty>}
      {editing && <ServiceEditor service={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={res.reload} />}
    </Panel>
  );
}
