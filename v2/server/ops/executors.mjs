// M10 plan-step executors. Each one DESCRIBES (side-effect free) what it will touch — apps, folders, data observed / transmitted,
// operations, outputs, model — for the plan card, and RUNS under the plan's derived authority (desktop operations through the
// Desktop Operator gate; Studio work through the media services directly, recorded with the plan as provenance). Steps whose outcome
// can be uncertain after a crash (an OBS recording, an import) RECONCILE by reading the real state instead of repeating.
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { notepadEditSave, capcutInspect, capcutNewProjectImport } from "../desktop/profiles.mjs";
import { parseInstruction } from "../media/review.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRef = (v) => typeof v === "string" && /^\$pas:\d+\./.test(v);

export function createExecutors({ desktop = null, media = null, settings, live = null }) {
  // ---------------------------------------------------------------- helpers
  const planCtx = ({ planId, stepId, authorize, plan }) => ({ kind: "plan", planId, stepId, actor: `plan:${planId}`, folders: plan?.authority?.folders || [], authorize });
  const runOn = (ctx) => (action) => desktop.perform(ctx, action);
  function needDesktop() { if (!desktop) throw new HubError("policy", "Desktop Operator nu e disponibil pe acest Hub.", { code: "DESKTOP_UNAVAILABLE" }); return desktop; }
  function needApp(id) { const a = needDesktop().apps.get(id); if (!a) throw new HubError("not_found", `Aplicație necunoscută: ${id}`); return a; }
  const checkAbort = (abort) => { if (abort?.aborted) throw new HubError("conflict", `Oprit: ${abort.reason || "pauză"}`, { code: "STOPPED" }); };
  /** Waits for a render job to finish (the queue is ticked here as well, so a plan does not depend on the scheduler cadence). */
  async function awaitRender(jobId, { abort, timeoutMs = 20 * 60000 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const job = media.render.get(jobId);
      if (["DONE", "FAILED", "CANCELLED", "INTERRUPTED"].includes(job?.status)) return job;
      if (abort?.aborted) { media.render.cancel(jobId, "plan:stop"); throw new HubError("conflict", `Oprit: ${abort.reason}`, { code: "STOPPED" }); }
      try { const r = media.render.tick(); r?.done?.catch?.(() => {}); } catch { /* the job row records it */ }
      await sleep(250);
    }
    throw new HubError("tool", "Randarea nu s-a terminat în timpul planului.", { code: "OUTCOME_UNKNOWN" });
  }
  async function renderVerified(editVersionId, profile, { actor, abort }) {
    const job = media.render.request({ editVersionId, profile, actor });
    const done = await awaitRender(job.id, { abort });
    if (done.status !== "DONE") throw new HubError("tool", `Randarea ${profile} nu a reușit (${done.status}): ${done.error?.message || ""}`.trim(), { code: "RENDER_FAILED" });
    return done;
  }
  const qaSummary = (qa) => ({ status: qa.status, kinds: Object.fromEntries(Object.entries(qa.reports || {}).map(([k, r]) => [k, r.status])),
    unjustified: Object.values(qa.reports || {}).flatMap((r) => (r.findings || []).filter((f) => f.severity !== "info" && !f.justified).map((f) => ({ kind: r.kind, code: f.code, message: String(f.message).slice(0, 160) }))) });
  /** What the owner sees separately: automated QA vs. creative review (never merged, never fabricated). */
  const reviewState = (editVersionId, qa) => {
    const decided = (media.reviews.list({ editVersionId }) || []).find((r) => r.kind === "CREATIVE_APPROVED" && r.status !== "DISMISSED");
    return { automatedQa: qa ? (qa.status === "PASS" ? "AUTOMATED_QA_PASS" : `AUTOMATED_QA_${qa.status}`) : "AUTOMATED_QA_NOT_RUN", creative: decided ? "CREATIVE_APPROVED" : "CREATIVE_REVIEW_PENDING" };
  };

  // ---------------------------------------------------------------- desktop
  const executors = {
    "desktop.app.open": {
      describe: ({ app }) => {
        const a = needApp(app);
        return { title: `Deschide ${a.displayName} și adu-l în față`, params: { app: a.id }, apps: [a.id], ops: [{ op: "app.launch", appId: a.id }, { op: "app.focus", appId: a.id }],
          observed: [`lista ferestrelor ${a.displayName}`], transmitted: [], outputs: [`${a.displayName} în prim-plan (verificat)`] };
      },
      run: async ({ planId, stepId, params, authorize, plan }) => {
        const ctx = planCtx({ planId, stepId, authorize, plan });
        const app = needApp(params.app);
        const run = runOn(ctx);
        const list = (await run({ op: "app.focus", helperOp: "listWindows", appId: app.id, args: { processNames: app.processNames } })).windows || [];
        let win = list.filter((w) => w.visible).at(-1);
        if (!win) {
          await run({ op: "app.launch", helperOp: "launch", appId: app.id, args: app.launch.kind === "aumid" ? { kind: "aumid", aumid: app.launch.aumid } : { kind: app.launch.kind, exe: app.launch.exe || app.exePath } });
          win = (await run({ op: "app.focus", helperOp: "waitWindow", appId: app.id, args: { processNames: app.processNames, timeoutMs: 45000 } })).window;
        }
        const f = await run({ op: "app.focus", helperOp: "focus", appId: app.id, args: { hwnd: win.hwnd } });
        return { result: { app: app.id, window: { hwnd: win.hwnd, pid: win.pid, procStart: win.procStart, title: String(win.title).slice(0, 80) }, foreground: Boolean(f.foreground) }, evidence: [{ foreground: Boolean(f.foreground) }] };
      },
    },
    "desktop.notepad.edit_save": {
      describe: ({ sourceFile, text, mode = "append", saveAs }) => {
        const a = needApp("notepad");
        if (!sourceFile || !saveAs) throw new HubError("validation", "Pasul Notepad cere fișierul de lucru și destinația.");
        return { title: `Notepad: deschide ${path.basename(sourceFile)}, scrie textul, salvează ca ${path.basename(saveAs)}`, params: { sourceFile, text: String(text || ""), mode, saveAs },
          apps: [a.id], folders: [...new Set([path.dirname(sourceFile), path.dirname(saveAs)])],
          ops: [{ op: "app.launch", appId: a.id, path: sourceFile }, { op: "app.focus", appId: a.id }, { op: "desktop.observe", appId: a.id }, { op: "ui.setText", appId: a.id },
            { op: "ui.keys", appId: a.id }, { op: "ui.type", appId: a.id }, { op: "file.saveAs", appId: a.id, destination: saveAs, overwrite: fs.existsSync(saveAs) }, { op: "ui.invoke", appId: a.id, controlName: "Save" }, { op: "window.move", appId: a.id }],
          observed: ["structura ferestrei Notepad", "textul fișierului de lucru (doar pentru verificare)"], transmitted: [], outputs: [saveAs] };
      },
      run: async ({ planId, stepId, params, authorize, plan }) => {
        const r = await notepadEditSave(runOn(planCtx({ planId, stepId, authorize, plan })), { app: needApp("notepad"), ...params });
        return { result: r, evidence: r.evidence };
      },
      reconcile: async ({ params }) => (fs.existsSync(params.saveAs) ? { outcome: "done", result: { file: params.saveAs }, detail: "fișierul salvat există" } : { outcome: "retry" }),
    },
    "desktop.capcut.inspect": {
      describe: () => { const a = needApp("capcut"); return { title: "CapCut: deschide și citește structura ferestrei (fără modificări)", params: {}, apps: [a.id], ops: [{ op: "app.launch", appId: a.id }, { op: "app.focus", appId: a.id }, { op: "desktop.observe", appId: a.id }],
        observed: ["structura ferestrei CapCut (fără valori din câmpuri)"], transmitted: [], outputs: ["lista controalelor accesibile structural"] }; },
      run: async ({ planId, stepId, authorize, plan }) => { const r = await capcutInspect(runOn(planCtx({ planId, stepId, authorize, plan })), { app: needApp("capcut") }); return { result: r, evidence: [{ verdict: r.verdict, nodes: r.nodes }] }; },
    },
    "desktop.capcut.new_project_import": {
      describe: ({ file }) => {
        const a = needApp("capcut");
        if (!file) throw new HubError("validation", "Pasul CapCut cere fișierul de test.");
        return { title: `CapCut: proiect nou de test și import ${path.basename(file)}`, params: { file }, apps: [a.id], folders: [path.dirname(file)],
          ops: [{ op: "app.launch", appId: a.id }, { op: "app.focus", appId: a.id }, { op: "desktop.observe", appId: a.id }, { op: "ui.invoke", appId: a.id }, { op: "file.open", appId: a.id, path: file }],
          observed: ["structura ferestrei CapCut"], transmitted: ["fișierul de test intră în proiectul local CapCut (fără încărcare în cloud din partea Hub-ului)"], outputs: ["proiect CapCut de test cu materialul importat (verificat structural)"] };
      },
      run: async ({ planId, stepId, params, authorize, plan }) => { const r = await capcutNewProjectImport(runOn(planCtx({ planId, stepId, authorize, plan })), { app: needApp("capcut"), file: params.file }); return { result: r, evidence: r.steps }; },
    },

    // ---------------------------------------------------------------- Studio
    "media.project.import": {
      // A folder outside the import roots ("importă din folderul acesta" on an arbitrary folder): the card shows what would be read
      // (names, types, sizes — no contents) and carries ONE decision, a one-time access for this import only (expires, consumed).
      // The global allowlist is never widened; protected folders (Hub data, repo, credentials, system) are refused outright.
      describe: ({ folder, access = null }) => {
        let p = null;
        try { p = media.bundles.preview({ dir: folder, actor: "plan:describe" }); }
        catch (error) {
          if (error.code !== "IMPORT_OUTSIDE_ROOTS") throw error;
          const a = media.importAccess.preview(folder);
          if (!a.hasProjectBundle && !a.files.some((f) => /^plan-de-montaj[^/]*\.json$/i.test(f.rel))) throw new HubError("validation", "Folderul nu conține un proiect Studio (proiect-studio.json) și nici planuri de montaj de reconstruit.", { code: "BUNDLE_MISSING" });
          const types = Object.entries(a.byType).map(([k, v]) => `${v} ${k}`).join(", ");
          return { title: `Importă proiectul din ${path.basename(a.folder)} (acces o singură dată la folder, doar pentru acest import)`, params: { folder: a.folder, access: { previewSha256: a.previewSha256 } },
            folders: [a.folder], ops: [{ op: "media.project.import", path: a.folder }],
            observed: [`${a.files.length} fișiere (${types || "niciunul"}); conținutul se citește doar la import`], transmitted: [], outputs: ["proiectul în Studio", "accesul la folder se consumă la import"] };
        }
        if (access) throw new HubError("conflict", "Folderul a devenit între timp folder de import; îți arăt planul din nou.", { code: "IMPORT_ACCESS_CHANGED" });
        if (p.problems.length) throw new HubError("validation", `Pachetul are probleme: ${p.problems.slice(0, 4).join("; ")}`, { code: "BUNDLE_PROBLEMS" });
        return { title: `Importă proiectul „${p.title}” în Studio${p.alreadyImported ? " (deja importat: îl deschid)" : ""}`, params: { folder, importId: p.importId, previewHash: p.previewHash },
          folders: [folder], ops: [{ op: "media.project.import", path: folder }],
          observed: [`${p.assets.length} fișiere sursă (hash verificat)`, `${p.edits.reduce((n, e) => n + e.versions, 0)} versiuni de montaj`, p.labels.length ? `etichete păstrate: ${p.labels.join(", ")}` : "fără etichete"],
          transmitted: [], outputs: [`proiectul în Studio${p.missing.length ? ` (lipsesc: ${p.missing.join(", ")})` : ""}`, "revizuirea creativă rămâne în așteptare"] };
      },
      run: async ({ params, planId, plan, authorize }) => {
        authorize({ op: "media.project.import", path: params.folder });
        let { importId, previewHash } = params;
        let grant = null;
        if (params.access) {
          grant = media.importAccess.authorize({ dir: params.folder, mode: "once", previewSha256: params.access.previewSha256, planId, ownerSessionId: plan?.authority?.sessionId || null, actor: `plan:${planId}` });
          // M10.2: the one-time access is consumed on EVERY failure after it was granted (an unreadable or invalid manifest threw
          // before, leaving the folder an import root until its expiry).
          let p;
          try { p = media.bundles.preview({ dir: params.folder, actor: `plan:${planId}` }); }
          catch (error) { media.importAccess.markUsed(grant.grantId); throw error; }
          if (p.problems.length) { media.importAccess.markUsed(grant.grantId); throw new HubError("validation", `Pachetul are probleme: ${p.problems.slice(0, 4).join("; ")}`, { code: "BUNDLE_PROBLEMS" }); }
          ({ importId, previewHash } = p);
        }
        let r;
        try { r = await media.bundles.confirmImport({ importId, previewHash, actor: `plan:${planId}` }); }
        finally { if (grant) media.importAccess.markUsed(grant.grantId); }
        const editProject = media.edits.list({ contentProjectId: r.contentProjectId })[0] || null;
        const edit = editProject ? media.edits.get(editProject.id) : null;
        return { result: { contentProjectId: r.contentProjectId, editProjectId: edit?.id || null, editVersionId: edit?.current?.id || null, duplicate: r.duplicate, missing: r.missing || [] }, evidence: [{ importId: r.importId, duplicate: r.duplicate }] };
      },
      // The import is idempotent by its key (same manifest + folder → the same project), so a retry never duplicates it.
      reconcile: async ({ params }) => { if (!params.importId) return { outcome: "retry" }; const g = media.bundles.get(params.importId); return g?.status === "IMPORTED" ? { outcome: "done", result: { contentProjectId: g.contentProjectId }, detail: "importul s-a încheiat" } : g?.status === "FAILED" ? { outcome: "retry" } : { outcome: "unknown", detail: `import ${g?.status || "necunoscut"}` }; },
    },
    "media.edit.correct": {
      // With reviewId: the correction Lega already PROPOSED (and showed) on that version is the one applied — never a second parse.
      describe: ({ editVersionId, text, atSec, selectedItemId = null, render = "draft", reviewId = null }) => {
        const v = isRef(editVersionId) ? null : media.edits.getVersion(editVersionId);
        if (!isRef(editVersionId) && !v) throw new HubError("not_found", "Versiunea de montaj nu există.");
        let preview = null;
        if (reviewId) {
          const rv = media.reviews.get(reviewId);
          if (!rv || rv.editVersionId !== editVersionId) throw new HubError("not_found", "Propunerea de corectură nu e pe această versiune.", { code: "REVIEW_MISSING" });
          if (rv.status !== "OPEN") throw new HubError("conflict", `Propunerea de corectură nu mai e deschisă (${rv.status}).`, { code: "REVIEW_NOT_OPEN" });
          if (rv.patch?.clarification) throw new HubError("validation", rv.patch.clarification, { code: "NEEDS_CLARIFICATION", data: { options: rv.patch.options || [] } });
          if (!(rv.patch?.ops || []).length) throw new HubError("validation", "Propunerea nu conține o modificare aplicabilă.", { code: "REVIEW_NO_OPS" });
          preview = { ops: rv.patch.ops };
        } else if (v) {
          preview = parseInstruction(text, { ir: v.ir, atMs: Number.isFinite(atSec) ? Math.round(atSec * 1000) : null, selectedItemId });
          if (preview.clarification) throw new HubError("validation", preview.clarification, { code: "NEEDS_CLARIFICATION", data: { options: preview.options || [] } });
        }
        return { title: `Corectură la ${atSec ?? "?"} s: „${String(text).slice(0, 60)}” → versiune nouă${render !== "none" ? ` + randare ${render} + QA` : ""}`, params: { editVersionId, text, atSec, selectedItemId, render, reviewId },
          ops: [{ op: "media.edit.apply" }, ...(render !== "none" ? [{ op: "media.render" }, { op: "media.qa" }] : [])], observed: ["planul de montaj al versiunii curente"], transmitted: [],
          outputs: [preview ? `operații: ${preview.ops.map((o) => o.op).join(", ")}` : "operațiile, după pasul anterior", "originalul rămâne neschimbat"] };
      },
      run: async ({ params, planId, abort, authorize }) => {
        const actor = `plan:${planId}`;
        authorize({ op: "media.edit.apply" });
        const proposal = params.reviewId ? media.reviews.get(params.reviewId)
          : media.reviews.propose({ editVersionId: params.editVersionId, text: params.text, timecodeMs: Number.isFinite(params.atSec) ? Math.round(params.atSec * 1000) : null, provenance: "lega", actor, selectedItemId: params.selectedItemId || null });
        if (proposal.patch?.clarification) throw new HubError("validation", proposal.patch.clarification, { code: "NEEDS_CLARIFICATION", data: { options: proposal.patch.options || [] } });
        const applied = media.reviews.apply({ reviewId: proposal.id, actor });
        checkAbort(abort);
        let job = null, qa = null;
        if (params.render !== "none") {
          authorize({ op: "media.render" });
          job = await renderVerified(applied.version.id, params.render || "draft", { actor, abort });
          authorize({ op: "media.qa" });
          qa = await media.qa.run({ editVersionId: applied.version.id, assetVersionId: job.outputAssetVersionId, actor });
        }
        return { result: { reviewId: proposal.id, editVersionId: applied.version.id, previousVersionId: params.editVersionId, ops: (proposal.patch?.ops || []).map((o) => o.op), renderJobId: job?.id || null,
          assetVersionId: job?.outputAssetVersionId || null, qa: qa ? qaSummary(qa) : null, review: reviewState(applied.version.id, qa) }, evidence: [{ diff: applied.diff?.summary || [] }] };
      },
    },
    "media.variant.render": {
      describe: ({ masterVersionId, platformKey }) => ({ title: `Variantă ${platformKey}: încadrare, texte lizibile, randare finală și QA`, params: { masterVersionId, platformKey },
        ops: [{ op: "media.variant" }, { op: "media.render" }, { op: "media.qa" }], observed: ["planul de montaj al masterului"], transmitted: [], outputs: [`varianta ${platformKey} randată, cu raport QA`] }),
      run: async ({ params, planId, abort, authorize }) => {
        const actor = `plan:${planId}`;
        authorize({ op: "media.variant" });
        const d = media.variants.derive({ masterVersionId: params.masterVersionId, platformKey: params.platformKey, actor });
        checkAbort(abort);
        authorize({ op: "media.render" });
        const job = await renderVerified(d.version.id, "final", { actor, abort });
        authorize({ op: "media.qa" });
        const qa = await media.qa.run({ editVersionId: d.version.id, assetVersionId: job.outputAssetVersionId, platform: params.platformKey, actor });
        return { result: { variantId: d.variant?.id || null, editVersionId: d.version.id, assetVersionId: job.outputAssetVersionId, renderJobId: job.id, changes: (d.changes || []).length, qa: qaSummary(qa), review: reviewState(d.version.id, qa) },
          evidence: [{ legibility: (d.changes || []).filter((c) => c.kind === "text_legibility").map((c) => c.message) }] };
      },
    },
    "media.render": {
      describe: ({ editVersionId, profile = "final" }) => ({ title: `Randare ${profile} + QA`, params: { editVersionId, profile }, ops: [{ op: "media.render" }, { op: "media.qa" }], observed: [], transmitted: [], outputs: [`randare ${profile} verificată`] }),
      run: async ({ params, planId, abort, authorize }) => {
        const actor = `plan:${planId}`;
        authorize({ op: "media.render" });
        const job = await renderVerified(params.editVersionId, params.profile || "final", { actor, abort });
        authorize({ op: "media.qa" });
        const qa = await media.qa.run({ editVersionId: params.editVersionId, assetVersionId: job.outputAssetVersionId, actor });
        return { result: { renderJobId: job.id, assetVersionId: job.outputAssetVersionId, qa: qaSummary(qa), review: reviewState(params.editVersionId, qa) } };
      },
    },
    "media.export.local": {
      describe: ({ assetVersionId, name = null }) => ({ title: `Exportă local în ${media.exportsDir() || "folderul de exporturi"}${name ? ` ca „${name}”` : ""} (fără publicare)`, params: { assetVersionId, name },
        folders: media.exportsDir() ? [media.exportsDir()] : [], ops: [{ op: "export.local", destination: media.exportsDir() ? path.join(media.exportsDir(), "x.mp4") : undefined }], observed: [], transmitted: [], outputs: ["fișier local nou (fără suprascriere)"] }),
      run: async ({ params, planId, authorize }) => { authorize({ op: "export.local" }); const r = media.exportLocal({ assetVersionId: params.assetVersionId, name: params.name, actor: `plan:${planId}` }); return { result: r }; },
    },
    // M10.2 (U10): the automatic readiness step a Studio plan lists when ffmpeg/ffprobe are not pinned yet (blockers.mjs
    // MEDIA_TOOLS_UNPINNED → "fixez ca pas al planului confirmat"). The card shows the exact identity seen at proposal (version +
    // sha256); the run re-inspects and pins ONLY that identity — a binary replaced in between stops the plan (nothing written), and a
    // change is never acknowledged here (that stays media.tools.acknowledge, the owner's decision). No file or desktop operation: it
    // writes the Hub's own pin record, authorized by the plan's one confirmation (status, expiry, session, budget checked first).
    "media.tools.pin": {
      // M10.2 (#30): the shown identity carries the shared-library set (libsSha256) and the version too — the DLLs next to a shared
      // ffmpeg build are where decoding happens, so they are part of what the owner confirms; the card prefixes the libs hash.
      describe: ({ expect = null } = {}) => {
        const shown = expect && typeof expect === "object" ? Object.fromEntries(["ffmpeg", "ffprobe"].filter((t) => expect[t]?.sha256)
          .map((t) => [t, { version: expect[t].version || null, sha256: String(expect[t].sha256), libsSha256: expect[t].libsSha256 ? String(expect[t].libsSha256) : null }])) : null;
        const label = shown && Object.keys(shown).length
          ? Object.entries(shown).map(([t, v]) => `${t} ${v.version || "?"} (sha256 ${v.sha256.slice(0, 12)}…${v.libsSha256 ? `, biblioteci ${v.libsSha256.slice(0, 8)}…` : ""})`).join(", ") : "ffmpeg și ffprobe";
        return { title: `Fixează uneltele de randare: ${label}`, params: { expect: shown }, ops: [], observed: ["versiunea, sha256 și bibliotecile ffmpeg/ffprobe (fără conținut)"], transmitted: [],
          outputs: ["identitatea uneltelor fixată; orice binar schimbat ulterior îți e arătat, nu adoptat"] };
      },
      run: async ({ params, planId, authorize }) => {
        authorize({});
        if (!media?.tools?.pin) throw new HubError("tool", "Uneltele media nu sunt disponibile.", { code: "TOOL_MISSING" });
        // The expected identity is compared INSIDE the pin transaction, on the identity being recorded (no inspect() → pin() gap): a
        // binary or DLL set replaced after the card was drawn refuses with TOOL_CHANGED and writes nothing.
        const r = await media.tools.pin({ actor: `plan:${planId}`, reason: "pas de pregătire al planului confirmat", expect: params.expect || null });
        if (r.changed.length) throw new HubError("conflict", `${r.changed.join(", ")} s-a schimbat față de identitatea fixată: schimbarea e înregistrată și o confirmi tu în Studio → Unelte („Confirmă schimbarea”).`, { code: "TOOL_CHANGED" });
        return { result: { pinned: r.pinned, unchanged: r.unchanged, states: r.tools?.states || {} } };
      },
      // Pinning is idempotent (an already-pinned identity writes nothing), so a retry after a crash is safe.
      reconcile: async () => ({ outcome: "retry" }),
    },
    "media.edit.from_capture": {
      describe: ({ assetVersionId, title, hook = "", label = "SIMULARE · Hub de test cu date sintetice" }) => ({ title: `Montaj din captură: „${title}” (etichetă „${label}”)`, params: { assetVersionId, title, hook, label },
        ops: [{ op: "media.edit.apply" }], observed: ["captura importată"], transmitted: [], outputs: ["plan de montaj nou (16:9) cu eticheta păstrată"] }),
      run: async ({ params, planId, authorize }) => {
        authorize({ op: "media.edit.apply" });
        const v = media.assets.getVersion(params.assetVersionId);
        if (!v) throw new HubError("not_found", "Captura nu e în bibliotecă.");
        const fps = { num: 30, den: 1 };
        const frames = Math.max(30, Math.floor(((v.probe?.durationMs || 4000) / 1000) * 30) - 1);
        const ir = { irVersion: 1, fps, canvas: { width: 1920, height: 1080, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
          tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: v.id, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION", fit: "contain" }] },
            { id: "lbl", kind: "text", items: [{ id: "l1", start: 0, end: frames, text: params.label, style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
            ...(params.hook ? [{ id: "hk", kind: "text", items: [{ id: "h1", start: 0, end: Math.min(frames, 90), text: params.hook, style: "hook", anchor: "bottom", x: 0.5, y: 0.86 }] }] : [])],
          markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: params.title, labels: ["SIMULATION"], author: `plan:${planId}`, notes: "Montaj generat din captură de planul Lega (fără model)." } };
        const created = media.edits.create({ contentProjectId: v.contentProjectId || null, title: params.title, ir, actor: `plan:${planId}` });
        return { result: { editProjectId: created.project.id, editVersionId: created.version.id } };
      },
    },

    // ---------------------------------------------------------------- capture
    "capture.browser_demo": {
      describe: ({ origin, steps = [], title = "Demonstrație", contentProjectId = null, captureLabel = "SIMULATION", maxDurationMs = 60000 }) => ({ title: `Captură demo (Public Demo Mode) pe ${origin}`, params: { origin, steps, title, contentProjectId, captureLabel, maxDurationMs },
        ops: [{ op: "capture.browser" }], observed: [`paginile ${origin} din pașii demonstrației (date sensibile mascate înainte de primul cadru)`], transmitted: [], outputs: ["înregistrare în biblioteca Studio (etichetată)"] }),
      run: async ({ params, planId, plan, authorize }) => {
        const actor = `plan:${planId}`;
        authorize({ op: "capture.browser" });
        const scope = { origin: params.origin, steps: params.steps.length, purpose: "record", audio: false, destination: "library", maxDurationMs: params.maxDurationMs, retention: "library", redactions: "default" };
        const session = media.capture.planSession({ contentProjectId: params.contentProjectId, kind: "browser_demo", scope, captureLabel: params.captureLabel, actor });
        media.capture.approveScope(session.id, { decisionId: planId, ownerSessionId: plan?.authority?.sessionId || plan?.consent?.sessionId || "unknown", expiresAt: plan?.expiresAt, actor });
        const allowed = new Set([new URL(params.origin).origin]);
        const r = await media.capture.captureBrowserDemo({ sessionId: session.id, origin: params.origin, steps: params.steps, captureLabel: params.captureLabel, title: params.title, contentProjectId: params.contentProjectId,
          maxDurationMs: params.maxDurationMs, actor, allowOrigin: (o) => allowed.has(o) });
        return { result: { sessionId: session.id, assetId: r.asset?.id || null, assetVersionId: r.version?.id || null, durationMs: r.durationMs }, evidence: [{ frames: r.frames, markers: (r.markers || []).length }] };
      },
    },
    "capture.obs_record": {
      describe: ({ durationSec = 20, scene = null, recordingRoot, obsUrl = "ws://127.0.0.1:4455", contentProjectId = null, title = "Înregistrare OBS" }) => {
        if (!recordingRoot) throw new HubError("validation", "Pasul OBS cere folderul înregistrărilor OBS (pentru import).");
        return { title: `OBS: înregistrează ${durationSec} s${scene ? ` (scena „${scene}”)` : ""}, oprește, verifică fișierul și importă-l`, params: { durationSec, scene, recordingRoot, obsUrl, contentProjectId, title },
          apps: ["obs"], folders: [recordingRoot], ops: [{ op: "capture.obs" }, { op: "media.import", path: recordingRoot }],
          observed: ["starea OBS (înregistrare activă / oprită)", "fișierul înregistrat"], transmitted: [], outputs: ["fișierul OBS verificat (ffprobe) și importat în Studio"] };
      },
      run: async ({ params, planId, abort, plan, secrets, authorize }) => {
        const actor = `plan:${planId}`;
        // Both operations are authorized BEFORE the recording starts: stopping is never refused (it only ends what this plan
        // started), and the stop imports the file from the approved recording folder as part of the same step.
        authorize({ op: "capture.obs", appId: "obs" });
        authorize({ op: "media.import", path: params.recordingRoot });
        const scope = { obsUrl: params.obsUrl, recordingRoot: params.recordingRoot, scene: params.scene || undefined, durationSec: params.durationSec, purpose: "record", audio: "conform setărilor OBS", title: params.title, retention: "library" };
        const session = media.capture.planSession({ contentProjectId: params.contentProjectId, kind: "obs", scope, captureLabel: "ORIGINAL_RECORDING", actor });
        media.capture.approveScope(session.id, { decisionId: planId, ownerSessionId: plan?.authority?.sessionId || "unknown", expiresAt: plan?.expiresAt, actor });
        await media.capture.startObsRecording(session.id, { password: secrets?.obsPassword || null, actor });
        const end = Date.now() + Math.max(1, params.durationSec) * 1000;
        while (Date.now() < end && !abort?.aborted) await sleep(200);
        const stopped = await media.capture.stopObsRecording(session.id, { password: secrets?.obsPassword || null, actor });
        if (!stopped.outputAssetId) throw new HubError("tool", `Înregistrarea s-a oprit, dar fișierul nu a fost importat: ${stopped.error || stopped.scope?.result?.outputPath || "OBS nu a raportat calea"}.`, { code: "OBS_IMPORT_FAILED" });
        const asset = media.assets.get(stopped.outputAssetId);
        return { result: { sessionId: session.id, assetId: stopped.outputAssetId, assetVersionId: asset?.current?.id || null, outputPath: stopped.scope?.result?.outputPath || null, stoppedEarly: Boolean(abort?.aborted) } };
      },
      // After a crash: if OBS is still recording for this session, stop it (fail-safe); never start a second recording.
      reconcile: async ({ stepId }) => ({ outcome: "unknown", detail: `verifică în OBS dacă înregistrarea (pasul ${stepId}) mai rulează; o oprești din Studio → Captură` }),
    },
  };
  return executors;
}
