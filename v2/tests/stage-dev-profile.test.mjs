// Stage before M12 — the local development profile (no Windows Hello dialog in local development) and the confirmed authority that
// outlives a closed browser. The profile is the INSTANCE's (a file in its private data folder, injected here through config.devProfile),
// bound to this machine and Windows account; a session it opens says authority local_dev_profile and userVerified false — never a
// WebAuthn result. An external origin, the 127.0.0.1 origin, the agent channel or a cross-site request cannot obtain it.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import path from "node:path";
import { readDevProfile, machineIdentity } from "../server/owner/dev-profile.mjs";
import { waitFor, prepareLiveWithoutGrants, freePort, HUB_ROOT, tempDir } from "./helpers.mjs";
import { realLaunchers } from "./media-helpers.mjs";
import { materializeFixture, demoSpec, FACTORY_DEMOS } from "../server/factory/fixtures.mjs";
import { browserStatus } from "../server/tools/browser.mjs";

const ME = machineIdentity();
const ON = { enabled: true, version: 1, id: "dev_test01", machine: ME.machine, user: ME.user };

async function httpHub(devProfile) {
  const t = await makeTestHub({ configOverrides: { devProfile } });
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const request = (p, { method = "GET", body, host = `localhost:${t.config.port}`, origin = undefined, cookie = "", token = null, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, path: p, method, headers: { Host: host, ...(origin === null ? {} : { Origin: origin || `http://${host}` }),
      ...(data ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { "X-Hub-Token": token } : {}), ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  const { json: { token } } = await request("/api/session");
  return { t, request, token, close: async () => { await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("DP-01 the profile is bound to this machine and account; off, absent, invalid or foreign means OFF", () => {
  assert.equal(readDevProfile({ override: ON }).enabled, true);
  assert.equal(readDevProfile({ override: { ...ON, enabled: false } }).reason, "disabled");
  assert.equal(readDevProfile({ override: { ...ON, machine: "ALT-PC" } }).reason, "foreign-machine-or-user");
  assert.equal(readDevProfile({ override: { ...ON, user: "altcineva" } }).reason, "foreign-machine-or-user");
  assert.equal(readDevProfile({ override: { ...ON, id: "x" } }).reason, "invalid-id");
  assert.equal(readDevProfile({ dataDir: "C:/nu-exista-niciodata" }).reason, "absent");
});

test("DP-02 profile on: the page opens the owner session with no ceremony — authority local_dev_profile, userVerified false, audited, fresh for every step", async () => {
  const h = await httpHub(ON);
  try {
    const st0 = await h.request("/api/owner/status");
    assert.equal(st0.json.devProfile.enabled, true);
    assert.equal(st0.json.session, null);
    const open = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    assert.equal(open.json.authority, "local_dev_profile");
    const cookie = String(open.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const pair = cookie.split(";")[0];
    const st = await h.request("/api/owner/status", { cookie: pair });
    assert.equal(st.json.session.authority, "local_dev_profile");
    assert.equal(st.json.session.userVerified, false, "never a WebAuthn result");
    assert.equal(st.json.session.fresh, true);
    assert.equal(h.t.hub.db.prepare("SELECT COUNT(*) AS n FROM owner_credentials").get().n, 0, "no authenticator was registered or imitated");
    const ev = h.t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'owner.session_opened' ORDER BY seq DESC LIMIT 1").get();
    assert.equal(JSON.parse(ev.payload_json).authority, "local_dev_profile");
    // A step that needed a fresh Windows Hello (the policy activation) passes in the dev-profile session, recorded as such.
    const session = h.t.hub.trust.resolveSession(pair.split("=")[1], { origin: `http://localhost:${h.t.config.port}` });
    assert.doesNotThrow(() => h.t.hub.trust.requireFresh(session, "test"));
    // Reopening with the same cookie renews, never multiplies sessions.
    const again = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, cookie: pair });
    assert.equal(again.json.renewed, true);
  } finally { await h.close(); }
});

test("DP-03 an external origin, the 127.0.0.1 origin, the agent channel, a cross-site request, a missing token or a profile that is off get nothing", async () => {
  const h = await httpHub(ON);
  try {
    const evil = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, origin: "http://evil.example" });
    assert.notEqual(evil.status, 200);
    assert.equal(evil.headers["set-cookie"], undefined);
    const ip = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, host: `127.0.0.1:${h.t.config.port}` });
    assert.notEqual(ip.status, 200, "only the canonical localhost origin");
    const agent = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, headers: { "X-Hub-Channel": "agent" } });
    assert.notEqual(agent.status, 200);
    const cross = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, headers: { "Sec-Fetch-Site": "cross-site" } });
    assert.notEqual(cross.status, 200);
    const noToken = await h.request("/api/owner/dev-session", { method: "POST", body: {} });
    assert.notEqual(noToken.status, 200);
    const noOrigin = await h.request("/api/owner/dev-session", { method: "POST", body: {}, token: h.token, origin: null });
    assert.notEqual(noOrigin.status, 200, "a request without an Origin is not the Hub's page");
  } finally { await h.close(); }
  const off = await httpHub({ ...ON, enabled: false });
  try {
    const r = await off.request("/api/owner/dev-session", { method: "POST", body: {}, token: off.token });
    assert.notEqual(r.status, 200);
    assert.match(JSON.stringify(r.json), /nu este activ/);
  } finally { await off.close(); }
});

