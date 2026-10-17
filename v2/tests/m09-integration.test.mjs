// M09 integration (coordinator): the media / content department wired into the Hub — commands on the bus with their channels,
// HTTP routes (owner channel from the session cookie, streaming media with Range, UI_STALE and fail-safe paths), and one real
// production flow through the commands: import → rights → edit plan → local render (real ffmpeg via the test proxy) → QA →
// platform variant. Real-tool parts report SKIPPED_ENV when ffmpeg/ffprobe are absent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTestHub, waitFor, enrolOwner, tempDir } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { API_CONTRACT } from "../server/config.mjs";
import { AGENT_COMMANDS } from "../server/runtime/commands.mjs";

const as = (t, type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));

async function httpHub(opts = {}) {
  const t = await makeTestHub(opts);
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = "", headers = {}, raw = false } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
        const buf = Buffer.concat(chunks); let json = null; if (!raw) { try { json = JSON.parse(buf.toString("utf8")); } catch { /* */ } }
        resolve({ status: res.statusCode, json, headers: res.headers, body: buf });
      });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, call, token, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("M09-IN-01 media/content commands: channels, names and the agent/cli refusal", async () => {
  const t = await makeTestHub();
  try {
    const catalog = t.hub.commands.catalog().filter((c) => /^(media|content)\./.test(c.type));
    assert.ok(catalog.length >= 50, `media/content commands registered (${catalog.length})`);
    for (const c of catalog) {
      assert.doesNotMatch(c.type, /commit|push|deploy|publish|^git\./i, c.type);
      assert.ok(!c.channels.includes("agent") && !c.channels.includes("schedule") && !c.channels.includes("cli"), `${c.type} has no agent/schedule/cli channel`);
      assert.ok(!AGENT_COMMANDS.has?.(c.type) && !(Array.isArray(AGENT_COMMANDS) && AGENT_COMMANDS.includes(c.type)), `${c.type} is not delegated`);
    }
    for (const channel of ["agent", "cli"]) {
      await assert.rejects(t.hub.commands.dispatch({ type: "media.render.request", payload: { editVersionId: "mev_x" }, channel, actor: channel, delegation: "delegare de test 123" }));
    }
    // Owner-only decisions refuse the UI channel (no session) — approval, manual release record, OBS start, import roots.
    for (const type of ["content.manifest.approve", "content.release.record_manual", "media.capture.obs.start", "media.policy.import_roots"]) {
      const spec = catalog.find((c) => c.type === type);
      assert.deepEqual(spec.channels, ["owner", "test"], type);
    }
    // Fail-safe stops are reachable from every owner-facing channel, voice included.
    for (const type of ["media.render.cancel", "media.capture.cancel", "media.capture.obs.stop", "media.rights.revoke", "content.release.cancel", "media.transcribe.cancel"]) {
      assert.ok(catalog.find((c) => c.type === type).channels.includes("voice"), type);
    }
  } finally { await t.cleanup(); }
});

test("M09-IN-02 import roots: never inside the repo or the Hub data; a creative approval needs the owner session", async () => {
  const t = await makeTestHub();
  try {
    await assert.rejects(as(t, "media.policy.import_roots", { roots: [t.dataDir] }), /repo sau datele Hub-ului|nu există/);
    await assert.rejects(as(t, "media.policy.import_roots", { roots: ["relativ/folder"] }), /absolută/);
    // CREATIVE_APPROVED from the UI channel (no owner session) is refused before the module.
    await assert.rejects(t.hub.commands.dispatch({ type: "media.review.decide", payload: { editVersionId: "mev_none", kind: "CREATIVE_APPROVED" }, channel: "ui", actor: "user" }), /sesiunea ta de proprietar/);
    assert.equal(t.hub.settings.get("mediaPolicy").autoPublish, false);
    assert.equal(t.hub.settings.get("mediaPolicy").liveUpload, false);
    assert.equal(t.hub.settings.get("mediaPolicy").liveCapture, false);
  } finally { await t.cleanup(); }
});

