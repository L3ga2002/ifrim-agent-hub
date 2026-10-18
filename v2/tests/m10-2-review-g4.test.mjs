// M10.2 review, group G4 (Studio / tools): regressions for the confirmed findings
//  #27 a changed / unpinned ffmpeg had no UI path: the Studio → Unelte panel logic (pure), the blocker / mapping pointing at it
//      (#/studio?panel=tools) and the HTTP pin / acknowledge flow with exactly the identity the panel displayed;
//  #28 variant, correction and capture plans list the media.tools.pin step first (capture $pas refs shifted) or return a blocker for a
//      changed toolset without proposing; a confirmed variant / correction plan with unpinned tools reaches DONE;
//  #29 studio_create on a NAMED clip: never replaced by the last target / the only renderable clip; 2+ matches → one question among
//      them; a named clip with two edit plans → the honest reason; a purpose with 2+ matches asks among them;
//  #30 the pin compares the shown identity (sha256 + shared libraries + version) inside the pin transaction; acknowledge too.
// No model, no live Hub, no network. Real ffmpeg parts report SKIPPED_ENV when the tools are absent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { makeTestHub, enrolOwner, tempDir, waitFor, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { SESSION_COOKIE } from "../server/owner/trust.mjs";
import { explain } from "../server/owner/blockers.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { createExecutors } from "../server/ops/executors.mjs";
import { blockerAction, mediaToolsPanel, studioToolsPanelOpen, STUDIO_TOOLS_HREF } from "../web/src/lib/uiLogic.js";

const launchers = realLaunchers();
const needTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent";
const rejectsCode = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const toolEvents = (hub) => hub.db.prepare("SELECT * FROM events WHERE type LIKE 'media.tool.%' ORDER BY seq").all();

