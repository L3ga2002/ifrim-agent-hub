import { resolvePresentation, storyFromPresentation } from "../server/delivery/presentation.mjs";
// Milestone 11 — the delivery master clip (v2/server/delivery/clip-ir.mjs), pure: a valid EditProjectIR v1 from two captures of the
// verified preview, hard cuts, the always-on synthetic-data label, tone texts gated by PASS criteria, markers and evidence regions,
// toneOps, the marker jump and applyPrefs. Checked with the REAL validateIR, the real QA checks (layout / factual / editorial), the
// real review applyOps and the real variant derivation — on hand-built capture descriptions (no files, no ffmpeg, no browser).
import test from "node:test";
import assert from "node:assert/strict";
import { validateIR, irHash, timelineDuration, clipDuration, primaryVideoTrack, framesToMs, msToFrames } from "../server/media/ir.mjs";
import { layoutCheck, factualCheck, editorialCheck } from "../server/media/qa.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import { applyOps, isDisclosureItem } from "../server/media/review.mjs";
import { PRESETS } from "../server/media/visual-bible.mjs";
import {
  CLIP_LABEL_TEXT, CLIP_LABEL_TEXT_SIMULATION, TONES, TEXT_IDS, LABEL_ITEM_ID, CLIP_IDS, TONE_SLOTS, PACING, MASTER_PRESET,
  buildMaster, buildMasterIR, toneOps, textsForTone, criteriaForClaims, passedCriteria, jumpCut, applyPrefs, markerTable, markerNeedles, markerMatch, fmtTime,
} from "../server/delivery/clip-ir.mjs";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";

// ---------------------------------------------------------------- fixtures

const TEXTS = {
  hook: { criteria: ["AC-1"], business: "Programări online pentru detailing — demo", technical: "Fix verificat: intervalele ocupate pe telefon (AC-1)" },
  desktop: { criteria: ["AC-7"], business: "Clientul alege serviciul și ora", technical: "E2E desktop 1280×800: PASS" },
  mobile: { criteria: ["AC-1", "AC-6"], business: "Pe telefon, orele ocupate nu mai pot fi alese", technical: "AC-1 + AC-6: interval ocupat → indisponibil (390 px)" },
  cta: { criteria: [], business: "Hai să discutăm", technical: "Pachet local, gata de verificare" },
};
const BOOKED = ".slot[data-booked='true'][aria-disabled='true']";
const BOOKED_RECT = { x: 0.25, y: 0.45, w: 0.12, h: 0.06 };
/** Markers as media/capture.mjs records them for the capture script of the template (highlight rects normalized to the viewport). */
const captureMarkers = (role) => [
  { id: "mmk_1", kind: "chapter", atMs: 0, note: "intro", source: "step" },
  { id: "mmk_2", kind: "demo", atMs: 800, note: `programare ${role === "desktop" ? "desktop" : "mobil"}`, source: "step" },
  { kind: "highlight", atMs: 820, note: "label[data-service='spalare-exterior']", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.08 } },
  { kind: "highlight", atMs: 2300, note: "button[data-day='1']", rect: { x: 0.3, y: 0.32, w: 0.1, h: 0.05 } },
  { kind: "highlight", atMs: 4000, note: BOOKED, rect: BOOKED_RECT },
  { kind: "highlight", atMs: 5400, note: ".slot[data-booked='false'][aria-disabled='false']", rect: { x: 0.4, y: 0.45, w: 0.12, h: 0.06 } },
  { kind: "highlight", atMs: 10000, note: "button[type='submit']", rect: { x: 0.1, y: 0.8, w: 0.3, h: 0.07 } },
  { kind: "highlight", atMs: 11800, note: "[data-state='success']", rect: { x: 0.1, y: 0.7, w: 0.8, h: 0.08 } }, // SUCCESS_RECT
  { kind: "proof", atMs: 13000, note: "Programare confirmată" },
];
const DESK_MS = 17600, MOB_MS = 16500; // 528 and 495 frames at 30 fps
const PROOF = "[data-state='success']";

test("M11-CI-14 text claims and footage claims remain distinct; a missing slot claim omits its text", () => {
  const built = buildMaster(input({ claimIdBySlot: { hook: "ccl_hook", mobile: "ccl_mobile", cta: "ccl_cta" }, claimIdByRole: { desktop: "ccl_capture_desk", mobile: "ccl_capture_mob" } }));
  const texts = built.ir.tracks.filter(t => t.kind === "text").flatMap(t => t.items);
  assert.ok(!texts.some(i => i.id === "t-desktop"));
  assert.deepEqual(texts.find(i => i.id === "t-hook").claimIds, ["ccl_hook"]);
  const clips = primaryVideoTrack(built.ir).clips;
  assert.deepEqual(clips[0].claimIds, ["ccl_capture_desk"]);
  assert.deepEqual(clips[1].claimIds, ["ccl_capture_mob"]);
  assert.ok(built.ir.evidenceRegions.every(r => ["ccl_capture_desk", "ccl_capture_mob"].includes(r.claimId)));
});
const SUCCESS_RECT = { x: 0.1, y: 0.7, w: 0.8, h: 0.08 };
const input = (over = {}, label = "ORIGINAL_RECORDING") => ({
  captures: [
    { role: "desktop", assetVersionId: "mav_desk", durationMs: DESK_MS, width: 1920, height: 1080, captureLabel: label, markers: captureMarkers("desktop"), evidenceSelectors: [BOOKED], proofSelector: PROOF },
    { role: "mobile", assetVersionId: "mav_mob", durationMs: MOB_MS, width: 780, height: 1688, captureLabel: label, markers: captureMarkers("mobile"), evidenceSelectors: [BOOKED], proofSelector: PROOF },
  ],
  texts: TEXTS, tone: "both", passed: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7"],
  claimIdsByCriterion: { "AC-1": "ccl_ac1", "AC-6": "ccl_ac6", "AC-7": "ccl_ac7" },
  deliveryId: "dlv_mux1abcd_0123456789", title: "Livrare: Demo Livrare — demo", noun: "programare", evidenceNote: "interval ocupat pe telefon",
  ...over,
});
const versions = (label = "ORIGINAL_RECORDING") => (id) => ({ id, status: "READY", origin: "OWNED", capture_label: label, kind: "video",
  probe: { hasVideo: true, hasAudio: false, container: "mov,mp4", durationMs: id === "mav_desk" ? DESK_MS : MOB_MS, video: id === "mav_desk" ? { width: 1920, height: 1080 } : { width: 780, height: 1688 } } });
