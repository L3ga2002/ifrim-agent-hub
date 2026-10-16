import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { acceptanceHub, seedReady, fingerprint, settle } from "./accept-helpers.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { captureRunning, decisionRows } from "../web/src/lib/deliveryLogic.js";
import { decisionsInbox } from "../server/delivery/inbox.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";

async function fixture(testContext, options) {
  const t = await acceptanceHub(options);
  testContext.after(() => t.cleanup());
  const target = await seedReady(t);
  return { t, target };
}
const acceptedEvents = t => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.bundle.status' AND json_extract(payload_json, '$.status') = 'OWNER_ACCEPTED'").all().map(r => JSON.parse(r.payload_json));
async function unchanged(t, action, status) {
  await settle(); const before = fingerprint(t);
  const r = await action();
  assert.equal(r.status, status, JSON.stringify(r.json));
  await settle(); assert.equal(fingerprint(t), before, "refusal leaves software, delivery, items, events and project bytes unchanged");
  return r;
}

for (const route of ["room", "panel"]) test(`ACCEPT ${route}: real owner HTTP, exact bundle, task completion and audit`, async c => {
  const { t, target: b } = await fixture(c);
  const owner = await t.authenticate();
  const r = await t.request(b[route], { body: b.body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.accepted, true); assert.equal(r.json.bundleId, b.bundleId); assert.equal(r.json.bundleSha, b.bundleSha);
  await settle();
  const v = t.hub.factory.view(b.missionId);
  assert.equal(v.factory.stage, "ACCEPTED"); assert.ok(v.tasks.every(task => task.status === "COMPLETED"));
  assert.equal(t.hub.missions.get(b.missionId).status, "COMPLETED");
  const [e] = acceptedEvents(t); assert.equal(acceptedEvents(t).length, 1);
  for (const [key, value] of Object.entries({ bundleId: b.bundleId, bundleSha: b.bundleSha, bundleShaDisplayed: b.bundleSha, missionId: b.missionId,
    deliveryId: route === "room" ? b.deliveryId : null, via: route === "room" ? "delivery_room" : "factory_panel", sessionId: owner.sessionId, authority: "webauthn", channel: "owner" })) assert.equal(e[key], value, key);
  assert.equal(e.integrity.ok, true); assert.match(e.integrity.decisionSha, /^[0-9a-f]{64}$/);
  const { decisionSha, ...record } = e.integrity; assert.equal(decisionSha, hashCanonical(record));
  const commands = t.hub.db.prepare("SELECT * FROM commands WHERE type IN ('delivery.software.accept','factory.accept')").all();
  assert.equal(commands.length, route === "room" ? 2 : 1);
  for (const cmd of commands) { assert.equal(cmd.actor, `owner:${owner.sessionId}`); assert.equal(cmd.channel, "owner"); assert.equal(cmd.correlation_id, e.correlationId); }
  assert.equal(commands.find(cmd => cmd.type === "factory.accept").id, e.commandId);
  assert.equal(t.hub.deliveries.items(b.deliveryId).find(i => i.kind === "bundle").meta.status, "OWNER_ACCEPTED");
});

test("ACCEPT isolation: mandatory sync, promise, open and rename write fences", async c => {
  const { t } = await fixture(c);
  const outside = path.join(t.root, "..", "tripwire-must-not-exist");
  assert.throws(() => fs.writeFileSync(outside, "no"), /outside synthetic root/);
  assert.throws(() => fsp.writeFile(outside, "no"), /outside synthetic root/);
  await assert.rejects(fsp.open(outside, "w"), /outside synthetic root/);
  assert.throws(() => fs.renameSync(path.join(t.projectDir, "README.md"), outside), /outside synthetic root/);
  t.assertPaths();
});

for (const state of ["absent", "fake", "expired", "revoked", "not-fresh"]) test(`ACCEPT ${state} session refuses both routes without writes`, async c => {
  let now = new Date();
  const { t, target: b } = await fixture(c, { clock: () => now });
  const owner = state === "absent" || state === "fake" ? null : await t.authenticate();
  if (state === "expired") now = new Date(now.getTime() + 25 * 3600000);
  if (state === "revoked") t.hub.db.prepare("UPDATE owner_sessions SET status = 'revoked' WHERE id = ?").run(owner.sessionId);
  if (state === "not-fresh") now = new Date(now.getTime() + 6 * 60000);
  for (const route of ["room", "panel"]) {
    const r = await unchanged(t, () => t.request(b[route], { body: b.body, ...(state === "fake" ? { sessionCookie: "ifrim_owner=fake" } : {}) }), 401);
    assert.match(JSON.stringify(r.json), /needSession|reauth/);
  }
  if (state === "not-fresh") { await t.authenticate({ reauth: true }); const r = await t.request(b.room, { body: b.body }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
});

test("ACCEPT channel boundaries: agent, cli, generic ui, declared test never gain owner authority", async c => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  for (const channel of ["agent", "cli"]) for (const route of ["room", "panel"]) await unchanged(t, () => t.request(b[route], { body: b.body, headers: { "X-Hub-Channel": channel } }), 403);
  for (const channel of ["ui", "test", "owner", "automation"]) await unchanged(t, () => t.request("/api/commands", { body: { type: "factory.accept", payload: { missionId: b.missionId, ...b.body } }, headers: { "X-Hub-Channel": channel } }), 403);
});

test("ACCEPT stale id, full wrong sha, prefix, another delivery binding and latest-bundle mismatch", async c => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const missing = await unchanged(t, () => t.request("/api/deliveries/dlv_missing/software-accept", { body: b.body }), 409);
  assert.equal(missing.json.error.code, "DELIVERY_MISSING");
  for (const route of ["room", "panel"]) for (const [patch, status] of [[{ bundleId: "bnd_stale" }, 409], [{ bundleSha: "f".repeat(64), displayedBundleSha: "f".repeat(64) }, 409], [{ bundleSha: b.bundleSha.slice(0, 12), displayedBundleSha: b.bundleSha.slice(0, 12) }, 400], [{ bundleId: "invalid" }, 400]])
    await unchanged(t, () => t.request(b[route], { body: { ...b.body, ...patch } }), status);
  t.hub.db.prepare("UPDATE deliveries SET bundle_id = 'bnd_other' WHERE id = ?").run(b.deliveryId);
  await unchanged(t, () => t.request(b.room, { body: b.body }), 409);
  t.hub.db.prepare("UPDATE deliveries SET bundle_id = ? WHERE id = ?").run(b.bundleId, b.deliveryId);
  replaceBundle(t, b);
  const view = t.hub.deliveries.view(b.deliveryId);
  assert.equal(view.software.bundle.id, b.bundleId); assert.equal(view.software.bundle.sha, b.bundleSha); assert.equal(view.software.bundleMismatch, true);
  for (const route of ["room", "panel"]) await unchanged(t, () => t.request(b[route], { body: b.body }), 409);
});

function replaceBundle(t, b) {
  t.hub.db.prepare(`INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at)
    SELECT 'bnd_replacement', mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at FROM factory_bundles WHERE id = ?`).run(b.bundleId);
}

for (const fault of ["replacement", "revoked", "delivery-stale", "capture", "software"]) test(`ACCEPT re-check after await: ${fault}`, async c => {
  const { t, target: b } = await fixture(c); const owner = await t.authenticate();
  t.hub.factoryRunner.stop = async () => {
    if (fault === "replacement") replaceBundle(t, b);
    if (fault === "revoked") t.hub.db.prepare("UPDATE owner_sessions SET status = 'revoked' WHERE id = ?").run(owner.sessionId);
    if (fault === "delivery-stale") t.hub.db.prepare("UPDATE deliveries SET status = 'STALE' WHERE id = ?").run(b.deliveryId);
    if (fault === "capture") capture(t, b);
    if (fault === "software") fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// changed during stop\n");
  };
  const r = await t.request(b.room, { body: b.body });
  assert.equal(r.status, fault === "revoked" ? 401 : 409, JSON.stringify(r.json));
  assert.equal(acceptedEvents(t).length, 0);
  const bundle = t.hub.db.prepare("SELECT * FROM factory_bundles WHERE id = ?").get(b.bundleId);
  assert.equal(bundle.status, fault === "software" ? "STALE" : "READY_FOR_OWNER_ACCEPTANCE"); assert.equal(bundle.decided_at, null);
});

function capture(t, b, kind = "plan") {
  const db = t.hub.db, at = t.config.now().toISOString();
  if (kind === "recording") {
    db.prepare("INSERT INTO media_capture_sessions (id, kind, status, scope_json, created_by, created_at, updated_at) VALUES ('cap_accept','browser_demo','RECORDING',?,'test',?,?)").run(JSON.stringify({ projectId: t.project.id }), at, at);
    return;
  }
  db.prepare("INSERT INTO ops_plans (id, kind, title, body_json, plan_hash, nonce, status, proposed_by, proposed_via, confirm_by, expires_at, created_at, updated_at) VALUES ('op_accept','delivery.package','capture','{}',?,'test','RUNNING','test','test',?,?,?,?)").run("a".repeat(64), at, at, at, at);
  db.prepare("INSERT INTO ops_plan_steps (id, plan_id, seq, kind, status, updated_at) VALUES ('step_accept','op_accept',1,'delivery.capture','RUNNING',?)").run(at);
  db.prepare("UPDATE deliveries SET ops_plan_id = 'op_accept' WHERE id = ?").run(b.deliveryId);
}

for (const kind of ["plan", "recording"]) test(`ACCEPT active ${kind} refuses both routes`, async c => {
  const { t, target: b } = await fixture(c); await t.authenticate(); capture(t, b, kind);
  assert.equal(captureRunning(t.hub.deliveries.view(b.deliveryId)), true);
  for (const route of ["room", "panel"]) {
    const result = await unchanged(t, () => t.request(b[route], { body: b.body }), 409);
    assert.equal(result.json.error.details[kind === "plan" ? "planId" : "sessionId"], kind === "plan" ? "op_accept" : "cap_accept");
  }
});

for (const concurrent of [false, true]) for (const key of [false, true]) test(`ACCEPT repeated HTTP concurrent=${concurrent}, key=${key}: one original decision`, async c => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const send = note => t.request(b.room, { body: { ...b.body, note }, headers: key ? { "Idempotency-Key": "accept-key" } : {} });
  const first = send("prima notă"), results = concurrent ? await Promise.all([first, send("a doua notă")]) : [await first, await send("a doua notă")];
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
  const duplicate = results.find(r => r.json.duplicate).json;
  assert.equal(duplicate.note, "prima notă"); assert.equal(duplicate.noteIgnored, true);
  const original = results.find(r => !r.json.duplicate).json;
  assert.equal(duplicate.decidedAt, original.decidedAt); assert.equal(acceptedEvents(t).length, 1);
  const cross = await t.request(b.panel, { body: { ...b.body, note: "prima notă" } });
  assert.equal(cross.json.duplicate, true); assert.equal(cross.json.noteIgnored, false); assert.equal(acceptedEvents(t).length, 1);
});

