import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hashCanonical } from "../server/core/canonical.mjs";
import { criterionFingerprint as fp, criterionProof, criterionRef, parseCriterionRef, displaySha } from "../server/media/claims.mjs";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";
import { normalizePresentation, resolvePresentation, storyFromPresentation, provePresentation, presentationForTemplate } from "../server/delivery/presentation.mjs";
import { renderSummary, summaryFactCheck, editSummary, regenerateSummary } from "../server/delivery/summary.mjs";
import { buildTemplate, pickCaptureCriteria, captureScriptFrom } from "../server/delivery/template.mjs";
import { buildMaster } from "../server/delivery/clip-ir.mjs";
import { factualCheck, createMediaQa } from "../server/media/qa.mjs";
import { createContent } from "../server/media/content.mjs";
import { irHash } from "../server/media/ir.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import { deriveCriteria, withField, withoutField } from "../server/owner/planners/criteria.mjs";
import { createDeliveryExecutors } from "../server/delivery/executors.mjs";
import { createExecutors } from "../server/ops/executors.mjs";
import { createFactory } from "../server/factory/factory.mjs";
import { createDeliveries } from "../server/delivery/delivery.mjs";
import { registerDeliveryCommands } from "../server/delivery/delivery-commands.mjs";
import { makeMediaEnv, fakeLaunchers } from "./media-helpers.mjs";

