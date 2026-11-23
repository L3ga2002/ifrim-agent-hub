import { useState } from "react";
import { KeyRound, Wallet, Power, Trash2 } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, refresh } from "../../store.js";
import { Panel, Loading, ErrorNotice, Chip, Notice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";

/**
 * 2.20 — the owner's optional API-key route ("plătesc cu cheia mea API"), per provider. Off by default. Saving the key, turning
 * the route on and changing the limits happen in the owner session (Windows Hello); turning it off is always available. The key
 * is sent once to this Hub (encrypted on this computer) and never shown again: only its last 4 characters.
 */
const NAMES = { codex: "OpenAI · Codex", claude: "Anthropic · Claude Code" };
const KEY_HINT = { codex: "sk-… (platform.openai.com → API keys)", claude: "sk-ant-… (console.anthropic.com → API Keys)" };
const usd = (v) => `${Number(v || 0).toFixed(2)} USD`;

function ProviderApi({ id, p, onChange }) {
  const [key, setKey] = useState("");
  const [budget, setBudget] = useState(() => ({ ...(p.budget || p.defaults) }));
  const saveKey = useAction(async () => {
    await withReauth(() => api("/api/owner/api-route/key", { method: "POST", body: { provider: id, key } }));
    setKey(""); onChange();
  });
  const enable = useAction(async () => {
    await withReauth(() => api("/api/owner/api-route/enable", { method: "POST", body: { provider: id, confirmText: p.consentText, ...budget } }));
    // The account check binds the key (no model call); the gate needs it before the first run.
    await api(`/api/providers/${id}/probe`, { method: "POST", body: { withModels: id === "codex" } }).catch(() => {});
    onChange();
  });
  const saveBudget = useAction(async () => { await withReauth(() => api("/api/owner/api-route/budget", { method: "POST", body: { provider: id, ...budget } })); onChange(); });
  const disable = useAction(async (removeKey = false) => { await api("/api/owner/api-route/disable", { method: "POST", body: { provider: id, reason: "oprită din Integrări", removeKey } }); onChange(); });
  const s = p.state || {};
  const field = (name, label) => (
    <label className="stack tight" style={{ minWidth: 120 }}>
      <span className="faint small">{label}</span>
      <input className="input" type="number" min={p.limits[name][0]} max={p.limits[name][1]} step="0.5" value={budget[name] ?? ""}
        onChange={(e) => setBudget({ ...budget, [name]: e.target.value === "" ? "" : Number(e.target.value) })} aria-label={`${label} (${NAMES[id]})`} />
    </label>
  );
  return (
    <div className="stack" data-lega-target={`api-route-${id}`}>
      <div className="row wrap" style={{ alignItems: "center" }}>
        <strong>{NAMES[id]}</strong>
        <Chip tone={p.enabled ? (s.ok ? "ok" : "warn") : "neutral"}>{p.enabled ? (s.ok ? "ruta API pornită" : "plafon atins") : "oprită (abonament)"}</Chip>
        <span className="muted small">{p.key ? (p.key.valid ? `cheie salvată …${p.key.last4}` : p.key.problem) : "nicio cheie salvată"}</span>
      </div>
      {p.enabled && (
        <dl className="kv">
          <dt>Azi</dt><dd>{usd(s.spent?.today)} din {usd(p.budget?.dailyUsd)}</dd>
          <dt>Luna aceasta</dt><dd>{usd(s.spent?.month)} din {usd(p.budget?.monthlyUsd)}</dd>
          <dt>Pe rulare</dt><dd>maxim {usd(p.budget?.perRunUsd)} · disponibil acum {usd(s.maxForRun)}</dd>
          {p.runs?.length > 0 && <><dt>Ultimele rulări</dt><dd>{p.runs.slice(0, 5).map((r) => `${fmt.dateTime(r.at)} ${usd(r.usd)}${r.estimated ? " (estimare maximă)" : ""}${r.model ? ` · ${r.model}` : ""}`).join(" | ")}</dd></>}
        </dl>
      )}
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <label className="stack tight" style={{ flex: "1 1 260px" }}>
          <span className="faint small">{p.key ? "Înlocuiește cheia" : "Cheia API"} — {KEY_HINT[id]}</span>
          <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`Cheia API ${NAMES[id]}`} />
        </label>
        <button className="btn sm" disabled={!key.trim() || saveKey.pending} onClick={saveKey.run}><KeyRound size={14} />{saveKey.pending ? "Salvez…" : "Salvează cheia"}</button>
      </div>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        {field("monthlyUsd", "Plafon lunar (USD)")}{field("dailyUsd", "Plafon zilnic (USD)")}{field("perRunUsd", "Plafon pe rulare (USD)")}
        {p.enabled && <button className="btn sm" disabled={saveBudget.pending} onClick={saveBudget.run}><Wallet size={14} />{saveBudget.pending ? "Salvez…" : "Salvează plafoanele"}</button>}
      </div>
      {!p.enabled && p.key?.valid && (
        <>
          <pre className="pre" style={{ maxHeight: 140, whiteSpace: "pre-wrap" }}>{p.consentText}</pre>
          <div className="row wrap">
            <button className="btn sm primary" disabled={enable.pending} onClick={enable.run}><Power size={14} />{enable.pending ? "Pornesc…" : "Accept textul și pornesc ruta API"}</button>
          </div>
        </>
      )}
      {(p.enabled || p.key) && (
        <div className="row wrap">
          {p.enabled && <button className="btn sm ghost" disabled={disable.pending} onClick={() => disable.run(false)}>Oprește ruta API (revin la abonament)</button>}
          {p.key && <button className="btn sm ghost" disabled={disable.pending} onClick={() => disable.run(true)}><Trash2 size={14} />Oprește și șterge cheia</button>}
        </div>
      )}
      <ErrorNotice error={saveKey.error || enable.error || saveBudget.error || disable.error} />
    </div>
  );
}

