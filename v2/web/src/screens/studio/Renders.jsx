import { useEffect, useState } from "react";
import { Film, Square, RotateCcw, Play, ShieldCheck, ThumbsUp, PencilLine, Ban } from "lucide-react";
import { onLive } from "../../store.js";
import { Panel, ErrorNotice, Empty, Chip, Notice, Loading } from "../../components/ui.jsx";
import { RENDER_STATUS, RENDER_ACTIVE, RENDER_RETRYABLE, renderProgress, latestQa, SEVERITY, QA_STATUS, QA_KIND_LABEL, fmtSeconds } from "../../lib/studioLogic.js";
import { studioPost, useBusy, useStudio, StateChip } from "./common.jsx";
import { fmt } from "../../api.js";

/** Live render progress (transient `media.render.progress` deltas); only measured numbers are shown. */
export function useRenderProgress() {
  const [progress, setProgress] = useState({});
  useEffect(() => onLive((e) => { if (e?.type === "media.render.progress" && e.jobId) setProgress((p) => ({ ...p, [e.jobId]: e })); }), []);
  return progress;
}

/**
 * Renders of one edit version: request draft / final, the list with live progress, cancel (fail-safe: always offered while a job
 * is active) and retry. A DONE render can be opened in the player.
 */
export function RendersPanel({ editVersionId, renders = [], onPlay, playingId, title = "Randări" }) {
  const progress = useRenderProgress();
  const b = useBusy();
  const request = (profile) => b.run(profile, async () => {
    const job = await studioPost("/api/media/renders", { editVersionId, profile }, { toast: profile === "final" ? "Randare finală cerută" : "Randare schiță cerută" });
    if (job?.duplicate) setNote(`Există deja o randare ${profile === "final" ? "finală" : "schiță"} pentru această versiune (${job.status}); folosește „Reia” dacă a eșuat.`);
  });
  const [note, setNote] = useState(null);
  return (
    <Panel title={title} icon={Film} id={`studio-renders-${editVersionId}`} actions={<>
      <button className="btn sm" type="button" disabled={Boolean(b.busy)} onClick={() => request("draft")}>{b.busy === "draft" ? "Se cere…" : "Randare schiță"}</button>
      <button className="btn sm primary" type="button" disabled={Boolean(b.busy)} onClick={() => request("final")}>{b.busy === "final" ? "Se cere…" : "Randare finală"}</button>
    </>}>
      <p className="faint small">Randarea rulează local (ffmpeg), cedează prioritatea lucrului interactiv și nu încarcă nimic nicăieri.</p>
      {note && <Notice tone="info">{note}</Notice>}
      <ErrorNotice error={b.error} />
      {!renders.length ? <Empty title="Nicio randare">Cere o schiță pentru a vedea montajul.</Empty> : (
        <ul className="intel-list">
          {renders.map((r) => {
            const live = renderProgress(progress[r.id]);
            const active = RENDER_ACTIVE.includes(r.status);
            return (
              <li key={r.id} className="stack tight">
                <div className="row wrap between">
                  <span className="row wrap"><StateChip map={RENDER_STATUS} value={r.status} /><Chip>{r.profile === "final" ? "finală" : "schiță"}</Chip><span className="faint small">{fmt.dateTime(r.createdAt)}</span></span>
                  <span className="row wrap">
                    {r.status === "DONE" && r.outputAssetVersionId && (
                      <button className="btn sm" type="button" aria-pressed={playingId === r.outputAssetVersionId} onClick={() => onPlay?.(r.outputAssetVersionId)}><Play size={14} aria-hidden="true" />{playingId === r.outputAssetVersionId ? "În player" : "Redă"}</button>
                    )}
                    {active && r.status !== "CANCEL_REQUESTED" && (
                      <button className="btn sm danger" type="button" disabled={b.busy === `c-${r.id}`} onClick={() => b.run(`c-${r.id}`, () => studioPost(`/api/media/renders/${encodeURIComponent(r.id)}/cancel`, {}, { toast: "Oprire cerută" }))}>
                        <Square size={13} aria-hidden="true" />Oprește</button>
                    )}
                    {RENDER_RETRYABLE.includes(r.status) && (
                      <button className="btn sm" type="button" disabled={Boolean(b.busy)} onClick={() => b.run(`r-${r.id}`, () => studioPost(`/api/media/renders/${encodeURIComponent(r.id)}/retry`, {}, { toast: "Randare reluată" }))}>
                        <RotateCcw size={13} aria-hidden="true" />Reia</button>
                    )}
                  </span>
                </div>
                {active && (live ? (
                  <div className="row wrap small">
                    {live.percent !== null ? <span className="meter" aria-label={`Progres măsurat ${live.percent}%`}><span className="bar"><i style={{ width: `${live.percent}%` }} /></span>{live.percent}%</span> : null}
                    <span className="faint">{live.phase}{live.segment ? ` · ${live.segment}` : ""}</span>
                  </div>
                ) : <span className="faint small">{r.progress?.phase ? `fază: ${r.progress.phase}` : "așteaptă (progresul apare când ffmpeg raportează)"}</span>)}
                {r.error && <span className="small studio-error">{r.error.code}: {r.error.message}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** QA (technical, editorial + layout, factual, rights) on the latest render; findings with severity, timecode (seek), criterion, fix. */
export function QaPanel({ editVersionId, onSeek }) {
  const qa = useStudio(`/api/media/qa/${encodeURIComponent(editVersionId)}`, ["media.qa.", "media.render."]);
  const b = useBusy();
  const view = latestQa(qa.data?.reports);
  const status = qa.data?.summary?.status || "NOT_RUN";
  return (
    <Panel title="QA" icon={ShieldCheck} id={`studio-qa-${editVersionId}`} actions={
      <button className="btn sm" type="button" disabled={Boolean(b.busy)} onClick={() => b.run("qa", () => studioPost("/api/media/qa", { editVersionId }, { toast: "QA rulat" }))}>{b.busy ? "Rulează…" : "Rulează QA"}</button>}>
      <ErrorNotice error={b.error} />
      {qa.loading && !qa.data ? <Loading lines={2} /> : qa.error ? <ErrorNotice error={qa.error} onRetry={qa.reload} /> : (
        <div className="stack tight">
          <div className="row wrap"><span className="small">Stare:</span><StateChip map={QA_STATUS} value={status} />
            {view.kinds.map((k) => <Chip key={k.kind} tone={(QA_STATUS[k.status] || QA_STATUS.NOT_RUN)[0]}>{QA_KIND_LABEL[k.kind] || k.kind}: {(QA_STATUS[k.status] || [null, k.status])[1]}</Chip>)}
          </div>
          {status === "FAIL" && <Notice tone="error">Un QA cu FAIL blochează aprobarea manifestului de distribuție.</Notice>}
          {!view.findings.length ? <p className="faint small">{view.kinds.length ? "Nicio constatare." : "QA nu a rulat încă pentru această versiune."}</p> : (
            <ul className="studio-findings">
              {view.findings.map((f, i) => {
                const [tone, label] = SEVERITY[f.severity] || ["neutral", f.severity];
                return (
                  <li key={`${f.kind}-${f.id || i}`} className={f.justified ? "is-justified" : undefined}>
                    <div className="row wrap">
                      <Chip tone={f.justified ? "neutral" : tone}>{label}</Chip>
                      {f.range?.fromMs !== undefined && f.range?.fromMs !== null ? (
                        <button className="link-btn mono small" type="button" onClick={() => onSeek?.(f.range.fromMs)} aria-label={`Mergi la ${fmtSeconds(f.range.fromMs)}`}>{f.range.timecode || fmtSeconds(f.range.fromMs)}</button>
                      ) : <span className="faint small">fără moment</span>}
                      <span className="small faint">{QA_KIND_LABEL[f.kind] || f.kind} · {f.criterion}</span>
                      {f.justified && <Chip tone="info">justificat</Chip>}
                    </div>
                    <p className="small">{f.message}</p>
                    {f.proposedFix && <p className="small faint">Remediere: {f.proposedFix}</p>}
                    {f.justified && f.justification && <p className="small faint">Justificare: {typeof f.justification === "string" ? f.justification : JSON.stringify(f.justification)}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

const DECISION_LABEL = { CREATIVE_APPROVED: ["ok", "creație aprobată"], CHANGES_REQUESTED: ["warn", "modificări cerute"], REJECTED: ["error", "respinsă"], COMMENT: ["neutral", "comentariu"] };

/**
 * Creative decision on an edit version. „Aprobă creația” needs your owner session (Windows Hello, fresh); the page never records an
 * approval by itself. Publication is a separate decision (the distribution manifest).
 */
export function Decisions({ editVersionId, reviews = [] }) {
  const [note, setNote] = useState("");
  const b = useBusy();
  const decide = (kind) => b.run(kind, async () => {
    await studioPost(`/api/media/edit-versions/${encodeURIComponent(editVersionId)}/decision`, { kind, note: note.trim() },
      { owner: kind === "CREATIVE_APPROVED", toast: kind === "CREATIVE_APPROVED" ? "Aprobarea creativă a fost înregistrată din sesiunea ta" : "Decizia a fost înregistrată" });
    setNote("");
  });
  const decided = reviews.filter((r) => r.status === "RECORDED");
  return (
    <div className="stack tight">
      <label className="field"><span>Notă (opțional)</span><textarea className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row wrap">
        <button className="btn approve" type="button" disabled={Boolean(b.busy)} onClick={() => decide("CREATIVE_APPROVED")}><ThumbsUp size={15} aria-hidden="true" />{b.busy === "CREATIVE_APPROVED" ? "Se verifică sesiunea…" : "Aprobă creația"}</button>
        <button className="btn" type="button" disabled={Boolean(b.busy)} onClick={() => decide("CHANGES_REQUESTED")}><PencilLine size={15} aria-hidden="true" />Cere modificări</button>
        <button className="btn danger" type="button" disabled={Boolean(b.busy)} onClick={() => decide("REJECTED")}><Ban size={15} aria-hidden="true" />Respinge</button>
      </div>
      <p className="faint small">„Aprobă creația” cere sesiunea ta de proprietar (Windows Hello). Nu aprobă publicarea: aceea se decide separat, pe manifest.</p>
      <ErrorNotice error={b.error} />
      {decided.length > 0 && (
        <ul className="intel-list">
          {decided.map((r) => { const [tone, label] = DECISION_LABEL[r.kind] || ["neutral", r.kind]; return (
            <li key={r.id} className="row wrap"><Chip tone={tone}>{label}</Chip><span className="faint small">{fmt.dateTime(r.createdAt)} · {r.provenance}</span>{r.text && <span className="small">{r.text}</span>}</li>
          ); })}
        </ul>
      )}
    </div>
  );
}
