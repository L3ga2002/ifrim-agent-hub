// M10.2 U04: GET /api/media/tools never mutates; pinning ffmpeg/ffprobe is an explicit act (media.tools.pin, the MEDIA_A ceremony
// or a step of a confirmed plan); a changed binary stays CHANGED until media.tools.acknowledge; a render refuses an unpinned or
// changed toolset before the job spawns anything.
// The tools here are `node -e` launchers whose identity file (IFRIM_REAL_TOOL) is a temp file: changing its bytes is "a different
// binary"; every `-version` spawn appends a line to a log so the 60 s inspection cache can be counted. No model, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { makeTestHub, enrolOwner, tempDir, waitFor } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { classifyRenderError, RENDER_FAILURE_CODES } from "../server/media/render.mjs";
import { MEDIA_TOOL_STATES } from "../server/media/tools.mjs";

/** Two fake tools: `node -e <script> -- <argv>`; identity = a temp file per tool; each spawn is logged. */
function scriptedLaunchers(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "spawns.log");
  const ids = { ffmpeg: path.join(dir, "ffmpeg-identity.bin"), ffprobe: path.join(dir, "ffprobe-identity.bin") };
  fs.writeFileSync(ids.ffmpeg, "ffmpeg build A");
  fs.writeFileSync(ids.ffprobe, "ffprobe build A");
  const script = (name) => `require("fs").appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${name}\n`)}); process.stdout.write(${JSON.stringify(`${name} version 9.9-test Copyright (c) test\n`)});`;
  const launcher = (name) => ({ executable: process.execPath, prefixArgs: ["-e", script(name), "--"], env: { IFRIM_REAL_TOOL: ids[name] } });
  return {
    launchers: { available: true, ffmpeg: launcher("ffmpeg"), ffprobe: launcher("ffprobe"), paths: ids },
    ids, spawns: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0),
  };
}

async function httpHub(opts = {}) {
  const t = await makeTestHub(opts);
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
        let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, call, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

const toolEvents = (hub) => hub.db.prepare("SELECT * FROM events WHERE type LIKE 'media.tool.%' ORDER BY seq").all();
const pinSettingEvents = (hub) => hub.db.prepare("SELECT * FROM events WHERE type = 'settings.changed' AND scope_id = 'mediaToolPins'").all();
const jobs = (hub) => hub.db.prepare("SELECT COUNT(*) AS n FROM media_render_jobs").get().n;
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);
const rejectsCode = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });

test("U04-01 GET /api/media/tools: same shape (tools + editors, plus pins), zero writes, zero events; a second GET within 60 s spawns nothing", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("u04-get"), "tools"));
  let nowMs = Date.parse("2026-10-04T12:00:00Z");
  const s = await httpHub({ clock: () => new Date(nowMs), configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    assert.equal(fx.spawns(), 0, "boot inspects nothing");
    const settingsBefore = pinSettingEvents(s.hub).length;
    const first = await s.call("GET", "/api/media/tools");
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual(Object.keys(first.json).sort(), ["editors", "pins", "tools"]);
    assert.deepEqual(first.json.tools.states, { ffmpeg: "UNPINNED", ffprobe: "UNPINNED" });
    assert.equal(first.json.tools.ok, true);
    assert.equal(first.json.tools.usable, false);
    assert.deepEqual(first.json.tools.problems, ["tools_not_pinned"]);
    assert.equal(first.json.tools.ffmpeg.version, "9.9-test");
    assert.match(first.json.tools.ffmpeg.sha256, /^[0-9a-f]{64}$/);
    assert.equal(first.json.tools.ffmpeg.state, "UNPINNED");
    assert.deepEqual(first.json.pins, { ffmpeg: null, ffprobe: null });
    assert.equal(first.json.editors.ffmpeg.status, "AVAILABLE");
    assert.match(first.json.editors.ffmpeg.note, /fixează/);
    assert.ok(MEDIA_TOOL_STATES.includes(first.json.tools.ffprobe.state));
    assert.equal(fx.spawns(), 2, "one -version per tool (the editors' registry reuses the inspection)");
    const second = await s.call("GET", "/api/media/tools");
    assert.equal(second.status, 200);
    assert.deepEqual(second.json.tools.states, first.json.tools.states);
    assert.equal(fx.spawns(), 2, "a second GET within 60 s spawns no process");
    assert.equal(pinSettingEvents(s.hub).length, settingsBefore, "no settings.changed for mediaToolPins");
    assert.equal(toolEvents(s.hub).length, 0, "no media.tool.* event");
    assert.deepEqual(s.hub.settings.get("mediaToolPins"), {});
    // After the cache window the version is read again (still without any write).
    nowMs += 61 * 1000;
    await s.call("GET", "/api/media/tools");
    assert.equal(fx.spawns(), 4);
    // A changed file is re-identified at once (size/mtime), even inside the window.
    fs.writeFileSync(fx.ids.ffprobe, "ffprobe build B (longer)");
    await s.call("GET", "/api/media/tools");
    assert.equal(fx.spawns(), 5, "only the changed tool's version is read again");
    assert.equal(toolEvents(s.hub).length, 0);
    assert.deepEqual(s.hub.settings.get("mediaToolPins"), {});
    // The Studio status reflects the last inspection (in memory), still read-only.
    assert.equal((await s.call("GET", "/api/media/status")).json.tools.states.ffmpeg, "UNPINNED");
  } finally { await s.stop(); }
});

test("U04-02 media.tools.pin writes exactly one pin per tool; a changed binary is CHANGED on GET without writing; media.tools.acknowledge (owner) clears it; renders refused meanwhile", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("u04-pin"), "tools"));
  const s = await httpHub({ configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    // From the owner's interface (no session: the "ui" channel); the actor is recorded on the pin and on each event.
    const r = await s.hub.commands.dispatch({ type: "media.tools.pin", payload: {}, channel: "ui", actor: "user" }).then((x) => x.result);
    assert.deepEqual(r.pinned, ["ffmpeg", "ffprobe"]);
    assert.deepEqual(r.states, { ffmpeg: "PINNED", ffprobe: "PINNED" });
    assert.equal(pinSettingEvents(s.hub).length, 1, "one settings write for both pins");
    const pinned = toolEvents(s.hub);
    assert.deepEqual(pinned.map((e) => [e.type, e.scope_id, e.source]), [["media.tool.pinned", "ffmpeg", "user"], ["media.tool.pinned", "ffprobe", "user"]]);
    assert.equal(JSON.parse(pinned[0].payload_json).actor, "user");
    assert.equal(JSON.parse(pinned[0].payload_json).version, "9.9-test");
    const pins = s.hub.settings.get("mediaToolPins");
    assert.equal(pins.ffmpeg.pinnedBy, "user");
    assert.equal(pins.ffmpeg.version, "9.9-test");
    // Pinning again writes nothing.
    const again = await dispatch(s.hub, "media.tools.pin", {});
    assert.deepEqual(again.pinned, []); assert.deepEqual(again.unchanged, ["ffmpeg", "ffprobe"]);
    assert.equal(toolEvents(s.hub).length, 2);
    assert.equal(pinSettingEvents(s.hub).length, 1);
    const ok = await s.call("GET", "/api/media/tools");
    assert.deepEqual(ok.json.tools.states, { ffmpeg: "PINNED", ffprobe: "PINNED" });
    assert.equal(ok.json.pins.ffmpeg.sha256, pins.ffmpeg.sha256);
    assert.equal(ok.json.pins.ffmpeg.pinnedBy, "user");

    // A different binary: GET reports CHANGED and writes nothing.
    fs.writeFileSync(fx.ids.ffmpeg, "ffmpeg build B");
    const changed = await s.call("GET", "/api/media/tools");
    assert.equal(changed.json.tools.states.ffmpeg, "CHANGED");
    assert.equal(changed.json.tools.ffmpeg.changeRecorded, false);
    assert.deepEqual(changed.json.tools.problems, ["tool_changed"]);
    assert.deepEqual(s.hub.settings.get("mediaToolPins"), pins, "the pin is untouched by a read");
    assert.equal(toolEvents(s.hub).length, 2);
    // A render is refused at the request (no job row) while the change is unacknowledged.
    await rejectsCode(dispatch(s.hub, "media.render.request", { editVersionId: "mev_missing", profile: "draft" }), "TOOL_CHANGED");
    await rejectsCode(s.hub.media.tools.resolve(), "TOOL_CHANGED");
    assert.equal(jobs(s.hub), 0);
    // Pinning does not acknowledge: it records the change (previous kept) and the refusal stays.
    const rec = await dispatch(s.hub, "media.tools.pin", {});
    assert.deepEqual(rec.changed, ["ffmpeg"]);
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.previous.sha256, pins.ffmpeg.sha256);
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.acknowledged, false);
    await rejectsCode(dispatch(s.hub, "media.render.request", { editVersionId: "mev_missing", profile: "draft" }), "TOOL_CHANGED");

    // Acknowledge is the owner's: refused on the UI, voice, agent and automation channels.
    for (const channel of ["ui", "voice", "agent", "automation"]) {
      await assert.rejects(s.hub.commands.dispatch({ type: "media.tools.acknowledge", payload: { tool: "ffmpeg" }, channel, actor: channel, delegation: "delegare de test 123" }));
    }
    const owner = await enrolOwner(s);
    // The identity the owner was shown must still be the one on disk.
    await rejectsCode(dispatch(s.hub, "media.tools.acknowledge", { tool: "ffmpeg", sha256: "0".repeat(64) }, { channel: "owner", ownerSession: owner.session }), "TOOL_CHANGED_AGAIN");
    const ack = await dispatch(s.hub, "media.tools.acknowledge", { tool: "ffmpeg", sha256: changed.json.tools.ffmpeg.sha256 }, { channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session });
    assert.equal(ack.acknowledged, true);
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.acknowledgedBy, `owner:${owner.session.id}`);
    assert.deepEqual((await s.call("GET", "/api/media/tools")).json.tools.states, { ffmpeg: "PINNED", ffprobe: "PINNED" });
    assert.equal(toolEvents(s.hub).filter((e) => e.type === "media.tool.acknowledged").length, 1);
    assert.equal((await dispatch(s.hub, "media.tools.acknowledge", { tool: "ffmpeg" }, { channel: "owner", ownerSession: owner.session })).acknowledged, false, "nothing left to acknowledge");
    // The gate now passes: the request reaches the edit lookup.
    await rejectsCode(dispatch(s.hub, "media.render.request", { editVersionId: "mev_missing", profile: "draft" }), "EDIT_VERSION_MISSING");

    // A change seen only by an inspection (never pinned) is recorded and acknowledged together by the owner.
    fs.writeFileSync(fx.ids.ffprobe, "ffprobe build C");
    assert.equal((await s.call("GET", "/api/media/tools")).json.tools.states.ffprobe, "CHANGED");
    const before = toolEvents(s.hub).length;
    const ack2 = await dispatch(s.hub, "media.tools.acknowledge", { tool: "ffprobe" }, { channel: "owner", ownerSession: owner.session });
    assert.equal(ack2.acknowledged, true);
    assert.deepEqual(toolEvents(s.hub).slice(before).map((e) => e.type), ["media.tool.changed", "media.tool.acknowledged"]);
    assert.equal(s.hub.settings.get("mediaToolPins").ffprobe.previous.sha256, pins.ffprobe.sha256);
    assert.equal(s.hub.media.tools.lastResolved().usable, true);

    // HTTP: pin from the Studio (UI channel) and acknowledge without a session → asks for Windows Hello.
    const noSession = await s.call("POST", "/api/media/tools/ffmpeg/acknowledge", { body: {} });
    assert.equal(noSession.status, 401);
    const httpPin = await s.call("POST", "/api/media/tools/pin", { body: {} });
    assert.equal(httpPin.status, 200, JSON.stringify(httpPin.json));
    assert.deepEqual(httpPin.json.pinned, []);
  } finally { await s.stop(); }
});

test("U04-03 a render with UNPINNED tools is refused before anything spawns (TOOLS_NOT_PINNED); the run re-verifies; failure codes are kept", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("u04-unpinned"), "tools"));
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    await rejectsCode(dispatch(t.hub, "media.render.request", { editVersionId: "mev_missing", profile: "final" }), "TOOLS_NOT_PINNED");
    await rejectsCode(dispatch(t.hub, "media.render.retry", { jobId: "mrj_missing" }), "RENDER_MISSING"); // retry checks its job first
    assert.equal(jobs(t.hub), 0);
    assert.equal(fx.spawns(), 0, "the request gate spawns nothing");
    // The run path (resolve) refuses too: only the two `-version` reads ran, never a job.
    await rejectsCode(t.hub.media.tools.resolve(), "TOOLS_NOT_PINNED");
    assert.equal(fx.spawns(), 2);
    assert.equal(toolEvents(t.hub).length, 0, "the refusal pins nothing");
    for (const code of ["TOOLS_NOT_PINNED", "TOOL_CHANGED"]) {
      assert.ok(RENDER_FAILURE_CODES.includes(code));
      assert.equal(classifyRenderError({ code, message: "x" }).code, code);
    }
  } finally { await t.cleanup(); }
});

test("U04-04 the MEDIA_A ceremony pins (explicit owner act, actor recorded); the automation channel pins only as a running step of a confirmed plan", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("u04-media-a"), "tools"));
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    // Catalog: who may pin / acknowledge.
    const spec = (type) => t.hub.commands.catalog().find((c) => c.type === type);
    assert.deepEqual([...spec("media.tools.pin").channels].sort(), ["automation", "owner", "test", "ui"]);
    assert.deepEqual([...spec("media.tools.acknowledge").channels].sort(), ["owner", "test"]);
    // Automation without a running plan step: refused, nothing written.
    for (const payload of [{}, { planId: "opl_missing" }]) {
      await rejectsCode(t.hub.commands.dispatch({ type: "media.tools.pin", payload, channel: "automation", actor: "automation" }), "PIN_NOT_IN_PLAN");
    }
    assert.deepEqual(t.hub.settings.get("mediaToolPins"), {});
    // Voice cannot pin.
    await assert.rejects(t.hub.commands.dispatch({ type: "media.tools.pin", payload: {}, channel: "voice", actor: "lega" }));
    assert.deepEqual(t.hub.settings.get("mediaToolPins"), {});
    // Presenting MEDIA_A pins, with the owner as actor.
    await dispatch(t.hub, "package.present", { kind: "MEDIA_A" }, { actor: "owner:sess_test" });
    const pins = t.hub.settings.get("mediaToolPins");
    assert.equal(pins.ffmpeg.pinnedBy, "owner:sess_test");
    assert.equal(pins.ffprobe.reason, "pachetul MEDIA_A");
    assert.deepEqual(toolEvents(t.hub).map((e) => [e.type, e.source]), [["media.tool.pinned", "owner:sess_test"], ["media.tool.pinned", "owner:sess_test"]]);
    const inv = t.hub.packages.inventoryMediaA();
    assert.ok(inv.tools.every((x) => x.pinned && x.verifiedSinceBoot && !x.changed), JSON.stringify(inv.tools));
  } finally { await t.cleanup(); }
});

test("U04-05 real tools: unpinned → refused; pinned → renders; a pin replaced underneath is caught by the run before any segment (TOOL_CHANGED)", async (ctx) => {
  const launchers = realLaunchers();
  if (!launchers.available) { ctx.skip("SKIPPED_ENV: ffmpeg/ffprobe absent"); return; }
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const inbox = path.join(tempDir("u04-real"), "inbox");
    makeSyntheticMedia(inbox, { name: "a.mp4", seconds: 1, width: 320, height: 180 });
    t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), importRoots: [inbox], diskReserveGb: 0, interactivePriority: false }, "test"));
    const a = await dispatch(t.hub, "media.asset.import", { sourcePath: path.join(inbox, "a.mp4"), origin: "OWNED", category: "screen_recording", captureLabel: "SIMULATION" });
    const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 320, height: 180, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
      tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: a.version.id, sourceIn: 0, sourceOut: 15, start: 0, label: "SIMULATION" }] }],
      markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "U04", labels: ["SIMULATION"], author: "test", notes: "" } };
    const edit = await dispatch(t.hub, "media.edit.create", { title: "U04", ir });
    await rejectsCode(dispatch(t.hub, "media.render.request", { editVersionId: edit.version.id, profile: "draft" }), "TOOLS_NOT_PINNED");
    assert.equal(jobs(t.hub), 0);
    await dispatch(t.hub, "media.tools.pin", {});
    const job = await dispatch(t.hub, "media.render.request", { editVersionId: edit.version.id, profile: "draft" });
    await waitFor(() => ["DONE", "FAILED"].includes(t.hub.media.render.get(job.id)?.status), 120000, 200);
    assert.equal(t.hub.media.render.get(job.id).status, "DONE", JSON.stringify(t.hub.media.render.get(job.id).error));
    // A pin that no longer matches the binary (as if another ffmpeg had been pinned): the request gate cannot see it without an
    // inspection, so the run catches it before compiling or spawning a segment.
    const pins = t.hub.settings.get("mediaToolPins");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaToolPins", { ...pins, ffmpeg: { ...pins.ffmpeg, sha256: "0".repeat(64) } }, "test"));
    const job2 = await dispatch(t.hub, "media.render.request", { editVersionId: edit.version.id, profile: "final" });
    await waitFor(() => ["DONE", "FAILED"].includes(t.hub.media.render.get(job2.id)?.status), 60000, 100);
    const failed = t.hub.media.render.get(job2.id);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.error.code, "TOOL_CHANGED");
    assert.deepEqual(failed.segments, [], "no segment ran");
    assert.equal(toolEvents(t.hub).filter((e) => e.type === "media.tool.changed").length, 0, "the run records nothing either");
  } finally { await t.cleanup(); }
});