const copy = v => structuredClone(v);
const spec = JSON.parse(fs.readFileSync(new URL("fixtures/s25-spec-a69b8e9f.json", import.meta.url)));
const baseline = JSON.parse(fs.readFileSync(new URL("fixtures/claims-baseline.json", import.meta.url)));
const catalog = BOOKING_DEMO.delivery.presentations;
const resolve = (s = spec, presentations = catalog) => resolvePresentation({ presentations, spec: s, specSha: hashCanonical(s), noun: "programare", captures: pickCaptureCriteria(s) });
function factsOf(s = spec) {
  const manifest = { spec: { sha256: hashCanonical(s), version: 1, protectedTests: {}, criteria: [] }, changeSet: { id: "cs_test", sha256: "c".repeat(64) }, start: { command: "node server.js" }, evidence: [], reviews: [] };
  const evidenceRows = [], reviewRows = [];
  for (const c of s.acceptance) {
    const id = "ev_" + c.id, review = c.verify === "review";
    manifest.spec.criteria.push({ ...copy(c), status: review ? "PASS_REVIEW" : "PASS_EVIDENCE", evidence: [id] });
    if (review) {
      manifest.reviews.push({ id, status: "VALID", verdict: "PASS", problems: [], changeSet: "c".repeat(12) });
      reviewRows.push({ id, status: "VALID", verdict: "PASS", change_set_id: "cs_test", validation_json: '{"problems":[]}' });
    } else {
      const stage = { test: "QA", e2e: "E2E", preview: "PREVIEW" }[c.verify];
      const command = c.verify === "test" ? `node --test ${c.testRef}` : c.verify === "e2e" ? `e2e ${c.id}` : "node server.js";
      const counts = { tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0 };
      manifest.evidence.push({ id, stage, command, status: "PASS", counts });
      evidenceRows.push({ id, stage, command, status: "PASS", counts: copy(counts), stale: 0, change_set_id: "cs_test", detail: { criterion: c.id, steps: (c.steps || []).map(s => ({ kind: Object.keys(s)[0], ok: true })) } });
      if (c.testRef) manifest.spec.protectedTests[c.testRef] = "a".repeat(64);
    }
  }
  return { manifest, bundle: { id: "bnd_test", sha256: hashCanonical(manifest), status: "READY_FOR_OWNER_ACCEPTANCE", change_set_id: "cs_test" }, spec: s, specRow: { sha256: hashCanonical(s) }, evidenceRows, reviewRows };
}
const proof = (f, id) => criterionProof({ ...f, id, expectedFp: fp(f.spec.acceptance.find(c => c.id === id), { previewCommand: "node server.js" }) });
const docOf = (p = resolve(), f = factsOf()) => renderSummary({ presentation: p, proofs: provePresentation(p, f), manifest: f.manifest, bundleId: f.bundle.id, bundleSha: f.bundle.sha256, generatedAt: "2026-10-16T00:00:00Z", issue: f.spec.title });
const templateOf = (demo = BOOKING_DEMO) => buildTemplate({ demo, project: { id: "prj_test", name: "Test" }, marker: { fixture: "booking-demo", data: "synthetic" }, missionView: { mission: { id: "mis_test" }, spec: { spec, version: 1, sha256: hashCanonical(spec) } }, tools: { state: "PINNED", identity: { ffmpeg: { version: "1", sha256: "a".repeat(64) }, ffprobe: { version: "1", sha256: "b".repeat(64) } } }, chromium: { version: "test" }, exportsDir: path.resolve(".tmp-s25-a/exports"), day: "20261016" });
const captures = ["desktop", "mobile"].map((role, i) => ({ role, assetVersionId: "mav_" + role, durationMs: 22000, width: i ? 390 : 1280, height: 844, captureLabel: "ORIGINAL_RECORDING", markers: [] }));
function master(p = resolve()) {
  return buildMaster({ captures, texts: storyFromPresentation(p).texts, claimIdBySlot: { hook: "cl_hook", desktop: "cl_desktop", mobile: "cl_mobile", cta: "cl_cta" }, claimIdByRole: { desktop: "cl_capdesktop", mobile: "cl_capmobile" }, deliveryId: "dlv_test" }).ir;
}
test("RC-01 criterion fingerprints preserve identity, change with every relevant field, and ignore provenance", () => {
  const c = spec.acceptance[0];
  for (const change of [{ id: "AC-99" }, { origin: "other" }, { status: "FAIL", evidence: [], note: "other", provenance: "hub_authored" }]) assert.equal(fp({ ...c, ...change }), fp(c));
  for (const change of [{ text: c.text + "!" }, { verify: "e2e" }, { testRef: "other.mjs" }, { kind: "other" }, { guard: !c.guard }, { expectFailure: "new" }]) assert.notEqual(fp({ ...c, ...change }), fp(c));
  const e = spec.acceptance.find(c => c.verify === "e2e");
  for (const steps of [[...e.steps, { expectText: "new" }], [...e.steps].reverse(), [{ viewport: { width: 400, height: 800 } }, ...e.steps.slice(1)]]) assert.notEqual(fp({ ...e, steps }), fp(e));
  assert.notEqual(fp({ text: "preview", verify: "preview" }, { previewCommand: "a" }), fp({ text: "preview", verify: "preview" }, { previewCommand: "b" }));
  assert.equal(fp({ ...c, text: " a\n  b " }), fp({ ...c, text: "a b" }));
  assert.deepEqual(parseCriterionRef(criterionRef(hashCanonical(spec), "AC-1")), { specSha: hashCanonical(spec), id: "AC-1" });
});
test("RC-02 pinned catalog: old reviewer claim cannot bind to privacy persistence; every privacy need binds", () => {
  for (const p of catalog) {
    assert.deepEqual(normalizePresentation(p).problems, []);
    const ref = p.key === "phone-privacy" ? spec : BOOKING_DEMO.spec;
    assert.equal(p.reference.specSha, hashCanonical(ref));
    for (const c of ref.acceptance) assert.equal(p.reference.criteria[c.id].fp, fp(c, { previewCommand: "node server.js" }));
  }
  const old = catalog[0].summary.demonstrates.find(c => c.text.includes("reviewer"));
  assert.deepEqual(old.needs, ["AC-4"]);
  assert.notEqual(catalog[0].reference.criteria["AC-4"].fp, fp(spec.acceptance.find(c => c.id === "AC-4")));
  assert.equal(resolve(spec, [catalog[0]]).status, "GENERATED");
  const p = resolve(); assert.equal(p.key, "phone-privacy");
  assert.ok(p.claims.every(c => c.status === "BOUND" && c.needs.every(n => n.id === n.refId)));
  assert.ok(Object.isFrozen(p.claims[0].needs));
});
test("RC-03 same id with changed text or verification method leaves dependent claims UNBOUND", () => {
  for (const change of [{ text: "Different" }, { verify: "test" }]) {
    const s = copy(spec); Object.assign(s.acceptance.find(c => c.id === "AC-8"), change);
    const c = resolve(s).claims.find(c => c.key === "clip.desktop");
    assert.equal(c.status, "UNBOUND"); assert.equal(c.reason.code, "CRITERION_MISSING");
  }
});
test("RC-04 renumbering preserves claims and renders new clip and summary citations", () => {
  const s = copy(spec); s.acceptance.forEach((c, i) => c.id = "AC-" + (30 - i));
  const p = resolve(s); assert.equal(p.key, "phone-privacy");
  assert.match(p.claims.find(c => c.key === "clip.desktop").texts.technical, /^AC-23:/);
  const doc = docOf(p, factsOf(s)); assert.match(doc.sections.find(s => s.id === "benefits").text, /dovadă: AC-30, AC-29, AC-21/);
  assert.equal(summaryFactCheck({ doc, presentation: p, proofs: provePresentation(p, factsOf(s)), spec: s }).status, "PASS");
});
test("RC-05 duplicate fingerprints and multiple applicable stories never choose by order", () => {
  const s = copy(spec); s.acceptance.push({ ...s.acceptance.find(c => c.id === "AC-8"), id: "AC-99" });
  assert.equal(resolve(s).claims.find(c => c.key === "clip.desktop").reason.code, "CRITERION_AMBIGUOUS");
  assert.equal(resolve(spec, [catalog[1], { ...catalog[1], key: "second-story" }]).reason.code, "AMBIGUOUS");
});
test("RC-06 per-method proof rejects missing, stale, wrong-stage, failed, skipped and mismatched evidence", () => {
  const cases = [
    ["AC-1", f => f.evidenceRows.shift()], ["AC-1", f => f.evidenceRows[0].stage = "E2E"], ["AC-1", f => f.evidenceRows[0].status = "FAIL"],
    ["AC-1", f => f.evidenceRows[0].counts.skipped = 1], ["AC-1", f => f.evidenceRows[0].stale = 1], ["AC-1", f => f.evidenceRows[0].change_set_id = "other"],
    ["AC-11", f => f.manifest.reviews[0].changeSet = "step0testsha"], ["AC-7", f => f.evidenceRows.find(r => r.command === "e2e AC-7").command = "e2e AC-8"],
    ["AC-7", f => f.evidenceRows.find(r => r.command === "e2e AC-7").detail.steps.pop()],
    ["AC-7", f => f.manifest.spec.criteria.find(c => c.id === "AC-7").status = "NEEDS_INSTALL_APPROVAL"],
    ["AC-7", f => f.manifest.spec.criteria.find(c => c.id === "AC-7").status = "VERIFICARE_MANUALĂ"],
  ];
  for (const [id, mutate] of cases) {
    const f = factsOf(); mutate(f); f.bundle.sha256 = hashCanonical(f.manifest); assert.equal(proof(f, id).ok, false, id);
    const d = docOf(resolve(), f); assert.match(d.sections.find(s => s.id === "cannot_claim").text, /Nu afirmăm: «/);
  }
  const f = factsOf(); f.bundle.sha256 = "0".repeat(64); assert.equal(proof(f, "AC-1").ok, false);
  for (const c of spec.acceptance) assert.equal(proof(factsOf(), c.id).ok, true, c.id);
});
test("RC-07 template freezing survives a poisoned fixture and edit.build uses only frozen claims", async () => {
  const demo = copy(BOOKING_DEMO), t = templateOf(demo), sha = hashCanonical(t);
  demo.delivery.presentations[1].clip.hook.business = "POISON";
  assert.equal(hashCanonical(t), sha); assert.equal(t.presentation.key, "phone-privacy");
  const f = factsOf(), content = [], bound = [], d = { id: "dlv_test", status: "ACTIVE", opsPlanId: "opp_test", missionId: "mis_test", bundleId: f.bundle.id, template: t, contentProjectId: "cp_test", title: "Test" };
  let built;
  const deliveries = { need: () => d, effectiveTemplate: x => x.template, currentItem: (_, kind, role) => kind === "capture" ? { id: "it_" + role, refId: "mav_" + role, meta: { ...captures.find(c => c.role === role), label: "ORIGINAL_RECORDING" } } : null,
    revisionOfPlan: () => null, replaceClaimItems: (_, roles, fn) => fn(), bindItem: (_, item) => { bound.push(item); return { id: "item_" + bound.length }; }, patch() {}, markerOf() { throw Error("fixture read"); } };
  const media = { content: { saveClaim: (_, c) => { content.push(c); return { id: "cl_" + content.length }; } }, assets: { getVersion: () => ({ status: "READY", probe: { durationMs: 22000, hasVideo: true, video: { width: 1280, height: 844 } } }) }, edits: { create: ({ ir }) => { built = ir; return { project: { id: "ep_test" }, version: { id: "ev_test" } }; } } };
  const run = createDeliveryExecutors({ deliveries, factory: { claimFacts: () => f }, media })["delivery.edit.build"].run;
  await run({ params: { deliveryId: d.id }, planId: "opp_test", authorize() {} });
  assert.ok(built.tracks.flatMap(t => t.items || []).every(i => !i.text.includes("POISON")));
  assert.equal(content.length, 6); assert.ok(content.some(c => c.evidence.some(e => e.kind === "e2e")));
  assert.ok(bound.filter(i => i.kind === "claim").every(i => /^(clip|capture)\./.test(i.role)));
  assert.equal(hashCanonical(t), sha);
  const executors = fs.readFileSync(new URL("../server/delivery/executors.mjs", import.meta.url), "utf8"); assert.doesNotMatch(executors, /FACTORY_DEMOS|blockOf/);
  const delivery = fs.readFileSync(new URL("../server/delivery/delivery.mjs", import.meta.url), "utf8").split("function renderDocument(")[1].split("function saveDocument(")[0]; assert.doesNotMatch(delivery, /FACTORY_DEMOS|markerOf/);
});
test("RC-08 factual findings have per-occurrence ranges, including variant overrides", () => {
  const ir = master(), p = resolve();
  const claims = p.claims.filter(c => c.key.startsWith("clip.")).map(c => ({ id: "cl_" + c.key.slice(5), status: "SUPPORTED", text: c.texts.business,
    evidence: [{ kind: "bundle", ref: "bnd_test", sha256: "b".repeat(64) }, ...c.needs.map(n => ({ kind: "criterion", ref: criterionRef(hashCanonical(spec), n.id), sha256: n.fp, specRowFound: true, manifestSpecSha: hashCanonical(spec), found: true, fpNow: n.fp, status: "PASS_EVIDENCE" })), ...Object.values(c.texts).map(t => ({ kind: "display", sha256: displaySha(t) }))] }));
  const context = { specSha: hashCanonical(spec), bundleId: "bnd_test", bundleSha: "b".repeat(64) };
  const cases = [
    ["TEXT_CLAIM_MISSING", (i) => { delete i.claimIds; i.text = "AC-8: PASS"; }],
    ["CLAIM_UNKNOWN", i => i.claimIds = ["unknown"]], ["CLAIM_BLOCKED", (_, c) => c.status = "BLOCKED"], ["CLAIM_NOT_SUPPORTED", (_, c) => c.status = "UNCERTAIN"],
    ["CLAIM_WITHOUT_EVIDENCE", (_, c) => c.evidence = []], ["CLAIM_CRITERIA_MISMATCH", i => i.text = "AC-99: E2E"],
    ["CLAIM_SPEC_MISMATCH", (_, c) => c.evidence[1].manifestSpecSha = "a".repeat(64)], ["CLAIM_BUNDLE_MISMATCH", (_, c) => c.evidence[0].ref = "other"],
    ["CLAIM_CRITERION_CHANGED", (_, c) => c.evidence[1].fpNow = "a".repeat(64)], ["CLAIM_CRITERION_NOT_PASS", (_, c) => c.evidence[1].status = "FAIL"],
    ["CLAIM_TEXT_UNBOUND", i => i.text = "O altă afirmație"],
  ];
  for (const vertical of [false, true]) for (const [code, mutate] of cases) {
    const edit = vertical ? deriveVariant({ masterIr: ir, platformKey: "shorts_9x16" }).ir : copy(ir), cs = copy(claims), item = edit.tracks.flatMap(t => t.items || []).find(i => i.id === "t-desktop");
    mutate(item, cs.find(c => c.id === "cl_desktop"));
    const finding = factualCheck({ ir: edit, claims: cs, context }).findings.find(f => f.code === code && f.itemId === item.id);
    assert.ok(finding?.range?.timecode, code); assert.equal(finding.range.fromFrame, item.start);
  }
  const overrides = storyFromPresentation(p).overrides;
  const vertical = deriveVariant({ masterIr: ir, platformKey: "shorts_9x16", overrides }).ir;
  const hook = vertical.tracks.flatMap(t => t.items || []).find(i => i.id === "t-hook");
  assert.equal(hook.text, overrides.hookText);
  assert.notEqual(hook.text, ir.tracks.flatMap(t => t.items || []).find(i => i.id === "t-hook").text);
  const bound = copy(claims), hookClaim = bound.find(c => c.id === "cl_hook");
  hookClaim.evidence.push({ kind: "display", ref: "t-hook:vertical", sha256: displaySha(overrides.hookText) });
  assert.deepEqual(factualCheck({ ir: vertical, claims: bound, context }).findings.filter(f => f.itemId === hook.id), []);
  for (const missingEvidence of [true, false]) {
    const changed = copy(vertical), cs = copy(bound);
    const item = changed.tracks.flatMap(t => t.items || []).find(i => i.id === hook.id);
    if (missingEvidence) cs.find(c => c.id === "cl_hook").evidence.pop();
    else item.text += " alterat";
    const finding = factualCheck({ ir: changed, claims: cs, context }).findings.find(f => f.code === "CLAIM_TEXT_UNBOUND" && f.itemId === item.id);
    assert.equal(finding?.claimId, "cl_hook");
    assert.equal(finding?.range.fromFrame, item.start); assert.equal(finding?.range.toFrame, item.end);
    assert.ok(finding?.range.timecode);
  }
  const missing = copy(ir); missing.tracks.forEach(t => { if (t.items) t.items = t.items.filter(i => i.id !== "t-hook"); });
  const variant = deriveVariant({ masterIr: missing, platformKey: "shorts_9x16", overrides: { hookText: "Ungated" } });
  assert.ok(!variant.ir.tracks.flatMap(t => t.items || []).some(i => i.id.startsWith("vhook")));
  assert.ok([...variant.findings, ...variant.warnings].some(f => f.code === "OVERRIDE_TARGET_MISSING"));
});
test("RC-09 every live defective summary citation fails; corrected privacy summary passes", () => {
  const p = resolve(), f = factsOf(), proofs = provePresentation(p, f), doc = docOf(p, f);
  assert.equal(summaryFactCheck({ doc, presentation: p, proofs, spec }).status, "PASS");
  const old = baseline.delivery.summary;
  const defective = { sections: [{ id: "demonstrated", text: old.demonstrates.map(c => c.text + ` (verificat: ${c.criteria.join(", ")})`).join("\n") }, { id: "benefits", text: old.benefits.map(c => c.text + ` (dovadă: ${c.criteria.join(", ")})`).join("\n") }] };
  const result = summaryFactCheck({ doc: defective, presentation: p, proofs, spec }); assert.equal(result.status, "FAIL"); assert.equal(result.findings.filter(f => f.code === 'SUMMARY_CITATION_UNBOUND').length, 7);
  assert.equal(result.findings.filter(f => f.code === 'SUMMARY_LINE_NOT_CURATED').length, 7);
});
test("RC-10 legacy presentation is generated from its own spec without rewriting the template", () => {
  const t = copy(templateOf()); delete t.presentation; const before = hashCanonical(t);
  const p = presentationForTemplate(t, factsOf()); assert.equal(p.status, "GENERATED"); assert.equal(p.origin, "legacy-generated"); assert.equal(hashCanonical(t), before);
  assert.equal(docOf(p).basis.origin, "legacy-generated");
});

