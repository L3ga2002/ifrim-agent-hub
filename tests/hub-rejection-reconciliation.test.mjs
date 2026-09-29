import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { reconcileHubRejection } from "../tools/reconcile-hub-018-rejection.mjs";
import { createConversationStore } from "../apps/api/src/conversation-store.mjs";
import { isolationPaths } from "../apps/api/src/subscription-isolation.mjs";

const runId = "provider-run-c8c037fd-7143-4abf-96b6-ebc41fea9bb1";
const conversationId = "conversation-e6fbedfd-3b88-4bb5-8808-0b18cf4ccb29";
const failure = "Run failed: expectedExistingSessionId is reserved for backend callers.";
const tables = ["hub_conversations", "hub_provider_runs", "hub_messages", "hub_leases", "hub_checkpoints"];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-reconcile-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-reconcile-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const database = path.join(root, ".ifrim/private/agent-hub.sqlite");
  await fs.mkdir(isolationPaths(root).state, { recursive: true });
  await fs.mkdir(path.join(root, ".ifrim/BACKUPS"));
  await fs.writeFile(path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), '{"status":"suspended"}');
  const db = new DatabaseSync(database);
  try {
    const store = createConversationStore(db);
    db.prepare(`INSERT INTO hub_conversations(id,project_slug,title,workspace,status,created_at,updated_at)
      VALUES (?, 'ifrim-agent-hub', 'synthetic', ?, 'blocked', 'before', 'before')`).run(conversationId, root);
    const metadata = { actual: null, remoteStateUnknown: true, rpcDiagnostics: {
      error: { code: "INVALID_REQUEST" }, requests: [{ method: "agent", requestId: "4:6c66c2bf-d483-452c-ab03-1bc4d9a2eb1c" }],
    }, activity: [] };
    db.prepare(`INSERT INTO hub_provider_runs(id,conversation_id,task_id,provider,model,reasoning,status,error_category,metadata_json,started_at)
      VALUES (?, ?, 'HUB-018', 'codex', 'openai/gpt-6-luna', 'max', 'blocked', 'REMOTE_STATE_UNKNOWN', ?, 'before')`)
      .run(runId, conversationId, JSON.stringify(metadata));
    store.addMessage({ conversationId, runId, role: "assistant", content: failure });
    assert.equal(store.acquireLease("workspace-write", root, conversationId, runId, "codex"), true);
    assert.equal(store.acquireLease("unrelated-resource", root, conversationId, "unrelated-run", "codex"), true);
  } finally { db.close(); }
  return { root, database, lock: path.join(isolationPaths(root).state, "maintenance.lock") };
}

function withDb(f, action, readOnly = false) {
  const db = new DatabaseSync(f.database, { readOnly });
  try { return action(db); } finally { db.close(); }
}

function snapshot(f) {
  return withDb(f, db => Object.fromEntries(tables.map(name => [name,
    db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])), true);
}

async function unlocked(f) {
  await assert.rejects(fs.access(f.lock), { code: "ENOENT" });
}

test("exact reconciliation releases one lease, preserves history and records pre-change checkpoint", async t => {
  const f = await fixture(t);
  const before = snapshot(f);
  const result = await reconcileHubRejection(f.root);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCategory, "PRE_ADMISSION_REJECTED");
  assert.equal(result.modelStarted, false);
  assert.equal(result.exactLeaseReleased, true);
  const after = snapshot(f);
  assert.deepEqual(after.hub_messages, before.hub_messages);
  assert.equal(after.hub_leases.length, 1);
  assert.equal(after.hub_leases[0].run_id, "unrelated-run");
  assert.equal(after.hub_provider_runs[0].status, "failed");
  assert.equal(JSON.parse(after.hub_provider_runs[0].usage_json).status, "not_started");
  assert.equal(after.hub_conversations[0].status, "failed");
  assert.equal(after.hub_checkpoints.length, 1);
  const envelope = JSON.parse(after.hub_checkpoints[0].envelope_json);
  assert.equal(envelope.kind, "reviewed-pre-admission-reconciliation");
  assert.equal(envelope.run.status, "blocked");
  assert.equal(envelope.lease.runId, runId);
  assert.equal(envelope.messages[0].content, failure);
  assert.ok(result.checkpoint.startsWith(path.join(f.root, ".ifrim/BACKUPS") + path.sep));
  const saved = new DatabaseSync(result.checkpoint, { readOnly: true });
  try {
    assert.equal(saved.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(saved.prepare("SELECT status FROM hub_provider_runs WHERE id=?").get(runId).status, "blocked");
    assert.equal(saved.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n, 2);
  } finally { saved.close(); }
  await unlocked(f);
});

for (const [label, change] of [
  ["other provider", db => db.prepare("UPDATE hub_provider_runs SET provider='claude' WHERE id=?").run(runId)],
  ["other model", db => db.prepare("UPDATE hub_provider_runs SET model='openai/gpt-6-sol' WHERE id=?").run(runId)],
  ["other request", db => mutateMetadata(db, m => { m.rpcDiagnostics.requests[0].requestId = "other"; })],
  ["other failure message", db => db.prepare("UPDATE hub_messages SET content='other error'").run()],
  ["accepted activity", db => mutateMetadata(db, m => { m.activity.push({ label: "OpenClaw: run admitted" }); })],
  ["remote gateway run", db => mutateMetadata(db, m => { m.gatewayRunId = "remote-run"; })],
  ["remote OpenClaw run", db => mutateMetadata(db, m => { m.openclawGatewayRunId = "remote-run"; })],
  ["actual model evidence", db => mutateMetadata(db, m => { m.actual = { verified: true }; })],
]) {
  test(`reconciliation rejects ${label} without DB mutation or backup`, async t => {
    const f = await fixture(t);
    withDb(f, change);
    const before = snapshot(f);
    await assert.rejects(reconcileHubRejection(f.root), /Exact reviewed/);
    assert.deepEqual(snapshot(f), before);
    assert.deepEqual(await fs.readdir(path.join(f.root, ".ifrim/BACKUPS")), []);
    await unlocked(f);
  });
}

