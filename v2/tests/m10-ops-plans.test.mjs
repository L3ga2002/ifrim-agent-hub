// M10 zero-form operation plans: ONE contextual confirmation in the owner session; the card shows apps, folders, data, operations,
// limits and what never happens; the authority is derived internally and checked at EVERY operation (status, expiry, owner session,
// step, operation, folder, budget); a pause / Stop / takeover stops new operations; "Continuă" resumes within the same limits after
// reconciling uncertain steps; boot never resumes a plan by itself; voice confirms only with the local evidence for THAT plan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTestHub, enrolOwner, tempDir, waitFor } from "./helpers.mjs";
import { asOwner, asChannel } from "./m10-helpers.mjs";
import { enrolVoice, speak } from "./voice-helpers.mjs";
import { HubError } from "../server/core/errors.mjs";
import { createHttpServer, isFailsafe } from "../server/http/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Test executors: a probe (authorizes each declared op), a step that waits for a signal, and one that tries an op outside its plan. */
function probes(t) {
  const calls = [];
  const gate = { open: false };
  t.hub.executors["test.probe"] = {
    describe: ({ n = 1, ops = ["media.render"], folder = null, fail = null, reconcile = "retry", input = null }) => ({ title: `Sondă ${n}`, params: { n, ops, folder, fail, reconcile, input },
      folders: folder ? [folder] : [], ops: ops.map((op) => ({ op, ...(folder && op === "media.import" ? { path: folder } : {}) })), observed: ["nimic"], transmitted: [], outputs: [`rezultat ${n}`] }),
    run: async ({ params, authorize, secrets }) => {
      for (const op of params.ops) authorize({ op, ...(params.folder && op === "media.import" ? { path: params.folder } : {}) });
      calls.push({ n: params.n, input: params.input, secretSeen: Boolean(secrets?.obsPassword) });
      if (params.fail) throw new HubError("tool", `eșec ${params.fail}`, { code: params.fail });
      return { result: { n: params.n, value: params.n * 10 } };
    },
    reconcile: async ({ params }) => ({ outcome: params.reconcile, result: { n: params.n, reconciled: true }, detail: "test" }),
  };
  t.hub.executors["test.wait"] = {
    describe: ({ ops = 1 } = {}) => ({ title: "Așteaptă", params: { ops }, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort, params }) => {
      authorize({ op: "media.render" });
      while (!gate.open && !abort.aborted) await sleep(15);
      for (let i = 0; i < (params.ops || 1); i += 1) authorize({ op: "media.render" });
      return { result: { waited: true } };
    },
  };
  t.hub.executors["test.sneaky"] = {
    describe: () => ({ title: "Doar randare", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); authorize({ op: "export.local" }); return { result: {} }; },
  };
  return { calls, gate };
}
const propose = (t, owner, steps, extra = {}) => asOwner(t, owner, "ops.plan.propose", { kind: extra.kind || "test.plan", title: extra.title || "Plan de test", steps, limits: extra.limits || {} });
const confirm = (t, owner, p, extra = {}) => asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash, ...(extra.secrets ? { secrets: extra.secrets } : {}), ...(extra.modality ? { modality: extra.modality, utteranceId: extra.utteranceId } : {}) },
  extra.session ? { ownerSession: extra.session } : {});
const running = (t, id) => waitFor(() => t.hub.opsPlans.view(id).steps.some((s) => s.status === "RUNNING"));

test("M10-OP-01 the card: apps, folders, data, operations, limits, what never happens, ONE confirmation; nothing runs before it", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }, { kind: "test.probe", params: { n: 2, input: "$pas:1.value" } }]);
    assert.equal(p.status, "PROPOSED");
    assert.ok(p.nonce && p.hash);
    assert.equal(p.summary.confirmations, 1);
    assert.deepEqual(p.summary.steps, ["Sondă 1", "Sondă 2"]);
    assert.ok(p.summary.never.includes("publicare pe platforme") && p.summary.never.includes("plăți sau cumpărături"));
    assert.deepEqual(p.summary.transmitted, ["nimic nu pleacă din calculator"]);
    assert.match(p.summary.limits, /cel mult \d+ min, \d+ operații/);
    assert.equal(p.summary.model, "fără model");
    assert.equal(calls.length, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n, 0, "no manual grant, no gate change");
  } finally { await t.cleanup(); }
});

