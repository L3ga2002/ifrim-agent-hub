import test from "node:test";
import assert from "node:assert/strict";
import { connectOpenClaw, gatewayConnectionError } from "../apps/api/src/openclaw-gateway.mjs";

test("socket refusal and timeout are not misreported as authentication", () => {
  assert.equal(gatewayConnectionError({ code: "ECONNREFUSED" }).category, "transport");
  assert.equal(gatewayConnectionError({ code: "ETIMEDOUT" }).category, "timeout");
  assert.equal(gatewayConnectionError(new Error("connect challenge timeout SECRET_CANARY")).category, "unknown");
});

test("only official explicit auth discriminants identify authentication", () => {
  const error = gatewayConnectionError({ code: "UNAUTHORIZED", details: { code: "AUTH_TOKEN_MISMATCH", token: "SECRET_CANARY" }, message: "SECRET_CANARY" });
  assert.equal(error.category, "authentication");
  assert.equal(error.detailCode, "AUTH_TOKEN_MISMATCH");
  assert.ok(!JSON.stringify(error).includes("SECRET_CANARY"));
  assert.equal(gatewayConnectionError({ message: "AUTH_TOKEN_MISMATCH" }).category, "unknown");
});

test("permission denial and unknown data remain distinct and sanitized", () => {
  assert.equal(gatewayConnectionError({ code: "FORBIDDEN" }).category, "permission");
  assert.equal(gatewayConnectionError({ details: { code: "AUTH_SCOPE_MISMATCH" } }).category, "permission");
  const error = gatewayConnectionError({ code: "SECRET_CANARY", details: { code: "SECRET_CANARY" }, stack: "SECRET_CANARY", message: "SECRET_CANARY" });
  assert.equal(error.category, "unknown");
  assert.equal(error.message, "OpenClaw connection failed");
  assert.ok(!JSON.stringify(error).includes("SECRET_CANARY"));
});

test("connection failure stops the client and preserves safe classification", async () => {
  let stopped = 0;
  class GatewayClient {
    constructor(options) { this.options = options; }
    start() { queueMicrotask(() => this.options.onConnectError({ code: "ECONNREFUSED", message: "SECRET_CANARY" })); }
    stop() { stopped++; }
  }
  await assert.rejects(connectOpenClaw(() => {}, { gateway: { port: 18790, auth: { token: "test-only" } } }, { GatewayClient }), (error) => error.category === "transport" && error.code === "ECONNREFUSED");
  assert.equal(stopped, 1);
});

test("hello acceptance preserves the existing authenticated client contract", async () => {
  class GatewayClient {
    constructor(options) { this.options = options; }
    start() { queueMicrotask(() => this.options.onHelloOk()); }
    stop() { throw new Error("successful connection must not stop"); }
  }
  const client = await connectOpenClaw(() => {}, { gateway: { port: 18790, auth: { token: "test-only" } } }, { GatewayClient });
  assert.equal(client.options.sharedStateMode, "read-only");
  assert.equal(client.options.deviceIdentity, null);
  assert.equal(client.options.url, "ws://127.0.0.1:18790");
  assert.equal(client.options.clientName, "gateway-client");
  assert.equal(client.options.mode, "backend");
  assert.equal(client.options.token, "test-only");
  assert.equal(client.options.role, "operator");
  assert.deepEqual(client.options.scopes, ["operator.read", "operator.write", "operator.admin"]);
});
