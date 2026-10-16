// M09 CAPTURE: capture sessions and markers, the obs-websocket v5 client against a local fake OBS (node:http upgrade + minimal
// RFC 6455 framing written here), the live-capture policy gate (nothing is sent to OBS while it refuses) and the Public Demo
// Mode browser capture with the REAL Playwright Chromium + ffmpeg on a local static page (SKIPPED_ENV when either is absent).
// Everything lives in a temporary data dir under .ifrim/tmp/v2-tests; no Hub, no model, no network beyond loopback.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { makeMediaEnv, realLaunchers, fakeLaunchers, probeJson, realTool, HUB_ROOT } from "./media-helpers.mjs";
import { createMediaPaths } from "../server/media/paths.mjs";
import { createMediaTools } from "../server/media/tools.mjs";
import { createMediaAssets } from "../server/media/assets.mjs";
import { browserLaunchOptions } from "../server/tools/browser-core.mjs";
import {
  createCapture, obsClient, obsAuthString, validateObsUrl, validateDemoSteps, checkDemoOrigin, buildConcatList, redactionCss,
  DEFAULT_REDACT_SELECTORS, SCREENCAST_JPEG_QUALITY, clearTypingField,
} from "../server/media/capture.mjs";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

test('M09-CP-12 typing clears only nonempty fillable controls, preserving empty/custom targets', async () => {
  for (const el of [
    { tagName: 'INPUT', type: 'tel', value: '0700' }, { tagName: 'INPUT', type: 'text', value: '' },
    { tagName: 'TEXTAREA', value: 'old' }, { tagName: 'TEXTAREA', value: '' },
    { tagName: 'DIV', isContentEditable: true, textContent: 'old' }, { tagName: 'DIV', isContentEditable: true, textContent: '' },
    { tagName: 'DIV', textContent: 'custom keyboard target' }, { tagName: 'INPUT', type: 'button', value: 'Click' },
  ]) {
    let fills = 0;
    const fillable = el.isContentEditable || el.tagName === 'TEXTAREA' || el.type === 'tel' || el.type === 'text';
    await clearTypingField({ evaluate: fn => fn(el), fill: async value => { fills++; assert.equal(value, ''); assert.ok(fillable); } }, 100);
    assert.equal(fills, Number(Boolean(fillable && (el.value || el.textContent))));
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------------

function setPolicy(env, patch) {
  env.bus.transaction(() => env.settings.set("mediaPolicy", { ...env.settings.get("mediaPolicy"), ...patch }, "test"));
}

const made = [];
function setup({ real = false, launch = null, obsFactory = undefined } = {}) {
  const env = makeMediaEnv({ launchers: real ? realLaunchers() : fakeLaunchers({}) });
  made.push(env);
  setPolicy(env, { diskReserveGb: 0 });
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const tools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools, settings: env.settings });
  const capture = createCapture({ db: env.db, bus: env.bus, clock: env.clock, settings: env.settings, config: env.config, paths, assets, tools,
    ...(launch ? { launch } : {}), ...(obsFactory ? { obsFactory } : {}) });
  return { env, paths, tools, assets, capture };
}
test.afterEach(async () => { for (const env of made.splice(0)) { await env.cleanup(); try { fs.rmSync(env.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a file still open on Windows */ } } });

const events = (db, type) => db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function rejectsCode(fn, code, category = null) {
  await assert.rejects(fn, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); if (category) assert.equal(e.category, category); return true; });
}
function throwsCode(fn, code) { assert.throws(fn, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; }); }

/** Independent reference of the v5 authentication (not the module's function). */
function referenceAuth(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(password + salt).digest("base64");
  return crypto.createHash("sha256").update(secret + challenge).digest("base64");
}

// ---------------------------------------------------------------------------------------------------------------------------
// fake OBS: node:http upgrade + minimal RFC 6455 (server frames unmasked, client frames masked, text/close/ping only)
// ---------------------------------------------------------------------------------------------------------------------------

function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  let header;
  if (body.length < 126) header = Buffer.from([0x80 | opcode, body.length]);
  else if (body.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  return Buffer.concat([header, body]);
}

