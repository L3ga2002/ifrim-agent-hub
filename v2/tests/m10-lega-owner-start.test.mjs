// M10 Lega zero-form start: one click (or „Pornește Lega”) inside the owner session starts the voice from BUILD_SAFE, with an
// authority derived for THAT voice session only (a voice grant born exhausted, revoked at the end, bounded by the owner session,
// rate-limited, audited). The Hub's mode is never written; runs stay refused; every other check (gate, consent, billing, realtime
// config, isolation, breaker, concurrency) still decides; Stop All / consent revoke / the owner session ending stop the voice.
// The old path (ui channel + LIVE_VALIDATION + a voice grant by hand) is unchanged. Fake app-server only: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { DERIVED_START_LIMIT } from "../server/runtime/lega.mjs";
import { resolveIntent, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { legaStartReadiness } from "../web/src/lib/uiLogic.js";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

/** A hub ready for voice EXCEPT the old path's mode + grant: BUILD_SAFE, gate open, billing + isolation ok, consent, owner session. */
async function ready({ codex = "lega-ok", policy = true, consent = true, clock } = {}) {
  const t = await makeTestHub({ codex, ...(clock ? { clock } : {}) });
  const owner = await enrolOwner(t, { activatePolicy: policy });
  await prepareLiveWithoutGrants(t.hub);
  if (consent) t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  return { t, owner };
}
const ownerStart = (t, owner, extra = {}) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER, ...extra } }).then((r) => r.result);
const uiStart = (t) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } }).then((r) => r.result);
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ ...e, payload: JSON.parse(e.payload_json || "{}") }));
const ended = (t) => waitFor(() => (t.hub.lega.state()?.status === "ended" ? t.hub.lega.state() : null), 15000);
const voiceGrants = (t) => t.hub.grants.list().filter((g) => g.kind === "voice");

