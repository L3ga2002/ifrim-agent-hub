// Milestone 11 — the delivery template (v2/server/delivery/template.mjs), pure: capture scripts derived from the approved E2E
// steps, eligibility blockers, the frozen template, the hashed envelope section and the deterministic package steps. Inline
// fixture objects in the shape of FACTORY_DEMOS['booking-demo'] (spec + delivery block); no Hub, no files, no model.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashCanonical, canonicalJson } from "../server/core/canonical.mjs";
import { checkSpec, specHash } from "../server/factory/spec.mjs";
import { validateDemoSteps, DEMO_STEP_KINDS } from "../server/media/capture.mjs";
import { validateE2ESteps } from "../server/tools/browser-core.mjs";
import {
  TEMPLATE_SCHEMA, STORY_TEMPLATE, SUMMARY_TEMPLATE, PACKAGE_KIND, DELIVERY_LIMITS, CAPTURE_PRESETS, CAPTURE_PACING, DELIVERY_NEVER, DELIVERY_DECISIONS_LEFT,
  normalizeDeliveryBlock, captureScriptFrom, e2eCriteria, pickCaptureCriteria, toolsOf, eligibility, exportFolderName, buildTemplate, templateSha, sectionOf,
  packageSteps, revisionSteps, citedCriteria,
} from "../server/delivery/template.mjs";
import { buildMaster } from "../server/delivery/clip-ir.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");

// ---------------------------------------------------------------- fixtures (the booking demo of the blueprint)

const e2eSteps = (width, height) => [
  { viewport: { width, height } }, { goto: "/" }, { noHorizontalOverflow: true },
  { click: "label[data-service='spalare-exterior']" }, { click: "button[data-day='1']" },
  { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" }, { click: ".slot[data-booked='false'][aria-disabled='false']" },
  { fill: { selector: "input[name='name']", value: "Client Demo {run}" } }, { fill: { selector: "input[name='vehicle']", value: "Autoturism test" } },
  { click: "button[type='submit']" }, { expectText: "Programare confirmată" },
];
const SPEC_INPUT = {
  workType: "BUGFIX", title: "Pe telefon, intervalele ocupate apar libere",
  objective: "Repară afișarea pe telefon a intervalelor ocupate, fără a schimba desktopul sau API-ul.",
  inScope: ["public/js/slots-view.mjs"], outOfScope: ["API", "date reale"],
  acceptance: [
    { id: "AC-1", text: "Pe telefon un interval ocupat apare indisponibil și nu poate fi ales", verify: "test", testRef: "test/acceptance.test.mjs", expectFailure: "interval_ocupat_liber_pe_mobil" },
    { id: "AC-2", text: "Pe desktop afișarea intervalelor rămâne aceeași", verify: "test", testRef: "test/acceptance.test.mjs" },
    { id: "AC-4", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" },
    { id: "AC-5", text: "Preview local pornit din versiunea verificată", verify: "preview" },
    { id: "AC-6", text: "Fluxul de programare la lățimea unui telefon", verify: "e2e", steps: e2eSteps(390, 844) },
    { id: "AC-7", text: "Fluxul de programare pe desktop", verify: "e2e", steps: e2eSteps(1280, 800) },
  ],
  verification: { checks: ["node --test"], acceptance: ["node --test test/acceptance.test.mjs"], preview: { command: "node server.js", url: "http://127.0.0.1:4620/" } },
  workspace: { ignore: ["data"] },
};
const { spec: SPEC, problems: SPEC_PROBLEMS } = checkSpec(SPEC_INPUT);
const DELIVERY_BLOCK = {
  noun: "programare", issue: "Pe telefon, intervalele ocupate apar libere", proofSelector: "[data-state='success']", bannerSelector: "[data-demo-banner]",
  evidenceNote: "interval ocupat pe telefon", exportPrefix: "demo-programari",
  texts: {
    hook: { criteria: ["AC-1"], business: "Programări online pentru detailing — demo", technical: "Fix verificat: intervalele ocupate pe telefon (AC-1)" },
    desktop: { criteria: ["AC-7"], business: "Clientul alege serviciul și ora", technical: "E2E desktop 1280×800: PASS" },
    mobile: { criteria: ["AC-1", "AC-6"], business: "Pe telefon, orele ocupate nu mai pot fi alese", technical: "AC-1 + AC-6: interval ocupat → indisponibil (390 px)" },
    cta: { criteria: [], business: "Hai să discutăm", technical: "Pachet local, gata de verificare" },
  },
  variant: { platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } },
};
const DEMO = { name: "Demo Livrare — Detailing (programări)", stack: "Node.js", workType: "BUGFIX", title: SPEC_INPUT.title, spec: SPEC_INPUT, delivery: DELIVERY_BLOCK };
const ROOT = path.resolve(HUB_ROOT, "..", "m11-template-projects-root"); // never created
// A TEST Hub's configuration: its port (45123) and a dev origin on another port (45124) — two independent sources of Hub ports.
const CONFIG = { testMode: true, port: 45123, allowedOrigins: new Set(["http://127.0.0.1:45124", "http://localhost:45124"]), projectsRoot: ROOT, hubRoot: path.join(ROOT, "Ifrim Agent Hub"),
  dataDir: path.join(path.resolve(HUB_ROOT, ".."), "m11-template-data", "private") };
const PROJECT = { id: "prj_mux0demo_0123456789", name: "Demo Livrare — Detailing (programări)", slug: "demo-livrare-detailing-programari", source: "hub-test", path: path.join(ROOT, "ifrim-delivery-demo-detailing") };
const MARKER = { createdBy: "ifrim-agent-hub", purpose: "live-validation", name: DEMO.name, stack: "Node.js", fixture: "booking-demo", data: "synthetic", createdAt: "2026-10-05T10:00:00.000Z" };
const MISSION_VIEW = { mission: { id: "mis_mux0demo_aaaaaaaaaa", title: SPEC_INPUT.title, projectId: PROJECT.id }, spec: { version: 1, status: "DRAFT", sha256: "a".repeat(64), spec: SPEC } };
const IDENTITY = { ffmpeg: { version: "7.1", sha256: "f".repeat(64), libsSha256: "1".repeat(64) }, ffprobe: { version: "7.1", sha256: "e".repeat(64), libsSha256: "1".repeat(64) } };
const EXPORTS = path.join(path.resolve(HUB_ROOT, ".."), "m11-template-videos", "Ifrim Studio", "Exporturi");
const APPROVED = [path.join(path.resolve(HUB_ROOT, ".."), "m11-template-videos")];
const BASE = { project: PROJECT, marker: MARKER, missionView: MISSION_VIEW, demo: DEMO, tools: { state: "PINNED", identity: IDENTITY }, chromium: { version: "1.61.0" }, exportsDir: EXPORTS, simulation: false, day: "20261005", config: CONFIG };
const ELIGIBLE = { project: PROJECT, marker: MARKER, demo: DEMO, missionView: MISSION_VIEW, route: "windows", missionIds: [MISSION_VIEW.mission.id], exportsDir: EXPORTS, approvedFolders: APPROVED,
  browser: { status: "available", installed: true, version: "1.61.0", cachedBrowsers: ["chromium-1228"] }, tools: { tools: "PINNED", identity: IDENTITY }, config: CONFIG, knownFixtures: ["bug-demo", "service-request", "booking-demo"] };
const DELIVERY_ID = "dlv_mux1abcd_0123456789";
const blockerCodes = (ctx) => eligibility(ctx).blockers.map((b) => b.code);
const throwsCode = (fn, expected) => assert.throws(fn, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); return true; });

