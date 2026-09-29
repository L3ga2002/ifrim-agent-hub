import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { refreshHubClaudeEvidence, assertNarrowClaudeRefresh } from "../tools/refresh-hub-claude-evidence.mjs";
import { buildIsolatedSubscriptionConfig, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";
import { hubAcceptanceScopes } from "../apps/api/src/hub-acceptance-scope.mjs";
import { digest } from "../apps/api/src/subscription-auth.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-claude-refresh-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-claude-refresh-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const privateDir = path.join(root, ".ifrim/private");
  await fs.mkdir(isolationPaths(root).state, { recursive: true });
  const files = { config: isolationPaths(root).config, gate: path.join(privateDir, "openclaw-subscription-gate.json"),
    evidence: path.join(privateDir, "openclaw-claude-auth-evidence.json"),
    codex: path.join(privateDir, "openclaw-codex-auth-evidence.json"), db: path.join(privateDir, "agent-hub.sqlite") };
  const ids = ["main", "ifrim-backend", ...Array.from({ length: 21 }, (_, i) => `ifrim-fixture-${String.fromCharCode(97 + i)}`)];
  const config = buildIsolatedSubscriptionConfig({ agents: { entries: Object.fromEntries(ids.map(id => [id, {}])) },
    plugins: { entries: { codex: { config: { appServer: { command: path.join(root, "absent-codex.exe") } } } } } }, root, "synthetic-only-token".repeat(3));
  const date = new Date(Date.now() - 1000).toISOString();
  const userHome = path.join(root, "synthetic-user-home");
  const globalConfig = path.join(userHome, ".claude.json");
  const binary = path.join(root, "synthetic-claude.exe");
  const settings = path.join(userHome, ".claude/settings.json");
  const credentials = { sources: { [globalConfig]: "new-state-hash", [binary]: "binary-hash", [settings]: "settings-hash" },
    runtimeVersion: "2026.9.6", profileId: "anthropic:claude-cli" };
  const plugin = { synthetic: "fresh-plugin-evidence" };
  const baseline = { ...credentials, sources: { ...credentials.sources, [globalConfig]: "old-state-hash" }, pluginEvidence: plugin };
  const evidence = { version: 1, provider: "claude", verifiedAt: date,
    receipt: { projectRoot: root, environment: { USERPROFILE: userHome } },
    agents: Object.fromEntries(ids.map(id => [id, structuredClone(baseline)])) };
  const codex = JSON.stringify({ preserved: "synthetic-codex-evidence" });
  const proof = { authMode: "local-subscription", apiBillingDisabled: true, evidencePath: files.evidence,
    evidenceSha256: digest(JSON.stringify(evidence)) };
  const gate = { ...hubAcceptanceScopes.claude, status: "suspended", verifiedAt: date,
    configSha256: digest(JSON.stringify(config)), gatewayConfigHash: "synthetic-applied", providers: {
      claude: proof, codex: { ...proof, evidencePath: files.codex, evidenceSha256: digest(codex), marker: "preserve" },
    } };
  for (const [file, data] of [[files.config, JSON.stringify(config)], [files.gate, JSON.stringify(gate)],
    [files.evidence, JSON.stringify(evidence)], [files.codex, codex]]) await fs.writeFile(file, data);
  const db = new DatabaseSync(files.db);
  try { db.exec("CREATE TABLE hub_leases(id TEXT); CREATE TABLE hub_provider_runs(status TEXT); CREATE TABLE execution_attempts(status TEXT);"); }
  finally { db.close(); }
  const original = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await fs.readFile(file)])));
  const calls = { lock: 0, release: 0, receipt: 0, credentials: 0, plugin: 0, connect: 0, stop: 0, rpc: [] };
  const deps = {
    acquireLock: async supplied => { assert.equal(supplied, root); calls.lock++; return async () => { calls.release++; }; },
    verifyReceipt: async receipt => { assert.deepEqual(receipt, evidence.receipt); calls.receipt++; },
    inspectCredentials: async (_config, options) => { assert.equal(options.provider, "claude"); calls.credentials++; return structuredClone(credentials); },
    inspectPlugin: async supplied => { assert.equal(supplied, root); calls.plugin++; return structuredClone(plugin); },
    connect: async () => { calls.connect++; return {
      request: async (method, params, settings) => {
        calls.rpc.push(method); assert.equal(method, "config.get"); assert.deepEqual(params, {}); assert.equal(settings.timeoutMs, 30000);
        return { valid: true, hash: gate.gatewayConfigHash, configRevisionHash: "revision", appliedConfigHash: "revision" };
      }, stopAndWait: async () => { calls.stop++; },
    }; },
  };
  return { root, privateDir, files, config, gate, evidence, original, calls, deps, credentials, plugin, globalConfig, binary, settings, ids };
}

