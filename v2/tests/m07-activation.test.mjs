// Milestone 07 — activation plumbing (PASS_SIMULATED, no model): the delegated-agent channel (recorded as the agent, never as
// a click), the UI–API contract handshake, the canonical origin redirect, the resumable setup orchestrator and the envelope's
// binding to the environment attestation (M06 bound nothing).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants } from "./helpers.mjs";
import { createHttpServer, isFailsafe } from "../server/http/server.mjs";
import { API_CONTRACT, HUB_VERSION } from "../server/config.mjs";
import { AGENT_COMMANDS, checkDelegation } from "../server/runtime/commands.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";

function httpClient(t, token) {
  return (p, { method = "GET", body, host = `localhost:${t.config.port}`, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, path: p, method, headers: { Host: host, ...(method !== "GET" ? { "X-Hub-Token": token } : {}), ...(data ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json, headers: res.headers, text }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

test("M07-AC-01 the agent channel: only delegated commands, only with a delegation reference, recorded as the agent (never as the owner's click)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const agent = (type, payload, delegation = "proprietar în conversație, M07 §03") => hub.commands.dispatch({ type, payload, channel: "agent", actor: "whoever", delegation });
    await assert.rejects(agent("backup.run", { projectId: hub.projects.hub().id }, ""), /referință de delegare/);
    assert.throws(() => checkDelegation("x\u0000yyyyyyyy"), /referință/);
    await assert.rejects(agent("envelope.confirm", { envelopeId: "x", nonce: "n", displayedHash: "h" }), /not delegated/);
    await assert.rejects(agent("owner.policy.activate", { text: "x" }), /not delegated/);
    await assert.rejects(agent("voice.enroll.finish", { consentText: "x" }), /not delegated/);
    assert.ok(!AGENT_COMMANDS.has("envelope.confirm") && !AGENT_COMMANDS.has("owner.autonomy.set") && !AGENT_COMMANDS.has("gate.set"), "the owner's own decisions are never delegable");
    const r = await agent("mode.set", { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" });
    const row = hub.db.prepare("SELECT actor, channel, intent_text FROM commands WHERE id = ?").get(r.command.id);
    assert.deepEqual([row.actor, row.channel], ["agent", "agent"]);
    assert.match(row.intent_text, /^\[delegat\] proprietar în conversație, M07 §03/);
    assert.equal(hub.settings.get("mode"), "LIVE_VALIDATION");
    // Over HTTP: the headers say so; without them the request is the owner's UI as before.
    const { server, token } = createHttpServer(hub);
    await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
    try {
      const req = httpClient(t, token);
      const refused = await req("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" }, headers: { "X-Hub-Channel": "agent" } });
      assert.equal(refused.status, 403);
      const ok = await req("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" }, headers: { "X-Hub-Channel": "agent", "X-Hub-Delegation": encodeURIComponent("proprietar în conversație, M07 §03") } });
      assert.equal(ok.status, 200);
      const last = hub.db.prepare("SELECT actor, channel, intent_text FROM commands WHERE type = 'mode.set' ORDER BY created_at DESC LIMIT 1").get();
      assert.deepEqual([last.actor, last.channel], ["agent", "agent"]);
      assert.match(last.intent_text, /proprietar în conversație, M07 §03/, "the percent-encoded UTF-8 reference is decoded");
      const catalog = await req("/api/commands/catalog");
      assert.ok(catalog.json.channels.includes("agent") && catalog.json.channels.includes("owner"));
    } finally { server.close(); }
  } finally { await t.cleanup(); }
});

