// M11 pilot 2026-10-08 — fixes found on the live pilot (PASS_LOCAL: pure stubs, nothing starts).
import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryExecutors, PREVIEW_WAIT_MS } from "../server/delivery/executors.mjs";

test("M11-PF-01 the delivery preview waits for a cold Windows sandbox (the pilot's first command took 181 s), not the 20 s default", async () => {
  const d = { id: "dlv_x", status: "ACTIVE", opsPlanId: "ops_x", missionId: "mis_x", projectId: "prj_x", snapshotSha: "s", template: { preview: { command: "node server.mjs", url: "http://127.0.0.1:4620/" } } };
  let seen = null;
  const ex = createDeliveryExecutors({
    deliveries: { need: () => d, revisionOfPlan: () => null, trigger: () => {} },
    factory: { previewStatus: () => ({ running: false }), snapshotCheck: () => ({ actual: "s", changedFiles: [] }) },
    media: {}, projects: { get: () => ({ path: "C:/x" }) }, supervisor: {}, opsPlans: {}, config: {},
    runner: { startPreview: async (o) => { seen = o; return { status: "PASS" }; } },
  });
  const out = await ex["delivery.preview.ensure"].run({ params: { deliveryId: "dlv_x" }, planId: "ops_x", authorize: () => {} });
  assert.equal(out.result.reused, false);
  assert.ok(seen.waitMs >= 180000, `waitMs ${seen.waitMs}`);
  assert.equal(seen.waitMs, PREVIEW_WAIT_MS);
});
