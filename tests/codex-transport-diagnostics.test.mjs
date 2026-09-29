import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installCodexTransportDiagnostics } from "../apps/api/src/gateway-rpc-diagnostics.mjs";

const executable = "C:\\isolated\\codex.exe";
function fixture(options = {}) {
  const children = [];
  const lines = [];
  const process = { spawn(...args) {
    const child = new EventEmitter();
    child.pid = 100 + children.length;
    child.stdout = new EventEmitter();
    child.calls = [];
    child.stdin = { write(...writeArgs) {
      child.calls.push({ receiver: this, args: writeArgs });
      if (options.transportError) throw options.transportError;
      return options.backpressure ? false : true;
    } };
    children.push(child);
    return child;
  } };
  const original = process.spawn;
  const restore = installCodexTransportDiagnostics(process, executable, options.sink || ((line) => {
    lines.push(line);
    return Buffer.byteLength(line);
  }), options);
  return { process, children, lines, restore, original, records: () => lines.map((line) => JSON.parse(line).hubCodexTransport) };
}
const send = (child, message) => child.stdin.write(JSON.stringify(message) + "\n");
const respond = (child, message) => child.stdout.emit("data", Buffer.from(JSON.stringify(message) + "\n"));

test("exact executable selection excludes Desktop and non app-server children", () => {
  const f = fixture();
  f.process.spawn("C:\\desktop\\codex.exe", ["app-server"]);
  f.process.spawn(executable, ["login"]);
  const child = f.process.spawn(executable, ["app-server", "--listen", "stdio://"]);
  assert.equal(f.records().length, 1);
  assert.equal(f.records()[0].pid, child.pid);
  assert.equal(child.stdout.listenerCount("data"), 0);
  f.restore();
  assert.equal(f.process.spawn, f.original);
});

test("write delegates all overloads once with original receiver callback and backpressure", () => {
  for (const backpressure of [false, true]) {
    const f = fixture({ backpressure });
    const child = f.process.spawn(executable, ["app-server"]);
    const callback = () => {};
    const receiver = {};
    const frame = '{"id":1,"method":"initialize"}\n';
    for (const args of [[frame], [frame, "utf8"], [frame, callback], [frame, "utf8", callback], [Buffer.from(frame), callback], [new Uint8Array(Buffer.from(frame))]]) {
      assert.equal(child.stdin.write.apply(receiver, args), !backpressure);
      assert.equal(child.calls.at(-1).receiver, receiver);
      assert.deepEqual(child.calls.at(-1).args, args);
    }
    assert.equal(child.calls.length, 6);
    assert.equal(f.records().filter((r) => r.phase === "queued").length, 6);
  }
});

test("original transport and stdout handler exceptions propagate unchanged", () => {
  const error = new Error("native transport");
  const f = fixture({ transportError: error });
  const child = f.process.spawn(executable, ["app-server"]);
  assert.throws(() => send(child, { id: 1, method: "initialize" }), (caught) => caught === error);
  assert.equal(f.records().length, 1);
  child.stdout.on("data", () => { throw error; });
  assert.throws(() => respond(child, { id: 1, result: {} }), (caught) => caught === error);
});

test("fragmented and multiple frames correlate per child without secret leakage", () => {
  const f = fixture();
  const a = f.process.spawn(executable, ["app-server"]);
  const b = f.process.spawn(executable, ["app-server"]);
  a.stdin.write('{"id":1,"method":"account/');
  a.stdin.write('login/start","params":{"accessToken":"SECRET_CANARY"}}\n{"id":2,"method":"model/list"}\n');
  send(b, { id: 1, method: "initialize", params: { secret: "SECRET_CANARY" } });
  respond(a, { id: 1, result: { accessToken: "SECRET_CANARY" } });
  b.stdout.emit("data", Buffer.from('{"id":1,"err'));
  b.stdout.emit("data", Buffer.from('or":{"code":-1,"message":"SECRET_CANARY","data":"SECRET_CANARY"}}\n'));
  respond(a, { id: 2, result: { models: ["SECRET_CANARY"] } });
  assert.ok(!f.lines.join("").includes("SECRET_CANARY"));
  const responses = f.records().filter((r) => r.phase === "response");
  assert.deepEqual(responses.map((r) => [r.pid, r.method, r.outcome]), [[a.pid, "account/login/start", "ok"], [b.pid, "initialize", "error"], [a.pid, "model/list", "ok"]]);
  assert.equal(responses[1].errorCode, -1);
  assert.ok(f.lines.every((line) => line.length < 1024));
});