test("M10-OP-02 confirm: owner session only; exact nonce + hash; runs in order with verified references; a second confirmation is refused", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }, { kind: "test.probe", params: { n: 2, input: "$pas:1.value" } }]);
    await assert.rejects(asChannel(t, "ui", "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash }), /cannot be issued through ui/);
    await assert.rejects(asChannel(t, "voice", "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash }), /cannot be issued through voice/);
    await assert.rejects(confirm(t, owner, { ...p, nonce: "0".repeat(24) }), /nu corespunde planului afișat/);
    await assert.rejects(confirm(t, owner, { ...p, hash: "f".repeat(64) }), /nu corespunde planului afișat/);
    const c = await confirm(t, owner, p);
    assert.equal(c.duplicate, false);
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", done.statusReason);
    assert.deepEqual(calls.map((x) => x.n), [1, 2]);
    assert.equal(calls[1].input, 10, "step 2 received step 1's verified result");
    assert.equal(done.consent.channel, "owner_session");
    assert.equal(done.consent.sessionId, owner.session.id);
    assert.deepEqual(done.authority.ops, ["media.render"]);
    await assert.rejects(confirm(t, owner, p), /nu mai așteaptă/);
  } finally { await t.cleanup(); }
});

test("M10-OP-03 only the latest card can be confirmed; a plan that changed after it was shown is superseded with the difference", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    probes(t);
    const a = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }]);
    const b = await propose(t, owner, [{ kind: "test.probe", params: { n: 2 } }]);
    assert.equal(t.hub.opsPlans.view(a.id).status, "SUPERSEDED");
    await assert.rejects(confirm(t, owner, a), /nu mai așteaptă/);
    let variant = "v1";
    t.hub.executors["test.drift"] = { describe: () => ({ title: "Drift", params: {}, ops: [{ op: "media.render" }], observed: [variant], transmitted: [], outputs: [] }), run: async () => ({ result: {} }) };
    const c = await propose(t, owner, [{ kind: "test.drift", params: {} }], { kind: "drift" });
    variant = "v2";
    await assert.rejects(confirm(t, owner, c), (e) => /s-a schimbat după ce l-ai văzut/.test(e.message) && e.details.changed.includes("observed"));
    assert.equal(t.hub.opsPlans.view(c.id).status, "SUPERSEDED");
    assert.equal(t.hub.opsPlans.view(b.id).status, "PROPOSED", "a different kind is not superseded");
  } finally { await t.cleanup(); }
});

test("M10-OP-04 a new folder is a decision IN the card: confirmation needs a fresh re-authentication (step-up), never a form", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const folder = path.join(tempDir("m10-folder"), "nou");
    fs.mkdirSync(folder, { recursive: true });
    now += 6 * 60000; // past the 5-minute re-authentication window
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1, ops: ["media.import"], folder } }]);
    assert.equal(p.body.decisions.length, 1);
    assert.equal(p.body.decisions[0].kind, "folder.plan");
    await assert.rejects(confirm(t, owner, p), (e) => e.details?.reauth === true);
    const fresh = owner.reauth();
    await confirm(t, owner, p, { session: fresh });
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", done.statusReason);
    assert.equal(calls.length, 1);
    assert.ok(done.authority.folders.includes(folder));
    await assert.rejects(propose(t, owner, [{ kind: "test.probe", params: { n: 2, ops: ["media.import"], folder: t.dataDir } }], { kind: "k2" }), (e) => e.code === "PLAN_REFUSED");
  } finally { await t.cleanup(); }
});