test("ACCEPT local dev profile: truthful authority and profile-off refusal", async c => {
  let profile = { enabled: true, version: 1, id: "dev_accept01", ...machineIdentity() };
  const { t, target: b } = await fixture(c, { devProfile: () => profile });
  await t.authenticate({ dev: true });
  profile = { ...profile, enabled: false };
  await unchanged(t, () => t.request(b.room, { body: b.body }), 401);
  profile = { ...profile, enabled: true }; await t.authenticate({ dev: true });
  const r = await t.request(b.room, { body: b.body });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(acceptedEvents(t)[0].authority, "local_dev_profile");
});

for (const status of ["CLOSED", "STALE"]) test(`ACCEPT repeat after delivery ${status} returns the original decision`, async c => {
  const { t, target: b } = await fixture(c); await t.authenticate();
  const first = await t.request(b.room, { body: b.body }); assert.equal(first.status, 200);
  if (status === "CLOSED") t.hub.deliveries.close(b.deliveryId);
  else t.hub.deliveries.trigger(b.deliveryId, "software_changed", { changedFiles: ["src/requests.js"] }, "test");
  for (const route of ["room", "panel"]) {
    const repeat = await unchanged(t, () => t.request(b[route], { body: b.body }), 200);
    assert.equal(repeat.json.duplicate, true); assert.equal(repeat.json.decidedAt, first.json.decidedAt);
    assert.equal(repeat.json.note, b.body.note); assert.equal(acceptedEvents(t).length, 1);
  }
});

