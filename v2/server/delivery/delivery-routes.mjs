// M11 HTTP adapter of the Delivery Room. Reads are GET only (the aggregated view, the E2E screenshots, the summary exports); writes
// dispatch on the owner channel with the owner session cookie (otherwise ui; owner-only commands then refuse). Agent / CLI requests are
// refused: a delivery is the owner's.
import fs from "node:fs";
import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "../owner/trust.mjs";
import { deliveryShot } from "./delivery-commands.mjs";
import { decisionsInbox } from "./inbox.mjs";

const ACTIONS = Object.freeze({
  verify: "delivery.verify", "summary-edit": "delivery.summary.edit", "summary-approve": "delivery.summary.approve", "software-accept": "delivery.software.accept",
  "package-propose": "delivery.package.propose", "preview-stop": "delivery.preview.stop", close: "delivery.close", cancel: "delivery.cancel", "revision-propose": "delivery.revision.propose",
  revise: "delivery.revise", "summary-service": "delivery.summary.service", "preview-start": "delivery.preview.start",
});

export function registerDeliveryRoutes(router, hub) {
  const { commands, trust, deliveries } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return i < 0 ? [c, ""] : [c.slice(0, i), safeDecode(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;
  const sessionOf = (req) => trust.resolveSession(cookies(req)[SESSION_COOKIE] || null, { origin: originOf(req), touch: true });
  const refuseDeclared = (req) => {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Livrările nu acceptă canalul ${declared}`);
  };

  // „Deciziile mele” (read-only): before /api/deliveries/:id so „decisions” is never read as a delivery id.
  get("/api/decisions/inbox", ({ req }) => { refuseDeclared(req); return decisionsInbox(hub); });
  get("/api/deliveries", ({ req, query }) => { refuseDeclared(req); return { deliveries: deliveries.list({ projectId: query.projectId || null }) }; });
  get("/api/deliveries/:id", ({ req, params }) => { refuseDeclared(req); return deliveries.view(params.id); });
  get("/api/deliveries/:id/evidence/:evidenceId/screenshot", ({ req, params }) => {
    refuseDeclared(req);
    const file = deliveryShot(hub, params.id, params.evidenceId);
    if (!file) throw new HubError("not_found", "Captura de ecran nu există (sau nu mai dovedește versiunea curentă).");
    return { __raw: true, contentType: "image/png", body: fs.readFileSync(file) };
  });
  get("/api/deliveries/:id/summary/:version", ({ req, params }) => {
    refuseDeclared(req);
    const m = String(params.version).match(/^(\d+)\.(md|html)$/);
    if (!m) throw new HubError("validation", "Versiune necunoscută");
    const doc = hub.db.prepare("SELECT export_json FROM delivery_documents WHERE delivery_id = ? AND version = ?").get(params.id, Number(m[1]));
    const file = doc ? JSON.parse(doc.export_json || "{}")[m[2]]?.file : null;
    if (!file || !fs.existsSync(file)) throw new HubError("not_found", "Fișierul rezumatului nu există.");
    return { __raw: true, contentType: m[2] === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8", body: fs.readFileSync(file) };
  });
  post("/api/deliveries/:id/:action", async ({ req, params, body }) => {
    refuseDeclared(req);
    const type = ACTIONS[params.action];
    if (!type) throw new HubError("not_found", "Acțiune necunoscută");
    const session = sessionOf(req);
    const result = await commands.dispatch({ type, payload: { ...(body || {}), deliveryId: params.id }, actor: session ? `owner:${session.id}` : "user", channel: session ? "owner" : "ui", ownerSession: session,
      idempotencyKey: req.headers["idempotency-key"] || null });
    if (result.approvalRequired) return { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } };
    return result.result;
  });
}