test('RCE-01 problem cites requirements exactly, including resolved ids; verified/evidence/foreign citations fail', () => {
  for (const renumber of [false, true]) {
    const s = copy(spec); if (renumber) s.acceptance.forEach((c, i) => c.id = 'AC-' + (30 - i));
    const p = resolve(s), f = factsOf(s), proofs = provePresentation(p, f), doc = docOf(p, f);
    const claim = p.claims.find(c => c.key === 'summary.problem'), ids = claim.needs.map(n => n.id).join(', ');
    const expected = `${claim.texts.text} (criteriile: ${ids})`;
    assert.equal(doc.sections.find(s => s.id === 'problem').text.split('\n')[0], expected);
    const check = text => summaryFactCheck({ doc: { sections: [{ id: 'problem', text }] }, presentation: p, proofs, spec: s });
    assert.equal(check(expected).status, 'PASS');
    for (const bad of [expected.replace('criteriile:', 'verificat:'), expected.replace('criteriile:', 'dovadă:'),
      expected.replace(ids, 'AC-99'), expected.replace(ids, ids.split(', ').reverse().join(', ')), expected + ' AC-99', 'Alt text (criteriile: ' + ids + ')']) {
      assert.ok(check(bad).findings.some(f => f.code === 'SUMMARY_CITATION_UNBOUND'), bad);
    }
    assert.equal(check(claim.texts.text).status, 'FAIL', 'the new requirement suffix is mandatory');
    assert.equal(summaryFactCheck({ doc: { sections: [{ id: 'problem', text: expected }] }, presentation: p,
      proofs: { ...proofs, [claim.needs[0].id]: { ok: false } }, spec: s }).status, 'FAIL');
  }
  const p = resolve(BOOKING_DEMO.spec), f = factsOf(BOOKING_DEMO.spec);
  assert.equal(docOf(p, f).sections.find(s => s.id === 'problem').text.split('\n')[0], baseline.delivery.summary.problem);
});

