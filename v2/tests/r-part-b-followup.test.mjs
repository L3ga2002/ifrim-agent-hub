import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, waitFor, registerCleanupGuard } from "./helpers.mjs";
import { fakeLaunchers } from "./media-helpers.mjs";
import * as capture from "../server/media/capture.mjs";
import { measureHold } from "../server/media/holds.mjs";

registerCleanupGuard();

test("part B restart: deliveries boot reopens event handling after each close", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  const { deliveries, db, bus } = h.hub;
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO deliveries (id, project_id, title, status, template_json, template_sha, ops_steps_json,
    ops_body_sha, created_by, created_at, updated_at) VALUES ('restart-delivery', ?, 'Restart', 'ARMED', '{}', '', '[]', '', 'test', ?, ?)`)
    .run(h.hub.projects.hub().id, at, at);
  for (let cycle = 0; cycle < 2; cycle++) {
    await deliveries.close_();
    deliveries.onEvent({ type: "system.stop_all" });
    assert.equal(deliveries.get("restart-delivery").status, "ARMED", "closed listener cannot act");
    deliveries.boot(); deliveries.boot(); // repeated boot must not duplicate subscriptions
    bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "restart", source: "test", payload: {} });
    await waitFor(() => deliveries.get("restart-delivery").status === "CANCELLED", 1000, 10, { signal: t.signal });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'delivery.status' AND scope_id = 'restart-delivery'").get().n, cycle + 1);
    db.prepare("UPDATE deliveries SET status = 'ARMED' WHERE id = 'restart-delivery'").run();
  }
});

test("part B restart: media boot reopens render, capture and tools; next close drains again", async (t) => {
  const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: fakeLaunchers(), ffmpeg: null, ffprobe: null } } });
  t.after(() => h.cleanup());
  const media = h.hub.media;
  let previous;
  for (let cycle = 0; cycle < 2; cycle++) {
    const closing = media.close();
    if (previous) assert.notEqual(closing, previous, "boot clears the cached close promise");
    previous = closing;
    await closing; media.detach();
    assert.deepEqual(media.render.tick(), { idle: true, reason: "shutdown" });
    await assert.rejects(media.capture.captureBrowserDemo({ actor: "test" }), (e) => e.code === "HUB_SHUTDOWN");
    await assert.rejects(media.tools.run({ tool: "ffmpeg", args: ["-version"] }), (e) => e.code === "HUB_SHUTDOWN");
    media.boot();
    assert.deepEqual(media.render.tick(), { idle: true });
    await assert.rejects(media.capture.captureBrowserDemo({ actor: "test" }), (e) => e.code === "DEMO_ALLOW_ORIGIN_REQUIRED");
    const result = await media.tools.run({ tool: "ffmpeg", args: ["-version"], cwd: h.config.mediaWorkDir });
    assert.equal(result.code, 0);
    const tick = media.render.tick; let ticks = 0;
    media.render.tick = () => { ticks++; return tick(); };
    try { media.tick(); assert.equal(ticks, 1); } finally { media.render.tick = tick; }
  }
});

test("part B restart: recovered operation plans execute and finalize newly confirmed work", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  const owner = await enrolOwner(h);
  let calls = 0;
  h.hub.executors["test.restart"] = {
    describe: () => ({ title: "Restart", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); calls++; return { result: { restarted: true } }; },
  };
  await h.hub.opsPlans.close(); h.hub.opsPlans.detach();
  h.hub.opsPlans.recover();
  const plan = await h.hub.opsPlans.propose({ kind: "test.restart", title: "Restart", actor: "test", steps: [{ kind: "test.restart", params: {} }] });
  await h.hub.opsPlans.confirm({ planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash, session: owner.session });
  const done = await h.hub.opsPlans.idle(plan.id);
  assert.equal(calls, 1); assert.equal(done.status, "DONE");
  assert.deepEqual(done.steps[0].result, { restarted: true });
});

const measured = measureHold({ reason: "end_hold", step: 8, startMs: 7713, endMs: 8529, plannedMs: 800, verified: true });
assert.ok(measured.hold);
const endHold = { ...measured.hold, result: "VERIFIED" };
const frames = [0, 6200, 8500, 8529, 8600].map((atMs, i) => ({ file: `f${i}.jpg`, arrival: 10000 + atMs, ts: 20 + atMs / 1000 }));
const timing = { firstArrival: 10000, firstTs: 20, stopArrival: 18633, fps: 30 };
function timeline(inputFrames, options) {
  assert.equal(typeof capture.captureTimeline, "function", "captureTimeline helper missing");
  return capture.captureTimeline(inputFrames, options);
}

test("part B capture: verified end_hold excludes stop latency frames and uncovered tail", () => {
  const holds = [endHold], before = structuredClone(holds);
  for (const stopArrival of [18633, 22000]) {
    const result = timeline(frames, { ...timing, stopArrival, holds });
    assert.equal(result.endMs, 8529);
    assert.deepEqual(result.frames.map((f) => f.file), ["f0.jpg", "f1.jpg", "f2.jpg"]);
    const list = capture.buildConcatList(result.frames, result.endMs);
    assert.equal(list.totalUs, 8529000, "encode -t, expected duration and tolerance use this same end");
    assert.equal(list.totalUs / 1000 - endHold.endMs, 0, "no uncovered stop-latency tail");
    assert.doesNotMatch(list.text, /f3\.jpg|f4\.jpg/);
  }
  assert.deepEqual(holds, before, "hold boundaries and caps are never extended");
});

test("part B capture: no VERIFIED end_hold preserves both legacy end bounds", () => {
  for (const holds of [[], [{ ...endHold, result: "REJECTED" }], [{ ...endHold, reason: "highlight" }]]) {
    for (const stopArrival of [18633, 19000]) {
      const result = timeline(frames, { ...timing, stopArrival, holds });
      const expected = Math.max(stopArrival - timing.firstArrival, result.frames.at(-1).atMs + 1000 / timing.fps);
      assert.equal(result.endMs, expected);
      assert.equal(result.frames.length, frames.length);
      assert.equal(capture.buildConcatList(result.frames, result.endMs).totalUs, Math.round(expected * 1000));
    }
  }
});

test("part B capture: arrival-clock fallback trims frames at the verified end too", () => {
  const input = frames.map((f) => ({ ...f, ts: null }));
  input[3].arrival -= 1e-8; // numerically before the end, but the same microsecond in ffconcat
  const result = timeline(input, { ...timing, firstTs: null, holds: [endHold] });
  assert.equal(result.endMs, 8529);
  assert.deepEqual(result.frames.map((f) => f.atMs), [0, 6200, 8500]);
  assert.equal(capture.buildConcatList(result.frames, result.endMs).totalUs, 8529000);
});
