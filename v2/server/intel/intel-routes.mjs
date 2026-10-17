import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE } from "../owner/trust.mjs";
import { DEVICE_COOKIE } from "./devices.mjs";

/**
 * HTTP adapter for M08. Reads are GET routes over the services; writes dispatch the M08 commands on the owner channel when the
 * request carries a valid owner session (HttpOnly cookie, re-read every time), otherwise on the UI channel (where commands that add
 * authority refuse). A request that declares itself an agent or a script is refused here, like the owner routes. The phone uses
 * its own HttpOnly device cookie; it never receives or reuses the owner's session.
 */
export function registerIntelRoutes(router, hub) {
  const { commands, trust, twin, warroom, autopilot, board, simulations, league, skillEvolution, teach, devices, packages, settings, factory, envelopes } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  // Cookies are shared by every app on localhost: a malformed one ("%" alone) must not break these routes (the phone's stop included).
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return i < 0 ? [c, ""] : [c.slice(0, i), safeDecode(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;
  // Reads never extend the owner's session (a 5-second poll would keep it unlocked forever; review M08); writes do.
  const sessionOf = (req, { touch = false } = {}) => trust.resolveSession(cookies(req)[SESSION_COOKIE] || null, { origin: originOf(req), touch });
  const deviceOf = (req) => devices.authenticate(cookies(req)[DEVICE_COOKIE] || null);
  const ownerOnly = (type) => { const spec = commands.catalog().find((c) => c.type === type); return Boolean(spec && !(spec.channels || []).includes("ui")); };

  async function dispatch(req, type, payload) {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Rutele M08 nu acceptă canalul ${declared}`);
    const session = sessionOf(req, { touch: true });
    // An owner-only action without a live session asks for Windows Hello (the page unlocks and retries), not a channel error.
    if (!session && ownerOnly(type)) throw new HubError("authentication", "Pentru asta deschide sesiunea de proprietar (Windows Hello)", { data: { needSession: true } });
    const result = await commands.dispatch({ type, payload, actor: session ? `owner:${session.id}` : "user", channel: session ? "owner" : "ui", ownerSession: session,
      idempotencyKey: req.headers["idempotency-key"] || null });
    if (result.approvalRequired) return { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } };
    return result.result;
  }
  const cmd = (type, map = ({ body }) => body) => async (ctx) => dispatch(ctx.req, type, map(ctx));

  // ---------- Digital Twin ----------
  get("/api/twin/company", () => twin.graph(null));
  get("/api/twin/why", ({ query }) => twin.why(query.projectId || null, String(query.q || "")));
  get("/api/twin/:projectId", ({ params }) => twin.graph(params.projectId));
  get("/api/twin/:projectId/blocked", ({ params }) => twin.blocked(params.projectId));
  get("/api/twin/:projectId/changes", ({ params, query }) => twin.changesSince(params.projectId, { since: query.since || null }));
  get("/api/twin/:projectId/impact", ({ params, query }) => twin.impact(params.projectId, { paths: String(query.paths || "").split(",").map((s) => s.trim()).filter(Boolean), changeSetId: query.changeSetId || null, component: query.component || null }));
  get("/api/twin/:projectId/claims", ({ params }) => ({ claims: twin.claims(params.projectId), contradictions: twin.contradictions(params.projectId) }));
  post("/api/twin/claims", cmd("twin.claim.add"));
  post("/api/twin/claims/:id/status", cmd("twin.claim.status", ({ params, body }) => ({ claimId: params.id, status: body.status, evidenceRef: body.evidenceRef || "" })));

  // ---------- War Room ----------
  get("/api/warroom", ({ query }) => ({ incidents: warroom.list({ projectId: query.projectId || null, open: query.open === "1" }), needed: warroom.needed }));
  get("/api/warroom/:id", ({ params }) => warroom.view(params.id));
  get("/api/warroom/:id/suggest-pause", ({ params }) => warroom.suggestPause(params.id));
  post("/api/warroom", cmd("incident.propose"));
  post("/api/warroom/:id/entries", cmd("incident.entry.add", ({ params, body }) => ({ ...body, incidentId: params.id })));
  post("/api/warroom/entries/:id/verify", cmd("incident.verify", ({ params, body }) => ({ ...body, entryId: params.id })));
  post("/api/warroom/:id/impact", cmd("incident.impact", ({ params, body }) => ({ incidentId: params.id, impact: body.impact || body })));
  post("/api/warroom/:id/components", cmd("incident.components", ({ params, body }) => ({ incidentId: params.id, components: body.components || [] })));
  post("/api/warroom/:id/transition", cmd("incident.transition", ({ params, body }) => ({ incidentId: params.id, to: body.to, reason: body.reason || "" })));
  post("/api/warroom/:id/remediate", cmd("incident.remediate", ({ params, body }) => ({ incidentId: params.id, testRef: body.testRef || "", verification: body.verification })));

  // ---------- Project Autopilot ----------
  get("/api/autopilot", ({ query }) => ({ objectives: autopilot.list(query.projectId || null) }));
  get("/api/autopilot/:id", ({ params }) => autopilot.view(params.id));
  post("/api/autopilot", cmd("autopilot.draft"));
  post("/api/autopilot/validate", ({ body }) => autopilot.validate(body || {}));
  post("/api/autopilot/:id/prepare", cmd("autopilot.prepare", ({ params }) => ({ objectiveId: params.id })));
  post("/api/autopilot/:id/propose", cmd("autopilot.propose", ({ params, body }) => ({ objectiveId: params.id, constraints: body.constraints || {} })));
  post("/api/autopilot/:id/amend", cmd("autopilot.amend", ({ params, body }) => ({ objectiveId: params.id, changes: body.changes || body })));

  // ---------- Board Meeting ----------
  get("/api/board/agenda", ({ query }) => board.agenda({ from: query.from || null }));
  get("/api/board/current", () => ({ meeting: board.current(), meetings: board.list() }));
  get("/api/board/:id", ({ params }) => board.view(params.id));
  post("/api/board", cmd("board.open"));
  post("/api/board/:id/move", cmd("board.move", ({ params, body }) => ({ meetingId: params.id, delta: Number(body.delta) || 1 })));
  post("/api/board/items/:id/decide", cmd("board.decide", ({ params, body }) => ({ itemId: params.id, decision: body.decision, note: body.note || "" })));
  post("/api/board/:id/close", cmd("board.close", ({ params }) => ({ meetingId: params.id })));

  // ---------- Simulation ----------
  get("/api/simulations", () => ({ simulations: simulations.list(), fields: simulations.fields, required: simulations.required, observed: simulations.observedInputs() }));
  get("/api/simulations/:id", ({ params }) => simulations.get(params.id) || (() => { throw new HubError("not_found", "Scenariu necunoscut"); })());
  post("/api/simulations", cmd("simulation.run"));
  post("/api/simulations/:id/propose", cmd("simulation.propose", ({ params, body }) => ({ simulationId: params.id, title: body.title || "" })));

  // ---------- Performance League ----------
  get("/api/league", ({ query }) => league.report({ includeTest: query.includeTest === "1" }));

  // ---------- Skill Evolution ----------
  get("/api/skills/candidates", ({ query }) => ({ candidates: skillEvolution.list(query.skillId || null) }));
  get("/api/skills/candidates/base/:skillId", ({ params }) => skillEvolution.baseBody(params.skillId));
  get("/api/skills/candidates/:id", ({ params }) => skillEvolution.get(params.id));
  post("/api/skills/candidates", cmd("skill.candidate.propose"));
  for (const [action, type] of [["evaluate", "skill.candidate.evaluate"], ["approve", "skill.candidate.approve"], ["activate", "skill.candidate.activate"], ["rollback", "skill.candidate.rollback"], ["reject", "skill.candidate.reject"]]) {
    post(`/api/skills/candidates/:id/${action}`, cmd(type, ({ params, body }) => ({ ...body, candidateId: params.id })));
  }

  // ---------- Teach Lega ----------
  get("/api/lessons", ({ query }) => ({ lessons: teach.list({ status: query.status || null }), applies: query.projectId ? teach.rulesFor({ projectId: query.projectId }) : undefined }));
  post("/api/lessons", cmd("lesson.propose"));
  post("/api/lessons/forget", cmd("lesson.forget"));
  post("/api/lessons/:id/confirm", cmd("lesson.confirm", ({ params }) => ({ lessonId: params.id })));
  post("/api/lessons/:id/dismiss", cmd("lesson.dismiss", ({ params }) => ({ lessonId: params.id })));
  post("/api/lessons/:id/forget/cancel", cmd("lesson.forget.cancel", ({ params }) => ({ lessonId: params.id })));
  post("/api/lessons/:id/forget/confirm", cmd("lesson.forget.confirm", ({ params }) => ({ lessonId: params.id })));

  // ---------- Decision packages ----------
  get("/api/packages", () => ({ packages: packages.list() }));
  get("/api/packages/:id", ({ params }) => packages.view(params.id));
  post("/api/packages", cmd("package.present"));
  post("/api/packages/:id/decide", cmd("package.decide", ({ params, body }) => ({ packageId: params.id, decisions: body.decisions || {} })));

  // ---------- Zero-Menu ----------
  /** "Ce avem azi?": the deterministic digest (the board's agenda, compact) plus what waits for the owner now. */
  get("/api/today", () => board.today());
  get("/api/owner/start-view", () => ({ startView: settings.get("startView") || "cockpit" }));
  post("/api/owner/start-view", cmd("owner.start_view"));
  post("/api/owner/plan/arm", cmd("envelope.arm"));

  // ---------- Personal Mission Control ----------
  /** The phone's compact state: for a paired device, or for the owner's session on the PC (same view, used to preview it). */
  get("/api/m/state", ({ req }) => {
    const device = deviceOf(req);
    const session = device ? null : sessionOf(req);
    if (!device && !session) throw new HubError("authentication", "Asociază acest dispozitiv (cod de pe PC) sau deschide sesiunea de proprietar", { data: { needPairing: true } });
    return { ...devices.mobileState(), viewer: device ? { kind: "device", id: device.id, label: device.label, permissions: device.permissions } : { kind: "owner-session" } };
  });
  get("/api/devices", ({ req }) => { if (!sessionOf(req)) throw new HubError("authentication", "Lista dispozitivelor cere sesiunea ta"); return { devices: devices.list(), permissions: devices.permissions }; });
  post("/api/devices/pairing", cmd("device.pairing.start", () => ({})));
  post("/api/devices/:id/revoke", cmd("device.revoke", ({ params }) => ({ deviceId: params.id })));
  post("/api/m/pair", ({ res, body }) => {
    const out = devices.pair({ code: body.code, label: body.label || "Telefon" });
    res.setHeader("Set-Cookie", `${DEVICE_COOKIE}=${encodeURIComponent(out.token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 90}`);
    return { device: out.device };
  });
  post("/api/m/command", async ({ req, body }) => {
    const device = deviceOf(req);
    if (!device) throw new HubError("authentication", "Dispozitiv neasociat sau revocat", { data: { needPairing: true } });
    return devices.command(device, { type: body.type, missionId: body.missionId || null, idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey, observedAt: body.observedAt });
  });
  post("/api/m/forget", async ({ req, res }) => {
    const device = deviceOf(req);
    if (device) await commands.dispatch({ type: "device.revoke", channel: "companion", actor: `device:${device.id}`, payload: { deviceId: device.id } });
    res.setHeader("Set-Cookie", `${DEVICE_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { forgotten: Boolean(device) };
  });
  void factory;
}