test('RCE-02 curated flow has uncited exact lines and one resolved closing citation; foreign text/citations fail', () => {
  for (const renumber of [false, true]) {
    const s = copy(spec); if (renumber) s.acceptance.forEach((c, i) => c.id = 'AC-' + (30 - i));
    const p = resolve(s), f = factsOf(s), proofs = provePresentation(p, f), doc = docOf(p, f);
    const claim = p.claims.find(c => c.key === 'summary.how'), ids = claim.needs.map(n => n.id).join(', ');
    const closing = `Flux verificat: ${ids}.`, lines = claim.texts.lines;
    assert.equal(doc.sections.find(s => s.id === 'how').text, lines.map(t => '- ' + t).join('\n') + '\n' + closing);
    const check = text => summaryFactCheck({ doc: { sections: [{ id: 'how', text }] }, presentation: p, proofs, spec: s });
    for (const line of [...lines, closing]) assert.equal(check(line).status, 'PASS');
    for (const bad of [lines[0] + ' alterat', `${lines[0]} (verificat: ${ids})`, `${lines[0]} (dovadă: ${ids})`,
      closing.replace(ids, 'AC-99'), closing.replace(ids, ids.split(', ').reverse().join(', ')), closing.slice(0, -1)]) assert.equal(check(bad).status, 'FAIL', bad);
    const missing = { ...proofs, [claim.needs[0].id]: { ok: false } };
    assert.equal(summaryFactCheck({ doc, presentation: p, proofs: missing, spec: s }).status, 'FAIL');
    const omitted = renderSummary({ presentation: p, proofs: missing, manifest: f.manifest, generatedAt: 'test' });
    assert.doesNotMatch(omitted.sections.find(s => s.id === 'how').text, /Flux verificat:/);
  }
  const p = resolve(BOOKING_DEMO.spec), f = factsOf(BOOKING_DEMO.spec);
  assert.equal(docOf(p, f).sections.find(s => s.id === 'how').text, baseline.delivery.summary.how.lines.map(t => '- ' + t).join('\n'));
});
test("RC-11 planner first-generation pins survive; two revision generations fill and label each field once", () => {
  const flows = BOOKING_DEMO.spec.acceptance.filter(c => c.verify === "e2e");
  for (const pin of baseline.derive) assert.equal(hashCanonical(deriveCriteria({ words: pin.words, flows })), pin.sha);
  const first = deriveCriteria({ words: baseline.derive[0].words, flows }), second = deriveCriteria({ words: baseline.derive[1].words, flows: first.flows });
  for (const flow of second.flows) { assert.equal(flow.steps.filter(s => s.fill?.selector.includes("phone")).length, 1); assert.equal(flow.text.split("câmpul „Telefon”").length, 2); }
  const field = { key: "phone", label: "Telefon", value: "0700" }, steps = [{ fill: { selector: 'input[name="phone"]', value: "old" } }, { click: "button" }, { expectText: "OK" }];
  assert.equal(withField(steps, field).filter(s => s.fill).length, 1);
  assert.equal(withoutField(steps, field).filter(s => s.fill).length, 0);
});
test("RC-12 capture collapses repeats across observations, never across a mutation", () => {
  const steps = [{ goto: "/" }, { fill: { selector: "input[name='phone']", value: "0700" } }, { expectLabel: { selector: "input[name='phone']", text: "Telefon" } }, { expectLabel: { selector: "input[name='phone']", text: "Telefon" } }, { fill: { selector: "input[name='phone']", value: "0700" } }, { click: "button" }, { fill: { selector: "input[name='phone']", value: "0700" } }, { expectText: "OK" }];
  const out = captureScriptFrom(steps, { role: "mobile", noun: "programare", proofSelector: "#success" });
  assert.equal(out.ok, true); assert.equal(out.steps.filter(s => s.type).length, 2); assert.deepEqual(out.collapsed.map(s => s.kind), ["expectLabel", "fill"]);
});
test("RC-13 regenerated owner sections retain text; review and owner-fact notices disappear when resolved", () => {
  const fresh = docOf(), edited = editSummary(fresh, [{ id: "problem", text: "Costă 200 lei" }]);
  const regenerated = regenerateSummary(edited, fresh, ["claims", "media"]);
  assert.ok(regenerated.sections.find(s => s.id === "problem").needsReview);
  assert.ok(regenerated.claimsToVerify.some(t => t.startsWith("Afirmat de tine")));
  const corrected = editSummary(regenerated, [{ id: "problem", text: "Problemă clarificată" }]);
  assert.ok(!corrected.claimsToVerify.some(t => /^(Afirmat de tine|De revăzut:)/.test(t)));
});

