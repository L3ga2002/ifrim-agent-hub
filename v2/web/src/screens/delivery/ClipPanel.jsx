import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, MessageSquareText, Send, X } from "lucide-react";
import { Panel, Chip, Notice, ErrorNotice } from "../../components/ui.jsx";
import { Player } from "../studio/Player.jsx";
import { OpsPlanCard } from "../lega/OpsPlanCard.jsx";
import { DecisionCard } from "../lega/cards.jsx";
import { DecisionAction, decisionRowFor } from "./DecisionsPanel.jsx";
import {
  clipSlots, selectionFor, selectionValid, revisionAvailability, revisionBody, revisionOutcome, clarificationReply, revisionRows, fmtClock,
  sessionGate, sessionLabel, sentence, REVISION_LIMITS,
} from "../../lib/deliveryLogic.js";

const CREATIVE_TEXT = { APPROVED: ["ok", "creație aprobată de tine"], PENDING: ["approval", "creație: în așteptarea ta"], CHANGES: ["warn", "creație: modificări cerute"], REJECTED: ["error", "creație respinsă"] };

/** The automated QA of one version: the overall chip, the six kinds, and the findings nobody justified (with a jump to their moment). */
function QaBlock({ slot, onSeek, muted = false }) {
  return (
    <div className="stack tight">
      <ul className="delivery-chips" aria-label={`QA automat pentru ${slot.title}`}>
        <li><Chip tone={muted ? "neutral" : slot.qa.tone}>{slot.qa.text}</Chip></li>
        {slot.qa.kinds.map((k) => <li key={k.kind}><Chip tone={muted ? "neutral" : k.tone}>{k.text}</Chip></li>)}
      </ul>
      {slot.qa.unjustified.length > 0 && (
        <ul className="studio-findings compact" aria-label="Constatări QA nejustificate">
          {slot.qa.unjustified.map((f, i) => (
            <li key={`${f.code}-${i}`}>
              <Chip tone="neutral">{f.kindLabel}</Chip> <span className="small">{f.message || f.code}</span>
              {f.ms !== null && onSeek && <> <button type="button" className="link-btn mono small" onClick={() => onSeek(f.ms)} aria-label={`Mergi la ${fmtClock(f.ms)}`}>{fmtClock(f.ms)}</button></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Versions of this clip line with the links the Hub really recorded („v2 înlocuiește v1”); a missing link is said, not drawn. */
function VersionLine({ slot }) {
  if (slot.versions.length < 2) return null;
  return (
    <ol className="delivery-versions" aria-label={`Versiunile pentru ${slot.title}`}>
      {slot.versions.map((v) => (
        <li key={v.id}>
          <Chip tone={v.tone}>v{v.n} · {v.text}</Chip>
          {v.supersedes ? <span className="faint small"> înlocuiește v{v.supersedes}</span> : !v.linked ? <span className="faint small"> (legătura cu versiunea anterioară lipsește)</span> : null}
          {v.staleReason && <span className="small delivery-reason"> — {v.staleReason}</span>}
        </li>
      ))}
    </ol>
  );
}

/** A stale or superseded player: collapsed behind its label; the video is not even requested until the owner opens it. */
function OldClip({ slot }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="delivery-old" data-clip={slot.key} data-mode="old" data-evidence="none" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{slot.collapsedLabel}</summary>
      <div className="stack tight">
        <p className="small delivery-reason">{sentence(slot.why?.text)} Îl poți privi, dar nu este dovadă pentru codul de acum și nu se aprobă.</p>
        {open && slot.playable && <div className={`delivery-player aspect-${slot.key}`}><Player assetVersionId={slot.assetVersionId} fps={slot.fps} label={`${slot.title} — versiunea veche`} /></div>}
        {open && !slot.playable && <p className="faint small">Versiunea veche nu are o randare păstrată.</p>}
        <QaBlock slot={slot} muted />
      </div>
    </details>
  );
}

/** The creative decision of this clip, offered under its player (the same row, request and lock as the decisions panel). */
function CreativeHere({ room, slotKey }) {
  const row = decisionRowFor(room, slotKey === "master" ? "creativeMaster" : "creativeVertical");
  if (!row?.action) return null;
  return <div className="delivery-creative-here"><DecisionAction room={room} row={row} place="clip" /></div>;
}

/** The current version of one format: player, labels, QA, versions, the marker list (seeks) and the text items (selection). */
function CurrentClip({ slot, room, register, onTime }) {
  const ref = useRef(null);
  useEffect(() => register(slot.key, ref), [register, slot.key]);
  const seek = (ms) => ref.current?.seek(ms);
  const [cTone, cText] = CREATIVE_TEXT[slot.creative] || CREATIVE_TEXT.PENDING;
  // The same text id exists in both clips (t-hook in 16:9 and in 9:16); the edit version says which clip a selection belongs to.
  const picked = (item) => room.selection?.kind === "text" && room.selection.id === item.id && room.selection.versionId === slot.editVersionId;
  return (
    <div className="stack tight" data-clip={slot.key} data-mode="current" data-evidence={slot.evidence ? "current" : "none"}>
      <ul className="delivery-chips" aria-label={`Etichetele pentru ${slot.title}`}>
        {slot.version && <li><Chip tone="neutral">v{slot.version}</Chip></li>}
        <li><Chip tone={slot.label.tone}>{slot.label.text}</Chip></li>
        <li><Chip tone="neutral">{slot.durationText}</Chip></li>
        <li><Chip tone={slot.evidence ? "ok" : "warn"}>{slot.evidence ? "dovadă curentă" : "nu contează ca dovadă"}</Chip></li>
        <li><Chip tone={cTone}>{cText}</Chip></li>
      </ul>
      {slot.playable
        ? <div className={`delivery-player aspect-${slot.key}`}><Player key={slot.assetVersionId} ref={ref} assetVersionId={slot.assetVersionId} fps={slot.fps} label={slot.title} onTime={onTime} /></div>
        : null}
      {slot.evidenceNote && <Notice tone="warn">{slot.evidenceNote}</Notice>}
      <QaBlock slot={slot} onSeek={slot.playable ? seek : null} />
      {/* Pilot 2026-10-08: the owner looked for the creative approval next to the clip; the same decision row as in „6 · Deciziile tale”. */}
      {slot.creative !== "APPROVED" && <CreativeHere room={room} slotKey={slot.key} />}
      <VersionLine slot={slot} />
      {slot.markers.length > 0 && (
        <div>
          <h4 className="delivery-h4">Momente</h4>
          <ul className="delivery-markers">
            {slot.markers.map((m) => (
              <li key={m.key}><button type="button" className="btn sm ghost" disabled={!slot.playable} onClick={() => seek(m.ms)} aria-label={m.aria}><span className="mono">{m.clock}</span> {m.label}</button></li>
            ))}
          </ul>
        </div>
      )}
      {slot.textItems.length > 0 && (
        <div>
          <h4 className="delivery-h4" id={`livrare-texte-${slot.key}`}>Texte pe ecran <span className="faint">(alege unul ca să spui ce schimbi la el)</span></h4>
          <ul className="delivery-texts" aria-labelledby={`livrare-texte-${slot.key}`}>
            {slot.textItems.map((t) => (
              <li key={t.id}>
                {t.selectable ? (
                  <button type="button" className="btn sm" aria-pressed={picked(t)}
                    onClick={() => { if (picked(t)) room.setSelection(null); else { room.setSelection(selectionFor(slot, t.id)); if (t.startMs !== null) seek(t.startMs); } }}>
                    <span className="mono faint">{t.range}</span> „{t.text}”
                  </button>
                ) : <span className="small faint"><span className="mono">{t.range}</span> „{t.text}” · etichetă obligatorie, nu se editează</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The Hub's ONE answer to a request made in the Room: the ONE clarification (≤ 3 buttons), the ONE difference card (an operation
 * plan or, for a software change, the mission plan — each confirmed once on the card itself) or a note. Never two cards.
 */
export function AnswerCard({ outcome, room, slot = "revise" }) {
  if (!outcome) return null;
  const close = () => room.setAnswer(slot, null);
  const action = slot === "repackage" ? "packagePropose" : "revise";
  const runKey = `answer:${slot}`;
  const answer = async (option) => {
    const out = await room.run(runKey, () => room.client.act(room.id, action, clarificationReply(outcome, option, outcome.request)), { owner: true });
    if (out !== undefined) room.setAnswer(slot, { ...revisionOutcome(out), request: outcome.request });
  };
  const projectId = room.view?.delivery?.projectId;
  const notes = (outcome.notes || []).length > 0 && <ul className="plain small">{outcome.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>;
  return (
    <div className="delivery-answer" aria-live="polite" data-answer={outcome.kind}>
      {outcome.kind === "question" && (
        <Notice tone="warn" title="O singură întrebare">
          {outcome.question}
          {outcome.options.length > 0 && (
            <span className="studio-options">
              {outcome.options.map((o) => <button key={o.id} type="button" className="btn sm" disabled={Boolean(room.busy)} onClick={() => answer(o)}>{o.label}</button>)}
            </span>
          )}
          <span className="faint small block">Nimic nu se schimbă până nu răspunzi; poți și să scrii răspunsul în cutia de mai sus.</span>
        </Notice>
      )}
      {outcome.kind === "ops" && <OpsPlanCard plan={outcome.plan} card={{ type: "OpsPlan", size: "l" }} onClose={close} />}
      {outcome.kind === "envelope" && (
        <>
          <Notice tone="info" title="Asta schimbă aplicația">Software-ul se schimbă doar printr-un plan separat, cu confirmarea lui: vezi mai jos doar diferența (misiunea nouă, apoi captura, clipul și rezumatul refăcute). Clipul și rezumatul de acum rămân neatinse până atunci.</Notice>
          {outcome.plan.summary?.headline
            ? <DecisionCard plan={outcome.plan} owner={room.owner} card={{ type: "DecisionCard", size: "l" }} onConfirmed={() => room.reload()} onCancel={close} />
            : <Notice tone="warn" title="Planul te așteaptă în cockpit">Hub-ul a pregătit planul <code className="mono">{outcome.plan.envelope.id}</code>, dar fără rezumatul lui; îl vezi și îl confirmi în cockpit. {projectId && <a href={`#/lega/${encodeURIComponent(projectId)}`}>Deschide cockpitul proiectului</a>}</Notice>}
        </>
      )}
      {(outcome.kind === "message" || outcome.kind === "empty") && (
        <Notice tone={outcome.tone || "info"}>
          {outcome.message} <button type="button" className="btn sm ghost" onClick={close}><X size={13} aria-hidden="true" />Închide</button>
        </Notice>
      )}
      {notes}
      <ErrorNotice error={room.errorOf(runKey)} />
    </div>
  );
}

/**
 * „Spune ce schimbi”: one sentence, sent as { text, selection, timecodeMs, player }. The selection is the text item picked above (with
 * the player it was picked in); the moment is attached only when the owner ticks it (a timecode makes the sentence about a clip), with
 * the player it was taken in — so a moment of the 9:16 player targets the vertical variant. Enter sends; Shift+Enter is a new line.
 */
function RevisionBox({ room, moment }) {
  const [text, setText] = useState("");
  const [atMoment, setAtMoment] = useState(false);
  const [localError, setLocalError] = useState("");
  const avail = revisionAvailability(room.view);
  const gate = sessionGate(room.session);
  const disabledReason = !avail.enabled ? avail.reason : gate.blocked ? gate.reason : "";
  const canSend = !disabledReason && !room.busy && text.trim().length >= REVISION_LIMITS.min;
  const selection = room.selection && selectionValid(room.view, room.selection) ? room.selection : null;
  const send = async () => {
    if (!canSend) return;
    const built = revisionBody({ text, selection, timecodeMs: atMoment && moment ? moment.ms : null, player: atMoment && moment ? moment.key : null }, room.view);
    if (!built.ok) { setLocalError(built.error); return; }
    setLocalError("");
    const out = await room.run("revise", () => room.client.act(room.id, "revise", built.body), { owner: true });
    if (out === undefined) return;
    room.setAnswer("revise", { ...revisionOutcome(out), request: { body: built.body } });
    setText(""); setAtMoment(false);
  };
  const onKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send(); } };
  return (
    <form className="delivery-revise stack tight" aria-label="Cere o schimbare" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <label className="field">
        <span><MessageSquareText size={13} aria-hidden="true" /> Spune ce schimbi</span>
        <textarea className="textarea" rows={2} maxLength={REVISION_LIMITS.max} value={text} disabled={Boolean(disabledReason)} aria-describedby="livrare-revise-help"
          placeholder="de exemplu: Clipul este prea tehnic; după secunda zece arată direct programarea." onChange={(e) => { setText(e.target.value); if (localError) setLocalError(""); }} onKeyDown={onKeyDown} />
      </label>
      <div className="row wrap">
        {selection && (
          <span className="row delivery-attach">
            <Chip tone="info">text ales: {selection.id}{selection.player ? ` · ${selection.player === "vertical" ? "9:16" : "16:9"}` : ""}</Chip>
            <button type="button" className="btn sm ghost icon" onClick={() => room.setSelection(null)} aria-label="Renunță la textul ales"><X size={13} /></button>
          </span>
        )}
        {moment && (
          <label className="check"><input type="checkbox" checked={atMoment} disabled={Boolean(disabledReason)} onChange={(e) => setAtMoment(e.target.checked)} />la momentul <span className="mono">{fmtClock(moment.ms)}</span> din {moment.title}</label>
        )}
        <button type="submit" className="btn primary" disabled={!canSend}><Send size={15} aria-hidden="true" />{room.busy === "revise" ? "Se trimite…" : sessionLabel("Trimite", room.session)}</button>
      </div>
      <p id="livrare-revise-help" className="faint small">
        {disabledReason || "Enter trimite, Shift+Enter face rând nou. Primești un singur card cu diferența sau o singură întrebare. „Site-ul e bine” e doar o notă: acceptarea rămâne decizia ta separată, iar un text nu devine niciodată cod."}
      </p>
      {localError && <Notice tone="warn">{localError}</Notice>}
      <ErrorNotice error={room.errorOf("revise")} />
    </form>
  );
}

/**
 * 4 · Clipul. Master 16:9 and vertical 9:16 from the delivery's own renders, each with its label, QA chips, versions and real links
 * between versions, the marker list (seeks the player) and the text items (selection). A stale or superseded player is never shown as
 * current: it sits collapsed behind „Clip pentru versiunea veche (bnd_…) — nu dovedește codul nou”. Below: the revision box.
 */
export function ClipPanel({ room }) {
  const slots = clipSlots(room.view);
  const players = useRef({});
  const [moment, setMoment] = useState(null); // { key, title, ms } of the player the owner last moved
  const titles = useRef({});
  for (const s of slots) titles.current[s.key] = s.title;
  const register = useCallback((key, ref) => { players.current[key] = ref; return () => { if (players.current[key] === ref) delete players.current[key]; }; }, []);
  // Rows elsewhere in the Room (an observation, a QA finding) can seek a player through the Room.
  const clipApi = room.clipApi;
  useEffect(() => {
    clipApi.current = { seek: (role, ms) => players.current[role]?.current?.seek(ms) };
    return () => { clipApi.current = null; };
  }, [clipApi]);
  // A selection made on a version that is no longer the current one is dropped (never sent).
  const { selection, setSelection, view } = room;
  useEffect(() => { if (selection && !selectionValid(view, selection)) setSelection(null); }, [view, selection, setSelection]);
  // The player reports its time every frame while it plays: the Room only needs tenths of a second. A player that merely loaded
  // (time 0) never takes „the current moment” away from the one the owner positioned.
  const onTimeOf = useRef({});
  const timeHandler = (key) => {
    if (!onTimeOf.current[key]) {
      onTimeOf.current[key] = (ms) => setMoment((m) => {
        const t = Math.max(0, Math.round((Number(ms) || 0) / 100) * 100);
        if (m && m.key === key && m.ms === t) return m;
        if (t === 0 && m && m.key !== key) return m;
        return { key, title: titles.current[key], ms: t };
      });
    }
    return onTimeOf.current[key];
  };
  const answer = room.answers.revise;
  const past = revisionRows(room.view);
  // „The current moment” is offered only while the player it was taken in still shows the current version of its clip.
  const momentCurrent = Boolean(moment) && slots.some((s) => s.key === moment.key && s.mode === "current");
  return (
    <Panel title="4 · Clipul" icon={Clapperboard} id="livrare-clip-panel">
      <div className="stack">
        <div className="delivery-clips">
          {slots.map((slot) => (
            <section key={slot.key} className={`delivery-clip is-${slot.key}`} aria-labelledby={`livrare-clip-${slot.key}`}>
              <h3 id={`livrare-clip-${slot.key}`} className="delivery-h3">{slot.title}</h3>
              {slot.mode === "missing" && <Notice tone="info">{slot.missingText}</Notice>}
              {slot.mode === "old" && <OldClip slot={slot} />}
              {slot.mode === "current" && <CurrentClip slot={slot} room={room} register={register} onTime={timeHandler(slot.key)} />}
            </section>
          ))}
        </div>
        <RevisionBox room={room} moment={momentCurrent && moment.ms > 0 ? moment : null} />
        <AnswerCard outcome={answer} room={room} slot="revise" />
        {past.length > 0 && (
          <details className="studio-details">
            <summary>Ce ai cerut până acum ({past.length})</summary>
            <ul className="intel-list delivery-plain">
              {past.map((r) => (
                <li key={r.id} className="stack tight">
                  <span className="small">„{r.text}”</span>
                  <span className="row wrap"><Chip tone={r.tone}>{r.statusText}</Chip>{r.classes.map((c) => <Chip key={c} tone="neutral">{c}</Chip>)}{r.planId && <span className="faint small mono">{r.planId}</span>}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}
