import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";

function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function startServer() {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  return { ...t, server, token, port: t.config.port, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("T21/T24 host, origin and token checks protect the local API", async () => {
  const s = await startServer();
  try {
    assert.equal((await request(s.port, { path: "/api/health" })).status, 200);
    assert.equal((await request(s.port, { path: "/api/health", headers: { Host: "evil.example:80" } })).status, 403, "DNS-rebinding host refused");
    assert.equal((await request(s.port, { path: "/api/health", headers: { Origin: "https://evil.example" } })).status, 403, "foreign origin refused");
    const noToken = await request(s.port, { method: "POST", path: "/api/stop-all", body: {} });
    assert.equal(noToken.status, 403);
    const session = await request(s.port, { path: "/api/session" });
    assert.equal(session.json.token, s.token);
    assert.equal((await request(s.port, { path: "/api/session", headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    const ok = await request(s.port, { method: "POST", path: "/api/stop-all", headers: { "X-Hub-Token": s.token }, body: {} });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.gate, "suspended");
  } finally { await s.stop(); }
});

test("T05 gate cannot be opened or mode changed without explicit confirmation; OPERATIONAL is refused", async () => {
  const s = await startServer();
  try {
    const h = { "X-Hub-Token": s.token };
    assert.equal((await request(s.port, { method: "POST", path: "/api/gate", headers: h, body: { action: "open" } })).status, 400);
    assert.equal((await request(s.port, { method: "POST", path: "/api/mode", headers: h, body: { mode: "LIVE_VALIDATION" } })).status, 400);
    assert.equal((await request(s.port, { method: "POST", path: "/api/mode", headers: h, body: { mode: "OPERATIONAL", confirm: "OPERATIONAL" } })).status, 403);
    assert.equal((await request(s.port, { method: "POST", path: "/api/grants", headers: h, body: { provider: "codex", projectId: s.hub.projects.hub().id, access: "read-only", maxAttempts: 1 } })).status, 403, "grants only in LIVE_VALIDATION");
    assert.equal((await request(s.port, { method: "PATCH", path: "/api/settings", headers: h, body: { mode: "OPERATIONAL" } })).status, 403);
    assert.equal((await request(s.port, { method: "PATCH", path: "/api/settings", headers: h, body: { voice: { enabled: true, wakeWord: true } } })).status, 403, "T20 wake word stays off");
  } finally { await s.stop(); }
});

test("T17 SSE replays by Last-Event-ID without gaps or duplicates", async () => {
  const s = await startServer();
  try {
    const h = { "X-Hub-Token": s.token };
    const project = s.hub.projects.hub();
    const conv = await request(s.port, { method: "POST", path: "/api/conversations", headers: h, body: { projectId: project.id, title: "SSE" } });
    for (let i = 0; i < 5; i += 1) await request(s.port, { method: "POST", path: `/api/conversations/${conv.json.id}/messages`, headers: h, body: { content: `m${i}`, clientMessageId: `c${i}` } });
    const all = (await request(s.port, { path: "/api/events?after=0&limit=1000" })).json.events.map((e) => e.seq);
    const middle = all[Math.floor(all.length / 2)];
    const received = await new Promise((resolve) => {
      const seqs = [];
      const req = http.get({ host: "127.0.0.1", port: s.port, path: "/api/stream", headers: { Host: `127.0.0.1:${s.port}`, "Last-Event-ID": String(middle) } }, (res) => {
        res.setEncoding("utf8");
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk;
          for (const match of buffer.matchAll(/^id: (\d+)$/gm)) seqs.push(Number(match[1]));
          buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
          if (seqs.length && seqs.at(-1) === all.at(-1)) { req.destroy(); resolve(seqs); }
        });
      });
    });
    assert.deepEqual(received, all.filter((seq) => seq > middle));
    assert.equal(new Set(received).size, received.length);
    // Idempotent message POST: same clientMessageId does not duplicate.
    const again = await request(s.port, { method: "POST", path: `/api/conversations/${conv.json.id}/messages`, headers: h, body: { content: "m0", clientMessageId: "c0" } });
    assert.equal(again.json.duplicate, true);
    const detail = await request(s.port, { path: `/api/conversations/${conv.json.id}` });
    assert.equal(detail.json.messages.length, 5);
  } finally { await s.stop(); }
});

test("T15/T21 approvals over HTTP require the displayed hash; voice cannot approve", async () => {
  const s = await startServer();
  try {
    const h = { "X-Hub-Token": s.token };
    const project = s.hub.projects.hub();
    const run = await request(s.port, { method: "POST", path: "/api/tools/process.run", headers: h, body: { projectId: project.id, args: { script: "test" } } });
    assert.equal(run.json.approvalRequired, true);
    const approval = run.json.approval;
    const wrong = await request(s.port, { method: "POST", path: `/api/approvals/${approval.id}/decide`, headers: h, body: { decision: "approved", displayedHash: "x".repeat(64) } });
    assert.equal(wrong.status, 409);
    const voice = await request(s.port, { method: "POST", path: "/api/voice/command", headers: h, body: { transcript: "Aprob deploy-ul acum" } });
    assert.equal(voice.json.kind, "refused");
    assert.equal(s.hub.approvals.get(approval.id).status, "pending");
    const disallowed = await request(s.port, { method: "POST", path: "/api/tools/process.run", headers: h, body: { projectId: project.id, args: { script: "deploy" } } });
    assert.equal(disallowed.status, 403);
    const traversal = await request(s.port, { method: "POST", path: "/api/tools/files.read", headers: h, body: { projectId: project.id, args: { path: "../../../Windows/win.ini" } } });
    assert.equal(traversal.status, 403);
    const privateRead = await request(s.port, { method: "POST", path: "/api/tools/files.read", headers: h, body: { projectId: project.id, args: { path: ".ifrim/private/x.json" } } });
    assert.equal(privateRead.status, 403);
    const blockedTool = await request(s.port, { method: "POST", path: "/api/tools/desktop.control", headers: h, body: { projectId: project.id } });
    assert.equal(blockedTool.status, 403);
    const external = await request(s.port, { method: "POST", path: "/api/tools/preview.check", headers: h, body: { projectId: project.id, args: { url: "http://169.254.169.254/latest" } } });
    assert.equal(external.status, 403, "no SSRF through preview checks");
  } finally { await s.stop(); }
});

test("T19 local voice commands: stop works locally and suspends the gate", async () => {
  const s = await startServer();
  try {
    const h = { "X-Hub-Token": s.token };
    const stop = await request(s.port, { method: "POST", path: "/api/voice/command", headers: h, body: { transcript: "Oprește!" } });
    assert.equal(stop.json.command, "stop_all");
    assert.equal(stop.json.result.gate, "suspended");
    const approvals = await request(s.port, { method: "POST", path: "/api/voice/command", headers: h, body: { transcript: "Arată aprobările" } });
    assert.equal(approvals.json.command, "show_approvals");
    const message = await request(s.port, { method: "POST", path: "/api/voice/command", headers: h, body: { transcript: "Fă un audit pentru site-ul clientului" } });
    assert.equal(message.json.kind, "message");
  } finally { await s.stop(); }
});