/** Runs `fn` with the clock and the random source poisoned: a deterministic function never touches them. */
function withoutClock(fn) {
  const RealDate = globalThis.Date, realRandom = Math.random;
  const poison = () => { throw new Error("the template read the clock or a random source"); };
  globalThis.Date = new Proxy(RealDate, { construct: poison, apply: poison, get: (target, key) => (key === "now" || key === "parse" || key === "UTC" ? poison : Reflect.get(target, key)) });
  Math.random = poison;
  try { return fn(); } finally { globalThis.Date = RealDate; Math.random = realRandom; }
}

// ---------------------------------------------------------------- capture scripts

test("M11-TP-00 the inline fixture is a valid spec (two E2E criteria: 390 px and 1280 px) and a valid delivery block", () => {
  assert.deepEqual(SPEC_PROBLEMS, []);
  assert.deepEqual(e2eCriteria(SPEC).map((c) => [c.id, c.width, c.height]), [["AC-6", 390, 844], ["AC-7", 1280, 800]]);
  const picked = pickCaptureCriteria(SPEC);
  assert.equal(picked.mobile.id, "AC-6");
  assert.equal(picked.desktop.id, "AC-7");
  const { block, problems } = normalizeDeliveryBlock(DELIVERY_BLOCK);
  assert.deepEqual(problems, []);
  assert.equal(block.noun, "programare");
  assert.deepEqual(block.texts.mobile.criteria, ["AC-1", "AC-6"]);
  assert.deepEqual(block.variant, { platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } });
});

test("M11-TP-01 captureScriptFrom maps the approved E2E steps: fill→type, click→highlight+click, expectSelector→waitFor+highlight, expectText→waitFor(proof)+marker, overflow dropped", () => {
  const bare = { settleMs: 0, proofHoldMs: 0 };
  const m = captureScriptFrom(e2eSteps(390, 844), { noun: "programare", role: "mobile", proofSelector: "[data-state='success']", pacing: bare });
  assert.equal(m.ok, true);
  assert.deepEqual(m.blockers, []);
  assert.deepEqual(m.steps, [
    { goto: "/" }, { marker: { kind: "chapter", note: "intro" } },
    // the first click carries the demo marker "<noun> <rol>"
    { marker: { kind: "demo", note: "programare mobil" } },
    { highlight: { selector: "label[data-service='spalare-exterior']", ms: 1200 } }, { click: "label[data-service='spalare-exterior']" },
    { highlight: { selector: "button[data-day='1']", ms: 1200 } }, { click: "button[data-day='1']" },
    { waitFor: ".slot[data-booked='true'][aria-disabled='true']" }, { highlight: { selector: ".slot[data-booked='true'][aria-disabled='true']", ms: 1200 } },
    { highlight: { selector: ".slot[data-booked='false'][aria-disabled='false']", ms: 1200 } }, { click: ".slot[data-booked='false'][aria-disabled='false']" },
    // {run} becomes a fixed synthetic word
    { type: { selector: "input[name='name']", text: "Client Demo Prezentare", delayMs: 60 } }, { type: { selector: "input[name='vehicle']", text: "Autoturism test", delayMs: 60 } },
    { highlight: { selector: "button[type='submit']", ms: 1200 } }, { click: "button[type='submit']" },
    { waitFor: "[data-state='success']" }, { highlight: { selector: "[data-state='success']", ms: 1200 } }, { marker: { kind: "proof", note: "Programare confirmată" } },
  ]);
  // The output is what validateDemoSteps returns for itself: valid and already normalized.
  assert.deepEqual(validateDemoSteps(m.steps), m.steps);
  assert.ok(m.steps.every((s) => DEMO_STEP_KINDS.includes(Object.keys(s)[0])));
  assert.ok(!JSON.stringify(m.steps).includes("noHorizontalOverflow") && !JSON.stringify(m.steps).includes("viewport"));
  // Mobile is a viewport: 390×844 at device scale factor 2 — nothing else.
  assert.deepEqual([m.viewport, m.deviceScaleFactor, m.sourceViewport], [{ width: 390, height: 844 }, 2, { width: 390, height: 844 }]);
  assert.deepEqual(m.evidenceSelectors, [".slot[data-booked='true'][aria-disabled='true']"]);
  assert.deepEqual(m.proofTexts, ["Programare confirmată"]);
  assert.equal(m.demoNote, "programare mobil");
  // Desktop: the capture preset (1280×720 at 1.5 → 1920×1080), whatever the E2E viewport was (1280×800).
  const d = captureScriptFrom(e2eSteps(1280, 800), { noun: "programare", role: "desktop", proofSelector: "[data-state='success']", pacing: bare });
  assert.deepEqual([d.viewport, d.deviceScaleFactor, d.sourceViewport], [{ width: 1280, height: 720 }, 1.5, { width: 1280, height: 800 }]);
  assert.deepEqual(d.steps[2], { marker: { kind: "demo", note: "programare desktop" } });
  assert.deepEqual(d.steps.filter((s) => !s.marker), m.steps.filter((s) => !s.marker));
  assert.deepEqual(CAPTURE_PRESETS.mobile.viewport, { width: 390, height: 844 });
  assert.match(CAPTURE_PRESETS.mobile.label, /lățimea unui telefon \(390 px\) în Chromium/);
});

test("M11-TP-02 default pacing only adds waits (a settle after the first page, the proof held for the CTA); typed values stay synthetic", () => {
  const paced = captureScriptFrom(e2eSteps(390, 844), { noun: "programare", role: "mobile", proofSelector: "[data-state='success']" });
  const bare = captureScriptFrom(e2eSteps(390, 844), { noun: "programare", role: "mobile", proofSelector: "[data-state='success']", pacing: { settleMs: 0, proofHoldMs: 0 } });
  assert.deepEqual(paced.steps.filter((s) => s.wait === undefined), bare.steps);
  assert.deepEqual(paced.steps.filter((s) => s.wait !== undefined), [{ wait: CAPTURE_PACING.settleMs }, { wait: CAPTURE_PACING.proofHoldMs }]);
  assert.deepEqual(paced.steps[2], { wait: 800 }); // right after goto + chapter
  assert.deepEqual(paced.steps.at(-1), { wait: 2500 }); // after the proof marker
  assert.deepEqual(validateDemoSteps(paced.steps), paced.steps);
  assert.ok(paced.estimatedMs > 9000 && paced.estimatedMs < 50000, String(paced.estimatedMs));
  // No step kind that could leave the page's own flow: only these.
  assert.deepEqual([...new Set(paced.steps.map((s) => Object.keys(s)[0]))].sort(), ["click", "goto", "highlight", "marker", "type", "wait", "waitFor"]);
});

