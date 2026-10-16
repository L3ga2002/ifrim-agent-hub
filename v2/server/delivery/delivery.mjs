import { presentationForTemplate, provePresentation, storyFromPresentation } from "./presentation.mjs";
// M11 „Ifrim Delivery” — the delivery service: the only writer of deliveries, delivery_items, delivery_documents and
// delivery_revisions (migration 12).
//
// A delivery binds ONE verified software version (the factory bundle, its change set and snapshot) to what is shown from it: the
// preview, two captures, the 16:9 clip and its vertical variant, the local exports and the commercial summary. Every item records the
// snapshot it is evidence of and the items it derives from (real links), so a change marks exactly the dependent items (stale.mjs):
// new code → everything software-bound STALE; a clip revision → only the media chain SUPERSEDED; a copy edit → a new summary version.
// Only audited reconciliation of a proven Hub-only invalidation may restore STALE items; ordinary transitions stay monotone.
//
// Authority: the owner confirms ONE envelope whose hashed body carries the delivery section (template sha, ops body sha). At the
// mission's DELIVERY_READY the package plan is DERIVED from that consent (opsPlans.adoptDerived), never confirmed again. Revisions and
// a re-package are ordinary one-confirmation ops plans. Nothing here accepts software, approves a clip or a summary, records rights or
// publishes: those stay the owner's own commands.
import { HUB_VERSION } from "../config.mjs";
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { TEST_PROJECT_MARKER } from "../domain/projects.mjs";
import { FACTORY_DEMOS } from "../factory/fixtures.mjs";
import { browserStatus } from "../tools/browser.mjs";
import { buildTemplate, templateSha, sectionOf, packageSteps, eligibility, PACKAGE_KIND, REVISE_KIND, DELIVERY_LIMITS } from "./template.mjs";
import { itemOf, applyRule, currentView, slotsComplete, previousOf, documentOf, canTransition } from "./stale.mjs";
import { renderSummary, summaryFactCheck, editSummary, regenerateSummary, toMarkdown, toHtml } from "./summary.mjs";
import { writeNew } from "./files.mjs";
import { presentationAudit, buildCorrectionRecord, overlayCorrection, correctionSteps, CORRECTION_KIND, LIVE_CORRECTION, irMetadata } from "./correction.mjs";
import { captureScriptFrom } from "./template.mjs";

/** The operations a derived delivery plan may contain (and nothing else: no model, no app, no decision). */
// Stage closure 2026-10-09: office.verify (Word / Excel read back through COM, in the delivery folder) belongs to the delivery phase too:
// the confirmed envelope already hashed those steps; without it a delivery with Word / Excel derived from an envelope never started.
export const DELIVERY_PHASE_OPS = Object.freeze(["delivery.verify", "delivery.bind", "delivery.preview", "capture.preview", "media.edit.apply", "media.render", "media.variant", "media.qa", "export.local", "delivery.summary", "media.tools.pin", "office.verify"]);
const OPEN = new Set(["PLANNED", "ARMED", "ACTIVE", "READY", "NEEDS_OWNER", "STALE"]);

