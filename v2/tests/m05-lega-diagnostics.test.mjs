import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

// M05 §22 (T16): Lega keeps and shows WHY a session ended (the provider's own error text, redacted), what the provider visibly
// did, and what happened to the grant attempt — by evidence, never "zero cost". Fake app-server only: no network, no audio.
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const dispatch = async (hub, type, payload = {}, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: "user", channel })).result;
async function enableLega(hub, attempts = 3) {
  await enableLive(hub, { provider: "codex" });
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  return hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: attempts, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
}
const legaEnded = (hub) => waitFor(() => (hub.lega.state()?.status === "ended" ? hub.lega.state() : null), 15000);
const events = (hub, type) => hub.bus.query({ typePrefix: type, limit: 200 }).filter((e) => e.type === type);

test("M05-LEGA-01 a provider error AFTER connect is kept, persisted (redacted) and shown; the attempt stays used, with its reason", async () => {
  const t = await makeTestHub({ codex: "lega-error-after-connect" });
  try {
    const grant = await enableLega(t.hub);
    const started = await dispatch(t.hub, "lega.session.start", { sdp: OFFER });
    await dispatch(t.hub, "lega.session.connected", { sessionId: started.sessionId });
    const ended = await legaEnded(t.hub);
    assert.equal(ended.endReason, "closed: error");
    assert.match(ended.endDetail, /upstream realtime failed \(1011\)|realtime failure after connect/, "the provider's own words, not just 'error'");
    assert.ok(!JSON.stringify(ended).includes("sk-proj-FAKE"), "redacted");
    assert.ok(ended.lastError && ["codex", "realtime"].includes(ended.lastError.source));
    assert.equal(ended.attempt.consumed, true);
    assert.equal(ended.attempt.refunded, false);
    assert.match(ended.attempt.rule, /consumul real e necunoscut|nu se restituie/);
    assert.equal(t.hub.grants.get(grant.id).attemptsUsed, 1);
    const persisted = events(t.hub, "lega.session.error");
    assert.ok(persisted.length >= 1, "the error is in the journal, not only a 7 s toast");
    assert.ok(!JSON.stringify(persisted).includes("sk-proj-FAKE"));
    const stopped = events(t.hub, "lega.session.stopped").at(0);
    assert.equal(stopped.payload.reason, "closed: error");
    assert.ok(stopped.payload.detail && stopped.payload.attempt && stopped.payload.activity, JSON.stringify(stopped.payload));
    assert.equal(ended.lastError.status, "active", "the error is recorded with the state it happened in (a live session)");
    assert.ok(["active", "stopping"].includes(stopped.payload.status));
  } finally { await t.cleanup(); }
});

test("M05-LEGA-02 activity before the failure is evidence: the record says the attempt was used because the provider worked", async () => {
  const t = await makeTestHub({ codex: "lega-error-after-words" });
  try {
    await enableLega(t.hub);
    const started = await dispatch(t.hub, "lega.session.start", { sdp: OFFER });
    await dispatch(t.hub, "lega.session.connected", { sessionId: started.sessionId });
    const ended = await legaEnded(t.hub);
    assert.ok(ended.activity.transcripts >= 1, JSON.stringify(ended.activity));
    assert.equal(ended.attempt.refunded, false);
    assert.match(ended.attempt.rule, /activitate/);
  } finally { await t.cleanup(); }
});

test("M05-LEGA-03 a failure BEFORE GPT-Live is refunded, but only within the grant's bound (no endless retries on one grant)", async () => {
  const t = await makeTestHub({ codex: "lega-error" });
  try {
    const grant = await enableLega(t.hub, 2);
    for (let i = 0; i < 2; i += 1) await assert.rejects(dispatch(t.hub, "lega.session.start", { sdp: OFFER }), /Lega nu a pornit/);
    // lega-error fails after realtime/start was sent (error+closed before "started"): GPT-Live was requested, nothing refunded.
    const afterRequested = t.hub.grants.get(grant.id);
    assert.equal(afterRequested.attemptsUsed, 2);
    const failed = events(t.hub, "lega.session.failed");
    assert.ok(failed.every((e) => e.payload.grantRefunded === false && /GPT-Live a fost cerut/.test(e.payload.attemptRule)), JSON.stringify(failed.map((e) => e.payload)));
  } finally { await t.cleanup(); }

  // A start refused before thread/realtime/start (an active MCP server) never reached GPT-Live: refunded, at most maxAttempts times.
  const u = await makeTestHub({ codex: "lega-mcp-active" });
  try {
    const grant = await enableLega(u.hub, 2);
    for (let i = 0; i < 4; i += 1) await assert.rejects(dispatch(u.hub, "lega.session.start", { sdp: OFFER }), /MCP|Lega nu a pornit|grant/i);
    const refunds = events(u.hub, "grant.refunded").filter((e) => e.scopeId === grant.id).length;
    assert.ok(refunds <= 2, `at most maxAttempts refunds (got ${refunds})`);
    assert.ok(events(u.hub, "grant.refund_refused").length >= 1 || u.hub.grants.get(grant.id).attemptsUsed >= 2, "the bound is enforced");
  } finally { await u.cleanup(); }
});
