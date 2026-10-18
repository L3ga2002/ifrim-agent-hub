// Milestone 10.2 — U16: end-to-end acceptance of the one-plan path, measured with the probe counters (U03) over the Hub's own logs
// (commands + events; never the browser). PASS_SIMULATED: the test Hub, fixture providers (fake app-server / fake Claude / fixture
// voice worker), a software authenticator and test projects — no model, no network, nothing on the live Hub.
//
//  A. promo video by voice on an empty library → the honest blocker ONCE, the request kept; import by a named folder with ONE
//     confirmation plus the folder step-up; the import re-plans the kept request into ONE content plan built only from the existing
//     Studio executors (owner decision 5: nothing generated); ONE confirmation → draft render + automated QA.
//  B. an engineering request (Lega's request_work) on a hub-test project → ONE draft + ONE envelope; ONE click runs writer, checks,
//     review, one repair cycle inside the shown limit (decision 6), QA, preview and E2E to DELIVERY_READY; BUILD_SAFE throughout (D2).
//  C. a request on the Hub's own project → the honest one-time explanation (factory refuses the Hub, R2 options; decision 10), the
//     request kept, no plan, no pointer at an old-flow target.
//  D. armed spoken confirmation on a TRUSTED hub-test project with the (global, decision 8) local voice gate on → 0 clicks.
//  E. pause → typed „Continuă” (decision 13) → expiry → a continuation plan of only what remains → ONE confirmation → delivery.
//  F. negative control: the legacy policy still takes the old path, and the same counters see it (grant prep, old-flow arrows).
//
// Every one-plan flow asserts: no grant.create on ui, no mode.set, no approval.decide(ui) and 0 Lega pointers at old-flow targets.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, enableLive, waitFor, tempDir, HUB_ROOT } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { enrolVoice, speak, startDerivedLega } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { NEVER_IN_PLANS } from "../server/ops/plans.mjs";
import { BUNDLE_FILE } from "../server/media/project-bundle.mjs";
import { PILOT_MODELS } from "../server/intel/packages.mjs";
import { OLD_FLOW_TARGETS, PROBE_COUNTERS } from "../server/owner/probe.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { browserStatus } from "../server/tools/browser.mjs";

