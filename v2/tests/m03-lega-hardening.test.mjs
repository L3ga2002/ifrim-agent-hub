import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { projectInstructions } from "../server/runtime/prompt.mjs";

// Findings of the adversarial review of Lega (MCP neutralization, cancellable start, open-mic safety, run context).
// Fake app-server only: no network, no audio, no model.
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const dispatch = async (hub, type, payload = {}, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: "user", channel })).result;
async function enableLega(hub) {
  await enableLive(hub, { provider: "codex" });
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
}
const startLega = (hub) => dispatch(hub, "lega.session.start", { sdp: OFFER });
const legaEnded = (hub) => waitFor(() => (hub.lega.state()?.status === "ended" ? hub.lega.state() : null), 15000);
const liveEvents = (hub) => { const events = []; hub.live.subscribe((e) => events.push(e)); return events; };
const writeCodexConfig = (t, text) => fs.writeFileSync(path.join(t.homeDir, ".codex", "config.toml"), text);

test("M03-LEGA-13 MCP: owner servers are disabled by name and verified inactive; an active server or a non-addressable name refuses Lega", async () => {
  let t = await makeTestHub({ codex: "lega-ok" });
  try {
    writeCodexConfig(t, "[mcp_servers.fs]\ncommand = \"fake\"\n\n[mcp_servers.git_tools]\ncommand = \"fake\"\n");
    await enableLega(t.hub);
    const s = await startLega(t.hub);
    const launch = t.readLog("codex").filter((l) => l.launchArgs).at(-1).launchArgs;
    // Plugin-provided MCP servers (Computer Use's cua_repl) are off because plugins are off for the Lega process.
    assert.ok(launch.includes("features.plugins=false") && launch.includes("features.remote_plugin=false"));
    assert.ok(launch.includes("mcp_servers.fs.enabled=false"));
    assert.ok(launch.includes("mcp_servers.git_tools.enabled=false"));
    await dispatch(t.hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-mcp-active" });
  try {
    await enableLega(t.hub);
    await assert.rejects(startLega(t.hub), (e) => e.category === "policy" && /MCP/.test(e.message));
    assert.equal(t.readLog("codex").some((l) => l.method === "thread/realtime/start"), false, "voice never starts while an MCP server is active");
    // No GPT-Live call was created, so the session's grant attempt is given back (live finding 2026-09-30).
    const voiceGrant = t.hub.grants.list().find((g) => g.kind === "voice");
    assert.deepEqual([voiceGrant.attemptsUsed, voiceGrant.status], [0, "active"]);
    assert.ok(t.hub.bus.query({ limit: 80 }).some((e) => e.type === "grant.refunded"));
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-ok" });
  try {
    writeCodexConfig(t, "[mcp_servers.\"bad.name\"]\ncommand = \"fake\"\n");
    await enableLega(t.hub);
    const refused = await startLega(t.hub).catch((e) => e);
    assert.equal(refused.details.checks.find((c) => c.id === "realtime_config").ok, false);
  } finally { await t.cleanup(); }
});

test("M03-LEGA-14 a Stop during the start cancels it (no orphan process, no realtime call); a Codex that ignores environments:[] is refused", async () => {
  let t = await makeTestHub({ codex: "lega-slow-start" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const pending = startLega(hub).catch((e) => e);
    await waitFor(() => (hub.lega.state()?.status === "starting" ? true : null), 5000);
    const stopped = await dispatch(hub, "lega.session.stop", { sessionId: "current", reason: "user" });
    assert.equal(stopped.status, "ended");
    const failure = await pending;
    assert.ok(failure instanceof Error, "the start does not succeed after Stop");
    await waitFor(() => (!hub.supervisor.list().some((p) => String(p.key).startsWith("voice-") && !p.exited) ? true : null), 10000);
    assert.equal(t.readLog("codex").some((l) => l.method === "thread/realtime/start"), false, "no realtime call is created after the Stop");
    assert.equal(hub.bus.query({ limit: 80 }).filter((e) => e.type === "lega.session.stopped").length, 1, "one terminal event");
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-env-ignored" });
  try {
    await enableLega(t.hub);
    await assert.rejects(startLega(t.hub), (e) => e.category === "policy" && /medii/.test(e.message));
  } finally { await t.cleanup(); }
});

test("M03-LEGA-15 open mic: a bare 'Oprește' only silences Lega; the agent's stop_all tool needs the owner's words; BUILD_SAFE ends the session", async () => {
  let t = await makeTestHub({ codex: "lega-bare-stop" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const events = liveEvents(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    await waitFor(() => events.find((e) => e.type === "lega.silence"), 5000);
    assert.equal(hub.settings.get("executionGate").status, "open", "no Stop All from a bare word");
    assert.equal(hub.lega.state().status, "active");
    await dispatch(hub, "mode.set", { mode: "BUILD_SAFE" });
    assert.equal((await legaEnded(hub)).endReason, "mode-changed");
  } finally { await t.cleanup(); }

  t = await makeTestHub({ codex: "lega-tool-stopall" });
  try {
    const { hub } = t;
    await enableLega(hub);
    const s = await startLega(hub);
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    const reply = await waitFor(() => t.readLog("codex").find((l) => l.toolReply)?.toolReply, 8000);
    assert.equal(reply.success, false);
    assert.equal(hub.settings.get("executionGate").status, "open", "agent output alone cannot stop everything");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});

test("M03-LEGA-16 runs keep project AGENTS.md: read by the Hub (bounded, redacted) and sent as project data", async () => {
  const t = await makeTestHub();
  try {
    fs.writeFileSync(path.join(t.projectDir, "AGENTS.md"), "# Conventions\nRun npm test before answering.\napi_key = sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE1234\n");
    const doc = projectInstructions(t.projectDir);
    assert.match(doc, /Run npm test/);
    assert.ok(!doc.includes("sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE1234"), "secret-looking values are redacted");
    await enableLive(t.hub, { provider: "codex" });
    const project = t.hub.projects.hub();
    const conversation = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title: "AGENTS" }, "user"));
    t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise." }, "user"));
    const { run } = await t.hub.runs.start({ conversationId: conversation.id, provider: "codex" });
    await waitFor(() => (["completed", "failed"].includes(t.hub.runs.getRun(run.id).status) ? true : null), 15000);
    const input = t.readLog("codex").find((l) => l.method === "turn/start").params.input[0].text;
    assert.match(input, /Project instructions \(AGENTS\.md/);
    assert.match(input, /Run npm test before answering/);
  } finally { await t.cleanup(); }
});

test("M03-LEGA-17 JSON-RPC peer: after the process is gone, requests fail at once instead of waiting for their timeout", async () => {
  const { createJsonRpcPeer } = await import("../server/providers/jsonrpc.mjs");
  const peer = createJsonRpcPeer({ write: () => {}, allowedMethods: new Set(["thread/realtime/stop"]) });
  peer.failAll(Object.assign(new Error("app-server exited (1)"), { category: "transport" }));
  const started = Date.now();
  await assert.rejects(peer.request("thread/realtime/stop", {}, 5000), /exited/);
  assert.ok(Date.now() - started < 500);
  assert.equal(peer.isClosed(), true);
});