test("M10-LEGA-ZF-01 one click in the owner session starts Lega from BUILD_SAFE: no mode change, no form, one exhausted derived grant, audited", async () => {
  const { t, owner } = await ready();
  try {
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const before = t.hub.db.prepare("SELECT MAX(seq) AS s FROM events").get().s;
    const r = await ownerStart(t, owner);
    assert.ok(r.answerSdp && r.sessionId);
    assert.equal(r.authority, "owner_session");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE", "the Hub's mode is never written");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE seq > ? AND type = 'settings.changed' AND scope_id IN ('mode','envelopeModeHold')").get(before).n, 0);
    const g = voiceGrants(t);
    assert.equal(g.length, 1);
    assert.equal(g[0].maxAttempts, 1);
    assert.equal(g[0].attemptsUsed, 1);
    assert.equal(g[0].status, "exhausted", "born exhausted: no other start and no run can use it");
    assert.equal(g[0].provider, "codex");
    assert.equal(g[0].access, "read-only");
    assert.ok(Date.parse(g[0].expiresAt) <= Date.now() + 33 * 60000);
    const derived = events(t, "lega.authority_derived");
    assert.equal(derived.length, 1);
    assert.equal(derived[0].payload.ownerSessionId, owner.session.id);
    assert.equal(derived[0].payload.legaSessionId, r.sessionId);
    assert.equal(derived[0].payload.grantId, g[0].id);
    assert.equal(events(t, "grant.created").at(-1).source, `owner:${owner.session.id}`);
    const cmds = t.hub.db.prepare("SELECT type, channel FROM commands WHERE type IN ('grant.create','mode.set','gate.set','lega.session.start')").all();
    assert.deepEqual(cmds.map((c) => `${c.type}:${c.channel}`), ["lega.session.start:owner"]);
    assert.equal(t.hub.lega.state().authority, "owner_session");
    // Runs are still refused in BUILD_SAFE (the derived authority is voice-only).
    const run = t.hub.gate.evaluate({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only" });
    assert.equal(run.checks.find((c) => c.id === "mode").ok, false);
    assert.equal(t.hub.grants.findUsable("codex", t.hub.projects.hub().id, "read-only", "voice")?.status === "active", false);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-02 no valid owner session, no authority: ui without session, a forged id, an ended / idle / revoked session", async () => {
  let offset = 0; // a real clock moved forward by the test (a frozen clock would make the fixtures look future-dated)
  const { t, owner } = await ready({ clock: () => new Date(Date.now() + offset) });
  try {
    const refused = await uiStart(t).catch((e) => e);
    assert.equal(refused.category, "gate");
    assert.ok(["mode", "voice_grant"].every((id) => refused.details.checks.find((c) => c.id === id).ok === false));
    assert.equal(refused.details.needSession, true, "the panel can say: open your session, then one click");
    await assert.rejects(t.hub.commands.dispatch({ type: "lega.session.start", channel: "test", actor: "t", ownerSession: { id: "osn_forged" }, payload: { sdp: OFFER } }), (e) => e.category === "authentication" && e.details?.needSession === true);
    assert.equal(voiceGrants(t).length, 0);
    for (const c of ["voice", "companion"]) await assert.rejects(t.hub.commands.dispatch({ type: "lega.session.start", channel: c, actor: c, payload: { sdp: OFFER } }), /cannot be issued through/);
    offset += 31 * 60000; // idle: the session's last activity is too old
    await assert.rejects(ownerStart(t, owner), (e) => e.category === "authentication");
    offset = 0;
    t.hub.trust.endSession(owner.session, "test");
    await assert.rejects(ownerStart(t, owner), (e) => e.category === "authentication");
    assert.equal(voiceGrants(t).length, 0, "nothing derived for an invalid session");
    assert.equal(events(t, "lega.authority_derived").length, 0);
  } finally { await t.cleanup(); }
});

test("M10-LEGA-ZF-03 legacy policy: the owner channel falls back to the old path (needPolicy hint); with LIVE_VALIDATION + a hand grant it still works", async () => {
  const { t, owner } = await ready({ policy: false });
  try {
    const refused = await ownerStart(t, owner).catch((e) => e);
    assert.equal(refused.category, "gate");
    assert.equal(refused.details.needPolicy, true);
    assert.equal(voiceGrants(t).length, 0);
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    const hand = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    const said = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "typed" } }).then((x) => x.result.results[0]);
    assert.equal(said.legaStart, true);
    assert.match(said.message, /grantul „Lega \(voce\)”/, "on the old path the reply never claims the owner session");
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "grant");
    assert.equal(t.hub.grants.get(hand.id).attemptsUsed, 1, "the hand grant is used on the old path");
    assert.equal(events(t, "lega.authority_derived").length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-04 the other checks still decide in the owner session: consent, the gate after Stop All, billing; nothing is derived", async () => {
  const { t, owner } = await ready({ consent: false });
  try {
    const p = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(p.authority, "owner_session");
    assert.equal(p.checks.find((c) => c.id === "mode").ok, true);
    assert.equal(p.checks.find((c) => c.id === "voice_grant").ok, true);
    let e = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(e.details.checks.filter((c) => !c.ok).map((c) => c.id), ["lega_consent"]);
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Stop All", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    e = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(e.details.checks.filter((c) => !c.ok).map((c) => c.id), ["execution_gate"], "derived authority never reopens the gate");
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    t.hub.bus.transaction(() => t.hub.settings.set("billingEvidence", {}, "test"));
    e = await ownerStart(t, owner).catch((x) => x);
    assert.ok(e.details.checks.filter((c) => !c.ok).map((c) => c.id).includes("billing_route"));
    assert.equal(voiceGrants(t).length, 0);
    assert.equal(events(t, "lega.authority_derived").length, 0);
  } finally { await t.cleanup(); }
});

test("M10-LEGA-ZF-05 the end revokes the derived authority (audited); it can never be reused, not even by the old path", async () => {
  const { t, owner } = await ready();
  try {
    const r = await ownerStart(t, owner);
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: r.sessionId } });
    await t.hub.commands.dispatch({ type: "lega.session.stop", channel: "ui", actor: "user", payload: { sessionId: r.sessionId } });
    const s = await ended(t);
    assert.equal(s.endReason, "user");
    const grantId = voiceGrants(t)[0].id;
    assert.ok(events(t, "grant.revoked").some((e) => e.scope_id === grantId));
    const released = events(t, "lega.authority_released");
    assert.equal(released.length, 1);
    assert.equal(released[0].payload.reason, "user");
    assert.equal(events(t, "lega.session.stopped").at(-1).payload.authority, "owner_session");
    assert.equal(events(t, "grant.refunded").filter((e) => e.scope_id === grantId).length, 0, "a derived grant is never refunded");
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    const old = await uiStart(t).catch((e) => e);
    assert.match(old.details.checks.find((c) => c.id === "voice_grant").detail, /Niciun grant de voce/);
  } finally { await t.cleanup(); }
});

