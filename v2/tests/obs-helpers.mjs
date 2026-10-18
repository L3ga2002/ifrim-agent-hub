// Simulated OBS WebSocket 5 server for tests (extracted from m09-media-capture.test.mjs, M10): real WebSocket framing, the
// obswebsocket.json subprotocol, the Hello/Identify handshake with the reference authentication, stateful StartRecord / StopRecord /
// GetRecordStatus and scenes. `outputPath` is what StopRecord reports (a test may create that file to exercise the import).
import http from "node:http";
import crypto from "node:crypto";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
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
export function fakeObs({ outputPath = "C:\\Users\\fictive\\Videos\\demo.mkv", password = null, salt = "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", challenge = "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=", respond = null, reverseOrder = false, availableRequests = null } = {}) {
  const state = { outputPath, recording: false, scene: "Demo", availableRequests, connections: 0, raw: [], identify: [], requests: [], protocols: [], authOk: 0, authFailed: 0, sockets: new Set() };
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
  if (type === "StopRecord") return { outputPath: state.outputPath || "C:\\Users\\fictive\\Videos\\demo.mkv" };
  return {};
}
