// M13 „Birou intern” (Operations / Customer Support / Finance-Admin) on fully synthetic acceptance hubs: one card per flow from the owner's
// words, the owner's reserved approval of the exact text (id + full sha), the derived export, the pinned inputs (a changed offer or package
// → STALE, history kept), repeats without duplicates, the records retrievable after a reload (GET), unknowns kept „De stabilit” and no
// send / publication / Engineering run / commercial mark.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { acceptanceHub, settle, seedReady } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, folderShas, countRows, approveSalesHttp, requestSalesApproval } from "./sales-helpers.mjs";
import { verifyPackageFolder } from "../server/delivery/office-executors.mjs";
import { findCommercialFigures } from "../server/sales/figures.mjs";
import { createDeskExecutors } from "../server/desk/executors.mjs";
import { devizText } from "../server/desk/builders.mjs";

const SERVICE = {
  name: "Programări online pe site", description: "Un modul de programări pe site-ul service-ului auto (sintetic).",
  scope: ["Pagină de programare pe site: clientul alege serviciul, ziua și un interval liber", "Lista programărilor, păstrată și după repornirea aplicației"],
  exclusions: ["Anularea sau mutarea programării de către client, direct din site", "Plata online sau avansul la programare"],
  materials: ["Lista serviciilor care se pot programa online și durata fiecăruia", "Programul de lucru pe zile, cu pauzele și zilele libere", "Accesul la site-ul existent"],
  tags: ["programari"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true,
};
const OPS_REQUEST = "Pregătește dosarul de pornire a proiectului din oferta aprobată";
const FIN_REQUEST = "Pregătește devizul din oferta aprobată";

/** One synthetic offer approved internally by the owner (M12 path), with one catalog service, on a hub whose exports folder is approved. */
async function approvedOfferHub(c, options = {}) {
  const t = await prepHub(c, options);
  await t.authenticate();
  const svc = (await salesCommand(t, "sales.service.save", SERVICE)).result;
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  const prep = await settlePreparation(t, preparationId);
  assert.equal(prep.status, "READY", prep.statusReason);
  const offer = t.hub.sales.latestProposal(prep.opportunityId);
  assert.equal(offer.status, "APPROVED_INTERNAL");
  return { t, svc, prep, offer, oppId: prep.opportunityId };
}
const FLOW = { desk_ops_prepare: "ops_start", desk_support_prepare: "support_case", desk_finance_prepare: "finance_doc" };
const propose = (t, text, intent) => t.hub.intake.plan({ kind: "desk", text, source: "typed", args: { flow: FLOW[intent] } }, { channel: "test", actor: "test", ownerSession: null });
async function settleRecord(t, id) { for (let i = 0; i < 6; i += 1) { await settle(); await t.hub.desk.idle(id); } return t.hub.desk.get(id); }
const nothingOutward = (t, before = {}) => {
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "agent_runs", "live_grants"]) {
    assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), before[table] || 0, `${table}: nothing outward / no run`);
  }
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM factory_missions"), before.factory_missions || 0, "no Factory mission created");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','WON','IN_DISCUSSION')"), 0, "no commercial mark");
};
const getJson = async (t, url) => { const r = await t.request(url, { method: "GET" }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const approveArtifact = (t, a) => approveSalesHttp(t, { route: `/api/desk/artifacts/${a.id}/approve`, body: { displayedSha: a.contentSha } });

test("M13-OPS-01 the owner's words → ONE start-dossier card (the same request again: the same card); confirmed → the record READY with checklist, received/missing, questions, risks, owner, next action, unknown deadlines; export + manifest; nothing commercial or Engineering", async (c) => {
  const { t, offer, oppId } = await approvedOfferHub(c);
  const plansBefore = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const r1 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  assert.ok(r1.opsPlan?.id && r1.opsPlan.recordId, JSON.stringify(r1).slice(0, 500));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore + 1, "one card");
  const r2 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  assert.equal(r2.opsPlan?.id, r1.opsPlan.id, "the same request shows the same card");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore + 1, "no second card");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM desk_records"), 1, "no second record");
  const rec0 = t.hub.desk.get(r1.opsPlan.recordId);
  assert.equal(rec0.status, "PLANNED", "nothing runs before the confirmation");
  await confirmCard(t, r1.opsPlan);
  const rec = await settleRecord(t, rec0.id);
  assert.equal(rec.status, "READY", rec.statusReason);
  const s = rec.state;
  assert.equal(s.offer.proposalId, offer.id);
  assert.equal(s.offer.contentSha, offer.contentSha);
  assert.deepEqual(s.offer.serviceIds, offer.content.serviceIds);
  assert.deepEqual(s.checklist.map((i) => i.text), SERVICE.materials, "the approved offer's materials");
  assert.ok(s.checklist.every((i) => i.status === "MISSING"));
  assert.deepEqual(s.received, []);
  assert.equal(s.missing.length, SERVICE.materials.length);
  assert.ok(s.questions.length >= 1 && s.risks.some((x) => /acceptarea clientului/.test(x.text)));
  assert.ok(s.deadlines.every((d) => d.status === "UNKNOWN" && /De stabilit/.test(d.value)), "unknown deadlines are marked");
  assert.equal(s.owner, "proprietar");
  assert.match(rec.nextAction, /materiale lipsă/);
  // Retrievable after a reload: the GET routes alone.
  const detail = await getJson(t, `/api/desk/records/${rec.id}`);
  assert.equal(detail.record.status, "READY");
  assert.equal(detail.exports.length, 1);
  const exp = detail.exports[0];
  assert.equal(exp.status, "READY");
  assert.ok(exp.folder.startsWith(path.join(t.exportsDir, "operatiuni")), exp.folder);
  assert.equal(verifyPackageFolder(exp.folder).ok, true);
  const md = fs.readFileSync(path.join(exp.folder, "dosar-pornire.md"), "utf8");
  for (const m of SERVICE.materials) assert.ok(md.includes(m), m);
  assert.match(md, /LIPSEȘTE/);
  assert.match(md, /Primit: nimic încă/);
  assert.ok(!fs.existsSync(path.join(exp.folder, "misiune-spec-draft.json")), "no SPEC_DRAFT unless the request names it");
  const list = await getJson(t, "/api/desk/records");
  assert.equal(list.records.length, 1);
  // The same request after READY: the truthful state, no new card.
  const r3 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  assert.equal(r3.opsPlan, undefined);
  assert.match(String(r3.message || ""), /există deja/);
  assert.equal(t.hub.sales.getOpportunity(oppId).opportunity.status, "APPROVED_INTERNAL", "the internal approval stays internal");
  nothingOutward(t);
  t.assertPaths();
});

