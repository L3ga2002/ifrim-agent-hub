// Milestone 09 — Lega & decisions for the Content Studio (PASS_SIMULATED: software authenticator, fixture providers, no model, no
// ffmpeg). Studio phrases resolve before the catch-all intents; a spoken correction is a PROPOSAL on the current edit version with
// the provenance of its source (never applied by a sentence); "publică" is refused; the MEDIA_A → MEDIA_B → MEDIA_C packages wait
// for each other, record how they were decided, apply only MB1 (live capture policy, with a fail-safe off from any channel) and
// never apply an external option; the league credits only skills a run actually received; the composer never sends Claude without
// a model; the phone shows clips read-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, tempDir } from "./helpers.mjs";
import { resolveIntent, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { insertEditVersion } from "../server/media/review.mjs";
import { PACKAGE_KINDS, MEDIA_AI_BUDGET } from "../server/intel/packages.mjs";
import { createLeague } from "../server/intel/league.mjs";
import { PRESETS } from "../server/media/visual-bible.mjs";
import { LEGA_SCREENS, legaDynamicTools, LEGA_RUN_EFFORTS } from "../server/policy/lega-policy.mjs";
import { composerOptions, runRequestBody, shadowReviewBody, claudeRunModel } from "../web/src/lib/uiLogic.js";
import { intelLines, replyFor } from "../web/src/lib/cockpitLogic.js";
import { latestPackages, PACKAGE_ORDER, packageLabel } from "../web/src/lib/intelLogic.js";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra }).then((r) => r.result);
const runsCount = (hub) => hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;

/** A content project with ONE edit plan whose current version shows a text between frames 300 and 450 (10–15 s at 30 fps). */
function seedClip(hub, title = "Demo checkout") {
  const project = hub.media.content.createProject({ title, platforms: ["youtube"] }, "test");
  const at = new Date().toISOString();
  const editId = `mep_test_${Math.random().toString(36).slice(2, 10)}`;
  hub.bus.transaction(() => hub.db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, 'test', ?, ?)")
    .run(editId, project.id, `Montaj ${title}`, at, at));
  const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1920, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_fake_1", sourceIn: 0, sourceOut: 900, start: 0, speed: 1, fit: "cover" }] },
      { id: "t1", kind: "text", items: [{ id: "x1", start: 300, end: 450, text: "Butonul de plată", style: "title", anchor: "top", x: 0.5, y: 0.6, maxWidth: 0.86 }] },
    ],
    markers: [], evidenceRegions: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title, labels: [] } };
  const version = insertEditVersion(hub.db, hub.bus, () => new Date(), { editProjectId: editId, ir, changeKind: "initial", change: { reason: "test" }, validation: { ok: true }, actor: "test" });
  return { project, editId, version };
}