test("M07-AC-02 an approval decided by an agent records the agent and the delegation, not 'user/ui'", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    await prepareLiveWithoutGrants(hub);
    const dir = path.join(t.dataDir, "factory-x");
    materializeFixture("bug-demo", dir);
    const project = (await hub.commands.dispatch({ type: "project.register_test", payload: { path: dir }, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" })).result;
    const { mission } = (await hub.commands.dispatch({ type: "factory.prepare", payload: { projectId: project.id, ...demoSpec("bug-demo") }, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" })).result;
    const scope = hub.factory.view(mission.id).scope;
    const asked = await hub.commands.dispatch({ type: "factory.start", payload: { missionId: mission.id, ...scope }, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" });
    assert.equal(asked.approvalRequired, true);
    const decided = (await hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: asked.approval.id, decision: "rejected", displayedHash: asked.approval.payloadHash }, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" })).result;
    assert.equal(decided.status, "rejected");
    const row = hub.db.prepare("SELECT decided_by, decided_via, decision_note AS note FROM approvals WHERE id = ?").get(asked.approval.id);
    assert.equal(row.decided_by, "agent"); assert.equal(row.decided_via, "agent"); assert.match(row.note, /\[delegat\]/);
  } finally { await t.cleanup(); }
});

test("M07-AC-03 the UI–API contract: reported everywhere; a stale page's mutating request is refused (409 UI_STALE) except fail-safes; scripts unaffected", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
  try {
    const req = httpClient(t, token);
    const session = await req("/api/session");
    assert.equal(session.json.apiContract, API_CONTRACT); assert.equal(session.json.version, HUB_VERSION);
    assert.equal((await req("/api/health")).json.apiContract, API_CONTRACT);
    assert.equal(session.headers["x-hub-contract"], String(API_CONTRACT));
    const stale = await req("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" }, headers: { "X-Hub-UI-Contract": "1" } });
    assert.equal(stale.status, 409); assert.equal(stale.json.error.code, "UI_STALE");
    assert.equal((await req("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" }, headers: { "X-Hub-UI-Contract": String(API_CONTRACT) } })).status, 200);
    assert.equal((await req("/api/mode", { method: "POST", body: { mode: "BUILD_SAFE" } })).status, 200, "no header (scripts, tests) → accepted");
    assert.notEqual((await req("/api/stop-all", { method: "POST", body: {}, headers: { "X-Hub-UI-Contract": "1" } })).status, 409);
    for (const p of ["/api/stop-all", "/api/runs/run_1/interrupt", "/api/factory/m1/stop", "/api/factory/m1/pause", "/api/envelopes/e/revoke", "/api/owner/logout"]) assert.ok(isFailsafe(p), p);
    for (const p of ["/api/factory/m1/start", "/api/envelopes/e/confirm", "/api/gate/open", "/api/mode", "/api/stop-all/x"]) assert.ok(!isFailsafe(p), p);
    // The gate: suspending is a fail-safe, opening is not (review M07).
    assert.equal(isFailsafe("/api/gate", { action: "suspend" }), true);
    assert.equal(isFailsafe("/api/gate", { action: "open", confirm: "OPEN GATE" }), false);
    assert.equal(isFailsafe("/api/gate"), false);
    const openStale = await req("/api/gate", { method: "POST", body: { action: "open", confirm: "OPEN GATE" }, headers: { "X-Hub-UI-Contract": "1" } });
    assert.equal(openStale.status, 409, "a stale page cannot open the gate");
    assert.notEqual((await req("/api/gate", { method: "POST", body: { action: "suspend" }, headers: { "X-Hub-UI-Contract": "1" } })).status, 409, "but it can suspend it");
  } finally { server.close(); await t.cleanup(); }
});

test("M07-AC-04 the canonical origin: a page navigation to 127.0.0.1 goes to localhost (path, query kept); /api, scripts and iframes never redirected", async () => {
  const t = await makeTestHub({ configOverrides: { canonicalRedirect: true } });
  const { server, token } = createHttpServer(t.hub);
  await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
  try {
    const req = httpClient(t, token);
    const ip = `127.0.0.1:${t.config.port}`;
    const nav = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
    const r = await req("/lega?x=1", { host: ip, headers: nav });
    assert.equal(r.status, 307); assert.equal(r.headers.location, `http://localhost:${t.config.port}/lega?x=1`); assert.equal(r.headers["cache-control"], "no-store");
    assert.notEqual((await req("/api/health", { host: ip, headers: nav })).status, 307, "the API is never redirected");
    assert.notEqual((await req("/assets/x.js", { host: ip, headers: { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" } })).status, 307);
    assert.notEqual((await req("/", { host: ip, headers: { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" } })).status, 307);
    assert.notEqual((await req("/", { headers: nav })).status, 307, "already on localhost");
    assert.equal((await req("/", { host: "evil.example:80", headers: nav })).status, 403, "the host allowlist is unchanged");
  } finally { server.close(); await t.cleanup(); }
  const plain = await makeTestHub();
  try { assert.equal(plain.config.canonicalRedirect, false, "tests opt in explicitly"); } finally { await plain.cleanup(); }
});

test("M07-AC-05 the setup lists the real steps in order; the automatic ones run on the Hub and become DONE_AUTO; personal ones wait for you; a refresh changes nothing", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    const origin = `http://localhost:${t.config.port}`;
    const first = hub.setup.steps({ origin, uiContract: API_CONTRACT });
    const ids = first.steps.map((s) => s.id);
    assert.deepEqual(ids.slice(0, 4), ["version_match", "canonical_origin", "migration", "backup"]);
    for (const id of ["env_inspected", "env_account", "env_attested", "deps_pipeline", "deps_voice", "owner_credential", "policy_active", "voice_profile", "test_project_trusted", "voice_mission"]) assert.ok(ids.includes(id), id);
    assert.equal(first.steps.find((s) => s.id === "owner_credential").status, "NEEDS_OWNER");
    assert.equal(first.steps.find((s) => s.id === "policy_active").status, "BLOCKED");
    assert.equal(hub.setup.steps({ origin: `http://127.0.0.1:${t.config.port}`, uiContract: API_CONTRACT }).steps.find((s) => s.id === "canonical_origin").status, "NEEDS_OWNER");
    assert.equal(hub.setup.steps({ origin, uiContract: API_CONTRACT - 1 }).steps[0].status, "RECOVERABLE_ERROR");
    assert.deepEqual(first.pendingAutomatic.slice(0, 2), ["backup", "env_inspected"]);
    assert.throws(() => hub.setup.runAutomatic({ channel: "agent", actor: "agent", delegation: "" }), /referință/);
    const started = hub.setup.runAutomatic({ channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" });
    assert.deepEqual(started.steps.slice(0, 2), ["backup", "env_inspected"]);
    assert.throws(() => hub.setup.runAutomatic({}), /rulează deja/);
    await waitFor(() => hub.setup.steps({ origin }).automatic?.finishedAt, 60000, 100);
    const after = hub.setup.steps({ origin, uiContract: API_CONTRACT });
    const auto = ["backup", "env_inspected", "env_account", "env_attested"].map((id) => after.steps.find((s) => s.id === id));
    for (const id of ["backup", "env_inspected"]) assert.equal(after.steps.find((s) => s.id === id).status, "DONE_AUTO", `${id}: ${after.steps.find((s) => s.id === id).detail}`);
    // Every automatic step either finished, or the FIRST failure is shown with its cause and the later ones say they were not run.
    const firstFail = auto.findIndex((s) => s.status !== "DONE_AUTO");
    if (firstFail >= 0) {
      assert.equal(auto[firstFail].status, "RECOVERABLE_ERROR", `${auto[firstFail].id}: ${auto[firstFail].status}`);
      assert.ok(auto[firstFail].detail.length > 3);
      for (const s of auto.slice(firstFail + 1)) assert.match(s.detail, /nerulat: oprit după eroarea/, s.id);
    }
    const agentRows = hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE actor = 'agent' AND channel = 'agent' AND type IN ('backup.run','environment.inspect','environment.probe','environment.attest')").get().n;
    assert.ok(agentRows >= 3, "the delegated runs are recorded as the agent");
    // Owner steps follow the real state.
    await enrolOwner(t, { activatePolicy: true });
    const owned = hub.setup.steps({ origin, uiContract: API_CONTRACT, session: null });
    assert.equal(owned.steps.find((s) => s.id === "owner_credential").status, "DONE_OWNER");
    assert.equal(owned.steps.find((s) => s.id === "policy_active").status, "DONE_OWNER");
    assert.deepEqual(hub.setup.steps({ origin, uiContract: API_CONTRACT }).steps.map((s) => s.status), owned.steps.map((s) => s.status), "a refresh is idempotent");
  } finally { await t.cleanup(); }
});

test("M07-AC-06 an envelope on the environment route is bound to the attestation (id, status, fingerprint); a re-attestation changes the plan", async () => {
  const t = await makeTestHub({ wsl: true, queues: true });
  try {
    const { hub } = t;
    await prepareLiveWithoutGrants(hub);
    const dir = path.join(t.dataDir, "factory-env");
    materializeFixture("bug-demo", dir);
    const project = (await hub.commands.dispatch({ type: "project.register_test", payload: { path: dir }, channel: "test", actor: "t" })).result;
    await hub.commands.dispatch({ type: "environment.inspect", payload: {}, channel: "test", actor: "t" });
    await hub.commands.dispatch({ type: "environment.attest", payload: { allowRestart: true }, channel: "test", actor: "t" });
    await hub.commands.dispatch({ type: "project.environment.set", payload: { projectId: project.id, environment: "wsl-runner" }, channel: "test", actor: "t" });
    await hub.commands.dispatch({ type: "factory.prepare", payload: { projectId: project.id, ...demoSpec("bug-demo") }, channel: "test", actor: "t" });
    const a = (await hub.commands.dispatch({ type: "envelope.propose", payload: { projectId: project.id }, channel: "test", actor: "t" })).result.envelope;
    const ref = a.body.attestations?.[0] || a.body.environment?.attestations?.[0] || JSON.stringify(a.body).match(/"attestationId":"([^"]+)"/)?.[1];
    assert.ok(ref, "the plan names the attestation");
    assert.ok(JSON.stringify(a.body).includes("att_") || JSON.stringify(a.body).includes("\"attestationId\":\""), JSON.stringify(a.body).slice(0, 300));
    assert.ok(!JSON.stringify(a.body).includes("\"attestationId\":null"), "not null any more");
    await hub.commands.dispatch({ type: "environment.attest", payload: { allowRestart: true }, channel: "test", actor: "t" });
    const b = (await hub.commands.dispatch({ type: "envelope.propose", payload: { projectId: project.id }, channel: "test", actor: "t" })).result.envelope;
    assert.notEqual(a.envelopeHash, b.envelopeHash, "a new attestation is a new plan (the old confirmation would not match)");
  } finally { await t.cleanup(); }
});

// ---------- regressions from the M07 adversarial review ----------

test("M07-AC-07 a plan never runs above the project's autonomy; lowering the level supersedes a waiting plan above it", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    await prepareLiveWithoutGrants(hub);
    const dir = path.join(t.dataDir, "factory-lvl");
    materializeFixture("bug-demo", dir);
    const project = (await hub.commands.dispatch({ type: "project.register_test", payload: { path: dir }, channel: "test", actor: "t" })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await hub.commands.dispatch({ type: "factory.prepare", payload: { projectId: project.id, ...demoSpec("bug-demo") }, channel: "test", actor: "t" });
    // The project is ASSISTED (default for a test project): asking a TRUSTED plan is refused.
    await assert.rejects(hub.commands.dispatch({ type: "envelope.propose", payload: { projectId: project.id, level: "TRUSTED" }, channel: "ui", actor: "user" }), /peste nivelul proiectului/);
    await hub.commands.dispatch({ type: "owner.autonomy.set", payload: { projectId: project.id, level: "TRUSTED" }, channel: "test", actor: "t", ownerSession: owner.reauth() });
    const env = (await hub.commands.dispatch({ type: "envelope.propose", payload: { projectId: project.id }, channel: "test", actor: "t" })).result.envelope;
    assert.equal(env.autonomyLevel, "TRUSTED");
    await hub.commands.dispatch({ type: "owner.autonomy.set", payload: { projectId: project.id, level: "OBSERVE" }, channel: "test", actor: "t", ownerSession: owner.session });
    assert.equal(hub.envelopes.get(env.id).status, "SUPERSEDED", "a waiting plan above the new level cannot be confirmed any more");
    await assert.rejects(hub.commands.dispatch({ type: "envelope.confirm", payload: { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, channel: "test", actor: "t", ownerSession: owner.session }), /nu mai așteaptă/);
  } finally { await t.cleanup(); }
});

test("M07-AC-08 every route honours the agent channel: the generic command route records it, owner routes refuse it, execute needs a delegation, approvals beyond the factory scope are not delegated", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
  try {
    const req = httpClient(t, token);
    const agentHeaders = { "X-Hub-Channel": "agent", "X-Hub-Delegation": encodeURIComponent("proprietar în conversație, M07 §03") };
    const generic = await req("/api/commands", { method: "POST", body: { type: "mode.set", payload: { mode: "BUILD_SAFE" } }, headers: agentHeaders });
    assert.equal(generic.status, 200);
    const row = t.hub.db.prepare("SELECT actor, channel FROM commands WHERE type = 'mode.set' ORDER BY created_at DESC LIMIT 1").get();
    assert.deepEqual([row.actor, row.channel], ["agent", "agent"]);
    assert.equal((await req("/api/commands", { method: "POST", body: { type: "gate.set", payload: { action: "suspend" } }, headers: agentHeaders })).status, 403, "not delegated");
    assert.equal((await req("/api/owner/unfreeze", { method: "POST", body: { projectId: "x" }, headers: agentHeaders })).status, 403, "owner routes refuse a declared agent");
    assert.equal((await req("/api/commands/cmd_x/execute", { method: "POST", body: {}, headers: { "X-Hub-Channel": "agent" } })).status, 403, "no delegation → refused");
    // An approval of another kind (not the factory start) is not delegated.
    const approval = t.hub.bus.transaction(() => t.hub.approvals.request({ actionKind: "sales.suppression_lift", target: "x", payload: { a: 1 }, codeVersion: "hub", permissionTier: "SENSITIVE_ACTIONS", scopeType: "command", scopeId: "c1", requestedBy: "user:ui", ttlMinutes: 60 }));
    const decided = await req("/api/approvals/" + approval.id + "/decide", { method: "POST", body: { decision: "approved", displayedHash: approval.payloadHash }, headers: agentHeaders });
    assert.equal(decided.status, 403, JSON.stringify(decided.json));
    assert.equal(t.hub.approvals.get(approval.id).status, "pending");
  } finally { server.close(); await t.cleanup(); }
});

test("M07-AC-09 a backup that is not verified stops the automatic setup steps and shows as a recoverable error", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    hub.backups.run = async () => ({ id: "bkp_fail", status: "failed", error: "disc plin (simulat)" });
    hub.setup.runAutomatic({ channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" });
    await waitFor(() => hub.setup.steps({}).automatic?.finishedAt, 30000, 100);
    const steps = hub.setup.steps({ origin: `http://localhost:${t.config.port}` }).steps;
    assert.equal(steps.find((s) => s.id === "backup").status, "RECOVERABLE_ERROR");
    assert.match(steps.find((s) => s.id === "env_inspected").detail, /nerulat: oprit după eroarea/);
  } finally { await t.cleanup(); }
});

test("M07-AC-10 the delegation covers test projects only: an agent's grant, route, mission or run on a real project is refused; fail-safes stay open everywhere; a declared script never runs the setup as the owner", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const agent = (type, payload) => hub.commands.dispatch({ type, payload, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" });
    const real = hub.projects.hub(); // the Hub's own project: source registry, a real project
    assert.notEqual(hub.db.prepare("SELECT source FROM projects WHERE id = ?").get(real.id).source, "hub-test");
    await agent("mode.set", { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" });
    await assert.rejects(agent("grant.create", { provider: "codex", projectId: real.id, access: "workspace-write", maxAttempts: 1, ttlMinutes: 30 }), /doar proiectele de test/);
    await assert.rejects(agent("grant.create", { provider: "codex", projectId: real.slug, access: "read-only", maxAttempts: 1, ttlMinutes: 30 }), /doar proiectele de test/, "by slug too");
    await assert.rejects(agent("project.environment.set", { projectId: real.id, environment: "wsl-runner" }), /doar proiectele de test/);
    await assert.rejects(agent("conversation.create", { projectId: real.id, title: "x" }), /doar proiectele de test/);
    const conv = hub.conversations.create({ projectId: real.id, title: "owner's" }, "test");
    await assert.rejects(agent("conversation.message", { conversationId: conv.id, content: "x" }), /doar proiectele de test/);
    await assert.rejects(agent("run.start", { conversationId: conv.id, provider: "claude", access: "read-only" }), /doar proiectele de test/);
    await assert.rejects(agent("grant.create", { provider: "codex", access: "read-only", maxAttempts: 1, ttlMinutes: 30 }), /doar proiectele de test/, "no project named: refused");
    await assert.rejects(agent("environment.policy.approve", { environmentId: "wsl-runner", confirmText: "x", fingerprintHash: "x" }), /not delegated/, "approving policy (b) is the owner's");
    // A test project: the same delegated commands pass the scope check.
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await agent("project.register_test", { path: dir })).result;
    const g = (await agent("grant.create", { provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 1, ttlMinutes: 30 })).result;
    assert.equal(g.projectId, project.id);
    const { mission } = (await agent("factory.prepare", { projectId: project.id, ...demoSpec("bug-demo") })).result;
    assert.ok(mission.id);
    // A forged extra field naming the test project never covers the real target (M07 review round 2): every field is checked.
    await assert.rejects(agent("run.start", { conversationId: conv.id, projectId: project.id, provider: "claude", access: "read-only" }), /decizi tu \(conversationId\)/);
    await assert.rejects(agent("conversation.message", { conversationId: conv.id, missionId: mission.id, content: "x" }), /decizi tu \(conversationId\)/);
    await assert.rejects(agent("factory.limits", { missionId: "mis_does_not_exist", projectId: project.id }), /decizi tu \(missionId\)/);
    // A run's task must belong to the conversation's project (every channel).
    const testConv = (await agent("conversation.create", { projectId: project.id, title: "probe" })).result;
    const realMission = hub.missions.create({ projectId: real.id, kind: "eng_bugfix", title: "owner's mission", objective: "an owner mission on a real project" }, "test");
    const realTask = hub.db.prepare("SELECT id FROM tasks WHERE mission_id = ? LIMIT 1").get(realMission.id);
    assert.ok(realTask, "the real mission has a task");
    await assert.rejects(agent("run.start", { conversationId: testConv.id, provider: "claude", access: "read-only", taskId: realTask.id }), /decizi tu \(taskId\)/);
    await assert.rejects(hub.runs.start({ conversationId: testConv.id, provider: "claude", access: "read-only", taskId: realTask.id, actor: "test" }), /altui proiect/);
    await assert.rejects(agent("factory.start", { missionId: realMission.id, projectId: project.id }), /decizi tu \(missionId\)/);
    // Fail-safes are never restricted: revoking, interrupting and Stop All work on any project.
    await agent("grant.revoke", { grantId: g.id });
    await agent("system.stop_all", { reason: "test" });
    // The setup route: a script that declares itself (cli) is refused instead of being recorded as the owner's click.
    const { server, token } = createHttpServer(hub);
    await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
    try {
      const cli = await httpClient(t, token)("/api/setup/run", { method: "POST", body: {}, headers: { "X-Hub-Channel": "cli", "X-Hub-UI-Contract": String(API_CONTRACT) } });
      assert.equal(cli.status, 403, cli.text);
      assert.match(cli.json?.error?.message || "", /canalul cli/);
    } finally { await new Promise((res) => server.close(res)); }
  } finally { await t.cleanup(); }
});
