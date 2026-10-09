// M11 „Ifrim Delivery” — the delivery template (pure): what ONE confirmation covers after DELIVERY_READY, frozen at proposal.
//
// - buildTemplate(...)        → the frozen template of a delivery (capture scripts, story, variant, summary template, tools identity,
//                                export folder). Stored as deliveries.template_json; hashCanonical(template) is its template_sha.
// - sectionOf(template, …)    → the `delivery` block hashed inside the envelope body (API contract 13); absent on ordinary plans.
// - packageSteps(template,id) → the ≤ 12 steps of the derived ops plan 'delivery.package'. Their params hold only the delivery id, the
//                                capture role, constants of the template and `$pas:N.field` references, so the ops body
//                                (opsPlans.buildBody) is the same at proposal, at confirmation and at activation.
// - revisionSteps(...)        → the 6 steps of a media revision plan 'delivery.revise' (no code, no model).
// - captureScriptFrom(...)    → the demo steps of one capture, derived from the APPROVED, protected E2E steps of the spec (never from
//                                free text): viewport → the capture preset; goto → goto + chapter marker; fill → type; click →
//                                highlight + click (the first click also gets the demo marker "<noun> <rol>"); expectSelector →
//                                waitFor + highlight (an evidence highlight); expectText → waitFor(proof) + highlight(proof) + proof
//                                marker; noHorizontalOverflow → dropped; select → refused (an eligibility blocker).
// - eligibility(ctx)          → the blockers that make a delivery impossible for a project, each explained in the owner's language.
//
// Deterministic by contract: no clock, no random, no environment, no file access. The only machine path is the exports folder the
// caller passes in; the date in the export folder name is the caller's `day` (frozen with the template at PLANNED).
// „Mobil” means a viewport: 390×844 at device scale factor 2 in Chromium — no touch, no user-agent emulation — and every text here
// says „lățimea unui telefon (390 px) în Chromium”.
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { redactText } from "../security/redact.mjs";
import { validateE2ESteps, E2E_RUN_TOKEN } from "../tools/browser-core.mjs";
import { validateDemoSteps, DEMO_MAX_STEPS, DEFAULT_REDACT_SELECTORS } from "../media/capture.mjs";
import { normalizeRo } from "../media/captions.mjs";
import { PLATFORM_KEYS } from "../media/variants.mjs";
import { TEST_PROJECT_MARKER, slugify } from "../domain/projects.mjs";
import { insideAny } from "../policy/action-policy.mjs";
import { assertCaptureOrigin, syntheticProjectProblems, textViolations, SYNTHETIC_BANNER } from "./capture-guard.mjs";
import { normalizeSummaryBlock } from "./summary.mjs";

export const TEMPLATE_SCHEMA = 1;
export const STORY_TEMPLATE = "delivery-presentation-v1";
export const SUMMARY_TEMPLATE = "commercial-summary-v2"; // v2: the owner's §21 sections (delivery/summary.mjs)
export const PACKAGE_KIND = "delivery.package";
export const REVISE_KIND = "delivery.revise";
export const DELIVERY_LIMITS = Object.freeze({ phaseMinutes: 30, hardStopMinutes: 60, maxActions: 120, revisionMinutes: 15, maxSteps: 16 });
/** Office artifacts a delivery may add (stage before M12): a Word document, an Excel workbook, a local campaign package. */
export const DELIVERY_EXTRAS = Object.freeze(["document", "workbook", "campaign"]);
export const TEXT_SLOTS = Object.freeze(["hook", "desktop", "mobile", "cta"]);
export const CAPTURE_ROLES = Object.freeze(["desktop", "mobile"]);
/** The two capture presets (hashed in the plan). Mobile is a viewport width, nothing more. */
export const CAPTURE_PRESETS = Object.freeze({
  desktop: Object.freeze({ viewport: Object.freeze({ width: 1280, height: 720 }), dsf: 1.5, fps: 30, maxDurationMs: 60000, label: "desktop 1280×720" }),
  mobile: Object.freeze({ viewport: Object.freeze({ width: 390, height: 844 }), dsf: 2, fps: 30, maxDurationMs: 60000, label: "lățimea unui telefon (390 px) în Chromium" }),
});
/** Which E2E criterion feeds which capture: its first viewport step (1280×800 when it has none, like the E2E runner). */
export const VIEWPORT_RULES = Object.freeze({ mobileMaxWidth: 480, desktopMinWidth: 1024, defaultWidth: 1280, defaultHeight: 800 });
/** Pacing of a capture (owner lens): a short settle after the first page, and the proof held long enough for the CTA to sit on it. */
export const CAPTURE_PACING = Object.freeze({ settleMs: 800, proofHoldMs: 2500, highlightMs: 1200, typeDelayMs: 60, runWord: "Prezentare" });
export const ROLE_WORD = Object.freeze({ desktop: "desktop", mobile: "mobil" });
export const STORY = Object.freeze({ tone: "both", canvas: Object.freeze({ width: 1920, height: 1080 }), fps: Object.freeze({ num: 30, den: 1 }), preset: Object.freeze({ id: "ifrim-business", version: 1 }), platformKey: "shorts_9x16" });

