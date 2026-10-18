// Corrections after M11 (R-MEDIA) — intentional pauses of a capture, with their interval and their provenance (pure, no I/O).
//
// A Public Demo Mode capture holds the picture still on purpose: a highlight is shown for its planned time, the success state is held
// for the CTA, typed text appears letter by letter, the page settles after it loads, the recording ends on a short hold. QA's
// freezedetect sees those as frozen ranges. Before, the only way to justify one was `holdIntentional` on the WHOLE clip, which would
// also have hidden an accidental freeze of the same capture. Here each hold is a measured interval on the capture's own clock:
//
//   capture (media/capture.mjs)  records a hold only for a step the plan asked for (highlight, wait, type, the end hold), measured from
//                                the step's start to its end, with the planned duration, a cap and the step's verified postcondition;
//                                a hold over its cap or whose postcondition failed is kept in `holdsRejected`, never as evidence.
//   montage (delivery/clip-ir.mjs) checks each hold against the capture it claims (asset version, session, steps sha) and puts the
//                                accepted ones on the video clip as `holds`, in SOURCE frames, so trims, cuts, speed and variants (which
//                                copy the clip and move sourceIn / sourceOut) remap them deterministically: a removed range disappears,
//                                an intersected one is clipped.
//   validator (media/ir.mjs)     refuses a malformed hold or one whose provenance names another asset version.
//   QA (media/qa.mjs)            justifies ONLY a frozen range covered by the timeline intervals of eligible holds (within the existing
//                                tolerance). Black, decode errors, a capture without frames, timeouts and legibility are never justified
//                                by a hold; the raw finding, its measurement and the explanation stay in the report.
//
// Old markers (a point in time, no end) never become evidence: only a hold with this schema is read.

export const HOLD_SCHEMA = "ifrim.capture-hold/1";
/** Why the picture is still: a planned highlight, the held success state, the settle after the first page, a planned wait, typing, the end. */
export const HOLD_REASONS = Object.freeze(["highlight", "proof_hold", "settle", "wait", "typing", "end_hold"]);
/** The demo step each reason comes from. */
export const HOLD_STEP_KINDS = Object.freeze({ highlight: "highlight", proof_hold: "wait", settle: "wait", wait: "wait", typing: "type", end_hold: "end" });
/** The postcondition each reason must have verified at the end of its step. */
export const HOLD_POSTCONDITIONS = Object.freeze({
  highlight: "highlight_visible", proof_hold: "proof_visible", settle: "page_on_origin", wait: "page_on_origin", typing: "value_typed", end_hold: "page_on_origin",
});
/**
 * The cap of a hold: the planned time plus a bounded allowance. Timers and one page evaluation add ~ tens of ms (250 ms allowed);
 * typing gets 25 % of its planned time (at least 400 ms) — never the whole latency of a slow page.
 */
export const HOLD_SLACK = Object.freeze({ timerMs: 250, typingMinMs: 400, typingShare: 0.25 });
export const HOLD_LIMITS = Object.freeze({ perCapture: 200, perClip: 200, maxMs: 30000 });
const HOLD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fpsParts = (fps) => ({ num: Number(fps?.num), den: Number(fps?.den) });
/** Source frame of a capture time: the start rounds UP and the end rounds DOWN, so a hold never grows in frames. */
export function holdFrame(ms, fps, mode) {
  const { num, den } = fpsParts(fps);
  const exact = (Number(ms) * num) / (1000 * den);
  const eps = 1e-9;
  return mode === "start" ? Math.ceil(exact - eps) : Math.floor(exact + eps);
}

/** The cap (ms) of a hold of `reason` planned for `plannedMs`. */
export function holdCap(reason, plannedMs) {
  const planned = Math.max(0, Math.round(Number(plannedMs) || 0));
  if (reason === "typing") return planned + Math.max(HOLD_SLACK.typingMinMs, Math.ceil(planned * HOLD_SLACK.typingShare));
  return planned + HOLD_SLACK.timerMs;
}

