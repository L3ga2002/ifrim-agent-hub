import { HubError } from "../core/errors.mjs";
import { resolveIntent } from "./intents.mjs";
import { AUTONOMY_LEVELS } from "./envelopes.mjs";
import { layoutForIntent } from "./layout.mjs";

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
  const { trust, envelopes, cockpit, interrupts, advisor, voice, projects, missions, factory, company, bus } = hub;
  const session = (ctx) => (ctx.channel === "owner" ? ctx.ownerSession : ctx.channel === "test" ? ctx.ownerSession || null : null);

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
    schema: { projectId: { required: true, max: 80 }, level: { enum: AUTONOMY_LEVELS, required: true } },
    execute: (input, ctx) => envelopes.setAutonomy({ projectId: input.projectId, level: input.level, session: session(ctx), actor: ctx.actor }) });
  reg("envelope.propose", { describe: "Arată-mi înainte să faci: planul exact, fără execuție și fără granturi", async: true, channels: ANY_OWNER_FACING,
    schema: { projectId: { required: true, max: 80 }, missionIds: { type: "array", max: 5, items: "string" }, level: { enum: AUTONOMY_LEVELS }, constraints: { type: "object", default: {} } },
    execute: (input, ctx) => envelopes.propose({ projectId: input.projectId, missionIds: input.missionIds || [], level: input.level || null, constraints: input.constraints || {}, actor: ctx.actor, via: ctx.channel }) });
  reg("envelope.confirm", { describe: "Confirmarea ta unică a planului afișat (sesiune autentificată, politica voice-first)", async: true, channels: OWNER,
    schema: { envelopeId: { required: true, max: 80 }, nonce: { required: true, max: 64 }, displayedHash: { required: true, max: 64 }, modality: { enum: ["click", "keyboard", "typed", "voice"], default: "click" },
      voice: { type: "object" } },
    execute: (input, ctx) => envelopes.confirm({ envelopeId: input.envelopeId, nonce: input.nonce, displayedHash: input.displayedHash, session: session(ctx), modality: input.modality, voice: input.voice || null, idempotencyKey: ctx.commandId }) });
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
      if (input.kind === "pause") return interrupts.pause({ projectId: input.projectId || null, actor: ctx.actor, reason: input.reason || "Pauză" });
      if (input.kind === "stop_worker") return interrupts.stopWorker({ provider: input.provider || "any", actor: ctx.actor });
      if (!input.projectId) throw new HubError("validation", "Spune proiectul");
      if (input.kind === "freeze") return interrupts.freeze({ projectId: input.projectId, actor: ctx.actor });
      return interrupts.takeover({ projectId: input.projectId, actor: ctx.actor });
    } });
  // Unfreezing allows work again: not from the voice route.
  reg("owner.unfreeze", { describe: "Dezgheață un proiect (misiunile rămân pe pauză până le reiei)", channels: ["ui", "owner", "test"], schema: { projectId: { required: true, max: 80 } },
    execute: (input, ctx) => interrupts.unfreeze({ projectId: input.projectId, actor: ctx.actor }) });
  reg("owner.prefs", { describe: "Preferințele de întrerupere (doar decizii, ore de liniște, notificări vocale)", channels: ANY_OWNER_FACING,
    schema: { onlyDecisions: { type: "boolean" }, voiceNotifications: { type: "boolean" }, quietHours: { type: "any", max: 200 } },
    execute: (input, ctx) => advisor.setPrefs(input, ctx.actor) });
  reg("owner.visit", { describe: "Marchează vizita în cockpit (pentru „ce s-a schimbat de la ultima vizită”)", channels: ANY_OWNER_FACING, schema: { projectId: { required: true, max: 80 } },
    execute: (input) => cockpit.markVisit(input.projectId === "__company__" ? "__company__" : (projects.get(input.projectId)?.id || input.projectId)) });

  // ---------- voice profile ----------
  reg("voice.enroll", { describe: "Înscrierea locală a profilului vocal (doar caracteristici, fără audio)", channels: OWNER,
    schema: { samples: { type: "array", required: true, max: 12 }, consentText: { required: true, max: 600 } },
    logPayload: (i) => ({ samples: Array.isArray(i.samples) ? i.samples.length : 0 }), logResult: (r) => ({ profileId: r?.profile?.id, version: r?.profile?.version }),
    execute: (input, ctx) => voice.enroll({ samples: input.samples, consentText: input.consentText, session: session(ctx) }) });
  reg("voice.delete", { describe: "Șterge profilul vocal (și fișierul lui)", channels: OWNER, schema: { reason: { max: 120, default: "la cererea ta" } },
    execute: (input, ctx) => voice.remove({ session: session(ctx), reason: input.reason }) });
  reg("voice.gate", { describe: "Pornește/oprește filtrul vocal local (modul strict reține propoziția până la verificare)", channels: OWNER,
    schema: { enabled: { type: "boolean", required: true }, strict: { type: "boolean" } },
    execute: (input, ctx) => voice.setGate({ enabled: input.enabled, strict: input.strict, session: session(ctx) }) });

  // ---------- shadow ----------
  reg("shadow.review", { describe: "Shadow Mode: un al doilea review, doar citire, pe același change set (fără efect asupra misiunii; cere un grant)", async: true, channels: ["ui", "owner", "test"],
    schema: { missionId: { required: true, max: 80 }, provider: { enum: ["claude", "codex"], default: "claude" }, model: { max: 80, default: "" } },
    execute: (input, ctx) => advisor.requestShadowReview({ missionId: input.missionId, provider: input.provider, model: input.model, actor: ctx.actor }) });

  // ---------- natural language ----------
  /**
   * One sentence → steps. Read/navigate steps return what to show; "plan" prepares a preview (no execution); interruptions
   * run (they only reduce activity); a confirmation runs ONLY from the owner channel, typed, for the plan the cockpit says it
   * presented. Voice transcripts from the provider never confirm.
   */
  reg("owner.intent", { describe: "Limbaj natural → pași (citire, navigare, plan, întreruperi; confirmarea doar în sesiunea ta)", async: true, channels: ANY_OWNER_FACING,
    schema: { text: { required: true, max: 2000 }, projectId: { max: 80 }, source: { enum: ["typed", "voice-local", "voice-provider"], default: "typed" },
      presented: { type: "object" }, layout: { type: "object" } },
    execute: async (input, ctx) => {
      const projectList = projects.list().map((p) => ({ id: p.id, name: p.name, slug: p.slug }));
      const current = input.projectId ? projects.get(input.projectId) : null;
      const presented = input.presented && typeof input.presented === "object" ? input.presented : null;
      const pendingForProject = envelopes.pending().filter((e) => !current || e.projectId === current.id);
      // A confirmation is valid only for the plan the cockpit reports it showed (id + nonce + hash); voice-provider never.
      const awaiting = presented?.envelopeId && pendingForProject.some((e) => e.id === presented.envelopeId) ? "envelope_confirmation" : null;
      const source = ctx.channel === "voice" ? "voice-provider" : input.source;
      const resolved = resolveIntent(input.text, { projects: projectList, currentProjectId: current?.id || null, missions: missions.list(current?.id || null).map((m) => ({ id: m.id, projectId: m.projectId, title: m.title })),
        departments: company.departments().map((d) => ({ key: d.key, name: d.name })), pendingEnvelopes: awaiting ? pendingForProject.filter((e) => e.id === presented.envelopeId).map((e) => ({ id: e.id, title: e.summary.headline })) : pendingForProject.map((e) => ({ id: e.id, title: e.summary.headline })),
        awaiting, source });
      bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor, payload: { channel: ctx.channel, source, steps: resolved.steps.map((s) => s.intent), clarification: Boolean(resolved.clarification), refused: resolved.refused.length } });
      const results = [];
      let projectId = current?.id || null;
      let layout = input.layout || null;
      for (const step of resolved.steps) {
        const r = { intent: step.intent, effect: step.effect, constraints: step.constraints, args: step.args };
        // Words transcribed by the provider (or arriving on the voice route) may open, show, plan and stop; they never add
        // authority (confirm, raise autonomy, unfreeze), even when the HTTP request carries the owner's session cookie.
        if (source === "voice-provider" && step.effect === "effect") {
          r.refused = "Din vocea transcrisă de provider nu schimb autoritatea; confirmă sau schimbă în cockpit (tastă, buton, Windows Hello)";
          results.push(r);
          continue;
        }
        try {
          if (step.intent === "open_project" || step.intent === "switch_project") {
            if (step.args.projectId) { projectId = step.args.projectId; r.cockpit = await cockpit.projectCockpit(projectId); r.navigate = `/cockpit/${projectId}`; }
            else r.message = step.args.unknownRef ? `Nu găsesc proiectul „${step.args.unknownRef}”.` : "Spune-mi proiectul.";
          } else if (["show_plan", "continue_work"].includes(step.intent)) {
            if (!projectId) { r.message = "Pe ce proiect?"; }
            else {
              const proposal = await envelopes.propose({ projectId, missionIds: step.args.missionId ? [step.args.missionId] : [], constraints: step.constraints, actor: ctx.actor, via: ctx.channel })
                .catch((error) => ({ error: error.message }));
              r.plan = proposal; r.note = "Plan afișat; nimic nu a pornit și niciun grant nu a fost creat.";
              if (proposal.envelope?.id) step.args.envelopeId = proposal.envelope.id;
              if (step.args.previewOnly || step.constraints.noStart) r.note = "Doar planul, cum ai cerut; nu pornesc nimic.";
              if (step.args.untilReady) r.note += " „Până e gata” înseamnă până la livrarea gata de verificarea ta, în limitele planului — nu execuție nelimitată.";
            }
          } else if (step.intent === "confirm") {
            if (ctx.channel !== "owner" && ctx.channel !== "test") r.refused = "Confirmarea se face în sesiunea ta autentificată (cockpit, tastă sau buton)";
            else if (!presented || presented.envelopeId !== step.args.envelopeId) r.refused = "Confirm doar planul afișat acum în cockpit";
            else r.confirmed = await envelopes.confirm({ envelopeId: presented.envelopeId, nonce: presented.nonce, displayedHash: presented.hash, session: session(ctx), modality: source === "voice-local" ? "voice" : "typed", voice: input.presented?.voice || null, idempotencyKey: ctx.commandId });
          } else if (step.intent === "status") r.explain = cockpit.status({ projectId, worker: step.args.worker || null });
          else if (step.intent === "why_blocked") r.explain = cockpit.whyBlocked({ projectId, missionId: step.args.missionId || null });
          else if (step.intent === "why_route") r.explain = cockpit.whyRoute({ worker: step.args.worker });
          else if (step.intent === "replay") { const mid = step.args.missionId || (projectId && factory.list().find((f) => f.projectId === projectId)?.missionId); r.replay = mid ? cockpit.replay(mid) : null; if (!mid) r.message = "Nu am o misiune de reluat pe acest proiect."; }
          else if (step.intent === "briefing" || step.intent === "continue_last") r.delta = cockpit.delta(projectId || "__company__");
          else if (step.intent === "show_company" || step.intent === "zoom") { r.companyMap = cockpit.companyMap(); r.navigate = step.args.departmentKey ? `/company-map/${step.args.departmentKey}` : "/company-map"; }
          else if (step.intent === "recommendations") r.recommendations = advisor.recommendations();
          else if (step.intent === "mute") r.interrupt = interrupts.mute({ actor: ctx.actor });
          else if (step.intent === "pause") r.interrupt = await interrupts.pause({ projectId: null, actor: ctx.actor });
          else if (step.intent === "stop_worker") r.interrupt = await interrupts.stopWorker({ provider: step.args.worker, actor: ctx.actor });
          else if (step.intent === "freeze_project") r.interrupt = step.args.projectId || projectId ? await interrupts.freeze({ projectId: step.args.projectId || projectId, actor: ctx.actor }) : { summary: "Ce proiect îngheț?" };
          else if (step.intent === "unfreeze_project") r.refused = ctx.channel === "voice" ? "Dezghețarea se face din cockpit (permite din nou munca)" : (r.interrupt = interrupts.unfreeze({ projectId: step.args.projectId || projectId, actor: ctx.actor }), undefined);
          else if (step.intent === "takeover") r.interrupt = projectId ? await interrupts.takeover({ projectId, actor: ctx.actor }) : { summary: "Ce proiect preiei?" };
          else if (step.intent === "stop_all") r.interrupt = (await hub.commands.dispatch({ type: "system.stop_all", channel: ctx.channel === "owner" ? "owner" : ctx.channel === "voice" ? "voice" : ctx.channel === "test" ? "test" : "ui", ownerSession: ctx.ownerSession, actor: ctx.actor, payload: { reason: "Oprește tot (Lega)" } })).result;
          else if (step.intent === "quiet") r.prefs = advisor.setPrefs({ onlyDecisions: true }, ctx.actor);
          else if (step.intent === "notify_normal") r.prefs = advisor.setPrefs({ onlyDecisions: false }, ctx.actor);
          else if (step.intent === "autonomy") r.autonomy = envelopes.setAutonomy({ projectId: step.args.projectId || projectId, level: step.args.level, session: session(ctx), actor: ctx.actor });
          if (projectId && ["show_changes", "show_tests", "show_review", "show_preview", "replay", "status", "why_blocked", "why_route", "show_plan", "continue_work", "briefing", "continue_last", "focus"].includes(step.intent)) {
            const cp = r.cockpit || await cockpit.projectCockpit(projectId);
            const next = layoutForIntent(step, cp, layout);
            if (next) { layout = next; r.layout = next; }
          }
        } catch (error) { r.error = { category: error.category || "internal", message: error.message }; }
        results.push(r);
      }
      return { projectId, resolved: { steps: resolved.steps.map((s) => ({ intent: s.intent, effect: s.effect, args: s.args, constraints: s.constraints })), clarification: resolved.clarification, refused: resolved.refused },
        results, layout, channel: ctx.channel, source };
    } });
}