function mutateMetadata(db, change) {
  const value = JSON.parse(db.prepare("SELECT metadata_json FROM hub_provider_runs WHERE id=?").get(runId).metadata_json);
  change(value);
  db.prepare("UPDATE hub_provider_runs SET metadata_json=? WHERE id=?").run(JSON.stringify(value), runId);
}

test("open failure releases acquired lock and preserves fixture database", async t => {
  const f = await fixture(t);
  const before = snapshot(f);
  await assert.rejects(reconcileHubRejection(f.root, {
    openDatabase: () => { throw new Error("Synthetic open failure"); },
  }), /Synthetic open failure/);
  assert.deepEqual(snapshot(f), before);
  await unlocked(f);
});

test("backup failure releases lock and preserves lease and all records", async t => {
  const f = await fixture(t);
  const before = snapshot(f);
  await assert.rejects(reconcileHubRejection(f.root, {
    backupDatabase: async (_db, checkpoint) => {
      assert.equal((await fs.stat(checkpoint)).size, 0);
      await assert.rejects(fs.open(checkpoint, "wx"), { code: "EEXIST" });
      throw new Error("Synthetic backup failure");
    },
  }), /Synthetic backup failure/);
  assert.deepEqual(snapshot(f), before);
  await unlocked(f);
});

test("lease deletion conflict rolls back run, checkpoint and lease atomically", async t => {
  const f = await fixture(t);
  withDb(f, db => db.exec(`CREATE TRIGGER synthetic_lease_conflict BEFORE DELETE ON hub_leases
    BEGIN SELECT RAISE(ABORT, 'Synthetic lease conflict'); END;`));
  const before = snapshot(f);
  await assert.rejects(reconcileHubRejection(f.root), /Synthetic lease conflict/);
  assert.deepEqual(snapshot(f), before);
  await unlocked(f);
});

test("concurrent running record forces rollback after exact lease release attempt", async t => {
  const f = await fixture(t);
  withDb(f, db => db.prepare(`INSERT INTO hub_provider_runs(id,conversation_id,provider,status,started_at)
    VALUES ('synthetic-concurrent', ?, 'codex', 'running', 'before')`).run(conversationId));
  const before = snapshot(f);
  await assert.rejects(reconcileHubRejection(f.root), /Concurrent active run/);
  assert.deepEqual(snapshot(f), before);
  await unlocked(f);
});

test("non-suspended admission gate cannot reconcile", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, ".ifrim/private/openclaw-subscription-gate.json"), '{"status":"approved"}');
  const before = snapshot(f);
  await assert.rejects(reconcileHubRejection(f.root), /Suspend admission/);
  assert.deepEqual(snapshot(f), before);
  await unlocked(f);
});

test("database link is rejected before opening or acquiring a lock", async t => {
  const f = await fixture(t);
  const preserved = path.join(f.root, "preserved-fixture.sqlite");
  await fs.rename(f.database, preserved);
  try { await fs.symlink(preserved, f.database, "file"); }
  catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows file symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const before = await fs.readFile(preserved);
  let opened = 0;
  let locked = 0;
  await assert.rejects(reconcileHubRejection(f.root, {
    openDatabase: () => { opened++; }, acquireLock: async () => { locked++; },
  }), /regular file/);
  assert.equal(opened, 0);
  assert.equal(locked, 0);
  assert.deepEqual(await fs.readFile(preserved), before);
});

test("linked database parent is rejected without touching its preserved contents", async t => {
  const f = await fixture(t);
  const parent = path.dirname(f.database);
  const preserved = path.join(f.root, "preserved-fixture-parent");
  await fs.rename(parent, preserved);
  await fs.symlink(preserved, parent, process.platform === "win32" ? "junction" : "dir");
  const before = await fs.readFile(path.join(preserved, "agent-hub.sqlite"));
  let opened = 0;
  let locked = 0;
  await assert.rejects(reconcileHubRejection(f.root, {
    openDatabase: () => { opened++; }, acquireLock: async () => { locked++; },
  }), /link|physical location/);
  assert.equal(opened, 0);
  assert.equal(locked, 0);
  assert.deepEqual(await fs.readFile(path.join(preserved, "agent-hub.sqlite")), before);
});

test("database directory is rejected before opening or acquiring a lock", async t => {
  const f = await fixture(t);
  await fs.rename(f.database, path.join(f.root, "preserved-fixture.sqlite"));
  await fs.mkdir(f.database);
  let opened = 0;
  let locked = 0;
  await assert.rejects(reconcileHubRejection(f.root, {
    openDatabase: () => { opened++; }, acquireLock: async () => { locked++; },
  }), /regular file/);
  assert.equal(opened, 0);
  assert.equal(locked, 0);
});