test("M11-TP-03 a select step, a mid-script viewport, a non-synthetic typed value and a missing proof selector are blockers (no steps)", () => {
  const opts = { noun: "programare", role: "mobile", proofSelector: "[data-state='success']" };
  const withSelect = captureScriptFrom([{ viewport: { width: 390, height: 844 } }, { goto: "/" }, { select: { selector: "select[name='service']", value: "audit" } }, { click: "button" }], opts);
  assert.equal(withSelect.ok, false);
  assert.deepEqual(withSelect.steps, []);
  assert.deepEqual(withSelect.blockers.map((b) => b.code), ["DELIVERY_STEP_UNSUPPORTED"]);
  assert.match(withSelect.blockers[0].detail, /Pasul 3 alege dintr-o listă \(select\)/);
  const midViewport = captureScriptFrom([{ goto: "/" }, { viewport: { width: 390, height: 844 } }, { click: "button" }], opts);
  assert.deepEqual(midViewport.blockers.map((b) => b.code), ["DELIVERY_STEP_UNSUPPORTED"]);
  for (const value of ["ion.popescu@gmail.com", "token=abcd1234efgh5678", "C:\\Users\\mihai\\date.csv"]) {
    const typed = captureScriptFrom([{ goto: "/" }, { fill: { selector: "input", value } }], opts);
    assert.deepEqual(typed.blockers.map((b) => b.code), ["DELIVERY_TYPED_TEXT"], value);
    assert.ok(!typed.blockers[0].detail.includes(value));
  }
  assert.equal(captureScriptFrom([{ goto: "/" }, { fill: { selector: "input", value: "ana.test@example.ro" } }], opts).ok, true);
  assert.deepEqual(captureScriptFrom([{ goto: "/" }, { expectText: "Gata" }], { noun: "x", role: "mobile", proofSelector: "a{b}" }).blockers.map((b) => b.code), ["DELIVERY_PROOF_SELECTOR"]);
  assert.deepEqual(captureScriptFrom([{ click: "a" }], opts).blockers.map((b) => b.code), ["DELIVERY_E2E_INVALID"]);
  assert.deepEqual(captureScriptFrom([], opts).blockers.map((b) => b.code), ["DELIVERY_E2E_INVALID"]);
  // 24 clicks are valid E2E (25 steps) but would not fit one 60 s capture.
  const many = [{ goto: "/" }, ...Array.from({ length: 24 }, (_, i) => ({ click: `#b${i}` }))];
  assert.deepEqual(validateE2ESteps(many), []);
  assert.ok(captureScriptFrom(many, { ...opts, pacing: { highlightMs: 5000 } }).blockers.some((b) => b.code === "DELIVERY_CAPTURE_TOO_LONG"));
  throwsCode(() => captureScriptFrom(e2eSteps(390, 844), { noun: "x", role: "tablet", proofSelector: "#ok" }), "DELIVERY_CAPTURE_ROLE");
});

// ---------------------------------------------------------------- eligibility

test("M11-TP-04 eligibility: the booking fixture on the Windows route is eligible; UNPINNED tools become a pin pre-step, not a blocker", () => {
  const ok = eligibility(ELIGIBLE);
  assert.deepEqual(ok.blockers, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.pin, null);
  assert.equal(ok.origin, "http://127.0.0.1:4620");
  assert.deepEqual(ok.criteria, { desktop: "AC-7", mobile: "AC-6" });
  const unpinned = eligibility({ ...ELIGIBLE, tools: { tools: "UNPINNED", identity: IDENTITY } });
  assert.equal(unpinned.ok, true);
  assert.deepEqual(unpinned.pin, { expect: IDENTITY });
  // The three accepted shapes of the tools input.
  assert.deepEqual(toolsOf(IDENTITY), { state: null, identity: IDENTITY });
  assert.deepEqual(toolsOf({ state: "PINNED", identity: IDENTITY }), { state: "PINNED", identity: IDENTITY });
  assert.deepEqual(toolsOf({ tools: "UNPINNED", identity: IDENTITY, prepend: [] }), { state: "UNPINNED", identity: IDENTITY });
  assert.deepEqual(toolsOf(null), { state: null, identity: null });
});

test("M11-TP-05 eligibility refuses: not hub-test, not synthetic, wsl route, no preview, a preview port of a Hub, two missions, exports outside the approved folders", () => {
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, project: { ...PROJECT, source: "registry" } }), ["DELIVERY_PROJECT_NOT_TEST"]);
  const { data, ...oldMarker } = MARKER;
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, marker: oldMarker }), ["DELIVERY_DATA_NOT_SYNTHETIC"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, knownFixtures: ["bug-demo"] }), ["DELIVERY_FIXTURE_UNKNOWN"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, project: { ...PROJECT, path: CONFIG.hubRoot } }), ["DELIVERY_PROJECT_PATH"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, route: "wsl-runner" }), ["DELIVERY_ROUTE_NOT_WINDOWS"]);
  const specWith = (patch) => ({ ...MISSION_VIEW, spec: { ...MISSION_VIEW.spec, spec: { ...SPEC, ...patch } } });
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, missionView: specWith({ verification: { ...SPEC.verification, preview: null } }) }), ["DELIVERY_NO_PREVIEW"]);
  // A Hub port as the preview: 8011 always; the TEST Hub's own port too, although config.testMode is true.
  for (const port of [8011, 3011, 8012, 45123, 45124]) {
    const view = specWith({ verification: { ...SPEC.verification, preview: { command: "node server.js", url: `http://127.0.0.1:${port}/` } } });
    assert.deepEqual(blockerCodes({ ...ELIGIBLE, missionView: view }), ["DELIVERY_PREVIEW_PORT_LIVE"], String(port));
  }
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, missionIds: ["mis_a", "mis_b"] }), ["DELIVERY_MULTI_MISSION"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, exportsDir: path.join(path.resolve(HUB_ROOT, ".."), "alt-folder", "Exporturi") }), ["DELIVERY_EXPORTS_NOT_APPROVED"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, approvedFolders: [] }), ["DELIVERY_EXPORTS_NOT_APPROVED"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, exportsDir: null }), ["DELIVERY_EXPORTS_DIR"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, browser: { status: "NEEDS_INSTALL_APPROVAL", installed: false, cachedBrowsers: [] } }), ["DELIVERY_PLAYWRIGHT_MISSING"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, browser: { installed: true, cachedBrowsers: [] } }), ["DELIVERY_PLAYWRIGHT_MISSING"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, browser: null }), ["DELIVERY_PLAYWRIGHT_MISSING"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, tools: { tools: "CHANGED", identity: IDENTITY } }), ["DELIVERY_TOOLS_CHANGED"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, tools: { tools: "MISSING", identity: null } }), ["DELIVERY_TOOLS_MISSING"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, demo: { ...DEMO, delivery: undefined } }), ["DELIVERY_NO_TEMPLATE"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, demo: { ...DEMO, delivery: { ...DELIVERY_BLOCK, proofSelector: "a{b}" } } }), ["DELIVERY_TEMPLATE_INVALID"]);
  // The E2E criteria the captures come from.
  const only = (ids) => specWith({ acceptance: SPEC.acceptance.filter((a) => a.verify !== "e2e" || ids.includes(a.id)) });
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, missionView: only(["AC-7"]) }), ["DELIVERY_E2E_MOBILE_MISSING"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, missionView: only(["AC-6"]) }), ["DELIVERY_E2E_DESKTOP_MISSING"]);
  const withSelect = specWith({ acceptance: SPEC.acceptance.map((a) => (a.id === "AC-6" ? { ...a, steps: [...a.steps.slice(0, 3), { select: { selector: "select", value: "x" } }, ...a.steps.slice(3)] } : a)) });
  const sel = eligibility({ ...ELIGIBLE, missionView: withSelect });
  assert.deepEqual(sel.blockers.map((b) => b.code), ["DELIVERY_STEP_UNSUPPORTED"]);
  assert.match(sel.blockers[0].detail, /^AC-6: /);
  // Every blocker is explained in the owner's language, with a title and a detail.
  const all = eligibility({ ...ELIGIBLE, project: { ...PROJECT, source: "registry" }, route: "wsl-runner", missionIds: ["a", "b"], browser: null });
  assert.equal(all.ok, false);
  assert.deepEqual(all.blockers.map((b) => b.code), ["DELIVERY_PROJECT_NOT_TEST", "DELIVERY_ROUTE_NOT_WINDOWS", "DELIVERY_MULTI_MISSION", "DELIVERY_PLAYWRIGHT_MISSING"]);
  for (const b of all.blockers) assert.ok(b.title.length > 5 && b.detail.length > 20, JSON.stringify(b));
  assert.match(all.blockers[0].detail, /captura unui proiect real cere decizia MB1/);
});

