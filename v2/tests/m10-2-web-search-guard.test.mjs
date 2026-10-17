// M10.2 U14 (reduced to owner decision 9): live web search never starts unseen. When the owner's saved Lega setting is 'live', a
// start must carry expectWebSearch === 'live' itself (server-side, not only in the page); an old client without the field, or a
// stale one, is refused with LEGA_TERMS_CHANGED + {needConfirm, webSearch:'live'} before any authority is derived or attempt
// consumed. The owner's setting is never changed or downgraded. The preview and the „Pornește Lega” reply state it.
// Fake app-server only: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

async function ready({ webSearch = "live" } = {}) {
  const t = await makeTestHub({ codex: "lega-ok" });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => {
    t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test");
    t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch }, "test");
  });
  t.hub.refreshCodexConfig();
  return { t, owner };
}
const ownerStart = (t, owner, extra = {}) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER, ...extra } }).then((r) => r.result);
const uiStart = (t, extra = {}) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER, ...extra } }).then((r) => r.result);
const voiceGrants = (t) => t.hub.grants.list().filter((g) => g.kind === "voice");
const lastSeq = (t) => t.hub.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM events").get().s;
const eventsSince = (t, seq, type) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE seq > ? AND type = ?").get(seq, type).n;
const needConfirm = (e) => {
  assert.equal(e.code, "LEGA_TERMS_CHANGED", e.message);
  assert.deepEqual(e.details, { needConfirm: true, webSearch: "live" });
  assert.match(e.message, /Căutarea pe internet e pornită \(live\)/);
  return true;
};

test("M10.2-WS-01 live search: a derived start without expectWebSearch 'live' is refused (needConfirm) before anything is derived; 'live' starts", async () => {
  const { t, owner } = await ready();
  try {
    const before = lastSeq(t);
    await assert.rejects(ownerStart(t, owner), needConfirm, "an old client that sends no expectation");
    await assert.rejects(ownerStart(t, owner, { expectWebSearch: "cached" }), needConfirm, "a stale page that showed another mode");
    await assert.rejects(ownerStart(t, owner, { expectWebSearch: "LIVE" }), needConfirm, "only the exact value counts");
    assert.equal(voiceGrants(t).length, 0, "no authority derived, no attempt consumed");
    assert.equal(eventsSince(t, before, "lega.authority_derived"), 0);
    assert.equal(eventsSince(t, before, "lega.session.starting"), 0);
    assert.equal(t.hub.lega.active(), false);
    assert.equal(t.hub.settings.get("lega").webSearch, "live", "the owner's setting is never changed or downgraded");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE seq > ? AND type = 'settings.changed'").get(before).n, 0);
    const r = await ownerStart(t, owner, { expectWebSearch: "live" });
    assert.ok(r.answerSdp && r.sessionId);
    assert.equal(t.hub.lega.state().webSearch, "live", "the session runs with the mode the owner named");
    assert.equal(voiceGrants(t).length, 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10.2-WS-02 the grant path gets the same refusal first (no gate record, no attempt); a non-live setting keeps the old rules", async () => {
  const { t } = await ready();
  try {
    const before = lastSeq(t);
    await assert.rejects(uiStart(t), needConfirm);
    assert.equal(eventsSince(t, before, "lega.session.refused"), 0, "refused on the web-search terms, before the gate");
    assert.equal(eventsSince(t, before, "lega.attempt_consumed"), 0);
    // cached: no field is still accepted on the terms (here the old path then fails on its own gate: BUILD_SAFE, no voice grant).
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch: "cached" }, "test"));
    await assert.rejects(uiStart(t), (e) => { assert.notEqual(e.code, "LEGA_TERMS_CHANGED"); return true; });
    // A stale page that still believes live is the M10 terms-changed refusal, without needConfirm.
    await assert.rejects(uiStart(t, { expectWebSearch: "live" }), (e) => { assert.equal(e.code, "LEGA_TERMS_CHANGED"); assert.deepEqual(e.details, { webSearch: "cached" }); return true; });
  } finally { await t.cleanup(); }
});

test("M10.2-WS-03 the preview and the „Pornește Lega” reply state live search; non-live modes do not ask", async () => {
  const { t, owner } = await ready();
  try {
    const p = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(p.webSearch, "live");
    assert.equal(p.webSearchNeedsConfirm, true);
    const r = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "typed" } }).then((x) => x.result);
    const step = r.results[0];
    assert.equal(step.intent, "lega_start");
    assert.equal(step.legaStart, true, JSON.stringify(step));
    assert.equal(step.legaStartWebSearch, "live", "the page passes 'live' only because the reply named it");
    assert.match(step.message, /Căutarea pe internet e live: Lega poate deschide orice pagină/);
    assert.equal(t.hub.lega.active(), false, "the intent starts nothing");
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), webSearch: "indexed" }, "test"));
    const q = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(q.webSearchNeedsConfirm, false);
    const r2 = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Pornește Lega", source: "typed" } }).then((x) => x.result);
    assert.match(r2.results[0].message, /Căutare pe internet: indexed/);
  } finally { await t.cleanup(); }
});

test("M10.2-WS-04 the web shell sends expectWebSearch on every start (never omitted)", () => {
  const src = fs.readFileSync(path.join(here, "..", "web", "src", "shell", "Lega.jsx"), "utf8");
  assert.match(src, /const expected = expectWebSearch \|\| fresh \|\| "disabled";/);
  assert.match(src, /body: \{ sdp: pc\.localDescription\.sdp, expectWebSearch: expected \}/);
  assert.doesNotMatch(src, /\.\.\.\(expected \? \{ expectWebSearch/, "the field is no longer conditional");
});
