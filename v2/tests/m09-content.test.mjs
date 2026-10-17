// M09 content department (contract §5.7): ideas (dedupe; event ideas only from ACCEPTED missions), readiness NO_GO /
// NEEDS_CAPTURE with capture tasks, versioned brief/script/storyboard with author_kind, claims SUPPORTED only with evidence,
// board columns without fake progress, explicit role bindings, Content → Sales link through the real Sales service and the
// funnel without invented attribution (T15). Deterministic: migrated temp DB (media-helpers), no tool, no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeMediaEnv, fakeLaunchers } from "./media-helpers.mjs";
import { createContent, BOARD_COLUMNS, CONTENT_ROLES } from "../server/media/content.mjs";
import { createCampaigns } from "../server/media/campaigns.mjs";
import { createSales } from "../server/sales/sales.mjs";
import { newId } from "../server/core/ids.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { criterionFingerprint, criterionRef, displaySha } from "../server/media/claims.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-20T10:00:00.000Z");

function setup() {
  let nowMs = T0;
  const clock = () => new Date(nowMs);
  const env = makeMediaEnv({ launchers: fakeLaunchers(), clock });
  const { db, bus, settings, config } = env;
  const sales = createSales({ db, bus, clock, config, settings });
  const content = createContent({ db, bus, clock, settings, sales });
  const campaigns = createCampaigns({ db, bus, clock, sales });
  const at = () => clock().toISOString();
  return { env, db, bus, clock, set: (ms) => { nowMs = ms; }, sales, content, campaigns, at };
}

/** A Software Factory mission row in a given stage (plus an optional bundle) — what the factory leaves in the DB. */
function seedMission(s, { stage = "DELIVERY_READY", bundle = true, client = false } = {}) {
  const projectId = s.db.prepare("SELECT id FROM projects LIMIT 1").get()?.id || (() => {
    const id = newId("prj");
    s.db.prepare("INSERT INTO projects (id, slug, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, `demo-${id}`, "Demo Hub", "C:/tmp/demo", s.at(), s.at());
    return id;
  })();
  if (client) {
    const cid = newId("cli");
    s.db.prepare("INSERT INTO clients (id, name, created_at, updated_at) VALUES (?, 'Client SRL', ?, ?)").run(cid, s.at(), s.at());
    s.db.prepare("UPDATE projects SET client_id = ? WHERE id = ?").run(cid, projectId);
  }
  const missionId = newId("mis");
  s.db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES (?, ?, 'factory', ?, ?, ?, ?)").run(missionId, projectId, "Formular de contact validat", "Validare server pentru formularul de contact", s.at(), s.at());
  s.db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, created_at, updated_at) VALUES (?, 'feature', ?, '{}', ?, ?)").run(missionId, stage, s.at(), s.at());
  let bundleId = null;
  if (bundle) {
    bundleId = newId("bnd");
    s.db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at) VALUES (?, ?, 'chs_1', ?, 1, '{}', ?, 'ACCEPTED', ?)")
      .run(bundleId, missionId, "a".repeat(64), "b".repeat(64), s.at());
  }
  return { missionId, bundleId, projectId };
}
const stageEvent = (s, missionId, stage) => s.bus.emit({ type: "factory.stage", scopeType: "mission", scopeId: missionId, source: "factory", payload: { stage } });

const brief = { objective: "Arătăm cum Hub-ul validează un formular real", angles: { technical: "Validare pe server cu teste reale", business: "" }, platforms: ["youtube"] };
const shot = (id, extra = {}) => ({ id, purpose: `Cadrul ${id}`, source: { kind: "text_only" }, durationMs: 2000, acceptance: "Textul e lizibil", ...extra });