// ---------------------------------------------------------------- template, section, steps

test("M11-TP-06 buildTemplate is frozen and deterministic: the same inputs give the same sha, with the clock and Math.random poisoned", () => {
  const a = withoutClock(() => buildTemplate(BASE));
  const b = withoutClock(() => buildTemplate(JSON.parse(JSON.stringify({ ...BASE, config: undefined }))));
  const c = buildTemplate({ ...BASE, config: CONFIG });
  assert.equal(templateSha(a), templateSha(c));
  assert.equal(templateSha(a), templateSha(b)); // key order and object identity do not matter; the config only validates
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.captures) && Object.isFrozen(a.captures[0].steps) && Object.isFrozen(a.story.texts.hook));
  assert.equal(a.schema, TEMPLATE_SCHEMA);
  assert.equal(a.template, STORY_TEMPLATE);
  assert.deepEqual([a.mode, a.parentDeliveryId, a.missionId, a.issueTitle, a.specVersion, a.specSha], ["new", null, MISSION_VIEW.mission.id, "Pe telefon, intervalele ocupate apar libere", 1, "a".repeat(64)]);
  assert.deepEqual(a.data, { kind: "synthetic", marker: ".ifrim-hub-test.json", banner: "Date sintetice · demo local", bannerSelector: "[data-demo-banner]" });
  assert.deepEqual(a.preview, { origin: "http://127.0.0.1:4620", command: "node server.js", url: "http://127.0.0.1:4620/" });
  assert.equal(a.route, "windows");
  assert.deepEqual(a.captures.map((cap) => [cap.role, cap.criterion, cap.viewport.width, cap.viewport.height, cap.dsf, cap.fps, cap.maxDurationMs, cap.captureLabel]),
    [["desktop", "AC-7", 1280, 720, 1.5, 30, 60000, "ORIGINAL_RECORDING"], ["mobile", "AC-6", 390, 844, 2, 30, 60000, "ORIGINAL_RECORDING"]]);
  for (const cap of a.captures) {
    assert.equal(cap.stepsSha, hashCanonical(cap.steps));
    assert.deepEqual(validateDemoSteps(JSON.parse(JSON.stringify(cap.steps))), JSON.parse(JSON.stringify(cap.steps)));
    assert.deepEqual([...cap.redactSelectors], ["[data-sensitive]", "input[type=password]"]);
    assert.deepEqual([...cap.evidenceSelectors], [".slot[data-booked='true'][aria-disabled='true']"]);
  }
  assert.deepEqual(a.story.variant, { platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" }, overridesSha: hashCanonical({ hookText: "Programări online — demo", ctaText: "Hai să vorbim" }) });
  assert.deepEqual([a.story.tone, a.story.canvas, a.story.fps, a.story.preset], ["both", { width: 1920, height: 1080 }, { num: 30, den: 1 }, { id: "ifrim-business", version: 1 }]);
  assert.deepEqual(a.summary, { template: SUMMARY_TEMPLATE, serviceRefs: [] });
  assert.deepEqual(a.tools, { ffmpeg: IDENTITY.ffmpeg, ffprobe: IDENTITY.ffprobe, chromium: { version: "1.61.0" } });
  assert.deepEqual(a.exports, { dir: EXPORTS, folder: "demo-programari-demo-livrare-detailing-programari-20261005" });
  assert.match(a.exports.folder, /^[a-z0-9][a-z0-9-]{2,80}$/);
  assert.deepEqual(a.limits, { phaseMinutes: 30, maxActions: 120 });
  assert.equal(a.pin, null);
  // A SIMULARE bundle or test mode: the capture label says so.
  const sim = buildTemplate({ ...BASE, simulation: true });
  assert.deepEqual([sim.simulation, sim.captureLabel, ...sim.captures.map((cap) => cap.captureLabel)], [true, "SIMULATION", "SIMULATION", "SIMULATION"]);
  assert.notEqual(templateSha(sim), templateSha(a));
  // What must change the sha: tools identity, Chromium, the port, the exports folder, the day, a text, the spec.
  const changed = [
    { ...BASE, tools: { state: "PINNED", identity: { ...IDENTITY, ffmpeg: { ...IDENTITY.ffmpeg, sha256: "0".repeat(64) } } } },
    { ...BASE, chromium: { version: "1.62.0" } },
    { ...BASE, exportsDir: path.join(EXPORTS, "alt") },
    { ...BASE, day: "2026-10-06" },
    { ...BASE, demo: { ...DEMO, delivery: { ...DELIVERY_BLOCK, texts: { ...DELIVERY_BLOCK.texts, cta: { criteria: [], business: "Sună-ne", technical: "Pachet local" } } } } },
    { ...BASE, missionView: { ...MISSION_VIEW, spec: { ...MISSION_VIEW.spec, sha256: "b".repeat(64) } } },
    { ...BASE, missionView: { ...MISSION_VIEW, spec: { ...MISSION_VIEW.spec, spec: { ...SPEC, verification: { ...SPEC.verification, preview: { command: "node server.js", url: "http://127.0.0.1:4621/" } } } } } },
  ];
  const shas = new Set(changed.map((input) => templateSha(buildTemplate(input))));
  assert.equal(shas.size, changed.length);
  assert.ok(!shas.has(templateSha(a)));
});

