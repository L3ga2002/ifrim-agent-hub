// Milestone 09 — Content Studio UI logic (pure, no browser): routes and deep links (#/studio/<id>?t=), timecodes at 30 and
// 30000/1001 fps, the Kanban columns, the measurable-progress rule, the timeline layout, proposal previews, CSV mapping and the
// fail-safe paths the Studio relies on (the shared client/server list is unchanged by the Studio).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STUDIO_TABS, PROJECT_TABS, BOARD_STAGES, studioRoute, studioHref, parseSecondsParam, formatTimecode, msToFrame, frameToMs, stepFrameMs, parseTimeInput,
  fmtDelta, boardColumns, measurableProgress, renderProgress, pickPlayable, timelineLayout, activeItemIds, describeOp, proposalPreview, latestQa,
  manifestRows, platformOfProfile, csvHeaders, suggestMapping, STUDIO_FAILSAFE_PATHS, STUDIO_GUARDED_PATHS, fillPath,
} from "../web/src/lib/studioLogic.js";
import { FAILSAFE_PATHS } from "../server/http/server.mjs";
import { isFailsafePath } from "../web/src/api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const NTSC = { num: 30000, den: 1001 };

test("M09-UI-01 studio routes: tabs, project detail by id, ?t= deep link in seconds, sub-tabs and safe fallbacks", () => {
  assert.deepEqual(STUDIO_TABS.map(([id]) => id), ["board", "project", "library", "command", "platforms", "analytics"]);
  assert.equal(PROJECT_TABS.length, 13);
  assert.deepEqual(studioRoute(null, {}), { tab: "board", projectId: null, sub: null, tMs: null, versionId: null });
  assert.equal(studioRoute("library", {}).tab, "library");
  assert.deepEqual(studioRoute("cpr_abc123", { t: "12.5" }), { tab: "project", projectId: "cpr_abc123", sub: "timeline", tMs: 12500, versionId: null }, "a time without a sub-tab opens the Timeline");
  assert.deepEqual(studioRoute("cpr_abc123", { t: "12,5", sub: "review", v: "mev_x1" }), { tab: "project", projectId: "cpr_abc123", sub: "review", tMs: 12500, versionId: "mev_x1" });
  assert.equal(studioRoute("cpr_abc123", {}).sub, "concept");
  assert.equal(studioRoute("cpr_abc123", { sub: "nope" }).sub, "concept");
  assert.equal(studioRoute("cpr_abc123", { t: "-3" }).tMs, null, "negative time refused");
  assert.equal(studioRoute("cpr_abc123", { t: "abc" }).tMs, null);
  assert.equal(studioRoute("cpr_abc123", { v: "../etc" }).versionId, null);
  assert.equal(studioRoute("<script>", {}).tab, "board", "an unsafe id never reaches an API path");
  assert.equal(parseSecondsParam("0"), 0);
  assert.equal(parseSecondsParam("1e3"), null);
  assert.equal(studioHref("board"), "/studio");
  assert.equal(studioHref("platforms"), "/studio/platforms");
  assert.equal(studioHref("cpr_abc123", { sub: "timeline", tMs: 12500, versionId: "mev_1" }), "/studio/cpr_abc123?sub=timeline&v=mev_1&t=12.5");
  // The address the app's parser produces round-trips through studioRoute.
  const main = source("web/src/main.jsx");
  assert.match(main, /studio: lazy\(\(\) => import\("\.\/screens\/Studio\.jsx"\)\)/);
  assert.match(source("web/src/nav.js"), /id: "studio", label: "Studio", long: "Content Studio", icon: Clapperboard/);
});

