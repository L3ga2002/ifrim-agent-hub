/**
 * Error taxonomy shared by API, runtime and providers. A failure before inference (gate, auth,
 * billing, policy) must never be treated as a weak model answer or trigger another provider.
 */
export const ERROR_CATEGORIES = Object.freeze([
  "gate", "authentication", "billing", "quota", "transport", "model", "tool", "policy", "task",
  "validation", "not_found", "conflict", "internal",
]);

export const PRE_INFERENCE_CATEGORIES = Object.freeze(new Set(["gate", "authentication", "billing", "policy", "validation"]));

const STATUS_BY_CATEGORY = {
  gate: 409, authentication: 401, billing: 402, quota: 429, transport: 502, model: 502, tool: 500,
  policy: 403, task: 409, validation: 400, not_found: 404, conflict: 409, internal: 500,
};

export class HubError extends Error {
  constructor(category, message, details = {}) {
    super(message);
    this.name = "HubError";
    this.category = ERROR_CATEGORIES.includes(category) ? category : "internal";
    this.status = details.status || STATUS_BY_CATEGORY[this.category];
    this.code = details.code || this.category.toUpperCase();
    this.details = details.data || undefined;
  }
}

export const fail = (category, message, details) => { throw new HubError(category, message, details); };

export function toPublicError(error) {
  if (error instanceof HubError) {
    return { status: error.status, body: { error: { category: error.category, code: error.code, message: error.message, details: error.details } } };
  }
  return { status: 500, body: { error: { category: "internal", code: "INTERNAL", message: "Unexpected server error" } } };
}
