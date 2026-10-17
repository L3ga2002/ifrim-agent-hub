import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { isSyncedPath } from "./paths.mjs";

/**
 * M09 Content / Media / Growth commands (one command bus, the existing channels). Reads are GET routes; every write is a command,
 * validated, audited and refused on the wrong channel:
 * - OWNER (the authenticated owner session, "test"): decisions — approve a distribution manifest (fresh Windows Hello), record that
 *   a post went out, start an OBS recording (policy-refused in M09), change where local media may be imported from.
 * - OWNER_UI (+ "ui"): production work from the owner's interface (import, edit plans, renders, QA, variants, packs, analytics).
 * - ANY (+ "voice", "companion"): proposals and fail-safe actions — a timecode correction proposed by Lega (never applied by a
 *   sentence), an idea, and every cancel / revoke.
 * No command type contains publish/push/deploy/commit, none is delegated to the agent channel and none runs on the schedule
 * channel: nothing here can upload, publish or message anyone.
 */
const OWNER = ["owner", "test"];
const OWNER_UI = ["ui", "owner", "test"];
const ANY = ["ui", "owner", "voice", "companion", "test"];

const brief = (r) => {
  if (!r || typeof r !== "object") return r ?? null;
  const pick = (o) => (o && typeof o === "object" ? { id: o.id ?? null, status: o.status ?? o.stage ?? null } : null);
  return { id: r.id ?? null, status: r.status ?? r.stage ?? null, project: pick(r.project), version: pick(r.version), asset: pick(r.asset),
    attempt: pick(r.attempt), manifest: pick(r.manifest), review: pick(r.review), job: pick(r.job), duplicate: r.duplicate ?? undefined };
};

/** Who proposed a correction: the owner's typed interface, Lega (a provider transcript, never authority) or a test. */
const provenanceOf = (ctx) => (ctx.channel === "voice" ? "voice-provider" : ctx.channel === "companion" ? "companion" : ctx.channel === "owner" ? "owner-typed" : ctx.channel === "test" ? "test" : "ui");
const authorKindOf = (ctx) => (ctx.channel === "owner" || ctx.channel === "ui" || ctx.channel === "test" ? "owner" : "agent");

