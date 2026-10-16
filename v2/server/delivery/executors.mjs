// M11 „Ifrim Delivery” — the step executors of a delivery plan ('delivery.package' derived from the envelope, or 'delivery.revise').
// Each has describe() (pure, deterministic: what the step touches, hashed in the plan body) and run() (every operation asks
// authorize() first). Steps act only for the delivery whose ops plan is running (CAPTURE_NOT_BOUND otherwise). No model is ever
// started here; nothing is published, accepted or approved.
import path from "node:path";
import { hashCanonical } from "../core/canonical.mjs";
import { irMetadata } from "./correction.mjs";
import { HubError } from "../core/errors.mjs";
import { criterionRef, displaySha } from "../media/claims.mjs";
import { presentationForTemplate, provePresentation, claimState, storyFromPresentation } from "./presentation.mjs";
import { probeUrl } from "../factory/runner.mjs";
import { assertSyntheticProject, checkPreviewTarget, probeNotHub, pageGuard } from "./capture-guard.mjs";
import { buildMaster } from "./clip-ir.mjs";
import { slotsComplete } from "./stale.mjs";

/** How long a delivery waits for its preview to answer (a cold sandbox included). */
export const PREVIEW_WAIT_MS = 240000;
const refuse = (code, message) => new HubError("policy", message, { code });
const checkAbort = (abort) => { if (abort?.aborted) throw new HubError("task", "Planul a fost oprit.", { code: "STOPPED" }); };

