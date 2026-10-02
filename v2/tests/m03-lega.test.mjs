import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { CODEX_ALLOWED_METHODS } from "../server/providers/codex.mjs";
import { CODEX_VOICE_ALLOWED_METHODS, CODEX_VOICE_EXTRA_ARGS, mcpDisableArgs } from "../server/providers/codex-realtime.mjs";
import { inspectRealtimeKeys } from "../server/providers/codex.mjs";
import { LEGA_CONSENT_TEXT, LEGA_CONSENT_VERSION, validateOfferSdp, speakable, legaDynamicTools } from "../server/policy/lega-policy.mjs";
import { parseVoiceCommand } from "../server/domain/voice.mjs";

// Lega = voice assistant (GPT-Live through the Codex app-server, thread/realtime/*). All tests use the fake app-server:
// signaling only, no network, no audio, no model.
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const dispatch = async (hub, type, payload = {}, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: "user", channel })).result;

async function enableLega(hub, { voiceGrant = true, consent = true, sessions = 3, maxDurationS = 600 } = {}) {
  await enableLive(hub, { provider: "codex" });
  if (consent) hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  if (voiceGrant) return hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: sessions, maxDurationS, ttlMinutes: 30, kind: "voice" }, "test"));
  return null;
}
const liveEvents = (hub) => { const events = []; hub.live.subscribe((e) => events.push(e)); return events; };
const startLega = (hub) => dispatch(hub, "lega.session.start", { sdp: OFFER });
const legaEnded = (hub) => waitFor(() => (hub.lega.state()?.status === "ended" ? hub.lega.state() : null), 15000);

test("M03-LEGA-01 voice process allowlist is narrow and separate; run processes cannot reach realtime", () => {
  for (const m of ["thread/realtime/start", "thread/realtime/stop", "thread/realtime/appendSpeech", "thread/start", "turn/interrupt", "mcpServerStatus/list"]) assert.ok(CODEX_VOICE_ALLOWED_METHODS.has(m), m);
  for (const m of ["turn/start", "thread/resume", "thread/realtime/appendText", "thread/realtime/appendAudio", "model/list", "config/batchWrite"]) assert.equal(CODEX_VOICE_ALLOWED_METHODS.has(m), false, m);
  for (const m of [...CODEX_ALLOWED_METHODS]) assert.equal(m.startsWith("thread/realtime/"), false, `run allowlist must not contain ${m}`);
  // An empty mcp_servers={} override is a no-op (Codex deep-merges config layers): servers are disabled by name instead.
  assert.equal(CODEX_VOICE_EXTRA_ARGS.includes("mcp_servers={}"), false);
  assert.deepEqual(mcpDisableArgs(["fs", "git_tools", "bad.name", "x=y"]), ["-c", "mcp_servers.fs.enabled=false", "-c", "mcp_servers.git_tools.enabled=false"]);
  assert.ok(CODEX_VOICE_EXTRA_ARGS.includes('experimental_realtime_ws_backend_prompt=""'));
  assert.ok(CODEX_VOICE_EXTRA_ARGS.includes("agents.enabled=false"), "no subagents behind Lega");
  const keys = inspectRealtimeKeys({ mcp_servers: { fs: {}, "bad.name": {} }, realtime: { type: "transcription" }, experimental_realtime_start_instructions: "x" });
  assert.deepEqual(keys.mcpServerNames, ["fs"]);
  for (const k of ["realtime.type", "experimental_realtime_start_instructions", "mcp_servers.<nume neadresabil>"]) assert.ok(keys.riskyKeys.includes(k), k);
  const tools = legaDynamicTools({ projects: [{ id: "p1", name: "Ifrim Hub Test" }] })[0];
  assert.equal(tools.type, "namespace");
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["company_briefing", "how_to", "hub_status", "list_missions", "list_projects", "mission_detail", "navigate", "open_cockpit", "pause",
    "pending_approvals", "point", "prepare_grant", "project_brief", "propose_mission", "propose_run", "recent_runs", "sales_drafts", "sales_lead", "sales_overview", "stop_all"]);
  assert.deepEqual(tools.tools.find((t) => t.name === "propose_run").inputSchema.properties.project.enum, ["Ifrim Hub Test"]);
});

