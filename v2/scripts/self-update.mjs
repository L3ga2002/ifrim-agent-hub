// 2.20 — installs a RELEASED version of the Hub (tag hub-release/<x.y.z>) on this computer and returns to the previous version on
// any failure. Started by the Hub when its owner presses „Actualizează” (owner session), or by hand:
//   node v2/scripts/self-update.mjs --to hub-release/2.20.1 [--expect-commit <sha>]
//   node v2/scripts/self-update.mjs --status
// Steps: check (clean installation, versions, schema) → fetch the one tag → forward-only check (the release contains the current
// commit) → checkout → dependencies (only when package-lock.json changed) → the existing upgrade runner (quiet Hub, migration dry
// run, verified pre-migration backup, UI build, restart, verification). Rollback: stop the Hub, restore the verified
// pre-migration copy when the schema moved, previous code and dependencies, UI build, start, check the old version answers.
// Everything is written to <data>/upgrade/self-update.json (read by GET /api/updates) and self-update.log. Never pushes, never
// touches another folder, never runs a model.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { HUB_ROOT, DATA_DIR, PORT, request, health, sleep, readPid, pidAlive } from "./common.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const DIR = path.join(DATA_DIR, "upgrade");
const STATE = path.join(DIR, "self-update.json");
const LOCK = path.join(DIR, "self-update.lock");
const DB = path.join(DATA_DIR, "hub-v2.sqlite");
const PRE = path.join(DATA_DIR, "pre-upgrade");
const TAG_RE = /^hub-release\/\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const GIT = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "advice.detachedHead=false"];
const log = (...a) => console.log(`[self-update ${new Date().toISOString()}]`, ...a);

function git(args, { allowFail = false, timeout = 120000 } = {}) {
  const r = spawnSync("git", [...GIT, ...args], { cwd: HUB_ROOT, encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout || "").trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}`);
  return r.status === 0 ? (r.stdout || "").trim() : null;
}
function node(args, { timeout = 20 * 60 * 1000 } = {}) {
  const r = spawnSync(process.execPath, args, { cwd: HUB_ROOT, encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, HUB_V2_PORT: String(PORT) } });
  process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");
  return r;
}
function npmCi() {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(cli)) throw new Error(`npm nu a fost găsit lângă node (${cli})`);
  const r = node([cli, "ci", "--no-audit", "--no-fund", "--loglevel=error"], { timeout: 30 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`npm ci a eșuat (${r.status}): ${(r.stderr || "").trim().slice(-300)}`);
}
function buildUi() {
  const vite = path.join(HUB_ROOT, "node_modules", "vite", "bin", "vite.js");
  const r = node([vite, "build", "--config", "v2/web/vite.config.js"], { timeout: 10 * 60 * 1000 });
  if (r.status !== 0) throw new Error("build-ul interfeței a eșuat");
}
const codeVersion = () => (/export const HUB_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(HUB_ROOT, "v2", "server", "config.mjs"), "utf8")) || [])[1] || null;
function schemaVersion() {
  if (!fs.existsSync(DB)) return null;
  const db = new DatabaseSync(DB, { readOnly: true });
  try { return db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? null; } catch { return null; } finally { db.close(); }
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } }
function writeState(s) { fs.mkdirSync(DIR, { recursive: true }); const tmp = `${STATE}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, STATE); return s; }
function step(s, name, ok, detail = "") { s.steps.push({ name, ok, detail: String(detail).slice(0, 400), at: new Date().toISOString() }); writeState(s); log(`${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`); }

async function stopHub(force) {
  const session = await request("GET", "/api/session");
  if (!session.json?.token) return "oprit";
  const r = await request("POST", "/api/system/shutdown", { body: { force }, token: session.json.token });
  if (r.status !== 200) throw new Error(r.json?.error?.message || `oprirea a fost refuzată (${r.status})`);
  const pid = readPid()?.pid;
  for (let i = 0; i < 100; i += 1) { await sleep(300); if (!pid || !pidAlive(pid)) return "oprit"; }
  throw new Error("Hub-ul nu s-a oprit");
}
async function startHub() {
  const r = process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HUB_ROOT, "v2", "scripts", "start-detached.ps1")], { cwd: HUB_ROOT, encoding: "utf8", timeout: 120000, windowsHide: true })
    : node([path.join(HUB_ROOT, "v2", "scripts", "start.mjs")], { timeout: 120000 });
  let h = await health();
  for (let i = 0; i < 180 && !h?.ok; i += 1) { await sleep(1000); h = await health(); }
  if (!h?.ok) throw new Error(`Hub-ul nu a pornit (${(r.stdout || "").trim().slice(-200)})`);
  return h;
}

