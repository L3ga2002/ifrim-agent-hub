// M12 WP5 — C-03 / T-S2 part 2: three data kinds (FIXTURE, STATEMENT, INFERENCE) separate from the M04 confidence label, on an
// isolated synthetic hub (salesAcceptanceHub, in process). A declared kind must match its label; FIXTURE comes only from the fixture
// adapter or the synthetic generator; a STATEMENT has a real source; an INFERENCE names its basis and reasoning; confirming an
// inference is a new STATEMENT row with its own source (never a copy); the kind is never rewritten. Legacy calls stay unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { salesAcceptanceHub, seedSalesReview, salesCommand } from "./sales-helpers.mjs";
import { settle } from "./accept-helpers.mjs";
import { toCsv } from "../server/sales/tabular.mjs";
import { DATA_KINDS, DATA_KIND_LABELS, EVIDENCE_LABELS, SOURCE_KINDS } from "../server/sales/sales.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const run = async (t, type, payload) => (await salesCommand(t, type, payload)).result;
async function fixture(c) {
  const t = await salesAcceptanceHub(c, { listen: false });
  const b = await seedSalesReview(t);
  const importRow = t.hub.sales.getOrg(b.orgId).evidence.find((e) => e.label === "USER_PROVIDED");
  return { t, b, importRow };
}
const evidenceCount = (t) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_evidence").get().n;
const evidenceRow = (t, id) => t.hub.db.prepare("SELECT * FROM sales_evidence WHERE id = ?").get(id);
const add = (t, b, over) => run(t, "sales.evidence.add", { subjectType: "org", subjectId: b.orgId, claim: "programări online", value: "vrea programări online", label: "USER_PROVIDED",
  sourceKind: "manual", sourceRef: "brief:spp_m12prov#problem", ...over });
async function refused(t, promise, pattern) {
  const before = evidenceCount(t);
  await assert.rejects(promise, pattern);
  assert.equal(evidenceCount(t), before, "nothing written");
}

test("M12-PROV-01 the kind/label matrix: a declared kind accepts only its labels (an INFERENCE is only INFERRED; nothing else is INFERRED)", async (c) => {
  const { t, b, importRow } = await fixture(c);
  assert.deepEqual(DATA_KINDS, ["FIXTURE", "STATEMENT", "INFERENCE"]);
  assert.deepEqual(EVIDENCE_LABELS, ["USER_PROVIDED", "OBSERVED", "SOURCE_REPORTED", "INFERRED", "UNKNOWN"], "M04 labels unchanged");
  assert.deepEqual(SOURCE_KINDS, ["file", "url", "fixture", "manual"], "the public source enum is unchanged");
  for (const dataKind of ["STATEMENT", "INFERENCE"]) {
    for (const label of EVIDENCE_LABELS) {
      const extra = dataKind === "INFERENCE" ? { basis: [importRow.id], reasoning: "dedus din fișa importată" } : {};
      if (DATA_KIND_LABELS[dataKind].includes(label)) {
        const e = await add(t, b, { dataKind, label, ...extra });
        assert.equal(e.dataKind, dataKind); assert.equal(e.label, label);
        const row = evidenceRow(t, e.id);
        assert.equal(row.data_kind, dataKind);
        assert.deepEqual(JSON.parse(row.basis_json), extra.basis || []);
        assert.equal(row.reasoning, extra.reasoning || "");
      } else {
        await refused(t, add(t, b, { dataKind, label, ...extra }), /nu poate avea eticheta/);
      }
    }
  }
  for (const label of ["OBSERVED", "USER_PROVIDED"]) await refused(t, add(t, b, { dataKind: "INFERENCE", label, basis: [importRow.id], reasoning: "x" }), /INFERENCE nu poate avea eticheta/);
  await assert.rejects(add(t, b, { dataKind: "GUESS" }), /dataKind must be one of/);
  // The read model shows the kind; the org sheet carries it to the UI.
  const sheet = t.hub.sales.getOrg(b.orgId);
  assert.ok(sheet.evidence.some((e) => e.dataKind === "INFERENCE" && e.basis[0] === importRow.id && e.reasoning));
  assert.equal(sheet.evidence.find((e) => e.id === importRow.id).dataKind, null, "the import row (M04 path) stays undeclared");
});

