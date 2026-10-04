import fs from "node:fs";
import path from "node:path";
import { PILOT_ACCEPTANCE_PATH, PILOT_ACCEPTANCE_SOURCE, pilotMissionInput } from "./pilot-acceptance.mjs";
import { HubError } from "../core/errors.mjs";
import { PACKAGE_KINDS } from "./packages.mjs";

/**
 * M08 commands (one command bus, the existing channels). Reading happens through GET routes; everything that writes is a command,
 * so it is validated, audited and refused on the wrong channel:
 * - OWNER ("owner" = the authenticated owner session, "test"): decisions that add authority or record the owner's choice
 *   (approve/activate a skill, confirm a lesson, decide a board item or a package, pair a phone, arm a spoken confirmation).
 * - OWNER_UI (+ "ui"): proposals and edits from the owner's interface.
 * - ANY (+ "voice", "companion"): proposals and fail-safe actions (open an incident, run a simulation, roll back a skill).
 * The agent channel has none of these (AGENT_COMMANDS is unchanged): an agent cannot draft objectives, decide or teach.
 */
const OWNER = ["owner", "test"];
const OWNER_UI = ["ui", "owner", "test"];
const ANY = ["ui", "owner", "voice", "companion", "test"];

export function registerIntelCommands(reg, hub) {
  const { twin, warroom, autopilot, board, simulations, skillEvolution, teach, devices, packages, envelopes, trust, voice, settings } = hub;
  const session = (ctx) => (ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession || null : null);

  // ---------- Digital Twin ----------
  reg("twin.claim.add", { describe: "Înregistrează o relație (observație cu sursă, declarație a ta sau ipoteză)", channels: ANY,
    schema: { projectId: { max: 80 }, subject: { type: "object", required: true }, predicate: { required: true, max: 80 }, object: { type: "object", required: true },
      kind: { enum: ["OBSERVED", "DECLARED", "HYPOTHESIS"], default: "HYPOTHESIS" }, sourceKind: { max: 40, default: "owner" }, sourceRef: { max: 300, default: "" }, note: { max: 1000, default: "" } },
    execute: (input, ctx) => {
      // Lega (voice) proposes; only the owner's own interface may declare or observe.
      const kind = ctx.channel === "voice" ? "HYPOTHESIS" : input.kind;
      const author = ctx.channel === "voice" ? "lega" : ctx.channel === "owner" || ctx.channel === "ui" || ctx.channel === "test" ? `owner:${ctx.actor}` : ctx.actor;
      return twin.addClaim({ ...input, kind, author, sourceKind: ctx.channel === "voice" ? "lega" : input.sourceKind });
    } });
  reg("twin.claim.status", { describe: "Confirmă (cu dovadă), respinge sau retrage o relație", channels: OWNER_UI,
    schema: { claimId: { required: true, max: 80 }, status: { enum: ["confirmed", "refuted", "retracted"], required: true }, evidenceRef: { max: 300, default: "" } },
    execute: (input, ctx) => twin.setClaimStatus(input.claimId, input.status, { actor: ctx.actor, evidenceRef: input.evidenceRef }) });

  // ---------- War Room ----------
  reg("incident.propose", { describe: "Deschide un incident PROPUS din raportul tău (nimic nu se oprește sau se modifică)", channels: ANY,
    schema: { projectId: { required: true, max: 80 }, text: { required: true, min: 3, max: 2000 } },
    execute: (input, ctx) => warroom.propose({ projectId: input.projectId, text: input.text, reportedBy: ctx.actor, source: ctx.channel === "voice" ? "lega" : "owner" }) });
  reg("incident.entry.add", { describe: "Semnal, ipoteză, acțiune, dovadă sau notă (conținutul unui model rămâne ipoteză neconfirmată)", channels: ANY,
    schema: { incidentId: { required: true, max: 80 }, kind: { enum: ["signal", "hypothesis", "action", "evidence", "note"], required: true }, text: { required: true, min: 2, max: 2000 },
      sourceKind: { max: 40, default: "owner" }, sourceRef: { max: 300, default: "" }, status: { enum: ["UNCONFIRMED", "CONFIRMED"], default: "UNCONFIRMED" } },
    execute: (input, ctx) => warroom.addEntry(input.incidentId, { ...input, sourceKind: ctx.channel === "voice" ? "lega" : input.sourceKind, actor: ctx.actor }) });
  reg("incident.verify", { describe: "Confirmă (cu dovadă) sau respinge o ipoteză sau un semnal", channels: OWNER_UI,
    schema: { entryId: { required: true, max: 80 }, status: { enum: ["CONFIRMED", "REFUTED"], required: true }, evidenceRef: { max: 300, default: "" }, reason: { max: 500, default: "" }, sourceKind: { enum: ["owner", "hub-check"], default: "owner" } },
    execute: (input, ctx) => warroom.verifyEntry(input.entryId, { ...input, actor: ctx.actor }) });
  reg("incident.impact", { describe: "Impactul confirmat de tine (separat de prioritatea recomandată)", channels: OWNER_UI,
    schema: { incidentId: { required: true, max: 80 }, impact: { type: "object", required: true } },
    execute: (input, ctx) => warroom.confirmImpact(input.incidentId, { impact: input.impact, actor: ctx.actor }) });
  reg("incident.components", { describe: "Componentele implicate (declarate de tine sau propuse ca ipoteză)", channels: ANY,
    schema: { incidentId: { required: true, max: 80 }, components: { type: "array", required: true } },
    execute: (input, ctx) => warroom.setComponents(input.incidentId, { components: input.components, actor: ctx.actor, sourceKind: ctx.channel === "voice" ? "lega" : "owner" }) });
  reg("incident.transition", { describe: "Triaj → reproducere → remediere → monitorizare → rezolvat (rezolvarea cere o dovadă confirmată)", channels: OWNER_UI,
    schema: { incidentId: { required: true, max: 80 }, to: { required: true, max: 20 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => warroom.transition(input.incidentId, { to: input.to, reason: input.reason, actor: ctx.actor }) });
  reg("incident.remediate", { describe: "Pregătește misiunea de remediere ca ciornă (nu pornește nimic)", channels: OWNER_UI, async: true,
    schema: { incidentId: { required: true, max: 80 }, testRef: { max: 200, default: "" }, verification: { type: "object" } },
    execute: (input, ctx) => warroom.proposeRemediation(input.incidentId, { testRef: input.testRef, verification: input.verification || null, actor: ctx.actor, channel: ctx.channel === "test" ? "test" : ctx.channel === "owner" ? "owner" : "ui", ownerSession: ctx.ownerSession }) });

  // ---------- Project Autopilot ----------
  reg("autopilot.draft", { describe: "Obiectiv finit: sarcini dependente, criterii, limite (validat; nimic nu pornește)", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, title: { required: true, min: 3, max: 160 }, criteria: { type: "array", default: [] }, tasks: { type: "array", required: true },
      verification: { type: "object" }, limits: { type: "object", default: {} }, models: { type: "object" } },
    // M09: `models` = { writer: { model, effort }, reviewer: { model, effort } } — passed explicitly to every task's mission.
    execute: (input, ctx) => autopilot.draft({ ...input, actor: ctx.actor }) });
  reg("autopilot.prepare", { describe: "Creează misiunile sarcinilor (ciorne, în ordinea dependențelor)", channels: OWNER_UI, async: true,
    schema: { objectiveId: { required: true, max: 80 } },
    execute: (input, ctx) => autopilot.prepare(input.objectiveId, { actor: ctx.actor, channel: ctx.channel === "test" ? "test" : ctx.channel === "owner" ? "owner" : "ui", ownerSession: ctx.ownerSession }) });
  reg("autopilot.propose", { describe: "Un singur plan peste sarcinile obiectivului (confirmarea rămâne a ta)", channels: OWNER_UI, async: true,
    schema: { objectiveId: { required: true, max: 80 }, constraints: { type: "object", default: {} } },
    execute: (input, ctx) => autopilot.propose(input.objectiveId, { actor: ctx.actor, via: ctx.channel, constraints: input.constraints }) });
  reg("autopilot.amend", { describe: "Versiune nouă a obiectivului (o confirmare veche nu acoperă scope-ul schimbat)", channels: OWNER_UI,
    schema: { objectiveId: { required: true, max: 80 }, changes: { type: "object", required: true } },
    execute: (input, ctx) => autopilot.amend(input.objectiveId, input.changes, { actor: ctx.actor }) });

  // ---------- Board Meeting ----------
  reg("board.open", { describe: "Deschide ședința (agenda din date; niciun model pornit)", channels: ANY, schema: { title: { max: 160, default: "" }, from: { max: 40 } },
    execute: (input, ctx) => board.open({ title: input.title, from: input.from || null, actor: ctx.actor }) });
  reg("board.move", { describe: "Subiectul următor / anterior", channels: ANY, schema: { meetingId: { required: true, max: 80 }, delta: { type: "number", default: 1 } },
    execute: (input, ctx) => board.move(input.meetingId, Math.max(-1, Math.min(1, Number(input.delta) || 1)), ctx.actor) });
  reg("board.decide", { describe: "Decizie înregistrată (decid/resping cer sesiunea ta; amânarea nu) — nu activează nimic", channels: ANY,
    schema: { itemId: { required: true, max: 80 }, decision: { enum: ["decide", "defer", "reject", "note"], required: true }, note: { max: 1000, default: "" } },
    execute: (input, ctx) => board.decide(input.itemId, { decision: input.decision, note: input.note, actor: ctx.actor, ownerSession: session(ctx) }) });
  reg("board.close", { describe: "Închide ședința cu procesul-verbal", channels: OWNER_UI, schema: { meetingId: { required: true, max: 80 } },
    execute: (input, ctx) => board.close(input.meetingId, { actor: ctx.actor }) });

  // ---------- Simulation ----------
  reg("simulation.run", { describe: "Scenariu what-if pe intrările tale (determinist; nu schimbă nimic)", channels: ANY,
    schema: { title: { max: 160, default: "" }, inputs: { type: "object", required: true }, saveAsDefaults: { type: "boolean", default: false } },
    execute: (input, ctx) => {
      const out = simulations.run({ title: input.title, inputs: input.inputs, actor: ctx.actor });
      // "Folosește-le ca estimările mele": only from the owner's interface; the scenario-specific count (newProjects) is not kept.
      if (input.saveAsDefaults && ["owner", "ui", "test"].includes(ctx.channel) && out.result?.status === "COMPUTED") {
        const { newProjects, ...rest } = input.inputs; void newProjects;
        settings.set("simulationDefaults", rest, ctx.actor, "Estimările tale pentru scenarii");
      }
      return out;
    } });
  reg("simulation.propose", { describe: "Transformă scenariul într-o propunere (ciornă de decizie separată)", channels: OWNER_UI,
    schema: { simulationId: { required: true, max: 80 }, title: { max: 160, default: "" } },
    execute: (input, ctx) => simulations.toProposal(input.simulationId, { actor: ctx.actor, title: input.title }) });

  // ---------- Skill Evolution ----------
  reg("skill.candidate.propose", { describe: "Propunere de modificare a unui skill (motiv, dovezi, cazuri de regresie)", channels: OWNER_UI,
    schema: { skillId: { required: true, max: 80 }, body: { required: true, max: 200000 }, reason: { required: true, max: 1000 }, evidence: { type: "array", default: [] }, regressionCases: { type: "array", default: [] } },
    execute: (input, ctx) => skillEvolution.propose({ ...input, actor: ctx.actor }) });
  reg("skill.candidate.evaluate", { describe: "Evaluare deterministă (verificări statice + cazuri de regresie)", channels: OWNER_UI, schema: { candidateId: { required: true, max: 80 } },
    execute: (input, ctx) => skillEvolution.evaluate(input.candidateId, { actor: ctx.actor }) });
  reg("skill.candidate.approve", { describe: "Aprobă candidatul (versiune nouă, încă inactivă)", channels: OWNER, schema: { candidateId: { required: true, max: 80 } },
    execute: (input, ctx) => skillEvolution.approve(input.candidateId, { actor: ctx.actor, ownerSession: session(ctx) }) });
  reg("skill.candidate.activate", { describe: "Activare limitată (proiecte) sau generală; execuțiile active rămân pe versiunea lor", channels: OWNER,
    schema: { candidateId: { required: true, max: 80 }, projectIds: { type: "array", default: [] }, all: { type: "boolean", default: false }, autoRollback: { type: "boolean", default: false } },
    execute: (input, ctx) => skillEvolution.activate(input.candidateId, { ...input, actor: ctx.actor, ownerSession: session(ctx) }) });
  reg("skill.candidate.rollback", { describe: "Revenire la versiunea de bază (fail-safe)", channels: ANY, schema: { candidateId: { required: true, max: 80 }, reason: { max: 300, default: "" } },
    execute: (input, ctx) => skillEvolution.rollback(input.candidateId, { reason: input.reason, actor: ctx.actor }) });
  reg("skill.candidate.reject", { describe: "Respinge candidatul", channels: OWNER_UI, schema: { candidateId: { required: true, max: 80 }, reason: { max: 300, default: "" } },
    execute: (input, ctx) => skillEvolution.reject(input.candidateId, { reason: input.reason, actor: ctx.actor }) });

  // ---------- Teach Lega ----------
  reg("lesson.propose", { describe: "Instrucțiunea ta → propunere de regulă/procedură (se salvează doar după confirmarea ta)", channels: ANY,
    schema: { text: { max: 2000, default: "" }, utteranceId: { max: 80 }, projectId: { max: 80 }, missionId: { max: 80 }, scope: { enum: ["GLOBAL", "PROJECT", "MISSION"] },
      source: { enum: ["typed", "document", "tool", "web", "email", "review", "model"], default: "typed" } },
    execute: (input, ctx) => {
      // Provenance comes from the channel and the server-held utterance, never from the words: pasted content keeps its source.
      let text = input.text;
      let provenance = ctx.channel === "voice" ? "owner-voice-provider" : input.source === "typed" ? "owner-typed" : input.source;
      if (input.utteranceId) {
        if (ctx.channel !== "owner" && ctx.channel !== "test") throw new HubError("authentication", "Fraza vocală locală se folosește doar în sesiunea ta");
        text = voice.utteranceForIntent({ utteranceId: input.utteranceId, session: session(ctx) }).transcript;
        provenance = "owner-voice-local";
      }
      if (ctx.channel === "companion") provenance = "device";
      return teach.propose({ text, provenance, projectId: input.projectId || null, missionId: input.missionId || null, scope: input.scope || null, actor: ctx.actor });
    } });
  reg("lesson.confirm", { describe: "Confirmă lecția (devine memorie, în scope-ul ei)", channels: OWNER, schema: { lessonId: { required: true, max: 80 } },
    execute: (input, ctx) => teach.confirm(input.lessonId, { ownerSession: session(ctx), actor: ctx.actor }) });
  reg("lesson.dismiss", { describe: "Renunță la propunere", channels: ANY, schema: { lessonId: { required: true, max: 80 } },
    execute: (input, ctx) => teach.dismiss(input.lessonId, { actor: ctx.actor }) });
  reg("lesson.forget", { describe: "„Uită regula asta”: pregătește dezactivarea exactă (nimic nu se șterge încă)", channels: ANY,
    schema: { ref: { max: 500, default: "" }, lessonId: { max: 80 } },
    execute: (input, ctx) => teach.proposeForget({ ref: input.ref, lessonId: input.lessonId || null, actor: ctx.actor }) });
  reg("lesson.forget.cancel", { describe: "Renunță la dezactivare (regula rămâne activă)", channels: ANY, schema: { lessonId: { required: true, max: 80 } },
    execute: (input, ctx) => teach.cancelForget(input.lessonId, { actor: ctx.actor }) });
  reg("lesson.forget.confirm", { describe: "Confirmă dezactivarea lecției (istoricul rămâne)", channels: OWNER, schema: { lessonId: { required: true, max: 80 } },
    execute: (input, ctx) => teach.confirmForget(input.lessonId, { ownerSession: session(ctx), actor: ctx.actor }) });

  // ---------- Personal Mission Control ----------
  reg("device.pairing.start", { describe: "Cod de asociere pentru un telefon (10 minute; doar vizualizare și opriri)", channels: OWNER, schema: {},
    // The code is shown once to the owner; the command log (readable by local API clients) keeps it masked (review M08).
    logResult: (r) => ({ ...r, code: "••••••" }),
    execute: (input, ctx) => devices.startPairing({ ownerSession: session(ctx), actor: ctx.actor }) });
  reg("device.revoke", { describe: "Revocă un dispozitiv", channels: ["owner", "test", "companion"], schema: { deviceId: { required: true, max: 80 } },
    execute: (input, ctx) => devices.revoke(input.deviceId, { actor: ctx.actor, ownerSession: session(ctx), device: ctx.channel === "companion" ? { id: String(ctx.actor).replace(/^device:/, "") } : null }) });

  // ---------- Decision packages ----------
  // M09: the Studio packages read the media tools' verification (created after the packages in hub.mjs).
  if (hub.media) packages.attachMedia?.(hub.media);
  reg("package.present", { describe: "Prezintă un pachet de decizie: A (datele), B (pilotul real), MEDIA_A (mediul Studio), MEDIA_B (captură, buget AI), MEDIA_C (conturi, încărcare)", channels: OWNER_UI, async: true,
    schema: { kind: { enum: [...PACKAGE_KINDS], required: true } },
    execute: async (input, ctx) => {
      // MEDIA_A: "executed" comes from a fresh verification of ffmpeg/ffprobe (version + sha256), never from the click.
      if (input.kind === "MEDIA_A" && hub.media?.tools?.resolve) { try { await hub.media.tools.resolve(); } catch { /* the inventory reports what is known */ } }
      return packages.present(input.kind, { actor: ctx.actor });
    } });
  reg("package.decide", { describe: "Decizia ta, opțiune cu opțiune (sesiune proaspătă)", channels: OWNER, async: true,
    schema: { packageId: { required: true, max: 80 }, decisions: { type: "object", required: true } },
    execute: (input, ctx) => packages.decide(input.packageId, { decisions: input.decisions, ownerSession: session(ctx), trust, actor: ctx.actor,
      apply: {
        setRoute: (projectId) => hub.commands.dispatch({ type: "project.environment.set", channel: ctx.channel, actor: ctx.actor, ownerSession: ctx.ownerSession, payload: { projectId, environment: "wsl-runner" } }),
        setAutonomy: (projectId, level) => envelopes.setAutonomy({ projectId, level, session: session(ctx), actor: ctx.actor }),
        // B4: the one file the Hub adds to the project (the independent acceptance test), then the pilot mission as a draft.
        preparePilot: async (inv) => {
          if (!inv?.available) throw new HubError("conflict", "Pilotul nu are un proiect ProDelivery înregistrat");
          const target = path.join(inv.path, PILOT_ACCEPTANCE_PATH);
          if (fs.existsSync(target)) {
            if (fs.readFileSync(target, "utf8") !== PILOT_ACCEPTANCE_SOURCE) throw new HubError("conflict", `${PILOT_ACCEPTANCE_PATH} există deja în proiect cu alt conținut; nu îl suprascriu`);
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, PILOT_ACCEPTANCE_SOURCE, { flag: "wx" });
          }
          // M09: the mission carries the package's models explicitly (writer/reviewer model + effort), never the account defaults.
          const modelLimits = packages.pilotModelLimits(inv.models);
          const existing = hub.db.prepare("SELECT m.id FROM missions m JOIN factory_missions fm ON fm.mission_id = m.id WHERE m.project_id = ? AND m.title = ? LIMIT 1").get(inv.projectId, inv.task.title);
          if (existing) {
            // A draft prepared before M09 (no models): the owner's B4 approval names these models, so the draft gets them (SPEC_DRAFT only;
            // a started mission is never changed — it keeps its own approved bindings).
            const fmRow = hub.factory.view(existing.id)?.factory;
            const missing = fmRow && Object.entries(modelLimits).some(([k, v]) => String(fmRow.limits?.[k] || "").toLowerCase() !== String(v).toLowerCase());
            if (fmRow?.stage === "SPEC_DRAFT" && missing) {
              await hub.commands.dispatch({ type: "factory.limits", channel: ctx.channel === "test" ? "test" : "owner", actor: ctx.actor, ownerSession: ctx.ownerSession, payload: { missionId: existing.id, limits: modelLimits } });
              return { missionId: existing.id, existing: true, modelsSet: true };
            }
            return { missionId: existing.id, existing: true };
          }
          const prepared = await hub.commands.dispatch({ type: "factory.prepare", channel: ctx.channel === "test" ? "test" : "owner", actor: ctx.actor, ownerSession: ctx.ownerSession,
            payload: { projectId: inv.projectId, ...pilotMissionInput(inv.task), limits: { ...inv.limits, ...modelLimits } } });
          return { missionId: prepared.result?.mission?.id || null };
        },
      } }) });

  // ---------- Zero-Menu ----------
  reg("envelope.arm", { describe: "Deschide fereastra scurtă de confirmare vocală pentru planul afișat (sesiunea ta, filtrul vocal activ)", channels: OWNER,
    schema: { envelopeId: { required: true, max: 80 }, legaSessionId: { max: 80 } },
    execute: (input, ctx) => envelopes.armConfirmation({ envelopeId: input.envelopeId, session: session(ctx), legaSessionId: input.legaSessionId || null }) });
  reg("owner.start_view", { describe: "Ecranul de pornire: cockpit-ul proiectului sau ecranul mare cu harta", channels: ANY, schema: { view: { enum: ["cockpit", "stage"], required: true } },
    execute: (input, ctx) => { settings.set("startView", input.view, ctx.actor, `Ecranul de pornire: ${input.view}`); return { startView: input.view }; } });
}
