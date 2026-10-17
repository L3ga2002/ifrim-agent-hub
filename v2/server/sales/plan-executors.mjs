import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { writeNew } from "../delivery/files.mjs";
import { verifyPackageFolder } from "../delivery/office-executors.mjs";
import { checkDocxFile, verifyDocxInWord, officeExe } from "../office/office.mjs";
import { LIVE_COLLECTION_DISABLED } from "./research.mjs";
import { syntheticOrgFor } from "./synthetic.mjs";
import { allowedCatalogTexts, proposalFigures } from "./figures.mjs";
import { findUnresolvedPlaceholders } from "./proposal.mjs";
import { DOSSIER_KIND, DOSSIER_PLAN_TITLE, ACTIVATE_WITHIN_MIN, SALES_DECISIONS_LEFT, SALES_NEVER, dossierSteps, phaseBLimits, realInside } from "./preparation.mjs";
import { dossierArtifacts, dossierFigures, dossierArtifactReuse, dossierReadme, dossierManifest, proposalDocxModel, expectedDocxShape, DOSSIER_EXTS, DOSSIER_GENERATORS } from "./dossier.mjs";

/**
 * M12 Sales plan steps (ops/plans.mjs executors: describe → run → reconcile). Every step:
 * - acts only for the preparation bound to ITS plan (SALES_NOT_BOUND otherwise) and re-reads its inputs (a changed input refuses);
 * - asks authorize() immediately before its committing transaction (no await in between), so a pause, a Stop All, a revocation or an
 *   expiry stops it with no partial effect;
 * - writes through the C-01 ledger (plan-ledger.mjs) keyed by the owner-confirmed root plan: a resume, a concurrent call or a
 *   continuation never repeats an effect (rows, files, events);
 * - and holds no owner identity: the plan's session id authorizes the plan's own operations only. Nothing here approves the offer,
 *   overrides a qualification, sends, contacts, hands off, deletes or starts a model.
 */
const OWNER_STOP = new Set(["STOPPED", "PAUSED", "PLAN_NOT_RUNNING", "SESSION_CLOSED", "PLAN_EXPIRED", "PLAN_BUDGET", "STEP_NOT_RUNNING", "HUB_SHUTDOWN"]);
const PREP_ID = /^spp_[A-Za-z0-9_]+$/;
const arr = (v) => (Array.isArray(v) ? v : []);