const CLAIMS = ["ccl_ac1", "ccl_ac6", "ccl_ac7"].map((id) => ({ id, status: "SUPPORTED", text: id, evidence: [{ kind: "bundle", ref: "bnd_x", sha256: "a".repeat(64) }, { kind: "test", ref: "fev_x" }] }));
const textItems = (ir) => ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items);
const item = (ir, id) => textItems(ir).find((i) => i.id === id) || null;
const codes = (report) => report.findings.map((f) => f.code);
const throwsCode = (fn, expected) => assert.throws(fn, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); return true; });

// ---------------------------------------------------------------- the IR

test("M11-CI-01 buildMasterIR returns a valid EditProjectIR v1: desktop then phone-width capture, contain, HARD CUTS only", () => {
  const ir = buildMasterIR(input());
  const checked = validateIR(ir, { presets: PRESETS, getVersion: versions() });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.warnings.map((w) => w.code), []);
  assert.deepEqual([ir.irVersion, ir.fps, ir.canvas.width, ir.canvas.height, ir.preset, ir.language], [1, { num: 30, den: 1 }, 1920, 1080, { ...MASTER_PRESET }, "ro"]);
  const clips = primaryVideoTrack(ir).clips;
  assert.deepEqual(clips.map((c) => [c.id, c.assetVersionId, c.sourceIn, c.sourceOut, c.start, c.fit]), [["c-desktop", "mav_desk", 0, 528, 0, "contain"], ["c-mobile", "mav_mob", 0, 495, 528, "contain"]]);
  // Hard cuts: no transition anywhere, clips contiguous, no speed change, no audio, no captions.
  for (const c of clips) { assert.equal(c.transitionIn, undefined); assert.equal(c.speed, undefined); }
  assert.equal(clips[1].start, clips[0].start + clipDuration(clips[0]));
  assert.equal(timelineDuration(ir), 1023);
  assert.deepEqual(ir.tracks.map((t) => [t.id, t.kind]), [["v-main", "video"], ["tr-label", "text"], ["tr-story", "text"]]);
  assert.deepEqual([CLIP_IDS.desktop, CLIP_IDS.mobile], ["c-desktop", "c-mobile"]);
  // meta: labels, author 'delivery:<id>', and that no model was involved.
  assert.deepEqual(ir.meta.labels, ["ORIGINAL_RECORDING"]);
  assert.equal(ir.meta.author, "delivery:dlv_mux1abcd_0123456789");
  assert.match(ir.meta.notes, /fără model/);
  assert.equal(ir.meta.title, "Livrare: Demo Livrare — demo");
  // A hard cut at the clip boundary can be cut through later (review.mjs refuses a cut that touches a transition).
  const cut = applyOps(ir, [{ op: "cut_range", from: 500, to: 560 }]);
  assert.equal(validateIR(cut, { presets: PRESETS }).ok, true);
  assert.equal(timelineDuration(cut), 963);
});