export function createDeliveryExecutors({ deliveries, factory, media, projects, runner, supervisor, opsPlans, config, fetchImpl = globalThis.fetch }) {
  const describedDelivery = id => { const d = deliveries.get(id); return d ? { ...d, template: deliveries.effectiveTemplate(d) } : null; };
  /** The delivery a running step belongs to: ACTIVE (or READY for a revision) and bound to THIS plan. */
  function bound(params, planId, { statuses = ["ACTIVE"] } = {}) {
    let d = deliveries.need(params.deliveryId);
    // The delivery-only card: the first step of the confirmed plan starts the PLANNED delivery it was proposed for.
    if (d.status === "PLANNED" && d.opsPlanId === planId) d = deliveries.startDirect(d.id, planId);
    const revision = d.opsPlanId !== planId && Boolean(planRevision(d.id, planId));
    if (d.opsPlanId !== planId && !revision) throw refuse("CAPTURE_NOT_BOUND", "Pasul nu aparține planului acestei livrări.");
    if (revision ? !["READY", "NEEDS_OWNER"].includes(d.status) : !statuses.includes(d.status)) throw refuse("DELIVERY_NOT_ACTIVE", `Livrarea e ${d.status}; pașii ei nu rulează.`);
    return { d: { ...d, template: deliveries.effectiveTemplate(d, { planId }) }, revision };
  }
  const planRevision = (deliveryId, planId) => deliveries.revisionOfPlan(deliveryId, planId);
  const snapshotEqual = (d) => {
    const s = factory.snapshotCheck(d.missionId);
    const drift = factory.driftProvenance(d.projectId, s.changedFiles);
    if (drift.software.length) {
      deliveries.trigger(d.id, "software_changed", { changedFiles: s.changedFiles, cause: `fișiere schimbate: ${s.changedFiles.slice(0, 5).join(", ") || "snapshot diferit"}` }, "delivery");
      throw refuse("SNAPSHOT_DRIFT", `Proiectul nu mai e versiunea verificată (${s.changedFiles.slice(0, 5).join(", ") || "snapshot diferit"}); nimic nu se filmează.`);
    }
    if (!s.expected || s.expected !== d.snapshotSha || s.bundleId !== d.bundleId || (d.changeSetId && s.changeSetId !== d.changeSetId)) throw refuse("SNAPSHOT_DRIFT", "Legătura cu versiunea verificată nu mai corespunde; nimic nu se filmează.");
    deliveries.verify(d.id, { by: "delivery" });
    return s;
  };
  const exportsDest = (d) => path.join(d.template.exports.dir, d.template.exports.folder, "x.mp4");
  const doneResult = (planId, kind) => (opsPlans.view(planId)?.steps || []).filter((s) => s.kind === kind && s.status === "DONE").map((s) => s.result).at(-1) || null;

  return {
    "delivery.correct.prepare": {
      describe: ({ deliveryId, revisionId, correctionSha }) => {
        const rev = deliveries.getRevision(revisionId);
        if (rev?.deliveryId !== deliveryId || rev.delta?.correctionSha !== correctionSha || hashCanonical(rev.delta.correction) !== correctionSha) throw refuse('CORRECTION_RECORD', 'Corectura imuabilă nu corespunde.');
        return { title: 'Verifică baza corecturii confirmate', params: { deliveryId, revisionId, correctionSha }, ops: [{ op: 'delivery.verify' }], observed: [], transmitted: [], outputs: rev.delta.correction.outputs };
      },
      run: async ({ params, planId, authorize }) => {
        bound(params, planId); authorize({ op: 'delivery.verify' });
        const rev = deliveries.revisionOfPlan(params.deliveryId, planId);
        if (rev?.id !== params.revisionId || rev.delta?.correctionSha !== params.correctionSha || hashCanonical(rev.delta.correction) !== params.correctionSha) throw refuse('CORRECTION_RECORD', 'Corectura nu corespunde planului.');
        await deliveries.checkCorrection(params.deliveryId, rev.delta.correction);
        return { result: { correctionSha: params.correctionSha } };
      },
    },
    "delivery.prepare": {
      describe: ({ deliveryId }) => ({ title: "Verifică pachetul software și pregătește proiectul de conținut al livrării", params: { deliveryId },
        ops: [{ op: "delivery.verify" }, { op: "delivery.bind" }], observed: ["pachetul verificat și proiectul de test (date sintetice)"], transmitted: [], outputs: ["proiectul de conținut al livrării"] }),
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId);
        authorize({ op: "delivery.verify" });
        snapshotEqual(d);
        const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
        if (!["READY_FOR_OWNER_ACCEPTANCE", "OWNER_ACCEPTED"].includes(facts.bundle.status)) throw refuse("DELIVERY_BUNDLE", "Pachetul software nu mai e gata (nici acceptat).");
        authorize({ op: "delivery.bind" });
        let contentProjectId = d.contentProjectId;
        if (!contentProjectId) {
          const project = media.content.createProject({ title: `Livrare: ${d.template.project.name} — demo`, audience: "both", format: "demo" }, "delivery");
          contentProjectId = project.id;
        }
        const presentation = presentationForTemplate(d.template, facts);
        const block = { noun: d.template.story.noun, ...storyFromPresentation(presentation) };
        const brief = media.content.saveBrief(contentProjectId, { authorKind: "template", author: "delivery", body: {
          objective: `Arătăm unui business cum funcționează ${block?.noun || "fluxul"} pe demo-ul local verificat: ${d.template.issueTitle}`.slice(0, 1000), audience: "both",
          angles: { business: "Ce problemă are clientul, ce vede pe telefon și pe desktop, cât de simplu e fluxul.", technical: "Testul de acceptanță și verificarea în browser care dovedesc fixul." },
          cta: block?.texts?.cta?.business || "Hai să discutăm", constraints: ["Date sintetice", "Fără publicare", "Fără ROI sau prețuri inventate"], mustAvoid: ["date reale", "afirmații fără dovadă"] } });
        deliveries.bindItem(d.id, { kind: "brief", role: "", refTable: "content_briefs", refId: brief.id || `${contentProjectId}@${brief.version}`, refSha: brief.sha256 || "", meta: { version: brief.version, tone: "both", ...(presentation.origin ? { origin: presentation.origin } : {}) } }, `plan:${planId}`);
        if (contentProjectId !== d.contentProjectId) deliveries.patch(d.id, { content_project_id: contentProjectId });
        return { result: { contentProjectId, bundleId: facts.bundle.id } };
      },
    },

    "delivery.preview.ensure": {
      describe: ({ deliveryId }) => ({ title: "Pornește sau refolosește preview-ul versiunii verificate", params: { deliveryId }, ops: [{ op: "delivery.preview" }], observed: ["preview-ul local al proiectului de test"], transmitted: [], outputs: ["preview local pornit"] }),
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId);
        authorize({ op: "delivery.preview" });
        const fp = factory.previewStatus(d.missionId);
        if (fp.running) { const p = await probeUrl(d.template.preview.url); if (p.status >= 200 && p.status < 400) return { result: { key: fp.key, url: d.template.preview.url, reused: true } }; }
        snapshotEqual(d);
        const key = `delivery-preview-${d.id}`;
        const project = projects.get(d.projectId);
        // Pilot 2026-10-08: the first command through the Windows sandbox after a Hub start takes minutes (181 s at the pilot's BASELINE);
        // the default 20 s wait failed the delivery with ECONNREFUSED while the preview was still starting.
        const r = await runner.startPreview({ key, ws: project.path, command: d.template.preview.command, url: d.template.preview.url, project, waitMs: PREVIEW_WAIT_MS });
        if (r.status !== "PASS") throw new HubError("tool", `Preview-ul nu a pornit: ${r.reason || r.status}`, { code: "DELIVERY_PREVIEW_FAILED" });
        return { result: { key, url: d.template.preview.url, reused: false } };
      },
    },

    "delivery.capture": {
      describe: ({ deliveryId, role, revisionId }) => ({ title: role === "mobile" ? "Filmează demo-ul la lățimea unui telefon (390 px) în Chromium" : "Filmează demo-ul pe desktop", params: { deliveryId, role, ...(revisionId ? { revisionId } : {}) },
        ops: [{ op: "capture.preview" }], observed: ["preview-ul local al proiectului de test (date sintetice), într-un browser izolat"], transmitted: [], outputs: [`captură ${role === "mobile" ? "telefon" : "desktop"} în biblioteca media`] }),
      run: async ({ params, planId, authorize, abort }) => {
        const { d } = bound(params, planId);
        authorize({ op: "capture.preview" });
        const cap = d.template.captures.find((c) => c.role === params.role);
        if (!cap) throw refuse("CAPTURE_ROLE", `Rolul de captură „${params.role}” nu e în planul confirmat.`);
        // Every condition before the browser launches (a refusal launches nothing).
        const project = projects.get(d.projectId);
        const marker = deliveries.markerOf(project) || {};
        assertSyntheticProject(project, marker, { config });
        const before = snapshotEqual(d);
        const binding = factory.deliveryBinding(d.missionId);
        const targetOf = () => checkPreviewTarget({ origin: d.template.preview.origin, delivery: { id: d.id, missionId: d.missionId, template: d.template, startUrl: binding?.startUrl }, supervisor, config });
        let target;
        try { target = targetOf(); }
        catch (error) {
          // Stage before M12 (criterion 5, found by the closed-browser run): the reused factory preview ended between the two captures. A
          // recoverable technical stop: the delivery starts its OWN supervised preview of the same verified version (bounded: once), then
          // every guard runs again; a foreign process on the port is still never filmed.
          if (error?.code !== "CAPTURE_PREVIEW_NOT_SUPERVISED") throw error;
          checkAbort(abort);
          const r = await runner.startPreview({ key: `delivery-preview-${d.id}`, ws: project.path, command: d.template.preview.command, url: d.template.preview.url, project, waitMs: PREVIEW_WAIT_MS });
          if (r.status !== "PASS") throw new HubError("tool", `Preview-ul livrării nu a putut fi repornit: ${r.reason || r.status}`, { code: "DELIVERY_PREVIEW_FAILED" });
          target = targetOf();
        }
        await probeNotHub(target.origin, { fetch: fetchImpl, config });
        checkAbort(abort);
        const scope = { kind: "delivery_preview", origin: target.origin, deliveryId: d.id, bundleId: d.bundleId, bundleSha: d.bundleSha, snapshotSha: d.snapshotSha, role: cap.role, viewport: cap.viewport,
          steps: cap.steps.length, purpose: "record", audio: false, destination: "library", retention: "library", dataKind: "synthetic" };
        const session = media.capture.planSession({ contentProjectId: d.contentProjectId, kind: "browser_demo", scope, captureLabel: cap.captureLabel, actor: `plan:${planId}` });
        const out = await media.capture.captureBrowserDemo({ sessionId: session.id, origin: target.origin, allowOrigin: (o) => o === target.origin, steps: cap.steps, viewport: cap.viewport,
          deviceScaleFactor: cap.dsf, fps: cap.fps, maxDurationMs: cap.maxDurationMs, redactSelectors: cap.redactSelectors, captureLabel: cap.captureLabel,
          title: `${d.template.project.name} — ${cap.label || cap.role}`, pageGuard: pageGuard({ bannerSelector: d.template.data.bannerSelector }), actor: `plan:${planId}` });
        // The snapshot bracket: a project that changed during the capture makes the capture unbound (it stays in the library).
        const after = factory.snapshotCheck(d.missionId);
        if (after.actual !== before.actual) throw refuse("SNAPSHOT_DRIFT", `Proiectul s-a schimbat în timpul capturii (${after.changedFiles.slice(0, 5).join(", ")}); captura nu se leagă de livrare.`);
        const bundleItem = deliveries.currentItem(d.id, "bundle");
        const item = deliveries.bindItem(d.id, { kind: "capture", role: cap.role, refTable: "media_asset_versions", refId: out.version.id, refSha: out.version.sha256 || "", upstream: bundleItem ? [bundleItem.id] : [],
          meta: { viewport: cap.viewport, dsf: cap.dsf, label: cap.captureLabel, durationMs: out.durationMs, width: out.width, height: out.height, markers: out.markers, sessionId: session.id, snapshotBefore: before.actual, snapshotAfter: after.actual,
            // R-MEDIA: the measured pauses of this capture (bound to its asset version, session and steps sha) and the refused ones, by code.
            stepsSha: out.stepsSha || null, holds: out.holds || [], holdsRejected: (out.holdsRejected || []).map((h) => ({ reason: h.reason, step: h.step, code: h.code })) } }, `plan:${planId}`);
        return { result: { assetVersionId: out.version.id, durationMs: out.durationMs, itemId: item.id } };
      },
    },

    "delivery.edit.build": {
      describe: ({ deliveryId, revisionId }) => ({ title: "Construiește montajul 16:9 din cele două capturi (fără model)", params: { deliveryId, ...(revisionId ? { revisionId } : {}) }, ops: [{ op: "media.edit.apply" }, { op: "delivery.bind" }], observed: [], transmitted: [], outputs: ["montaj 16:9 (versiunea 1)"] }),
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId);
        authorize({ op: "media.edit.apply" });
        const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
        const presentation = presentationForTemplate(d.template, facts);
        const proofs = provePresentation(presentation, facts);
        const block = { ...d.template.story, ...storyFromPresentation(presentation) };
        const passed = new Set(Object.values(proofs).filter(p => p.ok).map(p => p.id));
        const claimIdBySlot = {}, claimIdByRole = {}, claimItems = [], omitted = [];
        const oldClaimIds = params.revisionId ? deliveries.items(d.id).filter(i => i.kind === 'claim' && i.status === 'CURRENT').map(i => i.id) : [];
        const shown = [];
        for (const c of presentation.claims.filter(c => c.key.startsWith("clip."))) {
          const state = claimState(c, proofs);
          if (state.shown) shown.push(c);
          else omitted.push({ id: "t-" + c.key.slice(5), reason: state.code, criteria: c.needs.map(n => n.id || n.refId) });
        }
        for (const [role, cap] of Object.entries(presentation.captures)) {
          const c = { key: "capture." + role, status: "BOUND", needs: [cap], texts: { text: cap.text.slice(0, 500) } };
          const state = claimState(c, proofs);
          if (state.shown) shown.push(c);
          else omitted.push({ id: c.key, reason: state.code, criteria: [cap.id] });
        }
        authorize({ op: "delivery.bind" });
        const bundleItem = deliveries.currentItem(d.id, "bundle");
        deliveries.replaceClaimItems(d.id, shown.map(c => c.key), () => {
          for (const c of shown) {
            const slot = c.key.startsWith("clip.") ? c.key.slice(5) : null;
            const evidence = [{ kind: "bundle", ref: facts.bundle.id, sha256: facts.bundle.sha256 },
              ...c.needs.map(n => ({ kind: "criterion", ref: criterionRef(facts.specRow.sha256, n.id), sha256: n.fp }))];
            if (slot) {
              for (const tone of ["business", "technical"]) evidence.push({ kind: "display", ref: "t-" + slot + ":" + tone, sha256: displaySha(c.texts[tone]) });
              const override = presentation.claims.find(v => v.key === "variant." + (slot === "hook" ? "hookText" : slot === "cta" ? "ctaText" : ""));
              if (override && claimState(override, proofs).shown) evidence.push({ kind: "display", ref: "t-" + slot + ":vertical", sha256: displaySha(override.texts.text) });
            }
            const seen = new Set();
            for (const n of c.needs) for (const row of proofs[n.id].evidence) {
              const kind = { QA: "test", E2E: "e2e", PREVIEW: "preview", REVIEW: "review" }[row.stage];
              if (kind && !seen.has(row.id) && evidence.length < 20) { evidence.push({ kind, ref: row.id }); seen.add(row.id); }
            }
            const claim = media.content.saveClaim(d.contentProjectId, { text: c.texts.business || c.texts.text, evidence, status: "SUPPORTED" }, "plan:" + planId);
            if (slot) claimIdBySlot[slot] = claim.id; else claimIdByRole[c.key.slice(8)] = claim.id;
            claimItems.push(deliveries.bindItem(d.id, { kind: "claim", role: c.key, refTable: "content_claims", refId: claim.id, upstream: bundleItem ? [bundleItem.id] : [], meta: { criteria: c.needs.map(n => n.id) } }, "plan:" + planId));
          }
        });
        const captures = ["desktop", "mobile"].map((role) => {
          const item = deliveries.currentItem(d.id, "capture", role);
          if (!item) throw refuse("CAPTURE_MISSING", `Captura ${role} lipsește.`);
          const cap = d.template.captures.find((c) => c.role === role);
          // The duration the IR validator reads (ffprobe of the stored file), never the recorder's own estimate: the last frame must exist.
          const probed = media.assets.getVersion(item.refId)?.probe?.durationMs;
          return { role, assetVersionId: item.refId, durationMs: Number.isFinite(probed) && probed > 0 ? probed : item.meta.durationMs, width: item.meta.width, height: item.meta.height, captureLabel: item.meta.label, markers: item.meta.markers || [],
            evidenceSelectors: cap.evidenceSelectors, proofSelector: cap.proofSelector, itemId: item.id,
            // R-MEDIA: checked against THIS capture item and the confirmed template's steps (a hold of another script is refused in clip-ir).
            holds: item.meta.holds || [], sessionId: item.meta.sessionId || null, stepsSha: cap.stepsSha || null };
        });
        const brief = deliveries.currentItem(d.id, "brief");
        const prefs = brief?.meta?.prefs || {};
        const built = buildMaster({ captures, texts: block.texts, tone: prefs.tone || d.template.story.tone, claimIdBySlot, claimIdByRole, passed: [...passed], prefs, fps: d.template.story.fps, canvas: d.template.story.canvas,
          deliveryId: d.id, title: d.title, noun: block.noun, evidenceNote: block.evidenceNote, getVersion: (vid) => media.assets.getVersion(vid) });
        const rev = params.revisionId && deliveries.getRevision(params.revisionId);
        const correction = rev?.delta?.correction;
        const edit = correction ? media.edits.addVersion({ editProjectId: d.editProjectId, parentVersionId: correction.base.master.editVersionId, ir: built.ir, changeKind: 'patch', change: { kind: 'presentation-correction', revisionId: rev.id, correctionSha: rev.delta.correctionSha, version: correction.version }, actor: 'plan:' + planId }) : media.edits.create({ contentProjectId: d.contentProjectId, title: `${d.template.project.name} — prezentare 16:9`, ir: built.ir, actor: `plan:${planId}` });
        const textItems = built.ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).filter((i) => /^t-/.test(i.id)).map((i) => ({ id: i.id, text: i.text, start: i.start, end: i.end }));
        const fps = built.ir.fps.num / built.ir.fps.den;
        const markers = (built.ir.markers || []).map((m) => ({ kind: m.kind, note: m.note, ms: Math.round((m.frame / fps) * 1000) }));
        deliveries.patch(d.id, { edit_project_id: edit.project.id });
        deliveries.bindItem(d.id, { kind: "edit", role: "master", refTable: "media_edit_versions", refId: edit.version.id, refSha: edit.version.irSha256 || "",
          upstream: [...captures.map((c) => c.itemId), ...(brief ? [brief.id] : []), ...claimItems.map((c) => c.id)], meta: { textItems, markers, tone: prefs.tone || d.template.story.tone, omitted: [...omitted, ...(built.omitted || []).filter(o => !omitted.some(x => x.id === o.id))], ...(presentation.origin ? { origin: presentation.origin } : {}), holds: built.holds || {}, holdsRejected: built.holdsRejected || [], ...(correction ? { notes: built.notes || [] } : {}) } }, `plan:${planId}`);
        if (correction) deliveries.trigger(d.id, 'media_revision', { rootIds: oldClaimIds, keepIds: deliveries.items(d.id).filter(i => !oldClaimIds.includes(i.id)).map(i => i.id) }, `plan:${planId}`);
        return { result: { editVersionId: edit.version.id, editProjectId: edit.project.id } };
      },
    },

    "delivery.revise.apply": {
      describe: ({ deliveryId, revisionId }) => ({ title: "Aplică revizuirea pe montaj (versiune nouă, cea veche rămâne)", params: { deliveryId, revisionId }, ops: [{ op: "media.edit.apply" }, { op: "delivery.bind" }], observed: [], transmitted: [], outputs: ["montaj revizuit"] }),
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId, { statuses: ["READY", "NEEDS_OWNER"] });
        const rev = deliveries.getRevision(params.revisionId);
        if (!rev || rev.deliveryId !== d.id || !rev.reviewId) throw refuse("REVISION_MISSING", "Revizuirea nu există pentru această livrare.");
        authorize({ op: "media.edit.apply" });
        const applied = media.reviews.apply({ reviewId: rev.reviewId, actor: `plan:${planId}` });
        authorize({ op: "delivery.bind" });
        const prevEdit = deliveries.currentItem(d.id, "edit", "master");
        if (rev.delta?.prefs) {
          const brief = deliveries.currentItem(d.id, "brief");
          if (brief) deliveries.bindItem(d.id, { kind: "brief", role: "", refTable: brief.refTable, refId: `${brief.refId}#prefs-${rev.id}`, meta: { ...brief.meta, prefs: { ...(brief.meta.prefs || {}), ...rev.delta.prefs } } }, `plan:${planId}`);
        }
        // The new master supersedes the old one (and through the links its render, variant, QA and exports — stale.mjs media_revision).
        const edit = deliveries.bindItem(d.id, { kind: "edit", role: "master", refTable: "media_edit_versions", refId: applied.version.id, refSha: applied.version.irSha256 || "", upstream: prevEdit?.upstream || [],
          meta: { ...irMetadata(media.edits.getVersion(applied.version.id).ir), revisionId: rev.id } }, `plan:${planId}`);
        deliveries.trigger(d.id, "media_revision", { keepIds: [edit.id] }, `plan:${planId}`);
        deliveries.updateRevision(rev.id, { status: "APPLIED" });
        return { result: { editVersionId: applied.version.id } };
      },
    },

    "delivery.export": {
      describe: ({ deliveryId, master, vertical }) => {
        const d = describedDelivery(deliveryId);
        return { title: `Exportă local cele două clipuri${d ? ` în ${d.template.exports.folder}` : ""} (fără publicare)`, params: { deliveryId, master, vertical },
          ops: [{ op: "export.local", destination: d ? exportsDest(d) : undefined }, { op: "delivery.bind" }], folders: d ? [path.join(d.template.exports.dir, d.template.exports.folder)] : [], observed: [], transmitted: [], outputs: ["două fișiere video locale noi (fără suprascriere)"] };
      },
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId, { statuses: ["ACTIVE", "READY", "NEEDS_OWNER"] });
        const masterRender = doneResult(planId, "media.render");
        const variant = doneResult(planId, "media.variant.render");
        if (!masterRender || !variant) throw refuse("DELIVERY_RENDERS_MISSING", "Randările nu sunt gata.");
        if ([masterRender, variant].some(r => r.qa?.kinds?.factual === 'FAIL' || r.qa?.kinds?.factual?.status === 'FAIL')) throw refuse('DELIVERY_FACTUAL_QA_FAIL', 'Afirmațiile clipurilor nu au trecut verificarea factuală.');
        const n = (d.generation || 1) + deliveries.items(d.id).filter((i) => i.kind === "export" && i.role === "master").length;
        const exported = {};
        for (const [role, assetVersionId, name] of [["master", params.master, `demo-16x9-v${n}`], ["vertical", params.vertical, `demo-9x16-v${n}`]]) {
          authorize({ op: "export.local", destination: exportsDest(d) });
          exported[role] = media.exportLocal({ assetVersionId, name, folder: d.template.exports.folder, actor: `plan:${planId}` });
        }
        authorize({ op: "delivery.bind" });
        const editItem = deliveries.currentItem(d.id, "edit", "master");
        const fresh = deliveries.get(d.id);
        const label = d.labels.includes("SIMULATION") ? "SIMULARE" : "ORIGINAL";
        const rMaster = deliveries.bindItem(fresh, { kind: "render", role: "master", refTable: "media_asset_versions", refId: masterRender.assetVersionId, upstream: editItem ? [editItem.id] : [],
          meta: { renderJobId: masterRender.renderJobId, durationMs: media.assets.getVersion(masterRender.assetVersionId)?.probe?.durationMs || null, label, qa: masterRender.qa?.status || null, creative: masterRender.review?.creative === "CREATIVE_APPROVED" ? "APPROVED" : "PENDING" } }, `plan:${planId}`);
        const vItem = deliveries.bindItem(fresh, { kind: "variant", role: "vertical", refTable: "media_variants", refId: variant.variantId, upstream: editItem ? [editItem.id] : [], meta: { editVersionId: variant.editVersionId } }, `plan:${planId}`);
        const rVertical = deliveries.bindItem(fresh, { kind: "render", role: "vertical", refTable: "media_asset_versions", refId: variant.assetVersionId, upstream: [vItem.id],
          meta: { renderJobId: variant.renderJobId, durationMs: media.assets.getVersion(variant.assetVersionId)?.probe?.durationMs || null, label, qa: variant.qa?.status || null, creative: variant.review?.creative === "CREATIVE_APPROVED" ? "APPROVED" : "PENDING" } }, `plan:${planId}`);
        for (const [role, r, item] of [["master", masterRender, rMaster], ["vertical", variant, rVertical]]) {
          deliveries.bindItem(fresh, { kind: "qa", role, refTable: "media_qa", refId: r.qaRunId || `${r.assetVersionId}#qa`, upstream: [item.id], meta: { status: r.qa?.status || null, kinds: r.qa?.kinds || {}, unjustified: (r.qa?.unjustified || []).length } }, `plan:${planId}`);
          deliveries.bindItem(fresh, { kind: "export", role, refTable: "file", refId: exported[role].file, refSha: exported[role].sha256, upstream: [item.id], meta: { file: exported[role].file } }, `plan:${planId}`);
        }
        return { result: { master: exported.master.file, vertical: exported.vertical.file } };
      },
    },

    "delivery.summary.render": {
      describe: ({ deliveryId, only = undefined, revisionId }) => {
        const d = describedDelivery(deliveryId);
        return { title: only === "video" ? "Actualizează doar secțiunea video a rezumatului" : "Scrie rezumatul comercial (Markdown + HTML, fără prețuri inventate)", params: { deliveryId, ...(only !== undefined ? { only } : {}), ...(revisionId ? { revisionId } : {}) },
          ops: [{ op: "delivery.summary" }, { op: "export.local", destination: d ? path.join(d.template.exports.dir, d.template.exports.folder, "rezumat.md") : undefined }], observed: [], transmitted: [], outputs: ["rezumat comercial (versiune nouă)"] };
      },
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId, { statuses: ["ACTIVE", "READY", "NEEDS_OWNER"] });
        authorize({ op: "delivery.summary" });
        const doc = deliveries.renderDocument(d.id, { changed: params.only === "correction" ? ["claims", "media"] : params.only === "video" ? "media" : null, planId, revisionId: params.revisionId, actor: `plan:${planId}` });
        authorize({ op: "export.local", destination: path.join(d.template.exports.dir, d.template.exports.folder, "rezumat.md") });
        const exported = deliveries.exportDocument(d.id, doc.id);
        return { result: { documentId: doc.id, version: doc.version, md: exported.md.file, html: exported.html.file } };
      },
    },

    "delivery.finish": {
      describe: ({ deliveryId, render, variant, verticalEdit, mode = undefined, revisionId }) => ({ title: mode === "revision" ? "Leagă versiunile noi și marchează-le pe cele vechi ca înlocuite" : "Leagă dovezile de versiunea verificată și încheie livrarea",
        params: { deliveryId, render, variant, verticalEdit, ...(mode !== undefined ? { mode } : {}), ...(revisionId ? { revisionId } : {}) }, ops: [{ op: "delivery.bind" }, { op: "delivery.preview" }], observed: [], transmitted: [], outputs: ["livrare gata de verificarea ta"] }),
      run: async ({ params, planId, authorize }) => {
        const { d } = bound(params, planId, { statuses: ["ACTIVE", "READY", "NEEDS_OWNER"] });
        authorize({ op: "delivery.bind" });
        const v = deliveries.verify(d.id, { by: `plan:${planId}` });
        if (!v.equal) throw refuse("SNAPSHOT_DRIFT", "Proiectul s-a schimbat față de versiunea verificată; livrarea nu e gata.");
        authorize({ op: "delivery.preview" });
        // Only the delivery's own preview is stopped, never the factory's.
        await supervisor.stop(`delivery-preview-${d.id}`, { graceMs: 500 }).catch(() => {});
        const fresh = deliveries.get(d.id);
        const complete = slotsComplete(deliveries.items(d.id), fresh);
        if (!complete.complete) throw refuse("DELIVERY_INCOMPLETE", `Lipsesc: ${complete.missing.join(", ")}`);
        if (params.mode === 'correction') {
          if (planRevision(d.id, planId)?.id !== params.revisionId) throw refuse('CORRECTION_RECORD', 'Corectura nu aparține planului.');
          deliveries.finishCorrection(d.id, params.revisionId);
        }
        if (fresh.status === "ACTIVE") deliveries.setStatus(d.id, "READY", "Gata de verificarea ta: software, clip, variantă verticală și rezumat legate de aceeași versiune", {}, { from: ["ACTIVE"] });
        return { result: { status: "READY" } };
      },
    },
  };
}
