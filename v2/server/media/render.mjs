// M09 durable render queue. One row per render job in media_render_jobs; the state machine is
//   REQUESTED → CLAIMED → RUNNING → VALIDATING → DONE
//   any active state → FAILED (with a failure code) | CANCEL_REQUESTED → CANCELLED | (boot) INTERRUPTED
// Guarantees:
// - request() is idempotent (INSERT OR IGNORE on idempotency_key): a double click returns the existing job.
// - tick() claims the oldest REQUESTED job atomically (UPDATE … WHERE status = 'REQUESTED' inside a transaction) only when the
//   concurrency allows and — with mediaPolicy.interactivePriority — no AI run or Lega voice session is active
//   (`isInteractiveBusy()`, injected by the Hub).
// - recover() (boot) marks CLAIMED/RUNNING/VALIDATING as INTERRUPTED and CANCEL_REQUESTED as CANCELLED. A job is NEVER resumed
//   on its own: the owner retries it (retry() = a new job; the segment cache makes the retry cheap).
// - Every ffmpeg call runs with cwd = <mediaWorkDir>/jobs/<jobId> and relative paths; cancel() kills the whole process tree
//   (supervisor → taskkill /T).
// - Segments are cached by the compile key (input hashes, never names or text), validated before they enter the cache.
// - The final output is validated (decodes completely, duration within one frame + 50 ms, canvas, fps, yuv420p, AAC audio)
//   BEFORE it is promoted to renders/<jobId>.mp4 and registered as a derivative. A partial or invalid output stays in the job
//   folder next to journal.json (scratch root, never served) and is never registered.
// - Progress goes only to `live.publish({ type: "media.render.progress", … })` from measured ffmpeg out_time and segment counts;
//   persisted events exist only for transitions (requested, claimed, done, failed, cancelled, interrupted).
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { validateIR, irHash } from "./ir.mjs";
import { getPreset, resolveFonts, PRESETS } from "./visual-bible.mjs";
import { freeBytesAt } from "./paths.mjs";
import { compileRenderPlan, parseLoudnormJson, COMPILE_VERSION, RENDER_PROFILES } from "./compile.mjs";

// M10.2: TOOLS_NOT_PINNED / TOOL_CHANGED — the run re-verifies the pinned ffmpeg/ffprobe identity and refuses before spawning the job.
export const RENDER_FAILURE_CODES = Object.freeze(["DISK_RESERVE", "DISK_FULL", "TOOL_MISSING", "TOOLS_NOT_PINNED", "TOOL_CHANGED", "INPUT_MISSING", "INVALID_OUTPUT", "TIMEOUT", "CANCELLED", "TOOL_FAILED", "IR_INVALID"]);
export const ACTIVE_RENDER_STATUSES = Object.freeze(["CLAIMED", "RUNNING", "VALIDATING", "CANCEL_REQUESTED"]);
export const TERMINAL_RENDER_STATUSES = Object.freeze(["DONE", "FAILED", "CANCELLED", "INTERRUPTED"]);
const RETRYABLE = new Set(["FAILED", "CANCELLED", "INTERRUPTED"]);
const GIB = 1024 ** 3;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KEY_RE = /^[\x21-\x7e]{1,200}$/;
const DISK_FULL_RE = /no space left on device|ENOSPC|not enough space on the disk|disk full|disk quota exceeded/i;
const INPUT_CODES = new Set(["MEDIA_FILE_MISSING", "MEDIA_VERSION_MISSING", "MEDIA_QUARANTINED", "MEDIA_MISSING", "MEDIA_REMOVED_DERIVATIVE", "MEDIA_LINK_REFUSED", "MEDIA_PATH_OUTSIDE", "INPUT_MISSING"]);
const IR_CODES = new Set(["IR_INVALID", "PRESET_UNKNOWN", "PRESET_TAMPERED", "FONT_MISSING", "PROFILE_INVALID", "COMPILE_COLOR"]);
const PROGRESS_INTERVAL_MS = 250;

const FAILURE_TEXT = {
  DISK_RESERVE: "Spațiul liber pe disc este sub rezerva configurată; randarea nu a pornit.",
  DISK_FULL: "Discul s-a umplut în timpul randării.",
  TOOL_MISSING: "ffmpeg/ffprobe nu sunt disponibile.",
  TOOLS_NOT_PINNED: "ffmpeg/ffprobe nu sunt fixate (versiune + sha256); randarea nu a pornit.",
  TOOL_CHANGED: "ffmpeg/ffprobe s-au schimbat față de binarele fixate; confirmă schimbarea înainte de randare.",
  INPUT_MISSING: "Un fișier de intrare lipsește sau nu poate fi folosit.",
  INVALID_OUTPUT: "Fișierul produs nu a trecut validarea.",
  TIMEOUT: "ffmpeg a depășit timpul alocat.",
  CANCELLED: "Randarea a fost anulată.",
  TOOL_FAILED: "ffmpeg a eșuat.",
  IR_INVALID: "Editarea (IR) nu poate fi randată.",
};

const renderError = (code, message, data) => new HubError(code === "CANCELLED" ? "task" : code === "IR_INVALID" ? "validation" : code === "INPUT_MISSING" ? "not_found" : code === "DISK_RESERVE" || code === "DISK_FULL" ? "quota"
  : code === "TOOLS_NOT_PINNED" || code === "TOOL_CHANGED" ? "policy" : "tool",
  message || FAILURE_TEXT[code], { code, data });