export function registerMediaCommands(register, hub) {
  const { media, trust, settings, config } = hub;
  const reg = (type, h) => register(type, { logResult: brief, ...h });
  const session = (ctx) => (ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession || null : null);
  const kick = () => setImmediate(() => { try { media.tick(); } catch { /* the job row records failures */ } });

  // ---------- ideas & content projects ----------
  reg("content.idea.create", { describe: "Propune o idee de conținut (din muncă reală, cu dovezi; nu creează nimic public)", channels: ANY,
    schema: { title: { required: true, max: 200 }, angle: { max: 1000, default: "" }, audience: { enum: ["technical", "business", "both"], default: "both" },
      reason: { max: 1000, default: "" }, evidence: { type: "array", default: () => [] }, publicEligible: { type: "boolean", default: false } },
    execute: (input, ctx) => media.content.createIdea({ ...input, publicEligible: ctx.channel === "voice" ? false : input.publicEligible,
      sourceKind: ctx.channel === "voice" || ctx.channel === "companion" ? "manual" : "owner", actor: ctx.actor }) });
  reg("content.idea.status", { describe: "Schimbă starea unei idei (selectată / renunțată)", channels: OWNER_UI,
    schema: { ideaId: { required: true, max: 80 }, status: { required: true, enum: ["NEW", "SHORTLISTED", "DISCARDED"] }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => media.content.setIdeaStatus(input.ideaId, input.status, ctx.actor, input.reason) });
  reg("content.idea.promote", { describe: "Transformă o idee într-un proiect de conținut", channels: OWNER_UI,
    schema: { ideaId: { required: true, max: 80 }, fields: { type: "object", default: () => ({}) } },
    execute: (input, ctx) => media.content.promoteIdea(input.ideaId, input.fields, ctx.actor) });
  reg("content.project.create", { describe: "Creează un proiect de conținut", channels: OWNER_UI, schema: { fields: { type: "object", required: true } },
    execute: (input, ctx) => media.content.createProject(input.fields, ctx.actor) });
  reg("content.project.update", { describe: "Modifică detaliile unui proiect de conținut", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, fields: { type: "object", required: true }, expectedVersion: { type: "integer" } },
    execute: (input, ctx) => media.content.updateProject(input.projectId, input.fields, ctx.actor, { expectedVersion: input.expectedVersion ?? null }) });
  reg("content.project.stage", { describe: "Mută proiectul într-o etapă (cu verificările etapei)", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, stage: { required: true, max: 30 }, reason: { max: 500, default: "" }, expectedVersion: { type: "integer" } },
    execute: (input, ctx) => media.content.setStage(input.projectId, input.stage, { actor: ctx.actor, reason: input.reason, expectedVersion: input.expectedVersion ?? null }) });
  reg("content.readiness.evaluate", { describe: "Verifică dacă povestea poate fi produsă (READY / NO_GO / NEEDS_CAPTURE)", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 } }, execute: (input, ctx) => media.content.evaluateReadiness(input.projectId, ctx.actor) });
  reg("content.brief.save", { describe: "Salvează o versiune nouă a brief-ului", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, body: { type: "object", required: true } },
    execute: (input, ctx) => media.content.saveBrief(input.projectId, { body: input.body, authorKind: authorKindOf(ctx), author: ctx.actor }) });
  reg("content.script.save", { describe: "Salvează o versiune nouă a scenariului (voce, text pe ecran, subtitrări separate)", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, language: { enum: ["ro", "en"], default: "ro" }, segments: { type: "array", required: true }, title: { max: 200, default: "" }, notes: { max: 2000, default: "" } },
    execute: (input, ctx) => media.content.saveScript(input.projectId, { ...input, authorKind: authorKindOf(ctx), author: ctx.actor }) });
  reg("content.storyboard.save", { describe: "Salvează o versiune nouă a storyboard-ului", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, shots: { type: "array", required: true }, notes: { max: 2000, default: "" } },
    execute: (input, ctx) => media.content.saveStoryboard(input.projectId, { shots: input.shots, notes: input.notes, authorKind: authorKindOf(ctx), author: ctx.actor }) });
  reg("content.claim.save", { describe: "Salvează o afirmație din scenariu cu dovezile ei", channels: OWNER_UI,
    schema: { projectId: { required: true, max: 80 }, claim: { type: "object", required: true } },
    execute: (input, ctx) => media.content.saveClaim(input.projectId, input.claim, ctx.actor) });
  reg("content.claim.status", { describe: "Marchează o afirmație susținută / incertă / blocată", channels: OWNER_UI,
    schema: { claimId: { required: true, max: 80 }, status: { required: true, enum: ["SUPPORTED", "UNCERTAIN", "BLOCKED"] }, evidence: { type: "array" }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => media.content.setClaimStatus(input.claimId, input.status, { evidence: input.evidence, actor: ctx.actor, reason: input.reason }) });

  // ---------- library & rights ----------
  reg("media.asset.import", { describe: "Importă un fișier media local dintr-un folder permis (originalul rămâne neschimbat)", channels: OWNER_UI, async: true,
    schema: { sourcePath: { required: true, max: 1000 }, title: { max: 200, default: "" }, category: { max: 30, default: "raw" },
      origin: { enum: ["OWNED", "LICENSED", "CLIENT_PROVIDED", "AI_GENERATED", "UNKNOWN"], default: "UNKNOWN" }, captureLabel: { max: 40 },
      contentProjectId: { max: 80 }, tags: { type: "array", default: () => [] }, description: { max: 2000, default: "" } },
    execute: (input, ctx) => media.assets.ingestFile({ ...input, sourcePath: path.resolve(input.sourcePath), allowedRoots: media.importRoots(), actor: ctx.actor }) });
  reg("media.asset.import_upload", { describe: "Înregistrează în bibliotecă un fișier încărcat din pagină", channels: OWNER_UI, async: true,
    schema: { uploadId: { required: true, pattern: /^upl_[a-z0-9_]{6,80}\.[a-z0-9]{1,8}$/ }, title: { max: 200, default: "" }, category: { max: 30, default: "raw" },
      origin: { enum: ["OWNED", "LICENSED", "CLIENT_PROVIDED", "AI_GENERATED", "UNKNOWN"], default: "UNKNOWN" }, captureLabel: { max: 40 },
      contentProjectId: { max: 80 }, tags: { type: "array", default: () => [] }, description: { max: 2000, default: "" } },
    execute: async (input, ctx) => {
      const uploads = path.join(path.dirname(config.mediaWorkDir), "media-uploads");
      const sourcePath = path.join(uploads, input.uploadId);
      try {
        return await media.assets.ingestFile({ ...input, sourcePath, allowedRoots: [uploads], actor: ctx.actor });
      } finally { fs.rmSync(sourcePath, { force: true }); }
    } });
  reg("media.asset.update", { describe: "Modifică metadatele unui asset (nu fișierul original)", channels: OWNER_UI,
    schema: { assetId: { required: true, max: 80 }, patch: { type: "object", required: true }, expectedVersion: { type: "integer" } },
    execute: (input, ctx) => media.assets.updateMetadata(input.assetId, input.patch, ctx.actor, { expectedVersion: input.expectedVersion ?? null }) });
  reg("media.rights.record", { describe: "Înregistrează drepturile unui asset pentru un scop (platforme, folosire, perioadă)", channels: OWNER_UI,
    schema: { right: { type: "object", required: true } }, execute: (input, ctx) => media.rights.record({ ...input.right, actor: ctx.actor }) });
  reg("media.rights.revoke", { describe: "Revocă un drept (fail-safe; arată ce materiale sunt afectate)", channels: ANY,
    schema: { rightId: { required: true, max: 80 }, reason: { max: 500, default: "revocat" } },
    execute: (input, ctx) => {
      // rights.revoke returns { right, alreadyRevoked, impact } (impact computed after the revocation).
      const { right, alreadyRevoked, impact } = media.rights.revoke(input.rightId, input.reason, ctx.actor);
      // M09 review: a revocation re-checks every live manifest that uses the material at once (an approved one is invalidated
      // and its open packs are withdrawn), instead of waiting for the next approval or pack.
      const rechecked = [];
      for (const m of impact?.affected?.manifests || []) {
        if (m.status !== "APPROVED" && m.status !== "DRAFT") continue;
        try { rechecked.push(media.distribution.checkInvalidation(m.manifestId, { actor: ctx.actor })); } catch (error) { rechecked.push({ manifestId: m.manifestId, error: String(error?.message || error).slice(0, 200) }); }
      }
      return { right, alreadyRevoked, impact, rechecked };
    } });
  reg("media.policy.import_roots", { describe: "Folderele din care se poate importa media locală", channels: OWNER,
    schema: { roots: { type: "array", required: true } },
    execute: (input, ctx) => {
      const roots = [...new Set(input.roots.map((r) => String(r || "").trim()).filter(Boolean))].slice(0, 10);
      const warnings = [];
      for (const r of roots) {
        if (!path.isAbsolute(r)) throw new HubError("validation", `Calea trebuie să fie absolută: ${r}`);
        if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw new HubError("validation", `Folderul nu există: ${r}`);
        const resolved = path.resolve(r);
        // Inside (or equal to) / over the repo or the Hub data is refused; another drive is unrelated (path.relative then returns
        // an absolute path, which is NOT inside — M09 review: that case was refused by mistake).
        const inside = (dir, p) => { const rel = path.relative(dir, p); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
        for (const forbidden of [config.hubRoot, config.dataDir, config.mediaDir].filter(Boolean)) {
          const f = path.resolve(forbidden);
          if (inside(f, resolved) || inside(resolved, f)) throw new HubError("validation", `Folderul nu poate fi în/peste repo sau datele Hub-ului: ${r}`);
        }
        if (isSyncedPath(resolved)) warnings.push(`${r} pare sincronizat în cloud; fișierele importate sunt copiate în biblioteca locală.`);
      }
      hub.bus.transaction(() => settings.set("mediaPolicy", { ...settings.get("mediaPolicy"), importRoots: roots }, ctx.actor, "foldere de import media"));
      return { roots, warnings };
    } });
  // Fail-safe rollback of MEDIA_B/MB1 (owner-facing channels, voice and phone included): live capture goes back to off at once;
  // a browser demo being filmed is aborted; an OBS recording started by the Hub is listed (it stops with "Oprește înregistrarea",
  // which stays allowed after the policy is off — the password is never stored, so the Hub cannot stop OBS by itself).
  reg("media.policy.capture_off", { describe: "Oprește captura live (fail-safe, din orice canal al tău): politica revine la oprit", channels: ANY, async: true,
    schema: { reason: { max: 300, default: "" } },
    execute: async (input, ctx) => {
      const before = settings.get("mediaPolicy") || {};
      hub.bus.transaction(() => {
        settings.set("mediaPolicy", { ...before, liveCapture: false }, ctx.actor, "captura live oprită (fail-safe)");
        hub.bus.append({ type: "media.policy.capture_off", scopeType: "media_policy", scopeId: "liveCapture", source: ctx.actor,
          payload: { channel: ctx.channel, wasOn: before.liveCapture === true, reason: String(input.reason || "").slice(0, 300) } });
      });
      const cancelled = []; const obsRecording = [];
      let recording = [];
      try { recording = media.capture.list({ status: "RECORDING", limit: 50 }); } catch { recording = []; }
      for (const s of recording) {
        if (s.kind === "obs") { obsRecording.push(s.id); continue; }
        try { if (media.capture.cancel(s.id, { actor: ctx.actor })?.cancelled) cancelled.push(s.id); } catch { /* reported by the session row */ }
      }
      return { liveCapture: false, wasOn: before.liveCapture === true, cancelled, obsRecording,
        summary: `Captura live e oprită.${cancelled.length ? ` Am oprit ${cancelled.length} filmări în curs.` : ""}${obsRecording.length ? ` ${obsRecording.length} înregistrări OBS se opresc cu „Oprește înregistrarea”.` : ""}` };
    } });
  reg("media.transcribe", { describe: "Transcrie local sunetul unui asset (whisper-cli, fără rețea; nu e o comandă vocală)", channels: OWNER_UI, async: true,
    schema: { assetVersionId: { required: true, max: 80 }, language: { enum: ["ro", "en", "auto"], default: "ro" } },
    execute: async (input, ctx) => (await media.transcriber.start({ assetVersionId: input.assetVersionId, language: input.language, actor: ctx.actor, channel: ctx.channel })).transcript });
  reg("media.transcribe.cancel", { describe: "Oprește o transcriere media (fail-safe)", channels: ANY, async: true, schema: { transcriptId: { required: true, max: 80 } },
    execute: (input, ctx) => media.transcriber.cancel(input.transcriptId, ctx.actor) });

  // ---------- edit plans, reviews, variants ----------
  reg("media.edit.create", { describe: "Creează un plan de montaj (EditProjectIR validat)", channels: OWNER_UI,
    schema: { contentProjectId: { max: 80 }, title: { required: true, max: 200 }, ir: { type: "object", required: true } },
    execute: (input, ctx) => media.edits.create({ ...input, actor: ctx.actor }) });
  reg("media.edit.patch.propose", { describe: "Propune o corectură la un timecode (nu se aplică singură)", channels: ANY,
    // M10: selectedItemId = the text item the owner selected in the Studio for THIS version (it wins over any guess; a stale one is ignored).
    schema: { editVersionId: { required: true, max: 80 }, text: { required: true, max: 1000 }, timecodeMs: { type: "integer" }, selectedItemId: { max: 80 } },
    execute: (input, ctx) => media.reviews.propose({ ...input, timecodeMs: input.timecodeMs ?? null, selectedItemId: input.selectedItemId || null, provenance: provenanceOf(ctx), actor: ctx.actor, sessionId: session(ctx)?.id || null }) });
  // D7 (2.12.3): a correction Lega proposed as ONE plan (apply → draft render → QA) is applied only by that plan's confirmation in the owner
  // session (the cockpit card or the same card in the Studio). This command never confirms a plan (it also runs on the cookie-less "ui"
  // channel): it refuses a review bound to a live plan, refuses a review whose base a confirmed plan is correcting right now or a proposed
  // (unexpired) plan is waiting to correct (D7 review), and closes the proposed correction plans its own apply / dismissal made obsolete
  // (expired ones; no orphaned card). The plan's step calls media.reviews.apply directly, never this command.
  const reviewPlans = (review) => (review ? hub.opsPlans?.correctionPlans?.({ reviewId: review.id, editVersionId: review.editVersionId }) || [] : []);
  reg("media.edit.patch.apply", { describe: "Aplică o corectură propusă (versiune nouă; originalul rămâne)", channels: OWNER_UI,
    schema: { reviewId: { required: true, max: 80 } }, execute: (input, ctx) => hub.bus.transaction(() => {
      const review = media.reviews.get(input.reviewId);
      const plans = reviewPlans(review);
      const own = plans.find((p) => p.reviewId === review.id && !p.expired);
      if (own) {
        throw new HubError("conflict", own.status === "PROPOSED"
          ? "Corectura asta face parte din planul afișat: îl confirmi o dată și aplic corectura, randez ciorna și rulez QA. Nu o aplic separat."
          : "Corectura e deja în planul confirmat; îl urmărești sau îl continui din cardul planului.", { code: "REVIEW_IN_PLAN", data: { planId: own.id, status: own.status } });
      }
      // A confirmed plan corrects this very version now: a second version from here would make its step fail (REVIEW_STALE).
      const busy = plans.find((p) => p.status !== "PROPOSED" && p.editVersionId === review.editVersionId);
      if (busy) {
        throw new HubError("conflict", "Un plan confirmat corectează chiar acum această versiune; aștept să termine, apoi propui corectura pe versiunea nouă.",
          { code: "EDIT_PLAN_ACTIVE", data: { planId: busy.id, status: busy.status } });
      }
      // D7 review: a correction plan waiting for its ONE confirmation (PROPOSED, not expired) on this very version — the same sentence retyped
      // in the Studio as another review must not take the old path (a version with no render and no QA, the plan quietly closed). The plan's
      // card decides: confirmed, or „Nu acum” (cancelled) and only then a direct apply.
      const waiting = plans.find((p) => p.status === "PROPOSED" && !p.expired && p.editVersionId === review.editVersionId);
      if (waiting) {
        throw new HubError("conflict", "Planul afișat corectează deja această versiune: îl confirmi o dată sau alegi „Nu acum” pe cardul lui; abia apoi poți aplica altă corectură.",
          { code: "EDIT_PLAN_PROPOSED", data: { planId: waiting.id, status: waiting.status, reviewId: waiting.reviewId || null } });
      }
      const out = media.reviews.apply({ reviewId: input.reviewId, actor: ctx.actor });
      if (!out.alreadyApplied) {
        hub.opsPlans?.supersedeCorrections?.({ editVersionId: out.review.editVersionId,
          reason: "Versiunea a fost corectată direct în Studio; planul vechi nu se mai poate aplica. Cere corectura din nou dacă mai e nevoie." });
      }
      return out;
    }) });
  reg("media.edit.patch.dismiss", { describe: "Renunță la o corectură propusă", channels: ANY,
    schema: { reviewId: { required: true, max: 80 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => hub.bus.transaction(() => {
      // Fail-safe on every channel; only a plan already confirmed for this correction decides it (stopped or cancelled from its card).
      const review = media.reviews.get(input.reviewId);
      const confirmed = reviewPlans(review).find((p) => p.reviewId === review.id && p.status !== "PROPOSED");
      if (confirmed) {
        throw new HubError("conflict", "Corectura e în planul confirmat; o oprești sau o anulezi din cardul planului.", { code: "REVIEW_IN_PLAN", data: { planId: confirmed.id, status: confirmed.status } });
      }
      const out = media.reviews.dismiss({ reviewId: input.reviewId, actor: ctx.actor, reason: input.reason });
      hub.opsPlans?.supersedeCorrections?.({ reviewId: input.reviewId, reason: "Ai renunțat la corectură." });
      return out;
    }) });
  reg("media.edit.divergence.record", { describe: "Înregistrează o modificare făcută manual într-un editor (divergență)", channels: OWNER_UI,
    schema: { editVersionId: { required: true, max: 80 }, description: { required: true, max: 2000 }, editor: { max: 40, default: "capcut" }, ir: { type: "object" }, externalFileSha256: { max: 64 } },
    execute: (input, ctx) => media.reviews.recordManualDivergence({ ...input, actor: ctx.actor }) });
  reg("media.review.decide", { describe: "Decizia creativă pe o versiune (aprobarea creativă doar din sesiunea ta; publicarea e separată)", channels: OWNER_UI,
    schema: { editVersionId: { required: true, max: 80 }, kind: { required: true, enum: ["COMMENT", "CHANGES_REQUESTED", "CREATIVE_APPROVED", "REJECTED"] }, note: { max: 2000, default: "" } },
    execute: (input, ctx) => {
      if (input.kind === "CREATIVE_APPROVED") {
        const s = session(ctx);
        if (!s) throw new HubError("authentication", "Aprobarea creativă se dă doar din sesiunea ta de proprietar (Windows Hello)", { data: { needSession: true } });
        if (ctx.channel === "owner") trust.requireFresh(s, "aprobarea creativă");
      }
      return media.reviews.decide({ ...input, actor: ctx.actor, sessionId: session(ctx)?.id || null, channel: ctx.channel });
    } });
  reg("media.variant.derive", { describe: "Creează varianta nativă pentru o platformă (încadrare, text, durată proprii)", channels: OWNER_UI,
    schema: { masterVersionId: { required: true, max: 80 }, platformKey: { required: true, max: 40 }, overrides: { type: "object", default: () => ({}) } },
    execute: (input, ctx) => media.variants.derive({ ...input, actor: ctx.actor }) });

  // ---------- media tools (M10.2): pinning is an explicit act, never a side effect of a read ----------
  // media.tools.pin: the owner's interface, or the `automation` channel for an automatic readiness step of a CONFIRMED ops plan.
  // On automation the Hub checks itself that the named plan is RUNNING with a media.tools.pin step in progress (authority comes
  // from the plan's one confirmation in the owner session, never from the channel label); the plan id is recorded as the actor.
  // A different binary is recorded as CHANGED, never acknowledged by a pin.
  reg("media.tools.pin", { describe: "Fixează ffmpeg/ffprobe (versiune + sha256); un binar schimbat rămâne de confirmat", channels: [...OWNER_UI, "automation"], async: true,
    // `expect` (M10.2 #30): the identity the caller showed (the Studio → Unelte panel, a plan step); compared inside the pin transaction.
    schema: { reason: { max: 200, default: "" }, planId: { max: 80 }, expect: { type: "object" } },
    execute: async (input, ctx) => {
      let actor = ctx.actor;
      if (ctx.channel === "automation") {
        const plan = input.planId ? hub.opsPlans?.view?.(input.planId) : null;
        const step = plan?.status === "RUNNING" ? (plan.steps || []).find((s) => s.kind === "media.tools.pin" && s.status === "RUNNING") : null;
        if (!step) throw new HubError("policy", "Fixarea automată a uneltelor media rulează doar ca pas în curs al unui plan confirmat.", { code: "PIN_NOT_IN_PLAN" });
        actor = plan.id;
      }
      const r = await media.tools.pin({ actor, reason: input.reason || (ctx.channel === "automation" ? "pas de pregătire al planului confirmat" : ""), expect: input.expect || null });
      return { pinned: r.pinned, changed: r.changed, unchanged: r.unchanged, states: r.tools.states, problems: r.tools.problems, actor };
    } });
  reg("media.tools.acknowledge", { describe: "Confirmă un binar ffmpeg/ffprobe schimbat (identitatea nouă devine cea fixată)", channels: OWNER, async: true,
    // The identity the owner was shown (sha256, shared libraries — "none" for a static build — and version): a binary that changed
    // again since the panel was drawn is refused (TOOL_CHANGED_AGAIN), never acknowledged as what was seen.
    schema: { tool: { required: true, enum: ["ffmpeg", "ffprobe"] }, sha256: { max: 64 }, libsSha256: { max: 64 }, version: { max: 80 } },
    execute: (input, ctx) => media.tools.acknowledgeChange(input.tool, ctx.actor, { sha256: input.sha256 || null, libsSha256: input.libsSha256 ?? undefined, version: input.version ?? undefined }) });

  // ---------- renders, QA, exports ----------
  reg("media.render.request", { describe: "Cere o randare locală (schiță sau finală)", channels: OWNER_UI,
    schema: { editVersionId: { required: true, max: 80 }, profile: { enum: ["draft", "final"], default: "draft" } },
    execute: (input, ctx) => { const job = media.render.request({ ...input, actor: ctx.actor }); kick(); return job; } });
  reg("media.render.retry", { describe: "Reia o randare eșuată (refolosește segmentele validate)", channels: OWNER_UI, schema: { jobId: { required: true, max: 80 } },
    execute: (input, ctx) => { const job = media.render.retry(input.jobId, ctx.actor); kick(); return job; } });
  reg("media.render.cancel", { describe: "Oprește o randare (fail-safe)", channels: ANY, async: true, schema: { jobId: { required: true, max: 80 } },
    execute: (input, ctx) => media.render.cancel(input.jobId, ctx.actor) });
  reg("media.qa.run", { describe: "Rulează QA (tehnic, editorial, factual, drepturi) pe o versiune randată", channels: OWNER_UI, async: true,
    schema: { editVersionId: { required: true, max: 80 }, assetVersionId: { max: 80 }, renderJobId: { max: 80 }, platform: { max: 40 }, use: { enum: ["organic", "paid", "case_study"], default: "organic" } },
    execute: (input, ctx) => media.qa.run({ ...input, actor: ctx.actor }) });
  reg("media.export.otio", { describe: "Exportă timeline-ul în OpenTimelineIO", channels: OWNER_UI, schema: { editVersionId: { required: true, max: 80 } },
    execute: (input, ctx) => media.editors.writeOtio({ editVersionId: input.editVersionId, actor: ctx.actor }) });
  reg("media.export.edl", { describe: "Exportă lista de tăieturi (EDL CMX3600)", channels: OWNER_UI, schema: { editVersionId: { required: true, max: 80 } },
    execute: (input, ctx) => media.editors.writeEdl({ editVersionId: input.editVersionId, actor: ctx.actor }) });
  reg("media.export.capcut_pack", { describe: "Pregătește pachetul asistat pentru CapCut (materiale + pași; proiectele CapCut nu sunt editate)", channels: OWNER_UI, async: true,
    schema: { editVersionId: { required: true, max: 80 }, platform: { max: 40 } },
    execute: (input, ctx) => media.editors.exportAssistedPack({ editVersionId: input.editVersionId, platform: input.platform || null, actor: ctx.actor }) });

  // ---------- capture ----------
  reg("media.capture.plan", { describe: "Planifică o sesiune de captură (nu înregistrează nimic)", channels: OWNER_UI,
    schema: { contentProjectId: { max: 80 }, kind: { required: true, enum: ["obs", "browser_demo", "import", "interview"] }, scope: { type: "object", default: () => ({}) }, captureLabel: { max: 40 } },
    execute: (input, ctx) => media.capture.planSession({ ...input, actor: ctx.actor }) });
  reg("media.capture.marker", { describe: "Adaugă un marker (problemă, test, rezultat, înainte/după)", channels: OWNER_UI,
    schema: { sessionId: { required: true, max: 80 }, kind: { required: true, max: 30 }, atMs: { type: "integer", required: true }, note: { max: 300, default: "" } },
    execute: (input, ctx) => media.capture.addMarker(input.sessionId, { kind: input.kind, atMs: input.atMs, note: input.note }, { actor: ctx.actor }) });
  reg("media.capture.cancel", { describe: "Oprește o captură (fail-safe)", channels: ANY, schema: { sessionId: { required: true, max: 80 } },
    execute: (input, ctx) => media.capture.cancel(input.sessionId, { actor: ctx.actor }) });
  reg("media.capture.demo", { describe: "Filmează o demonstrație într-o instanță de test (Public Demo Mode; nu Hub-ul tău live)", channels: OWNER_UI, async: true,
    schema: { origin: { required: true, max: 200 }, steps: { type: "array", required: true }, captureLabel: { required: true, max: 40 }, title: { max: 200, default: "" },
      contentProjectId: { max: 80 }, viewport: { type: "object" }, deviceScaleFactor: { type: "number" }, fps: { type: "integer" }, redactSelectors: { type: "array" }, sessionId: { max: 80 } },
    execute: (input, ctx) => {
      // Only origins the owner listed (a simulator / demo instance); the live Hub stays refused while liveCapture is off.
      const allowed = new Set((settings.get("mediaPolicy")?.demoOrigins || []).map((o) => String(o).replace(/\/+$/, "")));
      return media.capture.captureBrowserDemo({ ...input, allowOrigin: (origin) => allowed.has(String(origin).replace(/\/+$/, "")), actor: ctx.actor });
    } });
  reg("media.capture.obs.start", { describe: "Pornește înregistrarea OBS (oprită de politică în M09)", channels: OWNER, async: true,
    schema: { sessionId: { required: true, max: 80 }, password: { max: 200 } },
    logPayload: (input) => ({ sessionId: input.sessionId, password: input.password ? "[ascuns]" : null }),
    execute: (input, ctx) => media.capture.startObsRecording(input.sessionId, { password: input.password || null, actor: ctx.actor }) });
  reg("media.capture.obs.stop", { describe: "Oprește înregistrarea OBS (fail-safe)", channels: ANY, async: true,
    schema: { sessionId: { required: true, max: 80 }, password: { max: 200 } },
    logPayload: (input) => ({ sessionId: input.sessionId, password: input.password ? "[ascuns]" : null }),
    execute: (input, ctx) => media.capture.stopObsRecording(input.sessionId, { password: input.password || null, actor: ctx.actor }) });

  // ---------- distribution (manifests, packs, manual records; no API upload in M09) ----------
  reg("content.manifest.build", { describe: "Construiește pachetul exact de variante pentru distribuție (ciornă)", channels: OWNER_UI,
    schema: { contentProjectId: { required: true, max: 80 }, variants: { type: "array", required: true } },
    execute: (input, ctx) => media.distribution.buildManifest({ ...input, actor: ctx.actor }) });
  reg("content.manifest.approve", { describe: "Aprobă pachetul exact văzut (Windows Hello); fiecare încărcare rămâne o acțiune separată", channels: OWNER,
    schema: { manifestId: { required: true, max: 80 }, manifestSha256: { required: true, pattern: /^[0-9a-f]{64}$/ }, note: { max: 500, default: "" } },
    execute: (input, ctx) => {
      const s = session(ctx);
      if (!s) throw new HubError("authentication", "Aprobarea se dă doar din sesiunea ta de proprietar (Windows Hello)", { data: { needSession: true } });
      if (ctx.channel === "owner") trust.requireFresh(s, "aprobarea pachetului de distribuție");
      return media.distribution.approve({ manifestId: input.manifestId, actor: ctx.actor,
        approval: { manifestSha256: input.manifestSha256, channel: ctx.channel, sessionId: s.id, via: "owner_session", note: input.note } });
    } });
  reg("content.release.prepare_pack", { describe: "Pregătește pachetul manual pentru o platformă (video, text, copertă, checklist)", channels: OWNER_UI, async: true,
    schema: { manifestId: { required: true, max: 80 }, platform: { required: true, max: 40 } },
    execute: (input, ctx) => media.distribution.preparePack({ ...input, actor: ctx.actor }) });
  reg("content.release.record_manual", { describe: "Înregistrează că ai postat manual (cu linkul)", channels: OWNER,
    schema: { attemptId: { required: true, max: 80 }, url: { required: true, max: 500 }, postedAt: { max: 40 }, note: { max: 500, default: "" } },
    execute: (input, ctx) => media.distribution.recordManual({ ...input, postedAt: input.postedAt || null, actor: ctx.actor }) });
  reg("content.release.cancel", { describe: "Anulează o încercare de distribuție (fail-safe)", channels: ANY,
    schema: { attemptId: { required: true, max: 80 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => media.distribution.cancel({ ...input, actor: ctx.actor }) });

  // ---------- analytics, experiments, insights ----------
  reg("content.metrics.import", { describe: "Importă metrici din exportul tău (CSV); lipsa nu devine zero", channels: OWNER_UI,
    schema: { platform: { required: true, max: 40 }, csvText: { required: true, max: 2_000_000, trim: false }, mapping: { type: "object", required: true },
      attemptId: { max: 80 }, contentProjectId: { max: 80 }, observedAt: { max: 40 }, window: { max: 20, default: "" }, decimal: { max: 1 } },
    logPayload: (input) => ({ platform: input.platform, attemptId: input.attemptId || null, contentProjectId: input.contentProjectId || null, bytes: String(input.csvText || "").length }),
    execute: (input, ctx) => media.analytics.importManual({ ...input, actor: ctx.actor }) });
  reg("content.experiment.register", { describe: "Înregistrează un experiment înainte de rezultate (nu se mai schimbă după)", channels: OWNER_UI,
    schema: { experiment: { type: "object", required: true } }, execute: (input, ctx) => media.analytics.registerExperiment({ ...input.experiment, actor: ctx.actor }) });
  reg("content.experiment.analyze", { describe: "Analizează un experiment după regula înregistrată", channels: OWNER_UI,
    schema: { experimentId: { required: true, max: 80 } }, execute: (input, ctx) => media.analytics.analyzeExperiment(input.experimentId, { actor: ctx.actor }) });
  reg("content.insight.propose", { describe: "Propune o concluzie (ipoteză, cu eșantion și limite)", channels: OWNER_UI,
    schema: { insight: { type: "object", required: true } }, execute: (input, ctx) => media.analytics.proposeInsight({ ...input.insight, actor: ctx.actor }) });
  reg("content.insight.status", { describe: "Schimbă starea unei concluzii (după regulile de dovadă)", channels: OWNER_UI,
    schema: { insightId: { required: true, max: 80 }, status: { required: true, max: 40 }, experimentId: { max: 80 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => media.analytics.setInsightStatus(input.insightId, input.status, { experimentId: input.experimentId || null, actor: ctx.actor, reason: input.reason }) });

  // ---------- campaigns & Sales link ----------
  reg("content.campaign.save", { describe: "Creează sau modifică o campanie (buget aprobat explicit, implicit 0)", channels: OWNER_UI,
    schema: { campaign: { type: "object", required: true } }, execute: (input, ctx) => media.campaigns.saveCampaign(input.campaign, ctx.actor) });
  reg("content.campaign.attach", { describe: "Leagă un proiect de conținut de o campanie", channels: OWNER_UI,
    schema: { campaignId: { required: true, max: 80 }, contentProjectId: { required: true, max: 80 } },
    execute: (input, ctx) => media.campaigns.attachProject({ ...input, actor: ctx.actor }) });
  reg("content.opportunity.link", { describe: "Leagă conținutul de o oportunitate Sales existentă (fără atribuire inventată)", channels: OWNER_UI,
    schema: { contentProjectId: { required: true, max: 80 }, opportunityId: { required: true, max: 80 }, note: { max: 500, default: "" }, replace: { type: "boolean", default: false } },
    execute: (input, ctx) => media.campaigns.linkOpportunity({ ...input, actor: ctx.actor }) });
  reg("content.funnel.record", { describe: "Înregistrează un eveniment (click, lead, propunere, contract, încasare) cu sursa lui", channels: OWNER_UI,
    schema: { event: { type: "object", required: true } }, execute: (input, ctx) => media.campaigns.recordFunnelEvent({ ...input.event, actor: ctx.actor }) });
}
