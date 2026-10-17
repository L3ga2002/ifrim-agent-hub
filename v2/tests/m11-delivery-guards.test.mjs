// M11 guards (PASS_SIMULATED: test Hub, fixture providers; no model, no browser launch, no render). T02 ambiguous project → ONE
// question; T03 a derived plan cannot widen or change what was confirmed; a capture step outside its delivery's plan launches
// nothing; T16 a ready bundle is never „done”; T17 „Deciziile mele” only reads.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, enrolOwner, freePort } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { decisionsInbox } from "../server/delivery/inbox.mjs";
import { DELIVERY_PHASE_OPS } from "../server/delivery/delivery.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });

async function twoDemos() {
  const t = await makeTestHub();
  const ids = [];
  for (const name of ["detailing-a", "detailing-b"]) {
    const dir = path.join(t.dataDir, name);
    materializeFixture("booking-demo", dir, { port: await freePort() });
    ids.push((await dispatch(t.hub, "project.register_test", { path: dir, name: `Demo ${name}` })).result.id);
  }
  return { ...t, ids };
}

test("M11-DG-01 (T02) two demo projects and none named → ONE question, nothing prepared, no model", async () => {
  const t = await twoDemos();
  try {
    const out = await t.hub.deliveryPlanner.prepare({ step: { intent: "delivery_prepare", args: {}, constraints: {} }, text: "Pregătește demo-ul pentru prezentare", projectId: null });
    assert.equal(out.kind, "question");
    assert.match(out.question, /Demo detailing-a.*Demo detailing-b|Demo detailing-b.*Demo detailing-a/);
    assert.equal(out.options.length, 2);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_missions").get().n, 0, "no draft prepared");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM deliveries").get().n, 0);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("M11-DG-02 (T03) a derived plan: only the confirmed body, only delivery operations, only from a registered, still-valid parent", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const steps = [{ kind: "delivery.preview.ensure", params: { deliveryId: "dlv_test_000001" } }];
    const parent = { kind: "envelope", id: "env_missing", hash: "x", confirmedAt: new Date().toISOString(), deliveryId: "dlv_test_000001" };
    await assert.rejects(t.hub.opsPlans.adoptDerived({ kind: "delivery.package", title: "t", steps, parent: { ...parent, kind: "nimeni" }, expectedBodySha: "x", sessionId: owner.session.id }), (e) => e.code === "PLAN_DERIVED_PARENT");
    await assert.rejects(t.hub.opsPlans.adoptDerived({ kind: "delivery.package", title: "t", steps, parent, expectedBodySha: "nu-e-acelasi", sessionId: owner.session.id }), (e) => e.code === "PLAN_DERIVED_CHANGED");
    const body = await t.hub.opsPlans.buildBody({ kind: "delivery.package", title: "t", steps, limits: {} });
    const { hashCanonical } = await import("../server/core/canonical.mjs");
    await assert.rejects(t.hub.opsPlans.adoptDerived({ kind: "delivery.package", title: "t", steps, parent, expectedBodySha: hashCanonical(body), sessionId: owner.session.id }), (e) => e.code === "PLAN_DERIVED_PARENT", "the envelope does not exist");
    // A step outside the delivery operations (a desktop app, a model) can never be derived.
    const desktop = [{ kind: "desktop.app.open", params: { app: "notepad" } }];
    const dBody = await t.hub.opsPlans.buildBody({ kind: "x", title: "t", steps: desktop, limits: {} }).catch((e) => e);
    if (!(dBody instanceof Error)) await assert.rejects(t.hub.opsPlans.adoptDerived({ kind: "x", title: "t", steps: desktop, parent, expectedBodySha: hashCanonical(dBody), sessionId: owner.session.id }), (e) => ["PLAN_DERIVED_APP", "PLAN_DERIVED_OP", "PLAN_DERIVED_DECISION"].includes(e.code));
    assert.ok(!DELIVERY_PHASE_OPS.includes("model.run") && !DELIVERY_PHASE_OPS.includes("publish") && !DELIVERY_PHASE_OPS.includes("upload"));
    // Nothing reaches adoptDerived from outside: no command or route carries it.
    assert.ok(!t.hub.commands.catalog().some((c) => /adopt|derived/i.test(c.type)), "no command exposes adoptDerived");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n, 0, "nothing inserted");
  } finally { await t.cleanup(); }
});

test("M11-DG-03 a delivery step outside its own plan is refused before anything starts (CAPTURE_NOT_BOUND)", async () => {
  const t = await makeTestHub();
  try {
    const now = new Date().toISOString();
    t.hub.db.prepare("PRAGMA foreign_keys = OFF").run();
    t.hub.db.prepare(`INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, ops_plan_id, created_by, created_at, updated_at)
      VALUES ('dlv_guard_000001', 'prj_x', 'Livrare test', 'ACTIVE', 'mis_x', '{"captures":[{"role":"desktop"}]}', 's', '[]', 'b', 'opp_real', 'test', ?, ?)`).run(now, now);
    let launched = 0;
    t.hub.media.capture.captureBrowserDemo = async () => { launched += 1; throw new Error("must not launch"); };
    const ex = t.hub.executors["delivery.capture"];
    await assert.rejects(ex.run({ params: { deliveryId: "dlv_guard_000001", role: "desktop" }, planId: "opp_other", authorize: () => ({}), abort: { aborted: false } }), (e) => e.code === "CAPTURE_NOT_BOUND");
    assert.equal(launched, 0);
  } finally { await t.cleanup(); }
});

test("M11-DG-04 (T16, T17) „Deciziile mele” lists what waits and changes nothing; a READY bundle is never in the cockpit's done list", async () => {
  const t = await makeTestHub();
  try {
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    const inbox = decisionsInbox(t.hub);
    assert.ok(Array.isArray(inbox.items));
    assert.match(inbox.note, /nu acceptă nimic în locul tău/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events").get().n, before, "a read writes nothing");
    assert.ok(!t.hub.commands.catalog().some((c) => /decisions?\.inbox|inbox\.(accept|decide)/.test(c.type)), "no inbox command that decides");
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../server/owner/cockpit.mjs", import.meta.url), "utf8"));
    assert.match(src, /b\.status === "OWNER_ACCEPTED"/);
    assert.doesNotMatch(src, /b\.status === "ACCEPTED" \|\| b\.decided_at/);
  } finally { await t.cleanup(); }
});