test("M11-CI-02 the synthetic-data label covers 100% of the timeline; a SIMULATION capture adds the disclosure word and passes factual QA", () => {
  const ir = buildMasterIR(input());
  const D = timelineDuration(ir);
  const label = item(ir, LABEL_ITEM_ID);
  assert.deepEqual([label.start, label.end, label.text, label.style], [0, D, "DATE SINTETICE · DEMO LOCAL", "label"]);
  assert.equal(label.text, CLIP_LABEL_TEXT);
  assert.equal(isDisclosureItem(label), true); // never the target of an unqualified „textul”
  assert.equal(textItems(ir).filter((i) => i.style === "label").length, 1);
  // SIMULATION (test mode or a SIMULARE bundle): the clips say so and the label starts with the whole word SIMULARE.
  const sim = buildMasterIR(input({}, "SIMULATION"));
  assert.equal(item(sim, LABEL_ITEM_ID).text, "SIMULARE · DATE SINTETICE · DEMO LOCAL");
  assert.equal(item(sim, LABEL_ITEM_ID).text, CLIP_LABEL_TEXT_SIMULATION);
  assert.deepEqual(primaryVideoTrack(sim).clips.map((c) => c.label), ["SIMULATION", "SIMULATION"]);
  assert.deepEqual(sim.meta.labels, ["SIMULATION"]);
  const factual = factualCheck({ ir: sim, claims: CLAIMS, getVersion: versions("SIMULATION") });
  assert.ok(codes(factual).length > 0 && codes(factual).every(c => c === "TEXT_CLAIM_MISSING")); // no LABEL_MISSING, no LABEL_PARTIAL, no LABEL_NOT_DECLARED
  assert.equal(factual.status, "FAIL");
  assert.equal(factual.measurements.labelledClips, 2);
  assert.deepEqual(validateIR(sim, { presets: PRESETS, getVersion: versions("SIMULATION") }).warnings.map((w) => w.code), []);
  // The honest counter-check: the same SIMULATION clips WITHOUT the label fail factual QA.
  const stripped = JSON.parse(JSON.stringify(sim));
  stripped.tracks = stripped.tracks.filter((t) => t.id !== "tr-label");
  assert.ok(codes(factualCheck({ ir: stripped, claims: CLAIMS, getVersion: versions("SIMULATION") })).includes("LABEL_MISSING"));
  // One SIMULATION capture is enough for the disclosure over the whole timeline.
  const mixed = input();
  mixed.captures[1].captureLabel = "SIMULATION";
  const mixedIr = buildMasterIR(mixed);
  assert.equal(item(mixedIr, LABEL_ITEM_ID).text, CLIP_LABEL_TEXT_SIMULATION);
  assert.deepEqual(primaryVideoTrack(mixedIr).clips.map((c) => c.label), ["ORIGINAL_RECORDING", "SIMULATION"]);
  // After a cut the label still covers everything.
  const cut = applyOps(sim, [{ op: "cut_range", from: 300, to: 552 }]);
  assert.deepEqual([item(cut, LABEL_ITEM_ID).start, item(cut, LABEL_ITEM_ID).end], [0, timelineDuration(cut)]);
  assert.ok(codes(factualCheck({ ir: cut, claims: CLAIMS, getVersion: versions("SIMULATION") })).every(c => c === "TEXT_CLAIM_MISSING"));
});

test("M11-CI-03 capture markers map to frames (round(ms·30/1000) + the clip offset); the IR carries the five story markers", () => {
  const { ir, markers } = buildMaster(input());
  assert.deepEqual(ir.markers, [
    { frame: 0, kind: "chapter", note: "intro" },
    { frame: 24, kind: "demo", note: "programare desktop" },            // 800 ms → 24
    { frame: 552, kind: "demo", note: "programare mobil" },             // 528 + 24
    { frame: 648, kind: "evidence", note: "interval ocupat pe telefon" }, // 528 + round(4000·30/1000) = 528 + 120
    { frame: 948, kind: "cta", note: "final" },                         // the CTA's first frame: 1023 − 75
  ]);
  assert.equal(msToFrames(4000, { num: 30, den: 1 }) + 528, 648);
  assert.deepEqual(markers.map((m) => [m.time, m.note]), [["0:00", "intro"], ["0:00,8", "programare desktop"], ["0:18,4", "programare mobil"], ["0:21,6", "interval ocupat pe telefon"], ["0:31,6", "final"]]);
  assert.deepEqual(markerTable(ir), markers);
  // No capture 'proof' marker becomes an IR marker: its note is the success TEXT („Programare confirmată”) and would shadow the noun.
  assert.ok(!ir.markers.some((m) => /confirmat/i.test(m.note)));
  // A marker past the end of a capture stays inside its clip.
  const late = input();
  late.captures[1].markers = [{ kind: "demo", atMs: 999999, note: "programare mobil" }];
  const lateIr = buildMasterIR(late);
  assert.equal(lateIr.markers.find((m) => m.note === "programare mobil").frame, 1022);
  assert.equal(validateIR(lateIr, { presets: PRESETS }).ok, true);
  // Without the noun the capture's own demo note is used; without evidence selectors there is no evidence marker (never a guess).
  const bare = buildMaster(input({ noun: undefined, evidenceNote: undefined, captures: input().captures.map((c) => ({ ...c, evidenceSelectors: undefined, proofSelector: undefined })) }));
  assert.deepEqual(bare.ir.markers.map((m) => [m.kind, m.note]), [["chapter", "intro"], ["demo", "programare desktop"], ["demo", "programare mobil"], ["cta", "final"]]);
  assert.ok(bare.notes.some((n) => /marcajul de dovadă/.test(n)));
  assert.equal(fmtTime(0), "0:00");
  assert.equal(fmtTime(18400), "0:18,4");
  assert.equal(fmtTime(62000), "1:02");
});

