// M10 real Desktop Operator helper (the C# binary built from v2/desktop/operator with the Windows .NET Framework compiler): protocol and
// authority checks WITHOUT touching the desktop — only read-only operations (ping, desktop state, a window list for a process that does
// not exist) and refusals (bad signature, replay, stale message, no / expired authority, paused). Windows only; SKIPPED_ENV elsewhere or
// when the compiler is missing. The Hub client's own handshake and verification against the manifest are exercised as well.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { tempDir } from "./helpers.mjs";

const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const available = process.platform === "win32" && fs.existsSync(csc);

async function startHelper(exe) {
  const key = crypto.randomBytes(32);
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const rl = readline.createInterface({ input: child.stdout });
  const queue = [];
  const waiters = [];
  rl.on("line", (line) => { const w = waiters.shift(); if (w) w(line); else queue.push(line); });
  const next = (ms = 15000) => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const timer = setTimeout(() => reject(new Error("no answer from the helper")), ms);
    waiters.push((l) => { clearTimeout(timer); resolve(l); });
  });
  const verify = (line) => {
    const env = JSON.parse(line);
    const mac = crypto.createHmac("sha256", key).update(env.body, "utf8").digest("hex");
    assert.equal(env.mac, mac, "every answer is signed with the session key");
    return JSON.parse(env.body);
  };
  child.stdin.write(`${JSON.stringify({ hello: { key: key.toString("hex"), session: "test" } })}\n`);
  const hello = verify(await next());
  const send = async ({ op, args = {}, auth = null, nonce = crypto.randomBytes(16).toString("hex"), ts = new Date().toISOString(), badMac = false }) => {
    const body = JSON.stringify({ v: 1, id: crypto.randomBytes(4).toString("hex"), op, args, auth, nonce, ts });
    const mac = badMac ? "0".repeat(64) : crypto.createHmac("sha256", key).update(body, "utf8").digest("hex");
    child.stdin.write(`${JSON.stringify({ body, mac })}\n`);
    return { answer: verify(await next()), body, mac, nonce };
  };
  const resend = async (raw) => { child.stdin.write(`${JSON.stringify(raw)}\n`); return verify(await next()); };
  return { child, hello, send, resend, close: () => { try { child.stdin.end(); } catch { /* */ } child.kill(); } };
}

test("M10-OR-01 real helper: build from source (UTF-8), manifest binds binary ↔ source, the Hub client refuses a stale binary", { skip: available ? false : "SKIPPED_ENV: Windows + .NET Framework csc required" }, async () => {
  const { buildOperator, sha256File, OPERATOR_SOURCE } = await import("../scripts/build-operator.mjs");
  const { verifyOperatorBinary } = await import("../server/desktop/operator-client.mjs");
  const out = path.join(tempDir("m10-op-build"), "desktop");
  const m = buildOperator(out);
  assert.equal(m.sha256, sha256File(m.exe));
  assert.equal(m.sourceSha256, sha256File(OPERATOR_SOURCE));
  assert.equal(verifyOperatorBinary(m.exe).ok, true);
  // A binary that no longer matches its manifest is refused (the Hub never starts an unknown helper).
  const copy = path.join(out, "copy");
  fs.mkdirSync(copy);
  fs.copyFileSync(m.exe, path.join(copy, "IfrimOperator.exe"));
  fs.writeFileSync(path.join(copy, "IfrimOperator.manifest.json"), JSON.stringify({ ...m, exe: path.join(copy, "IfrimOperator.exe"), sha256: "0".repeat(64) }));
  assert.equal(verifyOperatorBinary(path.join(copy, "IfrimOperator.exe")).ok, false);
  globalThis.__m10OperatorExe = m.exe;
});