/** The verified copy the new code's boot took before migrating from `fromSchema` (newest, after `since`), checked by its sha256. */
function preMigrationCopy(fromSchema, since) {
  if (!fs.existsSync(PRE)) return null;
  const manifests = fs.readdirSync(PRE).filter((f) => f.endsWith(".manifest.json")).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(PRE, f), "utf8")); } catch { return null; } })
    .filter((m) => m && m.schemaVersion === fromSchema && Date.parse(m.createdAt) >= Date.parse(since) - 60000 && fs.existsSync(m.file))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const m of manifests) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(m.file)).digest("hex");
    if (sha === m.sha256) return m;
  }
  return null;
}

async function rollback(s, cause) {
  log(`Revin la ${s.from.version} (${s.from.commit.slice(0, 12)}): ${cause}`);
  s.status = "rolling_back"; s.error = String(cause).slice(0, 400); writeState(s);
  try {
    let stopped;
    try { stopped = await stopHub(false); } catch { stopped = await stopHub(true); }
    step(s, "rollback:stop", true, stopped);
    const now = schemaVersion();
    if (s.from.schema !== null && now !== null && now > s.from.schema) {
      const copy = preMigrationCopy(s.from.schema, s.startedAt);
      if (!copy) throw new Error(`schema a trecut de la ${s.from.schema} la ${now}, dar copia verificată dinaintea migrării lipsește; baza NU a fost atinsă`);
      const aside = path.join(DIR, `failed-${s.id}`);
      fs.mkdirSync(aside, { recursive: true });
      for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(DB + suffix)) fs.renameSync(DB + suffix, path.join(aside, `hub-v2.sqlite${suffix}`));
      fs.copyFileSync(copy.file, DB);
      step(s, "rollback:database", true, `restaurată copia verificată ${path.basename(copy.file)}; baza nouă păstrată în ${path.relative(DATA_DIR, aside)}`);
    } else step(s, "rollback:database", true, "schema nu s-a schimbat: baza rămâne");
    if (s.from.branch) git(["checkout", "--quiet", s.from.branch]); else git(["checkout", "--quiet", "--detach", s.from.commit]);
    const head = git(["rev-parse", "HEAD"]);
    if (head !== s.from.commit) throw new Error(`după revenire HEAD este ${head}, nu ${s.from.commit}`);
    step(s, "rollback:code", true, s.from.branch || s.from.commit.slice(0, 12));
    if (s.depsChanged) { npmCi(); step(s, "rollback:dependencies", true, "npm ci"); }
    buildUi(); step(s, "rollback:ui", true);
    const h = await startHub();
    if (h.version !== s.from.version) throw new Error(`după revenire Hub-ul servește ${h.version}, nu ${s.from.version}`);
    step(s, "rollback:start", true, h.version);
    s.status = "rolled_back";
  } catch (error) {
    step(s, "rollback", false, error.message);
    s.status = "failed";
    s.rollbackError = String(error.message).slice(0, 400);
  }
  s.finishedAt = new Date().toISOString();
  writeState(s);
}