/** Parses complete client frames from `buffer`; returns { frames: [{ opcode, payload }], rest }. */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset]; const b1 = buffer[offset + 1];
    let len = b1 & 0x7f; let pos = offset + 2;
    if (len === 126) { if (buffer.length - pos < 2) break; len = buffer.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { if (buffer.length - pos < 8) break; len = Number(buffer.readBigUInt64BE(pos)); pos += 8; }
    const masked = (b1 & 0x80) !== 0;
    const maskLen = masked ? 4 : 0;
    if (buffer.length - pos < maskLen + len) break;
    const mask = masked ? buffer.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const payload = Buffer.from(buffer.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    frames.push({ opcode: b0 & 0x0f, masked, payload });
    offset = pos + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * A fake obs-websocket v5 server. `password` null = no authentication. `respond(type, data)` → { status, data } | "hang" |
 * "close". Records connections, raw text messages, identify payloads and request types.
 */
function fakeObs({ password = null, salt = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=", respond = null, reverseOrder = false, availableRequests = null } = {}) {
  const state = { recording: false, scene: "Demo", availableRequests, connections: 0, raw: [], identify: [], requests: [], protocols: [], authOk: 0, authFailed: 0, sockets: new Set() };
  const server = http.createServer((req, res) => { res.writeHead(426); res.end(); });
  server.on("upgrade", (req, socket) => {
    state.connections += 1;
    state.sockets.add(socket);
    socket.on("close", () => state.sockets.delete(socket));
    socket.on("error", () => {});
    const accept = crypto.createHash("sha1").update(String(req.headers["sec-websocket-key"]) + WS_GUID).digest("base64");
    const offered = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    state.protocols.push(offered);
    const lines = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`];
    if (offered.includes("obswebsocket.json")) lines.push("Sec-WebSocket-Protocol: obswebsocket.json");
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    const send = (obj) => { if (!socket.destroyed) socket.write(encodeFrame(0x1, JSON.stringify(obj))); };
    const close = (code, reason = "") => {
      const body = Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason)]);
      if (!socket.destroyed) { socket.write(encodeFrame(0x8, body)); socket.end(); }
    };
    send({ op: 0, d: { obsWebSocketVersion: "5.5.2", rpcVersion: 1, ...(password !== null ? { authentication: { challenge, salt } } : {}) } });
    let buffer = Buffer.alloc(0);
    const queue = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeFrames(buffer);
      buffer = Buffer.from(rest);
      for (const f of frames) {
        if (!f.masked) { close(1002, "unmasked"); return; }
        if (f.opcode === 0x8) { if (!socket.destroyed) { socket.write(encodeFrame(0x8, f.payload.subarray(0, 2))); socket.end(); } return; }
        if (f.opcode === 0x9) { socket.write(encodeFrame(0xa, f.payload)); continue; }
        if (f.opcode !== 0x1) continue;
        const text = f.payload.toString("utf8");
        state.raw.push(text);
        const msg = JSON.parse(text);
        if (msg.op === 1) {
          state.identify.push(msg.d);
          if (password !== null && msg.d.authentication !== referenceAuth(password, salt, challenge)) { state.authFailed += 1; close(4009, "Authentication failed."); return; }
          state.authOk += 1;
          send({ op: 2, d: { negotiatedRpcVersion: 1 } });
        } else if (msg.op === 6) {
          const { requestType, requestId, requestData } = msg.d;
          state.requests.push(requestType);
          const answer = respond ? respond(requestType, requestData) : null;
          if (answer === "hang") continue;
          if (answer === "close") { close(4011, "Session invalidated"); return; }
          const status = answer?.status || { result: true, code: 100 };
          // Stateful like OBS (M10): StartRecord / StopRecord change what GetRecordStatus reports; the program scene can be switched.
          if (status.result && !answer?.data) {
            if (requestType === "StartRecord") state.recording = true;
            if (requestType === "StopRecord") state.recording = false;
            if (requestType === "SetCurrentProgramScene") state.scene = requestData?.sceneName;
          }
          const reply = { op: 7, d: { requestType, requestId, requestStatus: status, responseData: answer?.data ?? defaultData(requestType, state) } };
          if (reverseOrder) { queue.push(reply); if (queue.length === 2) { send(queue.pop()); send(queue.pop()); } }
          else send(reply);
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `ws://127.0.0.1:${server.address().port}`;
      resolve({ url, state, close: () => new Promise((r) => { for (const s of state.sockets) s.destroy(); server.close(() => r()); }) });
    });
  });
}
const OBS_REQUESTS = ["GetVersion", "GetSceneList", "GetCurrentProgramScene", "SetCurrentProgramScene", "GetRecordStatus", "StartRecord", "StopRecord"];
function defaultData(type, state = {}) {
  if (type === "GetVersion") return { obsVersion: "31.0.0", obsWebSocketVersion: "5.5.2", rpcVersion: 1, availableRequests: state.availableRequests || OBS_REQUESTS, platform: "windows" };
  if (type === "GetSceneList") return { currentProgramSceneName: state.scene || "Demo", scenes: [{ sceneName: "Demo", sceneIndex: 0 }, { sceneName: "Ifrim Hub", sceneIndex: 1 }] };
  if (type === "GetRecordStatus") return { outputActive: Boolean(state.recording), outputPaused: false, outputTimecode: "00:00:00.000", outputDuration: 0, outputBytes: 0 };
  if (type === "StopRecord") return { outputPath: "C:\\Users\\fictive\\Videos\\demo.mkv" };
  return {};
}

// ---------------------------------------------------------------------------------------------------------------------------
// OBS client
// ---------------------------------------------------------------------------------------------------------------------------

test("M09-CP-01 v5 authentication string matches the documented vector and an independent computation; only loopback ws:// URLs", () => {
  // obs-websocket protocol docs example (password "supersecretpassword").
  assert.equal(obsAuthString("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="), "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=");
  for (const [pw, salt, ch] of [["ăîșț-parolă", "c2FsdA==", "Y2hhbGxlbmdl"], ["", "x", "y"], ["p".repeat(300), "s", "c"]]) assert.equal(obsAuthString(pw, salt, ch), referenceAuth(pw, salt, ch));
  assert.equal(validateObsUrl("ws://127.0.0.1:4455"), "ws://127.0.0.1:4455");
  assert.equal(validateObsUrl("ws://localhost:4455/"), "ws://localhost:4455");
  assert.equal(validateObsUrl("ws://[::1]:4455"), "ws://[::1]:4455");
  for (const bad of ["wss://127.0.0.1:4455", "ws://192.168.1.20:4455", "ws://obs.example.com:4455", "ws://u:p@127.0.0.1:4455", "http://127.0.0.1:4455", "ws://127.0.0.1:4455/x?y=1"]) {
    assert.throws(() => validateObsUrl(bad), (e) => /^OBS_URL_(REFUSED|INVALID)$/.test(e.code), bad);
  }
  throwsCode(() => obsClient({ url: "ws://10.0.0.5:4455" }), "OBS_URL_REFUSED");
  throwsCode(() => obsClient({ password: 12345 }), "OBS_PASSWORD_INVALID");
});

test("M09-CP-02 OBS client: Hello → Identify with the correct authentication → Identified; responses matched by requestId; the password never goes on the wire", async () => {
  const password = "parolă-de-test-obs";
  const obs = await fakeObs({ password, reverseOrder: true });
  try {
    const client = obsClient({ url: obs.url, password, timeoutMs: 3000 });
    const info = await client.connect();
    assert.deepEqual(info, { obsWebSocketVersion: "5.5.2", rpcVersion: 1, negotiatedRpcVersion: 1 });
    assert.equal(obs.state.authOk, 1);
    assert.deepEqual(obs.state.protocols[0], ["obswebsocket.json"]);
    assert.equal(obs.state.identify[0].rpcVersion, 1);
    assert.equal(obs.state.identify[0].eventSubscriptions, 0);
    assert.equal(obs.state.identify[0].authentication, referenceAuth(password, "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="));
    // Two concurrent requests answered in REVERSE order: each resolves with its own data (requestId matching).
    const [version, scenes] = await Promise.all([client.getVersion(), client.getSceneList()]);
    assert.equal(version.obsVersion, "31.0.0");
    assert.equal(scenes.currentProgramSceneName, "Demo");
    const status = await Promise.all([client.getRecordStatus(), client.getVersion()]);
    assert.equal(status[0].outputActive, false);
    assert.equal(status[1].rpcVersion, 1);
    // Only allowlisted request types; nothing is sent for the others.
    const before = obs.state.requests.length;
    await rejectsCode(() => client.request("SetInputSettings", { inputName: "x" }), "OBS_REQUEST_REFUSED");
    await rejectsCode(() => client.request("CallVendorRequest"), "OBS_REQUEST_REFUSED");
    assert.equal(obs.state.requests.length, before);
    const ids = obs.state.raw.map((t) => JSON.parse(t)).filter((m) => m.op === 6).map((m) => m.d.requestId);
    assert.equal(new Set(ids).size, ids.length, "every request has its own requestId");
    assert.ok(obs.state.raw.every((t) => !t.includes(password)), "the clear password is never sent");
    client.close();
    assert.equal(client.state(), "closed");
    await rejectsCode(() => client.getVersion(), "OBS_NOT_CONNECTED");
    await rejectsCode(() => client.connect(), "OBS_CLIENT_USED");
  } finally { await obs.close(); }
});

test("M09-CP-03 wrong password → refused (4009 → OBS_AUTH_FAILED); a server asking for a password the caller did not give is refused before Identify", async () => {
  const obs = await fakeObs({ password: "corect" });
  try {
    await rejectsCode(() => obsClient({ url: obs.url, password: "greșit", timeoutMs: 3000 }).connect(), "OBS_AUTH_FAILED", "authentication");
    assert.equal(obs.state.authFailed, 1);
    assert.equal(obs.state.authOk, 0);
    const identifies = obs.state.identify.length;
    await rejectsCode(() => obsClient({ url: obs.url, timeoutMs: 3000 }).connect(), "OBS_PASSWORD_REQUIRED", "authentication");
    assert.equal(obs.state.identify.length, identifies, "no Identify without a password");
    // The correct password works on the same server.
    const ok = obsClient({ url: obs.url, password: "corect", timeoutMs: 3000 });
    await ok.connect();
    assert.equal(obs.state.authOk, 1);
    ok.close();
  } finally { await obs.close(); }
  // A server without authentication: no authentication field is sent even when a password is given.
  const open = await fakeObs({ password: null });
  try {
    const c = obsClient({ url: open.url, password: "nefolosită", timeoutMs: 3000 });
    await c.connect();
    assert.equal(open.state.identify[0].authentication, undefined);
    c.close();
  } finally { await open.close(); }
});

test("M09-CP-04 request timeout, a late answer ignored, close while pending, unreachable OBS", async () => {
  let hangOnce = true;
  const obs = await fakeObs({ respond: (type) => (type === "GetRecordStatus" && hangOnce ? (hangOnce = false, "hang") : type === "GetSceneList" ? "close" : null) });
  try {
    const client = obsClient({ url: obs.url, timeoutMs: 250 });
    await client.connect();
    const t0 = Date.now();
    await rejectsCode(() => client.getRecordStatus(), "OBS_TIMEOUT", "transport");
    assert.ok(Date.now() - t0 >= 200 && Date.now() - t0 < 3000, `timeout after ${Date.now() - t0} ms`);
    // The client still works after a timeout.
    assert.equal((await client.getVersion()).obsWebSocketVersion, "5.5.2");
    assert.equal((await client.getRecordStatus()).outputActive, false);
    // The server closes the session while a request is pending → that request is rejected (not left hanging).
    await rejectsCode(() => client.getSceneList(), "OBS_SESSION_INVALIDATED");
    assert.equal(client.state(), "closed");
    await rejectsCode(() => client.getVersion(), "OBS_NOT_CONNECTED");
  } finally { await obs.close(); }
  // Nothing listens: a clear "OBS does not answer" error, within the connect timeout.
  const probe = http.createServer();
  const port = await new Promise((r) => probe.listen(0, "127.0.0.1", () => r(probe.address().port)));
  await new Promise((r) => probe.close(r));
  await rejectsCode(() => obsClient({ url: `ws://127.0.0.1:${port}`, connectTimeoutMs: 3000 }).connect(), "OBS_UNREACHABLE");
  // A server that accepts TCP but never says Hello: identification timeout.
  const silent = http.createServer();
  const held = new Set();
  silent.on("upgrade", (req, socket) => { held.add(socket); socket.on("error", () => {}); /* never answers */ });
  const sport = await new Promise((r) => silent.listen(0, "127.0.0.1", () => r(silent.address().port)));
  try { await rejectsCode(() => obsClient({ url: `ws://127.0.0.1:${sport}`, connectTimeoutMs: 300 }).connect(), "OBS_TIMEOUT"); }
  finally { for (const s of held) s.destroy(); silent.closeAllConnections?.(); await new Promise((r) => silent.close(r)); }
});

test("M09-CP-05 StartRecord is blocked by policy: LIVE_MEDIA_CAPTURE_DISABLED with no connection and no request to OBS; a scope cannot approve itself", async () => {
  const password = "secret-obs-parolă";
  const obs = await fakeObs({ password });
  let factoryCalls = 0;
  const { env, capture } = setup({ obsFactory: (o) => { factoryCalls += 1; return obsClient(o); } });
  try {
    const session = capture.planSession({ kind: "obs", scope: { obsUrl: obs.url, title: "Demo OBS" }, captureLabel: "ORIGINAL_RECORDING", actor: "owner" });
    assert.equal(session.status, "PLANNED");
    await rejectsCode(() => capture.startObsRecording(session.id, { password, actor: "owner" }), "LIVE_MEDIA_CAPTURE_DISABLED", "policy");
    // liveCapture switched on but the scope is not approved by the owner (MEDIA_B): still refused.
    setPolicy(env, { liveCapture: true });
    await rejectsCode(() => capture.startObsRecording(session.id, { password, actor: "owner" }), "LIVE_MEDIA_CAPTURE_DISABLED", "policy");
    setPolicy(env, { liveCapture: false });
    await rejectsCode(() => capture.stopObsRecording(session.id, { password, actor: "owner" }), "LIVE_MEDIA_CAPTURE_DISABLED", "policy");
    assert.equal(factoryCalls, 0, "no OBS client was even created");
    assert.equal(obs.state.connections, 0, "no connection to OBS");
    assert.deepEqual(obs.state.requests, [], "no StartRecord (or any request) was sent");
    assert.equal(capture.get(session.id).status, "PLANNED");
    const refused = events(env.db, "media.capture.refused");
    assert.equal(refused.length, 3);
    assert.ok(refused.every((e) => JSON.parse(e.payload_json).code === "LIVE_MEDIA_CAPTURE_DISABLED"));
    const dump = JSON.stringify(env.db.prepare("SELECT * FROM events").all()) + JSON.stringify(env.db.prepare("SELECT * FROM media_capture_sessions").all()) + JSON.stringify(env.db.prepare("SELECT * FROM settings").all());
    assert.ok(!dump.includes(password), "the password is never stored");
    // A scope that declares its own approval is refused at planning.
    throwsCode(() => capture.planSession({ kind: "obs", scope: { obsUrl: obs.url, scopeApproval: { via: "owner_session", decisionId: "x" } }, actor: "owner" }), "CAPTURE_SCOPE_SELF_APPROVAL");
    throwsCode(() => capture.planSession({ kind: "obs", scope: { nested: { approved: true } }, actor: "owner" }), "CAPTURE_SCOPE_SELF_APPROVAL");
    throwsCode(() => capture.planSession({ kind: "obs", scope: { obsUrl: "ws://192.168.0.2:4455" }, actor: "owner" }), "OBS_URL_REFUSED");
    // Only an obs session starts OBS.
    const demo = capture.planSession({ kind: "browser_demo", scope: {}, captureLabel: "SIMULATION", actor: "owner" });
    await rejectsCode(() => capture.startObsRecording(demo.id, { password }), "CAPTURE_KIND_MISMATCH");
  } finally { await obs.close(); }
});

test("M09-CP-06 (simulated MEDIA_B fixture) the policy gate is the only barrier: approved scope + liveCapture → GetRecordStatus/StartRecord; stop is fail-safe; a changed scope voids the approval", async () => {
  const password = "pw-obs";
  const obs = await fakeObs({ password });
  const { env, capture } = setup();
  try {
    const session = capture.planSession({ kind: "obs", scope: { obsUrl: obs.url }, captureLabel: "ORIGINAL_RECORDING", actor: "owner" });
    // M09 has no writer for this approval: the test writes the shape the MEDIA_B decision would record, bound to the scope sha.
    const scopeSha = crypto.createHash("sha256").update(JSON.stringify({ obsUrl: obs.url })).digest("hex");
    const approve = (sha) => env.db.prepare("UPDATE media_capture_sessions SET consent_json = ? WHERE id = ?").run(JSON.stringify({ scopeApproval: { via: "owner_session", decisionId: "dec_fixture", scopeSha: sha } }), session.id);
    approve("0".repeat(64));
    setPolicy(env, { liveCapture: true });
    assert.equal(capture.scopeApproved(session.id), false);
    await rejectsCode(() => capture.startObsRecording(session.id, { password }), "LIVE_MEDIA_CAPTURE_DISABLED");
    assert.equal(obs.state.connections, 0);
    approve(scopeSha);
    assert.equal(capture.scopeApproved(session.id), true);
    const started = await capture.startObsRecording(session.id, { password, actor: "owner" });
    assert.equal(started.status, "RECORDING");
    assert.deepEqual(obs.state.requests, ["GetVersion", "GetRecordStatus", "StartRecord", "GetRecordStatus"], "capabilities negotiated, the start confirmed by OBS status");
    // The owner switches live capture off during the recording: stopping still works (fail-safe).
    setPolicy(env, { liveCapture: false });
    const stopped = await capture.stopObsRecording(session.id, { password, actor: "owner" });
    assert.equal(stopped.status, "STOPPED");
    assert.deepEqual(obs.state.requests.slice(4), ["StopRecord", "GetRecordStatus"], "the stop confirmed by OBS status");
    assert.equal(stopped.scope.result.outputPath, "C:\\Users\\fictive\\Videos\\demo.mkv");
    assert.equal(stopped.outputAssetId, null, "no recordingRoot in scope: the file is recorded for a manual import, never read");
    assert.ok(!JSON.stringify(env.db.prepare("SELECT * FROM events").all()).includes(password));
    assert.equal(events(env.db, "media.capture.started").length, 1);
    assert.equal(events(env.db, "media.capture.stopped").length, 1);
  } finally { await obs.close(); }
  // OBS already recording (started by someone else): not taken over.
  const busy = await fakeObs({ respond: (type) => (type === "GetRecordStatus" ? { data: { outputActive: true } } : null) });
  const s2 = setup();
  try {
    const session = s2.capture.planSession({ kind: "obs", scope: { obsUrl: busy.url }, actor: "owner" });
    const sha = crypto.createHash("sha256").update(JSON.stringify({ obsUrl: busy.url })).digest("hex");
    s2.env.db.prepare("UPDATE media_capture_sessions SET consent_json = ? WHERE id = ?").run(JSON.stringify({ scopeApproval: { via: "owner_session", decisionId: "dec_fixture", scopeSha: sha } }), session.id);
    setPolicy(s2.env, { liveCapture: true });
    await rejectsCode(() => s2.capture.startObsRecording(session.id, {}), "OBS_ALREADY_RECORDING");
    assert.deepEqual(busy.state.requests, ["GetVersion", "GetRecordStatus"]);
    assert.equal(s2.capture.get(session.id).status, "PLANNED");
  } finally { await busy.close(); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// sessions, markers, pure helpers
// ---------------------------------------------------------------------------------------------------------------------------

test("M09-CP-07 planSession / addMarker: validation, sorted markers, closed sessions, fail-safe cancel, events", () => {
  const { env, capture } = setup();
  throwsCode(() => capture.planSession({ kind: "webcam", actor: "owner" }), "FIELD_INVALID");
  throwsCode(() => capture.planSession({ kind: "obs", captureLabel: "NOT_APPLICABLE", actor: "owner" }), "FIELD_INVALID");
  throwsCode(() => capture.planSession({ kind: "obs" }), "ACTOR_REQUIRED");
  assert.throws(() => capture.planSession({ kind: "obs", contentProjectId: "cpr_missing", actor: "owner" }), (e) => e.code === "CONTENT_PROJECT_MISSING" && e.category === "not_found");
  throwsCode(() => capture.planSession({ kind: "obs", scope: ["x"], actor: "owner" }), "CAPTURE_SCOPE_INVALID");
  throwsCode(() => capture.planSession({ kind: "obs", scope: { big: "x".repeat(20000) }, actor: "owner" }), "CAPTURE_SCOPE_INVALID");
  const s = capture.planSession({ kind: "interview", scope: { topic: "Interviu" }, actor: "owner" });
  assert.equal(s.captureLabel, "ORIGINAL_RECORDING");
  capture.addMarker(s.id, { kind: "cta", atMs: 9000, note: "  Apel la acțiune  " });
  capture.addMarker(s.id, { kind: "hook", atMs: 0 });
  const after = capture.addMarker(s.id, { kind: "proof", atMs: 4200.4, note: "Dovadă: testele trec" });
  assert.deepEqual(after.markers.map((m) => [m.kind, m.atMs]), [["hook", 0], ["proof", 4200], ["cta", 9000]]);
  assert.equal(after.markers[2].note, "Apel la acțiune");
  throwsCode(() => capture.addMarker(s.id, { kind: "explozie", atMs: 1 }), "FIELD_INVALID");
  throwsCode(() => capture.addMarker(s.id, { kind: "note", atMs: -5 }), "MARKER_INVALID");
  throwsCode(() => capture.addMarker(s.id, { kind: "note", atMs: Number.NaN }), "MARKER_INVALID");
  throwsCode(() => capture.addMarker(s.id, { kind: "note", atMs: 1, note: "x".repeat(400) }), "FIELD_TOO_LONG");
  throwsCode(() => capture.addMarker("mcs_nope", { kind: "note", atMs: 1 }), "CAPTURE_SESSION_MISSING");
  const c = capture.cancel(s.id, { actor: "owner" });
  assert.equal(c.cancelled, true);
  assert.equal(capture.get(s.id).status, "CANCELLED");
  throwsCode(() => capture.addMarker(s.id, { kind: "note", atMs: 1 }), "CAPTURE_SESSION_CLOSED");
  assert.equal(capture.cancel(s.id, { actor: "owner" }).cancelled, false, "cancel is idempotent");
  assert.equal(events(env.db, "media.capture.planned").length, 1);
  assert.equal(events(env.db, "media.capture.marker_added").length, 3);
  assert.equal(events(env.db, "media.capture.cancelled").length, 1);
  assert.equal(capture.list({ kind: "interview" }).length, 1);
  assert.equal(capture.recover().interrupted, 0);
});

test("M09-CP-08 typed demo steps, demo origin rules (live Hub flagged), exact ffconcat durations, redaction CSS", () => {
  const ok = validateDemoSteps([{ goto: "/" }, { marker: { kind: "hook" } }, { type: { selector: "#q", text: "căutare" } }, { press: "Control+A" }, { press: "Enter" },
    { wait: 500 }, { waitFor: "#out" }, { scroll: { y: 400 } }, { scroll: { selector: "#footer" } }, { highlight: "#go" }, { click: "#go" }]);
  assert.equal(ok.length, 11);
  assert.deepEqual(ok[2], { type: { selector: "#q", text: "căutare", delayMs: 60 } });
  assert.deepEqual(ok[9], { highlight: { selector: "#go", ms: 1200 } });
  for (const bad of [[], [{ click: "#a" }], [{ goto: "http://example.com/" }], [{ goto: "//evil.test/" }], [{ goto: "/a b" }], [{ eval: "alert(1)" }], [{ goto: "/", click: "a" }],
    [{ goto: "/" }, { click: "a{background:red}" }], [{ goto: "/" }, { click: "a</style>" }], [{ goto: "/" }, { press: "rm -rf" }], [{ goto: "/" }, { wait: 99999 }],
    [{ goto: "/" }, { marker: { kind: "x" } }], [{ goto: "/" }, { type: { selector: "#a", text: "\u0007" } }], Array.from({ length: 61 }, () => ({ goto: "/" }))]) {
    assert.throws(() => validateDemoSteps(bad), (e) => e.code === "DEMO_STEPS_INVALID", JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(checkDemoOrigin("http://127.0.0.1:5173"), { origin: "http://127.0.0.1:5173", port: "5173", liveHub: false });
  assert.equal(checkDemoOrigin("http://localhost:8011").liveHub, true);
  assert.equal(checkDemoOrigin("http://127.0.0.1:8011/").liveHub, true);
  assert.equal(checkDemoOrigin("http://127.0.0.1:9000", { config: { testMode: false, port: 9000 } }).liveHub, true, "the configured port of a production Hub is live too");
  assert.equal(checkDemoOrigin("http://127.0.0.1:9000", { config: { testMode: true, port: 9000 } }).liveHub, false);
  assert.equal(checkDemoOrigin("http://127.0.0.1:3011", { config: { testMode: true } }).liveHub, true, "the UI dev server proxies to the live Hub");
  assert.equal(checkDemoOrigin("http://127.0.0.1:5200", { config: { testMode: false, port: 8011, allowedOrigins: new Set(["http://localhost:5200"]) } }).liveHub, true, "a configured dev origin of a production Hub");
  for (const bad of ["http://example.com:80", "http://10.0.0.2:3000", "ftp://127.0.0.1:21", "http://u:p@127.0.0.1:3000", "http://127.0.0.1", "http://127.0.0.1:3000/app", "nu-e-url"]) {
    assert.throws(() => checkDemoOrigin(bad), (e) => /^DEMO_ORIGIN_(REFUSED|INVALID)$/.test(e.code), bad);
  }
  // Frames at 0, 100, 100.3 and 350 ms, end 1000 ms: the frame at 100 ms is replaced after 0.3 ms (< 0.5 ms, never visible) and
  // dropped, so the first frame lasts until 100.3 ms.
  const list = buildConcatList([{ file: "f000001.jpg", atMs: 0 }, { file: "f000002.jpg", atMs: 100 }, { file: "f000003.jpg", atMs: 100.3 }, { file: "f000004.jpg", atMs: 350 }], 1000);
  assert.equal(list.kept, 3);
  assert.equal(list.totalUs, 1000000);
  assert.equal(list.text, "ffconcat version 1.0\nfile 'f000001.jpg'\nduration 0.100300\nfile 'f000003.jpg'\nduration 0.249700\nfile 'f000004.jpg'\nduration 0.650000\nfile 'f000004.jpg'\n");
  // Drift-free: durations are differences of rounded boundaries, so they add up to the end exactly.
  const many = Array.from({ length: 200 }, (_, i) => ({ file: `f${String(i + 1).padStart(6, "0")}.jpg`, atMs: i * 33.3333 }));
  const l2 = buildConcatList(many, 7000);
  const sum = [...l2.text.matchAll(/duration (\d+\.\d{6})/g)].reduce((s, m) => s + Math.round(Number(m[1]) * 1e6), 0);
  assert.equal(sum, 7000000);
  assert.equal(l2.totalUs, 7000000);
  assert.ok(l2.text.trim().endsWith("file 'f000200.jpg'"), "the last file is repeated (the concat demuxer ignores the last duration otherwise)");
  assert.ok(!/[\\/:]/.test(l2.text.replace("ffconcat version 1.0", "").replace(/duration \d+\.\d+/g, "")), "relative portable names only (-safe 1)");
  assert.throws(() => buildConcatList([{ file: "../x.jpg", atMs: 0 }], 10), (e) => e.code === "CAPTURE_FRAME_NAME");
  assert.throws(() => buildConcatList([{ file: "C:/x.jpg", atMs: 0 }], 10), (e) => e.code === "CAPTURE_FRAME_NAME");
  assert.throws(() => buildConcatList([], 10), (e) => e.code === "CAPTURE_NO_FRAMES");
  const css = redactionCss([...DEFAULT_REDACT_SELECTORS, ".iban"]);
  assert.match(css, /\[data-sensitive\],\ninput\[type=password\],\n\.iban \{/);
  assert.match(css, /filter: brightness\(0\) !important/);
  assert.ok(SCREENCAST_JPEG_QUALITY >= 90);
});

test("M09-CP-09 captureBrowserDemo refuses before launching anything: live Hub origin, missing/negative allowOrigin, remote origin, missing label, bad options", async () => {
  let launches = 0;
  const launch = async () => { launches += 1; throw new Error("sentinel: launch reached"); };
  const { env, capture } = setup({ launch });
  const base = { steps: [{ goto: "/" }], captureLabel: "SIMULATION", actor: "owner", allowOrigin: () => true };
  for (const origin of ["http://localhost:8011", "http://127.0.0.1:8011", "http://[::1]:8011"]) {
    await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin }), "LIVE_HUB_CAPTURE_REFUSED", "policy");
  }
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", allowOrigin: undefined }), "DEMO_ALLOW_ORIGIN_REQUIRED", "policy");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", allowOrigin: () => false }), "DEMO_ORIGIN_NOT_ALLOWED", "policy");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", allowOrigin: () => "yes" }), "DEMO_ORIGIN_NOT_ALLOWED", "policy");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", allowOrigin: () => { throw new Error("x"); } }), "DEMO_ORIGIN_NOT_ALLOWED");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "https://demo.example.com:443" }), "DEMO_ORIGIN_REFUSED");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", captureLabel: undefined }), "CAPTURE_LABEL_REQUIRED");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", steps: [{ click: "#a" }] }), "DEMO_STEPS_INVALID");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", fps: 240 }), "FIELD_INVALID");
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100", redactSelectors: ["x{}"] }), "DEMO_SELECTOR_INVALID");
  assert.equal(launches, 0, "nothing was launched");
  assert.equal(count(env.db, "media_capture_sessions"), 0, "no session for a refused capture");
  assert.ok(events(env.db, "media.capture.refused").length >= 6);
  // The UI dev server (3011) proxies to the live Hub: refused the same way.
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://localhost:3011" }), "LIVE_HUB_CAPTURE_REFUSED", "policy");
  // liveCapture on is not enough: the live Hub also needs the owner's approval of the session's exact scope (no writer in M09).
  setPolicy(env, { liveCapture: true });
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:8011" }), "LIVE_HUB_CAPTURE_REFUSED", "policy");
  assert.equal(launches, 0, "still nothing launched");
  // A test Hub origin with liveCapture on reaches the browser launch.
  await rejectsCode(() => capture.captureBrowserDemo({ ...base, origin: "http://127.0.0.1:4100" }), "BROWSER_LAUNCH_FAILED", "tool");
  assert.equal(launches, 1);
  const failed = capture.list({ kind: "browser_demo" })[0];
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error, /Browserul nu a putut porni/);
  assert.equal(events(env.db, "media.capture.failed").length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------
// real browser capture (Playwright Chromium + ffmpeg)
// ---------------------------------------------------------------------------------------------------------------------------

let chromiumCheck = null;
async function chromiumAvailable() {
  if (chromiumCheck) return chromiumCheck;
  chromiumCheck = (async () => {
    let pw;
    try { pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); } catch { return "Playwright is not installed"; }
    try { const b = await pw.chromium.launch(browserLaunchOptions("http://127.0.0.1:9")); await b.close(); return null; }
    catch (error) { return `Chromium cannot start (${String(error.message).split("\n")[0].slice(0, 120)})`; }
  })();
  return chromiumCheck;
}
async function realSkip(t) {
  if (!realTool("ffmpeg") || !realTool("ffprobe")) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found"); return true; }
  const reason = await chromiumAvailable();
  if (reason) { t.skip(`SKIPPED_ENV: ${reason}`); return true; }
  return false;
}