test("M09-CT-11 criterion, display and method-specific evidence kinds validate their stored source", t => {
  const s = setup(); t.after(() => s.env.cleanup());
  const { missionId } = seedMission(s), project = s.content.createProject({ title: "Criterion claims" });
  const item = { id: "AC-1", text: "Test verificat", verify: "test", testRef: "test.mjs" }, spec = { acceptance: [item] }, specSha = hashCanonical(spec);
  s.db.prepare("INSERT INTO factory_specs (id,mission_id,version,status,spec_json,sha256,author,created_at) VALUES ('sp_claim',?,1,'APPROVED',?,?,'test',?)").run(missionId, JSON.stringify(spec), specSha, s.at());
  for (const stage of ["E2E", "PREVIEW"]) s.db.prepare("INSERT INTO factory_evidence (id,mission_id,change_set_id,stage,kind,command,runner,isolation,status,counts_json,detail_json,created_at) VALUES (?,?,'cs',?,'check','check','test','test','PASS','{}','{}',?)").run("ev_" + stage, missionId, stage, s.at());
  s.db.prepare("INSERT INTO factory_reviews (id,mission_id,change_set_id,change_set_sha,reviewer,verdict,validation_json,status,created_at) VALUES ('rv_claim',?,'cs',?,'test','PASS','{}','VALID',?)").run(missionId, "a".repeat(64), s.at());
  const save = evidence => s.content.saveClaim(project.id, { text: "Test verificat", status: "SUPPORTED", evidence });
  const criterion = { kind: "criterion", ref: criterionRef(specSha, item.id), sha256: criterionFingerprint(item) };
  const claim = save([criterion, { kind: "display", ref: "t-hook:business", sha256: displaySha("Test verificat") }, { kind: "e2e", ref: "ev_E2E" }, { kind: "preview", ref: "ev_PREVIEW" }, { kind: "review", ref: "rv_claim" }]);
  assert.equal(claim.status, "SUPPORTED"); assert.equal(claim.evidence.length, 5);
  assert.throws(() => save([{ ...criterion, sha256: "b".repeat(64) }]), e => e.code === "CRITERION_CHANGED");
  for (const evidence of [{ ...criterion, ref: criterionRef(specSha, "AC-2") }, { kind: "e2e", ref: "ev_PREVIEW" }, { kind: "preview", ref: "ev_E2E" }, { kind: "review", ref: "missing" }]) assert.throws(() => save([evidence]), e => e.code === "EVIDENCE_NOT_FOUND");
  assert.throws(() => save([{ kind: "display", ref: "t-hook", sha256: "bad" }]));
  s.db.prepare("UPDATE factory_specs SET status = 'DRAFT' WHERE id = 'sp_claim'").run();
  assert.throws(() => save([criterion]), e => e.code === "EVIDENCE_NOT_FOUND");
});

test("M09-CT-01 ideas: dedupe on the folded title, event ideas refused manually, status transitions, idempotent promotion", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const a = s.content.createIdea({ title: "Demo: formular validat în 30 de secunde", sourceKind: "owner", publicEligible: true });
  assert.equal(a.duplicate, false);
  const b = s.content.createIdea({ title: "  demo — formular VALIDAT in 30 de secunde ", sourceKind: "owner" });
  assert.equal(b.duplicate, true, "same idea typed again (case, diacritics, punctuation)");
  assert.equal(b.idea.id, a.idea.id);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM content_ideas").get().n, 1);
  assert.throws(() => s.content.createIdea({ title: "Idee din eveniment", sourceKind: "event" }), (e) => e.category === "policy" && e.code === "EVENT_IDEA_MANUAL");
  assert.throws(() => s.content.createIdea({ title: "ab" }), /minimum 3/);
  assert.throws(() => s.content.createIdea({ title: "Idee", evidence: [{ kind: "rumor", ref: "x" }] }), /tip de dovadă necunoscut/);
  assert.equal(s.content.setIdeaStatus(a.idea.id, "SHORTLISTED").status, "SHORTLISTED");
  assert.throws(() => s.content.setIdeaStatus(a.idea.id, "PROMOTED"), /promovarea/);
  const d = s.content.createIdea({ title: "Idee respinsă", sourceKind: "manual" }).idea;
  s.content.setIdeaStatus(d.id, "DISCARDED", "owner", "nu e relevant");
  assert.throws(() => s.content.promoteIdea(d.id), /DISCARDED/);
  const p1 = s.content.promoteIdea(a.idea.id, { platforms: ["youtube"] });
  assert.equal(p1.existing, false);
  assert.equal(p1.project.ideaId, a.idea.id);
  assert.equal(s.content.getIdea(a.idea.id).status, "PROMOTED");
  const p2 = s.content.promoteIdea(a.idea.id);
  assert.equal(p2.existing, true);
  assert.equal(p2.project.id, p1.project.id);
  assert.throws(() => s.content.setIdeaStatus(a.idea.id, "NEW"), /nepermisă/);
});

