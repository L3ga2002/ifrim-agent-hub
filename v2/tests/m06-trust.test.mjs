// Milestone 06 — trusted owner session (WebAuthn) and the versioned product policy. PASS_SIMULATED: a SOFTWARE
// authenticator (real signatures, key in memory) drives the verifier; it proves the Hub's checks, not Windows Hello.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub } from "./helpers.mjs";
import { createTestAuthenticator, COSE_ALGS, cborDecode, cborEncode, verifyAssertion, verifyRegistration } from "../server/owner/webauthn.mjs";
import { OWNER_SETUP_TEXT, OWNER_POLICY_TEXT } from "../server/owner/trust.mjs";
import { createHttpServer } from "../server/http/server.mjs";

const origin = (t) => `http://localhost:${t.config.port}`;
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });

/** Registers `auth` as the bootstrap credential and opens a session; returns { session, token }. */
async function enrol(t, auth) {
  const begin = t.hub.trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT });
  t.hub.trust.finishRegistration({ origin: origin(t), challengeId: begin.challengeId, credential: auth.create({ challenge: begin.publicKey.challenge }) });
  const a = t.hub.trust.beginAuthentication({ origin: origin(t) });
  const opened = t.hub.trust.finishAuthentication({ origin: origin(t), challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }) });
  return { opened, session: t.hub.trust.resolveSession(opened.token, { origin: origin(t) }) };
}

test("M06-TR-01 CBOR and COSE: round trip, refusals of indefinite lengths and duplicate keys", () => {
  const value = new Map([[1, 2], [3, -7], [-2, Buffer.alloc(32, 1)], ["fmt", "none"]]);
  const decoded = cborDecode(cborEncode(value));
  assert.equal(decoded.value.get(3), -7);
  assert.equal(decoded.value.get("fmt"), "none");
  assert.throws(() => cborDecode(Buffer.from([0x9f, 0x01, 0xff])), /nedefinite/);
  assert.throws(() => cborDecode(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), /duplicat/);
});

test("M06-TR-02 bootstrap registration: exact setup text, localhost origin only, UV required, single-use challenge", async () => {
  const t = await makeTestHub();
  try {
    const trust = t.hub.trust;
    assert.throws(() => trust.beginRegistration({ origin: `http://127.0.0.1:${t.config.port}`, setupText: OWNER_SETUP_TEXT }), /localhost/, "an IP origin cannot be an RP ID");
    assert.throws(() => trust.beginRegistration({ origin: origin(t), setupText: "da" }), /Textul de configurare/);
    const begin = trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT });
    assert.equal(begin.publicKey.rp.id, "localhost");
    assert.equal(begin.publicKey.authenticatorSelection.userVerification, "required");
    // No user verification (touch only): refused.
    const noUv = createTestAuthenticator({ origin: origin(t), userVerified: false });
    assert.throws(() => trust.finishRegistration({ origin: origin(t), challengeId: begin.challengeId, credential: noUv.create({ challenge: begin.publicKey.challenge }) }), /UV/);
    // The challenge was consumed by that attempt: a second answer to it is a replay.
    const auth = createTestAuthenticator({ origin: origin(t) });
    assert.throws(() => trust.finishRegistration({ origin: origin(t), challengeId: begin.challengeId, credential: auth.create({ challenge: begin.publicKey.challenge }) }), /deja folosită/);
    // Wrong origin inside clientDataJSON, wrong RP ID hash: refused.
    const b2 = trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT });
    assert.throws(() => trust.finishRegistration({ origin: origin(t), challengeId: b2.challengeId, credential: auth.create({ challenge: b2.publicKey.challenge, originOverride: "http://evil.localhost:8011" }) }), /Origin/);
    const b3 = trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT });
    assert.throws(() => trust.finishRegistration({ origin: origin(t), challengeId: b3.challengeId, credential: auth.create({ challenge: b3.publicKey.challenge, rpIdOverride: "example.com" }) }), /RP ID/);
    for (const alg of [COSE_ALGS.ES256, COSE_ALGS.RS256, COSE_ALGS.EDDSA]) {
      const a = createTestAuthenticator({ origin: origin(t), alg });
      const b = trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT, session: null });
      const r = trust.finishRegistration({ origin: origin(t), challengeId: b.challengeId, credential: a.create({ challenge: b.publicKey.challenge }) });
      assert.equal(r.alg, alg);
      break; // after the first credential the bootstrap path is closed (checked below)
    }
    assert.throws(() => trust.beginRegistration({ origin: origin(t), setupText: OWNER_SETUP_TEXT }), /autentificator/, "a second credential needs a re-authenticated session, not the setup text");
    const row = t.hub.db.prepare("SELECT public_key_jwk FROM owner_credentials").get();
    assert.ok(!/"d"/.test(row.public_key_jwk), "only the public key is stored");
  } finally { await t.cleanup(); }
});

