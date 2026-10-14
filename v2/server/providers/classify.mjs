/**
 * Maps provider-specific failure signals to the Hub taxonomy:
 * gate | authentication | billing | quota | transport | output_token_limit | model | tool | policy | task.
 * `preInference` is true when no model turn could have started (the failure must not be "fixed"
 * by switching model/provider or by any paid route).
 */
const CODEX_ERROR_INFO = {
  unauthorized: "authentication",
  usageLimitExceeded: "quota",
  rateLimitExceeded: "quota",
  sessionBudgetExceeded: "quota",
  serverOverloaded: "transport",
  internalServerError: "transport",
  contextWindowExceeded: "model",
  cyberPolicy: "policy",
  misalignmentPolicyViolation: "policy",
  badRequest: "model",
  sandboxError: "tool",
  threadRollbackFailed: "task",
  other: "model",
};

const CLAUDE_RETRY_ERRORS = {
  authentication_failed: "authentication",
  oauth_org_not_allowed: "authentication",
  account_on_hold: "billing",
  billing_error: "billing",
  rate_limit: "quota",
  overloaded: "transport",
  invalid_request: "model",
  model_not_found: "model",
  server_error: "transport",
  max_output_tokens: "model",
  cloud_credential_error: "authentication",
  unknown: "model",
};

export function classifyCodexTurnError(error) {
  const info = error?.codexErrorInfo;
  if (typeof info === "string") return CODEX_ERROR_INFO[info] || "model";
  if (info && typeof info === "object") {
    const key = Object.keys(info)[0] || "";
    if (/Connection|Disconnected|FailedAttempts/i.test(key)) return "transport";
    return "model";
  }
  return classifyText(error?.message || "");
}

export const classifyClaudeRetry = (code) => CLAUDE_RETRY_ERRORS[code] || "model";

/** Exact CLI terminal diagnostic, never a context-window or generic token-limit guess. */
export function claudeOutputTokenMaximum(text) {
  const match = String(text ?? "").match(/Claude['’]s response exceeded the ([1-9]\d*) output token maximum\b/i);
  const n = match ? Number(match[1]) : null;
  return Number.isSafeInteger(n) ? n : null;
}

export function classifyText(text = "") {
  const value = String(text);
  if (/billing|credit balance|payment|extra usage|purchase/i.test(value)) return "billing";
  if (/usage limit|rate.?limit|quota|too many requests|limit reached/i.test(value)) return "quota";
  if (claudeOutputTokenMaximum(value) !== null) return "output_token_limit";
  if (/not (?:logged|authenticated)|login required|unauthori[sz]ed|invalid api key|expired|401|403/i.test(value)) return "authentication";
  if (/timed? ?out|ECONNRESET|ECONNREFUSED|EPIPE|socket|network|unavailable|overloaded|5\d\d/i.test(value)) return "transport";
  if (/ENOENT|not found|spawn/i.test(value)) return "transport";
  if (/permission|denied|not allowed|policy/i.test(value)) return "policy";
  return "model";
}