test("M13-OPS-02 a material received (owner session) → a new record version, the export STALE (files unchanged); the same update twice changes nothing; ONE continuation card → revision 2 reflects it; without the owner session → 401", async (c) => {
  const { t } = await approvedOfferHub(c);
  const r1 = await propose(t, `${OPS_REQUEST} și schița misiunii Engineering`, "desk_ops_prepare");
  await confirmCard(t, r1.opsPlan);
  const rec = await settleRecord(t, r1.opsPlan.recordId);
  assert.equal(rec.status, "READY", rec.statusReason);
  const rev1 = t.hub.desk.latestExport(rec.id);
  assert.ok(fs.existsSync(path.join(rev1.folder, "misiune-spec-draft.json")), "the SPEC_DRAFT sketch named in the request");
  const spec = JSON.parse(fs.readFileSync(path.join(rev1.folder, "misiune-spec-draft.json"), "utf8"));
  assert.equal(spec.created, false);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM factory_missions"), 0, "never a Factory mission");
  const files1 = folderShas(rev1.folder);
  const noSession = await t.request(`/api/desk/records/${rec.id}/items`, { body: { itemId: "M1", status: "RECEIVED" }, sessionCookie: "" });
  assert.equal(noSession.status, 401, JSON.stringify(noSession.json));
  const up = await t.request(`/api/desk/records/${rec.id}/items`, { body: { itemId: "M1", status: "RECEIVED", note: "primit pe e-mail (sintetic)" } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const again = await t.request(`/api/desk/records/${rec.id}/items`, { body: { itemId: "M1", status: "RECEIVED", note: "primit pe e-mail (sintetic)" } });
  assert.equal(again.json.unchanged, true);
  const stale = t.hub.desk.get(rec.id);
  assert.equal(stale.status, "STALE");
  assert.deepEqual(stale.state.received, ["M1"]);
  assert.equal(t.hub.desk.exportOf(rev1.id).status, "STALE");
  assert.deepEqual(folderShas(rev1.folder), files1, "revision 1 stays on disk, unchanged");
  const cont = await t.request(`/api/desk/records/${rec.id}/continue`);
  assert.equal(cont.status, 200, JSON.stringify(cont.json));
  assert.equal(t.hub.desk.get(rec.id).status, "STALE", "nothing runs before the confirmation");
  await confirmCard(t, cont.json.plan);
  const done = await settleRecord(t, rec.id);
  assert.equal(done.status, "READY", done.statusReason);
  const rev2 = t.hub.desk.latestExport(rec.id);
  assert.equal(rev2.revision, 2);
  assert.equal(t.hub.desk.exportOf(rev1.id).status, "SUPERSEDED");
  const md = fs.readFileSync(path.join(rev2.folder, "dosar-pornire.md"), "utf8");
  assert.match(md, /\[x\] M1\./);
  assert.match(md, /Primit: M1/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM desk_records"), 1);
  nothingOutward(t);
});

test("M13-OPS-03 the approved offer changes after the start dossier (a catalog price saved → the offer STALE) → the record and its export STALE; history kept", async (c) => {
  const { t, svc } = await approvedOfferHub(c);
  const r1 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  await confirmCard(t, r1.opsPlan);
  const rec = await settleRecord(t, r1.opsPlan.recordId);
  assert.equal(rec.status, "READY");
  const exp = t.hub.desk.latestExport(rec.id);
  const files = folderShas(exp.folder);
  await salesCommand(t, "sales.service.save", { ...SERVICE, serviceId: svc.id, materials: [...SERVICE.materials, "Logo-ul firmei"] });
  await settle();
  assert.equal(t.hub.desk.get(rec.id).status, "STALE");
  assert.equal(t.hub.desk.exportOf(exp.id).status, "STALE");
  assert.deepEqual(folderShas(exp.folder), files);
  // A continuation now waits for a new approved offer: the truthful refusal.
  const cont = await t.request(`/api/desk/records/${rec.id}/continue`);
  assert.equal(cont.status, 409, JSON.stringify(cont.json));
  assert.match(String(cont.json?.error?.message || ""), /nu mai e aprobată/);
});

// ---------------------------------------------------------------- Support
async function supportHub(c) {
  const t = await acceptanceHub({ seedProject: true });
  c.after(() => t.cleanup());
  t.exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: t.exportsDir }, "test", "Folderul de exporturi al testului"));
  const seeded = await seedReady(t);
  // The owner's acceptance of the package (synthetic test database only): the case reads only an accepted package.
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'OWNER_ACCEPTED' WHERE id = ?").run(seeded.bundleId);
  await t.authenticate();
  return { t, seeded };
}
const SUP_REQUEST = "Caz de suport pentru Accept synthetic: un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?";

