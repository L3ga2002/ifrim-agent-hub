// R-MEDIA (corrections after M11): intentional pauses of a capture as measured intervals with provenance (media/holds.mjs), carried by
// the montage (delivery/clip-ir.mjs), checked by the IR validator, remapped by cuts / speed / variants, and used by QA to justify ONLY a
// frozen range inside them. T-MEDIA 1–8 of the owner's prompt; the real tests use ffmpeg and Playwright Chromium (SKIPPED_ENV without).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { makeMediaEnv, realLaunchers, realTool, HUB_ROOT } from "./media-helpers.mjs";
import { browserLaunchOptions } from "../server/tools/browser-core.mjs";
import { createMediaPaths } from "../server/media/paths.mjs";
import { createMediaTools } from "../server/media/tools.mjs";
import { createMediaAssets } from "../server/media/assets.mjs";
import { createMediaRights } from "../server/media/rights.mjs";
import { createMediaQa, justificationFor } from "../server/media/qa.mjs";
import { createCapture } from "../server/media/capture.mjs";
import { validateIR } from "../server/media/ir.mjs";
import { applyOps } from "../server/media/review.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import { PRESETS } from "../server/media/visual-bible.mjs";
import { buildMaster } from "../server/delivery/clip-ir.mjs";
import { captureScriptFrom } from "../server/delivery/template.mjs";
import { validateDemoSteps } from "../server/media/capture.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { HOLD_SCHEMA, holdCap, measureHold, checkCaptureHold, clipHoldOf, timelineHolds, holdCover } from "../server/media/holds.mjs";

