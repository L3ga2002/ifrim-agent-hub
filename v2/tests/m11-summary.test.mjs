// M11 U3 — the commercial summary (PASS_LOCAL: pure module, inline facts shaped as the factory bundle manifest).
// Covers T07 (a business finding stays visible next to a technical PASS), T10 (a claim without evidence is not stated), T13 (a copy-only
// change regenerates no engineering section), and the owner's §21 rule: no invented price, ROI, lead count, revenue or deadline.
import test from "node:test";
import assert from "node:assert/strict";
import { renderSummary, editSummary, regenerateSummary, assertNoInventedFacts, normalizeSummaryBlock, toMarkdown, toHtml, SECTION_BASIS } from "../server/delivery/summary.mjs";
import { SUMMARY_SECTIONS } from "../server/delivery/revision.mjs";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";
import { normalizeDeliveryBlock } from "../server/delivery/template.mjs";

const block = normalizeDeliveryBlock(BOOKING_DEMO.delivery).block;
const crit = (status = {}) => BOOKING_DEMO.spec.acceptance.map((a) => ({ ...a, status: status[a.id] || "PASS_EVIDENCE", evidence: [`ev_${a.id}`] }));
const manifest = (status) => ({ mission: { title: BOOKING_DEMO.title }, spec: { version: 2, criteria: crit(status) },
  changeSet: { sha256: "c".repeat(64), snapshot: "s".repeat(64), files: [{ path: "public/js/slots-view.mjs" }] } });
const MEDIA = [{ id: "dli_m", role: "master", file: "demo-master.mp4", durationMs: 24000, label: "ORIGINAL", qa: "PASS" }, { id: "dli_v", role: "vertical", file: "demo-vertical.mp4", durationMs: 18000, label: "ORIGINAL", qa: "PASS" }];
const base = (over = {}) => ({ projectName: "Demo Livrare — Detailing", synthetic: true, simulation: false, manifest: manifest(), bundleId: "bnd_x", bundleSha: "b".repeat(64), issue: BOOKING_DEMO.delivery.issue,
  block, media: MEDIA, services: [], owner: {}, generatedAt: "2026-10-07T18:00:00.000Z", ...over });
const section = (doc, id) => doc.sections.find((s) => s.id === id);

test("M11-SU-01 the owner's sections, in order; deterministic for the same facts", () => {
  const a = renderSummary(base());
  assert.deepEqual(a.sections.map((s) => s.id), SUMMARY_SECTIONS.map((s) => s.id));
  assert.deepEqual(a.sections.slice(0, 7).map((s) => s.heading), ["Problema", "Ce demonstrăm", "Cum funcționează", "Ce beneficii putem afirma", "Ce nu putem afirma", "Întrebări pentru client", "Următorul pas"]);
  assert.equal(renderSummary(base()).contentSha, a.contentSha);
  assert.match(a.title, /^\[DATE SINTETICE\] Rezumat: /);
  assert.match(renderSummary(base({ simulation: true })).title, /^\[SIMULARE\] \[DATE SINTETICE\]/);
});

test("M11-SU-02 (T10) a benefit or the flow is stated only with every criterion it depends on passed; a failed criterion moves to „Ce nu putem afirma”", () => {
  const ok = renderSummary(base());
  assert.match(section(ok, "benefits").text, /doar orele pe care le poate rezerva\. \(dovadă: AC-1, AC-6\)/);
  assert.match(section(ok, "how").text, /Primește confirmarea/);
  assert.match(section(ok, "demonstrated").text, /pe telefon și nu poate alege o oră ocupată\. \(verificat: AC-1, AC-6\)/, "a client's words, gated on the criteria");
  assert.match(section(ok, "demonstrated").text, /Verificări tehnice trecute: 7 din 7/);
  assert.match(section(ok, "provenance").text, /AC-6 .*lățimea unui telefon \(390 px, Chromium\)/, "the technical criteria stay traceable");
  const mobileFailed = renderSummary(base({ manifest: manifest({ "AC-6": "FAIL" }) }));
  assert.doesNotMatch(section(mobileFailed, "benefits").text, /doar orele/, "the phone benefit is gone with AC-6");
  assert.match(section(mobileFailed, "benefits").text, /O oră ocupată nu poate fi rezervată/, "a benefit on other criteria stays");
  assert.match(section(mobileFailed, "how").text, /nu e verificat cap-coadă.*AC-6/);
  assert.match(section(mobileFailed, "cannot_claim").text, /Nu afirmăm: AC-6 .*FAIL/);
  assert.ok(mobileFailed.claimsToVerify.some((c) => c.startsWith("AC-6")));
  assert.doesNotMatch(section(mobileFailed, "demonstrated").text, /nu poate alege o oră ocupată/, "the phone line is gone with AC-6");
  assert.match(section(mobileFailed, "demonstrated").text, /Verificări tehnice trecute: 6 din 7/);
});

