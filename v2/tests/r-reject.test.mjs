// 2.15.1: the owner's rejection of a Software Factory result (factory.reject) — authority, exact target, repeats and concurrency,
// through the real HTTP routes of a synthetic hub (accept-helpers: fresh roots, write fence, software WebAuthn authenticator).
import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceHub, seedReady, fingerprint, settle } from "./accept-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { rejectBody, rejectionAuthorityText } from "../web/src/lib/factoryRejectLogic.js";

async function fixture(testContext, options) {
  const t = await acceptanceHub(options);
  testContext.after(() => t.cleanup());
  const target = await seedReady(t);
  return { t, target };
}
const panel = (b) => `/api/factory/${b.missionId}/reject`;
/** What the Factory panel sends: the target from GET /api/factory/:id (view.rejectTarget), read through HTTP like the page. */
async function shown(t, b, note = "Nu vreau schimbarea asta") {
  const v = await t.request(`/api/factory/${b.missionId}`, { method: "GET" });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return rejectBody(v.json, note);
}
const rejectedEvents = (t) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.rejected' ORDER BY seq").all().map((r) => JSON.parse(r.payload_json));
const bundleEvents = (t, status) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.bundle.status' AND json_extract(payload_json, '$.status') = ?").all(status).map((r) => JSON.parse(r.payload_json));
const bundleRow = (t, b) => t.hub.db.prepare("SELECT * FROM factory_bundles WHERE id = ?").get(b.bundleId);
async function unchanged(t, action, status) {
  await settle(); const before = fingerprint(t);
  const r = await action();
  assert.equal(r.status, status, JSON.stringify(r.json));
  await settle(); assert.equal(fingerprint(t), before, "a refusal leaves the mission, bundle, tasks, delivery, events and project bytes unchanged");
  return r;
}
function replaceBundle(t, b) {
  // What buildBundle does: the waiting bundle becomes STALE and a new one waits (same mission).
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'STALE' WHERE id = ?").run(b.bundleId);
  t.hub.db.prepare(`INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at)
    SELECT 'bnd_replacement', mission_id, change_set_id, change_set_sha, spec_version, manifest_json, ?, 'READY_FOR_OWNER_ACCEPTANCE', created_at FROM factory_bundles WHERE id = ?`).run("e".repeat(64), b.bundleId);
}