test("M10-LEGA-ZF-06 the owner session ending stops a derived voice session: logout, revoke-all, idle (tick), policy deactivated", async () => {
  let offset = 0; // a real clock moved forward by the test (a frozen clock would make the fixtures look future-dated)
  const { t, owner } = await ready({ clock: () => new Date(Date.now() + offset) });
  const startAndConnect = async (o) => { const r = await ownerStart(t, o); await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: r.sessionId } }); return r; };
  const reopen = () => { const a = t.hub.trust.beginAuthentication({ origin: owner.origin }); const o = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: a.challengeId, credential: owner.auth.get({ challenge: a.publicKey.challenge }) }); return { ...owner, session: t.hub.trust.resolveSession(o.token, { origin: owner.origin }) }; };
  try {
    await startAndConnect(owner);
    t.hub.trust.endSession(owner.session, "logout");
    assert.equal((await ended(t)).endReason, "owner-session-ended");
    let o = reopen();
    await startAndConnect(o);
    t.hub.trust.revokeAllSessions("test", "owner");
    assert.equal((await ended(t)).endReason, "owner-session-ended");
    o = reopen();
    await startAndConnect(o);
    offset += 31 * 60000; // idle; no event is published for that: the tick catches it
    t.hub.lega.tick();
    assert.equal((await ended(t)).endReason, "owner-session-ended");
    offset = 0;
    o = reopen();
    await startAndConnect(o);
    t.hub.trust.deactivatePolicy("owner", "test");
    assert.equal((await ended(t)).endReason, "policy-deactivated");
    assert.equal(events(t, "lega.authority_released").length, 4, "every derived authority closed");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-07 Stop All and consent revoke stop the voice; the next start is refused on the gate / the consent", async () => {
  const { t, owner } = await ready({ codex: "lega-ok" });
  try {
    await ownerStart(t, owner);
    await t.hub.commands.dispatch({ type: "system.stop_all", channel: "ui", actor: "user", payload: { reason: "test" } });
    assert.equal((await ended(t)).endReason, "stop-all");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    const e = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(e.details.checks.filter((c) => !c.ok).map((c) => c.id), ["execution_gate"]);
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    await ownerStart(t, owner);
    await t.hub.commands.dispatch({ type: "lega.consent_revoke", channel: "voice", actor: "voice", payload: {} });
    assert.equal((await ended(t)).endReason, "consent-revoked");
    const c = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(c.details.checks.filter((x) => !x.ok).map((x) => x.id), ["lega_consent"]);
  } finally { await t.cleanup(); }
});

