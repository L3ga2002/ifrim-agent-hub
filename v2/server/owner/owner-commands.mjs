import { HubError } from "../core/errors.mjs";
import { AUTONOMY_LEVELS } from "./envelopes.mjs";
import { newId } from "../core/ids.mjs";
import { ATTESTATION_TEXT } from "../policy/billing.mjs";
import { buildDeclaration, applyDeclaration, applyLatch, evidenceOf, DECLARE_PROBE_MAX_AGE_H } from "../policy/billing-evidence.mjs";
import { createIntake } from "./intake.mjs";
import { registerEngineeringPlanner } from "./planners/engineering.mjs";
import { normalizeLimits, ROLE_DEFAULT_BINDINGS } from "../factory/plan.mjs";

/**
 * M06 commands. Channels: "owner" = the authenticated owner session (WebAuthn, resolved by the HTTP layer from the cookie);
 * "ui" = the Hub UI without that session (the legacy trust level); "voice" = Lega/the voice route (proposals and fail-safe
 * actions only); "test" = tests. Anything that adds authority (confirming a plan, raising autonomy, activating the policy,
 * enrolling a voice profile) needs "owner"; anything that only reduces activity is accepted from every owner-facing channel.
 */
const OWNER = ["owner", "test"];
const ANY_OWNER_FACING = ["ui", "owner", "voice", "companion", "test"];
const PRE_SESSION = ["ui", "owner", "test"];

