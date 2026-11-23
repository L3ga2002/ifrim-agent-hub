import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { HUB_VERSION } from "../config.mjs";

const execFileAsync = promisify(execFile);

/**
 * 2.20 — the update channel of an installed Hub (e.g. a tester's own computer). Only RELEASED versions reach it: the owner of the
 * repository publishes a validated version as an annotated tag `hub-release/<x.y.z>` (v2/scripts/publish-release.mjs); a commit
 * on a branch is never offered. The Hub reads the tags of its `origin` (git ls-remote: read-only, no credentials, no model) at
 * boot and once a day, says „Actualizare disponibilă” when a newer release exists, and applies it ONLY when its owner asks, in
 * the owner session: v2/scripts/self-update.mjs (a separate process) checks out the tag, installs its dependencies, runs the
 * existing upgrade runner (quiet Hub, migration dry run, verified backup, restart, verification) and, on any failure, returns to
 * the previous version (code, dependencies, UI and — when a migration ran — the verified pre-migration copy of the database).
 */
export const RELEASE_TAG_PREFIX = "hub-release/";
const CHECK_INTERVAL_MS = 24 * 3600 * 1000;
const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.file.allow=always"];

/** "2.20.0-dist" → [2, 20, 0]; null when not a version. */
export function parseVersion(text) {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]{1,40})?$/.exec(String(text || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** `git ls-remote --tags` output → [{ version, tag, commit }] for hub-release/* (peeled commit of an annotated tag preferred). */
export function parseReleaseTags(stdout) {
  const byTag = new Map();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(hub-release\/[^\s^]+?)(\^\{\})?$/.exec(line.trim());
    if (!m) continue;
    const [, sha, tag, peeled] = m;
    const version = tag.slice(RELEASE_TAG_PREFIX.length);
    if (!parseVersion(version)) continue;
    const prev = byTag.get(tag);
    if (!prev || peeled) byTag.set(tag, { version, tag, commit: sha });
  }
  return [...byTag.values()].sort((a, b) => compareVersions(a.version, b.version));
}

export function createUpdateService({ config, settings, bus, clock = () => new Date(), runGit = null, spawnUpdater = null }) {
  const root = config.hubRoot;
  const git = runGit || (async (args, timeout = 30000) => {
    const { stdout } = await execFileAsync("git", [...GIT_SAFE, ...args], { cwd: root, windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" } });
    return stdout;
  });
  let timer = null;
  let checking = null;

  function status() {
    const last = settings.get("updateCheck") || null;
    const running = readApplyState();
    return { current: HUB_VERSION, channel: `${RELEASE_TAG_PREFIX}*`, last, available: Boolean(last?.available && compareVersions(last.latest?.version, HUB_VERSION) === 1),
      latest: last?.latest || null, apply: running };
  }

  function readApplyState() {
    try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, "upgrade", "self-update.json"), "utf8")); } catch { return null; }
  }

  async function check(actor = "hub") {
    if (checking) return checking;
    checking = (async () => {
      const at = clock().toISOString();
      let record;
      try {
        const head = (await git(["rev-parse", "HEAD"], 15000)).trim();
        const out = await git(["ls-remote", "--tags", "--refs", "origin", `refs/tags/${RELEASE_TAG_PREFIX}*`], 30000).catch(async () => git(["ls-remote", "--tags", "origin", `refs/tags/${RELEASE_TAG_PREFIX}*`], 30000));
        const releases = parseReleaseTags(out);
        const latest = releases.at(-1) || null;
        const available = Boolean(latest && compareVersions(latest.version, HUB_VERSION) === 1);
        record = { checkedAt: at, ok: true, current: HUB_VERSION, head, latest, available, releases: releases.slice(-5).map((r) => r.version) };
      } catch (error) {
        record = { checkedAt: at, ok: false, current: HUB_VERSION, error: String(error?.stderr || error?.message || error).split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 200) || "eroare git", latest: settings.get("updateCheck")?.latest || null, available: false };
      }
      bus.transaction(() => {
        settings.set("updateCheck", record, actor, record.ok ? `Update check: ${record.available ? `release ${record.latest.version} available` : "up to date"}` : "Update check failed");
        bus.append({ type: "update.checked", scopeType: "hub", scopeId: "updates", source: actor, payload: { ok: record.ok, current: HUB_VERSION, latest: record.latest?.version || null, available: record.available, error: record.error || null } });
      });
      return record;
    })();
    try { return await checking; } finally { checking = null; }
  }

  /** At boot (after 20 s, so the first page load is not slowed) and once a day; never in test mode. */
  function schedule() {
    if (config.testMode || timer) return;
    const first = setTimeout(() => { check("hub").catch(() => {}); }, 20000);
    first.unref?.();
    timer = setInterval(() => { check("hub").catch(() => {}); }, CHECK_INTERVAL_MS);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  /**
   * Starts the separate updater for the latest checked release. The caller checked the owner session. Refused while an update is
   * already running, when nothing newer is known, or when the installation has local changes (the updater would refuse too).
   */
  async function startApply({ version, actor }) {
    const st = status();
    if (st.apply && st.apply.status === "running" && st.apply.pid && pidAlive(st.apply.pid)) throw Object.assign(new Error("O actualizare rulează deja"), { category: "conflict" });
    const latest = st.last?.latest;
    if (!st.available || !latest) throw Object.assign(new Error("Nu există o versiune publicată mai nouă (verifică din nou)"), { category: "conflict" });
    if (version && version !== latest.version) throw Object.assign(new Error(`Pagina arăta ${version}, dar ultima versiune publicată este ${latest.version}; reîncarcă`), { category: "conflict" });
    const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], 20000)).trim();
    if (dirty) throw Object.assign(new Error("Instalarea are fișiere modificate local; actualizarea automată le-ar suprascrie. Rulează `git status` în folderul Hub-ului."), { category: "conflict" });
    const dir = path.join(config.dataDir, "upgrade");
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, "self-update.log");
    const script = path.join(root, "v2", "scripts", "self-update.mjs");
    const launch = spawnUpdater || ((args) => {
      const out = fs.openSync(logFile, "a");
      const child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", out, out], env: { ...process.env, HUB_V2_PORT: String(config.port) } });
      child.unref();
      return child.pid;
    });
    const pid = launch([script, "--to", latest.tag, "--expect-commit", latest.commit]);
    bus.emit({ type: "update.started", scopeType: "hub", scopeId: "updates", source: actor, payload: { from: HUB_VERSION, to: latest.version, tag: latest.tag, pid: pid || null } });
    return { started: true, from: HUB_VERSION, to: latest.version, pid: pid || null, logFile: path.relative(config.dataDir, logFile) };
  }

  return { status, check, schedule, stop, startApply };
}

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } }
