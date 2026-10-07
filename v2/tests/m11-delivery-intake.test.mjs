// M11 — the owner's sentence through the one intake path (PASS_SIMULATED: test Hub, fixture providers; nothing runs here). Covers
// T01/T02 (project routing), T15 (no publish), T20 (no grant form, no manual mode: one plan card), and the planner's honest refusals.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, freePort, tempDir } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { realLaunchers } from "./media-helpers.mjs";

const launchers = realLaunchers();
const skipTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent (the planner then answers with the honest blocker)";

const OWNER_SENTENCE = "Lega, pregătește demo-ul de detailing pentru prezentare. Verifică programările pe mobil, repară problema convenită, fă un clip și pregătește-mi rezumatul comercial. Nu publica nimic.";
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const ctx = { projects: [], missions: [], departments: [], pendingEnvelopes: [], source: "typed" };

test("M11-DI-01 the owner's whole request is ONE delivery step with „nu publica” as a constraint; a stop in the same sentence is never absorbed", () => {
  const out = resolveIntent(OWNER_SENTENCE, ctx);
  assert.deepEqual(out.steps.map((s) => s.intent), ["delivery_prepare"]);
  assert.equal(out.steps[0].constraints.noPublish, true);
  assert.ok(out.steps[0].args.details.some((d) => /rezumatul comercial/.test(d)));
  assert.deepEqual(resolveIntent("Pregătește demo-ul pentru prezentare. Oprește tot.", ctx).steps.map((s) => s.intent), ["delivery_prepare", "stop_all"]);
  assert.deepEqual(resolveIntent("Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.", ctx).steps.map((s) => s.intent), ["delivery_revise"]);
  assert.deepEqual(resolveIntent("Arată-mi ce ai pregătit.", ctx).steps.map((s) => s.intent), ["delivery_open"]);
  assert.deepEqual(resolveIntent("Deciziile mele", ctx).steps.map((s) => s.intent), ["delivery_decisions"]);
  assert.deepEqual(resolveIntent("Fă un clip de promovare de 30 de secunde", ctx).steps.map((s) => s.intent), ["studio_create"], "a plain clip request stays a Studio plan");
});

test("M11-DI-02 (T20) the sentence → ONE envelope card carrying mission + delivery; nothing starts, no grant, no mode change; a real project is refused", { skip: skipTools }, async () => {
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const importRoot = tempDir("videos");
    t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), importRoots: [importRoot] }, "test", "exports folder"));
    const dir = path.join(t.dataDir, "detailing-demo");
    materializeFixture("booking-demo", dir, { port: await freePort() });
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    // The test account's model list (the fake provider): the owner's per-project model choice, as on the real Hub.
    t.hub.bus.transaction(() => t.hub.settings.set("factoryDefaultBindings", { [project.id]: { writer: { model: "gpt-fake-sol", effort: "medium" }, reviewer: { model: "sonnet", effort: "medium" } } }, "test", "fake models"));
    const grantsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n;
    const modeBefore = t.hub.settings.get("mode");
    const r = await asOwner(t, owner, { text: OWNER_SENTENCE, projectId: project.id });
    const env = r.plan?.envelope || r.results?.find((x) => x.plan)?.plan?.envelope;
    assert.ok(env, JSON.stringify(r.results?.map((x) => ({ message: x.message, blockedBy: x.blockedBy, error: x.error, note: x.note }))).slice(0, 1500));
    assert.ok(env.body.delivery?.deliveryId, "the card carries the delivery section");
    assert.ok(env.body.ownerConstraints.includes("noPublish"));
    assert.equal(t.hub.deliveries.get(env.body.delivery.deliveryId).status, "PLANNED");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing ran");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n, grantsBefore, "no grant");
    assert.equal(t.hub.settings.get("mode"), modeBefore, "no mode change");
    // A real (non-test) project is refused in plain words — the Hub's own repository here.
    const hubProject = t.hub.projects.hub();
    const refused = await asOwner(t, owner, { text: "Pregătește demo-ul pentru prezentare.", projectId: hubProject.id });
    const text = JSON.stringify(refused);
    assert.match(text, /proiecte de test|nu are un demo/, text.slice(0, 400));
  } finally { await t.cleanup(); }
});