const FPS = { num: 30, den: 1 };
const SHA = "a".repeat(64);
/** A measured capture hold as media/capture.mjs stores it (bound to its asset version, session and steps sha). */
function capHold(assetVersionId, { id = "hld_1", reason = "highlight", step = 3, startMs, endMs, plannedMs = endMs - startMs, sessionId = "mcs_demo", stepsSha = SHA } = {}) {
  const m = measureHold({ reason, step, startMs, endMs, plannedMs, verified: true });
  assert.ok(m.hold, JSON.stringify(m));
  return { schema: HOLD_SCHEMA, id, ...m.hold, result: "VERIFIED", sessionId, assetVersionId, stepsSha };
}
const clipHolds = (assetVersionId, list) => list.map((h) => clipHoldOf(capHold(assetVersionId, h), FPS));
/** A one-clip 10 s timeline of `mav_cap` (300 frames) with the given holds. */
function oneClipIr(holds, extra = {}) {
  return { irVersion: 1, fps: FPS, canvas: { width: 1280, height: 720, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_cap", sourceIn: 0, sourceOut: 300, start: 0, ...(holds.length ? { holds } : {}), ...extra }] }],
    meta: { title: "Hold test", labels: [], author: "", notes: "" } };
}
const stubVersions = (durationMs = 10000) => (id) => ({ id, status: "READY", origin: "OWNED", capture_label: "ORIGINAL_RECORDING", kind: "video",
  probe: { hasVideo: true, hasAudio: false, durationMs, container: "mov,mp4", video: { width: 1280, height: 720, displayWidth: 1280, displayHeight: 720, fps: FPS } } });

// ---------------------------------------------------------------------------------------------------------------------------
// Pure: the capture side
// ---------------------------------------------------------------------------------------------------------------------------

test("RM-01 a measured step is a hold only when planned, verified and within its cap; typing gets a bounded allowance, never the whole latency", () => {
  assert.equal(holdCap("highlight", 1200), 1450);
  assert.equal(holdCap("typing", 600), 1000, "600 ms typed: at least 400 ms of allowance");
  assert.equal(holdCap("typing", 4000), 5000, "25 % of a long typing");
  assert.ok(measureHold({ reason: "highlight", step: 2, startMs: 100, endMs: 1340, plannedMs: 1200, verified: true }).hold);
  assert.equal(measureHold({ reason: "highlight", step: 2, startMs: 100, endMs: 1600, plannedMs: 1200, verified: true }).rejected.code, "HOLD_LATENCY_EXCEEDED");
  assert.equal(measureHold({ reason: "highlight", step: 2, startMs: 100, endMs: 1300, plannedMs: 1200, verified: false }).rejected.code, "HOLD_POSTCONDITION_FAILED");
  assert.equal(measureHold({ reason: "typing", step: 4, startMs: 0, endMs: 3000, plannedMs: 600, verified: true }).rejected.code, "HOLD_LATENCY_EXCEEDED", "a slow page is not a planned pause");
  assert.equal(measureHold({ reason: "wait", step: 4, startMs: 500, endMs: 500, plannedMs: 0, verified: true }).rejected.code, "HOLD_NOT_PLANNED");
  assert.equal(measureHold({ reason: "screensaver", step: 4, startMs: 0, endMs: 900, plannedMs: 900, verified: true }).rejected.code, "HOLD_REASON_UNKNOWN");
});

test("RM-02 T-MEDIA 4/8: a hold of another asset version, session or steps script, without an end, unverified or tampered is refused by the montage check", () => {
  const ok = capHold("mav_cap", { startMs: 1000, endMs: 2200, plannedMs: 1200 });
  const ref = { assetVersionId: "mav_cap", sessionId: "mcs_demo", stepsSha: SHA, durationMs: 10000 };
  assert.deepEqual(checkCaptureHold(ok, ref), { ok: true });
  assert.equal(checkCaptureHold({ ...ok, assetVersionId: "mav_other" }, ref).code, "HOLD_ASSET_MISMATCH");
  assert.equal(checkCaptureHold(ok, { ...ref, assetVersionId: "mav_cap_v2" }).code, "HOLD_ASSET_MISMATCH", "a new version of the capture invalidates its old holds");
  assert.equal(checkCaptureHold({ ...ok, sessionId: "mcs_other" }, ref).code, "HOLD_SESSION_MISMATCH");
  assert.equal(checkCaptureHold(ok, { ...ref, sessionId: null }).code, "HOLD_PROVENANCE", "review F2: a caller that does not name the session gets no hold");
  assert.equal(checkCaptureHold(ok, { ...ref, stepsSha: null }).code, "HOLD_PROVENANCE", "nor one that does not name the script");
  assert.equal(checkCaptureHold({ ...ok, stepsSha: "b".repeat(64) }, ref).code, "HOLD_SCRIPT_MISMATCH");
  assert.equal(checkCaptureHold({ ...ok, endMs: undefined }, ref).code, "HOLD_FIELDS");
  assert.equal(checkCaptureHold({ ...ok, result: "FAILED" }, ref).code, "HOLD_UNVERIFIED");
  assert.equal(checkCaptureHold({ ...ok, schema: undefined }, ref).code, "HOLD_SCHEMA", "an old point marker is never a hold");
  assert.equal(checkCaptureHold({ kind: "highlight", atMs: 1000, note: "#go" }, ref).code, "HOLD_SCHEMA");
  assert.equal(checkCaptureHold({ ...ok, endMs: 9000 }, ref).code, "HOLD_LATENCY_EXCEEDED", "a stretched end is over the cap");
  assert.equal(checkCaptureHold({ ...ok, maxMs: 9000 }, ref).code, "HOLD_CAP", "the cap is re-derived from the plan");
  assert.equal(checkCaptureHold({ ...ok, endMs: 11000, startMs: 10000, plannedMs: 1000, maxMs: holdCap("highlight", 1000) }, ref).code, "HOLD_OUT_OF_RANGE");
});

test("RM-03 the IR validator checks every hold field: provenance of another asset, re-derived frames, unknown fields, malformed values", () => {
  const holds = clipHolds("mav_cap", [{ startMs: 1000, endMs: 2200, plannedMs: 1200 }]);
  const get = stubVersions();
  assert.equal(validateIR(oneClipIr(holds), { getVersion: get, presets: PRESETS }).ok, true);
  const codes = (ir) => validateIR(ir, { getVersion: get, presets: PRESETS }).errors.map((e) => e.code);
  assert.ok(codes(oneClipIr([{ ...holds[0], provenance: { ...holds[0].provenance, assetVersionId: "mav_other" } }])).includes("HOLD_PROVENANCE_MISMATCH"));
  assert.ok(codes(oneClipIr([{ ...holds[0], srcTo: holds[0].srcTo + 30 }])).includes("HOLD_FRAMES_MISMATCH"), "frames are re-derived from the measured interval");
  assert.ok(codes(oneClipIr([{ ...holds[0], why: "x" }])).includes("UNKNOWN_FIELD"), "no structure hidden in an ignored field");
  assert.ok(codes(oneClipIr([{ ...holds[0], provenance: { ...holds[0].provenance, extra: 1 } }])).includes("UNKNOWN_FIELD"));
  assert.ok(codes(oneClipIr([{ ...holds[0], reason: "anything" }])).includes("UNSUPPORTED_VALUE"));
  assert.ok(codes(oneClipIr([{ ...holds[0], provenance: { ...holds[0].provenance, maxMs: 99999 } }])).includes("HOLD_CAP"));
  assert.ok(codes(oneClipIr([holds[0], holds[0]])).includes("DUPLICATE_ID"));
  // Old IRs (no holds) hash and validate exactly as before: nothing is defaulted.
  assert.equal(validateIR(oneClipIr([]), { getVersion: get, presets: PRESETS }).ir.tracks[0].clips[0].holds, undefined);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Pure: QA justification
// ---------------------------------------------------------------------------------------------------------------------------

test("RM-04 T-MEDIA 1/2/3: a freeze inside a run of holds is justified (with the holds named); over the edge or outside stays flagged; one capture can hold both", () => {
  // highlight 1,0–2,2 s, proof hold 2,22–4,72 s (a 20 ms gap), end hold 4,74–5,54 s; nothing planned 6–9 s.
  const holds = clipHolds("mav_cap", [{ id: "h1", reason: "highlight", step: 3, startMs: 1000, endMs: 2200, plannedMs: 1200 },
    { id: "h2", reason: "proof_hold", step: 6, startMs: 2220, endMs: 4720, plannedMs: 2500 }, { id: "h3", reason: "end_hold", step: 7, startMs: 4740, endMs: 5540, plannedMs: 800 }]);
  const ir = oneClipIr(holds);
  const j = justificationFor(ir, "freeze", 37, 160); // 1,23–5,33 s: spans the three holds
  assert.ok(j, "covered by one run of holds");
  assert.equal(j.basis, "capture_holds");
  assert.deepEqual(j.holds.map((h) => h.id), ["h1", "h2", "h3"]);
  assert.match(j.reason, /highlight, proof_hold, end_hold/);
  assert.equal(justificationFor(ir, "freeze", 150, 200), null, "spills 1,1 s past the end hold");
  assert.equal(justificationFor(ir, "freeze", 20, 60), null, "starts 0,33 s before the highlight");
  assert.equal(justificationFor(ir, "freeze", 180, 270), null, "the accidental freeze of the same capture");
  assert.ok(justificationFor(ir, "freeze", 29, 68), "within 2 frames of tolerance at each edge");
});

test("RM-05 T-MEDIA 6: black and silence are never justified by a hold, and a gap between holds over the tolerance breaks the run", () => {
  const holds = clipHolds("mav_cap", [{ id: "h1", startMs: 1000, endMs: 2200, plannedMs: 1200 }, { id: "h2", reason: "wait", startMs: 2400, endMs: 3600, plannedMs: 1200 }]);
  const ir = oneClipIr(holds);
  assert.equal(justificationFor({ ...ir, canvas: { ...ir.canvas, background: "#FFFFFF" } }, "black", 31, 60), null, "a black range inside a hold stays an error");
  assert.ok(justificationFor(ir, "freeze", 31, 60));
  assert.equal(justificationFor(ir, "freeze", 31, 100), null, "200 ms between the holds (6 frames) is not a planned pause");
  // A hold whose provenance no longer names the clip's asset (the clip was relinked) justifies nothing.
  const relinked = oneClipIr(holds);
  relinked.tracks[0].clips[0].assetVersionId = "mav_cap_v2";
  assert.deepEqual(timelineHolds(relinked), []);
  assert.equal(justificationFor(relinked, "freeze", 31, 60), null);
});

test("RM-06 T-MEDIA 7: cuts, trims, speed and variants remap holds deterministically (removed ranges vanish, intersected ones are clipped)", () => {
  const holds = clipHolds("mav_cap", [{ id: "h1", startMs: 1000, endMs: 2200, plannedMs: 1200 }, { id: "h2", reason: "wait", step: 5, startMs: 5000, endMs: 6200, plannedMs: 1200 }]);
  const ir = oneClipIr(holds);
  assert.deepEqual(timelineHolds(ir).map((h) => [h.holdId, h.from, h.to]), [["h1", 30, 66], ["h2", 150, 186]]);
  // Cut 1,5–5,5 s: h1 is clipped to 30–45, h2 loses its head and moves 120 frames left (165–186 → 45–66).
  const cut = applyOps(ir, [{ op: "cut_range", from: 45, to: 165 }]);
  assert.deepEqual(timelineHolds(cut).map((h) => [h.holdId, h.from, h.to]), [["h1", 30, 45], ["h2", 45, 66]]);
  assert.equal(validateIR(cut, { getVersion: stubVersions(), presets: PRESETS }).ok, true, "the split clips keep valid holds");
  assert.ok(justificationFor(cut, "freeze", 31, 44));
  assert.equal(justificationFor(cut, "freeze", 31, 60), null, "two holds that a cut made adjacent belong to two clips: never bridged");
  // A cut that removes h1 entirely: it disappears.
  const gone = applyOps(ir, [{ op: "cut_range", from: 20, to: 90 }]);
  assert.deepEqual(timelineHolds(gone).map((h) => h.holdId), ["h2"]);
  // Speed 2: the same source frames take half the timeline.
  assert.deepEqual(timelineHolds(oneClipIr(holds, { speed: 2 })).map((h) => [h.holdId, h.from, h.to]), [["h1", 15, 33], ["h2", 75, 93]]);
  // A trim of the clip's head (sourceIn 40): h1 keeps only 40–66 in source → timeline 0–26.
  assert.deepEqual(timelineHolds(oneClipIr(holds, { sourceIn: 40 })).map((h) => [h.holdId, h.from, h.to]), [["h1", 0, 26], ["h2", 110, 146]]);
  // The 9:16 variant derived from the master keeps the same holds on its clips.
  const v = deriveVariant({ masterIr: { ...ir, tracks: [ir.tracks[0], { id: "tl", kind: "text", items: [{ id: "l1", start: 0, end: 300, text: "DATE SINTETICE · DEMO LOCAL", style: "label", anchor: "top", x: 0.8, y: 0.07, animation: "none" }] }] },
    platformKey: "tiktok_9x16", getVersion: stubVersions() });
  assert.deepEqual(timelineHolds(v.ir).map((h) => [h.holdId, h.from, h.to]), [["h1", 30, 66], ["h2", 150, 186]]);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The montage of a delivery
// ---------------------------------------------------------------------------------------------------------------------------

const TEXTS = Object.fromEntries(["hook", "desktop", "mobile", "cta"].map((slot) => [slot, { criteria: ["AC-1"], business: `Text ${slot} pentru business`, technical: `Text ${slot} tehnic` }]));
function captures(holdsByRole = {}, extra = {}) {
  return ["desktop", "mobile"].map((role) => ({ role, assetVersionId: `mav_${role}`, durationMs: 9000, width: role === "mobile" ? 780 : 1920, height: role === "mobile" ? 1688 : 1080,
    captureLabel: "ORIGINAL_RECORDING", markers: [], sessionId: `mcs_${role}`, stepsSha: SHA, holds: holdsByRole[role] || [], ...(extra[role] || {}) }));
}
const master = (caps) => buildMaster({ captures: caps, texts: TEXTS, passed: ["AC-1"], claimIdsByCriterion: { "AC-1": "ccl_1" }, getVersion: stubVersions(9000) });

test("RM-07 the montage puts only the holds that check out against THAT capture on its clip, and says which it refused", () => {
  const good = capHold("mav_desktop", { id: "hd1", startMs: 1000, endMs: 2200, plannedMs: 1200, sessionId: "mcs_desktop" });
  const foreign = capHold("mav_other", { id: "hd2", startMs: 3000, endMs: 4200, plannedMs: 1200, sessionId: "mcs_desktop" });
  const otherScript = { ...capHold("mav_mobile", { id: "hm1", startMs: 1000, endMs: 2000, plannedMs: 1000, sessionId: "mcs_mobile" }), stepsSha: "c".repeat(64) };
  const marker = { kind: "highlight", atMs: 500, note: "#go" };
  const built = master(captures({ desktop: [good, foreign, marker], mobile: [otherScript] }));
  const [desk, mob] = built.ir.tracks[0].clips;
  assert.deepEqual(desk.holds.map((h) => h.id), ["hd1"]);
  assert.equal(mob.holds, undefined, "no checked hold → no field");
  assert.deepEqual(built.holdsRejected.map((r) => r.code).sort(), ["HOLD_ASSET_MISMATCH", "HOLD_SCHEMA", "HOLD_SCRIPT_MISMATCH"]);
  assert.deepEqual(built.holds, { "c-desktop": 1, "c-mobile": 0 });
  // The desktop and phone clips are never marked holdIntentional as a whole.
  assert.ok(built.ir.tracks[0].clips.every((c) => c.holdIntentional !== true));
  assert.equal(validateIR(built.ir, { getVersion: stubVersions(9000), presets: PRESETS }).ok, true);
  // On the timeline the desktop hold is where it was measured; the phone clip has none.
  assert.deepEqual(timelineHolds(built.ir).map((h) => [h.clipId, h.from, h.to]), [["c-desktop", 30, 66]]);
});

test("RM-08 the steps sha a capture computes equals the template's stepsSha (the plan link a hold is checked against)", () => {
  const e2e = [{ viewport: { width: 1280, height: 800 } }, { goto: "/" }, { fill: { selector: "[name='name']", value: "Ana Demo" } }, { click: "button[type=submit]" }, { expectText: "Programare confirmată" }];
  const script = captureScriptFrom(e2e, { noun: "programare", role: "desktop", proofSelector: "[data-state='success']" });
  assert.equal(script.ok, true, JSON.stringify(script.blockers));
  assert.equal(hashCanonical(validateDemoSteps(script.steps)), hashCanonical(script.steps), "re-validation is idempotent");
});

// ---------------------------------------------------------------------------------------------------------------------------
// Real: ffmpeg freezedetect through QA, and a Chromium capture
// ---------------------------------------------------------------------------------------------------------------------------

function qaSetup() {
  const env = makeMediaEnv({ launchers: realLaunchers() });
  env.bus.transaction(() => env.settings.set("mediaPolicy", { ...env.settings.get("mediaPolicy"), diskReserveGb: 0 }, "test"));
  const paths = createMediaPaths({ config: env.config });
  paths.ensure();
  const tools = createMediaTools({ config: env.config, supervisor: env.supervisor, settings: env.settings, bus: env.bus, clock: env.clock });
  const assets = createMediaAssets({ db: env.db, bus: env.bus, clock: env.clock, paths, tools, settings: env.settings });
  const rights = createMediaRights({ db: env.db, bus: env.bus, clock: env.clock });
  const qa = createMediaQa({ db: env.db, bus: env.bus, clock: env.clock, tools, paths, assets, rights });
  const inbox = path.join(env.dir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  return { env, paths, tools, assets, qa, inbox };
}

/** 8 s, 320×240, 30 fps: moving 0–1, solid A 1–2,5 (planned hold), moving 2,5–3,5, solid B 3,5–5 (accidental), moving 5–6, black 6–7 (inside a hold), moving 7–8. */
function makeHoldFile(dir) {
  const out = path.join(dir, "holds.mp4");
  const mv = (d) => ["-f", "lavfi", "-i", `testsrc2=size=320x240:rate=30:duration=${d}`];
  const solid = (c, d) => ["-f", "lavfi", "-i", `color=c=${c}:size=320x240:rate=30:duration=${d}`];
  execFileSync(realTool("ffmpeg"), ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...mv(1), ...solid("0x3366cc", 1.5), ...mv(1), ...solid("0xcc6633", 1.5), ...mv(1), ...solid("black", 1), ...mv(1),
    "-filter_complex", "[0:v][1:v][2:v][3:v][4:v][5:v][6:v]concat=n=7:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", out], { stdio: "ignore", windowsHide: true });
  return out;
}

test("RM-09 real QA (ffmpeg): the planned freeze is justified by its hold, the accidental one in the same file stays a warning, black inside a hold stays an error", async (t) => {
  if (!realLaunchers().available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found"); return; }
  const s = qaSetup();
  try {
    const file = makeHoldFile(s.inbox);
    const { version } = await s.assets.ingestFile({ sourcePath: file, allowedRoots: [s.inbox], origin: "OWNED", actor: "owner" });
    // The holds as a capture would have measured them: a highlight 0,99–2,2 s then a proof hold 2,21–2,52 s cover solid A; a planned
    // wait covers the black second.
    const measured = [capHold(version.id, { id: "h1", reason: "highlight", step: 2, startMs: 990, endMs: 2200, plannedMs: 1200 }),
      capHold(version.id, { id: "h2", reason: "proof_hold", step: 4, startMs: 2210, endMs: 2520, plannedMs: 300 }),
      capHold(version.id, { id: "h3", reason: "wait", step: 7, startMs: 5980, endMs: 7020, plannedMs: 1000 })];
    // The capture session stores its holds (media/capture.mjs → scope_json.result.holds): QA honours only those.
    const at = new Date().toISOString();
    s.env.db.prepare("INSERT INTO media_capture_sessions (id, kind, status, scope_json, created_by, created_at, updated_at) VALUES ('mcs_demo', 'browser_demo', 'STOPPED', ?, 'test', ?, ?)")
      .run(JSON.stringify({ result: { holds: measured } }), at, at);
    const holds = measured.map((h) => clipHoldOf(h, FPS));
    const ir = { irVersion: 1, fps: FPS, canvas: { width: 320, height: 240, background: "#0B0D10" }, preset: { id: "ifrim-devlog", version: 1 }, language: "ro",
      tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: version.id, sourceIn: 0, sourceOut: 240, start: 0, holds }] }] };
    assert.equal(validateIR(ir, { getVersion: s.assets.getVersion, presets: PRESETS }).ok, true);
    const r = await s.qa.technical({ assetVersionId: version.id, ir });
    const frozen = r.findings.filter((f) => f.code === "FROZEN_SEGMENT").sort((a, b) => a.range.fromMs - b.range.fromMs);
    assert.equal(frozen.length, 2, JSON.stringify(r.findings.map((f) => [f.code, f.range?.label])));
    assert.equal(frozen[0].justified, true, JSON.stringify(frozen[0]));
    assert.equal(frozen[0].justificationBasis, "capture_holds");
    assert.deepEqual(frozen[0].justificationHolds.map((h) => h.id), ["h1", "h2"]);
    assert.equal(frozen[0].evidence.filter, "freezedetect", "the raw measurement stays");
    assert.ok(frozen[0].evidence.durationS >= 1.4);
    assert.equal(frozen[1].justified, false, "the accidental freeze 3,5–5 s of the same capture");
    const black = r.findings.filter((f) => f.code === "BLACK_SEGMENT");
    assert.equal(black.length, 1);
    assert.equal(black[0].justified, false, "a hold never neutralizes black");
    assert.equal(r.status, "FAIL");
    assert.deepEqual(r.measurements.holds, { kept: 3, unverified: 0 });
    // Review F1: a forged hold, consistent with itself and valid for the IR validator, but never stored by a capture → no justification.
    const forged = clipHoldOf(capHold(version.id, { id: "hx", reason: "wait", step: 3, startMs: 0, endMs: 8000, plannedMs: 8000, sessionId: "mcs_forged" }), FPS);
    const irForged = { ...ir, tracks: [{ ...ir.tracks[0], clips: [{ ...ir.tracks[0].clips[0], holds: [forged] }] }] };
    assert.equal(validateIR(irForged, { getVersion: s.assets.getVersion, presets: PRESETS }).ok, true, "the validator alone cannot tell");
    const rf = await s.qa.technical({ assetVersionId: version.id, ir: irForged });
    assert.ok(rf.findings.filter((f) => f.code === "FROZEN_SEGMENT").every((f) => !f.justified), "nothing justified by the forged hold");
    assert.deepEqual(rf.measurements.holds, { kept: 0, unverified: 1 });
    // A stored hold whose interval was edited in the IR no longer matches the session's record either.
    const stretched = { ...holds[0], provenance: { ...holds[0].provenance, endMs: 2240 }, srcTo: clipHoldOf({ ...measured[0], endMs: 2240 }, FPS).srcTo };
    const re = await s.qa.technical({ assetVersionId: version.id, ir: { ...ir, tracks: [{ ...ir.tracks[0], clips: [{ ...ir.tracks[0].clips[0], holds: [stretched, holds[1], holds[2]] }] }] } });
    assert.deepEqual(re.measurements.holds, { kept: 2, unverified: 1 });
  } finally { s.env.cleanup(); }
});

const STATIC_PAGE = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Hold demo</title><link rel="stylesheet" href="/s.css"></head>
<body><input id="name" name="name"><button id="go">Programează</button><div id="out" hidden data-state="success">Programare confirmată</div><script src="/app.js"></script></body></html>`;
const STATIC_CSS = "body{margin:0;background:#fff;font-family:sans-serif}#name{position:absolute;left:80px;top:80px;font-size:28px}#go{position:absolute;left:80px;top:200px;font-size:28px}#out{position:absolute;left:80px;top:320px;font-size:28px}";
// The click shows the success state 1,6 s later on a still page: an accidental freeze the plan never asked for.
const STATIC_JS = "document.getElementById('go').addEventListener('click',()=>{setTimeout(()=>{document.getElementById('out').hidden=false},1600)});";
function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const csp = { "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'" };
      if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...csp }); res.end(STATIC_PAGE); }
      else if (req.url === "/s.css") { res.writeHead(200, { "Content-Type": "text/css" }); res.end(STATIC_CSS); }
      else if (req.url === "/app.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(STATIC_JS); }
      else { res.writeHead(404); res.end(); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
  });
}
async function chromiumMissing() {
  let pw;
  try { pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); } catch { return "Playwright is not installed"; }
  try { const b = await pw.chromium.launch(browserLaunchOptions("http://127.0.0.1:9")); await b.close(); return null; }
  catch (error) { return `Chromium cannot start (${String(error.message).split("\n")[0].slice(0, 120)})`; }
}

test("RM-10 real capture (Chromium + ffmpeg): planned steps produce verified holds bound to the stored asset; QA justifies the planned freezes and flags the accidental one", { timeout: 240000 }, async (t) => {
  if (!realLaunchers().available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found"); return; }
  const missing = await chromiumMissing();
  if (missing) { t.skip(`SKIPPED_ENV: ${missing}`); return; }
  const site = await serveStatic();
  const s = qaSetup();
  try {
    const capture = createCapture({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, settings: s.env.settings, config: s.env.config, paths: s.paths, assets: s.assets, tools: s.tools });
    const steps = [{ goto: "/" }, { marker: { kind: "chapter", note: "intro" } }, { wait: 1200 }, { type: { selector: "#name", text: "Ana Demo", delayMs: 60 } },
      { highlight: { selector: "#go", ms: 1200 } }, { click: "#go" }, { waitFor: "#out" }, { highlight: { selector: "#out", ms: 1200 } },
      { marker: { kind: "proof", note: "Programare confirmată" } }, { wait: 1500 }];
    const out = await capture.captureBrowserDemo({ origin: site.origin, allowOrigin: (o) => o === site.origin, captureLabel: "SIMULATION", actor: "owner", viewport: { width: 640, height: 400 }, fps: 30, holdEndMs: 800, steps });
    const byReason = Object.fromEntries(out.holds.map((h) => [h.reason, h]));
    assert.deepEqual(Object.keys(byReason).sort(), ["end_hold", "highlight", "proof_hold", "settle", "typing"], JSON.stringify({ holds: out.holds, rejected: out.holdsRejected }));
    for (const h of out.holds) {
      assert.equal(h.assetVersionId, out.version.id); assert.equal(h.sessionId, out.session.id); assert.equal(h.stepsSha, out.stepsSha);
      assert.equal(h.result, "VERIFIED"); assert.ok(h.endMs - h.startMs <= h.maxMs && h.endMs <= out.durationMs, JSON.stringify(h));
    }
    assert.equal(out.holds.filter((h) => h.reason === "highlight").length, 2);
    assert.equal(byReason.typing.plannedMs, 8 * 60);
    assert.equal(capture.get(out.session.id).scope.result.holds.length, out.holds.length, "stored with the session");
    // The gaps between the holds of the final run (highlight → proof hold → end hold) are measured, not assumed.
    const tail = out.holds.filter((h) => h.startMs >= byReason.proof_hold.startMs - 2000).sort((a, b) => a.startMs - b.startMs);
    const gaps = tail.slice(1).map((h, i) => h.startMs - tail[i].endMs);
    t.diagnostic(`holds: ${out.holds.map((h) => `${h.reason}@${h.startMs}-${h.endMs}`).join(" ")}; tail gaps ms: ${gaps.join(", ")}`);
    // QA on the capture with its own holds (a one-clip IR, as clip-ir builds each clip).
    const holds = out.holds.map((h) => clipHoldOf(h, FPS)).filter(Boolean);
    const frames = Math.floor((out.durationMs * 30) / 1000);
    const ir = { irVersion: 1, fps: FPS, canvas: { width: 640, height: 400, background: "#0B0D10" }, preset: { id: "ifrim-devlog", version: 1 }, language: "ro",
      tracks: [{ id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: out.version.id, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION", holds }] }] };
    const v = validateIR(ir, { getVersion: s.assets.getVersion, presets: PRESETS });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    const r = await s.qa.technical({ assetVersionId: out.version.id, ir });
    const frozen = r.findings.filter((f) => f.code === "FROZEN_SEGMENT");
    t.diagnostic(`freezes: ${frozen.map((f) => `${f.range.label} ${f.justified ? "JUSTIFIED" : "FLAGGED"}`).join(" | ")}`);
    const [hlGo, hlOut] = out.holds.filter((h) => h.reason === "highlight").sort((a, b) => a.startMs - b.startMs);
    const accidental = frozen.filter((f) => f.range.fromMs >= hlGo.endMs - 100 && f.range.toMs <= hlOut.startMs + 100);
    assert.equal(accidental.length, 1, "the 1,6 s wait for the success state is found");
    assert.equal(accidental[0].justified, false, "and stays flagged");
    const planned = frozen.filter((f) => f !== accidental[0]);
    assert.ok(planned.length >= 1, "the planned pauses freeze the picture too");
    assert.ok(planned.every((f) => f.justified && f.justificationBasis === "capture_holds"), JSON.stringify(planned.map((f) => [f.range.label, f.justified])));
  } finally { await site.close(); s.env.cleanup(); }
});

test("RM-11 review F6: a planned wait on a blank page (same origin) is not a pause; old point markers never justify anything", { timeout: 180000 }, async (t) => {
  if (!realLaunchers().available) { t.skip("SKIPPED_ENV: ffmpeg/ffprobe not found"); return; }
  const missing = await chromiumMissing();
  if (missing) { t.skip(`SKIPPED_ENV: ${missing}`); return; }
  const blank = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><html><head><title>x</title></head><body><p id=\"t\">Pagina demo</p></body></html>"); }
      else if (req.url === "/gol") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end("<!doctype html><html><head><title>gol</title></head><body></body></html>"); }
      else { res.writeHead(404); res.end(); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
  });
  const s = qaSetup();
  try {
    const capture = createCapture({ db: s.env.db, bus: s.env.bus, clock: s.env.clock, settings: s.env.settings, config: s.env.config, paths: s.paths, assets: s.assets, tools: s.tools });
    const out = await capture.captureBrowserDemo({ origin: blank.origin, allowOrigin: (o) => o === blank.origin, captureLabel: "SIMULATION", actor: "owner", viewport: { width: 480, height: 320 }, fps: 30, holdEndMs: 0,
      steps: [{ goto: "/" }, { wait: 600 }, { goto: "/gol" }, { wait: 1200 }] });
    assert.deepEqual(out.holds.map((h) => h.reason), ["settle"], JSON.stringify({ holds: out.holds, rejected: out.holdsRejected }));
    assert.deepEqual(out.holdsRejected.map((h) => [h.reason, h.code]), [["wait", "HOLD_POSTCONDITION_FAILED"]], "the wait on the blank page is refused");
    // An old capture: point markers only, no holds → the montage puts none on the clip, QA justifies none.
    const built = buildMaster({ captures: captures({}, { desktop: { markers: [{ kind: "highlight", atMs: 500, note: "#go" }, { kind: "proof", atMs: 900, note: "gata" }] } }), texts: TEXTS, passed: ["AC-1"], claimIdsByCriterion: { "AC-1": "ccl_1" }, getVersion: stubVersions(9000) });
    assert.ok(built.ir.tracks[0].clips.every((c) => c.holds === undefined));
    assert.equal(justificationFor(built.ir, "freeze", 10, 40), null);
  } finally { await blank.close(); s.env.cleanup(); }
});