test("RC-14 revision executors reject stale/closed deliveries and proposals reject foreign revisions before mutation", async () => {
  for (const status of ["STALE", "CLOSED", "CANCELLED", "FAILED", "PLANNED", "ARMED", "ACTIVE", "EXPIRED"]) {
    const d = { id: "dlv_test", status, opsPlanId: "original" };
    const executors = createDeliveryExecutors({ deliveries: { need: () => d, revisionOfPlan: () => ({ id: "drv_test" }) } });
    await assert.rejects(() => executors["delivery.revise.apply"].run({ params: { deliveryId: d.id }, planId: "revision" }), e => e.code === "DELIVERY_NOT_ACTIVE");
  }
  const commands = new Map(); let changed = false;
  registerDeliveryCommands((key, def) => commands.set(key, def), { deliveries: { need: () => ({ id: "dlv_test" }), getRevision: () => ({ deliveryId: "other" }), updateRevision: () => { changed = true; } },
    opsPlans: { propose: () => { changed = true; } }, trust: { requireSession: () => ({ id: "session" }) } });
  await assert.rejects(() => commands.get("delivery.revision.propose").execute({ deliveryId: "dlv_test", revisionId: "drv_test" }, { session: { id: "session" } }), e => e.code === "REVISION_MISSING");
  assert.equal(changed, false);
});

