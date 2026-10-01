import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pick, parseMaybeJson, toBool, listOf, textExcerpt, statusMeta, ORG_STATUSES, OPP_STATUSES, fiscalCodeText, priorityText,
  orgView, contactView, evidenceView, auditView, qualificationView, oppView, proposalView, draftView, serviceView, batchView, importRowView, followupView,
  countEntries, normalizeCounts, catalogSummary, syntheticBannerText, SYNTHETIC_BANNER, SYNTHETIC_MIXED_BANNER, outreachState, OUTREACH_DISABLED_REASON,
  groupPipeline, oppManualTargets, orgManualTargets, parseOrgFilters, buildOrgQuery, pageInfo, ORG_PAGE_SIZE,
  MAPPING_FIELDS, mappingFieldLabel, initialMapping, validateMapping, validateImportFile, bytesToBase64, fileToBase64, IMPORT_MAX_BYTES,
  parseRoNumber, formatPrice, formatLeadTime, serviceToForm, serviceFormToPayload, NOT_CONFIGURED_TEXT, splitTags, splitLines,
  followupState, confirmationText, confirmationMatches, CONFIRMATION_TEXTS, acceptanceReadiness, contactReadiness, handoffReadiness, handoffMissionId,
  approvalFrom, isSalesEvent, salesRoute, salesHref, MOBILE_TAB_ORDER, SALES_TABS, rawCell, columnSamples, auditReadiness, newestFirst,
  pagedOf, batchCounts, handoffView, evidenceStatusView, orderEvidence, proposalApproved, proposalApprovalReadiness, latestProposal,
  followupPayload, followupDraftable, hasRealContact, SERVICE_LIMITS, syntheticBannerFor, realOrgCount, draftReadiness, draftBasis, isHistoricalEvidence,
} from "../web/src/lib/salesLogic.js";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");

// All records below are synthetic: fictitious names, .test domains, generated fiscal codes.

test("M04-UI-01 accessors: camelCase or SQLite columns (snake_case, *_json text, 0/1) read the same", () => {
  assert.equal(pick({ a: null, b: 0 }, "a", "b"), 0);
  assert.equal(pick(null, "a"), undefined);
  assert.deepEqual(parseMaybeJson('["x"]', []), ["x"]);
  assert.deepEqual(parseMaybeJson("not json", []), []);
  assert.deepEqual(parseMaybeJson("{broken", {}), {});
  assert.deepEqual(parseMaybeJson({ a: 1 }, {}), { a: 1 });
  assert.equal(toBool(1), true); assert.equal(toBool(0), false); assert.equal(toBool(null), null);
  assert.deepEqual(listOf({ batches: [1] }, "batches"), [1]);
  assert.deepEqual(listOf({ items: [2] }, "batches"), [2]);
  assert.deepEqual(listOf([3], "x"), [3]);
  assert.deepEqual(listOf(null, "x"), []);

  const camel = orgView({ id: "org_1", displayName: "Brutăria Ștefănescu", fiscalCode: "RO123", fiscalCodeValid: true, domainKind: "organization_site", synthetic: true });
  const snake = orgView({ id: "org_1", display_name: "Brutăria Ștefănescu", fiscal_code: "RO123", fiscal_code_valid: 1, domain_kind: "organization_site", synthetic: 1 });
  assert.deepEqual(camel, snake);
  assert.equal(camel.name, "Brutăria Ștefănescu");
  assert.equal(orgView({ fiscal_code_valid: null }).fiscalCodeValid, null, "unknown validity is not false");
  assert.equal(orgView(null).id, "");

  const c = contactView({ kind: "email", value: "info@brutaria-stefanescu.test", generic: 1, warnings_json: '["adresă generică"]' });
  assert.equal(c.generic, true);
  assert.deepEqual(c.warnings, ["adresă generică"]);

  const ev = evidenceView({ id: "ev1", claim: "telefon", value_json: '"+40 700 000 123"', label: "OBSERVED", source_kind: "fixture", source_ref: "brutaria-stefanescu.test" });
  assert.equal(ev.value, "+40 700 000 123");
  assert.equal(ev.sourceKind, "fixture");
  assert.equal(evidenceView({}).label, "UNKNOWN");
});

test("M04-UI-02 status labels: Romanian with diacritics for every lifecycle state; unknown codes stay visible", () => {
  for (const s of ORG_STATUSES) assert.notEqual(statusMeta("org", s).label, s, `org ${s} has a label`);
  for (const s of OPP_STATUSES) assert.notEqual(statusMeta("opp", s).label, s, `opp ${s} has a label`);
  assert.deepEqual(statusMeta("org", "DO_NOT_CONTACT"), { label: "Nu contacta", tone: "error" });
  assert.equal(statusMeta("opp", "WON").label, "Câștigată");
  assert.equal(statusMeta("draft", "CONTENT_APPROVED").label, "Conținut aprobat");
  assert.equal(statusMeta("evidence", "INFERRED").label, "Dedus");
  assert.equal(statusMeta("audit", "NOT_APPLICABLE").label, "Nu se aplică");
  assert.deepEqual(statusMeta("row", "SOMETHING_NEW"), { label: "SOMETHING_NEW", tone: "neutral" });
  assert.equal(statusMeta("opp", "").label, "—");
  assert.equal(fiscalCodeText("", null).text, "lipsă");
  assert.match(fiscalCodeText("RO18547290", true).text, /^valid/);
  assert.match(fiscalCodeText("RO18547291", false).text, /^invalid/);
  assert.equal(priorityText(null), "necunoscută");
  assert.equal(priorityText(72.4), "72/100");
  assert.equal(priorityText("abc"), "necunoscută");
});

