// M10 HTTP adapter: Desktop Operator, operation plans, Studio project import / import folders / capture scope / local export.
// Writes dispatch on the owner channel when the request carries the owner session (HttpOnly cookie), otherwise on the UI channel;
// commands that add authority refuse the UI channel (they are owner-only in the catalog). Agent / CLI requests are refused here —
// the desktop is never reachable from a worker or a script. Stop, "Preiau eu", pause, cancel and revocations are fail-safe paths.
import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "../owner/trust.mjs";
import { PLAN_LIMITS, NEVER_IN_PLANS } from "./plans.mjs";

export function registerOpsRoutes(router, hub) {
  const { commands, trust, desktop, opsPlans, media } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return i < 0 ? [c, ""] : [c.slice(0, i), safeDecode(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;
  const sessionOf = (req, { touch = false } = {}) => trust.resolveSession(cookies(req)[SESSION_COOKIE] || null, { origin: originOf(req), touch });
  const ownerOnly = (type) => { const spec = commands.catalog().find((c) => c.type === type); return Boolean(spec && !(spec.channels || []).includes("ui")); };
  const refuseDeclared = (req) => {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Operatorul desktop și planurile nu acceptă canalul ${declared}`);
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
  const readGuard = (req) => refuseDeclared(req);

  // ---------- desktop operator ----------
  get("/api/desktop/status", ({ req }) => { readGuard(req); return { ...desktop.status(), obs: hub.settings.get("mediaPolicy")?.obs || null, liveCapture: hub.settings.get("mediaPolicy")?.liveCapture === true, plans: opsPlans.active().map((p) => ({ id: p.id, title: p.title, status: p.status, statusReason: p.statusReason })) }; });
  get("/api/desktop/actions", ({ req, query }) => { readGuard(req); return { actions: desktop.recentActions(Number(query.limit) || 30) }; });
  post("/api/desktop/apps/discover", cmd("desktop.apps.discover", () => ({})));
  post("/api/desktop/apps/authorize", cmd("desktop.apps.authorize", ({ body }) => ({ apps: body.apps })));
  post("/api/desktop/apps/revoke", cmd("desktop.apps.revoke", ({ body }) => ({ apps: body.apps, reason: body.reason || "" })));
  post("/api/desktop/open", cmd("desktop.app.open", ({ body }) => ({ app: body.app })));
  post("/api/desktop/focus", cmd("desktop.app.focus", ({ body }) => ({ app: body.app })));
  post("/api/desktop/folder/show", cmd("desktop.folder.show", ({ body }) => ({ folder: body.folder || undefined })));
  post("/api/desktop/folder/current", cmd("desktop.folder.current", () => ({})));
  post("/api/desktop/stop", cmd("desktop.stop", ({ body }) => ({ reason: body.reason || "Stop" })));
  post("/api/desktop/takeover", cmd("desktop.takeover", () => ({})));
  post("/api/desktop/resume", cmd("desktop.resume", () => ({})));

  // ---------- operation plans ----------
  get("/api/ops/plans", ({ req, query }) => { readGuard(req); return { plans: opsPlans.list({ limit: Number(query.limit) || 20, status: query.status || null }), limits: PLAN_LIMITS, never: NEVER_IN_PLANS }; });
  get("/api/ops/plans/:id", ({ req, params }) => { readGuard(req); const p = opsPlans.view(params.id); if (!p) throw new HubError("not_found", "Plan necunoscut"); return p; });
  post("/api/ops/plans", cmd("ops.plan.propose", ({ body }) => ({ kind: body.kind, title: body.title, steps: body.steps, limits: body.limits || {} })));
  post("/api/ops/plans/:id/confirm", cmd("ops.plan.confirm", ({ params, body }) => ({ planId: params.id, nonce: body.nonce, displayedHash: body.displayedHash, modality: body.modality || "click",
    utteranceId: body.utteranceId || undefined, secrets: body.secrets && typeof body.secrets === "object" ? body.secrets : undefined })), { maxBytes: 32 * 1024 });
  post("/api/ops/plans/:id/pause", cmd("ops.plan.pause", ({ params, body }) => ({ planId: params.id, reason: body.reason || "Pauză" })));
  post("/api/ops/plans/:id/cancel", cmd("ops.plan.cancel", ({ params, body }) => ({ planId: params.id, reason: body.reason || "Anulat" })));
  post("/api/ops/plans/:id/resume", cmd("ops.plan.resume", ({ params }) => ({ planId: params.id })));

  // ---------- Studio: project bundle, import folders, capture scope, local export ----------
  post("/api/media/projects/export", cmd("media.project.export", ({ body }) => ({ contentProjectId: body.contentProjectId, dir: body.dir })));
  post("/api/media/projects/preview", cmd("media.project.preview", ({ body }) => ({ dir: body.dir })));
  post("/api/media/projects/import", cmd("media.project.import", ({ body }) => ({ importId: body.importId, previewHash: body.previewHash })));
  get("/api/media/import-folders", ({ req }) => { readGuard(req); return { grants: media.importAccess.list(), roots: media.importRoots(), exportsDir: media.exportsDir() }; });
  post("/api/media/import-folders/preview", cmd("media.import.folder.preview", ({ body }) => ({ dir: body.dir })));
  post("/api/media/import-folders/authorize", cmd("media.import.folder.authorize", ({ body }) => ({ dir: body.dir, mode: body.mode || "once", previewSha256: body.previewSha256 })));
  post("/api/media/import-folders/:id/revoke", cmd("media.import.folder.revoke", ({ params }) => ({ grantId: params.id })));
  post("/api/media/captures/:id/scope/approve", cmd("media.capture.scope.approve", ({ params, body }) => ({ sessionId: params.id, expiresMinutes: Number.isInteger(body.expiresMinutes) ? body.expiresMinutes : undefined })));
  post("/api/media/policy/obs", cmd("media.policy.obs", ({ body }) => ({ recordingRoot: body.recordingRoot, url: body.url || undefined, scene: body.scene || undefined, defaultDurationSec: Number.isInteger(body.defaultDurationSec) ? body.defaultDurationSec : undefined })));
  post("/api/media/exports/local", cmd("media.export.local", ({ body }) => ({ assetVersionId: body.assetVersionId, name: body.name || undefined })));
}