test("M11-TP-07 buildTemplate refuses what it cannot freeze honestly, listing every problem", () => {
  const problemsOf = (input) => { try { buildTemplate(input); return null; } catch (e) { assert.equal(e.code, "DELIVERY_TEMPLATE_INVALID", e.message); return e.details.problems; } };
  assert.ok(problemsOf({ ...BASE, day: undefined }).some((p) => /YYYYMMDD/.test(p)));
  assert.ok(problemsOf({ ...BASE, route: "wsl-runner" }).some((p) => /wsl-runner/.test(p)));
  assert.ok(problemsOf({ ...BASE, tools: { state: "CHANGED", identity: IDENTITY } }).some((p) => /CHANGED/.test(p)));
  assert.ok(problemsOf({ ...BASE, tools: null }).some((p) => /ffmpeg\/ffprobe/.test(p)));
  assert.ok(problemsOf({ ...BASE, chromium: null }).some((p) => /Chromium/.test(p)));
  assert.ok(problemsOf({ ...BASE, marker: { ...MARKER, data: undefined } }).some((p) => /date sintetice/.test(p)));
  assert.ok(problemsOf({ ...BASE, exportsDir: "relativ/Exporturi" }).some((p) => /cale absolută/.test(p)));
  assert.ok(problemsOf({ ...BASE, demo: { ...DEMO, delivery: null } }).some((p) => /blocul de livrare/.test(p)));
  assert.ok(problemsOf({ ...BASE, mode: "refresh" }).some((p) => /parentDeliveryId/.test(p)));
  assert.ok(problemsOf({ ...BASE, missionView: { ...MISSION_VIEW, spec: { ...MISSION_VIEW.spec, spec: { ...SPEC, verification: { ...SPEC.verification, preview: { command: "node server.js", url: "http://127.0.0.1:45123/" } } } } } }).length >= 1);
  assert.equal(problemsOf({}).length >= 5, true);
  // A refresh (software revision) names its parent.
  const refresh = buildTemplate({ ...BASE, mode: "refresh", parentDeliveryId: DELIVERY_ID });
  assert.deepEqual([refresh.mode, refresh.parentDeliveryId], ["refresh", DELIVERY_ID]);
  throwsCode(() => exportFolderName({ noun: "programare", slug: "demo", day: "5 oct" }), "DELIVERY_DAY_REQUIRED");
  assert.equal(exportFolderName({ noun: "Programare", slug: "Demo Livrare — Detailing", day: "20261005" }), "demo-programare-demo-livrare-detailing-20261005");
  assert.ok(exportFolderName({ noun: "programare", slug: "x".repeat(200), day: "20261005" }).length <= 81);
});

test("M11-TP-08 sectionOf is the hashed envelope block: the documented shape, bound to the template, the spec and the ops body", () => {
  const template = buildTemplate(BASE);
  const steps = packageSteps(template, DELIVERY_ID);
  const ops = { stepTitles: steps.map((s) => s.title || s.kind), bodySha: "c".repeat(64) };
  const section = withoutClock(() => sectionOf(template, { deliveryId: DELIVERY_ID, ops }));
  assert.deepEqual(Object.keys(section).sort(), ["captures", "data", "decisionsLeft", "deliveryId", "exports", "issueTitle", "limits", "missionId", "mode", "never", "ops", "outputs",
    "parentDeliveryId", "preview", "route", "schema", "specSha", "story", "summary", "templateSha", "tools"].sort());
  assert.deepEqual([section.schema, section.deliveryId, section.mode, section.parentDeliveryId, section.missionId, section.route], [1, DELIVERY_ID, "new", null, MISSION_VIEW.mission.id, "windows"]);
  assert.deepEqual(section.data, { kind: "synthetic", marker: ".ifrim-hub-test.json", banner: "Date sintetice · demo local" });
  assert.deepEqual(section.preview, { origin: "http://127.0.0.1:4620", command: "node server.js" });
  assert.deepEqual(section.captures, template.captures.map((c) => ({ role: c.role, viewport: { ...c.viewport }, dsf: c.dsf, fps: 30, maxDurationMs: 60000, stepsSha: c.stepsSha })));
  assert.deepEqual(section.story, { template: "delivery-presentation-v1", tone: "both", canvas: "1920x1080", fps: "30/1", variant: { platformKey: "shorts_9x16", overridesSha: template.story.variant.overridesSha } });
  assert.deepEqual(section.summary, { template: "commercial-summary-v2", serviceRefs: [] });
  assert.deepEqual(section.tools, { ffmpeg: IDENTITY.ffmpeg, ffprobe: IDENTITY.ffprobe, chromium: { version: "1.61.0" } });
  assert.deepEqual(section.exports, { dir: EXPORTS, folder: template.exports.folder });
  assert.deepEqual(section.limits, { phaseMinutes: 30, maxActions: 120 });
  assert.deepEqual(section.ops, { kind: PACKAGE_KIND, stepTitles: ops.stepTitles, bodySha: "c".repeat(64) });
  assert.deepEqual([section.templateSha, section.specSha], [templateSha(template), "a".repeat(64)]);
  assert.deepEqual(section.never, [...DELIVERY_NEVER]);
  assert.deepEqual(section.decisionsLeft, [...DELIVERY_DECISIONS_LEFT]);
  for (const word of ["publicare", "acceptarea software-ului", "aprobarea creativă", "niciun model după DELIVERY_READY"]) assert.ok(section.never.includes(word), word);
  assert.equal(section.decisionsLeft.length, 5);
  assert.equal(section.outputs.length, 4);
  // Stable hash; any change of the template, of the ops body or of the delivery shows in it.
  const sha = hashCanonical(section);
  assert.equal(hashCanonical(sectionOf(buildTemplate(BASE), { deliveryId: DELIVERY_ID, ops })), sha);
  assert.notEqual(hashCanonical(sectionOf(template, { deliveryId: DELIVERY_ID, ops: { ...ops, bodySha: "d".repeat(64) } })), sha);
  assert.notEqual(hashCanonical(sectionOf(template, { deliveryId: "dlv_mux1abcd_9999999999", ops })), sha);
  assert.notEqual(hashCanonical(sectionOf(buildTemplate({ ...BASE, chromium: { version: "1.62.0" } }), { deliveryId: DELIVERY_ID, ops })), sha);
  // Before the service knows the id and the ops body, those fields are empty — never invented.
  const open = sectionOf(template);
  assert.deepEqual([open.deliveryId, open.ops], [null, { kind: PACKAGE_KIND, stepTitles: [], bodySha: null }]);
  throwsCode(() => sectionOf(template, { deliveryId: "altceva" }), "DELIVERY_ID_INVALID");
  throwsCode(() => sectionOf({ schema: 9 }), "DELIVERY_TEMPLATE_INVALID");
});

test("M11-TP-09 packageSteps: the 10 steps of the plan, only ids, roles, template constants and $pas references — hashed identically twice", () => {
  const template = buildTemplate(BASE);
  const steps = withoutClock(() => packageSteps(template, DELIVERY_ID));
  assert.deepEqual(steps.map((s) => [s.kind, s.params]), [
    ["delivery.prepare", { deliveryId: DELIVERY_ID }],
    ["delivery.preview.ensure", { deliveryId: DELIVERY_ID }],
    ["delivery.capture", { deliveryId: DELIVERY_ID, role: "desktop" }],
    ["delivery.capture", { deliveryId: DELIVERY_ID, role: "mobile" }],
    ["delivery.edit.build", { deliveryId: DELIVERY_ID }],
    ["media.render", { editVersionId: "$pas:5.editVersionId", profile: "final", qaUse: "internal" }],
    ["media.variant.render", { masterVersionId: "$pas:5.editVersionId", platformKey: "shorts_9x16", qaUse: "internal", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } }],
    ["delivery.export", { deliveryId: DELIVERY_ID, master: "$pas:6.assetVersionId", vertical: "$pas:7.assetVersionId" }],
    ["delivery.summary.render", { deliveryId: DELIVERY_ID }],
    ["delivery.finish", { deliveryId: DELIVERY_ID, render: "$pas:6.renderJobId", variant: "$pas:7.variantId", verticalEdit: "$pas:7.editVersionId" }],
  ]);
  assert.ok(steps.length <= DELIVERY_LIMITS.maxSteps);
  // Deterministic: byte-identical canonical JSON and hash on a second call and from an equal template built separately.
  const again = withoutClock(() => packageSteps(buildTemplate(BASE), DELIVERY_ID));
  assert.equal(canonicalJson(again), canonicalJson(steps));
  assert.equal(hashCanonical(again), hashCanonical(steps));
  assert.equal(JSON.stringify(again), JSON.stringify(steps));
  // No absolute machine path, no timestamp, no random id: only the delivery id and the export FOLDER NAME appear.
  const text = JSON.stringify(steps);
  assert.ok(!/[A-Za-z]:\\\\|\/home\/|\/Users\//.test(text), "an absolute path leaked into the steps");
  assert.ok(!text.includes(EXPORTS.replace(/\\/g, "\\\\")));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text));
  assert.ok(text.includes(template.exports.folder));
  // Every reference points at an EARLIER step that produces it.
  for (const [i, s] of steps.entries()) for (const v of Object.values(s.params)) { const m = /^\$pas:(\d+)\./.exec(String(v)); if (m) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= i, `${s.kind}: ${v}`); }
  // Honest wording on the card: the phone capture is a width, and nothing is published.
  assert.match(steps[3].title, /lățimea unui telefon \(390 px\) în Chromium/);
  assert.match(steps[7].title, /fără publicare/);
  assert.ok(steps.every((s) => typeof s.title === "string" && s.title.length > 10 && s.title.length <= 160));
  // No step of an owner decision, a model, a desktop app or a publication exists in the template.
  assert.ok(steps.every((s) => /^(delivery\.(prepare|preview\.ensure|capture|edit\.build|export|summary\.render|finish)|media\.(render|variant\.render))$/.test(s.kind)));
  // Without variant overrides the param is not emitted at all (existing plan bodies keep their hash).
  const plain = buildTemplate({ ...BASE, demo: { ...DEMO, delivery: { ...DELIVERY_BLOCK, variant: {} } } });
  assert.deepEqual(packageSteps(plain, DELIVERY_ID)[6].params, { masterVersionId: "$pas:5.editVersionId", platformKey: "shorts_9x16", qaUse: "internal" });
  throwsCode(() => packageSteps(template, "mis_nu_e_livrare"), "DELIVERY_ID_INVALID");
  throwsCode(() => packageSteps(null, DELIVERY_ID), "DELIVERY_TEMPLATE_INVALID");
});

test("M11-TP-10 the pin step is prepended only when the tools were UNPINNED, and the $pas references shift with it", () => {
  const pinned = packageSteps(buildTemplate(BASE), DELIVERY_ID);
  assert.equal(pinned.length, 10);
  assert.ok(!pinned.some((s) => s.kind === "media.tools.pin"));
  for (const state of ["PINNED", null]) assert.equal(buildTemplate({ ...BASE, tools: IDENTITY, toolsState: state }).pin, null);
  const template = buildTemplate({ ...BASE, tools: { tools: "UNPINNED", identity: IDENTITY } });
  assert.deepEqual(template.pin, { expect: IDENTITY });
  const steps = packageSteps(template, DELIVERY_ID);
  assert.equal(steps.length, 11);
  assert.deepEqual(steps[0], { kind: "media.tools.pin", params: { expect: IDENTITY } });
  assert.deepEqual(steps.slice(1).map((s) => s.kind), pinned.map((s) => s.kind));
  assert.deepEqual(steps[6].params, { editVersionId: "$pas:6.editVersionId", profile: "final", qaUse: "internal" });
  assert.equal(steps[7].params.masterVersionId, "$pas:6.editVersionId");
  assert.deepEqual(steps[8].params, { deliveryId: DELIVERY_ID, master: "$pas:7.assetVersionId", vertical: "$pas:8.assetVersionId" });
  assert.deepEqual(steps[10].params, { deliveryId: DELIVERY_ID, render: "$pas:7.renderJobId", variant: "$pas:8.variantId", verticalEdit: "$pas:8.editVersionId" });
  // Each reference still names the step of the kind it needs.
  const kindAt = (ref) => steps[Number(/^\$pas:(\d+)\./.exec(ref)[1]) - 1].kind;
  assert.deepEqual([kindAt(steps[6].params.editVersionId), kindAt(steps[8].params.master), kindAt(steps[8].params.vertical), kindAt(steps[10].params.variant)],
    ["delivery.edit.build", "media.render", "media.variant.render", "media.variant.render"]);
  assert.notEqual(hashCanonical(steps), hashCanonical(pinned));
});

test("M11-TP-11 revisionSteps: one media revision is six steps — no capture, no factory step, no model", () => {
  const template = buildTemplate(BASE);
  const steps = withoutClock(() => revisionSteps(template, DELIVERY_ID, "drv_mux2abcd_0123456789"));
  assert.deepEqual(steps.map((s) => [s.kind, s.params]), [
    ["delivery.revise.apply", { deliveryId: DELIVERY_ID, revisionId: "drv_mux2abcd_0123456789" }],
    ["media.render", { editVersionId: "$pas:1.editVersionId", profile: "final", qaUse: "internal" }],
    ["media.variant.render", { masterVersionId: "$pas:1.editVersionId", platformKey: "shorts_9x16", qaUse: "internal", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } }],
    ["delivery.export", { deliveryId: DELIVERY_ID, master: "$pas:2.assetVersionId", vertical: "$pas:3.assetVersionId" }],
    ["delivery.summary.render", { deliveryId: DELIVERY_ID, only: "video" }],
    ["delivery.finish", { deliveryId: DELIVERY_ID, render: "$pas:2.renderJobId", variant: "$pas:3.variantId", verticalEdit: "$pas:3.editVersionId", mode: "revision" }],
  ]);
  assert.ok(!steps.some((s) => /capture|factory|model/.test(s.kind)));
  assert.equal(hashCanonical(revisionSteps(template, DELIVERY_ID, "drv_mux2abcd_0123456789")), hashCanonical(steps));
  throwsCode(() => revisionSteps(template, DELIVERY_ID, "rev-1"), "DELIVERY_REVISION_ID_INVALID");
});

test("M11-TP-12 normalizeDeliveryBlock lists what a fixture's delivery block is missing", () => {
  assert.deepEqual(normalizeDeliveryBlock(null).problems.length, 1);
  const bad = normalizeDeliveryBlock({ noun: "", proofSelector: "<x>", bannerSelector: "", texts: { hook: { criteria: ["X-1"], business: "", technical: "a\nb" }, desktop: DELIVERY_BLOCK.texts.desktop },
    variant: { platformKey: "tiktok_live", overrides: { hookText: "ok", extra: "x" } }, exportPrefix: "Demo Mare", redactSelectors: ["a{b}"] });
  for (const needle of ["noun", "proofSelector", "bannerSelector", "texts.hook.criteria", "texts.hook.business", "texts.hook.technical", "texts.mobile", "texts.cta", "variant.platformKey", "variant.overrides.extra", "exportPrefix", "redactSelectors"]) {
    assert.ok(bad.problems.some((p) => p.startsWith(needle)), `${needle} — ${bad.problems.join(" | ")}`);
  }
  // A template text is never a place for a secret, a path of this machine or a real address.
  const leak = normalizeDeliveryBlock({ ...DELIVERY_BLOCK, texts: { ...DELIVERY_BLOCK.texts, cta: { criteria: [], business: "Scrie la ion@gmail.com", technical: "ok" } } });
  assert.ok(leak.problems.some((p) => p.startsWith("texts.cta.business")));
});

