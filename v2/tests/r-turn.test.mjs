// PASS_SIMULATED: real Factory/runtime/supervisor, fixture processes only. No real CLI or model calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeTestHub, enableLive, enrolOwner, waitFor, FIXTURES, registerCleanupGuard } from "./helpers.mjs";
import { checkSpec, specHash, specSummary, AUTHOR_TURN_TIMEOUT_MIN } from "../server/factory/spec.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { defaultModelLimits, TURN_TIMEOUT_BOUNDS } from "../server/factory/plan.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { runRehearsal, S25_WORDS, createRehearsalCodex, probeRehearsalProviders, recordedProcessTree,
  recordedSurvivors, emergencyKillRecorded, cleanupRecordedProcesses, createRehearsalStop } from "./manual/s25-isolated-rehearsal.mjs";

const OLD = { maxOutputTokens: 64000, provenance: "decizia proprietarului 2026-10-13 21:32 UTC: limită de ieșire 64000 doar pentru autorul testului de la pasul 0" };
registerCleanupGuard();
const marker = { createdBy: "ifrim-agent-hub", purpose: "live-validation", fixture: "booking-demo", data: "synthetic", name: "Programări §25" };
const MODELS = { writerModel: "gpt-fake-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium" };
const END = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED"];
const line = "Autorul testului (pasul 0): 45 min de la trimiterea turei, reîncercările incluse.";
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-turn-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })); return dir; }
function booking(dir) { fs.cpSync(path.join(FIXTURES, "r-priv-booking"), dir, { recursive: true, filter: (s) => path.basename(s) !== "SOURCE.md" }); fs.writeFileSync(path.join(dir, ".ifrim-hub-test.json"), JSON.stringify(marker)); }