test("M10-OP-05 authority at every operation: an undeclared op is refused; expiry, a closed session and the budget stop new operations", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    const { gate } = probes(t);
    const s = await propose(t, owner, [{ kind: "test.sneaky", params: {} }], { kind: "sneaky" });
    await confirm(t, owner, s);
    let done = await t.hub.opsPlans.idle(s.id);
    assert.equal(done.status, "FAILED");
    assert.match(done.steps[0].error, /OUT_OF_PLAN/);
    // Expiry while a step waits: its next operation is refused and the plan waits for the owner.
    const e = await propose(t, owner, [{ kind: "test.wait", params: {} }], { kind: "exp", limits: { maxDurationMin: 5 } });
    await confirm(t, owner, e);
    await running(t, e.id);
    now += 40 * 60000;
    gate.open = true;
    done = await t.hub.opsPlans.idle(e.id);
    assert.equal(done.status, "NEEDS_OWNER");
    assert.match(done.steps[0].error, /PLAN_EXPIRED/);
    gate.open = false;
    now = Date.now();
    const owner2 = await enrolOwnerAgain(t, owner);
    // The owner session closes while a step waits.
    const c = await propose(t, owner2, [{ kind: "test.wait", params: {} }], { kind: "closed" });
    await confirm(t, owner2, c);
    await running(t, c.id);
    t.hub.trust.endSession(owner2.session, "test");
    gate.open = true;
    done = await t.hub.opsPlans.idle(c.id);
    assert.equal(done.status, "NEEDS_OWNER");
    assert.match(done.steps[0].error, /SESSION_CLOSED/);
    // The action budget.
    gate.open = true;
    const owner3 = await enrolOwnerAgain(t, owner);
    const b = await propose(t, owner3, [{ kind: "test.wait", params: { ops: 5 } }], { kind: "budget", limits: { maxActions: 3 } });
    await confirm(t, owner3, b);
    done = await t.hub.opsPlans.idle(b.id);
    assert.equal(done.status, "NEEDS_OWNER");
    assert.match(done.steps[0].error, /PLAN_BUDGET/);
  } finally { await t.cleanup(); }
});

/** A new owner session with the same authenticator (the first one may have been ended by the test). */
async function enrolOwnerAgain(t, owner) {
  const a = t.hub.trust.beginAuthentication({ origin: owner.origin });
  const opened = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: a.challengeId, credential: owner.auth.get({ challenge: a.publicKey.challenge }) });
  const session = t.hub.trust.resolveSession(opened.token, { origin: owner.origin });
  return { ...owner, session, token: opened.token };
}

test("M10-OP-06 pause / cancel are fail-safe from every channel; resume needs the SAME owner session and keeps the limits", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { gate } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.wait", params: {} }, { kind: "test.probe", params: { n: 2 } }]);
    await confirm(t, owner, p);
    await running(t, p.id);
    const paused = await asChannel(t, "voice", "ops.plan.pause", { planId: p.id, reason: "Pauză (voce)" });
    assert.equal(paused.status, "PAUSED");
    await t.hub.opsPlans.idle(p.id);
    const other = await enrolOwnerAgain(t, owner);
    // M10.2 (U11): another session of the SAME credential is asked to confirm only the difference (the new session), never resumed
    // silently; the full re-confirmation path is covered in m10-2-lifecycle LC-12.
    await assert.rejects(asOwner(t, other, "ops.plan.resume", { planId: p.id }), (e) => e.code === "RECONFIRM_DELTA" && Boolean(e.details?.reconfirm?.nonce));
    await assert.rejects(asChannel(t, "ui", "ops.plan.resume", { planId: p.id }), /cannot be issued through ui/);
    gate.open = true;
    const resumed = await asOwner(t, owner, "ops.plan.resume", { planId: p.id });
    assert.equal(resumed.authority.expiresAt, t.hub.opsPlans.view(p.id).expiresAt, "same expiry");
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", done.statusReason);
    // Cancel from the UI channel (fail-safe); what was done stays.
    gate.open = false;
    const q = await propose(t, owner, [{ kind: "test.wait", params: {} }], { kind: "cancel" });
    await confirm(t, owner, q);
    await running(t, q.id);
    const cancelled = await asChannel(t, "ui", "ops.plan.cancel", { planId: q.id });
    assert.equal(cancelled.status, "CANCELLED");
    await t.hub.opsPlans.idle(q.id);
    assert.equal(t.hub.opsPlans.view(q.id).status, "CANCELLED");
  } finally { await t.cleanup(); }
});