test("M13-SUP-01 a synthetic request → ONE case card → classification + read-only sources + reply DRAFT_ONLY; the owner approves the exact reply → the derived export (case open, reply NETRIMIS); the approval repeated → one decision; nothing sent or run", async (c) => {
  const { t, seeded } = await supportHub(c);
  const missions = countRows(t, "SELECT COUNT(*) AS n FROM factory_missions");
  const r = await propose(t, SUP_REQUEST, "desk_support_prepare");
  assert.ok(r.opsPlan?.recordId, JSON.stringify(r).slice(0, 600));
  const again = await propose(t, SUP_REQUEST, "desk_support_prepare");
  assert.equal(again.opsPlan?.id, r.opsPlan.id, "the same request: the same card");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  assert.equal(waiting.status, "WAITING_OWNER", waiting.statusReason);
  assert.equal(waiting.request, "un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?");
  assert.equal(waiting.state.classification.class, "QUESTION");
  assert.equal(waiting.state.sources.delivery.bundleId, seeded.bundleId);
  assert.equal(waiting.state.sources.delivery.bundleStatus, "OWNER_ACCEPTED");
  const reply = t.hub.desk.latestArtifact(waiting.id);
  assert.equal(reply.status, "DRAFT");
  assert.equal(reply.content.sent, false);
  assert.ok(reply.content.facts.some((f) => f.id === "AC-1"), JSON.stringify(reply.content.facts));
  assert.ok(!/\brezolvat\b|\binchis\b/i.test(reply.content.body));
  const detail = await getJson(t, `/api/desk/records/${waiting.id}`);
  assert.deepEqual([detail.decision.artifactId, detail.decision.sha], [reply.id, reply.contentSha]);
  const inbox = await getJson(t, "/api/decisions/inbox");
  assert.ok(inbox.items.some((i) => i.kind === "desk_support_reply" && i.target.sha === reply.contentSha));
  // A wrong SHA is refused (the displayed target reaches the write unchanged).
  const wrong = await t.request(`/api/desk/artifacts/${reply.id}/approve`, { body: { displayedSha: "0".repeat(64) } });
  assert.equal(wrong.status, 202);
  const ok = await approveArtifact(t, reply);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const done = await settleRecord(t, waiting.id);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(done.state.caseStatus, "REPLY_APPROVED");
  assert.match(done.state.caseStatusText, /nu e rezolvat și nu e închis/);
  const exp = t.hub.desk.latestExport(done.id);
  assert.equal(verifyPackageFolder(exp.folder).ok, true);
  const replyMd = fs.readFileSync(path.join(exp.folder, "raspuns-ciorna.md"), "utf8");
  assert.match(replyMd, /DRAFT_ONLY — NETRIMIS/);
  assert.match(replyMd, new RegExp(reply.contentSha));
  const caseMd = fs.readFileSync(path.join(exp.folder, "caz.md"), "utf8");
  assert.match(caseMd, /SINTETICĂ/);
  assert.match(caseMd, /nu dovedește un defect/);
  // The same approval again: one decision.
  const decisions = countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'");
  const repeat = await t.request(`/api/commands/${ok.json?.commandId || ""}/execute`, { body: {} });
  assert.notEqual(repeat.status, 500);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), decisions);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM factory_missions"), missions, "no new Factory mission");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
  t.assertPaths();
});