export function createDeliveries({ db, bus, clock, config, settings, projects, missions, factory, media, opsPlans, trust, sales = null }) {
  const now = () => clock().toISOString();
  let envelopes = null; // late-bound (hub.mjs): get(), and the consent of an envelope
  const attachEnvelopes = (api) => { envelopes = api; };

  // ---------------------------------------------------------------- rows
  const rowOf = (id) => db.prepare("SELECT * FROM deliveries WHERE id = ?").get(String(id || ""));
  const deliveryView = (r) => r && ({ id: r.id, projectId: r.project_id, parentId: r.parent_id, lineage: r.lineage, title: r.title, status: r.status, statusReason: r.status_reason,
    missionId: r.mission_id, envelopeId: r.envelope_id, envelopeHash: r.envelope_hash, opsPlanId: r.ops_plan_id, template: parse(r.template_json, {}), templateSha: r.template_sha,
    opsSteps: parse(r.ops_steps_json, []), opsBodySha: r.ops_body_sha, consent: parse(r.consent_json, null), activateBy: r.activate_by, activatedAt: r.activated_at,
    bundleId: r.bundle_id, bundleSha: r.bundle_sha, changeSetId: r.change_set_id, changeSetSha: r.change_set_sha, snapshotSha: r.snapshot_sha, specVersion: r.spec_version, specSha: r.spec_sha,
    bindingSha: r.binding_sha, generation: r.generation, contentProjectId: r.content_project_id, editProjectId: r.edit_project_id, labels: parse(r.labels_json, []),
    verified: parse(r.verified_json, {}), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, version: r.version });
  const get = (id) => deliveryView(rowOf(id));
  const need = (id) => { const d = get(id); if (!d) throw new HubError("not_found", "Livrarea nu există.", { code: "DELIVERY_MISSING" }); return d; };
  const itemsOfDelivery = (id) => db.prepare("SELECT * FROM delivery_items WHERE delivery_id = ? ORDER BY created_at, rowid").all(id).map(itemOf);
  const docsOf = (id) => db.prepare("SELECT * FROM delivery_documents WHERE delivery_id = ? ORDER BY version").all(id);
  const docView = (r) => r && ({ id: r.id, deliveryId: r.delivery_id, kind: r.kind, version: r.version, parentId: r.parent_id, sections: parse(r.sections_json, []), text: r.text, contentSha: r.content_sha,
    basis: parse(r.basis_json, {}), basisSha: r.basis_sha, claimsToVerify: parse(r.claims_to_verify_json, []), warnings: parse(r.warnings_json, []), authorKind: r.author_kind, status: r.status,
    staleReason: r.stale_reason, approval: parse(r.approval_json, null), exports: parse(r.export_json, {}), createdBy: r.created_by, createdAt: r.created_at });
  const currentDoc = (id) => docView(db.prepare("SELECT * FROM delivery_documents WHERE delivery_id = ? AND kind = 'commercial_summary' ORDER BY version DESC LIMIT 1").get(id));

  function setStatus(id, to, reason = "", extra = {}, { from = null, audit = {} } = {}) {
    const d = need(id);
    if (from && !from.includes(d.status)) return false;
    if (d.status !== to && (!canTransition(d.status, to) || (d.status === 'NEEDS_OWNER' && to === 'READY' && !audit.correction))) throw new HubError("conflict", `Livrarea nu poate trece din ${d.status} în ${to}.`, { code: "DELIVERY_TRANSITION" });
    const sets = ["status = ?", "status_reason = ?", "updated_at = ?", "version = version + 1", ...Object.keys(extra).map((k) => `${k} = ?`)];
    const n = db.prepare(`UPDATE deliveries SET ${sets.join(", ")} WHERE id = ? AND status = ?`).run(to, String(reason).slice(0, 500), now(), ...Object.values(extra), id, d.status).changes;
    if (n) bus.append({ type: "delivery.status", scopeType: "delivery", scopeId: id, source: "delivery", payload: { deliveryId: id, from: d.status, to, reason: String(reason).slice(0, 200), projectId: d.projectId, missionId: d.missionId, ...audit } });
    return n === 1;
  }

  /** Columns that are not the status (content/edit project ids); no event. */
  const PATCHABLE = new Set(["content_project_id", "edit_project_id", "ops_plan_id", "phase_expires_at"]);
  function patch(id, fields) {
    const entries = Object.entries(fields).filter(([k]) => PATCHABLE.has(k));
    if (entries.length) db.prepare(`UPDATE deliveries SET ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...entries.map(([, v]) => v), now(), id);
    return get(id);
  }

  // ---------------------------------------------------------------- facts for a template
  function markerOf(project) {
    try { return JSON.parse(fs.readFileSync(path.join(project.path, TEST_PROJECT_MARKER), "utf8")); } catch { return null; }
  }
  async function toolsFacts() {
    let t = null;
    try { t = media?.tools?.inspect ? await media.tools.inspect() : null; } catch { t = null; }
    const states = Object.values(t?.states || {});
    const state = !states.length ? null : states.includes("MISSING") ? "MISSING" : states.includes("CHANGED") ? "CHANGED" : states.includes("UNPINNED") ? "UNPINNED" : "PINNED";
    const identity = t ? Object.fromEntries(["ffmpeg", "ffprobe"].filter((k) => t[k]?.sha256).map((k) => [k, { version: t[k].version || null, sha256: t[k].sha256, libsSha256: t[k].libsSha256 || null }])) : null;
    return { state, identity };
  }
  const browserFacts = () => { try { return browserStatus({ hubRoot: config.browserRoot || config.hubRoot }); } catch { return { installed: false }; } };
  const day = () => now().slice(0, 10).replace(/-/g, "");
  const approvedFolders = () => { try { return media.importRoots(); } catch { return []; } };

  /** Why a delivery cannot be prepared for this project/mission (the owner's words), plus the facts the template needs. */
  async function readiness({ projectId, missionId }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiectul nu există.");
    const marker = markerOf(project);
    const demo = marker?.fixture ? FACTORY_DEMOS[marker.fixture] || null : null;
    const missionView = missionId ? factory.view(missionId) : null;
    const tools = await toolsFacts();
    const browser = browserFacts();
    const route = project.environmentRoute || project.route || "windows";
    const e = eligibility({ project, marker, demo, missionView, route, missionIds: missionId ? [missionId] : [], exportsDir: media.exportsDir(), approvedFolders: approvedFolders(), browser, tools, config });
    return { ...e, project, marker, demo, missionView, tools, browser, route };
  }

  // ---------------------------------------------------------------- PLANNED
  /**
   * The delivery row of a proposal (no effect): the frozen template, the exact package steps and the sha of their ops body. The same
   * mission and template reuse the open PLANNED row (a re-proposal of the same card).
   */
  async function createPlanned({ projectId, missionId, parentId = null, actor = "owner", extras = [], reused = [] }) {
    const r = await readiness({ projectId, missionId });
    if (!r.ok) throw new HubError("policy", `Livrarea nu poate fi pregătită: ${r.blockers.map((b) => b.title).join("; ")}`, { code: "DELIVERY_NOT_ELIGIBLE", data: { blockers: r.blockers } });
    const simulation = Boolean(config.testMode);
    const template = buildTemplate({ project: r.project, marker: r.marker, missionView: r.missionView, demo: r.demo, tools: r.tools.identity, toolsState: r.tools.state, chromium: { version: r.browser.version || null },
      exportsDir: media.exportsDir(), simulation, day: day(), route: r.route, mode: parentId ? "refresh" : "new", parentDeliveryId: parentId, config, extras, reused });
    const tSha = templateSha(template);
    const existing = db.prepare("SELECT * FROM deliveries WHERE mission_id = ? AND status = 'PLANNED' AND template_sha = ? ORDER BY created_at DESC LIMIT 1").get(missionId, tSha);
    if (existing) return get(existing.id);
    const id = newId("dlv");
    const steps = packageSteps(template, id);
    const lineage = parentId ? (get(parentId)?.lineage || 1) + 1 : 1;
    const labels = ["SYNTHETIC_DATA", "LOCAL_ONLY", ...(simulation ? ["SIMULATION"] : [])];
    // The row exists before the steps are described: a step's description reads it (the export folder), so the ops body is the same
    // here, at the envelope's proposal, at its confirmation and at activation.
    db.prepare(`INSERT INTO deliveries (id, project_id, parent_id, lineage, title, status, status_reason, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, labels_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PLANNED', 'Propusă; aștept confirmarea planului', ?, ?, ?, ?, '', ?, ?, ?, ?)`).run(id, projectId, parentId, lineage, `Livrare: ${r.project.name}`, missionId, json(template), tSha, json(steps),
      json(labels), String(actor).slice(0, 80), now(), now());
    let body;
    try { body = await opsPlans.buildBody({ kind: PACKAGE_KIND, title: `Livrare: ${r.project.name}`, steps, limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions } }); }
    catch (error) {
      db.prepare("UPDATE deliveries SET status = 'CANCELLED', status_reason = ?, updated_at = ? WHERE id = ?").run(`Pașii livrării nu pot fi descriși: ${String(error.message).slice(0, 300)}`, now(), id);
      throw error;
    }
    bus.transaction(() => {
      db.prepare("UPDATE deliveries SET ops_body_sha = ?, updated_at = ? WHERE id = ?").run(hashCanonical(body), now(), id);
      bus.append({ type: "delivery.planned", scopeType: "delivery", scopeId: id, source: actor, payload: { deliveryId: id, projectId, missionId, parentId, templateSha: tSha.slice(0, 16) } });
    });
    return get(id);
  }

  /** body.delivery of the envelope: recomputed from the current state (forConfirm: the rebuild at confirmation must hash the same). */
  async function sectionFor(id) {
    const d = need(id);
    const steps = packageSteps(d.template, d.id);
    const body = await opsPlans.buildBody({ kind: PACKAGE_KIND, title: d.title, steps, limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions } });
    return sectionOf(d.template, { deliveryId: d.id, ops: { stepTitles: body.steps.map((s) => s.title), bodySha: hashCanonical(body) } });
  }
  const sectionForMission = (missionId) => {
    const r = db.prepare("SELECT id FROM deliveries WHERE mission_id = ? AND status IN ('PLANNED','ARMED') ORDER BY created_at DESC LIMIT 1").get(missionId);
    return r ? r.id : null;
  };

  /** Inside the envelope's CONFIRMED transaction: PLANNED → ARMED (or a continuation re-arms). A throw rolls the confirmation back. */
  function arm(id, { envelopeId, envelopeHash, consent, expiresAt }) {
    const d = need(id);
    if (!["PLANNED", "ARMED"].includes(d.status)) throw new HubError("conflict", `Livrarea e ${d.status}; nu poate fi legată de această confirmare.`, { code: "DELIVERY_ARM" });
    const n = db.prepare(`UPDATE deliveries SET status = 'ARMED', status_reason = ?, envelope_id = ?, envelope_hash = ?, consent_json = ?, activate_by = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND status IN ('PLANNED','ARMED')`).run("Confirmată; pornește singură la DELIVERY_READY", envelopeId, envelopeHash, json(consent), expiresAt, now(), id).changes;
    if (n !== 1) throw new HubError("conflict", "Livrarea s-a schimbat în timpul confirmării.", { code: "DELIVERY_ARM" });
    bus.append({ type: "delivery.status", scopeType: "delivery", scopeId: id, source: "owner", payload: { deliveryId: id, from: d.status, to: "ARMED", envelopeId, projectId: d.projectId, missionId: d.missionId } });
    return get(id);
  }

  // ---------------------------------------------------------------- ACTIVE (derived, internal)
  function stopAllAfter(iso) {
    return Boolean(db.prepare("SELECT 1 FROM events WHERE type = 'system.stop_all' AND created_at > ? LIMIT 1").get(String(iso || "")));
  }
  /**
   * The activation checklist (design §4). The first failure stops it: the delivery becomes FAILED or EXPIRED with the reason, nothing is
   * captured, and the Room offers a re-package card (one confirmation).
   */
  let closing = false;
  async function activate(id, { actor = "hub" } = {}) {
    if (closing) return { activated: false, reason: "Hub shutdown" };
    const d = need(id);
    if (d.status !== "ARMED") return { activated: false, reason: `livrarea e ${d.status}` };
    const fail = (status, reason) => { bus.transaction(() => setStatus(id, status, reason, {}, { from: ["ARMED"] })); return { activated: false, reason }; };
    if (d.activateBy && new Date(d.activateBy) < clock()) return fail("EXPIRED", "Fereastra confirmării a trecut înainte ca software-ul să fie gata");
    const fv = factory.view(d.missionId);
    if (!fv || !["DELIVERY_READY", "ACCEPTED"].includes(fv.factory.stage)) return { activated: false, reason: `misiunea e în ${fv?.factory?.stage || "?"}` };
    const binding = factory.deliveryBinding(d.missionId);
    if (!binding) return fail("FAILED", "Misiunea nu are un pachet verificat");
    if (d.template.specSha && binding.specSha && binding.specSha !== d.template.specSha) return fail("FAILED", "Specificația s-a schimbat după confirmare");
    const snap = factory.snapshotCheck(d.missionId);
    if (!snap.equal) return fail("FAILED", `Proiectul nu mai e versiunea verificată (${snap.changedFiles.slice(0, 5).join(", ") || "snapshot diferit"})`);
    const tools = await toolsFacts();
    if (closing) return { activated: false, reason: "Hub shutdown" };
    for (const k of ["ffmpeg", "ffprobe"]) if (d.template.tools?.[k]?.sha256 && tools.identity?.[k]?.sha256 && tools.identity[k].sha256 !== d.template.tools[k].sha256) return fail("FAILED", `${k} s-a schimbat după confirmare`);
    const consent = d.consent || {};
    try { trust.requireSession({ id: consent.sessionId }, "livrarea confirmată"); } catch { /* the derived plan stops at its first operation with SESSION_CLOSED → NEEDS_OWNER */ }
    if (consent.confirmedAt && stopAllAfter(consent.confirmedAt)) return fail("FAILED", "„Oprește tot” a venit după confirmare; livrarea nu pornește singură");
    let startOrigin = null;
    try { startOrigin = binding.startUrl ? new URL(binding.startUrl).origin : null; } catch { startOrigin = null; }
    if (startOrigin && startOrigin !== d.template.preview.origin) return fail("FAILED", "Adresa preview-ului din pachet diferă de cea confirmată");
    const steps = packageSteps(d.template, d.id);
    const body = await opsPlans.buildBody({ kind: PACKAGE_KIND, title: d.title, steps, limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions } });
    if (closing) return { activated: false, reason: "Hub shutdown" };
    if (hashCanonical(body) !== d.opsBodySha) return fail("FAILED", "Pașii livrării s-au schimbat față de planul confirmat");
    bus.transaction(() => {
      bindSoftware(d, binding, actor);
      setStatus(id, "ACTIVE", "Pornită din confirmarea ta (fără altă întrebare)", { activated_at: now() }, { from: ["ARMED"] });
    });
    try {
      const env = envelopes?.get?.(d.envelopeId) || null;
      const plan = await opsPlans.adoptDerived({ kind: PACKAGE_KIND, title: d.title, steps, limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions },
        parent: { kind: "envelope", id: d.envelopeId, hash: d.envelopeHash, confirmedAt: consent.confirmedAt || env?.confirmedAt || null, deliveryId: d.id }, expectedBodySha: d.opsBodySha,
        sessionId: consent.sessionId, credential: consent.credential || "",
        onCreated: (planId, { expiresAt }) => db.prepare("UPDATE deliveries SET ops_plan_id = ?, phase_expires_at = ?, updated_at = ? WHERE id = ?").run(planId, expiresAt, now(), id) });
      return { activated: true, planId: plan.id };
    } catch (error) {
      if (closing) return { activated: false, reason: "Hub shutdown" };
      bus.transaction(() => setStatus(id, "NEEDS_OWNER", `Planul de livrare nu a pornit: ${String(error.message).slice(0, 200)}`, {}, { from: ["ACTIVE"] }));
      return { activated: false, reason: error.message };
    }
  }

  /**
   * The delivery-only card (software already verified): the owner confirmed THIS ops plan, whose id the planner recorded on the PLANNED
   * row. Its first step starts the delivery here, with the same checks as an activation: the mission still ready, the verified bundle,
   * the same snapshot and the same steps. Pilot 2026-10-08: without it the confirmed card failed at step 1 (CAPTURE_NOT_BOUND).
   */
  function startDirect(id, planId, { actor = "owner" } = {}) {
    const d = need(id);
    if (d.status !== "PLANNED" || !planId || d.opsPlanId !== planId) throw new HubError("policy", "Pasul nu aparține planului acestei livrări.", { code: "CAPTURE_NOT_BOUND" });
    const refuse = (reason) => { throw new HubError("policy", reason, { code: "DELIVERY_NOT_STARTED" }); };
    const fv = factory.view(d.missionId);
    if (!fv || !["DELIVERY_READY", "ACCEPTED"].includes(fv.factory.stage)) refuse(`Misiunea nu mai e gata (${fv?.factory?.stage || "?"}).`);
    const binding = factory.deliveryBinding(d.missionId);
    if (!binding) refuse("Misiunea nu are un pachet verificat.");
    if (d.template.specSha && binding.specSha && binding.specSha !== d.template.specSha) refuse("Specificația s-a schimbat după propunere.");
    const snap = factory.snapshotCheck(d.missionId);
    if (!snap.equal) refuse(`Proiectul nu mai e versiunea verificată (${snap.changedFiles.slice(0, 5).join(", ") || "snapshot diferit"}).`);
    const plan = opsPlans.view(planId);
    if (!plan || plan.kind !== PACKAGE_KIND || hashCanonical(plan.body) !== d.opsBodySha) refuse("Pașii livrării diferă de planul confirmat.");
    bus.transaction(() => {
      bindSoftware(d, binding, actor);
      setStatus(id, "ACTIVE", "Pornită din confirmarea ta (cardul livrării)", { activated_at: now(), phase_expires_at: plan.expiresAt || null }, { from: ["PLANNED"] });
    });
    return get(id);
  }

  /** Binds the verified version (bundle + E2E evidence) as generation g; called inside a transaction. */
  function bindSoftware(d, binding, actor) {
    const generation = (d.generation || 0) + (d.bundleSha === binding.bundleSha ? 0 : 1) || 1;
    const bindingSha = hashCanonical({ templateSha: d.templateSha, opsBodySha: d.opsBodySha, bundleSha: binding.bundleSha, changeSetSha: binding.changeSetSha, snapshotSha: binding.snapshotSha, specSha: binding.specSha });
    db.prepare(`UPDATE deliveries SET bundle_id = ?, bundle_sha = ?, change_set_id = ?, change_set_sha = ?, snapshot_sha = ?, spec_version = ?, spec_sha = ?, binding_sha = ?, generation = ?, updated_at = ? WHERE id = ?`)
      .run(binding.bundleId, binding.bundleSha, binding.changeSetId, binding.changeSetSha, binding.snapshotSha, binding.specVersion, binding.specSha, bindingSha, generation, now(), d.id);
    const fresh = get(d.id);
    const fileSha = (readPath) => { try { const file = readPath(); return file ? sha256(fs.readFileSync(file)) : ""; } catch (e) { if (["ENOENT", "ENOTDIR"].includes(e.code)) return ""; throw e; } };
    const bundlePath = db.prepare("SELECT file_path FROM factory_bundles WHERE id = ?").get(binding.bundleId)?.file_path;
    const bundleItem = bindItem(fresh, { kind: "bundle", role: "", refTable: "factory_bundles", refId: binding.bundleId, refSha: binding.bundleSha, meta: { status: binding.bundleStatus, fileSha: fileSha(() => bundlePath ? path.resolve(config.hubRoot, bundlePath) : null) } }, actor);
    for (const e of binding.e2e) {
      if (e.status !== "PASS") continue;
      const role = e.viewport && e.viewport.width <= 480 ? `mobile:${e.criterion}` : `desktop:${e.criterion}`;
      bindItem(fresh, { kind: "e2e_shot", role, refTable: "factory_evidence", refId: e.evidenceId, refSha: e.screenshot ? fileSha(() => factory.e2eShotPath(fresh.missionId, e.evidenceId)) : "", upstream: [bundleItem.id], meta: { criterion: e.criterion, viewport: e.viewport, screenshot: e.screenshot } }, actor);
    }
    return bundleItem;
  }

  // ---------------------------------------------------------------- items
  /**
   * A new CURRENT item; the previous CURRENT item of the same kind + role (if any) becomes SUPERSEDED and is linked (supersedes_id).
   * `snapshotSha` defaults to the delivery's (a brief has none).
   */
  function bindItem(d, { kind, role = "", refTable, refId, refSha = "", upstream = [], meta = {}, snapshotSha = undefined }, actor = "delivery") {
    const delivery = typeof d === "string" ? need(d) : d;
    if (!refSha && refTable === "media_asset_versions") refSha = db.prepare("SELECT sha256 FROM media_asset_versions WHERE id = ?").get(String(refId))?.sha256 || "";
    const items = itemsOfDelivery(delivery.id);
    const prev = items.filter((i) => i.kind === kind && i.role === role && i.status === "CURRENT").at(-1) || null;
    if (prev && prev.refId === String(refId) && (!prev.refSha || !refSha || prev.refSha === String(refSha)) && prev.snapshotSha === (kind === "brief" ? "" : String(delivery.snapshotSha || ""))) return prev; // idempotent
    const id = newId("dli");
    const at = now();
    if (prev) db.prepare("UPDATE delivery_items SET status = 'SUPERSEDED', status_reason = ?, updated_at = ? WHERE id = ? AND status = 'CURRENT'").run("înlocuit de o versiune nouă", at, prev.id);
    db.prepare(`INSERT INTO delivery_items (id, delivery_id, kind, role, ref_table, ref_id, ref_sha, snapshot_sha, generation, upstream_json, supersedes_id, status, meta_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT', ?, ?, ?, ?)`).run(id, delivery.id, kind, role, refTable, String(refId), String(refSha || ""),
      snapshotSha !== undefined ? String(snapshotSha) : kind === "brief" ? "" : String(delivery.snapshotSha || ""), delivery.generation || 1, json(upstream.map(String)), prev?.id || null, json(meta), String(actor).slice(0, 80), at, at);
    bus.append({ type: "delivery.item", scopeType: "delivery", scopeId: delivery.id, source: actor, payload: { deliveryId: delivery.id, itemId: id, kind, role, supersedes: prev?.id || null } });
    return itemOf(db.prepare("SELECT * FROM delivery_items WHERE id = ?").get(id));
  }
  const currentItem = (deliveryId, kind, role = "") => itemsOfDelivery(deliveryId).filter((i) => i.kind === kind && i.role === role && i.status === "CURRENT").at(-1) || null;

  /** Applies one stale rule to a delivery and persists what it changed (items, variants, documents, the delivery status). */
  function trigger(deliveryId, name, ctx = {}, actor = "delivery") {
    const d = need(deliveryId);
    const out = applyRule(name, { items: itemsOfDelivery(d.id), delivery: { id: d.id, status: d.status, snapshotSha: d.snapshotSha, envelopeId: d.envelopeId }, documents: docsOf(d.id) }, ctx);
    const at = now();
    bus.transaction(() => {
      for (const u of out.itemUpdates) db.prepare("UPDATE delivery_items SET status = ?, stale_code = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status != 'STALE'").run(u.status, u.staleCode || "", u.statusReason || "", at, u.id);
      for (const variantId of out.variants || []) { try { media.variants.invalidate(variantId, { reason: out.reason, actor }); } catch { /* reported by the variant's own state */ } }
      for (const u of out.documentUpdates || []) db.prepare("UPDATE delivery_documents SET status = 'STALE', stale_reason = ? WHERE id = ? AND status = 'CURRENT'").run(String(u.reason || out.reason).slice(0, 300), u.id);
      if (out.delivery) setStatus(d.id, out.delivery.status, out.delivery.reason, out.delivery.status === "CLOSED" ? { closed_at: at } : {}, { audit: { trigger: name, changedFiles: ctx.changedFiles || d.verified?.changedFiles || [], cascade: { reason: out.reason, items: out.itemUpdates, documents: out.documentUpdates || [], variants: out.variants || [] } } });
      if (d.status === "STALE" && !["software_changed", "software_revision"].includes(name)) bus.append({ type: "delivery.reconciliation_blocked", scopeType: "delivery", scopeId: d.id, source: actor, payload: { deliveryId: d.id, trigger: name, reason: out.reason } });
      if (out.itemUpdates.length || out.delivery) bus.append({ type: "delivery.stale", scopeType: "delivery", scopeId: d.id, source: actor, payload: { deliveryId: d.id, trigger: name, items: out.itemUpdates.length, to: out.delivery?.status || null } });
    });
    return out;
  }

  /** Whether the project folder is still the bound version; a drift marks the software-bound items STALE. Fail-safe: it only ever marks. */
  function snapshotComparison(d) {
    if (!d.missionId || !d.snapshotSha) return { equal: null, reason: "livrarea nu are încă o versiune legată" };
    const snap = factory.snapshotCheck(d.missionId);
    const drift = factory.driftProvenance(d.projectId, snap.changedFiles);
    const equal = Boolean(snap.expected) && snap.expected === d.snapshotSha && snap.bundleId === d.bundleId && (!d.changeSetId || snap.changeSetId === d.changeSetId) && drift.software.length === 0;
    return { equal, snap, drift };
  }
  function verify(id, { by = "owner" } = {}) {
    const d = need(id);
    const { equal, snap, drift, reason } = snapshotComparison(d);
    if (!snap) return { equal, reason };
    const verified = { ...d.verified, hubOnly: drift.hub, at: now(), by, expected: d.snapshotSha, actual: snap.actual, equal, changedFiles: snap.changedFiles };
    bus.transaction(() => db.prepare("UPDATE deliveries SET verified_json = ?, updated_at = ? WHERE id = ?").run(json(verified), now(), id));
    if (drift.software.length && ["READY", "NEEDS_OWNER", "ACTIVE"].includes(d.status)) trigger(id, "software_changed", { changedFiles: snap.changedFiles, cause: `fișiere schimbate: ${snap.changedFiles.slice(0, 5).join(", ") || "snapshot diferit"}` }, by);
    return verified;
  }

  /** The only STALE → READY path. Evidence is re-read inside the transaction; creative decisions are untouched. */
  function reconcileStale(deliveryId, { actor, dryRun = false } = {}) {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 80 || typeof dryRun !== "boolean") return { ok: false, reasons: ["Autorul sau dryRun este invalid"] };
    return bus.transaction(() => {
      const d = get(deliveryId), reasons = [];
      if (!d) return { ok: false, reasons: ["Livrarea nu există"] };
      if (d.status === "READY" && d.verified?.reconciled) return { ok: true, alreadyReconciled: true, evidence: d.verified.reconciled.evidence };
      if (d.status !== "STALE") return { ok: false, reasons: ["Livrarea nu este STALE"] };
      const event = db.prepare("SELECT * FROM events WHERE type = 'delivery.status' AND scope_id = ? AND json_extract(payload_json, '$.to') = 'STALE' ORDER BY seq DESC LIMIT 1").get(d.id);
      const payload = parse(event?.payload_json, {});
      // Older versions recorded the trigger in the immediately following cascade event.
      const next = event && db.prepare("SELECT * FROM events WHERE scope_id = ? AND seq > ? ORDER BY seq LIMIT 1").get(d.id, event.seq);
      const old = next?.type === "delivery.stale" ? parse(next.payload_json, {}) : {};
      const triggerName = payload.trigger || old.trigger;
      if (!event || !["software_changed", "software_revision"].includes(triggerName)) reasons.push("Cauza STALE nu este o modificare software verificabilă");
      let snap, drift;
      try { snap = factory.snapshotCheck(d.missionId); drift = factory.driftProvenance(d.projectId, snap.changedFiles); }
      catch (e) { reasons.push(`Snapshot-ul nu poate fi verificat: ${String(e.message)}`); }
      if (!snap || snap.expected !== d.snapshotSha) reasons.push("Snapshot-ul de referință nu corespunde livrării");
      if (drift?.software.length) reasons.push(`Există modificări software: ${drift.software.join(", ")}`);
      const legacyPaths = event && d.verified?.at && d.verified.at <= event.created_at ? d.verified.changedFiles : null;
      const recordedPaths = payload.changedFiles ?? legacyPaths;
      const paths = Array.isArray(recordedPaths) && recordedPaths.every((p) => typeof p === "string" && p.length > 0) ? recordedPaths : null;
      if (!paths) reasons.push("Lipsește inventarul căilor din invalidare");
      const pathEvidence = (paths || []).map((ref) => ({ path: ref, provenance: drift?.hub.find((h) => h.path === ref)?.provenance || (!snap?.changedFiles.includes(ref) ? "verified_bytes_restored" : "software") }));
      if (pathEvidence.some((x) => x.provenance === "software")) reasons.push("O cale din invalidare nu a revenit la octeții verificați și nu aparține Hub-ului");
      const snapshot = db.prepare("SELECT created_at FROM factory_snapshots WHERE mission_id = ? AND sha256 = ? ORDER BY seq DESC LIMIT 1").get(d.missionId, d.snapshotSha);
      if (!snapshot) reasons.push("Data snapshot-ului lipsește");
      const checked = snapshot ? db.prepare("SELECT fm.mission_id FROM factory_missions fm JOIN missions m ON m.id = fm.mission_id WHERE m.project_id = ? AND fm.started_at >= ?").all(d.projectId, snapshot.created_at).map((r) => ({ missionId: r.mission_id, writerStarted: factory.writerStarted(r.mission_id) })) : [];
      if (checked.some((m) => m.writerStarted)) reasons.push("O misiune ulterioară a început implementarea");
      if (event && db.prepare("SELECT 1 FROM events WHERE type = 'delivery.reconciliation_blocked' AND scope_id = ? AND seq > ? LIMIT 1").get(d.id, event.seq)) reasons.push("O invalidare ulterioară are altă cauză");
      const allItems = itemsOfDelivery(d.id), staleItems = allItems.filter((i) => i.status === "STALE");
      if (staleItems.some((i) => allItems.some((x) => x.supersedesId === i.id))) reasons.push("Cascada include elemente deja înlocuite");
      const reason = payload.cascade?.reason || d.statusReason;
      if (!reason || staleItems.some((i) => i.staleCode !== "SOFTWARE_CHANGED" || i.statusReason !== reason)) reasons.push("Elementele au altă cauză de invalidare");
      const cascadeList = (key) => {
        if (!payload.cascade) return null;
        const value = payload.cascade[key];
        if (!Array.isArray(value) || value.some((x) => key === "variants" ? typeof x !== "string" : !x || typeof x.id !== "string")) { reasons.push(`Inventarul cascadei este invalid: ${key}`); return []; }
        return value;
      };
      const expectedItems = cascadeList("items"), expectedDocs = cascadeList("documents"), expectedVariants = cascadeList("variants");
      if (expectedItems && expectedItems.some((i) => !staleItems.some((x) => x.id === i.id) || i.from !== "CURRENT")) reasons.push("Cascada nu mai corespunde elementelor curente");
      const checkedFiles = [];
      for (const i of allItems) {
        let file = null, recordedSha = i.refSha;
        try {
          if (i.refTable === "file") file = i.refId;
          else if (i.refTable === "media_asset_versions") {
            const v = db.prepare("SELECT rel_path, sha256 FROM media_asset_versions WHERE id = ?").get(i.refId);
            if (!v) throw new Error("versiunea media lipsește");
            file = media.paths.resolveRel(v.rel_path);
            recordedSha ||= v.sha256;
          } else if (i.refTable === "factory_bundles") {
            const bundle = db.prepare("SELECT file_path FROM factory_bundles WHERE id = ?").get(i.refId);
            file = bundle?.file_path ? path.resolve(config.hubRoot, bundle.file_path) : null;
          }
          else if (i.kind === "e2e_shot" && i.meta?.screenshot) file = factory.e2eShotPath(d.missionId, i.refId);
          if (file) {
            const expectedSha = i.refTable === "factory_bundles" ? i.meta?.fileSha : recordedSha;
            if (!/^[0-9a-f]{64}$/.test(expectedSha || "")) throw new Error("lipsește hash-ul de octeți înregistrat");
            if (!fs.lstatSync(file).isFile() || sha256(fs.readFileSync(file)) !== expectedSha) throw new Error("fișierul nu are sha-ul înregistrat");
            checkedFiles.push({ itemId: i.id, sha256: expectedSha });
          } else if (["file", "media_asset_versions", "factory_bundles"].includes(i.refTable) || i.kind === "e2e_shot" && i.meta?.screenshot) throw new Error("fișierul lipsește");
        } catch (e) { reasons.push(`${i.kind}, ${i.role || "fără rol"}, ${i.id}: ${String(e.message)}`); }
      }
      const docs = docsOf(d.id).filter((r) => r.status === "STALE");
      if (expectedDocs?.some((r) => !docs.some((x) => x.id === r.id))) reasons.push("Un document al cascadei nu mai este STALE");
      if (docs.some((r) => r.stale_reason !== String(reason || "").slice(0, 300))) reasons.push("Documentele au altă cauză de invalidare");
      const variants = staleItems.filter((i) => i.refTable === "media_variants").map((i) => db.prepare("SELECT * FROM media_variants WHERE id = ?").get(i.refId));
      const variantStates = new Map();
      for (const v of variants) {
        const invalidated = parse(v?.notes_json, {}).invalidated;
        if (!v || v.status !== "INVALIDATED" || invalidated?.reason !== String(reason || "").slice(0, 200)) { reasons.push("O variantă are altă cauză de invalidare"); continue; }
        let previous = invalidated.previousStatus, basis = "invalidation_record";
        if (!previous) {
          // Legacy variants were created DRAFT. Require the immutable creation event, not a guessed default.
          const derived = db.prepare("SELECT seq, payload_json FROM events WHERE type = 'media.variant.derived' AND scope_id = ? ORDER BY seq LIMIT 1").get(v.id);
          const data = parse(derived?.payload_json, {});
          const later = derived && db.prepare("SELECT type FROM events WHERE scope_id = ? AND seq > ? AND seq < ?").all(v.id, derived.seq, event?.seq || 0);
          if (derived && data.variantVersionId === v.variant_version_id && data.masterVersionId === v.master_version_id && later.every((e) => e.type === "media.variant.invalidated")) { previous = "DRAFT"; basis = "legacy_derived_event"; }
        }
        if (!["DRAFT", "READY", "QA_FAILED", "RENDERED"].includes(previous)) reasons.push("Starea anterioară a variantei nu poate fi verificată");
        else variantStates.set(v.id, { status: previous, basis });
      }
      if (expectedVariants?.some((id) => !variantStates.has(id))) reasons.push("O variantă a cascadei nu poate fi restaurată");
      if (db.prepare("SELECT id FROM deliveries WHERE project_id = ? AND id <> ? AND status IN ('READY','ACTIVE') AND (created_at > ? OR (created_at = ? AND rowid > (SELECT rowid FROM deliveries WHERE id = ?))) LIMIT 1").get(d.projectId, d.id, d.createdAt, d.createdAt, d.id)) reasons.push("Există o livrare mai nouă READY sau ACTIVE");
      if (reasons.length) return { ok: false, reasons };
      const evidence = { staleEvent: event.seq, trigger: triggerName, paths: pathEvidence, hubOnly: drift.hub, missions: checked, files: checkedFiles, items: staleItems.map((i) => i.id), documents: docs.map((r) => r.id), variants: variants.map((v) => ({ id: v.id, ...variantStates.get(v.id) })) };
      if (dryRun) return { ok: true, dryRun: true, evidence };
      const at = now();
      for (const i of staleItems) db.prepare("UPDATE delivery_items SET status = 'CURRENT', stale_code = '', status_reason = '', updated_at = ? WHERE id = ?").run(at, i.id);
      for (const doc of docs) db.prepare("UPDATE delivery_documents SET status = 'CURRENT', stale_reason = '' WHERE id = ?").run(doc.id);
      for (const v of variants) {
        const notes = parse(v.notes_json, {});
        db.prepare("UPDATE media_variants SET status = ?, notes_json = ?, updated_at = ? WHERE id = ?").run(variantStates.get(v.id).status, json({ ...notes, reinstated: { at, actor, evidence } }), at, v.id);
      }
      db.prepare("UPDATE deliveries SET status = 'READY', status_reason = ?, verified_json = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'STALE'").run("Invalidare exclusiv Hub anulată după verificare", json({ ...d.verified, hubOnly: drift.hub, reconciled: { at, actor, evidence } }), at, d.id);
      bus.append({ type: "delivery.stale_reconciled", scopeType: "delivery", scopeId: d.id, source: actor, payload: { deliveryId: d.id, projectId: d.projectId, evidence } });
      return { ok: true, evidence };
    });
  }

  // ---------------------------------------------------------------- the commercial summary (versioned documents)
  function mediaFacts(deliveryId) {
    const d = need(deliveryId);
    const { current } = currentView(itemsOfDelivery(deliveryId), d);
    const out = [];
    for (const role of ["master", "vertical"]) {
      const render = current.find((i) => i.kind === "render" && i.role === role);
      if (!render) continue;
      const exp = current.find((i) => i.kind === "export" && i.role === role);
      const qa = current.find((i) => i.kind === "qa" && i.role === role);
      out.push({ id: render.id, role, file: exp?.meta?.file ? path.basename(exp.meta.file) : `${role}.mp4`, durationMs: render.meta?.durationMs || 0, label: render.meta?.label || (d.labels.includes("SIMULATION") ? "SIMULARE" : "ORIGINAL"),
        qa: qa?.meta?.status || render.meta?.qa || null, itemIds: [render.id, exp?.id, qa?.id].filter(Boolean) });
    }
    return out;
  }
  function servicesOf(d) {
    const refs = d.template?.summary?.serviceRefs || [];
    if (!sales?.services?.get) return [];
    return refs.map((r) => { try { return sales.services.get(String(r).split("@")[0]); } catch { return null; } }).filter(Boolean);
  }
  function ownerProfile() { try { return sales?.ownerProfile?.() || settings.get("ownerProfile") || {}; } catch { return {}; } }

  /** A new document version: v1 from the facts, or a regeneration of `changed` ("software" | "media" | "services") keeping owner sections. */
  function effectiveTemplate(d, { planId } = {}) {
    const revision = planId ? revisionOfPlan(d.id, planId) : null;
    let template = d.template;
    for (const r of correctionRevisions(d.id).reverse().filter(r => r.status === 'APPLIED')) template = overlayCorrection(template, r.delta.correction);
    if (revision?.delta?.correction) template = overlayCorrection(template, revision.delta.correction);
    if (template.presentation) return template;
    // Derive legacy prose before proposing steps, so the card hashes the overrides
    // that execution will use. Never rewrite the confirmed template or package body.
    const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
    const presentation = presentationForTemplate(template, facts);
    const { texts, overrides } = storyFromPresentation(presentation);
    return { ...template, presentation, story: { ...template.story, texts,
      variant: { ...template.story.variant, overrides, overridesSha: hashCanonical(overrides) } } };
  }
  const correctionRevisions = id => db.prepare("SELECT * FROM delivery_revisions WHERE delivery_id = ? AND json_extract(delta_json, '$.correction.kind') = 'presentation-correction' ORDER BY rowid DESC").all(id).map(revisionView);
  // cancel() also labels untouched PENDING steps CANCELLED; their attempt/start fields distinguish them.
  const started = p => p?.steps.some(s => s.status !== 'PENDING' && (s.status !== 'CANCELLED' || s.startedAt || s.attempts > 0));
  const recoveryReason = 'Corectura anterioară nu s-a încheiat; o reiau de la ultimul pas reușit';
  function unfinishedCorrection(d) {
    const r = correctionRevisions(d.id).find(r => r.opsPlanId);
    const p = r && opsPlans.view(r.opsPlanId);
    return d.status === 'NEEDS_OWNER' && r?.status !== 'APPLIED'
      && ((['FAILED', 'CANCELLED'].includes(p?.status) && started(p)) || (r?.delta.correction.continuation && LIVE_CORRECTION.includes(p?.status))) ? { revision: r, plan: p } : null;
  }
  function correctionFacts(deliveryId) {
    const d = need(deliveryId), unfinished = unfinishedCorrection(d);
    const template = effectiveTemplate(d, { planId: unfinished?.plan.id });
    const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
    const all = itemsOfDelivery(d.id), current = d.status === 'STALE' ? [...new Map(all.map(i => [i.kind + ':' + i.role, i])).values()] : all.filter(i => i.status === 'CURRENT');
    const masterItem = current.find(i => i.kind === 'edit' && i.role === 'master');
    const verticalItem = current.find(i => i.kind === 'variant' && i.role === 'vertical');
    const master = { editVersionId: masterItem?.refId || null, ir: media.edits.getVersion(masterItem?.refId)?.ir || null };
    const vertical = { variantId: verticalItem?.refId || null, editVersionId: verticalItem?.meta?.editVersionId || null, ir: media.edits.getVersion(verticalItem?.meta?.editVersionId)?.ir || null };
    const captures = current.filter(i => i.kind === 'capture').map(i => {
      let actualSha = null;
      try { const v = media.assets.getVersion(i.refId); actualSha = sha256(fs.readFileSync(path.join(config.mediaDir, v.relPath))); } catch { /* missing is an audit defect */ }
      return { ...i, actualSha };
    });
    const summary = currentDoc(d.id);
    const demo = FACTORY_DEMOS[template.fixture];
    const audit = presentationAudit({ delivery: d, effectiveTemplate: template, spec: facts.spec, specSha: facts.specRow.sha256, catalog: demo?.delivery?.presentations || [], master, vertical, summary, captures, claimFacts: facts });
    const base = { templateSha: d.templateSha, specSha: d.specSha, bundleId: d.bundleId, bundleSha: d.bundleSha, changeSetSha: d.changeSetSha, snapshotSha: d.snapshotSha,
      master: { editVersionId: master.editVersionId, irSha: masterItem?.refSha || null }, vertical: { variantId: vertical.variantId, editVersionId: vertical.editVersionId },
      summary: { documentId: summary?.id || null, version: summary?.version || 0, contentSha: summary?.contentSha || null },
      captures: Object.fromEntries(['desktop', 'mobile'].map(role => { const c = captures.find(i => i.role === role); return [role, { itemId: c?.id || null, assetVersionId: c?.refId || null, sha256: c?.refSha || null, observedSha256: c?.actualSha || null, stepsSha: c?.meta?.stepsSha || null }]; })),
      exports: current.filter(i => i.kind === 'export').map(i => ({ itemId: i.id, role: i.role, file: i.meta.file, sha256: i.refSha })),
      office: officeSteps(d).filter(s => s.status === 'DONE').map(s => ({ kind: s.kind, planId: s.planId, seq: s.seq, file: s.result?.file || s.result?.dir || s.result?.folder || null, sha256: s.result?.sha256 || null })),
      exportCount: all.filter(i => i.kind === 'export' && i.role === 'master').length };
    const continuation = Boolean(unfinished && !audit.defects.length && (unfinished.revision.delta.correction.continuation || unfinished.plan.steps.some(s => s.kind === 'delivery.summary.render' && s.status === 'DONE')));
    const fresh = renderSummary({ projectName: template.project?.name || d.title, synthetic: true, simulation: d.labels.includes('SIMULATION'), manifest: facts.manifest, bundleId: facts.bundle.id,
      bundleSha: facts.bundle.sha256, issue: template.issueTitle, presentation: audit.presentation, proofs: provePresentation(audit.presentation, facts), media: mediaFacts(d.id), services: servicesOf(d), owner: ownerProfile(), generatedAt: summary?.createdAt || now() });
    const summaryPreview = summary ? regenerateSummary({ ...summary, title: fresh.title }, fresh, ['claims', 'media']) : fresh;
    if (!continuation) summaryPreview.sections.find(s => s.id === 'video').text = '(după randare)';
    return { delivery: d, audit, base, master, vertical, captures, summary, facts, template, continuation, summaryPreview,
      tone: currentItem(d.id, 'brief')?.meta?.prefs?.tone || template.story.tone || 'both' };
  }
  // Versioned filenames are consequences of a new record, not a new defect. Compare
  // the frozen facts separately when deciding whether tick already offered this work.
  const correctionWorkSha = c => hashCanonical({ ...c, version: 0, outputs: c.outputs.filter(x => !/Prezentare demo v|Campanie v|manifest-v/.test(x)) });
  function correctionDraft(deliveryId) {
    const input = correctionFacts(deliveryId);
    const earlier = correctionRevisions(deliveryId).filter(r => r.opsPlanId);
    const version = earlier.length + 1;
    const correction = buildCorrectionRecord({ ...input, version });
    if (input.continuation) { correction.continuation = true; correction.reason = recoveryReason; }
    for (const cap of input.template.captures) Object.assign(correction.captures[cap.role], { steps: cap.steps, stepsSha: cap.stepsSha });
    for (const role of ['desktop', 'mobile']) if (correction.captures[role].action === 'recapture') {
      const cap = input.template.captures.find(c => c.role === role), criterion = input.facts.spec.acceptance.find(c => c.id === correction.captures[role].criterion);
      const script = captureScriptFrom(criterion?.steps, { role, noun: input.template.story.noun, proofSelector: cap.proofSelector });
      if (!script.ok) throw new HubError('conflict', 'Pașii aprobați nu pot fi filmați.', { code: 'CORRECTION_CAPTURE_INVALID' });
      Object.assign(correction.captures[role], { steps: script.steps, stepsSha: hashCanonical(script.steps), collapsed: script.collapsed });
    }
    // A live card is idempotent; every new record (including a re-offer) gets the next version.
    const eligible = db.prepare("SELECT delta_json, ops_plan_id FROM delivery_revisions WHERE delivery_id = ? ORDER BY rowid DESC").all(deliveryId).filter(r => LIVE_CORRECTION.includes(opsPlans.view(r.ops_plan_id)?.status)).map(r => parse(r.delta_json, {}).correction).filter(Boolean);
    const previous = eligible.find(c => correctionWorkSha(c) === correctionWorkSha(correction));
    const record = previous || correction;
    return { ...input, correction: record, correctionSha: hashCanonical(record) };
  }
  async function checkCorrection(deliveryId, record = null, { planId = null } = {}) {
    const d = need(deliveryId);
    if (!['READY', 'NEEDS_OWNER'].includes(d.status)) throw new HubError('conflict', d.status === 'STALE' ? 'Livrarea este STALE; se reface printr-un pachet nou.' : `Livrarea este ${d.status}; corectura cere READY sau NEEDS_OWNER.`, { code: 'CORRECTION_STATUS' });
    const snapshot = snapshotComparison(d);
    if (!snapshot.equal) throw new HubError('conflict', 'Versiunea software s-a schimbat.', { code: 'CORRECTION_BASE_CHANGED' });
    const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
    const tools = await toolsFacts();
    if (facts.bundle.id !== d.bundleId || facts.bundle.sha256 !== d.bundleSha || facts.specRow.sha256 !== d.specSha || !['READY_FOR_OWNER_ACCEPTANCE', 'OWNER_ACCEPTED'].includes(facts.bundle.status)) throw new HubError('conflict', 'Pachetul sau specificația s-au schimbat.', { code: 'CORRECTION_BASE_CHANGED' });
    if (tools.state !== 'PINNED' || hashCanonical(tools.identity) !== hashCanonical({ ffmpeg: d.template.tools.ffmpeg, ffprobe: d.template.tools.ffprobe })) throw new HubError('conflict', 'Corectura nu fixează și nu schimbă uneltele media.', { code: 'CORRECTION_TOOLS' });
    if (record) {
      // Compare references and bytes directly: preparation never consults the mutable catalog.
      const item = (kind, role) => currentItem(d.id, kind, role);
      const doc = currentDoc(d.id);
      const b = record.base;
      const own = i => Boolean(planId && i && db.prepare('SELECT 1 FROM delivery_items WHERE id = ? AND created_by = ?').get(i.id, 'plan:' + planId));
      const master = item('edit', 'master'), vertical = item('variant', 'vertical');
      let equal = ['templateSha', 'specSha', 'bundleId', 'bundleSha', 'changeSetSha', 'snapshotSha'].every(k => b[k] === d[k])
        && (own(master) || (master?.refId === b.master.editVersionId && master?.refSha === b.master.irSha))
        && ((planId && doc?.createdBy === 'plan:' + planId) || (doc?.id === b.summary.documentId && doc?.contentSha === b.summary.contentSha && doc?.version === b.summary.version))
        && (own(vertical) || (vertical?.refId === b.vertical.variantId && vertical?.meta?.editVersionId === b.vertical.editVersionId));
      for (const role of ['desktop', 'mobile']) {
        const c = item('capture', role), before = b.captures[role];
        equal &&= own(c) || (c?.id === before.itemId && c?.refId === before.assetVersionId && c?.refSha === before.sha256 && c?.meta?.stepsSha === before.stepsSha);
        let actual = null;
        try { actual = sha256(fs.readFileSync(path.join(config.mediaDir, media.assets.getVersion(c.refId).relPath))); } catch { /* still missing is an unchanged defective base */ }
        equal &&= actual === (own(c) ? c.refSha : (before.observedSha256 ?? (record.captures[role].action === 'reuse' ? before.sha256 : null)));
      }
      if (!equal) throw new HubError('conflict', 'Baza corecturii s-a schimbat; pregătește o propunere nouă.', { code: 'CORRECTION_BASE_CHANGED' });
    }
    return d;
  }
  const proposingCorrections = new Map();
  async function proposeCorrection(deliveryId, options = {}) {
    if (proposingCorrections.has(deliveryId)) return proposingCorrections.get(deliveryId);
    const pending = proposeCorrectionOnce(deliveryId, options);
    proposingCorrections.set(deliveryId, pending);
    try { return await pending; } finally { proposingCorrections.delete(deliveryId); }
  }
  async function proposeCorrectionOnce(deliveryId, { actor = 'owner', via = 'owner' } = {}) {
    const rows = correctionRevisions(deliveryId);
    for (const r of rows) {
      const p = r.opsPlanId && opsPlans.view(r.opsPlanId);
      if (['CONFIRMED', 'RUNNING', 'PAUSED'].includes(p?.status)) return { proposed: true, plan: p, revision: r };
    }
    if (actor === 'hub' && rows.some(r => opsPlans.view(r.opsPlanId)?.status === 'CANCELLED')) return { proposed: false, reason: 'Corectura a fost anulată de proprietar.' };
    await checkCorrection(deliveryId);
    let draft = correctionDraft(deliveryId);
    if (!draft.audit.defects.length && !unfinishedCorrection(draft.delivery)) return { proposed: false, reason: 'Nimic de corectat: afirmațiile corespund criteriilor aprobate.' };
    for (const r of rows) {
      const p = r.opsPlanId && opsPlans.view(r.opsPlanId);
      if (p?.status !== 'PROPOSED') continue;
      if (r.delta.correctionSha === draft.correctionSha) return { proposed: true, plan: p, revision: r };
      await opsPlans.supersedeDeliveryCorrection(p.id, deliveryId);
      draft = correctionDraft(deliveryId);
    }
    let reoffer = false;
    if (actor === 'hub') {
      const sameWork = [draft.correctionSha, ...rows.filter(r => correctionWorkSha(r.delta.correction) === correctionWorkSha(draft.correction)).map(r => r.delta.correctionSha)];
      const offered = rows.filter(r => sameWork.includes(r.delta.correctionSha)).filter(r => db.prepare("SELECT 1 FROM events WHERE type = 'delivery.correction_proposed' AND scope_id = ? AND json_extract(payload_json, '$.planId') = ? AND json_extract(payload_json, '$.hubVersion') = ?").get(deliveryId, r.opsPlanId, HUB_VERSION));
      if (offered.length) {
        reoffer = ['SUPERSEDED', 'EXPIRED'].includes(opsPlans.view(offered[0].opsPlanId)?.status);
        const alreadyReoffered = offered.some(r => db.prepare("SELECT 1 FROM events WHERE type = 'delivery.correction_proposed' AND json_extract(payload_json, '$.planId') = ? AND json_extract(payload_json, '$.hubVersion') = ? AND json_extract(payload_json, '$.reoffer') = 1").get(r.opsPlanId, HUB_VERSION));
        if (!reoffer || alreadyReoffered) return { proposed: false, reason: 'Corectura a fost deja oferită pe această versiune.' };
      }
    }
    const rev = recordRevision(deliveryId, { text: draft.correction.reason, classes: ['correction'], delta: { correction: draft.correction, correctionSha: draft.correctionSha }, status: 'PROPOSED', source: actor === 'hub' ? 'hub' : 'owner', channel: via });
    let plan;
    try { plan = await opsPlans.propose({ kind: CORRECTION_KIND, title: `Corectură afirmații: ${draft.template.project.name}`, steps: correctionSteps(draft.template, deliveryId, rev.id, draft.correction), limits: { maxDurationMin: 30, maxActions: 120 }, actor, via }); }
    catch (error) { updateRevision(rev.id, { status: 'CANCELLED' }); throw error; }
    updateRevision(rev.id, { opsPlanId: plan.id });
    bus.emit({ type: 'delivery.correction_proposed', scopeType: 'delivery', scopeId: deliveryId, source: actor, payload: { deliveryId, revisionId: rev.id, planId: plan.id, version: draft.correction.version, correctionSha: draft.correctionSha, hubVersion: HUB_VERSION, reoffer } });
    return { proposed: true, plan, revision: getRevision(rev.id) };
  }
  function finishCorrection(deliveryId, revisionId) {
    const rev = getRevision(revisionId), d = need(deliveryId);
    if (!rev?.delta?.correction || rev.deliveryId !== deliveryId) throw new HubError('conflict', 'Corectura nu aparține livrării.');
    bus.transaction(() => {
      updateRevision(rev.id, { status: 'APPLIED', documentId: currentDoc(d.id)?.id });
      // This is the only recovery from NEEDS_OWNER to READY: all correction slots were checked by finish.
      if (d.status === 'NEEDS_OWNER') setStatus(d.id, 'READY', 'Corectura este gata de verificarea ta', {}, { audit: { correction: true } });
      bus.append({ type: 'delivery.correction_applied', scopeType: 'delivery', scopeId: d.id, source: 'delivery', payload: { revisionId, version: rev.delta.correction.version, correctionSha: rev.delta.correctionSha, master: currentItem(d.id, 'edit', 'master')?.refId, vertical: currentItem(d.id, 'variant', 'vertical')?.refId, documentId: currentDoc(d.id)?.id } });
    });
  }
  function replaceClaimItems(deliveryId, roles, produce) {
    return bus.transaction(() => {
      for (const item of itemsOfDelivery(deliveryId)) if (item.kind === "claim" && item.status === "CURRENT" && !roles.includes(item.role)) db.prepare("UPDATE delivery_items SET status = 'SUPERSEDED', status_reason = ?, updated_at = ? WHERE id = ?").run('Afirmația nu mai este inclusă în prezentarea corectată', now(), item.id);
      return produce();
    });
  }
  function renderDocument(deliveryId, { changed = null, actor = "delivery", planId, revisionId } = {}) {
    const d = need(deliveryId);
    const template = effectiveTemplate(d, { planId });
    const facts = factory.claimFacts(d.missionId, { bundleId: d.bundleId });
    const presentation = presentationForTemplate(template, facts), proofs = provePresentation(presentation, facts);
    const mediaList = mediaFacts(deliveryId);
    const fresh = renderSummary({ projectName: template.project?.name || d.title, synthetic: true, simulation: d.labels.includes("SIMULATION"), manifest: facts.manifest, bundleId: facts.bundle.id,
      bundleSha: facts.bundle.sha256, issue: template.issueTitle, presentation, proofs, media: mediaList, services: servicesOf(d), owner: ownerProfile(), generatedAt: now() });
    const prev = currentDoc(deliveryId);
    const doc = prev ? regenerateSummary({ ...prev, title: fresh.title }, fresh, changed || ["software", "claims", "media", "services", "template"]) : fresh;
    const factual = summaryFactCheck({ doc, presentation, proofs, spec: facts.spec });
    if (factual.status === "FAIL") throw new HubError("conflict", "Rezumatul conține citări fără dovadă.", { code: "SUMMARY_FACT_CHECK", data: factual });
    doc.basis.factual = factual;
    const correction = revisionId && getRevision(revisionId)?.delta;
    if (correction?.correction) {
      doc.basis.correction = { revisionId, version: correction.correction.version, correctionSha: correction.correctionSha };
      for (const s of doc.sections) if (s.needsReview) s.reviewReason = `corectura v${correction.correction.version} a schimbat faptele`;
    }
    doc.basisSha = hashCanonical(doc.basis);
    return saveDocument(d, prev, doc, { mediaList, authorKind: doc.authorKind, actor });
  }
  function saveDocument(d, prev, doc, { mediaList = null, authorKind = "template", actor = "delivery", approval = null }) {
    const version = (prev?.version || 0) + 1;
    const id = newId("ddoc");
    const media_ = mediaList || mediaFacts(d.id);
    const basis = { ...doc.basis, bundleSha: d.bundleSha || doc.basis?.software?.bundleSha || "", videoItemIds: media_.flatMap((m) => m.itemIds), serviceRefs: d.template?.summary?.serviceRefs || [] };
    bus.transaction(() => {
      if (prev && prev.status === "CURRENT") db.prepare("UPDATE delivery_documents SET status = 'SUPERSEDED' WHERE id = ?").run(prev.id);
      db.prepare(`INSERT INTO delivery_documents (id, delivery_id, kind, version, parent_id, sections_json, text, content_sha, basis_json, basis_sha, claims_to_verify_json, warnings_json, author_kind, status, approval_json, export_json, created_by, created_at)
        VALUES (?, ?, 'commercial_summary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT', ?, '{}', ?, ?)`).run(id, d.id, version, prev?.id || null, json(doc.sections), doc.text, doc.contentSha, json(basis), hashCanonical(basis),
        json(doc.claimsToVerify), json(doc.warnings), authorKind, approval ? json(approval) : null, String(actor).slice(0, 80), now());
      bus.append({ type: "delivery.summary.version", scopeType: "delivery", scopeId: d.id, source: actor, payload: { deliveryId: d.id, documentId: id, version, authorKind } });
    });
    return { ...docView(db.prepare("SELECT * FROM delivery_documents WHERE id = ?").get(id)), title: doc.title };
  }
  /** Writes rezumat-v<n>.md / .html into the delivery's export folder (never overwriting; sha recorded). */
  function exportDocument(deliveryId, documentId) {
    const d = need(deliveryId);
    const doc = docView(db.prepare("SELECT * FROM delivery_documents WHERE id = ? AND delivery_id = ?").get(documentId, deliveryId));
    if (!doc) throw new HubError("not_found", "Versiunea rezumatului nu există.");
    if (doc.status === "STALE") throw new HubError("conflict", "Rezumatul e învechit (software-ul s-a schimbat); nu îl export.", { code: "SUMMARY_STALE" });
    const dir = path.join(d.template.exports.dir, d.template.exports.folder);
    const title = doc.text.split("\n")[0];
    const md = writeNew(dir, `rezumat-v${doc.version}.md`, Buffer.from(toMarkdown({ title, sections: doc.sections }), "utf8"), { root: d.template.exports.dir });
    const html = writeNew(dir, `rezumat-v${doc.version}.html`, Buffer.from(toHtml({ title, sections: doc.sections }), "utf8"), { root: d.template.exports.dir });
    const exports = { md: { file: md.file, sha256: md.sha256 }, html: { file: html.file, sha256: html.sha256 } };
    bus.transaction(() => db.prepare("UPDATE delivery_documents SET export_json = ? WHERE id = ?").run(json(exports), documentId));
    return exports;
  }
  function editDocument(deliveryId, { sections, displayedSha, session }) {
    trust.requireSession(session, "editarea rezumatului");
    const d = need(deliveryId);
    const prev = currentDoc(deliveryId);
    if (prev && displayedSha !== undefined && displayedSha !== prev.contentSha) throw new HubError("conflict", "Rezumatul afișat s-a schimbat; reîncarcă versiunea curentă.", { code: "SUMMARY_DISPLAYED_STALE" });
    if (!prev) throw new HubError("conflict", "Rezumatul nu există încă.");
    if (prev.status === "STALE") throw new HubError("conflict", "Rezumatul e învechit; îl regenerez după noua versiune software.", { code: "SUMMARY_STALE" });
    const next = editSummary({ title: prev.text.split("\n")[0], sections: prev.sections, claimsToVerify: prev.claimsToVerify, warnings: prev.warnings, basis: prev.basis }, sections);
    return saveDocument(d, prev, next, { authorKind: next.authorKind, actor: `owner:${session.id}` });
  }
  function approveDocument(deliveryId, { displayedSha, session }) {
    trust.requireSession(session, "rezumatul gata de prezentare");
    const prev = currentDoc(deliveryId);
    if (!prev || prev.status !== "CURRENT") throw new HubError("conflict", "Nu există o versiune curentă a rezumatului.");
    if (displayedSha !== prev.contentSha) throw new HubError("conflict", "Versiunea afișată nu mai e cea curentă; reîncarcă rezumatul.", { code: "SUMMARY_DISPLAYED_STALE" });
    const stale = currentView(itemsOfDelivery(deliveryId), need(deliveryId)).hidden.filter((h) => prev.basis?.videoItemIds?.includes(h.id) && h.why === "STALE");
    if (stale.length) throw new HubError("conflict", "Rezumatul citează materiale învechite; nu îl marchez gata.", { code: "SUMMARY_STALE" });
    const audited = correctionFacts(deliveryId);
    if (audited.audit.defects.some(f => f.where.startsWith('summary.'))) throw new HubError('conflict', 'Rezumatul conține afirmații nelegate de criteriile aprobate.', { code: 'SUMMARY_FACT_CHECK' });
    const approval = { kind: "PRESENTATION_READY", sha: prev.contentSha, sessionId: session.id, at: now() };
    bus.transaction(() => {
      db.prepare("UPDATE delivery_documents SET approval_json = ? WHERE id = ?").run(json(approval), prev.id);
      bus.append({ type: "delivery.summary.approved", scopeType: "delivery", scopeId: deliveryId, source: `owner:${session.id}`, payload: { deliveryId, documentId: prev.id, version: prev.version } });
    });
    return docView(db.prepare("SELECT * FROM delivery_documents WHERE id = ?").get(prev.id));
  }

  /** A CONFIGURED catalog service bound to the summary (price / term then come from it); a new document version. */
  function bindService(deliveryId, { serviceId, session }) {
    trust.requireSession(session, "legarea unui serviciu");
    const d = need(deliveryId);
    const svc = sales?.services?.get ? sales.services.get(serviceId) : null;
    if (!svc) throw new HubError("not_found", "Serviciul nu există în catalog.");
    if (svc.price?.status !== "CONFIGURED") throw new HubError("validation", "Serviciul nu are un preț configurat; îl configurezi în Vânzări → Servicii.", { code: "SERVICE_NOT_CONFIGURED" });
    const refs = [...new Set([...(d.template.summary?.serviceRefs || []), `${svc.id}@${svc.version ?? 1}`])];
    const template = { ...d.template, summary: { ...d.template.summary, serviceRefs: refs } };
    bus.transaction(() => db.prepare("UPDATE deliveries SET template_json = ?, updated_at = ? WHERE id = ?").run(json(template), now(), d.id));
    return renderDocument(d.id, { changed: "services", actor: `owner:${session.id}` });
  }
  /** The owner's own preview of the bound version (test project, same snapshot); never the factory's process. */
  async function startPreview(deliveryId, { runner }) {
    const d = need(deliveryId);
    if (!d.missionId || !d.snapshotSha) throw new HubError("conflict", "Livrarea nu are încă o versiune legată.");
    const snap = factory.snapshotCheck(d.missionId);
    if (snap.actual !== d.snapshotSha) throw new HubError("conflict", "Proiectul nu mai e versiunea verificată; preview-ul nu pornește.", { code: "SNAPSHOT_DRIFT" });
    const fp = factory.previewStatus(d.missionId);
    if (fp.running) return { key: fp.key, url: d.template.preview.url, reused: true };
    const project = projects.get(d.projectId);
    const r = await runner.startPreview({ key: `delivery-preview-${d.id}`, ws: project.path, command: d.template.preview.command, url: d.template.preview.url, project });
    if (r.status !== "PASS") throw new HubError("tool", `Preview-ul nu a pornit: ${r.reason || r.status}`);
    return { key: `delivery-preview-${d.id}`, url: d.template.preview.url, reused: false };
  }

  // ---------------------------------------------------------------- revisions (recorded; planned by the planner)
  function recordRevision(deliveryId, { text, classes = [], target = {}, delta = {}, clarification = null, status, opsPlanId = null, reviewId = null, documentId = null, childDeliveryId = null, source = "owner", channel = "ui" }) {
    need(deliveryId);
    const id = newId("drv");
    bus.transaction(() => {
      db.prepare(`INSERT INTO delivery_revisions (id, delivery_id, text_redacted, classes_json, target_json, delta_json, clarification_json, status, ops_plan_id, review_id, document_id, child_delivery_id, source, channel, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, deliveryId, String(text || "").slice(0, 2000), json(classes), json(target), json(delta), clarification ? json(clarification) : null, status, opsPlanId, reviewId, documentId,
        childDeliveryId, String(source).slice(0, 40), String(channel).slice(0, 40), now(), now());
      bus.append({ type: "delivery.revision", scopeType: "delivery", scopeId: deliveryId, source, payload: { deliveryId, revisionId: id, status, classes } });
    });
    return revisionView(db.prepare("SELECT * FROM delivery_revisions WHERE id = ?").get(id));
  }
  const revisionView = (r) => r && ({ id: r.id, deliveryId: r.delivery_id, text: r.text_redacted, classes: parse(r.classes_json, []), target: parse(r.target_json, {}), delta: parse(r.delta_json, {}),
    clarification: parse(r.clarification_json, null), source: r.source, status: r.status, opsPlanId: r.ops_plan_id, reviewId: r.review_id, documentId: r.document_id, childDeliveryId: r.child_delivery_id, createdAt: r.created_at });
  /** The revision a running revision plan belongs to (its ops plan id), or null. */
  const revisionOfPlan = (deliveryId, planId) => revisionView(db.prepare("SELECT * FROM delivery_revisions WHERE delivery_id = ? AND ops_plan_id = ?").get(String(deliveryId || ""), String(planId || "")));
  const getRevision = (id) => revisionView(db.prepare("SELECT * FROM delivery_revisions WHERE id = ?").get(String(id || "")));
  function updateRevision(id, fields) {
    const cols = { status: "status", opsPlanId: "ops_plan_id", reviewId: "review_id", documentId: "document_id", childDeliveryId: "child_delivery_id" };
    const entries = Object.entries(fields).filter(([k]) => cols[k]);
    if (!entries.length) return getRevision(id);
    db.prepare(`UPDATE delivery_revisions SET ${entries.map(([k]) => `${cols[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...entries.map(([, v]) => v), now(), id);
    return getRevision(id);
  }

  const OFFICE_DEPENDS = Object.freeze({ "delivery.office.document": ["software", "criteria", "clips"], "delivery.office.workbook": ["fixture"], "delivery.campaign": ["software", "clips"], "delivery.package.index": ["software", "clips", "files"] });
  /** The office steps of the delivery's own package plan (DONE ones carry the file, its sha and the level reached). */
  function officeSteps(d, { history = false } = {}) {
    const ids = [d.opsPlanId, ...db.prepare("SELECT ops_plan_id FROM delivery_revisions WHERE delivery_id = ? ORDER BY rowid").all(d.id).map(r => r.ops_plan_id)].filter(Boolean);
    const latest = new Map(), all = [];
    for (const id of new Set(ids)) for (const s of opsPlans.view(id)?.steps || []) if (OFFICE_DEPENDS[s.kind]) {
      const step = { ...s, planId: id };
      all.push(step);
      if (s.status === 'DONE' || !latest.has(s.kind)) latest.set(s.kind, step);
    }
    if (history) return all;
    return [...latest.values()];
  }
  function officeOf(d) {
    const extras = d.template?.extras || [];
    // R-REV: what this refresh kept from its parent by proof (same inputs, same bytes), with the hashes and the reason.
    // Closure R-PACK: once the folder index copied it, the file shown is the verified local copy in THIS delivery's folder.
    const indexed = officeSteps(d).find((s) => s.kind === "delivery.package.index" && s.status === "DONE")?.result?.reused || [];
    const localOf = (r) => indexed.find((x) => x.kind === r.kind && x.sha256 === r.sha256)?.file || null;
    const reusedItems = (d.template?.reused || []).map((r) => ({ kind: `delivery.office.${r.kind}`, label: r.kind === "workbook" ? "Registru Excel" : r.kind, status: "REUSED", file: localOf(r) || r.file, sourceFile: r.file, copied: Boolean(localOf(r)), sha256: r.sha256,
      inputsSha: r.inputsSha, level: r.level || null, sourceDeliveryId: r.sourceDeliveryId, dependsOn: OFFICE_DEPENDS[`delivery.office.${r.kind}`] || [], state: "CURRENT", stateReason: r.reason }));
    if ((!extras.length && !d.template?.reused?.length) || !d.opsPlanId) return { requested: extras, folder: null, items: reusedItems, reused: reusedItems.length };
    const p = { steps: officeSteps(d) };
    const label = { "delivery.office.document": "Document Word", "delivery.office.workbook": "Registru Excel", "delivery.campaign": "Pachet de campanie", "delivery.package.index": "Cuprinsul dosarului" };
    const items = (p?.steps || []).filter((s) => label[s.kind]).map((s) => ({ kind: s.kind, label: label[s.kind], status: s.status, file: s.result?.file || s.result?.dir || s.result?.folder || null,
      pdf: s.result?.pdf || null, level: s.result?.level || s.result?.calendarLevel || null, pages: s.result?.pages || null, formulasChecked: s.result?.formulasChecked ?? null,
      channels: s.result?.channels ?? null, posts: s.result?.posts ?? null, files: s.result?.files?.length ?? (typeof s.result?.files === "number" ? s.result.files : null),
      sha256: s.result?.sha256 || null, ...officeState(d, s.kind, s.result) }));
    return { requested: extras, folder: path.join(d.template.exports.dir, d.template.exports.folder), softwareSpecSha: d.template?.specSha || null, items: [...items, ...reusedItems], reused: reusedItems.length };
  }

  /**
   * Stage before M12 (§8): what each office artifact depends on, and whether a software change made it out of date. The Word document
   * describes the verified software (criteria, flows), the campaign links the clips filmed from it and the folder index lists both:
   * a software change makes them STALE. The Excel workbook holds the fixture's demonstration data, not the code: it stays CURRENT.
   * A file is never „current” only because it exists: the state comes from the delivery's own stale record.
   */
  function officeState(d, kind, result = {}) {
    const dependsOn = OFFICE_DEPENDS[kind] || [];
    const softwareStale = d.status === "STALE" || ["CLOSED"].includes(d.status) && /software/i.test(String(d.statusReason || ""));
    const stale = softwareStale && dependsOn.includes("software");
    const clips = itemsOfDelivery(d.id).filter(i => i.kind === 'export' && i.status === 'CURRENT').map(i => i.refSha).sort();
    if (!stale && dependsOn.includes('clips') && result?.clipShas && hashCanonical([...result.clipShas].sort()) !== hashCanonical(clips)) return { dependsOn, state: 'REFERS_OLD_VERSION', stateReason: 'numește clipurile anterioare; se reface la corectură' };
    return { dependsOn, state: stale ? "STALE" : "CURRENT", stateReason: stale ? "descrie versiunea software anterioară; se refac în livrarea nouă" : dependsOn.includes("software") ? "legat de versiunea software verificată a acestei livrări" : "date demonstrative, independente de cod" };
  }

  // ---------------------------------------------------------------- the owner's view (contract: .ifrim/M11_DESIGN.md DELIVERY ROOM UI)
  function view(id) {
    const d = need(id);
    const project = projects.get(d.projectId);
    const items = itemsOfDelivery(id);
    const { current } = currentView(items, d);
    const binding = d.missionId ? (() => { try { return factory.deliveryBinding(d.missionId); } catch { return null; } })() : null;
    const fv = d.missionId ? factory.view(d.missionId) : null;
    const doc = currentDoc(id);
    // The owner's creative decision is read live from the Studio reviews of that exact edit version (pilot 2026-10-08: the value bound
    // at render time stayed PENDING after the owner approved, so the Room kept offering the button).
    const creativeOf = (editVersionId, bound) => {
      if (!editVersionId) return bound || "PENDING";
      let reviews = [];
      try { reviews = media.reviews.list({ editVersionId }) || []; } catch { return bound || "PENDING"; }
      const live = reviews.filter((r) => r.status !== "DISMISSED" && ["CREATIVE_APPROVED", "REJECTED"].includes(r.kind)).at(-1);
      return live ? (live.kind === "CREATIVE_APPROVED" ? "APPROVED" : "REJECTED") : (bound || "PENDING");
    };
    const clip = (role) => {
      const edit = current.find((i) => i.kind === (role === "master" ? "edit" : "variant") && i.role === (role === "master" ? "master" : "vertical"));
      const render = current.find((i) => i.kind === "render" && i.role === role);
      const qa = current.find((i) => i.kind === "qa" && i.role === role);
      if (!edit && !render) return null;
      return { editVersionId: role === "master" ? edit?.refId || null : edit?.meta?.editVersionId || null, assetVersionId: render?.refId || null, src: render?.refId ? `/api/media/files/${render.refId}` : null,
        durationMs: render?.meta?.durationMs || null, label: render?.meta?.label || null, qa: qa ? { status: qa.meta?.status || null, kinds: qa.meta?.kinds || {}, unjustified: qa.meta?.unjustified || 0 } : null,
        creative: creativeOf(role === "master" ? edit?.refId : edit?.meta?.editVersionId, render?.meta?.creative), ...(role === 'vertical' ? irMetadata(media.edits.getVersion(edit?.meta?.editVersionId)?.ir) : { markers: edit?.meta?.markers || [], textItems: edit?.meta?.textItems || [] }) };
    };
    const plans = db.prepare("SELECT id FROM ops_plans WHERE id = ? OR id IN (SELECT ops_plan_id FROM delivery_revisions WHERE delivery_id = ? AND ops_plan_id IS NOT NULL)").all(d.opsPlanId || "", id)
      .map((r) => opsPlans.view(r.id)).filter(Boolean).map((p) => ({ id: p.id, kind: p.kind, status: p.status, steps: p.steps.map((s) => ({ seq: s.seq, title: s.title, status: s.status, kind: s.kind })) }));
    const observations = [];
    let defects = [];
    if (['READY', 'NEEDS_OWNER', 'STALE'].includes(d.status)) try { defects = correctionFacts(d.id).audit.defects; } catch { /* incomplete facts */ }
    const correctionPlan = plans.find(p => p.kind === CORRECTION_KIND && LIVE_CORRECTION.includes(p.status));
    const recovery = unfinishedCorrection(d);
    const correction = { available: ['READY', 'NEEDS_OWNER'].includes(d.status) && (defects.length > 0 || Boolean(recovery)), reason: recovery ? recoveryReason : null, defectCount: defects.length, defects, plan: correctionPlan ? { id: correctionPlan.id, status: correctionPlan.status } : null,
      applied: db.prepare("SELECT payload_json, created_at FROM events WHERE type = 'delivery.correction_applied' AND scope_id = ? ORDER BY seq").all(id).map(r => ({ version: parse(r.payload_json, {}).version, correctionSha: parse(r.payload_json, {}).correctionSha, appliedAt: r.created_at })) };
    for (const c of binding?.criteria || []) if (!String(c.status).startsWith("PASS")) observations.push({ kind: "criterion", severity: "warn", text: `${c.id} ${c.text}: ${c.status}`, ref: c.id });
    for (const x of doc?.claimsToVerify || []) observations.push({ kind: "summary", severity: "info", text: x, ref: doc.id });
    for (const f of fv?.findings || []) if (f.status === "OPEN") observations.push({ kind: "finding", severity: f.severity, text: f.observation, ref: f.id });
    const child = db.prepare("WITH RECURSIVE descendants(id, depth) AS (SELECT id, 1 FROM deliveries WHERE parent_id = ? UNION ALL SELECT d.id, p.depth + 1 FROM deliveries d JOIN descendants p ON d.parent_id = p.id WHERE p.depth < 8) SELECT d.id, d.status FROM deliveries d JOIN descendants x ON x.id = d.id WHERE d.status IN ('READY','ARMED','ACTIVE','NEEDS_OWNER') ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1").get(id);
    if (d.status === 'STALE' && defects.length) observations.push({ kind: 'correction', severity: 'warn', text: 'Conține citări de criterii greșite (păstrată ca istoric); livrarea curentă e ' + (child?.id || 'indisponibilă'), ref: child?.id || null });
    return {
      correction,
      delivery: { id: d.id, title: d.title, status: d.status, statusReason: d.statusReason, projectId: d.projectId, projectName: project?.name || null, labels: d.labels, generation: d.generation,
        parentId: d.parentId, childId: child?.id || null, childStatus: child?.status || null, verified: d.verified, missionId: d.missionId, issueTitle: d.template.issueTitle },
      software: binding ? { bundle: { id: binding.bundleId, shaPrefix: String(binding.bundleSha).slice(0, 12), status: binding.bundleStatus, sha: binding.bundleSha },
        spec: { version: binding.specVersion, shaPrefix: String(binding.specSha || "").slice(0, 12) }, changeSet: { shaPrefix: String(binding.changeSetSha || "").slice(0, 12), files: binding.manifest?.changeSet?.files || [] },
        review: (binding.manifest?.reviews || []).filter((r) => r.status === "VALID").at(-1) || null, tests: (binding.manifest?.evidence || []).filter((e) => e.stage === "QA" || e.stage === "CHECKS"),
        criteria: binding.criteria.map((c) => ({ id: c.id, text: c.text, verify: c.verify, status: c.status, note: c.note })) } : null,
      preview: { url: d.template.preview.url, origin: d.template.preview.origin, startCommand: d.template.preview.command, running: d.missionId ? factory.previewStatus(d.missionId).running : false,
        shots: (binding?.e2e || []).map((e) => ({ criterion: e.criterion, status: e.status, viewportLabel: e.viewport && e.viewport.width <= 480 ? `lățimea unui telefon ${e.viewport.width} px, Chromium (fără touch)` : e.viewport ? `desktop ${e.viewport.width}×${e.viewport.height}` : "",
          src: e.screenshot ? `/api/deliveries/${id}/evidence/${e.evidenceId}/screenshot` : null })) },
      clip: { master: clip("master"), vertical: clip("vertical"), rights: { internal: "allowed", public: [] } },
      summary: doc ? { documentId: doc.id, version: doc.version, sha: doc.contentSha, status: doc.status, sections: doc.sections, warnings: doc.warnings, claimsToVerify: doc.claimsToVerify, basis: doc.basis,
        approval: doc.approval, exports: doc.exports, versions: docsOf(id).map(docView).map(v => ({ version: v.version, status: v.status, contentShaPrefix: v.contentSha.slice(0, 12), approval: v.approval, createdBy: v.createdBy, correction: v.basis.correction || null })) } : null,
      observations,
      decisions: { software: binding?.bundleStatus === "OWNER_ACCEPTED" ? "ACCEPTED" : "PENDING", creativeMaster: clip("master")?.creative || "PENDING", creativeVertical: clip("vertical")?.creative || "PENDING",
        rightsPublic: "NOT_RECORDED", summaryReady: doc?.approval ? "READY" : "PENDING", publishing: "OFF" },
      plans,
      // Stage before M12: the office part of the package (Word, Excel, campaign, folder index) with the verification level each reached.
      office: officeOf(d),
      revisions: db.prepare("SELECT * FROM delivery_revisions WHERE delivery_id = ? ORDER BY created_at").all(id).map(revisionView).filter(r => !r.delta?.correction || r.opsPlanId).map((r) => ({ id: r.id, text: r.text, status: r.status, classes: r.classes, planId: r.opsPlanId, source: r.source })),
      history: items.map((i) => ({ kind: i.kind, role: i.role, id: i.id, status: i.status, staleReason: i.statusReason, supersedesId: i.supersedesId, createdAt: i.createdAt })),
    };
  }
  const list = ({ projectId = null } = {}) => (projectId ? db.prepare("SELECT * FROM deliveries WHERE project_id = ? ORDER BY created_at DESC").all(projectId) : db.prepare("SELECT * FROM deliveries ORDER BY created_at DESC LIMIT 50").all()).map(deliveryView)
    .map(({ template, opsSteps, ...rest }) => ({ ...rest, issueTitle: template?.issueTitle || null }));
  const latestForProject = (projectId) => list({ projectId }).find((d) => OPEN.has(d.status)) || list({ projectId })[0] || null;

  function close(id, { reason = "închisă de proprietar", actor = "owner" } = {}) {
    const d = need(id);
    bus.transaction(() => setStatus(id, "CLOSED", reason, { closed_at: now() }, { from: ["READY", "STALE", "NEEDS_OWNER", "FAILED"] }));
    return get(d.id);
  }
  async function cancel(id, { reason = "anulată", actor = "owner" } = {}) {
    const d = need(id);
    if (d.opsPlanId) { try { await opsPlans.cancel?.({ planId: d.opsPlanId, reason, actor }); } catch { /* plan already over */ } }
    bus.transaction(() => { if (["PLANNED", "ARMED", "ACTIVE", "NEEDS_OWNER"].includes(d.status)) setStatus(id, "CANCELLED", reason, { closed_at: now() }); });
    return get(id);
  }

  // ---------------------------------------------------------------- listeners (post-commit, deferred)
  const deliveriesOfMission = (missionId) => db.prepare("SELECT id FROM deliveries WHERE mission_id = ? AND status NOT IN ('CLOSED','CANCELLED','EXPIRED')").all(String(missionId || "")).map((r) => r.id);
  function onEvent(e) {
    if (closing) return;
    const p = e.payload || {};
    try {
      if (e.type === "factory.bundle.status" && ["STALE", "REJECTED"].includes(p.status)) {
        for (const id of deliveriesOfMission(p.missionId)) if (get(id).bundleId === p.bundleId) trigger(id, "software_changed", { cause: p.reason || p.status }, "factory");
      } else if (e.type === "factory.bundle.status" && p.status === "OWNER_ACCEPTED") {
        for (const id of deliveriesOfMission(p.missionId)) { const b = currentItem(id, "bundle"); if (b) db.prepare("UPDATE delivery_items SET meta_json = json_set(meta_json, '$.status', 'OWNER_ACCEPTED'), updated_at = ? WHERE id = ?").run(now(), b.id); }
      } else if (e.type === "factory.stage" && ["DELIVERY_READY"].includes(p.stage || p.to)) {
        for (const id of deliveriesOfMission(p.missionId || e.scopeId)) if (get(id).status === "ARMED") setTimeout(() => activate(id).catch(() => {}), 0);
      } else if (e.type === "factory.stage" && ["IMPLEMENTING", "REPAIRING", "CHECKING"].includes(p.stage || p.to)) {
        const missionId = p.missionId || e.scopeId;
        for (const id of deliveriesOfMission(missionId)) { const d = get(id); if (["READY", "NEEDS_OWNER"].includes(d.status)) trigger(id, "software_changed", { cause: "misiunea lucrează din nou la cod" }, "factory"); }
      } else if (e.type === "factory.change_set" && p.files > 0) {
        const missionId = p.missionId || e.scopeId, projectId = missions.get(missionId)?.projectId;
        const first = db.prepare("SELECT id FROM factory_change_sets WHERE mission_id = ? AND json_array_length(changes_json) > 0 ORDER BY seq LIMIT 1").get(missionId);
        if (projectId && first?.id === p.changeSetId) for (const r of db.prepare("SELECT id FROM deliveries WHERE project_id = ? AND mission_id != ? AND status IN ('READY','NEEDS_OWNER')").all(projectId, missionId)) trigger(r.id, "software_revision", { missionId, changedFiles: factory.snapshotCheck(get(r.id).missionId).changedFiles }, "factory");
      } else if (e.type === "factory.retire_restored" && p.complete === true) {
        const projectId = p.projectId || missions.get(p.missionId || e.scopeId)?.projectId;
        for (const r of db.prepare("SELECT id FROM deliveries WHERE project_id = ? AND status = 'STALE'").all(projectId)) {
          const result = reconcileStale(r.id, { actor: "factory", dryRun: false });
          if (!result.ok) bus.emit({ type: "delivery.stale_reconcile_refused", scopeType: "delivery", scopeId: r.id, source: "factory", payload: { deliveryId: r.id, reasons: result.reasons, restoreMissionId: p.missionId || e.scopeId } });
        }
      } else if (e.type.startsWith("ops.plan.") && ["paused", "needs_owner", "failed", "cancelled"].includes(e.type.slice(9))) {
        const r = db.prepare("SELECT id FROM deliveries WHERE ops_plan_id = ? AND status = 'ACTIVE'").get(e.scopeId);
        if (r) trigger(r.id, "plan_stopped", { reason: `planul de livrare: ${e.type.slice(9)}${p.reason ? ` (${p.reason})` : ""}` }, "ops");
        const correction = db.prepare("SELECT r.id, r.delivery_id FROM delivery_revisions r JOIN deliveries d ON d.id = r.delivery_id WHERE r.ops_plan_id = ? AND json_extract(r.delta_json, '$.correction.kind') = 'presentation-correction' AND d.status IN ('READY','NEEDS_OWNER')").get(e.scopeId);
        if (correction) {
          const plan = opsPlans.view(e.scopeId);
          if (plan?.status === 'CANCELLED') updateRevision(correction.id, { status: 'CANCELLED' });
          if (!started(plan)) return;
          const reason = 'Corectura s-a oprit: ' + (p.reason || e.type.slice(9));
          setStatus(correction.delivery_id, 'NEEDS_OWNER', reason);
          bus.emit({ type: 'delivery.correction_failed', scopeType: 'delivery', scopeId: correction.delivery_id, source: 'ops', payload: { revisionId: correction.id, planId: e.scopeId, reason } });
        }
      } else if (e.type === "envelope.status" || e.type.startsWith("envelope.")) {
        const envelopeId = e.scopeId || p.envelopeId;
        const status = p.to || p.status || e.type.slice(9).toUpperCase();
        const r = db.prepare("SELECT id FROM deliveries WHERE envelope_id = ?").get(String(envelopeId || ""));
        if (r && ["SUPERSEDED", "EXPIRED", "CANCELLED", "REVOKED", "FAILED_TO_START"].includes(status)) trigger(r.id, "envelope_closed", { envelopeId, envelopeStatus: status }, "envelope");
      } else if (e.type === "system.stop_all") {
        for (const r of db.prepare("SELECT id FROM deliveries WHERE status = 'ARMED'").all()) bus.transaction(() => setStatus(r.id, "CANCELLED", "„Oprește tot” a oprit livrarea înainte să pornească", {}, { from: ["ARMED"] }));
      } else if (e.type === "media.rights.revoked") {
        for (const r of db.prepare("SELECT DISTINCT delivery_id FROM delivery_items WHERE ref_id = ? OR ref_id IN (SELECT id FROM media_asset_versions WHERE asset_id = ?)").all(String(p.assetId || ""), String(p.assetId || "")))
          trigger(r.delivery_id, "rights_revoked", { refIds: [p.assetId, ...(p.versionIds || [])].filter(Boolean) }, "rights");
      }
    } catch { /* a listener never breaks the publisher; tick re-checks */ }
  }
  let detach = null;
  function boot() {
    closing = false;
    if (detach || !bus.subscribe) return;
    detach = bus.subscribe((e) => setTimeout(() => onEvent(e), 0));
    // A crash after committing a verified restore may precede its deferred listener. Replay only for still-stale projects.
    const restores = db.prepare(`SELECT e.scope_id, e.payload_json FROM events e WHERE e.type = 'factory.retire_restored'
      AND json_extract(e.payload_json, '$.complete') = 1 AND e.seq = (SELECT MAX(x.seq) FROM events x WHERE x.type = e.type AND x.scope_id = e.scope_id)
      AND EXISTS (SELECT 1 FROM missions m JOIN deliveries d ON d.project_id = m.project_id WHERE m.id = e.scope_id AND d.status = 'STALE')`).all();
    for (const e of restores) setTimeout(() => onEvent({ type: "factory.retire_restored", scopeId: e.scope_id, payload: parse(e.payload_json, {}) }), 0);
  }

  /** Housekeeping: read-only proposal scans, at most once per delivery per ten minutes. */
  const lastCorrectionScan = new Map();
  async function tick() {
    if (closing) return;
    for (const r of db.prepare("SELECT id FROM deliveries d WHERE status IN ('READY','NEEDS_OWNER') AND NOT EXISTS (SELECT 1 FROM delivery_revisions r JOIN ops_plans p ON p.id = r.ops_plan_id WHERE r.delivery_id = d.id AND p.kind = 'delivery.correct' AND p.status IN ('PROPOSED','CONFIRMED','RUNNING','PAUSED'))").all()) {
      const time = clock().getTime();
      if (lastCorrectionScan.has(r.id) && time - lastCorrectionScan.get(r.id) < 10 * 60000) continue;
      lastCorrectionScan.set(r.id, time);
      const d = get(r.id);
      if (d.status === 'NEEDS_OWNER' && !unfinishedCorrection(d)) continue;
      try { await proposeCorrection(r.id, { actor: 'hub', via: 'correction' }); } catch { /* no authority on refusal */ }
    }
    // A derived delivery plan the Hub refused before any step did work — no ops plan (an operation the phase list lacked) or a plan that
    // FAILED with no step done (its step 1 ran before the plan id was bound) — goes back to ARMED once per Hub version, so the same
    // checks run again on the current code: the confirmation, the steps' hash, the snapshot and the tools are re-checked by activate().
    const candidates = db.prepare(`SELECT d.id, d.ops_plan_id FROM deliveries d WHERE d.status = 'NEEDS_OWNER' AND (d.status_reason LIKE 'Planul de livrare nu a pornit:%'
      OR (d.status_reason LIKE 'planul de livrare: failed%' AND d.ops_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ops_plan_steps s WHERE s.plan_id = d.ops_plan_id AND s.status = 'DONE')))`).all();
    for (const r of candidates) {
      if (db.prepare("SELECT 1 FROM events WHERE type = 'delivery.rearmed' AND scope_id = ? AND json_extract(payload_json, '$.version') = ? LIMIT 1").get(r.id, HUB_VERSION)) continue;
      bus.transaction(() => {
        setStatus(r.id, "ARMED", "Reîncerc pornirea livrării pe codul actual (o singură dată pe versiune)", {}, { from: ["NEEDS_OWNER"] });
        bus.append({ type: "delivery.rearmed", scopeType: "delivery", scopeId: r.id, source: "delivery", payload: { deliveryId: r.id, version: HUB_VERSION, previousPlanId: r.ops_plan_id || null } });
      });
    }
    for (const r of db.prepare("SELECT id, mission_id FROM deliveries WHERE status = 'ARMED'").all()) {
      if (closing) return;
      try { const f = factory.view(r.mission_id)?.factory; if (f && ["DELIVERY_READY", "ACCEPTED"].includes(f.stage)) await activate(r.id); } catch { /* next tick */ }
    }
  }

  return { correctionFacts, correctionDraft, checkCorrection, proposeCorrection, finishCorrection, officeSteps, effectiveTemplate, replaceClaimItems, createPlanned, sectionFor, sectionForMission, arm, activate, startDirect, bindItem, bindSoftware, currentItem, items: itemsOfDelivery, trigger, verify, reconcileStale, renderDocument, exportDocument, editDocument, approveDocument,
    currentDoc, recordRevision, getRevision, updateRevision, revisionOfPlan, view, get, need, list, latestForProject, close, cancel, setStatus, readiness, boot, tick, onEvent, attachEnvelopes, patch, bindService, startPreview,
    close_: () => { closing = true; if (detach) detach(); detach = null; }, mediaFacts, markerOf };
}
