import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Local development profile (2026-10-09, the owner's decision for the stage before M12): on the owner's own computer and Windows
 * account, the Hub may open an owner session WITHOUT a Windows Hello ceremony, so local development and the agent's verifications are
 * not interrupted by dialogs.
 *
 * What it is: an explicit, audited AUTHORITY of this Hub instance ("local_dev_profile"), enabled by a file in the Hub's private data
 * folder (outside the repository and OneDrive once relocated; workers never reach it) that names this machine and this Windows account.
 * Never a browser parameter: the HTTP layer only asks "is the profile on?" and opens a session for a same-origin request from loopback.
 *
 * What it is NOT: a WebAuthn result. A session it opens records user_verified = 0, credential "devprofile:<id>", and every event says
 * authority local_dev_profile. Nothing here writes or simulates a WebAuthn assertion, a verified voice or the owner's identity; the
 * owner's own decisions (accepting a package, a creative approval) stay recorded as made in a dev-profile session, never as Hello.
 *
 * Off by default. A missing, invalid or foreign file (another machine or account) means OFF, with the reason.
 */
export const DEV_PROFILE_FILE = "local-dev-profile.json";
export const DEV_PROFILE_VERSION = 1;
export const DEV_CREDENTIAL_PREFIX = "devprofile:";
export const DEV_SESSION_HOURS = 24;

const norm = (s) => String(s || "").trim().toLowerCase();

export function machineIdentity() {
  let user = "";
  try { user = os.userInfo().username; } catch { user = process.env.USERNAME || ""; }
  return { machine: os.hostname(), user };
}

/** Reads and validates the profile. `override` (tests) replaces the file: { enabled, id, machine, user }. */
export function readDevProfile({ dataDir, override = undefined, identity = machineIdentity() } = {}) {
  let doc = override;
  const file = dataDir ? path.join(dataDir, DEV_PROFILE_FILE) : null;
  if (doc === undefined) {
    if (!file || !fs.existsSync(file)) return { enabled: false, reason: "absent", file };
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { enabled: false, reason: "invalid-json", file }; }
  }
  if (!doc || typeof doc !== "object") return { enabled: false, reason: "absent", file };
  if (doc.enabled !== true) return { enabled: false, reason: "disabled", file };
  if (Number(doc.version || DEV_PROFILE_VERSION) !== DEV_PROFILE_VERSION) return { enabled: false, reason: "version", file };
  if (!/^[a-z0-9_-]{6,40}$/i.test(String(doc.id || ""))) return { enabled: false, reason: "invalid-id", file };
  // Bound to this machine and this Windows account: a copied data folder on another computer or account is OFF.
  if (norm(doc.machine) !== norm(identity.machine) || norm(doc.user) !== norm(identity.user)) return { enabled: false, reason: "foreign-machine-or-user", file };
  return { enabled: true, id: String(doc.id), machine: identity.machine, user: identity.user, enabledAt: doc.enabledAt || null, note: String(doc.note || "").slice(0, 200), file };
}

/** Writes the profile (the local CLI, v2/scripts/dev-profile.mjs). Returns what readDevProfile will then see. */
export function writeDevProfile(dataDir, { enabled, note = "" }) {
  const file = path.join(dataDir, DEV_PROFILE_FILE);
  const { machine, user } = machineIdentity();
  const doc = enabled
    ? { version: DEV_PROFILE_VERSION, enabled: true, id: `dev_${crypto.randomBytes(6).toString("hex")}`, machine, user, enabledAt: new Date().toISOString(), note: String(note).slice(0, 200) }
    : { version: DEV_PROFILE_VERSION, enabled: false, disabledAt: new Date().toISOString(), machine, user };
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return readDevProfile({ dataDir });
}

/** A cached reader (re-reads when the file changes, at most every 2 s): turning the profile off takes effect without a restart. */
export function createDevProfileReader({ dataDir, override = undefined, clock = () => new Date() }) {
  let cache = null;
  let checkedAt = 0;
  let stamp = "";
  return function current() {
    if (override !== undefined) return readDevProfile({ dataDir, override: typeof override === "function" ? override() : override });
    const t = clock().getTime();
    if (cache && t - checkedAt < 2000) return cache;
    checkedAt = t;
    let s = "none";
    try { const st = fs.statSync(path.join(dataDir, DEV_PROFILE_FILE)); s = `${st.mtimeMs}:${st.size}`; } catch { s = "none"; }
    if (!cache || s !== stamp) { cache = readDevProfile({ dataDir }); stamp = s; }
    return cache;
  };
}

export const isDevCredential = (id) => String(id || "").startsWith(DEV_CREDENTIAL_PREFIX);

/** Loopback peers only (the Hub listens on 127.0.0.1; this is a second, explicit check). */
export function isLoopback(address) {
  const a = String(address || "");
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
