import { useCallback, useEffect, useRef, useState } from "react";
import { OctagonX, Pause, Square, RefreshCw, Smartphone, LogOut, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import "../styles/m08.css";
import { api, fmt } from "../api.js";
import { mobileFreshness, newIdempotencyKey } from "../lib/intelLogic.js";
import { FACTORY_STAGE_RO } from "../lib/uiLogic.js";

const POLL_MS = 5000;
const DONE = { stop_all: "Stop tot: trimis — execuțiile se opresc.", pause_mission: "Pauză trimisă.", stop_mission: "Oprire trimisă." };

/**
 * Personal Mission Control (M08 §18): the phone's own screen. Its device cookie (HttpOnly, revocable) gives only the state and the
 * fail-safe commands (Stop all, pause / stop a mission); confirmations need the owner's session on the PC. A view older than 30 s
 * is marked stale and its buttons are disabled; every tap carries an idempotency key and the time of the view it was built on,
 * so a queued tap is never replayed after a disconnection (the Hub refuses views older than 2 minutes).
 */
export default function Mobile() {
  const [data, setData] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [needPairing, setNeedPairing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("Telefon");
  const pendingKey = useRef(new Map()); // one key per (command, mission) while a tap is unanswered — a retry reuses it

  const load = useCallback(async () => {
    try {
      const s = await api("/api/m/state");
      setData(s); setFetchedAt(Date.now()); setFailed(false); setNeedPairing(false);
    } catch (e) {
      if (e.status === 401 || e.details?.needPairing) { setNeedPairing(true); setData(null); }
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const fresh = mobileFreshness({ fetchedAt, serverTime: data?.serverTime, now, failed });
  const isDevice = data?.viewer?.kind === "device";

  const command = async (type, missionId = null, confirmText = null) => {
    if (!fresh.canAct || busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const k = `${type}:${missionId || ""}`;
    if (!pendingKey.current.has(k)) pendingKey.current.set(k, newIdempotencyKey("m"));
    setBusy(k); setMessage(null);
    try {
      const out = await api("/api/m/command", { method: "POST", body: { type, missionId, observedAt: data.serverTime, idempotencyKey: pendingKey.current.get(k) } });
      pendingKey.current.delete(k);
      setMessage({ tone: "ok", text: out.duplicate ? "Comanda fusese deja primită (nu s-a repetat)." : DONE[type] || "Trimis." });
      load();
    } catch (e) {
      // A refused or failed tap keeps its key only for a transport error (a retry of the SAME tap); a refusal needs a new view.
      if (e.status !== 0) pendingKey.current.delete(k);
      setMessage({ tone: "error", text: e.message });
    } finally { setBusy(null); }
  };

  const pair = async (e) => {
    e.preventDefault();
    setBusy("pair"); setMessage(null);
    try { await api("/api/m/pair", { method: "POST", body: { code: code.trim(), label: label.trim() || "Telefon" } }); setCode(""); await load(); setMessage({ tone: "ok", text: "Telefon asociat." }); }
    catch (er) { setMessage({ tone: "error", text: er.message }); }
    finally { setBusy(null); }
  };
  const forget = async () => {
    if (!window.confirm("Uiți acest telefon? Va trebui asociat din nou de pe PC.")) return;
    try { await api("/api/m/forget", { method: "POST", body: {} }); } catch { /* the cookie is cleared anyway */ }
    setData(null); setNeedPairing(true);
  };

  return (
    <div className="mobile-app">
      <header className="m-head">
        <Smartphone size={18} aria-hidden="true" /><strong>Ifrim Hub</strong>
        <span className={`m-fresh m-${fresh.state}`} role="status">{fresh.state === "fresh" ? <CheckCircle2 size={13} /> : fresh.state === "stale" || fresh.state === "offline" ? <AlertTriangle size={13} /> : <Clock size={13} />}{fresh.label}</span>
        <button className="btn sm icon ghost" onClick={load} aria-label="Reîncarcă"><RefreshCw size={15} /></button>
      </header>
      {message && <div className={`notice ${message.tone === "error" ? "error" : "info"}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div>}
      {needPairing ? (
        <form className="m-card stack" onSubmit={pair}>
          <h1 className="h3">Asociază acest telefon</h1>
          <p className="small">Pe PC: Pilot automat → Telefon → „Generează un cod”. Codul e valabil 10 minute.</p>
          <label className="field"><span>Cod (6 cifre)</span><input className="input m-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" /></label>
          <label className="field"><span>Numele telefonului</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></label>
          <button className="btn primary" disabled={code.length !== 6 || busy === "pair"}>Asociază</button>
          <p className="faint small">Telefonul primește doar vizualizare și opriri. Hub-ul ascultă doar pe acest calculator; din altă rețea nu e accesibil.</p>
        </form>
      ) : !data ? <p className="m-card faint">Citesc starea…</p> : (
        <>
          {!isDevice && <div className="notice info" role="status">Previzualizare din sesiunea ta de pe PC (așa arată pe telefon). Butoanele lucrează doar pe telefonul asociat; pe PC folosești Stop All din bara de sus.</div>}
          <button className="m-stop" disabled={!isDevice || !fresh.canAct || Boolean(busy) || !data.viewer.permissions.includes("stop_all")} onClick={() => command("stop_all", null, "Oprești toate execuțiile?")}><OctagonX size={22} aria-hidden="true" />Stop tot</button>
          {!fresh.canAct && <p className="faint small m-note">Butoanele sunt dezactivate până la o stare proaspătă (nu trimit comenzi construite pe o imagine veche).</p>}
          <section className="m-card" aria-labelledby="m-running"><h2 id="m-running" className="h3">În lucru ({data.running.length})</h2>
            {data.running.length ? <ul className="plain m-list">{data.running.map((m) => (
              <li key={m.missionId}><div><strong>{m.title}</strong><div className="faint small">{FACTORY_STAGE_RO[m.stage] || m.stage}</div></div>
                <div className="row">
                  <button className="btn sm" disabled={!isDevice || !fresh.canAct || Boolean(busy)} onClick={() => command("pause_mission", m.missionId)} aria-label={`Pauză: ${m.title}`}><Pause size={14} /></button>
                  <button className="btn sm" disabled={!isDevice || !fresh.canAct || Boolean(busy)} onClick={() => command("stop_mission", m.missionId, `Oprești „${m.title}”?`)} aria-label={`Oprește: ${m.title}`}><Square size={14} /></button>
                </div></li>
            ))}</ul> : <p className="faint small">Nimic nu rulează.</p>}
          </section>
          <section className="m-card" aria-labelledby="m-blocked"><h2 id="m-blocked" className="h3">Oprite / așteaptă ({data.blocked.length})</h2>
            {data.blocked.length ? <ul className="plain m-list">{data.blocked.map((m) => <li key={m.missionId}><div><strong>{m.title}</strong><div className="faint small">{FACTORY_STAGE_RO[m.stage] || m.stage}{m.reason ? ` — ${m.reason}` : ""}</div></div></li>)}</ul> : <p className="faint small">—</p>}
          </section>
          <section className="m-card" aria-labelledby="m-ready"><h2 id="m-ready" className="h3">Gata de verificat ({data.ready.length})</h2>
            {data.ready.length ? <ul className="plain m-list">{data.ready.map((m) => <li key={m.missionId}><strong>{m.title}</strong></li>)}</ul> : <p className="faint small">—</p>}
            <p className="faint small">Acceptarea unui pachet se face pe PC.</p>
          </section>
          <section className="m-card" aria-labelledby="m-dec"><h2 id="m-dec" className="h3">Decizii pentru tine ({data.decisions.length})</h2>
            {data.decisions.length ? <ul className="plain m-list">{data.decisions.map((d) => <li key={d.envelopeId}><div><strong>{d.headline}</strong><div className="faint small">se confirmă pe {d.where}</div></div></li>)}</ul> : <p className="faint small">—</p>}
          </section>
          <section className="m-card" aria-labelledby="m-inc"><h2 id="m-inc" className="h3">Incidente deschise ({data.incidents.length})</h2>
            {data.incidents.length ? <ul className="plain m-list">{data.incidents.map((i) => <li key={i.incidentId}><strong>{i.title}</strong> <span className="faint small">{i.status}{i.impactConfirmed ? " · impact confirmat" : ""}</span></li>)}</ul> : <p className="faint small">—</p>}
          </section>
          <footer className="m-foot faint small">Server {fmt.time(data.serverTime)} · versiunea stării {data.stateVersion}{isDevice && <> · <button className="btn sm ghost" onClick={forget}><LogOut size={13} />Uită acest telefon</button></>}</footer>
        </>
      )}
    </div>
  );
}