for (const status of ["PAUSED", "CANCELLED"]) test(`ACCEPT stuck capture in ${status} plan does not block`, async c => {
  const { t, target: b } = await fixture(c); await t.authenticate(); capture(t, b);
  t.hub.db.prepare("UPDATE ops_plans SET status = ? WHERE id = 'op_accept'").run(status);
  assert.equal(captureRunning(t.hub.deliveries.view(b.deliveryId)), false);
  assert.equal((await t.request(b.room, { body: b.body })).status, 200);
});

test("ACCEPT listener only changes bundle items referring to the accepted bundle; other owner decisions stay byte-identical", async c => {
  const { t, target: b } = await fixture(c); const db = t.hub.db, at = t.config.now().toISOString();
  // A second bundle and delivery of this mission precede the displayed target.
  replaceBundle(t, b);
  db.prepare("UPDATE factory_bundles SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = 'bnd_replacement'").run();
  db.prepare(`INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, bundle_id, bundle_sha, created_by, created_at, updated_at)
    SELECT 'dlv_other', project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, 'bnd_replacement', bundle_sha, created_by, created_at, updated_at FROM deliveries WHERE id = ?`).run(b.deliveryId);
  const other = t.hub.deliveries.bindItem("dlv_other", { kind: "bundle", refTable: "factory_bundles", refId: "bnd_replacement", refSha: b.bundleSha, meta: { status: "READY_FOR_OWNER_ACCEPTANCE" } });
  const otherBefore = JSON.stringify(db.prepare("SELECT * FROM delivery_items WHERE id = ?").get(other.id));
  db.prepare("INSERT INTO media_edit_projects (id, title, created_by, created_at, updated_at) VALUES ('mep_accept','Synthetic','test',?,?)").run(at, at);
  for (const [role, version] of [["master", 1], ["vertical", 2]]) {
    db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES (?,'mep_accept',?,'{}',?,'initial','test',?)").run(`mev_${role}`, version, "a".repeat(64), at);
    db.prepare("INSERT INTO media_reviews (id, edit_version_id, kind, status, provenance, actor, created_at, updated_at) VALUES (?,?,'CREATIVE_APPROVED','RECORDED','owner','owner',?,?)").run(`review_${role}`, `mev_${role}`, at, at);
  }
  db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, variant_version_id, status, created_by, created_at, updated_at) VALUES ('mvr_accept','mep_accept','mev_master','reels_9x16','mev_vertical','READY','owner',?,?)").run(at, at);
  t.hub.deliveries.bindItem(b.deliveryId, { kind: "edit", role: "master", refTable: "media_edit_versions", refId: "mev_master" });
  t.hub.deliveries.bindItem(b.deliveryId, { kind: "variant", role: "vertical", refTable: "media_variants", refId: "mvr_accept", meta: { editVersionId: "mev_vertical" } });
  const approval = JSON.stringify({ kind: "PRESENTATION_READY", sha: "summary-sha", by: "owner", at });
  db.prepare("INSERT INTO delivery_documents (id, delivery_id, kind, version, sections_json, text, content_sha, basis_json, basis_sha, author_kind, status, approval_json, created_by, created_at) VALUES ('ddoc_accept',?,'commercial_summary',1,'[]','Synthetic summary','summary-sha','{}','basis','owner','CURRENT',?,'owner',?)").run(b.deliveryId, approval, at);
  const otherDecisions = () => {
    const { software, ...decisions } = t.hub.deliveries.view(b.deliveryId).decisions;
    return JSON.stringify({ decisions, rows: ["media_reviews", "media_variants", "delivery_documents"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()) });
  };
  const before = otherDecisions();
  assert.equal(t.hub.deliveries.view(b.deliveryId).decisions.creativeMaster, "APPROVED");
  await t.authenticate(); assert.equal((await t.request(b.room, { body: b.body })).status, 200); await settle();
  assert.equal(otherDecisions(), before);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM delivery_items WHERE id = ?").get(other.id)), otherBefore);
  assert.equal(t.hub.deliveries.items(b.deliveryId).find(i => i.kind === "bundle").meta.status, "OWNER_ACCEPTED");
});

