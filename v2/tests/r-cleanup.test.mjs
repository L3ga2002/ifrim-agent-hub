import { registerCleanupGuard } from "./helpers.mjs";
registerCleanupGuard();
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as supervisorModule from "../server/runtime/supervisor.mjs";
import * as helpers from "./helpers.mjs";
const { FIXTURES, waitFor } = helpers;
const { createSupervisor, ownedProcessTree } = supervisorModule;
const exec = promisify(execFile);
const config = { testMode: true, allowedTestBinaryDir: FIXTURES };
const launch = (supervisor, key) => supervisor.start({ key, executable: process.execPath, args: [path.join(FIXTURES, "cleanup-bounded.mjs"), "--blocker", "--life=18000"], cwd: FIXTURES });

async function scenario(mode) {
  let stdout = "", stderr = "", code = 0;
  const env = { ...process.env, HUB_CLEANUP_CASE: mode };
  delete env.NODE_TEST_CONTEXT; // a separate node:test harness, not the parent's IPC reporter
  try { ({ stdout, stderr } = await exec(process.execPath, ["--test", "--test-reporter=tap", path.join(FIXTURES, "cleanup-scenarios.mjs")],
    { env, windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout || ""; stderr = error.stderr || ""; code = error.code; }
  const output = stdout + stderr;
  assert.equal(code, 1, output);
  assert.match(output, new RegExp(`CLEANUP_OBSERVER_OK ${mode}`), output);
  assert.doesNotMatch(output, /asynchronous activity after the test ended|database is not open|uncaughtException|unhandledRejection/);
  if (mode === "RT-4") { assert.match(output, /failureType: 'testTimeoutFailure'/); assert.match(output, /# cancelled 1/); }
  else assert.match(output, /ORIGINAL_BODY_ERROR/);
  if (mode === "RT-3b") { assert.match(output, /failureType: 'hookFailed'/); assert.match(output, /supervisor survivor.*pid=/); }
  else assert.doesNotMatch(output, /failureType: 'hookFailed'/);
}

test("RT-1 e1: failing body releases a held author admission at close, pre-inference block and observer", { timeout: 100000 }, () => scenario("RT-1"));
test("RT-2 e2: late registration after close iteration is refused; blockers all stopped", { timeout: 45000 }, async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let kills = 0;
  const supervisor = createSupervisor({ config, treeKill: async (record) => { kills++; await gate; record.child.kill("SIGKILL"); } });
  assert.equal(typeof supervisor.close, "function", "shutdown API missing: supervisor.close");
  t.after(async () => { release(); await supervisor.close(); });
  const records = [launch(supervisor, "blocker-1"), launch(supervisor, "blocker-2"), launch(supervisor, "blocker-3")];
  const closing = supervisor.close();
  await waitFor(() => kills === 3, 8000, 20, { signal: t.signal }); // all entered concurrently, not a serial key snapshot
  assert.throws(() => launch(supervisor, "late-author"), (e) => e.code === "HUB_SHUTDOWN");
  release();
  const result = await closing;
  assert.equal(result.results.length, 3); assert.ok(result.results.every((r) => r.stopped));
  assert.deepEqual(result.survivors, []); assert.deepEqual(supervisor.list(), []);
  for (const record of records) { assert.equal(record.exited, true); assert.throws(() => process.kill(record.pid, 0)); }
});
test("RT-3a e3: taskkill failure recorded, owned handle fallback confirms exit", { timeout: 30000 }, async (t) => {
  const supervisor = createSupervisor({ config, treeKill: async () => { throw Object.assign(new Error("injected taskkill failure"), { code: "TEST_KILL" }); } });
  const record = launch(supervisor, "fallback");
  t.after(() => supervisor.close());
  const result = await supervisor.stop(record.key, { graceMs: 0 });
  assert.equal(result.stopped, true); assert.equal(result.method, "handle");
  assert.equal(result.pid, record.pid); assert.equal(result.startedAt, record.startedAt);
  assert.equal(result.taskkill.ok, false); assert.equal(result.error.code, "TEST_KILL");
  assert.throws(() => process.kill(record.pid, 0)); assert.deepEqual(supervisor.list(), []);
});
test("RT-3b e3/B2: survivor reported separately from body failure; no DB flood", { timeout: 100000 }, () => scenario("RT-3b"));
test("RT-4 B: real test-level timeout with held admission and post-test observer", { timeout: 100000 }, () => scenario("RT-4"));
test("cleanup observers: abort stops even a pending predicate promptly", async () => {
  const controller = new AbortController(), reason = new Error("test cancelled");
  const pending = waitFor(() => new Promise(() => {}), 10000, 1000, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (e) => e === reason);
  await assert.rejects(waitFor(() => new Promise(() => {}), 25, 10, { signal: new AbortController().signal }), /waitFor timed out/);
});
test("cleanup observers: process snapshot ignores reused PID and descendants of its replacement", () => {
  const records = [{ key: "owned", pid: 10, startRequestedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.020Z" }];
  const row = (pid, parentPid, sec) => ({ pid, parentPid, creationDate: `2026-01-01T00:00:0${sec}.000Z`, name: "node.exe" });
  assert.deepEqual(ownedProcessTree(records, [row(10, 1, 2), row(11, 10, 3)]), []);
  assert.deepEqual(ownedProcessTree(records, [row(10, 1, 0), row(11, 10, 1)]).map((p) => p.pid), [10, 11]);
  assert.equal(records[0].creationDate, undefined, "identity observation never mutates a live supervisor record");
});

test("cleanup fixed-key restart preserves both owned handles without introducing a conflict", { timeout: 10000 }, async (t) => {
  const supervisor = createSupervisor({ config, treeKill: async (record) => { record.child.kill("SIGKILL"); } });
  t.after(() => supervisor.close());
  const first = launch(supervisor, "worker"), second = launch(supervisor, "worker");
  assert.notEqual(first.pid, second.pid);
  assert.equal(supervisor.get("worker"), second);
  assert.equal(supervisor.list().length, 2, "restarting never loses the previous live handle");
  const closed = await supervisor.close();
  assert.deepEqual(closed.survivors, []); assert.equal(closed.results.length, 2);
  assert.ok(first.exited && second.exited);
});

test("cleanup: explicit guard keeps finally's original error and separately reports cleanup", { timeout: 30000 }, async () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  let output = "";
  try { await exec(process.execPath, ["--test", "--test-reporter=tap", path.join(FIXTURES, "cleanup-finally.mjs")], { env, windowsHide: true, timeout: 25000 }); }
  catch (error) { assert.equal(error.code, 1); output = error.stdout + error.stderr; }
  assert.match(output, /ORIGINAL_FINALLY_ERROR/);
  assert.match(output, /CLEANUP_SENTINEL/);
  assert.match(output, /failureType: 'hookFailed'/);
  assert.match(output, /# fail 2/);
  assert.doesNotMatch(output, /asynchronous activity|unhandledRejection/);
});

for (const diagnosticFailure of [false, true]) test(`cleanup native tree: owned root and grandchild gone; snapshot failure=${diagnosticFailure}`, { timeout: 45000 }, async (t) => {
  let snapshots = 0, killed = false, leaf;
  const supervisor = createSupervisor({ config,
    ...(diagnosticFailure ? {
      treeKill: async (record) => { const result = await supervisorModule.killOwnedTree(record); killed = true; throw new Error(`diagnostic failure after native kill ${result.exitCode}`); },
      snapshot: async () => { snapshots++; throw new Error("snapshot unavailable sentinel"); },
    } : {}),
  });
  const root = supervisor.start({ key: "native-tree", executable: process.execPath,
    args: [path.join(FIXTURES, "cleanup-tree.mjs")], cwd: FIXTURES,
    onStdoutLine: (line) => { leaf = JSON.parse(line).grandchild; } });
  t.after(async () => { await supervisor.close(); await root.exit; });
  await waitFor(() => leaf, 5000, 10, { signal: t.signal });
  const before = await supervisorModule.windowsProcesses();
  const identities = ownedProcessTree([{ ...root }], before);
  assert.deepEqual(identities.filter((r) => r.name.toLowerCase() === "node.exe").map((r) => r.pid).sort(), [root.pid, leaf].sort(), "both start identities captured before stop");
  const stopped = await supervisor.stop(root.key, { graceMs: 0 });
  assert.equal(stopped.stopped, true);
  if (!diagnosticFailure) { assert.equal(stopped.method, "taskkill"); assert.equal(stopped.taskkill.ok, true); }
  const closed = await supervisor.close();
  if (diagnosticFailure) {
    assert.equal(killed, true, "native tree kill did not depend on snapshot availability");
    assert.equal(snapshots, 1);
    assert.ok(closed.survivors.some((r) => r.unverified && /snapshot unavailable sentinel/.test(r.snapshotError)));
  } else assert.deepEqual(closed.survivors, []);
  const after = await supervisorModule.windowsProcesses();
  for (const identity of identities) assert.equal(after.some((r) => r.pid === identity.pid && r.creationDate === identity.creationDate), false);
});

test("cleanup native tree: root-only fallback reports surviving grandchild from Hub snapshot", { timeout: 90000 }, async (t) => {
  let leaf;
  const supervisor = createSupervisor({ config, treeKill: async () => { throw new Error("tree kill failure sentinel"); } });
  const root = supervisor.start({ key: "fallback-tree", executable: process.execPath, args: [path.join(FIXTURES, "cleanup-tree.mjs"), "--life=45000", "--detached-leaf"], cwd: FIXTURES,
    onStdoutLine: (line) => { leaf = JSON.parse(line).grandchild; } });
  t.after(async () => { await supervisor.close(); await root.exit; });
  await waitFor(() => leaf, 5000, 10, { signal: t.signal });
  const identities = ownedProcessTree([{ ...root }], await supervisorModule.windowsProcesses());
  const childIdentity = identities.find((r) => r.pid === leaf); assert.ok(childIdentity);
  const closed = await supervisor.close();
  assert.ok(closed.survivors.some((r) => r.key === `fallback-tree:descendant:${leaf}` && r.creationDate === childIdentity.creationDate));
  await waitFor(async () => !(await supervisorModule.windowsProcesses()).some((r) => r.pid === leaf && r.creationDate === childIdentity.creationDate), 60000, 1000, { signal: t.signal });
});

test("cleanup helpers: plain-node import has no harness hooks, reporter or fatal-handler exit", async () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const prelude = 'await import(' + JSON.stringify(new URL('./helpers.mjs', import.meta.url).href) + ');';
  const clean = await exec(process.execPath, ['--input-type=module', '-e', prelude + 'console.log(JSON.stringify([process.listenerCount("uncaughtException"),process.listenerCount("unhandledRejection")]));'], { env, windowsHide: true });
  assert.equal(clean.stdout.trim(), '[0,0]');
  for (const failure of ['throw new Error("LATE_THROW")', 'Promise.reject(new Error("LATE_REJECT"))']) {
    await assert.rejects(exec(process.execPath, ['--input-type=module', '-e', prelude + 'process.on("exit", code => console.log("EXIT_EVENT " + code));setTimeout(() => {' + failure + '}, 10);'], { env, windowsHide: true }), error => {
      assert.equal(error.code, 1); assert.match(error.stdout, /EXIT_EVENT 1/); assert.doesNotMatch(error.stdout, /tests 0/); return true;
    });
  }
});

test("cleanup failure snapshot precedes handle fallback; normal tree kill never queries WMI", { timeout: 15000 }, async (t) => {
  for (const fail of [false, true]) {
    const order = []; let record;
    const supervisor = createSupervisor({ config,
      treeKill: async (owned) => { order.push("tree"); if (fail) throw new Error("injected failure"); owned.child.kill("SIGKILL"); },
      snapshot: async () => {
        order.push("snapshot"); assert.equal(record.exited, false);
        return [{ pid: record.pid, parentPid: process.pid, creationDate: record.startedAt, name: "node.exe" }];
      },
      killHandle: (owned) => { order.push("handle"); return owned.child.kill("SIGKILL"); },
    });
    record = launch(supervisor, "snapshot-order");
    t.after(() => supervisor.close());
    const stopped = await supervisor.stop(record.key, { graceMs: 0 });
    assert.equal(stopped.stopped, true);
    assert.deepEqual(order, fail ? ["tree", "snapshot", "handle"] : ["tree"]);
    assert.deepEqual((await supervisor.close()).survivors, []);
  }
});
