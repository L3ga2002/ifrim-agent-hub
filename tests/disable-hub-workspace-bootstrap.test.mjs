import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { bootstrapDisabledConfig, disableHubWorkspaceBootstrap } from "../tools/disable-hub-workspace-bootstrap.mjs";
import { buildIsolatedSubscriptionConfig, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";
import { digest } from "../apps/api/src/subscription-auth.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-bootstrap-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-bootstrap-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const state = isolationPaths(root);
  await fs.mkdir(state.state, { recursive: true });
  const files = { config: state.config, receipt: path.join(root, ".ifrim/private/subscription-gateway-receipt.json"),
    gate: path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), db: path.join(root, ".ifrim/private/agent-hub.sqlite") };
  const ids = ["main", "ifrim-backend", ...Array.from({ length: 21 }, (_, i) => `ifrim-fixture-${String.fromCharCode(97 + i)}`)];
  const config = buildIsolatedSubscriptionConfig({ agents: { entries: Object.fromEntries(ids.map(id => [id, {}])) },
    plugins: { entries: { codex: { config: { appServer: { command: path.join(root, "absent-codex.exe") } } } } } }, root, "synthetic-only-token".repeat(3));
  assert.equal(config.agents.defaults.skipBootstrap, true);
  delete config.agents.defaults.skipBootstrap;
  const receipt = { pid: 12345, startedAt: "synthetic-start", configSha256: digest(JSON.stringify(config)), environment: { synthetic: true } };
  const gate = { status: "suspended", verifiedAt: "preserved", configSha256: receipt.configSha256,
    gatewayConfigHash: "synthetic-baseline", providers: { codex: { synthetic: true } } };
  for (const [file, value] of [[files.config, config], [files.receipt, receipt], [files.gate, gate]]) await fs.writeFile(file, JSON.stringify(value));
  const db = new DatabaseSync(files.db);
  try { db.exec("CREATE TABLE hub_leases(id TEXT); CREATE TABLE hub_provider_runs(status TEXT); CREATE TABLE execution_attempts(status TEXT);"); }
  finally { db.close(); }
  const original = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await fs.readFile(file)])));
  const calls = { receipt: [], connect: 0, stop: 0, release: 0, methods: [], waits: 0 };
  const applied = { valid: true, hash: "synthetic-applied", config: bootstrapDisabledConfig(structuredClone(config)),
    configRevisionHash: "revision", appliedConfigHash: "revision" };
  const baseline = { valid: true, hash: gate.gatewayConfigHash, config: structuredClone(config),
    configRevisionHash: "old-revision", appliedConfigHash: "old-revision" };
  const deps = { attempts: 2, wait: async ms => { assert.equal(ms, 1000); calls.waits++; },
    acquireLock: async supplied => { assert.equal(supplied, root); return async () => { calls.release++; }; },
    verifyReceipt: async candidate => {
      assert.equal(candidate.pid, receipt.pid); assert.equal(candidate.startedAt, receipt.startedAt);
      calls.receipt.push(structuredClone(candidate));
      if (candidate.configurationUpdate) assert.equal(candidate.configSha256, digest(await fs.readFile(files.config)));
      else assert.deepEqual(await fs.readFile(files.config), original.config);
    },
    connect: async (_event, updated) => {
      calls.connect++; assert.deepEqual(updated, config);
      return { request: async (method, params, settings) => {
        const index = calls.methods.length;
        calls.methods.push(method); assert.equal(method, "config.get"); assert.deepEqual(params, {});
        assert.ok(settings.timeoutMs > 0 && settings.timeoutMs <= 30000);
        return structuredClone(index === 0 ? baseline : applied);
      }, stopAndWait: async () => { calls.stop++; } };
    },
  };
  return { root, files, config, receipt, gate, original, calls, applied, baseline, deps };
}

async function preserved(f, changedConfig = false, expected = {}) {
  for (const key of ["gate", "receipt", "db"]) assert.deepEqual(await fs.readFile(f.files[key]), expected[key] || f.original[key], key);
  if (!changedConfig) assert.deepEqual(await fs.readFile(f.files.config), expected.config || f.original.config);
  else assert.deepEqual(JSON.parse(await fs.readFile(f.files.config)), bootstrapDisabledConfig(f.config));
  assert.equal(JSON.parse(await fs.readFile(f.files.gate)).status, "suspended");
  assert.equal(f.calls.release, 1);
}