test("M04-UI-03 audit, qualification, proposal and draft views keep evidence as text and unknown as null", () => {
  const audit = auditView({ id: "a1", url: "https://brutaria-stefanescu.test/", source_kind: "fixture", result_json: JSON.stringify({ version: "audit-v1",
    checks: [{ id: "mobile_viewport", area: "mobile", status: "ISSUE", observation: "Lipsește meta viewport", label: "OBSERVED", evidence: { selector: "head", excerpt: "<script>alert(1)</script>", method: "static-html" } }],
    limits: ["Doar HTML static"] }) });
  assert.equal(audit.sourceKind, "fixture");
  assert.equal(audit.checks[0].evidence.excerpt, "<script>alert(1)</script>", "kept verbatim as a string; the UI renders it as text");
  assert.deepEqual(audit.limits, ["Doar HTML static"]);
  assert.equal(auditView({ checks: [{ id: "https" }] }).checks[0].status, "UNKNOWN");

  const q = qualificationView({ id: "q1", formula_version: "q-v1", priority: null, result_json: JSON.stringify({ version: "q-v1",
    components: { serviceFit: { score: 80, contributions: [{ factor: "Site fără viewport", points: 40, evidenceIds: ["ev1"] }] }, evidence: { score: null, contributions: [] } },
    unknowns: ["Cifra de afaceri"], explanation: ["x"], financialFilter: { status: "UNKNOWN", reason: "fără sursă" } }) });
  assert.equal(q.components.serviceFit.score, 80);
  assert.equal(q.components.evidence.score, null, "unknown component is null, not 0");
  assert.equal(q.components.completeness.score, null);
  assert.equal(q.priority, null);
  assert.deepEqual(q.components.serviceFit.contributions[0].evidenceIds, ["ev1"]);
  assert.equal(q.financialFilter.status, "UNKNOWN");
  assert.equal(qualificationView(null), null);

  const p = proposalView({ id: "p1", version: 2, status: "APPROVED", content_sha: "abc", content_json: JSON.stringify({ title: "Propunere", sections: [{ id: "price", heading: "Preț", text: "De stabilit (neconfigurat)" }], claimsToVerify: ["c1"] }) });
  assert.equal(p.sha, "abc");
  assert.equal(p.sections[0].heading, "Preț");
  assert.deepEqual(p.claimsToVerify, ["c1"]);

  const d = draftView({ id: "d1", version: 1, status: "DRAFT", subject: "S", body: "B", meta_json: JSON.stringify({ claimsToVerify: ["Telefonul e corect"], personalizationBasis: [{ text: "Site fără viewport", evidenceId: "ev1" }] }) });
  assert.deepEqual(d.claimsToVerify, ["Telefonul e corect"]);
  assert.deepEqual(d.personalizationBasis, [{ text: "Site fără viewport", evidenceId: "ev1" }]);
  assert.equal(draftView({ claimsToVerify: ["x"] }).claimsToVerify[0], "x");

  assert.equal(textExcerpt("  a\n\n b  "), "a b");
  assert.equal(textExcerpt("x".repeat(300), 200).length, 200);
  assert.ok(textExcerpt("x".repeat(300), 200).endsWith("…"));
});

test("M04-UI-04 overview: counts, synthetic banner and outreach state", () => {
  assert.deepEqual(countEntries({ orgs: 12, needsReview: 3, byStatus: { NEW: 2 }, label: "x" }).map((e) => [e.key, e.label, e.value]), [["orgs", "firme", 12], ["needsReview", "de revizuit", 3]]);
  assert.deepEqual(normalizeCounts({ NEW: 2, QUALIFIED: 1 }), [["NEW", 2], ["QUALIFIED", 1]]);
  assert.deepEqual(normalizeCounts([{ status: "WON", count: 1 }]), [["WON", 1]]);
  assert.deepEqual(catalogSummary([{ price: { status: "CONFIGURED", amount: 100 } }, { price_json: '{"status":"NOT_CONFIGURED"}' }]), { services: 2, configured: 1 });
  assert.deepEqual(catalogSummary({ services: 3, configured: 0 }), { services: 3, configured: 0 });

  assert.equal(syntheticBannerText(true), SYNTHETIC_BANNER);
  assert.equal(syntheticBannerText(false), null);
  assert.equal(syntheticBannerText(0), null);
  assert.equal(syntheticBannerText(5), SYNTHETIC_MIXED_BANNER);
  assert.equal(syntheticBannerText({ count: 10, total: 10 }), SYNTHETIC_BANNER);
  assert.equal(syntheticBannerText({ count: 2, total: 10 }), SYNTHETIC_MIXED_BANNER);
  assert.equal(syntheticBannerText({ any: false, count: 0 }), null);
  assert.match(SYNTHETIC_BANNER, /fictive/);
  assert.equal(syntheticBannerFor(true, 0), SYNTHETIC_BANNER, "only synthetic companies");
  assert.equal(syntheticBannerFor(true, 4), SYNTHETIC_MIXED_BANNER, "real companies too: never claim everything is fictive");
  assert.equal(syntheticBannerFor(true, null), SYNTHETIC_MIXED_BANNER, "unknown yet: the careful text");
  assert.equal(syntheticBannerFor(false, 0), null);
  assert.equal(realOrgCount({ counts: { orgs: 5 }, syntheticOrgs: 5 }), 0, "overview.syntheticOrgs vs counts.orgs");
  assert.equal(realOrgCount({ counts: { orgs: 7 }, syntheticOrgs: 5 }), 2);
  assert.equal(realOrgCount({ counts: { orgs: 7 } }), null, "unknown without syntheticOrgs");
  assert.equal(syntheticBannerFor(true, realOrgCount({ counts: { orgs: 3 }, syntheticOrgs: 3 })), SYNTHETIC_BANNER);
  assert.match(SYNTHETIC_BANNER, /\.test/);

  assert.deepEqual(outreachState({ outreach: "DISABLED" }), { mode: "DISABLED", sendEnabled: false, reason: OUTREACH_DISABLED_REASON });
  assert.equal(outreachState({ outreach: "ENABLED" }).sendEnabled, false, "M04 never enables sending from the UI");
  assert.equal(outreachState(null).mode, "DISABLED");
  assert.match(OUTREACH_DISABLED_REASON, /OUTREACH_DISABLED/);
});