test("unknown methods IDs notifications and invalid scalars are ignored", () => {
  const f = fixture();
  const child = f.process.spawn(executable, ["app-server"]);
  for (const message of [{ id: "SECRET_CANARY", method: "initialize" }, { id: -1, method: "initialize" }, { id: 1.5, method: "initialize" }, { id: 1, method: "turn/start", params: "SECRET_CANARY" }]) send(child, message);
  respond(child, { id: 99, result: "SECRET_CANARY" });
  send(child, { id: 2, method: "account/read" });
  respond(child, { id: 2, method: "account/read", params: "SECRET_CANARY" });
  respond(child, { id: 2, error: { code: "SECRET_CANARY", message: "SECRET_CANARY" } });
  assert.equal(f.records().length, 3);
  assert.ok(!Object.hasOwn(f.records()[2], "errorCode"));
  assert.ok(!f.lines.join("").includes("SECRET_CANARY"));
});

test("oversized frames are discarded through newline and valid following frames recover", () => {
  const f = fixture({ frameLimit: 128 });
  const child = f.process.spawn(executable, ["app-server"]);
  child.stdin.write('{"id":1,"method":"initialize","params":"' + "x".repeat(200));
  child.stdin.write('"}\n{"id":2,"method":"initialize"}\n');
  respond(child, { id: 1, result: {} });
  respond(child, { id: 2, result: {} });
  assert.deepEqual(f.records().filter((r) => r.id).map((r) => r.id), [2, 2]);
});

test("multi-MiB strings convert in bounded windows and recover within the same chunk", () => {
  const f = fixture();
  const child = f.process.spawn(executable, ["app-server"]);
  const from = Buffer.from;
  let largest = 0;
  Buffer.from = function (value, ...args) {
    if (typeof value === "string") largest = Math.max(largest, value.length);
    return from.call(this, value, ...args);
  };
  try {
    child.stdin.write("x".repeat(3 * 1024 * 1024) + '\n{"id":2,"method":"initialize"}\n');
  } finally { Buffer.from = from; }
  assert.ok(largest <= 4096);
  respond(child, { id: 2, result: {} });
  assert.equal(f.records().at(-1).phase, "response");
});

test("surrogate pairs at window boundaries remain valid and alternative encoding does not change transport", () => {
  const f = fixture();
  const child = f.process.spawn(executable, ["app-server"]);
  const prefix = '{"id":1,"method":"initialize","params":"';
  child.stdin.write(prefix + "a".repeat(4095 - prefix.length) + "\ud83d\ude00" + '"}\n');
  respond(child, { id: 1, result: {} });
  assert.equal(f.records().at(-1).phase, "response");
  const frame = Buffer.from('{"id":2,"method":"initialize"}\n').toString("hex");
  const callback = () => {};
  child.stdin.write(frame, "hex", callback);
  assert.deepEqual(child.calls.at(-1).args, [frame, "hex", callback]);
  respond(child, { id: 2, result: {} });
  assert.equal(f.records().at(-1).id, 1);
});

test("private sink error partial write and record ceiling disable observation only", () => {
  for (const sink of [() => { throw new Error("SECRET_CANARY"); }, () => false, () => 1]) {
    let calls = 0;
    const f = fixture({ sink: (line) => { calls++; return sink(line); } });
    const child = f.process.spawn(executable, ["app-server"]);
    assert.doesNotThrow(() => send(child, { id: 1, method: "initialize" }));
    assert.equal(child.calls.length, 1);
    assert.equal(calls, 1);
  }
  const f = fixture({ ceiling: 2 });
  const child = f.process.spawn(executable, ["app-server"]);
  for (let id = 0; id < 100; id++) send(child, { id, method: "initialize" });
  assert.equal(f.records().length, 2);
  assert.equal(child.calls.length, 100);
});

test("bounded per-child pending requests and sanitized exit metadata", () => {
  const f = fixture();
  const child = f.process.spawn(executable, ["app-server"]);
  for (let id = 0; id < 80; id++) send(child, { id, method: "initialize" });
  child.emit("exit", 2, "SECRET_CANARY");
  assert.equal(f.records().filter((r) => r.phase === "queued").length, 64);
  assert.equal(f.records().filter((r) => r.phase === "unresolved-at-exit").length, 64);
  assert.equal(f.records().at(-1).exitCode, 2);
  assert.ok(!f.lines.join("").includes("SECRET_CANARY"));
});
