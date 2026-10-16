import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { TEST_TMP, freePort } from "./helpers.mjs";
import { loadConfig } from "../server/config.mjs";
import { createHub } from "../server/hub.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { createTestAuthenticator } from "../server/owner/webauthn.mjs";
import { OWNER_SETUP_TEXT } from "../server/owner/trust.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { takeSnapshot } from "../server/factory/snapshot.mjs";
import { hashCanonical, sha256 } from "../server/core/canonical.mjs";

export const settle = () => new Promise(resolve => setTimeout(resolve, 35));
const ROOT_KEYS = ["dataDir", "dbPath", "backupDir", "workDir", "attachmentsDir", "mediaDir", "mediaWorkDir", "preUpgradeDir", "hubRoot", "browserRoot", "projectsRoot", "registryPath", "legacyDbPath", "roleRegistryPath", "voiceRoot"];

/** Resolve existing ancestors too: a missing leaf must never conceal a junction in the middle. */
export function assertInside(root, value) {
  const target = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  const rel = path.relative(root, target);
  assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel), `outside synthetic root: ${target}`);
  let cursor = target;
  while (true) {
    if (fs.existsSync(cursor)) {
      assert.equal(fs.lstatSync(cursor).isSymbolicLink(), false, `link/junction: ${cursor}`);
      assert.equal(fs.realpathSync.native(cursor).toLowerCase(), cursor.toLowerCase(), `redirected path: ${cursor}`);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return target;
}

// Node internals that load lazily (e.g. fs.cpSync's implementation) capture whichever fs functions exist on first use, so an earlier
// test's wrapper can outlive its restore: every wrapper checks the fence that is active NOW and passes through when none is.
let activeFence = null;

/** Mandatory process-local write fence; native SQLite paths are asserted separately before opening. */
export function installWriteTripwire(root) {
  const originals = [], fds = new Set([1, 2]);
  activeFence = { root, fds };
  const check = value => { const fence = activeFence; if (!fence) return; if (typeof value === "number") { assert.ok(fence.fds.has(value), `untracked write fd ${value}`); return; } assertInside(fence.root, Buffer.isBuffer(value) ? value.toString() : value); };
  const patch = (obj, key, wrap) => { if (typeof obj[key] !== "function") return; const original = obj[key]; originals.push(() => { obj[key] = original; }); obj[key] = wrap(original); };
  const writing = flags => typeof flags === "number" ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) : /[wa+]/.test(flags || "r");
  for (const obj of [fs, fsp]) {
    for (const stem of ["writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "truncate", "chmod", "chown", "utimes", "lutimes", "createWriteStream"]) {
      for (const key of [stem, `${stem}Sync`]) patch(obj, key, original => function (...args) { check(args[0]); return original.apply(this, args); });
    }
    // rename removes its source; a copy, hard link or symlink only reads (or points at) the first path and writes the second.
    for (const stem of ["rename"]) for (const key of [stem, `${stem}Sync`]) patch(obj, key, original => function (...args) { check(args[0]); check(args[1]); return original.apply(this, args); });
    for (const stem of ["copyFile", "cp", "link", "symlink"]) for (const key of [stem, `${stem}Sync`]) patch(obj, key, original => function (...args) { check(args[1]); return original.apply(this, args); });
    for (const key of ["write", "writeSync", "writev", "writevSync", "ftruncate", "ftruncateSync", "fchmod", "fchmodSync", "fchown", "fchownSync", "futimes", "futimesSync"]) patch(obj, key, original => function (...args) { check(args[0]); return original.apply(this, args); });
  }
  patch(fs, "openSync", original => function (file, flags, ...rest) { if (writing(flags)) check(file); const fd = original.call(this, file, flags, ...rest); if (writing(flags)) activeFence?.fds.add(fd); return fd; });
  patch(fs, "open", original => function (file, flags, ...rest) { if (writing(flags)) check(file); const cb = rest.pop(); return original.call(this, file, flags, ...rest, (error, fd) => { if (!error && writing(flags)) activeFence?.fds.add(fd); cb(error, fd); }); });
  patch(fsp, "open", original => async function (file, flags, ...rest) { if (writing(flags)) check(file); return original.call(this, file, flags, ...rest); });
  patch(fs, "closeSync", original => function (fd) { activeFence?.fds.delete(fd); return original.call(this, fd); });
  patch(fs, "close", original => function (fd, cb) { activeFence?.fds.delete(fd); return original.call(this, fd, cb); });
  syncBuiltinESMExports();
  return () => { activeFence = null; for (const restore of originals.reverse()) restore(); syncBuiltinESMExports(); };
}

export function assertStoredPaths(config, root) {
  const db = new DatabaseSync(assertInside(root, config.dbPath), { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON");
    for (const r of db.prepare("SELECT path FROM projects").all()) assertInside(root, r.path);
    const visit = value => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item && ["file", "dir", "folder", "path", "exportDir", "sourceFile"].includes(key)) assertInside(root, path.isAbsolute(item) ? item : path.join(root, item));
        else visit(item);
      }
    };
    for (const [table, column] of [["deliveries", "template_json"], ["delivery_items", "meta_json"], ["delivery_documents", "export_json"], ["ops_plan_steps", "result_json"]])
      for (const row of db.prepare(`SELECT ${column} value FROM ${table}`).all()) visit(JSON.parse(row.value || "{}"));
    for (const row of db.prepare("SELECT ref_id FROM delivery_items WHERE ref_table = 'file'").all()) assertInside(root, row.ref_id);
  } finally { db.close(); }
}

export async function acceptanceHub({ devProfile, clock } = {}) {
  fs.mkdirSync(TEST_TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_TMP, "accept-"));
  try { assertInside(TEST_TMP, root); } catch (error) { fs.rmdirSync(root); throw error; }
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TEMP = root; process.env.TMP = root;
  const restore = installWriteTripwire(root);
  let hub, server;
  const cleanup = async () => {
    try {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      if (hub) await hub.close();
      assertInside(TEST_TMP, root);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } finally {
      restore();
      for (const k of ["TEMP", "TMP"]) if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k];
    }
  };
  try {
    assert.notEqual(process.env.HUB_V2_OFFICE_COM, "1");
    const homeDir = path.join(root, "home"), hubRoot = path.join(root, "hub"), projectDir = path.join(root, "project");
    for (const dir of [homeDir, hubRoot]) fs.mkdirSync(dir);
    const config = loadConfig({ testMode: true, dataDir: path.join(root, "data"), hubRoot, browserRoot: hubRoot, projectsRoot: root,
      registryPath: path.join(root, "registry.md"), roleRegistryPath: path.join(root, "roles.json"), legacyDbPath: path.join(root, "legacy.sqlite"), voiceRoot: path.join(root, "voice"),
      port: await freePort(), ...(clock ? { now: clock } : {}), devProfile });
    assert.equal(config.testMode, true); assert.equal(config.dataLocation.source, "override");
    for (const key of ROOT_KEYS) assertInside(root, config[key]);
    for (const value of [homeDir, process.env.TEMP, process.env.TMP]) assertInside(root, value);
    assert.equal(fs.existsSync(config.dbPath), false);
    assert.notEqual(config.port, 8011);
    hub = createHub(config, { homeDir });
    await hub.boot();
    materializeFixture("bug-demo", projectDir);
    const project = hub.projects.registerTest({ path: projectDir, name: "Accept synthetic" }, "test");
    ({ server } = createHttpServer(hub));
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", resolve); });
    let token, cookie = "", auth;
    const request = (url, { method = "POST", body = {}, headers = {}, sessionCookie = cookie } = {}) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: config.port, path: url, method, headers: { Host: `localhost:${config.port}`, Origin: config.canonicalOrigin,
        "Content-Type": "application/json", ...(token ? { "X-Hub-Token": token } : {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...headers } }, res => {
        let text = ""; res.on("data", c => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject); req.end(method === "GET" ? undefined : JSON.stringify(body));
    });
    token = (await request("/api/session", { method: "GET" })).json.token;
    const authenticate = async ({ dev = false, reauth = false } = {}) => {
      let result;
      if (dev) result = await request("/api/owner/dev-session");
      else {
        if (!reauth) {
          auth = createTestAuthenticator({ origin: config.canonicalOrigin });
          const begin = await request("/api/owner/register/begin", { body: { setupText: OWNER_SETUP_TEXT } });
          assert.equal(begin.status, 200, JSON.stringify(begin.json));
          const finish = await request("/api/owner/register/finish", { body: { challengeId: begin.json.challengeId, credential: auth.create({ challenge: begin.json.publicKey.challenge }) } });
          assert.equal(finish.status, 200, JSON.stringify(finish.json));
        }
        const begin = await request("/api/owner/auth/begin", { body: { purpose: reauth ? "reauth" : "unlock" } });
        result = await request("/api/owner/auth/finish", { body: { challengeId: begin.json.challengeId, credential: auth.get({ challenge: begin.json.publicKey.challenge }) } });
      }
      assert.equal(result.status, 200, JSON.stringify(result.json));
      // A reauth refreshes the open session in place and may not send a new cookie: keep the current one then.
      if (result.headers["set-cookie"]) cookie = String(result.headers["set-cookie"]).split(";")[0];
      return result.json;
    };
    const t = { root, hub, config, project, projectDir, homeDir, request, authenticate, cleanup, assertPaths: () => assertStoredPaths(config, root) };
    t.assertPaths();
    return t;
  } catch (error) { await cleanup(); throw error; }
}

