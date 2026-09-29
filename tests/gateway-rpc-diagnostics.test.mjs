import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { gatewayRpcRecord, installGatewayRpcDiagnostics } from "../apps/api/src/gateway-rpc-diagnostics.mjs";

test("RPC record is metadata only with validated scalars", () => {
  const result = gatewayRpcRecord({ type: "gateway.rpc", method: "sessions.create", phase: "received",
    params: { token: "SECRET" }, payload: "SECRET", stack: "SECRET", outcome: {}, response: [],
    durationMs: Infinity, admissionMs: -1, queueWaitMs: {}, ts: 12, seq: NaN,
    trace: { traceId: "newline\nSECRET" } });
  assert.deepEqual(result, { method: "sessions.create", phase: "received", ts: 12 });
  assert.equal(gatewayRpcRecord({ type: "other", method: "agent", phase: "received" }), null);
  assert.equal(gatewayRpcRecord({ type: "gateway.rpc", method: "config.get", phase: "received" }), null);
});

test("sink subscribes narrowly and emits bounded single line metadata", () => {
  let callback;
  const lines = [];
  const unsubscribe = () => {};
  assert.equal(installGatewayRpcDiagnostics((listener, filter) => {
    callback = listener;
    assert.deepEqual(filter, { include: ["gateway.rpc"] });
    return unsubscribe;
  }, (line) => { lines.push(line); return Buffer.byteLength(line); }, { ceiling: 2 }), unsubscribe);
  for (let i = 0; i < 4; i++) callback({ type: "gateway.rpc", method: "agent", phase: "handler", outcome: "returned",
    durationMs: 25, trace: { traceId: "a".repeat(32), payload: "SECRET" }, token: "SECRET" });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split("\n").length, 2);
  assert.ok(lines[0].length <= 1024);
  assert.ok(!lines[0].includes("SECRET"));
  assert.equal(JSON.parse(lines[0]).hubRpcTrace.traceId, "a".repeat(32));
});

test("sink failure and backpressure never propagate or recurse", () => {
  for (const write of [() => false, () => { throw new Error("SECRET"); }]) {
    let callback;
    let count = 0;
    installGatewayRpcDiagnostics((listener) => { callback = listener; }, (line) => { count++; return write(line); });
    const event = { type: "gateway.rpc", method: "agent", phase: "received" };
    assert.doesNotThrow(() => callback(event));
    assert.doesNotThrow(() => callback(event));
    assert.equal(count, 1);
  }
});

test("official cancellation and unavailable outcomes remain visible", () => {
  for (const outcome of ["unavailable", "cancelled"]) {
    assert.equal(gatewayRpcRecord({ type: "gateway.rpc", method: "sessions.create", phase: "response", outcome }).outcome, outcome);
  }
});

test("partial synchronous descriptor writes disable the sink", () => {
  let writes = 0;
  let callback;
  installGatewayRpcDiagnostics((listener) => { callback = listener; }, () => { writes++; return 1; });
  callback({ type: "gateway.rpc", method: "agent", phase: "received" });
  callback({ type: "gateway.rpc", method: "agent", phase: "received" });
  assert.equal(writes, 1);
});

test("comparative bootstrap preserves isolation and hidden policy without staged SDK sink", async () => {
  const source = await fs.readFile(new URL("../tools/hidden-gateway-preload.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf("await assertPhysicalIsolationBoundary") < source.indexOf("installHiddenChildWindows(childProcess)"));
  assert.match(source, /syncBuiltinESMExports\(\);/);
  assert.doesNotMatch(source, /diagnostic-runtime|installGatewayRpcDiagnostics|await import/);
  assert.doesNotMatch(source, /process.stderr|\.on\("error"/);
  assert.doesNotMatch(source, /console\.|onTrustedInternalDiagnosticEvent|exporter/);
  const receipt = await fs.readFile(new URL("../apps/api/src/subscription-auth.mjs", import.meta.url), "utf8");
  assert.match(receipt, /!== receipt.rpcDiagnosticsSha256/);
});

test("Windows startup writes the Node-consumed receipt as UTF8 without BOM", async () => {
  const source = await fs.readFile(new URL("../tools/start-subscription-gateway.ps1", import.meta.url), "utf8");
  assert.match(source, /\[IO.File\]::WriteAllText\([^\n]+subscription-gateway-receipt.json[^\n]+\[System.Text.UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(source, /Set-Content[^\n]+subscription-gateway-receipt.json/);
});
