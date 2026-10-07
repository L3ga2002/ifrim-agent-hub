// M09 Content Studio — UI logic (pure; tested in node without a browser): routes, timecodes at the IR fps, the Kanban columns,
// the measurable-progress rule, the timeline layout, labels and tones. Nothing here talks to the Hub or decides anything: the
// server re-checks every transition, approval and policy.

/** Top-level Studio tabs (`#/studio/<tab>`). */
export const STUDIO_TABS = Object.freeze([
  ["board", "Panou"], ["project", "Proiect"], ["library", "Bibliotecă"], ["command", "Command Center"], ["platforms", "Platforme"], ["analytics", "Analytics"],
]);
/** Sub-tabs of a content project (`#/studio/<contentProjectId>?sub=<id>`). */
export const PROJECT_TABS = Object.freeze([
  ["concept", "Concept"], ["evidence", "Dovezi"], ["script", "Scenariu"], ["storyboard", "Storyboard"], ["assets", "Materiale"], ["timeline", "Timeline"],
  ["versions", "Versiuni"], ["variants", "Variante"], ["rights", "Drepturi"], ["review", "Review"], ["distribution", "Distribuție"], ["analytics", "Analytics"], ["activity", "Activitate"],
]);
const TAB_IDS = new Set(STUDIO_TABS.map(([id]) => id));
const SUB_IDS = new Set(PROJECT_TABS.map(([id]) => id));
const ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

/** The Kanban columns, in order (the server's BOARD_COLUMNS; ARCHIVED is counted, not shown). */
export const BOARD_STAGES = Object.freeze(["IDEAS", "RESEARCH", "SCRIPT", "STORYBOARD", "PRODUCTION", "EDITING", "REVIEW", "SCHEDULED", "PUBLISHED", "ANALYTICS"]);
export const STAGE_LABELS = Object.freeze({
  IDEAS: "Idei", RESEARCH: "Documentare", SCRIPT: "Scenariu", STORYBOARD: "Storyboard", PRODUCTION: "Producție", EDITING: "Montaj",
  REVIEW: "Revizie", SCHEDULED: "Programat", PUBLISHED: "Publicat", ANALYTICS: "Analiză", ARCHIVED: "Arhivat",
});
/** A copy of the server's transition table, only to offer sensible buttons; the server decides (and checks the preconditions). */
export const STAGE_TRANSITIONS = Object.freeze({
  IDEAS: ["RESEARCH", "ARCHIVED"], RESEARCH: ["SCRIPT", "IDEAS", "ARCHIVED"], SCRIPT: ["STORYBOARD", "RESEARCH", "ARCHIVED"],
  STORYBOARD: ["PRODUCTION", "SCRIPT", "ARCHIVED"], PRODUCTION: ["EDITING", "STORYBOARD", "ARCHIVED"], EDITING: ["REVIEW", "PRODUCTION", "ARCHIVED"],
  REVIEW: ["SCHEDULED", "EDITING", "ARCHIVED"], SCHEDULED: ["PUBLISHED", "REVIEW", "ARCHIVED"], PUBLISHED: ["ANALYTICS", "ARCHIVED"], ANALYTICS: ["ARCHIVED"], ARCHIVED: [],
});

/**
 * `#/studio/<id>?…` → { tab, projectId, sub, tMs, versionId }.
 * - no id → Panou; a known tab id → that tab; any other safe id → the project detail of that content project;
 * - `t` = seconds (12.5 or 12,5) → tMs (integer ms) for the player deep link; invalid / negative → null;
 * - `sub` = a project sub-tab; a deep link with `t` and no `sub` opens the Timeline (where the player is);
 * - `v` = an edit version id to select.
 */