const PAGE_HTML = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Demo Hub test</title><link rel="stylesheet" href="/s.css"></head>
<body><div id="secret" data-sensitive>IBAN RO49 AAAA 1B31 0075 9384 0000</div><div id="control"></div><div id="tick">0</div>
<button id="go">Pornește</button><div id="out"></div><img src="http://example.com/tracker.png" alt=""><script src="/app.js"></script></body></html>`;
const PAGE_CSS = `body{margin:0;background:#ffffff;font-family:sans-serif}
#secret{position:absolute;left:100px;top:100px;width:240px;height:100px;background:#ff0000;color:#ffffff;font-size:22px}
#control{position:absolute;left:420px;top:100px;width:240px;height:100px;background:#ff0000}
#tick{position:absolute;left:100px;top:300px;font-size:40px}#go{position:absolute;left:100px;top:420px;font-size:24px}#out{position:absolute;left:300px;top:420px;font-size:24px}`;
const PAGE_JS = `let n=0;setInterval(()=>{document.getElementById('tick').textContent=String(++n)},100);
document.getElementById('go').addEventListener('click',()=>{document.getElementById('out').textContent='gata'});`;

function servePage() {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url);
      // A strict CSP (no inline styles): the injected redaction must still apply.
      const csp = { "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'" };
      if (req.url === "/" ) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...csp }); res.end(PAGE_HTML); }
      else if (req.url === "/s.css") { res.writeHead(200, { "Content-Type": "text/css" }); res.end(PAGE_CSS); }
      else if (req.url === "/app.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(PAGE_JS); }
      else { res.writeHead(404); res.end(); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
  });
}