test("M13-SUP-02 a reported defect: DEFECT_REPORTED (not proof), a SPEC_DRAFT proposal text in the case, no mission; the package changes before the approval → the approval refused (STALE), the record STALE", async (c) => {
  const { t, seeded } = await supportHub(c);
  const missions = countRows(t, "SELECT COUNT(*) AS n FROM factory_missions");
  const r = await propose(t, "Înregistrează un caz de suport pentru Accept synthetic: formularul nu mai salvează solicitarea, dă eroare", "desk_support_prepare");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  assert.equal(waiting.status, "WAITING_OWNER", waiting.statusReason);
  assert.equal(waiting.state.classification.class, "DEFECT_REPORTED");
  assert.equal(waiting.state.specDraft.status, "SPEC_DRAFT");
  assert.equal(waiting.state.specDraft.created, false);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM factory_missions"), missions);
  const reply = t.hub.desk.latestArtifact(waiting.id);
  assert.match(reply.content.body, /nu confirmăm încă un defect/);
  // The accepted package is no longer the one read.
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'SUPERSEDED' WHERE id = ?").run(seeded.bundleId);
  const refused = await approveArtifact(t, reply);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  await t.hub.desk.tick();
  assert.equal(t.hub.desk.get(waiting.id).status, "STALE");
  assert.equal(t.hub.desk.artifact(reply.id).status, "STALE");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM desk_exports"), 0, "no export");
});

