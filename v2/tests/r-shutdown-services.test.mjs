import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, waitFor, registerCleanupGuard } from "./helpers.mjs";
import { probeNotHub } from "../server/delivery/capture-guard.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
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

for (const rejectLate of [false, true]) test(`shutdown: derived operation closes promptly, late rejection=${rejectLate}, boot recovers RUNNING`, { timeout: 30000 }, async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  const owner = await enrolOwner(h), calls = [];
  let release, dbOpenAtResume = null, beforeClose, abortedAtResume;
  const gate = new Promise((r) => { release = r; });
  const dbClose = h.hub.db.close.bind(h.hub.db);
  h.hub.db.close = () => { beforeClose = h.hub.opsPlans.view(plan.id); return dbClose(); };
  h.hub.executors["test.shutdown"] = {
    describe: ({ n }) => ({ title: `shutdown ${n}`, params: { n }, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ params, abort, authorize }) => {
      authorize({ op: "media.render" }); calls.push(params.n);
      await gate;
      try { h.hub.db.prepare("SELECT 1").get(); dbOpenAtResume = true; } catch { dbOpenAtResume = false; }
      abortedAtResume = abort.aborted;
      if (rejectLate) throw new Error("late derived step failure");
      return { result: { finished: true } };
    },
  };
  const input = { kind: "test.shutdown", title: "shutdown", steps: [1, 2].map((n) => ({ kind: "test.shutdown", params: { n } })) };
  h.hub.opsPlans.registerParent("test.delivery", { allowedOps: ["media.render"], verify: () => ({ ok: true }) });
  const body = await h.hub.opsPlans.buildBody(input);
  const plan = await h.hub.opsPlans.adoptDerived({ ...input, expectedBodySha: hashCanonical(body), sessionId: owner.session.id,
    parent: { kind: "test.delivery", id: "delivery-parent", hash: "approved", confirmedAt: new Date().toISOString() } });
  const at = new Date().toISOString();
  h.hub.db.prepare(`INSERT INTO deliveries (id, project_id, title, status, template_json, template_sha, ops_steps_json, ops_body_sha, ops_plan_id, created_by, created_at, updated_at)
    VALUES ('drain-delivery', ?, 'Drain', 'ACTIVE', '{}', '', '[]', '', ?, 'test', ?, ?)`).run(h.hub.projects.hub().id, plan.id, at, at);
  await waitFor(() => calls.length === 1, 10000, 10, { signal: t.signal });
  const started = performance.now();
  await h.hub.close();
  assert.ok(performance.now() - started < 3000, "close does not drain the held plan");
  release();
  await gate; await new Promise((r) => setImmediate(r));
  assert.equal(abortedAtResume, false, "shutdown is not owner cancellation");
  assert.equal(dbOpenAtResume, false, "held executor resumes after DB close; plan callback must be inert");
  assert.equal(beforeClose.status, "RUNNING");
  assert.deepEqual(beforeClose.steps.map((s) => s.status), ["RUNNING", "PENDING"]);
  assert.deepEqual(calls, [1]);
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