test("RC-15 curated validation blocks literal citations, mixed review needs, invented facts and invalid tokens", () => {
  for (const mutate of [p => p.clip.hook.technical = "AC-1", p => p.clip.cta.business = "{cite}", p => p.variant.hookText = "AC-1", p => p.summary.problem.text = "Preț 100 lei",
    p => p.summary.how.lines = ["{cite}"], p => p.clip.mobile.needs = ["AC-11", "AC-7"], p => p.clip.mobile.needs = ["AC-6", "AC-7"], p => p.anchors = ["AC-99"], p => p.clip.hook.business = "x".repeat(121)]) {
    const p = copy(catalog[1]); mutate(p); assert.ok(normalizePresentation(p).problems.length);
  }
  for (const mutate of [p => p.summary.how.lines = "bad", p => p.summary.benefits = {}, p => p.summary.questions = "bad", p => p.clip.hook = "bad", p => p.reference.criteria["AC-1"] = null, p => p.clip.hook.business = "two\nlines"]) {
    const p = copy(catalog[1]); mutate(p); assert.ok(normalizePresentation(p).problems.length);
  }
});

test("RC-18 original booking prose and summary sections remain byte-identical with passing evidence", () => {
  const p = resolve(BOOKING_DEMO.spec), f = factsOf(BOOKING_DEMO.spec), story = storyFromPresentation(p);
  for (const [key, text] of Object.entries(baseline.delivery.texts)) for (const tone of ["business", "technical"]) assert.equal(story.texts[key][tone], text[tone]);
  assert.deepEqual(story.overrides, baseline.delivery.variant.overrides);
  const input = { manifest: f.manifest, generatedAt: "2026-10-16T00:00:00Z", issue: baseline.delivery.issue };
  const previous = renderSummary({ ...input, block: baseline.delivery });
  const current = renderSummary({ ...input, presentation: p, proofs: provePresentation(p, f) });
  assert.equal(current.text, previous.text);
  assert.equal(current.contentSha, previous.contentSha);
  const pinned = renderSummary({ presentation: p, proofs: provePresentation(p, f), manifest: { spec: { criteria: f.manifest.spec.criteria } }, generatedAt: input.generatedAt });
  assert.equal(pinned.contentSha, '7c6d1b429b7959baadcdf37b349e62830f91035f89cf096d9b364147b3c781d0', 'full booking summary hash computed from 112764c before round E');
  assert.equal(summaryFactCheck({ doc: current, presentation: p, proofs: provePresentation(p, f), spec: f.spec }).status, "PASS");
});

test("RC-19 generated capture claims bind by construction; executor uses exactly the hashed overrides", async () => {
  const s = copy(spec); s.acceptance.push({ ...copy(s.acceptance.find(c => c.id === "AC-8")), id: "AC-99" });
  const p = resolve(s, []), claim = p.claims.find(c => c.key === "clip.desktop");
  assert.equal(claim.status, "BOUND"); assert.equal(claim.needs[0].id, p.captures.desktop.id);
  let applied;
  const media = { variants: { derive: args => { applied = args; return { version: { id: "mev_variant" } }; } },
    render: { request: () => ({ id: "render" }), get: () => ({ id: "render", status: "DONE", outputAssetVersionId: "mav_result" }) },
    qa: { run: async () => ({ status: "PASS", reports: {} }) }, reviews: { list: () => [] } };
  const executor = createExecutors({ media })["media.variant.render"];
  const params = { masterVersionId: "mev_master", platformKey: "shorts_9x16", overrides: { hookText: "Old words" } }, before = hashCanonical(params);
  await executor.run({ params, planId: "plan_legacy", authorize: () => {} });
  assert.deepEqual(applied.overrides, params.overrides);
  assert.equal(hashCanonical(params), before);
});

