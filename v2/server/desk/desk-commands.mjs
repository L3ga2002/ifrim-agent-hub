import { HubError } from "../core/errors.mjs";
import { DESK_FLOWS } from "./desk.mjs";

/**
 * M13 „Birou intern” commands on the Hub's command bus. The owner's reserved decision (the internal approval of the exact support reply
 * or deviz: id + full sha) follows the M12 offer approval (sales/sales-commands.mjs): channels owner / test, ALWAYS_ASK, decided only in
 * the owner session (approval.owner_decide), executed in the deciding credential's session, re-read in the service's final transaction.
 * A checklist update needs a fresh owner session; cancel is accepted from every owner-facing channel (it only reduces activity); a
 * continuation only PROPOSES a card (its own confirmation).
 */
export function registerDeskCommands(register, hub) {
  const desk = () => { if (!hub.desk) throw new HubError("internal", "Biroul intern nu e disponibil"); return hub.desk; };
  const ownerCheck = (ctx, what, fresh = false) => {
    if (ctx.channel === "test" && hub.config.testMode) return null;
    if (ctx.channel !== "owner") throw new HubError("policy", "Decizia cere canalul proprietarului");
    return fresh ? hub.trust.requireFresh(ctx.ownerSession, what) : hub.trust.requireSession(ctx.ownerSession, what);
  };
  /** The executing-session check of a reserved decision (as sales-commands authorizeReserved): same credential, authority not revoked. */
  const authorizeReserved = (what) => (_input, ctx, approval) => {
    const session = ownerCheck(ctx, what, true);
    if (ctx.channel === "test" && hub.config.testMode) return;
    if (!approval || !["approved", "consumed"].includes(approval.status)) return;
    if (approval.decidedVia !== "owner_session" || approval.credentialId !== session.credentialId) throw new HubError("conflict", "Aprobarea aparține altei credențiale; cere din nou aprobarea", { code: "OWNER_CREDENTIAL_MISMATCH" });
    if (!hub.trust.confirmedAuthority(approval.sessionId).ok) throw new HubError("conflict", "Autoritatea aprobării a fost revocată; cere din nou aprobarea", { code: "OWNER_DECISION_REVOKED" });
    const revoked = hub.db.prepare(`SELECT 1 FROM events WHERE type='owner.sessions_revoked' AND seq >
      (SELECT MAX(seq) FROM events WHERE type='approval.approved' AND json_extract(payload_json, '$.approvalId')=?) LIMIT 1`).get(approval.id);
    if (revoked) throw new HubError("conflict", "Autoritatea aprobării a fost revocată; cere din nou aprobarea", { code: "OWNER_DECISION_REVOKED" });
  };
  const kindOf = (artifactId) => {
    const a = desk().artifact(artifactId);
    if (!a) throw new HubError("not_found", "Documentul nu există");
    const r = desk().need(a.recordId);
    return { a, r, flow: DESK_FLOWS[r.kind] };
  };
  const what = (flow) => (flow.artifact === "support_reply" ? "aprobarea internă a răspunsului de suport" : "aprobarea internă a devizului");

  register("desk.artifact.approve", { describe: "Aprobarea internă a documentului exact (răspunsul de suport sau devizul): legată de ID și SHA; nu trimite, nu emite, nu închide nimic",
    channels: ["owner", "test"], ownerDecision: true, logResult: (r) => r,
    schema: { artifactId: { required: true, max: 80, pattern: /^dar_[A-Za-z0-9_]+$/ }, displayedSha: { required: true, pattern: /^[0-9a-f]{64}$/, trim: false } },
    action: (input, ctx) => {
      const { flow } = kindOf(input.artifactId);
      ownerCheck(ctx, what(flow));
      return { actionKind: flow.decision, target: `${input.artifactId}@${String(input.displayedSha).slice(0, 12)}`, projectId: "*" };
    },
    authorizeApproved: (input, ctx, approval) => authorizeReserved(what(kindOf(input.artifactId).flow))(input, ctx, approval),
    execute: (input, ctx) => {
      const { flow } = kindOf(input.artifactId);
      return desk().approveArtifact(input.artifactId, input, ctx.actor, { channel: ctx.channel, approvalId: hub.commands.get(ctx.commandId)?.approvalId, sessionCheck: () => ownerCheck(ctx, what(flow)) });
    } });
  register("desk.ops.item", { describe: "Marchezi un material primit sau lipsă în dosarul de pornire (o versiune nouă; exportul vechi devine depășit)", channels: ["owner", "test"],
    schema: { recordId: { required: true, max: 80, pattern: /^dsk_[A-Za-z0-9_]+$/ }, itemId: { required: true, max: 20, pattern: /^M[0-9]{1,3}$/ }, status: { enum: ["RECEIVED", "MISSING"], required: true }, note: { max: 300, default: "" } },
    execute: (input, ctx) => {
      ownerCheck(ctx, "o actualizare a dosarului de pornire", true);
      return desk().updateItem(input.recordId, input, ctx.actor, { channel: ctx.channel, sessionCheck: () => ownerCheck(ctx, "o actualizare a dosarului de pornire") });
    } });
  register("desk.record.continue", { describe: "Propune un card nou care continuă o înregistrare oprită sau depășită (aceeași înregistrare; nimic nu pornește până confirmi)",
    async: true, channels: ["ui", "owner", "test"], logResult: (r) => ({ planId: r?.plan?.id || null, status: r?.plan?.status || null, recordId: r?.record?.id || null }),
    schema: { recordId: { required: true, max: 80, pattern: /^dsk_[A-Za-z0-9_]+$/ } },
    execute: (input, ctx) => desk().continueCard(input.recordId, { actor: ctx.actor, via: ctx.channel }) });
  register("desk.record.cancel", { describe: "Anulează o înregistrare a biroului intern (fail-safe; ce s-a făcut rămâne)", channels: ["ui", "owner", "voice", "companion", "test"],
    schema: { recordId: { required: true, max: 80, pattern: /^dsk_[A-Za-z0-9_]+$/ }, reason: { max: 200, default: "Anulată de tine" } },
    execute: (input, ctx) => desk().cancel(input.recordId, { reason: input.reason, actor: ctx.actor }) });
}