/** Fake tools (`node -e`), identity = a temp file per tool; an optional shared-library DLL next to them (libsSha256 non-null). */
function scriptedLaunchers(dir, { sharedLib = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const ids = { ffmpeg: path.join(dir, "ffmpeg-identity.bin"), ffprobe: path.join(dir, "ffprobe-identity.bin") };
  fs.writeFileSync(ids.ffmpeg, "ffmpeg build A");
  fs.writeFileSync(ids.ffprobe, "ffprobe build A");
  const dll = path.join(dir, "avcodec-61.dll");
  if (sharedLib) fs.writeFileSync(dll, "avcodec v1");
  const script = (name) => `process.stdout.write(${JSON.stringify(`${name} version 9.9-test Copyright (c) test\n`)});`;
  const launcher = (name) => ({ executable: process.execPath, prefixArgs: ["-e", script(name), "--"], env: { IFRIM_REAL_TOOL: ids[name] } });
  return { launchers: { available: true, ffmpeg: launcher("ffmpeg"), ffprobe: launcher("ffprobe"), paths: ids }, ids, dll };
}

async function httpHub(opts = {}) {
  const t = await makeTestHub(opts);
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = null } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
        let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, call, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

// ---------------------------------------------------------------- #27

test("G4-27a the Studio → Unelte panel logic: UNPINNED → Fixează with the shown identity; CHANGED → Confirmă schimbarea (owner) with sha256 + libs + version; MISSING → nothing", () => {
  const sha = (c) => c.repeat(64);
  const unpinned = mediaToolsPanel({ tools: { usable: false, states: { ffmpeg: "UNPINNED", ffprobe: "UNPINNED" }, ffmpeg: { version: "8.1", sha256: sha("a"), libsSha256: sha("b"), state: "UNPINNED", path: "C:/x/ffmpeg.exe" },
    ffprobe: { version: "8.1", sha256: sha("c"), libsSha256: null, state: "UNPINNED" } }, pins: { ffmpeg: null, ffprobe: null } });
  assert.equal(unpinned.pin.type, "pin");
  assert.equal(unpinned.pin.label, "Fixează");
  assert.equal(unpinned.pin.path, "/api/media/tools/pin");
  assert.equal(unpinned.pin.owner, false, "pinning is allowed from the UI channel");
  assert.deepEqual(unpinned.pin.body.expect, { ffmpeg: { sha256: sha("a"), libsSha256: sha("b"), version: "8.1" }, ffprobe: { sha256: sha("c"), libsSha256: null, version: "8.1" } });
  assert.ok(unpinned.rows.every((r) => r.action === null && r.label === "nefixat"));

  const changed = mediaToolsPanel({ tools: { usable: false, states: { ffmpeg: "CHANGED", ffprobe: "PINNED" }, ffmpeg: { version: "8.2", sha256: sha("d"), libsSha256: null, state: "CHANGED" },
    ffprobe: { version: "8.1", sha256: sha("c"), libsSha256: null, state: "PINNED" } }, pins: { ffmpeg: { sha256: sha("a"), version: "8.1", previous: null }, ffprobe: { sha256: sha("c") } } });
  assert.equal(changed.pin, null, "nothing unpinned");
  const ack = changed.rows.find((r) => r.tool === "ffmpeg").action;
  assert.deepEqual(ack, { type: "acknowledge", label: "Confirmă schimbarea", owner: true, path: "/api/media/tools/ffmpeg/acknowledge", body: { sha256: sha("d"), libsSha256: "none", version: "8.2" } });
  assert.equal(changed.rows.find((r) => r.tool === "ffprobe").action, null);

  const missing = mediaToolsPanel({ tools: { usable: false, states: { ffmpeg: "MISSING", ffprobe: "UNPINNED" }, ffmpeg: null, ffprobe: { version: "8.1", sha256: sha("c"), state: "UNPINNED" } }, pins: {} });
  assert.equal(missing.missing, true);
  assert.equal(missing.pin, null, "a pin with a missing tool would be refused: not offered");
  assert.equal(mediaToolsPanel({ tools: { usable: true, states: { ffmpeg: "PINNED", ffprobe: "PINNED" }, ffmpeg: { sha256: sha("a") }, ffprobe: { sha256: sha("c") } } }).usable, true);

  // When the panel shows itself.
  assert.equal(studioToolsPanelOpen({ panel: "tools" }, null), true);
  assert.equal(studioToolsPanelOpen({}, { problems: ["tool_changed"] }), true);
  assert.equal(studioToolsPanelOpen({}, { problems: ["tools_not_pinned"] }), true);
  assert.equal(studioToolsPanelOpen({}, { problems: [] }), false);
  assert.equal(studioToolsPanelOpen({}, null), false);
});

test("G4-27b the MEDIA_TOOLS_CHANGED blocker and the UI mapping lead to the Unelte panel (#/studio?panel=tools), not the bare Studio", () => {
  assert.equal(STUDIO_TOOLS_HREF, "#/studio?panel=tools");
  const ex = explain({ intent: "studio", media: { assets: 1, editProjects: 1, tools: "CHANGED" } });
  assert.equal(ex.cause, "MEDIA_TOOLS_CHANGED");
  const option = ex.options.find((o) => o.code === "MEDIA_TOOLS_CHANGED");
  assert.equal(option.where, "#/studio?panel=tools");
  assert.match(option.label, /Studio → Unelte/);
  assert.deepEqual(blockerAction(option), { type: "link", href: "#/studio?panel=tools" });
  // A preserved request keeps only kind/code/label: the mapping by code must lead there too.
  assert.deepEqual(blockerAction({ kind: option.kind, code: option.code, label: option.label }), { type: "link", href: "#/studio?panel=tools" });
});

test("G4-27c HTTP: the panel's pin and acknowledge bodies work end to end; acknowledge needs the owner session (needSession) and refuses a second change", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("g4-27-http"), "tools"), { sharedLib: true });
  const s = await httpHub({ configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    const first = mediaToolsPanel((await s.call("GET", "/api/media/tools")).json);
    assert.ok(first.pin, JSON.stringify(first));
    assert.match(first.pin.body.expect.ffmpeg.libsSha256, /^[0-9a-f]{64}$/, "the shared libraries are part of the shown identity");
    const pinned = await s.call("POST", first.pin.path, { body: first.pin.body });
    assert.equal(pinned.status, 200, JSON.stringify(pinned.json));
    assert.deepEqual(pinned.json.pinned, ["ffmpeg", "ffprobe"]);
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.libsSha256, first.pin.body.expect.ffmpeg.libsSha256);

    // ffmpeg is updated: the panel offers „Confirmă schimbarea” for exactly the new identity.
    fs.writeFileSync(fx.ids.ffmpeg, "ffmpeg build B");
    const changed = mediaToolsPanel((await s.call("GET", "/api/media/tools")).json);
    const ack = changed.rows.find((r) => r.tool === "ffmpeg").action;
    assert.equal(ack?.type, "acknowledge");
    // No owner session → the route asks for Windows Hello (needSession), nothing acknowledged.
    const noSession = await s.call("POST", ack.path, { body: ack.body });
    assert.equal(noSession.status, 401);
    assert.equal(JSON.stringify(noSession.json).includes("needSession"), true, JSON.stringify(noSession.json));
    const owner = await enrolOwner(s);
    // The DLL set is swapped after the panel was drawn → refused (the libs are compared), nothing written.
    fs.writeFileSync(fx.dll, "avcodec v2 (swapped)");
    const swapped = await s.call("POST", ack.path, { body: ack.body, cookie: owner.token });
    assert.equal(swapped.status, 409, JSON.stringify(swapped.json));
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.acknowledged, undefined);
    // Drawn again → acknowledged with the owner session; renders are no longer refused for the change.
    const again = mediaToolsPanel((await s.call("GET", "/api/media/tools")).json);
    const ack2 = again.rows.find((r) => r.tool === "ffmpeg").action;
    const ok = await s.call("POST", ack2.path, { body: ack2.body, cookie: owner.token });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.acknowledged, true);
    assert.equal(s.hub.settings.get("mediaToolPins").ffmpeg.acknowledgedBy, `owner:${owner.session.id}`);
    // The swapped DLL also changed ffprobe's library set (same folder): the panel shows it; acknowledged the same way.
    const after = mediaToolsPanel((await s.call("GET", "/api/media/tools")).json);
    for (const r of after.rows.filter((x) => x.action)) assert.equal((await s.call("POST", r.action.path, { body: r.action.body, cookie: owner.token })).status, 200);
    assert.equal(mediaToolsPanel((await s.call("GET", "/api/media/tools")).json).usable, true);
  } finally { await s.stop(); }
});