export default function ApiKeyPanel() {
  const res = useResource("/api/api-route", { reloadOn: (e) => e.type.startsWith("api_route.") || e.type === "api.spend" || (e.type === "settings.changed" && ["apiRoutes", "apiSpend"].includes(e.payload?.key)) });
  if (res.loading) return <Panel title="Cheie API proprie" icon={KeyRound}><Loading lines={3} /></Panel>;
  if (res.error) return <Panel title="Cheie API proprie" icon={KeyRound}><ErrorNotice error={res.error} onRetry={res.reload} /></Panel>;
  const onChange = () => { res.reload(); refresh(); };
  const prices = res.data.codexPrices;
  return (
    <Panel title="Cheie API proprie (plătită de tine)" icon={KeyRound}>
      <div className="stack">
        <Notice tone="info" title="Opțional">
          Fără cheie, Hub-ul folosește abonamentele tale (ChatGPT / Claude) prin aplicațiile Codex și Claude Code logate pe acest calculator.
          Cu ruta API pornită, rulările acelui provider folosesc cheia ta și se opresc la plafoane. Setează și o limită de cheltuieli în contul providerului: aceea este frâna sigură.
        </Notice>
        {Object.entries(res.data.providers).map(([id, p]) => <ProviderApi key={id} id={id} p={p} onChange={onChange} />)}
        <p className="faint small" style={{ margin: 0 }}>
          Costul Claude este cel raportat de Claude Code (și oprit de el la plafonul rulării). Costul Codex este o estimare din tokeni, cu prețuri verificate pe {prices.checkedAt}
          ({prices.models.map((m) => `${m.label}: ${m.input}/${m.output}`).join(" · ")}; alt model: {prices.fallback.input}/{prices.fallback.output} USD la 1M tokeni, prudent).
          O rulare oprită fără raport de cost se socotește la plafonul ei.
        </p>
      </div>
    </Panel>
  );
}
