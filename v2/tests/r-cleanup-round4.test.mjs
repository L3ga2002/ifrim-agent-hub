import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createSupervisor, verifiedFailureTree } from "../server/runtime/supervisor.mjs";
import { finishShutdown } from "../server/runtime/production-shutdown.mjs";
import { FIXTURES, makeTestHub, tempDir } from "./helpers.mjs";

const config = { testMode: true, allowedTestBinaryDir: FIXTURES };
const launch = (s) => s.start({ key: "owned", executable: process.execPath,
  args: [path.join(FIXTURES, "cleanup-bounded.mjs"), "--blocker", "--life=18000"], cwd: FIXTURES });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

for (const verification of ["reused", "gone", "same", "unavailable"]) test(`round4 failure tree: fresh close identity ${verification}`, async (t) => {
  let record, snapshots = 0;
  const originalDate = "2026-01-01T00:00:00.000Z";
  const descendant = { pid: process.pid, parentPid: 0, creationDate: originalDate, name: "synthetic-descendant" };
  const supervisor = createSupervisor({ config,
    treeKill: async () => { throw new Error("injected taskkill failure"); },
    snapshot: async () => {
      if (++snapshots === 1) return [{ pid: record.pid, parentPid: 1, creationDate: record.startedAt, name: "node.exe" },
        { ...descendant, parentPid: record.pid, creationDate: record.startedAt }];
      if (verification === "unavailable") throw new Error("fresh snapshot unavailable");
      if (verification === "gone") return [];
      return [{ ...descendant, creationDate: verification === "same" ? record.startedAt : originalDate }];
    },
  });
  t.after(() => supervisor.close());
  record = launch(supervisor);
  const stopped = await supervisor.stop(record.key, { graceMs: 0 });
  assert.equal(stopped.stopped, true);
  await record.exit;
  const closed = await supervisor.close();
  assert.equal(snapshots, 2, "one failure snapshot plus one fresh bounded snapshot at close");
  assert.equal(closed.survivors.length, verification === "same" ? 1 : 0);
  if (verification === "same") assert.equal(closed.survivors[0].creationDate, record.startedAt);
  assert.equal(closed.unverified.length, verification === "unavailable" ? 1 : 0);
  assert.equal(record.failureTree[0].exitedAt !== undefined, verification !== "unavailable");
});

test("round4 descendant exit bound survives later PID reuse and absence", () => {
  const row = { pid: 10, parentPid: 1, creationDate: "2026-01-01T00:00:00.000Z" };
  const tree = [{ ...row }];
  assert.deepEqual(verifiedFailureTree(tree, [{ ...row, creationDate: "2026-01-01T00:00:01.000Z" }], "exit-bound"), []);
  assert.equal(tree[0].exitedAt, "exit-bound");
  assert.deepEqual(verifiedFailureTree(tree, [row]), [], "an exited identity cannot be resurrected");
});

for (const fail of [false, true]) test(`round4 root exited before late close: taskkill failure=${fail}`, async (t) => {
  let fallback = 0, snapshots = 0;
  const supervisor = createSupervisor({ config,
    treeKill: async (record) => {
      // Hold the close notification while the process handle already has an exit code.
      const listeners = record.child.listeners("close");
      record.child.removeAllListeners("close");
      const exited = new Promise((resolve) => record.child.once("exit", resolve));
      record.child.kill("SIGKILL"); await exited;
      t.after(() => { for (const listener of listeners) listener(record.child.exitCode); });
      if (fail) throw new Error("late taskkill failure");
      return { exitCode: 0 };
    },
    snapshot: async () => { snapshots++; return []; },
    killHandle: () => { fallback++; return false; },
  });
  const record = launch(supervisor);
  t.after(() => supervisor.close());
  const started = performance.now();
  const result = await supervisor.stop(record.key, { graceMs: 0 });
  assert.equal(result.stopped, true);
  assert.equal(fallback, 0);
  assert.equal(result.error?.handle, undefined);
  assert.ok(performance.now() - started < 4000, "no extra 8 s exit wait");
  assert.equal(Boolean(record.treeUnverified), fail);
  assert.deepEqual((await supervisor.close()).survivors, []);
  assert.equal(snapshots, fail ? 2 : 0);
});

test("round4 shutdown waits for preparation beyond the former 25 s bound", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = deferred(), calls = [];
  const closing = finishShutdown({ prepare: () => held.promise, hub: { close: async () => calls.push("close") },
    pidFile: path.join(tempDir("shutdown-bound"), "absent.json"), exit: () => calls.push("exit") });
  await Promise.resolve();
  t.mock.timers.tick(26000);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(calls, [], "neither hub.close nor exit may race stopAll");
  held.resolve(); await closing;
  assert.deepEqual(calls, ["close", "exit"]);
});

test("round4 hub close still settles runs when a tree is unverified or a survivor exists", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  let settled = 0;
  h.hub.supervisor.close = async () => ({ results: [], survivors: [{ key: "synthetic", pid: -1, startedAt: "synthetic" }], unverified: [] });
  h.hub.runs.settle = async () => { settled++; };
  await assert.rejects(h.hub.close(), /supervisor survivor synthetic/);
  assert.equal(settled, 1);
  h.hub.close = async () => {}; // expected close error was asserted
});

