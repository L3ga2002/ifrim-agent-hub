// Coordinator-only Hub flows: the acceptance sandbox owns git, DB and fake provider files; no real model or external effect.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceHub, seedReady } from "./accept-helpers.mjs";
import { decisionsInbox } from "../server/delivery/inbox.mjs";
import { ACTIVE_STAGES } from "../server/factory/factory.mjs";
import { HUB_VERSION, API_CONTRACT } from "../server/config.mjs";

const count = (hub, table) => hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const counts = (hub) => Object.fromEntries(["agent_runs", "mission_envelopes", "ops_plans", "approvals"].map((table) => [table, count(hub, table)]));
const ask = (t, text, recap) => t.request("/api/owner/intent", { body: { text, ...(recap ? { recap } : {}) } });
const one = (r, intent) => { assert.equal(r.status, 200, JSON.stringify(r.json)); const out = r.json.results.find((r) => r.intent === intent); assert.ok(out, JSON.stringify(r.json)); return out; };
const get = (t, path, headers = {}) => t.request(path, { method: "GET", headers });
test("M16 Hub routes: exact chapters, all read adapters, channel refusals, no new work or approvals", { timeout: 120000 }, async (c) => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const seeded = await seedReady(t);
  const before = counts(t.hub); const r = await get(t, "/api/recap?period=today&projectId=echo"); assert.equal(r.status, 200, JSON.stringify(r.json));
  const snapshot = r.json; assert.equal(snapshot.chapters.length, 6); assert.ok(!Object.hasOwn(snapshot, "projectId")); assert.equal(snapshot.scope, "company");
  const value = (id) => snapshot.chapters.flatMap((c) => c.indicators).find((i) => i.id === id);
  assert.equal(value("waiting.decisions").value, decisionsInbox(t.hub).items.length);
  assert.equal(value("waiting.approvals").value, t.hub.approvals.list("pending").length);
  assert.equal(value("work.active").value, t.hub.factory.list().filter((f) => ACTIVE_STAGES.has(f.stage) && f.stage !== "CANCEL_REQUESTED").length);
  assert.equal(value("results.bundles_ready").value, t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_bundles WHERE status = 'READY_FOR_OWNER_ACCEPTANCE'").get().n);
  assert.equal(value("results.deliveries").value, t.hub.deliveries.list().filter((d) => ["READY", "NEEDS_OWNER"].includes(d.status)).length);
  assert.equal(value("sales.open").value, t.hub.db.prepare("SELECT COUNT(*) AS n FROM sales_opportunities WHERE status NOT IN ('WON','LOST')").get().n);
  assert.equal(value("sales.sent").state, "disabled");
  assert.equal(value("desk.active").value, t.hub.db.prepare("SELECT COUNT(*) AS n FROM desk_records WHERE status IN ('PREPARING','PACKAGING')").get().n);
  const paths = ["/api/recap", `/api/recap/${snapshot.id}`, "/api/company/graph", "/api/process-sheets", "/api/sales/funnel", `/api/factory/${seeded.missionId}/trace`, "/api/system/map"];
  for (const path of paths) {
    const r = await get(t, path); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json)}`);
    for (const channel of ["agent", "cli"]) { const denied = await get(t, path, { "X-Hub-Channel": channel }); assert.equal(denied.status, 403, path); assert.equal(denied.json.error.category, "policy"); }
  }
  const stored = await get(t, `/api/recap/${snapshot.id}`); assert.deepEqual(stored.json, snapshot);
  const presented = await t.request(`/api/recap/${snapshot.id}/present`, { body: { index: 0 } }); assert.equal(presented.status, 200, JSON.stringify(presented.json)); assert.deepEqual(presented.json.voice, { requested: true, handedOff: false, reason: "voice_off" });
  assert.equal((await t.request(`/api/recap/${snapshot.id}/present`, { body: { index: 0 }, headers: { "X-Hub-Channel": "agent" } })).status, 403);
  for (const index of [-1, 6, 0.5]) assert.equal((await t.request(`/api/recap/${snapshot.id}/present`, { body: { index } })).status, 400);
  assert.equal((await get(t, "/api/recap?period=week")).status, 400); assert.equal((await get(t, "/api/sales/funnel?threshold=366")).status, 400);
  assert.equal((await get(t, "/api/factory/unknown/trace")).status, 404); assert.equal((await get(t, "/api/recap/unknown")).status, 404);
  assert.equal(HUB_VERSION, "2.19.1-m16"); assert.equal(API_CONTRACT, 22); assert.deepEqual(counts(t.hub), before);
});
test("M16 Hub intake: contextual navigation, since_visit briefing and isolated source failure", { timeout: 120000 }, async (c) => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const seeded = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'IMPLEMENTING' WHERE mission_id = ?").run(seeded.missionId);
  const before = counts(t.hub);
  const recap = one(await ask(t, "Ce s-a întâmplat azi?"), "recap").recap;
  assert.ok(recap.snapshot.id); assert.equal(recap.index, 0);
  const next = one(await ask(t, "următorul", { snapshotId: recap.snapshot.id, index: 0 }), "recap_control"); assert.equal(next.recapControl.index, 1);
  one(await ask(t, "următorul"), "board_next");
  for (const words of ["următorul?", "înapoi?", "repetă?"]) {
    const question = one(await ask(t, words, { snapshotId: recap.snapshot.id, index: 0 }), "unknown");
    assert.deepEqual(question.args, { recapQuestion: true });
    assert.equal(question.message, "Dacă vrei capitolul următor, spune „următorul”.");
  }
  const stop = one(await ask(t, "Oprește", { snapshotId: recap.snapshot.id, index: 1 }), "recap_control"); assert.equal(stop.recapControl.stopped, true); assert.ok(stop.recapControl.activeWork > 0); assert.match(stop.message, /Lucrările merg mai departe/);
  const morning = one(await ask(t, "Bună dimineața"), "briefing"); assert.ok(morning.delta); assert.equal(morning.recap.snapshot.period.kind, "since_visit");
  for (const [words, intent] of [["Mod comandă", "command_mode"], ["Harta sistemului", "command_view"], ["Ascunde cifrele", "command_numbers"], ["Arată departamentul engineering", "department_show"], ["Fișa factory", "process_sheet"]]) one(await ask(t, words), intent);
  const original = t.hub.approvals.list; t.hub.approvals.list = () => { throw new Error("private error"); };
  try { const r = await get(t, "/api/recap"); assert.equal(r.status, 200); const i = r.json.chapters[0].indicators.find((i) => i.id === "waiting.approvals"); assert.equal(i.state, "unavailable"); assert.equal(r.json.chapters[0].state, "partial"); assert.doesNotMatch(i.note, /private/); } finally { t.hub.approvals.list = original; }
  assert.deepEqual(counts(t.hub), before);
});