export function registerOwnerCommands(reg, hub) {
  const { trust, envelopes, cockpit, interrupts, advisor, voice, projects, bus } = hub;
  const session = (ctx) => (ctx.channel === "owner" ? ctx.ownerSession : ctx.channel === "test" ? ctx.ownerSession || null : null);
  // No action classifier, like owner.visit: presentation never requests an approval.
  reg("recap.present", { describe: "Prezintă un capitol păstrat în sesiunea vocală curentă", async: true, channels: PRE_SESSION,
    schema: { snapshotId: { required: true, max: 80 }, index: { type: "integer", required: true, min: 0, max: 5 }, legaSessionId: { max: 80 }, action: { enum: ["show", "stop"], default: "show" } },
    execute: (input, ctx) => hub.lega.presentRecap({ sessionId: input.legaSessionId, snapshotId: input.snapshotId, index: input.index, action: input.action, ownerSession: session(ctx) }) });

  // ---------- trusted session ----------
  reg("owner.register.begin", { describe: "Începe înregistrarea autentificatorului (WebAuthn: Windows Hello / PIN / cheie)", channels: PRE_SESSION,
    schema: { origin: { required: true, max: 120 }, setupText: { max: 400, default: "" } },
    execute: (input, ctx) => trust.beginRegistration({ origin: input.origin, setupText: input.setupText, session: session(ctx) }) });
  reg("owner.register.finish", { describe: "Verifică răspunsul autentificatorului și îl înregistrează (doar cheia publică)", channels: PRE_SESSION,
    schema: { origin: { required: true, max: 120 }, challengeId: { required: true, max: 80 }, credential: { type: "object", required: true }, label: { max: 60, default: "" } },
    logPayload: (i) => ({ origin: i.origin, challengeId: i.challengeId, credentialId: String(i.credential?.id || "").slice(0, 10), label: i.label }),
    execute: (input, ctx) => trust.finishRegistration({ origin: input.origin, challengeId: input.challengeId, credential: input.credential, label: input.label, actor: ctx.actor }) });
  reg("owner.auth.begin", { describe: "Provocare pentru deblocarea sesiunii de proprietar", channels: PRE_SESSION,
    schema: { origin: { required: true, max: 120 }, purpose: { max: 40, default: "unlock" } },
    execute: (input) => trust.beginAuthentication({ origin: input.origin, purpose: input.purpose }) });
  reg("owner.auth.finish", { describe: "Verifică aserțiunea și deschide (sau reîmprospătează) sesiunea de proprietar", channels: PRE_SESSION,
    schema: { origin: { required: true, max: 120 }, challengeId: { required: true, max: 80 }, credential: { type: "object", required: true }, currentToken: { max: 200, default: "" }, userAgent: { max: 200, default: "" } },
    logPayload: (i) => ({ origin: i.origin, challengeId: i.challengeId, credentialId: String(i.credential?.id || "").slice(0, 10), renew: Boolean(i.currentToken) }),
    logResult: (r) => ({ sessionId: r?.sessionId, expiresAt: r?.expiresAt, renewed: r?.renewed }),
    execute: (input) => trust.finishAuthentication({ origin: input.origin, challengeId: input.challengeId, credential: input.credential, currentToken: input.currentToken || null, userAgent: input.userAgent }) });
  reg("owner.dev_session.open", { describe: "Deschide sesiunea de proprietar din profilul de dezvoltare locală al instanței (fără Windows Hello; userVerified fals, auditat)", channels: PRE_SESSION,
    schema: { origin: { required: true, max: 120 }, currentToken: { max: 200, default: "" }, userAgent: { max: 200, default: "" } },
    logPayload: (i) => ({ origin: i.origin, renew: Boolean(i.currentToken) }),
    logResult: (r) => ({ sessionId: r?.sessionId, expiresAt: r?.expiresAt, renewed: r?.renewed, authority: r?.authority }),
    execute: (input) => trust.openDevSession({ origin: input.origin, currentToken: input.currentToken || null, userAgent: input.userAgent }) });
  reg("owner.logout", { describe: "Închide sesiunea de proprietar", channels: OWNER, schema: {},
    execute: (input, ctx) => trust.endSession(session(ctx), "logout", ctx.actor) });
  reg("owner.sessions.revoke_all", { describe: "Închide toate sesiunile de proprietar (fail-safe)", channels: ANY_OWNER_FACING, schema: { reason: { max: 200, default: "revocare" } },
    execute: (input, ctx) => ({ ended: trust.revokeAllSessions(input.reason, ctx.actor) }) });
  reg("owner.credential.revoke", { describe: "Revocă un autentificator (cere reautentificare)", channels: OWNER, schema: { credentialId: { required: true, max: 200 } },
    execute: (input, ctx) => trust.revokeCredential(input.credentialId, session(ctx)) });
  reg("owner.policy.activate", { describe: "Activează politica voice-first (sesiune reautentificată + textul exact)", channels: OWNER, schema: { text: { required: true, max: 1000 } },
    execute: (input, ctx) => trust.activatePolicy({ session: session(ctx), text: input.text }) });
  reg("owner.policy.deactivate", { describe: "Revino la politica legacy (fail-safe, din orice canal al tău)", channels: ANY_OWNER_FACING, schema: { reason: { max: 200, default: "" } },
    execute: (input, ctx) => trust.deactivatePolicy(ctx.actor, input.reason) });

  // ---------- autonomy, envelopes ----------
  reg("owner.autonomy.set", { describe: "Nivelul de autonomie al unui proiect (ridicarea cere reautentificare; coborârea e fail-safe)", channels: ANY_OWNER_FACING,
    // Review #42: atLeast = „ridică la cel puțin” — never lowers a project already at or above the level (no revoke, no supersede).
    schema: { projectId: { required: true, max: 80 }, level: { enum: AUTONOMY_LEVELS, required: true }, atLeast: { type: "boolean" } },
    execute: (input, ctx) => envelopes.setAutonomy({ projectId: input.projectId, level: input.level, session: session(ctx), actor: ctx.actor, atLeast: input.atLeast === true }) });
  reg("envelope.propose", { describe: "Arată-mi înainte să faci: planul exact, fără execuție și fără granturi", async: true, channels: ANY_OWNER_FACING,
    schema: { projectId: { required: true, max: 80 }, missionIds: { type: "array", max: 5, items: "string" }, level: { enum: AUTONOMY_LEVELS }, constraints: { type: "object", default: {} }, deliveryId: { max: 80 } },
    execute: (input, ctx) => envelopes.propose({ projectId: input.projectId, missionIds: input.missionIds || [], level: input.level || null, constraints: input.constraints || {}, actor: ctx.actor, via: ctx.channel, deliveryId: input.deliveryId || null }) });
  reg("envelope.confirm", { describe: "Confirmarea ta unică a planului afișat (sesiune autentificată, politica voice-first)", async: true, channels: OWNER,
    schema: { envelopeId: { required: true, max: 80 }, nonce: { required: true, max: 64 }, displayedHash: { required: true, max: 64 }, modality: { enum: ["click", "keyboard", "typed", "voice"], default: "click" },
      utteranceId: { max: 80 } },
    execute: (input, ctx) => envelopes.confirm({ envelopeId: input.envelopeId, nonce: input.nonce, displayedHash: input.displayedHash, session: session(ctx), modality: input.modality, utteranceId: input.utteranceId || null, idempotencyKey: ctx.commandId }) });
  reg("envelope.confirm_delta", { describe: "Confirmi doar diferența (un ciclu de remediere în plus, în limita misiunii)", channels: OWNER,
    schema: { envelopeId: { required: true, max: 80 }, missionId: { required: true, max: 80 }, modality: { enum: ["click", "keyboard", "typed"], default: "click" } },
    execute: (input, ctx) => envelopes.confirmDelta({ envelopeId: input.envelopeId, missionId: input.missionId, session: session(ctx), modality: input.modality }) });
  reg("envelope.revoke", { describe: "Retrage autoritatea unui plan (fail-safe: granturile derivate sunt revocate)", channels: ANY_OWNER_FACING,
    schema: { envelopeId: { required: true, max: 80 }, reason: { max: 200, default: "Revocat de proprietar" } },
    execute: (input, ctx) => envelopes.revoke(input.envelopeId, { actor: ctx.actor, reason: input.reason }) });

  // ---------- interruptions ----------
  reg("owner.interrupt", { describe: "Taci / Pauză / Oprește un agent / Îngheață / Preiau eu (Stop All rămâne system.stop_all)", async: true, channels: ANY_OWNER_FACING,
    schema: { kind: { enum: ["mute", "pause", "stop_worker", "freeze", "takeover"], required: true }, projectId: { max: 80 }, provider: { enum: ["codex", "claude", "any"] }, reason: { max: 200, default: "" } },
    execute: async (input, ctx) => {
      if (input.kind === "mute") return interrupts.mute({ actor: ctx.actor });
      // M10.2 (U11): the owner session that paused is recorded with the suspension („Continuă” in the same credential reopens it).
      if (input.kind === "pause") return interrupts.pause({ projectId: input.projectId || null, actor: ctx.actor, reason: input.reason || "Pauză", session: session(ctx), channel: ctx.channel });
      if (input.kind === "stop_worker") return interrupts.stopWorker({ provider: input.provider || "any", actor: ctx.actor });
      if (!input.projectId) throw new HubError("validation", "Spune proiectul");
      if (input.kind === "freeze") return interrupts.freeze({ projectId: input.projectId, actor: ctx.actor });
      return interrupts.takeover({ projectId: input.projectId, actor: ctx.actor });
    } });
  // ---------- contextual gate rearm (M10.2.1, D14–D16) ----------
  /**
   * Reopening the execution gate after Stop All (or any suspension that is not the owner's own pause) is the owner's decision in the
   * cockpit: the card names the exact suspension (who, when, what stopped, what stays stopped, security events) and the rearm needs a
   * FRESH Windows Hello in the owner session, bound to that card (nonce + hash, compare-and-set on the suspension). Owner channel only
   * (never voice, companion, ui, agent or cli — not in AGENT_COMMANDS); modality click / keyboard / typed only; no timer. The service
   * is hub.gateRearm (owner/gate-rearm.mjs), wired after the preserved requests exist; read at execution time.
   */
  const rearmService = () => { if (!hub.gateRearm) throw new HubError("internal", "Redeschiderea porții nu e disponibilă pe acest Hub"); return hub.gateRearm; };
  reg("gate.rearm.card", { describe: "Cardul de redeschidere a porții: ce a oprit-o, ce rămâne oprit (sesiunea ta; nu schimbă nimic)", channels: OWNER,
    schema: { requestId: { max: 80 } },
    logResult: (r) => ({ kind: r?.kind || null, eligible: r?.eligible !== false, code: r?.code || null, cls: r?.cls || null, hash: r?.hash ? String(r.hash).slice(0, 16) : null, expiresAt: r?.expiresAt || null }),
    execute: (input, ctx) => rearmService().cardFor({ ownerSession: session(ctx), requestId: input.requestId || null }) });
  reg("gate.rearm", { describe: "Redeschizi poarta după Stop All / o suspendare (sesiunea ta, Windows Hello proaspăt, legată de cardul afișat; nimic vechi nu repornește)", async: true, channels: OWNER,
    // 2.12.2 (P0-R1): ackLeases — the owner's acknowledgement for a reserved workspace whose outcome the card says it cannot prove.
    schema: { nonce: { required: true, max: 64 }, hash: { required: true, max: 64 }, requestId: { max: 80 }, ackSecurity: { type: "boolean", default: false }, ackLeases: { type: "boolean", default: false },
      modality: { max: 20, default: "click" } },
    logPayload: (i) => ({ hash: String(i.hash || "").slice(0, 16), requestId: i.requestId || null, ackSecurity: i.ackSecurity === true, ackLeases: i.ackLeases === true, modality: i.modality }),
    execute: (input, ctx) => rearmService().apply({ ownerSession: session(ctx), nonce: input.nonce, hash: input.hash, requestId: input.requestId || null, ackSecurity: input.ackSecurity === true,
      ackLeases: input.ackLeases === true, modality: input.modality }) });

  // Unfreezing allows work again: not from the voice route.
  reg("owner.unfreeze", { describe: "Dezgheață un proiect (misiunile rămân pe pauză până le reiei)", channels: ["ui", "owner", "test"], schema: { projectId: { required: true, max: 80 } },
    execute: (input, ctx) => interrupts.unfreeze({ projectId: input.projectId, actor: ctx.actor }) });
  reg("owner.prefs", { describe: "Preferințele de întrerupere (doar decizii, ore de liniște, notificări vocale)", channels: ANY_OWNER_FACING,
    schema: { onlyDecisions: { type: "boolean" }, voiceNotifications: { type: "boolean" }, quietHours: { type: "any", max: 200 } },
    execute: (input, ctx) => advisor.setPrefs(input, ctx.actor) });
  reg("owner.visit", { describe: "Marchează vizita în cockpit (pentru „ce s-a schimbat de la ultima vizită”)", channels: ANY_OWNER_FACING, schema: { projectId: { required: true, max: 80 } },
    execute: (input) => cockpit.markVisit(input.projectId === "__company__" ? "__company__" : (projects.get(input.projectId)?.id || input.projectId)) });

  // ---------- voice profile ----------
  // M07: the samples themselves go to the raw-audio route (never into a command log); finishing builds the profile from the
  // samples the Hub accepted in this session.
  reg("voice.enroll.finish", { describe: "Finalizează profilul vocal din mostrele acceptate în sesiunea ta (acordul exact)", channels: OWNER,
    schema: { consentText: { required: true, max: 800 } }, logPayload: () => ({ consent: true }), logResult: (r) => ({ profileId: r?.profile?.id, version: r?.profile?.version, samples: r?.calibration?.samples }),
    execute: (input, ctx) => voice.enrollFinish({ consentText: input.consentText, session: session(ctx) }) });
  reg("voice.enroll.reset", { describe: "Renunță la mostrele începute (nimic nu e salvat)", channels: OWNER, schema: {},
    execute: (input, ctx) => voice.enrollReset({ session: session(ctx) }) });
  reg("voice.delete", { describe: "Șterge profilul vocal (și fișierul lui)", channels: OWNER, schema: { reason: { max: 120, default: "la cererea ta" } },
    execute: (input, ctx) => voice.remove({ session: session(ctx), reason: input.reason }) });
  reg("voice.gate", { describe: "Pornește/oprește filtrul vocal local (modul strict reține propoziția până la verificare)", channels: OWNER,
    schema: { enabled: { type: "boolean", required: true }, strict: { type: "boolean" } },
    execute: (input, ctx) => voice.setGate({ enabled: input.enabled, session: session(ctx) }) });

  // ---------- shadow ----------
  reg("shadow.review", { describe: "Shadow Mode: un al doilea review, doar citire, pe același change set (fără efect asupra misiunii; cere un grant)", async: true, channels: ["ui", "owner", "test"],
    schema: { missionId: { required: true, max: 80 }, provider: { enum: ["claude", "codex"], default: "claude" }, model: { max: 80, default: "" } },
    execute: (input, ctx) => advisor.requestShadowReview({ missionId: input.missionId, provider: input.provider, model: input.model, actor: ctx.actor }) });

  // ---------- billing evidence (M09-A2) ----------
  /**
   * The owner's declaration that the provider-side overage setting is off (Claude usage credits / Codex automatic reload). It
   * adds authority, so: the owner session, re-authenticated; the exact text; and the account the page showed must be the
   * account a probe younger than 24 h verified on that route (a stale page or a switched account is refused, never adopted).
   */
  reg("billing.declare", { describe: "Declarația ta de facturare (setarea peste plan oprită), în sesiunea de proprietar, legată de contul verificat", channels: OWNER,
    schema: { provider: { enum: ["codex", "claude"], required: true }, confirmText: { required: true, max: 400 }, displayedIdentity: { required: true, max: 64 }, route: { enum: ["windows", "wsl-runner"], default: "windows" } },
    execute: (input, ctx) => {
      const s = trust.requireFresh(session(ctx), "declarația de facturare");
      if (input.confirmText !== ATTESTATION_TEXT[input.provider]) throw new HubError("validation", "Textul declarației nu corespunde exact textului afișat");
      const now = hub.config.now();
      const key = input.route === "windows" ? input.provider : `${input.provider}@${input.route}`;
      const state = hub.providerState.get(key);
      const probedMs = state?.probedAt ? Date.parse(state.probedAt) : NaN;
      if (!state || state.ok === false || !state.auth || !Number.isFinite(probedMs) || probedMs > now.getTime() || now.getTime() - probedMs > DECLARE_PROBE_MAX_AGE_H * 3600000) {
        throw new HubError("conflict", `Verifică întâi contul ${input.provider === "claude" ? "Claude" : "Codex"}${input.route !== "windows" ? ` din ${input.route}` : ""} („Verifică contul”): declarația se leagă de o verificare mai nouă de ${DECLARE_PROBE_MAX_AGE_H} h`);
      }
      const identity = state.auth.accountIdentity || null;
      if (!identity?.value) throw new HubError("conflict", "Contul verificat nu are o identitate derivabilă; rulează din nou „Verifică contul” (Hub-ul nu înregistrează o declarație nelegată de cont)");
      if (String(input.displayedIdentity) !== identity.value) throw new HubError("conflict", "Contul afișat pe pagină nu mai este contul verificat acum; reîncarcă Integrările și citește din nou contul înainte să declari");
      const declaration = buildDeclaration({ id: newId("bde"), provider: input.provider, text: ATTESTATION_TEXT[input.provider], identity, now, route: input.route,
        source: ctx.channel === "owner" ? "owner_session:webauthn" : "test:owner_session",
        recordedBy: { channel: ctx.channel, actor: ctx.actor, sessionId: s.id, credentialId10: s.credentialId ? String(s.credentialId).slice(0, 10) : null } });
      const before = evidenceOf(hub.settings.get("billingEvidence"), input.provider);
      hub.settings.set("billingEvidence", applyDeclaration(hub.settings.get("billingEvidence"), input.provider, declaration), ctx.actor, `Billing declaration recorded for ${input.provider} in the owner session`);
      bus.append({ type: "billing.declared", scopeType: "provider", scopeId: input.provider, source: ctx.actor,
        payload: { provider: input.provider, route: input.route, identity: identity.value.slice(0, 8), basis: identity.basis, expiresAt: declaration.expiresAt, sessionId: s.id,
          cleared: before.reverify?.required ? before.reverify.reasons || [] : [] } });
      return { provider: input.provider, declaration: { id: declaration.id, source: declaration.source, recordedAt: declaration.recordedAt, expiresAt: declaration.expiresAt, identity: identity.value.slice(0, 8), basis: identity.basis } };
    } });
  // Fail-safe: withdrawing only removes authority (Claude/Codex inference waits for a new declaration); accepted from every
  // owner-facing channel, with or without a declaration; by default it also stops that provider's running work.
  reg("billing.withdraw", { describe: "Retrage declarația de facturare (fail-safe: providerul se blochează până la o declarație nouă)", async: true, channels: ANY_OWNER_FACING,
    schema: { provider: { enum: ["codex", "claude"], required: true }, reason: { max: 200, default: "" }, stopRunning: { type: "boolean", default: true } },
    execute: async (input, ctx) => {
      const now = hub.config.now();
      bus.transaction(() => {
        hub.settings.set("billingEvidence", applyLatch(hub.settings.get("billingEvidence"), input.provider, { reason: "owner_withdrawn", now, by: ctx.actor }), ctx.actor, `Billing declaration withdrawn for ${input.provider}`);
        bus.append({ type: "billing.withdrawn", scopeType: "provider", scopeId: input.provider, source: ctx.actor, payload: { provider: input.provider, channel: ctx.channel, reason: String(input.reason || "").slice(0, 200) } });
        bus.append({ type: "billing.reverify_required", scopeType: "provider", scopeId: input.provider, source: ctx.actor, payload: { provider: input.provider, reason: "owner_withdrawn" } });
      });
      const stopped = input.stopRunning && interrupts ? await interrupts.stopWorker({ provider: input.provider, actor: ctx.actor }).catch((error) => ({ summary: `Oprirea execuțiilor a eșuat: ${error.message}` })) : null;
      return { provider: input.provider, withdrawn: true, blockedUntil: "o declarație nouă în sesiunea de proprietar", stopped: stopped ? { summary: stopped.summary } : null };
    } });

  // ---------- natural language (M10.2: one command path) ----------
  /**
   * One sentence → steps. The executor lives in owner/intake.mjs, shared by typed text, locally verified voice, provider transcripts
   * (the browser forwarder; the server voice bridge) and clarification buttons: read/navigate steps return what to show; "plan"
   * prepares a preview (no execution); interruptions run (they only reduce activity); a confirmation runs ONLY from the owner
   * channel, typed or locally verified, for the plan the cockpit says it presented. Voice transcripts from the provider never confirm.
   */
  const intake = createIntake(hub);
  // Late-bound clients (the Lega voice bridge, the planners of U09/U10/U11, the preserved requests of U06) reach the same executor.
  hub.intake = intake;
  // M10.2 (U09): engineering requests → ONE factory draft + ONE envelope (no lega.mission_request card; models explicit and hashed).
  hub.engineeringPlanner = registerEngineeringPlanner(hub, intake);

  /**
   * M10.2 owner decision 4: the optional per-project override of the engineering role defaults (writer Codex, reviewer Claude).
   * Changing which models write and review a project's code is the owner's decision: the owner session, freshly re-authenticated
   * (Windows Hello), both roles explicit (model AND effort — the account default is never a binding), validated like any limits
   * (Fable, [1m], "best", unknown efforts refused). `clear` returns to the role defaults. A plan already shown keeps the models
   * it showed: a new draft or a new plan takes the new ones, and a confirmed plan is never changed underneath.
   */
  reg("factory.defaults.set", { describe: "Modelele implicite ale unui proiect pentru planurile de engineering (sesiunea ta, Windows Hello; afișate și legate în fiecare plan)", channels: OWNER,
    schema: { projectId: { required: true, max: 80 }, writerModel: { max: 64, default: "" }, writerEffort: { max: 20, default: "" }, reviewerModel: { max: 64, default: "" }, reviewerEffort: { max: 20, default: "" },
      clear: { type: "boolean", default: false } },
    execute: (input, ctx) => {
      const s = trust.requireFresh(session(ctx), "modelele implicite ale proiectului");
      const project = projects.get(input.projectId);
      if (!project) throw new HubError("not_found", "Proiect necunoscut");
      const all = { ...(hub.settings.get("factoryDefaultBindings") || {}) };
      if (input.clear) {
        if (!all[project.id]) return { projectId: project.id, source: "role_default", bindings: ROLE_DEFAULT_BINDINGS, changed: false };
        delete all[project.id];
        bus.transaction(() => {
          hub.settings.set("factoryDefaultBindings", all, ctx.actor, `Engineering model defaults cleared for ${project.name}`);
          bus.append({ type: "factory.defaults_set", scopeType: "project", scopeId: project.id, projectId: project.id, source: ctx.actor, payload: { cleared: true, sessionId: s.id } });
        });
        return { projectId: project.id, source: "role_default", bindings: ROLE_DEFAULT_BINDINGS, changed: true };
      }
      const missing = ["writerModel", "writerEffort", "reviewerModel", "reviewerEffort"].filter((k) => !String(input[k] || "").trim());
      if (missing.length) throw new HubError("validation", `Ambele roluri au model și efort explicite (lipsește: ${missing.join(", ")}); implicitul contului nu e o alegere`);
      const checked = normalizeLimits({ writerModel: input.writerModel, writerEffort: input.writerEffort, reviewerModel: input.reviewerModel, reviewerEffort: input.reviewerEffort });
      const value = { writer: { model: checked.writerModel, effort: checked.writerEffort }, reviewer: { model: checked.reviewerModel, effort: checked.reviewerEffort },
        setAt: hub.config.now().toISOString(), setBy: `session:${s.id}` };
      all[project.id] = value;
      bus.transaction(() => {
        hub.settings.set("factoryDefaultBindings", all, ctx.actor, `Engineering model defaults set for ${project.name}`);
        bus.append({ type: "factory.defaults_set", scopeType: "project", scopeId: project.id, projectId: project.id, source: ctx.actor,
          payload: { writer: `${value.writer.model} · ${value.writer.effort}`, reviewer: `${value.reviewer.model} · ${value.reviewer.effort}`, sessionId: s.id } });
      });
      return { projectId: project.id, source: "owner", bindings: { writer: value.writer, reviewer: value.reviewer }, changed: true };
    } });

  reg("owner.intent", { describe: "Limbaj natural → pași (citire, navigare, plan, întreruperi; confirmarea doar în sesiunea ta)", async: true, channels: ANY_OWNER_FACING,
    // M07: "voice-local" is never a client's claim: a spoken sentence arrives as an utteranceId, and the text and its source are
    // read from the server-held row (local speaker check + local transcript, this session only). M10.2: `choice` answers an open
    // clarification by the id the Hub itself offered (a choice for a confirmation only presents that plan); `transcriptId` makes
    // a voice transcript execute at most once. The last target is server-held: no field of this schema can supply it.
    schema: { text: { max: 2000, default: "" }, projectId: { max: 80 }, source: { enum: ["typed", "voice-provider"], default: "typed" }, utteranceId: { max: 80 },
        presented: { type: "object" }, layout: { type: "object" }, legaSessionId: { max: 80 }, choice: { type: "object" }, transcriptId: { max: 80 }, recap: { type: "object" } },
    // 2.12.1 (D14): the rearm card's nonce goes to the owner's page only, never into the command log (as for gate.rearm.card).
    logResult: (r) => withoutRearmNonces(r),
    execute: (input, ctx) => intake.handle(input, ctx) });
}

/** A copy of an intake result with every gateRearm card's nonce removed (bounded walk; everything else is kept as returned). */
function withoutRearmNonces(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => withoutRearmNonces(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = k === "gateRearm" && v && typeof v === "object" && !Array.isArray(v) ? { ...v, nonce: v.nonce ? "[omis]" : v.nonce } : withoutRearmNonces(v, depth + 1);
  }
  return out;
}