async function assertPreserved(f, expected = f.original) {
  for (const [key, bytes] of Object.entries(expected)) assert.deepEqual(await fs.readFile(f.files[key]), bytes, key);
  assert.equal(f.calls.release, 1);
  assert.equal((await fs.readdir(f.privateDir)).some(name => name.includes(".checkpoint-")), false);
}

test("refresh changes only Claude evidence/proof and preserves Codex/global timestamp/suspension", async t => {
  const f = await fixture(t);
  const result = await refreshHubClaudeEvidence(f.root, f.deps);
  const gate = JSON.parse(await fs.readFile(f.files.gate, "utf8"));
  const evidenceRaw = await fs.readFile(f.files.evidence);
  const evidence = JSON.parse(evidenceRaw);
  assert.equal(result.status, "suspended"); assert.equal(result.modelStarted, false);
  assert.equal(result.certifiedAgents, 23);
  assert.equal(gate.verifiedAt, f.gate.verifiedAt);
  assert.deepEqual(gate, { ...f.gate, providers: { ...f.gate.providers,
    claude: { ...f.gate.providers.claude, evidenceSha256: digest(evidenceRaw) } } });
  assert.deepEqual(await fs.readFile(f.files.codex), f.original.codex);
  assert.deepEqual(await fs.readFile(f.files.config), f.original.config);
  assert.deepEqual(await fs.readFile(f.files.db), f.original.db);
  assert.notEqual(evidence.verifiedAt, f.evidence.verifiedAt);
  assert.equal(Object.keys(evidence.agents).length, 23);
  for (const value of Object.values(evidence.agents)) assert.deepEqual(value, { ...f.credentials, pluginEvidence: f.plugin });
  assert.deepEqual(evidence.receipt, f.evidence.receipt);
  assert.deepEqual(await fs.readFile(result.evidenceBackup), f.original.evidence);
  assert.deepEqual(await fs.readFile(result.gateBackup), f.original.gate);
  assert.deepEqual(f.calls, { lock: 1, release: 1, receipt: 2, credentials: 2, plugin: 2, connect: 1, stop: 1, rpc: ["config.get"] });
});

for (const hook of ["inspectCredentials", "verifyReceipt"]) {
  test(`${hook} unsafe rejection causes no overwrite and releases lock`, async t => {
    const f = await fixture(t);
    f.deps[hook] = async () => { throw new Error("Synthetic unsafe preflight"); };
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /unsafe preflight/);
    assert.equal(f.calls.connect, 0);
    await assertPreserved(f);
  });
}

test("isolated config rejection never connects or overwrites certificates", async t => {
  const f = await fixture(t);
  f.config.gateway.port = 18789;
  await fs.writeFile(f.files.config, JSON.stringify(f.config));
  const expected = { ...f.original, config: await fs.readFile(f.files.config) };
  await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Isolated loopback/);
  assert.equal(f.calls.connect, 0);
  await assertPreserved(f, expected);
});

for (const [label, applied] of [
  ["invalid", { valid: false, hash: "synthetic-applied", configRevisionHash: "r", appliedConfigHash: "r" }],
  ["wrong hash", { valid: true, hash: "wrong", configRevisionHash: "r", appliedConfigHash: "r" }],
  ["missing revision", { valid: true, hash: "synthetic-applied" }],
  ["stale applied", { valid: true, hash: "synthetic-applied", configRevisionHash: "new", appliedConfigHash: "old" }],
]) {
  test(`applied config ${label} rejection preserves files and cleans client/lock`, async t => {
    const f = await fixture(t);
    f.deps.connect = async () => ({ request: async method => { assert.equal(method, "config.get"); return applied; },
      stopAndWait: async () => { f.calls.stop++; } });
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Applied gateway revision/);
    assert.equal(f.calls.stop, 1);
    await assertPreserved(f);
  });
}