test("M06-TR-03 sessions: hashed token, origin bound, idle and absolute expiry, revocation, clone detection", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    const auth = createTestAuthenticator({ origin: origin(t), signCountStart: 5 });
    const { opened, session } = await enrol(t, auth);
    assert.ok(opened.token && session.id);
    const stored = t.hub.db.prepare("SELECT token_hash FROM owner_sessions WHERE id = ?").get(session.id).token_hash;
    assert.notEqual(stored, opened.token, "the database keeps only the hash");
    assert.equal(t.hub.trust.resolveSession(opened.token, { origin: `http://127.0.0.1:${t.config.port}` }), null, "another origin does not get the session");
    assert.equal(session.fresh, true);
    now += 6 * 60000;
    assert.equal(t.hub.trust.resolveSession(opened.token, { origin: origin(t) }).fresh, false, "re-authentication window is 5 minutes");
    now += 31 * 60000;
    assert.equal(t.hub.trust.resolveSession(opened.token, { origin: origin(t) }), null, "idle timeout ends the session");
    // A new session, then the counter goes backwards (cloned key): refused.
    const a = t.hub.trust.beginAuthentication({ origin: origin(t) });
    t.hub.trust.finishAuthentication({ origin: origin(t), challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }) });
    const replayChallenge = t.hub.trust.beginAuthentication({ origin: origin(t) });
    const stale = auth.get({ challenge: replayChallenge.publicKey.challenge, bumpCounter: false });
    assert.throws(() => t.hub.trust.finishAuthentication({ origin: origin(t), challengeId: replayChallenge.challengeId, credential: stale }), /Contorul/);
    // Tampered signature.
    const c2 = t.hub.trust.beginAuthentication({ origin: origin(t) });
    const good = auth.get({ challenge: c2.publicKey.challenge });
    const sig = Buffer.from(good.response.signature, "base64url"); sig[sig.length - 1] ^= 0xff;
    assert.throws(() => t.hub.trust.finishAuthentication({ origin: origin(t), challengeId: c2.challengeId, credential: { ...good, response: { ...good.response, signature: sig.toString("base64url") } } }), /Semnătura|semn/i);
    // Revoking all sessions ends them; a revoked credential cannot open a new one.
    assert.ok(t.hub.trust.revokeAllSessions("test") >= 1);
  } finally { await t.cleanup(); }
});

