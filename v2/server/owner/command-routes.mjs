import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "./trust.mjs";
import { companyGraph } from "../domain/company-graph.mjs";
import { processSheets } from "./process-sheets.mjs";
import { salesFunnel, funnelThreshold } from "../sales/funnel.mjs";
import { factoryTrace } from "../factory/trace.mjs";
import { systemMap } from "../domain/system-map.mjs";
export function refuseDeclared(req) {
  const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
  if (declared === "agent" || declared === "cli") throw new HubError("policy", `Rutele de proprietar nu acceptă canalul ${declared}`);
}
/** M16 read routes (GET, refused for the agent / cli channels) and the one presentation command (recap.present). */
export function registerCommandRoutes(router, hub) {
  const get = (path, handler) => router.add("GET", path, (context) => { refuseDeclared(context.req); return handler(context); });
  async function dispatch(req, type, payload) {
    refuseDeclared(req);
    const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); let value = c.slice(i + 1); try { value = decodeURIComponent(value); } catch { /* malformed cookie stays inert */ } return i < 0 ? [c, ""] : [c.slice(0, i), value]; }));
    const ownerSession = hub.trust.resolveSession(cookies[SESSION_COOKIE] || null, { origin: req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`, touch: true });
    const result = await hub.commands.dispatch({ type, payload, actor: ownerSession ? `owner:${ownerSession.id}` : "user", channel: ownerSession ? "owner" : "ui", ownerSession, idempotencyKey: req.headers["idempotency-key"] || null, intentText: type === "owner.intent" ? String(payload.text || "").slice(0, 500) : "" });
    return result.approvalRequired ? { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } } : result.result;
  }
  get("/api/recap", ({ query }) => hub.recap.build({ period: query.period || "today", projectId: query.projectId || null }));
  get("/api/recap/:id", ({ params }) => { const snapshot = hub.recap.get(params.id); if (!snapshot) throw new HubError("not_found", "Rezumatul nu mai e disponibil; cere unul nou."); return snapshot; });
  router.add("POST", "/api/recap/:id/present", ({ req, params, body }) => dispatch(req, "recap.present", { snapshotId: params.id, index: body?.index, legaSessionId: body?.legaSessionId, action: body?.action || "show" }));
  get("/api/company/graph", () => companyGraph(hub));
  get("/api/process-sheets", ({ query }) => processSheets(hub, { projectId: query.projectId || null }));
  get("/api/sales/funnel", ({ query }) => salesFunnel(hub, { threshold: funnelThreshold(query.threshold ?? 21) }));
  get("/api/factory/:id/trace", ({ params }) => factoryTrace(hub, params.id));
  get("/api/system/map", () => systemMap(hub));
}