export async function seedReady(t, { beforeSnapshot } = {}) {
  const { hub, project, config } = t, db = hub.db;
  const v = (await hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } } })).result;
  const missionId = v.mission.id, bundleId = `bnd_${missionId.slice(4)}`, deliveryId = `dlv_${missionId.slice(4)}`, csId = `cs_${missionId}`, snapId = `snap_${missionId}`;
  const spec = v.spec.spec, at = config.now().toISOString();
  db.prepare("UPDATE factory_specs SET status = 'APPROVED', protected_json = ? WHERE mission_id = ?").run(JSON.stringify({ files: { "test/acceptance.test.mjs": sha256(fs.readFileSync(path.join(project.path, "test/acceptance.test.mjs"))) }, historic: { active: [], retired: [] } }), missionId);
  db.prepare("UPDATE factory_missions SET stage = 'DELIVERY_READY', approved_spec_version = 1, base_snapshot_id = ? WHERE mission_id = ?").run(snapId, missionId);
  if (beforeSnapshot) await beforeSnapshot({ missionId, project });
  const snap = takeSnapshot(project.path, { mode: "walk", ignore: spec.workspace?.ignore || [] }), csSha = hashCanonical({ snapshot: snap.sha256, changes: [] });
  db.prepare("INSERT INTO factory_snapshots (id, mission_id, seq, kind, manifest_json, stats_json, sha256, created_at) VALUES (?,?,1,'base',?,?,?,?)").run(snapId, missionId, JSON.stringify(snap.files), JSON.stringify(snap.stats), snap.sha256, at);
  db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES (?,?,1,?,'[]',?,'CURRENT',?)").run(csId, missionId, snapId, csSha, at);
  const manifest = { mission: { id: missionId }, spec: { version: 1, sha256: v.spec.sha256, criteria: spec.acceptance.map(c => ({ ...c, status: "PASS_EVIDENCE", evidence: [] })) },
    changeSet: { id: csId, sha256: csSha, snapshot: snap.sha256, files: [] }, reviews: [], evidence: [], start: { command: "node server.js", url: "http://localhost:45678/" } };
  const bundleSha = hashCanonical(manifest), file = path.join(t.root, `${bundleId}.md`);
  fs.writeFileSync(file, "Synthetic verified bundle\n");
  db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, file_path, created_at) VALUES (?,?,?,?,1,?,?,'READY_FOR_OWNER_ACCEPTANCE',?,?)").run(bundleId, missionId, csId, csSha, JSON.stringify(manifest), bundleSha, path.relative(config.hubRoot, file), at);
  const template = { preview: { command: "node server.js", url: "http://localhost:45678/", origin: "http://localhost:45678" }, exports: { folder: path.join(t.root, "exports") } };
  db.prepare("INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, bundle_id, bundle_sha, snapshot_sha, change_set_id, change_set_sha, spec_sha, created_by, created_at, updated_at) VALUES (?,?,'Accept synthetic','READY',?,?,?,'[]',?,?,?,?,?,?,?,'test',?,?)")
    .run(deliveryId, project.id, missionId, JSON.stringify(template), hashCanonical(template), hashCanonical([]), bundleId, bundleSha, snap.sha256, csId, csSha, v.spec.sha256, at, at);
  hub.deliveries.bindItem(deliveryId, { kind: "bundle", refTable: "factory_bundles", refId: bundleId, refSha: bundleSha, meta: { fileSha: sha256(fs.readFileSync(file)) } });
  db.prepare("UPDATE tasks SET status = 'VERIFYING' WHERE mission_id = ?").run(missionId);
  db.prepare("UPDATE tasks SET status = 'DRAFT' WHERE id = ?").run(v.tasks.at(-1).id);
  await settle(); t.assertPaths();
  return { missionId, bundleId, bundleSha, deliveryId, csId, snapId, room: `/api/deliveries/${deliveryId}/software-accept`, panel: `/api/factory/${missionId}/accept`,
    body: { bundleId, bundleSha, displayedBundleSha: bundleSha, note: "decizia inițială" } };
}

export function fingerprint(t) {
  const tables = ["factory_bundles", "factory_missions", "missions", "tasks", "deliveries", "delivery_items", "content_ideas"];
  const rows = Object.fromEntries(tables.map(table => [table, t.hub.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  rows.events = t.hub.db.prepare("SELECT * FROM events WHERE type NOT LIKE 'command.%' AND type NOT LIKE 'owner.%' ORDER BY seq").all();
  rows.tree = takeSnapshot(t.projectDir, { mode: "walk" });
  return hashCanonical(rows);
}
