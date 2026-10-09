// Stage before M12 („Lega: autonomie și lucru pe PC”) — the office part of a delivery: a Word document, an Excel workbook with demo
// data and a local campaign package, requested in ONE sentence and produced by ONE plan in ONE folder next to the clips and the summary.
// Unit checks (no tools) + one end-to-end run on a test Hub (fake models; REAL Chromium capture, ffmpeg, and — with HUB_V2_OFFICE_COM=1
// on a computer with Office — REAL Word / Excel verification; otherwise the level stays FILE_CHECKED and says so).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants, freePort, HUB_ROOT, tempDir } from "./helpers.mjs";
import { realLaunchers } from "./media-helpers.mjs";
import { materializeFixture, demoSpec, FACTORY_DEMOS } from "../server/factory/fixtures.mjs";
import { browserStatus } from "../server/tools/browser.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { buildDocx, expectedDocxShape } from "../server/office/docx.mjs";
import { buildXlsx, formulaCells, dateSerial } from "../server/office/xlsx.mjs";
import { unzip } from "../server/office/zip.mjs";
import { presentationDocument, bookingsWorkbook, DEMO_NOTE } from "../server/office/demo-content.mjs";
import { buildCampaign, campaignWorkbook } from "../server/office/campaign.mjs";
import { requestedArtifacts, createOfficeExecutors } from "../server/delivery/office-executors.mjs";
import { packageSteps, buildTemplate, templateSha, DELIVERY_LIMITS } from "../server/delivery/template.mjs";

const COMBINED = "Pregătește prezentarea demo-ului de detailing: verifică site-ul, fă un document Word, un Excel cu date demonstrative, un clip vertical și un pachet de campanie. Salvează totul într-un singur dosar.";

test("OFF-01 the combined sentence is ONE delivery step and asks for the three office artifacts; a negated one is not asked", () => {
  const r = resolveIntent(COMBINED, { projects: [], missions: [], departments: [], pendingEnvelopes: [], source: "typed" });
  assert.deepEqual(r.steps.map((s) => s.intent), ["delivery_prepare"]);
  assert.deepEqual(requestedArtifacts(`${COMBINED} ${(r.steps[0].args.details || []).join(" ")}`), ["document", "workbook", "campaign"]);
  assert.deepEqual(requestedArtifacts("Pregătește demo-ul, fără Excel, dar cu un document Word."), ["document"]);
  assert.deepEqual(requestedArtifacts("nu face campania"), []);
  assert.deepEqual(requestedArtifacts("Pregătește demo-ul de detailing pentru prezentare. Nu publica nimic."), []);
});

test("OFF-02 the .docx has real heading styles, a numbered bullet list, tables with a repeated header row and the demo note; same input → same bytes", () => {
  const model = presentationDocument({ criteria: [{ id: "AC-1", text: "Pagina se încarcă", status: "PASS" }], generatedAt: "9 octombrie 2026" });
  const a = buildDocx(model, { created: new Date("2026-10-09T10:00:00Z") });
  const b = buildDocx(model, { created: new Date("2026-10-09T10:00:00Z") });
  assert.ok(a.equals(b), "deterministic");
  const parts = unzip(a);
  const doc = parts.get("word/document.xml").toString("utf8");
  for (const p of ["[Content_Types].xml", "word/styles.xml", "word/numbering.xml", "docProps/core.xml"]) assert.ok(parts.has(p), p);
  const shape = expectedDocxShape(model);
  assert.equal((doc.match(/w:pStyle w:val="Heading1"/g) || []).length, shape.headings.length);
  assert.equal((doc.match(/<w:tbl>/g) || []).length, shape.tables.length);
  assert.ok(/<w:tblHeader\/>/.test(doc), "header row repeats on new pages");
  assert.ok(/<w:numId w:val="1"\/>/.test(doc), "bullets are a real list");
  assert.ok(doc.includes("Date demonstrative"), "the demo note is in the document");
  assert.ok(!/\b\d+\s*(lei|ron|eur|€)\b/i.test(doc), "no price is stated");
});

test("OFF-03 the .xlsx carries formulas without cached values, a full calculation on load, filters and a frozen header; the expected values are the data's", () => {
  const { model, expect, rows } = bookingsWorkbook();
  const parts = unzip(buildXlsx(model));
  assert.match(parts.get("xl/workbook.xml").toString("utf8"), /fullCalcOnLoad="1"/);
  const s1 = parts.get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.match(s1, /<autoFilter ref="A1:H13"\/>/);
  assert.match(s1, /state="frozen"/);
  assert.ok(!/<f>[^<]*<\/f><v>/.test(s1), "no cached value next to a formula");
  assert.equal(formulaCells(model).length, 24);
  const total = expect.find((e) => e.sheet === "Programari" && e.ref === "D14");
  assert.equal(total.value, rows.reduce((a, r) => a + r.minutes, 0));
  assert.equal(dateSerial("2026-10-12"), 46307);
});

