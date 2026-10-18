import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HubError } from "../core/errors.mjs";
import { newId, nowIso } from "../core/ids.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * M09 Distribution — the approved package of what goes where (manifest), manual publication packs and the honest record of
 * each attempt. Production states, distribution states and outcomes are separate.
 *
 * - A manifest binds, per variant: the FINAL render's media sha256, the caption sha256, the cover sha256, the account and the
 *   schedule (local time + IANA zone + resolved UTC instant). Its sha256 is what the owner approves.
 * - Any change (caption, cover, account, variant, schedule, re-render, rights, QA) invalidates the approval; an amendment
 *   creates a new DRAFT manifest. Open attempts of an invalidated manifest are cancelled; OUTCOME_UNKNOWN is kept.
 * - Packs are complete and hash-bound: video copied while hashing (mismatch → refused), caption.txt, cover, checklist.md,
 *   manifest.json listing every file hash. The idempotency key `manifestId:platform:pack` makes a repeat return the same pack.
 * - apiRelease always refuses in M09 with the precise missing conditions. reconcile only LOOKS UP an OUTCOME_UNKNOWN attempt
 *   (never posts a second time). tick never dispatches: a due item becomes MISSED_NEEDS_DECISION; a restart sends no backlog.
 * - Times: schedule given as local wall time in an IANA zone (default Europe/Bucharest) and resolved through Intl; a time
 *   that does not exist (spring-forward gap) is refused; an ambiguous one (fall-back) needs an explicit choice.
 */

export const DEFAULT_TIMEZONE = "Europe/Bucharest";
export const OPERATION_STATUSES = Object.freeze(["DOCUMENTED", "NEEDS_AUTH", "NEEDS_REVIEW", "VERIFIED_LIVE", "ASSISTED_ONLY", "COST_BLOCKED", "POLICY_UNSUPPORTED", "NOT_TESTED"]);

const op = (status, docRef, notes) => Object.freeze({ status, docRef, notes });
/**
 * Platform capabilities as documented, never as verified: nothing here is VERIFIED_LIVE in M09. Doc refs S10–S17 point to the
 * M09 source list; the notes are internal estimates („verifică regulile actuale”), not platform rules.
 */
export const PLATFORM_REGISTRY = Object.freeze({
  registryVersion: 1,
  verifiedAt: null,
  source: "estimare internă — verifică regulile actuale",
  platforms: Object.freeze({
    instagram: Object.freeze({ id: "instagram", label: "Instagram (Reels)", domains: Object.freeze(["instagram.com"]), captionMax: 2200, operations: Object.freeze({
      manual_pack: op("ASSISTED_ONLY", null, "Proprietarul încarcă manual din pachet; Hub-ul nu atinge contul."),
      api_upload: op("NEEDS_AUTH", "S10", "Content Publishing API: cont profesional (Business/Creator), aplicație Meta aprobată și token; neconectat."),
      api_schedule: op("NOT_TESTED", "S10", "Programarea prin API nu a fost testată."),
      insights: op("NEEDS_AUTH", "S11", "Insights cer cont profesional conectat; disponibilitatea metricilor e de verificat."),
    }), manualSteps: Object.freeze(["Deschide Instagram pe contul indicat și alege Reel nou.", "Bifează eticheta AI dacă declarația o cere."]) }),
    tiktok: Object.freeze({ id: "tiktok", label: "TikTok", domains: Object.freeze(["tiktok.com"]), captionMax: 2200, operations: Object.freeze({
      manual_pack: op("ASSISTED_ONLY", null, "Proprietarul încarcă manual din pachet."),
      api_upload: op("POLICY_UNSUPPORTED", "S12", "Direct Post cere auditul aplicației; până la audit postările prin API rămân private. Nu se folosește."),
      api_draft: op("NEEDS_REVIEW", "S12", "Încărcarea ca schiță (inbox) cere aplicație aprobată; netestat."),
      insights: op("NOT_TESTED", "S13", "Metricile prin API sunt de verificat."),
    }), manualSteps: Object.freeze(["Deschide TikTok pe contul indicat și încarcă video-ul.", "Activează „Conținut generat de AI” dacă declarația o cere."]) }),
    youtube: Object.freeze({ id: "youtube", label: "YouTube (Shorts / video)", domains: Object.freeze(["youtube.com", "youtu.be"]), captionMax: 5000, operations: Object.freeze({
      manual_pack: op("ASSISTED_ONLY", null, "Proprietarul încarcă manual din YouTube Studio."),
      api_upload: op("DOCUMENTED", "S14", "videos.insert e documentat; proiectele neverificate încarcă privat. Neconectat, netestat."),
      api_schedule: op("DOCUMENTED", "S14", "status.publishAt pentru videouri private; netestat."),
      insights: op("DOCUMENTED", "S15", "YouTube Analytics API documentat; neconectat."),
    }), manualSteps: Object.freeze(["Deschide YouTube Studio pe canalul indicat și încarcă video-ul.", "La „Conținut modificat” răspunde conform declarației AI."]) }),
    x: Object.freeze({ id: "x", label: "X", domains: Object.freeze(["x.com", "twitter.com"]), captionMax: 280, operations: Object.freeze({
      manual_pack: op("ASSISTED_ONLY", null, "Proprietarul postează manual."),
      api_upload: op("COST_BLOCKED", "S16", "API-ul X cere un plan plătit; fără buget aprobat."),
      insights: op("COST_BLOCKED", "S16", "Metricile prin API cer plan plătit."),
    }), manualSteps: Object.freeze(["Deschide X pe contul indicat și creează o postare cu video-ul."]) }),
    linkedin: Object.freeze({ id: "linkedin", label: "LinkedIn", domains: Object.freeze(["linkedin.com"]), captionMax: 3000, operations: Object.freeze({
      manual_pack: op("ASSISTED_ONLY", null, "Proprietarul postează manual."),
      api_upload: op("NEEDS_REVIEW", "S17", "Posts API cere produs aprobat de LinkedIn și token cu permisiuni; neconectat."),
      insights: op("NEEDS_REVIEW", "S17", "Statisticile cer aprobare suplimentară."),
    }), manualSteps: Object.freeze(["Deschide LinkedIn pe profilul/pagina indicată și creează o postare cu video-ul."]) }),
  }),
});
const PLATFORMS = PLATFORM_REGISTRY.platforms;
const OPEN_ATTEMPT_STATUSES = Object.freeze(["PREPARED", "PACK_READY", "SCHEDULED", "MISSED_NEEDS_DECISION"]);
const RECONCILABLE = Object.freeze(["OUTCOME_UNKNOWN", "UPLOADING", "PROCESSING"]);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (v) => String(v ?? "").replace(CONTROL, "").trim();
const clip = (v, max) => { const s = clean(v); return s.length > max ? s.slice(0, max) : s; };
const bad = (message, code = "VALIDATION", data) => new HubError("validation", message, { code, data });
const conflict = (message, code = "CONFLICT", data) => new HubError("conflict", message, { code, data });
const normalizeRo = (text) => String(text ?? "").replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț");