test("M09-CT-02 event ideas only from ACCEPTED missions: one per mission, evidence refs, never from DELIVERY_READY / REJECTED", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const off = s.content.attach();
  t.after(off);
  const ready = seedMission(s, { stage: "DELIVERY_READY" });
  stageEvent(s, ready.missionId, "DELIVERY_READY");
  const rejected = seedMission(s, { stage: "REJECTED" });
  stageEvent(s, rejected.missionId, "REJECTED");
  // a forged ACCEPTED event while the factory row says DELIVERY_READY is not trusted
  stageEvent(s, ready.missionId, "ACCEPTED");
  assert.equal(s.content.listIdeas({ sourceKind: "event" }).length, 0);
  const acc = seedMission(s, { stage: "ACCEPTED", client: true });
  stageEvent(s, acc.missionId, "ACCEPTED");
  stageEvent(s, acc.missionId, "ACCEPTED");
  const ideas = s.content.listIdeas({ sourceKind: "event" });
  assert.equal(ideas.length, 1, "one idea per mission");
  const idea = ideas[0];
  assert.equal(idea.publicEligible, true);
  assert.equal(idea.dedupeKey, `event:factory-accepted:${acc.missionId}`);
  assert.match(idea.title, /Livrare acceptată: Formular de contact validat/);
  assert.deepEqual(idea.evidence.map((e) => e.kind), ["mission", "bundle", "event"]);
  assert.equal(idea.evidence[1].ref, acc.bundleId);
  assert.match(idea.reason, /acordul clientului/);
  assert.equal(s.content.onEvent({ type: "factory.stage", scopeType: "mission", scopeId: acc.missionId, payload: { stage: "REJECTED" } }), null);
  assert.equal(s.content.onEvent(null), null);
  assert.equal(s.content.onEvent({ type: "factory.stage", scopeType: "mission", scopeId: "mis_missing", payload: { stage: "ACCEPTED" } }), null);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'content.idea.created'").get().n, 1);
});

test("M09-CT-03 versioned brief / script / storyboard with author_kind; identical body creates no version; ro and en are separate", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const p = s.content.createProject({ title: "Proiect versiuni", platforms: ["youtube"] });
  assert.throws(() => s.content.saveBrief(p.id, { body: brief, authorKind: "robot", author: "x" }), /Tip de autor necunoscut/);
  assert.throws(() => s.content.saveBrief(p.id, { body: { ...brief, angles: { technical: "scurt", business: "" } }, authorKind: "owner", author: "Cătălin" }), /cel puțin un unghi/);
  const b1 = s.content.saveBrief(p.id, { body: brief, authorKind: "owner", author: "Cătălin" });
  assert.equal(b1.version, 1);
  assert.equal(b1.authorKind, "owner");
  assert.match(b1.sha256, /^[a-f0-9]{64}$/);
  assert.equal(s.content.saveBrief(p.id, { body: brief, authorKind: "owner", author: "Cătălin" }).unchanged, true);
  const b2 = s.content.saveBrief(p.id, { body: { ...brief, angles: { ...brief.angles, business: "Mai puține formulare pierdute" } }, authorKind: "agent", author: "creative-director" });
  assert.equal(b2.version, 2);
  assert.equal(b2.authorKind, "agent");
  assert.equal(s.content.getVersion("brief", p.id, 1).sha256, b1.sha256, "older versions are kept");
  const ro = s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "Cătălin", segments: [{ id: "s1", vo: "Aşa arată validarea", onScreen: "Validare reală", pauses: [{ at: "după titlu", ms: 400 }], pronunciations: [{ term: "Hub", say: "hab" }] }] });
  assert.equal(ro.version, 1);
  assert.equal(ro.body.segments[0].vo, "Așa arată validarea", "cedilla normalized to comma-below");
  const en = s.content.saveScript(p.id, { language: "en", authorKind: "template", author: "tpl", segments: [{ id: "s1", vo: "This is real validation" }] });
  assert.equal(en.version, 1, "en has its own chain");
  assert.equal(s.content.saveScript(p.id, { language: "ro", authorKind: "dev_session", author: "dev", segments: [{ id: "s1", vo: "Altă voce" }] }).version, 2);
  assert.throws(() => s.content.saveScript(p.id, { language: "de", authorKind: "owner", author: "x", segments: [{ id: "s1", vo: "x" }] }), /Limbă/);
  assert.throws(() => s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "x", segments: [{ id: "s1" }] }), /nici voce/);
  assert.throws(() => s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "x", segments: [{ id: "s1", vo: "a" }, { id: "s1", vo: "b" }] }), /duplicat/);
  assert.throws(() => s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "x", segments: [{ id: "s1", vo: "a", claimIds: ["ccl_x"] }] }), /nu aparține/);
  const sb = s.content.saveStoryboard(p.id, { authorKind: "agent", author: "creative-director", shots: [shot("sh1", { framing: "9:16 centru", crop: { x: 0, y: 0, w: 1, h: 1 }, motion: "zoom lent", overlays: ["Titlu"], audio: "muzică -20 dB", interval: { fromMs: 0, toMs: 2000 } })] });
  assert.equal(sb.version, 1);
  assert.deepEqual(Object.keys(sb.body.shots[0]).sort(), ["acceptance", "audio", "claimIds", "crop", "durationMs", "framing", "id", "interval", "motion", "overlays", "purpose", "source"]);
  assert.throws(() => s.content.saveStoryboard(p.id, { authorKind: "agent", author: "a", shots: [shot("x", { crop: { x: 0.5, y: 0, w: 0.8, h: 1 } })] }), /decupajul/);
  assert.throws(() => s.content.saveStoryboard(p.id, { authorKind: "agent", author: "a", shots: [shot("x", { source: { kind: "capture", description: "" } })] }), /descrie ce trebuie înregistrat/);
  const d = s.content.detail(p.id);
  assert.equal(d.versions.briefs.length, 2);
  assert.equal(d.versions.scripts.length, 3);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'content.brief.saved'").get().n, 2);
});