test("M09-UI-02 timecodes at 30 fps: frames, mm:ss.ff and HH:MM:SS:FF; frame stepping", () => {
  const fps = { num: 30, den: 1 };
  assert.deepEqual(formatTimecode(12500, fps), { frame: 375, clock: "00:12.15", timecode: "00:00:12:15", ms: 12500 });
  assert.deepEqual(formatTimecode(0, fps), { frame: 0, clock: "00:00.00", timecode: "00:00:00:00", ms: 0 });
  assert.equal(formatTimecode(61000 + 1000 / 30 * 29, fps).clock, "01:01.29");
  assert.equal(formatTimecode(3600000, fps).timecode, "01:00:00:00");
  assert.equal(msToFrame(frameToMs(90, fps), fps), 90, "an exact frame start stays on its frame");
  assert.equal(msToFrame(stepFrameMs(12500, 1, fps), fps), 376);
  assert.equal(msToFrame(stepFrameMs(12500, -1, fps), fps), 374);
  assert.equal(stepFrameMs(0, -1, fps) >= 0, true, "never before 0");
  assert.equal(parseTimeInput("00:12.15", fps), Math.round(frameToMs(375, fps) + 0.5));
  assert.equal(parseTimeInput("12,5", fps), 12500);
  assert.equal(parseTimeInput("1:02", fps), 62000);
  assert.equal(parseTimeInput("1:75", fps), null);
  assert.equal(parseTimeInput("", fps), null);
  assert.equal(fmtDelta(1500), "+1,50 s");
  assert.equal(fmtDelta(-2000), "−2,00 s");
  assert.equal(fmtDelta(0), "0,00 s");
});

test("M09-UI-03 timecodes at 30000/1001 fps: frame index, clock that never drifts, non-drop timecode like the server", () => {
  const t = formatTimecode(12500, NTSC);
  assert.equal(t.frame, 374, "floor(12.5 × 29.97…)");
  assert.equal(t.clock, "00:12.14", "frame 360 is the first frame of second 12 → ff 14");
  assert.equal(t.timecode, "00:00:12:14", "non-drop timecode at the nominal 30");
  // One minute of real time: the clock shows 01:00, the NDF timecode is behind (1798 frames < 1800).
  const minute = formatTimecode(60000, NTSC);
  assert.equal(minute.frame, 1798);
  assert.equal(minute.clock, "00:59.29", "frame 1798 starts at 59,993 s");
  assert.equal(formatTimecode(frameToMs(1799, NTSC), NTSC).clock, "01:00.00", "frame 1799 (60,027 s) is the first of second 60");
  assert.equal(formatTimecode(60060, NTSC).clock, "01:00.01");
  assert.equal(minute.timecode, "00:00:59:28");
  // Every frame round-trips through its start time at a non-integer rate.
  for (const f of [0, 1, 29, 30, 1799, 1800, 107892]) assert.equal(msToFrame(frameToMs(f, NTSC), NTSC), f, `frame ${f}`);
  assert.equal(msToFrame(stepFrameMs(frameToMs(29, NTSC), 1, NTSC), NTSC), 30);
  // Invalid fps falls back to 30/1 instead of NaN.
  assert.equal(formatTimecode(1000, { num: 0, den: 1 }).frame, 30);
});

test("M09-UI-04 board columns: fixed order IDEAS…ANALYTICS, missing stages present and empty, unknown stages ignored, archived counted", () => {
  assert.deepEqual(BOARD_STAGES, ["IDEAS", "RESEARCH", "SCRIPT", "STORYBOARD", "PRODUCTION", "EDITING", "REVIEW", "SCHEDULED", "PUBLISHED", "ANALYTICS"]);
  const view = boardColumns({ columns: [{ stage: "REVIEW", label: "Revizie", cards: [{ id: "cpr_2" }] }, { stage: "IDEAS", cards: [{ id: "cpr_1" }, null, { title: "fără id" }] }, { stage: "BOGUS", cards: [{ id: "x" }] }], archived: 3 });
  assert.deepEqual(view.columns.map((c) => c.stage), BOARD_STAGES);
  assert.equal(view.columns[0].label, "Idei");
  assert.equal(view.columns[0].count, 1, "cards without an id are not rendered");
  assert.equal(view.columns.find((c) => c.stage === "REVIEW").count, 1);
  assert.equal(view.archived, 3);
  assert.equal(view.columns.some((c) => c.cards.some((x) => x.id === "x")), false);
  assert.deepEqual(boardColumns(null).columns.map((c) => c.count), BOARD_STAGES.map(() => 0));
});