test("M11-CI-04 evidence regions come from the highlight rects through the contain framing, each with the clip's claim; focus = the primary evidence", () => {
  const ir = buildMasterIR(input());
  const desktop = ir.evidenceRegions.filter((r) => r.clipId === "c-desktop");
  const mobile = ir.evidenceRegions.filter((r) => r.clipId === "c-mobile");
  // Evidence = what the criterion CHECKS (the booked slot of expectSelector, the success state), not what a step merely clicks.
  assert.deepEqual(desktop.map((r) => [r.from, r.to, r.rect]), [[120, 165, BOOKED_RECT], [354, 399, SUCCESS_RECT]]);
  assert.equal(mobile.length, 2);
  // Desktop 1920×1080 on a 1920×1080 canvas: identity. [from, to) = the highlight's moment + 1.5 s.
  const booked = desktop.find((r) => r.from === 120);
  assert.deepEqual(booked, { clipId: "c-desktop", from: 120, to: 165, rect: BOOKED_RECT, claimId: "ccl_ac7" });
  assert.equal(booked.to - booked.from, msToFrames(PACING.evidenceHoldMs, ir.fps));
  // Phone capture 780×1688 → a centred pillarbox: scale = 1080/1688, width = 780·scale/1920 of the canvas.
  const dw = (780 * (1080 / 1688)) / 1920, dx = (1 - dw) / 2;
  const m = mobile.find((r) => r.from === 648);
  assert.ok(Math.abs(m.rect.x - (dx + BOOKED_RECT.x * dw)) < 1e-4, JSON.stringify(m.rect));
  assert.ok(Math.abs(m.rect.w - BOOKED_RECT.w * dw) < 1e-4);
  assert.deepEqual([m.rect.y, m.rect.h, m.claimId], [0.45, 0.06, "ccl_ac1"]);
  for (const r of mobile) assert.ok(r.rect.x >= dx - 1e-4 && r.rect.x + r.rect.w <= dx + dw + 1e-4, "an evidence rect left the phone area");
  for (const r of ir.evidenceRegions) assert.ok(r.to > r.from && r.rect.w > 0 && r.rect.h > 0 && r.rect.x + r.rect.w <= 1 && r.rect.y + r.rect.h <= 1);
  // Focus (source space) = the first highlight that came from an expectSelector step, not the first click.
  assert.deepEqual(primaryVideoTrack(ir).clips.map((c) => c.focus), [BOOKED_RECT, BOOKED_RECT]);
  // Without those lists nothing is dropped silently: every highlight rect is an evidence region and the focus is the first one.
  const plain = buildMasterIR(input({ captures: input().captures.map((c) => ({ ...c, evidenceSelectors: undefined, proofSelector: undefined })) }));
  assert.deepEqual(primaryVideoTrack(plain).clips[0].focus, { x: 0.1, y: 0.2, w: 0.3, h: 0.08 });
  assert.deepEqual([plain.evidenceRegions.filter((r) => r.clipId === "c-desktop").length, plain.evidenceRegions.filter((r) => r.clipId === "c-mobile").length], [6, 6]);
  // Degenerate or missing rects are skipped, never invented; a rect that spills over the edge is clipped.
  const odd = input();
  odd.captures[0].markers = [{ kind: "highlight", atMs: 1000, note: BOOKED, rect: { x: 0.5, y: 0.5, w: 0, h: 0.1 } }, { kind: "highlight", atMs: 2000, note: BOOKED },
    { kind: "highlight", atMs: 3000, note: BOOKED, rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }, { kind: "highlight", atMs: 4000, note: BOOKED, rect: { x: 2, y: 0, w: 0.1, h: 0.1 } }];
  const oddIr = buildMasterIR(odd);
  assert.deepEqual(oddIr.evidenceRegions.filter((r) => r.clipId === "c-desktop").map((r) => r.rect), [{ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }]);
  assert.equal(validateIR(oddIr, { presets: PRESETS }).ok, true);
});

test("M11-CI-05 a text appears only when ALL its criteria are PASS; a non-PASS criterion produces no text and no claim", () => {
  const all = buildMaster(input());
  assert.deepEqual(all.included, ["t-hook", "t-desktop", "t-mobile", "t-cta"]);
  assert.deepEqual(all.omitted, []);
  assert.deepEqual(all.claims, { "c-desktop": ["ccl_ac7"], "c-mobile": ["ccl_ac1", "ccl_ac6"] });
  assert.deepEqual(primaryVideoTrack(all.ir).clips.map((c) => c.claimIds), [["ccl_ac7"], ["ccl_ac1", "ccl_ac6"]]);
  // AC-1 NEVERIFICAT: the phone text and the hook (both claim AC-1) are gone, and so is AC-1's claim.
  const noAc1 = buildMaster(input({ passed: ["AC-2", "AC-3", "AC-6", "AC-7"] }));
  assert.equal(item(noAc1.ir, "t-mobile"), null);
  assert.equal(item(noAc1.ir, "t-hook"), null);
  assert.ok(item(noAc1.ir, "t-desktop") && item(noAc1.ir, "t-cta"));
  assert.deepEqual(noAc1.omitted, [{ id: "t-hook", reason: "CRITERIA_NOT_PASS", criteria: ["AC-1"] }, { id: "t-mobile", reason: "CRITERIA_NOT_PASS", criteria: ["AC-1"] }]);
  assert.deepEqual(primaryVideoTrack(noAc1.ir).clips[1].claimIds, ["ccl_ac6"]);
  assert.ok(!JSON.stringify(noAc1.ir).includes("ccl_ac1"));
  assert.ok(noAc1.ir.evidenceRegions.filter((r) => r.clipId === "c-mobile").every((r) => r.claimId === "ccl_ac6"));
  assert.equal(validateIR(noAc1.ir, { presets: PRESETS }).ok, true);
  // AC-7 not PASS: no desktop text, no desktop claim, no desktop evidence region — the label and the CTA stay.
  const noAc7 = buildMaster(input({ passed: ["AC-1", "AC-6"] }));
  assert.equal(item(noAc7.ir, "t-desktop"), null);
  assert.equal(primaryVideoTrack(noAc7.ir).clips[0].claimIds, undefined);
  assert.deepEqual(noAc7.ir.evidenceRegions.filter((r) => r.clipId === "c-desktop"), []);
  assert.ok(item(noAc7.ir, LABEL_ITEM_ID) && item(noAc7.ir, "t-cta") && item(noAc7.ir, "t-hook") && item(noAc7.ir, "t-mobile"));
  // Nothing passed: only the label and the CTA (which claims nothing).
  const none = buildMaster(input({ passed: [] }));
  assert.deepEqual(textItems(none.ir).map((i) => i.id), [LABEL_ITEM_ID, "t-cta"]);
  assert.deepEqual(none.ir.evidenceRegions, []);
  // A PASS criterion without a recorded claim gives the text but no claim id (the claim is the service's to create first).
  const noClaims = buildMaster(input({ claimIdsByCriterion: {} }));
  assert.deepEqual(noClaims.included, ["t-hook", "t-desktop", "t-mobile", "t-cta"]);
  assert.deepEqual(noClaims.ir.evidenceRegions, []);
  assert.equal(noClaims.notes.length, 2);
  // Helpers for the caller.
  assert.deepEqual(criteriaForClaims(TEXTS, ["AC-7", "AC-1", "AC-6", "AC-2"]), ["AC-1", "AC-6", "AC-7"]);
  assert.deepEqual(criteriaForClaims(TEXTS, ["AC-6"]), ["AC-6"]);
  assert.deepEqual(passedCriteria([{ id: "AC-1", status: "PASS_EVIDENCE" }, { id: "AC-4", status: "PASS_REVIEW" }, { id: "AC-6", status: "NEVERIFICAT" }, { id: "AC-7", status: "FAIL" }]), ["AC-1", "AC-4"]);
});