test("M09-CT-04 claims: SUPPORTED needs evidence of a known kind that exists; text change resets to UNCERTAIN; BLOCKED needs a reason", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const p = s.content.createProject({ title: "Proiect afirmații" });
  assert.throws(() => s.content.saveClaim(p.id, { text: "Validarea rulează pe server", status: "SUPPORTED" }), (e) => e.code === "CLAIM_NEEDS_EVIDENCE");
  const c = s.content.saveClaim(p.id, { text: "Validarea rulează pe server" });
  assert.equal(c.status, "UNCERTAIN");
  assert.throws(() => s.content.setClaimStatus(c.id, "SUPPORTED"), (e) => e.code === "CLAIM_NEEDS_EVIDENCE");
  assert.throws(() => s.content.setClaimStatus(c.id, "SUPPORTED", { evidence: [{ kind: "vibe", ref: "x" }] }), /tip de dovadă necunoscut/);
  assert.throws(() => s.content.setClaimStatus(c.id, "SUPPORTED", { evidence: [{ kind: "run", ref: "run_missing" }] }), (e) => e.code === "EVIDENCE_NOT_FOUND");
  assert.throws(() => s.content.setClaimStatus(c.id, "SUPPORTED", { evidence: [{ kind: "bundle", ref: "bnd_missing" }] }), (e) => e.code === "EVIDENCE_NOT_FOUND");
  assert.throws(() => s.content.setClaimStatus(c.id, "SUPPORTED", { evidence: [{ kind: "commit", ref: "not-a-sha" }] }), /commit valid/);
  const { bundleId } = seedMission(s, { stage: "ACCEPTED" });
  const sup = s.content.setClaimStatus(c.id, "SUPPORTED", { evidence: [{ kind: "bundle", ref: bundleId }, { kind: "commit", ref: "8b277c5" }, { kind: "test", ref: "m03-factory.test.mjs" }] });
  assert.equal(sup.status, "SUPPORTED");
  assert.equal(sup.evidence.length, 3);
  const edited = s.content.saveClaim(p.id, { id: c.id, text: "Validarea rulează pe server și în browser" });
  assert.equal(edited.status, "UNCERTAIN", "the evidence was for the old text");
  assert.throws(() => s.content.setClaimStatus(c.id, "BLOCKED"), /motivul|de ce/);
  assert.equal(s.content.setClaimStatus(c.id, "BLOCKED", { reason: "Nu există test pentru browser" }).status, "BLOCKED");
});