test("M12-PROV-02 FIXTURE is never added by hand: only the fixture adapter and the synthetic generator produce it", async (c) => {
  const { t, b } = await fixture(c);
  for (const label of DATA_KIND_LABELS.FIXTURE) {
    for (const sourceKind of ["fixture", "manual"]) await refused(t, add(t, b, { dataKind: "FIXTURE", label, sourceKind }), /FIXTURE vin doar din adaptorul de fixture/);
  }
});

test("M12-PROV-03 an INFERENCE names its basis (existing evidence, brief fields or stored audit checks) and its reasoning", async (c) => {
  const { t, b, importRow } = await fixture(c);
  const inference = (over) => add(t, b, { claim: "oraș", value: "Cluj-Napoca", label: "INFERRED", dataKind: "INFERENCE", sourceRef: "brief:spp_m12prov#place", reasoning: "reședința județului Cluj", ...over });
  for (const basis of [undefined, [], ["http://x.test"], ["sev_nu_exista_123"], ["audit:sad_nu_exista#https"], ["brief:#place"], [" "]]) {
    await refused(t, inference({ basis }), /Inferența cere baza|Baza se dă|nu există/);
  }
  for (const reasoning of [undefined, "", "   "]) await refused(t, inference({ basis: [importRow.id], reasoning }), /raționamentul/);
  const fromBrief = await inference({ basis: ["brief:spp_m12prov#place"] });
  const fromEvidence = await inference({ basis: [importRow.id, "brief:spp_m12prov#place"] });
  assert.deepEqual(fromBrief.basis, ["brief:spp_m12prov#place"]);
  assert.deepEqual(fromEvidence.basis, [importRow.id, "brief:spp_m12prov#place"]);
  assert.equal(fromEvidence.reasoning, "reședința județului Cluj");
});

test("M12-PROV-04 T-S2: a manual row without a source, a fixture-sourced statement or a statement sourced in a Hub derivation is refused", async (c) => {
  const { t, b, importRow } = await fixture(c);
  for (const sourceRef of ["", "   "]) {
    await refused(t, add(t, b, { sourceRef }), /sourceRef is required|sursă/); // the M04 call (no kind)
    await refused(t, add(t, b, { sourceRef, dataKind: "STATEMENT" }), /sourceRef is required|sursă/);
  }
  await refused(t, add(t, b, { dataKind: "STATEMENT", sourceKind: "fixture" }), /sursa ei/);
  for (const sourceRef of ["rule:R-PLACE@1", `${importRow.id}`, "audit:sad_x#https", "inference: dedus"]) {
    await refused(t, add(t, b, { dataKind: "STATEMENT", sourceRef }), /sursa ei/);
  }
  const ok = await add(t, b, { dataKind: "STATEMENT", label: "SOURCE_REPORTED", sourceKind: "url", sourceRef: "https://registru-sintetic.test/firma" });
  assert.equal(ok.dataKind, "STATEMENT");
});

test("M12-PROV-05 confirming an inference is a NEW statement row with its own source; the inference stays an inference (never a copy)", async (c) => {
  const { t, b, importRow } = await fixture(c);
  const inf = await add(t, b, { claim: "employees", value: "12", label: "INFERRED", dataKind: "INFERENCE", sourceRef: "dedus din fișa sintetică", basis: [importRow.id], reasoning: "un singur sediu" });
  const infBefore = evidenceRow(t, inf.id);
  await refused(t, add(t, b, { claim: "employees", value: "12", dataKind: "STATEMENT", sourceRef: "dedus din fișa sintetică", basis: [inf.id] }), /nu devine afirmație prin copiere/);
  await refused(t, add(t, b, { claim: "employees", value: "12", dataKind: "STATEMENT", label: "UNKNOWN", sourceRef: "telefon cu proprietarul", basis: [inf.id] }), /Confirmarea unei inferențe/);
  const confirmed = await add(t, b, { claim: "employees", value: "12", dataKind: "STATEMENT", label: "USER_PROVIDED", sourceRef: "proprietarul, discuție sintetică 2026-10-17", basis: [inf.id] });
  assert.notEqual(confirmed.id, inf.id);
  assert.deepEqual(confirmed.basis, [inf.id]);
  assert.deepEqual(evidenceRow(t, inf.id), infBefore, "the inference row is byte-identical");
  const q = await run(t, "sales.org.qualify", { orgId: b.orgId, formula: "q-v2" });
  assert.ok(!q.result.inferences.some((i) => i.claim === "employees"), "a confirmed claim is no longer „de confirmat”");
  assert.ok(q.result.components.evidence.contributions.some((x) => x.evidenceIds.includes(confirmed.id)));
  assert.ok(!q.result.components.evidence.contributions.some((x) => x.evidenceIds.includes(inf.id)));
});