async function fixture(t, { old = false, demo = false, scenario = null, scale = 1, clock, turnTimers, owner = false, prepare = true, timeoutMs = 60000, waitUntil = Date.now() + timeoutMs - 5000 } = {}) {
  const binaries = scenario ? {
    claude: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-turn.mjs"), `--turn-scenario=${scenario}`] },
    codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs")] },
  } : null;
  const h = await makeTestHub({ queues: true, hubOptions: { turnTimers }, ...(clock ? { clock } : {}), ...(binaries ? { configOverrides: { providerBinaries: binaries } } : {}) });
  t.after(() => h.cleanup());
  const dispatch = (type, payload, extra = {}) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
  await enableLive(h.hub, { access: "workspace-write" });
  h.hub.factory.setTurnTimeScaleForTests(scale);
  const dir = path.join(h.dataDir, "turn-project");
  if (demo) materializeFixture("bug-demo-test-first", dir); else booking(dir);
  const project = (await dispatch("project.register_test", { path: dir })).result;
  h.hub.bus.transaction(() => { for (const provider of ["claude", "codex"]) h.hub.grants.create({ provider, projectId: project.id, access: provider === "claude" ? "read-only" : "workspace-write", maxAttempts: 5, maxDurationS: 7200, ttlMinutes: 240 }, "test"); });
  const built = demo ? { input: demoSpec("bug-demo-test-first", { projectId: project.id }) } : buildEngineeringSpec({ text: S25_WORDS, project });
  if (old || demo) built.input.spec.authoring.authorLimits = OLD;
  const mission = prepare ? (await dispatch("factory.prepare", { projectId: project.id, ...built.input, limits: { ...MODELS, maxAttemptsPerStage: 1 } })).result.mission : null;
  const view = () => h.hub.factory.view(mission.id);
  const start = async () => { const r = await dispatch("factory.start", view().scope); await dispatch("approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash }); await h.hub.commands.executeApproved(r.command.id, "user"); };
  const where = () => JSON.stringify({ stage: view().factory.stage, reason: view().factory.stageReason, dispatches: view().dispatches, runs: h.hub.runs.activeRuns() });
  const wait = (fn) => waitFor(fn, Math.max(1, waitUntil - Date.now()), 50, { signal: t.signal }).catch((error) => {
    if (t.signal.aborted) throw error;
    throw new Error(`${error.message} · ${where()}`, { cause: error });
  });
  const settled = async () => { await wait(() => END.includes(view().factory.stage)); await wait(async () => { await h.hub.factory.idle(mission.id); return true; }); return view(); };
  const running = () => wait(() => h.hub.runs.activeRuns().map((r) => h.hub.runs.getRun(r.runId)).find((r) => r.provider === "claude" && r.timeline.turn_sent));
  const session = owner ? await enrolOwner(h) : null;
  return { ...h, dir, project, built, mission, view, start, settled, running, wait, dispatch, owner: session };
}

test("T-TURN-01 strict 45-only schema, stable old shapes/hashes, dataset-scoped planner provenance", (t) => {
  assert.equal(AUTHOR_TURN_TIMEOUT_MIN, 45); assert.deepEqual(TURN_TIMEOUT_BOUNDS.reviewer, [3, 40]);
  const dir = temp(t); booking(dir);
  const project = { id: "test", source: "hub-test", path: dir };
  const built = buildEngineeringSpec({ text: S25_WORDS, project });
  assert.deepEqual(built.problems, []); assert.ok(built.input.spec.dataset);
  const input = { ...built.input.spec, ...Object.fromEntries(["workType", "title", "objective"].map((k) => [k, built.input[k]])) };
  const limits = input.authoring.authorLimits;
  assert.deepEqual(Object.keys(limits), ["maxOutputTokens", "turnTimeoutMin", "provenance"]);
  assert.equal(limits.turnTimeoutMin, 45); assert.ok(limits.provenance.length <= 300);
  for (const date of ["2026-10-13 21:32 UTC", "2026-10-14 10:09 UTC"]) assert.ok(limits.provenance.includes(date));
  const checked = checkSpec(input); assert.deepEqual(checked.problems, []); assert.match(specSummary(checked.spec), /45 min/);
  const problemText = "authoring.authorLimits: doar maxOutputTokens 64000, opțional turnTimeoutMin 45 pentru planul §25 cu date martor, și provenance (1–300 caractere)";
  for (const dataset of [undefined, null, {}]) {
    const invalid = checkSpec({ ...input, dataset });
    assert.ok(invalid.problems.includes(problemText));
    assert.ok(checkSpec(invalid.spec).problems.includes(problemText), "saving cannot erase an invalid override");
  }
  const old = checkSpec({ ...input, authoring: { ...input.authoring, authorLimits: OLD } });
  assert.deepEqual(old.problems, []); assert.equal(JSON.stringify(old.spec.authoring.authorLimits), JSON.stringify(OLD));
  const reverted = structuredClone(checked.spec); reverted.authoring.authorLimits = OLD;
  assert.equal(specHash(reverted), specHash(old.spec)); assert.notEqual(specHash(checked.spec), specHash(old.spec));
  for (const value of [44, 46, 40, "45", null, undefined]) {
    const bad = checkSpec({ ...input, authoring: { ...input.authoring, authorLimits: { ...limits, turnTimeoutMin: value } } });
    assert.ok(bad.problems.some((p) => p.includes("authorLimits")), String(value));
    assert.ok(checkSpec(bad.spec).problems.some((p) => p.includes("authorLimits")));
  }
  assert.ok(checkSpec({ ...input, authoring: { ...input.authoring, authorLimits: { ...limits, extra: 45 } } }).problems.length);
  for (const text of ["Corectează suma calculată greșit: totalul pentru 2 și 3 trebuie să fie 5.", S25_WORDS.replaceAll("Telefonul", "Numele").replaceAll("telefonul", "numele")]) {
    assert.deepEqual(buildEngineeringSpec({ text, project }).input.spec.authoring.authorLimits, OLD);
  }
  fs.appendFileSync(path.join(dir, "src/server-app.js"), "\n");
  const changed = buildEngineeringSpec({ text: S25_WORDS, project }); assert.equal(changed.input.spec.dataset, undefined); assert.deepEqual(changed.input.spec.authoring.authorLimits, OLD);
  fs.unlinkSync(path.join(dir, ".ifrim-hub-test.json"));
  assert.deepEqual(buildEngineeringSpec({ text: S25_WORDS, project }).input.spec.authoring.authorLimits, OLD);
});

test("T-TURN-01 Factory dispatch/runtime scale: author only; role limits and old spec unchanged", { timeout: 180000 }, async (t) => {
  const waitUntil = Date.now() + 175000;
  for (const old of [false, true]) await t.test(old ? "old shape" : "approved §25", async (t) => {
    const scale = 0.01, h = await fixture(t, { old, scale, waitUntil });
    h.queue("claude", "author:dataset-reference", "review:pass"); h.queue("codex", "test-review:pass", "factory-write:privacy-harness");
    assert.equal(h.view().turnLimits.author, undefined, "unapproved draft grants no override");
    const calls = [], start = h.hub.runs.start;
    h.hub.runs.start = async (args) => {
      calls.push(args);
      const row = h.hub.db.prepare("SELECT * FROM factory_dispatches WHERE id = ?").get(args.correlationId);
      if (!old && row.stage === "TEST_AUTHORING") {
        await assert.rejects(start({ ...args, turnTimeoutMs: args.turnTimeoutMs + 1 }), /scalei Factory/);
        await assert.rejects(start({ ...args, actor: "user" }), /scalei Factory/);
        await assert.rejects(start({ ...args, taskId: null }), /scalei Factory/);
      }
      return start(args);
    };
    await h.start(); const done = await h.settled(); assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.turnLimits.author, old ? undefined : 45);
    for (const stage of ["TEST_AUTHORING", "TEST_REVIEW", "IMPLEMENTING", "REVIEWING"]) {
      const d = done.dispatches.find((d) => d.stage === stage); assert.ok(d, stage);
      const min = stage === "TEST_AUTHORING" && !old ? 45 : ["TEST_AUTHORING", "REVIEWING"].includes(stage) ? 15 : 25;
      assert.equal(d.request.turnTimeoutMin, min); assert.equal(d.request.turnTimeoutSource, min === 45 ? "authorLimits" : undefined);
      assert.equal(d.request.counted, 1);
      const row = h.hub.db.prepare("SELECT request_json FROM factory_dispatches WHERE id = ?").get(d.id);
      assert.match(row.request_json, /"cycle":0,"changeSeq":\d+/);
      const ms = Math.max(1, Math.round(min * 60000 * scale));
      assert.equal(calls.find((a) => a.correlationId === d.id).turnTimeoutMs, ms);
      const run = h.hub.runs.getRun(d.runId); assert.equal(run.plan.turnTimeoutMs, ms);
      assert.equal(run.evidence.turnDeadline.limitMs, ms); assert.equal(run.evidence.turnDeadline.clearedBy, "finished");
      assert.equal(run.evidence.turnTimeout, undefined);
    }
  });
});

test("T-TURN-02 retries/deltas never extend the one turn arm; 45-min timeout kills a real fake child", { timeout: 60000 }, async (t) => {
  // Hub timestamps and deadline timers advance together; fixture processes and cleanup use real time.
  // Separate admission, turn_sent and retries so resets and an old admission timer are observable.
  let elapsedMs = 0;
  let base = null;
  const timers = new Set();
  const turnTimers = { now: () => elapsedMs,
    setTimeout: (fn, ms) => { const timer = { fn, at: elapsedMs + ms }; timers.add(timer); if (elapsedMs === 0) elapsedMs = 400; return timer; },
    clearTimeout: (timer) => timers.delete(timer) };
  const advance = (ms) => { elapsedMs += ms; for (const timer of [...timers]) if (timer.at <= elapsedMs) { timers.delete(timer); timer.fn(); } };
  const ms = 1800, h = await fixture(t, { scenario: "hang", scale: ms / (45 * 60000), turnTimers, clock: () => new Date((base ?? Date.now()) + elapsedMs) });
  base = Date.now();
  await h.start(); const run = await h.running();
  const first = h.hub.runs.activeRuns().find((r) => r.runId === run.id).turnDeadline;
  advance(600);
  await h.wait(() => h.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND type = 'run.notice'").get(run.id).n >= 3);
  advance(ms - 601);
  assert.deepEqual(h.hub.runs.activeRuns().find((r) => r.runId === run.id).turnDeadline, first);
  assert.equal(timers.size, 1, "admission arm replaced once; retries added no timers");
  advance(1);
  const done = await h.settled(), final = h.hub.runs.getRun(run.id), d = final.evidence.turnDeadline;
  assert.equal(final.errorCategory, "turn_timeout"); assert.equal(final.status, "failed");
  assert.equal(d.limitMs, ms); assert.equal(d.admissionArms, 1); assert.equal(d.turnArms, 1);
  assert.ok(d.apiRetriesAfterTurnSent >= 3); assert.equal(d.noticesAfterTurnSent, d.apiRetriesAfterTurnSent);
  assert.equal(d.deadlineAt, first.at); assert.equal(Date.parse(d.deadlineAt) - Date.parse(d.turnArmedAt), ms);
  assert.equal(Date.parse(d.admissionDeadlineAt) - Date.parse(d.admissionArmedAt), ms);
  assert.equal(Date.parse(d.turnArmedAt) - Date.parse(d.admissionArmedAt), 400);
  assert.notEqual(d.deadlineAt, d.admissionDeadlineAt);
  const elapsed = Date.parse(d.firedAt) - Date.parse(d.turnArmedAt);
  assert.ok(elapsed >= ms - 20 && elapsed < ms + 1000, `deadline fired after ${elapsed} ms`);
  assert.equal(d.fired, true); assert.equal(d.clearedBy, null); assert.equal(final.evidence.turnTimeout.deadlineAt, d.deadlineAt);
  assert.ok(final.timeline.first_output); assert.throws(() => process.kill(run.pid, 0));
  const events = h.hub.db.prepare("SELECT type,payload_json FROM events WHERE run_id = ? AND type IN ('run.turn_deadline','run.turn_timeout')").all(run.id);
  assert.equal(events.length, 2); assert.deepEqual(JSON.parse(events.find((e) => e.type === "run.turn_deadline").payload_json), d);
  assert.equal(done.factory.stage, "NEEDS_OWNER_DECISION"); assert.match(done.factory.stageReason, /^Etapa TEST_AUTHORING \(autorul testului\) a depășit limita de 45 min pe tură/);
  await h.hub.factory.tick(); assert.equal(h.view().dispatches.length, 1);
});

test("T-TURN parity: admission-only timeout is recorded before inference and never redispatched", { timeout: 60000 }, async (t) => {
  const h = await fixture(t, { scenario: "admission", scale: 1000 / (45 * 60000) });
  await h.start(); const done = await h.settled();
  const run = h.hub.runs.getRun(done.dispatches[0].runId), d = run.evidence.turnDeadline;
  assert.equal(run.errorCategory, "turn_timeout"); assert.equal(run.status, "blocked"); assert.equal(run.preInference, true);
  assert.match(done.factory.stageReason, /^Etapa TEST_AUTHORING \(autorul testului\):/);
  assert.equal(d.admissionArms, 1); assert.equal(d.turnArms, 0); assert.equal(d.turnSentAt, null); assert.equal(d.turnArmedAt, null);
  assert.equal(d.deadlineAt, d.admissionDeadlineAt); assert.equal(d.fired, true); assert.equal(d.noticesAfterTurnSent, 0);
  assert.throws(() => process.kill(run.pid, 0)); await h.hub.factory.tick(); assert.equal(h.view().dispatches.length, 1);
});

for (const reason of ["Stop", "revocation", "expiry"]) test(`T-TURN-03 ${reason}: running author dies, deadline cleared, no redispatch`, { timeout: 60000 }, async (t) => {
  let offset = 0;
  const h = await fixture(t, { scenario: "hang", clock: () => new Date(Date.now() + offset), owner: reason === "revocation" });
  let envelope;
  if (reason === "revocation") {
    envelope = (await h.dispatch("envelope.propose", { projectId: h.project.id, missionIds: [h.mission.id] })).result.envelope;
    await h.dispatch("envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: h.owner.session });
  } else await h.start();
  const run = await h.running(); assert.equal(run.plan.turnTimeoutMs, 45 * 60000);
  if (reason === "Stop") await h.dispatch("factory.stop", { missionId: h.mission.id });
  else if (reason === "revocation") h.hub.envelopes.revoke(envelope.id, { reason: "T-TURN revocation" });
  else { offset = (h.view().factory.limits.maxDurationMin + 1) * 60000; await h.hub.factory.tick(); }
  await h.wait(() => h.hub.runs.activeRuns().length === 0);
  await h.wait(async () => { await h.hub.factory.idle(h.mission.id); return true; });
  const done = h.view(), final = h.hub.runs.getRun(run.id);
  assert.throws(() => process.kill(run.pid, 0)); assert.equal(final.status, "interrupted"); assert.equal(final.evidence.turnDeadline.fired, false);
  assert.ok(final.evidence.turnDeadline.clearedBy); assert.equal(final.evidence.turnTimeout, undefined);
  assert.ok(["INTERRUPTED", "CANCELLED"].includes(done.dispatches[0].status), done.dispatches[0].status);
  assert.equal(done.factory.stage, reason === "Stop" ? "CANCELLED" : reason === "revocation" ? "PAUSED" : "NEEDS_OWNER_DECISION");
  if (envelope) assert.equal(h.hub.envelopes.get(envelope.id).status, "REVOKED");
  await h.hub.factory.tick(); assert.equal(h.view().dispatches.length, 1);
});

for (const category of ["transport", "authentication", "output_token_limit"]) test(`T-TURN-04 ${category}: distinct cause, bounded single attempt`, { timeout: 60000 }, async (t) => {
  const h = await fixture(t, { scenario: category }); await h.start(); const done = await h.settled();
  assert.equal(done.dispatches.length, 1); const run = h.hub.runs.getRun(done.dispatches[0].runId);
  assert.equal(run.errorCategory, category, run.errorMessage); assert.equal(run.status, category === "authentication" ? "blocked" : "failed");
  assert.equal(run.preInference, category === "authentication");
  assert.equal(run.evidence.turnDeadline.fired, false); assert.equal(run.evidence.turnDeadline.clearedBy, "finished");
  assert.equal(run.evidence.turnTimeout, undefined); assert.equal(run.plan.turnTimeoutMs, 2700000);
  if (category === "authentication") { assert.equal(run.timeline.turn_sent, undefined); assert.equal(run.evidence.turnDeadline.turnArmedAt, null); }
  if (category === "transport") assert.equal(run.evidence.turnDeadline.apiRetriesAfterTurnSent, 3);
  if (category === "output_token_limit") { assert.equal(run.evidence.authorOutputLimit.effective, 64000); assert.match(done.factory.stageReason, /buget.*ieșire/); }
  assert.ok(["NEEDS_OWNER_DECISION", "BLOCKED"].includes(done.factory.stage)); assert.ok(done.factory.stageReason);
  await h.hub.factory.tick(); await h.hub.factory.idle(h.mission.id); assert.equal(h.view().dispatches.length, 1);
});

test("T-TURN-05 card text and hash: old text exact, changed authorLimits supersede; approved spec immutable", { timeout: 120000 }, async (t) => {
  const h = await fixture(t, { scenario: "hang", owner: true, timeoutMs: 120000 });
  const propose = async () => (await h.dispatch("envelope.propose", { projectId: h.project.id, missionIds: [h.mission.id] })).result;
  const confirm = (e) => h.dispatch("envelope.confirm", { envelopeId: e.id, nonce: e.nonce, displayedHash: e.envelopeHash }, { ownerSession: h.owner.session });
  const first = await propose();
  assert.ok(first.summary.limits.endsWith(line)); assert.ok(first.summary.testFirst.step0.endsWith(line));
  assert.equal(hashCanonical(first.envelope.body), first.envelope.envelopeHash);
  const body = structuredClone(first.envelope.body); body.missions[0].testFirst.authorLimits.turnTimeoutMin = 44;
  assert.notEqual(hashCanonical(body), first.envelope.envelopeHash);
  const current = h.view().spec.spec;
  h.hub.factory.reviseSpec(h.mission.id, { authoring: { ...current.authoring, authorLimits: OLD } });
  await assert.rejects(confirm(first.envelope), /s-a schimbat/); assert.equal(h.hub.envelopes.get(first.envelope.id).status, "SUPERSEDED");
  const second = await propose();
  assert.equal(second.summary.limits, first.summary.limits.replace(" " + line, ""));
  assert.equal(second.summary.testFirst.step0, first.summary.testFirst.step0.replace("\n" + line, ""));
  h.hub.factory.reviseSpec(h.mission.id, { authoring: current.authoring });
  await assert.rejects(confirm(second.envelope), /s-a schimbat/);
  const third = await propose(); await confirm(third.envelope); await h.running();
  assert.throws(() => h.hub.factory.reviseSpec(h.mission.id, { authoring: { ...current.authoring, authorLimits: OLD } }), /nu se mai schimbă după pornire/);
  await assert.rejects(confirm(third.envelope), /nu mai așteaptă/);
  await h.dispatch("factory.stop", { missionId: h.mission.id });
});

test("T-TURN-01 planner request identity excludes old §25 drafts without editing them", { timeout: 60000 }, async (t) => {
  const h = await fixture(t, { owner: true, prepare: false });
  const defaults = defaultModelLimits().limits;
  const state = h.hub.providerState.get("codex"); h.hub.providerState.set("codex", { ...state, models: [...state.models, { id: defaults.writerModel, efforts: ["medium", "high"] }] });
  const built = h.built;
  const identity = { projectId: h.project.id, workType: built.input.workType, objective: built.input.objective, testRef: built.testRef, models: defaults, testFirst: built.testFirst.testRef };
  const oldInput = structuredClone(built.input); oldInput.spec.authoring.authorLimits = OLD;
  const previous = h.hub.prepareFactoryMission({ projectId: h.project.id, ...oldInput, limits: defaults }, { actor: "test", provenance: { createdBy: "intake", requestHash: hashCanonical(identity).slice(0, 32) } });
  const before = h.hub.db.prepare("SELECT * FROM factory_specs WHERE mission_id = ?").all(previous.mission.id);
  const response = await h.hub.intake.plan({ kind: "engineering", text: S25_WORDS, projectId: h.project.id }, { channel: "owner", actor: "owner", ownerSession: h.owner.session });
  const e = response.plan?.envelope; assert.ok(e, JSON.stringify(response)); assert.notEqual(e.missionIds[0], previous.mission.id);
  const provenance = h.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.provenance' AND scope_id = ? AND json_extract(payload_json, '$.requestHash') IS NOT NULL").get(e.missionIds[0]);
  assert.equal(JSON.parse(provenance.payload_json).requestHash, hashCanonical({ ...identity, authorLimits: built.input.spec.authoring.authorLimits }).slice(0, 32));
  assert.deepEqual(h.hub.db.prepare("SELECT * FROM factory_specs WHERE mission_id = ?").all(previous.mission.id), before);
  assert.equal(h.hub.factory.view(previous.mission.id).factory.stage, "SPEC_DRAFT");
  // 2.14.14 included testFirst, but never the ubiquitous 64000/provenance authorLimits.
  const ordinaryWords = "Corectează suma calculată greșit: totalul pentru 2 și 3 trebuie să fie 5.";
  const nonS25 = buildEngineeringSpec({ text: ordinaryWords, project: h.project });
  assert.ok(nonS25.testFirst.ok); assert.equal(nonS25.input.spec.dataset, undefined);
  assert.deepEqual(nonS25.input.spec.authoring.authorLimits, OLD);
  const hash21414 = hashCanonical({ projectId: h.project.id, workType: nonS25.input.workType, objective: nonS25.input.objective,
    testRef: nonS25.testRef, models: defaults, testFirst: nonS25.testFirst.testRef }).slice(0, 32);
  const ordinaryDraft = h.hub.prepareFactoryMission({ projectId: h.project.id, ...nonS25.input, limits: defaults },
    { actor: "test", provenance: { createdBy: "intake", requestHash: hash21414 } });
  const ordinaryPlan = await h.hub.intake.plan({ kind: "engineering", text: ordinaryWords, projectId: h.project.id },
    { channel: "owner", actor: "owner", ownerSession: h.owner.session });
  assert.equal(ordinaryPlan.plan?.envelope.missionIds[0], ordinaryDraft.mission.id, JSON.stringify(ordinaryPlan));
  assert.notEqual(JSON.parse(provenance.payload_json).requestHash, hashCanonical(identity).slice(0, 32), "§25 changes the 2.14.14 hash");
  fs.mkdirSync(path.join(h.dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(h.dir, "test/acceptance.test.mjs"), 'import test from "node:test"; test("existing acceptance", () => {});\n');
  const text = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
  const plain = buildEngineeringSpec({ text, project: h.project }); assert.equal(plain.input.spec.authoring, undefined);
  const ordinary = await h.hub.intake.plan({ kind: "engineering", text, projectId: h.project.id }, { channel: "owner", actor: "owner", ownerSession: h.owner.session });
  const id = ordinary.plan?.envelope.missionIds[0]; assert.ok(id, JSON.stringify(ordinary));
  const p = h.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.provenance' AND scope_id = ? AND json_extract(payload_json, '$.requestHash') IS NOT NULL").get(id);
  assert.equal(JSON.parse(p.payload_json).requestHash, hashCanonical({ projectId: h.project.id, workType: plain.input.workType, objective: plain.input.objective, testRef: plain.testRef, models: defaults }).slice(0, 32));
});

function assertNoCredentialReads(source) {
  assert.doesNotMatch(source, /auth\.json|\bcredentials\b/i);
  assert.doesNotMatch(source, /(?:readFileSync|readFile|copyFileSync|copyFile)\([^;\n]*["']\.codex["']/);
  // Include multiline/nested path expressions and fs.promises; inspectCodexConfig(homeDir) stays allowed.
  assert.doesNotMatch(source, /\b(?:read\w*|createReadStream|open\w*|copyFile\w*)\s*\([^;]*\bos\s*\.\s*homedir\s*\(/);
}

test("T-TURN driver credential guard rejects credentials and home-directory fs reads", () => {
  for (const source of [
    'fs.readFileSync("credentials", "utf8")',
    'fs.readFileSync(path.join(homeDir, ".credentials.json"), "utf8")',
    'fs.readFileSync(path.join(os.homedir(), "private"), "utf8")',
    'await fs.promises.readFile(\n path.resolve(\n os.homedir(), "private"))',
    'fs.createReadStream(path.join(os.homedir(), "private"))',
  ]) assert.throws(() => assertNoCredentialReads(source));
  assertNoCredentialReads('inspectCodexConfig(os.homedir()); fs.readFileSync(output, "utf8");');
});

test("T-TURN driver real Codex route is the production adapter; non-read-only is refused before constructing it", async () => {
  let turns = 0;
  const adapter = createRehearsalCodex({ codexAdapterFactory() { turns++; assert.fail("must not resolve a writer"); } });
  for (const access of ["workspace-write", "full-access", undefined]) {
    const result = await adapter.startTurn({ runId: "refused", access }).done;
    assert.equal(result.preInference, true); assert.equal(result.errorCategory, "policy"); assert.match(result.error, /DEFECT_WRITER_REACHED/);
  }
  assert.equal(turns, 0);
  const source = fs.readFileSync(new URL("./manual/s25-isolated-rehearsal.mjs", import.meta.url), "utf8");
  assertNoCredentialReads(source);
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) assert.ok(source.includes(`process.on("${signal}", stop)`));
});

test("T-TURN real-style Codex wiring preserves production probe, installation, session and startTurn", async () => {
  const calls = [], evidence = { probes: {} }, providerState = new Map();
  const probe = { ok: true, auth: { accountType: "chatgpt", planType: "prolite" },
    usage: { windows: [{ usedPercent: 2 }] },
    models: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", efforts: ["medium"] }],
    sandbox: { readiness: "ready", profiles: ["ifrim_hub_ro", "ifrim_hub_rw"].map((id) => ({ id, allowed: true })) },
    config: { realtime: { riskyKeys: [], mcpServers: 0, mcpServerNames: [] } } };
  const installation = { installed: true, version: "fake" };
  const codex = createRehearsalCodex({ codexAdapterFactory: () => ({
    probe: async (args) => { calls.push("probe"); assert.deepEqual(args, { withModels: true }); return probe; },
    inspectInstallation: async () => installation,
    startTurn(options) { calls.push("turn"); assert.equal(options.access, "read-only"); assert.equal(options.threadId, "cycle-0");
      options.onEvent({ type: "session", nativeSessionId: "cycle-0", model: "gpt-6.1-sol", reasoningEffort: "medium", sandbox: { type: "readOnly" } });
      return { key: "run-review", done: Promise.resolve({ status: "completed" }) }; },
  }), onProbe: (record) => { evidence.probes.codex = record; } });
  const claude = { probe: async () => ({ ok: true, auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" } }), inspectInstallation: async () => installation };
  await probeRehearsalProviders({ providers: { claude, codex }, providerState, mode: "real", evidence });
  assert.strictEqual(providerState.get("codex").sandbox, probe.sandbox);
  const events = [];
  assert.equal((await codex.startTurn({ access: "read-only", runId: "review", threadId: "cycle-0", onEvent: (e) => events.push(e) }).done).status, "completed");
  assert.deepEqual(calls, ["probe", "turn"]); assert.equal(events[0].nativeSessionId, "cycle-0");
});

test("T-TURN Hub probe missing a ChatGPT plan stops preflight before any dispatch", async () => {
  for (const auth of [{ accountType: "chatgpt", planType: null }, { accountType: "chatgpt" },
    { accountType: "chatgpt", planType: " " }, { accountType: "api", planType: "pro" }, undefined]) {
    let dispatches = 0, probes = 0;
    const evidence = { probes: {} }, providerState = new Map(), result = { ok: true, auth, models: [{ id: "must-not-run" }] };
    const codex = createRehearsalCodex({ codexAdapterFactory: () => ({
      probe: async (options) => { probes++; assert.deepEqual(options, { withModels: true }); return result; },
      inspectInstallation() { assert.fail("invalid account must stop immediately"); },
      startTurn() { assert.fail("must never start app-server turn"); },
    }), supervisor: { start() { assert.fail("must not launch a CLI"); } } });
    const providers = { codex, claude: {
      probe: async () => ({ ok: true, auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" } }),
      inspectInstallation: async () => ({ installed: true }),
    } };
    await assert.rejects(async () => {
      await probeRehearsalProviders({ providers, providerState, mode: "real", evidence });
      dispatches++;
    }, /Codex subscription precondition failed:.*ChatGPT and planType; stopped before any model or dispatch/);
    assert.equal(dispatches, 0); assert.equal(probes, 1); assert.equal(providerState.has("codex"), false);
    assert.strictEqual(evidence.probes.codex.probe, result);
  }
});

test("T-TURN cleanup follows recorded parent chains, retains orphans, and excludes reused PIDs", () => {
  const at = (n) => new Date(Date.UTC(2026, 9, 14, 10, 0, n)).toISOString();
  const records = [{ pid: 10, root: true, startRequestedAt: at(0), startedAt: at(1), exitedAt: null }];
  const root = { pid: 10, parentPid: 1, creationDate: at(0) };
  const child = { pid: 11, parentPid: 10, creationDate: at(2) };
  const grandchild = { pid: 12, parentPid: 11, creationDate: at(3) };
  assert.deepEqual(recordedProcessTree(records, [grandchild, child, root]).map((p) => p.pid), [10, 11, 12]);
  records[0].exitedAt = at(4);
  const lateChild = { pid: 13, parentPid: 10, creationDate: at(3) };
  assert.deepEqual(recordedProcessTree(records, [grandchild, lateChild]).map((p) => p.pid), [12, 13]);
  const reused = [root, child, grandchild, lateChild].map((p) => ({ ...p, creationDate: at(10) }));
  assert.deepEqual(recordedProcessTree(records, reused), []);
  assert.equal(records.length, 4);
});

for (const kind of ["emergency", "cleanup"]) test(`T-TURN ${kind} kill checks recorded roots and descendants by CreationDate`, async () => {
  const date = "2026-10-14T10:00:00.000Z", later = "2026-10-14T10:01:00.000Z";
  const records = [
    { pid: 10, root: true, creationDate: date },
    { pid: 11, parentPid: 10, root: false, creationDate: date },
    { pid: 12, parentPid: 11, root: false, creationDate: date },
    { pid: 20, root: true, creationDate: date }, // absent
    { pid: 21, root: true, creationDate: date }, // reused root
    { pid: 22, root: false, creationDate: date }, // reused descendant
    { pid: 23, root: true }, // identity never recorded
    { pid: 24, root: true, creationDate: date, exitedAt: later },
    { pid: 25, root: false, creationDate: date, exitedAt: later },
  ];
  const rows = [10, 11, 12, 21, 22, 23, 24, 25, 99].map((pid) => ({ pid,
    parentPid: pid === 99 ? 10 : 1, creationDate: [21, 22].includes(pid) ? later : date }));
  const kills = [], probes = [];
  const execute = (file, args, options) => {
    if (file === "powershell.exe") {
      assert.equal(options.encoding, "utf8");
      assert.match(args.at(-1), /Get-CimInstance Win32_Process -Filter 'ProcessId=\d+'/);
      assert.match(args.at(-1), /CreationDate\.ToUniversalTime\(\)\.ToString\('o'\)/);
      const pid = Number(args.at(-1).match(/ProcessId=(\d+)/)[1]); probes.push(pid);
      const row = rows.find((p) => p.pid === pid);
      return row ? row.creationDate.replace(".000Z", ".0000000Z") + "\r\n" : "";
    }
    assert.equal(file, "taskkill");
    assert.deepEqual(args, ["/PID", args[1], "/T", "/F"]);
    kills.push(Number(args[1]));
    return { stdout: "" };
  };
  if (kind === "emergency") {
    emergencyKillRecorded(records, { execSync: execute });
    assert.deepEqual(probes, [10, 11, 12, 20, 21, 22]);
  } else {
    let scans = 0;
    const result = await cleanupRecordedProcesses(records, { exec: execute, snapshot: async () => { scans++; return rows; } });
    assert.equal(scans, records.length);
    assert.equal(result.filter((r) => r.exitCode === 0).length, 3);
    assert.equal(result.filter((r) => r.skipped).length, 6);
  }
  assert.deepEqual(kills, [10, 11, 12]);
  assert.deepEqual(recordedSurvivors(records, rows).map((p) => p.pid), [10, 11, 12]);
  assert.deepEqual(recordedSurvivors(records, rows.filter((p) => !kills.includes(p.pid))), []);
});

test("T-TURN second signal synchronously checks identities, kills, then exits 130", () => {
  const controller = new AbortController(), calls = [];
  const creationDate = "2026-10-14T10:00:00.000Z";
  const stop = createRehearsalStop({ controller,
    emergencyKill: () => emergencyKillRecorded([{ pid: 10, root: true, creationDate }], { execSync: (file) => {
      calls.push(file); return creationDate;
    } }), exit: (code) => calls.push(code) });
  stop();
  assert.equal(controller.signal.aborted, true); assert.deepEqual(calls, []);
  assert.throws(() => controller.signal.throwIfAborted(), /Stop cerut din terminal/);
  stop();
  assert.deepEqual(calls, ["powershell.exe", "taskkill", 130]);
});

test("T-TURN pre-aborted rehearsal stops before filesystem setup", async () => {
  const controller = new AbortController(); controller.abort(new Error("pre-launch stop"));
  await assert.rejects(runRehearsal({ mode: "fake", signal: controller.signal }), /pre-launch stop/);
});

for (const scenario of ["success", "hang", "amend"]) test(`T-TURN driver --fake ${scenario}: envelope grants and writer boundary`, { timeout: 180000 }, async (t) => {
  const out = temp(t), e = await runRehearsal({ mode: "fake", out, scenario, calibrate: false });
  assert.equal(e.hubClosed, true); assert.ok(e.pidChecks.length > 0 && e.pidChecks.every((p) => p.gone));
  assert.equal(e.admin.mode, "BUILD_SAFE"); assert.equal(e.admin.label, "throwaway admin path");
  assert.equal(e.billingDeclaration.source, "test:fixture"); assert.match(e.ownerSession, /PASS_SIMULATED/);
  assert.equal(e.configuration.maxDurationMin, 180); assert.equal(e.spec.authorLimits.turnTimeoutMin, 45);
  assert.deepEqual(e.grants.map((g) => [g.provider, g.access, g.maxAttempts, g.maxDurationS]).sort(), [["claude", "read-only", 5, 7200], ["codex", "workspace-write", 5, 7200]]);
  for (const g of e.grants) assert.ok(g.binding.bindingHash && g.binding.missionId && g.binding.model);
  assert.equal(e.dispatches.filter((r) => ["IMPLEMENTING", "REPAIRING"].includes(r.stage)).length, 0);
  assert.equal(e.runs.filter((r) => r.access === "workspace-write").length, 0); assert.equal(e.writerStarted, false);
  const authors = e.dispatches.filter((d) => d.stage === "TEST_AUTHORING");
  assert.equal(authors.length, scenario === "amend" ? 2 : 1);
  for (const d of authors) { assert.equal(JSON.parse(d.request_json).turnTimeoutSource, "authorLimits"); assert.equal(JSON.parse(d.request_json).turnTimeoutMin, 45); }
  if (scenario === "hang") {
    assert.equal(e.classification, "TECHNICAL_STOP"); assert.equal(e.runs[0].error_category, "turn_timeout"); assert.equal(e.boundaryHits.length, 0);
  } else {
    assert.equal(e.classification, "INTENTIONAL_STOP_BEFORE_WRITER"); assert.equal(e.boundaryHits.length, 1);
    assert.equal(e.outcome.stageReason, "REHEARSAL_INTENTIONAL_STOP_BEFORE_WRITER");
    assert.equal(e.authoring.status, "PROTECTED"); assert.equal(e.baselineGate.length, 1); assert.equal(e.baselineGate[0].result, null);
    assert.equal(e.baselineGate[0].status, "FAIL"); assert.equal(e.baselineGate[0].signature, e.authoring.proof.signature);
    assert.deepEqual(e.testReviews.map((r) => r.verdict), scenario === "amend" ? ["CHANGES_REQUESTED", "PASS"] : ["PASS"]);
    for (const c of e.candidates) assert.ok(fs.existsSync(path.join(out, c.file)));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "evidence.json"), "utf8")), e);
});
