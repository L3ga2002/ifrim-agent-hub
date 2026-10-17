import test from "node:test";
import assert from "node:assert/strict";
import { ownedProcessTree, PROCESS_LAUNCH_TOLERANCE_MS } from "../server/runtime/supervisor.mjs";
import { recordedProcessTree } from "./manual/s25-isolated-rehearsal.mjs";
import { compareProcessIdentity } from "./manual/s25-process-identity.mjs";

const at = (ms) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
const root = () => ({ key: "owned", pid: 10, root: true, startRequestedAt: at(100), startedAt: at(110) });
const row = (ms, pid = 10, parentPid = 1) => ({ pid, parentPid, creationDate: at(ms) });

for (const match of [ownedProcessTree, recordedProcessTree]) {
  test(`${match.name}: creation 15 ms before launch matches`, () => {
    assert.deepEqual(match([root()], [row(85)], at(200)).map((p) => p.pid), [10]);
  });

  test(`${match.name}: creation 40 ms before launch does not match`, () => {
    assert.deepEqual(match([root()], [row(60)], at(200)), []);
  });

  test(`${match.name}: launch tolerance is inclusive and bounded on both sides`, () => {
    assert.equal(PROCESS_LAUNCH_TOLERANCE_MS, 32);
    for (const [ms, matches] of [[68, true], [67, false], [142, true], [143, false]]) {
      assert.equal(match([root()], [row(ms)], at(200)).length, Number(matches), `creation offset ${ms}`);
    }
  });

  test(`${match.name}: known identity rejects a reused PID even within tolerance`, () => {
    for (const ms of [101, 115, 143]) {
      assert.deepEqual(match([{ ...root(), creationDate: at(100) }], [row(ms), row(ms + 1, 11, 10)], at(200)), []);
    }
    assert.equal(match([{ ...root(), creationDate: at(100) }], [row(100)], at(200)).length, 1);
  });

  test(`${match.name}: a known parent's creation time stays an exact descendant lower bound`, () => {
    assert.deepEqual(match([{ ...root(), creationDate: at(100) }],
      [row(100), row(99, 11, 10), row(100, 12, 10)], at(200)).map((p) => p.pid), [10, 12]);
  });
}

test("ownedProcessTree: unknown parent uses tolerant descendant and replacement bounds", () => {
  assert.deepEqual(ownedProcessTree([root()], [row(85), row(67, 11, 10), row(68, 12, 10)]).map((p) => p.pid), [10, 12]);
  assert.deepEqual(ownedProcessTree([root()], [row(142), row(150, 11, 10)]).map((p) => p.pid), [10, 11]);
  assert.deepEqual(ownedProcessTree([root()], [row(143), row(150, 11, 10)]), []);
});

test("recordedProcessTree: absence waits until the uncaptured launch window has passed", () => {
  const records = [root()];
  recordedProcessTree(records, [], at(141));
  assert.equal(records[0].absentAt, undefined);
  assert.deepEqual(recordedProcessTree(records, [row(142)], at(142)).map((p) => p.pid), [10]);
  recordedProcessTree(records, [], at(143));
  assert.equal(records[0].absentAt, at(143), "captured identities retain exact absence checks");
  const absent = [root()];
  recordedProcessTree(absent, [], at(142));
  assert.equal(absent[0].absentAt, at(142));
});

test("compareProcessIdentity: a later creation stamp remains a different process", () => {
  const record = { ...root(), creationDate: at(100), startTimeSource: "Win32_Process.CreationDate" };
  assert.deepEqual(compareProcessIdentity(record, { rows: [row(101)], error: null }), { gone: true, verificationError: null });
});