test("M04-UI-05 pipeline grouping: lifecycle order, counts, empty groups kept, unknown statuses appended", () => {
  const groups = groupPipeline([
    { id: "o1", status: "IDENTIFIED", title: "B", next_action_at: "2026-10-05T09:00:00Z" },
    { id: "o2", status: "IDENTIFIED", title: "A", nextActionAt: "2026-10-03T09:00:00Z" },
    { id: "o3", status: "WON", title: "C" },
    { id: "o4", status: "EXPERIMENTAL", title: "D" },
    null,
  ]);
  assert.deepEqual(groups.slice(0, OPP_STATUSES.length).map((g) => g.status), [...OPP_STATUSES]);
  const identified = groups.find((g) => g.status === "IDENTIFIED");
  assert.equal(identified.count, 2);
  assert.deepEqual(identified.items.map((o) => o.id), ["o2", "o1"], "earliest next action first");
  assert.equal(groups.find((g) => g.status === "LOST").count, 0);
  assert.equal(groups.at(-2).status, "EXPERIMENTAL");
  assert.equal(groups.at(-1).status, "UNKNOWN", "a malformed record lands in an UNKNOWN group, never crashes");
  assert.equal(groups.find((g) => g.status === "WON").label, "Câștigată");

  assert.deepEqual(oppManualTargets("WON"), []);
  assert.ok(!oppManualTargets("APPROVED_INTERNAL").includes("CONTACTED"), "CONTACTED needs a contact event");
  assert.ok(!oppManualTargets("IN_DISCUSSION").includes("WON"), "WON needs a client acceptance");
  assert.deepEqual(orgManualTargets("DO_NOT_CONTACT"), []);
  assert.ok(!orgManualTargets("NEW").includes("DO_NOT_CONTACT"), "suppression has its own action with a reason");
});

test("M04-UI-06 org filters: query-string builder omits empty values and clamps paging; parse is tolerant", () => {
  assert.equal(buildOrgQuery({}), `offset=0&limit=${ORG_PAGE_SIZE}`);
  const qs = new URLSearchParams(buildOrgQuery({ q: "  Ștefănescu & Fiii ", status: "QUALIFIED", city: "Iași", synthetic: "1", needsReview: true, sort: "name_asc", offset: 100, limit: 50 }));
  assert.equal(qs.get("q"), "Ștefănescu & Fiii");
  assert.equal(qs.get("status"), "QUALIFIED");
  assert.equal(qs.get("city"), "Iași");
  assert.equal(qs.get("synthetic"), "1");
  assert.equal(qs.get("needsReview"), "1");
  assert.equal(qs.get("sort"), "name_asc");
  assert.equal(qs.get("offset"), "100");
  const bad = new URLSearchParams(buildOrgQuery({ needsReview: "yes", sort: "drop table", offset: -5, limit: 99999, synthetic: "maybe" }));
  assert.equal(bad.get("needsReview"), null);
  assert.equal(bad.get("sort"), null);
  assert.equal(bad.get("offset"), "0");
  assert.equal(bad.get("limit"), String(ORG_PAGE_SIZE));
  assert.equal(bad.get("synthetic"), null);

  const f = parseOrgFilters({ q: "brutărie", status: "NOPE", needsReview: "1", offset: "50", sort: "priority_desc" });
  assert.equal(f.status, "");
  assert.equal(f.needsReview, true);
  assert.equal(f.offset, 50);
  assert.equal(f.sort, "priority_desc");
  assert.equal(parseOrgFilters(null).sort, "updated_desc");

  assert.deepEqual(pageInfo({ total: 230, offset: 0, limit: 50 }).label, "1–50 din 230");
  const last = pageInfo({ total: 230, offset: 200, limit: 50 });
  assert.equal(last.label, "201–230 din 230");
  assert.equal(last.hasNext, false); assert.equal(last.hasPrev, true); assert.equal(last.prevOffset, 150); assert.equal(last.page, 5); assert.equal(last.pages, 5);
  assert.equal(pageInfo({ total: 0 }).label, "0 rezultate");
  assert.equal(pageInfo({ total: 10, offset: 999, limit: 50 }).from, 10, "an offset past the end is clamped");
});

test("M04-UI-07 import mapping: field labels, defaults from the suggestion, validation", () => {
  const ids = MAPPING_FIELDS.map(([id]) => id);
  assert.deepEqual(ids, ["name", "fiscalCode", "website", "email", "phone", "city", "county", "address", "caen", "contactName", "contactRole", "turnover", "turnoverYear", "employees", "notes", "source", "ignore"], "the contract §5 field list");
  assert.equal(mappingFieldLabel("fiscalCode"), "CUI / cod fiscal");
  assert.equal(mappingFieldLabel("zzz"), "zzz");

  // The Hub suggests and stores the mapping by column index ("0", "1", …): two columns may share a header.
  const headers = ["Denumire", "CUI", "Telefon", "Telefon", "Oraș", "Altceva"];
  const m = initialMapping(headers, {}, { 0: "name", 1: "fiscalCode", 2: "phone", 4: "city", 5: "hack" });
  assert.deepEqual(m, { 0: "name", 1: "fiscalCode", 2: "phone", 3: "ignore", 4: "city", 5: "ignore" });
  assert.equal(initialMapping(["A"], { 0: "email" }, { 0: "name" })["0"], "email", "the saved mapping wins over the suggestion");
  assert.equal(initialMapping(["A", "B"], {}, { B: "name" })["1"], "name", "a mapping keyed by header text is read too");

  assert.equal(validateMapping(m, headers).ok, true);
  const twoPhones = validateMapping({ ...m, 3: "phone" }, headers);
  assert.equal(twoPhones.ok, false, "the Hub maps a field to one column only (normalizeMapping refuses two)");
  assert.match(twoPhones.errors.join(" "), /mai multe coloane: Telefon, Telefon/);
  assert.equal(validateMapping({ ...m, 3: "ignore", 5: "ignore" }, headers).ok, true, "several ignored columns are fine");
  const noName = validateMapping({ 1: "fiscalCode" }, headers);
  assert.equal(noName.ok, false);
  assert.match(noName.errors[0], /numele firmei/);
  const dup = validateMapping({ A: "name", B: "name" });
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join(" "), /mai multe coloane: A, B/);
  assert.match(validateMapping({ 0: "name", 1: "bogus" }, headers).errors.join(" "), /Câmp necunoscut pentru coloana „CUI”/);
  assert.match(validateMapping({ 0: "name" }, headers).warnings.join(" "), /nume și oraș/);
  assert.match(validateMapping({ A: "name", B: "fiscalCode", C: "turnover" }).warnings.join(" "), /fără an/);
  assert.equal(validateMapping({ 0: "name", 9: "name" }, ["A"]).ok, true, "columns past the headers are ignored");
  assert.match(validateMapping({ 0: "name", 1: "name" }, ["A", ""]).errors.join(" "), /A, coloana 2/, "a column without a header is named by its number");

  assert.equal(rawCell(["Firma Test", "RO1"], ["Nume", "CUI"], "CUI"), "RO1");
  assert.equal(rawCell(["Firma Test", "RO1"], ["Nume", "CUI"], 1), "RO1", "by column index");
  assert.equal(rawCell({ Nume: "Firma Test" }, ["Nume"], "Nume"), "Firma Test");
  assert.equal(rawCell({ Nume: "Firma Test" }, ["Nume"], 0), "Firma Test");
  assert.equal(rawCell('["a","b"]', ["x", "y"], "y"), "b", "a raw_json column (JSON text) is read too");
  assert.equal(rawCell(null, ["x"], "x"), "");
  const samples = columnSamples([{ raw: ["Alfa", "Iași"] }, { raw_json: '{"Nume":"Beta","Oraș":"Iași"}' }, { raw: ["Alfa", "Cluj"] }], ["Nume", "Oraș"]);
  assert.deepEqual(samples, { 0: ["Alfa", "Beta"], 1: ["Iași", "Cluj"] }, "distinct values per column index; array rows, and object rows (JSON text) by header");
});

