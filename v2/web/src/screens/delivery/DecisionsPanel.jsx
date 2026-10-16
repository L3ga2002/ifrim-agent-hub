import { Scale, ExternalLink, Ban } from "lucide-react";
import { Panel, Chip, Notice, ErrorNotice } from "../../components/ui.jsx";
import { confirmationHint, decisionGroups, decisionRows, PUBLISHING_ROW_TEXT } from "../../lib/deliveryLogic.js";

const DONE_TOAST = {
  software: "Software acceptat local (doar acest pachet; nimic altceva nu a fost aprobat)",
  creativeMaster: "Aprobarea creativă a clipului 16:9 a fost înregistrată din sesiunea ta",
  creativeVertical: "Aprobarea creativă a variantei 9:16 a fost înregistrată din sesiunea ta",
  summaryReady: "Rezumatul afișat e marcat „gata de prezentare”",
};
const PENDING_TEXT = { software: "Se verifică și se acceptă…", creativeMaster: "Se confirmă…", creativeVertical: "Se confirmă…", summaryReady: "Se înregistrează…" };

/**
 * The button (or Studio link) of ONE decision row. It sends exactly the request lib/deliveryLogic.js computed for that row — the
 * displayed bundle sha, the displayed edit version or the displayed summary sha — through the Room's single in-flight lock.
 * A disabled button always says why. Exported so the summary editor can show „Gata de prezentare” next to the text it approves.
 */
export function DecisionAction({ room, row, place = "" }) {
  const blocked = room.view.correction?.available && ['creativeMaster', 'creativeVertical', 'summaryReady'].includes(row?.key);
  const a = blocked && row?.action ? { ...row.action, enabled: false, reason: 'Afirmațiile acestei versiuni trebuie corectate; confirmă planul de corectură.' } : row?.action;
  if (!a) return null;
  const key = `decision:${row.key}`;
  // `place` keeps the ids unique when the same decision is offered in two panels (the summary editor and the decisions list).
  const reasonId = `livrare-decizie-${row.key}-motiv${place ? `-${place}` : ""}`;
  if (a.kind === "link") {
    return (
      <div className="row wrap">
        {a.enabled
          ? <a className="btn sm" href={a.href}><ExternalLink size={14} aria-hidden="true" />{a.label}</a>
          : <span className="small delivery-reason">{a.reason}</span>}
      </div>
    );
  }
  const send = () => room.run(key, () => room.client.send(a.request.path, a.request.body), { owner: a.needsSession, toast: DONE_TOAST[row.key] || "Decizie înregistrată" });
  return (
    <div className="stack tight">
      <div className="row wrap">
        <button type="button" className="btn approve" disabled={!a.enabled || !a.request} onClick={send} aria-describedby={a.reason || a.caution ? reasonId : undefined}>
          {room.busy === key ? PENDING_TEXT[row.key] || "Se trimite…" : a.label}
        </button>
        {confirmationHint(a, room.owner) && <span className="faint small">{confirmationHint(a, room.owner)}</span>}
      </div>
      {(a.reason || a.caution) && <p id={reasonId} className="small delivery-reason">{a.reason || a.caution}</p>}
      <ErrorNotice error={room.errorOf(key)} />
    </div>
  );
}

/**
 * One decision: what it is about, its state in words, what it does and what it does NOT mean, and its own action. A group with a
 * single row is already named by its heading, so the row starts with what exactly is being decided (the displayed id and sha).
 */
function DecisionRow({ room, row, titled }) {
  return (
    <li className={`delivery-decision tone-${row.chip.tone}`} data-decision={row.key} data-state={row.state}>
      <div className="row wrap between">
        {titled ? <strong>{row.title}</strong> : <span className="small mono faint break">{row.target}</span>}
        <Chip tone={row.chip.tone}>{row.chip.text}</Chip>
      </div>
      {titled && row.target && <p className="small mono faint break">{row.target}</p>}
      {row.does && <p className="small">{row.does}</p>}
      {row.doesNot && <p className="small faint"><strong>Nu înseamnă:</strong> {row.doesNot}</p>}
      {row.internalText && <p className="small">{row.internalText}</p>}
      {row.scopes?.length > 0 && (
        <ul className="delivery-chips" aria-label="Starea drepturilor pe fiecare tip de folosire publică">
          {row.scopes.map((s) => <li key={s.scope}><Chip tone={s.tone}>{s.label}: {s.text}</Chip></li>)}
        </ul>
      )}
      {row.anomaly && <Notice tone="warn">{row.anomaly}</Notice>}
      <DecisionAction room={room} row={row} />
    </li>
  );
}

/**
 * 6 · Deciziile tale — FIVE separate decisions, none implying another: software acceptance, creative approval (per version), rights
 * for public use, the summary „gata de prezentare”, and publishing, which is shown OFF and has no button. Each row reads only its own
 * record and sends only its own command; nothing is approved by opening or reading this page.
 */
export function DecisionsPanel({ room }) {
  const groups = decisionGroups(room.view, { session: room.session, busy: Boolean(room.busy), summaryDirty: room.summaryDirty });
  return (
    <Panel title="6 · Deciziile tale (cinci, separate)" icon={Scale} id="livrare-decizii-panel">
      <div className="stack">
        <p className="small">Fiecare decizie e a ta și stă singură: niciuna nu o bifează pe alta, iar pagina nu aprobă nimic doar pentru că ai deschis-o.</p>
        <ol className="delivery-decisions">
          {groups.map((g) => (
            <li key={g.key} className="delivery-decision-group" aria-labelledby={`livrare-grup-${g.key}`}>
              <h3 id={`livrare-grup-${g.key}`} className="delivery-h3">{g.title}</h3>
              {g.key === "publishing" ? (
                <div className="delivery-decision is-off" data-decision="publishing">
                  <p className="delivery-off-line"><Ban size={15} aria-hidden="true" /><strong>{PUBLISHING_ROW_TEXT}</strong></p>
                  <p className="small faint">{g.rows[0].doesNot}</p>
                  {g.rows[0].anomaly && <Notice tone="warn">{g.rows[0].anomaly}</Notice>}
                </div>
              ) : (
                <ul className="delivery-decision-rows">{g.rows.map((row) => <DecisionRow key={row.key} room={room} row={row} titled={g.rows.length > 1} />)}</ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/** The row of one decision for another panel (same data, same lock): used by the summary editor. */
export function decisionRowFor(room, key) {
  return decisionRows(room.view, { session: room.session, busy: Boolean(room.busy), summaryDirty: room.summaryDirty }).find((r) => r.key === key) || null;
}