/** The read and write routes of the desk (GET only for the reads; the owner dispatcher for the owner's actions). */
export function registerDeskRoutes({ get, post, hub, owner }) {
  get("/api/desk/records", ({ query }) => ({ records: hub.desk.list({ kind: query.kind || null, limit: query.limit }) }));
  get("/api/desk/records/:id", ({ params }) => hub.desk.detail(params.id));
  get("/api/desk/register", () => ({ register: hub.desk.register(), note: "Registru intern: nu e un registru fiscal; nimic nu e emis, trimis sau încasat." }));
  post("/api/desk/artifacts/:id/approve", ({ req, params, body }) => owner.dispatch(req, "desk.artifact.approve", { artifactId: params.id, displayedSha: body?.displayedSha }, { requireOwner: true }));
  post("/api/desk/records/:id/items", ({ req, params, body }) => owner.dispatch(req, "desk.ops.item", { recordId: params.id, itemId: body?.itemId, status: body?.status, note: body?.note || "" }, { requireOwner: true }));
  post("/api/desk/records/:id/continue", ({ req, params }) => owner.dispatch(req, "desk.record.continue", { recordId: params.id }, { requireOwner: true }));
  post("/api/desk/records/:id/cancel", ({ req, params, body }) => owner.dispatch(req, "desk.record.cancel", { recordId: params.id, reason: body?.reason || "Anulată de tine" }));
}

/** The inbox rows: a desk record waiting for the owner's approval of exactly its current document (read only; the action is on #/lega). */
export function deskDecisions(hub) {
  if (!hub.desk?.pendingDecisions) return [];
  return hub.desk.pendingDecisions().map((d) => ({ kind: d.kind === "support_case" ? "desk_support_reply" : "desk_finance_doc", id: d.artifactId, recordId: d.recordId, projectId: null,
    projectName: d.kind === "support_case" ? "Suport (date sintetice)" : "Finance-Admin (date sintetice)", real: false, synthetic: true, title: `${d.internalNo}: ${d.title}`.slice(0, 200), waitingSince: null,
    target: { artifactId: d.artifactId, version: d.version, sha: d.sha },
    what: d.kind === "support_case" ? `Răspunsul în ciornă la cazul ${d.internalNo}, versiunea ${d.version}.` : `Devizul în ciornă ${d.internalNo}, versiunea ${d.version}.`,
    why: "Așteaptă aprobarea ta internă, pe ID-ul și SHA-ul afișate, în ecranul L3ga.",
    acceptLabel: "Dacă îl aprobi:", rejectLabel: "Dacă nu îl aprobi:",
    ifAccept: d.kind === "support_case" ? "Textul devine aprobat intern (DRAFT_ONLY — NETRIMIS) și exportul cazului se face local; cazul rămâne deschis." : "Devizul devine aprobat intern și se scrie în Word și PDF, local; nu e emis fiscal și nu se trimite.",
    ifReject: "Nimic nu pornește; documentul rămâne ciornă.", effects: ["date sintetice", "un export local nou", "nimic trimis, publicat sau cheltuit"], link: "/lega" }));
}