test("M11-TP-13 the real booking fixture definition (when it is in this tree) is what this module expects: eligible, a frozen template, 10 steps", async (t) => {
  let def;
  try { ({ BOOKING_DEMO: def } = await import("../server/factory/booking-demo-def.mjs")); }
  catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    t.skip("SKIPPED_ENV: v2/server/factory/booking-demo-def.mjs is not in this tree yet (the inline fixture above covers the same shape)");
    return;
  }
  const checked = checkSpec({ workType: def.workType, title: def.title, objective: def.objective, ...def.spec });
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(normalizeDeliveryBlock(def.delivery).problems, []);
  const view = { mission: { id: "mis_mux0demo_aaaaaaaaaa", title: def.title }, spec: { version: 1, sha256: specHash(checked.spec), spec: checked.spec } };
  const marker = { ...MARKER, fixture: def.key, data: def.data };
  const ok = eligibility({ ...ELIGIBLE, demo: def, marker, missionView: view, knownFixtures: [def.key] });
  assert.deepEqual(ok.blockers, []);
  assert.deepEqual(ok.criteria, { desktop: "AC-7", mobile: "AC-6" });
  const template = buildTemplate({ ...BASE, demo: def, marker, missionView: view });
  assert.equal(template.preview.origin, `http://127.0.0.1:${def.port}`);
  assert.equal(template.fixture, def.key);
  assert.equal(template.issueTitle, def.title);
  assert.equal(template.specSha, specHash(checked.spec));
  for (const cap of template.captures) assert.deepEqual(validateDemoSteps(JSON.parse(JSON.stringify(cap.steps))), JSON.parse(JSON.stringify(cap.steps)));
  assert.deepEqual(template.captures.map((cap) => cap.demoNote), [`${def.delivery.noun} desktop`, `${def.delivery.noun} mobil`]);
  assert.match(template.exports.folder, /^[a-z0-9][a-z0-9-]{2,80}$/);
  assert.equal(packageSteps(template, DELIVERY_ID).length, 10);
  assert.equal(hashCanonical(packageSteps(template, DELIVERY_ID)), hashCanonical(packageSteps(buildTemplate({ ...BASE, demo: def, marker, missionView: view }), DELIVERY_ID)));
});

// ---------------------------------------------------------------- cross-check regressions (template × capture × clip)

const BOOKED = ".slot[data-booked='true'][aria-disabled='true']";
/**
 * The markers media/capture.mjs records for a capture script: a marker step as it is, and a highlight step as
 * { kind: "highlight", note: <the step's normalized selector>, rect } — the note clip-ir.mjs matches against evidenceSelectors.
 */
function recorded(cap, { width, height }) {
  let t = 0;
  const markers = [];
  for (const step of cap.steps) {
    if (step.marker) markers.push({ kind: step.marker.kind, atMs: t, note: step.marker.note });
    if (step.highlight) { markers.push({ kind: "highlight", atMs: t, note: step.highlight.selector, rect: { x: 0.2, y: 0.4, w: 0.2, h: 0.06 } }); t += step.highlight.ms; }
    t += step.wait ?? (step.type ? step.type.text.length * step.type.delayMs : step.goto ? 1000 : 150);
  }
  return { role: cap.role, assetVersionId: `mav_${cap.role}`, durationMs: t + 1000, width, height, captureLabel: "ORIGINAL_RECORDING", markers, evidenceSelectors: [...cap.evidenceSelectors], proofSelector: cap.proofSelector };
}
const SIZES = { desktop: { width: 1920, height: 1080 }, mobile: { width: 780, height: 1688 } };
const masterOf = (captures, texts = DELIVERY_BLOCK.texts) => buildMaster({ captures: captures.map((cap) => recorded(cap, SIZES[cap.role])), texts, tone: "both", passed: ["AC-1", "AC-6", "AC-7"],
  claimIdsByCriterion: { "AC-1": "ccl_1", "AC-6": "ccl_6", "AC-7": "ccl_7" }, noun: "programare", evidenceNote: "interval ocupat pe telefon" });

test("M11-TP-14 evidenceSelectors are the selectors of the EMITTED highlight steps (normalized like validateDemoSteps normalizes them): an approved selector with spaces around it still gives the evidence marker and its regions", () => {
  // The approved E2E step may carry spaces around its selector (validateE2ESteps accepts it); the demo step is emitted trimmed.
  const padded = (width, height) => e2eSteps(width, height).map((step) => (step.expectSelector ? { expectSelector: `  ${step.expectSelector} ` } : step));
  assert.deepEqual(validateE2ESteps(padded(390, 844)), []);
  const script = captureScriptFrom(padded(390, 844), { noun: "programare", role: "mobile", proofSelector: " [data-state='success'] " });
  assert.equal(script.ok, true);
  assert.deepEqual(script.evidenceSelectors, [BOOKED]);
  // Exactly the selector of the highlight step the capture will run (and record as the highlight's note) — and the proof likewise.
  const highlights = script.steps.filter((step) => step.highlight).map((step) => step.highlight.selector);
  assert.ok(script.evidenceSelectors.every((selector) => highlights.includes(selector)));
  assert.ok(highlights.includes(BOOKED) && !highlights.some((selector) => selector !== selector.trim()));
  assert.equal(script.proofSelector, "[data-state='success']");
  assert.ok(highlights.includes(script.proofSelector));
  // The same result as for the clean selector: the padding changes nothing in the script.
  const clean = captureScriptFrom(e2eSteps(390, 844), { noun: "programare", role: "mobile", proofSelector: "[data-state='success']" });
  assert.deepEqual([script.steps, script.evidenceSelectors], [clean.steps, clean.evidenceSelectors]);
  // One entry per selector: the same state checked twice (once padded), and a second state after the proof, in the order checked.
  const twice = captureScriptFrom([...padded(390, 844), { expectSelector: BOOKED }, { expectSelector: " #summary  " }], { noun: "programare", role: "mobile", proofSelector: "[data-state='success']" });
  assert.deepEqual(twice.evidenceSelectors, [BOOKED, "#summary"]);
  assert.ok(twice.evidenceSelectors.every((selector) => twice.steps.some((step) => step.highlight?.selector === selector)));
  // A selector that is only spaces is not a selector: a blocker, never an empty evidence entry.
  const blank = captureScriptFrom([{ goto: "/" }, { expectSelector: "   " }], { noun: "programare", role: "mobile", proofSelector: "[data-state='success']" });
  assert.deepEqual([blank.ok, blank.evidenceSelectors, blank.blockers.map((b) => b.code)], [false, [], ["DELIVERY_STEPS_INVALID"]]);

  // The frozen template carries the normalized selectors for both captures …
  const paddedSpec = { ...SPEC, acceptance: SPEC.acceptance.map((a) => (a.verify === "e2e" ? { ...a, steps: padded(a.id === "AC-6" ? 390 : 1280, a.id === "AC-6" ? 844 : 800) } : a)) };
  const template = buildTemplate({ ...BASE, missionView: { ...MISSION_VIEW, spec: { ...MISSION_VIEW.spec, spec: paddedSpec } } });
  for (const cap of template.captures) assert.deepEqual([...cap.evidenceSelectors], [BOOKED], cap.role);
  // … so the clip built from what the capture records has its evidence marker, the phone-width evidence regions and no „unknown evidence” note.
  const built = masterOf(template.captures);
  assert.deepEqual(built.ir.markers.map((m) => [m.kind, m.note]), [["chapter", "intro"], ["demo", "programare desktop"], ["demo", "programare mobil"], ["evidence", "interval ocupat pe telefon"], ["cta", "final"]]);
  assert.equal(built.ir.evidenceRegions.filter((r) => r.clipId === "c-mobile").length, 2, "the booked slot and the confirmed booking");
  assert.equal(built.ir.evidenceRegions.filter((r) => r.clipId === "c-desktop").length, 2);
  assert.ok(!built.notes.some((n) => /evidențiere de dovadă cunoscută/.test(n)), built.notes.join(" | "));
  // The counter-check: with the RAW (padded) selector — what the template used to keep — the same captures lose the marker.
  const raw = masterOf(template.captures.map((cap) => ({ ...cap, evidenceSelectors: cap.evidenceSelectors.map((selector) => `  ${selector} `) })));
  assert.ok(!raw.ir.markers.some((m) => m.kind === "evidence"));
  assert.ok(raw.notes.some((n) => /evidențiere de dovadă cunoscută/.test(n)));
});