test("M09-CT-05 readiness: NO_GO with reasons; NEEDS_CAPTURE with concrete capture tasks; READY only with real material", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const p = s.content.createProject({ title: "Proiect pregătire", platforms: ["youtube"] });
  let r = s.content.evaluateReadiness(p.id);
  assert.equal(r.status, "NO_GO");
  assert.deepEqual(r.reasons.map((x) => x.code).sort(), ["NO_BRIEF", "NO_SCRIPT", "NO_STORYBOARD"]);
  assert.equal(s.content.getProject(p.id).readiness, "NO_GO", "persisted");
  s.content.saveBrief(p.id, { body: brief, authorKind: "owner", author: "Cătălin" });
  const claim = s.content.saveClaim(p.id, { text: "Formularul refuză un e-mail invalid" });
  s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "Cătălin", segments: [{ id: "s1", vo: "Uite ce se întâmplă", claimIds: [claim.id] }] });
  s.content.saveStoryboard(p.id, { authorKind: "owner", author: "Cătălin", shots: [
    shot("sh1"),
    shot("sh2", { purpose: "Demonstrația refuzului", source: { kind: "capture", captureKind: "browser_demo", description: "Completează un e-mail invalid și apasă Trimite" }, durationMs: 4000, framing: "9:16", claimIds: [claim.id], acceptance: "Mesajul de eroare e vizibil 2 s" }),
    shot("sh3", { source: { kind: "asset", assetVersionId: "mav_missing" } }),
  ] });
  r = s.content.evaluateReadiness(p.id);
  assert.equal(r.status, "NO_GO");
  assert.ok(r.reasons.some((x) => x.code === "CLAIM_UNCERTAIN" && x.claimId === claim.id));
  const { bundleId } = seedMission(s, { stage: "ACCEPTED" });
  s.content.setClaimStatus(claim.id, "SUPPORTED", { evidence: [{ kind: "bundle", ref: bundleId }] });
  r = s.content.evaluateReadiness(p.id);
  assert.equal(r.status, "NEEDS_CAPTURE");
  assert.equal(r.reasons.length, 0);
  assert.equal(r.captureTasks.length, 2);
  const t2 = r.captureTasks.find((c) => c.shotId === "sh2");
  assert.equal(t2.kind, "browser_demo");
  assert.match(t2.title, /Înregistrează cadrul sh2: Demonstrația refuzului/);
  assert.equal(t2.details.acceptance, "Mesajul de eroare e vizibil 2 s");
  assert.equal(t2.details.durationMs, 4000);
  assert.deepEqual(t2.details.claimIds, [claim.id]);
  assert.match(r.captureTasks.find((c) => c.shotId === "sh3").why, /nu există în bibliotecă/);
  // material arrives: a READY asset (labelled SIMULATION → warning, not a block)
  const assetId = newId("mas"); const versionId = newId("mav");
  s.db.prepare("INSERT INTO media_assets (id, content_project_id, kind, category, title, origin, capture_label, created_by, created_at, updated_at) VALUES (?, ?, 'video', 'screen_recording', 'demo', 'OWNED', 'SIMULATION', 'test', ?, ?)").run(assetId, p.id, s.at(), s.at());
  s.db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, status, created_by, created_at) VALUES (?, ?, 1, ?, 10, 'originals/aa/x.mp4', 'READY', 'test', ?)").run(versionId, assetId, "c".repeat(64), s.at());
  s.content.saveStoryboard(p.id, { authorKind: "owner", author: "Cătălin", shots: [shot("sh1"), shot("sh2", { source: { kind: "asset", assetVersionId: versionId }, claimIds: [claim.id] }), shot("sh3", { source: { kind: "generated", description: "fundal" } })] });
  r = s.content.evaluateReadiness(p.id);
  assert.equal(r.status, "READY");
  assert.ok(r.warnings.some((w) => w.code === "LABEL_REQUIRED"));
  assert.ok(r.warnings.some((w) => w.code === "AI_DISCLOSURE"));
  // a promoted idea that is not public-eligible blocks production
  const idea = s.content.createIdea({ title: "Idee internă", sourceKind: "manual" }).idea;
  const p2 = s.content.promoteIdea(idea.id).project;
  assert.ok(s.content.evaluateReadiness(p2.id).reasons.some((x) => x.code === "NOT_PUBLIC_ELIGIBLE"));
});