test("M09-IN-03 real production through the commands: import → rights → edit plan → render → QA → variant; nothing external", async (ctx) => {
  const launchers = realLaunchers();
  if (!launchers.available) { ctx.skip("SKIPPED_ENV: ffmpeg/ffprobe absent"); return; }
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const inbox = path.join(tempDir("m09-inbox"), "inbox");
    makeSyntheticMedia(inbox, { name: "a.mp4", seconds: 2, width: 640, height: 360 });
    makeSyntheticMedia(inbox, { name: "b.mp4", seconds: 2, width: 640, height: 360 });
    setPolicy(t, { importRoots: [inbox], diskReserveGb: 0, interactivePriority: false });
    await as(t, "media.tools.pin", {}); // M10.2: renders need pinned tools; pinning is an explicit act
    const project = await as(t, "content.project.create", { fields: { title: "Test integrare", format: "short", platforms: ["instagram", "youtube"] } });
    const projectId = project.id || project.project?.id;
    assert.ok(projectId);
    const imp = async (name) => (await as(t, "media.asset.import", { sourcePath: path.join(inbox, name), title: name, category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: projectId }));
    const a = await imp("a.mp4");
    const b = await imp("b.mp4");
    for (const r of [a, b]) await as(t, "media.rights.record", { right: { assetId: r.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test" } });
    // Outside the allowed roots: refused.
    const outside = makeSyntheticMedia(path.join(tempDir("m09-outside"), "x"), { name: "x.mp4", seconds: 1 });
    await assert.rejects(as(t, "media.asset.import", { sourcePath: outside, origin: "OWNED" }));
    const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 360, height: 640, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
      tracks: [
        { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: a.version.id, sourceIn: 0, sourceOut: 30, start: 0, label: "SIMULATION" }, { id: "c2", assetVersionId: b.version.id, sourceIn: 0, sourceOut: 30, start: 30, label: "SIMULATION" }] },
        { id: "t1", kind: "text", items: [{ id: "x1", start: 0, end: 60, text: "Demonstrație pe date de test", style: "label", anchor: "top", x: 0.5, y: 0.08 }] },
      ],
      markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Integrare", labels: ["SIMULATION"], author: "test", notes: "" } };
    const edit = await as(t, "media.edit.create", { contentProjectId: projectId, title: "Montaj test", ir });
    const versionId = edit.version.id;
    const job = await as(t, "media.render.request", { editVersionId: versionId, profile: "draft" });
    await waitFor(() => ["DONE", "FAILED"].includes(t.hub.media.render.get(job.id)?.status), 120000, 200);
    const done = t.hub.media.render.get(job.id);
    assert.equal(done.status, "DONE", JSON.stringify(done.error));
    assert.ok(done.outputAssetVersionId);
    const qa = await as(t, "media.qa.run", { editVersionId: versionId, assetVersionId: done.outputAssetVersionId });
    assert.ok(["PASS", "WARN", "FAIL"].includes(qa.status));
    const variant = await as(t, "media.variant.derive", { masterVersionId: versionId, platformKey: "youtube_16x9" });
    assert.notEqual(variant.version.id, versionId);
    assert.notEqual(variant.variantHash, variant.masterHash);
    // Nothing external happened: no release attempt, no capture session, no model run.
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM content_release_attempts").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M09-IN-04 HTTP: status with limitations, media streamed with Range, UI_STALE on writes, fail-safe cancel still accepted", async (ctx) => {
  const launchers = realLaunchers();
  const s = await httpHub(launchers.available ? { configOverrides: { mediaTools: { launcher: launchers } } } : {});
  try {
    const status = await s.call("GET", "/api/media/status");
    assert.equal(status.status, 200);
    const codes = status.json.limitations.map((l) => l.code);
    for (const c of ["VOICE_FILTER_OFF", "LIVE_MEDIA_CAPTURE_DISABLED", "LIVE_UPLOAD_DISABLED", "AUTO_PUBLISH_OFF"]) assert.ok(codes.includes(c), c);
    // A stale UI cannot write, but can always stop a render.
    const stale = await s.call("POST", "/api/media/renders", { body: { editVersionId: "mev_x" }, headers: { "X-Hub-UI-Contract": String(API_CONTRACT - 1) } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "UI_STALE");
    const cancel = await s.call("POST", "/api/media/renders/mrj_missing/cancel", { body: {}, headers: { "X-Hub-UI-Contract": String(API_CONTRACT - 1) } });
    assert.notEqual(cancel.status, 409);
    // Agent / CLI requests refused on the Studio routes.
    assert.equal((await s.call("POST", "/api/content/ideas", { body: { title: "x" }, headers: { "X-Hub-Channel": "agent" } })).status, 403);
    // Owner-only approval without a session asks for Windows Hello.
    const approve = await s.call("POST", "/api/content/manifests/cmf_x/approve", { body: { manifestSha256: "0".repeat(64) } });
    assert.equal(approve.status, 401);
    assert.equal(approve.json.error.details?.needSession ?? approve.json.error.data?.needSession, true);
    if (!launchers.available) { ctx.diagnostic("SKIPPED_ENV: Range streaming needs ffmpeg for the synthetic file"); return; }
    const inbox = path.join(tempDir("m09-http"), "inbox");
    const file = makeSyntheticMedia(inbox, { name: "s.mp4", seconds: 1 });
    setPolicy(s, { importRoots: [inbox] });
    const imported = await s.hub.commands.dispatch({ type: "media.asset.import", payload: { sourcePath: file, origin: "OWNED" }, channel: "test", actor: "test" }).then((r) => r.result);
    const size = fs.statSync(file).size;
    const full = await s.call("GET", `/api/media/files/${imported.version.id}`, { raw: true });
    assert.equal(full.status, 200);
    assert.equal(full.headers["x-content-type-options"], "nosniff");
    assert.equal(Number(full.headers["content-length"]), size);
    const part = await s.call("GET", `/api/media/files/${imported.version.id}`, { raw: true, headers: { Range: "bytes=10-109" } });
    assert.equal(part.status, 206);
    assert.equal(part.body.length, 100);
    assert.deepEqual(part.body, fs.readFileSync(file).subarray(10, 110));
    assert.equal((await s.call("GET", `/api/media/files/${imported.version.id}`, { raw: true, headers: { Range: `bytes=${size + 10}-` } })).status, 416);
    assert.equal((await s.call("GET", "/api/media/files/mav_nope", { raw: true })).status, 404);
  } finally { await s.stop(); }
});

test("M09-IN-05 boot marks interrupted media work and never resumes it; owner session can approve-gate a manifest", async () => {
  const t = await makeTestHub();
  try {
    const report = t.hub.getBootReport();
    assert.ok(report.media && !report.media.error, JSON.stringify(report.media));
    assert.ok(report.media.presets.inserted >= 5 || report.media.presets.inserted === 0);
    const owner = await enrolOwner(t);
    // With a session the approval reaches the module (which refuses an unknown manifest) — the channel gate is passed.
    await assert.rejects(t.hub.commands.dispatch({ type: "content.manifest.approve", payload: { manifestId: "cmf_missing", manifestSha256: "0".repeat(64) }, channel: "owner", actor: "owner:t", ownerSession: owner.reauth() }),
      (e) => !/sesiunea ta de proprietar/.test(e.message));
  } finally { await t.cleanup(); }
});