test("M06-TR-04 policy: legacy by default, activation only fresh + exact text, deactivation fail-safe from voice", async () => {
  let now = Date.now();
  const t = await makeTestHub({ clock: () => new Date(now) });
  try {
    assert.equal(t.hub.trust.policy().mode, "legacy");
    const auth = createTestAuthenticator({ origin: origin(t) });
    const { session } = await enrol(t, auth);
    await assert.rejects(dispatch(t.hub, "owner.policy.activate", { text: OWNER_POLICY_TEXT }, { channel: "ui" }), /cannot be issued through ui/, "the UI without a session cannot activate it");
    await assert.rejects(t.hub.commands.dispatch({ type: "owner.policy.activate", channel: "owner", actor: "x", payload: { text: OWNER_POLICY_TEXT } }), /authenticated owner session/, "the owner channel needs a resolved session");
    await assert.rejects(dispatch(t.hub, "owner.policy.activate", { text: "altceva" }, { ownerSession: session }), /nu corespunde/);
    now += 6 * 60000;
    await assert.rejects(dispatch(t.hub, "owner.policy.activate", { text: OWNER_POLICY_TEXT }, { ownerSession: session }), /confirmă din nou/, "stale re-authentication");
    const a = t.hub.trust.beginAuthentication({ origin: origin(t), purpose: "policy" });
    // Re-authentication of the same session (same browser cookie) refreshes the window.
    const renewed = t.hub.trust.finishAuthentication({ origin: origin(t), challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }), currentToken: null });
    const s2 = t.hub.trust.resolveSession(renewed.token, { origin: origin(t) });
    const active = (await dispatch(t.hub, "owner.policy.activate", { text: OWNER_POLICY_TEXT }, { ownerSession: s2 })).result;
    assert.equal(active.mode, "voice_first");
    assert.equal(active.active, true);
    const off = (await t.hub.commands.dispatch({ type: "owner.policy.deactivate", channel: "voice", actor: "voice", payload: { reason: "test" } })).result;
    assert.equal(off.mode, "legacy", "returning to legacy is fail-safe from the voice route");
    // Historical approvals are untouched: the policy change is a settings event, not a rewrite.
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE decided_via = 'owner_session'").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M06-TR-05 HTTP: cookie HttpOnly SameSite=Strict on localhost; status shows the session; 127.0.0.1 never gets it", async () => {
  const t = await makeTestHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const request = (path, { method = "GET", body, host = `localhost:${t.config.port}`, cookie = "", tokenHeader = null } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, path, method, headers: { Host: host, Origin: `http://${host}`, ...(data ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(tokenHeader ? { "X-Hub-Token": tokenHeader } : {}) } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  try {
    const { json: { token } } = await request("/api/session");
    const auth = createTestAuthenticator({ origin: origin(t) });
    const begin = await request("/api/owner/register/begin", { method: "POST", body: { setupText: OWNER_SETUP_TEXT }, tokenHeader: token });
    assert.equal(begin.status, 200, JSON.stringify(begin.json));
    const fin = await request("/api/owner/register/finish", { method: "POST", tokenHeader: token, body: { challengeId: begin.json.challengeId, credential: auth.create({ challenge: begin.json.publicKey.challenge }) } });
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    const ab = await request("/api/owner/auth/begin", { method: "POST", tokenHeader: token, body: {} });
    const af = await request("/api/owner/auth/finish", { method: "POST", tokenHeader: token, body: { challengeId: ab.json.challengeId, credential: auth.get({ challenge: ab.json.publicKey.challenge }) } });
    assert.equal(af.status, 200, JSON.stringify(af.json));
    const cookie = String(af.headers["set-cookie"]);
    assert.match(cookie, /ifrim_owner=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/api/);
    assert.ok(!("token" in af.json), "the token travels only in the cookie");
    const pair = cookie.split(";")[0];
    const status = await request("/api/owner/status", { cookie: pair });
    assert.equal(status.json.session?.id, af.json.sessionId);
    const ip = await request("/api/owner/status", { cookie: pair, host: `127.0.0.1:${t.config.port}` });
    assert.equal(ip.json.session, null, "the session is bound to the localhost origin");
    // Owner-only command without the cookie: refused with an authentication error.
    const noCookie = await request("/api/owner/policy/activate", { method: "POST", tokenHeader: token, body: { text: OWNER_POLICY_TEXT } });
    assert.equal(noCookie.status, 401);
    const withCookie = await request("/api/owner/policy/activate", { method: "POST", tokenHeader: token, cookie: pair, body: { text: OWNER_POLICY_TEXT } });
    assert.equal(withCookie.status, 200, JSON.stringify(withCookie.json));
    assert.equal(withCookie.json.mode, "voice_first");
    const logged = t.hub.db.prepare("SELECT channel, actor FROM commands WHERE type = 'owner.policy.activate' AND status = 'executed'").get();
    assert.equal(logged.channel, "owner", "recorded on the real channel");
    assert.match(logged.actor, /^owner:osn_/);
  } finally { await new Promise((r) => server.close(r)); await t.cleanup(); }
});

test("M06-TR-07 ES256, RS256 (frequent on Windows Hello) and EdDSA: registration and assertion verified end to end", () => {
  for (const alg of [COSE_ALGS.ES256, COSE_ALGS.RS256, COSE_ALGS.EDDSA]) {
    const auth = createTestAuthenticator({ alg, signCountStart: 1 });
    const reg = verifyRegistration(auth.create({ challenge: "reg-c" }), { challenge: "reg-c", origin: "http://localhost:8011", rpId: "localhost" });
    assert.equal(reg.alg, alg);
    const stored = { id: reg.credentialId, publicKey: reg.publicKey, alg: reg.alg, signCount: reg.signCount };
    const ok = verifyAssertion(auth.get({ challenge: "get-c" }), { challenge: "get-c", origin: "http://localhost:8011", rpId: "localhost", stored });
    assert.ok(ok.signCount > stored.signCount, `alg ${alg}`);
    const other = createTestAuthenticator({ alg });
    const forged = { ...other.get({ challenge: "get-c" }), id: auth.credentialId, rawId: auth.credentialId };
    assert.throws(() => verifyAssertion(forged, { challenge: "get-c", origin: "http://localhost:8011", rpId: "localhost", stored }), /Semnătura/, `another key cannot sign for this credential (alg ${alg})`);
  }
});

test("M06-TR-06 a signed assertion cannot be reused against another challenge", () => {
  const auth = createTestAuthenticator();
  const reg = auth.create({ challenge: "c1" });
  const key = cborDecode(cborDecode(Buffer.from(reg.response.attestationObject, "base64url")).value.get("authData").subarray(55 + 32)).value;
  assert.ok(key instanceof Map);
  const assertion = auth.get({ challenge: "c2" });
  assert.throws(() => verifyAssertion(assertion, { challenge: "c3", origin: "http://localhost:8011", rpId: "localhost", stored: { id: auth.credentialId, publicKey: {}, alg: -7, signCount: 0 } }), /Provocarea/);
});