// ---------- time zones (Intl only; no tz database of our own) ----------
const formatters = new Map();
function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
}
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try { formatter(timeZone); return true; } catch { return false; }
}
function wallParts(ms, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour === 24 ? 0 : parts.hour, minute: parts.minute, second: parts.second };
}
/** Offset of `timeZone` from UTC at instant `ms`, in minutes (Bucharest: +120 winter, +180 summer). */
export function offsetMinutesAt(ms, timeZone) {
  const p = wallParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
const pad = (n, w = 2) => String(n).padStart(w, "0");
const fmtOffset = (min) => `${min >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;
const roDate = (y, m, d) => `${pad(d)}.${pad(m)}.${y}`;
/** UTC instant → local wall time in the zone. */
export function utcToZoned(instant, timeZone = DEFAULT_TIMEZONE) {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw bad("Moment invalid");
  const p = wallParts(ms, timeZone);
  const offsetMinutes = offsetMinutesAt(ms, timeZone);
  return { local: `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`, offsetMinutes, offset: fmtOffset(offsetMinutes), timeZone };
}
/**
 * Local wall time („YYYY-MM-DDTHH:mm”) in an IANA zone → UTC instant.
 * Nonexistent (DST gap) → refused (SCHEDULE_NONEXISTENT). Ambiguous (DST overlap) → refused (SCHEDULE_AMBIGUOUS) unless
 * `fold` is "earlier" (first occurrence, summer offset) or "later" (second occurrence, winter offset).
 */
export function zonedToUtc(local, timeZone = DEFAULT_TIMEZONE, { fold = null } = {}) {
  if (!isValidTimeZone(timeZone)) throw bad(`Fus orar necunoscut: ${timeZone}`, "TIMEZONE_INVALID");
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(local || ""));
  if (!m) throw bad("Ora programată trebuie să fie de forma AAAA-LL-ZZTHH:MM (ora locală)", "SCHEDULE_FORMAT");
  const [y, mo, d, h, mi, s = 0] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) throw bad(`Data ${local} nu există în calendar`, "SCHEDULE_FORMAT");
  const offsets = [...new Set([guess - 86400000, guess, guess + 86400000].map((t) => offsetMinutesAt(t, timeZone)))];
  const candidates = [...new Set(offsets.map((o) => guess - o * 60000))].filter((inst) => {
    const p = wallParts(inst, timeZone);
    return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && p.second === s;
  }).sort((a, b) => a - b);
  const hm = `${pad(h)}:${pad(mi)}`;
  if (!candidates.length) {
    throw bad(`Ora ${hm} din ${roDate(y, mo, d)} nu există în ${timeZone} (ceasul sare peste ea la trecerea la ora de vară); alege altă oră`, "SCHEDULE_NONEXISTENT");
  }
  if (candidates.length > 1 && fold !== "earlier" && fold !== "later") {
    const opts = candidates.map((c) => fmtOffset(offsetMinutesAt(c, timeZone)));
    throw bad(`Ora ${hm} din ${roDate(y, mo, d)} apare de două ori în ${timeZone} (trecerea la ora de iarnă): alege prima apariție (${opts[0]}) sau a doua (${opts[1]})`, "SCHEDULE_AMBIGUOUS",
      { candidates: candidates.map((c) => ({ utc: new Date(c).toISOString(), offset: fmtOffset(offsetMinutesAt(c, timeZone)) })) });
  }
  const chosen = candidates.length > 1 && fold === "later" ? candidates[1] : candidates[0];
  const offsetMinutes = offsetMinutesAt(chosen, timeZone);
  return { utc: new Date(chosen).toISOString(), offsetMinutes, offset: fmtOffset(offsetMinutes), ambiguous: candidates.length > 1, fold: candidates.length > 1 ? fold : null };
}

/** Test adapter for reconcile: answers status lookups from a script; any upload/post call is counted and refused. */
export function createFixtureAdapter(script = {}) {
  const calls = { status: 0, upload: 0, post: 0 };
  const queue = Array.isArray(script.status) ? [...script.status] : null;
  const refuse = (kind) => async () => { calls[kind] += 1; throw new HubError("policy", "Adaptorul de test nu publică nimic", { code: "FIXTURE_NO_POST" }); };
  return {
    id: script.id || "fixture", fixture: true, calls,
    async status(query) {
      calls.status += 1;
      if (script.authExpired) { const e = new Error("token expirat"); e.code = "TOKEN_EXPIRED"; throw e; }
      if (typeof script.status === "function") return script.status(query, calls.status);
      if (queue) return queue.length > 1 ? queue.shift() : queue[0];
      return { state: "unknown" };
    },
    upload: refuse("upload"), post: refuse("post"),
  };
}

export function createDistribution({ db, bus, clock = () => new Date(), paths = null, assets = null, rights = null, settings = null, qa = null, graceMinutes = 15, lookupTimeoutMs = 30000 }) {
  const now = () => nowIso(clock);
  const policy = () => ({ autoPublish: false, liveUpload: false, ...(settings?.get?.("mediaPolicy") || {}) });
  const building = new Set();
  const reconciling = new Set();

  const rowToManifest = (r) => r && ({ id: r.id, contentProjectId: r.content_project_id, status: r.status, body: parse(r.body_json, {}), manifestSha256: r.manifest_sha256,
    approval: parse(r.approval_json, {}), approvedBy: r.approved_by, approvedAt: r.approved_at, invalidatedReason: r.invalidated_reason,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const rowToAttempt = (r) => r && ({ id: r.id, manifestId: r.manifest_id, variantId: r.variant_id, platform: r.platform, route: r.route, idempotencyKey: r.idempotency_key,
    status: r.status, scheduledFor: r.scheduled_for, timezone: r.timezone, external: parse(r.external_json, {}), evidence: parse(r.evidence_json, []), error: r.error,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const emit = (type, scopeId, payload, source = "distribution") => bus.append({ type, scopeType: "content", scopeId, source, payload });
  const getManifestRow = (id) => rowToManifest(db.prepare("SELECT * FROM content_manifests WHERE id = ?").get(id));
  const needManifest = (id) => { const m = getManifestRow(id); if (!m) throw new HubError("not_found", "Manifestul nu există"); return m; };
  const getAttemptRow = (id) => rowToAttempt(db.prepare("SELECT * FROM content_release_attempts WHERE id = ?").get(id));
  const needAttempt = (id) => { const a = getAttemptRow(id); if (!a) throw new HubError("not_found", "Încercarea de publicare nu există"); return a; };
  const versionRow = (id) => db.prepare("SELECT * FROM media_asset_versions WHERE id = ?").get(id);
  const absOfVersion = (row) => (assets?.versionPath ? assets.versionPath(row.id) : paths?.resolveRel ? paths.resolveRel(row.rel_path) : null);

  // ---------- variant → final render ----------
  function resolveVariant(variantId) {
    const v = db.prepare("SELECT v.*, e.content_project_id FROM media_variants v JOIN media_edit_projects e ON e.id = v.edit_project_id WHERE v.id = ?").get(variantId);
    if (!v) return { variant: null };
    const editVersionId = v.variant_version_id || null;
    const job = editVersionId
      ? db.prepare("SELECT id, output_asset_version_id FROM media_render_jobs WHERE edit_version_id = ? AND status = 'DONE' AND profile = 'final' AND output_asset_version_id IS NOT NULL ORDER BY finished_at DESC, created_at DESC, rowid DESC LIMIT 1").get(editVersionId)
      : null;
    const out = job ? versionRow(job.output_asset_version_id) : null;
    return {
      variant: { id: v.id, status: v.status, platformKey: v.platform_key, contentProjectId: v.content_project_id, editVersionId },
      media: out ? { renderJobId: job.id, assetVersionId: out.id, sha256: out.sha256, bytes: out.bytes, status: out.status, ext: path.extname(out.rel_path).toLowerCase() || ".mp4" } : null,
    };
  }

  /**
   * QA bound to what is packed: the technical report must be the one of THIS final render file (a draft, an older render or
   * another asset never counts) and the IR-level reports (editorial/layout, factual, rights) must be for THIS edit version.
   * A missing kind is NOT_RUN. An injected QA summary is only a fallback when the library holds no report at all (tests).
   */
  function qaStatus(editVersionId, media) {
    const anyReport = db.prepare("SELECT 1 FROM media_qa_reports WHERE edit_version_id = ? OR (asset_version_id IS NOT NULL AND asset_version_id = ?) LIMIT 1").get(editVersionId, media?.assetVersionId || "");
    const viaDep = typeof qa === "function" ? qa : typeof qa?.qaSummary === "function" ? qa.qaSummary.bind(qa) : typeof qa?.summary === "function" ? qa.summary.bind(qa) : null;
    if (!anyReport && viaDep) {
      const s = viaDep(editVersionId) || {};
      return { status: s.status || "NOT_RUN", source: "qa", findings: s.findings || [] };
    }
    const kinds = {};
    const technical = media?.assetVersionId
      ? db.prepare("SELECT status FROM media_qa_reports WHERE kind = 'technical' AND asset_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(media.assetVersionId)
      : null;
    kinds.technical = technical?.status || "NOT_RUN";
    for (const kind of ["editorial", "factual", "rights"]) {
      const r = db.prepare("SELECT status FROM media_qa_reports WHERE kind = ? AND edit_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(kind, editVersionId);
      kinds[kind] = r?.status || "NOT_RUN";
    }
    const statuses = Object.values(kinds);
    const status = statuses.includes("FAIL") ? "FAIL" : statuses.includes("NOT_RUN") ? "NOT_RUN" : statuses.includes("WARN") ? "WARN" : "PASS";
    return { status, source: "media_qa_reports", kinds, assetVersionId: media?.assetVersionId || null };
  }

  function rightsFor(platform, versionIds, at) {
    if (!rights?.evaluateAssets) return { allowed: false, requiresDisclosure: false, reasons: ["Verificarea drepturilor nu e disponibilă (serviciul de drepturi lipsește)"] };
    const r = rights.evaluateAssets({ versionIds: versionIds.filter(Boolean), platform, use: "organic", at }) || {};
    return { allowed: r.allowed === true, requiresDisclosure: Boolean(r.requiresDisclosure), reasons: (r.reasons || []).map(String).slice(0, 20), status: r.status || null };
  }

  // ---------- manifest ----------
  function normalizeSchedule(v, nowMs) {
    if (v.scheduleAt === undefined || v.scheduleAt === null || v.scheduleAt === "") return null;
    const timezone = v.timezone || DEFAULT_TIMEZONE;
    if (!isValidTimeZone(timezone)) throw bad(`Fus orar necunoscut: ${timezone}`, "TIMEZONE_INVALID");
    let resolved;
    if (/(Z|[+-]\d{2}:\d{2})$/.test(String(v.scheduleAt))) {
      const ms = Date.parse(v.scheduleAt);
      if (!Number.isFinite(ms)) throw bad("Ora programată nu e un moment valid", "SCHEDULE_FORMAT");
      const z = utcToZoned(ms, timezone);
      resolved = { local: z.local, utc: new Date(ms).toISOString(), offset: z.offset, offsetMinutes: z.offsetMinutes, ambiguous: false, fold: null };
    } else {
      const r = zonedToUtc(v.scheduleAt, timezone, { fold: v.scheduleFold || null });
      resolved = { local: String(v.scheduleAt).slice(0, 16), ...r };
    }
    if (Date.parse(resolved.utc) <= nowMs) throw bad(`Ora programată (${resolved.local}, ${timezone}) a trecut deja`, "SCHEDULE_PAST");
    return { ...resolved, timezone };
  }

  function normalizeDisclosure(d) {
    const x = d && typeof d === "object" ? d : {};
    return { aiGenerated: x.aiGenerated === true, paidPartnership: x.paidPartnership === true, text: normalizeRo(clip(x.text, 300)) };
  }

  function buildVariant(input, contentProjectId, nowMs) {
    const variantId = clean(input?.variantId);
    if (!variantId) throw bad("Fiecare variantă are nevoie de variantId");
    const platform = clean(input.platform);
    const reg = PLATFORMS[platform];
    if (!reg) throw bad(`Platformă necunoscută: ${platform}`);
    const resolved = resolveVariant(variantId);
    if (!resolved.variant) throw new HubError("not_found", `Varianta ${variantId} nu există`);
    if (resolved.variant.contentProjectId !== contentProjectId) throw bad(`Varianta ${variantId} aparține altui proiect de conținut`);
    if (resolved.variant.status === "INVALIDATED") throw conflict(`Varianta ${variantId} e invalidată: derivă una nouă`);
    const account = clip(input.account, 120);
    if (!account) throw bad(`Varianta ${platform}: contul (numele afișat sau handle-ul) lipsește`);
    if (/^(sk|pk|ya29|EAA|Bearer)\b|[A-Za-z0-9_-]{40,}/.test(account)) throw bad("Câmpul cont acceptă doar numele/handle-ul contului, nu un token sau o cheie", "ACCOUNT_LOOKS_LIKE_SECRET");
    if (typeof input.caption !== "string") throw bad(`Varianta ${platform}: textul postării (caption) lipsește`);
    const caption = normalizeRo(input.caption.replace(CONTROL, "").replace(/\r\n/g, "\n")).trim();
    if (caption.length > 5000) throw bad(`Varianta ${platform}: textul postării depășește 5000 de caractere`);
    const warnings = [];
    if (caption.length > reg.captionMax) warnings.push(`Textul are ${caption.length} caractere; limita estimată pentru ${reg.label} e ${reg.captionMax} (verifică regula actuală).`);
    let cover = null;
    if (input.coverVersionId) {
      const c = versionRow(input.coverVersionId);
      if (!c) throw new HubError("not_found", `Coperta ${input.coverVersionId} nu există`);
      if (c.status !== "READY") throw conflict(`Coperta ${input.coverVersionId} are starea ${c.status}`);
      cover = { versionId: c.id, sha256: c.sha256, ext: path.extname(c.rel_path).toLowerCase() || ".jpg" };
    }
    return {
      variantId, platform, account, caption, captionSha256: sha256(caption), editVersionId: resolved.variant.editVersionId,
      media: resolved.media ? { renderJobId: resolved.media.renderJobId, assetVersionId: resolved.media.assetVersionId, sha256: resolved.media.sha256, bytes: resolved.media.bytes, ext: resolved.media.ext } : null,
      cover, schedule: normalizeSchedule(input, nowMs), disclosure: normalizeDisclosure(input.disclosure), warnings,
    };
  }

  function cancelOpenAttempts(manifestId, reason, actor) {
    const open = db.prepare(`SELECT id, platform FROM content_release_attempts WHERE manifest_id = ? AND status IN (${OPEN_ATTEMPT_STATUSES.map(() => "?").join(",")})`).all(manifestId, ...OPEN_ATTEMPT_STATUSES);
    for (const a of open) {
      db.prepare("UPDATE content_release_attempts SET status = 'CANCELLED', error = ?, updated_at = ? WHERE id = ?").run(clip(reason, 500), now(), a.id);
      emit("content.release.cancelled", a.id, { manifestId, platform: a.platform, reason: clip(reason, 200) }, actor);
    }
    return open.length;
  }

  function insertManifest(contentProjectId, variants, actor, previousId = null) {
    const body = { manifestVersion: 1, registryVersion: PLATFORM_REGISTRY.registryVersion, contentProjectId, variants: variants.map(({ warnings, ...v }) => v) };
    const sha = hashCanonical(body);
    const id = newId("cmf");
    const at = now();
    // One live manifest per project: an older DRAFT/APPROVED one is superseded (its open attempts are cancelled).
    for (const old of db.prepare("SELECT id, status FROM content_manifests WHERE content_project_id = ? AND status IN ('DRAFT','APPROVED')").all(contentProjectId)) {
      if (old.id === previousId) continue;
      db.prepare("UPDATE content_manifests SET status = 'SUPERSEDED', invalidated_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`înlocuit de ${id}`, at, old.id);
      cancelOpenAttempts(old.id, `Manifest înlocuit de ${id}`, actor);
      emit("content.manifest.superseded", old.id, { by: id, wasApproved: old.status === "APPROVED" }, actor);
    }
    db.prepare(`INSERT INTO content_manifests (id, content_project_id, status, body_json, manifest_sha256, created_by, created_at, updated_at) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?)`)
      .run(id, contentProjectId, json(body), sha, actor, at, at);
    emit("content.manifest.built", id, { contentProjectId, platforms: body.variants.map((v) => v.platform), manifestSha256: sha, previousId }, actor);
    return { ...getManifestRow(id), warnings: variants.flatMap((v) => v.warnings.map((w) => `${v.platform}: ${w}`)) };
  }

  function validateVariantSet(variants) {
    if (!Array.isArray(variants) || !variants.length) throw bad("Manifestul are nevoie de cel puțin o variantă");
    if (variants.length > 10) throw bad("Manifestul are maximum 10 variante");
    const platforms = new Set();
    for (const v of variants) {
      if (platforms.has(v.platform)) throw bad(`Platforma ${v.platform} apare de două ori; un manifest are o singură variantă pe platformă`);
      platforms.add(v.platform);
    }
  }

  function buildManifest({ contentProjectId, variants, actor = "owner" } = {}) {
    const project = db.prepare("SELECT id, stage FROM content_projects WHERE id = ?").get(contentProjectId);
    if (!project) throw new HubError("not_found", "Proiectul de conținut nu există");
    if (project.stage === "ARCHIVED") throw conflict("Proiectul e arhivat");
    const nowMs = clock().getTime();
    if (!Array.isArray(variants)) throw bad("Manifestul are nevoie de cel puțin o variantă");
    const built = variants.map((v) => buildVariant(v, contentProjectId, nowMs));
    validateVariantSet(built);
    return bus.transaction(() => insertManifest(contentProjectId, built, actor));
  }

  /** Any change to an approved manifest invalidates the approval and yields a new DRAFT (old DRAFT → SUPERSEDED). */
  function amendManifest({ manifestId, variantId = null, platform = null, changes = {}, actor = "owner" } = {}) {
    const m = needManifest(manifestId);
    if (!["DRAFT", "APPROVED"].includes(m.status)) throw conflict(`Manifestul are starea ${m.status}: construiește unul nou`);
    const idx = m.body.variants.findIndex((v) => (variantId ? v.variantId === variantId : v.platform === platform));
    if (idx < 0) throw new HubError("not_found", "Varianta nu există în manifest");
    const allowed = ["caption", "account", "coverVersionId", "scheduleAt", "timezone", "scheduleFold", "disclosure", "variantId"];
    const keys = Object.keys(changes || {}).filter((k) => changes[k] !== undefined);
    if (!keys.length) throw bad("Nicio modificare de aplicat");
    for (const k of keys) if (!allowed.includes(k)) throw bad(`Câmp nemodificabil în manifest: ${k}`);
    const nowMs = clock().getTime();
    const inputs = m.body.variants.map((v) => ({ variantId: v.variantId, platform: v.platform, account: v.account, caption: v.caption, coverVersionId: v.cover?.versionId || null,
      scheduleAt: v.schedule ? v.schedule.utc : null, timezone: v.schedule?.timezone || DEFAULT_TIMEZONE, disclosure: v.disclosure }));
    const cur = inputs[idx];
    if (keys.some((k) => ["scheduleAt", "timezone", "scheduleFold"].includes(k))) {
      cur.scheduleAt = changes.scheduleAt === undefined ? (m.body.variants[idx].schedule?.local ?? null) : changes.scheduleAt;
      cur.timezone = changes.timezone || cur.timezone;
      cur.scheduleFold = changes.scheduleFold || m.body.variants[idx].schedule?.fold || null;
    }
    for (const k of ["caption", "account", "coverVersionId", "disclosure", "variantId"]) if (changes[k] !== undefined) cur[k] = changes[k];
    const built = inputs.map((v) => buildVariant(v, m.contentProjectId, nowMs));
    validateVariantSet(built);
    const changedParts = keys.map((k) => ({ caption: "text", account: "cont", coverVersionId: "copertă", scheduleAt: "programare", timezone: "programare", scheduleFold: "programare", disclosure: "declarare", variantId: "variantă" }[k]));
    const reason = `Modificat după ${m.status === "APPROVED" ? "aprobare" : "construire"}: ${[...new Set(changedParts)].join(", ")}`;
    return bus.transaction(() => {
      const at = now();
      const nextStatus = m.status === "APPROVED" ? "INVALIDATED" : "SUPERSEDED";
      db.prepare("UPDATE content_manifests SET status = ?, invalidated_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = ?").run(nextStatus, reason, at, manifestId, m.status);
      const cancelled = cancelOpenAttempts(manifestId, `${reason}; pachetul vechi nu mai e valabil`, actor);
      emit(nextStatus === "INVALIDATED" ? "content.manifest.invalidated" : "content.manifest.superseded", manifestId, { reason, changed: [...new Set(changedParts)], cancelledAttempts: cancelled }, actor);
      const next = insertManifest(m.contentProjectId, built, actor, manifestId);
      return { manifest: next, previous: { id: manifestId, status: nextStatus, reason } };
    });
  }

  /** Re-checks every bound fact. An APPROVED manifest with any difference becomes INVALIDATED (open attempts cancelled). */
  function checkInvalidation(manifestId, { actor = "system" } = {}) {
    const m = needManifest(manifestId);
    const reasons = [];
    if (hashCanonical(m.body) !== m.manifestSha256) reasons.push({ code: "MANIFEST_TAMPERED", message: "Conținutul manifestului nu mai corespunde hash-ului aprobat" });
    if (m.status === "APPROVED" && m.approval.manifestSha256 !== m.manifestSha256) reasons.push({ code: "APPROVAL_MISMATCH", message: "Aprobarea nu corespunde acestui manifest" });
    for (const v of m.body.variants || []) {
      const r = resolveVariant(v.variantId);
      if (!r.variant) { reasons.push({ code: "VARIANT_MISSING", platform: v.platform, message: `Varianta ${v.platform} nu mai există` }); continue; }
      if (r.variant.status === "INVALIDATED") reasons.push({ code: "VARIANT_INVALIDATED", platform: v.platform, message: `Varianta ${v.platform} a fost invalidată` });
      if (r.variant.editVersionId !== v.editVersionId) reasons.push({ code: "VARIANT_CHANGED", platform: v.platform, message: `Varianta ${v.platform} are acum altă versiune de montaj` });
      if ((r.media?.sha256 || null) !== (v.media?.sha256 || null)) reasons.push({ code: "MEDIA_CHANGED", platform: v.platform, message: `Randarea finală pentru ${v.platform} s-a schimbat` });
      if (v.media) {
        const row = versionRow(v.media.assetVersionId);
        if (!row || row.status !== "READY" || row.sha256 !== v.media.sha256) reasons.push({ code: "MEDIA_UNAVAILABLE", platform: v.platform, message: `Fișierul randat pentru ${v.platform} nu mai e disponibil sau s-a schimbat` });
      }
      if (v.cover) {
        const c = versionRow(v.cover.versionId);
        if (!c || c.status !== "READY" || c.sha256 !== v.cover.sha256) reasons.push({ code: "COVER_CHANGED", platform: v.platform, message: `Coperta pentru ${v.platform} s-a schimbat sau lipsește` });
      }
      if (m.status === "APPROVED") {
        const rr = rightsFor(v.platform, [v.media?.assetVersionId, v.cover?.versionId], v.schedule?.utc || now());
        if (!rr.allowed) reasons.push({ code: "RIGHTS_CHANGED", platform: v.platform, message: `Drepturile nu mai permit ${v.platform}: ${rr.reasons.join("; ") || "verificare negativă"}` });
        const q = qaStatus(v.editVersionId, v.media);
        if (q.status === "FAIL") reasons.push({ code: "QA_FAILED", platform: v.platform, message: `QA a eșuat pentru ${v.platform}` });
      }
    }
    if (m.status === "APPROVED" && reasons.length) {
      const reasonText = reasons.map((r) => r.message).join("; ").slice(0, 900);
      bus.transaction(() => {
        const res = db.prepare("UPDATE content_manifests SET status = 'INVALIDATED', invalidated_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(reasonText, now(), manifestId);
        if (res.changes) {
          const cancelled = cancelOpenAttempts(manifestId, `Aprobare invalidată: ${reasonText}`, actor);
          emit("content.manifest.invalidated", manifestId, { reasons: reasons.map((r) => r.code), cancelledAttempts: cancelled }, actor);
        }
      });
    }
    const status = getManifestRow(manifestId).status;
    return { manifestId, status, valid: status === "APPROVED" && reasons.length === 0, reasons };
  }

  /**
   * Owner approval of the exact manifest sha. Requires: every variant rendered (final), QA ran without FAIL, rights allowed
   * per platform (and AI disclosure when the rights say so), schedule still in the future. The channel/session rules
   * (OWNER, fresh re-auth) are enforced by the command layer; `approval` records what it saw.
   */
  function approve({ manifestId, actor = "owner", approval = {} } = {}) {
    const m = needManifest(manifestId);
    if (m.status === "APPROVED" && m.approval.manifestSha256 === m.manifestSha256) return { manifest: m, alreadyApproved: true };
    if (m.status !== "DRAFT") throw conflict(`Manifestul are starea ${m.status}; doar un DRAFT se aprobă`);
    if (!approval || approval.manifestSha256 !== m.manifestSha256) throw conflict("Aprobarea trebuie să confirme exact manifestul afișat (hash diferit sau lipsă)", "APPROVAL_SHA_MISMATCH");
    const pre = checkInvalidation(manifestId);
    const blocking = pre.reasons.filter((r) => r.code !== "APPROVAL_MISMATCH");
    if (blocking.length) throw conflict(`Manifestul nu mai corespunde datelor: ${blocking.map((r) => r.message).join("; ")}`, "MANIFEST_STALE", { reasons: blocking });
    const problems = [];
    const checks = [];
    const nowMs = clock().getTime();
    for (const v of m.body.variants) {
      if (!v.media) { problems.push(`${v.platform}: varianta nu are o randare finală reușită`); continue; }
      const q = qaStatus(v.editVersionId, v.media);
      if (q.status === "FAIL") problems.push(`${v.platform}: QA are rezultat FAIL`);
      else if (q.status === "NOT_RUN") problems.push(`${v.platform}: QA nu a rulat pe această versiune`);
      const rr = rightsFor(v.platform, [v.media.assetVersionId, v.cover?.versionId], v.schedule?.utc || new Date(nowMs).toISOString());
      if (!rr.allowed) problems.push(`${v.platform}: drepturile nu permit publicarea (${rr.reasons.join("; ") || "verificare negativă"})`);
      if (rr.requiresDisclosure && !v.disclosure.aiGenerated) problems.push(`${v.platform}: materialul cere declarare AI, dar varianta nu o are`);
      if (v.schedule && Date.parse(v.schedule.utc) <= nowMs) problems.push(`${v.platform}: ora programată (${v.schedule.local}) a trecut; modifică programarea`);
      checks.push({ platform: v.platform, qa: q.status, rights: { allowed: rr.allowed, requiresDisclosure: rr.requiresDisclosure, reasons: rr.reasons } });
    }
    if (problems.length) throw conflict(`Manifestul nu poate fi aprobat: ${problems.join("; ")}`, "MANIFEST_NOT_APPROVABLE", { problems });
    const record = {
      manifestSha256: m.manifestSha256, channel: clip(approval.channel, 40) || null, sessionId: clip(approval.sessionId, 80) || null, via: clip(approval.via, 40) || null,
      note: clip(approval.note, 300), approvedAt: now(), checks,
    };
    return bus.transaction(() => {
      const res = db.prepare("UPDATE content_manifests SET status = 'APPROVED', approval_json = ?, approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'DRAFT' AND manifest_sha256 = ?")
        .run(json(record), actor, record.approvedAt, record.approvedAt, manifestId, m.manifestSha256);
      if (!res.changes) throw conflict("Manifestul a fost modificat între timp; reîncarcă", "STALE_VERSION");
      emit("content.manifest.approved", manifestId, { manifestSha256: m.manifestSha256, platforms: m.body.variants.map((v) => v.platform), channel: record.channel }, actor);
      return { manifest: getManifestRow(manifestId), alreadyApproved: false };
    });
  }

  // ---------- manual packs ----------
  async function copyVerified(src, dest, expectedSha) {
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink() || !st.isFile()) throw new HubError("policy", "Sursa pachetului nu e un fișier obișnuit (legături refuzate)", { code: "PACK_SOURCE_INVALID" });
    if (paths?.assertRegularFile) paths.assertRegularFile(src);
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    await pipeline(fs.createReadStream(src), new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); bytes += chunk.length; cb(null, chunk); } }), fs.createWriteStream(dest, { flags: "wx" }));
    const got = hash.digest("hex");
    if (got !== expectedSha) throw conflict("Fișierul de pe disc nu corespunde hash-ului aprobat; pachetul a fost refuzat", "PACK_HASH_MISMATCH");
    return { sha256: got, bytes };
  }
  const hashFile = async (file) => {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  };

  function checklistText({ manifest, variant, reg, files, rightsCheck }) {
    const d = variant.disclosure;
    const lines = [
      `# Pachet de publicare manuală — ${reg.label}`, "",
      `- Manifest: ${manifest.id} (sha256 ${manifest.manifestSha256})`,
      `- Cont: ${variant.account}`,
      `- Programare: ${variant.schedule ? `${variant.schedule.local.replace("T", " ")} (${variant.schedule.timezone}, ${variant.schedule.offset}; UTC ${variant.schedule.utc})` : "fără oră programată"}`,
      "", "## Fișiere (nu le modifica: orice modificare anulează aprobarea)",
      ...files.filter((f) => f.name !== "manifest.json" && f.name !== "checklist.md").map((f) => `- ${f.name} — sha256 ${f.sha256}`),
      "", "## Declarări",
      `- Conținut generat sau modificat cu AI: ${d.aiGenerated ? "DA — activează eticheta AI a platformei" : "NU"}`,
      `- Parteneriat plătit / promovare: ${d.paidPartnership ? "DA — activează eticheta de parteneriat" : "NU"}`,
      ...(d.text ? [`- Text de declarare: ${d.text}`] : []),
      "", "## Drepturi (verificate la aprobare)",
      `- ${rightsCheck ? (rightsCheck.rights.allowed ? "Permis pentru această platformă" : "NEPERMIS") : "nedisponibil"}${rightsCheck?.rights.reasons?.length ? `: ${rightsCheck.rights.reasons.join("; ")}` : ""}`,
      `- QA: ${rightsCheck?.qa || "necunoscut"}`,
      "", "## Pași",
      ...reg.manualSteps.map((s, i) => `${i + 1}. ${s}`),
      `${reg.manualSteps.length + 1}. Încarcă ${files.find((f) => f.name.startsWith("video"))?.name} exact cum e (fără re-export sau recomprimare).`,
      `${reg.manualSteps.length + 2}. Copiază textul din caption.txt fără modificări.`,
      ...(files.some((f) => f.name.startsWith("cover")) ? [`${reg.manualSteps.length + 3}. Setează coperta din ${files.find((f) => f.name.startsWith("cover")).name}.`] : []),
      "- Bifează declarările de mai sus înainte de publicare.",
      "- După publicare, copiază URL-ul postării și înregistrează-l în Hub („Înregistrează publicarea manuală”).",
      "", "Hub-ul nu publică nimic automat. Regulile platformei se pot schimba: verifică-le în aplicație.", "",
    ];
    return lines.join("\n");
  }

  async function verifyPack(attempt) {
    const files = attempt.external?.files || [];
    const dir = attempt.external?.packRelPath && paths?.resolveRel ? paths.resolveRel(attempt.external.packRelPath) : attempt.external?.packDir;
    const missing = []; const mismatched = [];
    if (!dir || !files.length) return { complete: false, missing: ["manifest.json"], mismatched };
    for (const f of files) {
      const p = path.join(dir, f.name);
      if (!fs.existsSync(p)) { missing.push(f.name); continue; }
      if (await hashFile(p) !== f.sha256) mismatched.push(f.name);
    }
    if (!fs.existsSync(path.join(dir, "manifest.json"))) missing.push("manifest.json");
    return { complete: !missing.length && !mismatched.length, missing, mismatched, dir };
  }

  /** Builds (or returns) the manual pack for one platform of an APPROVED, still-valid manifest. */
  async function preparePack({ manifestId, platform, actor = "owner" } = {}) {
    if (!paths?.packDir) throw new HubError("internal", "Modulul de căi media lipsește: pachetul nu poate fi scris");
    // Key `manifestId:platform:pack`; after a CANCELLED/FAILED pack of a still-valid manifest the next one is `…:pack#n`.
    const baseKey = `${manifestId}:${platform}:pack`;
    const prior = db.prepare("SELECT * FROM content_release_attempts WHERE idempotency_key = ? OR idempotency_key LIKE ? ORDER BY created_at DESC, rowid DESC").all(baseKey, `${baseKey}#%`).map(rowToAttempt);
    const latest = prior[0] || null;
    const retired = Boolean(latest && ["CANCELLED", "FAILED"].includes(latest.status));
    const existing = retired ? null : latest;
    const key = !latest ? baseKey : retired ? `${baseKey}#${prior.length + 1}` : latest.idempotencyKey;
    if (existing && existing.status !== "PREPARED") {
      if (existing.status === "PACK_READY") {
        const integrity = await verifyPack(existing);
        if (!integrity.complete) throw conflict(`Pachetul existent e incomplet sau modificat (${[...integrity.missing, ...integrity.mismatched].join(", ")}); anulează-l și pregătește altul`, "PACK_DAMAGED", integrity);
        return { attempt: existing, existing: true, integrity };
      }
      return { attempt: existing, existing: true };
    }
    if (existing && building.has(existing.id)) throw conflict("Pachetul pentru această platformă se pregătește deja", "PACK_IN_PROGRESS");
    const check = checkInvalidation(manifestId, { actor });
    if (!check.valid) throw conflict(`Manifestul nu e aprobat sau nu mai e valabil (${check.status}${check.reasons.length ? `: ${check.reasons.map((r) => r.message).join("; ")}` : ""})`, "MANIFEST_NOT_VALID", { reasons: check.reasons });
    const m = needManifest(manifestId);
    const variant = m.body.variants.find((v) => v.platform === platform);
    if (!variant) throw new HubError("not_found", `Manifestul nu are o variantă pentru ${platform}`);
    const reg = PLATFORMS[platform];
    // Reserve the idempotency key first (a duplicate request finds the row), then build outside the transaction.
    const attemptId = existing?.id || bus.transaction(() => {
      const raced = db.prepare("SELECT id FROM content_release_attempts WHERE idempotency_key = ?").get(key);
      if (raced) return raced.id;
      const id = newId("cra");
      const at = now();
      db.prepare(`INSERT INTO content_release_attempts (id, manifest_id, variant_id, platform, route, idempotency_key, status, scheduled_for, timezone, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'manual_pack', ?, 'PREPARED', ?, ?, ?, ?, ?)`).run(id, manifestId, variant.variantId, platform, key, variant.schedule?.utc || null, variant.schedule?.timezone || null, actor, at, at);
      emit("content.release.prepared", id, { manifestId, platform, route: "manual_pack" }, actor);
      return id;
    });
    if (building.has(attemptId)) throw conflict("Pachetul pentru această platformă se pregătește deja", "PACK_IN_PROGRESS");
    building.add(attemptId);
    const finalDir = paths.packDir(attemptId);
    const partial = `${finalDir}.partial`;
    try {
      fs.rmSync(partial, { recursive: true, force: true });
      fs.mkdirSync(partial, { recursive: true });
      const files = [];
      const mediaRow = versionRow(variant.media.assetVersionId);
      const mediaAbs = mediaRow && absOfVersion(mediaRow);
      if (!mediaAbs || !fs.existsSync(mediaAbs)) throw conflict("Fișierul randat lipsește de pe disc", "PACK_MEDIA_MISSING");
      const videoName = `video${variant.media.ext || ".mp4"}`;
      files.push({ name: videoName, ...(await copyVerified(mediaAbs, path.join(partial, videoName), variant.media.sha256)) });
      const captionBytes = Buffer.from(variant.caption, "utf8");
      fs.writeFileSync(path.join(partial, "caption.txt"), captionBytes, { flag: "wx" });
      files.push({ name: "caption.txt", sha256: sha256(captionBytes), bytes: captionBytes.length });
      if (sha256(variant.caption) !== variant.captionSha256) throw conflict("Textul postării nu corespunde hash-ului aprobat", "PACK_HASH_MISMATCH");
      if (variant.cover) {
        const coverRow = versionRow(variant.cover.versionId);
        const coverAbs = coverRow && absOfVersion(coverRow);
        if (!coverAbs || !fs.existsSync(coverAbs)) throw conflict("Coperta lipsește de pe disc", "PACK_COVER_MISSING");
        const coverName = `cover${variant.cover.ext || ".jpg"}`;
        files.push({ name: coverName, ...(await copyVerified(coverAbs, path.join(partial, coverName), variant.cover.sha256)) });
      }
      const rightsCheck = (m.approval.checks || []).find((c) => c.platform === platform) || null;
      const checklist = Buffer.from(checklistText({ manifest: m, variant, reg, files, rightsCheck }), "utf8");
      fs.writeFileSync(path.join(partial, "checklist.md"), checklist, { flag: "wx" });
      files.push({ name: "checklist.md", sha256: sha256(checklist), bytes: checklist.length });
      const manifestJson = Buffer.from(JSON.stringify({ attemptId, manifestId, manifestSha256: m.manifestSha256, platform, account: variant.account, schedule: variant.schedule,
        disclosure: variant.disclosure, media: variant.media, cover: variant.cover, captionSha256: variant.captionSha256, files, createdAt: now() }, null, 2), "utf8");
      fs.writeFileSync(path.join(partial, "manifest.json"), manifestJson, { flag: "wx" });
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(partial, finalDir);
      const packRelPath = paths.relOf ? paths.relOf(finalDir) : null;
      const external = { packRelPath, packDir: packRelPath ? undefined : finalDir, files, manifestSha256: m.manifestSha256 };
      const result = bus.transaction(() => {
        const live = db.prepare("SELECT status FROM content_manifests WHERE id = ?").get(manifestId)?.status;
        if (live !== "APPROVED") throw conflict("Manifestul a fost invalidat în timpul pregătirii pachetului", "MANIFEST_NOT_VALID");
        db.prepare("UPDATE content_release_attempts SET status = 'PACK_READY', external_json = ?, error = NULL, updated_at = ? WHERE id = ? AND status = 'PREPARED'").run(json(external), now(), attemptId);
        emit("content.release.pack_ready", attemptId, { manifestId, platform, files: files.map((f) => ({ name: f.name, sha256: f.sha256 })) }, actor);
        return getAttemptRow(attemptId);
      });
      return { attempt: result, existing: false, integrity: { complete: true, missing: [], mismatched: [] } };
    } catch (error) {
      fs.rmSync(partial, { recursive: true, force: true });
      if (error?.code === "PACK_HASH_MISMATCH") {
        bus.transaction(() => {
          db.prepare("UPDATE content_release_attempts SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ? AND status = 'PREPARED'").run(clip(error.message, 500), now(), attemptId);
          db.prepare("UPDATE content_manifests SET status = 'INVALIDATED', invalidated_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run("Fișier modificat pe disc după aprobare", now(), manifestId);
          emit("content.manifest.invalidated", manifestId, { reasons: ["PACK_HASH_MISMATCH"] }, actor);
        });
      } else {
        bus.emit({ type: "content.release.pack_failed", scopeType: "content", scopeId: attemptId, source: actor, payload: { manifestId, platform, error: clip(error?.message, 300) } });
      }
      throw error;
    } finally {
      building.delete(attemptId);
    }
  }

  function validPostUrl(url, platform) {
    let u;
    try { u = new URL(String(url || "")); } catch { throw bad("URL-ul postării nu e valid", "URL_INVALID"); }
    if (u.protocol !== "https:") throw bad("URL-ul postării trebuie să fie https", "URL_INVALID");
    const host = u.hostname.toLowerCase();
    if (!PLATFORMS[platform].domains.some((d) => host === d || host.endsWith(`.${d}`))) throw bad(`URL-ul nu aparține platformei ${PLATFORMS[platform].label}`, "URL_PLATFORM_MISMATCH");
    if (u.username || u.password) throw bad("URL-ul postării nu poate conține date de autentificare", "URL_INVALID");
    return `${u.origin}${u.pathname}${u.search}`.slice(0, 500);
  }

  /** The owner posted from the pack: records the URL as manual evidence. Idempotent for the same URL. */
  function recordManual({ attemptId, url, postedAt = null, actor = "owner", note = "" } = {}) {
    let a = needAttempt(attemptId);
    if (a.route !== "manual_pack") throw conflict("Înregistrarea manuală e doar pentru pachete manuale");
    const cleanUrl = validPostUrl(url, a.platform);
    if (a.status === "PUBLISHED") {
      if (a.external.url === cleanUrl) return { attempt: a, duplicate: true };
      throw conflict("Încercarea are deja o publicare înregistrată cu alt URL", "ALREADY_RECORDED");
    }
    // M09 review: the approved manifest is re-checked first (a revoked right, a changed file): its open packs are withdrawn.
    const manifestNow = getManifestRow(a.manifestId);
    if (manifestNow?.status === "APPROVED") { try { checkInvalidation(a.manifestId, { actor }); } catch { /* reported by checkInvalidation */ } a = needAttempt(attemptId); }
    const at = clock().getTime();
    const posted = postedAt ? Date.parse(postedAt) : at;
    if (!Number.isFinite(posted)) throw bad("Momentul publicării nu e valid");
    if (posted > at + 5 * 60000) throw bad("Momentul publicării e în viitor");
    if (posted < Date.parse(a.createdAt) - 60000) throw bad("Momentul publicării e înainte de pregătirea pachetului");
    // A withdrawn pack (manifest superseded or invalidated) cannot be used for a NEW post, but a post the owner made BEFORE the
    // withdrawal is recorded truthfully (history is never rewritten); the evidence says so.
    // The moment must be stated: a default „now” is never before a withdrawal (it may even be the withdrawal this call made).
    const withdrawnAt = a.status === "CANCELLED" ? Date.parse(a.updatedAt) : null;
    const recordableWithdrawn = a.status === "CANCELLED" && Boolean(postedAt) && Number.isFinite(withdrawnAt) && posted <= withdrawnAt;
    if (!["PACK_READY", "MISSED_NEEDS_DECISION"].includes(a.status) && !recordableWithdrawn) {
      throw conflict(a.status === "CANCELLED" ? "Pachetul a fost retras; se poate înregistra doar o postare făcută înainte de retragere (spune momentul postării)." : `Încercarea are starea ${a.status}: nu se poate înregistra o publicare`, "ATTEMPT_STATE");
    }
    const dup = db.prepare("SELECT id FROM content_release_attempts WHERE status = 'PUBLISHED' AND json_extract(external_json, '$.url') = ? AND id <> ?").get(cleanUrl, attemptId);
    if (dup) throw conflict(`URL-ul e deja înregistrat pentru încercarea ${dup.id}`, "URL_ALREADY_RECORDED");
    return bus.transaction(() => {
      const evidence = [...a.evidence, { kind: "manual", url: cleanUrl, postedAt: new Date(posted).toISOString(), recordedBy: actor, recordedAt: now(), note: clip(note, 300), late: a.status === "MISSED_NEEDS_DECISION",
        ...(recordableWithdrawn ? { recordedAfterWithdrawal: true, withdrawnAt: new Date(withdrawnAt).toISOString(), withdrawalReason: clip(a.error || "", 200) } : {}) }];
      const res = db.prepare("UPDATE content_release_attempts SET status = 'PUBLISHED', external_json = ?, evidence_json = ?, error = NULL, updated_at = ? WHERE id = ? AND status = ?")
        .run(json({ ...a.external, url: cleanUrl, postedAt: new Date(posted).toISOString() }), json(evidence), now(), attemptId, a.status);
      if (!res.changes) throw conflict("Încercarea a fost modificată între timp", "STALE_VERSION");
      emit("content.release.recorded_manual", attemptId, { manifestId: a.manifestId, platform: a.platform, late: a.status === "MISSED_NEEDS_DECISION" }, actor);
      return { attempt: getAttemptRow(attemptId), duplicate: false };
    });
  }

  /** M09: never uploads. Lists every missing condition precisely and records the refusal. */
  function apiRelease({ manifestId = null, platform = null, actor = "system" } = {}) {
    const missing = [{ code: "API_RELEASE_NOT_IMPLEMENTED", message: "Publicarea prin API nu există în M09 (doar pachete manuale)" }];
    const pol = policy();
    if (pol.liveUpload !== true) missing.push({ code: "LIVE_UPLOAD_OFF", message: "mediaPolicy.liveUpload este dezactivat" });
    if (pol.autoPublish !== true) missing.push({ code: "AUTO_PUBLISH_OFF", message: "mediaPolicy.autoPublish este dezactivat" });
    const reg = platform ? PLATFORMS[platform] : null;
    if (!reg) missing.push({ code: "PLATFORM_UNKNOWN", message: platform ? `Platformă necunoscută: ${platform}` : "Platforma nu a fost indicată" });
    else {
      const up = reg.operations.api_upload;
      if (up.status !== "VERIFIED_LIVE") missing.push({ code: "PLATFORM_NOT_VERIFIED", message: `Încărcarea API pentru ${reg.label} are starea ${up.status}${up.docRef ? ` (${up.docRef})` : ""}, nu VERIFIED_LIVE` });
    }
    missing.push({ code: "ACCOUNT_NOT_CONNECTED", message: `Niciun cont ${reg ? reg.label : ""} conectat (decizia MEDIA_C nu a fost aplicată)`.replace("  ", " ") });
    missing.push({ code: "UPLOAD_CONFIRMATION_MISSING", message: "Lipsește confirmarea proprietarului pentru această încărcare" });
    if (!manifestId) missing.push({ code: "MANIFEST_MISSING", message: "Niciun manifest indicat" });
    else {
      const m = getManifestRow(manifestId);
      if (!m) missing.push({ code: "MANIFEST_MISSING", message: "Manifestul nu există" });
      else if (m.status !== "APPROVED") missing.push({ code: "MANIFEST_NOT_APPROVED", message: `Manifestul are starea ${m.status}` });
    }
    try {
      bus.emit({ type: "content.release.api_refused", scopeType: "content", scopeId: manifestId || "api", source: actor, payload: { platform, missing: missing.map((x) => x.code) } });
    } catch { /* the refusal stands even if the event cannot be written */ }
    throw new HubError("policy", `Publicarea prin API e refuzată: ${missing.map((x) => x.message).join("; ")}`, { code: "API_RELEASE_REFUSED", data: { missing } });
  }

  const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "LOOKUP_TIMEOUT" })), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
  const isAuthError = (e) => ["TOKEN_EXPIRED", "AUTH", "UNAUTHORIZED", "NEEDS_AUTH"].includes(e?.code) || e?.status === 401 || e?.category === "authentication";

  /** OUTCOME_UNKNOWN → status LOOKUP only (never a second post). Unknown/auth problems keep OUTCOME_UNKNOWN. */
  async function reconcile({ attemptId, adapter, actor = "system" } = {}) {
    const a = needAttempt(attemptId);
    if (["PUBLISHED", "FAILED", "CANCELLED"].includes(a.status)) return { attempt: a, outcome: a.status, changed: false, lookedUp: false };
    if (!RECONCILABLE.includes(a.status)) throw conflict(`Reconcilierea e doar pentru încercări cu rezultat necunoscut (acum ${a.status})`, "ATTEMPT_STATE");
    if (!adapter || typeof adapter.status !== "function") throw bad("Reconcilierea are nevoie de un adaptor cu interogare de stare");
    if (reconciling.has(attemptId)) throw conflict("Reconcilierea acestei încercări rulează deja", "RECONCILE_IN_PROGRESS");
    reconciling.add(attemptId);
    try {
      let answer;
      try {
        answer = await withTimeout(adapter.status({ platform: a.platform, idempotencyKey: a.idempotencyKey, external: a.external }), lookupTimeoutMs);
      } catch (error) {
        const auth = isAuthError(error);
        const outcome = auth ? "NEEDS_AUTH" : "LOOKUP_FAILED";
        const message = auth ? "NEEDS_AUTH: autorizarea platformei a expirat; reconectarea cere decizia proprietarului. Rezultatul rămâne necunoscut." : `Interogarea stării a eșuat (${clip(error?.message, 160)}); rezultatul rămâne necunoscut.`;
        bus.transaction(() => {
          db.prepare("UPDATE content_release_attempts SET error = ?, updated_at = ? WHERE id = ?").run(message, now(), attemptId);
          emit(auth ? "content.release.needs_auth" : "content.release.lookup_failed", attemptId, { platform: a.platform, adapter: adapter.id || "unknown" }, actor);
        });
        return { attempt: getAttemptRow(attemptId), outcome, changed: false, lookedUp: true };
      }
      const state = String(answer?.state || "unknown");
      const checkedAt = now();
      const base = { kind: "reconcile", adapter: adapter.id || "unknown", fixture: Boolean(adapter.fixture), state, checkedAt };
      let next = null; let error = null; let external = a.external; let outcome = state.toUpperCase();
      if (state === "published") {
        const url = answer.url ? clip(answer.url, 500) : null;
        if (!url && !answer.externalId) { outcome = "UNKNOWN"; error = "Platforma raportează publicat, dar fără URL sau id; rezultatul rămâne necunoscut."; }
        else { next = "PUBLISHED"; external = { ...a.external, url, externalId: answer.externalId ? clip(answer.externalId, 120) : null }; outcome = "PUBLISHED"; }
      } else if (state === "failed") { next = "FAILED"; error = `Platforma raportează eșec: ${clip(answer.error || "fără detalii", 200)}`; outcome = "FAILED"; }
      else if (state === "not_found") { next = "FAILED"; error = "Postarea nu există pe platformă. Nu se repostează automat: o nouă încercare cere o decizie nouă."; outcome = "FAILED"; }
      else if (state === "processing") { next = "PROCESSING"; outcome = "PROCESSING"; }
      else if (state === "needs_auth") { error = "NEEDS_AUTH: autorizarea platformei a expirat; rezultatul rămâne necunoscut."; outcome = "NEEDS_AUTH"; }
      else { outcome = "UNKNOWN"; error = "Platforma nu confirmă rezultatul; încercarea rămâne OUTCOME_UNKNOWN."; }
      return bus.transaction(() => {
        const evidence = [...a.evidence, { ...base, ...(answer?.url ? { url: clip(answer.url, 500) } : {}), ...(answer?.externalId ? { externalId: clip(answer.externalId, 120) } : {}) }];
        if (next) {
          db.prepare("UPDATE content_release_attempts SET status = ?, external_json = ?, evidence_json = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?").run(next, json(external), json(evidence), error, checkedAt, attemptId, a.status);
        } else {
          db.prepare("UPDATE content_release_attempts SET evidence_json = ?, error = ?, updated_at = ? WHERE id = ?").run(json(evidence), error, checkedAt, attemptId);
        }
        emit(outcome === "NEEDS_AUTH" ? "content.release.needs_auth" : "content.release.reconciled", attemptId, { platform: a.platform, from: a.status, to: next || a.status, outcome }, actor);
        return { attempt: getAttemptRow(attemptId), outcome, changed: Boolean(next && next !== a.status), lookedUp: true };
      });
    } finally {
      reconciling.delete(attemptId);
    }
  }

  /**
   * Scheduler tick (also run at boot). Never dispatches anything: a due attempt past the grace window becomes
   * MISSED_NEEDS_DECISION. With autoPublish ON it is still not dispatched (no API route exists in M09).
   */
  function tick(nowArg = null) {
    const at = nowArg ? new Date(nowArg) : clock();
    if (!Number.isFinite(at.getTime())) throw bad("Moment invalid pentru tick");
    const cutoff = new Date(at.getTime() - graceMinutes * 60000).toISOString();
    const pol = policy();
    const due = db.prepare("SELECT * FROM content_release_attempts WHERE status IN ('PREPARED','PACK_READY','SCHEDULED') AND scheduled_for IS NOT NULL AND scheduled_for <= ? ORDER BY scheduled_for").all(cutoff).map(rowToAttempt);
    const missed = [];
    if (due.length) {
      bus.transaction(() => {
        for (const a of due) {
          const local = a.timezone ? utcToZoned(a.scheduledFor, a.timezone).local.replace("T", " ") : a.scheduledFor;
          const message = `Ora programată (${local}${a.timezone ? ` ${a.timezone}` : ""}) a trecut fără o publicare înregistrată. Hub-ul nu publică automat${pol.autoPublish ? " (nicio rută automată nu există în M09)" : " (autoPublish dezactivat)"}: publică manual și înregistrează URL-ul, reprogramează (aprobare nouă) sau anulează.`;
          const res = db.prepare("UPDATE content_release_attempts SET status = 'MISSED_NEEDS_DECISION', error = ?, updated_at = ? WHERE id = ? AND status = ?").run(message, at.toISOString(), a.id, a.status);
          if (res.changes) {
            missed.push(a.id);
            emit("content.release.missed", a.id, { manifestId: a.manifestId, platform: a.platform, scheduledFor: a.scheduledFor, autoPublish: Boolean(pol.autoPublish) }, "scheduler");
          }
        }
      });
    }
    return { at: at.toISOString(), checked: due.length, missed, dispatched: 0, autoPublish: Boolean(pol.autoPublish) };
  }

  /** Boot: an interrupted upload has an unknown outcome; due items are marked missed (never sent). */
  function recover() {
    const interrupted = db.prepare("SELECT id, platform FROM content_release_attempts WHERE status = 'UPLOADING'").all();
    if (interrupted.length) bus.transaction(() => {
      for (const a of interrupted) {
        db.prepare("UPDATE content_release_attempts SET status = 'OUTCOME_UNKNOWN', error = ?, updated_at = ? WHERE id = ? AND status = 'UPLOADING'").run("Încărcare întreruptă de repornire: rezultatul e necunoscut; se reconciliază, nu se reîncarcă.", now(), a.id);
        emit("content.release.outcome_unknown", a.id, { platform: a.platform, reason: "restart" }, "system");
      }
    });
    return { ...tick(), interrupted: interrupted.map((a) => a.id) };
  }

  /** Fail-safe cancel of a not-yet-published attempt. OUTCOME_UNKNOWN cannot be cancelled (external state unknown). */
  function cancel({ attemptId, actor = "owner", reason = "" } = {}) {
    const a = needAttempt(attemptId);
    if (a.status === "CANCELLED") return { attempt: a, already: true };
    if (!OPEN_ATTEMPT_STATUSES.includes(a.status)) {
      throw conflict(a.status === "OUTCOME_UNKNOWN" ? "Rezultatul e necunoscut: reconciliază încercarea înainte de anulare" : `Încercarea are starea ${a.status} și nu se mai anulează`, "ATTEMPT_STATE");
    }
    return bus.transaction(() => {
      db.prepare("UPDATE content_release_attempts SET status = 'CANCELLED', error = ?, updated_at = ? WHERE id = ? AND status = ?").run(clip(reason || "Anulat de proprietar", 500), now(), attemptId, a.status);
      emit("content.release.cancelled", attemptId, { manifestId: a.manifestId, platform: a.platform, reason: clip(reason, 200) }, actor);
      return { attempt: getAttemptRow(attemptId), already: false };
    });
  }

  /** Partial success is kept: each platform keeps its own outcome; nothing is rolled back. */
  function releaseStatus(manifestId) {
    const m = needManifest(manifestId);
    const attempts = db.prepare("SELECT * FROM content_release_attempts WHERE manifest_id = ? ORDER BY created_at").all(manifestId).map(rowToAttempt);
    const byPlatform = Object.fromEntries((m.body.variants || []).map((v) => {
      const list = attempts.filter((a) => a.platform === v.platform);
      const last = list[list.length - 1] || null;
      return [v.platform, { status: last?.status || "NOT_STARTED", attemptId: last?.id || null, url: last?.external?.url || null }];
    }));
    const values = Object.values(byPlatform).map((x) => x.status);
    const published = values.filter((s) => s === "PUBLISHED").length;
    const overall = published === values.length && values.length ? "COMPLETE" : published > 0 ? "PARTIAL" : values.every((s) => s === "NOT_STARTED") ? "NONE"
      : values.includes("OUTCOME_UNKNOWN") ? "UNKNOWN" : values.every((s) => ["FAILED", "CANCELLED"].includes(s)) ? "FAILED" : "IN_PROGRESS";
    return { manifestId, manifestStatus: m.status, overall, published, total: values.length, byPlatform };
  }

  function listAttempts({ manifestId = null, contentProjectId = null, status = null, limit = 200 } = {}) {
    const where = []; const args = [];
    if (manifestId) { where.push("a.manifest_id = ?"); args.push(manifestId); }
    if (contentProjectId) { where.push("m.content_project_id = ?"); args.push(contentProjectId); }
    if (status) { where.push("a.status = ?"); args.push(status); }
    return db.prepare(`SELECT a.* FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC LIMIT ?`)
      .all(...args, Math.min(Math.max(Number(limit) || 200, 1), 500)).map(rowToAttempt);
  }

  return {
    PLATFORM_REGISTRY, buildManifest, amendManifest, approve, checkInvalidation, preparePack, verifyPack: async (attemptId) => verifyPack(needAttempt(attemptId)),
    recordManual, apiRelease, reconcile, tick, recover, cancel, releaseStatus, listAttempts,
    getManifest: needManifest, getAttempt: needAttempt,
    listManifests: (contentProjectId) => db.prepare("SELECT * FROM content_manifests WHERE content_project_id = ? ORDER BY created_at DESC").all(contentProjectId).map(rowToManifest),
  };
}