test("M11-CI-06 tones: 'both' = business hook and CTA + technical evidence texts; toneOps touches only t-* items and only what changes", () => {
  assert.deepEqual([...TONES], ["both", "business", "technical"]);
  assert.deepEqual(TONE_SLOTS.both, { hook: "business", desktop: "technical", mobile: "technical", cta: "business" });
  const both = buildMasterIR(input());
  assert.deepEqual(["t-hook", "t-desktop", "t-mobile", "t-cta"].map((id) => item(both, id).text),
    [TEXTS.hook.business, TEXTS.desktop.technical, TEXTS.mobile.technical, TEXTS.cta.business]);
  assert.deepEqual(textsForTone(TEXTS, "technical"), { hook: TEXTS.hook.technical, desktop: TEXTS.desktop.technical, mobile: TEXTS.mobile.technical, cta: TEXTS.cta.technical });
  // „prea tehnic” → business: only the two technical texts change.
  const ops = toneOps(both, TEXTS, "business");
  assert.deepEqual(ops, [{ op: "replace_text", itemId: "t-desktop", text: TEXTS.desktop.business }, { op: "replace_text", itemId: "t-mobile", text: TEXTS.mobile.business }]);
  assert.ok(ops.every((o) => o.op === "replace_text" && Object.values(TEXT_IDS).includes(o.itemId)));
  assert.ok(!ops.some((o) => o.itemId === LABEL_ITEM_ID));
  // Applying them gives exactly the clip built in that tone (timing was sized for the longest variant of each text).
  const business = buildMasterIR(input({ tone: "business" }));
  assert.equal(irHash(applyOps(both, ops)), irHash(business));
  assert.deepEqual(toneOps(business, TEXTS, "business"), []);
  assert.equal(toneOps(both, TEXTS, "technical").length, 2); // hook and CTA
  assert.deepEqual(toneOps(business, TEXTS, "technical").map((o) => o.itemId), ["t-hook", "t-desktop", "t-mobile", "t-cta"]);
  // An item that is not in the IR (its criteria did not pass) gets no operation.
  const gated = buildMasterIR(input({ passed: ["AC-7"] }));
  assert.deepEqual(toneOps(gated, TEXTS, "business").map((o) => o.itemId), ["t-desktop"]);
  // The owner's kept tone wins over the default.
  assert.equal(irHash(buildMasterIR(input({ tone: "both", prefs: { tone: "business" } }))), irHash(business));
  throwsCode(() => toneOps(both, TEXTS, "funny"), "CLIP_TONE_INVALID");
  throwsCode(() => buildMasterIR(input({ tone: "funny" })), "CLIP_TONE_INVALID");
});

test("M11-CI-07 pacing and legibility: one story text at a time, ≤ 15 characters/s in every tone, the CTA held ≥ 2.5 s, layout and editorial QA clean", () => {
  for (const tone of TONES) {
    const ir = buildMasterIR(input({ tone }));
    const story = ["t-hook", "t-desktop", "t-mobile", "t-cta"].map((id) => item(ir, id));
    // In order, never overlapping (they share one track), each inside its own clip.
    for (let i = 1; i < story.length; i += 1) assert.ok(story[i].start >= story[i - 1].end, `${story[i].id} overlaps ${story[i - 1].id}`);
    assert.ok(story[0].start === 0 && story[1].end <= 528 && story[2].start >= 528 && story[3].end === 1023);
    for (const t of story) {
      const cps = [...t.text].length / (framesToMs(t.end - t.start, ir.fps) / 1000);
      assert.ok(cps <= PACING.readCps + 0.01, `${tone} ${t.id}: ${cps.toFixed(1)} caractere/s`);
    }
    assert.ok(framesToMs(story[3].end - story[3].start, ir.fps) >= 2500);
    const layout = layoutCheck({ ir });
    assert.deepEqual(codes(layout), [], `${tone}: ${layout.findings.map((f) => f.message).join(" | ")}`);
    assert.deepEqual(codes(editorialCheck({ ir })), []);
    assert.ok(codes(factualCheck({ ir, claims: CLAIMS, getVersion: versions() })).every(c => c === "TEXT_CLAIM_MISSING"));
  }
  const ir = buildMasterIR(input());
  // The hook is on from the first frame; the phone text starts at the proof (the booked slot's highlight).
  assert.deepEqual([item(ir, "t-hook").start, item(ir, "t-hook").style, item(ir, "t-cta").style], [0, "hook", "cta"]);
  assert.equal(item(ir, "t-mobile").start, 648);
  assert.equal(item(ir, "t-cta").start, 948);
  // A text never sits on evidence shown at the same time: move the booked slot under the lower third and it goes to the top.
  const low = input();
  low.captures[0].markers = [{ kind: "demo", atMs: 800, note: "programare desktop" }, { kind: "highlight", atMs: 4500, note: BOOKED, rect: { x: 0.3, y: 0.8, w: 0.4, h: 0.1 } }];
  const moved = buildMaster(low);
  assert.equal(item(moved.ir, "t-desktop").anchor, "top");
  assert.deepEqual(codes(layoutCheck({ ir: moved.ir })), []);
  // A capture too short for a readable text omits it and says so (never a flash of text).
  const short = buildMaster(input({ captures: [{ ...input().captures[0], durationMs: 3000 }, input().captures[1]] }));
  assert.deepEqual(short.omitted, [{ id: "t-desktop", reason: "NO_ROOM", criteria: [] }]);
  assert.ok(short.notes.some((n) => /t-desktop/.test(n)));
  assert.equal(validateIR(short.ir, { presets: PRESETS }).ok, true);
});

test("M11-CI-08 jumpCut: the cut ends at the first matching MARKER after the time, never at a fixed second; applyPrefs reproduces it", () => {
  const ir = buildMasterIR(input());
  const jump = jumpCut(ir, { afterSec: 10, markerNote: "programarea" });
  assert.deepEqual([jump.ok, jump.from, jump.to, jump.marker.note, jump.needle], [true, 300, 552, "programare mobil", "programare"]);
  assert.deepEqual(jump.op, { op: "cut_range", from: 300, to: 552 });
  // 'programare desktop' (0:00,8) is before second 10, so the first match AFTER it is the phone one.
  assert.equal(jumpCut(ir, { afterSec: 0, markerNote: "programare" }).marker.note, "programare desktop");
  assert.equal(jumpCut(ir, { afterSec: 10, markerNote: "programarea pe telefon" }).marker.note, "programare mobil");
  assert.equal(jumpCut(ir, { afterSec: 10, markerNote: "intervalul ocupat" }).to, 648);
  assert.equal(jumpCut(ir, { afterSec: 10, markerNote: "finalul" }).to, 948); // by kind (cta)
  // Other capture timing → another frame for the same request: the cut follows the marker.
  const slower = input();
  slower.captures[0].durationMs = 21000;
  slower.captures[1].markers = captureMarkers("mobile").map((m) => (m.kind === "demo" ? { ...m, atMs: 1500 } : m));
  assert.equal(jumpCut(buildMasterIR(slower), { afterSec: 10, markerNote: "programare" }).to, 630 + 45);
  // No marker / past the end / invalid time: no cut, with the markers that exist after that time.
  const none = jumpCut(ir, { afterSec: 10, markerNote: "plata" });
  assert.deepEqual([none.ok, none.reason, none.candidates.map((m) => m.note)], [false, "NO_MARKER", ["programare mobil", "interval ocupat pe telefon", "final"]]);
  assert.deepEqual([jumpCut(ir, { afterSec: 25, markerNote: "programare" }).reason, jumpCut(ir, { afterSec: 600, markerNote: "programare" }).reason, jumpCut(ir, { afterSec: -1, markerNote: "x" }).reason, jumpCut(ir, { afterSec: 10, markerNote: "" }).reason],
    ["NO_MARKER", "AFTER_END", "TIME_INVALID", "NO_MARKER"]);
  // Two matching markers on the same frame: ambiguous, the owner chooses; a chosen frame resolves without words.
  const twin = JSON.parse(JSON.stringify(ir));
  twin.markers.push({ frame: 552, kind: "note", note: "programare rapidă" });
  const amb = jumpCut(twin, { afterSec: 10, markerNote: "programare" });
  assert.deepEqual([amb.ok, amb.reason, amb.candidates.length], [false, "AMBIGUOUS", 2]);
  assert.deepEqual(jumpCut(twin, { afterSec: 10, markerNote: "programare", markerFrame: 648 }).op, { op: "cut_range", from: 300, to: 648 });
  assert.equal(jumpCut(ir, { afterSec: 10, markerFrame: 100 }).ok, false); // not after the time
  // applyPrefs = that cut applied; buildMasterIR with the kept prefs gives the same clip after a regeneration.
  const prefs = { jump: { afterSec: 10, markerNote: "programare" } };
  const applied = applyPrefs(ir, prefs);
  assert.deepEqual(applied.applied, [{ pref: "jump", from: 300, to: 552, marker: "programare mobil" }]);
  assert.deepEqual(applied.skipped, []);
  assert.equal(irHash(applied.ir), irHash(applyOps(ir, [{ op: "cut_range", from: 300, to: 552 }])));
  assert.equal(irHash(buildMasterIR(input({ prefs }))), irHash(applied.ir));
  assert.equal(timelineDuration(applied.ir), 1023 - 252);
  assert.equal(validateIR(applied.ir, { presets: PRESETS }).ok, true);
  assert.equal(markerTable(applied.ir).find((m) => m.note === "programare mobil").frame, 300); // the clip now goes straight to it
  // A kept jump that no longer resolves is skipped and reported — the clip is returned uncut, never cut at a guessed second.
  const gone = applyPrefs(ir, { jump: { afterSec: 10, markerNote: "plata" } });
  assert.equal(irHash(gone.ir), irHash(ir));
  assert.deepEqual(gone.skipped.map((s) => [s.pref, s.reason]), [["jump", "NO_MARKER"]]);
  assert.ok(buildMaster(input({ prefs: { jump: { afterSec: 10, markerNote: "plata" } } })).notes.some((n) => /nu s-a putut aplica/.test(n)));
  assert.deepEqual(applyPrefs(ir, {}), { ir, applied: [], skipped: [] });
});