/**
 * Decides one measured step (capture side): → { hold } when it is eligible, else { rejected } with the code. `step` is 1-based.
 * Eligible = a planned reason, an interval with an end after its start, not longer than its cap, and the postcondition verified.
 */
export function measureHold({ reason, step, startMs, endMs, plannedMs, verified }) {
  const base = { reason, step, stepKind: HOLD_STEP_KINDS[reason] || null, startMs: Math.round(startMs), endMs: Math.round(endMs), plannedMs: Math.round(plannedMs), maxMs: holdCap(reason, plannedMs), postcondition: HOLD_POSTCONDITIONS[reason] || null };
  if (!HOLD_REASONS.includes(reason)) return { rejected: { ...base, code: "HOLD_REASON_UNKNOWN" } };
  if (!(base.plannedMs > 0) || base.plannedMs > HOLD_LIMITS.maxMs) return { rejected: { ...base, code: "HOLD_NOT_PLANNED" } };
  if (!(base.endMs > base.startMs)) return { rejected: { ...base, code: "HOLD_EMPTY" } };
  if (base.endMs - base.startMs > base.maxMs) return { rejected: { ...base, code: "HOLD_LATENCY_EXCEEDED" } };
  if (verified !== true) return { rejected: { ...base, code: "HOLD_POSTCONDITION_FAILED" } };
  return { hold: base };
}

/**
 * Checks a stored hold against the capture it is used with (montage side). `capture` = { assetVersionId, sessionId?, stepsSha?,
 * durationMs }. → { ok: true } | { ok: false, code, message }. A hold of another asset version, session or steps script is refused.
 */
export function checkCaptureHold(h, capture) {
  const no = (code, message) => ({ ok: false, code, message });
  if (!isObject(h) || h.schema !== HOLD_SCHEMA) return no("HOLD_SCHEMA", "nu este o pauză măsurată (schema lipsă)");
  if (!HOLD_ID_RE.test(String(h.id || ""))) return no("HOLD_ID", "id invalid");
  if (!HOLD_REASONS.includes(h.reason) || h.stepKind !== HOLD_STEP_KINDS[h.reason] || h.postcondition !== HOLD_POSTCONDITIONS[h.reason]) return no("HOLD_REASON", "motiv, pas sau postcondiție nepotrivite");
  if (h.result !== "VERIFIED") return no("HOLD_UNVERIFIED", "postcondiția pasului nu a fost verificată");
  if (h.assetVersionId !== capture.assetVersionId) return no("HOLD_ASSET_MISMATCH", "provine din altă versiune de asset");
  // Review F2: the session and the steps script of the capture are required; a caller that does not know them gets no hold at all.
  if (!capture.sessionId || !capture.stepsSha) return no("HOLD_PROVENANCE", "captura nu își declară sesiunea și scriptul de pași");
  if (h.sessionId !== capture.sessionId) return no("HOLD_SESSION_MISMATCH", "provine din altă sesiune de captură");
  if (h.stepsSha !== capture.stepsSha) return no("HOLD_SCRIPT_MISMATCH", "provine din alt script de pași");
  if (!SESSION_RE.test(String(h.sessionId || "")) || !SHA_RE.test(String(h.stepsSha || ""))) return no("HOLD_PROVENANCE", "proveniență incompletă");
  for (const k of ["startMs", "endMs", "plannedMs", "maxMs", "step"]) if (!Number.isInteger(h[k]) || h[k] < 0) return no("HOLD_FIELDS", `${k} invalid`);
  if (h.step < 1) return no("HOLD_FIELDS", "pasul începe de la 1");
  if (!(h.endMs > h.startMs)) return no("HOLD_EMPTY", "sfârșitul nu e după început");
  if (h.maxMs !== holdCap(h.reason, h.plannedMs) || h.plannedMs > HOLD_LIMITS.maxMs) return no("HOLD_CAP", "plafonul nu corespunde duratei planificate");
  if (h.endMs - h.startMs > h.maxMs) return no("HOLD_LATENCY_EXCEEDED", "durează mai mult decât plafonul");
  if (Number.isFinite(capture.durationMs) && h.endMs > capture.durationMs) return no("HOLD_OUT_OF_RANGE", "se termină după captură");
  return { ok: true };
}

