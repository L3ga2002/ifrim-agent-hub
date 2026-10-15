import test from "node:test";
import { makeTestHub } from "../helpers.mjs";
// No explicit guard: every importing suite must retain the original finally-body failure.
test("original finally error", async () => {
  const h = await makeTestHub();
  h.hub.desktop.close = async () => { throw new Error("CLEANUP_SENTINEL"); };
  try { throw new Error("ORIGINAL_FINALLY_ERROR"); } finally { await h.cleanup(); }
});