test("DP-04 turning the profile off ends its sessions at the next check; a dev session's authority is revoked with it", async () => {
  let profile = { ...ON };
  const t = await makeTestHub({ configOverrides: { devProfile: () => profile } });
  try {
    const opened = t.hub.trust.openDevSession({ origin: `http://localhost:${t.config.port}` });
    const s = t.hub.trust.requireSession({ id: opened.sessionId }, "test");
    assert.equal(s.authority, "local_dev_profile");
    assert.equal(t.hub.trust.confirmedAuthority(opened.sessionId).ok, true);
    profile = { ...ON, enabled: false };
    assert.throws(() => t.hub.trust.requireSession({ id: opened.sessionId }, "test"), /sesiunea de proprietar/);
    assert.equal(t.hub.trust.confirmedAuthority(opened.sessionId).ok, false, "a plan confirmed in it stops at its next operation");
  } finally { await t.cleanup(); }
});

test("DP-05 (§7) a confirmation's authority outlives the page: idle, expiry and logout keep it; a revoked authenticator or revoke-all end it", async () => {
  const t = await makeTestHub({});
  try {
    const owner = await enrolOwner(t);
    const sid = owner.session.id;
    assert.deepEqual(t.hub.trust.confirmedAuthority(sid), { ok: true, sessionOpen: true });
    t.hub.trust.endSession({ id: sid }, "logout");
    const after = t.hub.trust.confirmedAuthority(sid);
    assert.equal(after.ok, true); assert.equal(after.sessionOpen, false); assert.equal(after.endedBecause, "logout");
    assert.throws(() => t.hub.trust.requireSession({ id: sid }, "o confirmare nouă"), /sesiunea de proprietar/, "new confirmations still need an open session");
  } finally { await t.cleanup(); }
  const t2 = await makeTestHub({});
  try {
    const owner2 = await enrolOwner(t2);
    t2.hub.trust.revokeAllSessions("revocare", "owner");
    assert.equal(t2.hub.trust.confirmedAuthority(owner2.session.id).ok, false, "revoke-all is a revocation");
  } finally { await t2.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ criterion 4, end to end
const launchers = realLaunchers();
const browser = browserStatus({ hubRoot: HUB_ROOT });
const skipE2E = !launchers.available ? "SKIPPED_ENV: ffmpeg/ffprobe absent" : !(browser.installed && browser.cachedBrowsers.length) ? "SKIPPED_ENV: Playwright/Chromium absent" : false;

test("DP-06 (criterion 4) the owner confirms ONE plan and closes the browser at once: the mission, review, QA, the derived delivery and its exports still reach READY", { timeout: 900000, skip: skipE2E }, async () => {
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const importRoot = tempDir("videos");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), importRoots: [importRoot] }, "test", "exports folder"));
    const port = await freePort();
    const dir = path.join(t.dataDir, "detailing-demo");
    materializeFixture("booking-demo", dir, { port });
    const dispatch = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
    const project = (await dispatch("project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch("owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const { mission } = (await dispatch("factory.prepare", { projectId: project.id, ...demoSpec("booking-demo", { port }), limits: { ...FACTORY_DEMOS["booking-demo"].limits, writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    const planned = await t.hub.deliveries.createPlanned({ projectId: project.id, missionId: mission.id, actor: "test" });
    const { envelope } = (await dispatch("envelope.propose", { projectId: project.id, missionIds: [mission.id], deliveryId: planned.id, constraints: { noPublish: true } })).result;
    t.queue("codex", "factory-write:booking-fix");
    t.queue("claude", "review:pass");
    await dispatch("envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: owner.session });
    // The browser is closed right after the one confirmation: the page's session ends (idle), nobody is there to click anything.
    t.hub.db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = 'idle' WHERE id = ?").run(new Date().toISOString(), owner.session.id);
    const where = () => { const dd = t.hub.deliveries.get(planned.id); const pv = dd.opsPlanId ? t.hub.opsPlans.view(dd.opsPlanId) : null;
      return JSON.stringify({ stage: t.hub.factory.view(mission.id).factory.stage, reason: t.hub.factory.view(mission.id).factory.stageReason, delivery: dd.status, why: dd.statusReason, steps: pv?.steps.map((s) => [s.seq, s.kind, s.status, s.error]) }); };
    const ready = await waitFor(() => (["READY", "FAILED", "NEEDS_OWNER", "EXPIRED", "CANCELLED"].includes(t.hub.deliveries.get(planned.id).status) ? t.hub.deliveries.get(planned.id) : null), 600000, 300)
      .catch((error) => { throw new Error(`${error.message} · ${where()}`); });
    const d = t.hub.deliveries.get(planned.id);
    const plan = d.opsPlanId ? t.hub.opsPlans.view(d.opsPlanId) : null;
    assert.equal(ready.status, "READY", `${ready.statusReason} · ${JSON.stringify(plan?.steps.map((s) => [s.seq, s.kind, s.status, s.error]))}`);
    assert.equal(t.hub.db.prepare("SELECT status FROM owner_sessions WHERE id = ?").get(owner.session.id).status, "ended", "the session really was closed the whole time");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM owner_sessions WHERE status = 'active'").get().n, 0, "no new session was opened for it");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent'").get().n, 0, "no second confirmation");
  } finally { await t.cleanup(); }
});

test("DP-07 (§25 closure) the delivery DERIVED from the envelope also produces the Word document and the campaign (office.verify inside the phase; the plan is bound before its first step)", { timeout: 900000, skip: skipE2E }, async () => {
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const importRoot = tempDir("videos");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), importRoots: [importRoot] }, "test", "exports folder"));
    const port = await freePort();
    const dir = path.join(t.dataDir, "detailing-demo");
    materializeFixture("booking-demo", dir, { port });
    const dispatch = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
    const project = (await dispatch("project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch("owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const { mission } = (await dispatch("factory.prepare", { projectId: project.id, ...demoSpec("booking-demo", { port }), limits: { ...FACTORY_DEMOS["booking-demo"].limits, writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    const planned = await t.hub.deliveries.createPlanned({ projectId: project.id, missionId: mission.id, actor: "test", extras: ["document", "campaign"] });
    const { envelope } = (await dispatch("envelope.propose", { projectId: project.id, missionIds: [mission.id], deliveryId: planned.id, constraints: { noPublish: true } })).result;
    t.queue("codex", "factory-write:booking-fix");
    t.queue("claude", "review:pass");
    await dispatch("envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: owner.session });
    // The browser is closed right after the one confirmation: the page's session ends (idle), nobody is there to click anything.
    t.hub.db.prepare("UPDATE owner_sessions SET status = 'ended', revoked_at = ?, revoke_reason = 'idle' WHERE id = ?").run(new Date().toISOString(), owner.session.id);
    const where = () => { const dd = t.hub.deliveries.get(planned.id); const pv = dd.opsPlanId ? t.hub.opsPlans.view(dd.opsPlanId) : null;
      return JSON.stringify({ stage: t.hub.factory.view(mission.id).factory.stage, reason: t.hub.factory.view(mission.id).factory.stageReason, delivery: dd.status, why: dd.statusReason, steps: pv?.steps.map((s) => [s.seq, s.kind, s.status, s.error]) }); };
    const ready = await waitFor(() => (["READY", "FAILED", "NEEDS_OWNER", "EXPIRED", "CANCELLED"].includes(t.hub.deliveries.get(planned.id).status) ? t.hub.deliveries.get(planned.id) : null), 600000, 300)
      .catch((error) => { throw new Error(`${error.message} · ${where()}`); });
    const d = t.hub.deliveries.get(planned.id);
    const plan = d.opsPlanId ? t.hub.opsPlans.view(d.opsPlanId) : null;
    assert.equal(ready.status, "READY", `${ready.statusReason} · ${JSON.stringify(plan?.steps.map((s) => [s.seq, s.kind, s.status, s.error]))}`);
    assert.equal(t.hub.db.prepare("SELECT status FROM owner_sessions WHERE id = ?").get(owner.session.id).status, "ended", "the session really was closed the whole time");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM owner_sessions WHERE status = 'active'").get().n, 0, "no new session was opened for it");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent'").get().n, 0, "no second confirmation");
    for (const k of ["delivery.office.document", "delivery.campaign", "delivery.package.index"]) assert.equal(plan.steps.find((st) => st.kind === k)?.status, "DONE", k);
    assert.equal(plan.steps.find((st) => st.kind === "delivery.office.workbook"), undefined, "no Excel asked");
  } finally { await t.cleanup(); }
});