test("M09-LG-01 resolver: studio phrases win over the catch-alls; effects never add authority; the time is never guessed; document text is inert", () => {
  const ctx = { projects: [{ id: "p1", name: "ProDelivery", slug: "prodelivery" }] };
  const one = (s, extra = {}) => resolveIntent(s, { ...ctx, ...extra }).steps[0];
  assert.equal(one("Deschide studioul").intent, "studio_open");
  assert.equal(one("Du-mă la studio").intent, "studio_open");
  assert.equal(one("Studioul").intent, "studio_open");
  // "Arată-mi clipul" is NOT a project named „clipul” (open_project is the catch-all) and "preview-ul clipului" is not the factory preview.
  assert.equal(one("Arată-mi clipul").intent, "studio_show_clip");
  assert.notEqual(one("Arată-mi clipul").intent, "open_project");
  assert.equal(one("Arată-mi clipul despre checkout").args.clipRef, "checkout");
  assert.equal(one("Preview-ul clipului").intent, "studio_show_clip");
  assert.equal(one("Arată-mi preview-ul").intent, "show_preview", "the factory preview keeps its meaning");
  assert.equal(one("Deschide ProDelivery").intent, "open_project", "a real project still opens");
  const edit = one("La secunda 12 textul acoperă butonul, mută-l mai sus");
  assert.equal(edit.intent, "studio_edit"); assert.equal(edit.effect, "plan");
  assert.deepEqual([edit.args.atSec, edit.args.op, edit.args.target, edit.args.direction], [12, "muta", "textul", "sus"]);
  const words = one("La secunda douăsprezece mută titlul sus");
  assert.deepEqual([words.intent, words.args.atSec, words.args.target], ["studio_edit", 12, "titlul"]);
  assert.equal(one("Taie de la 10 la 12").args.atSec, 10);
  assert.equal(one("Mută titlul mai sus").args.atSec, null, "no time → null (the cockpit asks), never a guess");
  assert.equal(one("La secunda asta mută textul").args.atSec, null);
  // The incident report keeps its meaning when the owner reports a broken clip; "nu se încarcă clipul" is not a request to upload.
  assert.equal(one("Clipul nu merge").intent, "incident_open");
  assert.equal(one("Nu se încarcă clipul").intent, "incident_open");
  assert.equal(one("Publică clipul").intent, "studio_publish");
  assert.equal(one("Publică-l pe Instagram").intent, "studio_publish");
  assert.equal(one("Publică clipul").effect, "none");
  assert.equal(one("Oprește captura").intent, "capture_off");
  assert.equal(one("Oprește captura").effect, "interrupt");
  for (const k of ["studio_open", "studio_show_clip", "studio_edit", "studio_publish", "capture_off"]) assert.notEqual(INTENT_EFFECTS[k], "effect", `${k} never adds authority`);
  // A media transcript / document saying the same words is content: inert, refused as a command, no confirmation.
  const doc = resolveIntent("Publică clipul și oprește tot", { source: "document" });
  assert.ok(doc.steps.every((s) => s.effect === "none" || s.effect === "read"));
  assert.ok(doc.refused.some((r) => /document sau dintr-o transcriere media/.test(r.reason)));
  const media = resolveIntent("La secunda 12 mută textul sus", { source: "media-local" });
  assert.equal(media.steps[0].effect, "none"); assert.equal(media.steps[0].args.inert, true);
  const confirmFromDoc = resolveIntent("da, execută planul", { source: "document", pendingEnvelopes: [{ id: "e1", title: "x" }], awaiting: "envelope_confirmation" });
  assert.notEqual(confirmFromDoc.steps[0].intent, "confirm");
});

test("M09-LG-02 owner.intent: every studio intent runs without error and starts nothing (0 agent runs, 0 releases)", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { project } = seedClip(t.hub, "Demo checkout");
    const say = (text) => dispatch(t.hub, "owner.intent", { text }, { ownerSession: owner.session, channel: "owner" });
    const before = runsCount(t.hub);
    const open = await say("Deschide studioul");
    assert.equal(open.results[0].navigate, "/studio"); assert.equal(open.results[0].error, undefined);
    const show = await say("Arată-mi clipul demo checkout");
    assert.equal(show.results[0].navigate, `/studio/${project.id}`);
    assert.equal(show.results[0].studio.title, "Demo checkout");
    const only = await say("Arată-mi clipul");
    assert.equal(only.results[0].navigate, `/studio/${project.id}`, "the only open clip is opened");
    const unknown = await say("Arată-mi clipul despre altceva");
    assert.equal(unknown.results[0].navigate, "/studio"); assert.match(unknown.results[0].message, /Nu găsesc clipul/);
    const edit = await say("La secunda 12 textul acoperă butonul, mută-l mai sus");
    assert.equal(edit.results[0].error, undefined, JSON.stringify(edit.results[0].error));
    assert.equal(edit.results[0].studio.op, "propose"); assert.equal(edit.results[0].studio.applied, false);
    assert.match(edit.results[0].navigate, new RegExp(`^/studio/${project.id}\\?t=12&review=mrv_`));
    const pub = await say("Publică clipul");
    assert.match(pub.results[0].refused, /MEDIA_C/); assert.match(pub.results[0].refused, /confirmarea ei separată/);
    assert.equal(pub.results[0].effect, "none");
    const off = await say("Oprește captura");
    assert.equal(off.results[0].interrupt.liveCapture, false);
    assert.equal(runsCount(t.hub), before, "no agent run started");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0, "nothing released");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM content_manifests").get().n, 0);
    // The cockpit's reply is built from the result: a proposal is never described as applied; the publish refusal is spoken.
    assert.match(intelLines(edit.results[0]).join(" "), /Am propus o corectură la 12 s pe „Demo checkout” \(v1\).*Nu am aplicat nimic/);
    assert.match(replyFor(pub), /MEDIA_C/);
  } finally { await t.cleanup(); }
});

