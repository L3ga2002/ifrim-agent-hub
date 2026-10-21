import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { writeNew } from "../delivery/files.mjs";
import { verifyPackageFolder } from "../delivery/office-executors.mjs";
import { checkDocxFile, verifyDocxInWord, officeExe } from "../office/office.mjs";
import { expectedDocxShape } from "../office/docx.mjs";
import { allowedCatalogTexts } from "../sales/figures.mjs";
import { realInside } from "../sales/preparation.mjs";
import { DESK_FLOWS, exportSteps, exportTitle, deskPhaseBLimits, DESK_ACTIVATE_WITHIN_MIN } from "./desk.mjs";
import { DESK_EXTS, DESK_NEVER, opsStartState, opsProgress, opsExportFiles, classifySupport, supportReply, supportSpecDraft, supportExportFiles, devizContent, devizText,
  devizExportFiles, devizDocxModel, checkExportTexts, deskReadme, deskManifest } from "./builders.mjs";

/**
 * M13 „Birou intern” plan steps (ops/plans.mjs executors: describe → run → reconcile), on the M12 rules (sales/plan-executors.mjs):
 * a step acts only for the record bound to ITS plan and re-reads its inputs (a changed input refuses: DESK_STALE); authorize() right
 * before the committing write; every effect through the C-01 ledger keyed by the owner-confirmed root plan (a resume, a concurrent call
 * or a continuation never repeats it); exports are new folders, files written exclusively, README + manifest last, self-verified.
 * Nothing here approves, sends, contacts, hands off, starts a model or the Factory, or deletes.
 */
const OWNER_STOP = new Set(["STOPPED", "PAUSED", "PLAN_NOT_RUNNING", "SESSION_CLOSED", "PLAN_EXPIRED", "PLAN_BUDGET", "STEP_NOT_RUNNING", "HUB_SHUTDOWN"]);
const REC_ID = /^dsk_[A-Za-z0-9_]+$/;
const FS_MISSING = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);
const SHA = /^[0-9a-f]{64}$/;