test("success changes only skipBootstrap, preserves PID/gate and saves exclusive originals", async t => {
  const f = await fixture(t);
  const result = await disableHubWorkspaceBootstrap(f.root, f.deps);
  assert.equal(result.pid, f.receipt.pid); assert.equal(result.gatewayRestarted, false); assert.equal(result.modelStarted, false);
  assert.equal(result.status, "suspended");
  assert.deepEqual(JSON.parse(await fs.readFile(f.files.config)), bootstrapDisabledConfig(f.config));
  assert.deepEqual(await fs.readFile(f.files.gate), f.original.gate);
  assert.deepEqual(await fs.readFile(f.files.db), f.original.db);
  const receipt = JSON.parse(await fs.readFile(f.files.receipt));
  const { configSha256, configurationUpdate, ...unchanged } = receipt;
  const { configSha256: oldHash, ...before } = f.receipt;
  assert.deepEqual(unchanged, before);
  assert.equal(configSha256, digest(await fs.readFile(f.files.config)));
  assert.equal(configurationUpdate.previousConfigSha256, oldHash);
  for (const [key, backup] of [["config", result.configBackup], ["receipt", result.receiptBackup], ["gate", result.gateBackup]]) {
    assert.deepEqual(await fs.readFile(backup), f.original[key]);
    await assert.rejects(fs.open(backup, "wx"), { code: "EEXIST" });
  }
  assert.equal(f.calls.receipt.length, 2); assert.equal(f.calls.connect, 1); assert.equal(f.calls.stop, 1); assert.equal(f.calls.release, 1);
  assert.deepEqual(f.calls.methods, ["config.get", "config.get", "config.get"]);
});

for (const table of ["hub_leases", "hub_provider_runs", "execution_attempts"]) {
  test(`active ${table} blocks patch before receipt/connect`, async t => {
    const f = await fixture(t);
    const db = new DatabaseSync(f.files.db);
    try { db.exec(table === "hub_leases" ? "INSERT INTO hub_leases VALUES ('synthetic')" : `INSERT INTO ${table} VALUES ('running')`); }
    finally { db.close(); }
    const expected = { db: await fs.readFile(f.files.db) };
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /Active work/);
    assert.equal(f.calls.receipt.length, 0); assert.equal(f.calls.connect, 0);
    await preserved(f, false, expected);
  });
}

test("old receipt failure prevents any config patch", async t => {
  const f = await fixture(t);
  f.deps.verifyReceipt = async () => { throw new Error("Synthetic old receipt failed"); };
  await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /old receipt failed/);
  assert.equal(f.calls.connect, 0);
  await preserved(f);
});

for (const [label, change] of [
  ["invalid", value => { value.valid = false; }],
  ["bootstrap still enabled", value => { value.config.agents.defaults.skipBootstrap = false; }],
  ["missing revision", value => { delete value.configRevisionHash; }],
  ["stale applied", value => { value.appliedConfigHash = "stale"; }],
]) {
  test(`bad applied ${label} preserves old receipt and suspended gate`, async t => {
    const f = await fixture(t);
    change(f.applied);
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /Live bootstrap configuration not confirmed/);
    assert.equal(f.calls.stop, 1); assert.equal(f.calls.waits, 1);
    await preserved(f, true);
  });
}

test("new receipt failure never publishes candidate receipt", async t => {
  const f = await fixture(t);
  f.deps.verifyReceipt = async candidate => { if (candidate.configurationUpdate) throw new Error("Synthetic new receipt failure"); };
  await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /new receipt failure/);
  assert.equal(f.calls.stop, 1);
  await preserved(f, true);
});

for (const mode of ["changed revision", "invalid final"]) {
  test(`final config ${mode} cannot publish candidate receipt`, async t => {
    const f = await fixture(t);
    const connect = f.deps.connect;
    f.deps.connect = async (...args) => {
      const client = await connect(...args); const request = client.request; let n = 0;
      client.request = async (...rpc) => {
        const value = await request(...rpc);
        if (++n === 3) { if (mode === "invalid final") value.valid = false; else value.configRevisionHash = "changed"; }
        return value;
      };
      return client;
    };
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /Live configuration changed/);
    await preserved(f, true);
  });
}

for (const file of ["gate", "receipt", "config"]) {
  test(`concurrent ${file} bytes are preserved without candidate overwrite`, async t => {
    const f = await fixture(t);
    const expected = {};
    const verify = f.deps.verifyReceipt;
    f.deps.verifyReceipt = async candidate => {
      await verify(candidate);
      if (candidate.configurationUpdate) { await fs.appendFile(f.files[file], " "); expected[file] = await fs.readFile(f.files[file]); }
    };
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /changed concurrently/);
    await preserved(f, true, expected);
    if (file === "config") assert.deepEqual(await fs.readFile(f.files.config), expected.config);
  });
}