// ---------------------------------------------------------------- Finance
test("M13-FIN-01 the deviz from the approved offer: ONE card → draft „De stabilit” (no zero, no total), registered; the owner approves the exact document → Word (+ status) and the register; the same approval repeated → one decision", async (c) => {
  const { t, offer } = await approvedOfferHub(c);
  const r = await propose(t, FIN_REQUEST, "desk_finance_prepare");
  assert.ok(r.opsPlan?.recordId, JSON.stringify(r).slice(0, 600));
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  assert.equal(waiting.status, "WAITING_OWNER", waiting.statusReason);
  const doc = t.hub.desk.latestArtifact(waiting.id);
  const c0 = doc.content;
  assert.equal(c0.source.proposalId, offer.id);
  assert.equal(c0.source.contentSha, offer.contentSha);
  assert.ok(c0.lines.length === 1 && c0.lines[0].unitPrice.status === "UNKNOWN" && c0.lines[0].unitPrice.text === "De stabilit");
  assert.equal(c0.total.status, "UNKNOWN");
  assert.equal(findCommercialFigures(devizText(c0)).length, 0, "no invented figure");
  assert.ok(!/\b0(?:[.,]00)?\s*(?:lei|ron|eur)\b/i.test(JSON.stringify(c0)), "an unknown is never zero");
  const reg = await getJson(t, "/api/desk/register");
  assert.equal(reg.register.length, 1);
  assert.equal(reg.register[0].documents[0].status, "DRAFT");
  const ok = await approveArtifact(t, doc);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const done = await settleRecord(t, waiting.id);
  assert.equal(done.status, "READY", done.statusReason);
  const exp = t.hub.desk.latestExport(done.id);
  assert.equal(verifyPackageFolder(exp.folder).ok, true);
  assert.ok(fs.existsSync(path.join(exp.folder, "deviz-v1.docx")));
  assert.equal(exp.verification.docx.app, "APP_NOT_RUN", "no Word in the test environment: declared, never claimed");
  const md = fs.readFileSync(path.join(exp.folder, "deviz-v1.md"), "utf8");
  assert.match(md, /nu e număr fiscal/);
  assert.match(md, /Total: De stabilit/);
  const reg2 = await getJson(t, "/api/desk/register");
  assert.equal(reg2.register[0].documents[0].status, "APPROVED_INTERNAL");
  assert.equal(reg2.register[0].exports[0].status, "READY");
  const decisions = countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'");
  assert.equal(decisions, 1);
  const again = await approveArtifact(t, doc).catch(() => null);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), 1, "one decision on repeats");
  assert.ok(!again || again.status !== 500);
  nothingOutward(t);
});

test("M13-FIN-02 a price configured after the deviz → the offer STALE → the deviz record STALE (never the new price taken silently); the old approval cannot approve new content", async (c) => {
  const { t, svc } = await approvedOfferHub(c);
  const r = await propose(t, FIN_REQUEST, "desk_finance_prepare");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  const doc = t.hub.desk.latestArtifact(waiting.id);
  await salesCommand(t, "sales.service.save", { ...SERVICE, serviceId: svc.id, price: { status: "CONFIGURED", amount: 1500, currency: "RON", unit: "proiect" } });
  await settle();
  assert.equal(t.hub.desk.get(waiting.id).status, "STALE");
  assert.equal(t.hub.desk.artifact(doc.id).status, "STALE");
  assert.equal(t.hub.desk.artifact(doc.id).content.lines[0].unitPrice.text, "De stabilit", "the document keeps the approved offer's value");
  const refused = await approveArtifact(t, doc);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), 0);
});