test("M09-LG-03 a spoken correction (voice-provider, filter off) is proposed on the CURRENT version with its provenance and never applied; no time / two clips → a question", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { project, editId, version } = seedClip(t.hub, "Demo checkout");
    const versions = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_edit_versions WHERE edit_project_id = ?").get(editId).n;
    assert.equal(t.hub.voice.status().gate.enabled, false, "the local voice filter is off in this test");
    // GPT-Live transcript on the owner channel (the cookie is there): still a provider transcript.
    const viaCockpit = await dispatch(t.hub, "owner.intent", { text: "La secunda 12 textul acoperă butonul, mută-l mai sus", source: "voice-provider" }, { ownerSession: owner.session, channel: "owner" });
    const s = viaCockpit.results[0].studio;
    assert.equal(s.provenance, "voice-provider"); assert.equal(s.voiceFilterOff, true); assert.equal(s.editVersionId, version.id); assert.equal(s.version, 1);
    assert.match(viaCockpit.results[0].note, /Filtrul vocal e oprit/);
    const row = t.hub.db.prepare("SELECT * FROM media_reviews WHERE id = ?").get(s.reviewId);
    assert.equal(row.status, "OPEN"); assert.equal(row.provenance, "voice-provider"); assert.equal(row.timecode_ms, 12000); assert.equal(row.edit_version_id, version.id);
    assert.equal(versions(), 1, "nothing applied: still only the original version");
    // The voice route itself.
    const viaVoice = await t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "lega", payload: { text: "La secunda 12 mută textul mai sus" } }).then((r) => r.result);
    assert.equal(viaVoice.results[0].studio.provenance, "voice-provider");
    assert.equal(versions(), 1);
    // Applying is the owner's separate action and is refused on the voice route.
    await assert.rejects(t.hub.commands.dispatch({ type: "media.edit.patch.apply", channel: "voice", actor: "lega", payload: { reviewId: s.reviewId } }), /cannot be issued through voice/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_reviews WHERE status = 'APPLIED'").get().n, 0);
    // Typed by the owner: owner-typed provenance.
    const typed = await dispatch(t.hub, "owner.intent", { text: "La secunda 12 mută textul mai sus" }, { ownerSession: owner.session, channel: "owner" });
    assert.equal(typed.results[0].studio.provenance, "owner-typed");
    // No time → a question, no review row.
    const reviews = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_reviews").get().n;
    const n = reviews();
    const noTime = await dispatch(t.hub, "owner.intent", { text: "Mută titlul mai sus" }, { ownerSession: owner.session, channel: "owner" });
    assert.match(noTime.results[0].message, /La ce secundă/); assert.equal(reviews(), n);
    // Two open clips and no reference: a conversation with no last target asks which one (nothing proposed) …
    seedClip(t.hub, "Alt clip de test");
    const two = await dispatch(t.hub, "owner.intent", { text: "La secunda 12 mută textul mai sus" }, { channel: "ui", actor: "user" });
    assert.match(two.results[0].message, /Pe care clip/); assert.equal(reviews(), n);
    // … while in the owner's conversation the clip last acted on is the target (M10.2 U10: the server-held last target, no question).
    const last = await dispatch(t.hub, "owner.intent", { text: "La secunda 12 mută textul mai sus" }, { ownerSession: owner.session, channel: "owner" });
    assert.equal(last.results[0].studio?.contentProjectId, project.id, JSON.stringify(last.results[0])); assert.equal(reviews(), n + 1);
    // A reference picks it.
    const named = await dispatch(t.hub, "owner.intent", { text: "La secunda 12 în clipul demo checkout mută textul mai sus" }, { ownerSession: owner.session, channel: "owner" });
    assert.equal(named.results[0].studio?.contentProjectId, project.id, JSON.stringify(named.results[0]));
  } finally { await t.cleanup(); }
});