test("M04-UI-07b server shapes: import rows (preview and stored), paged answers, batch counters, hand-offs", () => {
  // A preview row (POST …/preview → rows): the record at top level, sheetRow from the server.
  const preview = importRowView({ rowIndex: 0, sheetRow: 2, status: "CREATE", record: { name: "Atelierul Verde SRL", fiscalCode: "18547290", fiscalCodeValid: true, domain: "atelierul-verde.test" }, errors: [], warnings: ["x"], matches: [] });
  assert.equal(preview.record.name, "Atelierul Verde SRL");
  assert.equal(preview.sheetRow, 2);
  // A stored row (GET …/imports/:id → rows.items): the record under normalized.record once processed.
  const stored = importRowView({ id: "sir_1", batchId: "sib_1", rowIndex: 3, status: "CREATED", normalized: { numericCols: [], record: { name: "Lumen Foto SRL", city: "Iași" } }, orgId: "org_1" });
  assert.equal(stored.record.name, "Lumen Foto SRL");
  assert.equal(stored.sheetRow, 5, "row index 3 is spreadsheet row 5 (header + 1-based)");
  assert.deepEqual(importRowView({ normalized: { numericCols: [] } }).record, {}, "an unprocessed row has no record yet");
  assert.equal(statusMeta("row", "DUPLICATE_IN_FILE").label, "Duplicat în fișier");
  assert.equal(statusMeta("row", "SUPPRESSED").tone, "error");
  assert.equal(statusMeta("row", "MATCH").label, "Potrivire sigură");

  assert.deepEqual(pagedOf({ batch: {}, rows: { items: [1, 2], total: 7, offset: 0, limit: 50 } }, "rows"), { items: [1, 2], total: 7 });
  assert.deepEqual(pagedOf({ review: { items: [1], total: 1 } }, "review"), { items: [1], total: 1 });
  assert.deepEqual(pagedOf({ items: [1, 2, 3], total: 9 }), { items: [1, 2, 3], total: 9 });
  assert.deepEqual(pagedOf({}, "rows"), { items: [], total: 0 });

  assert.deepEqual(batchCounts({ counts: { preview: { total: 3, CREATE: 3, warnings: 0 }, imported: { CREATED: 3 } } }).map((c) => [c.key, c.label, c.value]), [["CREATED", "create", 3]], "after the import: what it did");
  assert.deepEqual(batchCounts({ counts: { preview: { total: 3, CREATE: 2, INVALID: 1 } } }).map((c) => c.label), ["total", "firme noi", "invalide"], "before: what the preview found");
  assert.deepEqual(batchCounts({}), []);

  const h = handoffView({ id: "sho_1", missionId: "mis_1", status: "DRAFT_CREATED", proposalSha: "abc", outdated: true, note: "Propunerea s-a schimbat" });
  assert.equal(h.missionId, "mis_1");
  assert.equal(h.outdated, true);
  assert.equal(handoffMissionId({ handoffId: "sho_1", missionId: "mis_9", package: {} }), "mis_9", "the creation answer");
  assert.equal(handoffMissionId({ handoffId: "sho_1", missionId: null }), null, "package only, no project chosen");
  assert.equal(catalogSummary({ services: 2, configuredPrices: 1 }).configured, 1, "overview.catalog.configuredPrices");
  assert.equal(countEntries({ missingWebsite: 2 })[0].label, "fără site");
});

