// M11 delivery commands. Channels follow the effect (as ops-commands.mjs): what only REDUCES activity or only marks something stale
// (verify, preview stop, cancel) is accepted from every owner-facing channel; what the owner decides (summary edit / approve, a service
// bound, local software acceptance, a preview started, a package proposed, a revision) needs the authenticated owner session. Nothing is
// on the agent, schedule or cli channels; nothing here publishes, approves a clip or records rights.
import fs from "node:fs";
import { HubError } from "../core/errors.mjs";
import { packageSteps, revisionSteps, PACKAGE_KIND, REVISE_KIND, DELIVERY_LIMITS } from "./template.mjs";

const OWNER = ["owner", "test"];
const OWNER_UI = ["ui", "owner", "test"];
const ANY = ["ui", "owner", "voice", "companion", "test"];

export function registerDeliveryCommands(reg, hub) {
  const { deliveries, trust, factory, opsPlans, commands } = hub;
  const session = (ctx) => (ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession || null : null);
  const needSession = (ctx, what) => trust.requireSession(session(ctx), what);

  reg("delivery.verify", { describe: "Verifică dacă proiectul e încă versiunea legată de livrare (poate doar marca învechit)", channels: ANY, schema: { deliveryId: { required: true, max: 80 } },
    execute: (input, ctx) => deliveries.verify(input.deliveryId, { by: ctx.actor }) });
  reg("delivery.summary.edit", { describe: "O versiune nouă a rezumatului comercial (secțiunile tale)", channels: OWNER, schema: { deliveryId: { required: true, max: 80 }, sections: { type: "array", required: true, max: 12 }, displayedSha: { max: 64 } },
    execute: (input, ctx) => deliveries.editDocument(input.deliveryId, { sections: input.sections, displayedSha: input.displayedSha, session: needSession(ctx, "editarea rezumatului") }) });
  reg("delivery.summary.approve", { describe: "Marchează versiunea afișată a rezumatului „gata de prezentare”", channels: OWNER, schema: { deliveryId: { required: true, max: 80 }, displayedSha: { required: true, max: 64 } },
    execute: (input, ctx) => deliveries.approveDocument(input.deliveryId, { displayedSha: input.displayedSha, session: needSession(ctx, "rezumatul gata de prezentare") }) });
  reg("delivery.software.accept", { describe: "Accept local software-ul afișat (pachetul exact)", async: true, channels: OWNER, schema: { deliveryId: { required: true, max: 80 }, displayedBundleSha: { required: true, max: 64 }, note: { max: 500, default: "" } },
    execute: async (input, ctx) => {
      needSession(ctx, "acceptarea software-ului");
      const d = deliveries.need(input.deliveryId);
      const binding = factory.deliveryBinding(d.missionId);
      if (!binding || binding.bundleSha !== input.displayedBundleSha || d.bundleSha !== input.displayedBundleSha) throw new HubError("conflict", "Pachetul afișat nu mai e cel curent; reîncarcă livrarea.", { code: "DELIVERY_BUNDLE_DISPLAYED" });
      const plan = d.opsPlanId ? opsPlans.view(d.opsPlanId) : null;
      if (plan && plan.steps.some((s) => s.kind === "delivery.capture" && s.status === "RUNNING")) throw new HubError("conflict", "Aștept capturile sau oprește planul livrării înainte de acceptare.", { code: "DELIVERY_CAPTURE_RUNNING" });
      // ONLY the factory's own acceptance; no other effect.
      return (await commands.dispatch({ type: "factory.accept", payload: { missionId: d.missionId, note: input.note }, channel: ctx.channel, actor: ctx.actor, ownerSession: ctx.ownerSession })).result;
    } });
  reg("delivery.package.propose", { describe: "Cardul pașilor de livrare (o confirmare): captură, clip, rezumat pe versiunea verificată", async: true, channels: OWNER, schema: { deliveryId: { required: true, max: 80 } },
    execute: async (input, ctx) => {
      needSession(ctx, "pașii de livrare");
      const d = deliveries.need(input.deliveryId);
      return opsPlans.propose({ kind: PACKAGE_KIND, title: d.title, steps: packageSteps(d.template, d.id), limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions }, actor: ctx.actor, via: ctx.channel });
    } });
  reg("delivery.revise", { describe: "Spune ce schimbi la livrare: o observație, rezumatul, clipul sau software-ul (un singur card sau o întrebare)", async: true, channels: OWNER,
    schema: { deliveryId: { required: true, max: 80 }, text: { required: true, max: 2000 }, selection: { type: "object" }, timecodeMs: { type: "number" }, player: { max: 20 }, choice: { type: "object" }, revisionId: { max: 80 } },
    execute: async (input, ctx) => {
      const s = needSession(ctx, "revizuirea livrării");
      const d = deliveries.need(input.deliveryId);
      if (!hub.deliveryPlanner) throw new HubError("internal", "Planificatorul livrării nu e disponibil");
      return hub.deliveryPlanner.revise({ step: { intent: "delivery_revise", args: { request: input.text }, constraints: {} }, text: input.text, projectId: d.projectId, session: s,
        lastTarget: { kind: "delivery", id: d.id }, room: { selection: input.selection || null, timecodeMs: Number.isFinite(input.timecodeMs) ? input.timecodeMs : null, player: input.player || null, choice: input.choice || null } });
    } });
  reg("delivery.summary.service", { describe: "Leagă un serviciu CONFIGURAT din catalog de rezumat (o versiune nouă)", channels: OWNER, schema: { deliveryId: { required: true, max: 80 }, serviceId: { required: true, max: 80 } },
    execute: (input, ctx) => deliveries.bindService(input.deliveryId, { serviceId: input.serviceId, session: needSession(ctx, "legarea unui serviciu") }) });
  reg("delivery.preview.start", { describe: "Pornește preview-ul versiunii verificate (proiect de test, același snapshot)", async: true, channels: OWNER, schema: { deliveryId: { required: true, max: 80 } },
    execute: async (input, ctx) => { needSession(ctx, "preview-ul livrării"); return deliveries.startPreview(input.deliveryId, { runner: hub.factoryRunner }); } });
  reg("delivery.preview.stop", { describe: "Oprește preview-ul livrării (fail-safe)", async: true, channels: ANY, schema: { deliveryId: { required: true, max: 80 } },
    execute: async (input) => { await hub.supervisor.stop(`delivery-preview-${deliveries.need(input.deliveryId).id}`, { graceMs: 500 }).catch(() => {}); return { stopped: true }; } });
  reg("delivery.close", { describe: "Închide livrarea (rămâne în istoric)", channels: OWNER_UI, schema: { deliveryId: { required: true, max: 80 }, reason: { max: 200, default: "închisă de proprietar" } },
    execute: (input, ctx) => deliveries.close(input.deliveryId, { reason: input.reason, actor: ctx.actor }) });
  reg("delivery.cancel", { describe: "Anulează livrarea și planul ei (fail-safe; nu șterge nimic)", async: true, channels: ANY, schema: { deliveryId: { required: true, max: 80 }, reason: { max: 200, default: "anulată" } },
    execute: (input, ctx) => deliveries.cancel(input.deliveryId, { reason: input.reason, actor: ctx.actor }) });
  reg("delivery.revision.propose", { describe: "Cardul unei revizuiri de clip (o confirmare): doar diferența", async: true, channels: OWNER, schema: { deliveryId: { required: true, max: 80 }, revisionId: { required: true, max: 80 } },
    execute: async (input, ctx) => {
      needSession(ctx, "revizuirea clipului");
      const d = deliveries.need(input.deliveryId);
      const revision = deliveries.getRevision(input.revisionId);
      if (!revision || revision.deliveryId !== d.id) throw new HubError("conflict", "Revizuirea nu aparține acestei livrări.", { code: "REVISION_MISSING" });
      const plan = await opsPlans.propose({ kind: REVISE_KIND, title: `Revizuire clip: ${d.title}`, steps: revisionSteps(deliveries.effectiveTemplate(d), d.id, input.revisionId), limits: { maxDurationMin: DELIVERY_LIMITS.revisionMinutes, maxActions: 60 }, actor: ctx.actor, via: ctx.channel });
      deliveries.updateRevision(input.revisionId, { opsPlanId: plan.id, status: "PROPOSED" });
      return plan;
    } });
}

/** The read path of the E2E screenshot (non-stale evidence of the delivery's mission, a png in its work area), or null. */
export function deliveryShot(hub, deliveryId, evidenceId) {
  const d = hub.deliveries.need(deliveryId);
  const file = hub.factory.e2eShotPath(d.missionId, evidenceId);
  return file && fs.existsSync(file) ? file : null;
}