// ---------------------------------------------------------------- #30

test("G4-30 the pin records ONLY the identity shown: a swapped DLL set or a different version is refused inside the pin (nothing written); the executor no longer pre-checks sha256 only", async () => {
  const fx = scriptedLaunchers(path.join(tempDir("g4-30"), "tools"), { sharedLib: true });
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: fx.launchers } } });
  try {
    const seen = await t.hub.media.tools.inspect();
    const shown = Object.fromEntries(["ffmpeg", "ffprobe"].map((k) => [k, { version: seen[k].version, sha256: seen[k].sha256, libsSha256: seen[k].libsSha256 }]));
    assert.ok(shown.ffmpeg.libsSha256);
    // The plan step's card: the libs are in the shown identity (describe normalisation keeps them).
    const ex = createExecutors({ media: t.hub.media, settings: t.hub.settings });
    const d = ex["media.tools.pin"].describe({ expect: shown });
    assert.equal(d.params.expect.ffmpeg.libsSha256, shown.ffmpeg.libsSha256);
    assert.match(d.title, /biblioteci/);
    // DLLs replaced between the card and the run: same executables (sha256 equal), different libraries → refused, nothing pinned.
    fs.writeFileSync(fx.dll, "avcodec v2 (swapped)");
    await rejectsCode(ex["media.tools.pin"].run({ params: d.params, planId: "opl_g4", authorize: () => {} }), "TOOL_CHANGED");
    assert.deepEqual(t.hub.settings.get("mediaToolPins"), {}, "nothing written");
    assert.equal(toolEvents(t.hub).length, 0);
    // A different version than the one shown → refused too.
    const now = await t.hub.media.tools.inspect();
    const wrongVersion = Object.fromEntries(["ffmpeg", "ffprobe"].map((k) => [k, { version: "1.0-other", sha256: now[k].sha256, libsSha256: now[k].libsSha256 }]));
    await rejectsCode(t.hub.media.tools.pin({ actor: "owner:test", expect: wrongVersion }), "TOOL_CHANGED");
    // A tool that is about to be pinned but was not shown → refused.
    await rejectsCode(t.hub.media.tools.pin({ actor: "owner:test", expect: { ffmpeg: { sha256: now.ffmpeg.sha256, libsSha256: now.ffmpeg.libsSha256, version: now.ffmpeg.version } } }), "TOOL_CHANGED");
    // A malformed expectation is refused, never compared as "nothing".
    await rejectsCode(t.hub.media.tools.pin({ actor: "owner:test", expect: { ffmpeg: { sha256: "nu" } } }), "MEDIA_EXPECT_INVALID");
    assert.deepEqual(t.hub.settings.get("mediaToolPins"), {});
    // The identity on disk now, shown → pinned exactly that (libs included); the command path carries `expect` too.
    const right = Object.fromEntries(["ffmpeg", "ffprobe"].map((k) => [k, { version: now[k].version, sha256: now[k].sha256, libsSha256: now[k].libsSha256 }]));
    const r = await t.hub.commands.dispatch({ type: "media.tools.pin", payload: { expect: right }, channel: "ui", actor: "user" }).then((x) => x.result);
    assert.deepEqual(r.pinned, ["ffmpeg", "ffprobe"]);
    assert.equal(t.hub.settings.get("mediaToolPins").ffmpeg.libsSha256, right.ffmpeg.libsSha256);
    // Acknowledge compares the libraries as well: a change acknowledged with the wrong library set is refused.
    fs.writeFileSync(fx.ids.ffmpeg, "ffmpeg build B");
    const c = await t.hub.media.tools.inspect();
    await rejectsCode(t.hub.media.tools.acknowledgeChange("ffmpeg", "owner:test", { sha256: c.ffmpeg.sha256, libsSha256: "none" }), "TOOL_CHANGED_AGAIN");
    await rejectsCode(t.hub.media.tools.acknowledgeChange("ffmpeg", "owner:test", { sha256: c.ffmpeg.sha256, libsSha256: c.ffmpeg.libsSha256, version: "0.1" }), "TOOL_CHANGED_AGAIN");
    assert.equal((await t.hub.media.tools.acknowledgeChange("ffmpeg", "owner:test", { sha256: c.ffmpeg.sha256, libsSha256: c.ffmpeg.libsSha256, version: c.ffmpeg.version })).acknowledged, true);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #28 / #29 (real tools)

const as = (t, owner, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ownerSession: owner?.session || null }).then((r) => r.result);
const intent = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const irOf = (assetVersionId, frames = 60) => ({
  irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 640, height: 360, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
  tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION" }] },
    { id: "t1", kind: "text", items: [{ id: "lbl", start: 0, end: frames, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
    { id: "t2", kind: "text", items: [{ id: "txt", start: 0, end: frames, text: "Un singur plan, o confirmare", style: "hook", anchor: "bottom", x: 0.5, y: 0.8 }] },
  ],
  markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Clip test", labels: ["SIMULATION"], author: "test", notes: "" } });
async function clipProject(t, owner, root, title, { edits = 1 } = {}) {
  const inbox = path.join(root, "inbox", title.replace(/[^a-z0-9]+/gi, "-"));
  makeSyntheticMedia(inbox, { name: "demo.mp4", seconds: 2, width: 640, height: 360 });
  const project = await as(t, owner, "content.project.create", { fields: { title, format: "short", platforms: ["linkedin"] } });
  const pid = project.id || project.project?.id;
  const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(inbox, "demo.mp4"), title: "Captură demo", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
  await as(t, owner, "media.rights.record", { right: { assetId: a.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test" } });
  let edit = null;
  for (let i = 0; i < edits; i += 1) edit = await as(t, owner, "media.edit.create", { contentProjectId: pid, title: `Montaj ${i + 1}`, ir: irOf(a.version.id) });
  return { pid, asset: a, edit };
}
const studioHub = () => makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
const confirmAndRun = async (t, owner, card) => {
  const fresh = owner.reauth();
  const yes = await intent(t, { ...owner, session: fresh }, { text: "Da", presented: { planId: card.id, nonce: card.nonce, hash: card.hash } });
  assert.ok(yes.results[0].confirmed, JSON.stringify(yes.results[0]));
  return t.hub.opsPlans.idle(card.id);
};

test("G4-28a variant and correction plans with UNPINNED tools list media.tools.pin FIRST and reach DONE after the one confirmation", { skip: needTools }, async () => {
  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("g4-28a"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const a = await clipProject(t, owner, root, "Lansare Hub");
    assert.deepEqual(t.hub.settings.get("mediaToolPins"), {}, "unpinned");

    const v = (await intent(t, owner, { text: "Pregătește varianta verticală" })).results[0];
    assert.ok(v.opsPlan, JSON.stringify(v));
    const vp = t.hub.opsPlans.view(v.opsPlan.id);
    assert.deepEqual(vp.steps.map((s) => s.kind), ["media.tools.pin", "media.variant.render"]);
    assert.match(vp.steps[0].params.expect.ffmpeg.sha256, /^[0-9a-f]{64}$/);
    assert.ok("libsSha256" in vp.steps[0].params.expect.ffmpeg, "the libs are part of the shown identity");
    const done = await confirmAndRun(t, owner, v.opsPlan);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps.map((s) => s.error).join(" | ")}`);
    assert.equal(t.hub.settings.get("mediaToolPins").ffmpeg.pinnedBy, `plan:${vp.id}`);
    assert.ok(done.steps[1].result.assetVersionId);

    // Tools pinned now: the correction card has no pin step. Unpin (as a fresh install) → the pin is its first step again.
    t.hub.bus.transaction(() => t.hub.settings.set("mediaToolPins", {}, "test"));
    const fix = (await intent(t, owner, { text: "La secunda 1 mută textul mai sus" })).results[0];
    assert.ok(fix.opsPlan, JSON.stringify(fix));
    const fp = t.hub.opsPlans.view(fix.opsPlan.id);
    assert.deepEqual(fp.steps.map((s) => s.kind), ["media.tools.pin", "media.edit.correct"]);
    const fixed = await confirmAndRun(t, owner, fix.opsPlan);
    assert.equal(fixed.status, "DONE", `${fixed.statusReason} ${fixed.steps.map((s) => s.error).join(" | ")}`);
    assert.ok(fixed.steps[1].result.assetVersionId, "draft rendered after the pin");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    void a;
  } finally { await t.cleanup(); }
});

test("G4-28b the capture plan prepends the pin and shifts its $pas references; a CHANGED toolset blocks variant / correction / capture without proposing anything", { skip: needTools }, async () => {
  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    const root = path.join(tempDir("g4-28b"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false, liveCapture: true });
    await clipProject(t, owner, root, "Lansare Hub");
    const cap = (await intent(t, owner, { text: "Înregistrează demonstrația și pregătește varianta verticală, fără să publici" })).results[0];
    assert.ok(cap.opsPlan, JSON.stringify(cap));
    const cp = t.hub.opsPlans.view(cap.opsPlan.id);
    assert.deepEqual(cp.steps.map((s) => s.kind), ["media.tools.pin", "capture.browser_demo", "media.edit.from_capture", "media.render", "media.variant.render"]);
    assert.equal(cp.steps[2].params.assetVersionId, "$pas:2.assetVersionId", "the capture is step 2 now");
    assert.equal(cp.steps[3].params.editVersionId, "$pas:3.editVersionId");
    assert.equal(cp.steps[4].params.masterVersionId, "$pas:3.editVersionId");
    t.hub.opsPlans.reject?.(cp.id, { actor: "test" });

    // A pinned identity that no longer matches the binary (another ffmpeg was pinned / installed): CHANGED → a blocker, no plan.
    await as(t, owner, "media.tools.pin", {});
    const pins = t.hub.settings.get("mediaToolPins");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaToolPins", { ...pins, ffmpeg: { ...pins.ffmpeg, sha256: "0".repeat(64) } }, "test"));
    const before = count(t, "SELECT COUNT(*) AS n FROM ops_plans");
    for (const text of ["Pregătește varianta verticală", "Înregistrează demonstrația și pregătește varianta verticală, fără să publici"]) {
      const r = (await intent(t, owner, { text })).results[0];
      assert.equal(r.opsPlan, undefined, `${text}: ${JSON.stringify(r)}`);
      assert.equal(r.blockedBy?.signature, "MEDIA_TOOLS_CHANGED", JSON.stringify(r));
      assert.equal(r.navigate, "/studio?panel=tools");
      assert.match(r.message, /Studio → Unelte/);
    }
    const fix = (await intent(t, owner, { text: "La secunda 1 mută textul mai sus" })).results[0];
    assert.equal(fix.opsPlan, undefined);
    assert.match(fix.planError || "", /binar de randare s-a schimbat/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), before, "nothing proposed");
    // The refusal text of the render path names the real place.
    await rejectsCode(t.hub.media.tools.resolve(), "TOOL_CHANGED");
    await assert.rejects(t.hub.media.tools.resolve(), /Studio → Unelte/);
  } finally { await t.cleanup(); }
});

test("G4-29a the grammar keeps a named clip apart from a purpose or a platform", () => {
  const args = (text) => resolveIntent(text, { projects: [], missions: [], departments: [], pendingEnvelopes: [] }).steps.find((s) => s.intent === "studio_create")?.args;
  assert.equal(args("Fă un clip din Promo").clipRef, "promo");
  assert.equal(args("Fă un clip vertical din clipul Promo pentru TikTok").clipRef, "promo");
  assert.equal(args("Fă un clip pentru clipul Tutorial").clipRef, "tutorial");
  const li = args("Fă un videoclip pentru LinkedIn");
  assert.equal(li.clipRef, undefined); assert.equal(li.about, undefined); assert.equal(li.forWhom, undefined, "a platform is not a name");
  assert.equal(args("Fă un clip din materialele importate").clipRef, undefined, "a generic source is not a name");
  const tk = args("Fă un clip vertical pentru TikTok despre lansare hub");
  assert.equal(tk.about, "lansare hub"); assert.equal(tk.forWhom, undefined);
  const promo = args("Fă un videoclip de promovare de 30 de secunde");
  assert.deepEqual([promo.durationSec, promo.topic, promo.purpose, promo.clipRef], [30, "promovare", "promovare", undefined]);
  assert.equal(args("Fă un clip de prezentare pentru clienți").forWhom, "clienti");
});

test("G4-29b studio_create on a named clip: never the last target; 2+ name matches → one question among them; a named clip with two edit plans → the honest reason; a purpose with 2+ matches asks among them", { skip: needTools }, async () => {
  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    await as(t, owner, "media.tools.pin", {});
    const root = path.join(tempDir("g4-29"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const promo = await clipProject(t, owner, root, "Promo");
    const tutorial = await clipProject(t, owner, root, "Tutorial");
    // The owner looked at „Tutorial” (server-held lastTarget) …
    const shown = (await intent(t, owner, { text: "Arată-mi clipul tutorial" })).results[0];
    assert.equal(shown.navigate, `/studio/${tutorial.pid}`);
    // … then names „Promo”: the plan is for Promo, not for the last target.
    const named = (await intent(t, owner, { text: "Fă un clip din Promo" })).results[0];
    assert.ok(named.opsPlan, JSON.stringify(named));
    assert.equal(t.hub.opsPlans.view(named.opsPlan.id).steps.at(-1).params.editVersionId, promo.edit.version.id);
    // A name that matches nothing → asked, never the last target.
    const ghost = (await intent(t, owner, { text: "Fă un clip din Inexistent" })).results[0];
    assert.equal(ghost.opsPlan, undefined);
    assert.match(ghost.message, /Nu găsesc clipul „inexistent”/);
    assert.equal(ghost.clarification?.forIntent, "studio_create");

    // Two clips whose names match → ONE question whose options are exactly those two.
    const pa = await clipProject(t, owner, root, "Lansare iarnă");
    const pb = await clipProject(t, owner, root, "Lansare vară");
    const two = (await intent(t, owner, { text: "Fă un clip din lansare" })).results[0];
    assert.equal(two.opsPlan, undefined, JSON.stringify(two));
    assert.deepEqual(two.clarification.options.map((o) => o.id).sort(), [pa.pid, pb.pid].sort());

    // A purpose („de lansare”) matching both, with the last target (Tutorial) not among them → the question is among those two.
    await intent(t, owner, { text: "Arată-mi clipul tutorial" });
    const purpose = (await intent(t, owner, { text: "Fă un videoclip de lansare" })).results[0];
    assert.equal(purpose.opsPlan, undefined, JSON.stringify(purpose));
    assert.deepEqual(purpose.clarification.options.map((o) => o.id).sort(), [pa.pid, pb.pid].sort(), "never Tutorial (the last target is not a purpose match)");

    // A named clip with two edit plans → the honest reason, its Studio page; no other clip planned in its place.
    const dublu = await clipProject(t, owner, root, "Dublu", { edits: 2 });
    const plansBefore = count(t, "SELECT COUNT(*) AS n FROM ops_plans");
    const d = (await intent(t, owner, { text: "Fă un clip din Dublu" })).results[0];
    assert.equal(d.opsPlan, undefined, JSON.stringify(d));
    assert.match(d.message, /„Dublu” nu e gata de randat: are 2 planuri de montaj/);
    assert.equal(d.navigate, `/studio/${dublu.pid}`);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #27 in a real browser (needs a build that contains the panel)

const pwStatus = browserStatus({ hubRoot: HUB_ROOT });
const hasToolsPanel = () => {
  try {
    const dir = path.join(WEB_DIST, "assets");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("Unelte de randare"));
  } catch { return false; }
};
const browserSkip = !pwStatus.installed || !pwStatus.cachedBrowsers?.length ? "SKIPPED_ENV: Playwright/Chromium is missing"
  : !hasToolsPanel() ? `SKIPPED_ENV: the built UI has no Studio → Unelte panel (${WEB_DIST}); set HUB_V2_WEB_DIST to a fresh build` : false;

test("G4-27d browser: #/studio?panel=tools → „Fixează” pins the displayed identity; a changed ffmpeg → „Confirmă schimbarea” in the owner session → renders allowed", { skip: browserSkip, timeout: 240000 }, async () => {
  const fx = scriptedLaunchers(path.join(tempDir("g4-27-browser"), "tools"));
  const t = await makeTestHub({ configOverrides: { webDist: WEB_DIST, mediaTools: { launcher: fx.launchers } } });
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });

    // The blocker's address opens the panel; the tools are unpinned → „Fixează”.
    await page.goto(`${origin}/#/studio?panel=tools`);
    await page.getByText("Unelte de randare").waitFor({ timeout: 20000 });
    const seen = await t.hub.media.tools.inspect();
    await page.getByRole("button", { name: /^Fixează$/ }).click();
    await waitFor(() => Boolean(t.hub.settings.get("mediaToolPins")?.ffprobe?.sha256), 20000, 100);
    const pins = t.hub.settings.get("mediaToolPins");
    assert.equal(pins.ffmpeg.sha256, seen.ffmpeg.sha256, "the identity displayed");
    assert.match(pins.ffmpeg.pinnedBy, /^owner:/, "pinned from the owner's page");

    // ffmpeg updated → the panel offers „Confirmă schimbarea”; one click in the owner session acknowledges exactly what is shown.
    fs.writeFileSync(fx.ids.ffmpeg, "ffmpeg build B");
    await page.reload();
    const ack = page.getByRole("button", { name: /Confirmă schimbarea/ });
    await ack.waitFor({ timeout: 20000 });
    await ack.click();
    await waitFor(() => t.hub.settings.get("mediaToolPins")?.ffmpeg?.acknowledged === true, 20000, 100);
    const now = t.hub.settings.get("mediaToolPins").ffmpeg;
    assert.match(now.acknowledgedBy, /^owner:/);
    assert.equal((await t.hub.media.tools.resolve()).usable, true, "renders are no longer refused");
    await page.getByText(/Uneltele sunt fixate/).waitFor({ timeout: 20000 });
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser.close();
    server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup();
  }
});