/** Maps any error to one of RENDER_FAILURE_CODES (+ a message without file paths from the user). */
export function classifyRenderError(error) {
  const code = error?.code;
  if (RENDER_FAILURE_CODES.includes(code)) return { code, message: error.message || FAILURE_TEXT[code] };
  if (code === "ENOSPC" || DISK_FULL_RE.test(String(error?.message || ""))) return { code: "DISK_FULL", message: FAILURE_TEXT.DISK_FULL };
  if (INPUT_CODES.has(code)) return { code: "INPUT_MISSING", message: error.message || FAILURE_TEXT.INPUT_MISSING };
  if (IR_CODES.has(code)) return { code: "IR_INVALID", message: error.message || FAILURE_TEXT.IR_INVALID };
  if (code === "UNDECODABLE") return { code: "INVALID_OUTPUT", message: error.message || FAILURE_TEXT.INVALID_OUTPUT };
  return { code: "TOOL_FAILED", message: `${FAILURE_TEXT.TOOL_FAILED}${error?.message ? ` ${String(error.message).slice(0, 400)}` : ""}` };
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function writeText(jobDir, rel, content) {
  if (typeof rel !== "string" || path.isAbsolute(rel) || rel.split(/[\\/]/).some((p) => p === ".." || !p)) throw renderError("TOOL_FAILED", "Cale de fișier de lucru invalidă în planul de randare.");
  const abs = path.join(jobDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}
const rmQuiet = (p) => { try { fs.rmSync(p, { force: true, recursive: true }); } catch { /* best effort */ } };

/**
 * createRenderQueue({ db, bus, live, clock, paths, tools, assets, settings, isInteractiveBusy, resolveToolVersion, fontsDir, timeoutMs })
 */
export function createRenderQueue({ db, bus, live = null, clock = () => new Date(), paths, tools, assets, settings = null,
  isInteractiveBusy = () => false, resolveToolVersion = null, fontsDir = "C:/Windows/Fonts", timeoutMs = null, compileVersion = COMPILE_VERSION }) {
  if (!db || !bus || !paths || !tools || !assets) throw new Error("createRenderQueue requires db, bus, paths, tools and assets");
  const now = () => clock().toISOString();
  const active = new Map(); // jobId → { token, procKey, cancelRequested, done }
  let closing = false, detached = false;
  const lastPublish = new Map();

  const policy = () => ({ renderConcurrency: 1, diskReserveGb: 15, interactivePriority: true, ...(settings?.get("mediaPolicy") || {}) });
  const selJob = db.prepare("SELECT * FROM media_render_jobs WHERE id = ?");
  const selByKey = db.prepare("SELECT * FROM media_render_jobs WHERE idempotency_key = ?");
  const selEdit = db.prepare(`SELECT v.*, p.title AS project_title, p.content_project_id FROM media_edit_versions v
    JOIN media_edit_projects p ON p.id = v.edit_project_id WHERE v.id = ?`);
  const insJob = db.prepare(`INSERT OR IGNORE INTO media_render_jobs (id, edit_version_id, profile, idempotency_key, status, request_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?)`);
  const selCache = db.prepare("SELECT * FROM media_render_cache WHERE cache_key = ?");
  const upCache = db.prepare(`INSERT INTO media_render_cache (cache_key, rel_path, bytes, probe_json, tool_version, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET rel_path = excluded.rel_path, bytes = excluded.bytes, probe_json = excluded.probe_json, tool_version = excluded.tool_version, last_used_at = excluded.last_used_at`);
  const touchCache = db.prepare("UPDATE media_render_cache SET last_used_at = ? WHERE cache_key = ?");
  const delCache = db.prepare("DELETE FROM media_render_cache WHERE cache_key = ?");

  const view = (r) => r && ({
    id: r.id, editVersionId: r.edit_version_id, profile: r.profile, idempotencyKey: r.idempotency_key, status: r.status,
    request: parse(r.request_json, {}), progress: parse(r.progress_json, {}), segments: parse(r.segments_json, []),
    outputAssetVersionId: r.output_asset_version_id, error: r.error ? parse(r.error, { code: "TOOL_FAILED", message: r.error }) : null,
    attempts: r.attempts, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, startedAt: r.started_at, finishedAt: r.finished_at,
    active: active.has(r.id),
  });
  const get = (jobId) => view(selJob.get(String(jobId || ""))) || null;

  function list({ editVersionId = null, status = null, limit = 100 } = {}) {
    const where = []; const args = [];
    if (editVersionId) { where.push("edit_version_id = ?"); args.push(String(editVersionId)); }
    if (status) { where.push("status = ?"); args.push(String(status)); }
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    return db.prepare(`SELECT * FROM media_render_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args, lim).map(view);
  }

  const requireActor = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };

  function publish(jobId, data, { force = false } = {}) {
    if (!live?.publish) return;
    const t = Date.now();
    if (!force && t - (lastPublish.get(jobId) || 0) < PROGRESS_INTERVAL_MS) return;
    lastPublish.set(jobId, t);
    try { live.publish({ type: "media.render.progress", jobId, ...data }); } catch { /* a live channel failure never breaks a render */ }
  }

  // ------------------------------------------------------------------ request / retry

  /**
   * M10.2: a render needs a pinned, unchanged ffmpeg/ffprobe. Refused at the request (no job row, nothing spawned) with
   * TOOLS_NOT_PINNED / TOOL_CHANGED; the run re-verifies through tools.resolve(). Pinning is never a side effect of a render or a
   * read: it is the owner's command or a step listed in a confirmed plan. `resolveToolVersion` (the queue's test seam) replaces
   * the whole tool verification, so it skips this gate too.
   */
  function toolGate() {
    if (resolveToolVersion || typeof tools.requirePinned !== "function") return;
    tools.requirePinned();
  }

  /** Queues a render. Duplicate idempotency keys return the existing job (`duplicate: true`). */
  function request({ editVersionId, profile, actor, idempotencyKey = null } = {}) {
    if (closing) throw new HubError("policy", "Hub shutdown: render queue closed", { code: "HUB_SHUTDOWN" });
    const who = requireActor(actor);
    if (typeof editVersionId !== "string" || !ID_RE.test(editVersionId)) throw new HubError("validation", "Versiunea de editare este invalidă.", { code: "FIELD_INVALID" });
    if (!RENDER_PROFILES[profile]) throw new HubError("validation", "Profilul de randare trebuie să fie „draft” sau „final”.", { code: "PROFILE_INVALID" });
    const key = idempotencyKey === null || idempotencyKey === undefined || idempotencyKey === "" ? `render:${editVersionId}:${profile}` : idempotencyKey;
    if (typeof key !== "string" || !KEY_RE.test(key)) throw new HubError("validation", "Cheia de idempotență este invalidă (1–200 caractere tipăribile, fără spații).", { code: "FIELD_INVALID" });
    toolGate();
    const edit = selEdit.get(editVersionId);
    if (!edit) throw new HubError("not_found", "Versiunea de editare nu există.", { code: "EDIT_VERSION_MISSING" });
    return insertJob({ editVersionId, profile, key, actor: who, request: { editVersionId, profile, irSha256: edit.ir_sha256, compileVersion } });
  }

  function insertJob({ editVersionId, profile, key, actor, request: req }) {
    return bus.transaction(() => {
      const id = newId("mrj");
      const at = now();
      const r = insJob.run(id, editVersionId, profile, key, json(req), actor, at, at);
      if (Number(r.changes) !== 1) {
        const existing = selByKey.get(key);
        if (existing.edit_version_id !== editVersionId || existing.profile !== profile) {
          throw new HubError("conflict", "Cheia de idempotență a fost folosită deja pentru altă randare.", { code: "IDEMPOTENCY_CONFLICT" });
        }
        return { ...view(existing), duplicate: true };
      }
      bus.append({ type: "media.render.requested", scopeType: "media_render", scopeId: id, source: actor,
        payload: { jobId: id, editVersionId, profile, retryOf: req.retryOf || null } });
      return { ...get(id), duplicate: false };
    });
  }

  /** A new job for a FAILED / CANCELLED / INTERRUPTED one (same edit version and profile; the segment cache is reused). */
  function retry(jobId, actor) {
    const who = requireActor(actor);
    const old = selJob.get(String(jobId || ""));
    if (!old) throw new HubError("not_found", "Randarea nu există.", { code: "RENDER_MISSING" });
    if (!RETRYABLE.has(old.status)) throw new HubError("conflict", `Doar o randare eșuată, anulată sau întreruptă poate fi reluată (stare: ${old.status}).`, { code: "RENDER_NOT_RETRYABLE" });
    toolGate();
    if (!selEdit.get(old.edit_version_id)) throw new HubError("not_found", "Versiunea de editare nu mai există.", { code: "EDIT_VERSION_MISSING" });
    return insertJob({ editVersionId: old.edit_version_id, profile: old.profile, key: `retry:${old.id}`, actor: who,
      request: { ...parse(old.request_json, {}), retryOf: old.id, compileVersion } });
  }

  // ------------------------------------------------------------------ transitions

  function transition(jobId, token, from, to, fields = {}, event = null) {
    return bus.transaction(() => {
      const sets = ["status = ?", "updated_at = ?"]; const values = [to, now()];
      for (const [col, value] of Object.entries(fields)) { sets.push(`${col} = ?`); values.push(value); }
      const r = db.prepare(`UPDATE media_render_jobs SET ${sets.join(", ")} WHERE id = ? AND claim_token = ? AND status IN (${from.map(() => "?").join(",")})`)
        .run(...values, jobId, token, ...from);
      if (Number(r.changes) !== 1) return false;
      if (event) bus.append({ scopeType: "media_render", scopeId: jobId, source: "media-render", ...event });
      return true;
    });
  }
  const setProgress = (jobId, token, progress) => {
    db.prepare("UPDATE media_render_jobs SET progress_json = ?, updated_at = ? WHERE id = ? AND claim_token = ?").run(json(progress), now(), jobId, token);
  };

  // ------------------------------------------------------------------ claim

  /**
   * Claims and starts at most one job. → { claimed: jobId, done: Promise<job view> } | { deferred: true, reason } | { idle: true }.
   */
  function tick() {
    if (closing) return { idle: true, reason: "shutdown" };
    const p = policy();
    if (p.interactivePriority !== false) {
      let busy = false;
      try { busy = Boolean(isInteractiveBusy()); } catch { busy = true; } // an unknown state defers (interactive work wins)
      if (busy) return { deferred: true, reason: "interactive" };
    }
    const concurrency = Math.min(4, Math.max(1, Math.trunc(Number(p.renderConcurrency) || 1)));
    if (active.size >= concurrency) return { deferred: true, reason: "concurrency" };
    const token = newId("claim");
    const claimed = bus.transaction(() => {
      const row = db.prepare("SELECT id, edit_version_id, profile FROM media_render_jobs WHERE status = 'REQUESTED' ORDER BY created_at, rowid LIMIT 1").get();
      if (!row) return null;
      const at = now();
      const r = db.prepare("UPDATE media_render_jobs SET status = 'CLAIMED', claim_token = ?, attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ? AND status = 'REQUESTED'")
        .run(token, at, at, row.id);
      if (Number(r.changes) !== 1) return null;
      bus.append({ type: "media.render.claimed", scopeType: "media_render", scopeId: row.id, source: "media-render", payload: { jobId: row.id, editVersionId: row.edit_version_id, profile: row.profile } });
      return row.id;
    });
    if (!claimed) return { idle: true };
    const record = { token, procKey: null, cancelRequested: false, done: null };
    active.set(claimed, record);
    record.done = runJob(claimed, token, record).finally(() => { active.delete(claimed); lastPublish.delete(claimed); }).then(() => detached ? null : get(claimed));
    return { claimed, done: record.done };
  }

  // ------------------------------------------------------------------ cancel / recover

  /** Fail-safe cancel: REQUESTED → CANCELLED; active → CANCEL_REQUESTED → process tree killed → CANCELLED. */
  async function cancel(jobId, actor) {
    const who = requireActor(actor);
    const row = selJob.get(String(jobId || ""));
    if (!row) throw new HubError("not_found", "Randarea nu există.", { code: "RENDER_MISSING" });
    if (TERMINAL_RENDER_STATUSES.includes(row.status)) return { changed: false, job: view(row) };
    if (row.status === "REQUESTED") {
      const changed = bus.transaction(() => {
        const r = db.prepare("UPDATE media_render_jobs SET status = 'CANCELLED', error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'REQUESTED'")
          .run(json({ code: "CANCELLED", message: FAILURE_TEXT.CANCELLED }), now(), now(), row.id);
        if (Number(r.changes) !== 1) return false;
        bus.append({ type: "media.render.cancelled", scopeType: "media_render", scopeId: row.id, source: who, payload: { jobId: row.id, phase: "queued" } });
        return true;
      });
      if (changed) return { changed: true, job: get(row.id) };
      return cancel(jobId, actor); // claimed meanwhile: cancel the running job
    }
    bus.transaction(() => {
      db.prepare("UPDATE media_render_jobs SET status = 'CANCEL_REQUESTED', updated_at = ? WHERE id = ? AND status IN ('CLAIMED','RUNNING','VALIDATING')").run(now(), row.id);
    });
    const rec = active.get(row.id);
    if (rec) {
      rec.cancelRequested = true;
      rec.cancelledBy = who;
      if (rec.procKey) await tools.cancel(rec.procKey).catch(() => {});
      await Promise.race([rec.done.catch(() => {}), new Promise((r) => setTimeout(r, 20000).unref?.())]);
      return { changed: true, job: get(row.id) };
    }
    // Nothing runs in this process (a stale row): close it now.
    bus.transaction(() => {
      const r = db.prepare("UPDATE media_render_jobs SET status = 'CANCELLED', error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'CANCEL_REQUESTED'")
        .run(json({ code: "CANCELLED", message: FAILURE_TEXT.CANCELLED }), now(), now(), row.id);
      if (Number(r.changes) === 1) bus.append({ type: "media.render.cancelled", scopeType: "media_render", scopeId: row.id, source: who, payload: { jobId: row.id, phase: "stale" } });
    });
    return { changed: true, job: get(row.id) };
  }

  /** Boot recovery: active jobs of a previous process become INTERRUPTED (or CANCELLED when a cancel was pending). Never resumed. */
  function recover() {
    closing = false; detached = false;
    const out = { interrupted: [], cancelled: [] };
    const rows = db.prepare(`SELECT * FROM media_render_jobs WHERE status IN (${ACTIVE_RENDER_STATUSES.map(() => "?").join(",")})`).all(...ACTIVE_RENDER_STATUSES);
    for (const row of rows) {
      if (active.has(row.id)) continue;
      const to = row.status === "CANCEL_REQUESTED" ? "CANCELLED" : "INTERRUPTED";
      bus.transaction(() => {
        const err = to === "CANCELLED" ? { code: "CANCELLED", message: FAILURE_TEXT.CANCELLED }
          : { code: "INTERRUPTED", message: "Hub-ul s-a oprit în timpul randării; randarea nu se reia singură — folosește „Reia” pentru o randare nouă." };
        const r = db.prepare("UPDATE media_render_jobs SET status = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = ?")
          .run(to, json(err), now(), now(), row.id, row.status);
        if (Number(r.changes) !== 1) return;
        bus.append({ type: to === "CANCELLED" ? "media.render.cancelled" : "media.render.interrupted", scopeType: "media_render", scopeId: row.id, source: "media-render",
          payload: { jobId: row.id, from: row.status, phase: "boot" } });
        (to === "CANCELLED" ? out.cancelled : out.interrupted).push(row.id);
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ the run

  function checkCancel(jobId, rec) {
    if (detached) throw new HubError("policy", "Hub shutdown", { code: "HUB_SHUTDOWN" });
    if (rec.cancelRequested) throw renderError("CANCELLED");
    const row = selJob.get(jobId);
    if (row?.status === "CANCEL_REQUESTED") { rec.cancelRequested = true; throw renderError("CANCELLED"); }
  }

  function reserveCheck() {
    const reserve = Math.max(0, Number(policy().diskReserveGb) || 0) * GIB;
    for (const dir of [paths.root, paths.work]) {
      const free = freeBytesAt(dir);
      if (free !== null && free < reserve) {
        throw renderError("DISK_RESERVE", `Spațiul liber pe disc (${(free / GIB).toFixed(1)} GiB) este sub rezerva de ${(reserve / GIB).toFixed(0)} GiB; randarea nu a pornit.`);
      }
    }
  }

  async function defaultToolVersion() {
    // resolve() refuses a missing, unpinned or changed-unacknowledged toolset before any segment spawns (only `-version` ran).
    let r;
    try { r = await tools.resolve(); } catch (error) {
      if (["TOOL_MISSING", "TOOLS_NOT_PINNED", "TOOL_CHANGED"].includes(error?.code)) throw renderError(error.code, error.message, error.details);
      throw error;
    }
    if (!r?.ffmpeg || !r?.ffprobe) throw renderError("TOOL_MISSING", "ffmpeg sau ffprobe nu sunt disponibile; randarea nu poate porni.");
    return `ffmpeg-${r.ffmpeg.version || "necunoscut"}+${String(r.ffmpeg.sha256).slice(0, 16)}${r.ffmpeg.libsSha256 ? `+${r.ffmpeg.libsSha256.slice(0, 16)}` : ""}`;
  }

  const callTimeout = (expectedMs) => (typeof timeoutMs === "function" ? timeoutMs(expectedMs) : Number(timeoutMs) > 0 ? Number(timeoutMs)
    : Math.min(6 * 3600 * 1000, Math.max(120000, Math.round(expectedMs * 30) + 120000)));

  /** Runs one ffmpeg step and turns the result into success or a classified failure. */
  async function ffmpegStep({ jobId, rec, jobDir, args, label, expectedMs, onProgress }) {
    checkCancel(jobId, rec);
    rec.procKey = `media:render:${jobId}:${label}:${newId("p")}`;
    let r;
    try {
      r = await tools.run({ tool: "ffmpeg", args, cwd: jobDir, key: rec.procKey, timeoutMs: callTimeout(expectedMs), onProgress });
    } catch (error) {
      if (error?.code === "TOOL_MISSING") throw renderError("TOOL_MISSING", error.message);
      throw error;
    } finally { rec.procKey = null; }
    if (r.cancelled || rec.cancelRequested) throw renderError("CANCELLED");
    if (r.timedOut) throw renderError("TIMEOUT", `ffmpeg a depășit timpul alocat (${label}).`);
    if (r.code !== 0) {
      const tail = r.stderrLines.slice(-6).join(" | ").slice(0, 500);
      if (DISK_FULL_RE.test(r.stderrLines.join("\n"))) throw renderError("DISK_FULL", `Discul s-a umplut în timpul randării (${label}).`);
      throw renderError("TOOL_FAILED", `ffmpeg a eșuat (${label}, cod ${r.code})${tail ? `: ${tail}` : "."}`);
    }
    return r;
  }

  /** Probe + exact-geometry checks + a complete decode. Throws INVALID_OUTPUT. */
  async function validateOutput({ jobId, rec, jobDir, rel, canvas, fps, frames, expectedMs, frameMs, needAudio, label }) {
    const abs = path.join(jobDir, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { throw renderError("INVALID_OUTPUT", `ffmpeg nu a produs fișierul așteptat (${label}).`); }
    if (!st.isFile() || st.size === 0) throw renderError("INVALID_OUTPUT", `Fișierul produs este gol (${label}).`);
    let probe;
    try { probe = await tools.probe(abs); }
    catch (error) {
      if (error?.code === "TOOL_MISSING") throw renderError("TOOL_MISSING", error.message);
      throw renderError("INVALID_OUTPUT", `Fișierul produs nu poate fi citit ca video (${label}).`);
    }
    const problems = [];
    const v = probe.video;
    if (!v) problems.push("lipsește fluxul video");
    else {
      if (v.width !== canvas.width || v.height !== canvas.height) problems.push(`dimensiuni ${v.width}×${v.height} în loc de ${canvas.width}×${canvas.height}`);
      if (v.pixFmt !== "yuv420p") problems.push(`format de pixeli ${v.pixFmt || "necunoscut"} în loc de yuv420p`);
      if (!v.fps || v.fps.num * fps.den !== fps.num * v.fps.den) problems.push(`cadență ${v.fps ? `${v.fps.num}/${v.fps.den}` : "necunoscută"} în loc de ${fps.num}/${fps.den}`);
      if (Number.isInteger(v.frameCount) && v.frameCount !== frames) problems.push(`${v.frameCount} cadre în loc de ${frames}`);
      const dur = Number.isFinite(v.durationMs) ? v.durationMs : probe.durationMs;
      if (!Number.isFinite(dur) || Math.abs(dur - expectedMs) > frameMs + 50) problems.push(`durată ${dur} ms în loc de ${Math.round(expectedMs)} ms (toleranță un cadru + 50 ms)`);
    }
    if (needAudio && (!probe.audio || probe.audio.sampleRate !== 48000)) problems.push("lipsește fluxul audio AAC 48 kHz");
    if (problems.length) throw renderError("INVALID_OUTPUT", `Validarea a eșuat (${label}): ${problems.join("; ")}.`, { problems });
    // A complete decode: a file whose header is fine but whose packets are damaged must not be promoted or cached.
    const d = await ffmpegStep({ jobId, rec, jobDir, label: `${label}-decode`, expectedMs, args: ["-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", rel, "-map", "0", "-f", "null", "-"] })
      .catch((error) => { if (["CANCELLED", "TOOL_MISSING", "TIMEOUT"].includes(error.code)) throw error; throw renderError("INVALID_OUTPUT", `Fișierul produs nu se decodează complet (${label}).`); });
    if (d.stderrLines.some((l) => /error|invalid|corrupt/i.test(l))) throw renderError("INVALID_OUTPUT", `Decodarea completă a raportat erori (${label}).`);
    return probe;
  }

  function cacheLookup(key) {
    const row = selCache.get(key);
    if (!row) return null;
    try {
      const abs = paths.resolveRel(row.rel_path);
      const st = fs.lstatSync(abs);
      if (st.isFile() && !st.isSymbolicLink() && st.size === row.bytes) return { abs, row };
    } catch { /* missing or refused → stale */ }
    delCache.run(key);
    return null;
  }
  function linkOrCopy(src, dest) {
    rmQuiet(dest);
    try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
  }
  function storeCache(key, abs, probe, toolVersion) {
    const dir = path.join(paths.cacheDir(), "seg");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${key}.mp4`);
    const tmp = path.join(dir, `${key}.${newId("t")}.tmp`);
    fs.copyFileSync(abs, tmp);
    fs.renameSync(tmp, target);
    const at = now();
    upCache.run(key, paths.relOf(target), fs.statSync(target).size, json(probe), toolVersion, at, at);
  }

  async function runJob(jobId, token, rec) {
    let jobDir = null;
    const journal = { jobId, token, steps: [], partials: [] };
    const writeJournal = () => { if (!jobDir) return; try { writeJsonAtomic(path.join(jobDir, "journal.json"), journal); } catch { /* journal is best effort */ } };
    const step = (name, detail = {}) => { journal.steps.push({ at: now(), step: name, ...detail }); writeJournal(); };
    let cacheHits = 0; let cacheMisses = 0;
    try {
      if (!transition(jobId, token, ["CLAIMED"], "RUNNING", { progress_json: json({ phase: "prepare" }) })) checkCancel(jobId, rec);
      const job = selJob.get(jobId);
      jobDir = paths.jobDir(jobId);
      paths.ensure();
      fs.mkdirSync(jobDir, { recursive: true });
      Object.assign(journal, { editVersionId: job.edit_version_id, profile: job.profile, createdAt: now(), compileVersion });
      step("start");
      checkCancel(jobId, rec);
      reserveCheck();

      // The IR, validated against the library as it is NOW.
      const edit = selEdit.get(job.edit_version_id);
      if (!edit) throw renderError("IR_INVALID", "Versiunea de editare nu mai există.");
      const ir = parse(edit.ir_json, null);
      // Edit versions are immutable: the IR rendered must be the one hashed when the version was stored and when the render was
      // requested (a row changed underneath would otherwise render under the old version's identity).
      const requestedSha = parse(job.request_json, {})?.irSha256 || null;
      const storedSha = ir ? irHash(ir) : null;
      if (!ir || storedSha !== edit.ir_sha256 || (requestedSha && requestedSha !== storedSha)) {
        throw renderError("IR_INVALID", "IR-ul versiunii de editare nu mai corespunde amprentei cu care a fost salvat/cerut; randarea nu pornește.");
      }
      const presetRef = ir?.preset;
      let preset = null;
      if (presetRef && typeof presetRef.id === "string" && Number.isInteger(presetRef.version)) {
        try { preset = getPreset(db, presetRef.id, presetRef.version); } catch (error) { throw renderError("IR_INVALID", error.message); }
        if (!preset && PRESETS[presetRef.id]?.version === presetRef.version) preset = PRESETS[presetRef.id];
      }
      const fonts = preset ? resolveFonts(preset, { fontsDir }) : null;
      const validation = validateIR(ir, { getVersion: (id) => assets.getVersion(id), presets: preset ? [preset] : [], fonts: fonts || undefined });
      if (!validation.ok) {
        const onlyAssets = validation.errors.every((e) => e.code === "ASSET_MISSING" || e.code === "ASSET_UNAVAILABLE");
        const first = validation.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
        throw renderError(onlyAssets ? "INPUT_MISSING" : "IR_INVALID", `${onlyAssets ? "Intrări indisponibile" : "IR invalid"}: ${first}`, { errors: validation.errors.slice(0, 20) });
      }
      const assetMap = {};
      for (const versionId of validation.dependencies.assetVersionIds) {
        const v = assets.getVersion(versionId);
        let abs;
        try { abs = assets.versionPath(versionId); } catch (error) { throw renderError("INPUT_MISSING", `Fișierul pentru „${versionId}” nu poate fi folosit: ${error.message}`); }
        const rel = path.relative(jobDir, abs);
        assetMap[versionId] = { absPath: abs, inputPath: path.isAbsolute(rel) ? abs : rel.split(path.sep).join("/"), sha256: v.sha256, probe: v.probe, kind: v.kind };
      }
      const toolVersion = await (resolveToolVersion || defaultToolVersion)();
      checkCancel(jobId, rec);
      const compileArgs = { ir, profile: job.profile, assets: assetMap, fonts: fonts?.files || {}, fontRoles: fonts?.roles || null, preset, toolVersion, compileVersion };
      let plan = compileRenderPlan(compileArgs);
      Object.assign(journal, { irSha256: irHash(ir), toolVersion, planHash: plan.planHash, expectedFrames: plan.expectedFrames, canvas: plan.canvas });
      step("compiled", { segments: plan.segments.length, loudness: plan.final.loudnessMode });

      // ---- segments
      const total = plan.segments.length;
      const segResults = [];
      for (const seg of plan.segments) {
        checkCancel(jobId, rec);
        const target = path.join(jobDir, seg.output);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const segMs = plan.frameMs * seg.frames;
        const hit = cacheLookup(seg.key);
        if (hit) {
          linkOrCopy(hit.abs, target);
          touchCache.run(now(), seg.key);
          cacheHits += 1;
          segResults.push({ key: seg.key, clipId: seg.clipId, cache: "hit", frames: seg.frames });
          publish(jobId, { phase: "segments", segment: seg.index + 1, segments: total, cache: "hit", percent: Math.round(((seg.index + 1) / total) * 50) }, { force: true });
          step("segment_cache_hit", { clipId: seg.clipId, key: seg.key });
          continue;
        }
        for (const [rel, content] of Object.entries(seg.files)) writeText(jobDir, rel, content);
        journal.partials.push(seg.partial); writeJournal();
        await ffmpegStep({ jobId, rec, jobDir, args: seg.args, label: `segment ${seg.index + 1}/${total}`, expectedMs: segMs,
          onProgress: (p) => publish(jobId, { phase: "segments", segment: seg.index + 1, segments: total, outTimeMs: p.outTimeMs, expectedMs: Math.round(segMs),
            percent: Math.round(((seg.index + Math.min(1, (p.outTimeMs || 0) / Math.max(1, segMs))) / total) * 50) }) });
        const probe = await validateOutput({ jobId, rec, jobDir, rel: seg.partial, canvas: plan.canvas, fps: plan.fps, frames: seg.frames, expectedMs: segMs,
          frameMs: plan.frameMs, needAudio: false, label: `segment ${seg.index + 1}/${total}` });
        rmQuiet(target);
        fs.renameSync(path.join(jobDir, seg.partial), target);
        journal.partials = journal.partials.filter((p) => p !== seg.partial);
        storeCache(seg.key, target, probe, toolVersion);
        cacheMisses += 1;
        segResults.push({ key: seg.key, clipId: seg.clipId, cache: "miss", frames: seg.frames });
        step("segment_rendered", { clipId: seg.clipId, key: seg.key });
      }
      db.prepare("UPDATE media_render_jobs SET segments_json = ?, updated_at = ? WHERE id = ? AND claim_token = ?").run(json(segResults), now(), jobId, token);
      setProgress(jobId, token, { phase: "final", cacheHits, cacheMisses });

      // ---- loudness measurement (final profile, two-pass)
      if (plan.final.needsMeasurement) {
        for (const [rel, content] of Object.entries(plan.measure.files)) writeText(jobDir, rel, content);
        const r = await ffmpegStep({ jobId, rec, jobDir, args: plan.measure.args, label: "loudness-measure", expectedMs: plan.expectedDurationMs,
          onProgress: (p) => publish(jobId, { phase: "measure", outTimeMs: p.outTimeMs, expectedMs: Math.round(plan.expectedDurationMs),
            percent: 50 + Math.round(Math.min(1, (p.outTimeMs || 0) / Math.max(1, plan.expectedDurationMs)) * 10) }) });
        const measured = parseLoudnormJson(r.stderrLines);
        if (!measured) throw renderError("TOOL_FAILED", "Măsurarea loudness (prima trecere loudnorm) nu a produs rezultate.");
        plan = compileRenderPlan({ ...compileArgs, loudness: measured });
        journal.loudness = measured;
        step("loudness_measured", { inputI: Number.isFinite(measured.inputI) ? measured.inputI : String(measured.inputI), mode: plan.final.loudnessMode });
      }

      // ---- final pass
      checkCancel(jobId, rec);
      for (const [rel, src] of Object.entries(plan.final.fontCopies)) {
        const dest = path.join(jobDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      for (const [rel, content] of Object.entries(plan.final.files)) writeText(jobDir, rel, content);
      journal.partials.push(plan.final.output); writeJournal();
      await ffmpegStep({ jobId, rec, jobDir, args: plan.final.args, label: "final", expectedMs: plan.expectedDurationMs,
        onProgress: (p) => publish(jobId, { phase: "final", outTimeMs: p.outTimeMs, expectedMs: Math.round(plan.expectedDurationMs),
          percent: 60 + Math.round(Math.min(1, (p.outTimeMs || 0) / Math.max(1, plan.expectedDurationMs)) * 35) }) });
      step("final_rendered");

      // ---- validation, promotion, registration
      if (!transition(jobId, token, ["RUNNING"], "VALIDATING", { progress_json: json({ phase: "validate", cacheHits, cacheMisses }) })) checkCancel(jobId, rec);
      publish(jobId, { phase: "validate", percent: 95 }, { force: true });
      await validateOutput({ jobId, rec, jobDir, rel: plan.final.output, canvas: plan.canvas, fps: plan.fps, frames: plan.expectedFrames,
        expectedMs: plan.expectedDurationMs, frameMs: plan.frameMs, needAudio: plan.hasAudio, label: "final" });
      step("validated");
      checkCancel(jobId, rec);
      const renderAbs = paths.renderPath(jobId, "mp4");
      const promoteTmp = path.join(path.dirname(renderAbs), `${jobId}.${newId("t")}.promote`);
      fs.mkdirSync(path.dirname(renderAbs), { recursive: true });
      fs.copyFileSync(path.join(jobDir, plan.final.output), promoteTmp);
      fs.renameSync(promoteTmp, renderAbs);
      let registered;
      try {
        registered = await assets.registerDerivative({
          inputVersionIds: validation.dependencies.assetVersionIds, op: "render", category: "render", kind: "video", absPath: renderAbs, actor: job.created_by,
          title: `Randare ${job.profile === "final" ? "finală" : "draft"} — ${String(edit.project_title || "editare").slice(0, 150)} v${edit.version}`,
          contentProjectId: edit.content_project_id || null,
          params: { editVersionId: job.edit_version_id, profile: job.profile, irSha256: journal.irSha256, compileVersion, toolVersion, planHash: plan.planHash, jobId },
        });
      } catch (error) {
        rmQuiet(renderAbs);
        throw error;
      }
      const outputVersionId = registered.version.id;
      const finishedAt = now();
      const progress = { phase: "done", percent: 100, cacheHits, cacheMisses, loudness: plan.final.loudnessMode, durationMs: Math.round(plan.expectedDurationMs) };
      const ok = transition(jobId, token, ["VALIDATING", "CANCEL_REQUESTED"], "DONE",
        { output_asset_version_id: outputVersionId, finished_at: finishedAt, progress_json: json(progress), error: null },
        { type: "media.render.done", payload: { jobId, editVersionId: job.edit_version_id, profile: job.profile, outputAssetVersionId: outputVersionId,
          cacheHits, cacheMisses, loudness: plan.final.loudnessMode, frames: plan.expectedFrames, canvas: plan.canvas } });
      if (!ok) throw renderError("TOOL_FAILED", "Starea randării s-a schimbat neașteptat înainte de finalizare.");
      journal.status = "DONE"; journal.outputAssetVersionId = outputVersionId; step("done");
      publish(jobId, { phase: "done", percent: 100, outputAssetVersionId: outputVersionId }, { force: true });
      // The job folder keeps journal.json and the graphs; media copies are already cached or promoted.
      for (const sub of ["seg", "fonts"]) rmQuiet(path.join(jobDir, sub));
      rmQuiet(path.join(jobDir, plan.final.output));
    } catch (error) {
      const failure = rec.cancelRequested ? { code: "CANCELLED", message: FAILURE_TEXT.CANCELLED } : classifyRenderError(error);
      if (detached) return;
      journal.status = failure.code === "CANCELLED" ? "CANCELLED" : "FAILED";
      journal.error = failure;
      try { step("failed", { code: failure.code }); } catch { /* ignore */ }
      const to = failure.code === "CANCELLED" ? "CANCELLED" : "FAILED";
      transition(jobId, token, ACTIVE_RENDER_STATUSES, to, { error: json(failure), finished_at: now(), progress_json: json({ phase: "stopped", cacheHits, cacheMisses }) },
        { type: to === "CANCELLED" ? "media.render.cancelled" : "media.render.failed", source: to === "CANCELLED" ? rec.cancelledBy || "media-render" : "media-render",
          payload: { jobId, code: failure.code, phase: "running", partials: journal.partials.length } });
      publish(jobId, { phase: to === "CANCELLED" ? "cancelled" : "failed", code: failure.code }, { force: true });
    }
  }

  /**
   * Segment cache cleanup (regenerable files only): entries not used for `olderThanDays`. Dry run by default (lists what would
   * go). Never touches renders, originals or registered derivatives; skipped while a render runs in this process.
   */
  function pruneCache({ olderThanDays = 30, dryRun = true, actor = null } = {}) {
    const days = Number(olderThanDays);
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw new HubError("validation", "Vechimea minimă trebuie să fie între 0 și 3650 de zile.", { code: "FIELD_INVALID" });
    if (!dryRun) requireActor(actor);
    if (!dryRun && active.size) throw new HubError("conflict", "O randare rulează; curățarea cache-ului se face după ce se termină.", { code: "RENDER_ACTIVE" });
    const cutoff = new Date(clock().getTime() - days * 86400000).toISOString();
    const rows = db.prepare("SELECT * FROM media_render_cache WHERE last_used_at <= ? ORDER BY last_used_at").all(cutoff);
    const candidates = rows.filter((r) => /^cache\/seg\/[0-9a-f]{64}\.mp4$/.test(r.rel_path)).map((r) => ({ key: r.cache_key, relPath: r.rel_path, bytes: r.bytes, lastUsedAt: r.last_used_at }));
    const totalBytes = candidates.reduce((s, c) => s + (c.bytes || 0), 0);
    if (dryRun) return { dryRun: true, candidates, totalBytes };
    const removed = [];
    for (const c of candidates) {
      try { rmQuiet(paths.resolveRel(c.relPath)); } catch { continue; }
      delCache.run(c.key);
      removed.push(c);
    }
    if (removed.length) bus.emit({ type: "media.render.cache_pruned", scopeType: "media_render_cache", scopeId: "segments", source: actor, payload: { removed: removed.length, bytes: removed.reduce((s, c) => s + (c.bytes || 0), 0), olderThanDays: days } });
    return { dryRun: false, removed, totalBytes: removed.reduce((s, c) => s + (c.bytes || 0), 0) };
  }

  /** Waits for every job running in this process (tests and orderly shutdown). */
  const idle = () => Promise.all([...active.values()].map((r) => r.done?.catch(() => {})));

  function beginClose() {
    closing = true;
    for (const rec of active.values()) { rec.cancelRequested = true; rec.cancelledBy = "hub:close"; }
  }
  async function close() {
    beginClose();
    await Promise.all([...active.values()].map(async (rec) => {
      if (rec.procKey) await tools.cancel(rec.procKey);
      await rec.done;
    }));
  }
  return { beginClose, close, detach: () => { detached = true; }, request, retry, cancel, tick, recover, get, list, pruneCache, idle, activeJobs: () => [...active.keys()] };
}
