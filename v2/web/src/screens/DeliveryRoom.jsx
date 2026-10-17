import { useCallback, useEffect, useRef, useState } from "react";
import { PackageCheck, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import "../styles/m08.css";
import "../styles/m09.css";
import "../styles/m11.css";
import { api, fmt } from "../api.js";
import { onHubEvent, pushToast, usePref } from "../store.js";
import { withReauth, onLocalhost } from "../lib/ownerSession.js";
import { Chip, Empty, ErrorNotice, Loading, Notice } from "../components/ui.jsx";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";
import {
  deliveryRoute, deliveryHref, deliveryViewPath, deliveryListPath, deliveryActionPath, latestDelivery, deliveryReloadEvent, headerChips, verifyState,
  staleBanner, statusNotice, lineageLinks, spineTiles, ownerSessionState, repackageState, revisionOutcome, sentence,
} from "../lib/deliveryLogic.js";
import { PreviewPanel, ShotsPanel } from "./delivery/PreviewPanel.jsx";
import { SoftwarePanel } from "./delivery/SoftwarePanel.jsx";
import { ClipPanel, AnswerCard } from "./delivery/ClipPanel.jsx";
import { SummaryEditor } from "./delivery/SummaryEditor.jsx";
import { DecisionsPanel } from "./delivery/DecisionsPanel.jsx";
import { ObservationsPanel } from "./delivery/ObservationsPanel.jsx";
import { DecisionInbox } from "./delivery/DecisionInbox.jsx";
import { OfficePanel } from "./delivery/OfficePanel.jsx";

/**
 * The Room's data access, built on the existing API client only: one GET for the aggregated view, the delivery's allowlisted POST
 * actions, and the two existing reads it needs (owner session state, the sales catalog). `send` posts a request computed by
 * lib/deliveryLogic.js (its path comes from that module's own tables and validated ids, never from text in the view).
 * Injectable (`client` prop) so the screen can be driven without a Hub.
 */
export function createDeliveryClient(request = api) {
  const post = (path, body = {}) => request(path, { method: "POST", body });
  return Object.freeze({
    view: (id) => request(deliveryViewPath(id)),
    list: (projectId) => request(deliveryListPath(projectId)),
    owner: () => request("/api/owner/status"),
    services: () => request("/api/sales/services"),
    act: (id, key, body) => post(deliveryActionPath(id, key), body),
    send: (path, body) => post(path, body),
  });
}
const defaultClient = createDeliveryClient();

/**
 * Loads `load()` for `key` and reloads on matching Hub events (debounced). The last good data stays on screen while a reload runs or
 * fails (the error is shown next to it); a slower, older answer never overwrites a newer one; nothing is set after unmount.
 */
export function useLoaded(key, load, reloadOn = null) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(key), key });
  const seq = useRef(0);
  const alive = useRef(true);
  const loader = useRef(load);
  loader.current = load;
  const matcher = useRef(reloadOn);
  matcher.current = reloadOn;
  const reload = useCallback(async () => {
    if (!key) return null;
    const mine = ++seq.current;
    try {
      const data = await loader.current();
      if (alive.current && mine === seq.current) setState({ data, error: null, loading: false, key });
      return data;
    } catch (error) {
      if (alive.current && mine === seq.current) setState((s) => ({ ...s, error, loading: false }));
      return null;
    }
  }, [key]);
  useEffect(() => {
    alive.current = true;
    setState((s) => (s.key === key ? { ...s, loading: Boolean(key) } : { data: null, error: null, loading: Boolean(key), key }));
    reload();
    return () => { alive.current = false; };
  }, [key, reload]);
  useEffect(() => {
    if (!key) return undefined;
    let timer = null;
    const off = onHubEvent((event) => { if (matcher.current?.(event)) { clearTimeout(timer); timer = setTimeout(reload, 250); } });
    return () => { off(); clearTimeout(timer); };
  }, [key, reload]);
  // Data of another key is never shown for this one (the route changed while a request was in flight).
  return state.key === key ? { data: state.data, error: state.error, loading: state.loading, reload } : { data: null, error: null, loading: Boolean(key), reload };
}

/**
 * One write at a time in the whole Room: while a command is in flight every other button is disabled (`busy`, render state) and a
 * second activation is ignored, never queued. The ref lock covers what render state cannot: two activations in the same task, before
 * React has re-rendered the button as disabled (a scripted or assistive double activation), still send ONE request.
 * Owner-session commands run the Windows Hello ceremony once when the Hub asks for it, then repeat the call; a refusal is shown next
 * to the button that caused it and is never retried with more authority. The view is read again after every command, success or not.
 */