test("M11-TP-15 a tone text names only criteria it is gated on: every criterion id cited inside a text is in that text's criteria list (the inline block, the real BOOKING_DEMO, and a refusal for a block that breaks it)", async () => {
  assert.deepEqual(citedCriteria("Fix verificat: intervalele ocupate pe telefon (AC-1, ac-6)"), ["AC-1", "AC-6"]);
  assert.deepEqual(citedCriteria("AC-1 + AC-6: interval ocupat → indisponibil (390 px); AC-1 din nou"), ["AC-1", "AC-6"]);
  assert.deepEqual([citedCriteria("E2E desktop 1280×800: PASS"), citedCriteria("MAC-12 și AC-1234 și XAC-3"), citedCriteria(null)], [[], [], []]);
  const { BOOKING_DEMO } = await import("../server/factory/booking-demo-def.mjs");
  for (const [name, block] of [["inline", DELIVERY_BLOCK], ["BOOKING_DEMO", BOOKING_DEMO.delivery]]) {
    assert.deepEqual(normalizeDeliveryBlock(block).problems, [], name);
    for (const [slot, entry] of Object.entries(block.texts)) {
      for (const tone of ["business", "technical"]) {
        const ungated = citedCriteria(entry[tone]).filter((id) => !entry.criteria.includes(id));
        assert.deepEqual(ungated, [], `${name}: texts.${slot}.${tone} „${entry[tone]}” cites a criterion it is not gated on`);
      }
    }
    // A variant override replaces its slot's text, so it is held to the same list.
    assert.deepEqual(citedCriteria(block.variant.overrides.hookText).filter((id) => !block.texts.hook.criteria.includes(id)), [], name);
    assert.deepEqual(citedCriteria(block.variant.overrides.ctaText).filter((id) => !block.texts.cta.criteria.includes(id)), [], name);
  }
  // The hook is gated on AC-1 alone and says so; the phone-width text is gated on both criteria it names.
  assert.deepEqual([BOOKING_DEMO.delivery.texts.hook.criteria, BOOKING_DEMO.delivery.texts.hook.technical], [["AC-1"], "Fix verificat: intervalele ocupate pe telefon (AC-1)"]);
  assert.deepEqual(citedCriteria(BOOKING_DEMO.delivery.texts.mobile.technical), ["AC-1", "AC-6"]);
  assert.deepEqual(DELIVERY_BLOCK.texts, JSON.parse(JSON.stringify(BOOKING_DEMO.delivery.texts)), "the inline block of this file is the real one");

  // A block that breaks the rule is not a valid delivery template: listed as a problem, an eligibility blocker, never frozen.
  const wrongHook = { ...DELIVERY_BLOCK, texts: { ...DELIVERY_BLOCK.texts, hook: { criteria: ["AC-1"], business: DELIVERY_BLOCK.texts.hook.business, technical: "Fix verificat: intervalele ocupate pe telefon (AC-1, AC-6)" } } };
  assert.deepEqual(normalizeDeliveryBlock(wrongHook).problems, ["texts.hook.technical: textul numește AC-6, dar nu este condiționat de el (criteria); ar rămâne pe ecran și când acel criteriu nu a trecut"]);
  assert.deepEqual(blockerCodes({ ...ELIGIBLE, demo: { ...DEMO, delivery: wrongHook } }), ["DELIVERY_TEMPLATE_INVALID"]);
  throwsCode(() => buildTemplate({ ...BASE, demo: { ...DEMO, delivery: wrongHook } }), "DELIVERY_TEMPLATE_INVALID");
  const wrongCta = normalizeDeliveryBlock({ ...DELIVERY_BLOCK, texts: { ...DELIVERY_BLOCK.texts, cta: { criteria: [], business: "Hai să discutăm (AC-1 și AC-7)", technical: "Pachet local, gata de verificare" } } });
  assert.deepEqual(wrongCta.problems, ["texts.cta.business: textul numește AC-1, AC-7, dar nu este condiționat de ele (criteria); ar rămâne pe ecran și când acele criterii nu au trecut"]);
  const wrongOverride = normalizeDeliveryBlock({ ...DELIVERY_BLOCK, variant: { platformKey: "shorts_9x16", overrides: { hookText: "Programări online (AC-1, AC-7)", ctaText: "Hai să vorbim" } } });
  assert.deepEqual(wrongOverride.problems, ["variant.overrides.hookText: textul numește AC-7, dar textul pe care îl înlocuiește (texts.hook) nu este condiționat de el"]);
  assert.deepEqual(wrongOverride.block.variant.overrides, { ctaText: "Hai să vorbim" }, "the refused override is not kept");
  // Gating the hook on both criteria is the other honest way to name both.
  const gatedOnBoth = { ...wrongHook, texts: { ...wrongHook.texts, hook: { ...wrongHook.texts.hook, criteria: ["AC-1", "AC-6"] } } };
  assert.deepEqual(normalizeDeliveryBlock(gatedOnBoth).problems, []);

  // What it protects, on screen (the cross-check scenario: technical tone, everything passed but AC-6): the phone-width text is left
  // out, and no text that IS shown names AC-6.
  const captures = buildTemplate(BASE).captures;
  const shown = (texts) => buildMaster({ captures: captures.map((cap) => recorded(cap, SIZES[cap.role])), texts, tone: "technical", passed: ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-7"], noun: "programare" });
  const honest = shown(BOOKING_DEMO.delivery.texts);
  assert.deepEqual(honest.omitted, [{ id: "t-mobile", reason: "CRITERIA_NOT_PASS", criteria: ["AC-6"] }]);
  const onScreen = (built) => built.ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).map((i) => i.text);
  assert.ok(onScreen(honest).includes("Fix verificat: intervalele ocupate pe telefon (AC-1)"));
  assert.deepEqual(onScreen(honest).flatMap(citedCriteria), ["AC-1"]);
  assert.ok(onScreen(shown(wrongHook.texts)).flatMap(citedCriteria).includes("AC-6"), "the old hook text would have named a criterion that did not pass");
});