test("M04-UI-07c evidence freshness, contradictions and the qualification override as the server returns them", () => {
  const list = [
    { id: "e1", claim: "financial:turnover", label: "USER_PROVIDED", sourceRef: "a.csv#rând 2", freshness: "SUPERSEDED", freshnessReason: "Există o citire mai nouă din aceeași sursă", conflictsWith: [] },
    { id: "e2", claim: "financial:turnover", label: "USER_PROVIDED", sourceRef: "a.csv#rând 2", freshness: "NEEDS_RECHECK", freshnessReason: "Cifra e din 2021: e veche", conflictsWith: ["e3"] },
    { id: "e3", claim: "financial:turnover", label: "SOURCE_REPORTED", sourceRef: "registru", freshness: "CURRENT", conflictsWith: ["e2"] },
  ].map(evidenceView);
  assert.equal(list[0].freshness, "SUPERSEDED");
  assert.equal(list[1].freshnessReason, "Cifra e din 2021: e veche");
  assert.deepEqual(list[2].conflictsWith, ["e2"]);
  assert.equal(evidenceView({}).freshness, "CURRENT", "no freshness from an older server: current");
  assert.deepEqual(orderEvidence(list).map((e) => e.id), ["e3", "e2", "e1"], "current, then to recheck, then the superseded history");
  assert.deepEqual(statusMeta("freshness", "NEEDS_RECHECK"), { label: "Necesită reverificare", tone: "warn" });
  assert.equal(statusMeta("freshness", "SUPERSEDED").label, "Înlocuită");
  assert.equal(statusMeta("freshness", "CURRENT").label, "Actuală");
  const rolled = evidenceView({ id: "e4", claim: "x", freshness: "ROLLED_BACK", freshnessReason: "Lotul de import a fost anulat (rollback)" });
  assert.equal(statusMeta("freshness", "ROLLED_BACK").label, "Anulată (rollback)");
  assert.equal(isHistoricalEvidence(rolled), true);
  assert.equal(isHistoricalEvidence(list[0]), true, "superseded is history too");
  assert.equal(isHistoricalEvidence(list[2]), false);
  assert.deepEqual(orderEvidence([rolled, ...list]).map((e) => e.id), ["e3", "e2", "e1", "e4"]);
  assert.equal(evidenceStatusView({ rolledBack: 2 }).rolledBack, 2);
  const st = evidenceStatusView({ current: 1, needsRecheck: 1, superseded: 1, contradictions: [{ id: "e2", claim: "financial:turnover", conflictsWith: ["e3"] }] });
  assert.equal(st.contradictions[0].conflictsWith[0], "e3");
  assert.deepEqual(evidenceStatusView(undefined), { current: 0, needsRecheck: 0, superseded: 0, rolledBack: 0, contradictions: [] });

  // sales.qualification.override: the row's priority is the owner's value; the formula's stays in computedPriority.
  const q = qualificationView({ id: "q2", formulaVersion: "q-v1", priority: 80, override: { priority: 80, previousPriority: 41, reason: "recomandat", actor: "user", at: "2026-10-01T10:00:00Z" },
    result: { version: "q-v1", priority: 80, computedPriority: 41, overrides: [{ priority: 80, previousPriority: 41, reason: "recomandat" }], components: {} } });
  assert.equal(q.priority, 80);
  assert.equal(q.computedPriority, 41);
  assert.equal(q.history.length, 1);
  assert.equal(qualificationView({ priority: 50, result: { priority: 50 } }).computedPriority, 50, "no override: computed = priority");
});

test("M04-UI-08 import files: type and size checks, base64 of the exact bytes", async () => {
  assert.deepEqual(validateImportFile({ name: "firme.csv", size: 10 }), { ok: true, kind: "csv" });
  assert.deepEqual(validateImportFile({ name: "Firme.XLSX", size: 10 }), { ok: true, kind: "xlsx" });
  assert.equal(validateImportFile({ name: "firme.tsv", size: 10 }).kind, "csv");
  assert.match(validateImportFile({ name: "firme.xlsm", size: 10 }).reason, /macro/);
  assert.match(validateImportFile({ name: "firme.xls", size: 10 }).reason, /\.xls/);
  assert.match(validateImportFile({ name: "firme.pdf", size: 10 }).reason, /neacceptat/);
  assert.equal(validateImportFile({ name: "firme.csv", size: 0 }).reason, "Fișier gol");
  assert.match(validateImportFile({ name: "firme.csv", size: IMPORT_MAX_BYTES + 1 }).reason, /20 MB/);
  assert.equal(validateImportFile({ name: "", size: 1 }).ok, false);

  const text = "Denumire;CUI\r\nBrutăria Ștefănescu SRL;RO18547290\r\n";
  const bytes = new TextEncoder().encode(text);
  assert.equal(bytesToBase64(bytes), Buffer.from(text, "utf8").toString("base64"));
  const big = new Uint8Array(200_000).map((_, i) => i % 256);
  assert.equal(bytesToBase64(big), Buffer.from(big).toString("base64"), "chunked encoding of a large buffer");
  assert.equal(bytesToBase64(new Uint8Array(0)), "");
  assert.equal(await fileToBase64(new Blob([bytes])), Buffer.from(text, "utf8").toString("base64"));
  await assert.rejects(fileToBase64(null), /Fișier invalid/);
});