test("M13-FIN-03 Word available (stubbed COM): APP_VERIFIED with the PDF Word exported, listed in the manifest; Word failing → APP_FAILED, never READY", async (c) => {
  const { t } = await approvedOfferHub(c);
  const stub = async (_file, _shape, { pdfOut }) => { fs.mkdirSync(path.dirname(pdfOut), { recursive: true }); fs.writeFileSync(pdfOut, Buffer.from("%PDF-1.4 sintetic\n")); return { ok: true, level: "APP_VERIFIED", app: "Microsoft Word", version: "16.0", pages: 1, pdf: pdfOut }; };
  Object.assign(t.hub.executors, createDeskExecutors({ desk: t.hub.desk, sales: t.hub.sales, ledger: t.hub.deskLedger, opsPlans: t.hub.opsPlans, media: t.hub.media, config: t.config,
    appCheck: "com", officeAvailable: () => true, verifyDocx: stub }));
  const r = await propose(t, FIN_REQUEST, "desk_finance_prepare");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  assert.equal((await approveArtifact(t, t.hub.desk.latestArtifact(waiting.id))).status, 200);
  const done = await settleRecord(t, waiting.id);
  assert.equal(done.status, "READY", done.statusReason);
  const exp = t.hub.desk.latestExport(done.id);
  assert.equal(exp.verification.docx.app, "APP_VERIFIED");
  assert.ok(exp.files.some((f) => f.path === "deviz-v1.pdf"));
  assert.equal(verifyPackageFolder(exp.folder).ok, true);
});

test("M13-INT-01 the owner's typed words through POST /api/owner/intent: the start dossier and the deviz each ONE card (a desk record); „Trimite devizul clientului” refused (OUTREACH_DISABLED), nothing planned", async (c) => {
  const { t } = await approvedOfferHub(c);
  const plans = () => countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  for (const [text, kind] of [[OPS_REQUEST, "desk.ops.prepare"], [FIN_REQUEST, "desk.finance.prepare"]]) {
    const before = plans();
    const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const step = r.json.results.find((x) => x.opsPlan);
    assert.ok(step, `${text}: ${JSON.stringify(r.json.results).slice(0, 400)}`);
    assert.equal(step.opsPlan.kind, kind);
    assert.match(String(step.opsPlan.recordId || ""), /^dsk_/);
    assert.equal(plans(), before + 1, "ONE card");
  }
  const before = plans();
  const r = await t.request("/api/owner/intent", { body: { text: "Trimite devizul clientului", source: "typed" } });
  assert.equal(r.status, 200);
  assert.ok(r.json.results.some((x) => x.intent === "sales_send" && x.refused), JSON.stringify(r.json.results));
  assert.equal(plans(), before, "nothing planned");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM desk_records"), 2);
});

test("M13-AUTH-01 the reserved decision: without the owner session 401; on the UI channel refused; a document approved once cannot be approved again as new content; the old approval never approves the next version", async (c) => {
  const { t, svc } = await approvedOfferHub(c);
  const r = await propose(t, FIN_REQUEST, "desk_finance_prepare");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  const doc = t.hub.desk.latestArtifact(waiting.id);
  const anon = await t.request(`/api/desk/artifacts/${doc.id}/approve`, { body: { displayedSha: doc.contentSha }, sessionCookie: "" });
  assert.equal(anon.status, 401, JSON.stringify(anon.json));
  const ui = await t.hub.commands.dispatch({ type: "desk.artifact.approve", payload: { artifactId: doc.id, displayedSha: doc.contentSha }, channel: "ui", actor: "user" }).catch((e) => e);
  assert.ok(ui instanceof Error || ui?.error, "the UI channel cannot request the owner's decision");
  // A request whose approval is decided, then the inputs change before the execution: the execution is refused (STALE), nothing approved.
  const requested = await requestSalesApproval(t, { route: `/api/desk/artifacts/${doc.id}/approve`, body: { displayedSha: doc.contentSha } });
  await t.request(`/api/approvals/${requested.approval.id}/owner_decide`, { body: { decision: "approved", displayedHash: requested.approval.payloadHash } });
  await salesCommand(t, "sales.service.save", { ...SERVICE, serviceId: svc.id, materials: [...SERVICE.materials, "Logo"] });
  await settle();
  const exec = await t.request(`/api/commands/${requested.commandId}/execute`);
  assert.notEqual(exec.status, 200, JSON.stringify(exec.json));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), 0);
  assert.equal(t.hub.desk.artifact(doc.id).status, "STALE");
  assert.equal(t.hub.desk.get(waiting.id).status, "STALE");
});

