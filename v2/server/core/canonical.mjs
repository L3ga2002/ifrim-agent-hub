import crypto from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, `undefined` dropped. Used for approval hashes. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
export const hashCanonical = (value) => sha256(canonicalJson(value));
