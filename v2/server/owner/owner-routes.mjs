import { HubError } from "../core/errors.mjs";
import { SESSION_COOKIE, SESSION_DEFAULTS } from "./trust.mjs";
import { validateLayout, defaultLayout, CARD_TYPES } from "./layout.mjs";
import { AUTONOMY_LEVELS, AUTONOMY_LABELS, DENIED_EFFECTS } from "./envelopes.mjs";
import { PROJECT_STATES } from "./cockpit.mjs";
import { decodeDelegation } from "../runtime/commands.mjs";

/**
 * HTTP adapter for M06. The owner session travels in an HttpOnly, SameSite=Strict cookie scoped to /api; the database keeps
 * only its hash and the session is re-read on every request. A request with a valid session is dispatched on the "owner"
 * channel; without one it is the UI's legacy channel, and commands that add authority refuse it.
 */
export function registerOwnerRoutes(router, hub) {
  const { commands, trust, envelopes, cockpit, advisor, voice, projects, missions, factory, config } = hub;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);

  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  const originOf = (req) => req.headers.origin || `http://${String(req.headers.host || "").toLowerCase()}`;
  const tokenOf = (req) => cookies(req)[SESSION_COOKIE] || null;
  const sessionOf = (req, touch = true) => trust.resolveSession(tokenOf(req), { origin: originOf(req), touch });
  const setCookie = (res, token, maxAgeS) => res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${token ? maxAgeS : 0}`);

  async function dispatch(req, type, payload, { requireOwner = false } = {}) {
    // These routes act for the owner (session) or the owner's UI; a request that declares itself an agent or a script is refused
    // here instead of being recorded as the owner's click.
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    if (declared === "agent" || declared === "cli") throw new HubError("policy", `Rutele de proprietar nu acceptă canalul ${declared}`);
    const session = sessionOf(req);
    if (requireOwner && !session) throw new HubError("authentication", "Deschide sesiunea de proprietar (Windows Hello / cheia ta) pentru această acțiune", { data: { needSession: true } });
    const result = await commands.dispatch({ type, payload, actor: session ? `owner:${session.id}` : "user", channel: session ? "owner" : "ui", ownerSession: session,
      idempotencyKey: req.headers["idempotency-key"] || null, intentText: type === "owner.intent" ? String(payload.text || "").slice(0, 500) : "" });
    if (result.approvalRequired) return { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } };
    return result.result;
  }

  // ---------- trusted session ----------
  get("/api/owner/status", ({ req }) => ({ ...trust.status(sessionOf(req, false)), origin: originOf(req), webauthnOrigin: `http://localhost:${config.port}`,
    autonomyLevels: AUTONOMY_LEVELS.map((l) => ({ level: l, label: AUTONOMY_LABELS[l] })), deniedEffects: DENIED_EFFECTS, projectStates: PROJECT_STATES }));
  post("/api/owner/register/begin", ({ req, body }) => dispatch(req, "owner.register.begin", { origin: originOf(req), setupText: body.setupText || "" }));
  post("/api/owner/register/finish", ({ req, body }) => dispatch(req, "owner.register.finish", { origin: originOf(req), challengeId: body.challengeId, credential: body.credential, label: body.label || "" }), { maxBytes: 64 * 1024 });
  post("/api/owner/auth/begin", ({ req, body }) => dispatch(req, "owner.auth.begin", { origin: originOf(req), purpose: body.purpose || "unlock" }));
  post("/api/owner/auth/finish", async ({ req, res, body }) => {
    const result = await dispatch(req, "owner.auth.finish", { origin: originOf(req), challengeId: body.challengeId, credential: body.credential, currentToken: tokenOf(req) || "", userAgent: String(req.headers["user-agent"] || "").slice(0, 200) });
    if (result?.token) setCookie(res, result.token, SESSION_DEFAULTS.maxHours * 3600);
    return { sessionId: result.sessionId, expiresAt: result.expiresAt, reauthAt: result.reauthAt, renewed: result.renewed };
  }, { maxBytes: 64 * 1024 });
  post("/api/owner/logout", async ({ req, res }) => { const r = sessionOf(req) ? await dispatch(req, "owner.logout", {}) : { ended: false }; setCookie(res, null, 0); return r; });
  post("/api/owner/sessions/revoke-all", ({ req, body }) => dispatch(req, "owner.sessions.revoke_all", { reason: body.reason || "revocare" }));
  post("/api/owner/credentials/:id/revoke", ({ req, params }) => dispatch(req, "owner.credential.revoke", { credentialId: params.id }, { requireOwner: true }));
  post("/api/owner/policy/activate", ({ req, body }) => dispatch(req, "owner.policy.activate", { text: body.text }, { requireOwner: true }));
  post("/api/owner/policy/deactivate", ({ req, body }) => dispatch(req, "owner.policy.deactivate", { reason: body.reason || "" }));

  // ---------- cockpit, explain, replay, company map ----------
  get("/api/cockpit/:projectId", async ({ params }) => {
    const data = await cockpit.projectCockpit(params.projectId);
    if (!data) throw new HubError("not_found", "Proiect necunoscut");
    return { ...data, layout: defaultLayout(data) };
  });
  get("/api/cockpit/:projectId/delta", ({ params }) => cockpit.delta(params.projectId === "company" ? "__company__" : (projects.get(params.projectId)?.id || params.projectId)));
  post("/api/cockpit/:projectId/visit", ({ req, params }) => dispatch(req, "owner.visit", { projectId: params.projectId === "company" ? "__company__" : params.projectId }));
  get("/api/owner/explain", ({ query }) => {
    if (query.kind === "blocked") return cockpit.whyBlocked({ projectId: query.projectId || null, missionId: query.missionId || null });
    if (query.kind === "route") return cockpit.whyRoute({ worker: query.worker === "codex" ? "codex" : "claude", missionId: query.missionId || null });
    if (query.kind === "estimate") return cockpit.estimate({ stage: String(query.stage || "coding"), provider: query.provider === "claude" ? "claude" : "codex" });
    return cockpit.status({ projectId: query.projectId || null, worker: query.worker || null });
  });
  get("/api/missions/:id/replay", ({ params }) => { const r = cockpit.replay(params.id); if (!r) throw new HubError("not_found", "Misiunea nu e o misiune Software Factory"); return r; });
  get("/api/company/map", () => cockpit.companyMap());

  // ---------- natural language, envelopes, autonomy, interruptions ----------
  post("/api/owner/intent", ({ req, body }) => dispatch(req, "owner.intent", { text: body.text || "", projectId: body.projectId || undefined, source: body.source || "typed", utteranceId: body.utteranceId || undefined, presented: body.presented || undefined, layout: body.layout || undefined }));
  get("/api/envelopes", ({ query }) => ({ envelopes: query.projectId ? envelopes.forProject(projects.get(query.projectId)?.id || query.projectId, 20).map((e) => envelopes.view(e.id)) : envelopes.pending().map((e) => envelopes.view(e.id)) }));
  get("/api/envelopes/:id", ({ params }) => { const v = envelopes.view(params.id); if (!v) throw new HubError("not_found", "Plan necunoscut"); return v; });
  post("/api/envelopes", ({ req, body }) => dispatch(req, "envelope.propose", { projectId: body.projectId, missionIds: body.missionIds || [], level: body.level || undefined, constraints: body.constraints || {} }));
  post("/api/envelopes/:id/confirm", ({ req, params, body }) => dispatch(req, "envelope.confirm", { envelopeId: params.id, nonce: body.nonce, displayedHash: body.displayedHash, modality: body.modality || "click", utteranceId: body.utteranceId || undefined }, { requireOwner: true }));
  post("/api/envelopes/:id/delta", ({ req, params, body }) => dispatch(req, "envelope.confirm_delta", { envelopeId: params.id, missionId: body.missionId, modality: body.modality || "click" }, { requireOwner: true }));
  post("/api/envelopes/:id/revoke", ({ req, params, body }) => dispatch(req, "envelope.revoke", { envelopeId: params.id, reason: body.reason || "Revocat de proprietar" }));
  post("/api/owner/autonomy", ({ req, body }) => dispatch(req, "owner.autonomy.set", { projectId: body.projectId, level: body.level }));
  post("/api/owner/interrupt", ({ req, body }) => dispatch(req, "owner.interrupt", { kind: body.kind, projectId: body.projectId || undefined, provider: body.provider || undefined, reason: body.reason || "" }));
  post("/api/owner/unfreeze", ({ req, body }) => dispatch(req, "owner.unfreeze", { projectId: body.projectId }));
  get("/api/owner/attention", ({ query }) => advisor.attention({ afterSeq: Number(query.after) || 0 }));
  post("/api/owner/prefs", ({ req, body }) => dispatch(req, "owner.prefs", body || {}));
  get("/api/owner/recommendations", () => advisor.recommendations());
  get("/api/missions/:id/shadow", ({ params }) => ({ shadows: advisor.shadowsOf(params.id) }));
  post("/api/missions/:id/shadow", ({ req, params, body }) => dispatch(req, "shadow.review", { missionId: params.id, provider: body.provider || "claude", model: body.model || "" }));

  // ---------- contextual layout (validation only; no state) ----------
  get("/api/layout/catalog", () => ({ cards: Object.entries(CARD_TYPES).map(([type, def]) => ({ type, refs: def.refs, label: def.label })) }));
  post("/api/layout/validate", ({ body }) => {
    const projectId = projects.get(body.projectId)?.id;
    if (!projectId) throw new HubError("not_found", "Proiect necunoscut");
    const exists = (kind, id) => {
      if (kind === "project") return id === projectId;
      if (kind === "mission") return missions.get(id)?.projectId === projectId;
      if (kind === "envelope") return envelopes.get(id)?.projectId === projectId;
      if (kind === "department") return Boolean(hub.company.department(id));
      return false;
    };
    return validateLayout(body.layout, { projectId, exists });
  });

  // ---------- local voice (M07): raw PCM segments, decided and transcribed on this computer ----------
  // The audio goes only to these session-bound routes (never into a command log); each segment leaves a voice_utterances row
  // (hash, decision, the owner's own transcript) instead. Without the owner session nothing is analysed.
  const ownerOnly = (req) => { const s = sessionOf(req); if (!s) throw new HubError("authentication", "Vocea se verifică doar în sesiunea ta de proprietar (Windows Hello / cheia ta)", { data: { needSession: true } }); return s; };
  const voiceFlags = (req) => { try { const v = JSON.parse(String(req.headers["x-voice-flags"] || "{}").slice(0, 1000)); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const SEGMENT_BYTES = 600 * 1024; // 15 s of 16 kHz PCM16 is 480 KB
  get("/api/voice", ({ req }) => voice.status(sessionOf(req, false)));
  post("/api/voice/utterances", ({ req, query, body }) => voice.analyzeUtterance({ session: ownerOnly(req), buffer: body, purpose: String(query.purpose || ""),
    legaSessionId: query.legaSession || null, envelopeId: query.envelope || null, flags: voiceFlags(req) }), { raw: true, maxBytes: SEGMENT_BYTES });
  get("/api/voice/utterances/:id", ({ req, params }) => voice.getUtterance({ id: params.id, session: ownerOnly(req) }));
  post("/api/voice/enroll/sample", ({ req, query, body }) => voice.enrollSample({ session: ownerOnly(req), buffer: body, phraseIndex: query.phrase }), { raw: true, maxBytes: SEGMENT_BYTES });
  post("/api/voice/enroll/finish", ({ req, body }) => dispatch(req, "voice.enroll.finish", { consentText: body.consentText }, { requireOwner: true }));
  post("/api/voice/enroll/reset", ({ req }) => dispatch(req, "voice.enroll.reset", {}, { requireOwner: true }));
  post("/api/voice/delete", ({ req, body }) => dispatch(req, "voice.delete", { reason: body.reason || "la cererea ta" }, { requireOwner: true }));
  post("/api/voice/gate", ({ req, body }) => dispatch(req, "voice.gate", { enabled: Boolean(body.enabled), strict: body.strict }, { requireOwner: true }));

  // ---------- setup orchestrator (M07) ----------
  // A pure read of the real state; the page passes the contract it was built with (?ui=).
  get("/api/setup", ({ req, query }) => hub.setup.steps({ origin: originOf(req), uiContract: query.ui ?? null, session: sessionOf(req, false) }));
  // Runs the automatic steps on the Hub: from the owner's page (recorded as the UI) or from an agent acting on a recorded
  // delegation (X-Hub-Channel: agent + X-Hub-Delegation; recorded as the agent, never as a click).
  post("/api/setup/run", ({ req }) => {
    const declared = String(req.headers["x-hub-channel"] || "").toLowerCase();
    // A script that declares itself (cli, or anything else but the owner's page or a delegated agent) is never recorded as the owner's click.
    if (declared && declared !== "agent" && declared !== "ui") throw new HubError("policy", `Pașii automați nu se pornesc de pe canalul ${declared.slice(0, 20)}`);
    const agent = declared === "agent";
    return hub.setup.runAutomatic(agent ? { channel: "agent", actor: "agent", delegation: decodeDelegation(req.headers["x-hub-delegation"]) } : { channel: "ui", actor: "user" });
  });

  // The factory list per project, for the cockpit's mission picker (read-only).
  get("/api/cockpit/:projectId/missions", ({ params }) => ({ missions: factory.list().filter((f) => f.projectId === (projects.get(params.projectId)?.id || params.projectId)) }));
}