test("M09-UI-05 measurable-progress rule: a percentage only when measured; a fact checklist otherwise; never a guess", () => {
  assert.equal(measurableProgress(null), null);
  assert.equal(measurableProgress({ percent: 40 }), null, "an unmeasured percent is not shown");
  assert.deepEqual(measurableProgress({ percent: 40.4, measured: true }), { kind: "percent", value: 40, text: "40%" });
  assert.equal(measurableProgress({ percent: 140, measured: true }), null);
  const c = measurableProgress({ done: 3, total: 9, steps: [{ key: "brief", label: "Brief", done: true }, { key: "edit", label: "Versiune de montaj", done: false }] });
  assert.equal(c.kind, "checklist");
  assert.equal(c.text, "3 din 9 fapte verificate");
  assert.equal(c.next, "Versiune de montaj");
  assert.equal(measurableProgress({ done: 10, total: 9 }), null);
  // Live render progress: measured percent kept, missing percent stays missing (the phase is shown instead).
  assert.equal(renderProgress({ phase: "final", percent: 72 }).percent, 72);
  assert.equal(renderProgress({ phase: "final" }).percent, null);
  assert.equal(renderProgress({ phase: "segments", segment: 2, segments: 3, cache: "hit", percent: 33 }).segment, "segment 2/3 (din cache)");
  assert.equal(pickPlayable([{ status: "DONE", profile: "draft", outputAssetVersionId: "a" }, { status: "DONE", profile: "final", outputAssetVersionId: "b" }, { status: "FAILED", profile: "final" }]).outputAssetVersionId, "b");
  assert.equal(pickPlayable([{ status: "RUNNING", profile: "final" }]), null);
});

test("M09-UI-06 timeline layout: lanes per track, clip duration with speed, capture labels as badges, active items under the playhead", () => {
  const ir = { fps: { num: 30, den: 1 }, tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_1", sourceIn: 0, sourceOut: 60, start: 0, label: "SIMULATION" }, { id: "c2", assetVersionId: "mav_2", sourceIn: 0, sourceOut: 120, start: 60, speed: 2 }] },
    { id: "t1", kind: "text", items: [{ id: "x1", start: 0, end: 45, text: "Demonstrație", style: "label" }] },
    { id: "cap", kind: "captions", cues: [{ id: "q1", start: 30, end: 90, text: "Subtitrare" }] },
    { id: "a1", kind: "audio", clips: [{ id: "m1", assetVersionId: "mav_3", sourceIn: 0, sourceOut: 120, start: 0, role: "music", gainDb: -20 }] },
    { id: "zz", kind: "unknown" },
  ] };
  const l = timelineLayout(ir);
  assert.equal(l.durationFrames, 120, "c2 lasts 120/2 = 60 frames");
  assert.equal(l.durationMs, 4000);
  assert.deepEqual(l.lanes.map((x) => x.kind), ["video", "text", "captions", "audio"]);
  const [c1, c2] = l.lanes[0].items;
  assert.equal(c1.badge, "SIMULATION");
  assert.equal(c2.badge, null);
  assert.equal(c2.startMs, 2000);
  assert.equal(c2.leftPct, 50);
  assert.equal(c2.widthPct, 50);
  const active = activeItemIds(l, 1600);
  assert.ok(active.has("v1:c1") && active.has("cap:q1") && active.has("a1:m1"));
  assert.ok(!active.has("t1:x1"), "the text ended at 1,5 s");
  assert.deepEqual(timelineLayout(null).lanes, []);
});

test("M09-UI-07 proposals and QA: operations in Romanian, diff preview with duration delta, latest QA per kind sorted by severity", () => {
  assert.match(describeOp({ op: "move_text", itemId: "x1", dx: 0, dy: -0.05 }), /Mută textul x1 mai sus/);
  assert.match(describeOp({ op: "extend_clip", clipId: "c2", frames: 60 }), /Prelungește clipul c2 cu 60 cadre/);
  assert.match(describeOp({ op: "replace_text", itemId: "x1", text: "Nou" }), /„Nou”/);
  const pv = proposalPreview({ ops: [{ op: "extend_clip", clipId: "c2", frames: 60 }], preview: { valid: true, errors: [], diff: { durationMs: { before: 4000, after: 6000, delta: 2000 }, summary: ["Durata: 4,00 s → 6,00 s (+2,00 s)."], counts: { modified: 1 } } } });
  assert.equal(pv.hasOps, true);
  assert.equal(pv.valid, true);
  assert.equal(pv.durationDelta, 2000);
  assert.equal(pv.durationText, "4,00 s → 6,00 s (+2,00 s)");
  assert.equal(proposalPreview({ ops: [], clarification: "Spune momentul" }).hasOps, false);
  const qa = latestQa([
    { kind: "technical", status: "WARN", createdAt: "b", findings: [{ id: "TEC-1", severity: "warning", range: { fromMs: 900 } }, { id: "TEC-2", severity: "error", range: { fromMs: 2000 } }] },
    { kind: "technical", status: "PASS", createdAt: "a", findings: [{ id: "OLD", severity: "error" }] },
    { kind: "factual", status: "FAIL", createdAt: "b", findings: [{ id: "FAC-1", severity: "error", range: { fromMs: 100 } }] },
  ]);
  assert.deepEqual(qa.kinds.map((k) => k.kind), ["technical", "factual"]);
  assert.deepEqual(qa.findings.map((f) => f.id), ["FAC-1", "TEC-2", "TEC-1"], "errors first, then by time; the older run is ignored");
});