for (const hook of ["inspectCredentials", "inspectPlugin"]) {
  test(`changing ${hook} between audits refuses all certificate overwrites`, async t => {
    const f = await fixture(t);
    let count = 0;
    f.deps[hook] = async () => {
      const value = structuredClone(hook === "inspectCredentials" ? f.credentials : f.plugin);
      if (++count === 2) value.changed = true;
      return value;
    };
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /sources changed/);
    assert.equal(f.calls.stop, 1);
    await assertPreserved(f);
  });
}

for (const file of ["gate", "evidence", "codex", "config"]) {
  test(`concurrent ${file} mutation is retained and never overwritten`, async t => {
    const f = await fixture(t);
    const expected = { ...f.original };
    f.deps.verifyReceipt = async () => {
      if (++f.calls.receipt === 2) {
        await fs.appendFile(f.files[file], " ");
        expected[file] = await fs.readFile(f.files[file]);
      }
    };
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /changed concurrently/);
    assert.equal(f.calls.stop, 1);
    await assertPreserved(f, expected);
  });
}

for (const table of ["hub_leases", "hub_provider_runs", "execution_attempts"]) {
  test(`active ${table} blocks refresh without inspection or overwrite`, async t => {
    const f = await fixture(t);
    const db = new DatabaseSync(f.files.db);
    try { db.exec(table === "hub_leases" ? "INSERT INTO hub_leases VALUES ('synthetic')" : `INSERT INTO ${table} VALUES ('running')`); }
    finally { db.close(); }
    const expected = { ...f.original, db: await fs.readFile(f.files.db) };
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Active execution/);
    assert.equal(f.calls.credentials, 0); assert.equal(f.calls.receipt, 0); assert.equal(f.calls.connect, 0);
    await assertPreserved(f, expected);
  });
}

test("connect failure releases lock without overwriting evidence", async t => {
  const f = await fixture(t);
  f.deps.connect = async () => { throw new Error("Synthetic connect rejected"); };
  await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /connect rejected/);
  await assertPreserved(f);
});

test("import is inert and CLI requires explicit approval before invoking refresh", async () => {
  const text = await fs.readFile(new URL("../tools/refresh-hub-claude-evidence.mjs", import.meta.url), "utf8");
  const cli = text.slice(text.indexOf("if (process.argv[1]"));
  assert.match(cli, /path\.resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/);
  assert.ok(cli.indexOf('process.argv[2] !== "--approved-hub-018"') < cli.indexOf("await refreshHubClaudeEvidence("));
  assert.match(text, /new DatabaseSync\(database, \{ readOnly: true \}\)/);
  assert.doesNotMatch(text, /status: "approved"|sessions\.create|client\.request\("agent"/);
  const narrow = text.indexOf("for (const id of agents) assertNarrowClaudeRefresh(");
  assert.ok(narrow >= 0 && narrow < text.indexOf("client = await connect("));
});

for (const [label, mutate] of [
  ["binary", f => { f.credentials.sources[f.binary] = "changed"; }],
  ["settings", f => { f.credentials.sources[f.settings] = "changed"; }],
  ["plugin", f => { f.plugin.synthetic = "changed"; }],
  ["profile", f => { f.credentials.profileId = "other-profile"; }],
  ["runtime", f => { f.credentials.runtimeVersion = "other-version"; }],
  ["unknown source key", f => { f.credentials.sources[path.join(f.root, "unknown-source")] = "new"; }],
  ["removed source key", f => { delete f.credentials.sources[f.binary]; }],
  ["missing current global key", f => { delete f.credentials.sources[f.globalConfig]; }],
]) {
  test(`narrow refresh refuses ${label} before connect and persistence`, async t => {
    const f = await fixture(t);
    mutate(f);
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Only Claude application state|provenance missing/);
    assert.equal(f.calls.connect, 0);
    await assertPreserved(f);
  });
}