export function studioRoute(id, query = {}) {
  const q = query && typeof query === "object" ? query : {};
  const tMs = parseSecondsParam(q.t);
  const versionId = typeof q.v === "string" && ID_RE.test(q.v) ? q.v : null;
  if (!id) return { tab: "board", projectId: null, sub: null, tMs: null, versionId: null };
  if (TAB_IDS.has(id)) {
    const projectId = id === "project" && typeof q.id === "string" && ID_RE.test(q.id) ? q.id : null;
    return { tab: id, projectId, sub: projectId ? subOf(q.sub, tMs) : null, tMs: projectId ? tMs : null, versionId: projectId ? versionId : null };
  }
  if (!ID_RE.test(String(id))) return { tab: "board", projectId: null, sub: null, tMs: null, versionId: null };
  return { tab: "project", projectId: String(id), sub: subOf(q.sub, tMs), tMs, versionId };
}
const subOf = (sub, tMs) => (typeof sub === "string" && SUB_IDS.has(sub) ? sub : tMs !== null ? "timeline" : "concept");

/** "12.5" | "12,5" | "12" → 12500 ms; anything else → null. */
export function parseSecondsParam(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) return null;
  const ms = Math.round(Number(s) * 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Hash path for a tab, or for a project (with optional sub-tab, edit version and time). */
export function studioHref(target = "board", { sub = null, tMs = null, versionId = null } = {}) {
  if (!target || TAB_IDS.has(target)) return target && target !== "board" ? `/studio/${target}` : "/studio";
  const params = new URLSearchParams();
  if (sub && SUB_IDS.has(sub)) params.set("sub", sub);
  if (versionId) params.set("v", versionId);
  if (Number.isFinite(tMs) && tMs >= 0) params.set("t", secondsParam(tMs));
  const qs = params.toString();
  return `/studio/${encodeURIComponent(target)}${qs ? `?${qs}` : ""}`;
}
/** ms → "12.5" (no trailing zeros, at most 3 decimals). */
export const secondsParam = (ms) => String(Math.round(Math.max(0, ms)) / 1000);

// ---------- D7 (2.12.3): a correction Lega proposed and the ONE plan it is bound to ----------

/**
 * `?review=<id>` of the cockpit's deep link (`/studio/<id>?t=12&review=<reviewId>`) → that review id, or null. A separate helper, so
 * studioRoute keeps its shape.
 */
export function studioReviewParam(query) {
  return typeof query?.review === "string" && ID_RE.test(query.review) ? query.review : null;
}

/**
 * What the correction panel offers for a proposal: { kind: "plan", planId, status } — the plan's own card (its ONE confirmation applies,
 * renders and runs QA; the server refuses a separate apply) — { kind: "apply" } — the M09 apply (no plan) — or { kind: "none" } (nothing
 * to apply: a dismissed / applied proposal with no plan, a comment, a clarification, an invalid preview).
 */
export function proposalAction(review, reviews = []) {
  if (!review || typeof review !== "object") return { kind: "none" };
  if (review.plan && typeof review.plan === "object" && review.plan.id && (review.status === "OPEN" || review.status === "APPLIED")) {
    return { kind: "plan", planId: String(review.plan.id), status: review.plan.status || null };
  }
  if (review.status !== "OPEN") return { kind: "none" };
  const patch = review.patch || {};
  if (!(Array.isArray(patch.ops) && patch.ops.length) || patch.preview?.valid === false || patch.clarification) return { kind: "none" };
  // D7 review: another proposal of this version waits for its plan's ONE confirmation — that plan's card decides first (the server refuses
  // the direct apply, EDIT_PLAN_PROPOSED): { kind: "waiting", planId, status, reviewId }, never the M09 Aplică.
  const waiting = waitingCorrection(reviews, review.id);
  if (waiting) return { kind: "waiting", planId: String(waiting.plan.id), status: waiting.plan.status, reviewId: waiting.id };
  return { kind: "apply" };
}

/**
 * D7 review: whether a { kind: "waiting" } action still holds against the plan's live view (GET /api/ops/plans/<id>): true until that view —
 * of THIS plan — says it no longer waits (confirmed, cancelled with „Nu acum”, superseded, expired). No view yet → still waiting.
 */
export function waitingStillWaits(action, livePlan) {
  if (!action || action.kind !== "waiting") return false;
  if (!livePlan || typeof livePlan !== "object" || String(livePlan.id || "") !== String(action.planId)) return true;
  if (livePlan.status !== "PROPOSED") return false;
  return !(livePlan.confirmBy && Number.isFinite(Date.parse(livePlan.confirmBy)) && Date.parse(livePlan.confirmBy) <= Date.now());
}

/** D7 review: the open proposal of this version whose correction plan waits for its confirmation (PROPOSED), other than `exceptId`, or null. */
export function waitingCorrection(reviews, exceptId = null) {
  const list = Array.isArray(reviews) ? reviews.filter((r) => r && typeof r === "object") : [];
  return list.find((r) => r.id !== exceptId && r.status === "OPEN" && r.plan && typeof r.plan === "object" && r.plan.id && r.plan.status === "PROPOSED") || null;
}

/**
 * The proposal the correction panel opens with: the deep-linked review when it is on this version, otherwise the ONE open review waiting
 * for its plan's confirmation (PROPOSED), otherwise null (two such reviews: none is guessed; the Review tab lists them all).
 */
export function studioPlanReview(reviews, deepReviewId = null) {
  const list = Array.isArray(reviews) ? reviews.filter((r) => r && typeof r === "object") : [];
  if (deepReviewId) {
    const deep = list.find((r) => r.id === deepReviewId);
    if (deep) return deep;
  }
  const waiting = list.filter((r) => r.status === "OPEN" && r.plan?.status === "PROPOSED");
  return waiting.length === 1 ? waiting[0] : null;
}

// ---------- frames & timecodes (rational fps, the IR's units) ----------

const DEFAULT_FPS = Object.freeze({ num: 30, den: 1 });
/** A safe { num, den } (positive integers); anything else → 30/1. */
export function normFps(fps) {
  const num = Number(fps?.num), den = Number(fps?.den ?? 1);
  return Number.isInteger(num) && num > 0 && Number.isInteger(den) && den > 0 ? { num, den } : { ...DEFAULT_FPS };
}
export const fpsValue = (fps) => { const f = normFps(fps); return f.num / f.den; };
/** Frame index shown at `ms` (floor; a tiny epsilon keeps exact frame starts on their own frame). */
export function msToFrame(ms, fps) {
  const f = normFps(fps);
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor((v * f.num) / (1000 * f.den) + 1e-6);
}
/** Start time (ms, fractional) of a frame. */
export function frameToMs(frame, fps) { const f = normFps(fps); return (Math.max(0, frame) * 1000 * f.den) / f.num; }
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * The time display of the player at `ms`:
 * - `frame`: the frame index at the IR fps;
 * - `clock`: "mm:ss.ff" — real minutes:seconds and `ff` = the frame's index inside that real second (at 29.97 fps a second has
 *   29 or 30 frames; the clock never drifts from the media time);
 * - `timecode`: "HH:MM:SS:FF" non-drop-frame at the nominal rate — the same format the server uses in QA findings.
 */
