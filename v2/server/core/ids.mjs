import crypto from "node:crypto";

/** Stable, prefix-typed, roughly time-ordered identifiers (e.g. `task_lx9k2m_3f9a1c7e2b`). */
export function newId(prefix) {
  const time = Date.now().toString(36);
  const random = crypto.randomBytes(5).toString("hex");
  return `${prefix}_${time}_${random}`;
}

export const nowIso = (clock = () => new Date()) => clock().toISOString();