for (const mode of ["changed-baseline", "missing-agent", "missing-global-key"]) {
  test(`all-role validation rejects last-role ${mode} before connect`, async t => {
    const f = await fixture(t);
    const last = f.ids.at(-1);
    if (mode === "changed-baseline") f.evidence.agents[last].runtimeVersion = "other";
    else if (mode === "missing-agent") delete f.evidence.agents[last];
    else delete f.evidence.agents[last].sources[f.globalConfig];
    const raw = JSON.stringify(f.evidence);
    f.gate.providers.claude.evidenceSha256 = digest(raw);
    await fs.writeFile(f.files.evidence, raw);
    await fs.writeFile(f.files.gate, JSON.stringify(f.gate));
    const expected = { ...f.original, evidence: await fs.readFile(f.files.evidence), gate: await fs.readFile(f.files.gate) };
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Only Claude application state|provenance missing/);
    assert.equal(f.calls.connect, 0);
    await assertPreserved(f, expected);
  });
}

test("pure narrow guard accepts exact global-state hash only and does not mutate inputs", () => {
  const global = path.resolve("synthetic-home/.claude.json");
  const previous = { sources: { [global]: "old", binary: "same" }, profileId: "same", pluginEvidence: { hash: "same" } };
  const current = { ...structuredClone(previous), sources: { ...previous.sources, [global]: "new" } };
  const before = structuredClone({ previous, current });
  assert.doesNotThrow(() => assertNarrowClaudeRefresh(previous, current, global));
  assert.deepEqual({ previous, current }, before);
  assert.throws(() => assertNarrowClaudeRefresh(previous, current, path.resolve("other-home/.claude.json")), /provenance missing/);
});

for (const concurrent of [false, true]) {
  test(`second rename failure stays fail-closed${concurrent ? " and preserves concurrent gate bytes" : " with original gate"}`, async t => {
    const f = await fixture(t);
    const originalRename = fs.rename;
    const failure = new Error("Synthetic second rename failure");
    let expectedGate = f.original.gate;
    const renamed = [];
    try {
      fs.rename = async (from, to) => {
        if (to === f.files.evidence || to === f.files.gate) {
          assert.ok(path.resolve(from).startsWith(path.resolve(f.root) + path.sep));
          renamed.push(to);
          if (to === f.files.gate) {
            if (concurrent) {
              expectedGate = Buffer.concat([f.original.gate, Buffer.from(" ")]);
              await fs.writeFile(f.files.gate, expectedGate);
            }
            throw failure;
          }
        }
        return originalRename(from, to);
      };
      await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), error => error === failure);
    } finally {
      fs.rename = originalRename;
    }
    assert.equal(fs.rename, originalRename);
    assert.deepEqual(renamed, [f.files.evidence, f.files.gate]);
    assert.equal(f.calls.release, 1);
    assert.equal(f.calls.stop, 1);
    assert.deepEqual(await fs.readFile(f.files.gate), expectedGate);
    assert.deepEqual(await fs.readFile(f.files.codex), f.original.codex);
    assert.deepEqual(await fs.readFile(f.files.config), f.original.config);
    assert.deepEqual(await fs.readFile(f.files.db), f.original.db);
    const gate = JSON.parse(await fs.readFile(f.files.gate, "utf8"));
    const refreshed = await fs.readFile(f.files.evidence);
    assert.equal(gate.status, "suspended");
    assert.equal(gate.verifiedAt, f.gate.verifiedAt);
    assert.deepEqual(gate.providers.codex, f.gate.providers.codex);
    assert.notEqual(digest(refreshed), gate.providers.claude.evidenceSha256);
    const entries = await fs.readdir(f.privateDir);
    for (const [key, original] of [["gate", f.original.gate], ["evidence", f.original.evidence]]) {
      const prefix = path.basename(f.files[key]) + ".checkpoint-";
      const checkpoints = entries.filter(name => name.startsWith(prefix) && !name.endsWith(".next"));
      assert.equal(checkpoints.length, 1);
      const file = path.join(f.privateDir, checkpoints[0]);
      assert.deepEqual(await fs.readFile(file), original);
      await assert.rejects(fs.open(file, "wx"), { code: "EEXIST" });
    }
    const pendingGate = entries.filter(name => name.startsWith(path.basename(f.files.gate) + ".checkpoint-") && name.endsWith(".next"));
    assert.equal(pendingGate.length, 1);
    const connections = f.calls.connect;
    await assert.rejects(refreshHubClaudeEvidence(f.root, f.deps), /Claude certificate changed/);
    assert.equal(f.calls.connect, connections);
    assert.equal(f.calls.release, 2);
    assert.deepEqual(await fs.readFile(f.files.gate), expectedGate);
    assert.deepEqual(await fs.readFile(f.files.evidence), refreshed);
  });
}