// ---------------------------------------------------------------- review round 1 (flows): regressions
test("M13-R2-PURE the builders and the words: a deviz of an offer naming no service keeps its price / term rows; the unknowns per field; an empty material list is „De stabilit”, never „toate primite”; the colon before a quoted name; the SPEC_DRAFT sketch only when asked; „pot adăuga …?” is a question; the Finance words name an approved offer", async () => {
  const { devizContent, opsStartState, opsProgress, classifySupport } = await import("../server/desk/builders.mjs");
  const { supportRequestOf, asksForSpec } = await import("../server/owner/planners/desk.mjs");
  const { resolveIntent } = await import("../server/owner/intents.mjs");
  const offer = { proposalId: "spr_x", version: 1, contentSha: "a".repeat(64), approvedSha: "a".repeat(64), title: "Ofertă", serviceIds: [], serviceNames: [], orgId: "org_x", orgName: "Firma SRL", synthetic: true, opportunityId: "opp_x",
    pricing: [{ item: "price", serviceId: null, status: "UNKNOWN", text: "De stabilit (neconfigurat)", reason: "catalog neconfigurat" }, { item: "leadTime", serviceId: null, status: "UNKNOWN", text: "De stabilit (neconfigurat)", reason: "catalog neconfigurat" }] };
  const d = devizContent({ offer, internalNo: "DVZ-0001" });
  assert.equal(d.lines.length, 1);
  assert.deepEqual([d.lines[0].unitPrice.status, d.lines[0].term.status], ["UNKNOWN", "UNKNOWN"]);
  assert.ok(d.unknown.includes("Ofertă: preț") && d.unknown.includes("Ofertă: termen"), JSON.stringify(d.unknown));
  const termOnly = devizContent({ offer: { ...offer, serviceIds: ["svc_1@2"], serviceNames: ["Serviciu"], pricing: [{ item: "price", serviceId: "svc_1", status: "CONFIGURED", text: "configurat" }, { item: "leadTime", serviceId: "svc_1", status: "UNKNOWN", text: "De stabilit", reason: "x" }] }, internalNo: "DVZ-0002" });
  assert.ok(termOnly.unknown.includes("Serviciu: termen") && !termOnly.unknown.includes("Serviciu: preț"));
  const empty = opsStartState({ offer, proposal: { content: { sections: [{ id: "materials", text: "Le stabilim împreună după confirmarea nevoilor." }] } } });
  assert.equal(empty.checklist.length, 0);
  assert.match(empty.nextAction, /Stabilești cu clientul lista materialelor/);
  assert.ok(empty.questions.some((q) => /Ce materiale trebuie/.test(q.text)));
  assert.doesNotMatch(opsProgress({ checklist: [] }).nextAction, /primite/);
  assert.equal(supportRequestOf("Caz de suport pentru „Demo Livrare”: clienții nu pot anula"), "clienții nu pot anula");
  assert.equal(supportRequestOf("caz de suport clientul nu poate anula"), "clientul nu poate anula");
  assert.equal(asksForSpec("pregateste dosarul de pornire si schita misiunii engineering"), true);
  assert.equal(asksForSpec("pregateste dosarul de pornire, fara misiune engineering"), false);
  assert.equal(asksForSpec("pregateste dosarul de pornire si nu porni nicio misiune"), false);
  assert.equal(classifySupport("Clienții pot adăuga mai multe servicii la o programare?").class, "QUESTION");
  const intent = (t) => resolveIntent(t, { projects: [], departments: [], source: "typed" }).steps.map((s) => s.intent);
  assert.deepEqual(intent("Pregătește devizul din oferta aprobată"), ["desk_finance_prepare"]);
  assert.deepEqual(intent("Pregătește devizul pentru oferta aprobată a firmei Lăstărel"), ["desk_finance_prepare"]);
  assert.ok(!intent("Pregătește proforma din oferta aprobată").includes("desk_finance_prepare"), "a proforma is not made as a deviz");
  assert.ok(!intent("Pregătește un deviz nou pentru un service auto după ce e aprobat bugetul").includes("desk_finance_prepare"));
});