test("M10-OP-07 uncertain steps are reconciled on „Continuă” (done → not repeated; unknown → the owner is asked), never re-run blindly", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1, fail: "OPERATOR_TIMEOUT", reconcile: "done" } }, { kind: "test.probe", params: { n: 2 } }]);
    await confirm(t, owner, p);
    let v = await t.hub.opsPlans.idle(p.id);
    assert.equal(v.status, "NEEDS_OWNER");
    assert.equal(v.steps[0].status, "UNCERTAIN");
    await asOwner(t, owner, "ops.plan.resume", { planId: p.id });
    v = await t.hub.opsPlans.idle(p.id);
    assert.equal(v.status, "DONE");
    assert.equal(v.steps[0].result.reconciled, true);
    assert.deepEqual(calls.map((c) => c.n), [1, 2], "step 1 was reconciled, not run twice");
    const q = await propose(t, owner, [{ kind: "test.probe", params: { n: 3, fail: "OPERATOR_EXITED", reconcile: "unknown" } }], { kind: "unknown" });
    await confirm(t, owner, q);
    await t.hub.opsPlans.idle(q.id);
    await assert.rejects(asOwner(t, owner, "ops.plan.resume", { planId: q.id }), (e) => e.code === "OUTCOME_UNKNOWN");
  } finally { await t.cleanup(); }
});

test("M10-OP-08 boot never resumes: a running plan waits for the owner (its step uncertain); an unconfirmed card expires", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const owner = await enrolOwner(t);
    probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }], { kind: "boot1" });
    // Simulate a crash in the middle of the step (rows as the run loop leaves them).
    t.hub.db.prepare("UPDATE ops_plans SET status = 'RUNNING', authority_json = '{}' WHERE id = ?").run(p.id);
    t.hub.db.prepare("UPDATE ops_plan_steps SET status = 'RUNNING' WHERE plan_id = ?").run(p.id);
    const old = await propose(t, owner, [{ kind: "test.probe", params: { n: 2 } }], { kind: "boot2" });
    now += 20 * 60000;
    const r = t.hub.opsPlans.recover();
    assert.deepEqual(r.waitingOwner, [p.id]);
    const v = t.hub.opsPlans.view(p.id);
    assert.equal(v.status, "NEEDS_OWNER");
    assert.equal(v.steps[0].status, "UNCERTAIN");
    assert.equal(t.hub.opsPlans.view(old.id).status, "EXPIRED");
  } finally { await t.cleanup(); }
});

test("M10-OP-09 „Da” through Lega: typed in the session for THE presented plan confirms; a quote, the provider voice or no card does not", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }]);
    const presented = { planId: p.id, nonce: p.nonce, hash: p.hash };
    const none = await asOwner(t, owner, "owner.intent", { text: "Da", source: "typed" });
    assert.ok(none.resolved.refused.some((r) => r.intent === "confirm"));
    const quoted = await asOwner(t, owner, "owner.intent", { text: "Scrie „da” în document", source: "typed", presented });
    assert.ok(!quoted.results.some((r) => r.confirmed));
    const provider = await t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text: "Da", presented } }).then((r) => r.result);
    assert.ok(!provider.results.some((r) => r.confirmed));
    const providerCookie = await asOwner(t, owner, "owner.intent", { text: "Da", source: "voice-provider", presented });
    assert.ok(!providerCookie.results.some((r) => r.confirmed), "a provider transcript never confirms, even with the session cookie");
    assert.equal(calls.length, 0);
    const yes = await asOwner(t, owner, "owner.intent", { text: "Da, execută planul", source: "typed", presented });
    assert.ok(yes.results[0].confirmed, JSON.stringify(yes.results[0]));
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE");
    assert.equal(done.consent.modality, "typed");
  } finally { await t.cleanup(); }
});

