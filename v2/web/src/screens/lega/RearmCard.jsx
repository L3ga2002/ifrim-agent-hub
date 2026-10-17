import { useEffect, useId, useRef, useState } from "react";
import { ShieldAlert, Lock, RefreshCw, X, Eye } from "lucide-react";
import { api, fmt } from "../../api.js";
import { Panel, Notice, ErrorNotice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";
import { REARM_CARD_PATH, REARM_PATH, REARM_BUTTON_LABEL, REARM_SHOW_LABEL, SECURITY_ACK_LABEL, REARM_CHANGED_NOTICE, REARM_REQUEST_GONE_NOTICE, REARM_SETUP,
  isRearmCard, rearmReady, rearmRequestBody, continueAfterFetch, rearmErrorAction, rearmCardExpired, sameDisplayedCard, rearmTriggerDue, rearmRequestRefused,
  noAuthenticatorError, LEASES_ACK_LABEL, REARM_LEASES_BUTTON_LABEL, rearmLeaseSteps, rearmLeasesAckRequired, rearmLeasesOnly } from "../../lib/rearmLogic.js";

/**
 * M10.2.1 (D14–D16): the ONE card that reopens the execution gate after Stop All (or any suspension that is not the owner's own pause),
 * in the cockpit or Lega's panel. It shows what the Hub says — who stopped the gate and when, what was stopped, what stays stopped, the
 * security events around the stop — and confirms exactly that card (nonce + hash) in the owner session, with a FRESH Windows Hello
 * (withReauth opens the prompt once and repeats the same request). Click or Enter on the focused card; never voice. When the Hub listed
 * security events, „Am verificat cauza” must be ticked first. Nothing here retries on a timer or starts old work: after the rearm the
 * Hub re-proposes only the request this card was shown for, as a plan that still needs its own confirmation.
 *
 * Shapes: `card` (the Hub's card, from an intake answer); none (the cockpit banner, a blocker option, a refused resume: the click only
 * asks the card and SHOWS it — 2.12.1, UI-01: the full card is always on screen before the decision, and only a refreshed copy of a
 * card already on screen with the same facts goes on in the same gesture, rearmLogic.continueAfterFetch); `wait` (the stop is not
 * confirmed yet: the Hub's reason and „Verifică din nou”).
 * `trigger` / `handled` (UI-02): a click elsewhere (an option, a refused resume) as a ONE-SHOT sequence number whose handled state lives
 * in the caller (`onTriggerHandled(seq)`), so a remount never replays it; it only asks and shows the card, never confirms it.
 * `onRequestDropped` (UI-03): the kept request the card was asked for is no longer active — the card is asked without it.
 * `onApply(requestId)` (UI-07): told right before the rearm is sent, so the caller never focuses the plan it re-proposes.
 * `noAuthenticator` (UI-06): no enrolled authenticator — the setup step instead of a card that cannot work.
 * 2.12.2 (P0-R1): a workspace still reserved after an unconfirmed stop is a step INCLUDED in the card, as the Hub wrote it (stop the
 * process the Hub left behind, or release the reservation); when the Hub cannot prove its outcome, „Am înțeles, eliberează spațiul de
 * lucru” must be ticked first (bound to that card, like the security acknowledgement). Under the owner's own pause the card only
 * releases the reservation; „Continuă” reopens the pause afterwards.
 */
export function RearmCard({ card: given = null, requestId = null, wait: givenWait = null, hint = null, trigger = 0, handled = 0, compact = false, noAuthenticator = false,
  onDone, onClose, onSay, onTriggerHandled, onRequestDropped, onApply }) {
  const [card, setCard] = useState(() => (isRearmCard(given) ? given : null));
  const [wait, setWait] = useState(givenWait || null);
  const [ack, setAck] = useState(false);
  const [ackLeases, setAckLeases] = useState(false); // P0-R1: the reservation acknowledgement, bound to the card on screen
  const [phase, setPhase] = useState("idle"); // idle | fetching | applying
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [setup, setSetup] = useState(Boolean(noAuthenticator));
  const busy = useRef(false);
  const alive = useRef(true);
  const box = useRef(null);
  const cardRef = useRef(card); cardRef.current = card;
  const ackRef = useRef(ack); ackRef.current = ack;
  const ackLeasesRef = useRef(ackLeases); ackLeasesRef.current = ackLeases;
  // The kept request the card is asked for (UI-03: dropped once the Hub says it is no longer active).
  const ridRef = useRef(requestId || null);
  useEffect(() => { ridRef.current = requestId || null; }, [requestId]);
  // The owner status changed (an authenticator enrolled meanwhile, or the last one revoked): the card follows it.
  useEffect(() => { setSetup(Boolean(noAuthenticator)); }, [noAuthenticator]);
  const ids = useId();
  const howId = `${ids}-how`;
  const ackHintId = `${ids}-ack`;
  const secHeadId = `${ids}-sec`;
  const leaseHeadId = `${ids}-leases`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A newer card from the Hub (another answer for the same slot) replaces the one on screen; the acknowledgement belongs to a card.
  useEffect(() => {
    if (!isRearmCard(given) || given.nonce === cardRef.current?.nonce) return;
    if (!sameDisplayedCard(cardRef.current, given)) { setAck(false); setAckLeases(false); }
    setCard(given); setWait(null); setNotice(null); setError(null);
  }, [given?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (givenWait) { setWait(givenWait); setCard(null); } }, [givenWait?.code, givenWait?.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Asks the Hub's card (owner session; Windows Hello only if the session must be opened). UI-03: a kept request the Hub refuses as no
   * longer active is dropped and the card is asked ONCE more without it → { next, dropped }. Anything else is the caller's error.
   */
  const fetchCard = async () => {
    const rid = ridRef.current;
    try { return { next: await withReauth(() => api(REARM_CARD_PATH, { method: "POST", body: rid ? { requestId: rid } : {} })), dropped: false }; }
    catch (e) {
      if (!rid || !rearmRequestRefused(e)) throw e;
      ridRef.current = null;
      onRequestDropped?.();
      return { next: await withReauth(() => api(REARM_CARD_PATH, { method: "POST", body: {} })), dropped: true };
    }
  };
  /** A refused ceremony because no authenticator is enrolled (UI-06): the setup step, never a loop of the same refusal. */
  const failed = (e) => { if (!alive.current) return; if (noAuthenticatorError(e)) setSetup(true); else setError(e); };
  /** The Hub's "not here, not now" ({ eligible: false, code, reason }): the gate is already open, or the honest reason. */
  const notEligible = (out) => {
    if (out?.code === "OPEN") { onDone?.({ alreadyOpen: true }); return; }
    setCard(null); setAck(false); setAckLeases(false);
    setWait({ code: String(out?.code || "NOT_ELIGIBLE"), reason: String(out?.reason || "Poarta nu se poate redeschide acum.") });
  };
  /** Shows a new card; the acknowledgement survives only for the same facts. Returns the acknowledgement that applies to it. */
  const show = (next, previous = cardRef.current) => {
    const same = sameDisplayedCard(previous, next);
    if (!same) { setAck(false); setAckLeases(false); }
    setCard(next); setWait(null);
    return same ? ackRef.current : false;
  };
  /** P0-R1: the reservation acknowledgement that applies to a card asked again (only for the same facts). */
  const leasesAckFor = (next, previous) => (sameDisplayedCard(previous, next) ? ackLeasesRef.current : false);

  /** One rearm request; a card that is no longer the live one is asked again ONCE and re-sent only when its facts are the same. */
  const applyCard = async (c, modality, ackNow, ackLeasesNow = false) => {
    const send = (x, a, al = false) => { onApply?.(x.requestId || null); return withReauth(() => api(REARM_PATH, { method: "POST", body: rearmRequestBody(x, { ackSecurity: a, ackLeases: al, modality }) })); };
    let res;
    try { res = await send(c, ackNow, ackLeasesNow); }
    catch (e) {
      const act = rearmErrorAction(e);
      if (!alive.current) return;
      if (act.action === "refresh") {
        const { next, dropped } = await fetchCard();
        if (!alive.current) return;
        if (!isRearmCard(next)) { notEligible(next); return; }
        const same = sameDisplayedCard(c, next);
        const al = leasesAckFor(next, c);
        const a = show(next, c);
        if (dropped) { setNotice(REARM_REQUEST_GONE_NOTICE); return; }
        if (!(act.retry && same && (!next.security || a) && (!rearmLeasesAckRequired(next) || al))) { setNotice(`${act.message} Verifică cardul de mai jos și confirmă din nou.`); return; }
        res = await send(next, a, al);
      } else if (act.action === "wait" || act.action === "pause") { setCard(null); setWait({ code: act.code, reason: act.message }); return; }
      else if (act.action === "ack") { setNotice(act.message); return; }
      else if (act.action === "opened") { onDone?.({ alreadyOpen: true }); return; }
      else throw e;
    }
    if (alive.current) onDone?.(res);
  };

  /**
   * A card asked again is shown; what the owner reads with it: the request it no longer carries (UI-03), facts that changed since the
   * card on screen (UI-08), or the security events to read first. Returns the acknowledgement that applies to it.
   */
  const showFetched = (next, previous, dropped) => {
    const a = show(next, previous);
    if (dropped) setNotice(REARM_REQUEST_GONE_NOTICE);
    else if (isRearmCard(previous) && !sameDisplayedCard(previous, next)) setNotice(REARM_CHANGED_NOTICE);
    else if (next.security && !a) setNotice("Înainte de redeschidere: citește evenimentele de securitate, bifează „Am verificat cauza”, apoi confirmă.");
    else if (rearmLeasesAckRequired(next) && !leasesAckFor(next, previous)) setNotice(`Înainte de redeschidere: citește pasul inclus pentru spațiul de lucru rămas rezervat, bifează „${LEASES_ACK_LABEL}”, apoi confirmă.`);
    return a;
  };

  /**
   * The owner's gesture ON the card (its button / Enter): the decision. An expired card is asked again first and confirmed in the same
   * gesture only when it shows the same facts (and, with security events, the acknowledgement is ticked); otherwise it is shown.
   */
  const run = async (modality = "click") => {
    if (busy.current) return;
    busy.current = true; setError(null); setNotice(null);
    try {
      let c = cardRef.current;
      let ackNow = ackRef.current;
      let ackLeasesNow = ackLeasesRef.current;
      if (!isRearmCard(c) || rearmCardExpired(c)) {
        setPhase("fetching");
        const { next, dropped } = await fetchCard();
        if (!alive.current) return;
        if (!isRearmCard(next)) { notEligible(next); return; }
        const go = !dropped && continueAfterFetch({ previous: c, next, ack: ackNow, ackLeases: ackLeasesNow });
        if (!go) { showFetched(next, c, dropped); return; }
        ackLeasesNow = leasesAckFor(next, c);
        ackNow = show(next, c);
        c = next;
      }
      const ready = rearmReady(c, { ack: ackNow, ackLeases: ackLeasesNow });
      if (!ready.ready) {
        if (ready.why === "ack") setNotice("Bifează întâi „Am verificat cauza”: poarta nu se redeschide peste evenimente de securitate nevăzute.");
        else if (ready.why === "ack_leases") setNotice(`Bifează întâi „${LEASES_ACK_LABEL}”: spațiul de lucru rămas rezervat se eliberează doar cu confirmarea ta.`);
        return;
      }
      setPhase("applying");
      await applyCard(c, modality, ackNow, ackLeasesNow);
    } catch (e) { failed(e); }
    finally { busy.current = false; if (alive.current) setPhase("idle"); }
  };
  /** „Arată cardul de redeschidere” / „Verifică din nou”: only asks the Hub's card and shows it (never confirms anything). */
  const check = async () => {
    if (busy.current) return;
    busy.current = true; setError(null); setNotice(null); setPhase("fetching");
    try {
      const previous = cardRef.current;
      const { next, dropped } = await fetchCard();
      if (!alive.current) return;
      if (isRearmCard(next)) showFetched(next, previous, dropped); else notEligible(next);
    } catch (e) { failed(e); }
    finally { busy.current = false; if (alive.current) setPhase("idle"); }
  };

  // UI-02: a click elsewhere (a blocker option, a refused resume) reaches this card as a ONE-SHOT trigger whose handled state lives in
  // the caller: recorded as handled BEFORE anything runs, and read back from the caller on a remount (a cockpit reload error, a project
  // switch), so it is never replayed. It only brings the card into view and asks it when none is live — never the decision (UI-01).
  const handledRef = useRef(Number(handled) || 0);
  useEffect(() => {
    if (!rearmTriggerDue({ trigger, handled: Math.max(handledRef.current, Number(handled) || 0) })) return;
    handledRef.current = trigger;
    onTriggerHandled?.(trigger);
    box.current?.scrollIntoView?.({ block: "nearest" });
    const c = cardRef.current;
    if (!(isRearmCard(c) && !rearmCardExpired(c)) && !setup) check();
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = phase !== "idle";
  const security = card?.security || null;
  // P0-R1: the steps the Hub included for a workspace still reserved (as it wrote them) and their acknowledgement.
  const leaseSteps = rearmLeaseSteps(card);
  const leasesAck = rearmLeasesAckRequired(card);
  const leasesOnly = rearmLeasesOnly(card);
  const ackMissing = Boolean(security && !ack) || Boolean(leasesAck && !ackLeases);
  const missingLabels = [security && !ack ? SECURITY_ACK_LABEL : null, leasesAck && !ackLeases ? LEASES_ACK_LABEL : null].filter(Boolean).map((l) => `„${l}”`).join(" și ");
  const label = phase === "applying" ? "Redeschid poarta…" : phase === "fetching" ? "Citesc starea porții…" : card ? REARM_BUTTON_LABEL : REARM_SHOW_LABEL;
  const buttonLabel = leasesOnly ? (phase === "applying" ? "Eliberez spațiul de lucru…" : phase === "fetching" ? label : REARM_LEASES_BUTTON_LABEL) : label;
  // UI-10: Enter on the focused group is the same decision as the button (only for a card on screen; without one it only shows it).
  const onKeyDown = (e) => {
    if (e.key === "Enter" && e.target === box.current && !pending && !wait && !setup) { e.preventDefault(); if (card) run("keyboard"); else check(); }
  };
  const body = setup ? (
    // UI-06: no authenticator — the rearm cannot be confirmed; the honest step instead of a card that cannot work.
    <div ref={box} className="decision rearm" role="group" aria-label="Redeschiderea porții de execuție">
      <p className={compact ? "small" : "lead"}>{REARM_SETUP.text}</p>
      <div className="row wrap"><a className="btn sm primary" href={REARM_SETUP.href}>Deschide {REARM_SETUP.label}</a></div>
    </div>
  ) : (
    <div ref={box} tabIndex={0} className="decision rearm" role="group" aria-label="Redeschiderea porții de execuție"
      aria-keyshortcuts={card ? "Enter" : undefined} aria-describedby={howId} onKeyDown={onKeyDown}>
      {card ? (
        <>
          <p className={compact ? "small" : "lead"}>{card.headline}</p>
          {card.lines?.length > 0 && <ul className="plain decision-lines">{card.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          {card.stays?.length > 0 && (
            <div>
              <h3 className="h3">Ce rămâne oprit</h3>
              <ul className="plain decision-lines">{card.stays.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
          {/* UI-10: the security block is a plain region with its own heading, never a live region (the list and the checkbox are read
              once, when the owner reaches them); the Hub lists the NEWEST events first. */}
          {security && (
            <section className="notice warn rearm-security-block" aria-labelledby={secHeadId}>
              <ShieldAlert size={16} aria-hidden="true" />
              <div>
                <h3 className="h3" id={secHeadId}>Evenimente de securitate în jurul opririi</h3>
                {security.events?.length > 0
                  ? <ul className="plain small rearm-security">{security.events.map((ev) => <li key={ev.id}><strong>{ev.label}</strong> <span className="faint">{fmt.dateTime(ev.at)} · {ev.type}</span></li>)}</ul>
                  : <span className="small">Oprirea a fost una de securitate.</span>}
                {security.truncated && <div className="faint small">Afișez {security.order === "newest_first" ? "ultimele" : "primele"} {security.events.length} din {security.total}.</div>}
                <label className="rearm-ack"><input type="checkbox" checked={ack} disabled={pending} onChange={(e) => setAck(e.target.checked)} /> {SECURITY_ACK_LABEL}</label>
              </div>
            </section>
          )}
          {/* P0-R1: a workspace still reserved after an unconfirmed stop — the step is part of this decision (the Hub's own words). */}
          {leaseSteps.length > 0 && (
            <section className="notice warn rearm-leases-block" aria-labelledby={leaseHeadId}>
              <Lock size={16} aria-hidden="true" />
              <div>
                <h3 className="h3" id={leaseHeadId}>{leasesOnly ? "Ce fac acum" : "Inclus în redeschidere"}</h3>
                <ul className="plain small rearm-leases">{leaseSteps.map((s, i) => <li key={s.leaseId || i}>{s.text}</li>)}</ul>
                {leasesAck && <label className="rearm-ack"><input type="checkbox" checked={ackLeases} disabled={pending} onChange={(e) => setAckLeases(e.target.checked)} /> {LEASES_ACK_LABEL}</label>}
              </div>
            </section>
          )}
        </>
      ) : wait ? (
        <Notice tone={wait.code === "OWNER_PAUSE" ? "info" : "warn"} title={wait.code === "OWNER_PAUSE" ? "E pauza ta" : "Încă nu pot redeschide poarta"}>{wait.reason}</Notice>
      ) : (
        <p className={compact ? "small" : "lead"}>{hint || "Poarta de execuție e oprită: nimic nou nu pornește. O redeschizi aici, cu Windows Hello; nimic vechi nu repornește singur."}</p>
      )}
      {notice && <Notice tone="info">{notice}</Notice>}
      <div className="row wrap">
        {!wait && <button className={`btn ${compact ? "sm " : ""}primary`} disabled={pending || ackMissing} aria-describedby={ackMissing ? `${ackHintId} ${howId}` : howId}
          onClick={(e) => (card ? run(e.detail === 0 ? "keyboard" : "click") : check())}>{card ? <Lock size={compact ? 13 : 15} /> : <Eye size={compact ? 13 : 15} />}{buttonLabel}</button>}
        {wait && wait.code !== "OWNER_PAUSE" && <button className="btn sm" disabled={pending} onClick={check}><RefreshCw size={13} />{phase === "fetching" ? "Verific…" : "Verifică din nou"}</button>}
        {wait?.code === "OWNER_PAUSE" && onSay && <button className="btn sm" onClick={() => onSay("Continuă")}>„Continuă”</button>}
        {card
          ? <span className="faint small" id={howId}>valabil până la {fmt.time(card.expiresAt)} · legat de oprirea afișată · se confirmă cu click sau Enter, nu prin voce</span>
          : <span className="faint small" id={howId}>Primul click doar îți arată cardul (ce s-a oprit, ce rămâne oprit); redeschizi din card, cu click sau Enter, nu prin voce.</span>}
        {ackMissing && <span className="faint small" id={ackHintId}>Butonul se activează după ce bifezi {missingLabels}.</span>}
      </div>
      <ErrorNotice error={error} />
    </div>
  );
  if (compact) return <div className="rearm-inline">{body}</div>;
  return (
    <Panel title="Poarta de execuție" icon={ShieldAlert} className="cockpit-card size-l rearm-card"
      actions={onClose && <button className="btn sm icon ghost" onClick={onClose} disabled={pending} aria-label="Ascunde cardul de redeschidere"
        title={pending ? "Aștept răspunsul Hub-ului; cardul se poate ascunde după aceea" : undefined}><X size={13} /></button>}>
      {body}
    </Panel>
  );
}
