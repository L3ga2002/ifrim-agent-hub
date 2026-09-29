import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireSubscriptionMaintenanceLock } from "../tools/subscription-maintenance-lock.mjs";
import { isolationPaths } from "../apps/api/src/subscription-isolation.mjs";

async function withTemporaryState(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-supported-codex-test-"));
  const state = isolationPaths(root).state;
  try {
    await fs.mkdir(state, { recursive: true });
    await run(root, path.join(state, "maintenance.lock"));
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    if (!relative.startsWith("hub-supported-codex-test-") || relative.includes(path.sep)) {
      throw new Error("Unexpected temporary cleanup path");
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

const helperSource = () => fs.readFile(new URL("../tools/select-supported-codex.mjs", import.meta.url), "utf8");

test("maintenance lock excludes another holder and can be reacquired after release", async () => {
  await withTemporaryState(async (root, lockPath) => {
    const release = await acquireSubscriptionMaintenanceLock(root);
    try {
      const before = await fs.readFile(lockPath, "utf8");
      assert.equal(JSON.parse(before).pid, process.pid);
      await assert.rejects(acquireSubscriptionMaintenanceLock(root), { code: "EEXIST" });
      assert.equal(await fs.readFile(lockPath, "utf8"), before);
    } finally {
      await release();
    }
    await assert.rejects(fs.stat(lockPath), { code: "ENOENT" });
    const releaseAgain = await acquireSubscriptionMaintenanceLock(root);
    await releaseAgain();
    await assert.rejects(fs.stat(lockPath), { code: "ENOENT" });
  });
});

test("concurrent maintenance acquisitions admit exactly one holder", async () => {
  await withTemporaryState(async (root) => {
    const outcomes = await Promise.allSettled([
      acquireSubscriptionMaintenanceLock(root),
      acquireSubscriptionMaintenanceLock(root),
    ]);
    try {
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      const rejected = outcomes.filter((item) => item.status === "rejected");
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, "EEXIST");
    } finally {
      for (const item of outcomes) if (item.status === "fulfilled") await item.value();
    }
  });
});

test("a simulated maintenance failure releases its lock through finally", async () => {
  await withTemporaryState(async (root, lockPath) => {
    await assert.rejects(async () => {
      const release = await acquireSubscriptionMaintenanceLock(root);
      try {
        throw new Error("Synthetic maintenance rejection");
      } finally {
        await release();
      }
    }, /Synthetic maintenance rejection/);
    await assert.rejects(fs.stat(lockPath), { code: "ENOENT" });
    const release = await acquireSubscriptionMaintenanceLock(root);
    await release();
  });
});

test("an existing maintenance lock is preserved rather than stolen or cleared", async () => {
  await withTemporaryState(async (root, lockPath) => {
    const original = "synthetic existing owner";
    await fs.writeFile(lockPath, original, { flag: "wx" });
    await assert.rejects(acquireSubscriptionMaintenanceLock(root), { code: "EEXIST" });
    assert.equal(await fs.readFile(lockPath, "utf8"), original);
  });
});

test("supported selection gates approval before acquiring a lock and always releases it", async () => {
  const source = await helperSource();
  const approval = source.indexOf('process.argv[2] !== "--approved-hub-018"');
  const lock = source.indexOf("await acquireSubscriptionMaintenanceLock(root)");
  const scope = source.indexOf("try {", lock);
  const read = source.indexOf("await fs.readFile(target.config)");
  assert.ok(approval >= 0 && approval < lock && lock < scope && scope < read);
  assert.match(source, /process\.platform !== "win32"/);
  assert.match(source, /finally\s*\{\s*await releaseMaintenanceLock\(\);\s*\}/);
});

test("supported selection rechecks suspended gate and stopped processes before atomic rename", async () => {
  const source = await helperSource();
  const initialGate = source.indexOf('gate.status !== "suspended"');
  const version = source.indexOf('await exec(binary, ["--version"]');
  const currentGate = source.indexOf('currentGate.status !== "suspended"');
  const stopped = source.indexOf("await assertStopped();", currentGate);
  const rename = source.indexOf("await fs.rename(temporary, target.config)");
  assert.ok(initialGate >= 0 && initialGate < version && version < currentGate && currentGate < stopped && stopped < rename);
  assert.equal((source.match(/await assertStopped\(\);/g) || []).length, 2);
  assert.match(source, /ProcessId=\$\{receipt\.pid\}/);
  assert.match(source, /ParentProcessId=\$\{receipt\.pid\}/);
  assert.match(source, /Get-NetTCPConnection -State Listen -ErrorAction Stop/);
  assert.match(source, /LocalPort -In 18789,18790/);
  assert.match(source, /currentStat\.isSymbolicLink\(\).*digest\(await fs\.readFile\(target\.config\)\) !== digest\(raw\)/);
});

test("supported selection binds exact native path and package and executable revisions", async () => {
  const source = await helperSource();
  assert.match(source, /pkg\.name !== "@openai\/codex" \|\| pkg\.version !== "0\.155\.1"/);
  assert.match(source, /@openai\/codex-win32-x64\/vendor\/x86_64-pc-windows-msvc\/bin\/codex\.exe/);
  assert.match(source, /assertPhysicalIsolationBoundary\(root, path\.dirname\(binary\)\)/);
  assert.match(source, /fs\.lstat\(binary\)\)\.isFile\(\).*fs\.lstat\(binary\)\)\.isSymbolicLink\(\)/);
  assert.match(source, /version\.trim\(\) !== "codex-cli 0\.155\.1"/);
  assert.match(source, /previous !== path\.join\(process\.env\.LOCALAPPDATA, "OpenAI\/Codex\/bin\/faa963e871dd422c\/codex\.exe"\)/);
  assert.match(source, /receipt\.projectRoot !== root \|\| receipt\.configSha256 !== digest\(raw\)/);
  assert.match(source, /Number\.isSafeInteger\(receipt\.pid\)/);
});

