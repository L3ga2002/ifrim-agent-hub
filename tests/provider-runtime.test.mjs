import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderError, shouldFallback } from "../apps/api/src/provider-runtime.mjs";

test("usage limits are distinguishable from ordinary failures", () => {
  assert.equal(classifyProviderError("Codex usage limit reached"), "USAGE_LIMIT");
  assert.equal(classifyProviderError("Claude quota exhausted"), "USAGE_LIMIT");
  assert.equal(classifyProviderError("Login required"), "AUTH_ERROR");
  assert.equal(classifyProviderError("API Error: 401 OAuth access token has expired"), "AUTH_ERROR");
  assert.equal(classifyProviderError("Permission denied"), "PERMISSION_DENIED");
  assert.equal(classifyProviderError("Tests failed"), "UNKNOWN");
});

test("fallback is bounded and excludes auth, permissions and cancellation", () => {
  assert.equal(shouldFallback({ category: "USAGE_LIMIT", handoffCount: 0 }), true);
  assert.equal(shouldFallback({ category: "PROVIDER_UNAVAILABLE", handoffCount: 1 }), true);
  assert.equal(shouldFallback({ category: "USAGE_LIMIT", handoffCount: 2 }), false);
  assert.equal(shouldFallback({ category: "AUTH_ERROR" }), false);
  assert.equal(shouldFallback({ category: "PERMISSION_DENIED" }), false);
  assert.equal(shouldFallback({ category: "USAGE_LIMIT", cancelled: true }), false);
});