test("M04-UI-09 services: price and lead time only when CONFIGURED; Romanian numbers; form round trip", () => {
  assert.equal(parseRoNumber("1.500,50"), 1500.5);
  assert.equal(parseRoNumber("1500"), 1500);
  assert.equal(parseRoNumber("1.500"), 1500);
  assert.equal(parseRoNumber("2.5"), 2.5);
  assert.equal(parseRoNumber("1 200"), 1200);
  assert.equal(parseRoNumber("abc"), null);
  assert.equal(parseRoNumber("-5"), null);
  assert.equal(parseRoNumber(""), null);

  assert.equal(formatPrice({ status: "NOT_CONFIGURED", amount: 900 }), NOT_CONFIGURED_TEXT, "an amount without CONFIGURED is never shown");
  assert.equal(formatPrice('{"status":"CONFIGURED","amount":1500,"currency":"RON","unit":"project"}'), "1.500 RON / proiect");
  assert.equal(formatPrice(null), NOT_CONFIGURED_TEXT);
  assert.equal(formatLeadTime({ status: "CONFIGURED", value: 10, unit: "days" }), "10 zile lucrătoare");
  assert.equal(formatLeadTime({ status: "CONFIGURED" }), NOT_CONFIGURED_TEXT);

  assert.deepEqual(splitTags("Website, responsive;contact, website"), ["website", "responsive", "contact"]);
  assert.deepEqual(splitLines("a\n\n b \r\nc"), ["a", "b", "c"]);

  const form = serviceToForm({ id: "s1", name: "Site de prezentare", tags_json: '["website","responsive"]', scope_json: '["5 pagini"]', price_json: '{"status":"CONFIGURED","amount":2500.5,"currency":"EUR","unit":"project"}', lead_time_json: '{"status":"NOT_CONFIGURED"}' });
  assert.equal(form.amount, "2500,5");
  assert.equal(form.priceStatus, "CONFIGURED");
  assert.equal(form.leadStatus, "NOT_CONFIGURED");
  const ok = serviceFormToPayload(form);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.deepEqual(ok.payload.price, { status: "CONFIGURED", amount: 2500.5, currency: "EUR", unit: "project" });
  assert.deepEqual(ok.payload.leadTime, { status: "NOT_CONFIGURED" });
  assert.deepEqual(ok.payload.tags, ["website", "responsive"]);
  assert.deepEqual(ok.payload.scope, ["5 pagini"]);

  const bad = serviceFormToPayload({ ...form, name: "x", amount: "gratis", leadStatus: "CONFIGURED", leadValue: "0" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  const notConfigured = serviceFormToPayload({ ...form, priceStatus: "NOT_CONFIGURED", amount: "garbage" });
  assert.equal(notConfigured.ok, true, "the amount is ignored when the price is not configured");
  assert.deepEqual(notConfigured.payload.price, { status: "NOT_CONFIGURED" });
  assert.equal(serviceView({}).active, true);

  // The Hub stores a configured lead time as free text: { status: "CONFIGURED", text } (sales.mjs saveService).
  const lead = serviceFormToPayload({ ...form, leadStatus: "CONFIGURED", leadText: "  10 zile   lucrătoare " });
  assert.equal(lead.ok, true, lead.errors.join("; "));
  assert.deepEqual(lead.payload.leadTime, { status: "CONFIGURED", text: "10 zile lucrătoare" });
  assert.equal(formatLeadTime({ status: "CONFIGURED", text: "2–3 săptămâni" }), "2–3 săptămâni");
  assert.equal(formatLeadTime({ status: "NOT_CONFIGURED", text: "2 zile" }), NOT_CONFIGURED_TEXT);
  assert.equal(serviceToForm({ lead_time_json: '{"status":"CONFIGURED","text":"5 zile"}' }).leadText, "5 zile", "round trip of the stored text");
  assert.equal(serviceFormToPayload({ ...form, name: "ab" }).ok, false, `names have at least ${SERVICE_LIMITS.nameMin} characters (server)`);
  assert.equal(serviceFormToPayload({ ...form, description: "x".repeat(SERVICE_LIMITS.description + 1) }).ok, false);
  assert.equal(serviceFormToPayload({ ...form, scope: Array.from({ length: 21 }, (_, i) => `r${i}`).join("\n") }).ok, false, "at most 20 scope lines (command schema)");
  assert.equal(serviceFormToPayload({ ...form, tags: Array.from({ length: 11 }, (_, i) => `t${i}`).join(",") }).ok, false, "at most 10 tags (kept by the Hub)");
});

test("M04-UI-10 follow-ups, confirmations and readiness rules", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  assert.equal(followupState({ status: "PENDING", due_at: "2026-09-30T12:00:00Z" }, now), "overdue");
  assert.equal(followupState({ status: "PENDING", dueAt: "2026-10-02T06:00:00Z" }, now), "due");
  assert.equal(followupState({ status: "PENDING", dueAt: "2026-10-09T06:00:00Z" }, now), "upcoming");
  assert.equal(followupState({ status: "SUSPENDED", dueAt: "2026-09-01T06:00:00Z" }, now), "suspended");
  assert.equal(followupState({ status: "DONE", dueAt: "2026-09-01T06:00:00Z" }, now), "closed");
  assert.equal(followupView({ due_at: "x", opportunity_id: "o1" }).opportunityId, "o1");

  assert.equal(confirmationText({}, "manualContact"), CONFIRMATION_TEXTS.manualContact);
  assert.equal(confirmationText({ confirmations: { manualContact: " Text de la server " } }, "manualContact"), "Text de la server");
  assert.equal(confirmationMatches("  confirm că am contactat  această firmă în afara Hub-ului ", CONFIRMATION_TEXTS.manualContact), true);
  assert.equal(confirmationMatches("Confirm ca am contactat aceasta firma in afara Hub-ului", CONFIRMATION_TEXTS.manualContact), false, "diacritics must match");
  assert.equal(confirmationMatches("", ""), false);

  const proposals = [{ id: "p1", version: 1, status: "SUPERSEDED" }, { id: "p2", version: 2, status: "APPROVED", approved_sha: "sha2" }];
  assert.equal(acceptanceReadiness({ status: "IN_DISCUSSION" }, proposals).proposal.id, "p2");
  assert.equal(acceptanceReadiness({ status: "IN_DISCUSSION" }, [{ id: "p1", status: "DRAFT" }]).ok, false);
  assert.equal(acceptanceReadiness({ status: "WON" }, proposals).ok, false);
  assert.equal(contactReadiness({ status: "APPROVED_INTERNAL" }, { status: "DO_NOT_CONTACT" }).ok, false);
  assert.equal(contactReadiness({ status: "APPROVED_INTERNAL" }, { status: "OPPORTUNITY" }).ok, true);
  assert.equal(handoffReadiness({ status: "IN_DISCUSSION" }, []).ok, false);
  assert.equal(handoffReadiness({ status: "WON" }, []).ok, true);
  assert.equal(handoffReadiness({ status: "WON" }, [{ id: "h1", missionId: "mis_1" }]).ok, false, "a hand-off with its mission is done");
  assert.equal(handoffReadiness({ status: "WON" }, [{ id: "h1" }]).needsProject, true, "a package-only hand-off can still get its mission");
  assert.equal(auditReadiness({ domain: "brutaria-stefanescu.test" }).ok, true);
  assert.equal(auditReadiness({ website: "https://www.Brutaria-Stefanescu.test/contact" }).host, "brutaria-stefanescu.test");
  assert.match(auditReadiness({ domain: "exemplu.ro" }).reason, /LIVE_COLLECTION_DISABLED/, "no live collection in M04");
  assert.equal(auditReadiness({}).ok, false);
  assert.deepEqual(newestFirst([{ id: "a", createdAt: "2026-09-01T00:00:00Z" }, { id: "b" }, { id: "c", created_at: "2026-10-01T00:00:00Z" }]).map((x) => x.id), ["c", "a", "b"]);

  assert.equal(handoffMissionId({ mission: { id: "mis_1" } }), "mis_1");
  assert.equal(handoffMissionId({ mission_id: "mis_2" }), "mis_2");
  assert.equal(handoffMissionId({}), null);
});

test("M04-UI-10b readiness as the server checks it: proposal approval, acceptance, hand-off, follow-ups", () => {
  // Proposals as GET /api/sales/opportunities/:id returns them (camelCase, contentSha, APPROVED_INTERNAL).
  const v1 = { id: "p1", version: 1, status: "SUPERSEDED", contentSha: "s1" };
  const v2 = { id: "p2", version: 2, status: "DRAFT", contentSha: "s2", approvedSha: null };
  const v2ok = { ...v2, status: "APPROVED_INTERNAL", approvedSha: "s2" };
  assert.equal(proposalView(v2).sha, "s2", "displayedSha is the server's contentSha");
  assert.equal(latestProposal([v1, v2]).id, "p2");
  assert.equal(proposalApproved(v2ok), true);
  assert.equal(proposalApproved({ ...v2ok, approvedSha: "old" }), false, "an approval of other content does not count");
  assert.equal(proposalApproved(v1), false);

  assert.equal(proposalApprovalReadiness({ status: "PROPOSAL_DRAFT" }, v2, [v1, v2]).needsReview, true, "first mark it ready for review");
  assert.equal(proposalApprovalReadiness({ status: "READY_FOR_OWNER_REVIEW" }, v2, [v1, v2]).ok, true);
  assert.equal(proposalApprovalReadiness({ status: "READY_FOR_OWNER_REVIEW" }, v1, [v1, v2]).ok, false, "only the latest version");
  assert.equal(proposalApprovalReadiness({ status: "APPROVED_INTERNAL" }, v2ok, [v1, v2ok]).ok, false, "already approved");
  assert.match(proposalApprovalReadiness({ status: "IDENTIFIED" }, v2, [v2]).reason, /De revizuit de tine/);

  assert.equal(acceptanceReadiness({ status: "CONTACTED" }, [v1, v2ok]).proposal.id, "p2");
  assert.match(acceptanceReadiness({ status: "APPROVED_INTERNAL" }, [v1, v2ok]).reason, /contact real/, "acceptance comes after a real contact");
  assert.match(acceptanceReadiness({ status: "CONTACTED" }, [v2ok, { id: "p3", version: 3, status: "DRAFT", contentSha: "s3" }]).reason, /v3/, "a newer unapproved version blocks it");
  assert.equal(CONFIRMATION_TEXTS.clientAcceptance, "Confirm că clientul a acceptat această propunere", "the server's sentence (CLIENT_ACCEPTANCE_TEXT)");

  const accepted = [{ id: "sca_1", proposalId: "p2", proposalSha: "s2" }];
  const manual = [{ kind: "MANUAL_RECORDED", occurredAt: "2026-09-28T10:00:00Z" }];
  assert.equal(handoffReadiness({ status: "WON" }, [], { proposals: [v1, v2ok], acceptances: accepted }).ok, true);
  assert.equal(handoffReadiness({ status: "WON" }, [], { proposals: [v2ok, { id: "p3", version: 3, status: "DRAFT", contentSha: "s3" }], acceptances: accepted }).ok, false, "a newer version needs its own acceptance");
  assert.equal(handoffReadiness({ status: "WON" }, [{ id: "h1", outdated: true }], { proposals: [v2ok], acceptances: accepted }).ok, true, "an outdated hand-off does not block a new one");
  assert.equal(handoffReadiness({ status: "WON" }, [{ id: "h1", status: "DRAFT_CREATED", outdated: false, missionId: "mis_1" }]).ok, false);
  const packageOnly = handoffReadiness({ status: "WON" }, [{ id: "h1", status: "DRAFT_CREATED", outdated: false, missionId: null }], { proposals: [v2ok], acceptances: accepted });
  assert.deepEqual([packageOnly.ok, packageOnly.needsProject, packageOnly.current.id], [true, true, "h1"], "the same row gets its mission (sent with a projectId)");
  assert.equal(handoffReadiness({ status: "IN_DISCUSSION" }, [{ id: "h1" }]).ok, false);

  // Drafts: only from the LATEST proposal approved internally, for an open opportunity of a contactable company.
  assert.equal(draftReadiness({ status: "APPROVED_INTERNAL" }, [v1, v2ok]).proposal.id, "p2");
  assert.match(draftReadiness({ status: "PROPOSAL_DRAFT" }, [v1, v2]).reason, /aprobat/);
  assert.match(draftReadiness({ status: "IDENTIFIED" }, []).reason, /propunere/);
  assert.match(draftReadiness({ status: "WON" }, [v2ok]).reason, /câștigată/);
  assert.match(draftReadiness({ status: "APPROVED_INTERNAL" }, [v2ok], { suppressed: true }).reason, /Nu contacta/);
  assert.match(draftReadiness({ status: "APPROVED_INTERNAL" }, [v2ok], { emails: [] }).reason, /e-mail/);
  const d2 = draftView({ id: "d1", status: "DRAFT", proposalId: "p2", meta: { proposalSha: "s2" } });
  assert.equal(d2.proposalSha, "s2");
  assert.equal(draftBasis(d2, { status: "APPROVED_INTERNAL" }, [v2ok]).ok, true);
  assert.match(draftBasis(d2, { status: "PROPOSAL_DRAFT" }, [v2ok, { id: "p3", version: 3, status: "DRAFT", contentSha: "s3" }]).reason, /Propunerea s-a schimbat după ciornă/);
  assert.equal(draftBasis(d2, { status: "LOST" }, [v2ok]).ok, false);

  // IN_DISCUSSION by hand, and the acceptance, need a real contact event.
  assert.ok(!oppManualTargets("ON_HOLD", { realContact: false }).includes("IN_DISCUSSION"));
  assert.ok(oppManualTargets("ON_HOLD", { realContact: true }).includes("IN_DISCUSSION"));
  assert.ok(!oppManualTargets("CONTACTED", { realContact: false }).includes("IN_DISCUSSION"));
  assert.match(acceptanceReadiness({ status: "IN_DISCUSSION" }, [v2ok], [{ kind: "REPLY_RECORDED" }]).reason, /contact real/);
  assert.equal(acceptanceReadiness({ status: "IN_DISCUSSION" }, [v2ok], manual).ok, true);

  assert.equal(hasRealContact(manual), true);
  assert.equal(hasRealContact([{ kind: "REPLY_RECORDED" }]), false);
  assert.deepEqual(followupPayload({ basis: "last_contact", afterDays: "3" }, { contactEvents: manual }), { ok: true, body: { basis: "last_contact", afterDays: 3 } });
  assert.match(followupPayload({ basis: "last_contact", afterDays: 3 }, { contactEvents: [] }).reason, /contact real/);
  assert.equal(followupPayload({ basis: "last_contact", afterDays: 91 }, { contactEvents: manual }).ok, false, "1..90 days");
  assert.equal(followupPayload({ basis: "last_contact", afterDays: 2.5 }, { contactEvents: manual }).ok, false);
  assert.deepEqual(followupPayload({ basis: "explicit_date", dueAt: "2026-10-05T09:00:00.000Z" }), { ok: true, body: { basis: "explicit_date", dueAt: "2026-10-05T09:00:00.000Z" } });
  assert.equal(followupPayload({ basis: "explicit_date", dueAt: "" }).ok, false);
  assert.equal(followupPayload({ basis: "manual" }).ok, false);
  assert.equal(followupDraftable({ status: "DUE" }), true);
  assert.equal(followupDraftable({ status: "DUE", draftId: "sdr_1" }), false, "one draft per follow-up");
  assert.equal(followupDraftable({ status: "DONE" }), false);

  // Manual moves mirror the server's tables; event-only states are never offered.
  assert.deepEqual(oppManualTargets("PROPOSAL_DRAFT"), ["READY_FOR_OWNER_REVIEW", "ON_HOLD", "LOST"]);
  for (const s of OPP_STATUSES) for (const t of oppManualTargets(s)) assert.ok(!["APPROVED_INTERNAL", "CONTACTED", "WON"].includes(t), `${s} → ${t}`);
  assert.deepEqual(orgManualTargets("OPPORTUNITY"), ["ON_HOLD", "DISQUALIFIED"]);
  assert.deepEqual(orgManualTargets("DISQUALIFIED"), ["NEEDS_RESEARCH"]);
});

test("M04-UI-11 approvals, events and routes", () => {
  assert.deepEqual(approvalFrom({ approvalRequired: true, approval: { id: "apr_1" }, commandId: "cmd_1" }), { approval: { id: "apr_1" }, commandId: "cmd_1" });
  assert.equal(approvalFrom({ approvalRequired: false }), null);
  assert.equal(approvalFrom({ id: "x" }), null);
  assert.equal(isSalesEvent({ type: "sales.org.updated" }), true);
  assert.equal(isSalesEvent({ type: "command.executed", payload: { type: "sales.import.confirm" } }), true);
  assert.equal(isSalesEvent({ type: "command.executed", payload: { type: "mission.create" } }), false);
  assert.equal(isSalesEvent({ type: "approval.decided" }), true);
  assert.equal(isSalesEvent({ type: "run.activity" }), false);
  assert.equal(isSalesEvent(null), false);

  assert.deepEqual(salesRoute({}), { tab: "overview", id: "" });
  assert.deepEqual(salesRoute({ tab: "org" }), { tab: "orgs", id: "" }, "a sheet without an id falls back to the list");
  assert.deepEqual(salesRoute({ tab: "opp", id: "opp_1" }), { tab: "opp", id: "opp_1" });
  assert.deepEqual(salesRoute({ tab: "pipeline", id: "x" }), { tab: "pipeline", id: "" });
  assert.deepEqual(salesRoute({ tab: "<script>" }), { tab: "overview", id: "" });
  assert.deepEqual(salesRoute({}, { defaultTab: "orgs" }), { tab: "orgs", id: "" }, "phones open on search");
  assert.deepEqual(MOBILE_TAB_ORDER.slice(0, 3), ["orgs", "org", "opp"], "search, sheet and draft review first on a phone");
  assert.deepEqual([...MOBILE_TAB_ORDER].sort(), SALES_TABS.map(([id]) => id).sort(), "every tab is placed on mobile");
  assert.equal(salesHref("org", { id: "org 1", empty: "" }), "/sales?tab=org&id=org+1");
  assert.equal(salesHref("orgs", { needsReview: true }), "/sales?tab=orgs&needsReview=1");
});

test("M04-UI-12 Sales UI source: no HTML injection, send never wired, nav and lazy screen registered, CSS imported", () => {
  const dir = path.join(V2, "web/src/screens/sales");
  const files = ["web/src/screens/Sales.jsx", ...fs.readdirSync(dir).filter((f) => f.endsWith(".jsx")).map((f) => `web/src/screens/sales/${f}`)];
  assert.ok(files.length >= 6, "the Sales sub-views exist");
  for (const f of files) {
    const text = source(f);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML/, `${f} never injects HTML`);
    assert.doesNotMatch(text, /\/send["`]/, `${f} never calls the send endpoint (OUTREACH_DISABLED)`);
    assert.doesNotMatch(text, /localhost|127\.0\.0\.1|https?:\/\/(?!.*\.test)/, `${f} has no hard-coded origins`);
  }
  assert.match(source("web/src/screens/Sales.jsx"), /import "\.\.\/styles\/m04\.css"/);
  assert.match(source("web/src/nav.js"), /id: "sales", label: "Vânzări", long: "Vânzări & lead-uri"/);
  assert.match(source("web/src/main.jsx"), /sales: lazy\(\(\) => import\("\.\/screens\/Sales\.jsx"\)\)/);
  const opp = source("web/src/screens/sales/Opportunity.jsx");
  assert.match(opp, /OUTREACH_DISABLED_REASON/);
  assert.match(opp, /disabled[^>]*aria-describedby/, "the Send button is rendered disabled with its reason");
});