test("M12-PROV-06 the kind is immutable: no server module updates or deletes evidence rows", () => {
  const root = path.join(here, "..", "server");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".mjs") && /(?:UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+sales_evidence\b/i.test(fs.readFileSync(file, "utf8"))) offenders.push(path.relative(root, file));
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test("M12-PROV-07 the fixture adapter declares its rows: a check read on the page is FIXTURE, a check the audit deduced is an INFERENCE with its audit basis", async (c) => {
  const t = await salesAcceptanceHub(c, { listen: false });
  const csv = toCsv(["Denumire firmă", "Site web", "Localitate"], [["Atelierul Verde SRL", "https://atelierul-verde.test", "Cluj-Napoca"]], { delimiter: ";" });
  const batch = await run(t, "sales.import.create", { fileName: "m12-prov.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: true });
  await run(t, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run(t, "sales.import.preview", { batchId: batch.id });
  await run(t, "sales.import.confirm", { batchId: batch.id });
  const orgId = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE display_name = 'Atelierul Verde SRL'").get().id;
  const { auditId } = await run(t, "sales.org.audit", { orgId });
  await settle(); t.assertPaths();
  const rows = t.hub.db.prepare("SELECT * FROM sales_evidence WHERE subject_id = ? AND claim LIKE 'audit:%'").all(orgId);
  assert.ok(rows.length > 0);
  assert.ok(rows.some((r) => r.label === "OBSERVED") && rows.some((r) => r.label === "INFERRED"), "the fixture has both kinds of checks");
  for (const r of rows) {
    if (r.label === "OBSERVED") assert.deepEqual([r.data_kind, r.basis_json, r.reasoning], ["FIXTURE", "[]", ""], r.claim);
    else {
      assert.equal(r.data_kind, "INFERENCE", r.claim);
      assert.deepEqual(JSON.parse(r.basis_json), [`audit:${auditId}#${r.claim.slice("audit:".length)}`]);
      assert.ok(r.reasoning.length > 0);
    }
    assert.equal(r.synthetic, 1);
  }
  const imported = t.hub.db.prepare("SELECT data_kind FROM sales_evidence WHERE subject_id = ? AND claim NOT LIKE 'audit:%'").all(orgId);
  assert.ok(imported.length && imported.every((r) => r.data_kind === null), "the import path (M04) is unchanged");
});

test("M12-PROV-08 legacy calls are unchanged: no kind given → kind NULL, the event as before; the M09 Content → Sales link still records its evidence", async (c) => {
  const { t, b } = await fixture(c);
  const e = await add(t, b, {});
  assert.deepEqual([e.dataKind, e.basis, e.reasoning], [null, [], ""]);
  assert.deepEqual(Object.values(t.hub.db.prepare("SELECT data_kind, basis_json, reasoning FROM sales_evidence WHERE id = ?").get(e.id)), [null, null, null]);
  const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.evidence.added' ORDER BY seq DESC LIMIT 1").get();
  assert.deepEqual(Object.keys(JSON.parse(ev.payload_json)).sort(), ["evidenceId", "label"]);
  const linked = t.hub.sales.addEvidence("opportunity", b.oppId, { claim: "Legat de proiectul media", value: { contentProjectId: "cpr_x" }, label: "USER_PROVIDED", sourceKind: "manual", sourceRef: "content:cpr_x" }, "owner");
  assert.equal(linked.dataKind, null);
  const declared = await add(t, b, { dataKind: "STATEMENT" });
  const ev2 = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.evidence.added' ORDER BY seq DESC LIMIT 1").get();
  assert.deepEqual(JSON.parse(ev2.payload_json), { evidenceId: declared.id, label: "USER_PROVIDED", dataKind: "STATEMENT" });
});
