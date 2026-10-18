import { Radar, Siren, History, Crosshair, HelpCircle, ShieldQuestion, Users, FlaskConical, Trophy, GraduationCap, Sun, Scale, Rocket, Check, X, Eraser, ExternalLink } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useAction, pushToast, refresh } from "../../store.js";
import { withReauth } from "../../lib/ownerSession.js";
import { Notice, Chip, ErrorNotice } from "../../components/ui.jsx";
import { INCIDENT_RO, OBJECTIVE_RO, intelHref } from "../../lib/intelLogic.js";
import { CardShell } from "./cards.jsx";

const META = {
  incident: ["Incident propus", Siren, "warroom"], changes: ["Ce s-a schimbat", History, "twin"], impact: ["Impactul schimbării", Crosshair, "twin"],
  why: ["De ce am ales", HelpCircle, "twin"], blocked: ["Ce blochează proiectul", ShieldQuestion, "twin"], board: ["Ședința", Users, "board"],
  simulation: ["Scenariu", FlaskConical, "simulation"], league: ["Liga agenților", Trophy, "league"], lesson: ["Lecție propusă", GraduationCap, "lessons"],
  forget: ["Uită regula", Eraser, "lessons"], today: ["Ce avem azi", Sun, "today"], decisions: ["Decizii pentru tine", Scale, "decisions"], objectives: ["Obiective", Rocket, "autopilot"],
};
const VERDICT_RO = { "ÎN_CAPACITATE": "în capacitate", "LA_LIMITĂ": "la limită", "PESTE_CAPACITATE": "peste capacitate" };

/**
 * M08 Zero-Menu: the answer to a sentence ("X a picat", "ce s-a schimbat de ieri", "ce se întâmplă dacă…", "ține minte…") shown
 * in the cockpit itself, from the same Hub data as the full screen (link). Nothing here starts work; a lesson becomes a rule only
 * with your confirmation in the session.
 */