test("REJECT 1: real owner session, exact target → one rejection with its audit", async (c) => {
  const { t, target: b } = await fixture(c);
  const owner = await t.authenticate();
  const body = await shown(t, b);
  assert.equal(body.bundleId, b.bundleId); assert.equal(body.bundleSha, b.bundleSha); assert.ok(Number.isInteger(body.displayedVersion));
  const r = await t.request(panel(b), { body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rejected, true); assert.equal(r.json.duplicate, false); assert.equal(r.json.factory.stage, "REJECTED");
  await settle();
  const bundle = bundleRow(t, b);
  assert.deepEqual([bundle.status, bundle.decision_note], ["REJECTED", "Nu vreau schimbarea asta"]); assert.ok(bundle.decided_at);
  assert.ok(t.hub.missions.tasks(b.missionId).every((task) => ["CANCELLED", "COMPLETED", "FAILED"].includes(task.status)));
  const [e] = rejectedEvents(t); assert.equal(rejectedEvents(t).length, 1); assert.equal(bundleEvents(t, "REJECTED").length, 1);
  for (const [key, value] of Object.entries({ missionId: b.missionId, displayedVersion: body.displayedVersion, stage: "DELIVERY_READY", bundleId: b.bundleId, bundleSha: b.bundleSha,
    note: "Nu vreau schimbarea asta", sessionId: owner.sessionId, authority: "webauthn", channel: "owner", decidedAt: bundle.decided_at })) assert.equal(e[key], value, key);
  const cmd = t.hub.db.prepare("SELECT * FROM commands WHERE type = 'factory.reject'").all();
  assert.equal(cmd.length, 1); assert.equal(cmd[0].actor, `owner:${owner.sessionId}`); assert.equal(cmd[0].channel, "owner");
  assert.equal(cmd[0].id, e.commandId); assert.equal(cmd[0].correlation_id, e.correlationId);
  assert.equal(t.hub.db.prepare("SELECT COUNT(*) n FROM approvals").get().n, 0, "a rejection never waits for an approval");
  const v = t.hub.factory.view(b.missionId);
  assert.equal(v.rejectTarget, null); assert.equal(v.rejection.authority, "webauthn"); assert.equal(v.rejection.note, "Nu vreau schimbarea asta");
  assert.match(rejectionAuthorityText(v.rejection), /Windows Hello/);
  t.assertPaths();
});

for (const state of ["absent", "fake", "expired", "revoked", "revoke-all", "not-fresh"]) test(`REJECT 2: ${state} session is refused without writes`, async (c) => {
  let now = new Date();
  const { t, target: b } = await fixture(c, { clock: () => now });
  const owner = state === "absent" || state === "fake" ? null : await t.authenticate();
  const body = await shown(t, b);
  if (state === "expired") now = new Date(now.getTime() + 25 * 3600000);
  if (state === "revoked") t.hub.db.prepare("UPDATE owner_sessions SET status = 'revoked' WHERE id = ?").run(owner.sessionId);
  if (state === "revoke-all") assert.equal((await t.request("/api/owner/sessions/revoke-all", { body: { reason: "test" } })).status, 200);
  if (state === "not-fresh") now = new Date(now.getTime() + 6 * 60000);
  const r = await unchanged(t, () => t.request(panel(b), { body, ...(state === "fake" ? { sessionCookie: "ifrim_owner=fake" } : {}) }), 401);
  assert.match(JSON.stringify(r.json), /needSession|reauth/);
  assert.equal(bundleRow(t, b).status, "READY_FOR_OWNER_ACCEPTANCE");
  if (state === "not-fresh") {
    await t.authenticate({ reauth: true });
    assert.equal((await t.request(panel(b), { body })).status, 200);
  }
});

test("REJECT 3: every other path is refused (agent, cli, generic commands, internal channels, the service without authority)", async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const body = await shown(t, b);
  for (const channel of ["agent", "cli"]) await unchanged(t, () => t.request(panel(b), { body, headers: { "X-Hub-Channel": channel } }), 403);
  for (const channel of ["ui", "test", "owner", "automation", "agent"]) await unchanged(t, () => t.request("/api/commands", { body: { type: "factory.reject", payload: { missionId: b.missionId, ...body } }, headers: { "X-Hub-Channel": channel, "X-Hub-Delegation": "test delegation reference" } }), 403);
  const payload = { missionId: b.missionId, ...body };
  for (const channel of ["ui", "voice", "companion", "automation", "schedule", "recovery", "cli", "agent"]) {
    await settle(); const before = fingerprint(t);
    await assert.rejects(t.hub.commands.dispatch({ type: "factory.reject", payload, channel, actor: "x", delegation: "test delegation reference" }), /cannot be issued|not delegated/, channel);
    assert.equal(fingerprint(t), before, channel);
  }
  await assert.rejects(t.hub.commands.dispatch({ type: "factory.reject", payload, channel: "owner", actor: "x" }), /owner session/);
  // The service itself: no channel, the UI channel, or the owner channel without a session re-check is refused before anything.
  for (const options of [{ channel: null }, { channel: "ui" }, { channel: "owner" }, { channel: "voice", sessionCheck: () => ({}) }]) {
    await settle(); const before = fingerprint(t);
    await assert.rejects(t.hub.factory.reject(b.missionId, { ...body, ...options }), (e) => e.category === "authentication", JSON.stringify(options));
    assert.equal(fingerprint(t), before);
  }
  assert.equal(t.hub.db.prepare("SELECT COUNT(*) n FROM approvals").get().n, 0);
  assert.equal(rejectedEvents(t).length, 0); assert.equal(bundleRow(t, b).status, "READY_FOR_OWNER_ACCEPTANCE");
});