test("OFF-04 the campaign package is complete, local-only, and shaped for an M12 plan (distribution off, no budget invented)", () => {
  const c = buildCampaign({ proofs: ["AC-1: x"], materials: [{ name: "demo-16x9-v1.mp4", format: "16:9" }, { name: "demo-9x16-v1.mp4", format: "9:16" }], startDate: "2026-10-13" });
  assert.ok(c.objective && c.audience.length && c.message && c.cta);
  assert.equal(c.texts.length, c.channels.length);
  for (const t of c.texts) assert.ok(t.text.length > 40 && t.text.length <= c.channels.find((ch) => ch.key === t.channel).limit);
  assert.equal(c.calendar.length, c.channels.length * 2);
  assert.deepEqual(c.missing, []);
  assert.equal(c.distribution.publish, false);
  assert.equal(c.distribution.autoPublish, false);
  assert.equal(c.distribution.budget, null);
  assert.equal(c.note, DEMO_NOTE);
  const wb = campaignWorkbook(c);
  assert.equal(wb.expect.at(-1).value, c.calendar.length);
});

test("OFF-05 extras only when asked: a template without them keeps the M11 hash and 10 steps; with them the office steps run before finish, inside the limit", async () => {
  const { BOOKING_DEMO: def } = await import("../server/factory/booking-demo-def.mjs");
  const { checkSpec, specHash } = await import("../server/factory/spec.mjs");
  const checked = checkSpec({ workType: def.workType, title: def.title, objective: def.objective, ...def.spec });
  const view = { mission: { id: "mis_mux0demo_aaaaaaaaaa", title: def.title }, spec: { version: 1, sha256: specHash(checked.spec), spec: checked.spec } };
  const identity = { ffmpeg: { version: "7.1", sha256: "f".repeat(64) }, ffprobe: { version: "7.1", sha256: "e".repeat(64) } };
  const base = { project: { id: "prj_x", name: "Demo Livrare — Detailing", slug: "demo-livrare" }, marker: { fixture: def.key, data: def.data }, missionView: view, demo: def,
    tools: { state: "PINNED", identity }, chromium: { version: "1.61.0" }, exportsDir: path.resolve("C:/tmp/exports"), simulation: false, day: "20261009", config: {} };
  const plain = buildTemplate(base);
  const again = buildTemplate({ ...base, extras: [] });
  assert.equal(templateSha(plain), templateSha(again));
  assert.equal(plain.extras, undefined);
  assert.equal(packageSteps(plain, "dlv_test_0001").length, 10);
  const full = buildTemplate({ ...base, extras: ["campaign", "document", "workbook"] });
  assert.deepEqual(full.extras, ["document", "workbook", "campaign"], "canonical order");
  assert.notEqual(templateSha(full), templateSha(plain));
  const steps = packageSteps(full, "dlv_test_0001");
  assert.deepEqual(steps.slice(-5).map((s) => s.kind), ["delivery.office.document", "delivery.office.workbook", "delivery.campaign", "delivery.package.index", "delivery.finish"]);
  assert.ok(steps.length <= DELIVERY_LIMITS.maxSteps);
  assert.throws(() => buildTemplate({ ...base, extras: ["powerpoint"] }), /livrabil necunoscut/);
});

// ------------------------------------------------------------------------------------------------ end to end
const launchers = realLaunchers();
const browser = browserStatus({ hubRoot: HUB_ROOT });
const skip = !launchers.available ? "SKIPPED_ENV: ffmpeg/ffprobe absent" : !(browser.installed && browser.cachedBrowsers.length) ? "SKIPPED_ENV: Playwright/Chromium absent" : false;
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED", "FAILED"];

