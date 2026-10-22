// M14 recovery after an interruption, on fully synthetic acceptance hubs: the Hub process ends with a Birou intern record READY (exported)
// and a deviz whose approval the owner has DECIDED but that has not executed yet; the next boot keeps the records, the exports, the decision
// and the states (nothing re-run, no event written by the boot), a read still answers, and the owner's decided approval then executes once
// (the derived export once; a repeat is the same decision). The owner's session survives the restart like his browser cookie does.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows, requestSalesApproval, decideSalesApproval } from "./sales-helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { SESSION_COOKIE } from "../server/owner/trust.mjs";

const FLOW = { desk_ops_prepare: "ops_start", desk_finance_prepare: "finance_doc" };
const propose = (h, text, intent) => h.intake.plan({ kind: "desk", text, source: "typed", args: { flow: FLOW[intent] } }, { channel: "test", actor: "test", ownerSession: null });
async function settleRecord(h, id) { for (let i = 0; i < 8; i += 1) { await settle(); await h.desk.idle(id); } return h.desk.get(id); }
/** The owner's session cookie the test client sends (read from one request; the token itself is never printed). */
async function ownerToken(t) {
  const original = http.request;
  let cookie = null;
  http.request = (options, ...rest) => { cookie = cookie || options?.headers?.Cookie || null; return original(options, ...rest); };
  try { await t.request("/api/owner/status", { method: "GET" }); } finally { http.request = original; }
  const m = String(cookie || "").match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

test("M14-REC-01 the Hub stops with a READY dossier and a decided-but-not-executed deviz approval: the next boot keeps records, exports, decision and states (no re-run, no event), a read answers, the decided approval executes once", { timeout: 240000 }, async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  await salesCommand(t, "sales.service.save", { name: "Programări online pe site", description: "Modul (sintetic).", scope: ["Pagină de programare"], exclusions: ["Plata online"],
    materials: ["Programul de lucru", "Lista serviciilor"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true });
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
  const ops = await propose(t.hub, "Pregătește dosarul de pornire a proiectului din oferta aprobată", "desk_ops_prepare");
  await confirmCard(t, ops.opsPlan);
  const opsRec = await settleRecord(t.hub, ops.opsPlan.recordId);
  assert.equal(opsRec.status, "READY", opsRec.statusReason);
  const fin = await propose(t.hub, "Pregătește devizul din oferta aprobată", "desk_finance_prepare");
  await confirmCard(t, fin.opsPlan);
  const finRec = await settleRecord(t.hub, fin.opsPlan.recordId);
  assert.equal(finRec.status, "WAITING_OWNER", finRec.statusReason);
  const doc = t.hub.desk.latestArtifact(finRec.id);
  // The owner decides the approval (the reserved decision) — the process ends before it executes.
  const requested = await requestSalesApproval(t, { route: `/api/desk/artifacts/${doc.id}/approve`, body: { displayedSha: doc.contentSha } });
  await decideSalesApproval(t, requested);
  const token = await ownerToken(t);
  assert.ok(token, "the owner's session cookie");
  const snapshot = (h) => ({
    records: h.db.prepare("SELECT id, status, version FROM desk_records ORDER BY id").all().map((r) => ({ ...r })),
    exports: h.db.prepare("SELECT id, status, manifest_sha256 FROM desk_exports ORDER BY id").all().map((r) => ({ ...r })),
    artifacts: h.db.prepare("SELECT id, status, content_sha FROM desk_artifacts ORDER BY id").all().map((r) => ({ ...r })),
    deskEvents: h.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'desk.%'").get().n,
    approval: h.db.prepare("SELECT status FROM approvals WHERE id = ?").get(requested.approval.id)?.status,
  });
  const before = snapshot(t.hub);
  assert.equal(before.approval, "approved");
  await t.hub.close();
  const again = createHub(t.config, { homeDir: t.homeDir });
  try {
    await again.boot();
    for (let i = 0; i < 6; i += 1) { await settle(); await again.desk.tick?.(); }
    assert.deepEqual(snapshot(again), before, "the boot keeps records, exports, documents, the decision and writes no desk event");
    assert.equal(again.desk.get(opsRec.id).status, "READY");
    assert.equal(again.desk.get(finRec.id).status, "WAITING_OWNER", "decided, not executed: still waiting, never approved by the boot");
    // A read after the restart answers from the same records.
    const read = again.deskAnswers.show({ internalNo: "DVZ-0001" });
    assert.match(read.message, /Devizul DVZ-0001 \(SINTETIC\): așteaptă decizia ta/);
    // The owner's decided approval executes once, in his (surviving) session.
    const session = again.trust.resolveSession(token, { origin: t.config.canonicalOrigin, touch: false });
    assert.ok(session, "the owner's session survives the restart");
    await again.commands.executeApproved(requested.commandId, `owner:${session.id}`, { ownerSession: session });
    for (let i = 0; i < 300 && again.desk.get(finRec.id).status !== "READY"; i += 1) { await settle(); await again.desk.idle(finRec.id); }
    assert.equal(again.desk.get(finRec.id).status, "READY", again.desk.get(finRec.id).statusReason);
    const approvals = () => again.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'desk.artifact.approved'").get().n;
    assert.equal(approvals(), 1);
    const exportsOf = () => again.db.prepare("SELECT COUNT(*) AS n FROM desk_exports WHERE record_id = ?").get(finRec.id).n;
    const exported = exportsOf();
    assert.equal(exported, 1, "the derived export once");
    await again.commands.executeApproved(requested.commandId, `owner:${session.id}`, { ownerSession: session }).catch(() => null);
    for (let i = 0; i < 6; i += 1) await settle();
    assert.deepEqual([approvals(), exportsOf()], [1, exported], "a repeat changes nothing");
    assert.equal(countRows({ hub: again }, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
  } finally { await again.close(); t.hub.close = async () => {}; }
});