test("M09-CT-06 stages follow real data: guards refuse fake progress; board columns, checklist progress, no percentage", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const p = s.content.createProject({ title: "Proiect etape", platforms: ["youtube"], deadline: "2026-10-01T00:00:00Z", responsible: "Cătălin" });
  assert.throws(() => s.content.setStage(p.id, "SCRIPT"), (e) => e.code === "STAGE_TRANSITION");
  s.content.setStage(p.id, "RESEARCH");
  assert.throws(() => s.content.setStage(p.id, "SCRIPT"), (e) => e.code === "STAGE_PRECONDITION" && /brief/.test(e.message));
  s.content.saveBrief(p.id, { body: brief, authorKind: "owner", author: "Cătălin" });
  s.content.setStage(p.id, "SCRIPT");
  assert.throws(() => s.content.setStage(p.id, "STORYBOARD"), /scenariu/);
  s.content.saveScript(p.id, { language: "ro", authorKind: "owner", author: "Cătălin", segments: [{ id: "s1", vo: "Salut" }] });
  s.content.setStage(p.id, "STORYBOARD");
  s.content.saveStoryboard(p.id, { authorKind: "owner", author: "Cătălin", shots: [shot("sh1", { source: { kind: "capture", description: "Ecranul de start al Hub-ului" } })] });
  assert.throws(() => s.content.setStage(p.id, "PRODUCTION"), (e) => e.code === "STAGE_PRECONDITION" && /NEEDS_CAPTURE/.test(e.message));
  s.content.saveStoryboard(p.id, { authorKind: "owner", author: "Cătălin", shots: [shot("sh1")] });
  s.content.setStage(p.id, "PRODUCTION");
  s.content.setStage(p.id, "EDITING");
  assert.throws(() => s.content.setStage(p.id, "REVIEW"), /randare/);
  const stale = s.content.getProject(p.id).version - 1;
  assert.throws(() => s.content.setStage(p.id, "PRODUCTION", { expectedVersion: stale }), (e) => e.code === "STALE_VERSION");
  const b = s.content.board();
  assert.deepEqual(b.columns.map((c) => c.stage), [...BOARD_COLUMNS]);
  assert.equal(b.columns.length, 10);
  const card = b.columns.find((c) => c.stage === "EDITING").cards[0];
  assert.equal(card.id, p.id);
  assert.equal(card.responsible, "Cătălin");
  assert.equal(card.overdue, true);
  assert.equal(card.previewAssetVersionId, null);
  assert.equal(card.models, null, "no route/model shown when none was planned");
  assert.equal(card.progress.total, 9);
  assert.equal(card.progress.done, 4, "brief, script, storyboard, readiness READY — nothing else exists");
  assert.ok(!("percent" in card) && !("percent" in card.progress));
  assert.deepEqual(card.progress.steps.filter((x) => x.done).map((x) => x.key), ["brief", "script", "storyboard", "readiness"]);
  s.content.setStage(p.id, "ARCHIVED", { reason: "test" });
  assert.equal(s.content.board().archived, 1);
  assert.throws(() => s.content.saveBrief(p.id, { body: brief, authorKind: "owner", author: "x" }), /arhivat/);
});

test("M09-CT-07 media roles carry an explicit binding request; tasks store it and are never dispatched", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  for (const [role, def] of Object.entries(CONTENT_ROLES)) {
    assert.ok(def.binding.provider && def.binding.model && def.binding.effort, role);
    assert.ok(!/fable|\[1m\]/i.test(def.binding.model));
  }
  assert.deepEqual(Object.keys(CONTENT_ROLES).sort(), ["creative-director", "distribution-planner", "growth-analyst", "media-qa", "scriptwriter", "video-editor"]);
  const p = s.content.createProject({ title: "Proiect sarcini" });
  const task = s.content.addTask(p.id, { role: "scriptwriter", title: "Scenariu 30 s" });
  assert.deepEqual(task.binding, { provider: "claude", model: "sonnet", effort: "medium" });
  assert.equal(task.dispatched, false);
  assert.equal(task.status, "PLANNED");
  assert.throws(() => s.content.addTask(p.id, { role: "scriptwriter", title: "x y z", binding: { provider: "claude", model: "fable", effort: "medium" } }), /nu e permis/);
  assert.throws(() => s.content.addTask(p.id, { role: "scriptwriter", title: "x y z", binding: { provider: "claude", model: "sonnet[1m]", effort: "medium" } }), /nu e permis/);
  assert.throws(() => s.content.addTask(p.id, { role: "scriptwriter", title: "x y z", binding: { provider: "claude", model: "", effort: "medium" } }), /explicit/);
  assert.throws(() => s.content.addTask(p.id, { role: "scriptwriter", title: "x y z", binding: { provider: "claude", model: "opus", effort: "turbo" } }), /effort/);
  assert.throws(() => s.content.addTask(p.id, { role: "scriptwriter", taskType: "content_qa", title: "x y z" }), /nu face/);
  assert.throws(() => s.content.addTask(p.id, { role: "ceo", title: "x y z" }), /Rol media necunoscut/);
  s.content.addTask(p.id, { role: "media-qa", title: "QA final", binding: { provider: "codex", model: "gpt-6.1-sol", effort: "low" } });
  const card = s.content.board().columns[0].cards[0];
  assert.deepEqual(card.models.sort(), ["claude · sonnet · medium", "codex · gpt-6.1-sol · low"]);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing ran");
});