async function main() {
  if (argv.includes("--status")) { console.log(JSON.stringify(readState(), null, 2)); return; }
  const tag = opt("to");
  if (!tag || !TAG_RE.test(tag)) { console.error("Folosește --to hub-release/<x.y.z> (doar versiuni publicate)."); process.exitCode = 2; return; }
  fs.mkdirSync(DIR, { recursive: true });
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" }); }
  catch {
    const other = Number(fs.readFileSync(LOCK, "utf8")) || 0;
    if (other && pidAlive(other)) { console.error(`O actualizare rulează deja (pid ${other}).`); process.exitCode = 1; return; }
    fs.writeFileSync(LOCK, String(process.pid));
  }
  const s = { id: `upd_${Date.now().toString(36)}`, status: "running", pid: process.pid, startedAt: new Date().toISOString(), steps: [], to: { tag, version: tag.slice("hub-release/".length) } };
  try {
    // 1. the installation as it is
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
    if (dirty) throw Object.assign(new Error("fișiere modificate local în folderul Hub-ului; nimic nu s-a schimbat"), { before: true });
    s.from = { commit: git(["rev-parse", "HEAD"]), branch: git(["symbolic-ref", "-q", "--short", "HEAD"], { allowFail: true }), version: codeVersion(), schema: schemaVersion() };
    writeState(s); step(s, "check", true, `${s.from.version} (${s.from.commit.slice(0, 12)}), schema ${s.from.schema}`);
    // 2. the one tag, forward only
    git(["fetch", "--quiet", "--no-tags", "origin", `+refs/tags/${tag}:refs/tags/${tag}`], { timeout: 300000 });
    s.to.commit = git(["rev-parse", `refs/tags/${tag}^{commit}`]);
    const expect = opt("expect-commit");
    if (expect && expect !== s.to.commit) throw Object.assign(new Error(`tag-ul ${tag} indică ${s.to.commit.slice(0, 12)}, nu ${expect.slice(0, 12)} cât a citit Hub-ul; nimic nu s-a schimbat`), { before: true });
    if (git(["merge-base", "--is-ancestor", s.from.commit, s.to.commit], { allowFail: true }) === null) throw Object.assign(new Error(`versiunea ${s.to.version} nu continuă versiunea instalată (nu se coboară versiunea și nu se sare pe altă ramură); nimic nu s-a schimbat`), { before: true });
    s.depsChanged = git(["diff", "--quiet", s.from.commit, s.to.commit, "--", "package-lock.json"], { allowFail: true }) === null;
    step(s, "fetch", true, `${tag} → ${s.to.commit.slice(0, 12)}${s.depsChanged ? ", dependențe noi" : ""}`);
    // The Hub must be quiet before anything changes (the same preflight the upgrade runner uses, from the INSTALLED code).
    const plan = node([path.join(HUB_ROOT, "v2", "scripts", "upgrade.mjs"), "--plan"], { timeout: 5 * 60 * 1000 });
    const planJson = (() => { try { return JSON.parse(String(plan.stdout || "").slice(String(plan.stdout || "").indexOf("{"))); } catch { return null; } })();
    if (plan.status !== 0 || !planJson) throw Object.assign(new Error("verificarea dinaintea actualizării a eșuat; nimic nu s-a schimbat"), { before: true });
    if (planJson.preflight && planJson.preflight.ok === false) throw Object.assign(new Error(`Hub-ul nu e liniștit (${(planJson.preflight.blockers || []).join(", ")}); încearcă după ce se termină; nimic nu s-a schimbat`), { before: true });
    step(s, "preflight", true, planJson.preflight?.running === false ? "Hub oprit" : "liniștit");
    // 3. code, dependencies, the existing upgrade runner
    git(["checkout", "--quiet", "--detach", s.to.commit]);
    step(s, "checkout", true, s.to.commit.slice(0, 12));
    if (s.depsChanged) { npmCi(); step(s, "dependencies", true, "npm ci"); }
    const up = node([path.join(HUB_ROOT, "v2", "scripts", "upgrade.mjs"), "--apply"]);
    if (up.status !== 0) throw new Error(`upgrade-ul a eșuat (vezi pașii din ${path.relative(HUB_ROOT, path.join(DATA_DIR, "upgrade"))})`);
    const h = await health();
    if (h?.version !== codeVersion()) throw new Error(`Hub-ul servește ${h?.version}, nu ${codeVersion()}`);
    step(s, "upgrade", true, `${s.from.version} → ${h.version}`);
    s.status = "done"; s.finishedAt = new Date().toISOString(); writeState(s);
  } catch (error) {
    if (error.before || !s.from) { s.status = "refused"; s.error = String(error.message).slice(0, 400); s.finishedAt = new Date().toISOString(); writeState(s); log(`refuzat: ${error.message}`); process.exitCode = 1; }
    else { step(s, "update", false, error.message); await rollback(s, error.message); process.exitCode = 1; }
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* gone */ }
  }
  log(JSON.stringify({ id: s.id, status: s.status, from: s.from?.version, to: s.to.version, error: s.error || null }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
