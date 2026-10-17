import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, Link2, Check, X, MessageSquareText, ArrowRight } from "lucide-react";
import { ErrorNotice, Notice, Chip } from "../../components/ui.jsx";
import { formatTimecode, stepFrameMs, parseTimeInput, describeOp, proposalPreview, fmtSeconds, studioHref, textItemsAt, proposalAction, studioPlanReview, waitingStillWaits } from "../../lib/studioLogic.js";
import { useResource } from "../../store.js";
import { studioPost, useBusy } from "./common.jsx";
import { OpsPlanCard } from "../lega/OpsPlanCard.jsx";

/**
 * HTML5 player over GET /api/media/files/<assetVersionId> (HTTP Range, so seeking works on long files). The time is shown in
 * frames and mm:ss.ff at the edit's fps; `initialMs` (the ?t= deep link) seeks once the metadata is loaded. Keyboard on the
 * player area: K play/pause, J / ← one frame back, L / → one frame forward. Nothing here records or listens: it only plays.
 */
export const Player = forwardRef(function Player({ assetVersionId, fps, initialMs = null, onTime, label = "Previzualizare" }, ref) {
  const video = useRef(null);
  const [ms, setMs] = useState(initialMs || 0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(null);
  const pendingSeek = useRef(initialMs);
  const raf = useRef(0);
  const report = useCallback((value) => { setMs(value); onTime?.(value); }, [onTime]);
  const seek = useCallback((target) => {
    const v = video.current;
    const t = Math.max(0, Number(target) || 0);
    if (!v || v.readyState < 1) { pendingSeek.current = t; report(t); return; }
    const max = Number.isFinite(v.duration) ? Math.max(0, v.duration * 1000 - 1) : t;
    v.currentTime = Math.min(t, max) / 1000;
    report(Math.min(t, max));
  }, [report]);
  useImperativeHandle(ref, () => ({ seek, get currentMs() { return ms; } }), [seek, ms]);
  useEffect(() => { pendingSeek.current = initialMs; setFailed(null); }, [assetVersionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return undefined;
    const tick = () => { const v = video.current; if (v) report(Math.round(v.currentTime * 1000)); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, report]);
  const step = (delta) => { video.current?.pause(); seek(stepFrameMs(Math.round((video.current?.currentTime || 0) * 1000), delta, fps)); };
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const onKeyDown = (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key;
    if (k === "j" || k === "J" || k === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (k === "l" || k === "L" || k === "ArrowRight") { e.preventDefault(); step(1); }
    else if (k === "k" || k === "K") { e.preventDefault(); toggle(); }
  };
  const tc = formatTimecode(ms, fps);
  if (!assetVersionId) return <Notice tone="info" title="Nicio randare de redat">Cere o randare (schiță sau finală) în Review; previzualizarea apare când e gata.</Notice>;
  return (
    <div className="studio-player" onKeyDown={onKeyDown} role="group" aria-label={`${label}: K redare/pauză, J sau săgeată stânga un cadru înapoi, L sau săgeată dreapta un cadru înainte`}>
      <video ref={video} className="studio-video" src={`/api/media/files/${encodeURIComponent(assetVersionId)}`} controls preload="metadata" playsInline
        onLoadedMetadata={() => { if (pendingSeek.current !== null && pendingSeek.current !== undefined) { const t = pendingSeek.current; pendingSeek.current = null; seek(t); } }}
        onTimeUpdate={() => { if (!playing && video.current) report(Math.round(video.current.currentTime * 1000)); }}
        onSeeked={() => { if (video.current) report(Math.round(video.current.currentTime * 1000)); }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => setFailed("Fișierul nu poate fi redat în browser (format sau acces).")} />
      <div className="row wrap studio-transport">
        <button className="btn sm icon" type="button" onClick={() => step(-1)} aria-label="Un cadru înapoi (J)"><ChevronLeft size={16} /></button>
        <button className="btn sm icon" type="button" onClick={toggle} aria-label={playing ? "Pauză (K)" : "Redă (K)"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="btn sm icon" type="button" onClick={() => step(1)} aria-label="Un cadru înainte (L)"><ChevronRight size={16} /></button>
        <output className="studio-tc mono" aria-live="off" title={`timecode ${tc.timecode}`}>{tc.clock} <span className="faint">· cadrul {tc.frame}</span></output>
      </div>
      {failed && <Notice tone="warn">{failed}</Notice>}
    </div>
  );
});

/**
 * „Corectură la timecode”: a sentence + the time (prefilled with the player's current time until you edit it) → a PROPOSAL
 * (POST …/patches). Nothing changes until you press Aplică, which writes a NEW edit version; the original stays.
 * D7 (2.12.3): a correction Lega proposed as ONE plan (apply → draft render → QA) shows that plan's own card here instead of Aplică /
 * Renunță — the same card as in the cockpit (one confirmation in your session, Windows Hello for decisions, pause / continue, „Nu
 * acum”); the Hub refuses a separate apply of it. The panel opens on the cockpit's deep-linked proposal (`deepReviewId`) or on the one
 * proposal of this version waiting for its plan; a proposal you typed here is never replaced by another one.
 * D7 review: while a correction plan of this version waits for its confirmation, a proposal typed here gets no Aplică — the waiting plan's
 * card stays in view with the reason (the server refuses that apply: EDIT_PLAN_PROPOSED); after „Nu acum” on that card the M09 Aplică
 * comes back for it.
 */
export function Correction({ editVersionId, fps, currentMs, projectId, onApplied, ir = null, reviews = [], deepReviewId = null }) {
  const [text, setText] = useState("");
  // M10: the text item you mean (it wins over any guess); the disclosure label is never picked automatically.
  const [target, setTarget] = useState("");
  const [timeText, setTimeText] = useState("");
  const [follow, setFollow] = useState(true);
  const [proposal, setProposal] = useState(null);
  const [planNote, setPlanNote] = useState(null);
  // Proposals you dismissed or closed here are not opened again by the seeding below.
  const dropped = useRef(new Set());
  const b = useBusy();
  useEffect(() => { if (follow) setTimeText(formatTimecode(currentMs, fps).clock); }, [currentMs, follow, fps]);
  useEffect(() => { setProposal(null); setTarget(""); setPlanNote(null); }, [editVersionId]);
  // D7: the shown proposal follows the server's copy (status, bound plan); an empty panel opens on the deep-linked / waiting proposal.
  useEffect(() => {
    const list = Array.isArray(reviews) ? reviews : [];
    const seed = studioPlanReview(list, deepReviewId);
    setProposal((p) => {
      if (p) return list.find((x) => x.id === p.id) || p;
      return seed && !dropped.current.has(seed.id) ? seed : p;
    });
  }, [reviews, deepReviewId]);
  // A stale page (the plan appeared after the page loaded): the Hub's honest 409 names the plan, and its card replaces the button.
  const bindPlan = (e) => {
    if (!e?.details?.planId) return false;
    if (e.code === "REVIEW_IN_PLAN") {
      setProposal((p) => (p ? { ...p, plan: { id: String(e.details.planId), status: e.details.status || null } } : p));
      setPlanNote(e.message || null);
      return true;
    }
    // D7 review: another proposal's plan waits on this version (a stale page): its card replaces Aplică, with the Hub's reason.
    if (e.code === "EDIT_PLAN_PROPOSED") {
      setProposal((p) => (p ? { ...p, waitingPlan: { id: String(e.details.planId), status: e.details.status || "PROPOSED", reviewId: e.details.reviewId || null } } : p));
      setPlanNote(e.message || null);
      return true;
    }
    return false;
  };
  const timeMs = parseTimeInput(timeText, fps);
  const visibleTexts = textItemsAt(ir, timeMs ?? currentMs);
  const propose = (selectedItemId) => b.run("propose", async () => {
    const review = await studioPost(`/api/media/edit-versions/${encodeURIComponent(editVersionId)}/patches`, { text: text.trim(), ...(timeMs !== null ? { timecodeMs: timeMs } : {}), ...(selectedItemId ? { selectedItemId } : {}) });
    setPlanNote(null);
    setProposal(review);
  });
  const submit = (e) => { e.preventDefault(); propose(target || null); };
  const preview = proposal ? proposalPreview(proposal.patch) : null;
  const known = proposalAction(proposal, reviews);
  const fromServer = proposal?.waitingPlan || null;
  const waitingAction = known.kind === "apply" && fromServer ? { kind: "waiting", planId: fromServer.id, status: fromServer.status, reviewId: fromServer.reviewId } : known;
  // D7 review: the waiting plan's own state, live — once it no longer waits (confirmed, „Nu acum”, expired) the panel follows it.
  const waitingLive = useResource(waitingAction.kind === "waiting" ? `/api/ops/plans/${encodeURIComponent(waitingAction.planId)}` : null, { reloadOn: (e) => e.type.startsWith("ops.") });
  const action = waitingStillWaits(waitingAction, waitingLive.data) ? waitingAction : waitingAction.kind === "waiting" ? { kind: "apply" } : waitingAction;
  const deepLink = projectId && timeMs !== null ? `#${studioHref(projectId, { sub: "timeline", tMs: timeMs, versionId: editVersionId })}` : null;
  return (
    <div className="stack tight studio-correction">
      <form className="studio-form inline" onSubmit={submit} aria-label="Propune o corectură">
        <label className="field studio-time-field"><span>Corectură la timecode</span>
          <input className="input mono" value={timeText} inputMode="decimal" aria-describedby="studio-time-help"
            onChange={(e) => { setFollow(false); setTimeText(e.target.value); }} />
        </label>
        {visibleTexts.length > 0 && (
          <label className="field studio-target"><span>Textul vizat</span>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{visibleTexts.filter((t) => !t.isLabel).length === 1 ? "automat (singurul text de conținut)" : "automat (te întreb dacă sunt mai multe)"}</option>
              {visibleTexts.map((t) => <option key={t.id} value={t.id}>„{t.text}”{t.isLabel ? " · etichetă" : ""}</option>)}
            </select>
          </label>
        )}
        <label className="field grow"><span>Ce trebuie schimbat</span>
          <input className="input" value={text} maxLength={1000} placeholder="de exemplu: textul acoperă butonul, mută-l mai sus" onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="row wrap">
          <button className="btn primary" type="submit" disabled={Boolean(b.busy) || text.trim().length < 3}><MessageSquareText size={15} aria-hidden="true" />{b.busy === "propose" ? "Se analizează…" : "Propune corectura"}</button>
          {!follow && <button className="btn ghost sm" type="button" onClick={() => setFollow(true)}>Folosește timpul curent</button>}
          {deepLink && <a className="btn ghost sm" href={deepLink}><Link2 size={14} aria-hidden="true" />Link la acest moment</a>}
        </div>
      </form>
      <p id="studio-time-help" className="faint small">Timpul: mm:ss.ff (cadre la {fps?.num || 30}/{fps?.den || 1} fps) sau secunde („12,5”). {timeMs === null && timeText ? "Timp nerecunoscut — corectura se trimite fără moment." : timeMs !== null ? `= ${fmtSeconds(timeMs)}` : ""}</p>
      <ErrorNotice error={b.error} />
      {proposal && (
        <div className="studio-proposal" aria-live="polite">
          <div className="row wrap between"><strong>Propunere {proposal.status === "OPEN" ? "(neaplicată)" : `(${proposal.status})`}</strong><Chip tone="neutral">proveniență: {proposal.provenance}</Chip></div>
          {proposal.patch?.clarification && <Notice tone="warn" title="Am nevoie de o clarificare">{proposal.patch.clarification}
            {(proposal.patch.options || []).length > 0 && <span className="studio-options">{proposal.patch.options.map((id) => { const t = visibleTexts.find((x) => x.id === id); return <button key={id} type="button" className="btn sm" disabled={Boolean(b.busy)} onClick={() => { setTarget(id); propose(id); }}>Acesta: „{t?.text || id}”</button>; })}</span>}
          </Notice>}
          {(proposal.patch?.notes || []).length > 0 && <ul className="faint small">{proposal.patch.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {preview.hasOps ? (
            <>
              <ol className="studio-ops">{proposal.patch.ops.map((op, i) => <li key={i}>{describeOp(op)}</li>)}</ol>
              {preview.durationText && <p className="small">Durata: <strong>{preview.durationText}</strong></p>}
              {preview.lines.length > 0 && <ul className="studio-diff">{preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              {preview.valid === false && <Notice tone="error" title="Rezultatul n-ar fi valid">{preview.errors.join(" · ") || "IR invalid"}</Notice>}
              {action.kind === "plan" ? (
                <div className="stack tight">
                  {planNote && <Notice tone="info">{planNote}</Notice>}
                  <OpsPlanCard plan={{ id: action.planId, status: action.status }} card={{ type: "OpsPlan", size: "m" }} />
                </div>
              ) : action.kind === "waiting" ? (
                <div className="stack tight">
                  <Notice tone="info" title="Un plan așteaptă deja confirmarea ta">{planNote || "Planul afișat corectează deja această versiune: îl confirmi o dată sau alegi „Nu acum” pe cardul lui; abia apoi poți aplica altă corectură."}</Notice>
                  <OpsPlanCard plan={{ id: action.planId, status: action.status }} card={{ type: "OpsPlan", size: "m" }} />
                  <div className="row wrap">
                    <button className="btn ghost" type="button" disabled={Boolean(b.busy)} onClick={() => b.run("dismiss", async () => {
                      await studioPost(`/api/media/reviews/${encodeURIComponent(proposal.id)}/dismiss`, { reason: "renunțat din Studio" });
                      dropped.current.add(proposal.id);
                      setProposal(null);
                      setPlanNote(null);
                    })}><X size={15} aria-hidden="true" />Renunță la propunerea nouă</button>
                  </div>
                </div>
              ) : proposal.status === "OPEN" && (
                <div className="row wrap">
                  <button className="btn approve" type="button" disabled={Boolean(b.busy) || preview.valid === false} onClick={() => b.run("apply", async () => {
                    try {
                      const out = await studioPost(`/api/media/reviews/${encodeURIComponent(proposal.id)}/apply`, {}, { toast: "Versiune nouă creată; originalul a rămas neschimbat" });
                      setProposal(out?.review || null);
                      if (out?.version?.id) onApplied?.(out.version.id);
                    } catch (e) { if (!bindPlan(e)) throw e; }
                  })}><Check size={15} aria-hidden="true" />{b.busy === "apply" ? "Se aplică…" : "Aplică (versiune nouă)"}</button>
                  <button className="btn ghost" type="button" disabled={Boolean(b.busy)} onClick={() => b.run("dismiss", async () => {
                    try {
                      await studioPost(`/api/media/reviews/${encodeURIComponent(proposal.id)}/dismiss`, { reason: "renunțat din Studio" });
                      dropped.current.add(proposal.id);
                      setProposal(null);
                    } catch (e) { if (!bindPlan(e)) throw e; }
                  })}><X size={15} aria-hidden="true" />Renunță</button>
                </div>
              )}
              {proposal.status === "APPLIED" && proposal.resultVersionId && action.kind !== "plan" && (
                <div className="row wrap">
                  <button className="btn sm" type="button" onClick={() => { dropped.current.add(proposal.id); onApplied?.(proposal.resultVersionId); }}><ArrowRight size={14} aria-hidden="true" />Deschide versiunea nouă</button>
                </div>
              )}
            </>
          ) : !proposal.patch?.clarification && <Notice tone="info">Nu am găsit o modificare aplicabilă; propunerea a rămas un comentariu.</Notice>}
        </div>
      )}
    </div>
  );
}