const launchers = realLaunchers();
const needTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const calls = (list) => `lega-calls:${b64(list)}`;
const script = (list) => `lega-script:${b64(list)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, type, payload, session = owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const intent = (t, owner, payload, session = owner.session) => asOwner(t, owner, "owner.intent", { source: "typed", ...payload }, session);
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT seq, payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ seq: e.seq, ...JSON.parse(e.payload_json || "{}") }));
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const liveEvents = (hub) => { const out = []; hub.live.subscribe((e) => out.push(e)); return out; };
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 120000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "CANCELLED"];
const OLD_FLOW_TEXT = /LIVE_VALIDATION|OPEN GATE|Creează grant|live_grant|mode \(BUILD_SAFE/;
const PROMO = "Fă un videoclip de promovare de 30 de secunde";
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };

function consent(hub) {
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.refreshCodexConfig();
}
/** The probe report of a flow's window (marker → now), read the way GET /api/owner/probe reads it. */
const probe = (t, m0) => t.hub.probe.report({ sinceSeq: m0 });
/** Settings writes of the Hub mode inside the window (the plan must never touch it: D2, envelope-scoped live authority). */
const modeWrites = (t, m0) => count(t, "SELECT COUNT(*) AS n FROM events WHERE seq > ? AND type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'", m0);

/**
 * The invariants every one-plan flow shares, from the server logs only: no manual grant, no manual mode change or gate opening, no
 * old approval card clicked or Approvals screen entered, no Lega arrow at an old-flow target, no developer acting on the Hub, and the
 * Hub left in BUILD_SAFE without a single mode write. `expect` pins the flow's exact counters (U03 names).
 */
function assertOnePlanPath(t, m0, expect, label) {
  const r = probe(t, m0);
  const evidence = JSON.stringify(r.evidence);
  for (const k of ["grantFormsOpened", "manualGrantCreates", "manualModeChanges", "approvalsNavigations", "legaOldFlowPointers", "developerInterventions"]) {
    assert.equal(r.counters[k], 0, `${label}: ${k} = ${r.counters[k]} (${evidence})`);
  }
  for (const [k, v] of Object.entries(expect)) {
    if (typeof v === "number") assert.equal(r.counters[k], v, `${label}: ${k} = ${r.counters[k]}, expected ${v} (${JSON.stringify(r.evidence[k])})`);
    else assert.ok(v(r.counters[k]), `${label}: ${k} = ${r.counters[k]} (${JSON.stringify(r.evidence[k])})`);
  }
  assert.deepEqual(r.settings.drift, [], `${label}: no out-of-band settings write`);
  // The same facts straight from the tables (independent of the probe's own filters).
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'grant.create' AND channel IN ('ui','agent')"), 0, `${label}: grant.create on ui`);
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'mode.set'"), 0, `${label}: mode.set`);
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, `${label}: gate.set (typed OPEN GATE)`);
  assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'approval.decide' AND channel = 'ui'"), 0, `${label}: approval.decide(ui)`);
  const old = new Set(OLD_FLOW_TARGETS);
  assert.equal(events(t, "lega.pointed").filter((e) => e.seq > m0 && old.has(e.target)).length, 0, `${label}: Lega arrows at old-flow targets`);
  assert.equal(events(t, "lega.grant_prepared").filter((e) => e.seq > m0).length, 0, `${label}: Lega grant preparation`);
  assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE", `${label}: the Hub stays in BUILD_SAFE`);
  assert.equal(modeWrites(t, m0), 0, `${label}: no mode write at all`);
  assert.deepEqual(Object.keys(r.counters), [...PROBE_COUNTERS]);
  return r;
}

// ---------------------------------------------------------------- Flow A (Content Studio)
const irOf = (assetVersionId, { frames = 60, content = "Un singur plan, o confirmare" } = {}) => ({
  irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 640, height: 360, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
  tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION" }] },
    { id: "t1", kind: "text", items: [{ id: "lbl", start: 0, end: frames, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
    { id: "t2", kind: "text", items: [{ id: "txt", start: 0, end: frames, text: content, style: "hook", anchor: "bottom", x: 0.5, y: 0.8 }] },
  ],
  markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Clip test", labels: ["SIMULATION"], author: "test", notes: "" } });

/** An exported Studio project (made on ANOTHER test Hub), so the Hub under test starts with an empty library. */
async function exportedBundle(base, received) {
  const src = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const so = await enrolOwner(src);
    const as = (type, payload) => dispatch(src.hub, type, payload, { actor: "owner:test", ownerSession: so.session }).then((r) => r.result);
    // The exporting Hub approves its own folders (the export target included); the Hub under test does not know them.
    setPolicy(src, { importRoots: [path.join(base, "src"), path.dirname(received)], diskReserveGb: 0, interactivePriority: false });
    const inbox = path.join(base, "src", "inbox");
    makeSyntheticMedia(inbox, { name: "demo.mp4", seconds: 2, width: 640, height: 360 });
    const project = await as("content.project.create", { fields: { title: "Promo Hub", format: "short", platforms: ["linkedin"] } });
    const pid = project.id || project.project?.id;
    const a = await as("media.asset.import", { sourcePath: path.join(inbox, "demo.mp4"), title: "Captură demo", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
    await as("media.rights.record", { right: { assetId: a.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test" } });
    await as("media.edit.create", { contentProjectId: pid, title: "Montaj", ir: irOf(a.version.id) });
    await as("media.project.export", { contentProjectId: pid, dir: received });
  } finally { await src.cleanup(); }
  assert.ok(fs.existsSync(path.join(received, BUNDLE_FILE)), "the bundle exists");
}

test("M10.2-E2E-A promo by voice on an empty library → blocked once, kept; folder import (ONE confirmation + step-up) → re-plan → ONE content plan → draft render + QA", { skip: needTools }, async () => {
  const base = tempDir("u16-a");
  const videos = path.join(base, "Videos");
  const received = path.join(base, "Downloads", "Pachet promo");
  await exportedBundle(base, received);
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await prepareLiveWithoutGrants(t.hub); // Lega's own preconditions (billing, isolation); the Studio plans need none of them
    fs.mkdirSync(videos, { recursive: true });
    setPolicy(t, { importRoots: [videos], diskReserveGb: 0, interactivePriority: false });
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM media_assets"), 0, "the library is empty");
    const live = liveEvents(t.hub);
    const m0 = t.hub.bus.lastSeq();

    // (1) The owner says it to Lega. The server voice bridge sends the final transcript to the intake: the Studio planner answers with
    //     the honest blocker (no material), the request is kept, and the Hub speaks its own words — once.
    t.queue("codex", script([{ sleep: 1500 }, { say: PROMO }, { sleep: 2500 }]));
    const lega = await startDerivedLega(t, owner);
    assert.equal(t.hub.lega.state().authority, "owner_session");
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((s) => /Biblioteca media e goală/.test(s)), 10000);
    const said = spoken(t).filter((s) => /Biblioteca media e goală/.test(s));
    assert.equal(said.length, 1, "the full explanation is spoken once");
    assert.doesNotMatch(said[0], OLD_FLOW_TEXT);
    assert.match(said[0], /MB1/);
    const actions = t.hub.lega.hubActions();
    assert.equal(actions.length, 1, JSON.stringify(actions));
    assert.equal(actions[0].outcome, "blocked");
    assert.deepEqual(actions[0].intents, ["studio_create"]);
    const wr = t.hub.db.prepare("SELECT * FROM work_requests").all();
    assert.equal(wr.length, 1, "one kept request");
    assert.equal(wr[0].intent, "studio");
    assert.equal(wr[0].channel, "voice");
    assert.equal(wr[0].status, "BLOCKED");
    assert.equal(wr[0].blocker_signature, "STUDIO_NO_MATERIAL");
    assert.equal(wr[0].id, actions[0].workRequestId);
    const wrId = wr[0].id;
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0, "a blocker proposes nothing");
    assert.equal(live.filter((e) => e.type === "lega.plan").length, 0);
    await t.hub.lega.stopAll("test");

    // (2) „Importă din Descărcări/Pachet promo” (typed in the cockpit): outside the import roots → ONE card with ONE folder decision.
    //     The session was opened an hour ago, so widening access asks for a fresh verification (the step-up), then ONE confirmation.
    t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE id = ?").run(new Date(Date.now() - 3600_000).toISOString(), owner.session.id);
    const card = (await intent(t, owner, { text: "Importă din Descărcări/Pachet promo" })).results[0];
    assert.equal(card.intent, "studio_import_folder");
    assert.ok(card.opsPlan, JSON.stringify(card));
    assert.deepEqual(card.opsPlan.decisions.map((d) => d.kind), ["folder.plan"]);
    const fresh = owner.reauth();
    const imported = await intent(t, owner, { text: "Da", presented: { planId: card.opsPlan.id, nonce: card.opsPlan.nonce, hash: card.opsPlan.hash } }, fresh);
    assert.ok(imported.results[0].confirmed, JSON.stringify(imported.results[0]));
    const importDone = await t.hub.opsPlans.idle(card.opsPlan.id);
    assert.equal(importDone.status, "DONE", `${importDone.statusReason} ${importDone.steps[0].error}`);
    assert.ok(!t.hub.media.importRoots().some((x) => x.toLowerCase().includes("pachet promo")), "the allowlist is never widened");

    // (3) The import clears the blocker: the kept request is re-planned automatically into ONE content plan (a proposal only), built
    //     from the existing executors on the imported clip — nothing generated, no model.
    await waitFor(() => t.hub.workRequests.get(wrId).status === "PLANNED", 30000);
    const kept = t.hub.workRequests.get(wrId);
    assert.equal(kept.planRef.kind, "ops");
    const plan = t.hub.opsPlans.view(kept.planRef.id);
    assert.equal(plan.status, "PROPOSED");
    assert.equal(plan.kind, "studio.create");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE kind = 'studio.create'"), 1, "ONE content plan");
    assert.ok(live.some((e) => e.type === "lega.plan" && e.data?.planRef?.id === plan.id), "announced as lega.plan");
    assert.equal(plan.summary.model, "fără model");
    assert.deepEqual(plan.body.never, [...NEVER_IN_PLANS]);
    assert.ok(plan.steps.length >= 1 && plan.steps.every((s) => ["media.tools.pin", "media.render", "media.variant.render", "export.local"].includes(s.kind)), JSON.stringify(plan.steps.map((s) => s.kind)));
    assert.ok(!plan.steps.some((s) => /model|run\.start|generate|plate/.test(s.kind)), "only existing executors (D5)");

    // (4) ONE confirmation → draft render + automated QA; creative review stays the owner's.
    const go = await intent(t, owner, { text: "Da", presented: { planId: plan.id, nonce: plan.nonce, hash: plan.hash } }, fresh);
    assert.ok(go.results[0].confirmed, JSON.stringify(go.results[0]));
    const done = await t.hub.opsPlans.idle(plan.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps.map((s) => s.error).join(" | ")}`);
    const render = done.steps.find((s) => s.kind === "media.render").result;
    assert.equal(done.steps.find((s) => s.kind === "media.render").params.profile, "draft");
    assert.ok(render.assetVersionId, "draft rendered");
    assert.ok(["PASS", "WARN", "FAIL"].includes(render.qa.status), "an automated QA result");
    assert.equal(render.review.creative, "CREATIVE_REVIEW_PENDING");

    // Exact counters for the flow: 2 scope confirmations (import + content plan), the folder step-up as the only extra authentication.
    assertOnePlanPath(t, m0, { scopeConfirmations: 2, extraAuthentications: (n) => n <= 1, clarifications: 0 }, "Flow A");
    assert.equal(probe(t, m0).counters.extraAuthentications, 1, "exactly the folder step-up");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "no model run");
    assert.equal(t.hub.grants.list().filter((g) => g.kind !== "voice").length, 0, "no grant (only Lega's own derived voice grant)");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no approval card of any kind");
    assert.equal(t.hub.lega.state()?.id === lega ? t.hub.lega.state().status : "ended", "ended");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- Flow B (engineering on a hub-test project)