test("pure config delta is immutable and refuses already-disabled state", () => {
  const old = { agents: { defaults: { model: "preserve" }, entries: { main: {} } }, other: "preserve" };
  const before = structuredClone(old);
  const updated = bootstrapDisabledConfig(old);
  assert.deepEqual(old, before);
  assert.deepEqual(updated, { ...old, agents: { ...old.agents, defaults: { ...old.agents.defaults, skipBootstrap: true } } });
  assert.throws(() => bootstrapDisabledConfig(updated), /bootstrap-enabled/);
});

test("CLI requires explicit approval and contains no model or restart invocation", async () => {
  const text = await fs.readFile(new URL("../tools/disable-hub-workspace-bootstrap.mjs", import.meta.url), "utf8");
  const cli = text.slice(text.indexOf("if (process.argv[1]"));
  assert.ok(cli.indexOf('process.argv[2] !== "--approved-hub-018"') < cli.indexOf("await disableHubWorkspaceBootstrap("));
  assert.doesNotMatch(text, /sessions\.create|client\.request\("agent"|execFile|spawn\(|gatewayStart/);
});

for (const [label, change] of [
  ["invalid", value => { value.valid = false; }],
  ["uncertified hash", value => { value.hash = "wrong"; }],
  ["missing revision", value => { delete value.configRevisionHash; }],
  ["stale applied", value => { value.appliedConfigHash = "wrong"; }],
]) {
  test(`baseline ${label} is rejected before patch or backups`, async t => {
    const f = await fixture(t);
    change(f.baseline);
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /Original applied configuration/);
    await preserved(f);
    assert.equal(f.calls.stop, 1);
    for (const directory of [path.dirname(f.files.config), path.dirname(f.files.gate)]) {
      assert.equal((await fs.readdir(directory)).some(name => name.includes("checkpoint-bootstrap")), false);
    }
  });
}

test("new bootstrap flag with unchanged baseline revision is not accepted", async t => {
  const f = await fixture(t);
  f.applied.configRevisionHash = f.baseline.configRevisionHash;
  f.applied.appliedConfigHash = f.baseline.configRevisionHash;
  await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /not confirmed/);
  await preserved(f, true);
});

test("polling request timeout is capped to remaining 120s budget", async t => {
  const f = await fixture(t);
  const realNow = Date.now;
  let time = 1000;
  const connect = f.deps.connect;
  f.deps.connect = async (...args) => {
    const client = await connect(...args);
    const request = client.request; let count = 0;
    client.request = async (...rpc) => {
      const value = await request(...rpc);
      if (++count === 2) { time += 119000; return { ...value, appliedConfigHash: "stale" }; }
      if (count === 3) assert.equal(rpc[2].timeoutMs, 1000);
      return value;
    };
    return client;
  };
  try {
    Date.now = () => time;
    const result = await disableHubWorkspaceBootstrap(f.root, f.deps);
    assert.equal(result.skipBootstrap, true);
    assert.equal(f.calls.waits, 1);
  } finally { Date.now = realNow; }
  assert.equal(f.calls.release, 1);
});

test("expired polling deadline stops requests and keeps old receipt suspended", async t => {
  const f = await fixture(t);
  const realNow = Date.now;
  let time = 1000;
  f.applied.appliedConfigHash = "stale";
  f.deps.wait = async () => { time += 120000; };
  try {
    Date.now = () => time;
    await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /deadline reached/);
  } finally { Date.now = realNow; }
  assert.equal(f.calls.methods.length, 2);
  await preserved(f, true);
});

test("unapproved extra live-config delta cannot publish receipt", async t => {
  const f = await fixture(t);
  f.applied.config.gateway.port = 18789;
  await assert.rejects(disableHubWorkspaceBootstrap(f.root, f.deps), /unapproved delta/);
  assert.equal(f.calls.receipt.length, 1);
  assert.equal(f.calls.stop, 1);
  await preserved(f, true);
});

for (const value of [true, null, "false", "true", 0, 1, {}]) {
  test(`pure bootstrap delta rejects unsupported flag ${JSON.stringify(value)}`, () => {
    const config = { agents: { defaults: { skipBootstrap: value } } };
    const before = structuredClone(config);
    assert.throws(() => bootstrapDisabledConfig(config), /bootstrap-enabled/);
    assert.deepEqual(config, before);
  });
}

for (const value of [undefined, false]) {
  test(`pure bootstrap delta accepts only enabled flag ${String(value)}`, () => {
    const config = { agents: { defaults: { skipBootstrap: value, marker: "preserve" } } };
    const before = structuredClone(config);
    assert.deepEqual(bootstrapDisabledConfig(config), { agents: { defaults: { skipBootstrap: true, marker: "preserve" } } });
    assert.deepEqual(config, before);
  });
}
