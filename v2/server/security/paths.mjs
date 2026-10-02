import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";

const SECRET_NAME = /^(?:\.env(?!\.example$).*|.*\.(?:pem|key|pfx|p12|kdbx|jks|keystore|ppk|p8|gpg|tfvars|tfstate(?:\.backup)?)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|\.dockercfg|\.dev\.vars|\.vault-token|credentials(?:\.json)?|\.credentials\.json|auth\.json|service-account.*\.json|.*-adminsdk-.*\.json|secrets?\.(?:json|ya?ml|toml|env|ini))$/i;

export const isSecretLikeName = (name) => SECRET_NAME.test(name);

const normalize = (p) => path.resolve(p).replace(/[\\/]+$/, "");
const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/** Project-relative directories the Hub never exposes (lowercase, "/"-separated). Same list as the model isolation. */
export const PROTECTED_DIRS = Object.freeze([".ifrim/private", ".ifrim/backups", ".ifrim/tmp", ".git"]);

/** True when a project-relative path ("/" or "\\") is a protected directory or inside one, or has a secret-like part. */
export function isProtectedRelative(relative) {
  const parts = String(relative).split(/[\\/]+/).filter((p) => p && p !== ".");
  const rel = parts.join("/").toLowerCase();
  if (PROTECTED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return true;
  return parts.some((part) => isSecretLikeName(part));
}

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
  if (denyPrivate && isProtectedRelative(path.relative(rootReal, target))) throw new HubError("policy", "Path is protected (private data, backups, scratch, Git internals or a secret-like file)");
  let real;
  try { real = fs.realpathSync.native(target); }
  catch (error) {
    if (allowMissing && error.code === "ENOENT") return target;
    throw new HubError("not_found", "Path not found");
  }
  if (!isInside(rootReal, real)) throw new HubError("policy", "Symlink or junction escapes the project scope");
  // The requested path may be harmless while a junction/symlink on it leads into a protected directory.
  if (denyPrivate && isProtectedRelative(path.relative(rootReal, real))) throw new HubError("policy", "Path resolves into a protected location");
  return real;
}