const UNSAFE_SELECTOR = /[{}<>;\\\r\n\u0000]|\/\*|\*\//;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CRITERION_RE = /^AC-\d{1,3}$/;
const DELIVERY_ID_RE = /^dlv_[A-Za-z0-9_-]{4,60}$/;
const REVISION_ID_RE = /^drv_[A-Za-z0-9_-]{4,60}$/;
const EXPORT_PREFIX_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const TOOL_STATES = Object.freeze(["PINNED", "UNPINNED", "CHANGED", "MISSING"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (value, max) => redactText(normalizeRo(String(value ?? ""))).slice(0, max);
const safeSelector = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !UNSAFE_SELECTOR.test(value);
const invalid = (message, problems) => new HubError("validation", message, { code: "DELIVERY_TEMPLATE_INVALID", data: { problems } });

// ---------------------------------------------------------------------------------------------------------------------------
// The fixture's delivery block (Hub-side; not part of the spec, so it never changes the spec hash)
// ---------------------------------------------------------------------------------------------------------------------------

/** The criterion ids a text names („Fix verificat … (AC-1)” → ["AC-1"]), upper-cased, each once, in the order written. */
export function citedCriteria(text) {
  return [...new Set((String(text ?? "").match(/(?<![A-Za-z0-9])AC-\d{1,3}(?!\d)/gi) || []).map((id) => id.toUpperCase()))];
}
/** The slot whose text a variant override replaces (media/variants.mjs deriveVariant: hookText → the hook, ctaText → the CTA). */
const OVERRIDE_SLOT = Object.freeze({ hookText: "hook", ctaText: "cta" });

/**
 * Normalizes FACTORY_DEMOS[*].delivery → { block, problems[] }. Shape:
 *   { noun, issue?, proofSelector, bannerSelector, evidenceNote?, exportPrefix?, redactSelectors?,
 *     texts: { hook|desktop|mobile|cta: { criteria: ["AC-1", …], business, technical } },
 *     variant: { platformKey?: "shorts_9x16", overrides?: { hookText?, ctaText? } } }
 * A text is shown only when ALL its criteria are PASS, so `criteria` is what the text claims (cta claims nothing). A text may
 * therefore name only criteria it is gated on: one that cites another criterion would stay on screen when that criterion did not
 * pass (a problem here, never a frame). The same holds for a variant override, which replaces its slot's text.
 */
export function normalizeDeliveryBlock(input) {
  const problems = [];
  if (!isObject(input)) return { block: null, problems: ["blocul de livrare (delivery) lipsește din definiția fixture-ului"] };
  const noun = clean(input.noun, 40).toLocaleLowerCase("ro-RO");
  if (noun.length < 2 || !/^[\p{L}][\p{L} -]*$/u.test(noun)) problems.push("noun: substantivul demonstrației (de exemplu „programare”) lipsește sau nu este un cuvânt");
  for (const key of ["proofSelector", "bannerSelector"]) if (!safeSelector(input[key])) problems.push(`${key}: selector CSS lipsă sau invalid`);
  const texts = {};
  for (const slot of TEXT_SLOTS) {
    const raw = input.texts?.[slot];
    if (!isObject(raw)) { problems.push(`texts.${slot}: lipsește`); continue; }
    const criteria = Array.isArray(raw.criteria) ? raw.criteria.map((c) => String(c).toUpperCase()) : [];
    if (criteria.length > 6 || criteria.some((c) => !CRITERION_RE.test(c)) || new Set(criteria).size !== criteria.length) problems.push(`texts.${slot}.criteria: cel mult 6 criterii distincte de forma AC-n`);
    const entry = { criteria };
    for (const tone of ["business", "technical"]) {
      const text = normalizeRo(String(raw[tone] ?? ""));
      if (!text || text.length > 120 || text.includes("\n") || CONTROL.test(text)) problems.push(`texts.${slot}.${tone}: text de 1–120 de caractere, pe un rând`);
      else if (textViolations(text).length) problems.push(`texts.${slot}.${tone}: textul nu poate conține secrete, căi de pe calculator sau adrese reale`);
      const ungated = citedCriteria(text).filter((id) => !criteria.includes(id));
      if (ungated.length) problems.push(`texts.${slot}.${tone}: textul numește ${ungated.join(", ")}, dar nu este condiționat de ${ungated.length === 1 ? "el" : "ele"} (criteria); ar rămâne pe ecran și când ${ungated.length === 1 ? "acel criteriu nu a trecut" : "acele criterii nu au trecut"}`);
      entry[tone] = text;
    }
    texts[slot] = entry;
  }
  const platformKey = input.variant?.platformKey === undefined ? STORY.platformKey : String(input.variant.platformKey);
  if (!PLATFORM_KEYS.includes(platformKey)) problems.push(`variant.platformKey: profil necunoscut „${platformKey.slice(0, 40)}”`);
  const overrides = {};
  const rawOverrides = input.variant?.overrides ?? input.variantOverrides ?? {};
  if (!isObject(rawOverrides)) problems.push("variant.overrides: trebuie să fie un obiect { hookText, ctaText }");
  else {
    for (const key of Object.keys(rawOverrides)) {
      if (!["hookText", "ctaText"].includes(key)) { problems.push(`variant.overrides.${key.slice(0, 30)}: doar hookText și ctaText se pot schimba în varianta verticală`); continue; }
      const text = normalizeRo(String(rawOverrides[key] ?? ""));
      const ungated = citedCriteria(text).filter((id) => !(texts[OVERRIDE_SLOT[key]]?.criteria || []).includes(id));
      if (!text || text.length > 120 || text.includes("\n") || textViolations(text).length) problems.push(`variant.overrides.${key}: text de 1–120 de caractere, pe un rând`);
      else if (ungated.length) problems.push(`variant.overrides.${key}: textul numește ${ungated.join(", ")}, dar textul pe care îl înlocuiește (texts.${OVERRIDE_SLOT[key]}) nu este condiționat de ${ungated.length === 1 ? "el" : "ele"}`);
      else overrides[key] = text;
    }
  }
  const evidenceNote = input.evidenceNote === undefined || input.evidenceNote === null ? null : clean(input.evidenceNote, 80);
  const exportPrefix = input.exportPrefix === undefined || input.exportPrefix === null ? null : String(input.exportPrefix);
  if (exportPrefix !== null && !EXPORT_PREFIX_RE.test(exportPrefix)) problems.push("exportPrefix: litere mici, cifre și cratime (2–31 de caractere)");
  const redactSelectors = Array.isArray(input.redactSelectors) ? input.redactSelectors : [];
  if (redactSelectors.length > 20 || redactSelectors.some((s) => !safeSelector(s))) problems.push("redactSelectors: cel mult 20 de selectori CSS valizi");
  // M11: the commercial summary's template text (problem, flow, benefits gated on criteria, questions), fact-guarded at definition time.
  const summaryPart = normalizeSummaryBlock(input.summary);
  problems.push(...summaryPart.problems);
  const block = { noun, issue: input.issue ? clean(input.issue, 160) : null, proofSelector: String(input.proofSelector || "").trim(), bannerSelector: String(input.bannerSelector || "").trim(),
    evidenceNote: evidenceNote || null, exportPrefix, redactSelectors: redactSelectors.map((s) => String(s).trim()), texts, variant: { platformKey, overrides },
    ...(summaryPart.summary ? { summary: summaryPart.summary } : {}) };
  return { block, problems };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Capture scripts from the approved E2E steps
// ---------------------------------------------------------------------------------------------------------------------------

const blocker = (code, title, detail) => ({ code, title, detail });

/** The spec object inside a factory view ({ spec: { spec, version, sha256 } }), a spec row ({ spec, version, sha256 }) or a bare spec. */
function specParts(source) {
  const row = isObject(source?.spec) && isObject(source.spec.spec) ? source.spec : isObject(source?.spec) && Array.isArray(source.spec.acceptance) ? source : null;
  if (row) return { spec: row.spec, version: Number.isInteger(row.version) ? row.version : null, sha256: typeof row.sha256 === "string" ? row.sha256 : null };
  return { spec: isObject(source) && Array.isArray(source.acceptance) ? source : null, version: null, sha256: null };
}

/** The E2E criteria that carry steps, with the viewport they start at. → [{ id, text, width, height, steps }] */
export function e2eCriteria(spec) {
  const list = Array.isArray(spec?.acceptance) ? spec.acceptance : [];
  return list.filter((a) => a && a.verify === "e2e" && Array.isArray(a.steps) && a.steps.length).map((a) => {
    const first = a.steps.find((s) => isObject(s) && isObject(s.viewport));
    return { id: String(a.id), text: String(a.text || ""), steps: a.steps,
      width: Number.isInteger(first?.viewport?.width) ? first.viewport.width : VIEWPORT_RULES.defaultWidth,
      height: Number.isInteger(first?.viewport?.height) ? first.viewport.height : VIEWPORT_RULES.defaultHeight };
  });
}
/** The first E2E criterion at a phone width (≤ 480) and the first at a desktop width (≥ 1024); null when the spec has none. */
export function pickCaptureCriteria(spec) {
  const all = e2eCriteria(spec);
  return { mobile: all.find((c) => c.width <= VIEWPORT_RULES.mobileMaxWidth) || null, desktop: all.find((c) => c.width >= VIEWPORT_RULES.desktopMinWidth) || null };
}

const boundedInt = (value, fallback, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);

/**
 * `captureScriptFrom(e2eSteps, { noun, role, proofSelector, pacing })` →
 *   { ok, role, steps, blockers, viewport, deviceScaleFactor, sourceViewport, evidenceSelectors, proofSelector, proofTexts, demoNote, estimatedMs }
 * `steps` pass media/capture.mjs validateDemoSteps (they are its normalized output) and are [] when a blocker exists. Typed values
 * come only from the approved `fill` values (`{run}` → "Prezentare"); a value that looks like a secret, a user path or a real e-mail
 * is a blocker, not a frame. `pacing` ({ settleMs, proofHoldMs, highlightMs, typeDelayMs }) only adds `wait` steps and durations —
 * they are part of the steps, so the plan hashes them.
 */
export function captureScriptFrom(e2eSteps, { noun, role, proofSelector, pacing = {} } = {}) {
  if (!CAPTURE_ROLES.includes(role)) throw new HubError("validation", `Rol de captură necunoscut: ${String(role).slice(0, 20)} (desktop sau mobile).`, { code: "DELIVERY_CAPTURE_ROLE" });
  const preset = CAPTURE_PRESETS[role];
  const word = clean(noun, 40) || "demo";
  const settleMs = boundedInt(pacing?.settleMs, CAPTURE_PACING.settleMs, 0, 5000);
  const proofHoldMs = boundedInt(pacing?.proofHoldMs, CAPTURE_PACING.proofHoldMs, 0, 5000);
  const highlightMs = boundedInt(pacing?.highlightMs, CAPTURE_PACING.highlightMs, 200, 5000);
  const typeDelayMs = boundedInt(pacing?.typeDelayMs, CAPTURE_PACING.typeDelayMs, 0, 300);
  const blockers = [];
  const base = { role, viewport: { ...preset.viewport }, deviceScaleFactor: preset.dsf, proofSelector: safeSelector(proofSelector) ? proofSelector.trim() : null, demoNote: `${word} ${ROLE_WORD[role]}` };
  const fail = () => ({ ok: false, ...base, steps: [], blockers, sourceViewport: null, evidenceSelectors: [], proofTexts: [], estimatedMs: 0 });
  const e2eProblems = validateE2ESteps(e2eSteps);
  if (e2eProblems.length) {
    blockers.push(blocker("DELIVERY_E2E_INVALID", "Pașii E2E ai criteriului nu sunt valizi", e2eProblems.join("; ")));
    return fail();
  }
  const steps = [];
  const evidenceSteps = []; // the highlight steps of expectSelector: their selectors are read back AFTER normalization (below)
  const proofTexts = [];
  let sourceViewport = null;
  let pageStarted = false;
  let demoMarked = false;
  let lastProofAt = -1;
  for (const [index, step] of e2eSteps.entries()) {
    const [kind] = Object.keys(step);
    const value = step[kind];
    const n = index + 1;
    if (kind === "viewport") {
      if (pageStarted) blockers.push(blocker("DELIVERY_STEP_UNSUPPORTED", "Schimbare de fereastră în mijlocul pașilor", `Pasul ${n} schimbă dimensiunea ferestrei după ce pagina a pornit; o captură are o singură dimensiune (${preset.label}).`));
      else sourceViewport = { width: value.width, height: value.height };
    } else if (kind === "goto") {
      steps.push({ goto: value }, { marker: { kind: "chapter", note: pageStarted ? `pagina ${value}`.slice(0, 120) : "intro" } });
      if (!pageStarted && settleMs) steps.push({ wait: settleMs });
      pageStarted = true;
    } else if (kind === "fill") {
      const text = String(value.value).split(E2E_RUN_TOKEN).join(CAPTURE_PACING.runWord);
      if (textViolations(text).length) blockers.push(blocker("DELIVERY_TYPED_TEXT", "Un text tastat nu arată a dată sintetică", `Pasul ${n} tastează un text care seamănă cu un secret, o cale de pe calculator sau o adresă reală; captura folosește doar date sintetice.`));
      steps.push({ type: { selector: value.selector, text, delayMs: typeDelayMs } });
    } else if (kind === "click") {
      if (!demoMarked) { steps.push({ marker: { kind: "demo", note: base.demoNote } }); demoMarked = true; }
      steps.push({ highlight: { selector: value, ms: highlightMs } }, { click: value });
    } else if (kind === "expectSelector") {
      const shown = { highlight: { selector: value, ms: highlightMs } };
      steps.push({ waitFor: value }, shown);
      evidenceSteps.push(shown);
    } else if (kind === "expectText") {
      if (!base.proofSelector) { blockers.push(blocker("DELIVERY_PROOF_SELECTOR", "Lipsește selectorul stării de succes", `Pasul ${n} așteaptă un text, dar șablonul de livrare nu are un proofSelector valid pentru a arăta dovada.`)); continue; }
      const note = clean(String(value).split(E2E_RUN_TOKEN).join(CAPTURE_PACING.runWord), 300);
      steps.push({ waitFor: base.proofSelector }, { highlight: { selector: base.proofSelector, ms: highlightMs } }, { marker: { kind: "proof", note } });
      proofTexts.push(note);
      lastProofAt = steps.length;
    } else if (kind === "select") {
      blockers.push(blocker("DELIVERY_STEP_UNSUPPORTED", "Pas E2E care nu poate fi filmat", `Pasul ${n} alege dintr-o listă (select); captura demo nu are un pas echivalent, așa că acest criteriu nu poate fi filmat în M11.`));
    }
    // noHorizontalOverflow is a check, not something to show: dropped.
  }
  if (lastProofAt >= 0 && proofHoldMs) steps.splice(lastProofAt, 0, { wait: proofHoldMs });
  if (steps.length > DEMO_MAX_STEPS) blockers.push(blocker("DELIVERY_CAPTURE_TOO_LONG", "Prea mulți pași pentru o captură", `Criteriul ar da ${steps.length} pași demo; o captură are cel mult ${DEMO_MAX_STEPS}.`));
  // A coarse lower bound of the recording time (waits + highlights + typing + one second per navigation); real pages add latency.
  const estimatedMs = steps.reduce((ms, s) => ms + (s.wait ?? 0) + (s.highlight?.ms ?? 0) + (s.type ? s.type.text.length * s.type.delayMs : 0) + (s.goto ? 1000 : 0) + (s.click || s.waitFor ? 150 : 0), 0);
  if (estimatedMs > preset.maxDurationMs - 10000) blockers.push(blocker("DELIVERY_CAPTURE_TOO_LONG", "Captura ar depăși durata maximă", `Pașii ar dura cel puțin ${Math.round(estimatedMs / 1000)} s; o captură are cel mult ${preset.maxDurationMs / 1000} s.`));
  if (blockers.length) return fail();
  let normalized;
  try { normalized = validateDemoSteps(steps); }
  catch (error) {
    blockers.push(blocker("DELIVERY_STEPS_INVALID", "Pașii demo derivați nu sunt valizi", String(error?.message || error).slice(0, 400)));
    return fail();
  }
  // The evidence selectors are the selectors of the EMITTED highlight steps, i.e. as validateDemoSteps normalized them (it trims a
  // selector; the approved E2E step may carry spaces around it). The capture records a highlight under its step's selector and
  // clip-ir.mjs matches by exact string, so a raw selector here would lose the evidence marker and its regions.
  const evidenceSelectors = [...new Set(evidenceSteps.map((step) => normalized[steps.indexOf(step)].highlight.selector))];
  return { ok: true, ...base, steps: normalized, blockers, sourceViewport, evidenceSelectors, proofTexts, estimatedMs };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tools identity and readiness
// ---------------------------------------------------------------------------------------------------------------------------

const toolIdentity = (t) => (isObject(t) && typeof t.sha256 === "string" && t.sha256 ? { version: t.version ? String(t.version).slice(0, 80) : null, sha256: t.sha256, libsSha256: t.libsSha256 ? String(t.libsSha256) : null } : null);
/**
 * Accepts the identity map ({ ffmpeg, ffprobe }), { state, identity } or the result of ops/intent-actions.mjs studioRenderReadiness
 * ({ tools: "PINNED" | …, identity }). → { state: "PINNED" | "UNPINNED" | "CHANGED" | "MISSING" | null, identity: { ffmpeg, ffprobe } | null }
 */
export function toolsOf(input, stateOverride = null) {
  if (!isObject(input)) return { state: TOOL_STATES.includes(stateOverride) ? stateOverride : null, identity: null };
  const rawState = stateOverride ?? (typeof input.state === "string" ? input.state : typeof input.tools === "string" ? input.tools : null);
  const source = isObject(input.identity) ? input.identity : input;
  const identity = {};
  for (const name of ["ffmpeg", "ffprobe"]) { const id = toolIdentity(source[name]); if (id) identity[name] = id; }
  return { state: TOOL_STATES.includes(rawState) ? rawState : null, identity: Object.keys(identity).length === 2 ? identity : null };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------------------------------------

function previewOf(spec, config) {
  const preview = spec?.verification?.preview;
  if (!isObject(preview) || !preview.url || !preview.command) return { preview: null, origin: null, problem: blocker("DELIVERY_NO_PREVIEW", "Specificația nu are un preview", "Livrarea filmează preview-ul local al versiunii verificate; specificația misiunii nu definește unul (verification.preview).") };
  let origin = null;
  try { origin = new URL(String(preview.url)).origin; } catch { origin = null; }
  if (!origin || origin === "null") return { preview, origin: null, problem: blocker("DELIVERY_PREVIEW_ORIGIN", "Adresa preview-ului nu este validă", "Adresa de preview din specificație nu este un URL local valid.") };
  try { assertCaptureOrigin(origin, { config }); }
  catch (error) {
    const live = error?.code === "CAPTURE_ORIGIN_LIVE";
    return { preview, origin, problem: blocker(live ? "DELIVERY_PREVIEW_PORT_LIVE" : "DELIVERY_PREVIEW_ORIGIN", live ? "Preview-ul folosește un port al Hub-ului" : "Adresa preview-ului nu poate fi filmată", String(error?.message || error)) };
  }
  return { preview, origin, problem: null };
}

function scriptsFor(spec, block) {
  const picked = pickCaptureCriteria(spec);
  const blockers = [];
  const scripts = {};
  if (!picked.mobile) blockers.push(blocker("DELIVERY_E2E_MOBILE_MISSING", "Lipsește verificarea la lățimea unui telefon", `Specificația nu are un criteriu E2E cu pași la o lățime de cel mult ${VIEWPORT_RULES.mobileMaxWidth} px; fără el nu există ce să filmez la lățimea unui telefon.`));
  if (!picked.desktop) blockers.push(blocker("DELIVERY_E2E_DESKTOP_MISSING", "Lipsește verificarea pe desktop", `Specificația nu are un criteriu E2E cu pași la o lățime de cel puțin ${VIEWPORT_RULES.desktopMinWidth} px; fără el nu există ce să filmez pe desktop.`));
  for (const role of CAPTURE_ROLES) {
    const criterion = picked[role];
    if (!criterion || !block) continue;
    const script = captureScriptFrom(criterion.steps, { noun: block.noun, role, proofSelector: block.proofSelector });
    for (const b of script.blockers) blockers.push({ ...b, detail: `${criterion.id}: ${b.detail}` });
    scripts[role] = { criterion, script };
  }
  return { picked, scripts, blockers };
}

const PROJECT_BLOCKER_TITLES = Object.freeze({ DELIVERY_PROJECT_NOT_TEST: "Proiectul nu este un proiect de test", DELIVERY_DATA_NOT_SYNTHETIC: "Datele proiectului nu sunt declarate sintetice",
  DELIVERY_PROJECT_PATH: "Folderul proiectului nu poate fi folosit" });

/**
 * `eligibility(ctx)` → { ok, blockers: [{ code, title, detail }], pin, origin, criteria: { desktop, mobile } }.
 * ctx: { project, marker, demo, spec | missionView, route = "windows", missionIds = [], exportsDir, approvedFolders = [],
 *        browser (tools/browser.mjs browserStatus), tools (see toolsOf), config, knownFixtures }.
 * `pin` is { expect: identity } when ffmpeg/ffprobe are UNPINNED (the pin becomes the first step of the same plan); CHANGED and
 * MISSING are blockers (a changed binary is the owner's own decision in Studio → Unelte). Nothing is started or read from disk.
 */
export function eligibility(ctx = {}) {
  const { project = null, marker = null, demo = null, route = "windows", missionIds = [], exportsDir = null, approvedFolders = [], browser = null, tools = null, config = {} } = ctx;
  const blockers = [];
  const knownFixtures = Array.isArray(ctx.knownFixtures) ? ctx.knownFixtures : undefined;
  for (const p of syntheticProjectProblems(project, marker, { config, ...(knownFixtures ? { knownFixtures } : {}), realPath: ctx.realPath ?? null })) {
    blockers.push(blocker(p.code, PROJECT_BLOCKER_TITLES[p.code] || "Markerul proiectului de test nu este valid", p.message));
  }
  const { block, problems: blockProblems } = normalizeDeliveryBlock(demo?.delivery);
  if (!block) blockers.push(blocker("DELIVERY_NO_TEMPLATE", "Proiectul nu are un șablon de livrare", "Definiția fixture-ului nu are un bloc de livrare (texte, selectorul dovezii, bannerul de date sintetice); fără el nu pot construi clipul."));
  else if (blockProblems.length) blockers.push(blocker("DELIVERY_TEMPLATE_INVALID", "Șablonul de livrare al proiectului nu este valid", blockProblems.join("; ")));
  if (route !== "windows") {
    blockers.push(blocker("DELIVERY_ROUTE_NOT_WINDOWS", "Livrarea rulează doar pe ruta Windows", `Proiectul este pe ruta „${String(route).slice(0, 30)}”: preview-ul ei rulează într-un spațiu de rețea izolat la care captura din Windows nu ajunge. Captura în mediul izolat este amânată (M12).`));
  }
  const { spec } = specParts(ctx.spec ?? ctx.missionView);
  let origin = null;
  if (!spec) blockers.push(blocker("DELIVERY_NO_SPEC", "Misiunea nu are o specificație", "Nu am o specificație a misiunii din care să iau preview-ul și pașii E2E aprobați."));
  else {
    const pv = previewOf(spec, config);
    origin = pv.origin;
    if (pv.problem) blockers.push(pv.problem);
    blockers.push(...scriptsFor(spec, blockProblems.length ? null : block).blockers);
  }
  const missions = Array.isArray(missionIds) ? missionIds : [];
  if (missions.length > 1) blockers.push(blocker("DELIVERY_MULTI_MISSION", "O livrare acoperă o singură misiune", `Planul are ${missions.length} misiuni; captura, clipul și rezumatul se leagă de o singură versiune verificată.`));
  if (typeof exportsDir !== "string" || !exportsDir || !path.isAbsolute(exportsDir)) {
    blockers.push(blocker("DELIVERY_EXPORTS_DIR", "Nu există un folder de exporturi", "Nu există un folder local de exporturi aprobat (Studio → foldere de import); fără el nu am unde pune clipurile și rezumatul."));
  } else if (!insideAny(Array.isArray(approvedFolders) ? approvedFolders : [], exportsDir)) {
    blockers.push(blocker("DELIVERY_EXPORTS_NOT_APPROVED", "Folderul de exporturi nu este într-un folder aprobat", `Folderul ${exportsDir} nu este în folderele pe care le-ai aprobat; un plan derivat nu poate cere un folder nou.`));
  }
  if (!isObject(browser) || browser.installed !== true) {
    blockers.push(blocker("DELIVERY_PLAYWRIGHT_MISSING", "Lipsește browserul de verificare", "Playwright nu este instalat în proiectul Hub-ului (sau starea lui nu a putut fi citită); captura rulează doar în Chromium-ul izolat al Hub-ului."));
  } else if (Array.isArray(browser.cachedBrowsers) && !browser.cachedBrowsers.length) {
    blockers.push(blocker("DELIVERY_PLAYWRIGHT_MISSING", "Lipsește Chromium", "Playwright este instalat, dar Chromium nu este pe acest calculator; captura nu descarcă nimic singură."));
  }
  const t = toolsOf(tools);
  let pin = null;
  if (t.state === "CHANGED") blockers.push(blocker("DELIVERY_TOOLS_CHANGED", "ffmpeg sau ffprobe s-a schimbat", "Un binar de randare diferă de identitatea fixată; schimbarea o confirmi tu în Studio → Unelte, nu un plan."));
  else if (t.state === "MISSING") blockers.push(blocker("DELIVERY_TOOLS_MISSING", "ffmpeg sau ffprobe lipsește", "Uneltele de randare nu sunt pe acest calculator; se instalează în afara Hub-ului."));
  else if (t.state === "UNPINNED") {
    if (t.identity) pin = { expect: t.identity };
    else blockers.push(blocker("DELIVERY_TOOLS_MISSING", "Identitatea uneltelor de randare lipsește", "ffmpeg și ffprobe nu sunt fixate și identitatea lor nu a putut fi citită."));
  }
  const picked = spec ? pickCaptureCriteria(spec) : { desktop: null, mobile: null };
  // One line per distinct cause (a spec problem can surface through two checks).
  const seen = new Set();
  const unique = blockers.filter((b) => { const key = `${b.code}|${b.detail}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { ok: unique.length === 0, blockers: unique, pin, origin, criteria: { desktop: picked.desktop?.id || null, mobile: picked.mobile?.id || null } };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The frozen template
// ---------------------------------------------------------------------------------------------------------------------------

const dayOf = (day) => { const d = String(day ?? "").replace(/-/g, ""); return /^\d{8}$/.test(d) ? d : null; };

/** `demo-<noun>-<project slug>-<yyyymmdd>` (or the block's exportPrefix), a single path segment media.exportLocal accepts. */
export function exportFolderName({ prefix = null, noun, slug, day }) {
  const d = dayOf(day);
  if (!d) throw new HubError("validation", "Ziua folderului de export trebuie dată ca YYYYMMDD.", { code: "DELIVERY_DAY_REQUIRED" });
  const head = prefix && EXPORT_PREFIX_RE.test(prefix) ? prefix : `demo-${slugify(String(noun || "demo")) || "demo"}`.slice(0, 31);
  const middle = (slugify(String(slug || "")) || "proiect").slice(0, 80 - head.length - d.length - 2).replace(/-+$/, "") || "proiect";
  const folder = `${head}-${middle}-${d}`;
  if (!FOLDER_RE.test(folder)) throw new HubError("validation", "Numele folderului de export nu este valid.", { code: "DELIVERY_EXPORT_FOLDER" });
  return folder;
}

/**
 * `buildTemplate({ project, marker, missionView, demo, tools, toolsState, chromium, exportsDir, simulation, day, route, mode,
 *                  parentDeliveryId, config })` → the frozen template (plain JSON, deep-frozen).
 * `missionView` is factory.view(missionId) (or { mission, spec: { spec, version, sha256 } }); `demo` the fixture definition with its
 * `delivery` block; `tools` see toolsOf (`toolsState` overrides its state); `chromium` { version }; `exportsDir` the approved
 * exports folder; `day` "YYYYMMDD" — the caller's date at PLANNED (this module reads no clock); `simulation` = test mode or a
 * SIMULARE bundle (the capture label is then SIMULATION). Throws DELIVERY_TEMPLATE_INVALID listing every problem; callers show
 * blockers with `eligibility` first.
 */
export function buildTemplate({ project, marker, missionView, demo, tools = null, toolsState = null, chromium = null, exportsDir, simulation = false, day,
  route = "windows", mode = "new", parentDeliveryId = null, config = {}, extras = [] } = {}) {
  const problems = [];
  const extraList = DELIVERY_EXTRAS.filter((x) => (extras || []).includes(x));
  for (const x of extras || []) if (!DELIVERY_EXTRAS.includes(x)) problems.push(`livrabil necunoscut: ${String(x).slice(0, 30)}`);
  if (!isObject(project) || !project.id || !project.name) problems.push("proiectul lipsește");
  if (!isObject(marker) || typeof marker.fixture !== "string" || marker.data !== "synthetic") problems.push("markerul proiectului nu declară un fixture cu date sintetice");
  if (route !== "windows") problems.push(`ruta „${String(route).slice(0, 30)}” nu poate fi filmată (doar windows)`);
  if (!["new", "refresh"].includes(mode)) problems.push("mode trebuie să fie new sau refresh");
  if (mode === "refresh" && !DELIVERY_ID_RE.test(String(parentDeliveryId || ""))) problems.push("o livrare refresh are nevoie de parentDeliveryId");
  if (mode === "new" && parentDeliveryId) problems.push("parentDeliveryId se dă doar pentru mode refresh");
  const { block, problems: blockProblems } = normalizeDeliveryBlock(demo?.delivery);
  problems.push(...blockProblems);
  const { spec, version: specVersion, sha256: specSha } = specParts(missionView);
  const missionId = String(missionView?.mission?.id || "");
  if (!missionId) problems.push("misiunea lipsește");
  if (!spec) problems.push("specificația misiunii lipsește");
  if (typeof exportsDir !== "string" || !exportsDir || !path.isAbsolute(exportsDir)) problems.push("folderul de exporturi lipsește sau nu este o cale absolută");
  const d = dayOf(day);
  if (!d) problems.push("ziua folderului de export (day, YYYYMMDD) lipsește");
  const t = toolsOf(tools, toolsState);
  if (!t.identity) problems.push("identitatea ffmpeg/ffprobe (versiune, sha256) lipsește");
  if (t.state === "CHANGED" || t.state === "MISSING") problems.push(`uneltele de randare sunt ${t.state}`);
  const chromiumVersion = chromium?.version ? String(chromium.version).slice(0, 80) : null;
  if (!chromiumVersion) problems.push("versiunea Chromium (Playwright) lipsește");
  let pv = { preview: null, origin: null, problem: null };
  let scripts = {};
  if (spec) {
    pv = previewOf(spec, config);
    if (pv.problem) problems.push(pv.problem.detail);
    if (block && !blockProblems.length) {
      const built = scriptsFor(spec, block);
      scripts = built.scripts;
      problems.push(...built.blockers.map((b) => b.detail));
    }
  }
  if (problems.length) throw invalid(`Șablonul de livrare nu poate fi construit: ${problems.join("; ")}`, problems);

  const captureLabel = simulation ? "SIMULATION" : "ORIGINAL_RECORDING";
  const redactSelectors = [...new Set([...DEFAULT_REDACT_SELECTORS, ...block.redactSelectors])];
  const captures = CAPTURE_ROLES.map((role) => {
    const { criterion, script } = scripts[role];
    const preset = CAPTURE_PRESETS[role];
    return { role, label: preset.label, criterion: criterion.id, viewport: { ...preset.viewport }, dsf: preset.dsf, fps: preset.fps, maxDurationMs: preset.maxDurationMs,
      steps: script.steps, stepsSha: hashCanonical(script.steps), evidenceSelectors: script.evidenceSelectors, proofSelector: script.proofSelector, demoNote: script.demoNote,
      redactSelectors, captureLabel };
  });
  const slug = project.slug ? String(project.slug) : slugify(String(project.name));
  const overrides = block.variant.overrides;
  const template = {
    schema: TEMPLATE_SCHEMA, template: STORY_TEMPLATE, mode, parentDeliveryId: mode === "refresh" ? String(parentDeliveryId) : null,
    project: { id: String(project.id), name: clean(project.name, 120), slug },
    fixture: marker.fixture, missionId, issueTitle: clean(spec.title || missionView?.mission?.title || block.issue || "", 160),
    specVersion, specSha,
    data: { kind: "synthetic", marker: TEST_PROJECT_MARKER, banner: SYNTHETIC_BANNER, bannerSelector: block.bannerSelector },
    route: "windows",
    preview: { origin: pv.origin, command: String(pv.preview.command), url: String(pv.preview.url) },
    simulation: Boolean(simulation), captureLabel,
    captures,
    story: { template: STORY_TEMPLATE, tone: STORY.tone, canvas: { ...STORY.canvas }, fps: { ...STORY.fps }, preset: { ...STORY.preset }, noun: block.noun,
      evidenceNote: block.evidenceNote, texts: block.texts, variant: { platformKey: block.variant.platformKey, overrides, overridesSha: hashCanonical(overrides) } },
    summary: { template: SUMMARY_TEMPLATE, serviceRefs: [] },
    tools: { ffmpeg: t.identity.ffmpeg, ffprobe: t.identity.ffprobe, chromium: { version: chromiumVersion } },
    exports: { dir: exportsDir, folder: exportFolderName({ prefix: block.exportPrefix, noun: block.noun, slug, day: d }) },
    limits: { phaseMinutes: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions },
    pin: t.state === "UNPINNED" ? { expect: t.identity } : null,
    // Only when asked: a template without extras keeps the M11 shape (and hash) byte for byte.
    ...(extraList.length ? { extras: extraList } : {}),
  };
  return deepFreeze(JSON.parse(JSON.stringify(template)));
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

/** sha256 of the canonical template (deliveries.template_sha). */
export const templateSha = (template) => hashCanonical(template);

function requireTemplate(template) {
  if (!isObject(template) || template.schema !== TEMPLATE_SCHEMA || template.template !== STORY_TEMPLATE || !Array.isArray(template.captures)
    || !isObject(template.exports) || !isObject(template.story) || !isObject(template.tools)) {
    throw new HubError("validation", "Șablonul de livrare lipsește sau are altă schemă.", { code: "DELIVERY_TEMPLATE_INVALID" });
  }
  return template;
}
const deliveryIdOf = (id) => {
  if (!DELIVERY_ID_RE.test(String(id ?? ""))) throw new HubError("validation", "Identificatorul livrării (dlv_…) lipsește sau nu este valid.", { code: "DELIVERY_ID_INVALID" });
  return String(id);
};

// ---------------------------------------------------------------------------------------------------------------------------
// The hashed envelope section
// ---------------------------------------------------------------------------------------------------------------------------

/** What the delivery phase produces, what it never does and what stays the owner's — fixed lines, shown on the card and hashed. */
export const DELIVERY_NEVER = Object.freeze(["publicare", "încărcare (upload)", "mesaje către oricine", "commit, push sau deploy", "acceptarea software-ului", "aprobarea creativă",
  "înregistrarea drepturilor", "aprobarea rezumatului", "date reale", "alte proiecte", "prețuri sau termene inventate", "OBS, ecranul tău sau CapCut", "niciun model după DELIVERY_READY"]);
export const DELIVERY_DECISIONS_LEFT = Object.freeze(["Accept local (software)", "aprobarea creativă a clipului 16:9", "aprobarea creativă a variantei verticale",
  "drepturile pentru uz public", "rezumatul „gata de prezentare”"]);
const EXTRA_OUTPUTS = Object.freeze({ document: "document Word (verificat în Word, cu PDF)", workbook: "registru Excel cu date demonstrative (formule recalculate de Excel)", campaign: "pachet de campanie pregătit local (nepublicat)" });
const outputsOf = (t) => ["clip 16:9 cu QA automat", "variantă verticală 9:16 cu QA automat", "rezumat comercial v1 (Markdown + HTML)", ...(t.extras || []).map((x) => EXTRA_OUTPUTS[x]),
  `folder local: ${t.exports.folder} (în folderul de exporturi aprobat)`];

/**
 * `sectionOf(template, { deliveryId, ops: { stepTitles, bodySha } })` → body.delivery of the envelope (hashed with the rest of it).
 * `deliveryId` and `ops` come from the delivery service (the row id; the titles and hashCanonical of opsPlans.buildBody for
 * packageSteps); without them the fields are null / [] — a section is only hashed once they are set. `templateSha` and `specSha`
 * bind the frozen template and the approved spec, so a change of either supersedes the card („pașii de după livrare”).
 */
export function sectionOf(template, { deliveryId = null, ops = null } = {}) {
  const t = requireTemplate(template);
  const stepTitles = Array.isArray(ops?.stepTitles) ? ops.stepTitles.map((s) => String(s).slice(0, 160)) : [];
  return {
    schema: 1, deliveryId: deliveryId === null ? null : deliveryIdOf(deliveryId), mode: t.mode, parentDeliveryId: t.parentDeliveryId, missionId: t.missionId, issueTitle: t.issueTitle,
    specSha: t.specSha, templateSha: templateSha(t),
    data: { kind: t.data.kind, marker: t.data.marker, banner: t.data.banner },
    route: t.route, preview: { origin: t.preview.origin, command: t.preview.command },
    captures: t.captures.map((c) => ({ role: c.role, viewport: { ...c.viewport }, dsf: c.dsf, fps: c.fps, maxDurationMs: c.maxDurationMs, stepsSha: c.stepsSha })),
    story: { template: t.story.template, tone: t.story.tone, canvas: `${t.story.canvas.width}x${t.story.canvas.height}`, fps: `${t.story.fps.num}/${t.story.fps.den}`,
      variant: { platformKey: t.story.variant.platformKey, overridesSha: t.story.variant.overridesSha } },
    summary: { template: t.summary.template, serviceRefs: [...t.summary.serviceRefs] },
    tools: { ffmpeg: { ...t.tools.ffmpeg }, ffprobe: { ...t.tools.ffprobe }, chromium: { ...t.tools.chromium } },
    exports: { dir: t.exports.dir, folder: t.exports.folder }, limits: { phaseMinutes: t.limits.phaseMinutes, maxActions: t.limits.maxActions },
    ops: { kind: PACKAGE_KIND, stepTitles, bodySha: typeof ops?.bodySha === "string" && ops.bodySha ? ops.bodySha : null },
    outputs: outputsOf(t), never: [...DELIVERY_NEVER], decisionsLeft: [...DELIVERY_DECISIONS_LEFT],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Plan steps
// ---------------------------------------------------------------------------------------------------------------------------

const variantParams = (t) => ({ platformKey: t.story.variant.platformKey, qaUse: "internal", ...(Object.keys(t.story.variant.overrides || {}).length ? { overrides: { ...t.story.variant.overrides } } : {}) });

/**
 * `packageSteps(template, deliveryId)` → [{ kind, title?, params }] — 10 steps, or 11 with the media.tools.pin pre-step when the
 * tools were UNPINNED at proposal (the `$pas:` references shift with it). Same input → same output, byte for byte.
 */
export function packageSteps(template, deliveryId) {
  const t = requireTemplate(template);
  const id = deliveryIdOf(deliveryId);
  const steps = [];
  if (t.pin) steps.push({ kind: "media.tools.pin", params: { expect: JSON.parse(JSON.stringify(t.pin.expect)) } });
  const base = steps.length;
  const ref = (n, field) => `$pas:${base + n}.${field}`;
  steps.push(
    { kind: "delivery.prepare", title: "Verifică pachetul software și pregătește proiectul de conținut al livrării", params: { deliveryId: id } },
    { kind: "delivery.preview.ensure", title: `Pornește sau refolosește preview-ul versiunii verificate (${t.preview.origin})`, params: { deliveryId: id } },
    { kind: "delivery.capture", title: "Filmează demo-ul pe desktop (1280×720, date sintetice, browser izolat)", params: { deliveryId: id, role: "desktop" } },
    { kind: "delivery.capture", title: "Filmează demo-ul la lățimea unui telefon (390 px) în Chromium (date sintetice, browser izolat)", params: { deliveryId: id, role: "mobile" } },
    { kind: "delivery.edit.build", title: "Construiește montajul 16:9 din cele două capturi (fără model)", params: { deliveryId: id } },
    { kind: "media.render", title: "Randează clipul 16:9 și rulează QA automat (uz intern)", params: { editVersionId: ref(5, "editVersionId"), profile: "final", qaUse: "internal" } },
    { kind: "media.variant.render", title: "Derivă varianta verticală 9:16, randeaz-o și rulează QA automat (uz intern)", params: { masterVersionId: ref(5, "editVersionId"), ...variantParams(t) } },
    { kind: "delivery.export", title: `Exportă local cele două clipuri în ${t.exports.folder} (fără publicare)`, params: { deliveryId: id, master: ref(6, "assetVersionId"), vertical: ref(7, "assetVersionId") } },
    { kind: "delivery.summary.render", title: "Scrie rezumatul comercial v1 (Markdown + HTML, fără prețuri inventate)", params: { deliveryId: id } },
  );
  // Stage before M12: the office artifacts the owner asked for, in the same folder, before the delivery is closed.
  const extraKinds = { document: "delivery.office.document", workbook: "delivery.office.workbook", campaign: "delivery.campaign" };
  for (const x of t.extras || []) steps.push({ kind: extraKinds[x], params: { deliveryId: id } });
  if ((t.extras || []).length) steps.push({ kind: "delivery.package.index", params: { deliveryId: id } });
  steps.push({ kind: "delivery.finish", title: "Leagă dovezile de versiunea verificată și încheie livrarea", params: { deliveryId: id, render: ref(6, "renderJobId"), variant: ref(7, "variantId"), verticalEdit: ref(7, "editVersionId") } });
  if (steps.length > DELIVERY_LIMITS.maxSteps) throw new HubError("internal", "Planul de livrare depășește numărul maxim de pași.", { code: "DELIVERY_STEPS_LIMIT" });
  return steps;
}

/**
 * `revisionSteps(template, deliveryId, revisionId)` → the 6 steps of ONE media revision ('delivery.revise'): apply the recorded
 * OPEN review, render the master, re-derive and render the vertical, export the new versions (never overwriting), regenerate only
 * the video section of the summary, bind and supersede. No capture, no factory step, no model.
 */
export function revisionSteps(template, deliveryId, revisionId) {
  const t = requireTemplate(template);
  const id = deliveryIdOf(deliveryId);
  if (!REVISION_ID_RE.test(String(revisionId ?? ""))) throw new HubError("validation", "Identificatorul revizuirii (drv_…) lipsește sau nu este valid.", { code: "DELIVERY_REVISION_ID_INVALID" });
  const ref = (n, field) => `$pas:${n}.${field}`;
  return [
    { kind: "delivery.revise.apply", title: "Aplică revizuirea pe montaj (versiune nouă, cea veche rămâne)", params: { deliveryId: id, revisionId: String(revisionId) } },
    { kind: "media.render", title: "Randează clipul 16:9 revizuit și rulează QA automat (uz intern)", params: { editVersionId: ref(1, "editVersionId"), profile: "final", qaUse: "internal" } },
    { kind: "media.variant.render", title: "Reface varianta verticală 9:16 din montajul revizuit, cu QA automat (uz intern)", params: { masterVersionId: ref(1, "editVersionId"), ...variantParams(t) } },
    { kind: "delivery.export", title: `Exportă local versiunile noi în ${t.exports.folder} (fără suprascriere, fără publicare)`, params: { deliveryId: id, master: ref(2, "assetVersionId"), vertical: ref(3, "assetVersionId") } },
    { kind: "delivery.summary.render", title: "Actualizează doar secțiunea video a rezumatului", params: { deliveryId: id, only: "video" } },
    { kind: "delivery.finish", title: "Leagă versiunile noi și marchează-le pe cele vechi ca înlocuite", params: { deliveryId: id, render: ref(2, "renderJobId"), variant: ref(3, "variantId"), verticalEdit: ref(3, "editVersionId"), mode: "revision" } },
  ];
}
