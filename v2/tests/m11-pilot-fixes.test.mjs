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

test("M11-PF-02 the Hub uses the Codex CLI the desktop selected (CODEX_CLI_PATH), not the newest file in the desktop bundle", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { selectedCodexCli } = await import("../server/providers/codex.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codexcli-"));
  const exe = path.join(dir, "codex.exe");
  fs.writeFileSync(exe, "");
  try {
    assert.equal(selectedCodexCli({ env: { CODEX_CLI_PATH: exe } }), exe);
    assert.equal(selectedCodexCli({ env: { CODEX_CLI_PATH: path.join(dir, "missing.exe") } }), null, "a missing file is never selected");
    assert.equal(selectedCodexCli({ env: {}, platform: "win32", readUserEnv: () => exe }), exe, "read from the user's environment");
    assert.equal(selectedCodexCli({ env: {}, platform: "linux" }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("M11-PF-03 a sandboxed command never runs with an fnm/nvm per-shell node (the Codex sandbox cannot launch it): the system node is used", async () => {
  const path = await import("node:path");
  const { sandboxNodePath, commandArgv } = await import("../server/factory/runner.mjs");
  const fnm = String.raw`C:\Users\u\AppData\Local\fnm_multishells\2516_1\node.exe`;
  const pf = String.raw`C:\Program Files`;
  const sys = path.join(pf, "nodejs", "node.exe");
  const own = String.raw`D:\n\node.exe`;
  const exists = (p) => p === sys;
  assert.equal(sandboxNodePath({ env: { ProgramFiles: pf }, platform: "win32", execPath: fnm, exists }), sys);
  assert.equal(sandboxNodePath({ env: {}, platform: "win32", execPath: sys, exists }), sys, "a system node stays");
  assert.equal(sandboxNodePath({ env: { HUB_SANDBOX_NODE: own }, platform: "win32", execPath: fnm, exists: () => true }), own);
  assert.equal(sandboxNodePath({ env: {}, platform: "win32", execPath: fnm, exists: () => false }), fnm, "no system node: unchanged (the sandbox then reports it)");
  assert.deepEqual(commandArgv("node server.js", sys), [sys, "server.js"]);
  assert.deepEqual(commandArgv("node --test a.mjs", sys), [sys, "--test", "--test-reporter=tap", "a.mjs"]);
});