test("ACCEPT Room shows latest unbound bundle read-only; inbox uses Room only in acceptance states", async c => {
  const { t, target: b } = await fixture(c), db = t.hub.db;
  for (const status of ["PLANNED", "ARMED"]) {
    db.prepare("UPDATE deliveries SET status = ?, bundle_id = NULL, bundle_sha = NULL WHERE id = ?").run(status, b.deliveryId);
    const view = t.hub.deliveries.view(b.deliveryId);
    assert.equal(view.software.bundle.id, b.bundleId); assert.equal(view.software.bound, false);
    assert.equal(decisionRows(view).find(r => r.key === "software").action.enabled, false);
  }
  db.prepare("UPDATE deliveries SET bundle_id = ?, bundle_sha = ? WHERE id = ?").run(b.bundleId, b.bundleSha, b.deliveryId);
  for (const status of ["PLANNED", "ARMED", "ACTIVE", "READY", "NEEDS_OWNER", "STALE", "CLOSED", "FAILED", "EXPIRED", "CANCELLED"]) {
    db.prepare("UPDATE deliveries SET status = ? WHERE id = ?").run(status, b.deliveryId);
    const item = decisionsInbox(t.hub).items.find(i => i.kind === "software_bundle");
    assert.equal(item.link, ["PLANNED", "ARMED", "ACTIVE", "READY", "NEEDS_OWNER"].includes(status) ? `/livrare/${b.deliveryId}` : `/missions/${b.missionId}`);
  }
});