export function createDeskExecutors({ desk, sales, ledger, opsPlans, media, config,
  appCheck = (config?.testMode && process.env.HUB_V2_OFFICE_COM !== "1") ? "skip" : "com", verifyDocx = verifyDocxInWord, officeAvailable = () => Boolean(officeExe("docx")) }) {
  const actorOf = (planId) => `plan:${planId}`;
  const checkAbort = (abort) => { if (abort?.aborted) throw new HubError("conflict", `Oprit: ${abort.reason || "pauză"}`, { code: "STOPPED" }); };
  const needRec = (id) => { if (!REC_ID.test(String(id || ""))) throw new HubError("validation", "Pasul cere înregistrarea (dsk_…)"); return String(id); };
  const stale = (why) => new HubError("conflict", why, { code: "DESK_STALE" });
  const workDir = () => path.join(config?.workDir || path.join(config?.dataDir || ".", "work"), "office");
  const reconcileWith = (fn) => async (ctx) => { try { return (await fn(ctx)) || { outcome: "retry" }; } catch (error) { return { outcome: "retry", detail: String(error?.message || error).slice(0, 200) }; } };
  const exportsBase = (kind) => { const dir = media?.exportsDir?.(); if (!dir) throw new HubError("policy", "Exportul se scrie în folderul de exporturi aprobat, care nu e ales încă.", { code: "DESK_NO_EXPORTS_DIR" }); return path.join(path.resolve(dir), DESK_FLOWS[kind].root); };
  const catalogTexts = (serviceIds) => { const refs = new Set(serviceIds || []); return allowedCatalogTexts(sales.listServices({ activeOnly: false }).filter((s) => refs.has(`${s.id}@${s.version}`))); };
  const thenOf = async (kind, recordId) => {
    const body = await opsPlans.buildBody({ kind: DESK_FLOWS[kind].exportKind, title: exportTitle(kind), steps: exportSteps(kind, { recordId }), limits: deskPhaseBLimits() });
    return { stepTitles: body.steps.map((s) => s.title), bodySha: hashCanonical(body), activateWithinMin: DESK_ACTIVATE_WITHIN_MIN, never: DESK_NEVER };
  };
  const contOf = (continues) => (continues && typeof continues === "object" ? { continues: { rootPlanId: String(continues.rootPlanId || ""), rootPlanHash: String(continues.rootPlanHash || "") } } : {});
  /** The approved offer of the record, exactly the one the card pinned (a newer version, another sha → STALE). */
  function pinnedOffer(r, params) {
    const o = desk.approvedOffer(r.opportunityId);
    if (!o.ok) throw stale(`Oferta nu mai e cea aprobată: ${o.reason}`);
    if (o.proposal.id !== params.proposalId || o.proposal.contentSha !== params.proposalSha) throw stale("Oferta aprobată s-a schimbat față de cardul confirmat; o continuare o citește din nou.");
    return o;
  }

  // ---------------------------------------------------------------- the place of an export (never inside the Hub's own roots)
  function realOrNearest(p) {
    let cur = path.resolve(p);
    const rest = [];
    for (;;) {
      try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); }
      catch (error) {
        const up = path.dirname(cur);
        if (up === cur || !["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
        rest.push(path.basename(cur));
        cur = up;
      }
    }
  }
  const within = (base, p) => { const n = (x) => (process.platform === "win32" ? x.toLowerCase() : x); const b = n(base).replace(/[\\/]+$/, ""); const t = n(p); return t === b || t.startsWith(`${b}${path.sep}`); };
  function assertPlace(exportsDir, folder) {
    const realExports = realOrNearest(exportsDir);
    const realFolder = realOrNearest(folder);
    const roots = [config?.hubRoot, config?.dataDir, config?.dataLocation?.dataRoot, config?.backupDir, config?.preUpgradeDir, config?.mediaDir, config?.workDir].filter(Boolean).map(realOrNearest);
    if (roots.some((r) => within(r, realExports) || within(r, realFolder))) throw new HubError("policy", "Folderul de exporturi duce în datele sau în folderul Hub-ului; nu scriu acolo.", { code: "DESK_FORBIDDEN_ROOT" });
    if (!within(realExports, realFolder)) throw new HubError("policy", "Folderul exportului iese din folderul de exporturi aprobat.", { code: "DESK_OUTSIDE" });
  }

  /** The Word level of a deviz: kept from this export's own earlier attempt, or checked now (APP_VERIFIED + PDF / APP_NOT_RUN / APP_FAILED). */
  async function wordCheck({ exp, prior, docx, docxFile, shape, folder, files, authorize, abort }) {
    const base = { file: "FILE_CHECKED", headings: shape.headings.length, tables: shape.tables.length };
    const pdfName = docx.path.replace(/\.docx$/i, ".pdf");
    const keepPdf = (source) => {
      const dest = path.join(folder, pdfName);
      authorize({ op: "export.local", destination: dest });
      const bytes = fs.readFileSync(source);
      try { fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== "EEXIST") throw error; if (sha256(fs.readFileSync(dest)) !== sha256(bytes)) throw new HubError("conflict", `Există deja ${pdfName} cu alt conținut; nu îl suprascriu.`, { code: "DELIVERY_FILE_TAKEN" }); }
      const copied = sha256(fs.readFileSync(dest));
      if (copied !== sha256(bytes)) throw new HubError("tool", "Copia PDF-ului nu are aceiași octeți.", { code: "DELIVERY_FILE_VERIFY" });
      if (!files.some((f) => f.path === pdfName)) files.push({ path: pdfName, bytes: bytes.length, sha256: copied, inputsSha: hashCanonical({ generator: "word-pdf-export", docx: docx.sha256 }), generator: "word-pdf-export" });
      return copied;
    };
    const work = workDir();
    const pdfOut = path.join(work, `${exp.id}-${path.basename(pdfName)}`);
    const own = prior?.verification?.docx;
    if (own?.docxSha256 === docx.sha256 && own.app === "APP_NOT_RUN") return { docx: { ...own } };
    if (own?.docxSha256 === docx.sha256 && own.app === "APP_VERIFIED" && own.pdfSha256) {
      for (const source of [path.join(folder, pdfName), pdfOut]) {
        try { if (sha256(fs.readFileSync(source)) === own.pdfSha256 && keepPdf(source) === own.pdfSha256) return { docx: { ...own } }; } catch (error) { if (!FS_MISSING.has(error?.code)) throw error; }
      }
    }
    checkAbort(abort);
    authorize({ op: "office.verify" });
    if (appCheck !== "com") return { docx: { ...base, app: "APP_NOT_RUN", docxSha256: docx.sha256, note: "Verificarea în Word nu rulează în acest mediu (fără Office): documentul e verificat doar ca fișier; PDF-ul nu a fost produs." } };
    if (!officeAvailable()) return { docx: { ...base, app: "APP_NOT_RUN", docxSha256: docx.sha256, note: "Microsoft Word nu e instalat pe acest calculator: documentul e verificat doar ca fișier; PDF-ul nu a fost produs." } };
    fs.mkdirSync(work, { recursive: true });
    let res;
    try { res = await verifyDocx(docxFile, shape, { pdfOut, workDir: work }); }
    catch (error) { res = { ok: false, level: "APP_FAILED", error: `Word nu a putut verifica documentul: ${String(error?.message || error)}` }; }
    if (!res?.ok) return { docx: { ...base, app: "APP_FAILED", level: res?.level || "APP_FAILED", docxSha256: docx.sha256, note: String(res?.error || (res?.problems || []).join("; ") || res?.level || "APP_FAILED").slice(0, 300) } };
    const exported = res.pdf || pdfOut;
    const verified = { docx: { ...base, app: "APP_VERIFIED", appName: res.app || "Microsoft Word", appVersion: res.version || null, pages: res.pages ?? null, docxSha256: docx.sha256, pdf: pdfName,
      pdfSha256: sha256(fs.readFileSync(exported)), note: "Deschis în Word (instanță proprie, invizibilă, doar citire): titluri și tabel verificate, PDF exportat de Word." } };
    desk.recordExportFiles(exp.id, files, { verification: verified });
    if (keepPdf(exported) !== verified.docx.pdfSha256) throw new HubError("tool", "Copia PDF-ului nu are aceiași octeți.", { code: "DELIVERY_FILE_VERIFY" });
    return verified;
  }

  /**
   * One export (claimed key): the files built (pure) and checked, the folder created exclusively inside the exports root, every file
   * written exclusively, the Word document checked (finance), the inputs read again, README, the manifest LAST, the folder self-verified,
   * then the ledger's completion (READY). A stop declares the partial effect (INCOMPLETE, files listed, nothing deleted).
   */
  async function writeExport({ r, op, phase, files: built, artifact = null, target, claim, planId, authorize, abort, exportsDir, title, facts, sources, nextAction, inputs, currentInputs, word = false, allow = [], stateAfter = null }) {
    const actor = actorOf(planId);
    const files = [];
    let exp = null;
    let verification = {};
    try {
      checkExportTexts(built, { allow });
      assertPlace(exportsDir, target.folder);
      if (!target.existing && fs.existsSync(target.folder)) throw new HubError("conflict", `Folderul ${path.basename(target.folder)} există deja și nu e al acestui export; nu scriu în el.`, { code: "DESK_FOLDER_TAKEN" });
      authorize({ op: "export.local", destination: path.join(target.folder, "README.md") });
      const reserved = desk.reserveExport({ r, target, artifact, inputs, fixedAt: claim.fixedAt, planId, actor });
      exp = reserved.exp;
      fs.mkdirSync(path.dirname(target.folder), { recursive: true });
      if (fs.existsSync(target.folder)) { if (!reserved.resumed) throw new HubError("conflict", "Folderul reviziei a apărut între timp; nu scriu în el.", { code: "DESK_FOLDER_TAKEN" }); }
      else {
        try { fs.mkdirSync(target.folder); }
        catch (error) { if (error.code === "EEXIST") throw new HubError("conflict", "Folderul reviziei a apărut între timp; nu scriu în el.", { code: "DESK_FOLDER_TAKEN" }); throw error; }
      }
      if (!realInside(exportsDir, target.folder)) throw new HubError("policy", "Folderul exportului iese din folderul de exporturi aprobat.", { code: "DESK_OUTSIDE" });
      const prior = reserved.resumed ? exp : null;
      for (const a of built) {
        checkAbort(abort);
        authorize({ op: "export.local", destination: path.join(target.folder, a.path) });
        const w = writeNew(target.folder, a.path, a.buf, { root: exportsDir, exts: DESK_EXTS, exclusive: true });
        files.push({ path: a.path, bytes: a.buf.length, sha256: w.sha256, inputsSha: a.inputsSha, generator: a.generator });
        desk.recordExportFiles(exp.id, files);
      }
      if (word) {
        const docx = files.find((f) => f.path.endsWith(".docx"));
        const docxFile = path.join(target.folder, docx.path);
        const shape = expectedDocxShape(devizDocxModel(artifact.content, { approval: { at: artifact.approvedAt, sha: artifact.approvedSha } }));
        const fileCheck = checkDocxFile(docxFile, shape);
        if (!fileCheck.ok) throw new HubError("tool", `Documentul Word salvat nu are structura devizului: ${fileCheck.problems.join("; ")}`, { code: "OFFICE_VERIFY_FAILED" });
        verification = await wordCheck({ exp, prior, docx, docxFile, shape, folder: target.folder, files, authorize, abort });
        desk.recordExportFiles(exp.id, files, { verification });
        if (verification.docx.app === "APP_FAILED") throw new HubError("tool", `Word nu confirmă documentul: ${verification.docx.note}`, { code: "OFFICE_VERIFY_FAILED" });
      }
      if (hashCanonical(currentInputs()) !== hashCanonical(inputs)) throw new HubError("conflict", "Intrările s-au schimbat în timpul scrierii exportului; nu îl închei.", { code: "DESK_INPUTS_CHANGED" });
      checkAbort(abort);
      const readme = deskReadme({ title, record: r, exportId: exp.id, revision: exp.revision, createdAt: claim.fixedAt, files, verification, facts });
      authorize({ op: "export.local", destination: path.join(target.folder, "README.md") });
      const wr = writeNew(target.folder, "README.md", readme, { root: exportsDir, exts: DESK_EXTS, exclusive: true });
      files.push({ path: "README.md", bytes: readme.length, sha256: wr.sha256, inputsSha: hashCanonical({ generator: "desk-readme-v1", files: files.map((f) => f.sha256), verification }), generator: "desk-readme-v1" });
      const manifest = deskManifest({ kind: r.kind, record: r, exportId: exp.id, revision: exp.revision, folderName: path.basename(target.folder), createdAt: claim.fixedAt, artifact,
        plan: { rootPlanId: r.rootPlanId, rootPlanHash: r.rootPlanHash, opKey: claim.key }, files, verification, sources });
      authorize({ op: "export.local", destination: path.join(target.folder, "manifest.json") });
      const wm = writeNew(target.folder, "manifest.json", manifest, { root: exportsDir, exts: DESK_EXTS, exclusive: true });
      desk.recordExportFiles(exp.id, files, { verification });
      const self = verifyPackageFolder(target.folder);
      if (!self.ok) throw new HubError("tool", `Exportul nu se verifică singur: ${self.problems.join("; ")}`, { code: "DESK_NOT_SELF_CONTAINED" });
      checkAbort(abort);
      authorize({ op });
      return ledger.complete({ key: claim.key, token: claim.token, effect: () => {
        const x = desk.completeExport({ exportId: exp.id, planId, phase, files, verification, manifestSha: wm.sha256, actor, nextAction, inputsSha: hashCanonical(inputs), stateAfter });
        return { exportId: x.id, revision: x.revision, folder: target.folder, file: path.join(target.folder, "manifest.json"), sha256: wm.sha256, files: files.length, verification, recordId: r.id };
      } });
    } catch (error) {
      const code = error?.code || "FAILED";
      const stop = OWNER_STOP.has(code);
      if (exp) desk.recordExportFiles(exp.id, files, stop ? { verification } : { incomplete: `${code}: ${String(error?.message || "").slice(0, 200)}`, verification });
      ledger.release({ key: claim.key, token: claim.token, failed: !stop, error: `${code}: ${String(error?.message || "").slice(0, 200)}` });
      throw error;
    }
  }
  /** The common claim loop of an export step (a concurrent or repeated run gets the same result; never a second folder). */
  async function exportStep({ planId, params, authorize, abort, phase, statuses, op, prepare }) {
    for (;;) {
      checkAbort(abort);
      const r = desk.bound(params.recordId, planId, { phase, statuses });
      const exportsDir = media?.exportsDir?.();
      if (!exportsDir) throw new HubError("policy", "Nu există un folder de exporturi aprobat.", { code: "DESK_NO_EXPORTS_DIR" });
      const p = prepare(r);
      const target = desk.exportTarget(r, { op, keyParams: p.keyParams, name: p.name, subjectId: p.subjectId }, exportsDir);
      const claim = ledger.claim({ root: desk.rootOf(r), op, keyParams: p.keyParams, params: { inputsSha: hashCanonical(p.inputs) } });
      if (claim.done) return { result: { ...claim.result, duplicate: true } };
      if (claim.inProgress) { await claim.promise; continue; }
      if (r.status !== statuses[0]) { ledger.release({ key: claim.key, token: claim.token }); throw new HubError("conflict", `Înregistrarea e ${r.status}; exportul nu se mai scrie.`, { code: "DESK_RECORD_STATE" }); }
      return { result: await writeExport({ r, op, phase, target, claim, planId, authorize, abort, exportsDir, ...p }) };
    }
  }
  const exportReconcile = (op, phase, prepare) => reconcileWith(({ planId, params }) => {
    const r = desk.get(params.recordId);
    if (!r || (phase === "A" ? r.planId : r.phaseBPlanId) !== planId) return null;
    const p = prepare(r);
    const s = ledger.status({ root: desk.rootOf(r), op, keyParams: p.keyParams, params: { inputsSha: hashCanonical(p.inputs) } });
    if (s.status !== "DONE" || !s.result?.folder) return null;
    return verifyPackageFolder(s.result.folder).ok ? { outcome: "done", result: s.result, detail: "exportul există și se verifică singur" } : { outcome: "unknown", detail: "exportul din registru nu se mai verifică" };
  });

  // ---------------------------------------------------------------- Operations
  const opsPrepare = (r) => {
    const state = r.state || {};
    const stateSha = hashCanonical(state);
    const inputs = { recordId: r.id, stateSha, inputsSha: r.inputsSha };
    return { keyParams: { recordId: r.id, stateSha, inputsSha: r.inputsSha }, inputs, name: state.offer?.orgName || r.title, subjectId: r.opportunityId || r.id, files: opsExportFiles({ record: r, state }),
      title: `Dosarul de pornire a proiectului ${r.internalNo}`, nextAction: state.nextAction || "",
      facts: [`Oferta: ${state.offer?.proposalId} v${state.offer?.version} (SHA-256 ${state.offer?.contentSha}) — aprobată intern, nu acceptată de client`, `Primit: ${(state.received || []).join(", ") || "nimic încă"}; lipsește: ${(state.missing || []).join(", ") || "nimic"}`],
      sources: { offer: { id: state.offer?.proposalId, version: state.offer?.version, contentSha: state.offer?.contentSha, serviceIds: state.offer?.serviceIds } },
      currentInputs: () => { const cur = desk.get(r.id); return { recordId: cur.id, stateSha: hashCanonical(cur.state || {}), inputsSha: cur.inputsSha }; } };
  };
  // ---------------------------------------------------------------- Support
  const supportClosedState = (state) => ({ ...state, caseStatus: "REPLY_APPROVED", caseStatusText: "Deschis: răspunsul e aprobat intern și NETRIMIS; cazul nu e rezolvat și nu e închis.",
    nextAction: "Trimiți tu răspunsul în afara Hub-ului, dacă vrei (de aici nu se trimite nimic), apoi revii cu rezultatul; cazul rămâne deschis până decizi tu altfel." });
  const supportPrepare = (r) => {
    const ok = desk.approvedExactly(r);
    if (!ok.ok) throw stale(`Răspunsul nu e cel aprobat exact: ${ok.reason}`);
    const reply = ok.artifact;
    const state = supportClosedState(r.state || {});
    const inputs = { recordId: r.id, artifactId: reply.id, artifactSha: reply.contentSha, approvedSha: reply.approvedSha, inputsSha: r.inputsSha, stateSha: hashCanonical(r.state || {}) };
    return { keyParams: { recordId: r.id, artifactId: reply.id, artifactSha: reply.contentSha, inputsSha: r.inputsSha }, inputs, artifact: reply, name: state.sources?.project?.name || r.title, subjectId: r.id,
      files: supportExportFiles({ record: r, state, reply }), title: `Cazul de suport ${r.internalNo}`, nextAction: state.nextAction, stateAfter: state,
      facts: [`Cererea: SINTETICĂ — „${String(state.request || "").slice(0, 200)}”`, `Răspunsul: ${reply.id} v${reply.version} (SHA-256 ${reply.contentSha}) — aprobat intern, NETRIMIS`, `Sursa: pachetul ${state.sources?.delivery?.bundleId} (OWNER_ACCEPTED), doar citire`],
      sources: { delivery: state.sources?.delivery, sourcesSha: state.sources?.sha },
      currentInputs: () => { const cur = desk.get(r.id); const a = desk.approvedExactly(cur); return { recordId: cur.id, artifactId: a.ok ? a.artifact.id : null, artifactSha: a.ok ? a.artifact.contentSha : null, approvedSha: a.ok ? a.artifact.approvedSha : null, inputsSha: cur.inputsSha, stateSha: hashCanonical(cur.state || {}) }; } };
  };
  // ---------------------------------------------------------------- Finance
  const financePrepare = (r) => {
    const ok = desk.approvedExactly(r);
    if (!ok.ok) throw stale(`Devizul nu e cel aprobat exact: ${ok.reason}`);
    const doc = ok.artifact;
    const c = doc.content;
    const state = { ...(r.state || {}), registerStatus: "APPROVED_INTERNAL", nextAction: "Stabilești prețul și termenul (catalog), apoi o ofertă nouă aprobată și un deviz nou; acest deviz rămâne ciornă internă: nu e emis, nu e trimis, nu înseamnă acceptare sau încasare." };
    const inputs = { recordId: r.id, artifactId: doc.id, artifactSha: doc.contentSha, approvedSha: doc.approvedSha, inputsSha: r.inputsSha };
    return { keyParams: { recordId: r.id, artifactId: doc.id, artifactSha: doc.contentSha, inputsSha: r.inputsSha }, inputs, artifact: doc, name: c.client?.name || r.title, subjectId: r.opportunityId || r.id,
      files: devizExportFiles({ record: r, artifact: doc }), title: `Devizul ${c.internalNo} (ciornă internă)`, nextAction: state.nextAction, stateAfter: state, word: true, allow: catalogTexts(c.source?.serviceIds),
      facts: [`Documentul: ${doc.id} v${doc.version} (SHA-256 ${doc.contentSha}) — aprobat intern; nu e emis fiscal, nu e trimis`, `Sursa: oferta ${c.source?.proposalId} v${c.source?.version} (SHA-256 ${c.source?.contentSha})`, `Necunoscute: ${(c.unknown || []).join("; ") || "niciuna"}`],
      sources: { offer: c.source },
      currentInputs: () => { const cur = desk.get(r.id); const a = desk.approvedExactly(cur); return { recordId: cur.id, artifactId: a.ok ? a.artifact.id : null, artifactSha: a.ok ? a.artifact.contentSha : null, approvedSha: a.ok ? a.artifact.approvedSha : null, inputsSha: cur.inputsSha }; } };
  };

  /** Phase-A step 1 of Operations / Finance: the record enters the plan; the offer it pins is read again. */
  const executors = {
    "desk.ops.record": {
      describe: ({ recordId, opportunityId, proposalId, proposalSha, withSpec = false, continues = null }) => {
        needRec(recordId);
        if (!/^spr_[A-Za-z0-9_]+$/.test(String(proposalId || "")) || !SHA.test(String(proposalSha || ""))) throw new HubError("validation", "Pasul cere oferta aprobată exactă (id + SHA)");
        return { title: `Pregătește înregistrarea internă de pornire din oferta aprobată ${proposalId} (checklist-ul materialelor, ce e primit / ce lipsește, întrebări, riscuri, responsabil, termene)${withSpec ? "; plus o schiță de misiune Engineering SPEC_DRAFT, necreată în Fabrică" : ""}`,
          params: { recordId, opportunityId: String(opportunityId || ""), proposalId, proposalSha, withSpec: Boolean(withSpec), ...contOf(continues) }, ops: [{ op: "desk.ops.record" }],
          observed: ["oferta aprobată intern (id + SHA), cu serviciul ei din catalog"], transmitted: [], outputs: ["înregistrarea internă de pornire (fără acceptarea clientului, fără WON)"] };
      },
      run: async ({ planId, params, authorize, abort, plan }) => {
        checkAbort(abort);
        const r = desk.enterPlan(params.recordId, plan);
        const o = pinnedOffer(r, params);
        authorize({ op: "desk.ops.record" });
        const out = ledger.runSync({ root: desk.rootOf(r), op: "desk.ops.record", keyParams: { recordId: r.id, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, withSpec: Boolean(params.withSpec) },
          effect: () => {
            const fresh = opsStartState({ offer: o.facts, proposal: o.proposal, withSpec: params.withSpec });
            // A continuation from another offer keeps what you already received (same material text).
            const had = new Map((r.state?.checklist || []).map((i) => [i.text, i]));
            const checklist = fresh.checklist.map((i) => (had.get(i.text)?.status === "RECEIVED" ? { ...i, status: "RECEIVED", receivedAt: had.get(i.text).receivedAt, note: had.get(i.text).note || "" } : i));
            const state = { ...fresh, checklist };
            Object.assign(state, opsProgress(state));
            desk.saveState(r.id, state, { nextAction: state.nextAction, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, source: { opportunityId: r.opportunityId, proposalVersion: o.proposal.version, serviceIds: o.facts.serviceIds },
              inputsSha: desk.inputsShaOf(r), actor: actorOf(planId) });
            return { recordId: r.id, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, materials: checklist.length };
          },
          after: () => desk.enterPreparing(desk.need(r.id), plan) });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const r = desk.get(params.recordId);
        if (!r || r.planId !== planId || r.status === "PLANNED") return null;
        const s = ledger.status({ root: desk.rootOf(r), op: "desk.ops.record", keyParams: { recordId: r.id, proposalId: params.proposalId, proposalSha: params.proposalSha, withSpec: Boolean(params.withSpec) } });
        return s.status === "DONE" ? { outcome: "done", result: s.result, detail: "registrul planului: făcut" } : null;
      }),
    },
    "desk.ops.export": {
      describe: ({ recordId }) => {
        needRec(recordId);
        const base = exportsBase("ops_start");
        return { title: "Scrie „Dosarul de pornire a proiectului” (Markdown + JSON, README, manifest sha256) într-un folder nou, fără suprascriere; nimic trimis",
          params: { recordId }, ops: [{ op: "desk.ops.export" }, { op: "export.local", destination: path.join(base, "dosar-pornire.md") }], folders: [base],
          observed: ["înregistrarea de pornire"], transmitted: [], outputs: ["un dosar local nou (o revizie), verificabil prin manifest"] };
      },
      run: ({ planId, params, authorize, abort }) => exportStep({ planId, params, authorize, abort, phase: "A", statuses: ["PREPARING", "READY"], op: "desk.ops.export", prepare: opsPrepare }),
      reconcile: exportReconcile("desk.ops.export", "A", opsPrepare),
    },

    "desk.support.case": {
      describe: ({ recordId, projectId, deliveryId, bundleSha, requestSha, continues = null }) => {
        needRec(recordId);
        if (!SHA.test(String(bundleSha || "")) || !SHA.test(String(requestSha || ""))) throw new HubError("validation", "Pasul cere pachetul acceptat (SHA) și amprenta cererii");
        return { title: "Înregistrează cazul de suport (cerere SINTETICĂ): clasificare declarată (întrebare / defect raportat / cerere nouă), surse doar-citire din pachetul acceptat al proiectului",
          params: { recordId, projectId: String(projectId || ""), deliveryId: String(deliveryId || ""), bundleSha, requestSha, ...contOf(continues) }, ops: [{ op: "desk.support.case" }],
          observed: ["cererea ta (sintetică)", "criteriile verificate ale pachetului acceptat (doar citire)"], transmitted: [], outputs: ["cazul de suport cu clasificarea și sursele lui"] };
      },
      run: async ({ planId, params, authorize, abort, plan }) => {
        checkAbort(abort);
        const r = desk.enterPlan(params.recordId, plan);
        if (hashCanonical(r.request) !== params.requestSha) throw stale("Cererea s-a schimbat față de cardul confirmat.");
        const s = desk.acceptedSources(params.projectId, params.deliveryId);
        if (!s.ok) throw stale(s.reason);
        if (s.sources.delivery.bundleSha !== params.bundleSha) throw stale("Pachetul acceptat al proiectului s-a schimbat față de cardul confirmat.");
        authorize({ op: "desk.support.case" });
        const out = ledger.runSync({ root: desk.rootOf(r), op: "desk.support.case", keyParams: { recordId: r.id, requestSha: params.requestSha, sourcesSha: s.sources.sha },
          effect: () => {
            const classification = classifySupport(r.request);
            const state = { schema: 1, kind: "support_case", request: r.request, synthetic: true, project: s.sources.project, classification, sources: s.sources, owner: "proprietar",
              caseStatus: "TRIAGED", caseStatusText: "Deschis: clasificat, răspunsul se pregătește (clasificarea nu dovedește un defect)",
              specDraft: classification.class === "DEFECT_REPORTED" ? supportSpecDraft({ request: r.request, sources: s.sources, caseNo: r.internalNo }) : null,
              nextAction: "Aștepți răspunsul în ciornă, apoi îl inspectezi și îl aprobi (sau nu)." };
            desk.saveState(r.id, state, { nextAction: state.nextAction, source: { requestSha: params.requestSha, deliveryId: s.delivery.id, bundleId: s.sources.delivery.bundleId, bundleSha: s.sources.delivery.bundleSha },
              inputsSha: desk.inputsShaOf(r), actor: actorOf(planId) });
            return { recordId: r.id, classification: classification.class, sourcesSha: s.sources.sha, criteria: s.sources.criteria.length };
          },
          after: () => desk.enterPreparing(desk.need(r.id), plan) });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const r = desk.get(params.recordId);
        if (!r || r.planId !== planId || r.status === "PLANNED" || !r.state?.sources) return null;
        const s = ledger.status({ root: desk.rootOf(r), op: "desk.support.case", keyParams: { recordId: r.id, requestSha: params.requestSha, sourcesSha: r.state.sources.sha } });
        return s.status === "DONE" ? { outcome: "done", result: s.result, detail: "registrul planului: făcut" } : null;
      }),
    },
    "desk.support.reply": {
      describe: async ({ recordId }) => {
        needRec(recordId);
        const then = await thenOf("support_case", recordId);
        return { title: "Pregătește răspunsul în ciornă (DRAFT_ONLY — NETRIMIS), doar din ce a verificat pachetul acceptat; aprobarea textului rămâne decizia ta",
          params: { recordId, then }, ops: [{ op: "desk.support.reply" }], observed: ["cazul și sursele lui"], transmitted: [],
          outputs: ["răspunsul în ciornă, gata de revizuirea ta (neaprobat, netrimis)", "după aprobarea ta: exportul cazului, fără altă întrebare"] };
      },
      run: async ({ planId, params, authorize, abort }) => {
        checkAbort(abort);
        const r = desk.bound(params.recordId, planId, { statuses: ["PREPARING", "WAITING_OWNER"] });
        const latest = desk.latestArtifact(r.id);
        if (r.status === "WAITING_OWNER") {
          if (!latest || latest.id !== r.awaited?.artifactId) throw stale("Răspunsul s-a schimbat după pregătire.");
          return { result: { artifactId: latest.id, contentSha: latest.contentSha, reused: true } };
        }
        const content = supportReply({ request: r.state.request, classification: r.state.classification, sources: r.state.sources, caseNo: r.internalNo });
        authorize({ op: "desk.support.reply" });
        const replaces = latest && !["DRAFT", "APPROVED_INTERNAL"].includes(latest.status) ? latest.id : null;
        const out = ledger.runSync({ root: desk.rootOf(r), op: "desk.support.reply", keyParams: { recordId: r.id, contentSha: hashCanonical(content), inputsSha: r.inputsSha, replaces },
          effect: () => {
            const a = desk.createArtifact({ recordId: r.id, kind: "support_reply", content, inputsSha: r.inputsSha, actor: actorOf(planId) });
            desk.saveState(r.id, { ...r.state, caseStatus: "REPLY_DRAFTED", caseStatusText: "Deschis: răspunsul e în ciornă și îți așteaptă revizuirea; nimic trimis" }, { actor: actorOf(planId) });
            return { artifactId: a.id, contentSha: a.contentSha, version: a.version };
          },
          after: () => { const cur = desk.latestArtifact(r.id); if (!cur || !["DRAFT", "APPROVED_INTERNAL"].includes(cur.status)) throw stale("Răspunsul pregătit nu mai e curent."); desk.toWaiting(desk.need(r.id), cur); } });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const r = desk.get(params.recordId);
        if (!r || r.planId !== planId || r.status !== "WAITING_OWNER" || !r.awaited) return null;
        return { outcome: "done", result: { artifactId: r.awaited.artifactId, contentSha: r.awaited.sha }, detail: "răspunsul așteaptă aprobarea ta" };
      }),
    },
    "desk.support.export": {
      describe: ({ recordId }) => {
        needRec(recordId);
        const base = exportsBase("support_case");
        return { title: "Scrie exportul cazului de suport (cazul, răspunsul aprobat și NETRIMIS, sursele, README, manifest sha256) într-un folder nou; nimic trimis",
          params: { recordId }, ops: [{ op: "desk.support.export" }, { op: "export.local", destination: path.join(base, "caz.md") }], folders: [base],
          observed: ["cazul și răspunsul aprobat de tine (id + SHA)"], transmitted: [], outputs: ["un export local nou (o revizie), verificabil prin manifest"] };
      },
      run: ({ planId, params, authorize, abort }) => exportStep({ planId, params, authorize, abort, phase: "B", statuses: ["PACKAGING", "READY"], op: "desk.support.export", prepare: supportPrepare }),
      reconcile: exportReconcile("desk.support.export", "B", supportPrepare),
    },

    "desk.finance.document": {
      describe: async ({ recordId, opportunityId, proposalId, proposalSha, continues = null }) => {
        needRec(recordId);
        if (!/^spr_[A-Za-z0-9_]+$/.test(String(proposalId || "")) || !SHA.test(String(proposalSha || ""))) throw new HubError("validation", "Pasul cere oferta aprobată exactă (id + SHA)");
        const then = await thenOf("finance_doc", recordId);
        return { title: `Pregătește devizul în ciornă din oferta aprobată ${proposalId} (prețul și termenul exact ca în ofertă; necunoscutul „De stabilit”, fără total calculat) și îl înregistrează intern; aprobarea lui rămâne decizia ta`,
          params: { recordId, opportunityId: String(opportunityId || ""), proposalId, proposalSha, then, ...contOf(continues) }, ops: [{ op: "desk.finance.document" }],
          observed: ["oferta aprobată intern (id + SHA)"], transmitted: [], outputs: ["devizul în ciornă în registrul local (neaprobat, neemis, netrimis)", "după aprobarea ta: Word și PDF verificate, fără altă întrebare"] };
      },
      run: async ({ planId, params, authorize, abort, plan }) => {
        checkAbort(abort);
        const r = desk.enterPlan(params.recordId, plan);
        const o = pinnedOffer(r, params);
        const content = devizContent({ offer: o.facts, internalNo: r.internalNo });
        const allow = catalogTexts(o.facts.serviceIds);
        checkExportTexts([{ path: "deviz", buf: Buffer.from(""), clientText: devizText(content) }], { allow });
        authorize({ op: "desk.finance.document" });
        const latest = desk.latestArtifact(r.id);
        const replaces = latest && !["DRAFT", "APPROVED_INTERNAL"].includes(latest.status) ? latest.id : null;
        const out = ledger.runSync({ root: desk.rootOf(r), op: "desk.finance.document", keyParams: { recordId: r.id, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, contentSha: hashCanonical(content), replaces },
          effect: () => {
            const inputsSha = desk.inputsShaOf(r);
            desk.saveState(r.id, { schema: 1, kind: "finance_doc", offer: o.facts, register: { internalNo: r.internalNo, docType: "Deviz", notFiscal: true }, registerStatus: "DRAFT" },
              { proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, source: { opportunityId: r.opportunityId, proposalVersion: o.proposal.version, serviceIds: o.facts.serviceIds }, inputsSha, actor: actorOf(planId) });
            const a = desk.createArtifact({ recordId: r.id, kind: "deviz", content, inputsSha, actor: actorOf(planId) });
            return { artifactId: a.id, contentSha: a.contentSha, version: a.version };
          },
          after: () => {
            desk.enterPreparing(desk.need(r.id), plan);
            const cur = desk.latestArtifact(r.id);
            if (!cur || !["DRAFT", "APPROVED_INTERNAL"].includes(cur.status)) throw stale("Devizul pregătit nu mai e curent.");
            desk.toWaiting(desk.need(r.id), cur);
          } });
        return { result: { ...out.result, duplicate: out.duplicate, opKey: out.key } };
      },
      reconcile: reconcileWith(({ planId, params }) => {
        const r = desk.get(params.recordId);
        if (!r || r.planId !== planId || r.status !== "WAITING_OWNER" || !r.awaited) return null;
        return { outcome: "done", result: { artifactId: r.awaited.artifactId, contentSha: r.awaited.sha }, detail: "devizul așteaptă aprobarea ta" };
      }),
    },
    "desk.finance.export": {
      describe: ({ recordId }) => {
        needRec(recordId);
        const base = exportsBase("finance_doc");
        return { title: "Scrie devizul aprobat în Word (verificat în Word, PDF exportat de Word), Markdown și JSON, README și manifest sha256, într-un folder nou; nu e emis fiscal, nimic trimis",
          params: { recordId }, ops: [{ op: "desk.finance.export" }, { op: "export.local", destination: path.join(base, "deviz.md") }, { op: "office.verify" }], folders: [base],
          observed: ["devizul aprobat de tine (id + SHA)"], transmitted: [], outputs: ["un folder local nou (o versiune), verificabil prin manifest"] };
      },
      run: ({ planId, params, authorize, abort }) => exportStep({ planId, params, authorize, abort, phase: "B", statuses: ["PACKAGING", "READY"], op: "desk.finance.export", prepare: financePrepare }),
      reconcile: exportReconcile("desk.finance.export", "B", financePrepare),
    },
  };
  return executors;
}