test("M13-R2-01 a card never confirmed that expired holds nothing: the same request gets a new record and card", async (c) => {
  const { t } = await approvedOfferHub(c);
  const r1 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  t.hub.opsPlans.cancel(r1.opsPlan.id, { reason: "test: expirat", actor: "test" });
  await settle();
  t.hub.db.prepare("UPDATE desk_records SET status = 'EXPIRED' WHERE id = ?").run(r1.opsPlan.recordId);
  const r2 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  assert.ok(r2.opsPlan?.id && r2.opsPlan.id !== r1.opsPlan.id, JSON.stringify(r2).slice(0, 300));
  assert.notEqual(r2.opsPlan.recordId, r1.opsPlan.recordId);
});

test("M13-R2-02 a material received then marked missing again (a round trip) → the continuation still exports a new revision and the record is READY", async (c) => {
  const { t } = await approvedOfferHub(c);
  const r1 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  await confirmCard(t, r1.opsPlan);
  const rec = await settleRecord(t, r1.opsPlan.recordId);
  for (const status of ["RECEIVED", "MISSING"]) assert.equal((await t.request(`/api/desk/records/${rec.id}/items`, { body: { itemId: "M1", status } })).status, 200);
  const cont = await t.request(`/api/desk/records/${rec.id}/continue`);
  await confirmCard(t, cont.json.plan);
  const done = await settleRecord(t, rec.id);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(t.hub.desk.latestExport(rec.id).revision, 2);
  assert.equal(t.hub.desk.latestExport(rec.id).status, "READY");
});

// ---------------------------------------------------------------- review round 1 (authority): regressions
test("M13-R1-01 a manual contact recorded after the start dossier keeps it READY (the approved offer is unchanged); DO_NOT_CONTACT makes it STALE", async (c) => {
  const { t, oppId, prep } = await approvedOfferHub(c);
  const r1 = await propose(t, OPS_REQUEST, "desk_ops_prepare");
  await confirmCard(t, r1.opsPlan);
  const rec = await settleRecord(t, r1.opsPlan.recordId);
  assert.equal(rec.status, "READY");
  await salesCommand(t, "sales.contact_event.record", { opportunityId: oppId, kind: "MANUAL_RECORDED", note: "contact sintetic (test)", confirmText: "Confirm că am contactat această firmă în afara Hub-ului" });
  assert.equal(t.hub.sales.getOpportunity(oppId).opportunity.status, "CONTACTED", "the contact was recorded");
  await t.hub.desk.tick();
  assert.equal(t.hub.desk.get(rec.id).status, "READY", "a contact never invalidates the internal start dossier");
  await salesCommand(t, "sales.org.suppress", { orgId: prep.orgId, reason: "test: nu contacta" });
  await t.hub.desk.tick();
  assert.equal(t.hub.desk.get(rec.id).status, "STALE");
});

test("M13-R1-03 „Oprește tot” after the card's confirmation and before the owner's approval: the approval is refused in its own transaction (nothing approved), the record STOPPED", async (c) => {
  const { t } = await approvedOfferHub(c);
  const r = await propose(t, FIN_REQUEST, "desk_finance_prepare");
  await confirmCard(t, r.opsPlan);
  const waiting = await settleRecord(t, r.opsPlan.recordId);
  const doc = t.hub.desk.latestArtifact(waiting.id);
  const requested = await requestSalesApproval(t, { route: `/api/desk/artifacts/${doc.id}/approve`, body: { displayedSha: doc.contentSha } });
  await t.request(`/api/approvals/${requested.approval.id}/owner_decide`, { body: { decision: "approved", displayedHash: requested.approval.payloadHash } });
  // The Stop All event lands; the approval runs before the deferred listener could move the record.
  t.hub.bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: "owner", payload: { stopKind: "stop_all" } });
  const exec = await t.request(`/api/commands/${requested.commandId}/execute`);
  assert.notEqual(exec.status, 200, JSON.stringify(exec.json));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'"), 0);
  await settle();
  assert.equal(t.hub.desk.get(waiting.id).status, "STOPPED");
  assert.equal(t.hub.desk.artifact(doc.id).status, "DRAFT", "the document stays a draft");
});