test("M09-LG-04 MEDIA packages: A → B → C; fresh owner session; how the decision was taken is recorded; MB1 sets live capture, capture_off from the voice channel; MB2 records a budget; MEDIA_C is never applied", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const fonts = tempDir("fonts");
    for (const p of Object.values(PRESETS)) for (const f of Object.values(p.fonts)) fs.writeFileSync(path.join(fonts, f.file), "");
    t.hub.packages.useFontsDir(fonts);
    // ffmpeg/ffprobe: a verification since boot that matches the pins (the tools themselves are not run in this test).
    const sha = (c) => c.repeat(64);
    t.hub.bus.transaction(() => t.hub.settings.set("mediaToolPins", { ffmpeg: { path: "C:/ff/ffmpeg.exe", version: "7.1", sha256: sha("a") }, ffprobe: { path: "C:/ff/ffprobe.exe", version: "7.1", sha256: sha("b") } }, "test"));
    const resolved = { ok: true, problems: [], ffmpeg: { path: "C:/ff/ffmpeg.exe", version: "7.1", sha256: sha("a") }, ffprobe: { path: "C:/ff/ffprobe.exe", version: "7.1", sha256: sha("b") } };
    t.hub.media.tools.lastResolved = () => resolved;
    t.hub.media.tools.resolve = async () => resolved;
    assert.deepEqual([...PACKAGE_KINDS], ["A", "B", "MEDIA_A", "MEDIA_B", "MEDIA_C"]);
    const spec = t.hub.commands.catalog().find((c) => c.type === "package.present");
    assert.deepEqual([...spec.schema.kind.enum], [...PACKAGE_KINDS]);
    const ma = await dispatch(t.hub, "package.present", { kind: "MEDIA_A" });
    assert.equal(ma.title, "Studio: instalări și mediu");
    assert.deepEqual(ma.options.map((o) => o.key), ["MA1", "MA2", "MA3"]);
    assert.equal(ma.options.find((o) => o.key === "MA1").executed, true, "MA1 is read from the pins + the verification");
    assert.equal(ma.options.find((o) => o.key === "MA2").executed, null, "OBS cannot be verified without connecting");
    assert.equal(ma.options.find((o) => o.key === "MA3").executed, true, "fonts read from disk");
    const mb = await dispatch(t.hub, "package.present", { kind: "MEDIA_B" });
    assert.ok(mb.blockedBy.length > 0, "MEDIA_B waits for MEDIA_A");
    await assert.rejects(dispatch(t.hub, "package.decide", { packageId: mb.id, decisions: { MB1: "approve" } }, { ownerSession: owner.reauth() }), /MEDIA_A/);
    assert.equal(t.hub.settings.get("mediaPolicy").liveCapture, false);
    // No session → refused; the voice route cannot decide at all.
    await assert.rejects(dispatch(t.hub, "package.decide", { packageId: ma.id, decisions: { MA1: "approve" } }), /sesiunea/);
    await assert.rejects(t.hub.commands.dispatch({ type: "package.decide", channel: "voice", actor: "lega", payload: { packageId: ma.id, decisions: { MA1: "approve" } } }), /cannot be issued through voice/);
    const da = await dispatch(t.hub, "package.decide", { packageId: ma.id, decisions: { MA1: "approve", MA2: "approve", MA3: "approve" } }, { ownerSession: owner.reauth() });
    assert.deepEqual(da.package.options.map((o) => o.state), ["EXECUTED", "APPROVED", "EXECUTED"]);
    assert.equal(da.package.status, "DECIDED");
    const rec = JSON.parse(t.hub.db.prepare("SELECT decisions_json FROM decision_packages WHERE id = ?").get(ma.id).decisions_json).MA1;
    assert.equal(rec.via, "owner_session"); assert.equal(rec.modality, "click"); assert.equal(rec.sessionId, owner.session.id);
    assert.ok(rec.credential && rec.credential.length <= 10, "credential prefix only");
    // MEDIA_C waits for MEDIA_B.
    const mc = await dispatch(t.hub, "package.present", { kind: "MEDIA_C" });
    assert.deepEqual(mc.options.map((o) => o.key), ["MC1", "MC2", "MC3", "MC4", "MC5"]);
    assert.ok(mc.options.every((o) => o.external === true && o.executed === null));
    assert.ok(mc.blockedBy.length > 0);
    assert.match(mc.options.find((o) => o.key === "MC4").limits.join(" "), /COST_BLOCKED/);
    // MEDIA_B now decidable: MB1 turns live capture on (owner session), MB2 records the budget and starts nothing.
    const runsBefore = runsCount(t.hub);
    const db = await dispatch(t.hub, "package.decide", { packageId: mb.id, decisions: { MB1: "approve", MB2: "approve" } }, { ownerSession: owner.reauth() });
    assert.ok(db.applied.includes("MB1"));
    assert.equal(t.hub.settings.get("mediaPolicy").liveCapture, true);
    assert.equal(t.hub.settings.get("mediaPolicy").liveCaptureDecision.via, "owner_session");
    const mbDec = JSON.parse(t.hub.db.prepare("SELECT decisions_json FROM decision_packages WHERE id = ?").get(mb.id).decisions_json);
    assert.deepEqual(mbDec.MB2.budget, JSON.parse(JSON.stringify(MEDIA_AI_BUDGET)));
    assert.equal(runsCount(t.hub), runsBefore, "a budget decision starts no run");
    assert.equal(db.package.options.find((o) => o.key === "MB2").state, "APPROVED", "a decision only: never 'executed'");
    // Fail-safe off from the voice channel (and the MB1 state follows reality).
    const off = await t.hub.commands.dispatch({ type: "media.policy.capture_off", channel: "voice", actor: "lega", payload: { reason: "test" } }).then((r) => r.result);
    assert.equal(off.liveCapture, false); assert.equal(off.wasOn, true);
    assert.equal(t.hub.settings.get("mediaPolicy").liveCapture, false);
    assert.equal(t.hub.packages.view(mb.id).options.find((o) => o.key === "MB1").state, "APPROVED_PENDING_EXECUTION");
    // MEDIA_C: decided only after MEDIA_B; external options are recorded, never applied, never executed.
    assert.equal(t.hub.packages.view(mc.id).blockedBy.length, 0, "MEDIA_B decided (capture off does not re-block accounts)");
    const dc = await dispatch(t.hub, "package.decide", { packageId: mc.id, decisions: { MC1: "approve", MC4: "reject" } }, { ownerSession: owner.reauth() });
    assert.deepEqual(dc.applied, []);
    assert.equal(dc.package.options.find((o) => o.key === "MC1").state, "APPROVED");
    assert.equal(dc.package.options.find((o) => o.key === "MC1").executed, null);
    assert.equal(t.hub.settings.get("mediaPolicy").liveUpload, false);
    assert.equal(t.hub.settings.get("mediaPolicy").autoPublish, false);
    assert.equal(JSON.parse(t.hub.db.prepare("SELECT decisions_json FROM decision_packages WHERE id = ?").get(mc.id).decisions_json).MC1.external, true);
    // Lega lists every kind waiting for a decision.
    const dec = await dispatch(t.hub, "owner.intent", { text: "Ce decizii am?" }, { ownerSession: owner.session, channel: "owner" });
    assert.ok(dec.results[0].packages.some((p) => p.kind === "MEDIA_C"), JSON.stringify(dec.results[0].packages));
    // The Decisions tab renders every kind in order (titles from the Hub, not hard-coded).
    const rows = latestPackages(t.hub.packages.list());
    assert.deepEqual(rows.map((r) => r.kind), [...PACKAGE_ORDER]);
    assert.equal(rows.find((r) => r.kind === "MEDIA_B").pkg.title, "Studio: captură live și producție AI limitată");
    assert.equal(packageLabel("MEDIA_C"), "MEDIA C");
  } finally { await t.cleanup(); }
});