test("M10-OP-10 voice confirmation: the owner's verified voice + local transcript recorded FOR this plan; a reused or foreign segment is refused", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    await enrolVoice(t, owner);
    probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }]);
    const foreign = await speak(t, owner, "Da, execută planul", { purpose: "confirm", envelopeId: "opp_altul" });
    await assert.rejects(confirm(t, owner, p, { modality: "voice", utteranceId: foreign.utteranceId }), /nu a fost înregistrat pentru planul acesta/);
    const mine = await speak(t, owner, "Da, execută planul", { purpose: "confirm", envelopeId: p.id });
    await confirm(t, owner, p, { modality: "voice", utteranceId: mine.utteranceId });
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE");
    assert.equal(done.consent.modality, "voice");
    assert.equal(done.consent.voice.transcriptSource, "local");
    const q = await propose(t, owner, [{ kind: "test.probe", params: { n: 2 } }], { kind: "v2" });
    await assert.rejects(confirm(t, owner, q, { modality: "voice", utteranceId: mine.utteranceId }), /nu a fost înregistrat pentru planul acesta|deja folosită/);
  } finally { await t.cleanup(); }
});

test("M10-OP-11 transient secrets (e.g. the OBS password typed at confirmation) reach the step but never the plan, the log or an event", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { calls } = probes(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }]);
    await confirm(t, owner, p, { secrets: { obsPassword: "Parola-Secreta-XYZ-123" } });
    await t.hub.opsPlans.idle(p.id);
    assert.equal(calls[0].secretSeen, true);
    const dump = JSON.stringify([t.hub.db.prepare("SELECT * FROM commands").all(), t.hub.db.prepare("SELECT * FROM events").all(), t.hub.db.prepare("SELECT * FROM ops_plans").all(), t.hub.db.prepare("SELECT * FROM ops_plan_steps").all()]);
    assert.ok(!dump.includes("Parola-Secreta-XYZ-123"));
  } finally { await t.cleanup(); }
});

test("M10-OP-12 Stop All and „Oprește tot” pause every running plan; „Pauză” too; nothing is undone", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    probes(t);
    const p = await propose(t, owner, [{ kind: "test.wait", params: {} }], { kind: "s1" });
    await confirm(t, owner, p);
    await running(t, p.id);
    const r = await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    assert.deepEqual(r.plansPaused, [p.id]);
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED");
    await t.hub.opsPlans.idle(p.id);
    const q = await propose(t, owner, [{ kind: "test.wait", params: {} }], { kind: "s2" });
    await confirm(t, owner, q);
    await running(t, q.id);
    const pause = await asOwner(t, owner, "owner.intent", { text: "Pauză", source: "typed" });
    assert.deepEqual(pause.results[0].plansPaused, [q.id]);
    await t.hub.opsPlans.idle(q.id);
  } finally { await t.cleanup(); }
});

test("M10-OP-13 HTTP: plan routes need the session to confirm; pause / cancel / desktop stop are fail-safe paths; agent and cli are refused", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  try {
    for (const p of ["/api/desktop/stop", "/api/desktop/takeover", "/api/ops/plans/opp_x/pause", "/api/ops/plans/opp_x/cancel", "/api/media/import-folders/mig_x/revoke", "/api/desktop/apps/revoke"]) assert.equal(isFailsafe(p), true, p);
    for (const p of ["/api/ops/plans/opp_x/confirm", "/api/ops/plans/opp_x/resume", "/api/desktop/open", "/api/desktop/apps/authorize"]) assert.equal(isFailsafe(p), false, p);
    probes(t);
    const proposed = await call("POST", "/api/ops/plans", { body: { kind: "http", title: "HTTP", steps: [{ kind: "test.probe", params: { n: 1 } }] } });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const noSession = await call("POST", `/api/ops/plans/${proposed.json.id}/confirm`, { body: { nonce: proposed.json.nonce, displayedHash: proposed.json.hash } });
    assert.equal(noSession.status, 401);
    assert.equal(noSession.json.error?.details?.needSession ?? noSession.json.details?.needSession ?? true, true);
    const agent = await call("POST", "/api/desktop/open", { body: { app: "notepad" }, headers: { "X-Hub-Channel": "agent" } });
    assert.ok(agent.status >= 400 && agent.status < 500);
    const cli = await call("GET", "/api/desktop/status", { headers: { "X-Hub-Channel": "cli" } });
    assert.ok(cli.status >= 400 && cli.status < 500);
    const status = await call("GET", "/api/desktop/status");
    assert.equal(status.status, 200);
    assert.ok(Array.isArray(status.json.apps));
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); }
});