/** A checked capture hold → the clip hold of the IR (source frames + the provenance needed to re-check it). Null when empty in frames. */
export function clipHoldOf(h, fps) {
  const srcFrom = holdFrame(h.startMs, fps, "start");
  const srcTo = holdFrame(h.endMs, fps, "end");
  if (!(srcTo > srcFrom)) return null;
  return { id: h.id, reason: h.reason, srcFrom, srcTo, maxFrames: holdFrame(h.maxMs, fps, "start"),
    provenance: { schema: HOLD_SCHEMA, sessionId: h.sessionId, assetVersionId: h.assetVersionId, stepsSha: h.stepsSha, step: h.step, stepKind: h.stepKind,
      startMs: h.startMs, endMs: h.endMs, plannedMs: h.plannedMs, maxMs: h.maxMs, postcondition: h.postcondition } };
}

/**
 * The problems of one IR clip hold (validator side): [{ field, code, message }]. `clip` is the raw clip (its assetVersionId), `fps`
 * the IR fps, `available` the source frames when known. Consistency is re-derived: frames from the measured ms, the cap from the plan.
 */
export function clipHoldProblems(hold, clip, fps) {
  const out = [];
  const add = (field, code, message) => out.push({ field, code, message });
  const p = isObject(hold?.provenance) ? hold.provenance : null;
  if (!p) { add("provenance", "HOLD_PROVENANCE", "Pauza nu are proveniența capturii."); return out; }
  if (p.schema !== HOLD_SCHEMA) add("provenance.schema", "HOLD_SCHEMA", `Schema pauzei trebuie să fie ${HOLD_SCHEMA}.`);
  if (p.assetVersionId !== clip?.assetVersionId) add("provenance.assetVersionId", "HOLD_PROVENANCE_MISMATCH", "Pauza provine din altă versiune de asset decât clipul.");
  if (!SESSION_RE.test(String(p.sessionId || ""))) add("provenance.sessionId", "FORMAT", "Sesiunea de captură lipsește sau e invalidă.");
  if (!SHA_RE.test(String(p.stepsSha || ""))) add("provenance.stepsSha", "FORMAT", "Amprenta pașilor (sha256) lipsește sau e invalidă.");
  if (p.stepKind !== HOLD_STEP_KINDS[hold.reason]) add("provenance.stepKind", "HOLD_REASON", "Tipul pasului nu corespunde motivului pauzei.");
  if (p.postcondition !== HOLD_POSTCONDITIONS[hold.reason]) add("provenance.postcondition", "HOLD_REASON", "Postcondiția nu corespunde motivului pauzei.");
  for (const k of ["step", "startMs", "endMs", "plannedMs", "maxMs"]) if (!Number.isInteger(p[k]) || p[k] < 0) add(`provenance.${k}`, "TYPE", `${k}: se așteaptă un întreg ≥ 0.`);
  if (out.length) return out;
  if (p.step < 1) add("provenance.step", "RANGE", "Pasul începe de la 1.");
  if (!(p.endMs > p.startMs)) add("provenance.endMs", "FRAME_RANGE", "Sfârșitul pauzei trebuie să fie după început.");
  if (p.maxMs !== holdCap(hold.reason, p.plannedMs) || p.plannedMs > HOLD_LIMITS.maxMs) add("provenance.maxMs", "HOLD_CAP", "Plafonul nu corespunde duratei planificate.");
  if (p.endMs - p.startMs > p.maxMs) add("provenance.endMs", "HOLD_LATENCY_EXCEEDED", "Pauza durează mai mult decât plafonul ei.");
  if (hold.srcFrom !== holdFrame(p.startMs, fps, "start") || hold.srcTo !== holdFrame(p.endMs, fps, "end") || hold.maxFrames !== holdFrame(p.maxMs, fps, "start")) {
    add("srcFrom", "HOLD_FRAMES_MISMATCH", "Cadrele pauzei nu corespund intervalului măsurat.");
  }
  return out;
}