export function createSalesPlanExecutors({ sales, preparations, ledger, opsPlans, media, config, bus,
  appCheck = (config?.testMode && process.env.HUB_V2_OFFICE_COM !== "1") ? "skip" : "com", verifyDocx = verifyDocxInWord, officeAvailable = () => Boolean(officeExe("docx")) }) {
  const actorOf = (planId) => `plan:${planId}`;
  const checkAbort = (abort) => { if (abort?.aborted) throw new HubError("conflict", `Oprit: ${abort.reason || "pauză"}`, { code: "STOPPED" }); };
  const needPrepId = (id) => { if (!PREP_ID.test(String(id || ""))) throw new HubError("validation", "Pasul cere pregătirea (spp_…)"); return String(id); };
  const emit = (type, scopeId, payload, source) => bus.append({ type, scopeType: "sales", scopeId, source, payload });
  const workDir = () => path.join(config?.workDir || path.join(config?.dataDir || ".", "work"), "office");
  /** A reconcile answers „done” only for an operation the ledger records as DONE for THIS plan's preparation; anything else re-runs (idempotent). */
  const reconcileWith = (fn) => async (ctx) => { try { return (await fn(ctx)) || { outcome: "retry" }; } catch (error) { return { outcome: "retry", detail: String(error?.message || error).slice(0, 200) }; } };
  const catalogOf = (content) => {
    const refs = new Set(arr(content?.serviceIds));
    return sales.listServices({ activeOnly: false }).filter((s) => refs.has(`${s.id}@${s.version}`));
  };

  // ---------------------------------------------------------------- A1 synthetic client (S-02)
  const keyA1 = (p) => ({ preparationId: p.id, briefSha: p.briefSha });
  // ---------------------------------------------------------------- A2 fixture research (S-03)
  const keyA2 = (p, org) => ({ preparationId: p.id, orgId: org.id, host: org.domain });
  // ---------------------------------------------------------------- A3 q-v2 qualification (S-04, C-04)
  const keyA3 = (p, basis) => ({ preparationId: p.id, orgId: p.orgId, evidenceSha: basis.evidence, formula: "q-v2" });

  /** The dossier's facts in ONE synchronous read: refused (no folder, no row) unless the offer is exactly the one the owner approved. */
  function readFacts(p) {
    const view = sales.getOpportunity(p.opportunityId);
    if (!view.org?.synthetic || !view.opportunity?.synthetic) throw new HubError("policy", "Dosarul ofertei se scrie doar pentru o firmă sintetică.", { code: "SALES_DOSSIER_NOT_SYNTHETIC" });
    const ok = preparations.approvedExactly(p);
    if (!ok.ok) throw new HubError("conflict", `Dosarul se scrie doar pentru oferta aprobată de tine, exact cum a fost pregătită: ${ok.reason}`, { code: "SALES_DOSSIER_NOT_APPROVED" });
    const proposal = ok.proposal;
    if (!/^[0-9a-f]{64}$/.test(String(p.awaited?.proposalSha || "")) || proposal.contentSha !== p.awaited.proposalSha || proposal.approvedSha !== p.awaited.proposalSha) {
      throw new HubError("conflict", "Oferta aprobată nu are SHA-ul complet așteptat.", { code: "SALES_DOSSIER_NOT_APPROVED" });
    }
    const draft = view.drafts[0] || null;
    if (!draft || draft.proposalId !== proposal.id || draft.meta?.proposalSha !== proposal.contentSha || !["DRAFT", "CONTENT_APPROVED"].includes(draft.status)) {
      throw new HubError("conflict", "Ciorna nu e făcută din oferta aprobată (pasul ciornei).", { code: "SALES_DOSSIER_NOT_APPROVED" });
    }
    const sheet = sales.getOrg(view.org.id);
    const inputs = preparations.dossierInputs(p.opportunityId);
    return { proposal, draft, org: view.org, opportunity: view.opportunity, contacts: sheet.contacts, evidence: sheet.evidence, unknowns: sheet.unknowns, qualification: sheet.qualification,
      qualificationHistory: sheet.qualificationHistory, brief: p.brief, services: catalogOf(proposal.content), inputs, inputsSha: hashCanonical(inputs) };
  }

  /** The dossier write (claimed key): files created exclusively, Word checked (or APP_NOT_RUN declared), README, manifest last, self-check. */
  async function writeDossier({ p, facts, target, claim, planId, authorize, abort, exportsDir }) {
    const actor = actorOf(planId);
    const files = [];
    const reused = [];
    let dossier = null;
    let verification = null;
    try {
      // 1. Everything the folder will hold is built (pure) and checked before anything is created: C-02 figures, placeholders.
      const artifacts = dossierArtifacts(facts);
      const figures = dossierFigures(artifacts, { allow: allowedCatalogTexts(facts.services) });
      if (figures.length) throw new HubError("policy", `Dosarul ar conține cifre comerciale neconfigurate (${figures.slice(0, 3).map((f) => `„${f.text}”`).join(", ")}); nu îl scriu.`, { code: "SALES_DOSSIER_FIGURES" });
      // 2. The folder: the one this key reserved (a resume), or a new one created exclusively — never a folder the Hub did not create.
      if (!target.existing && fs.existsSync(target.folder)) throw new HubError("conflict", `Folderul ${path.basename(target.folder)} există deja și nu e al acestui dosar; nu scriu în el.`, { code: "SALES_DOSSIER_FOLDER_TAKEN" });
      authorize({ op: "export.local", destination: path.join(target.folder, "README.md") });
      const reserved = preparations.reserveDossier({ p, target, facts, fixedAt: claim.fixedAt, planId, actor });
      dossier = reserved.dossier;
      fs.mkdirSync(path.dirname(target.folder), { recursive: true });
      if (fs.existsSync(target.folder)) { if (!reserved.resumed) throw new HubError("conflict", "Folderul revizei a apărut între timp; nu scriu în el.", { code: "SALES_DOSSIER_FOLDER_TAKEN" }); }
      else {
        try { fs.mkdirSync(target.folder); }
        catch (error) { if (error.code === "EEXIST") throw new HubError("conflict", "Folderul revizei a apărut între timp; nu scriu în el.", { code: "SALES_DOSSIER_FOLDER_TAKEN" }); throw error; }
      }
      if (!realInside(exportsDir, target.folder)) throw new HubError("policy", "Folderul dosarului iese din folderul de exporturi aprobat.", { code: "SALES_DOSSIER_OUTSIDE" });
      const prior = reserved.resumed ? dossier : null;
      // 3. The artifacts: the bytes of an earlier revision when the rebuild proves them identical (R-REV), copied here (R-PACK).
      const previous = preparations.previousDossier(p.opportunityId, dossier.id);
      for (const a of artifacts) {
        checkAbort(abort);
        const proof = dossierArtifactReuse({ previous, artifact: a });
        const buf = proof ? proof.buf : a.buf;
        authorize({ op: "export.local", destination: path.join(target.folder, a.path) });
        const w = writeNew(target.folder, a.path, buf, { root: exportsDir, exts: DOSSIER_EXTS, exclusive: true });
        files.push({ path: a.path, bytes: buf.length, sha256: w.sha256, inputsSha: a.inputsSha, generator: a.generator, ...(proof ? { reusedFrom: proof.reusedFrom } : {}) });
        if (proof) reused.push({ file: a.path, sha256: w.sha256, source: { dossierId: proof.reusedFrom.dossierId, revision: proof.reusedFrom.revision }, inputsSha: a.inputsSha,
          reason: "aceleași intrări; regenerat = aceiași octeți", copiedVerified: true });
        preparations.recordDossierFiles(dossier.id, files);
      }
      // 4. The Word document: read back as a file, then in Word itself (own invisible instance, read-only) — or APP_NOT_RUN, declared.
      const docx = files.find((f) => f.path.endsWith(".docx"));
      const docxFile = path.join(target.folder, docx.path);
      const shape = expectedDocxShape(proposalDocxModel({ proposal: facts.proposal }));
      const fileCheck = checkDocxFile(docxFile, shape);
      if (!fileCheck.ok) throw new HubError("tool", `Documentul Word salvat nu are structura ofertei: ${fileCheck.problems.join("; ")}`, { code: "OFFICE_VERIFY_FAILED" });
      verification = await wordCheck({ dossier, prior, previous, docx, docxFile, shape, facts, target, files, reused, authorize, abort, exportsDir });
      preparations.recordDossierFiles(dossier.id, files, { verification });
      if (verification.proposalDocx.app === "APP_FAILED") throw new HubError("tool", `Word nu confirmă documentul: ${verification.proposalDocx.note}`, { code: "OFFICE_VERIFY_FAILED" });
      // 5. The inputs read again (they could change while Word ran): a change stops here, before README and the manifest.
      if (hashCanonical(preparations.dossierInputs(p.opportunityId)) !== facts.inputsSha) {
        throw new HubError("conflict", "Oferta, ciorna sau dovezile s-au schimbat în timpul scrierii dosarului; nu îl închei.", { code: "SALES_DOSSIER_INPUTS_CHANGED" });
      }
      // 6. README (listed and hashed in the manifest), then the manifest, written LAST.
      checkAbort(abort);
      const readme = dossierReadme({ dossierId: dossier.id, revision: dossier.revision, createdAt: dossier.createdAt, opportunityId: p.opportunityId, proposal: facts.proposal, draft: facts.draft,
        files, verification, reused });
      authorize({ op: "export.local", destination: path.join(target.folder, "README.md") });
      const wr = writeNew(target.folder, "README.md", readme, { root: exportsDir, exts: DOSSIER_EXTS, exclusive: true });
      files.push({ path: "README.md", bytes: readme.length, sha256: wr.sha256, inputsSha: hashCanonical({ generator: DOSSIER_GENERATORS.readme, files: files.map((f) => f.sha256), verification }), generator: DOSSIER_GENERATORS.readme });
      const manifest = dossierManifest({ dossierId: dossier.id, revision: dossier.revision, folderName: path.basename(target.folder), createdAt: dossier.createdAt, opportunityId: p.opportunityId,
        orgId: facts.org.id, proposal: facts.proposal, draft: facts.draft, qualification: facts.qualification, plan: { rootPlanId: p.rootPlanId, rootPlanHash: p.rootPlanHash, opKey: claim.key },
        files, reused, verification });
      authorize({ op: "export.local", destination: path.join(target.folder, "manifest.json") });
      const wm = writeNew(target.folder, "manifest.json", manifest, { root: exportsDir, exts: DOSSIER_EXTS, exclusive: true });
      preparations.recordDossierFiles(dossier.id, files, { verification });
      // 7. The folder verifies on its own (manifest → every file by sha; nothing unlisted; reused files local).
      const self = verifyPackageFolder(target.folder);
      if (!self.ok) throw new HubError("tool", `Dosarul nu se verifică singur: ${self.problems.join("; ")}`, { code: "SALES_DOSSIER_NOT_SELF_CONTAINED" });
      // 8. The final transaction (the ledger's completion): READY, older revisions SUPERSEDED, the preparation READY, one event.
      checkAbort(abort);
      authorize({ op: "sales.dossier" });
      return ledger.complete({ key: claim.key, token: claim.token, effect: () => {
        const d = preparations.completeDossier({ dossierId: dossier.id, planId, files, verification, manifestSha: wm.sha256, reused, actor });
        return { dossierId: d.id, revision: d.revision, folder: target.folder, file: path.join(target.folder, "manifest.json"), sha256: wm.sha256, files: files.length, verification,
          reused: reused.map((r) => ({ file: r.file, sha256: r.sha256, from: r.source })), opportunityId: p.opportunityId, preparationId: p.id };
      } });
    } catch (error) {
      const code = error?.code || "FAILED";
      const stop = OWNER_STOP.has(code);
      // The partial effect is declared: the files written so far stay listed; a stop that cannot finish is INCOMPLETE (no manifest).
      if (dossier) preparations.recordDossierFiles(dossier.id, files, stop ? { verification } : { incomplete: `${code}: ${String(error?.message || "").slice(0, 200)}`, verification });
      ledger.release({ key: claim.key, token: claim.token, failed: !stop, error: `${code}: ${String(error?.message || "").slice(0, 200)}` });
      throw error;
    }
  }

  /** The Word level of the offer document: carried from a proven reuse, kept from this dossier's own earlier attempt, or checked now. */
  async function wordCheck({ dossier, prior, previous, docx, docxFile, shape, facts, target, files, reused, authorize, abort, exportsDir }) {
    const base = { file: "FILE_CHECKED", headings: shape.headings.length, tables: shape.tables.length };
    const pdfName = docx.path.replace(/\.docx$/i, ".pdf");
    /**
     * The PDF Word exported (in the Hub's work folder) or the previous revision's verified PDF, copied into the dossier with COPYFILE_EXCL:
     * never over an existing name; an existing file with the same bytes is this dossier's own earlier copy (a resume).
     */
    const keepPdf = (source, from) => {
      const dest = path.join(target.folder, pdfName);
      authorize({ op: "export.local", destination: dest });
      const bytes = fs.readFileSync(source);
      try { fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (sha256(fs.readFileSync(dest)) !== sha256(bytes)) throw new HubError("conflict", `Există deja ${pdfName} cu alt conținut; nu îl suprascriu.`, { code: "DELIVERY_FILE_TAKEN" });
      }
      const copied = sha256(fs.readFileSync(dest));
      if (copied !== sha256(bytes)) throw new HubError("tool", "Copia PDF-ului nu are aceiași octeți.", { code: "DELIVERY_FILE_VERIFY" });
      files.push({ path: pdfName, bytes: bytes.length, sha256: copied, inputsSha: hashCanonical({ generator: DOSSIER_GENERATORS.pdf, docx: docx.sha256 }), generator: DOSSIER_GENERATORS.pdf, ...(from ? { reusedFrom: from } : {}) });
      return copied;
    };
    // This dossier's own earlier attempt already verified this exact document in Word (a resume): its PDF is in the folder already.
    const own = prior?.verification?.proposalDocx;
    if (own?.app === "APP_VERIFIED" && own.docxSha256 === docx.sha256 && own.pdf) {
      const pdfFile = path.join(target.folder, own.pdf);
      try { if (sha256(fs.readFileSync(pdfFile)) === own.pdfSha256 && keepPdf(pdfFile, null) === own.pdfSha256) return { proposalDocx: { ...own } }; } catch { /* checked again below */ }
    }
    // A document reused by proof from the previous revision carries its Word check when its PDF is still the recorded one (R-PACK).
    const prev = previous?.verification?.proposalDocx;
    if (docx.reusedFrom && prev?.app === "APP_VERIFIED" && prev.pdf && prev.docxSha256 === docx.sha256) {
      try {
        const source = path.join(previous.folder, prev.pdf);
        if (sha256(fs.readFileSync(source)) === prev.pdfSha256) {
          const pdfSha = keepPdf(source, { dossierId: previous.id, revision: previous.revision, file: prev.pdf, sha256: prev.pdfSha256 });
          reused.push({ file: pdfName, sha256: pdfSha, source: { dossierId: previous.id, revision: previous.revision }, inputsSha: hashCanonical({ generator: DOSSIER_GENERATORS.pdf, docx: docx.sha256 }),
            reason: "documentul refolosit fusese verificat în Word; PDF-ul lui, copiat", copiedVerified: true });
          return { proposalDocx: { ...prev, docxSha256: docx.sha256, pdf: pdfName, pdfSha256: pdfSha, reusedFrom: { dossierId: previous.id, revision: previous.revision } } };
        }
      } catch { /* checked again below */ }
    }
    checkAbort(abort);
    authorize({ op: "office.verify" });
    if (appCheck !== "com") return { proposalDocx: { ...base, app: "APP_NOT_RUN", docxSha256: docx.sha256, note: "Verificarea în Word nu rulează în acest mediu (fără Office): documentul e verificat doar ca fișier." } };
    if (!officeAvailable()) return { proposalDocx: { ...base, app: "APP_NOT_RUN", docxSha256: docx.sha256, note: "Microsoft Word nu e instalat pe acest calculator: documentul e verificat doar ca fișier." } };
    const work = workDir();
    fs.mkdirSync(work, { recursive: true });
    // Word exports the PDF in the Hub's own work folder (it would write over a path itself); the bytes are then copied exclusively.
    const pdfOut = path.join(work, `${dossier.id}-${path.basename(pdfName)}`);
    const r = await verifyDocx(docxFile, shape, { pdfOut, workDir: work });
    if (!r.ok) return { proposalDocx: { ...base, app: "APP_FAILED", level: r.level || "APP_FAILED", docxSha256: docx.sha256, note: String(r.error || arr(r.problems).join("; ") || r.level).slice(0, 300) } };
    const pdfSha = keepPdf(r.pdf || pdfOut, null);
    return { proposalDocx: { ...base, app: "APP_VERIFIED", appName: r.app || "Microsoft Word", appVersion: r.version || null, pages: r.pages ?? null, docxSha256: docx.sha256, pdf: pdfName, pdfSha256: pdfSha,
      note: "Deschis în Word (instanță proprie, invizibilă, doar citire): titluri și liste verificate, PDF exportat." } };
  }

  const executors = {
    "sales.synthetic": {
      describe: ({ preparationId, briefSha, continues = null }) => {
        needPrepId(preparationId);
        if (!/^[0-9a-f]{64}$/.test(String(briefSha || ""))) throw new HubError("validation", "Pasul cere amprenta brief-ului");
        const cont = continues && typeof continues === "object" ? { rootPlanId: String(continues.rootPlanId || ""), rootPlanHash: String(continues.rootPlanHash || "") } : null;
        return { title: cont ? "Reia firma și oportunitatea sintetice ale pregătirii (ce e deja făcut nu se repetă)" : "Creează firma și oportunitatea sintetice din brief (domeniu .test, CUI fictiv 99…, marcate „sintetic”)",
          params: { preparationId, briefSha, ...(cont ? { continues: cont } : {}) }, ops: [{ op: "sales.synthetic" }],
          observed: ["brieful cererii tale (doar ce ai spus; nicio firmă reală)"], transmitted: [], outputs: ["o firmă și o oportunitate sintetice, cu dovezile lor (FIXTURE, afirmații, inferențe)"] };
      },
      run: async ({ planId, params, authorize, abort, plan }) => {
        checkAbort(abort);
        const p = preparations.enterPlan(params.preparationId, plan);
        if (p.briefSha !== params.briefSha || hashCanonical(p.brief) !== p.briefSha) throw new HubError("conflict", "Brieful s-a schimbat față de planul confirmat.", { code: "SALES_INPUTS_CHANGED" });
        const identity = syntheticOrgFor(p.brief, p.rootPlanId);
        authorize({ op: "sales.synthetic" });
        const out = ledger.runSync({ root: preparations.rootOf(p), op: "sales.synthetic", keyParams: keyA1(p), params: { seed: p.rootPlanId, generator: identity.generator },
          effect: ({ key }) => {
            const r = sales.createPreparationOrg({ identity, brief: p.brief, preparationId: p.id, actor: actorOf(planId) });
            emit("sales.synthetic.created", p.id, { preparationId: p.id, orgId: r.orgId, opportunityId: r.opportunityId, opKey: key.slice(0, 16) }, actorOf(planId));
            return { orgId: r.orgId, opportunityId: r.opportunityId, problemEvidenceId: r.problemEvidenceId, domain: identity.domain };
          },
          after: (result) => preparations.enterPreparing(preparations.need(p.id), plan, result) });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.planId !== planId || p.status === "PLANNED") return null;
        const s = ledger.status({ root: preparations.rootOf(p), op: "sales.synthetic", keyParams: keyA1(p) });
        return s.status === "DONE" ? { outcome: "done", result: s.result, detail: "registrul planului: făcut" } : null;
      }),
    },

    "sales.research": {
      describe: ({ preparationId, mode = "fixture" }) => {
        needPrepId(preparationId);
        if (mode !== "fixture") throw new HubError("policy", "Colectarea live e dezactivată (LIVE_COLLECTION_DISABLED): cercetarea folosește doar site-uri fixture.", { code: LIVE_COLLECTION_DISABLED });
        return { title: "Cercetează site-ul firmei sintetice doar din fixture-uri (fără colectare live); ce nu are dovadă rămâne UNKNOWN", params: { preparationId, mode: "fixture" },
          ops: [{ op: "sales.research" }], observed: ["pagina fixture a domeniului .test, dacă există"], transmitted: [], outputs: ["dovezi cu proveniență sau un rând UNKNOWN „neverificat”"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        checkAbort(abort);
        // A live request is refused before anything (the plan card could not carry it; this is the second wall).
        if (params.mode !== "fixture") await sales.fixturePage("refuzat.test", { mode: String(params.mode || "live") });
        for (;;) {
          const p = preparations.bound(params.preparationId, planId);
          const org = sales.getOrg(p.orgId).org;
          if (!org.synthetic) throw new HubError("policy", "Cercetarea M12 e doar pentru firme sintetice.", { code: "SALES_NOT_SYNTHETIC" });
          const c = ledger.claim({ root: preparations.rootOf(p), op: "sales.research", keyParams: keyA2(p, org), params: { adapter: "fixture-v1" } });
          if (c.done) return { result: { ...c.result, duplicate: true, opKey: c.key } };
          if (c.inProgress) { await c.promise; checkAbort(abort); continue; }
          let research;
          try { research = await sales.fixturePage(org.domain, { mode: "fixture" }); }
          catch (error) { ledger.release({ key: c.key, token: c.token, failed: true, error: error.message }); throw error; }
          // The page was read asynchronously: a stop that landed meanwhile wins; the claim stays open with no effect (a resume retries).
          try { checkAbort(abort); authorize({ op: "sales.research" }); }
          catch (error) { ledger.release({ key: c.key, token: c.token }); throw error; }
          const result = ledger.complete({ key: c.key, token: c.token, effect: () => {
            preparations.bound(p.id, planId);
            const r = sales.recordResearch(org.id, research, actorOf(planId));
            emit("sales.research.recorded", p.id, { preparationId: p.id, orgId: org.id, found: Boolean(research.found), evidence: r.evidenceIds.length, opKey: c.key.slice(0, 16) }, actorOf(planId));
            return { orgId: org.id, host: org.domain, found: Boolean(research.found), adapter: research.adapter, evidenceIds: r.evidenceIds, auditId: r.auditId };
          } });
          return { result: { ...result, duplicate: false, opKey: c.key } };
        }
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.planId !== planId || !p.orgId) return null;
        const s = ledger.status({ root: preparations.rootOf(p), op: "sales.research", keyParams: keyA2(p, sales.getOrg(p.orgId).org) });
        return s.status === "DONE" ? { outcome: "done", result: s.result, detail: "registrul planului: făcut" } : null;
      }),
    },

    "sales.qualify": {
      describe: ({ preparationId, formula = "q-v2" }) => {
        needPrepId(preparationId);
        if (formula !== "q-v2") throw new HubError("validation", "Pregătirea M12 califică doar cu formula q-v2.");
        return { title: "Califică firma cu formula q-v2 (inferențele nu primesc puncte; fiecare punct își numește dovada)", params: { preparationId, formula: "q-v2" },
          ops: [{ op: "sales.qualify" }], observed: ["dovezile firmei sintetice"], transmitted: [], outputs: ["calificarea explicată (fără model)"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        checkAbort(abort);
        const p = preparations.bound(params.preparationId, planId);
        const basis = sales.preparationBasis(p.opportunityId, { briefSha: p.briefSha });
        authorize({ op: "sales.qualify" });
        const out = ledger.runSync({ root: preparations.rootOf(p), op: "sales.qualify", keyParams: keyA3(p, basis), effect: () => {
          preparations.bound(p.id, planId);
          const q = sales.qualifyOrg(p.orgId, { formula: "q-v2" }, actorOf(planId));
          return { qualificationId: q.id, priority: q.priority, formulaVersion: q.formulaVersion };
        } });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.planId !== planId || !p.opportunityId) return null;
        const s = ledger.status({ root: preparations.rootOf(p), op: "sales.qualify", keyParams: keyA3(p, sales.preparationBasis(p.opportunityId, { briefSha: p.briefSha })) });
        return s.status === "DONE" ? { outcome: "done", result: s.result, detail: "registrul planului: făcut" } : null;
      }),
    },

    "sales.proposal.draft": {
      describe: async ({ preparationId }) => {
        needPrepId(preparationId);
        // The derived continuation (draft + dossier) is part of THIS card: its exact steps are hashed here, so a change of them
        // supersedes the card before confirmation and refuses the derivation after it.
        const then = await opsPlans.buildBody({ kind: DOSSIER_KIND, title: DOSSIER_PLAN_TITLE, steps: dossierSteps({ preparationId }), limits: phaseBLimits() });
        return { title: "Pregătește oferta în ciornă până la „gata de revizuire” (prețuri „De stabilit (neconfigurat)”, fără cifre inventate); aprobarea ei rămâne decizia ta",
          params: { preparationId, then: { stepTitles: then.steps.map((s) => s.title), bodySha: hashCanonical(then), activateWithinMin: ACTIVATE_WITHIN_MIN, decisionsLeft: SALES_DECISIONS_LEFT, never: SALES_NEVER } },
          ops: [{ op: "sales.proposal.draft" }], observed: ["dovezile și calificarea firmei sintetice", "catalogul tău (gol: prețurile rămân „De stabilit (neconfigurat)”)"], transmitted: [],
          outputs: ["oferta în ciornă, gata de revizuirea ta (neaprobată)", "după aprobarea ta: ciorna de contact și dosarul ofertei, fără altă întrebare"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        checkAbort(abort);
        const p = preparations.bound(params.preparationId, planId, { statuses: ["PREPARING", "WAITING_OWNER"] });
        // A resume after the offer was already prepared: the same version, nothing new.
        if (p.status === "WAITING_OWNER") {
          if (!preparations.awaitedCurrent(p)) throw new HubError("conflict", "Oferta s-a schimbat după pregătire.", { code: "SALES_STALE" });
          return { result: { proposalId: p.awaited.proposalId, proposalSha: p.awaited.proposalSha, reused: true } };
        }
        // A continuation whose offer is still the current one: wait again for the same version (no new version is written).
        if (p.awaited && preparations.awaitedCurrent(p)) {
          const latest = sales.latestProposal(p.opportunityId);
          authorize({ op: "sales.proposal.draft" });
          preparations.toWaiting(p, latest);
          return { result: { proposalId: latest.id, proposalSha: latest.contentSha, version: latest.version, reused: true } };
        }
        const basis = sales.preparationBasis(p.opportunityId, { briefSha: p.briefSha });
        if (!basis.workable) throw new HubError("policy", "Firma nu mai poate fi lucrată (DO_NOT_CONTACT, unită sau arhivată).", { code: "SALES_STALE" });
        if (!basis.qualificationId) throw new HubError("conflict", "Calificarea lipsește (pasul de calificare).", { code: "STEP_REF_MISSING" });
        const problemEvidenceId = sales.getOrg(p.orgId).evidence.find((e) => e.claim === "brief:problem" && e.sourceRef === `brief:${p.id}#problem`)?.id || null;
        const fields = p.brief?.fields || {};
        const brief = { ...p.brief, id: p.id, fields: { ...fields, ...(fields.problem ? { problem: { ...fields.problem, ...(problemEvidenceId ? { evidenceId: problemEvidenceId } : {}) } } : {}) } };
        const keyParams = { preparationId: p.id, basisSha: hashCanonical(basis), replaces: p.awaited?.proposalId || null };
        authorize({ op: "sales.proposal.draft" });
        const out = ledger.runSync({ root: preparations.rootOf(p), op: "sales.proposal.draft", keyParams, params: { opportunityId: p.opportunityId },
          effect: () => {
            preparations.bound(p.id, planId);
            const created = sales.createProposal(p.opportunityId, { brief, basis }, actorOf(planId));
            // C-02 before READY_FOR_OWNER_REVIEW: no invented amount, term, ROI, discount or approximation; no unresolved field.
            const figures = proposalFigures(created.content, { allow: allowedCatalogTexts(catalogOf(created.content)) });
            if (figures.length) throw new HubError("policy", `Oferta ar conține cifre comerciale care nu vin din catalogul configurat (${figures.slice(0, 3).map((f) => `„${f.text}”`).join(", ")}).`, { code: "COMMERCIAL_FIGURES" });
            const leftovers = findUnresolvedPlaceholders(created.content.text);
            if (leftovers.length) throw new HubError("policy", `Oferta are câmpuri nerezolvate: ${leftovers.slice(0, 5).join(", ")}.`, { code: "SALES_PLACEHOLDERS" });
            sales.transitionOpportunity(p.opportunityId, { to: "READY_FOR_OWNER_REVIEW", reason: "Pregătită de planul tău confirmat; aprobarea internă rămâne decizia ta" }, actorOf(planId));
            return { proposalId: created.id, proposalSha: created.contentSha, version: created.version, opportunityId: p.opportunityId };
          },
          after: (result) => {
            const latest = sales.latestProposal(p.opportunityId);
            if (!latest || latest.id !== result.proposalId || latest.contentSha !== result.proposalSha) throw new HubError("conflict", "Oferta pregătită nu mai e versiunea curentă.", { code: "SALES_STALE" });
            preparations.toWaiting(preparations.need(p.id), latest);
          } });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.planId !== planId || p.status !== "WAITING_OWNER" || !preparations.awaitedCurrent(p)) return null;
        return { outcome: "done", result: { proposalId: p.awaited.proposalId, proposalSha: p.awaited.proposalSha }, detail: "oferta pregătită așteaptă aprobarea ta" };
      }),
    },

    "sales.draft": {
      describe: ({ preparationId }) => {
        needPrepId(preparationId);
        return { title: "Pregătește ciorna mesajului de contact din oferta aprobată de tine (DRAFT_ONLY: nu se trimite nimic)", params: { preparationId }, ops: [{ op: "sales.draft" }],
          observed: ["oferta aprobată de tine (id + SHA)"], transmitted: [], outputs: ["ciorna de contact, netrimisă"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        checkAbort(abort);
        const p = preparations.bound(params.preparationId, planId, { phase: "B" });
        const ok = preparations.approvedExactly(p);
        if (!ok.ok) throw new HubError("conflict", `Ciorna se face doar din oferta aprobată exact: ${ok.reason}`, { code: "SALES_STALE" });
        const proposal = ok.proposal;
        // The latest draft already made from this exact offer (by an earlier run, or revised by you) is the draft: nothing new.
        const current = sales.latestDraft(p.opportunityId);
        if (current && current.proposalId === proposal.id && current.meta?.proposalSha === proposal.contentSha && ["DRAFT", "CONTENT_APPROVED"].includes(current.status)) {
          return { result: { draftId: current.id, draftSha: current.contentSha, version: current.version, reused: true } };
        }
        authorize({ op: "sales.draft" });
        const out = ledger.runSync({ root: preparations.rootOf(p), op: "sales.draft", keyParams: { preparationId: p.id, proposalId: proposal.id, proposalSha: proposal.contentSha, replaces: current?.id || null },
          effect: () => {
            preparations.bound(p.id, planId, { phase: "B" });
            const d = sales.createDraft(p.opportunityId, { proposalId: proposal.id }, actorOf(planId));
            return { draftId: d.id, draftSha: d.contentSha, version: d.version };
          } });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.phaseBPlanId !== planId) return null;
        const ok = preparations.approvedExactly(p);
        const d = ok.ok ? sales.latestDraft(p.opportunityId) : null;
        return d && d.proposalId === ok.proposal.id && d.meta?.proposalSha === ok.proposal.contentSha && ["DRAFT", "CONTENT_APPROVED"].includes(d.status)
          ? { outcome: "done", result: { draftId: d.id, draftSha: d.contentSha, version: d.version }, detail: "ciorna există" } : null;
      }),
    },

    "sales.dossier": {
      describe: ({ preparationId }) => {
        needPrepId(preparationId);
        const exportsDir = media?.exportsDir?.();
        if (!exportsDir) throw new HubError("policy", "Dosarul ofertei se scrie în folderul de exporturi aprobat, care nu e ales încă (alege un folder de import sau de exporturi în Studio).", { code: "SALES_DOSSIER_NO_EXPORTS_DIR" });
        const base = path.join(path.resolve(exportsDir), "vanzari");
        return { title: "Scrie „Dosarul ofertei” (oferta în Markdown și Word verificat în Word, fișa firmei, dovezile, calificarea, ciorna netrimisă, README, manifest sha256), fără suprascriere; nimic trimis",
          params: { preparationId }, ops: [{ op: "sales.dossier" }, { op: "export.local", destination: path.join(base, "dosar.md") }, { op: "office.verify" }], folders: [base],
          observed: ["oferta aprobată, ciorna, fișa sintetică, dovezile și calificarea"], transmitted: [], outputs: ["un dosar local nou (o revizie), verificabil prin manifest"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        for (;;) {
          checkAbort(abort);
          // READY only for the answer of a dossier already written by this key (a concurrent or repeated run); never a new write.
          const p = preparations.bound(params.preparationId, planId, { phase: "B", statuses: ["PACKAGING", "READY"] });
          const exportsDir = media?.exportsDir?.();
          if (!exportsDir) throw new HubError("policy", "Nu există un folder de exporturi aprobat pentru dosarul ofertei.", { code: "SALES_DOSSIER_NO_EXPORTS_DIR" });
          const facts = readFacts(p);
          const target = preparations.dossierTarget(p, facts, exportsDir);
          const claim = ledger.claim({ root: preparations.rootOf(p), op: "sales.dossier", keyParams: preparations.dossierKeyParams(p, facts), params: { inputsSha: facts.inputsSha } });
          if (claim.done) return { result: { ...claim.result, duplicate: true } };
          if (claim.inProgress) { await claim.promise; continue; }
          if (p.status !== "PACKAGING") {
            ledger.release({ key: claim.key, token: claim.token });
            throw new HubError("conflict", `Pregătirea e ${p.status}; dosarul nu se mai scrie.`, { code: "SALES_PREPARATION_STATE" });
          }
          return { result: await writeDossier({ p, facts, target, claim, planId, authorize, abort, exportsDir }) };
        }
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const p = preparations.get(params.preparationId);
        if (!p || p.phaseBPlanId !== planId) return null;
        const facts = readFacts(p);
        const s = ledger.status({ root: preparations.rootOf(p), op: "sales.dossier", keyParams: preparations.dossierKeyParams(p, facts), params: { inputsSha: facts.inputsSha } });
        if (s.status !== "DONE" || !s.result?.folder) return null;
        return verifyPackageFolder(s.result.folder).ok ? { outcome: "done", result: s.result, detail: "dosarul există și se verifică singur" } : { outcome: "unknown", detail: "dosarul din registru nu se mai verifică" };
      }),
    },
  };
  return executors;
}