test("M10-LEGA-ZF-08 mode coupling: a plan's own mode release does not kill a derived session; an explicit BUILD_SAFE does; billing withdrawal stops it", async () => {
  const { t, owner } = await ready();
  try {
    await ownerStart(t, owner);
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "owner"));
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "envelopes"));
    const right = t.hub.lega.state();
    assert.equal(right.status, "connecting", "right after the plan gives back its mode hold, the derived voice still runs (no stop started)");
    assert.equal(right.endReason, null);
    await new Promise((r) => setTimeout(r, 700)); // longer than the fake app-server needs to finish a stop
    assert.equal(t.hub.lega.state().status, "connecting", "a plan giving back its mode hold does not end the derived voice");
    assert.equal(events(t, "lega.session.stopping").length + events(t, "lega.session.stopped").length, 0, "no stop at all");
    await t.hub.commands.dispatch({ type: "mode.set", channel: "ui", actor: "user", payload: { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" } });
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    assert.equal(t.hub.lega.state().status, "connecting", "entering LIVE_VALIDATION never stops voice");
    await t.hub.commands.dispatch({ type: "mode.set", channel: "ui", actor: "user", payload: { mode: "BUILD_SAFE" } });
    assert.equal((await ended(t)).endReason, "mode-changed", "an explicit mode change still ends it");
    assert.ok(!JSON.stringify(t.hub.settings.get("envelopeModeHold") || {}).includes("lega"));
    await ownerStart(t, owner);
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "billing.withdrawn", scopeType: "provider", scopeId: "codex", source: "owner", payload: { provider: "codex" } }));
    assert.equal((await ended(t)).endReason, "billing-withdrawn");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-08b old path (ui + LIVE_VALIDATION + a hand grant): a plan's mode release DOES end it; withdrawing Codex billing stops it too (fail-safe)", async () => {
  const { t } = await ready();
  const hand = () => t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    hand();
    const r = await uiStart(t);
    assert.equal(r.authority, "grant");
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "envelopes"));
    assert.equal((await ended(t)).endReason, "mode-changed", "the old path relied on LIVE_VALIDATION: losing it ends the voice");
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    hand();
    await uiStart(t);
    await t.hub.commands.dispatch({ type: "billing.withdraw", channel: "ui", actor: "user", payload: { provider: "codex", reason: "test" } });
    assert.equal((await ended(t)).endReason, "billing-withdrawn", "a withdrawn Codex declaration stops voice on the old path as well");
    assert.equal(events(t, "lega.authority_derived").length, 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-06b revoking the session's authenticator stops a derived voice session", async () => {
  const { t, owner } = await ready();
  try {
    const r = await ownerStart(t, owner);
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: r.sessionId } });
    const fresh = owner.reauth();
    await t.hub.commands.dispatch({ type: "owner.credential.revoke", channel: "owner", actor: `owner:${fresh.id}`, ownerSession: fresh, payload: { credentialId: fresh.credentialId } });
    assert.equal((await ended(t)).endReason, "owner-session-ended");
    assert.equal(events(t, "lega.authority_released").length, 1);
    const again = await ownerStart(t, owner).catch((e) => e);
    assert.equal(again.category, "authentication");
    assert.equal(again.details?.needSession, true);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-09 a failure before GPT-Live is never refunded (revoked; a new click derives another); the derived-start limit, from the audit", async () => {
  let offset = 0;
  const { t, owner } = await ready({ codex: "lega-mcp-active", clock: () => new Date(Date.now() + offset) });
  try {
    await assert.rejects(ownerStart(t, owner), /Lega nu a pornit|MCP/);
    await ended(t);
    const first = voiceGrants(t)[0];
    assert.equal(events(t, "grant.refunded").filter((e) => e.scope_id === first.id).length, 0);
    assert.ok(events(t, "grant.revoked").some((e) => e.scope_id === first.id));
    assert.match(t.hub.lega.state().attempt.rule, /se derivă altul/);
    for (let i = 1; i < DERIVED_START_LIMIT.count; i += 1) { await ownerStart(t, owner).catch(() => null); await ended(t); }
    assert.equal(new Set(voiceGrants(t).map((g) => g.id)).size, DERIVED_START_LIMIT.count, "each start derived its own grant");
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.allowed, false, "the preview shows the limit before the click");
    const rate = pv.checks.find((c) => c.id === "derived_rate");
    assert.ok(rate && !rate.ok && rate.retryAfterS > 0, JSON.stringify(pv.checks.filter((c) => !c.ok)));
    assert.equal(pv.derivedStartsLeft, 0);
    const limited = await ownerStart(t, owner).catch((e) => e);
    assert.equal(limited.details?.rateLimited, true);
    assert.equal(voiceGrants(t).length, DERIVED_START_LIMIT.count, "no grant past the limit");
    offset += DERIVED_START_LIMIT.windowMs + 1000;
    // (the owner session idles out after 30 min of inactivity: refresh it as the cookie would)
    t.hub.db.prepare("UPDATE owner_sessions SET last_seen_at = ? WHERE id = ?").run(new Date(Date.now() + offset).toISOString(), owner.session.id);
    const p = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(p.derivedStartsLeft, DERIVED_START_LIMIT.count, "the preview counts the window again");
    const again = await ownerStart(t, owner).catch((e) => e);
    assert.notEqual(again?.details?.rateLimited, true, "allowed again after the window");
    assert.match(String(again?.message), /Lega nu a pornit|MCP/, "the start went through to the (failing) provider, not the limit");
    assert.equal(voiceGrants(t).length, DERIVED_START_LIMIT.count + 1, "a new derived grant after the window");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-10 bounds: the voice session never outlives the owner session; under a minute left → open the session again", async () => {
  const { t, owner } = await ready();
  try {
    t.hub.db.prepare("UPDATE owner_sessions SET expires_at = ? WHERE id = ?").run(new Date(Date.now() + 5 * 60000).toISOString(), owner.session.id);
    const r = await ownerStart(t, owner);
    assert.ok(r.maxDurationS <= 280 && r.maxDurationS >= 60, `maxDurationS ${r.maxDurationS}`);
    await t.hub.lega.stopAll("test");
    t.hub.db.prepare("UPDATE owner_sessions SET expires_at = ? WHERE id = ?").run(new Date(Date.now() + 50000).toISOString(), owner.session.id);
    const ending = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(ending.needSession, true, "the preview says: open the session again");
    assert.equal(ending.sessionReason, "session-ending");
    assert.match(ending.sessionProblem, /mai puțin de un minut/);
    await assert.rejects(ownerStart(t, owner), (e) => e.category === "authentication" && e.details?.needSession === true);
    // „Open your session again” must help: a re-authentication with the same cookie near the end opens a NEW session.
    const a = t.hub.trust.beginAuthentication({ origin: owner.origin, purpose: "unlock" });
    const rotated = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: a.challengeId, credential: owner.auth.get({ challenge: a.publicKey.challenge }), currentToken: owner.token });
    assert.equal(rotated.renewed, false);
    assert.ok(rotated.token && rotated.sessionId !== owner.session.id, "a new session and cookie");
    assert.ok(Date.parse(rotated.expiresAt) > Date.now() + 7 * 3600000, "a full lifetime");
    assert.equal(t.hub.db.prepare("SELECT status, revoke_reason FROM owner_sessions WHERE id = ?").get(owner.session.id).revoke_reason, "rotated");
    const fresh = t.hub.trust.resolveSession(rotated.token, { origin: owner.origin });
    const after = await ownerStart(t, { ...owner, session: fresh });
    assert.equal(after.authority, "owner_session");
    assert.ok(after.maxDurationS >= 60);
    await t.hub.lega.stopAll("test");
    await ended(t);
    // Far from the end, a re-authentication still renews the same session in place (no rotation).
    const b = t.hub.trust.beginAuthentication({ origin: owner.origin, purpose: "reauth" });
    const same = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: b.challengeId, credential: owner.auth.get({ challenge: b.publicKey.challenge }), currentToken: rotated.token });
    assert.equal(same.renewed, true);
    assert.equal(same.sessionId, fresh.id);
    owner.session = fresh; owner.token = rotated.token;
    // Idle in 40 s but hours left: the click (a request) touches the session, so the preview shows the full derived length.
    t.hub.db.prepare("UPDATE owner_sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?").run(new Date(Date.now() + 4 * 3600000).toISOString(), new Date(Date.now() - (30 * 60000 - 40000)).toISOString(), owner.session.id);
    const idleSoon = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(idleSoon.needSession, false, JSON.stringify(idleSoon.sessionProblem));
    assert.equal(idleSoon.authority, "owner_session");
    assert.ok(idleSoon.maxDurationS >= 60, `maxDurationS ${idleSoon.maxDurationS}`);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-ZF-11 HTTP: the cookie makes the preview one-click and the POST an owner-channel start (201); agent/cli refused; a stale web-search setting refused", async () => {
  const { t, owner } = await ready();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = "", headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  const { SESSION_COOKIE } = await import("../server/owner/trust.mjs");
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.token)}`;
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch: "disabled" }, "test"));
    const withCookie = await call("GET", "/api/lega", { cookie });
    assert.equal(withCookie.json.preview.webSearch, "disabled", "the preview reports the owner's saved setting, not the default");
    assert.equal(withCookie.json.owner.session, true);
    assert.equal(withCookie.json.owner.policyActive, true);
    assert.equal(withCookie.json.preview.allowed, true, JSON.stringify(withCookie.json.preview.checks.filter((c) => !c.ok)));
    assert.equal(withCookie.json.preview.authority, "owner_session");
    const without = await call("GET", "/api/lega");
    assert.equal(without.json.owner.session, false);
    assert.equal(without.json.preview.checks.find((c) => c.id === "mode").ok, false);
    const noCookie = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER } });
    assert.equal(noCookie.status, 409);
    assert.equal(noCookie.json.error.details.needSession, true);
    const cli = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER }, cookie, headers: { "X-Hub-Channel": "cli" } });
    assert.equal(cli.status, 403);
    const agent = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER }, cookie, headers: { "X-Hub-Channel": "agent" } });
    assert.equal(agent.status, 403, "a delegated agent never starts the owner's voice");
    assert.equal(voiceGrants(t).length, 0);
    assert.equal(withCookie.json.preview.derivedStartsLeft, DERIVED_START_LIMIT.count);
    assert.equal(withCookie.json.preview.webSearch, withCookie.json.settings.webSearch);
    const stale = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER, expectWebSearch: "live" }, cookie });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "LEGA_TERMS_CHANGED");
    const ok = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER, expectWebSearch: withCookie.json.preview.webSearch }, cookie });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.ok(ok.json.answerSdp);
    const row = t.hub.db.prepare("SELECT channel, actor FROM commands WHERE type = 'lega.session.start' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(row.channel, "owner");
    assert.equal(row.actor, `owner:${owner.session.id}`);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); }
});

test("M10-LEGA-ZF-12 „Pornește Lega”: a check that writes nothing (the page starts the voice); never from a provider transcript; phrases keep their intents", async () => {
  const { t, owner } = await ready();
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch: "indexed" }, "test"));
    const r = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "typed" } }).then((x) => x.result);
    assert.equal(r.results[0].intent, "lega_start");
    assert.equal(r.results[0].legaStart, true, JSON.stringify(r.results[0]));
    assert.equal(r.results[0].legaStartWebSearch, "indexed", "the page passes the shown (saved) mode to the start");
    assert.match(r.results[0].message, /Pornesc Lega în sesiunea ta .*Căutare pe internet: indexed/, "the reply names how it starts and the web-search mode");
    assert.equal(t.hub.lega.active(), false, "the server starts nothing from an intent");
    assert.equal(voiceGrants(t).length, 0);
    const provider = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "voice-provider" } }).then((x) => x.result);
    assert.ok(provider.results[0].refused && !provider.results[0].legaStart);
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", {}, "test"));
    const noConsent = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "typed" } }).then((x) => x.result);
    assert.ok(!noConsent.results[0].legaStart);
    assert.match(noConsent.results[0].message, /Acordul pentru Lega/);
    assert.equal(INTENT_EFFECTS.lega_start, "effect");
    assert.equal(resolveIntent("Lega, pornește").steps[0].intent, "unknown", "„Lega, pornește” without a card stays a (refused) confirmation, never a start");
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    await ownerStart(t, owner);
    const running = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Deschide Lega", source: "voice-provider" } }).then((x) => x.result);
    assert.equal(running.results[0].message, "Lega e deja pornită.");
    assert.ok(!running.results[0].refused && !running.results[0].legaStart);
    await t.hub.lega.stopAll("test");
    for (const [phrase, intent] of [["Pornește Lega", "lega_start"], ["vreau să vorbesc cu Lega", "lega_start"], ["pornește direct în ecran complet", "start_view"], ["modul Lega", "fullscreen"], ["nu porni Lega", "not_yet"], ["Deschide Studio", "studio_open"]]) {
      assert.equal(resolveIntent(phrase, { projects: [] }).steps[0].intent, intent, phrase);
    }
  } finally { await t.cleanup(); }
});

test("M10-LEGA-ZF-13 restart: a derived authority whose session died with the process is closed once at boot; nothing starts", async () => {
  const { t, owner } = await ready();
  try {
    const r = await ownerStart(t, owner);
    const liveGrant = t.hub.lega.state().grantId;
    // Simulate the crash of an EARLIER process: its derived grant (exhausted) and audit exist, its release never happened.
    const orphan = t.hub.bus.transaction(() => { const g = t.hub.grants.create({ kind: "voice", provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 15 }, "test"); return t.hub.grants.consumeAttempt(g.id); });
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "lega.authority_derived", scopeType: "grant", scopeId: orphan.id, source: "test", payload: { ownerSessionId: owner.session.id, legaSessionId: "lega_crashed", grantId: orphan.id } }));
    const first = t.hub.lega.recover();
    assert.equal(first.closed, 1, "only the orphan (the live session is skipped)");
    const released = events(t, "lega.authority_released").filter((e) => e.payload.reason === "hub-restart");
    assert.equal(released.length, 1);
    assert.equal(released[0].payload.grantId, orphan.id);
    assert.ok(events(t, "grant.revoked").some((e) => e.scope_id === orphan.id), "the orphan grant is revoked");
    assert.ok(!events(t, "grant.revoked").some((e) => e.scope_id === liveGrant), "the live session's grant is not touched");
    assert.equal(t.hub.lega.recover().closed, 0, "idempotent");
    assert.equal(t.hub.lega.state().id, r.sessionId, "the live session was not touched");
    assert.notEqual(t.hub.lega.state().status, "ended");
    // A clean shutdown finalizes the live session (released once), so the next boot has nothing to close.
    await t.hub.lega.stopAll("shutdown");
    await ended(t);
    assert.equal(events(t, "lega.authority_released").filter((e) => e.payload.legaSessionId === r.sessionId).length, 1);
    assert.equal(t.hub.lega.recover().closed, 0, "nothing left for the next boot");
    assert.equal(t.hub.lega.active(), false, "recover never starts anything");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10-LEGA-UI-01 legaStartReadiness: open your session (not a form), a real blocker, the legacy policy, ready", () => {
  const checks = (failed) => ["execution_gate", "mode", "voice_grant", "lega_consent", "billing_route"].map((id) => ({ id, ok: !failed.includes(id), detail: id }));
  let rd = legaStartReadiness({ owner: { session: false, policyActive: true }, preview: { checks: checks(["mode", "voice_grant"]) } });
  assert.equal(rd.needsSession, true);
  assert.deepEqual(rd.blocking, []);
  rd = legaStartReadiness({ owner: { session: false, policyActive: true }, preview: { checks: checks(["mode", "voice_grant", "lega_consent"]) } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["lega_consent"], "a real blocker alone: never mode / voice_grant / LIVE_VALIDATION");
  // A presented session that must be reopened (idle / ending): open it, not the old path.
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { needSession: true, sessionProblem: "Sesiunea de proprietar a expirat din lipsă de activitate", checks: checks(["mode", "voice_grant"]) } });
  assert.equal(rd.needsSession, true);
  assert.deepEqual(rd.blocking, []);
  assert.match(rd.sessionProblem, /expirat/);
  // The start limit is a real blocker.
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: [...checks([]), { id: "derived_rate", ok: false, detail: "limit" }] } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["derived_rate"]);
  assert.equal(rd.needsSession, false);
  // Legacy policy: the authority checks stay blockers (the old path), with the policy hint.
  rd = legaStartReadiness({ owner: { session: false, policyActive: false }, preview: { checks: checks(["mode", "voice_grant"]) } });
  assert.equal(rd.needsSession, false);
  assert.equal(rd.needsPolicy, true);
  assert.deepEqual(rd.blocking.map((c) => c.id), ["mode", "voice_grant"]);
  rd = legaStartReadiness({ owner: { session: true, policyActive: false }, preview: { checks: checks(["mode", "voice_grant"]) } });
  assert.equal(rd.needsPolicy, true);
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: checks([]) } });
  assert.equal(rd.ready, true);
  assert.equal(rd.derived, true);
});
