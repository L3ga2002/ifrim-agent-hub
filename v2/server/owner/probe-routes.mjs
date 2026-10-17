// M10.2 probe (U03) HTTP adapter. GET /api/owner/probe is read-only (SELECTs only; no command, no event, no session touch).
// POST /api/owner/nav records which old-flow screen the owner's UI entered: a fixed enum key, dispatched on the owner channel
// when the request carries the owner session, otherwise on the UI channel. A request that declares itself an agent or a script
// is refused: a developer's navigation is not the owner's and must never be counted as one.
import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "./trust.mjs";

export function registerProbeRoutes(router, hub) {
  const { commands, trust, probe } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return i < 0 ? [c, ""] : [c.slice(0, i), safeDecode(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;

  // ?mark=1 returns only the newest event seq (the marker a live probe starts from); otherwise the counters for the window.
  get("/api/owner/probe", ({ query }) => (query.mark ? probe.mark() : probe.report({ sinceSeq: query.sinceSeq, untilSeq: query.untilSeq })));

  post("/api/owner/nav", async ({ req, body }) => {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Telemetria de navigare nu acceptă canalul ${declared}`);
    // touch: false — entering a screen is not owner activity; it must not extend the session's idle deadline.
    const session = trust.resolveSession(cookies(req)[SESSION_COOKIE] || null, { origin: originOf(req), touch: false });
    // Only the screen key travels; anything else in the body is dropped here and again by the command's schema.
    const result = await commands.dispatch({ type: "owner.nav", payload: { screen: body?.screen }, actor: session ? `owner:${session.id}` : "user",
      channel: session ? "owner" : "ui", ownerSession: session });
    return result.result;
  }, { maxBytes: 1024 });
}