/** Average RGB of a region of the frame at `atSec`, decoded with the REAL ffmpeg (test assertion only). */
function regionRgb(file, atSec, { x, y, w, h }) {
  const raw = execFileSync(realTool("ffmpeg"), ["-v", "error", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const px = raw.length / 3;
  assert.equal(px, w * h);
  let r = 0; let g = 0; let b = 0;
  for (let i = 0; i < raw.length; i += 3) { r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; }
  return { r: r / px, g: g / px, b: b / px };
}

test("M09-CP-10 browser demo capture: decodable constant-fps H.264 with the expected duration, [data-sensitive] masked from the first frame, markers stored, asset OWNED/screen_recording", { timeout: 180000 }, async (t) => {
  if (await realSkip(t)) return;
  const site = await servePage();
  const { env, capture, assets, paths } = setup({ real: true });
  try {
    const allowed = [];
    const t0 = Date.now();
    const result = await capture.captureBrowserDemo({
      origin: site.origin, allowOrigin: (o) => { allowed.push(o); return o === site.origin; }, captureLabel: "SIMULATION", title: "Demo Public Demo Mode", actor: "owner",
      viewport: { width: 960, height: 540 }, fps: 30, holdEndMs: 400,
      steps: [{ goto: "/" }, { marker: { kind: "hook", note: "Început demo" } }, { wait: 1200 }, { click: "#go" }, { waitFor: "#out" }, { highlight: { selector: "#go", ms: 400 } },
        { marker: { kind: "cta", note: "Final apel la acțiune" } }, { wait: 800 }],
    });
    const wall = Date.now() - t0;
    assert.deepEqual(allowed, [site.origin]);
    assert.equal(result.session.status, "STOPPED");
    assert.equal(result.asset.category, "screen_recording");
    assert.equal(result.asset.origin, "OWNED");
    assert.equal(result.asset.captureLabel, "SIMULATION");
    assert.equal(result.session.outputAssetId, result.asset.id);
    assert.equal(result.version.status, "READY");
    assert.equal(result.width, 960); assert.equal(result.height, 540);
    assert.ok(result.frames >= 10, `frames: ${result.frames}`);
    // Waits 1200 + 400 + 800 + hold 400 = 2800 ms at least; never more than the wall time.
    assert.ok(result.durationMs >= 2700 && result.durationMs <= wall, `durationMs ${result.durationMs}, wall ${wall}`);
    const file = assets.versionPath(result.version.id);
    const probe = probeJson(file);
    const video = probe.streams.find((s) => s.codec_type === "video");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.pix_fmt, "yuv420p");
    assert.equal(video.avg_frame_rate, "30/1");
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(video.width, 960); assert.equal(video.height, 540);
    assert.ok(!probe.streams.some((s) => s.codec_type === "audio"));
    const seconds = Number(probe.format.duration);
    assert.ok(Math.abs(seconds * 1000 - result.durationMs) <= result.durationMs * 0.1, `probe ${seconds}s vs expected ${result.durationMs} ms`);
    const frames = Number(video.nb_frames);
    assert.ok(Math.abs(frames - (result.durationMs / 1000) * 30) <= 3, `constant fps: ${frames} frames for ${result.durationMs} ms`);
    // Decodes end to end without errors.
    const decode = execFileSync(realTool("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(decode.trim(), "");
    // Redaction: the sensitive box is black in the FIRST frame and later; the identical control box stays red.
    for (const at of [0, 1.0, (result.durationMs / 1000) - 0.2]) {
      const secret = regionRgb(file, at, { x: 120, y: 120, w: 200, h: 60 });
      const control = regionRgb(file, at, { x: 440, y: 120, w: 200, h: 60 });
      assert.ok(secret.r < 40 && secret.g < 40 && secret.b < 40, `masked at ${at}s: ${JSON.stringify(secret)}`);
      assert.ok(control.r > 150 && control.g < 90 && control.b < 90, `control red at ${at}s: ${JSON.stringify(control)}`);
    }
    // Markers: stored on the session in time order, inside the recording, findable through the library search.
    const session = capture.get(result.session.id);
    // M11: a highlight step also records where the element was (a rect normalized to the viewport), so a clip can point at it.
    assert.deepEqual(session.markers.map((m) => m.kind), ["hook", "highlight", "cta"]);
    const hl = session.markers.find((m) => m.kind === "highlight");
    assert.ok(hl.rect && [hl.rect.x, hl.rect.y, hl.rect.w, hl.rect.h].every((v) => v >= 0 && v <= 1) && hl.rect.w > 0, JSON.stringify(hl));
    assert.ok(session.markers[0].atMs <= 400, `hook at ${session.markers[0].atMs}`);
    const cta = session.markers.find((m) => m.kind === "cta");
    assert.ok(cta.atMs >= 1200 && cta.atMs <= result.durationMs, `cta at ${cta.atMs}`);
    const hits = assets.search({ q: "apel la acțiune" });
    assert.ok(hits.some((h) => h.source === "marker" && h.assetId === result.asset.id && h.fromMs === cta.atMs));
    // A marker after the end of the recording is refused; one inside is accepted.
    assert.throws(() => capture.addMarker(session.id, { kind: "note", atMs: result.durationMs + 5000 }), (e) => e.code === "MARKER_OUT_OF_RANGE");
    assert.equal(capture.addMarker(session.id, { kind: "note", atMs: 500, note: "Adăugat după" }).markers.length, 4);
    // The external image was blocked by the guard; the page server saw only its own files.
    assert.ok(session.scope.result.blocked >= 1);
    assert.deepEqual([...new Set(site.hits)].sort(), ["/", "/app.js", "/s.css"]);
    assert.ok(session.scope.steps.every((s) => !("type" in s) || typeof s.type.chars === "number"));
    // The scratch frames are gone; the library holds the recording under a content-addressed name.
    assert.equal(fs.existsSync(path.join(env.config.workDir, "media-capture", session.id)), false);
    assert.match(result.version.relPath, /^originals\/[0-9a-f]{2}\/[0-9a-f]{64}\.mp4$/);
    assert.ok(paths.isLibraryPath(file));
    assert.equal(events(env.db, "media.capture.completed").length, 1);
    assert.equal(events(env.db, "media.asset.imported").length, 1);
  } finally { await site.close(); }
});

test("M09-CP-11 browser demo capture: cancel during the recording → CANCELLED, frames removed, journal kept, no asset", { timeout: 120000 }, async (t) => {
  if (await realSkip(t)) return;
  const site = await servePage();
  const { env, capture } = setup({ real: true });
  try {
    const planned = capture.planSession({ kind: "browser_demo", scope: { origin: site.origin }, captureLabel: "SIMULATION", actor: "owner" });
    const running = capture.captureBrowserDemo({ sessionId: planned.id, origin: site.origin, allowOrigin: () => true, actor: "owner", viewport: { width: 640, height: 400 },
      steps: [{ goto: "/" }, { wait: 20000 }] });
    const settled = running.then(() => null, (e) => e);
    // Wait until the recording is running (frames written), then cancel (fail-safe).
    const dir = path.join(env.config.workDir, "media-capture", planned.id);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(fs.existsSync(dir) && fs.readdirSync(dir).some((n) => n.endsWith(".jpg")))) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.readdirSync(dir).some((n) => n.endsWith(".jpg")), "frames were being written");
    // A second capture while one runs is refused.
    await assert.rejects(() => capture.captureBrowserDemo({ origin: site.origin, allowOrigin: () => true, captureLabel: "SIMULATION", actor: "owner", steps: [{ goto: "/" }] }), (e) => e.code === "CAPTURE_BUSY");
    const c = capture.cancel(planned.id, { actor: "owner" });
    assert.equal(c.running, true);
    const error = await settled;
    assert.equal(error?.code, "CANCELLED");
    const session = capture.get(planned.id);
    assert.equal(session.status, "CANCELLED");
    assert.equal(session.outputAssetId, null);
    assert.deepEqual(fs.readdirSync(dir), ["journal.json"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "journal.json"), "utf8")).code, "CANCELLED");
    assert.equal(count(env.db, "media_assets"), 0);
    assert.equal(events(env.db, "media.capture.cancelled").length, 1);
  } finally { await site.close(); }
});