test("OFF-06 (combined task) ONE sentence → ONE card → software check, captures, clips, summary, Word, Excel, campaign and the index in ONE folder; resume reuses files", { timeout: 900000, skip }, async () => {
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const importRoot = tempDir("videos");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), importRoots: [importRoot] }, "test", "exports folder"));
    const port = await freePort();
    const dir = path.join(t.dataDir, "detailing-demo");
    materializeFixture("booking-demo", dir, { port });
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const spec = demoSpec("booking-demo", { port });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...spec, limits: { ...FACTORY_DEMOS["booking-demo"].limits, writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: project.id, missionIds: [mission.id], constraints: { noPublish: true } })).result;
    t.queue("codex", "factory-write:booking-fix");
    t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: owner.session });
    const done = await waitFor(() => (SETTLED.includes(t.hub.factory.view(mission.id).factory.stage) ? t.hub.factory.view(mission.id) : null), 180000, 200);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const runsAtReady = t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;

    const intent = resolveIntent(COMBINED, { projects: [], missions: [], departments: [], pendingEnvelopes: [], source: "typed" }).steps[0];
    const card = await t.hub.deliveryPlanner.prepare({ step: intent, text: COMBINED, projectId: project.id });
    assert.equal(card.kind, "ops", JSON.stringify(card).slice(0, 400));
    assert.match(card.note, /documentul Word, Excel-ul cu date demonstrative, pachetul de campanie/);
    const kinds = card.plan.body.steps.map((s) => s.kind);
    for (const k of ["delivery.office.document", "delivery.office.workbook", "delivery.campaign", "delivery.package.index"]) assert.ok(kinds.includes(k), k);
    assert.equal(card.plan.summary.confirmations, 1);
    await dispatch(t.hub, "ops.plan.confirm", { planId: card.plan.id, nonce: card.plan.nonce, displayedHash: card.plan.hash }, { channel: "owner", ownerSession: owner.session });
    const d0 = t.hub.deliveries.list({ projectId: project.id })[0];
    const ready = await waitFor(() => (["READY", "FAILED", "NEEDS_OWNER", "EXPIRED", "CANCELLED"].includes(t.hub.deliveries.get(d0.id).status) ? t.hub.deliveries.get(d0.id) : null), 400000, 250);
    const pv = t.hub.opsPlans.view(card.plan.id);
    assert.equal(ready.status, "READY", `${ready.statusReason} · ${JSON.stringify(pv.steps.map((s) => [s.seq, s.kind, s.status, s.error]))}`);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsAtReady, "no model after DELIVERY_READY");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent' AND scope_id = ?").get(card.plan.id).n <= 1, true, "one confirmation");

    const folder = path.join(ready.template.exports.dir, ready.template.exports.folder);
    const files = fs.readdirSync(folder);
    for (const f of ["Prezentare demo.docx", "Programari demo.xlsx", "README.md", "manifest.json", "Campanie"]) assert.ok(files.includes(f), `${f} in ${files.join(", ")}`);
    assert.ok(files.some((f) => /^demo-16x9-v1/.test(f)) && files.some((f) => /^demo-9x16-v1/.test(f)) && files.some((f) => /^rezumat-v1\.md$/.test(f)), files.join(", "));
    const camp = fs.readdirSync(path.join(folder, "Campanie"));
    for (const f of ["campanie.md", "campanie.json", "calendar.xlsx", "texte"]) assert.ok(camp.includes(f), f);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
    assert.equal(manifest.published, false);
    assert.ok(manifest.files.length >= 12, manifest.files.map((f) => f.path).join(", "));
    const docStep = pv.steps.find((s) => s.kind === "delivery.office.document");
    const xlsStep = pv.steps.find((s) => s.kind === "delivery.office.workbook");
    const expected = process.env.HUB_V2_OFFICE_COM === "1" ? "APP_VERIFIED" : "FILE_CHECKED";
    assert.equal(docStep.result.level, expected);
    assert.equal(xlsStep.result.level, expected);
    if (expected === "APP_VERIFIED") { assert.ok(docStep.result.pdf && fs.existsSync(docStep.result.pdf)); assert.ok(xlsStep.result.formulasChecked >= 13); }

    // Resume never duplicates: the same steps run again for the same plan reuse the identical files.
    const ex = createOfficeExecutors({ deliveries: t.hub.deliveries, factory: t.hub.factory, opsPlans: t.hub.opsPlans, config: t.hub.config, appCheck: "skip" });
    const allow = () => true;
    const again = await ex["delivery.office.document"].run({ params: { deliveryId: d0.id }, planId: card.plan.id, authorize: allow });
    assert.equal(again.result.reused, true);
    const again2 = await ex["delivery.campaign"].run({ params: { deliveryId: d0.id }, planId: card.plan.id, authorize: allow });
    assert.equal(again2.result.complete, true);
    assert.deepEqual(fs.readdirSync(folder).sort(), files.sort(), "no copy was written");
  } finally { await t.cleanup(); }
});