test("M09-CT-08 Content → Sales link through the real Sales service (getOpportunity + addEvidence), never sales_* writes here", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const orgId = newId("org");
  s.db.prepare("INSERT INTO sales_orgs (id, display_name, normalized_name, status, synthetic, created_at, updated_at) VALUES (?, 'Firma Test SRL', 'firma test', 'NEW', 1, ?, ?)").run(orgId, s.at(), s.at());
  const opp = s.sales.createOpportunity({ orgId, title: "Site cu formular" }, "owner").opportunity;
  const opp2 = s.sales.createOpportunity({ orgId, title: "Al doilea proiect" }, "owner").opportunity;
  const p = s.content.createProject({ title: "Studiu de caz formular" });
  assert.throws(() => s.campaigns.linkOpportunity({ contentProjectId: p.id, opportunityId: "opp_missing" }), (e) => e.category === "not_found");
  const r = s.campaigns.linkOpportunity({ contentProjectId: p.id, opportunityId: opp.id, note: "Clientul a văzut demo-ul" });
  assert.equal(r.already, false);
  assert.equal(s.content.getProject(p.id).opportunityId, opp.id);
  const ev = s.db.prepare("SELECT * FROM sales_evidence WHERE subject_type = 'opportunity' AND subject_id = ?").all(opp.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].source_ref, `content:${p.id}`);
  assert.equal(ev[0].label, "USER_PROVIDED");
  assert.equal(s.campaigns.linkOpportunity({ contentProjectId: p.id, opportunityId: opp.id }).already, true);
  assert.throws(() => s.campaigns.linkOpportunity({ contentProjectId: p.id, opportunityId: opp2.id }), (e) => e.code === "ALREADY_LINKED");
  assert.equal(s.campaigns.linkOpportunity({ contentProjectId: p.id, opportunityId: opp2.id, replace: true }).opportunityId, opp2.id);
  // source guard: the media modules never write sales_* tables
  for (const f of ["campaigns.mjs", "content.mjs", "distribution.mjs", "analytics.mjs"]) {
    const src = fs.readFileSync(path.join(here, "..", "server", "media", f), "utf8");
    assert.ok(!/(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+sales_/i.test(src), `${f} writes sales_*`);
  }
  // no outreach surface
  const api = Object.keys(s.campaigns);
  assert.ok(!api.some((k) => /dm|message|comment|outreach|send|contact|email|reply/i.test(k)), api.join(","));
});

