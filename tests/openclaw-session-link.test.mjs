import test from "node:test";
import assert from "node:assert/strict";
import { openClawSessionLink } from "../src/openclaw-session-link.mjs";

test("new and historical session links retain their Gateway identity", () => {
  const key = "agent:ifrim-qa:ifrim-hub:abc";
  assert.equal(openClawSessionLink({ openclawSessionKey: key, openclawGatewayPort: 18790 }), `http://127.0.0.1:18790/chat?session=${encodeURIComponent(key)}`);
  assert.match(openClawSessionLink({ openclawSessionKey: key }), /^http:\/\/127\.0\.0\.1:18789\/chat\?/);
  assert.equal(openClawSessionLink({ openclawSessionKey: key, openclawGatewayPort: 1234 }), "");
  assert.equal(openClawSessionLink({}), "");
  assert.equal(openClawSessionLink({ openclawSessionKey: "x".repeat(2049) }), "");
});