test("M09-LG-05 MEDIA_A executed follows reality: no verification or an empty fonts folder → not executed; a changed binary → not executed", async () => {
  const t = await makeTestHub();
  try {
    t.hub.packages.useFontsDir(tempDir("nofonts"));
    t.hub.media.tools.lastResolved = () => null;
    const inv = t.hub.packages.inventoryMediaA();
    assert.equal(inv.toolsOk, false); assert.equal(inv.fontsOk, false);
    assert.ok(inv.fonts.every((f) => f.missing.length > 0));
    const sha = "c".repeat(64);
    t.hub.bus.transaction(() => t.hub.settings.set("mediaToolPins", { ffmpeg: { version: "7.1", sha256: sha, changedAt: new Date().toISOString(), acknowledged: false }, ffprobe: { version: "7.1", sha256: sha } }, "test"));
    t.hub.media.tools.lastResolved = () => ({ ok: true, problems: ["tool_changed"], ffmpeg: { sha256: sha, version: "7.1" }, ffprobe: { sha256: sha, version: "7.1" } });
    assert.equal(t.hub.packages.inventoryMediaA().toolsOk, false, "an unacknowledged change is never executed");
  } finally { await t.cleanup(); }
});

test("M09-LG-06 league: an outcome is credited only to skills the run actually received (usage rows; a pre-M09 run without usage rows is not attributed)", () => {
  const runs = [
    { id: "r1", status: "completed", skill_versions_json: JSON.stringify([{ id: "alpha", version: 1 }, { id: "beta", version: 2 }]) },
    { id: "r2", status: "failed", error_category: "task", skill_versions_json: JSON.stringify([{ id: "alpha", version: 1 }, { id: "beta", version: 2 }]) },
    { id: "r3", status: "completed", skill_versions_json: JSON.stringify([{ id: "gamma", version: 1 }, { id: "delta", version: 1, applied: false }]) },
  ].map((r) => ({ provider: "codex", model: "gpt-x", effort: "medium", started_at: null, finished_at: null, usage_json: "{}", environment: "windows", stage: "IMPLEMENTING", mission_id: `m_${r.id}`,
    work_type: "bugfix", repair_cycles: 0, mission_stage: "DELIVERY_READY", project_source: "registry", error_category: null, ...r }));
  const usage = [
    { run_id: "r1", skill_id: "alpha", version: 1, applied: 1 }, { run_id: "r1", skill_id: "beta", version: 2, applied: 0 },
    { run_id: "r2", skill_id: "alpha", version: 1, applied: 0 }, { run_id: "r2", skill_id: "beta", version: 2, applied: 0 },
  ];
  const db = { prepare: (sql) => ({ all: () => (/FROM agent_runs/.test(sql) ? runs : /FROM run_skill_usage/.test(sql) ? usage : []) }) };
  const report = createLeague({ db, config: {} }).report({});
  const skills = Object.fromEntries(report.skills.map((s) => [s.skill, s]));
  assert.deepEqual(Object.keys(skills).sort(), ["alpha"], "beta (never injected), gamma/delta (pre-M09: listed, not injected) collect nothing");
  assert.equal(skills.alpha.runs, 1); assert.equal(skills.alpha.completed, 1); assert.equal(skills.alpha.failedNonInfra, 0, "r2's failure is not alpha's: it was not applied there");
  assert.equal(skills.alpha.evidenceSource, "usage");
  assert.equal(report.skillAttribution.runsWithoutUsageEvidence, 1, "r3 is counted as unattributed, not credited");
});