test("M09-CT-09 T15 funnel: UNATTRIBUTED by default, attribution needs evidence, revenue only manual/import with explicit attribution, rates only with measured denominators", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const orgId = newId("org");
  s.db.prepare("INSERT INTO sales_orgs (id, display_name, normalized_name, status, synthetic, created_at, updated_at) VALUES (?, 'Firma Funnel SRL', 'firma funnel', 'NEW', 1, ?, ?)").run(orgId, s.at(), s.at());
  const opp = s.sales.createOpportunity({ orgId, title: "Oportunitate funnel" }, "owner").opportunity;
  const p = s.content.createProject({ title: "Funnel demo" });
  const lead = s.campaigns.recordFunnelEvent({ kind: "lead", contentProjectId: p.id, source: "manual" });
  assert.equal(lead.attribution, "UNATTRIBUTED");
  let f = s.campaigns.funnel(p.id);
  assert.equal(f.counts.lead, 1);
  assert.equal(f.rates.leadPerClick.value, null, "clicks were never measured");
  assert.match(f.rates.leadPerClick.reason, /nu e măsurat/);
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "api" }), /Sursa/);
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "manual", attribution: "DIRECT_TRACKED_LINK" }), (e) => e.code === "ATTRIBUTION_NEEDS_EVIDENCE");
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "manual", attribution: "DIRECT_TRACKED_LINK", evidence: [{ kind: "client_statement", ref: "apel" }] }), /link urmărit/);
  for (let i = 0; i < 4; i += 1) s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "import", attribution: "DIRECT_TRACKED_LINK", evidence: [{ kind: "utm", ref: `utm_campaign=demo&i=${i}` }] });
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "revenue_received", contentProjectId: p.id, opportunityId: opp.id, source: "manual", amount: 1500, currency: "EUR" }), (e) => e.code === "REVENUE_ATTRIBUTION_REQUIRED");
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "revenue_received", contentProjectId: p.id, source: "fixture", attribution: "UNATTRIBUTED", amount: 1500, currency: "EUR" }), (e) => e.code === "REVENUE_SOURCE");
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "revenue_received", contentProjectId: p.id, source: "manual", attribution: "UNATTRIBUTED", amount: 0, currency: "EUR" }), /sumă pozitivă/);
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "manual", amount: 5, currency: "EUR" }), /nu are sumă/);
  assert.throws(() => s.campaigns.recordFunnelEvent({ kind: "lead", contentProjectId: p.id, source: "manual", opportunityId: "opp_missing" }), (e) => e.category === "not_found");
  const rev = s.campaigns.recordFunnelEvent({ kind: "revenue_received", contentProjectId: p.id, opportunityId: opp.id, source: "manual", attribution: "SELF_REPORTED", evidence: [{ kind: "client_statement", ref: "Clientul a spus că a văzut clipul" }], amount: 1500, currency: "eur" });
  assert.equal(rev.currency, "EUR");
  s.campaigns.recordFunnelEvent({ kind: "revenue_received", contentProjectId: p.id, source: "import", attribution: "UNATTRIBUTED", amount: 500, currency: "EUR" });
  s.campaigns.recordFunnelEvent({ kind: "click", contentProjectId: p.id, source: "fixture" });
  f = s.campaigns.funnel(p.id);
  assert.equal(f.counts.click, 4, "fixture events stay out of real counts");
  assert.equal(f.fixtureEvents, 1);
  assert.equal(f.rates.leadPerClick.value, 0.25);
  assert.equal(f.rates.leadPerClick.denominator, 4);
  assert.equal(f.revenue.EUR.total, 2000);
  assert.equal(f.revenue.EUR.byAttribution.SELF_REPORTED, 1500);
  assert.equal(f.revenue.EUR.byAttribution.UNATTRIBUTED, 500);
  assert.equal(f.revenue.EUR.byAttribution.DIRECT_TRACKED_LINK, 0, "no invented attribution");
  assert.equal(f.byAttribution.UNATTRIBUTED.lead, 1);
  assert.equal(s.campaigns.listFunnelEvents({ opportunityId: opp.id }).length, 1);
});

test("M09-CT-10 campaigns: create, transitions, calendar validation, attach projects; budget is a record only", (t) => {
  const s = setup(); t.after(() => s.env.cleanup());
  const p = s.content.createProject({ title: "Clip campanie" });
  assert.throws(() => s.campaigns.saveCampaign({ name: "ab" }), /minimum 3/);
  assert.throws(() => s.campaigns.saveCampaign({ name: "Toamnă", calendar: [{ date: "25.10.2026" }] }), /AAAA-LL-ZZ/);
  assert.throws(() => s.campaigns.saveCampaign({ name: "Toamnă", cta: { text: "Scrie-ne", url: "http://ifrim.example" } }), /https/);
  assert.throws(() => s.campaigns.saveCampaign({ name: "Toamnă", status: "ACTIVE" }), /DRAFT/);
  const c = s.campaigns.saveCampaign({ name: "Campanie toamnă", objective: "Cereri de ofertă", calendar: [{ date: "2026-11-02", contentProjectId: p.id }, { date: "2026-10-28", note: "teaser" }], budget: { approved: 200, currency: "ron" }, cta: { text: "Cere o ofertă", url: "https://ifrim.example/oferta" } });
  assert.equal(c.status, "DRAFT");
  assert.deepEqual(c.calendar.map((e) => e.date), ["2026-10-28", "2026-11-02"]);
  assert.equal(c.budget.currency, "RON");
  assert.match(c.budget.note, /nu cheltuie/);
  const active = s.campaigns.saveCampaign({ id: c.id, status: "ACTIVE", expectedVersion: c.version });
  assert.equal(active.status, "ACTIVE");
  assert.throws(() => s.campaigns.saveCampaign({ id: c.id, status: "DRAFT" }), /nepermisă/);
  assert.throws(() => s.campaigns.saveCampaign({ id: c.id, name: "Alt nume", expectedVersion: c.version }), (e) => e.code === "STALE_VERSION");
  assert.equal(s.campaigns.attachProject({ campaignId: c.id, contentProjectId: p.id }).already, false);
  assert.equal(s.content.getProject(p.id).campaignId, c.id);
  assert.equal(s.content.board({ campaignId: c.id }).columns[0].cards.length, 1);
  s.campaigns.saveCampaign({ id: c.id, status: "CLOSED" });
  assert.throws(() => s.campaigns.saveCampaign({ id: c.id, name: "Redeschisă" }), /închisă/);
});
