// Coordinator-only: existing fake realtime provider; appendSpeech means handed off, never proof of actual audio playback.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION, speakable } from "../server/policy/lega-policy.mjs";
import { redactText } from "../server/security/redact.mjs";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const script = (items) => `lega-script:${Buffer.from(JSON.stringify(items)).toString("base64url")}`;
const spoken = (t) => t.readLog("codex").filter((r) => r.spoke).map((r) => r.spoke);
test("M16 voice: one chapter per turn, delegated duplicate withheld, transcript-only heard evidence and session binding", { timeout: 120000 }, async (c) => {
  const t = await makeTestHub({ queues: true, clock: () => new Date("2026-10-25T12:00:00Z") }); c.after(() => t.cleanup());
  const owner = await enrolOwner(t, { activatePolicy: true }); await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: t.config.now().toISOString() }, "test")); t.hub.refreshCodexConfig();
  const events = []; t.hub.live.subscribe((e) => events.push(e));
  const snapshot = t.hub.recap.build(); const chapter2 = speakable(redactText(snapshot.chapters[1].speech));
  t.queue("codex", script([{ sleep: 700 }, { say: "Ce s-a întâmplat azi?" }, { sleep: 900 }, { tool: "hub_status", heard: "Ce s-a întâmplat azi?" }, { sleep: 700 }, { say: "următorul" }, { sleep: 900 }, { say: "Alte cuvinte fără legătură", role: "assistant" }, { sleep: 300 }, { say: chapter2, role: "assistant" }, { say: chapter2, role: "assistant" }, { sleep: 300 }]));
  const started = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: started.sessionId } });
  await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
  await waitFor(() => events.some((e) => e.type === "lega.recap_heard"), 10000);
  const shows = events.filter((e) => e.type === "lega.recap" && e.action === "show"); assert.deepEqual(shows.map((e) => e.index), [0, 1]); assert.ok(shows.every((e) => e.handedOff));
  const lines = spoken(t); assert.equal(lines.filter((s) => s.includes("Capitolul 1 din 6")).length, 1); assert.equal(lines.filter((s) => s.includes("Capitolul 2 din 6")).length, 1); assert.ok(!lines.some((s) => s.includes("Rezultat simulat pentru hub_status")));
  const heard = events.filter((e) => e.type === "lega.recap_heard"); assert.equal(heard.length, 1); assert.equal(heard[0].index, 1); assert.ok(heard[0].match >= 0.9);
  const before = spoken(t).length; const other = await t.hub.lega.presentRecap({ sessionId: "another-session", snapshotId: shows[0].snapshotId, index: 2 }); assert.equal(other.voice.reason, "other_session"); assert.equal(spoken(t).length, before);
  assert.equal(t.hub.lega.recapOf(started.sessionId).index, 1);
  assert.equal(t.hub.lega.isHeld(shows[0].snapshotId), true);
  const noOwner = await t.hub.lega.presentRecap({ sessionId: started.sessionId, snapshotId: shows[0].snapshotId, index: 2 });
  assert.deepEqual(noOwner.voice, { requested: true, handedOff: false, reason: "other_session" });
  assert.equal(spoken(t).length, before);
  assert.equal(t.hub.lega.recapOf(started.sessionId).index, 1);
  await t.hub.lega.presentRecap({ sessionId: started.sessionId, snapshotId: shows[0].snapshotId, index: 1, action: "stop", ownerSession: owner.session }); assert.equal(t.hub.lega.recapOf(started.sessionId).active, false); assert.equal(spoken(t).length, before); assert.ok(events.some((e) => e.type === "lega.recap" && e.action === "stop"));
});

for (const phrase of ["Lega, stop", "Lega, oprește", "Lega oprește", "Oprește tot", "oprește"]) for (const active of [true, false]) test(`M16 R3 voice stop priority: ${phrase}, recap=${active}`, { timeout: 120000 }, async (c) => {
  const t = await makeTestHub({ queues: true }); c.after(() => t.cleanup());
  const owner = await enrolOwner(t, { activatePolicy: true }); await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: t.config.now().toISOString() }, "test")); t.hub.refreshCodexConfig();
  const events = []; t.hub.live.subscribe((e) => events.push(e));
  t.queue("codex", script([{ sleep: 1500 }, { say: phrase }, { sleep: 500 }]));
  const started = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: started.sessionId } });
  if (active) {
    const snapshot = t.hub.recap.build();
    const presented = await t.hub.lega.presentRecap({ sessionId: started.sessionId, snapshotId: snapshot.id, index: 0, ownerSession: owner.session });
    assert.equal(presented.voice.handedOff, true);
  }
  await waitFor(() => t.readLog("codex").some((l) => l.scriptDone) || t.hub.lega.state()?.status === "ended", 30000);
  const stoppedAll = t.hub.bus.query({ typePrefix: "lega.command", limit: 100 }).some((e) => e.payload.command === "stop_all");
  // Bare stop may be parsed by the old silence path without dispatching Stop All.
  if (phrase === "oprește") {
    assert.notEqual(t.hub.settings.get("executionGate")?.reason, "Lega: Oprește tot");
    if (active) { assert.equal(stoppedAll, false); assert.ok(events.some((e) => e.type === "lega.recap" && e.action === "stop")); }
    else assert.ok(events.some((e) => e.type === "lega.silence"));
  } else {
    assert.equal(stoppedAll, true);
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    if (active) assert.ok(events.some((e) => e.type === "lega.recap" && e.action === "stop"));
  }
});