test("REJECT 4: stale, replaced or incompatible target is refused without writes", async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const body = await shown(t, b);
  for (const [patch, status, code] of [
    [{ displayedVersion: body.displayedVersion + 1 }, 409, "REJECT_TARGET_STALE"], [{ displayedVersion: 0 }, 400, null],
    [{ bundleId: "bnd_other" }, 409, "REJECT_TARGET_STALE"], [{ bundleSha: "f".repeat(64) }, 409, "REJECT_TARGET_STALE"],
    [{ bundleId: null, bundleSha: null }, 409, "REJECT_TARGET_STALE"], [{ bundleSha: null }, 400, null], [{ bundleSha: b.bundleSha.slice(0, 12) }, 400, null],
    [{ displayedVersion: undefined }, 400, null], [{ displayedVersion: "1" }, 400, null], [{ note: "  " }, 400, null]]) {
    const r = await unchanged(t, () => t.request(panel(b), { body: { ...body, ...patch } }), status);
    if (code) assert.equal(r.json.error.code, code, JSON.stringify(patch));
  }
  // The page showed version v; the mission moved on (same stage, new version) → refused.
  t.hub.db.prepare("UPDATE factory_missions SET version = version + 1 WHERE mission_id = ?").run(b.missionId);
  await unchanged(t, () => t.request(panel(b), { body }), 409);
  t.hub.db.prepare("UPDATE factory_missions SET version = version - 1 WHERE mission_id = ?").run(b.missionId);
  // A new bundle replaced the displayed one.
  replaceBundle(t, b);
  assert.equal((await unchanged(t, () => t.request(panel(b), { body }), 409)).json.error.code, "REJECT_TARGET_STALE");
  // Incompatible states: a stop already requested, an active stage, an accepted mission.
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'READY_FOR_OWNER_ACCEPTANCE' WHERE id = ?").run(b.bundleId);
  t.hub.db.prepare("DELETE FROM factory_bundles WHERE id = 'bnd_replacement'").run();
  t.hub.db.prepare("UPDATE factory_missions SET cancel_requested_at = ? WHERE mission_id = ?").run(t.config.now().toISOString(), b.missionId);
  assert.equal((await unchanged(t, () => t.request(panel(b), { body }), 409)).json.error.code, "REJECT_STATE");
  t.hub.db.prepare("UPDATE factory_missions SET cancel_requested_at = NULL, stage = 'IMPLEMENTING' WHERE mission_id = ?").run(b.missionId);
  assert.equal((await unchanged(t, () => t.request(panel(b), { body }), 409)).json.error.code, "REJECT_STATE");
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'ACCEPTED' WHERE mission_id = ?").run(b.missionId);
  assert.equal((await unchanged(t, () => t.request(panel(b), { body }), 409)).json.error.code, "MISSION_DECIDED");
  assert.equal((await t.request("/api/factory/mis_missing/reject", { body })).status, 404);
  assert.equal(rejectedEvents(t).length, 0);
});

