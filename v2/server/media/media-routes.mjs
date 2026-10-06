import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "../owner/trust.mjs";

/** MIME types the library serves (anything else is refused, never sniffed). */
const SERVABLE = new Set(["video/mp4", "video/webm", "video/quicktime", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac",
  "image/png", "image/jpeg", "image/webp", "text/vtt", "application/x-subrip"]);
const UPLOAD_EXT = /^\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac|ogg|png|jpg|jpeg|webp)$/i;

/**
 * HTTP adapter for the M09 Content Studio. Reads are GET routes over the services; writes dispatch the media/content commands on
 * the owner channel when the request carries a valid owner session (HttpOnly cookie), otherwise on the UI channel. Agent / CLI
 * requests are refused. Media files are streamed (HTTP Range) only for READY library versions, by id — never by path, never the
 * data root, never a directory. Uploads stream to the work folder and are imported by the same validated command as a local file.
 */
export function registerMediaRoutes(router, hub) {
  const { commands, trust, media, voice, config } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return i < 0 ? [c, ""] : [c.slice(0, i), safeDecode(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;
  const sessionOf = (req, { touch = false } = {}) => trust.resolveSession(cookies(req)[SESSION_COOKIE] || null, { origin: originOf(req), touch });
  const ownerOnly = (type) => { const spec = commands.catalog().find((c) => c.type === type); return Boolean(spec && !(spec.channels || []).includes("ui")); };
  const refuseDeclared = (req) => {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Rutele Studio nu acceptă canalul ${declared}`);
  };

  async function dispatch(req, type, payload) {
    refuseDeclared(req);
    const session = sessionOf(req, { touch: true });
    if (!session && ownerOnly(type)) throw new HubError("authentication", "Pentru asta deschide sesiunea de proprietar (Windows Hello)", { data: { needSession: true } });
    const result = await commands.dispatch({ type, payload, actor: session ? `owner:${session.id}` : "user", channel: session ? "owner" : "ui", ownerSession: session,
      idempotencyKey: req.headers["idempotency-key"] || null });
    if (result.approvalRequired) return { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } };
    return result.result;
  }
  const cmd = (type, map = ({ body }) => body) => async (ctx) => dispatch(ctx.req, type, map(ctx));

  /** What the Studio must say about itself (never fake a voice-only or live capability). */
  function limitations() {
    const out = [];
    let vs = null;
    try { vs = voice?.status?.() || null; } catch { vs = null; }
    if (!vs?.gate?.enabled) out.push({ code: "VOICE_FILTER_OFF", text: "Filtrul vocal e oprit: comenzile vocale pentru Studio vin ca transcriere de provider — pot deschide și propune corecturi (anulabile), nu pot aproba sau publica." });
    if (vs && vs.localTranscription && !vs.localTranscription.available) out.push({ code: "LOCAL_STT_UNAVAILABLE", text: "Transcrierea vocală locală nu e disponibilă acum." });
    const policy = hub.settings.get("mediaPolicy") || {};
    if (!policy.liveCapture) out.push({ code: "LIVE_MEDIA_CAPTURE_DISABLED", text: "Captura ecranului tău / a Hub-ului live e oprită (pachetul MEDIA_B)." });
    if (!policy.liveUpload) out.push({ code: "LIVE_UPLOAD_DISABLED", text: "Încărcarea pe platforme e oprită: se pregătesc pachete manuale (pachetul MEDIA_C)." });
    if (!policy.autoPublish) out.push({ code: "AUTO_PUBLISH_OFF", text: "Nimic nu se publică automat." });
    return out;
  }

  // ---------- status & catalogs ----------
  get("/api/media/status", () => ({ ...media.status(), limitations: limitations() }));
  // M10.2: a GET never mutates. inspect() compares the binaries with the pins (PINNED / UNPINNED / CHANGED / MISSING) and writes
  // no setting or event; pinning is the media.tools.pin command (or a step of a confirmed plan), a change needs media.tools.acknowledge.
  get("/api/media/tools", async () => {
    const tools = await media.tools.inspect();
    const pins = hub.settings.get("mediaToolPins") || {};
    const pinView = (p) => (p?.sha256 ? { version: p.version || null, sha256: p.sha256, libsSha256: p.libsSha256 || null, path: p.path || null, pinnedAt: p.pinnedAt || null,
      pinnedBy: p.pinnedBy || null, changedAt: p.changedAt || null, acknowledged: p.changedAt ? Boolean(p.acknowledged) : null,
      previous: p.previous ? { version: p.previous.version || null, sha256: p.previous.sha256 || null } : null } : null);
    return { tools, pins: { ffmpeg: pinView(pins.ffmpeg), ffprobe: pinView(pins.ffprobe) }, editors: await media.editors.inspectAll() };
  });
  get("/api/media/profiles", () => ({ profiles: media.PLATFORM_PROFILES }));
  get("/api/media/presets", () => ({ presets: media.presets.list() }));
  get("/api/media/presets/:id", ({ params, query }) => {
    const preset = media.presets.get(params.id, query.version ? Number(query.version) : undefined);
    if (!preset) throw new HubError("not_found", "Presetul nu există");
    return { preset, fonts: media.presets.fonts(preset) };
  });
  get("/api/content/platforms", () => ({ platforms: media.PLATFORM_REGISTRY }));

  // ---------- content ----------
  get("/api/content/board", ({ query }) => media.content.board({ campaignId: query.campaignId || null }));
  get("/api/content/ideas", ({ query }) => ({ ideas: media.content.listIdeas({ status: query.status || null, limit: Number(query.limit) || 100 }) }));
  get("/api/content/projects", ({ query }) => ({ projects: media.content.listProjects({ stage: query.stage || null, limit: Number(query.limit) || 100 }) }));
  get("/api/content/projects/:id", ({ params }) => {
    const detail = media.content.detail(params.id);
    if (!detail) throw new HubError("not_found", "Proiectul de conținut nu există");
    return { ...detail, edits: media.edits.list({ contentProjectId: params.id }), manifests: media.distribution.listManifests(params.id),
      captures: media.capture.list({ contentProjectId: params.id }), assets: media.assets.list({ contentProjectId: params.id }), limitations: limitations() };
  });
  get("/api/content/command-center", () => commandCenter());

  // ---------- library ----------
  get("/api/media/assets", ({ query }) => ({ assets: media.assets.list({ contentProjectId: query.contentProjectId || null, category: query.category || null, kind: query.kind || null,
    q: query.q || null, limit: Number(query.limit) || 100, offset: Number(query.offset) || 0 }), quota: media.assets.quota() }));
  get("/api/media/assets/:id", ({ params }) => {
    const asset = media.assets.get(params.id);
    if (!asset) throw new HubError("not_found", "Assetul nu există");
    return { asset, rights: media.rights.current(params.id), evaluation: media.rights.evaluate({ assetId: params.id, platform: "*", use: "organic" }) };
  });
  get("/api/media/search", ({ query }) => ({ results: media.assets.search({ q: String(query.q || ""), limit: Number(query.limit) || 50, contentProjectId: query.contentProjectId || null }) }));
  get("/api/media/rights/:assetId/impact", ({ params }) => media.rights.revocationImpact(params.assetId));
  get("/api/media/transcripts", ({ query }) => ({ transcripts: media.transcriber.list({ assetVersionId: query.assetVersionId || null, limit: Number(query.limit) || 50 }) }));
  get("/api/media/files/:versionId", ({ req, res, params, query }) => streamVersion(req, res, params.versionId, query));

  // ---------- edits, renders, QA, reviews, variants ----------
  get("/api/media/edits", ({ query }) => ({ edits: media.edits.list({ contentProjectId: query.contentProjectId || null }) }));
  get("/api/media/edits/:id", ({ params }) => { const e = media.edits.get(params.id); if (!e) throw new HubError("not_found", "Proiectul de montaj nu există"); return { edit: e, variants: media.variants.list({ editProjectId: params.id }) }; });
  get("/api/media/edit-versions/:id", ({ params }) => {
    const version = media.edits.getVersion(params.id);
    if (!version) throw new HubError("not_found", "Versiunea nu există");
    let explain = null;
    try { explain = media.editors.explainEdit(version.ir, {}); } catch { explain = null; }
    return { version, explain, qa: media.qa.summary(params.id), reviews: media.reviews.list({ editVersionId: params.id }), renders: media.render.list({ editVersionId: params.id }) };
  });
  get("/api/media/renders", ({ query }) => ({ renders: media.render.list({ editVersionId: query.editVersionId || null, status: query.status || null, limit: Number(query.limit) || 50 }) }));
  get("/api/media/renders/:id", ({ params }) => { const j = media.render.get(params.id); if (!j) throw new HubError("not_found", "Randarea nu există"); return j; });
  get("/api/media/qa/:editVersionId", ({ params }) => ({ summary: media.qa.summary(params.editVersionId), reports: media.qa.list({ editVersionId: params.editVersionId }) }));
  get("/api/media/reviews", ({ query }) => ({ reviews: media.reviews.list({ editVersionId: query.editVersionId || null, limit: Number(query.limit) || 100 }) }));
  get("/api/media/variants", ({ query }) => ({ variants: media.variants.list({ editProjectId: query.editProjectId || null }) }));
  get("/api/media/captures", ({ query }) => ({ captures: media.capture.list({ contentProjectId: query.contentProjectId || null, limit: Number(query.limit) || 50 }) }));

  // ---------- distribution & growth ----------
  get("/api/content/manifests", ({ query }) => ({ manifests: query.contentProjectId ? media.distribution.listManifests(query.contentProjectId) : [] }));
  get("/api/content/manifests/:id", ({ params }) => ({ manifest: media.distribution.getManifest(params.id), releases: media.distribution.releaseStatus(params.id) }));
  get("/api/content/releases", ({ query }) => ({ releases: media.distribution.listAttempts({ manifestId: query.manifestId || null, contentProjectId: query.contentProjectId || null, status: query.status || null, limit: Number(query.limit) || 100 }) }));
  get("/api/content/analytics/:contentProjectId", ({ params }) => ({ summary: media.analytics.summary(params.contentProjectId), plan: safe(() => media.analytics.snapshotPlan?.({ contentProjectId: params.contentProjectId })) }));
  get("/api/content/metrics/registry", () => ({ registry: media.analytics.METRIC_REGISTRY }));
  get("/api/content/experiments", () => ({ experiments: media.analytics.listExperiments() }));
  get("/api/content/insights", ({ query }) => ({ insights: media.analytics.listInsights({ status: query.status || null }) }));
  get("/api/content/campaigns", ({ query }) => ({ campaigns: media.campaigns.listCampaigns({ status: query.status || null }) }));
  get("/api/content/funnel/:contentProjectId", ({ params }) => media.campaigns.funnel(params.contentProjectId));

  // ---------- writes (commands) ----------
  post("/api/content/ideas", cmd("content.idea.create"));
  post("/api/content/ideas/:id/status", cmd("content.idea.status", ({ params, body }) => ({ ...body, ideaId: params.id })));
  post("/api/content/ideas/:id/promote", cmd("content.idea.promote", ({ params, body }) => ({ ideaId: params.id, fields: body.fields || {} })));
  post("/api/content/projects", cmd("content.project.create", ({ body }) => ({ fields: body.fields || body })));
  post("/api/content/projects/:id/update", cmd("content.project.update", ({ params, body }) => ({ projectId: params.id, fields: body.fields || {}, expectedVersion: body.expectedVersion })));
  post("/api/content/projects/:id/stage", cmd("content.project.stage", ({ params, body }) => ({ ...body, projectId: params.id })));
  post("/api/content/projects/:id/readiness", cmd("content.readiness.evaluate", ({ params }) => ({ projectId: params.id })));
  post("/api/content/projects/:id/brief", cmd("content.brief.save", ({ params, body }) => ({ projectId: params.id, body: body.body || body })));
  post("/api/content/projects/:id/script", cmd("content.script.save", ({ params, body }) => ({ ...body, projectId: params.id })));
  post("/api/content/projects/:id/storyboard", cmd("content.storyboard.save", ({ params, body }) => ({ ...body, projectId: params.id })));
  post("/api/content/projects/:id/claims", cmd("content.claim.save", ({ params, body }) => ({ projectId: params.id, claim: body.claim || body })));
  post("/api/content/claims/:id/status", cmd("content.claim.status", ({ params, body }) => ({ ...body, claimId: params.id })));
  post("/api/media/assets/import", cmd("media.asset.import"));
  post("/api/media/assets/:id/update", cmd("media.asset.update", ({ params, body }) => ({ assetId: params.id, patch: body.patch || {}, expectedVersion: body.expectedVersion })));
  post("/api/media/rights", cmd("media.rights.record", ({ body }) => ({ right: body.right || body })));
  post("/api/media/rights/:id/revoke", cmd("media.rights.revoke", ({ params, body }) => ({ rightId: params.id, reason: body.reason || "revocat" })));
  post("/api/media/policy/import-roots", cmd("media.policy.import_roots"));
  // Fail-safe: switching live capture off always works (a stale page included).
  post("/api/media/policy/capture-off", cmd("media.policy.capture_off", ({ body }) => ({ reason: String(body?.reason || "oprit din Studio").slice(0, 300) })));
  post("/api/media/transcripts", cmd("media.transcribe"));
  post("/api/media/transcripts/:id/cancel", cmd("media.transcribe.cancel", ({ params }) => ({ transcriptId: params.id })));
  post("/api/media/edits", cmd("media.edit.create"));
  post("/api/media/edit-versions/:id/patches", cmd("media.edit.patch.propose", ({ params, body }) => ({ ...body, editVersionId: params.id })));
  post("/api/media/reviews/:id/apply", cmd("media.edit.patch.apply", ({ params }) => ({ reviewId: params.id })));
  post("/api/media/reviews/:id/dismiss", cmd("media.edit.patch.dismiss", ({ params, body }) => ({ reviewId: params.id, reason: body.reason || "" })));
  post("/api/media/edit-versions/:id/divergence", cmd("media.edit.divergence.record", ({ params, body }) => ({ ...body, editVersionId: params.id })));
  post("/api/media/edit-versions/:id/decision", cmd("media.review.decide", ({ params, body }) => ({ ...body, editVersionId: params.id })));
  post("/api/media/edit-versions/:id/variants", cmd("media.variant.derive", ({ params, body }) => ({ ...body, masterVersionId: params.id })));
  // M10.2 (#27): the Studio → Unelte panel posts the identity it displayed, so the pin / acknowledgement covers exactly what the owner
  // saw (compared server-side; a binary or DLL set swapped meanwhile is refused). The planId of an automation pin never comes from HTTP.
  post("/api/media/tools/pin", cmd("media.tools.pin", ({ body }) => ({ reason: String(body?.reason || "").slice(0, 200),
    ...(body?.expect && typeof body.expect === "object" && !Array.isArray(body.expect) ? { expect: body.expect } : {}) })));
  post("/api/media/tools/:tool/acknowledge", cmd("media.tools.acknowledge", ({ params, body }) => ({ tool: params.tool, ...(body?.sha256 ? { sha256: body.sha256 } : {}),
    ...(typeof body?.libsSha256 === "string" && body.libsSha256 ? { libsSha256: body.libsSha256 } : {}), ...(typeof body?.version === "string" && body.version ? { version: body.version } : {}) })));
  post("/api/media/renders", cmd("media.render.request"));
  post("/api/media/renders/:id/retry", cmd("media.render.retry", ({ params }) => ({ jobId: params.id })));
  post("/api/media/renders/:id/cancel", cmd("media.render.cancel", ({ params }) => ({ jobId: params.id })));
  post("/api/media/qa", cmd("media.qa.run"));
  post("/api/media/edit-versions/:id/export/otio", cmd("media.export.otio", ({ params }) => ({ editVersionId: params.id })));
  post("/api/media/edit-versions/:id/export/edl", cmd("media.export.edl", ({ params }) => ({ editVersionId: params.id })));
  post("/api/media/edit-versions/:id/export/capcut", cmd("media.export.capcut_pack", ({ params, body }) => ({ editVersionId: params.id, platform: body.platform || undefined })));
  post("/api/media/captures", cmd("media.capture.plan"));
  post("/api/media/captures/demo", cmd("media.capture.demo"));
  post("/api/media/captures/:id/markers", cmd("media.capture.marker", ({ params, body }) => ({ ...body, sessionId: params.id })));
  post("/api/media/captures/:id/cancel", cmd("media.capture.cancel", ({ params }) => ({ sessionId: params.id })));
  post("/api/media/captures/:id/obs/start", cmd("media.capture.obs.start", ({ params, body }) => ({ sessionId: params.id, password: body.password || undefined })));
  post("/api/media/captures/:id/obs/stop", cmd("media.capture.obs.stop", ({ params, body }) => ({ sessionId: params.id, password: body.password || undefined })));
  post("/api/content/manifests", cmd("content.manifest.build"));
  post("/api/content/manifests/:id/approve", cmd("content.manifest.approve", ({ params, body }) => ({ ...body, manifestId: params.id })));
  post("/api/content/manifests/:id/packs", cmd("content.release.prepare_pack", ({ params, body }) => ({ manifestId: params.id, platform: body.platform })));
  post("/api/content/releases/:id/manual", cmd("content.release.record_manual", ({ params, body }) => ({ ...body, attemptId: params.id })));
  post("/api/content/releases/:id/cancel", cmd("content.release.cancel", ({ params, body }) => ({ attemptId: params.id, reason: body.reason || "" })));
  post("/api/content/metrics/import", cmd("content.metrics.import"));
  post("/api/content/experiments", cmd("content.experiment.register", ({ body }) => ({ experiment: body.experiment || body })));
  post("/api/content/experiments/:id/analyze", cmd("content.experiment.analyze", ({ params }) => ({ experimentId: params.id })));
  post("/api/content/insights", cmd("content.insight.propose", ({ body }) => ({ insight: body.insight || body })));
  post("/api/content/insights/:id/status", cmd("content.insight.status", ({ params, body }) => ({ ...body, insightId: params.id })));
  post("/api/content/campaigns", cmd("content.campaign.save", ({ body }) => ({ campaign: body.campaign || body })));
  post("/api/content/campaigns/:id/attach", cmd("content.campaign.attach", ({ params, body }) => ({ campaignId: params.id, contentProjectId: body.contentProjectId })));
  post("/api/content/projects/:id/opportunity", cmd("content.opportunity.link", ({ params, body }) => ({ ...body, contentProjectId: params.id })));
  post("/api/content/funnel", cmd("content.funnel.record", ({ body }) => ({ event: body.event || body })));
  // Upload: the body is streamed to the work folder (never buffered in memory, never into a command log), then imported by the
  // same validated command as a local file (hash, magic sniff, ffprobe, QUARANTINED when undecodable).
  post("/api/media/upload", async ({ req, query }) => {
    refuseDeclared(req);
    const ext = path.extname(String(query.filename || "")).toLowerCase();
    if (!UPLOAD_EXT.test(ext)) throw new HubError("validation", "Tip de fișier nepermis pentru încărcare", { code: "UPLOAD_TYPE" });
    if (!/^application\/octet-stream\b/i.test(String(req.headers["content-type"] || ""))) throw new HubError("validation", "Content-Type must be application/octet-stream");
    const max = Number(hub.settings.get("mediaPolicy")?.uploadMaxBytes) || 4 * 1024 ** 3;
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > max) throw new HubError("validation", "Fișierul depășește limita de încărcare", { code: "UPLOAD_TOO_LARGE" });
    const uploads = path.join(path.dirname(config.mediaWorkDir), "media-uploads");
    fs.mkdirSync(uploads, { recursive: true });
    const uploadId = `upl_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}${ext}`;
    const target = path.join(uploads, uploadId);
    await new Promise((resolve, reject) => {
      let size = 0;
      let settled = false;
      const out = fs.createWriteStream(target, { flags: "wx" });
      const fail = (error) => { if (settled) return; settled = true; out.destroy(); reject(error); };
      req.on("data", (chunk) => { size += chunk.length; if (size > max) { req.destroy(); fail(new HubError("validation", "Fișierul depășește limita de încărcare", { code: "UPLOAD_TOO_LARGE" })); } });
      // A client that goes away mid-upload: the partial file is closed and removed (never imported).
      req.on("aborted", () => fail(new HubError("validation", "Încărcarea a fost întreruptă", { code: "UPLOAD_ABORTED" })));
      req.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => { if (!settled) { settled = true; resolve(); } });
      req.pipe(out);
    }).catch((error) => { fs.rmSync(target, { force: true }); throw error; });
    try {
      return await dispatch(req, "media.asset.import_upload", { uploadId, title: String(query.title || "").slice(0, 200), category: query.category || "raw",
        origin: query.origin || "UNKNOWN", captureLabel: query.captureLabel || undefined, contentProjectId: query.contentProjectId || undefined });
    } finally {
      // Refused before the import ran (channel, validation): the uploaded file never stays behind.
      fs.rmSync(target, { force: true });
    }
  }, { stream: true });

  function safe(fn) { try { return fn(); } catch { return null; } }

  /** Pipes a file to the response and closes the file when the client goes away (a seek aborts the previous range request). */
  function pipeFile(stream, res) {
    const close = () => { if (!stream.destroyed) stream.destroy(); };
    res.on("close", close);
    stream.on("error", () => { close(); res.destroy(); });
    stream.pipe(res);
  }

  /** Streams one READY library version (Range supported, nosniff, never a path from the request). */
  function streamVersion(req, res, versionId, query) {
    const version = media.assets.getVersion(String(versionId || ""));
    if (!version) throw new HubError("not_found", "Fișierul nu există");
    if (!SERVABLE.has(String(version.mime || "").toLowerCase())) throw new HubError("policy", "Tipul fișierului nu se servește", { code: "MEDIA_NOT_SERVABLE" });
    const abs = media.assets.versionPath(version.id);
    const stat = fs.statSync(abs);
    const headers = { "Content-Type": version.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=0", "X-Content-Type-Options": "nosniff" };
    if (query.download === "1") {
      const base = String(version.title || version.id).replace(/[^\p{L}\p{N} ._-]+/gu, "_").slice(0, 80) || version.id;
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(base + path.extname(abs))}`;
    }
    const range = String(req.headers.range || "");
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (!(start >= 0 && start <= end && end < stat.size)) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return undefined;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
      pipeFile(fs.createReadStream(abs, { start, end }), res);
      return undefined;
    }
    res.writeHead(200, { ...headers, "Content-Length": stat.size });
    pipeFile(fs.createReadStream(abs), res);
    return undefined;
  }

  /** Command Center: counts from real rows only; "not enough data" instead of invented insights. */
  function commandCenter() {
    const db = hub.db;
    const count = (sql, ...a) => Number(db.prepare(sql).get(...a)?.n || 0);
    const byStage = Object.fromEntries(db.prepare("SELECT stage, COUNT(*) AS n FROM content_projects GROUP BY stage").all().map((r) => [r.stage, r.n]));
    const releases = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM content_release_attempts GROUP BY status").all().map((r) => [r.status, r.n]));
    const measured = count("SELECT COUNT(DISTINCT release_attempt_id) AS n FROM content_metrics WHERE value IS NOT NULL AND source != 'fixture'");
    return {
      ideas: { open: count("SELECT COUNT(*) AS n FROM content_ideas WHERE status IN ('NEW','SHORTLISTED')") },
      projects: byStage,
      renders: { active: count("SELECT COUNT(*) AS n FROM media_render_jobs WHERE status IN ('REQUESTED','CLAIMED','RUNNING','VALIDATING','CANCEL_REQUESTED')"),
        failed: count("SELECT COUNT(*) AS n FROM media_render_jobs WHERE status = 'FAILED'") },
      reviews: { open: count("SELECT COUNT(*) AS n FROM media_reviews WHERE status = 'OPEN'") },
      manifests: { draft: count("SELECT COUNT(*) AS n FROM content_manifests WHERE status = 'DRAFT'"), approved: count("SELECT COUNT(*) AS n FROM content_manifests WHERE status = 'APPROVED'") },
      releases,
      measuredPublications: measured,
      insights: measured < 3 ? { status: "INSUFFICIENT_DATA", text: "Nu avem încă suficiente publicații măsurate pentru concluzii." }
        : { status: "AVAILABLE", supported: count("SELECT COUNT(*) AS n FROM content_insights WHERE status = 'EXPERIMENT_SUPPORTED'"), observed: count("SELECT COUNT(*) AS n FROM content_insights WHERE status = 'OBSERVED_ASSOCIATION'") },
      limitations: limitations(),
    };
  }
}