test("M03-LEGA-02 policy helpers: SDP validation, speakable text, Lega prefix in voice commands", () => {
  assert.equal(validateOfferSdp(OFFER), null);
  assert.match(validateOfferSdp("hello"), /v=0/);
  assert.match(validateOfferSdp("v=0\r\nm=audio 9 x\r\n"), /data channel/);
  assert.match(validateOfferSdp(`v=0\r\nm=audio 1\r\nm=application 1\r\n${"a".repeat(70000)}`), /64 KB/);
  assert.equal(speakable("[FINAL] Gata. ```js\nconst x = 1;\n``` Rezultatul `ok`."), "Gata. (cod omis) Rezultatul ok.");
  assert.equal(parseVoiceCommand("Lega, oprește tot", { legaPrefix: true }).command, "stop_all");
  assert.equal(parseVoiceCommand("Lega, deschide aprobările", { legaPrefix: true }).path, "/approvals");
  assert.equal(parseVoiceCommand("Lega aprobă tot", { legaPrefix: true }).kind, "refused");
  assert.equal(parseVoiceCommand("Lega, oprește tot").kind, "message", "without legaPrefix the name is not stripped");
  assert.equal(parseVoiceCommand("Lega, oprește", { legaPrefix: true }).addressed, true);
  const bare = parseVoiceCommand("Oprește", { legaPrefix: true });
  assert.deepEqual([bare.command, bare.addressed, bare.explicit], ["stop_all", false, false], "a bare 'oprește' is neither addressed nor explicit");
  assert.equal(parseVoiceCommand("oprește tot", { legaPrefix: true }).explicit, true);
});

test("M03-LEGA-03 gate: BUILD_SAFE, missing voice grant, missing consent and grant-kind mixups are refused before any process starts", async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  try {
    const { hub } = t;
    await assert.rejects(startLega(hub), (e) => e.category === "gate" && e.details.checks.find((c) => c.id === "mode").ok === false);
    await enableLega(hub, { voiceGrant: false, consent: false });
    const refused = await startLega(hub).catch((e) => e);
    const failed = refused.details.checks.filter((c) => !c.ok).map((c) => c.id).sort();
    assert.deepEqual(failed, ["lega_consent", "voice_grant"], "the run grant created by enableLive does not admit a voice session");
    assert.match(refused.details.checks.find((c) => c.id === "voice_grant").detail, /Niciun grant de voce/);
    const voiceGrant = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 1, maxDurationS: 300, ttlMinutes: 30, kind: "voice" }, "test"));
    // A voice grant never admits an agent run.
    const runGate = hub.gate.evaluate({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", grantId: voiceGrant.id });
    assert.match(runGate.checks.find((c) => c.id === "live_grant").detail, /Lega/);
    assert.equal(t.readLog("codex").filter((l) => l.launchArgs).length, 1 + 0, "only the enableLive probe spawned an app-server");
    assert.throws(() => hub.grants.create({ provider: "claude", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 1, maxDurationS: 300, ttlMinutes: 30, kind: "voice" }, "test"), /Codex/);
    assert.throws(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "workspace-write", maxAttempts: 1, maxDurationS: 300, ttlMinutes: 30, kind: "voice" }, "test"), /read-only/);
    await assert.rejects(dispatch(hub, "lega.session.start", { sdp: "not an sdp" }), (e) => e.category === "validation");
  } finally { await t.cleanup(); }
});