test("M11-CI-09 marker references: stems, synonyms and kinds — all the words must name the marker", () => {
  const hit = (marker, phrase) => markerMatch(marker, markerNeedles(phrase));
  const mobil = { kind: "demo", note: "programare mobil" };
  assert.deepEqual(hit(mobil, "programarea"), ["programare"]);
  assert.deepEqual(hit(mobil, "programările"), ["programare"]);
  assert.deepEqual(hit(mobil, "programarea de pe telefon"), ["programare", "mobil"]);
  assert.equal(hit(mobil, "programarea pe desktop"), null);
  assert.equal(hit(mobil, "plata"), null);
  assert.equal(hit(mobil, "la"), null); // only stop words: nothing to match
  assert.deepEqual(hit({ kind: "cta", note: "final" }, "sfârșitul"), ["sfarsit"]);
  assert.deepEqual(hit({ kind: "chapter", note: "intro" }, "începutul"), ["inceput"]);
  assert.deepEqual(hit({ kind: "evidence", note: "interval ocupat pe telefon" }, "dovada"), ["dovada"]);
});

test("M11-CI-10 deterministic: the same captures give the same IR hash, with the clock and Math.random poisoned", () => {
  const a = irHash(buildMasterIR(input()));
  const RealDate = globalThis.Date, realRandom = Math.random;
  const poison = () => { throw new Error("the clip builder read the clock or a random source"); };
  let b;
  globalThis.Date = new Proxy(RealDate, { construct: poison, apply: poison, get: (target, key) => (key === "now" ? poison : Reflect.get(target, key)) });
  Math.random = poison;
  try { b = irHash(buildMasterIR(JSON.parse(JSON.stringify(input())))); } finally { globalThis.Date = RealDate; Math.random = realRandom; }
  assert.equal(a, b);
  assert.notEqual(a, irHash(buildMasterIR(input({ tone: "business" }))));
  assert.notEqual(a, irHash(buildMasterIR(input({ passed: ["AC-7"] }))));
});