test("M09-LG-07 composer and Lega: a Claude run always names its model; a shadow review too; Lega can propose an explicit model + effort; the Studio screen is navigable", () => {
  const claude = composerOptions({ provider: "claude", model: "" });
  assert.equal(claude.model, "sonnet"); assert.equal(claude.modelRequired, true);
  assert.equal(composerOptions({ provider: "claude", model: "opus" }).model, "opus");
  assert.equal(composerOptions({ provider: "claude", model: "fable" }).model, "sonnet", "a refused/unknown alias is never sent");
  assert.equal(composerOptions({ provider: "codex", model: "" }).model, "", "Codex: empty = account default pinned at start");
  assert.equal(runRequestBody({ provider: "claude", access: "read-only", model: "" }).model, "sonnet");
  assert.deepEqual(runRequestBody({ provider: "codex", access: "read-only", model: "", effort: "high", taskId: "tsk_1" }), { provider: "codex", access: "read-only", effort: "high", taskId: "tsk_1" });
  assert.equal(shadowReviewBody({ provider: "claude" }).model, "sonnet");
  assert.equal(claudeRunModel("haiku"), "haiku");
  assert.equal(LEGA_SCREENS.studio, "/studio");
  const tools = legaDynamicTools({ projects: [{ name: "Hub" }], allProjects: [{ name: "Hub" }] })[0].tools;
  const run = tools.find((x) => x.name === "propose_run").inputSchema;
  assert.ok(run.properties.model && run.properties.effort);
  assert.deepEqual(run.properties.effort.enum, [...LEGA_RUN_EFFORTS]);
  assert.deepEqual(run.required, ["project", "provider", "task"]);
  assert.ok(tools.find((x) => x.name === "navigate").inputSchema.properties.screen.enum.includes("studio"));
});

test("M09-LG-08 phone: clips in production/review are listed read-only (title, stage, open corrections, on the PC); no new permission or command", async () => {
  const t = await makeTestHub();
  try {
    const { project } = seedClip(t.hub, "Clip pentru telefon");
    t.hub.bus.transaction(() => t.hub.db.prepare("UPDATE content_projects SET stage = 'REVIEW' WHERE id = ?").run(project.id));
    const owner = await enrolOwner(t);
    await dispatch(t.hub, "owner.intent", { text: "La secunda 12 mută textul mai sus" }, { ownerSession: owner.session, channel: "owner" });
    const st = t.hub.devices.mobileState();
    assert.equal(st.content.length, 1);
    assert.deepEqual([st.content[0].title, st.content[0].stage, st.content[0].openReviews, st.content[0].where], ["Clip pentru telefon", "REVIEW", 1, "pe PC, în sesiunea ta"]);
    assert.deepEqual([...st.permissions].sort(), ["pause_mission", "stop_all", "stop_mission", "view"], "permissions unchanged");
  } finally { await t.cleanup(); }
});