test("M10-OR-02 real helper protocol: signed hello/answers; bad MAC, replay, stale, no or expired authority refused; Romanian text intact", { skip: available ? false : "SKIPPED_ENV: Windows + .NET Framework csc required" }, async () => {
  let exe = globalThis.__m10OperatorExe;
  if (!exe) { const { buildOperator } = await import("../scripts/build-operator.mjs"); exe = buildOperator(path.join(tempDir("m10-op-build2"), "desktop")).exe; }
  const h = await startHelper(exe);
  try {
    assert.equal(h.hello.op, "hello");
    assert.equal(h.hello.ok, true);
    const ping = await h.send({ op: "ping" });
    assert.equal(ping.answer.ok, true);
    // Read-only state (no authority needed): the input desktop name and the interactive flag.
    const st = await h.send({ op: "desktopState" });
    assert.equal(st.answer.ok, true);
    assert.equal(typeof st.answer.result.inputDesktop, "string");
    // Bad signature.
    const bad = await h.send({ op: "ping", badMac: true });
    assert.equal(bad.answer.ok, false);
    assert.equal(bad.answer.error.code, "BAD_MAC");
    // Replay: the same signed message twice.
    const first = await h.send({ op: "ping" });
    assert.equal(first.answer.ok, true);
    const replay = await h.resend({ body: first.body, mac: first.mac });
    assert.equal(replay.error.code, "REPLAY");
    // Stale timestamp.
    const stale = await h.send({ op: "ping", ts: new Date(Date.now() - 10 * 60000).toISOString() });
    assert.equal(stale.answer.error.code, "STALE");
    // Effectful operations without the Hub's authority, or with an expired one.
    const none = await h.send({ op: "focus", args: { hwnd: 1 } });
    assert.equal(none.answer.error.code, "NO_AUTHORITY");
    const expired = await h.send({ op: "launch", args: { kind: "exe", exe: "C:\\Windows\\System32\\cmd.exe" }, auth: { plan: "p", step: "s", apps: [], exp: new Date(Date.now() - 1000).toISOString() } });
    assert.equal(expired.answer.error.code, "AUTHORITY_EXPIRED");
    // A window list for a process that does not exist: empty (read-only, inside the authority's scope).
    const list = await h.send({ op: "listWindows", args: { processNames: ["IfrimNoSuchProcess"] }, auth: { plan: "p", step: "s", apps: ["IfrimNoSuchProcess"], exp: new Date(Date.now() + 60000).toISOString() } });
    assert.equal(list.answer.ok, true);
    assert.deepEqual(list.answer.result.windows, []);
    // Stop pauses: effectful work is refused until resume; the Romanian message arrives intact (UTF-8 source + output).
    const stop = await h.send({ op: "stop" });
    assert.equal(stop.answer.ok, true);
    const paused = await h.send({ op: "focus", args: { hwnd: 1 }, auth: { plan: "p", step: "s", apps: ["x"], exp: new Date(Date.now() + 60000).toISOString() } });
    assert.equal(paused.answer.error.code, "PAUSED");
    assert.match(paused.answer.error.message, /Operatorul e pe pauză/);
    assert.doesNotMatch(JSON.stringify(paused.answer), /Ã|�/, "no mojibake");
    const resume = await h.send({ op: "resume" });
    assert.equal(resume.answer.ok, true);
  } finally { h.close(); }
});

test("M10-OR-03 real helper reads JSON arrays (object[]): discovery candidates are honoured; a window op without an app list is refused (fail-closed)", { skip: available ? false : "SKIPPED_ENV: Windows + .NET Framework csc required" }, async () => {
  let exe = globalThis.__m10OperatorExe;
  if (!exe) { const { buildOperator } = await import("../scripts/build-operator.mjs"); exe = buildOperator(path.join(tempDir("m10-op-build3"), "desktop")).exe; }
  const h = await startHelper(exe);
  const auth = (apps) => ({ plan: "p", step: "s", ...(apps ? { apps } : {}), exp: new Date(Date.now() + 60000).toISOString() });
  try {
    // A candidate whose known path is this Node executable: the array of candidates and its knownPaths array are read.
    const d = await h.send({ op: "discoverApps", args: { candidates: [{ id: "probe", appPaths: [], startMenu: [], knownPaths: [process.execPath] }] }, auth: auth([]) });
    assert.equal(d.answer.ok, true, JSON.stringify(d.answer.error));
    assert.equal(d.answer.result.apps.length, 1);
    assert.equal(d.answer.result.apps[0].id, "probe");
    assert.equal(d.answer.result.apps[0].found.length, 1, "the knownPaths array was honoured");
    assert.equal(path.resolve(d.answer.result.apps[0].found[0].path).toLowerCase(), process.execPath.toLowerCase());
    // The shell's own windows (explorer.exe always has some): the processNames array filters them.
    const list = await h.send({ op: "listWindows", args: { processNames: ["explorer"] }, auth: auth(["explorer"]) });
    assert.equal(list.answer.ok, true);
    const win = list.answer.result.windows[0];
    if (win) {
      // Read-only observe, but outside the authority's apps → OUT_OF_SCOPE; with NO app list at all → refused too (never "any app").
      const out = await h.send({ op: "observe", args: { hwnd: win.hwnd, maxNodes: 5 }, auth: auth(["notepad"]) });
      assert.equal(out.answer.error?.code, "OUT_OF_SCOPE");
      const none = await h.send({ op: "observe", args: { hwnd: win.hwnd, maxNodes: 5 }, auth: auth(null) });
      assert.equal(none.answer.error?.code, "OUT_OF_SCOPE");
    }
  } finally { h.close(); }
});