test("M11-CI-11 the vertical variant derives from the master: valid, the hook and CTA overrides land on t-hook / t-cta, the label stays", () => {
  const master = buildMasterIR(input({}, "SIMULATION"));
  const v = deriveVariant({ masterIr: master, platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" }, getVersion: versions("SIMULATION") });
  assert.equal(validateIR(v.ir, { presets: PRESETS, getVersion: versions("SIMULATION") }).ok, true);
  assert.deepEqual([v.ir.canvas.width, v.ir.canvas.height], [1080, 1920]);
  assert.equal(item(v.ir, "t-hook").text, "Programări online — demo");
  assert.equal(item(v.ir, "t-cta").text, "Hai să vorbim");
  assert.equal(item(v.ir, LABEL_ITEM_ID).text, CLIP_LABEL_TEXT_SIMULATION);
  assert.deepEqual([item(v.ir, LABEL_ITEM_ID).start, item(v.ir, LABEL_ITEM_ID).end], [0, timelineDuration(v.ir)]);
  // Evidence is never cut silently: a letterbox is a shown finding, not an error.
  assert.ok(!v.findings.some((f) => f.severity === "error"), JSON.stringify(v.findings));
  assert.ok(v.findings.every((f) => f.code === "EVIDENCE_REQUIRES_LETTERBOX"));
  assert.ok(codes(factualCheck({ ir: v.ir, claims: CLAIMS, getVersion: versions("SIMULATION") })).every(c => c === "TEXT_CLAIM_MISSING"));
  const layout = layoutCheck({ ir: v.ir, profile: "shorts_9x16" });
  assert.ok(!layout.findings.some((f) => f.severity === "error"), layout.findings.map((f) => f.message).join(" | "));
  // The markers the revision needs survive in the variant.
  assert.deepEqual(v.ir.markers.map((m) => m.note), master.markers.map((m) => m.note));
});

test("M11-CI-12 inputs are validated: both captures, a known label, valid ids, complete texts", () => {
  throwsCode(() => buildMasterIR(input({ captures: [input().captures[0]] })), "CLIP_CAPTURES_INVALID");
  throwsCode(() => buildMasterIR(input({ captures: [input().captures[0], input().captures[0]] })), "CLIP_CAPTURES_INVALID");
  throwsCode(() => buildMasterIR(input({ captures: null })), "CLIP_CAPTURES_INVALID");
  throwsCode(() => buildMasterIR(input({}, "GENERATED")), "CLIP_CAPTURES_INVALID");
  throwsCode(() => buildMasterIR(input({}, null)), "CLIP_CAPTURES_INVALID"); // the label is never guessed
  throwsCode(() => buildMasterIR(input({ captures: [{ ...input().captures[0], assetVersionId: "../x" }, input().captures[1]] })), "CLIP_CAPTURES_INVALID");
  throwsCode(() => buildMasterIR(input({ captures: [{ ...input().captures[0], durationMs: 400 }, input().captures[1]] })), "CLIP_CAPTURE_TOO_SHORT");
  throwsCode(() => buildMasterIR(input({ texts: { ...TEXTS, cta: { criteria: [], business: "", technical: "x" } } })), "CLIP_TEXTS_INVALID");
  throwsCode(() => buildMasterIR(input({ texts: null })), "CLIP_TEXTS_INVALID");
  throwsCode(() => buildMasterIR(input({ claimIdsByCriterion: { "AC-1": "id cu spații" } })), "CLIP_CLAIMS_INVALID");
  throwsCode(() => buildMasterIR(input({ canvas: { width: 1921, height: 1080 } })), "CLIP_CANVAS_INVALID");
  // A source shorter than the builder was told is caught by the real asset check.
  throwsCode(() => buildMasterIR(input({ getVersion: (id) => ({ ...versions()(id), probe: { ...versions()(id).probe, durationMs: 5000 } }) })), "DELIVERY_IR_INVALID");
  assert.equal(validateIR(buildMasterIR(input({ getVersion: versions() })), { presets: PRESETS, getVersion: versions() }).ok, true);
});

test("M11-CI-13 no text on screen names a criterion that did not pass: in every tone and for every set of PASS criteria, a shown text cites only criteria of its own gate", () => {
  const cited = (text) => [...new Set((String(text).match(/AC-\d{1,3}/g) || []))];
  // The texts of this file are the real ones of the booking fixture; each cites only criteria of its own list.
  assert.deepEqual(TEXTS, Object.fromEntries(Object.entries(storyFromPresentation(resolvePresentation({ presentations: BOOKING_DEMO.delivery.presentations, spec: BOOKING_DEMO.spec, specSha: "a".repeat(64) })).texts).map(([k, { claim, ...v }]) => [k, v])));
  for (const [slot, entry] of Object.entries(TEXTS)) for (const tone of ["business", "technical"]) {
    assert.deepEqual(cited(entry[tone]).filter((id) => !entry.criteria.includes(id)), [], `texts.${slot}.${tone} cites a criterion it is not gated on`);
  }
  assert.equal(TEXTS.hook.technical, "Fix verificat: intervalele ocupate pe telefon (AC-1)");
  // Every subset of the criteria the texts are gated on × every tone: what is shown names only what passed.
  const gates = ["AC-1", "AC-6", "AC-7"];
  let checked = 0;
  for (let mask = 0; mask < 1 << gates.length; mask += 1) {
    const passed = gates.filter((_, i) => mask & (1 << i));
    for (const tone of TONES) {
      const built = buildMaster(input({ tone, passed: [...passed, "AC-2", "AC-3", "AC-4", "AC-5"] }));
      for (const shown of textItems(built.ir)) {
        assert.deepEqual(cited(shown.text).filter((id) => !passed.includes(id)), [], `${tone}, PASS = [${passed.join(", ")}]: ${shown.id} „${shown.text}” names a criterion that did not pass`);
        checked += 1;
      }
      // And nothing is shown for a slot whose gate did not pass.
      for (const [slot, id] of Object.entries(TEXT_IDS)) assert.equal(Boolean(item(built.ir, id)), TEXTS[slot].criteria.every((c) => passed.includes(c)), `${tone}, PASS = [${passed.join(", ")}]: ${id}`);
    }
  }
  assert.ok(checked > 60, String(checked));
  // The scenario of the cross-check: technical tone, everything passed but AC-6. The hook stays (it is gated on AC-1 alone) and
  // names AC-1 alone; the phone-width text is left out as CRITERIA_NOT_PASS.
  const noAc6 = buildMaster(input({ tone: "technical", passed: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-7"] }));
  assert.equal(item(noAc6.ir, "t-hook").text, "Fix verificat: intervalele ocupate pe telefon (AC-1)");
  assert.deepEqual(noAc6.omitted, [{ id: "t-mobile", reason: "CRITERIA_NOT_PASS", criteria: ["AC-6"] }]);
  assert.ok(!JSON.stringify(textItems(noAc6.ir)).includes("AC-6"));
  // The counter-check: the earlier hook text („… (AC-1, AC-6)”, still gated on AC-1 alone) would have shown AC-6 there.
  const earlier = buildMaster(input({ tone: "technical", passed: ["AC-1", "AC-7"], texts: { ...TEXTS, hook: { ...TEXTS.hook, technical: "Fix verificat: intervalele ocupate pe telefon (AC-1, AC-6)" } } }));
  assert.deepEqual(cited(item(earlier.ir, "t-hook").text).filter((id) => !["AC-1", "AC-7"].includes(id)), ["AC-6"]);
  // A tone revision keeps the rule: the operations write the same gated texts.
  const toTechnical = toneOps(buildMasterIR(input({ tone: "business", passed: ["AC-1", "AC-7"] })), TEXTS, "technical");
  assert.deepEqual(toTechnical.map((o) => o.itemId), ["t-hook", "t-desktop", "t-cta"]);
  assert.deepEqual(toTechnical.flatMap((o) => cited(o.text)), ["AC-1"]);
});