test("M10.2-E2E-B engineering request by voice on a hub-test project → ONE click runs writer, checks, review, a repair, QA to DELIVERY_READY in BUILD_SAFE", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }]));
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    consent(t.hub);
    const live = liveEvents(t.hub);
    const modes = []; t.hub.bus.subscribe((e) => { if (e.type === "settings.changed" && (e.payload?.key || e.scopeId) === "mode") modes.push(e); });
    const m0 = t.hub.bus.lastSeq();

    // The owner asks Lega; the agent hands the request to the Hub (request_work) → the engineering planner: ONE draft + ONE envelope.
    t.queue("codex", calls([{ tool: "request_work", args: { request: BUG, kind_hint: "engineering", project: project.name } }]));
    const s = (await asOwner(t, owner, "lega.session.start", { sdp: OFFER }));
    await dispatch(t.hub, "lega.session.connected", { sessionId: s.sessionId }, { channel: "ui", actor: "user" });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
    const reply = replies(t).find((x) => x.tool === "request_work");
    assert.ok(reply?.ok, JSON.stringify(reply));
    assert.doesNotMatch(reply.text, OLD_FLOW_TEXT);
    await t.hub.lega.stopAll("test");
    const envRow = t.hub.db.prepare("SELECT id FROM mission_envelopes WHERE status = 'PROPOSED'").all();
    assert.equal(envRow.length, 1, "ONE envelope");
    const env = t.hub.envelopes.view(envRow[0].id);
    assert.equal(env.projectId, project.id);
    assert.ok(live.some((e) => e.type === "lega.plan" && e.id === env.id), "announced as lega.plan");
    const missionId = env.missionIds[0];
    assert.equal(view(t, missionId).factory.stage, "SPEC_DRAFT");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no lega.mission_request card (decision 1)");
    assert.match(env.body.models[missionId].writer, new RegExp(PILOT_MODELS.writer.model.replace(/\./g, "\\.")), "the role defaults, shown and hashed (D4)");
    assert.match(env.body.models[missionId].reviewer, /sonnet/);

    // ONE click (the cockpit's confirm button: owner channel, nonce + hash). The fixture review asks for one change, so the mission
    // goes through one repair cycle — pre-authorized by the limits shown on the card (decision 6): no second confirmation.
    t.queue("codex", "factory-write:bug-fix", "factory-write:bug-fix-v2");
    t.queue("claude", "review:changes-dedupe", "review:pass");
    const confirmed = await asOwner(t, owner, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, modality: "click" });
    assert.equal(confirmed.envelope.status, "ACTIVE");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const done = await untilStage(t, missionId, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 1, "one repair inside the limit");
    const [first, second] = done.reviews;
    assert.equal(first.verdict, "CHANGES_REQUESTED");
    assert.equal(second.verdict, "PASS");
    const stages = new Set(events(t, "factory.stage").filter((e) => e.seq > m0).map((e) => e.stage));
    for (const st of ["IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "DELIVERY_READY"]) assert.ok(stages.has(st), `stage ${st} visited (${[...stages].join(", ")})`);
    const derived = t.hub.grants.ofEnvelope(env.id);
    const runs = t.hub.db.prepare("SELECT provider, grant_id, model FROM agent_runs WHERE status <> 'blocked'").all();
    assert.ok(runs.length >= 4 && runs.every((x) => derived.some((g) => g.id === x.grant_id)), `every model step on the plan's own grants: ${JSON.stringify(runs)}`);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE decided_via = 'ui'"), 0);
    assert.equal(events(t, "envelope.delta_confirmed").length, 0, "no delta asked for the repair shown on the card");
    assert.equal(modes.length, 0, "BUILD_SAFE throughout (no mode write while the plan ran)");

    assertOnePlanPath(t, m0, { scopeConfirmations: 1, extraAuthentications: 0, clarifications: 0 }, "Flow B");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// Flow B, second half: preview and browser E2E. A spec built from the owner's words carries test criteria only (a browser path cannot be
// made up from a sentence), so the preview + E2E stages are exercised on Demo B, whose owner-written spec has them: the owner names the
// draft by voice („Pornește misiunea …”), ONE click, and the plan runs the checks' failure → repair → review → QA → preview → E2E.
test("M10.2-E2E-B2 Demo B by voice: ONE click runs a failing check → repair → review → QA → preview from the verified version → browser E2E → DELIVERY_READY, BUILD_SAFE", async (tc) => {
  const port = 46000 + Math.floor(Math.random() * 2500);
  // The repository's own Playwright install (no download): the factory's isolated Chromium drives the loopback preview.
  const t = await makeTestHub({ queues: true, configOverrides: { browserRoot: HUB_ROOT } });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-service-request");
    materializeFixture("service-request", dir, { port });
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("service-request", { port }), limits: M09_MODELS })).result;
    const modes = []; t.hub.bus.subscribe((e) => { if (e.type === "settings.changed" && (e.payload?.key || e.scopeId) === "mode") modes.push(e); });
    const m0 = t.hub.bus.lastSeq();
    t.queue("codex", script([{ sleep: 1500 }, { say: `Pornește misiunea ${mission.title}` }, { sleep: 2500 }]));
    await startDerivedLega(t, owner);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((s) => /Am pregătit planul/.test(s)), 10000);
    await t.hub.lega.stopAll("test");
    const action = t.hub.lega.hubActions?.() || [];
    const envId = t.hub.db.prepare("SELECT id FROM mission_envelopes WHERE status = 'PROPOSED'").all();
    assert.equal(envId.length, 1, `ONE envelope (${JSON.stringify(action)})`);
    const env = t.hub.envelopes.view(envId[0].id);
    assert.deepEqual(env.missionIds, [mission.id]);
    assert.equal(env.proposedVia, "voice");
    t.queue("codex", "factory-write:feature-b-nodedupe", "factory-write:feature-b-dedupe");
    t.queue("claude", "review:pass");
    const confirmed = await asOwner(t, owner, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, modality: "click" });
    assert.equal(confirmed.envelope.status, "ACTIVE");
    const done = await untilStage(t, mission.id, SETTLED, 240000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 1, "the failing check was repaired inside the limit shown on the card");
    const preview = done.evidence.find((e) => e.stage === "PREVIEW");
    assert.equal(preview?.status, "PASS", preview?.detail?.reason);
    assert.equal(preview.changeSetId, done.changeSets.at(-1).id, "the preview runs the verified version");
    const e2e = done.evidence.find((e) => e.stage === "E2E");
    const manifest = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE mission_id = ?").get(mission.id).manifest_json);
    if (browserStatus({ hubRoot: t.config.browserRoot }).installed) {
      tc.diagnostic("E2E: Playwright present, the browser E2E ran");
      assert.equal(e2e?.status, "PASS", e2e?.outputTail);
      assert.equal(e2e.changeSetId, done.changeSets.at(-1).id, "E2E ran on the verified version");
    } else {
      tc.diagnostic("E2E: SKIPPED_ENV (Playwright absent): AC-7 must say NEEDS_INSTALL_APPROVAL");
      assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-7").status, "NEEDS_INSTALL_APPROVAL", "E2E is never claimed without Playwright");
    }
    const derived = t.hub.grants.ofEnvelope(env.id);
    const runs = t.hub.db.prepare("SELECT grant_id FROM agent_runs WHERE status <> 'blocked'").all();
    assert.ok(runs.length >= 3 && runs.every((x) => derived.some((g) => g.id === x.grant_id)), "every model step on the plan's own grants");
    assert.equal(events(t, "envelope.delta_confirmed").length, 0);
    assert.equal(modes.length, 0, "BUILD_SAFE throughout");
    assertOnePlanPath(t, m0, { scopeConfirmations: 1, extraAuthentications: 0, clarifications: 0 }, "Flow B2");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- Flow C (the Hub's own project)
test("M10.2-E2E-C a request on the Hub's own project → the honest explanation once (factory refuses the Hub, R2 options), the request kept, no plan, no old-flow pointer", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t, { activatePolicy: true });
    consent(t.hub);
    const hubProject = t.hub.projects.hub();
    const m0 = t.hub.bus.lastSeq();
    const ask = { tool: "request_work", args: { request: "Adaugă un buton nou în cockpit; testul e test/acceptance.test.mjs", kind_hint: "engineering", project: hubProject.name } };
    t.queue("codex", calls([ask, ask, { tool: "how_to", args: { topic: "r2" } }]));
    const s = await asOwner(t, owner, "lega.session.start", { sdp: OFFER });
    await dispatch(t.hub, "lega.session.connected", { sessionId: s.sessionId }, { channel: "ui", actor: "user" });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
    const r = replies(t).filter((x) => x.tool === "request_work");
    assert.equal(r.length, 2);
    assert.equal(r[0].ok, false, "a refusal is not a success");
    assert.match(r[0].text, /Software Factory nu lucrează pe Hub-ul însuși/);
    assert.match(r[0].text, /R2/);
    assert.match(r[0].text, /wsl-runner/, "the real option (environment route), not a mode / gate / grant step");
    assert.doesNotMatch(r[0].text, OLD_FLOW_TEXT);
    assert.doesNotMatch(r[0].text, /host_isolation|workspace_lease|execution_gate \(|live_grant/, "no raw gate ids");
    // 2.12.2 (L3, m10-2-p0r5-lega-honesty.test.mjs): the Hub's factual tail ends every non-plan answer; here it says the request is kept.
    assert.match(r[1].text, /^Încă blocat .*cererea ta e păstrată\. \(Cererea e păstrată de Hub\.\)$/, "explained once; the second mention is one line");
    const how = replies(t).find((x) => x.tool === "how_to");
    assert.doesNotMatch(how.text, /tastezi LIVE_VALIDATION|tastezi OPEN GATE|apasă tu „Creează grant”/);
    const kept = t.hub.db.prepare("SELECT * FROM work_requests").all();
    assert.equal(kept.length, 1, "one kept request");
    assert.equal(kept[0].status, "BLOCKED");
    assert.equal(kept[0].project_id, hubProject.id);
    assert.match(kept[0].blocker_signature, /HUB_SELF_TARGET/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 0, "no plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM factory_missions"), 0, "no draft");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.equal(t.hub.settings.get("r2Acceptance")?.[hubProject.id], undefined, "R2 is never accepted on the owner's behalf");
    assertOnePlanPath(t, m0, { scopeConfirmations: 0, extraAuthentications: 0 }, "Flow C");
    // Not even a new-path arrow at the isolation screen: an R2 acceptance is an admin decision the owner takes on his own.
    assert.equal(events(t, "lega.pointed").filter((e) => e.seq > m0).length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- Flow D (armed spoken confirmation, 0 clicks)
test("M10.2-E2E-D armed spoken confirmation on a TRUSTED hub-test project with the local voice gate on: 0 clicks from words to DELIVERY_READY", async () => {
  const t = await makeTestHub({ queues: true, codex: "ok" });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-armed");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await enrolVoice(t, owner);
    await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    const m0 = t.hub.bus.lastSeq();
    const say = `Pornește misiunea ${mission.title}`;
    t.queue("codex", script([{ sleep: 2500 }, { say }, { sleep: 60000 }]));
    const lega = await startDerivedLega(t, owner);
    assert.equal(t.hub.lega.state().gated, true, "the session started behind the local voice gate");
    // The sentence passes the local filter (owner's voice, local transcript), then the provider transcript reaches the bridge.
    const gateSay = async (text) => {
      const g = await speak(t, owner, text, { purpose: "gate", legaSessionId: lega });
      if (g.result === "MATCH") await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 5000);
      await sleep(200);
      return g;
    };
    await gateSay(say);
    const armed = await waitFor(() => t.hub.armedWindows.open().find((w) => w.legaSessionId === lega) || null, 20000);
    const env = t.hub.envelopes.get(armed.planId);
    assert.equal(env.status, "PROPOSED");
    assert.deepEqual(env.missionIds, [mission.id]);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const yes = await gateSay("Da, execută planul");
    assert.equal(yes.result, "MATCH");
    assert.equal(yes.boundPlanId, env.id);
    const active = await waitFor(() => (["ACTIVE", "COMPLETED", "WAITING_OWNER"].includes(t.hub.envelopes.get(env.id).status) ? t.hub.envelopes.view(env.id) : null), 20000);
    assert.equal(active.consent.modality, "voice");
    assert.equal(active.consent.voice.transcriptSource, "local");
    const done = await untilStage(t, mission.id, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    // 0 clicks: no confirm button, no typed answer, no approval decision, no grant / mode / gate / settings command in the window.
    const clicks = count(t, `SELECT COUNT(*) AS n FROM commands c JOIN events e ON e.scope_id = c.id AND e.type = 'command.accepted' WHERE e.seq > ?
      AND c.type IN ('envelope.confirm','ops.plan.confirm','approval.decide','grant.create','mode.set','gate.set','settings.update')`, m0);
    assert.equal(clicks, 0, "0 clicks");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'owner'"), 0, "nothing typed in the cockpit");
    assertOnePlanPath(t, m0, { scopeConfirmations: 1, extraAuthentications: 0 }, "Flow D");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- Flow E (pause → Continuă → expiry → continuation)
test("M10.2-E2E-E pause → typed „Continuă” → expiry → a continuation plan of only what remains → ONE confirmation → DELIVERY_READY", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    const say = (text) => intent(t, owner, { text, projectId: project.id });
    const m0 = t.hub.bus.lastSeq();

    // ONE plan, confirmed with typed „Da” on the card the owner sees (Enter in the cockpit).
    const shown = (await say(`Pornește misiunea ${mission.title}`)).results[0];
    const a = shown.plan?.envelope;
    assert.ok(a?.id, JSON.stringify(shown));
    t.queue("codex", "hang");
    const yes = (await say("Da")).results; // without the presented card: refused (a confirmation is for the card on screen)
    assert.ok(yes.every((r) => !r.confirmed), JSON.stringify(yes));
    const ok = (await intent(t, owner, { text: "Da", projectId: project.id, presented: { envelopeId: a.id, nonce: a.nonce, hash: a.envelopeHash } })).results[0];
    assert.ok(ok.confirmed, JSON.stringify(ok));
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);

    // „Pauză” → the gate is suspended by the owner's own pause; typed „Continuă” reopens it and resumes inside the same plan.
    await say("Pauză");
    await untilStage(t, mission.id, ["PAUSED"], 30000);
    assert.equal(t.hub.settings.get("executionGate").suspendedBy?.kind, "pause");
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    t.queue("codex", "hang");
    const cont = (await say("Continuă")).results[0];
    assert.equal(cont.interrupt?.reopened, true, JSON.stringify(cont));
    assert.equal(t.hub.settings.get("executionGate").status, "open");
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);

    // The plan expires while the writer works: the mission is paused, the turn interrupted, the plan's grants revoked.
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), a.id);
    t.hub.envelopes.tick();
    assert.equal(t.hub.envelopes.get(a.id).status, "EXPIRED");
    await untilStage(t, mission.id, ["PAUSED"], 30000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    assert.ok(t.hub.grants.ofEnvelope(a.id).every((g) => g.status !== "active"), "an expired plan authorizes nothing");

    // „Reia misiunea …” → a continuation plan: only the difference (what remains), ONE confirmation, factory.resume (no new start).
    const starts = count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'factory.start'");
    const scopes = count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope'");
    const next = (await say(`Reia misiunea ${mission.title}`)).results[0];
    const b = next.plan?.envelope;
    assert.ok(b?.id, JSON.stringify(next));
    assert.deepEqual(b.body.continuation, { fromEnvelopeId: a.id, missionId: mission.id });
    assert.match(next.plan.summary.headline, /^Continuare: /);
    assert.ok(next.plan.summary.continuation?.remaining, "the card shows only what remains");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const ok2 = (await intent(t, owner, { text: "Da", projectId: project.id, presented: { envelopeId: b.id, nonce: b.nonce, hash: b.envelopeHash } })).results[0];
    assert.ok(ok2.confirmed, JSON.stringify(ok2));
    const done = await untilStage(t, mission.id, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'factory.start'"), starts, "no factory.start for the continuation");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope'"), scopes, "no new factory.scope approval");
    assert.equal(events(t, "envelope.mission_continued").length, 1);

    assertOnePlanPath(t, m0, { scopeConfirmations: 2, extraAuthentications: 0 }, "Flow E");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- F: negative control (the counters see the old path)
test("M10.2-E2E-F negative control: under the legacy policy Lega still prepares grants and points at the old forms, and the same counters count them", async () => {
  const t = await makeTestHub({ codex: calls([{ tool: "prepare_grant", args: { kind: "run" } }, { tool: "point", args: { target: "grant-create" } }, { tool: "point", args: { target: "live-mode" } }]) });
  try {
    await enrolOwner(t, { activatePolicy: false }); // the owner's fail-safe: the legacy policy
    await enableLive(t.hub, { provider: "codex" });
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    consent(t.hub);
    const m0 = t.hub.bus.lastSeq();
    const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } })).result;
    assert.equal(s.authority, "grant");
    await dispatch(t.hub, "lega.session.connected", { sessionId: s.sessionId }, { channel: "ui", actor: "user" });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
    assert.equal(t.hub.lega.state().voiceFirst, false);
    // The owner follows the arrows by hand (the M03 path): opens the grant form and the Approvals screen.
    await dispatch(t.hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" });
    await dispatch(t.hub, "owner.nav", { screen: "approvals" }, { channel: "ui", actor: "user" });
    const r = probe(t, m0);
    assert.ok(r.counters.grantFormsOpened >= 2, JSON.stringify(r.evidence.grantFormsOpened));
    assert.ok(r.counters.legaOldFlowPointers >= 1, JSON.stringify(r.evidence.legaOldFlowPointers));
    assert.equal(r.counters.approvalsNavigations, 1);
    assert.equal(r.counters.scopeConfirmations, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