function useRoomActions(reload) {
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async (key, fn, { owner = false, toast = null } = {}) => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: null }));
    try {
      const out = owner ? await withReauth(fn) : await fn();
      const text = typeof toast === "function" ? toast(out) : toast;
      if (text) pushToast(`delivery-${key}`, "ok", text);
      return out === undefined ? null : out;
    } catch (error) {
      if (alive.current) setErrors((e) => ({ ...e, [key]: error }));
      return undefined;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
      reload();
    }
  }, [reload]);
  const errorOf = useCallback((key) => errors[key] || null, [errors]);
  return { busy, run, errorOf };
}

const SECTION_IDS = Object.freeze({ demo: "livrare-demo", software: "livrare-software", shots: "livrare-capturi", clip: "livrare-clip", summary: "livrare-rezumat", decisions: "livrare-decizii" });
/** In-page jump: the app routes by hash, so sections are reached by scrolling and focusing them, never by an anchor link. */
function jumpTo(sectionId) {
  const node = typeof document !== "undefined" ? document.getElementById(sectionId) : null;
  if (!node) return;
  node.scrollIntoView?.({ block: "start", behavior: "auto" });
  node.focus?.({ preventScroll: true });
}

/** The progress spine: five tiles, each in exactly one state said in words, each a button that jumps to its panel. */
function Spine({ tiles }) {
  return (
    <nav className="delivery-spine" aria-label="Starea livrării, pe cele cinci etape">
      <ol>
        {tiles.map((t, i) => (
          <li key={t.key}>
            <button type="button" className={`delivery-tile tone-${t.tone}`} onClick={() => jumpTo(t.target)} aria-label={`${t.title}: ${t.stateLabel}. ${t.text}. Mergi la secțiune.`}>
              <span className="delivery-tile-head"><span className="delivery-tile-n" aria-hidden="true">{i + 1}</span><strong>{t.title}</strong></span>
              <Chip tone={t.tone}>{t.stateLabel}</Chip>
              <span className="small delivery-tile-text">{t.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The red banner of a stale delivery: the reason, the changed files, what it means, the real replacement link, and ONE way forward. */
function StaleBanner({ banner, room, onAnswer }) {
  const again = repackageState(room.view, { session: room.session, owner: room.owner, busy: Boolean(room.busy) });
  return (
    <div className="delivery-stale" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="stack tight">
        <p><strong>{banner.title}.</strong> {sentence(banner.reason)}</p>
        <p className="small">{banner.consequence}</p>
        {banner.files.length > 0 && (
          <div>
            <p className="small"><strong>Fișiere schimbate față de versiunea testată:</strong></p>
            <ul className="delivery-files" aria-label="Fișiere schimbate">
              {banner.files.map((f) => <li key={f.path}><code className="mono">{f.path}</code>{f.status && <span className="faint small"> · {f.status}</span>}</li>)}
              {banner.more > 0 && <li className="faint small">… și încă {banner.more}</li>}
            </ul>
          </div>
        )}
        <div className="row wrap">
          {banner.replacement && <a className="btn sm primary" href={banner.replacement.href}><ArrowRight size={14} aria-hidden="true" />{banner.replacement.label}</a>}
          {again.offered && !banner.replacement && (
            <button type="button" className="btn sm" disabled={!again.enabled} aria-describedby="livrare-repackage-note"
              onClick={async () => { const out = await room.run("repackage", () => room.client.act(room.id, "packagePropose", {}), { owner: true }); if (out !== undefined) onAnswer(revisionOutcome(out)); }}>
              {room.busy === "repackage" ? "Se pregătește…" : again.label}
            </button>
          )}
        </div>
        {again.offered && !banner.replacement && <p id="livrare-repackage-note" className="faint small">{again.reason || again.note} Dacă s-a schimbat codul, spune mai jos ce vrei (cutia „Spune ce schimbi”): primești un singur card cu diferența.</p>}
        <ErrorNotice error={room.errorOf("repackage")} />
      </div>
    </div>
  );
}

/**
 * One part of the Room inside its own boundary: an unexpected shape in one deliverable (or in a reused card) never blanks the others
 * — in particular the decisions stay reachable. The failure is said in place, with a retry.
 */
function Guard({ name, resetKey, children }) {
  return (
    <ErrorBoundary label={`livrare:${name}`} resetKey={resetKey} fallback={(error, reset) => (
      <Notice tone="error" title={`„${name}” nu a putut fi afișat`}>{String(error?.message || error).slice(0, 200)} <button type="button" className="btn sm ghost" onClick={reset}>Reîncearcă</button></Notice>
    )}>{children}</ErrorBoundary>
  );
}

/**
 * The Room for one loaded view (presentational: everything it shows comes from `view` through lib/deliveryLogic.js). Viewing never
 * approves, accepts, starts or records anything; every effect is a command the Hub validates.
 */
export function DeliveryRoomView({ view, owner = null, client = defaultClient, reload = () => {}, refreshError = null }) {
  const d = view?.delivery || {};
  const actions = useRoomActions(reload);
  const [selection, setSelection] = useState(null);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [answers, setAnswers] = useState({ revise: null, repackage: null });
  const clipApi = useRef(null);
  const session = ownerSessionState(owner, { onLocalhost: typeof window === "undefined" ? true : onLocalhost() });
  const hubOrigin = typeof window === "undefined" ? "" : window.location.origin;
  // WebAuthn needs a domain: on http://127.0.0.1 the owner session cannot open; the same Hub answers on http://localhost:<port>.
  const localhostHref = session === "unavailable" && typeof window !== "undefined" && /^http:\/\/localhost:\d{2,5}$/.test(owner?.webauthnOrigin || "")
    ? `${owner.webauthnOrigin}${window.location.pathname}${window.location.hash}` : null;
  const setAnswer = useCallback((slot, outcome) => setAnswers((a) => ({ ...a, [slot]: outcome })), []);
  /** A row elsewhere in the Room points at a moment of a clip or at a panel: go there. */
  const jump = useCallback((target) => {
    if (!target) return;
    if (target.kind === "clip") { jumpTo(SECTION_IDS.clip); clipApi.current?.seek(target.role, target.ms); }
    else if (target.kind === "summary") jumpTo(SECTION_IDS.summary);
    else if (target.kind === "software") jumpTo(SECTION_IDS.software);
    else if (target.kind === "decisions") jumpTo(SECTION_IDS.decisions);
  }, []);
  // What every panel receives. Panels read it during render only (no effect depends on its identity).
  const room = { id: d.id, view, client, session, owner, hubOrigin, reload, jump, clipApi, selection, setSelection, summaryDirty, setSummaryDirty, answers, setAnswer, ...actions };

  const chips = headerChips(view);
  const check = verifyState(view);
  const banner = staleBanner(view);
  const notice = banner ? null : statusNotice(view);
  const tiles = spineTiles(view);
  const links = lineageLinks(view);
  const verify = () => actions.run("verify", () => client.act(d.id, "verify", {}), {
    toast: (out) => { const v = verifyState(out?.delivery ? out : { delivery: { verified: out?.verified || out } }); return v.equal === true ? "Snapshot identic: livrarea corespunde codului de acum" : v.equal === false ? "Workspace-ul diferă de versiunea testată" : "Verificare făcută"; },
  });
  // Screen readers hear a status change once (polite): the status words and, when stale, the reason.
  const announcement = `${chips[0].text}${banner ? `. ${banner.reason}` : ""}`;
  // A part that failed to render gets another try whenever a new view arrives.
  const viewTick = useRef(0);
  const lastView = useRef(view);
  if (lastView.current !== view) { lastView.current = view; viewTick.current += 1; }
  const hiddenPlanIds = [answers.revise, answers.repackage].filter((a) => a?.kind === "ops").map((a) => a.plan.id);

  return (
    <div className="page delivery">
      <div className="page-head delivery-head">
        <div className="delivery-title">
          <p className="section-title"><PackageCheck size={14} aria-hidden="true" /> Camera de livrare</p>
          <h1>{d.title || "Livrare"}</h1>
          <p>
            {d.projectId ? <a href={`#/lega/${encodeURIComponent(d.projectId)}`}>{d.projectName || d.projectId}</a> : d.projectName || "—"}
            {" · "}<code className="mono">{d.id}</code>
          </p>
          <ul className="delivery-chips" aria-label="Starea și etichetele livrării">
            {chips.map((c) => <li key={c.key}><Chip tone={c.tone}>{c.text}</Chip></li>)}
          </ul>
          {links.length > 0 && <p className="small">{links.map((l, i) => <span key={l.key}>{i > 0 && " · "}<a href={l.href}>{l.label}</a></span>)}</p>}
        </div>
        <div className="delivery-verify">
          <div className="row wrap">
            <Chip tone={check.tone}>{check.text}</Chip>
            {check.at && <span className="faint small">verificat {fmt.dateTime(check.at)}</span>}
          </div>
          <button type="button" className="btn" disabled={Boolean(actions.busy)} onClick={verify} aria-describedby="livrare-verify-help">
            <RefreshCw size={15} aria-hidden="true" />{actions.busy === "verify" ? "Se verifică…" : "Verifică acum"}
          </button>
          <p id="livrare-verify-help" className="faint small">Compară workspace-ul cu versiunea testată. Poate doar să marcheze livrarea ca învechită; nu aprobă nimic.</p>
          <ErrorNotice error={actions.errorOf("verify")} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {refreshError && <Notice tone="warn" title="Nu am putut reîmprospăta">{refreshError.message} Vezi ultima stare încărcată. <button type="button" className="btn sm ghost" onClick={reload}>Reîncearcă</button></Notice>}
      {session === "unavailable" && (
        <Notice tone="warn" title="Deciziile nu se pot lua de pe această adresă">
          Acceptarea, aprobările și schimbările cer sesiunea ta de proprietar (Windows Hello), care se deschide doar pe http://localhost. Aici poți doar citi.
          {localhostHref && <> <a href={localhostHref}>Deschide aceeași pagină pe localhost</a></>}
        </Notice>
      )}
      {banner && <StaleBanner banner={banner} room={room} onAnswer={(o) => setAnswer("repackage", o)} />}
      {notice && <Notice tone={notice.tone} title={notice.title}>{notice.text}{notice.link && <> <a href={notice.link.href}>{notice.link.label}</a></>}</Notice>}
      {answers.repackage && <AnswerCard outcome={answers.repackage} room={room} slot="repackage" />}
      {view.correction?.available && <Notice tone="warn" title="Corectură afirmații">
        {view.correction.reason || `Afirmațiile din clip și din rezumat nu corespund criteriilor aprobate (${view.correction.defects.length} probleme). Corectura e pregătită ca plan; o confirmi tu.`}
        <ul>{view.correction.defects.map((f, i) => <li key={i}>{f.plain}</li>)}</ul>
        {!view.correction.plan && <button className="btn" disabled={Boolean(room.busy) || session === 'unavailable'} onClick={() => room.run('correction', () => room.client.act(view.delivery.id, 'correctionPropose'), { owner: true, toast: 'Corectura este pregătită ca plan' })}>{view.delivery.status === 'NEEDS_OWNER' ? 'Pregătește din nou corectura' : 'Pregătește corectura'}</button>}
        <ErrorNotice error={room.errorOf('correction')} />
      </Notice>}
      <Spine tiles={tiles} />
      <div className="delivery-sections">
        <div id={SECTION_IDS.demo} tabIndex={-1} className="delivery-section"><Guard name="Demo local" resetKey={viewTick.current}><PreviewPanel room={room} /></Guard></div>
        <div id={SECTION_IDS.software} tabIndex={-1} className="delivery-section"><Guard name="Software" resetKey={viewTick.current}><SoftwarePanel room={room} /></Guard></div>
        <div id={SECTION_IDS.shots} tabIndex={-1} className="delivery-section"><Guard name="Capturi" resetKey={viewTick.current}><ShotsPanel room={room} /></Guard></div>
        <div id={SECTION_IDS.clip} tabIndex={-1} className="delivery-section"><Guard name="Clip" resetKey={viewTick.current}><ClipPanel room={room} /></Guard></div>
        <div id={SECTION_IDS.summary} tabIndex={-1} className="delivery-section"><Guard name="Rezumat" resetKey={viewTick.current}><SummaryEditor room={room} /></Guard></div>
        {view?.office?.requested?.length ? <div id="livrare-dosar" tabIndex={-1} className="delivery-section"><Guard name="Dosar" resetKey={viewTick.current}><OfficePanel room={room} /></Guard></div> : null}
        <div id={SECTION_IDS.decisions} tabIndex={-1} className="delivery-section delivery-last">
          <Guard name="Observații" resetKey={viewTick.current}><ObservationsPanel room={room} hiddenPlanIds={hiddenPlanIds} /></Guard>
          <Guard name="Decizii" resetKey={viewTick.current}><DecisionsPanel room={room} /></Guard>
        </div>
      </div>
    </div>
  );
}

/** `#/livrare/<dlv>`: loads the view, keeps it fresh on Hub events, and shows loading / error / not-found honestly. */
function DeliveryRoomLoader({ deliveryId, client }) {
  const shown = useRef(null);
  const view = useLoaded(deliveryId, () => client.view(deliveryId), (event) => deliveryReloadEvent(event, shown.current));
  shown.current = view.data;
  const owner = useLoaded(`owner:${deliveryId}`, () => client.owner(), (e) => e.type.startsWith("owner."));
  if (view.loading && !view.data) return <div className="page delivery" aria-busy="true"><div className="page-head"><div><h1>Camera de livrare</h1><p>Se încarcă livrarea…</p></div></div><Loading lines={6} /></div>;
  if (!view.data) {
    const missing = view.error?.status === 404;
    return (
      <div className="page delivery">
        <div className="page-head"><div><h1>Camera de livrare</h1><p><code className="mono">{deliveryId}</code></p></div></div>
        {missing
          ? <Empty title="Livrarea nu există pe acest Hub" action={<a className="btn sm" href="#/lega">Înapoi la cockpit</a>}>Poate a fost creată pe alt Hub sau adresa e greșită. Un Hub care nu are încă Ifrim Delivery (M11) răspunde la fel.</Empty>
          : <ErrorNotice error={view.error || { message: "Hub-ul nu a răspuns cu o livrare." }} onRetry={view.reload} />}
      </div>
    );
  }
  if (!view.data.delivery?.id) return <div className="page delivery"><Notice tone="error" title="Răspuns neașteptat">Hub-ul a răspuns fără datele livrării; reîncarcă pagina. <button type="button" className="btn sm ghost" onClick={view.reload}>Reîncearcă</button></Notice></div>;
  return <DeliveryRoomView view={view.data} owner={owner.data} client={client} reload={view.reload} refreshError={view.error} />;
}

/** `#/livrare` without an id: the latest delivery of the cockpit project (or of `?projectId=`), opened by replacing the address. */
function LatestDelivery({ projectId, go, client }) {
  const [cockpitProject] = usePref("lega.project", "");
  const pid = projectId || (typeof cockpitProject === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(cockpitProject) ? cockpitProject : null);
  const list = useLoaded(pid ? `list:${pid}` : null, () => client.list(pid));
  const latest = list.data ? latestDelivery(list.data) : null;
  useEffect(() => {
    if (!latest) return;
    // Replace (not push): „înapoi” returns to where the owner came from, not to this lookup.
    if (typeof window !== "undefined" && window.location?.replace) window.location.replace(`#${deliveryHref(latest)}`);
    else go(deliveryHref(latest));
  }, [latest, go]);
  return (
    <div className="page delivery">
      <div className="page-head"><div><h1>Camera de livrare</h1><p>Software-ul verificat, demo-ul local, clipul și rezumatul comercial ale unei livrări, într-un singur loc. Nimic nu se publică de aici.</p></div></div>
      {!pid ? <Empty title="Niciun proiect ales" action={<a className="btn sm" href="#/lega">Deschide cockpitul</a>}>Alege un proiect în cockpit, apoi spune-i lui Lega: „Pregătește demo-ul pentru prezentare”.</Empty>
        : list.loading && !list.data ? <Loading lines={4} />
          : list.error ? <ErrorNotice error={list.error} onRetry={list.reload} />
            : latest ? <Loading lines={4} />
              : <Empty title="Nicio livrare pentru acest proiect" action={<a className="btn sm" href={`#/lega/${encodeURIComponent(pid)}`}>Deschide cockpitul proiectului</a>}>Spune-i lui Lega, într-o singură frază: „Pregătește demo-ul pentru prezentare: repară problema convenită, pregătește un clip și un rezumat comercial. Nu publica nimic.”</Empty>}
    </div>
  );
}

/**
 * M11 — Camera de livrare (`#/livrare/:id`). One room for the six deliverables of a delivery: the local demo and how to run it; the
 * software with its diff, review and tests bound to the exact snapshot; the E2E screenshots on desktop and at phone width; the clip
 * (16:9 and 9:16) with QA and versions; the commercial summary, edited by section; the remaining observations and the owner's five
 * separate decisions. Opening it only reads. Nothing here publishes, uploads or sends anything.
 */
export default function DeliveryRoom({ id, query, go, client = defaultClient }) {
  // M11 „Deciziile mele”: #/livrare/decizii lists every result waiting for the owner (read-only).
  if (id === "decizii") return <DecisionInbox go={go} />;
  const route = deliveryRoute(id, query);
  if (route.invalid) {
    return (
      <div className="page delivery">
        <div className="page-head"><div><h1>Camera de livrare</h1></div></div>
        <Empty title="Adresă de livrare nevalidă" action={<a className="btn sm" href="#/livrare">Deschide ultima livrare</a>}>Identificatorul din adresă nu arată ca o livrare (dlv_…).</Empty>
      </div>
    );
  }
  if (!route.deliveryId) return <LatestDelivery projectId={route.projectId} go={go} client={client} />;
  return <DeliveryRoomLoader key={route.deliveryId} deliveryId={route.deliveryId} client={client} />;
}
