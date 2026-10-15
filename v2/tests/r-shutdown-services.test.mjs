import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, waitFor, registerCleanupGuard } from "./helpers.mjs";
import { probeNotHub } from "../server/delivery/capture-guard.mjs";
import { fakeLaunchers } from "./media-helpers.mjs";
registerCleanupGuard();

test("shutdown: idempotent close aggregates independent failures and always closes DB", async (t) => {
  const h = await makeTestHub();
  let dbClosed = 0, desktopClosed = 0;
  const dbClose = h.hub.db.close.bind(h.hub.db), factoryClose = h.hub.factory.close;
  h.hub.db.close = () => { dbClosed++; dbClose(); };
  h.hub.factory.close = async () => { await factoryClose(); throw new Error("factory failure sentinel"); };
  h.hub.desktop.close = async () => { desktopClosed++; throw new Error("desktop failure sentinel"); };
  const first = h.hub.close();
  assert.equal(h.hub.close(), first);
  await assert.rejects(first, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /factory.close: factory failure sentinel/);
    assert.match(error.message, /desktop.close: desktop failure sentinel/);
    return true;
  });
  assert.equal(dbClosed, 1); assert.equal(desktopClosed, 1);
  assert.throws(() => h.hub.db.prepare("SELECT 1"), /not open/);
  // The intentional failure is asserted here; restore the close result solely for the fixture directory removal.
  h.hub.close = async () => {};
  t.after(() => h.cleanup());
});

test("shutdown: operation in flight sees cancellation, drains before DB, and next step never runs", { timeout: 30000 }, async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  const owner = await enrolOwner(h), calls = [];
  h.hub.executors["test.shutdown"] = {
    describe: ({ n }) => ({ title: `shutdown ${n}`, params: { n }, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ params, abort, authorize }) => {
      authorize({ op: "media.render" }); calls.push(params.n);
      await waitFor(() => abort.aborted, 10000, 10, { signal: t.signal });
      assert.ok(h.hub.db.prepare("SELECT 1").get());
      return { result: { cancelled: true } };
    },
  };
  const plan = await h.hub.opsPlans.propose({ kind: "test.shutdown", title: "shutdown", actor: "test", steps: [1, 2].map((n) => ({ kind: "test.shutdown", params: { n } })) });
  await h.hub.opsPlans.confirm({ planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash, session: owner.session });
  await waitFor(() => calls.length === 1, 10000, 10, { signal: t.signal });
  await h.hub.close();
  assert.deepEqual(calls, [1]);
  assert.deepEqual(h.hub.media.render.tick(), { idle: true, reason: "shutdown" });
  await assert.rejects(h.hub.runs.start({}), (e) => e.code === "HUB_SHUTDOWN");
});

test("capture probe: preserves error.name, cause.code and elapsed time without retry", async () => {
  let calls = 0;
  await assert.rejects(probeNotHub("http://127.0.0.1:46200", { fetch: async () => {
    calls++; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  } }), (error) => {
    assert.equal(error.code, "CAPTURE_TARGET_UNREACHABLE"); assert.equal(error.category, "tool");
    assert.equal(error.details.errorName, "TypeError"); assert.equal(error.details.causeCode, "ECONNREFUSED");
    assert.ok(error.details.elapsedMs >= 0); return true;
  });
  assert.equal(calls, 1);
});

test("shutdown: pending capture admission is drained and cannot launch a browser", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  let release;
  const gate = new Promise((r) => { release = r; });
  const capture = h.hub.media.capture.captureBrowserDemo({ actor: "test", origin: "http://127.0.0.1:46200",
    allowOrigin: async () => { await gate; return true; }, captureLabel: "SIMULATION", steps: [] });
  const refused = assert.rejects(capture, (e) => e.code === "HUB_SHUTDOWN");
  const closing = h.hub.close();
  release();
  await refused; await closing;
  assert.deepEqual(h.hub.supervisor.list(), []);
});

test("shutdown: in-flight media tool is cancelled and awaited before DB closes", { timeout: 30000 }, async (t) => {
  const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: fakeLaunchers({ FAKE_FFMPEG_MODE: "hang" }), ffmpeg: null, ffprobe: null } } });
  t.after(() => h.cleanup());
  const key = "media:cleanup:held";
  const pending = h.hub.media.tools.run({ tool: "ffmpeg", args: ["-version"], key, cwd: h.config.mediaWorkDir });
  const observed = pending.then((result) => { assert.ok(h.hub.db.prepare("SELECT 1").get()); return result; });
  await waitFor(() => h.hub.supervisor.get(key), 10000, 10, { signal: t.signal });
  await h.hub.close();
  const result = await observed;
  assert.equal(result.cancelled, true);
  assert.deepEqual(h.hub.supervisor.list(), []);
});
