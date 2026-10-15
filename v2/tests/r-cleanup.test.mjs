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
});
