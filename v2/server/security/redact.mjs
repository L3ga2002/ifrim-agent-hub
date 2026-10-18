/**
 * Redaction applied to logs, errors, exports, provider stderr and handoff packages.
 * Adapted from V1 context-engine sanitizer, extended with more token shapes.
 */
const TOKEN_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{12,}/g, "[redacted:anthropic-key]"],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g, "[redacted:openai-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted:github-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted:github-token]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted:slack-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted:aws-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted:jwt]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted:private-key]"],
];
// The value: a quoted string (spaces and escaped quotes included: `password: "my secret pass"`) or an unquoted run of 4+ characters.
const SENSITIVE_ASSIGNMENT = /(\b[\w-]*(?:api[_-]?key|token|secret|password|passwd|pwd|authorization|cookie|credential)["']?\s*[:=]\s*)(?:("(?!\[redacted)(?:[^"\\\n]|\\.)+")|('(?!\[redacted)(?:[^'\\\n]|\\.)+')|(?!\[redacted)[^\s"',;]{4,})/gi;
export const SENSITIVE_KEY = /^(?:.*(?:api[_-]?key|token|secret|password|passwd|authorization|cookie|credential|private[_-]?key).*)$/i;

export function redactText(value) {
  if (typeof value !== "string" || !value) return value;
  let text = value;
  for (const [pattern, replacement] of TOKEN_PATTERNS) text = text.replace(pattern, replacement);
  return text.replace(SENSITIVE_ASSIGNMENT, (_, prefix, dq, sq) => `${prefix}${dq ? '"[redacted]"' : sq ? "'[redacted]'" : "[redacted]"}`);
}

/**
 * `secret` (internal): the value sits in a list under a sensitive key (`tokens: ["…"]`, `secrets: [{ value: "…" }]`), so every value in
 * it is redacted, not only the ones that look like a credential. An object directly under a sensitive key is still judged by its own
 * keys (`tokenUsage: { input: 3 }` stays readable).
 */
export function redactDeep(value, depth = 0, secret = false) {
  if (depth > 12) return "[truncated]";
  if (secret && (value === null || value === undefined)) return value;
  if (secret && typeof value !== "object") return "[redacted]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1, secret));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const sensitive = SENSITIVE_KEY.test(key);
      out[key] = sensitive && typeof item !== "object" ? "[redacted]" : redactDeep(item, depth + 1, secret || (sensitive && Array.isArray(item)));
    }
    return out;
  }
  return value;
}

/** True when text still looks like it carries a credential after redaction (used as a hard stop for memory/export). */
export function containsSecretLikeContent(value) {
  if (typeof value !== "string") return false;
  return TOKEN_PATTERNS.some(([pattern]) => { pattern.lastIndex = 0; const hit = pattern.test(value); pattern.lastIndex = 0; return hit; })
    || /(?:api[_-]?key|client[_-]?secret|password|refresh[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i.test(value);
}