test("REJECT 4b: a decision state without a waiting bundle is rejected only as „no bundle”", async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'STALE' WHERE id = ?").run(b.bundleId);
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'NEEDS_OWNER_DECISION' WHERE mission_id = ?").run(b.missionId);
  const body = await shown(t, b, "Nu continua misiunea");
  assert.deepEqual([body.bundleId, body.bundleSha], [null, null]);
  await unchanged(t, () => t.request(panel(b), { body: { ...body, bundleId: b.bundleId, bundleSha: b.bundleSha } }), 409);
  const r = await t.request(panel(b), { body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [e] = rejectedEvents(t);
  assert.deepEqual([e.stage, e.bundleId, e.bundleSha], ["NEEDS_OWNER_DECISION", null, null]);
  assert.equal(bundleRow(t, b).status, "STALE", "a bundle that was not waiting is not decided");
  assert.equal(bundleEvents(t, "REJECTED").length, 0);
});

for (const fault of ["revoked", "revoke-all", "replacement", "version", "cancel", "accepted"]) test(`REJECT 5: re-check after the preview stop — ${fault}`, async (c) => {
  const { t, target: b } = await fixture(c); const owner = await t.authenticate();
  const body = await shown(t, b);
  let stopped = 0;
  t.hub.factoryRunner.stop = async () => {
    stopped += 1;
    if (fault === "revoked") t.hub.db.prepare("UPDATE owner_sessions SET status = 'revoked' WHERE id = ?").run(owner.sessionId);
    if (fault === "revoke-all") t.hub.trust.revokeAllSessions("test", "test");
    if (fault === "replacement") replaceBundle(t, b);
    if (fault === "version") t.hub.db.prepare("UPDATE factory_missions SET version = version + 1 WHERE mission_id = ?").run(b.missionId);
    if (fault === "cancel") t.hub.db.prepare("UPDATE factory_missions SET cancel_requested_at = ? WHERE mission_id = ?").run(t.config.now().toISOString(), b.missionId);
    if (fault === "accepted") {
      t.hub.db.prepare("UPDATE factory_bundles SET status = 'OWNER_ACCEPTED', decided_at = ? WHERE id = ?").run(t.config.now().toISOString(), b.bundleId);
      t.hub.db.prepare("UPDATE factory_missions SET stage = 'ACCEPTED', version = version + 1 WHERE mission_id = ?").run(b.missionId);
    }
  };
  const r = await t.request(panel(b), { body });
  assert.equal(r.status, fault.startsWith("revoke") ? 401 : 409, JSON.stringify(r.json));
  assert.equal(stopped, 1);
  assert.equal(rejectedEvents(t).length, 0); assert.equal(bundleEvents(t, "REJECTED").length, 0);
  const bundle = bundleRow(t, b);
  assert.notEqual(bundle.status, "REJECTED"); assert.ok(!bundle.decision_note);
  assert.notEqual(t.hub.factory.view(b.missionId).factory.stage, "REJECTED");
});

test("REJECT 6: no approve-then-execute path — the command never waits and cannot be executed again", async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const r = await t.request(panel(b), { body: await shown(t, b) });
  assert.equal(r.status, 200); assert.equal(r.json.approvalRequired, undefined);
  const [cmd] = t.hub.db.prepare("SELECT * FROM commands WHERE type = 'factory.reject'").all();
  assert.equal(cmd.status, "executed"); assert.equal(cmd.approval_id, null);
  await settle(); const before = fingerprint(t);
  const again = await t.request(`/api/commands/${cmd.id}/execute`, { body: {} });
  assert.ok(again.status >= 400, JSON.stringify(again.json)); assert.equal(fingerprint(t), before);
});

for (const concurrent of [false, true]) for (const key of [false, true]) test(`REJECT 7: repeats concurrent=${concurrent}, idempotency key=${key} → one decision`, async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const body = await shown(t, b);
  const send = (note) => t.request(panel(b), { body: { ...body, note }, headers: key ? { "Idempotency-Key": "reject-key" } : {} });
  const results = concurrent ? await Promise.all([send("prima notă"), send("prima notă")]) : [await send("prima notă"), await send("prima notă")];
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
  const original = results.find((r) => !r.json.duplicate).json, duplicate = results.find((r) => r.json.duplicate).json;
  assert.equal(duplicate.decidedAt, original.decidedAt); assert.equal(duplicate.note, "prima notă"); assert.equal(duplicate.factory.stage, "REJECTED");
  assert.equal(rejectedEvents(t).length, 1); assert.equal(bundleEvents(t, "REJECTED").length, 1);
  // Another reason against the decided mission: refused, the original reason, author and moment kept, nothing doubled.
  const other = await unchanged(t, () => send("alt motiv"), 409);
  assert.equal(other.json.error.code, "REJECT_ALREADY_DECIDED");
  assert.equal(bundleRow(t, b).decision_note, "prima notă"); assert.equal(rejectedEvents(t)[0].note, "prima notă");
  // A repeat after the session was revoked is refused (no replay of the earlier answer).
  t.hub.trust.revokeAllSessions("test", "test");
  await unchanged(t, () => send("prima notă"), 401);
});