export function IntelResult({ result, kind, onDone, ...rest }) {
  const [title, Icon, tab] = META[kind] || ["Rezultat", Radar, "today"];
  const confirmLesson = useAction(async (path, toast) => { await withReauth(() => api(path, { method: "POST", body: {} })); pushToast(`lesson-${path}`, "ok", toast); refresh(); onDone?.(); });
  const r = result;
  const id = kind === "incident" ? r.incident?.incident?.id : kind === "simulation" ? r.simulation?.id : null;
  const link = <a className="btn sm ghost" href={`#${intelHref(tab, id)}`}><ExternalLink size={12} />Ecranul complet</a>;
  let body = null;
  if (kind === "incident") {
    const inc = r.incident.incident;
    body = <><p className="small"><strong>{inc.title}</strong> <Chip tone="neutral">{INCIDENT_RO[inc.status]}</Chip> {inc.priorityRecommended && <Chip tone="neutral">recomandat {inc.priorityRecommended.level}</Chip>}</p>
      <p className="faint small">{r.incident.note}</p>{r.incident.existingOpen && <p className="small">Există deja un incident deschis pe proiect.</p>}
      <ul className="small">{(r.incident.needed || []).slice(0, 4).map((n) => <li key={n}>{n}</li>)}</ul></>;
  } else if (kind === "changes") {
    const c = r.changes;
    body = <><p className="faint small">De la {fmt.dateTime(c.since)} ({c.sinceSource})</p>{c.items.length ? <ul className="plain small">{c.items.slice(-8).reverse().map((it, i) => <li key={i}><Chip tone="neutral">{it.kind}</Chip> {it.text} <span className="faint">{fmt.time(it.at)}</span></li>)}</ul> : <p className="small">{c.note}</p>}{c.offlineNote && <p className="faint small">{c.offlineNote}</p>}</>;
  } else if (kind === "impact") {
    const m = r.impact;
    body = m.components.length ? <><p className="small">Componente: {m.components.join(", ")} · schimbări anterioare {m.known.history.length} · incidente {m.known.incidents.length} · decizii {m.known.decisions.length}</p><p className="faint small">{m.limits}</p></> : <Notice tone="info">{m.unknowns.join(" · ")}</Notice>;
  } else if (kind === "why") {
    body = r.why.found ? <ul className="plain small">{r.why.decisions.map((d) => <li key={d.decisionId}><strong>{d.title}</strong>: {d.decision}{d.rationale ? ` — ${d.rationale}` : ""}</li>)}{r.why.board.map((b) => <li key={b.boardItemId}><strong>{b.title}</strong>{b.note ? `: ${b.note}` : ""}</li>)}</ul> : <Notice tone="info">{r.why.note}</Notice>;
  } else if (kind === "blocked") {
    body = r.blocked.chain.length ? <ol className="small intel-chain">{r.blocked.chain.slice(0, 5).map((c, i) => <li key={i}>{c.kind === "attention" ? "(atenție) " : ""}<strong>{c.what}</strong> — {c.why}<div className="faint">→ {c.next}</div></li>)}</ol> : <p className="small">{r.blocked.unknowns.join(" ")}</p>;
  } else if (kind === "board") {
    const m = r.board.meeting || r.board;
    body = <p className="small">{m.title} · {m.current ? <>acum: <strong>{m.current.title}</strong></> : "agenda goală"} · {m.remaining} rămase</p>;
  } else if (kind === "simulation") {
    const res = r.simulation.result;
    body = <><Chip tone="info">SIMULARE</Chip> {res.status === "COMPUTED"
      ? <span className="small">{res.result.single ? `${VERDICT_RO[res.verdict.single]} · utilizare ${res.result.single.utilizationPct}% · ${res.result.single.weeksNeeded} săpt. necesare` : `optimist ${VERDICT_RO[res.verdict.optimistic]} / pesimist ${VERDICT_RO[res.verdict.pessimistic]}`}</span>
      : <span className="small">Lipsesc: {res.missing.map((m) => m.label).join(", ")} — nu inventez cifre.</span>}</>;
  } else if (kind === "league") {
    body = <p className="small">{r.league.verdict === "INSUFFICIENT_EVIDENCE" ? "Date insuficiente pentru un clasament." : `${r.league.groups.length} grupe comparabile.`} {r.league.note}</p>;
  } else if (kind === "lesson") {
    const L = r.lesson;
    body = L.refused ? <Notice tone="warn" title="Refuzat">{L.reason}</Notice> : <>
      {L.lesson.parsed.trigger && <p className="small"><strong>Când:</strong> {L.lesson.parsed.trigger}</p>}
      <p className="small"><strong>Pași:</strong> {L.lesson.parsed.steps.join(" · ")}</p>
      <p className="faint small">{L.generalization || ""}{L.replaces ? ` Înlocuiește o regulă existentă.` : ""}</p>
      {L.securityDecision && <Notice tone="warn">{L.securityDecision.note}</Notice>}
      {L.lesson.status === "PROPOSED" && !L.securityDecision && <div className="row"><button className="btn sm primary" disabled={confirmLesson.pending} onClick={() => confirmLesson.run(`/api/lessons/${L.lesson.id}/confirm`, "Lecție activă")}><Check size={12} />Confirmă (sesiunea ta)</button>
        <button className="btn sm ghost" disabled={confirmLesson.pending} onClick={() => confirmLesson.run(`/api/lessons/${L.lesson.id}/dismiss`, "Renunțat")}><X size={12} />Renunță</button></div>}</>;
  } else if (kind === "forget") {
    const F = r.forget;
    body = F.matches?.length === 1 && F.effect ? <><p className="small">{F.effect}</p><button className="btn sm" disabled={confirmLesson.pending} onClick={() => confirmLesson.run(`/api/lessons/${F.matches[0].id}/forget/confirm`, "Regula nu se mai aplică")}><Eraser size={12} />Confirmă</button></>
      : <p className="small">{F.question || F.note}</p>;
  } else if (kind === "today") {
    body = <ul className="plain small">{r.today.headline.slice(0, 6).map((h, i) => <li key={i}>{h.title}</li>)}{!r.today.headline.length && <li>Nimic care să ceară atenția ta.</li>}</ul>;
  } else if (kind === "decisions") {
    body = <ul className="plain small">{r.decisions.slice(0, 6).map((d, i) => <li key={i}>{d.title}</li>)}{(r.packages || []).map((p) => <li key={p.id}>Pachet {p.kind}: {p.title}</li>)}{!r.decisions.length && !(r.packages || []).length && <li>Nicio decizie în așteptare.</li>}</ul>;
  } else if (kind === "objectives") {
    body = r.objectives.length ? <ul className="plain small">{r.objectives.slice(0, 6).map((o) => <li key={o.id}>{o.title} <Chip tone="neutral">{OBJECTIVE_RO[o.status] || o.status}</Chip> {o.progress.delivered}/{o.progress.total}</li>)}</ul> : <p className="small">Niciun obiectiv pe acest proiect.</p>;
  }
  return (
    <CardShell {...rest} title={title} icon={Icon} actions={link}>
      {body}
      <ErrorNotice error={confirmLesson.error} />
    </CardShell>
  );
}