/**
 * Review F1: whether a clip hold is the one its capture session STORED (`stored` = the session's scope_json.result.holds): same id, asset
 * version, steps sha, reason, interval, plan and cap. An IR is editable; only this match makes a hold evidence for QA.
 */
export function holdMatchesStored(hold, stored = []) {
  const p = hold?.provenance;
  if (!p) return false;
  return (Array.isArray(stored) ? stored : []).some((s) => s && s.id === hold.id && s.schema === HOLD_SCHEMA && s.result === "VERIFIED" && s.reason === hold.reason
    && s.assetVersionId === p.assetVersionId && s.sessionId === p.sessionId && s.stepsSha === p.stepsSha && s.step === p.step
    && s.startMs === p.startMs && s.endMs === p.endMs && s.plannedMs === p.plannedMs && s.maxMs === p.maxMs);
}

const speedOf = (clip) => (clip?.speed === undefined ? 1 : Number(clip.speed));
const clipLen = (clip) => Math.max(0, Math.round((Number(clip.sourceOut) - Number(clip.sourceIn)) / speedOf(clip)));

/**
 * The timeline intervals of the holds of the primary video track (the first video track): each hold's source range intersected with
 * the clip's [sourceIn, sourceOut) and mapped through its start and speed. → [{ from, to, holdId, reason, clipId, step, assetVersionId }]
 */
export function timelineHolds(ir) {
  const track = (Array.isArray(ir?.tracks) ? ir.tracks : []).find((t) => t?.kind === "video");
  const out = [];
  for (const clip of track?.clips || []) {
    const holds = Array.isArray(clip?.holds) ? clip.holds : [];
    if (!holds.length) continue;
    const sIn = Number(clip.sourceIn) || 0, sOut = Number(clip.sourceOut), sp = speedOf(clip), start = Number(clip.start) || 0;
    if (!(sp > 0) || !(sOut > sIn)) continue;
    const end = start + clipLen(clip);
    for (const h of holds) {
      if (h?.provenance?.assetVersionId !== clip.assetVersionId || h?.provenance?.schema !== HOLD_SCHEMA || !HOLD_REASONS.includes(h?.reason)) continue;
      const a = Math.max(Number(h.srcFrom), sIn), b = Math.min(Number(h.srcTo), sOut);
      if (!(b > a)) continue;
      const from = Math.max(start, start + Math.round((a - sIn) / sp)), to = Math.min(end, start + Math.round((b - sIn) / sp));
      if (to > from) out.push({ from, to, holdId: h.id, reason: h.reason, clipId: clip.id, step: h.provenance.step, assetVersionId: clip.assetVersionId });
    }
  }
  return out.sort((x, y) => x.from - y.from || x.to - y.to);
}

/**
 * Whether the frozen range [fromFrame, toFrame) lies inside ONE run of consecutive hold intervals (gaps ≤ tol frames), with `tol` frames
 * at the edges. → { from, to, holds: [...] } | null. A run is made of holds of one clip only: a hard cut is never bridged.
 */
export function holdCover(ir, fromFrame, toFrame, tol = 2) {
  const list = timelineHolds(ir);
  let run = null;
  const runs = [];
  for (const h of list) {
    if (run && h.clipId === run.clipId && h.from <= run.to + tol) { run.to = Math.max(run.to, h.to); run.holds.push(h); continue; }
    run = { clipId: h.clipId, from: h.from, to: h.to, holds: [h] };
    runs.push(run);
  }
  const hit = runs.find((r) => r.from - tol <= fromFrame && toFrame <= r.to + tol);
  return hit ? { from: hit.from, to: hit.to, clipId: hit.clipId, holds: hit.holds.filter((h) => h.to > fromFrame - tol && h.from < toFrame + tol) } : null;
}