test("RC-16 Hub-authored tests require protected sha, PROVEN result and VALID/PASS independent test review", () => {
  const f = factsOf(); f.manifest.spec.criteria[0].provenance = "hub_authored";
  const ref = f.spec.acceptance[0].testRef;
  f.manifest.acceptanceTest = { ref, sha: f.manifest.spec.protectedTests[ref], proof: { verdict: "PROVEN" }, reviewer: { reviewId: "review_test" } };
  f.manifest.reviews.push({ id: "review_test", status: "VALID", verdict: "PASS", problems: [], changeSet: "a".repeat(12) });
  f.reviewRows.push({ id: "review_test", status: "VALID", verdict: "PASS", change_set_id: "acceptance:test", validation_json: '{"problems":[]}' });
  f.bundle.sha256 = hashCanonical(f.manifest); assert.equal(proof(f, "AC-1").ok, true);
  for (const mutate of [x => x.manifest.acceptanceTest.sha = "bad", x => x.manifest.acceptanceTest.proof.verdict = "UNPROVEN", x => x.reviewRows.at(-1).verdict = "FAIL", x => x.reviewRows.pop()]) {
    const broken = copy(f); mutate(broken); broken.bundle.sha256 = hashCanonical(broken.manifest); assert.equal(proof(broken, "AC-1").ok, false);
  }
});

