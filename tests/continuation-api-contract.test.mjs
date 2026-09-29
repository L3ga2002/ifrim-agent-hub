import test from "node:test";
import assert from "node:assert/strict";

const apiBase = process.env.HUB_API_BASE || "http://127.0.0.1:8004/api";

test("endpointul continuation expune selectia si urmatoarea actiune", async () => {
  const response = await fetch(`${apiBase}/projects/ifrim-agent-hub/continuation`, { signal: AbortSignal.timeout(30000) });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.continuation.readOnly, true);
  assert.ok(payload.continuation.selection);
  assert.match(payload.continuation.selection.kind, /^(active_task|latest_completed_task|no_task)$/);
  assert.equal(typeof payload.continuation.nextAction.code, "string");
  assert.equal(typeof payload.continuation.nextAction.label, "string");
});
