import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, waitFor, registerCleanupGuard } from "./helpers.mjs";
import { probeNotHub } from "../server/delivery/capture-guard.mjs";
import { fakeLaunchers } from "./media-helpers.mjs";
import { createHub } from "../server/hub.mjs";
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

test("shutdown: operation drains before DB, stays RUNNING for boot, and next step never runs", { timeout: 30000 }, async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  const owner = await enrolOwner(h), calls = [];
  let release, dbOpenAtResume = null, beforeClose;
  const gate = new Promise((r) => { release = r; });
  const dbClose = h.hub.db.close.bind(h.hub.db);
  h.hub.db.close = () => { beforeClose = h.hub.opsPlans.view(plan.id); return dbClose(); };
  const plansClose = h.hub.opsPlans.close;
  h.hub.opsPlans.close = (...args) => { setTimeout(release, 30); return plansClose(...args); };
  h.hub.executors["test.shutdown"] = {
    describe: ({ n }) => ({ title: `shutdown ${n}`, params: { n }, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ params, abort, authorize }) => {
      authorize({ op: "media.render" }); calls.push(params.n);
      await gate;
      try { h.hub.db.prepare("SELECT 1").get(); dbOpenAtResume = true; } catch { dbOpenAtResume = false; }
      assert.equal(abort.aborted, false, "shutdown is not owner cancellation");
      return { result: { finished: true } };
    },
  };
  const plan = await h.hub.opsPlans.propose({ kind: "test.shutdown", title: "shutdown", actor: "test", steps: [1, 2].map((n) => ({ kind: "test.shutdown", params: { n } })) });
  const at = new Date().toISOString();
  h.hub.db.prepare(`INSERT INTO deliveries (id, project_id, title, status, template_json, template_sha, ops_steps_json, ops_body_sha, ops_plan_id, created_by, created_at, updated_at)
    VALUES ('drain-delivery', ?, 'Drain', 'ACTIVE', '{}', '', '[]', '', ?, 'test', ?, ?)`).run(h.hub.projects.hub().id, plan.id, at, at);
  await h.hub.opsPlans.confirm({ planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash, session: owner.session });
  await waitFor(() => calls.length === 1, 10000, 10, { signal: t.signal });
  await h.hub.close();
  assert.equal(dbOpenAtResume, true, "executor finished before db.close (outside the plan runner's catch)");
  assert.equal(beforeClose.status, "RUNNING");
  assert.deepEqual(beforeClose.steps.map((s) => s.status), ["RUNNING", "PENDING"]);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(h.hub.media.render.tick(), { idle: true, reason: "shutdown" });
  await assert.rejects(h.hub.runs.start({}), (e) => e.code === "HUB_SHUTDOWN");
  const next = createHub(h.config, { homeDir: h.homeDir });
  try {
    await next.boot();
    assert.equal(next.opsPlans.view(plan.id).status, "NEEDS_OWNER");
    assert.equal(next.opsPlans.view(plan.id).steps[0].status, "UNCERTAIN");
    await waitFor(() => next.deliveries.get("drain-delivery").status === "NEEDS_OWNER", 1000);
  } finally { await next.close(); }
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

test("shutdown: in-flight media tool exits before DB closes without owner cancellation", { timeout: 30000 }, async (t) => {
  const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: fakeLaunchers({ FAKE_FFMPEG_MODE: "hang" }), ffmpeg: null, ffprobe: null } } });
  t.after(() => h.cleanup());
  const key = "media:cleanup:held";
  const pending = h.hub.media.tools.run({ tool: "ffmpeg", args: ["-version"], key, cwd: h.config.mediaWorkDir });
  const observed = pending.then((result) => { assert.ok(h.hub.db.prepare("SELECT 1").get()); return result; });
  await waitFor(() => h.hub.supervisor.get(key), 10000, 10, { signal: t.signal });
  await h.hub.close();
  const result = await observed;
  assert.equal(result.cancelled, false);
  assert.deepEqual(h.hub.supervisor.list(), []);
});