test("M11-SU-03 (T07) a criterion the reviewer left open (business decision) stays visible: it is never folded into a PASS", () => {
  const doc = renderSummary(base({ manifest: manifest({ "AC-4": "NEVERIFICAT" }) }));
  assert.match(section(doc, "cannot_claim").text, /AC-4 Cauza și fixul.*NEVERIFICAT/);
  assert.doesNotMatch(section(doc, "demonstrated").text, /reviewer independent/);
});

test("M11-SU-04 no invented price, ROI, deadline or date: price comes only from a CONFIGURED service; the fact guard refuses the rest", () => {
  const doc = renderSummary(base());
  assert.equal(section(doc, "price_terms").text, "Preț: De stabilit (neconfigurat). Termen: De stabilit (neconfigurat).");
  assert.match(section(doc, "cannot_claim").text, /Rezultate de business.*nu le-am măsurat/);
  assert.ok(doc.warnings.some((w) => /Prețul și termenul nu sunt configurate/.test(w)));
  const service = { id: "svc_1", version: 3, name: "Pachet programări", price: { status: "CONFIGURED", amount: 900, currency: "ron" }, leadTime: { status: "CONFIGURED", text: "două săptămâni" } };
  assert.match(section(renderSummary(base({ services: [service] })), "price_terms").text, /Pachet programări: preț 900 RON; termen două săptămâni/);
  for (const bad of ["Costă 200 lei", "Crește vânzările cu 30%", "Gata în 10 zile", "ROI garantat", "Disponibil din 12.10.2026"]) assert.throws(() => assertNoInventedFacts(bad), /fără o sursă configurată/, bad);
  const r = normalizeSummaryBlock({ problem: "Pierdeți 30% din clienți", benefits: [{ text: "Câștigați 500 lei pe lună", criteria: ["AC-1"] }] });
  assert.equal(r.problems.length, 2, "a fixture definition with invented facts is refused before it reaches a document");
});

test("M11-SU-05 owner edits: a new version; generated sections refused; the owner's own facts kept but listed to verify", () => {
  const v1 = renderSummary(base());
  const v2 = editSummary(v1, [{ id: "next_step", text: "Vă sun săptămâna viitoare; oferta: 900 lei." }]);
  assert.notEqual(v2.contentSha, v1.contentSha);
  assert.equal(section(v2, "next_step").source, "owner");
  assert.equal(v2.authorKind, "mixed");
  assert.ok(v2.claimsToVerify.some((c) => /Afirmat de tine în „Următorul pas”: un preț/.test(c)));
  assert.throws(() => editSummary(v1, [{ id: "provenance", text: "x" }]), /nu se editează de mână/);
  assert.throws(() => editSummary(v1, [{ id: "video", text: "x" }]), /nu se editează de mână/);
  assert.throws(() => editSummary(v1, [{ id: "problem", text: "  " }]), /e gol/);
  assert.throws(() => editSummary(v1, [{ id: "problem", text: "Salut {{nume}}" }]), /câmpuri nerezolvate/);
});

test("M11-SU-06 (T12/T13) a media-only change rewrites only „Materiale video”; a software change keeps the owner's sections and flags them", () => {
  const v1 = editSummary(renderSummary(base()), [{ id: "questions", text: "- Câte programări aveți pe săptămână?" }]);
  const newMedia = [{ ...MEDIA[0], id: "dli_m2", file: "demo-master-v2.mp4", durationMs: 20000 }];
  const media = regenerateSummary(v1, renderSummary(base({ media: newMedia })), "media");
  for (const s of media.sections) if (s.id !== "video") assert.deepEqual(s, section(v1, s.id), `${s.id} untouched by a clip change`);
  assert.match(section(media, "video").text, /demo-master-v2\.mp4, 0:20/);
  assert.deepEqual(media.basis.software, v1.basis.software, "the software basis is the same");
  const sw = regenerateSummary(v1, renderSummary(base({ manifest: manifest({ "AC-6": "FAIL" }), bundleSha: "d".repeat(64) })), "software");
  assert.equal(section(sw, "questions").text, "- Câte programări aveți pe săptămână?", "the owner's section keeps its text");
  assert.ok(!section(sw, "questions").needsReview, "questions are template-based, not software-based");
  assert.match(section(sw, "how").text, /nu e verificat/);
  const ownBenefit = editSummary(renderSummary(base()), [{ id: "benefits", text: "- Clientul programează singur." }]);
  const sw2 = regenerateSummary(ownBenefit, renderSummary(base({ bundleSha: "e".repeat(64) })), "software");
  assert.equal(section(sw2, "benefits").needsReview, true, "an owner section on a changed basis is flagged for review");
  assert.ok(sw2.claimsToVerify.some((c) => /De revăzut: „Ce beneficii putem afirma”/.test(c)));
  assert.equal(SECTION_BASIS.video, "media");
});

test("M11-SU-07 exports: Markdown, and escaped self-contained HTML with no script or external resource", () => {
  const doc = editSummary(renderSummary(base()), [{ id: "next_step", text: "<script>alert(1)</script> & „ok”" }]);
  const html = toHtml(doc);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp;/);
  assert.doesNotMatch(html, /https?:\/\/|<link|src=/);
  assert.match(toMarkdown(doc), /^# \[DATE SINTETICE\] Rezumat: /);
});