export function formatTimecode(ms, fps) {
  const f = normFps(fps);
  const frame = msToFrame(ms, f);
  const sec = Math.floor((frame * f.den) / f.num + 1e-9);
  const firstOfSecond = Math.ceil((sec * f.num) / f.den - 1e-9);
  const ff = Math.max(0, frame - firstOfSecond);
  const clock = `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}.${pad2(ff)}`;
  const nominal = Math.max(1, Math.round(f.num / f.den));
  const totalS = Math.floor(frame / nominal);
  const timecode = `${pad2(Math.floor(totalS / 3600))}:${pad2(Math.floor(totalS / 60) % 60)}:${pad2(totalS % 60)}:${pad2(frame % nominal)}`;
  return { frame, clock, timecode, ms: Math.max(0, Math.round(Number(ms) || 0)) };
}
/** The time (ms, integer) one frame before/after the frame at `ms`, aimed slightly inside the target frame. */
export function stepFrameMs(ms, delta, fps) {
  const target = Math.max(0, msToFrame(ms, fps) + Math.trunc(delta));
  return Math.round(frameToMs(target, fps) + Math.min(1, frameToMs(1, fps) / 4));
}
/** Seconds with a Romanian decimal comma: 12500 → "12,50 s". */
export const fmtSeconds = (ms, digits = 2) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(digits).replace(".", ",")} s` : "—");
/** A signed duration delta: +1500 → "+1,50 s", −2000 → "−2,00 s", 0 → "0,00 s". */
export function fmtDelta(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms === 0) return "0,00 s";
  return `${ms > 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(2).replace(".", ",")} s`;
}
/** A free-text time field ("12,5", "12.5", "00:12.15", "1:02") → ms, or null. Frames after "." in mm:ss.ff are read at `fps`. */
export function parseTimeInput(text, fps) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const mmss = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,2}))?$/.exec(s);
  if (mmss) {
    const [m, sec, ff] = [Number(mmss[1]), Number(mmss[2]), mmss[3] === undefined ? 0 : Number(mmss[3])];
    if (sec > 59) return null;
    const f = normFps(fps);
    const base = (m * 60 + sec) * 1000;
    const firstFrame = Math.ceil(((m * 60 + sec) * f.num) / f.den - 1e-9);
    return ff ? Math.round(frameToMs(firstFrame + ff, f) + 0.5) : base;
  }
  return parseSecondsParam(s);
}

// ---------- board ----------

/**
 * The board as columns in the fixed order, whatever the API sent: every known stage present (empty when the API has none),
 * unknown stages ignored, card counts and the archived counter kept.
 */
export function boardColumns(board) {
  const byStage = new Map((Array.isArray(board?.columns) ? board.columns : []).map((c) => [c?.stage, c]));
  return {
    columns: BOARD_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const cards = Array.isArray(c?.cards) ? c.cards.filter((x) => x && x.id) : [];
      return { stage, label: c?.label || STAGE_LABELS[stage], cards, count: cards.length };
    }),
    archived: Number.isFinite(Number(board?.archived)) ? Number(board.archived) : 0,
    total: BOARD_STAGES.reduce((n, s) => n + (Array.isArray(byStage.get(s)?.cards) ? byStage.get(s).cards.length : 0), 0),
  };
}

/**
 * The measurable-progress rule: a percentage is shown ONLY when the API gives a measured one (`percent` in 0..100 with
 * `measured === true`); a checklist of verified facts is shown as „done din total”; anything else shows nothing (never a guess).
 */
export function measurableProgress(progress) {
  if (!progress || typeof progress !== "object") return null;
  const p = Number(progress.percent);
  if (progress.measured === true && progress.percent !== null && progress.percent !== undefined && Number.isFinite(p) && p >= 0 && p <= 100) {
    return { kind: "percent", value: Math.round(p), text: `${Math.round(p)}%` };
  }
  const done = Number(progress.done), total = Number(progress.total);
  if (Number.isInteger(done) && Number.isInteger(total) && total > 0 && done >= 0 && done <= total) {
    const steps = Array.isArray(progress.steps) ? progress.steps.map((s) => ({ key: String(s?.key || s?.label || ""), label: String(s?.label || s?.key || ""), done: s?.done === true })) : [];
    return { kind: "checklist", done, total, steps, text: `${done} din ${total} fapte verificate`, next: steps.find((s) => !s.done)?.label || null };
  }
  return null;
}

/** A render progress event (live, `media.render.progress`): the percent only when the event carries a measured number. */
export function renderProgress(event) {
  if (!event || typeof event !== "object") return null;
  const p = Number(event.percent);
  const percent = event.percent !== null && event.percent !== undefined && Number.isFinite(p) && p >= 0 && p <= 100 ? Math.round(p) : null;
  const phase = RENDER_PHASES[event.phase] || (event.phase ? String(event.phase) : "—");
  const segment = Number.isInteger(event.segment) && Number.isInteger(event.segments) ? `segment ${event.segment}/${event.segments}${event.cache === "hit" ? " (din cache)" : ""}` : null;
  return { percent, phase, segment, code: event.code || null };
}
export const RENDER_PHASES = Object.freeze({ segments: "segmente", measure: "măsurare loudness", final: "compunere finală", validate: "validare", done: "gata", failed: "eșuată", cancelled: "anulată" });
export const RENDER_STATUS = Object.freeze({
  REQUESTED: ["neutral", "în coadă"], CLAIMED: ["info", "preluată"], RUNNING: ["info", "rulează"], VALIDATING: ["info", "validare"],
  CANCEL_REQUESTED: ["warn", "oprire cerută"], CANCELLED: ["neutral", "anulată"], DONE: ["ok", "gata"], FAILED: ["error", "eșuată"], INTERRUPTED: ["warn", "întreruptă"],
});
export const RENDER_ACTIVE = Object.freeze(["REQUESTED", "CLAIMED", "RUNNING", "VALIDATING", "CANCEL_REQUESTED"]);
export const RENDER_RETRYABLE = Object.freeze(["FAILED", "CANCELLED", "INTERRUPTED"]);
/** The render to play for an edit version: the newest DONE final, else the newest DONE draft. */
export function pickPlayable(renders) {
  const done = (Array.isArray(renders) ? renders : []).filter((r) => r?.status === "DONE" && r.outputAssetVersionId);
  return done.find((r) => r.profile === "final") || done[0] || null;
}

// ---------- timeline (read-only visualization of the IR) ----------

const clipLen = (c) => {
  const len = Number(c?.sourceOut) - Number(c?.sourceIn);
  const speed = c?.speed === undefined ? 1 : Number(c.speed);
  return Number.isFinite(len) && Number.isFinite(speed) && speed > 0 ? Math.max(0, Math.round(len / speed)) : 0;
};
const audioLen = (c) => { const len = Number(c?.sourceOut) - Number(c?.sourceIn); return Number.isFinite(len) ? Math.max(0, len) : 0; };
export const TRACK_KIND_LABEL = Object.freeze({ video: "Video", text: "Text", captions: "Subtitrări", audio: "Sunet" });

/**
 * IR → lanes for the inspector: { fps, durationFrames, durationMs, lanes: [{ id, kind, label, items: [{ id, kind, start, end,
 * startMs, endMs, leftPct, widthPct, label, text, badge }] }] }. Video clips keep their capture label (SIMULATION, REPLAY…).
 */
export function timelineLayout(ir) {
  const fps = normFps(ir?.fps);
  const tracks = Array.isArray(ir?.tracks) ? ir.tracks : [];
  let duration = 0;
  for (const t of tracks) if (t?.kind === "video") for (const c of t.clips || []) duration = Math.max(duration, (Number(c.start) || 0) + clipLen(c));
  const total = Math.max(1, duration);
  const item = (kind, id, start, end, extra) => {
    const s = Math.max(0, Number(start) || 0), e = Math.max(s, Number(end) || 0);
    return { id: String(id || ""), kind, start: s, end: e, startMs: Math.round(frameToMs(s, fps)), endMs: Math.round(frameToMs(e, fps)),
      leftPct: Math.min(100, (s / total) * 100), widthPct: Math.max(0.6, Math.min(100 - Math.min(100, (s / total) * 100), ((e - s) / total) * 100)), ...extra };
  };
  const lanes = tracks.filter((t) => t && TRACK_KIND_LABEL[t.kind]).map((t) => {
    let items = [];
    if (t.kind === "video") items = (t.clips || []).map((c) => item("clip", c.id, c.start, (Number(c.start) || 0) + clipLen(c),
      { label: c.label || null, text: c.shotId ? `cadru ${c.shotId}` : String(c.assetVersionId || "").slice(-8), badge: c.label && c.label !== "ORIGINAL_RECORDING" ? c.label : null, hold: c.holdIntentional === true }));
    if (t.kind === "text") items = (t.items || []).map((x) => item("text", x.id, x.start, x.end, { label: x.style || null, text: String(x.text || "") }));
    if (t.kind === "captions") items = (t.cues || []).map((q) => item("cue", q.id, q.start, q.end, { label: null, text: String(q.text || "") }));
    if (t.kind === "audio") items = (t.clips || []).map((c) => item("audio", c.id, c.start, (Number(c.start) || 0) + audioLen(c), { label: c.role || null, text: `${c.role || "audio"} · ${Number(c.gainDb ?? 0)} dB` }));
    return { id: String(t.id || t.kind), kind: t.kind, label: `${TRACK_KIND_LABEL[t.kind]} · ${t.id}`, items };
  });
  return { fps, durationFrames: duration, durationMs: Math.round(frameToMs(duration, fps)), lanes };
}
/** The items active at `ms` (for highlighting under the playhead). */
export function activeItemIds(layout, ms) {
  const out = new Set();
  for (const lane of layout?.lanes || []) for (const it of lane.items) if (ms >= it.startMs && ms < it.endMs) out.add(`${lane.id}:${it.id}`);
  return out;
}

// ---------- review proposals ----------

/** One proposed operation in plain Romanian (the server's ops: move_text, extend_clip, trim_clip, replace_text, remove_cue, cut_range, edit_cue). */
export function describeOp(op) {
  if (!op || typeof op !== "object") return "—";
  switch (op.op) {
    case "move_text": return `Mută textul ${op.itemId}${Number.isFinite(op.dy) && op.dy ? (op.dy < 0 ? " mai sus" : " mai jos") : ""}${Number.isFinite(op.dx) && op.dx ? (op.dx < 0 ? " la stânga" : " la dreapta") : ""} (dx ${op.dx ?? 0}, dy ${op.dy ?? 0})`;
    case "extend_clip": return `Prelungește clipul ${op.clipId} cu ${op.frames} cadre`;
    case "trim_clip": return `Scurtează clipul ${op.clipId}${Number.isFinite(op.frames) ? ` cu ${op.frames} cadre` : ""}`;
    case "replace_text": return `Înlocuiește textul ${op.itemId} cu „${String(op.text ?? "").slice(0, 120)}”`;
    case "remove_cue": return `Scoate subtitrarea ${op.cueId}`;
    case "cut_range": return `Taie intervalul cadrelor ${op.from}–${op.to}`;
    case "edit_cue": return `Schimbă subtitrarea ${op.cueId} în „${String(op.text ?? "").slice(0, 120)}”`;
    default: return `${op.op || "operație"} ${JSON.stringify(op).slice(0, 120)}`;
  }
}
/** The preview of a proposal → { valid, errors[], lines[], durationDelta, durationText }. */
export function proposalPreview(patch) {
  const preview = patch?.preview || null;
  const diff = preview?.diff || null;
  const delta = Number(diff?.durationMs?.delta);
  return {
    hasOps: Array.isArray(patch?.ops) && patch.ops.length > 0,
    valid: preview ? preview.valid === true : null,
    errors: Array.isArray(preview?.errors) ? preview.errors.map((e) => `${e.path ? `${e.path}: ` : ""}${e.message || e.code}`) : [],
    lines: Array.isArray(diff?.summary) ? diff.summary : [],
    durationDelta: Number.isFinite(delta) ? delta : null,
    durationText: diff?.durationMs ? `${fmtSeconds(diff.durationMs.before)} → ${fmtSeconds(diff.durationMs.after)} (${fmtDelta(delta)})` : null,
    counts: diff?.counts || null,
  };
}

// ---------- QA ----------

export const SEVERITY = Object.freeze({ error: ["error", "eroare"], warning: ["warn", "avertisment"], info: ["neutral", "info"] });
const SEV_ORDER = { error: 0, warning: 1, info: 2 };
export const QA_STATUS = Object.freeze({ PASS: ["ok", "PASS"], WARN: ["warn", "WARN"], FAIL: ["error", "FAIL"], NOT_RUN: ["neutral", "nerulat"] });
export const QA_KIND_LABEL = Object.freeze({ technical: "tehnic", editorial: "editorial + încadrare", factual: "factual", rights: "drepturi", layout: "încadrare" });
/** Latest report per kind (reports newest first, as the API sends them) and their findings sorted by severity then time. */
export function latestQa(reports) {
  const latest = new Map();
  for (const r of Array.isArray(reports) ? reports : []) if (r?.kind && !latest.has(r.kind)) latest.set(r.kind, r);
  const findings = [...latest.values()].flatMap((r) => (Array.isArray(r.findings) ? r.findings : []).map((f) => ({ ...f, kind: r.kind })))
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3) || (a.range?.fromMs ?? Infinity) - (b.range?.fromMs ?? Infinity));
  return { kinds: [...latest.values()].map((r) => ({ kind: r.kind, status: r.status, at: r.createdAt })), findings };
}

// ---------- distribution & platforms ----------

export const OPERATION_STATUS = Object.freeze({
  DOCUMENTED: ["neutral", "documentat"], NEEDS_AUTH: ["warn", "necesită autorizare"], NEEDS_REVIEW: ["warn", "necesită aprobarea platformei"],
  VERIFIED_LIVE: ["ok", "verificat live"], ASSISTED_ONLY: ["info", "doar asistat (manual)"], COST_BLOCKED: ["error", "COST_BLOCKED · plan plătit"],
  POLICY_UNSUPPORTED: ["error", "nesuportat de politică"], NOT_TESTED: ["neutral", "NOT_TESTED · netestat"],
});
export const OPERATION_LABEL = Object.freeze({ manual_pack: "Pachet manual", api_upload: "Încărcare API", api_schedule: "Programare API", api_draft: "Schiță API", insights: "Statistici" });
export const MANIFEST_STATUS = Object.freeze({ DRAFT: ["neutral", "ciornă"], APPROVED: ["ok", "aprobat"], INVALIDATED: ["error", "invalidat"], SUPERSEDED: ["neutral", "înlocuit"] });
export const ATTEMPT_STATUS = Object.freeze({
  NOT_STARTED: ["neutral", "neînceput"], PREPARED: ["neutral", "pregătit"], PACK_READY: ["info", "pachet gata"], SCHEDULED: ["info", "programat"],
  MISSED_NEEDS_DECISION: ["warn", "ratat · decide tu"], UPLOADING: ["info", "se încarcă"], PROCESSING: ["info", "procesare"], DRAFT_EXTERNAL: ["info", "schiță pe platformă"],
  PUBLISHED: ["ok", "publicat (manual, cu link)"], FAILED: ["error", "eșuat"], CANCELLED: ["neutral", "anulat"], OUTCOME_UNKNOWN: ["warn", "rezultat necunoscut"],
});
export const ATTEMPT_OPEN = Object.freeze(["PREPARED", "PACK_READY", "SCHEDULED", "MISSED_NEEDS_DECISION"]);
/** Distribution platform of a variant profile key (reels_9x16 → instagram), from the profiles the API sent. */
export function platformOfProfile(profiles, key) {
  const p = profiles && typeof profiles === "object" ? profiles[key] : null;
  return p?.platform || p?.rightsPlatform || null;
}
/** Manifest rows for display: one per variant with the hashes and the platform's release state. */
export function manifestRows(manifest, releases) {
  const by = releases?.byPlatform || {};
  return (manifest?.body?.variants || []).map((v) => ({
    platform: v.platform, variantId: v.variantId, account: v.account, caption: v.caption, captionSha256: v.captionSha256,
    mediaSha256: v.media?.sha256 || null, rendered: Boolean(v.media), cover: v.cover?.sha256 || null,
    schedule: v.schedule ? `${v.schedule.local.replace("T", " ")} (${v.schedule.timezone}, ${v.schedule.offset})` : "fără programare (manual)",
    disclosure: v.disclosure?.aiGenerated ? "conținut generat cu AI — de declarat" : null,
    release: by[v.platform] || { status: "NOT_STARTED", attemptId: null, url: null },
  }));
}
export const shortHash = (h, n = 12) => (h ? String(h).slice(0, n) : "—");

/** The API limitations the Studio must show (codes the server sends), with a tone. */
export const LIMITATION_TONE = Object.freeze({ VOICE_FILTER_OFF: "warn", LOCAL_STT_UNAVAILABLE: "warn", LIVE_MEDIA_CAPTURE_DISABLED: "info", LIVE_UPLOAD_DISABLED: "info", AUTO_PUBLISH_OFF: "info" });
export const limitationTone = (code) => LIMITATION_TONE[code] || "info";

// ---------- analytics CSV ----------

/** Delimiter and header cells of a CSV export (BOM stripped, quotes handled on the header line). */
export function csvHeaders(text) {
  const raw = String(text ?? "").replace(/^﻿/, "");
  const first = raw.split(/\r?\n/).find((l) => l.trim()) || "";
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
  const cells = []; let cur = ""; let quoted = false;
  for (let i = 0; i < first.length; i += 1) {
    const ch = first[i];
    if (quoted) { if (ch === '"' && first[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (first) cells.push(cur.trim());
  return { delimiter, headers: cells.filter((c) => c.length > 0) };
}
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** A first mapping suggestion: header ≈ metric key or label → that key; date-like → @date; else @ignore. The owner reviews it. */
export function suggestMapping(headers, metrics) {
  const defs = metrics && typeof metrics === "object" ? Object.entries(metrics) : [];
  const out = {};
  for (const h of headers || []) {
    const f = fold(h);
    const hit = defs.find(([key, def]) => fold(key) === f || fold(def?.label) === f);
    out[h] = hit ? hit[0] : /^(data|date|zi|day)$/.test(f) ? "@date" : "@ignore";
  }
  return out;
}

/** Studio write paths that must keep working with a stale page (they are in the shared fail-safe list). */
export const STUDIO_FAILSAFE_PATHS = Object.freeze(["/api/media/renders/{id}/cancel", "/api/content/releases/{id}/cancel", "/api/media/rights/{id}/revoke",
  "/api/media/transcripts/{id}/cancel", "/api/media/captures/{id}/cancel"]);
/** Studio write paths that add authority or work and therefore are NOT fail-safe. */
export const STUDIO_GUARDED_PATHS = Object.freeze(["/api/media/renders", "/api/media/qa", "/api/content/manifests", "/api/content/manifests/{id}/approve",
  "/api/content/manifests/{id}/packs", "/api/content/releases/{id}/manual", "/api/media/edit-versions/{id}/decision", "/api/media/edit-versions/{id}/patches",
  "/api/media/reviews/{id}/apply", "/api/media/edit-versions/{id}/variants", "/api/media/assets/import", "/api/media/upload", "/api/media/rights", "/api/content/metrics/import"]);
export const fillPath = (p, id = "x_1") => p.replace("{id}", id);

// ---------------------------------------------------------------- M10: the text a correction targets
const DISCLOSURE_RE = /^\s*(simulare|simulation|reconstituire|reconstruction|reluare|replay|generat|generated|accelerat|×\s*\d)/i;
/** Text items visible at `ms` (all text tracks), each marked when it is a disclosure label (never guessed as the target). */
export function textItemsAt(ir, ms) {
  if (!ir || !Array.isArray(ir.tracks)) return [];
  const frame = msToFrame(ms, ir.fps);
  return ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items || [])
    .filter((i) => Number(i.start) <= frame && frame < Number(i.end))
    .map((i) => ({ id: i.id, text: String(i.text || "").slice(0, 60), style: i.style, isLabel: i.style === "label" || DISCLOSURE_RE.test(String(i.text || "")) }));
}
/** The automated QA and the creative review are separate statements (never merged into one "approved"). */
export function reviewStates(qaStatus, creativeApproved) {
  return { automated: qaStatus ? `QA automat: ${qaStatus === "PASS" ? "trecut" : qaStatus === "WARN" ? "avertismente" : qaStatus === "FAIL" ? "picat" : "nerulat"}` : "QA automat: nerulat",
    creative: creativeApproved ? "Revizuire creativă: aprobată de tine" : "Revizuire creativă: în așteptarea ta" };
}