test("RC-17 database: own bundle/spec, frozen summary, stale displayed sha, atomic claim supersession and bounded descendants", async t => {
  const env = makeMediaEnv({ launchers: fakeLaunchers() }); t.after(() => env.cleanup());
  const { db, bus, config, settings } = env, at = "2026-10-16T00:00:00.000Z", clock = () => new Date(at), f = factsOf(), template = templateOf();
  db.prepare("INSERT INTO projects (id, slug, name, path, created_at, updated_at) VALUES ('prj_claims','claims','Claims',?,?,?)").run(env.dir, at, at);
  db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES ('mis_claims','prj_claims','factory','Claims','Claims',?,?)").run(at, at);
  db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, created_at, updated_at) VALUES ('mis_claims','FEATURE','DELIVERY_READY','{}',?,?)").run(at, at);
  db.prepare("INSERT INTO factory_specs (id, mission_id, version, status, spec_json, sha256, author, created_at) VALUES ('sp_claims','mis_claims',1,'APPROVED',?,?,'test',?)").run(JSON.stringify(spec), hashCanonical(spec), at);
  const bundle = db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at) VALUES (?,'mis_claims','cs_test',?,1,?,?,?,?)");
  bundle.run(f.bundle.id, f.manifest.changeSet.sha256, JSON.stringify(f.manifest), f.bundle.sha256, f.bundle.status, at);
  bundle.run("bnd_newer", f.manifest.changeSet.sha256, "{}", "d".repeat(64), "STALE", "2026-10-17T00:00:00Z");
  for (const r of f.evidenceRows) db.prepare("INSERT INTO factory_evidence (id, mission_id, change_set_id, stage, kind, command, runner, isolation, status, counts_json, detail_json, created_at) VALUES (?,'mis_claims',?,?,'check',?,'node','test',?,?,?,?)").run(r.id, r.change_set_id, r.stage, r.command, r.status, JSON.stringify(r.counts), JSON.stringify(r.detail), at);
  for (const r of f.reviewRows) db.prepare("INSERT INTO factory_reviews (id, mission_id, change_set_id, change_set_sha, reviewer, verdict, validation_json, status, created_at) VALUES (?,'mis_claims',?,?,'reviewer',?,?,?,?)").run(r.id, r.change_set_id, f.manifest.changeSet.sha256, r.verdict, r.validation_json, r.status, at);
  const factory = createFactory({ db, bus, config, clock });
  assert.equal(factory.claimFacts("mis_claims", { bundleId: f.bundle.id }).bundle.id, f.bundle.id);
  const own = factory.claimFacts("mis_claims", { bundleId: f.bundle.id }); assert.ok(Object.values(provePresentation(resolve(), own)).every(p => p.ok));
  db.prepare("UPDATE factory_specs SET spec_json = '{}' WHERE id = 'sp_claims'").run();
  assert.throws(() => factory.claimFacts("mis_claims", { bundleId: f.bundle.id }), e => e.code === "CRITERION_CHANGED");
  db.prepare("UPDATE factory_specs SET spec_json = ? WHERE id = 'sp_claims'").run(JSON.stringify(spec));
  const ins = db.prepare("INSERT INTO deliveries (id, project_id, parent_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, bundle_id, bundle_sha, spec_sha, created_by, created_at, updated_at) VALUES (?,'prj_claims',?,'Claims',?,'mis_claims',?,?,'[]',?, ?,?,?,'test',?,?)");
  const add = (id, parent, status) => ins.run(id, parent, status, JSON.stringify(template), hashCanonical(template), "0".repeat(64), f.bundle.id, f.bundle.sha256, hashCanonical(spec), at, at);
  add("dlv_claims", null, "READY");
  const deliveries = createDeliveries({ db, bus, config, settings, clock, projects: { get: () => ({ id: "prj_claims", name: "Claims" }) }, factory: { ...factory, deliveryBinding: () => null, view: () => null, previewStatus: () => ({ running: false }) }, media: {}, opsPlans: {}, trust: { requireSession: () => ({ id: "test" }) } });
  const content = createContent({ db, bus, clock }), cp = content.createProject({ title: "Claims QA" });
  const ir = master(); ir.meta.author = "delivery:dlv_claims";
  ir.tracks.forEach(t => { if (t.clips) t.clips.forEach(c => { c.claimIds = []; }); if (t.items) t.items = t.items.filter(i => i.id === "t-desktop" || i.style === "label"); });
  ir.evidenceRegions = [];
  const target = ir.tracks.flatMap(t => t.items || []).find(i => i.id === "t-desktop"), item = spec.acceptance.find(c => c.id === "AC-8");
  const claim = content.saveClaim(cp.id, { text: "Flux desktop verificat", status: "SUPPORTED", evidence: [{ kind: "bundle", ref: f.bundle.id, sha256: f.bundle.sha256 },
    { kind: "criterion", ref: criterionRef(hashCanonical(spec), item.id), sha256: fp(item) }, { kind: "display", ref: "t-desktop:technical", sha256: displaySha(target.text) }, { kind: "e2e", ref: "ev_AC-8" }] });
  target.claimIds = [claim.id];
  db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, created_by, created_at, updated_at) VALUES ('mep_claims',?,'Claims','test',?,?)").run(cp.id, at, at);
  db.prepare("INSERT INTO media_edit_versions (id, edit_project_id, version, ir_json, ir_sha256, change_kind, created_by, created_at) VALUES ('mev_claims','mep_claims',1,?,?,'initial','test',?)").run(JSON.stringify(ir), irHash(ir), at);
  const qa = createMediaQa({ db, bus, clock });
  const checked = await qa.run({ editVersionId: "mev_claims" }); assert.equal(checked.reports.factual.status, "PASS", JSON.stringify(checked.reports.factual.findings));
  assert.equal(checked.reports.factual.measurements.textItemsClaimed, 1);
  db.prepare("UPDATE factory_evidence SET stale = 1 WHERE id = 'ev_AC-8'").run();
  const staleQa = await qa.run({ editVersionId: "mev_claims" });
  assert.ok(staleQa.reports.factual.findings.some(f => f.code === "CLAIM_CRITERION_NOT_PASS" && f.itemId === target.id && f.range.timecode));
  db.prepare("UPDATE factory_evidence SET stale = 0 WHERE id = 'ev_AC-8'").run();
  const first = deliveries.renderDocument("dlv_claims"); assert.equal(first.basis.factual.status, "PASS");
  assert.throws(() => deliveries.editDocument("dlv_claims", { displayedSha: "old", sections: [{ id: "problem", text: "Owner" }], session: { id: "test" } }), e => e.code === "SUMMARY_DISPLAYED_STALE");
  deliveries.editDocument("dlv_claims", { displayedSha: first.contentSha, sections: [{ id: "problem", text: "Textul proprietarului" }], session: { id: "test" } });
  const next = deliveries.renderDocument("dlv_claims"); assert.equal(next.sections.find(s => s.id === "problem").text, "Textul proprietarului"); assert.equal(next.sections.find(s => s.id === "problem").needsReview, true);
  assert.equal(db.prepare("SELECT template_json FROM deliveries WHERE id = 'dlv_claims'").get().template_json, JSON.stringify(template));
  const legacy = copy(template); delete legacy.presentation;
  db.prepare("UPDATE deliveries SET template_json = ?, ops_plan_id = 'plan_legacy' WHERE id = 'dlv_claims'").run(JSON.stringify(legacy));
  const legacyBefore = db.prepare("SELECT template_json, ops_body_sha FROM deliveries WHERE id = 'dlv_claims'").get();
  const effective = deliveries.effectiveTemplate(deliveries.get("dlv_claims"));
  assert.equal(effective.presentation.origin, "legacy-generated");
  assert.deepEqual(effective.story.variant.overrides, { hookText: "Demo local", ctaText: "Hai să vorbim" });
  assert.equal(effective.story.variant.overridesSha, hashCanonical(effective.story.variant.overrides));
  assert.equal(deliveries.renderDocument("dlv_claims").basis.origin, "legacy-generated");
  assert.deepEqual(db.prepare("SELECT template_json, ops_body_sha FROM deliveries WHERE id = 'dlv_claims'").get(), legacyBefore);
  db.prepare("UPDATE deliveries SET template_json = ?, ops_plan_id = NULL WHERE id = 'dlv_claims'").run(JSON.stringify(template));
  const old = deliveries.bindItem("dlv_claims", { kind: "claim", role: "AC-1", refTable: "content_claims", refId: "old" });
  assert.throws(() => deliveries.replaceClaimItems("dlv_claims", [], () => { throw Error("rollback"); }));
  assert.equal(deliveries.currentItem("dlv_claims", "claim", "AC-1").id, old.id);
  deliveries.replaceClaimItems("dlv_claims", ["clip.hook"], () => deliveries.bindItem("dlv_claims", { kind: "claim", role: "clip.hook", refTable: "content_claims", refId: "new" }));
  assert.equal(deliveries.currentItem("dlv_claims", "claim", "AC-1"), null);
  add("dlv_middle", "dlv_claims", "STALE"); add("dlv_ready", "dlv_middle", "READY"); add("dlv_failed", "dlv_claims", "EXPIRED");
  assert.equal(deliveries.view("dlv_claims").delivery.childId, "dlv_ready");
  add("dlv_active", "dlv_middle", "ACTIVE"); assert.equal(deliveries.view("dlv_claims").delivery.childStatus, "ACTIVE");
  db.prepare("UPDATE deliveries SET status = 'CLOSED' WHERE id IN ('dlv_ready','dlv_active')").run();
  let parent = "dlv_middle"; for (let i = 2; i <= 9; i++) { const id = "dlv_depth" + i; add(id, parent, i === 9 ? "READY" : "CLOSED"); parent = id; }
  assert.equal(deliveries.view("dlv_claims").delivery.childId, null);
});