test("REJECT 7b: two concurrent rejections with different reasons → one decision, the other refused", async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const body = await shown(t, b);
  const results = await Promise.all([t.request(panel(b), { body: { ...body, note: "motivul A" } }), t.request(panel(b), { body: { ...body, note: "motivul B" } })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const won = results.find((r) => r.status === 200).json;
  assert.equal(results.find((r) => r.status === 409).json.error.code, "REJECT_ALREADY_DECIDED");
  assert.equal(rejectedEvents(t).length, 1); assert.equal(rejectedEvents(t)[0].note, won.note); assert.equal(bundleRow(t, b).decision_note, won.note);
});

for (const order of ["concurrent", "accept-first", "reject-first"]) test(`REJECT 7c: acceptance versus rejection (${order}) → exactly one terminal decision`, async (c) => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const body = await shown(t, b);
  const accept = () => t.request(b.panel, { body: b.body }), reject = () => t.request(panel(b), { body });
  let a, r;
  if (order === "concurrent") [a, r] = await Promise.all([accept(), reject()]);
  else if (order === "accept-first") { a = await accept(); r = await reject(); }
  else { r = await reject(); a = await accept(); }
  const statuses = [a.status, r.status];
  assert.deepEqual([...statuses].sort(), [200, 409], JSON.stringify([a.json, r.json]));
  if (order === "accept-first") assert.equal(r.json.error.code, "MISSION_DECIDED");
  await settle();
  const stage = t.hub.factory.view(b.missionId).factory.stage, bundle = bundleRow(t, b);
  const accepted = bundleEvents(t, "OWNER_ACCEPTED").length, rejected = rejectedEvents(t).length;
  if (a.status === 200) assert.deepEqual([stage, bundle.status, accepted, rejected], ["ACCEPTED", "OWNER_ACCEPTED", 1, 0]);
  else assert.deepEqual([stage, bundle.status, accepted, rejected], ["REJECTED", "REJECTED", 0, 1]);
});

test("REJECT 9: local development profile is recorded as local_dev_profile, never Windows Hello; profile off refuses", async (c) => {
  let profile = { enabled: true, version: 1, id: "dev_reject01", ...machineIdentity() };
  const { t, target: b } = await fixture(c, { devProfile: () => profile });
  await t.authenticate({ dev: true });
  const body = await shown(t, b);
  profile = { ...profile, enabled: false };
  await unchanged(t, () => t.request(panel(b), { body }), 401);
  profile = { ...profile, enabled: true }; await t.authenticate({ dev: true });
  const r = await t.request(panel(b), { body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [e] = rejectedEvents(t);
  assert.equal(e.authority, "local_dev_profile"); assert.equal(bundleEvents(t, "REJECTED")[0].authority, "local_dev_profile");
  const text = rejectionAuthorityText(t.hub.factory.view(b.missionId).rejection);
  assert.match(text, /sesiune locală de dezvoltare/); assert.doesNotMatch(text, /Windows Hello/);
});

test("REJECT UI logic: the body is the displayed target; nothing to send when the page shows none", () => {
  assert.deepEqual(rejectBody({ rejectTarget: { displayedVersion: 7, bundleId: "bnd_x", bundleSha: "a".repeat(64), stage: "DELIVERY_READY" } }, "motiv"),
    { note: "motiv", displayedVersion: 7, bundleId: "bnd_x", bundleSha: "a".repeat(64) });
  assert.deepEqual(rejectBody({ rejectTarget: { displayedVersion: 3, bundleId: null, bundleSha: null } }, "motiv"), { note: "motiv", displayedVersion: 3, bundleId: null, bundleSha: null });
  assert.equal(rejectBody({ rejectTarget: null }, "motiv"), null);
  assert.equal(rejectBody({}, "motiv"), null);
  assert.match(rejectionAuthorityText({ authority: "test" }), /canalul de test/);
  assert.match(rejectionAuthorityText(null), /nu e înregistrată/);
});