test("M09-UI-08 distribution rows and CSV mapping: hashes per platform, platform of a profile, header detection, suggested mapping", () => {
  const profiles = { reels_9x16: { platform: "instagram" }, youtube_16x9: { platform: "youtube" } };
  assert.equal(platformOfProfile(profiles, "reels_9x16"), "instagram");
  assert.equal(platformOfProfile(profiles, "nope"), null);
  const rows = manifestRows({ body: { variants: [{ platform: "youtube", variantId: "mvr_1", account: "Ifrim Digital", caption: "Text", captionSha256: "a".repeat(64), media: { sha256: "b".repeat(64) }, schedule: null, disclosure: { aiGenerated: true } }] } },
    { byPlatform: { youtube: { status: "PACK_READY", attemptId: "cra_1", url: null } } });
  assert.equal(rows[0].mediaSha256, "b".repeat(64));
  assert.equal(rows[0].rendered, true);
  assert.equal(rows[0].release.status, "PACK_READY");
  assert.match(rows[0].schedule, /manual/);
  assert.match(rows[0].disclosure, /AI/);
  const h = csvHeaders("﻿Data;Vizualizări;\"Aprecieri; total\"\r\n2026-10-01;10;2\r\n");
  assert.equal(h.delimiter, ";");
  assert.deepEqual(h.headers, ["Data", "Vizualizări", "Aprecieri; total"]);
  const m = suggestMapping(["Data", "Vizualizări", "likes", "Altceva"], { views: { label: "Vizualizări" }, likes: { label: "Aprecieri" } });
  assert.deepEqual(m, { Data: "@date", "Vizualizări": "views", likes: "likes", Altceva: "@ignore" });
});

test("M09-UI-09 fail-safe paths: the Studio's stops/revocations are fail-safe on client and server; its effectful writes are not; the shared list is unchanged", () => {
  for (const p of STUDIO_FAILSAFE_PATHS) {
    const filled = fillPath(p, "mrj_abc");
    assert.equal(isFailsafePath(filled), true, `client: ${filled}`);
    assert.ok(FAILSAFE_PATHS.includes(p.replace("{id}", "*")), `server: ${p}`);
  }
  for (const p of STUDIO_GUARDED_PATHS) assert.equal(isFailsafePath(fillPath(p, "cmf_abc")), false, `not fail-safe: ${p}`);
  // The Studio adds no fail-safe entry of its own: the client list mirrors the server list exactly (same patterns, same order).
  const client = source("web/src/api.js");
  const block = client.slice(client.indexOf("const FAILSAFE = ["), client.indexOf("];", client.indexOf("const FAILSAFE = [")));
  const clientPatterns = [...block.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(clientPatterns, [...FAILSAFE_PATHS]);
  for (const file of ["web/src/lib/studioLogic.js", "web/src/screens/Studio.jsx"]) assert.doesNotMatch(source(file), /FAILSAFE\s*=\s*\[/, `${file} defines no fail-safe list`);
  // Opening the Studio never starts the microphone or a recording.
  const studioSources = ["web/src/screens/Studio.jsx", ...fs.readdirSync(path.join(here, "..", "web/src/screens/studio")).map((f) => `web/src/screens/studio/${f}`)];
  for (const file of studioSources) assert.doesNotMatch(source(file), /getUserMedia|MediaRecorder|startVoice|voiceEngine|\/api\/voice/, `${file} touches no microphone`);
});
