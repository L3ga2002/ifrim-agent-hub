import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isolationPaths, assertPhysicalIsolationBoundary } from "./subscription-isolation.mjs";
import { consumeOrderedFreshReads, createFreshFileHasher } from "./ordered-fingerprint-io.mjs";

export function requireSettledPluginMigrations(pending) {
  if (!Array.isArray(pending) || pending.length) throw new Error("Native plugin migration pending; startup and certification remain blocked");
}

export async function inspectIsolatedPlugin(root, env) {
  const target = isolationPaths(root);
  if (path.resolve(env.OPENCLAW_STATE_DIR || "") !== target.state) throw new Error("Plugin evidence requires isolated state");
  const dist = path.join(env.APPDATA, "npm", "node_modules", "openclaw", "dist");
  const { a: readPending } = await import(pathToFileURL(path.join(dist, "deferred-plugin-migrations-DZuh_dkr.mjs")));
  requireSettledPluginMigrations(readPending({ env, artifactPreservingReadOnly: true }));
  return fingerprintIsolatedPluginArtifacts(root, env);
}

export async function fingerprintIsolatedPluginArtifacts(root, env) {
  const target = isolationPaths(root);
  if (path.resolve(env.OPENCLAW_STATE_DIR || "") !== target.state) throw new Error("Plugin evidence requires isolated state");
  const dist = path.join(env.APPDATA, "npm", "node_modules", "openclaw", "dist");
  const { i: readRecords, o: clearInstallRecordCache } = await import(pathToFileURL(path.join(dist, "installed-plugin-index-record-reader-B3UvF50J.mjs")));
  clearInstallRecordCache();
  const record = readRecords({ env, artifactPreservingReadOnly: true }).codex;
  if (!record?.installPath) throw new Error("Isolated plugin install record missing");
  await assertPhysicalIsolationBoundary(target.state, record.installPath);
  const hashes = {};
  let sdkDependency = null;
  let tree;
  const walk = async function* (directory) {
    await assertPhysicalIsolationBoundary(target.state, directory);
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const expectedLink = path.join(record.installPath,"node_modules","openclaw");
        const expectedTarget = path.join(env.APPDATA,"npm","node_modules","openclaw");
        if (file !== expectedLink || (await fs.realpath(file)).toLowerCase() !== path.resolve(expectedTarget).toLowerCase()) throw new Error("Unexpected plugin dependency link");
        await assertPhysicalIsolationBoundary(path.dirname(expectedTarget),expectedTarget);
        const sdkPackage = await fs.readFile(path.join(expectedTarget,"package.json"));
        const parsed = JSON.parse(sdkPackage.toString("utf8"));
        if (parsed.name !== "openclaw" || parsed.version !== "2026.9.6") throw new Error("Official SDK dependency revision differs");
        yield { kind: "sdk-start", sdkPackage, expectedLink, expectedTarget, version: parsed.version };
        const sdkWalk = async function* (directory) {
          await assertPhysicalIsolationBoundary(expectedTarget,directory);
          for (const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
            const sdkFile = path.join(directory,item.name);
            if (item.isSymbolicLink()) throw new Error("Official SDK artifact contains a link");
            if (item.isDirectory()) {yield* sdkWalk(sdkFile);continue;}
            if (!item.isFile()) throw new Error("Unexpected SDK artifact type");
            yield { kind: "file", label: "SDK", file: sdkFile, relative: path.relative(expectedTarget,sdkFile).replaceAll(path.sep,"/") };
          }
        };
        yield* sdkWalk(path.join(expectedTarget,"dist"));
        yield { kind: "sdk-end" };
        continue;
      }
      if (entry.isDirectory()) { yield* walk(file); continue; }
      if (!entry.isFile()) throw new Error("Unexpected plugin artifact type");
      yield { kind: "file", label: "Plugin", file, relative: path.relative(record.installPath, file).replaceAll(path.sep, "/") };
    }
  };
  await consumeOrderedFreshReads(walk(record.installPath), createFreshFileHasher(fs,
    (data) => createHash("sha256").update(data).digest("hex")), (item) => {
    if (item.kind === "sdk-start") {
      tree = createHash("sha256").update(item.sdkPackage);
      sdkDependency = { link: item.expectedLink, target: item.expectedTarget, version: item.version };
    } else if (item.kind === "sdk-end") {
      sdkDependency.sha256 = tree.digest("hex");
      tree = null;
    } else if (item.label === "SDK") {
      tree.update(JSON.stringify([item.relative, item.sha256]));
    } else {
      hashes[item.relative] = item.sha256;
    }
  });
  const pkg = JSON.parse(await fs.readFile(path.join(record.installPath, "package.json"), "utf8"));
  if (pkg.name !== "@openclaw/codex" || pkg.version !== "2026.9.6" || !hashes["openclaw.plugin.json"]) throw new Error("Native plugin revision or manifest differs");
  return { record, artifacts: hashes, sdkDependency };
}
