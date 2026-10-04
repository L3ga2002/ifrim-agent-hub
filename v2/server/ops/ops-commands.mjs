// M10 commands: Desktop Operator, operation plans, Studio project import / folders / capture scope / local export.
// Channels follow the effect: what only REDUCES activity (stop, take over, pause, cancel, revoke) is accepted from every owner-facing
// channel; what ADDS authority (confirm a plan, resume it, authorize an app or a persistent folder, approve a capture scope) needs the
// authenticated owner session — and a fresh re-authentication when it widens access. Direct desktop commands (open / focus / show)
// need the owner session too (never the provider voice route alone). Nothing here is on the agent, schedule or cli channels.
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { insideAny } from "../policy/action-policy.mjs";

const OWNER = ["owner", "test"];
const OWNER_UI = ["ui", "owner", "test"];
const ANY = ["ui", "owner", "voice", "companion", "test"];

export function registerOpsCommands(reg, hub) {
  const { desktop, opsPlans, media, trust } = hub;
  const session = (ctx) => (ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession || null : null);
  const directArgs = (ctx) => ({ channel: ctx.channel, actor: ctx.actor, sessionId: session(ctx)?.id || null });

  // ---------------------------------------------------------------- desktop (direct, LOCAL_DIRECT)
  reg("desktop.app.open", { describe: "Deschide o aplicație autorizată și o aduce în față (verificat)", async: true, channels: OWNER, schema: { app: { required: true, max: 60 } },
    execute: (input, ctx) => desktop.openApp({ app: input.app, ...directArgs(ctx) }) });
  reg("desktop.app.focus", { describe: "Aduce în față fereastra unei aplicații autorizate (verificat)", async: true, channels: OWNER, schema: { app: { required: true, max: 60 } },
    execute: (input, ctx) => desktop.focusApp({ app: input.app, ...directArgs(ctx) }) });
  reg("desktop.folder.show", { describe: "Arată un folder aprobat în Explorer (exporturi, import)", async: true, channels: OWNER, schema: { folder: { max: 1000 } },
    execute: (input, ctx) => desktop.showFolder({ folder: input.folder || null, ...directArgs(ctx) }) });
  reg("desktop.folder.current", { describe: "Folderul ferestrei Explorer din față (pentru „importă din folderul acesta”)", async: true, channels: OWNER, schema: {},
    execute: (input, ctx) => desktop.currentFolder(directArgs(ctx)) });
  reg("desktop.stop", { describe: "Oprește inputul operatorului (fail-safe; aplicațiile rămân deschise)", async: true, channels: ANY, schema: { reason: { max: 200, default: "Stop" } },
    execute: async (input, ctx) => {
      const out = await desktop.stop({ actor: ctx.actor, reason: input.reason });
      for (const p of opsPlans.active().filter((x) => ["RUNNING", "CONFIRMED"].includes(x.status))) opsPlans.pause(p.id, { reason: input.reason, actor: ctx.actor });
      return out;
    } });
  reg("desktop.takeover", { describe: "Preiau eu: operatorul se oprește și îți lasă controlul", async: true, channels: ANY, schema: {},
    execute: async (input, ctx) => {
      const out = await desktop.takeover({ actor: ctx.actor });
      for (const p of opsPlans.active().filter((x) => ["RUNNING", "CONFIRMED"].includes(x.status))) opsPlans.pause(p.id, { reason: "Preiau eu", actor: ctx.actor });
      return out;
    } });
  reg("desktop.resume", { describe: "Reia operatorul după ce a verificat din nou starea", async: true, channels: OWNER, schema: {},
    execute: (input, ctx) => { trust.requireSession(session(ctx), "reluarea operatorului"); return desktop.resume({ actor: ctx.actor }); } });
  reg("desktop.apps.discover", { describe: "Descoperă aplicațiile operatorului din sursele standard (fără scanarea discului)", async: true, channels: OWNER, schema: {},
    execute: (input, ctx) => desktop.discover(ctx.actor) });
  reg("desktop.apps.authorize", { describe: "Autorizează aplicații pentru operator (sesiune reautentificată)", channels: OWNER, schema: { apps: { type: "array", required: true, max: 10, items: "string" } },
    execute: (input, ctx) => { const s = trust.requireFresh(session(ctx), "autorizarea unei aplicații pentru operator"); return desktop.apps.authorize(input.apps, { sessionId: s.id, via: "owner_session", actor: ctx.actor }); } });
  reg("desktop.apps.revoke", { describe: "Retrage autorizarea unor aplicații (fail-safe)", channels: ANY, schema: { apps: { type: "array", required: true, max: 10, items: "string" }, reason: { max: 200, default: "" } },
    execute: (input, ctx) => desktop.apps.revoke(input.apps, { actor: ctx.actor, reason: input.reason }) });

  // ---------------------------------------------------------------- operation plans (zero-form)
  reg("ops.plan.propose", { describe: "Arată planul exact (aplicații, date, operații, limite); nimic nu pornește", async: true, channels: ANY,
    schema: { kind: { required: true, max: 60 }, title: { required: true, max: 200 }, steps: { type: "array", required: true, max: 12 }, limits: { type: "object", default: {} } },
    execute: (input, ctx) => opsPlans.propose({ kind: input.kind, title: input.title, steps: input.steps, limits: input.limits || {}, actor: ctx.actor, via: ctx.channel }) });
  reg("ops.plan.confirm", { describe: "Confirmarea ta unică a planului afișat (sesiunea de proprietar)", async: true, channels: OWNER,
    schema: { planId: { required: true, max: 80 }, nonce: { required: true, max: 64 }, displayedHash: { required: true, max: 64 }, modality: { enum: ["click", "keyboard", "typed", "voice"], default: "click" },
      utteranceId: { max: 80 }, secrets: { type: "object" } },
    logPayload: (i) => ({ planId: i.planId, modality: i.modality, secrets: i.secrets ? Object.keys(i.secrets) : [] }),
    execute: (input, ctx) => opsPlans.confirm({ planId: input.planId, nonce: input.nonce, displayedHash: input.displayedHash, session: session(ctx), modality: input.modality,
      utteranceId: input.utteranceId || null, idempotencyKey: ctx.commandId, secrets: input.secrets || null }) });
  reg("ops.plan.pause", { describe: "Pauză: niciun pas nou (fail-safe)", channels: ANY, schema: { planId: { required: true, max: 80 }, reason: { max: 200, default: "Pauză" } },
    execute: (input, ctx) => opsPlans.pause(input.planId, { reason: input.reason, actor: ctx.actor }) });
  reg("ops.plan.cancel", { describe: "Anulează planul (fail-safe; ce s-a făcut rămâne)", channels: ANY, schema: { planId: { required: true, max: 80 }, reason: { max: 200, default: "Anulat" } },
    execute: (input, ctx) => opsPlans.cancel(input.planId, { reason: input.reason, actor: ctx.actor }) });
  reg("ops.plan.resume", { describe: "Continuă planul exact (aceleași limite; pașii incerți se verifică întâi)", async: true, channels: OWNER, schema: { planId: { required: true, max: 80 } },
    execute: (input, ctx) => opsPlans.resume(input.planId, { session: session(ctx), actor: ctx.actor }) });

  // ---------------------------------------------------------------- Studio: project import, folders, capture scope, local export
  reg("media.project.export", { describe: "Exportă proiectul Studio ca pachet (manifest cu hash-uri + surse)", channels: OWNER_UI,
    schema: { contentProjectId: { required: true, max: 80 }, dir: { required: true, max: 1000 } },
    execute: (input, ctx) => {
      if (!path.isAbsolute(input.dir)) throw new HubError("validation", "Folderul pachetului trebuie să fie o cale absolută.");
      // The destination may not exist yet: its nearest existing parent is resolved for real (links, junctions; protected folders and
      // UNC refused) and the destination must lie inside an approved folder; only then is it created.
      const target = path.resolve(input.dir);
      let probe = target;
      while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      const real = path.join(media.importAccess.realFolder(probe), path.relative(probe, target));
      const roots = media.importRoots().map((r) => { try { return fs.realpathSync.native(r); } catch { return path.resolve(r); } });
      if (!insideAny(roots, real)) throw new HubError("policy", "Exportul pachetului se face doar într-un folder aprobat.", { code: "EXPORT_DIR_NOT_APPROVED" });
      fs.mkdirSync(real, { recursive: true });
      return media.bundles.exportProject({ contentProjectId: input.contentProjectId, dir: real, actor: ctx.actor });
    } });
  reg("media.project.preview", { describe: "Ce se importă dintr-un folder de proiect (doar citire)", channels: OWNER_UI, schema: { dir: { required: true, max: 1000 } },
    execute: (input, ctx) => media.bundles.preview({ dir: input.dir, actor: ctx.actor }) });
  reg("media.project.import", { describe: "Importă proiectul previzualizat (confirmarea ta, în sesiune)", async: true, channels: OWNER,
    schema: { importId: { required: true, max: 80 }, previewHash: { required: true, max: 64 } },
    execute: (input, ctx) => { trust.requireSession(session(ctx), "importul proiectului"); return media.bundles.confirmImport({ importId: input.importId, previewHash: input.previewHash, actor: ctx.actor }); } });
  reg("media.import.folder.preview", { describe: "Ce ar citi un import din folderul acesta (nume, tipuri, mărimi; fără conținut)", channels: OWNER_UI, schema: { dir: { required: true, max: 1000 } },
    execute: (input) => media.importAccess.preview(input.dir) });
  reg("media.import.folder.authorize", { describe: "Acces la un folder pentru import: o dată sau permanent (permanentul cere reautentificare)", channels: OWNER,
    schema: { dir: { required: true, max: 1000 }, mode: { enum: ["once", "persistent"], default: "once" }, previewSha256: { required: true, max: 64 } },
    execute: (input, ctx) => {
      const s = input.mode === "persistent" ? trust.requireFresh(session(ctx), "un folder de import permanent") : trust.requireSession(session(ctx), "accesul la folder");
      return media.importAccess.authorize({ dir: input.dir, mode: input.mode, previewSha256: input.previewSha256, ownerSessionId: s.id, actor: ctx.actor });
    } });
  reg("media.import.folder.revoke", { describe: "Retrage un acces la folder (fail-safe)", channels: ANY, schema: { grantId: { required: true, max: 80 } },
    execute: (input, ctx) => ({ revoked: media.importAccess.revoke(input.grantId, ctx.actor) }) });
  reg("media.capture.scope.approve", { describe: "Aprobă scopul exact al unei sesiuni de captură (sesiune reautentificată)", channels: OWNER,
    schema: { sessionId: { required: true, max: 80 }, expiresMinutes: { type: "integer", default: 60 } },
    execute: (input, ctx) => {
      const s = trust.requireFresh(session(ctx), "aprobarea scopului capturii");
      const minutes = Math.min(240, Math.max(5, input.expiresMinutes || 60));
      return media.capture.approveScope(input.sessionId, { decisionId: `owner:${s.id}`, ownerSessionId: s.id, expiresAt: new Date(hub.config.now().getTime() + minutes * 60000).toISOString(), actor: ctx.actor });
    } });
  // OBS for the Hub's capture steps: the recordings folder (imported from there only), the LOCAL WebSocket address and an optional
  // dedicated scene. Never the password (typed at each plan's confirmation, memory only). Adds no import root by itself: the plan card
  // carries the folder decision when the recordings folder is not approved yet.
  reg("media.policy.obs", { describe: "Configurarea OBS a Hub-ului: folderul înregistrărilor, adresa locală, scena (fără parolă)", channels: OWNER,
    schema: { recordingRoot: { required: true, max: 1000 }, url: { max: 200, default: "ws://127.0.0.1:4455" }, scene: { max: 120 }, defaultDurationSec: { type: "integer", default: 20 } },
    execute: (input, ctx) => {
      trust.requireFresh(session(ctx), "configurarea OBS");
      const real = media.importAccess.realFolder(input.recordingRoot);
      let u;
      try { u = new URL(input.url || "ws://127.0.0.1:4455"); } catch { throw new HubError("validation", "Adresa OBS WebSocket nu e validă (de exemplu ws://127.0.0.1:4455)."); }
      if (u.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new HubError("policy", "OBS WebSocket se folosește doar local (ws://127.0.0.1 sau ws://localhost); nu îl expun în rețea.", { code: "OBS_URL_NOT_LOCAL" });
      const obs = { recordingRoot: real, url: `ws://${u.host}`, scene: input.scene ? String(input.scene).slice(0, 120) : null, defaultDurationSec: Math.min(120, Math.max(5, input.defaultDurationSec || 20)) };
      hub.settings.set("mediaPolicy", { ...hub.settings.get("mediaPolicy"), obs }, ctx.actor, `OBS: înregistrări în ${real}, ${obs.url}`);
      return { obs };
    } });
  reg("media.export.local", { describe: "Exportă local o randare în folderul aprobat (fără publicare, fără suprascriere)", channels: OWNER_UI,
    schema: { assetVersionId: { required: true, max: 80 }, name: { max: 120 } },
    execute: (input, ctx) => media.exportLocal({ assetVersionId: input.assetVersionId, name: input.name || null, actor: ctx.actor }) });
}
