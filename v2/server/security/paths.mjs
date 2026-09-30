import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";

const SECRET_NAME = /^(?:\.env(?!\.example$).*|.*\.(?:pem|key|pfx|p12|kdbx)|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|\.credentials\.json|auth\.json)$/i;

export const isSecretLikeName = (name) => SECRET_NAME.test(name);

const normalize = (p) => path.resolve(p).replace(/[\\/]+$/, "");
const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Pure prefix containment (case-insensitive on Windows). */
export function isInside(root, candidate) {
  const r = lower(normalize(root));
  const c = lower(normalize(candidate));
  return c === r || c.startsWith(`${r}${path.sep}`);
}

/**
 * Resolves `relative` under `root` and rejects traversal, absolute escapes, symlink/junction escapes,
 * secret-like files and hub-private directories. Returns the real absolute path.
 */
export function resolveInScope(root, relative, { allowMissing = false, denyPrivate = true } = {}) {
  if (typeof relative !== "string" || relative.includes("\0")) throw new HubError("validation", "Invalid path");
  const rootReal = fs.realpathSync.native(root);
  const target = path.resolve(rootReal, relative);
  if (!isInside(rootReal, target)) throw new HubError("policy", "Path escapes the project scope");
  const parts = path.relative(rootReal, target).split(path.sep);
  if (denyPrivate) {
    const rel = parts.join("/").toLowerCase();
    if (rel === ".ifrim/private" || rel.startsWith(".ifrim/private/") || rel.startsWith(".git/") || rel === ".git") {
      throw new HubError("policy", "Path is in a protected directory");
    }
    if (parts.some((part) => isSecretLikeName(part))) throw new HubError("policy", "Secret-like file names are not exposed");
  }
  let real;
  try { real = fs.realpathSync.native(target); }
  catch (error) {
    if (allowMissing && error.code === "ENOENT") return target;
    throw new HubError("not_found", "Path not found");
  }
  if (!isInside(rootReal, real)) throw new HubError("policy", "Symlink or junction escapes the project scope");
  return real;
}