test("M03-LEGA-04 happy path: separate experimental app-server, no environments, lega tools, WebRTC v3; SDP never logged; stop order", async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  try {
    const { hub } = t;
    const grant = await enableLega(hub);
    const events = liveEvents(hub);
    const started = await startLega(hub);
    assert.ok(started.answerSdp.startsWith("v=0"));
    assert.equal(started.voice, "cove");
    assert.equal(hub.lega.state().status, "connecting");
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 1, "one session consumed one voice-grant attempt");
    const log = t.readLog("codex");
    const inits = log.filter((l) => l.method === "initialize");
    assert.deepEqual(inits.map((l) => l.params.capabilities.experimentalApi), [false, true], "probe stays non-experimental; only the Lega process opts in");
    const threadStart = log.filter((l) => l.method === "thread/start").at(-1).params;
    assert.equal(threadStart.ephemeral, true);
    assert.deepEqual(threadStart.environments, [], "no shell/file/patch tools on the Lega thread");
    assert.equal(threadStart.approvalsReviewer, "user");
    assert.equal(threadStart.dynamicTools[0].name, "lega");
    assert.ok(!threadStart.cwd.toLowerCase().includes(".ifrim"), "empty scratch cwd outside protected paths");
    const rt = log.find((l) => l.method === "thread/realtime/start").params;
    assert.equal(rt.transport.type, "webrtc");
    assert.equal(rt.version, "v3");
    assert.equal(rt.outputModality, "audio");
    assert.equal(rt.clientManagedHandoffs, true);
    assert.equal(rt.includeStartupContext, false);
    assert.equal(rt.voice, "cove");
    const launch = log.filter((l) => l.launchArgs).at(-1).launchArgs.join(" ");
    for (const piece of ["agents.enabled=false", "project_doc_max_bytes=0", 'default_permissions="ifrim_hub_ro"']) assert.ok(launch.includes(piece), piece);
    assert.ok(log.some((l) => l.method === "mcpServerStatus/list"), "active MCP servers are checked before voice starts");
    const cmd = hub.db.prepare("SELECT payload_json, result_json FROM commands WHERE type = 'lega.session.start' ORDER BY created_at DESC LIMIT 1").get();
    assert.ok(!cmd.payload_json.includes("m=audio"), "the SDP offer (with local ICE candidates) is not logged");
    assert.match(cmd.payload_json, /sdpLength/);
    assert.ok(!cmd.result_json.includes("v=0"), "the SDP answer goes back to the browser but is not stored in the command log");
    assert.match(cmd.result_json, /answerSdpLength/);

    await assert.rejects(startLega(hub), (e) => e.category === "conflict", "one Lega session at a time");
    const connected = await dispatch(hub, "lega.session.connected", { sessionId: started.sessionId });
    assert.equal(connected.status, "active");
    const stopped = await dispatch(hub, "lega.session.stop", { sessionId: started.sessionId });
    assert.equal(stopped.status, "ended");
    assert.equal(stopped.endReason, "user");
    const types = events.map((e) => e.type);
    assert.ok(types.indexOf("lega.session.stopping") >= 0, "the browser is told to close its peer first");
    await waitFor(() => t.readLog("codex").some((l) => l.method === "thread/realtime/stop"), 5000);
    assert.ok(hub.bus.query({ limit: 50 }).some((e) => e.type === "lega.session.stopped"));
  } finally { await t.cleanup(); }
});

test("M03-LEGA-05 owner's words: 'Lega, oprește tot' runs Stop All (ends Lega, suspends the gate, revokes grants)", async () => {
  const t = await makeTestHub({ codex: "lega-stop-words" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const ended = await legaEnded(hub);
    assert.equal(ended.endReason, "stop-all");
    assert.equal(hub.settings.get("executionGate").status, "suspended");
    assert.equal(hub.grants.list().filter((g) => g.status === "active").length, 0);
    assert.ok(hub.bus.query({ limit: 80 }).some((e) => e.type === "lega.command" && e.payload.command === "stop_all"));
  } finally { await t.cleanup(); }
});

test("M03-LEGA-06 refused words ('aprobă', 'deploy') execute nothing; navigation words only publish a navigate event", async () => {
  for (const [scenario, expect] of [["lega-refused-words", "notice"], ["lega-navigate-words", "navigate"]]) {
    const t = await makeTestHub({ codex: scenario });
    try {
      const { hub } = t;
      await enableLega(hub);
      const events = liveEvents(hub);
      const s = await startLega(hub);
      await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
      if (expect === "notice") {
        const notice = await waitFor(() => events.find((e) => e.type === "lega.notice"), 5000);
        assert.match(notice.text, /click/);
        assert.equal(hub.settings.get("executionGate").status, "open", "nothing was executed");
      } else {
        const nav = await waitFor(() => events.find((e) => e.type === "lega.navigate"), 5000);
        assert.equal(nav.path, "/approvals");
      }
      await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
    } finally { await t.cleanup(); }
  }
});

test("M03-LEGA-07 lega.hub_status from a delegated turn is answered by the Hub; the final answer is spoken without [FINAL]", async () => {
  const t = await makeTestHub({ codex: "lega-status" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const reply = await waitFor(() => t.readLog("codex").find((l) => l.toolReply)?.toolReply, 8000);
    assert.equal(reply.success, true);
    assert.match(reply.contentItems[0].text, /LIVE_VALIDATION/);
    const spoke = await waitFor(() => t.readLog("codex").find((l) => l.spoke)?.spoke, 8000);
    assert.ok(!spoke.includes("[FINAL]"));
    assert.match(spoke, /Rezultat simulat pentru hub_status/);
    assert.ok(hub.bus.query({ limit: 80 }).some((e) => e.type === "lega.transcript" && e.payload.role === "user"), "the owner's final words are kept as redacted text");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-LEGA-08 propose_run creates a click approval (no run); after approval the run goes through the gate and its result is spoken", async () => {
  const t = await makeTestHub({ codex: "lega-propose" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const events = liveEvents(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const proposal = await waitFor(() => events.find((e) => e.type === "lega.proposal"), 8000);
    const approval = hub.approvals.get(proposal.approvalId);
    assert.equal(approval.status, "pending");
    assert.equal(approval.actionKind, "lega.run_request");
    assert.equal(hub.runs.listRuns({}).length, 0, "nothing runs before the click");
    await assert.rejects(hub.commands.dispatch({ type: "lega.propose_run", payload: { projectId: hub.projects.hub().id, provider: "codex", task: "x y z" }, actor: "user", channel: "ui" }), (e) => e.category === "policy", "only the voice channel proposes");
    await assert.rejects(hub.commands.dispatch({ type: "approval.decide", payload: { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash }, actor: "voice", channel: "voice" }), (e) => e.category === "policy", "voice cannot approve");
    await dispatch(hub, "approval.decide", { approvalId: approval.id, decision: "approved", displayedHash: approval.payloadHash });
    const executed = await hub.commands.executeApproved(proposal.commandId, "user");
    const runId = executed.result.runId;
    assert.ok(runId);
    await waitFor(() => (["completed", "failed"].includes(hub.runs.getRun(runId).status) ? true : null), 15000);
    const spoke = await waitFor(() => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke).find((x) => /Gata|oprit/.test(x)), 10000);
    assert.match(spoke, /Citește README/);
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-LEGA-09 unknown tools fail; forbidden items or approval requests on the Lega thread end the session", async () => {
  for (const [scenario, reason] of [["lega-unknown-tool", null], ["lega-forbidden", /^forbidden:commandExecution$/], ["lega-approval-request", /^forbidden:/]]) {
    const t = await makeTestHub({ codex: scenario });
    try {
      const { hub } = t;
      await enableLega(hub);
      const s = await startLega(hub);
      await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
      if (!reason) {
        const reply = await waitFor(() => t.readLog("codex").find((l) => l.toolReply)?.toolReply, 8000);
        assert.equal(reply.success, false);
        await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
      } else {
        const ended = await legaEnded(hub);
        assert.match(ended.endReason, reason);
        assert.ok(hub.bus.query({ limit: 80 }).some((e) => e.type === "lega.session.violation"));
        // The process is killed at once on a violation, so the fixture may not live long enough to log the (decline) reply.
        if (scenario === "lega-approval-request") { const reply = t.readLog("codex").find((l) => l.approvalReply)?.approvalReply; assert.ok(!reply || reply.decision === "decline", JSON.stringify(reply)); }
      }
    } finally { await t.cleanup(); }
  }
});

test("M03-LEGA-10 Stop All ends the voice session; provider errors, full-access threads and timers end or refuse it", async () => {
  let t = await makeTestHub({ codex: "lega-ok" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const result = await dispatch(hub, "system.stop_all", { reason: "test" });
    assert.equal(result.voiceSession.status, "ended");
    assert.equal(result.voiceSession.endReason, "stop-all");
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-full-access" });
  try {
    await enableLega(t.hub);
    await assert.rejects(startLega(t.hub), (e) => e.category === "policy");
    assert.equal(t.hub.lega.state().status, "ended");
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-error" });
  try {
    await enableLega(t.hub);
    await assert.rejects(startLega(t.hub), (e) => /Lega nu a pornit/.test(e.message));
    assert.ok(t.hub.bus.query({ limit: 50 }).some((e) => e.type === "lega.session.failed"));
  } finally { await t.cleanup(); }

  // Negotiation timeout (browser never connects) and idle timeout, with scaled timers (test mode only).
  t = await makeTestHub({ codex: "lega-ok", configOverrides: { legaTimeScale: 0.005 } });
  try {
    const { hub } = t;
    await enableLega(hub);
    await startLega(hub);
    assert.equal((await legaEnded(hub)).endReason, "negotiation-timeout");
    const s2 = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s2.sessionId });
    assert.equal((await legaEnded(hub)).endReason, "idle");
  } finally { await t.cleanup(); }
});

test("M03-LEGA-11 consent and settings: exact text, UI only; revoke from voice ends the session; settings validated", async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  try {
    const { hub } = t;
    await assert.rejects(dispatch(hub, "lega.consent", { confirmText: "da" }), (e) => e.category === "validation");
    await assert.rejects(dispatch(hub, "lega.consent", { confirmText: LEGA_CONSENT_TEXT }, "voice"), (e) => e.category === "policy");
    const recorded = await dispatch(hub, "lega.consent", { confirmText: LEGA_CONSENT_TEXT });
    assert.equal(recorded.version, LEGA_CONSENT_VERSION);
    await enableLega(hub, { consent: false });
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    await dispatch(hub, "lega.consent_revoke", {}, "voice");
    assert.equal(hub.lega.state().status, "ended");
    assert.equal(hub.gate.evaluateVoice().checks.find((c) => c.id === "lega_consent").ok, false);
    await assert.rejects(dispatch(hub, "settings.update", { lega: { voice: "alloy" } }), /voice/i);
    await assert.rejects(dispatch(hub, "settings.update", { lega: { maxSessionMinutes: 90 } }), /1\.\.30/);
    const saved = await dispatch(hub, "settings.update", { lega: { voice: "juniper", maxSessionMinutes: 10 } });
    assert.deepEqual(saved.lega, { voice: "juniper", maxSessionMinutes: 10, idleTimeoutS: 120, webSearch: "cached" });
  } finally { await t.cleanup(); }
});

test("M03-LEGA-12 HTTP: GET /api/lega previews the gate; session start needs the token; the start response carries only the answer", async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  const { server, token } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  const request = (options, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  try {
    const preview = await request({ path: "/api/lega" });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.preview.allowed, false);
    assert.equal(preview.body.consentText, LEGA_CONSENT_TEXT);
    assert.ok(preview.body.voices.includes("cove"));
    const noToken = await request({ method: "POST", path: "/api/lega/sessions" }, { sdp: OFFER });
    assert.equal(noToken.status, 403);
    await enableLega(t.hub);
    const started = await request({ method: "POST", path: "/api/lega/sessions", headers: { "X-Hub-Token": token } }, { sdp: OFFER });
    assert.equal(started.status, 201);
    const result = started.body.result || started.body;
    assert.ok(result.answerSdp.startsWith("v=0"));
    assert.equal(JSON.stringify(started.body).includes("m=audio"), false, "the offer is not echoed back");
    const state = await request({ path: "/api/state" });
    assert.equal(state.body.lega.status, "connecting");
    await request({ method: "POST", path: `/api/lega/sessions/${result.sessionId}/stop`, headers: { "X-Hub-Token": token } }, {});
  } finally {
    server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup();
  }
});
