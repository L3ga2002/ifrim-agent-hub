import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { consumeOrderedFreshReads, createFreshFileHasher } from "../apps/api/src/ordered-fingerprint-io.mjs";
import { inspectIsolatedPlugin } from "../apps/api/src/isolated-plugin-evidence.mjs";
import { isolationPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const file = (name, label = "Plugin") => ({ kind: "file", file: name, relative: name, label });
async function* items(values) { yield* values; }

test("public fresh inspection matches the old serial plugin/linked-SDK evidence byte for byte", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-plugin-evidence-test-"));
  try {
    const state = isolationPaths(root).state;
    const appdata = path.join(root, "appdata");
    const sdk = path.join(appdata, "npm/node_modules/openclaw");
    const plugin = path.join(state, "fixture-codex");
    const record = { installPath: plugin, version: "2026.9.6" };
    const put = async (name, value) => { await fs.mkdir(path.dirname(name), { recursive: true }); await fs.writeFile(name, value); };
    await put(path.join(plugin, "package.json"), '{"name":"@openclaw/codex","version":"2026.9.6"}');
    await put(path.join(plugin, "openclaw.plugin.json"), "{}");
    await put(path.join(plugin, "assets/a/x"), "plugin nested bytes");
    await put(path.join(plugin, "assets/z"), "plugin sibling bytes");
    await put(path.join(sdk, "package.json"), '{"name":"openclaw","version":"2026.9.6"}');
    await put(path.join(sdk, "dist/installed-plugin-index-record-reader-B3UvF50J.mjs"), `export function i(){return {codex:${JSON.stringify(record)}}} export function o(){}`);
    await put(path.join(sdk, "dist/deferred-plugin-migrations-DZuh_dkr.mjs"), "export function a(){return []}");
    await put(path.join(sdk, "dist/a/nested"), "SDK nested bytes");
    await put(path.join(sdk, "dist/z"), "SDK sibling bytes");
    await fs.mkdir(path.join(plugin, "node_modules"));
    const link = path.join(plugin, "node_modules/openclaw");
    await fs.symlink(sdk, link, process.platform === "win32" ? "junction" : "dir");
    const env = { APPDATA: appdata, OPENCLAW_STATE_DIR: state };
    const old = { record, artifacts: {}, sdkDependency: null };
    let bytes = 0;
    const readHash = async (name) => {
      const stat = await fs.stat(name);
      assert.ok(bytes + stat.size <= 536870912);
      const data = await fs.readFile(name); bytes += data.length;
      return hash(data);
    };
    async function sdkWalk(directory, tree) {
      await assertPhysicalIsolationBoundary(sdk, directory);
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = path.join(directory, entry.name);
        assert.equal(entry.isSymbolicLink(), false);
        if (entry.isDirectory()) { await sdkWalk(name, tree); continue; }
        assert.equal(entry.isFile(), true);
        tree.update(JSON.stringify([path.relative(sdk, name).replaceAll(path.sep, "/"), await readHash(name)]));
      }
    }
    async function pluginWalk(directory) {
      await assertPhysicalIsolationBoundary(state, directory);
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          assert.equal(name, link); assert.equal((await fs.realpath(name)).toLowerCase(), sdk.toLowerCase());
          await assertPhysicalIsolationBoundary(path.dirname(sdk), sdk);
          const sdkPackage = await fs.readFile(path.join(sdk, "package.json"));
          const tree = createHash("sha256").update(sdkPackage);
          await sdkWalk(path.join(sdk, "dist"), tree);
          old.sdkDependency = { link, target: sdk, version: "2026.9.6", sha256: tree.digest("hex") };
          continue;
        }
        if (entry.isDirectory()) { await pluginWalk(name); continue; }
        assert.equal(entry.isFile(), true);
        old.artifacts[path.relative(plugin, name).replaceAll(path.sep, "/")] = await readHash(name);
      }
    }
    await pluginWalk(plugin);
    assert.equal(JSON.stringify(await inspectIsolatedPlugin(root, env)), JSON.stringify(old));
    await put(path.join(sdk, "dist/z"), "SDK changed without version change");
    assert.notEqual((await inspectIsolatedPlugin(root, env)).sdkDependency.sha256, old.sdkDependency.sha256);
    await fs.symlink(path.join(sdk, "dist/a"), path.join(sdk, "dist/forbidden-link"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(inspectIsolatedPlugin(root, env), /artifact contains a link/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("fresh bounded I/O preserves serial DFS evidence and SDK tree bytes under inverse completion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-fingerprint-test-"));
  try {
    for (const [name, text] of [["plugin/a/x", "one"], ["plugin/z", "two"], ["sdk/dist/a/x", "three"], ["sdk/dist/z", "four"]]) {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await fs.writeFile(path.join(root, name), text);
    }
    async function* walk(directory, label, base) {
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(target, label, base);
        else yield { kind: "file", file: target, relative: path.relative(base, target).replaceAll(path.sep, "/"), label };
      }
    }
    const sdkPackage = Buffer.from('{"name":"openclaw","version":"2026.9.6"}');
    async function* fixture() {
      yield* walk(path.join(root, "plugin"), "Plugin", path.join(root, "plugin"));
      yield { kind: "sdk-start", sdkPackage };
      yield* walk(path.join(root, "sdk/dist"), "SDK", path.join(root, "sdk"));
      yield { kind: "sdk-end" };
    }
    function collector() {
      const evidence = { record: { installPath: "fixture" }, artifacts: {}, sdkDependency: { version: "2026.9.6" } };
      let tree;
      return { evidence, consume(item) {
        if (item.kind === "sdk-start") tree = createHash("sha256").update(item.sdkPackage);
        else if (item.kind === "sdk-end") evidence.sdkDependency.sha256 = tree.digest("hex");
        else if (item.label === "SDK") tree.update(JSON.stringify([item.relative, item.sha256]));
        else evidence.artifacts[item.relative] = item.sha256;
      } };
    }
    const serial = collector();
    let bytes = 0;
    for await (const item of fixture()) {
      if (item.kind !== "file") { serial.consume(item); continue; }
      const stat = await fs.stat(item.file);
      assert.ok(bytes + stat.size <= 536870912);
      const data = await fs.readFile(item.file);
      bytes += data.length;
      serial.consume({ ...item, sha256: hash(data) });
    }
    let active = 0;
    let maximum = 0;
    let reads = 0;
    const completions = [];
    const io = { stat: (...args) => fs.stat(...args), async readFile(name) {
      active += 1; maximum = Math.max(maximum, active); reads += 1;
      try { await delay(name.endsWith("x") ? 20 : 1); const data = await fs.readFile(name); completions.push(path.basename(name)); return data; }
      finally { active -= 1; }
    } };
    const parallel = collector();
    await consumeOrderedFreshReads(fixture(), createFreshFileHasher(io, hash), parallel.consume);
    assert.equal(JSON.stringify(parallel.evidence), JSON.stringify(serial.evidence));
    assert.deepEqual(Object.keys(parallel.evidence.artifacts), ["a/x", "z"]);
    assert.deepEqual(completions, ["z", "x", "z", "x"]);
    assert.equal(maximum, 2); assert.equal(active, 0); assert.equal(reads, 4);
    await fs.writeFile(path.join(root, "plugin/z"), "fresh changed bytes");
    const fresh = collector();
    await consumeOrderedFreshReads(fixture(), createFreshFileHasher(io, hash), fresh.consume);
    assert.notEqual(fresh.evidence.artifacts.z, parallel.evidence.artifacts.z);
    assert.equal(reads, 8); assert.equal(active, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("read errors stop admission and settle the other in-flight read", async () => {
  const boom = new Error("fixture read failed");
  const started = [];
  let active = 0;
  await assert.rejects(consumeOrderedFreshReads(items([0, 1, 2, 3]), async (value) => {
    started.push(value); active += 1;
    try { await delay(value === 0 ? 1 : 20); if (value === 0) throw boom; return value; }
    finally { active -= 1; }
  }, () => {}), (error) => error === boom);
  assert.deepEqual(started, [0, 1]); assert.equal(active, 0);
});

test("later read failure is observed without waiting to admit more work", async () => {
  const started = [];
  let active = 0;
  await assert.rejects(consumeOrderedFreshReads(items([0, 1, 2]), async (value) => {
    started.push(value); active += 1;
    try { await delay(value === 0 ? 20 : 1); if (value === 1) throw new Error("later failed"); return value; }
    finally { active -= 1; }
  }, () => {}), /later failed/);
  assert.deepEqual(started, [0, 1]); assert.equal(active, 0);
});

test("traversal and consumer failures close the iterator and drain admitted work", async () => {
  for (const mode of ["traversal", "consumer"]) {
    let closed = false;
    let active = 0;
    async function* source() {
      try { yield 0; if (mode === "traversal") throw new Error("traversal failed"); yield 1; yield 2; }
      finally { closed = true; }
    }
    await assert.rejects(consumeOrderedFreshReads(source(), async (value) => {
      active += 1; try { await delay(10); return value; } finally { active -= 1; }
    }, () => { throw new Error("consumer failed"); }), new RegExp(`${mode} failed`));
    assert.equal(active, 0); assert.equal(closed, true);
  }
});

test("stat budgets reserve in-flight bytes and reject before the over-budget read", async () => {
  let active = 0;
  const reads = [];
  const io = { async stat() { return { size: 4 }; }, async readFile(name) {
    reads.push(name); active += 1;
    try { await delay(10); return Buffer.alloc(4); } finally { active -= 1; }
  } };
  await assert.rejects(consumeOrderedFreshReads(items([file("a"), file("b", "SDK"), file("c")]), createFreshFileHasher(io, hash, 7), () => {}), /SDK evidence exceeds audit budget/);
  assert.deepEqual(reads, ["a"]); assert.equal(active, 0);
});

test("actual file growth fails closed for plugin and SDK, with no outstanding reads", async () => {
  for (const label of ["Plugin", "SDK"]) {
    let active = 0;
    const io = { async stat() { return { size: 3 }; }, async readFile(name) {
      active += 1;
      try { await delay(name === "a" ? 1 : 15); return Buffer.alloc(name === "a" ? 8 : 3); }
      finally { active -= 1; }
    } };
    await assert.rejects(consumeOrderedFreshReads(items([file("a", label), file("b", label)]), createFreshFileHasher(io, hash, 10), () => {}), /evidence exceeds audit budget/);
    assert.equal(active, 0);
  }
});

test("stat errors and synchronous hash errors are settled, empty streams do no I/O", async () => {
  for (const mode of ["stat", "hash"]) {
    let active = 0;
    const io = { async stat(name) { if (mode === "stat" && name === "a") throw new Error("stat failed"); return { size: 1 }; }, async readFile() {
      active += 1; try { await delay(5); return Buffer.from("x"); } finally { active -= 1; }
    } };
    const digest = mode === "hash" ? () => { throw new Error("hash failed"); } : hash;
    await assert.rejects(consumeOrderedFreshReads(items([file("a"), file("b")]), createFreshFileHasher(io, digest), () => {}), /failed/);
    assert.equal(active, 0);
  }
  await consumeOrderedFreshReads(items([]), () => { throw new Error("unexpected read"); }, () => {});
});