test("supported selection only changes the command and preserves checkpoint and offline scope", async () => {
  const source = await helperSource();
  const assignments = source.match(/config(?:\.[A-Za-z_$][\w$]*)+\s*=(?!=)/g) || [];
  assert.deepEqual(assignments, ["config.plugins.entries.codex.config.appServer.command ="]);
  assert.match(source, /fs\.writeFile\(path\.join\(checkpoint, "openclaw\.json"\), raw, \{ flag: "wx" \}\)/);
  assert.match(source, /fs\.writeFile\(temporary,.*\{ flag: "wx" \}\)/);
  assert.equal((source.match(/await assertPhysicalIsolationBoundary\(root, checkpoint\)/g) || []).length, 2);
  assert.doesNotMatch(source, /fs\.writeFile\(target\.config/);
  assert.doesNotMatch(source, /connectOpenClaw|startProvider|fetch\(|https?:\/\/|auth-profiles|auth login|config\.patch/);
  assert.match(source, /gatewayStarted: false, modelInvoked: false/);
});

test("certification shares selection's maintenance lock before reads and releases it after client cleanup", async () => {
  const source = await fs.readFile(new URL("../tools/certify-openclaw-subscription.mjs", import.meta.url), "utf8");
  const selection = await helperSource();
  for (const code of [source, selection]) {
    assert.match(code, /import \{ acquireSubscriptionMaintenanceLock \} from "\.\/subscription-maintenance-lock\.mjs"/);
    const approval = code.indexOf('process.argv[2] !== "--approved-hub-018"');
    const lock = code.indexOf("await acquireSubscriptionMaintenanceLock(root)");
    const scope = code.indexOf("try {", lock);
    const read = code.indexOf("await fs.readFile(target.config)");
    assert.ok(approval >= 0 && approval < lock && lock < scope && scope < read);
    assert.match(code, /finally\s*\{\s*await releaseMaintenanceLock\(\);\s*\}/);
  }
  assert.ok(source.indexOf("await client.stopAndWait()") < source.lastIndexOf("await releaseMaintenanceLock()"));
});

test("startup uses the same exclusive lock path across audits, launch and receipt persistence", async () => {
  const source = await fs.readFile(new URL("../tools/start-subscription-gateway.ps1", import.meta.url), "utf8");
  const lockSource = await fs.readFile(new URL("../tools/subscription-maintenance-lock.mjs", import.meta.url), "utf8");
  assert.match(source, /\$state = Join-Path \$root '\.ifrim\\private\\openclaw-subscription-runtime'/);
  assert.match(source, /\$maintenancePath = Join-Path \$state 'maintenance\.lock'/);
  assert.match(lockSource, /const state = isolationPaths\(root\)\.state/);
  assert.match(lockSource, /path\.join\(state, "maintenance\.lock"\)/);
  assert.match(lockSource, /fs\.open\(lockPath, "wx"\)/);
  assert.match(source, /\[IO\.FileMode\]::CreateNew, \[IO\.FileAccess\]::Write, \[IO\.FileShare\]::None/);
  const approval = source.indexOf("if (-not $ApprovedHub018)");
  const lock = source.indexOf("$maintenance = [IO.File]::Open");
  const scope = source.indexOf("try {", lock);
  const audit = source.indexOf("audit-subscription-isolation.mjs");
  const launch = source.indexOf("[Diagnostics.Process]::Start($info)");
  const receipt = source.indexOf("[IO.File]::WriteAllText");
  const release = source.indexOf("$maintenance.Dispose()");
  assert.ok(approval >= 0 && approval < lock && lock < scope && scope < audit && audit < launch && launch < receipt && receipt < release);
  assert.match(source, /finally\s*\{\s*\$maintenance\.Dispose\(\)\s*Remove-Item -LiteralPath \$maintenancePath -ErrorAction Stop\s*\}/);
});

test("failed lock metadata write closes the acquired handle and unlinks only its lock", async (t) => {
  await withTemporaryState(async (root, lockPath) => {
    const failure = new Error("Synthetic metadata write failure");
    const calls = [];
    t.mock.method(fs, "open", async (target, flags) => {
      assert.equal(target, lockPath);
      assert.equal(flags, "wx");
      return {
        writeFile: async () => { throw failure; },
        close: async () => { calls.push("close"); },
      };
    });
    t.mock.method(fs, "unlink", async (target) => {
      assert.equal(target, lockPath);
      calls.push("unlink");
    });
    await assert.rejects(acquireSubscriptionMaintenanceLock(root), (error) => error === failure);
    assert.deepEqual(calls, ["close", "unlink"]);
  });
});

test("failed lock acquisition cleanup retains both original and cleanup errors", async (t) => {
  await withTemporaryState(async (root) => {
    const failure = new Error("Synthetic metadata write failure");
    const cleanupFailure = new Error("Synthetic handle close failure");
    t.mock.method(fs, "open", async () => ({
      writeFile: async () => { throw failure; },
      close: async () => { throw cleanupFailure; },
    }));
    const unlink = t.mock.method(fs, "unlink", async () => {});
    await assert.rejects(acquireSubscriptionMaintenanceLock(root), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, cleanupFailure]);
      return true;
    });
    assert.equal(unlink.mock.callCount(), 0);
  });
});

test("startup checks the physical boundary and fails closed before creating its lock", async () => {
  const source = await fs.readFile(new URL("../tools/start-subscription-gateway.ps1", import.meta.url), "utf8");
  const verifier = await fs.readFile(new URL("../tools/verify-subscription-boundary.mjs", import.meta.url), "utf8");
  const approval = source.indexOf("if (-not $ApprovedHub018)");
  const boundary = source.indexOf("& $node (Join-Path $PSScriptRoot 'verify-subscription-boundary.mjs')");
  const failureGate = source.indexOf("if ($LASTEXITCODE -ne 0)", boundary);
  const lock = source.indexOf("$maintenance = [IO.File]::Open");
  assert.ok(approval >= 0 && approval < boundary && boundary < failureGate && failureGate < lock);
  assert.match(verifier, /await assertPhysicalIsolationBoundary\(root, isolationPaths\(root\)\.state\)/);
  assert.doesNotMatch(verifier, /writeFile|mkdir|unlink|spawn|execFile|connectOpenClaw/);
});
