// Milestone 10.2 — U06: the blocker explainer (pure, server-authored text from verified state), preserved work requests (the
// one-time explanation rule, re-proposal when a blocker clears, never a confirmation), the automatic readiness runner (only
// inference-free steps on the automation channel; a same-fingerprint re-attestation only after the owner's confirmation) and the
// boot announcement of an invalid attestation. SIMULATED distro (tests/fixtures/fake-wsl.mjs), fake providers, no model.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor, tempDir } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { explain, attestationCode, reattestEligibility, readinessOnlyDelta, OPTION_KINDS } from "../server/owner/blockers.mjs";
import { READINESS_COMMANDS } from "../server/owner/readiness-runner.mjs";
import { CANARY_VERSION } from "../server/environments/canary.mjs";
import { ENV_POLICY_TEXT } from "../server/policy/isolation.mjs";
import { classifyEvent } from "../server/owner/advisor.mjs";
import { openDatabase } from "../server/storage/db.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { dryRunMigration } from "../server/storage/upgrade.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const OLD_CANARY = "m05-canary-1+e1fde725";
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const FORBIDDEN_WORDS = /LIVE_VALIDATION|grant|OPEN GATE/i;
const allText = (ex) => [ex.text, ex.short, ...ex.blockers.flatMap((b) => [b.title, b.detail]), ...ex.options.map((o) => o.label)].join("\n");

/** The live Hub project as read on 2026-10-04: real, Windows route, OBSERVE, R2 open, the factory refuses it. */
const HUB_FACTS = {
  intent: "engineering",
  project: { id: "prj_mun799nc_df5737e504", name: "Ifrim Agent Hub", source: "registry", isHub: true, route: "windows" },
  hubSelfRefused: true, autonomy: "OBSERVE", gate: { status: "open" }, frozen: false,
  checks: [{ role: "writer", provider: "codex", id: "host_isolation", ok: false, detail: "R2_OPEN: pe Ifrim Agent Hub, comenzile Codex ar putea citi prin cale absolută alte proiecte" }],
  stage: { realProjectEligible: false, blockers: ["Implementare: în afara graniței de mediu (R2 deschis pe Windows)"] },
  decisions: { reattestAfterConfirmation: true },
};
/** ProDelivery as read live: wsl-runner, canary e1fde725 vs 0491ff30 on the same fingerprint, (b) valid, C16 older than 24 h. */
const prodelivery = ({ decision = true, policyFp = true, fpSame = true } = {}) => ({
  intent: "engineering",
  project: { id: "prj_prodelivery", name: "ProDelivery", source: "registry", isHub: false, route: "wsl-runner" },
  autonomy: "ASSISTED", gate: { status: "open" }, checks: [], stage: { realProjectEligible: false, blockers: ["Implementare: blocat: mediul nu e pregătit"] },
  environment: { id: "wsl-runner", attesting: false, idle: true,
    attestation: { code: "canary_changed", attestationId: "att_murgupen_3459ee8157", latestStatus: "PASS_LOCAL", attestedCanary: OLD_CANARY, currentCanary: "m05-canary-1+0491ff30",
      attestedFingerprint: "8f9e9eeb934b6c01", currentFingerprint: fpSame ? "8f9e9eeb934b6c01" : "0000aaaa0000bbbb", fingerprintSame: fpSame, ageDays: 1 },
    probes: { codex: { problem: "verificarea contului e mai veche de 24 h", ageH: 45.4 }, reviewer: { applicable: true, problem: "verificarea contului e mai veche de 24 h", ageH: 45.5 } },
    policyB: { approved: true, fingerprintSame: policyFp, fingerprintHash: "8f9e9eeb934b6c01" } },
  decisions: { reattestAfterConfirmation: decision },
});

test("U06-BL-01 the Hub project: exactly refused (factory on the Hub), separate decision (route), admin (R2), inline decision (autonomy); honest text, no old-flow words", () => {
  const ex = explain(HUB_FACTS);
  assert.equal(ex.blocked, true);
  assert.deepEqual(ex.options.map((o) => o.kind).sort(), ["admin", "owner_decision_inline", "owner_decision_separate", "refused"]);
  assert.deepEqual(ex.causes, ["AUTONOMY_OBSERVE", "HOST_R2_OPEN", "HUB_SELF_TARGET"]);
  assert.equal(ex.options.find((o) => o.kind === "refused").code, "HUB_SELF_TARGET");
  assert.equal(ex.options.find((o) => o.kind === "admin").code, "HOST_R2_OPEN");
  assert.match(ex.options.find((o) => o.kind === "admin").label, /risc acceptat, nu izolare/);
  assert.match(ex.options.find((o) => o.kind === "owner_decision_separate").label, /wsl-runner/);
  assert.match(ex.options.find((o) => o.kind === "owner_decision_inline").label, /Windows Hello/);
  assert.match(ex.text, /Software Factory nu lucrează pe Hub-ul însuși/);
  assert.match(ex.text, /video promo nu are nevoie de Codex/);
  assert.match(ex.text, /[Cc]ererea ta rămâne păstrată/);
  assert.doesNotMatch(allText(ex), FORBIDDEN_WORDS, "no LIVE_VALIDATION, grant or OPEN GATE in anything the owner hears");
  assert.ok(ex.options.every((o) => OPTION_KINDS.includes(o.kind)));
  assert.equal(ex.automaticOnly, false);
  // A plan-resolved check (mode, grant, lease, backup, concurrency) is never a blocker, whatever it says.
  const resolved = explain({ ...HUB_FACTS, project: { ...HUB_FACTS.project, isHub: false }, hubSelfRefused: false, autonomy: "ASSISTED", checks: [...HUB_FACTS.checks,
    { role: "writer", id: "mode", ok: false, detail: "BUILD_SAFE" }, { role: "writer", id: "live_grant", ok: false, detail: "Niciun grant" }, { role: "writer", id: "concurrency", ok: false, detail: "2/2" }] });
  assert.deepEqual(resolved.causes, ["HOST_R2_OPEN"]);
  assert.equal(explain({ intent: "engineering", project: { id: "p", name: "T", source: "hub-test", route: "windows" }, gate: { status: "open" }, autonomy: "ASSISTED", checks: [] }).blocked, false);
});

test("U06-BL-02 ProDelivery: C16 refresh is automatic; the re-attestation is automatic only with decision 3 and the same fingerprint as (b), otherwise the owner's step", () => {
  const on = explain(prodelivery());
  assert.deepEqual(on.causes, ["ACCOUNT_CHECK_STALE", "ENV_NOT_ATTESTED_CANARY"]);
  const probe = on.options.find((o) => o.code === "ACCOUNT_CHECK_STALE");
  assert.equal(probe.kind, "automatic_readiness");
  assert.equal(probe.step.command, "environment.probe");
  const att = on.options.find((o) => o.code === "ENV_NOT_ATTESTED_CANARY");
  assert.equal(att.kind, "automatic_readiness");
  assert.deepEqual([att.step.command, att.step.afterConfirmation], ["environment.attest", true]);
  assert.match(att.label, /după ce confirmi planul/);
  assert.equal(on.automaticOnly, true);
  assert.deepEqual(on.steps.map((s) => s.command).sort(), ["environment.attest", "environment.probe"]);
  assert.match(on.text, /e1fde725 → m05-canary-1\+0491ff30/);
  assert.doesNotMatch(allText(on), FORBIDDEN_WORDS);
  for (const [label, facts, why] of [["decision off", prodelivery({ decision: false }), /decizia 3/], ["(b) on another fingerprint", prodelivery({ policyFp: false }), /aprobării tale \(b\)/],
    ["fingerprint changed", prodelivery({ fpSame: false, policyFp: false }), /amprenta inspectată diferă/]]) {
    const ex = explain(facts);
    const o = ex.options.find((x) => x.code === "ENV_NOT_ATTESTED_CANARY");
    assert.equal(o.kind, "owner_decision_separate", label);
    assert.match(o.label, why, label);
    assert.equal(ex.automaticOnly, false, label);
    assert.ok(!ex.steps.some((s) => s.command === "environment.attest"), `${label}: no automatic attestation step`);
  }
  // The eligibility names every failing condition.
  assert.deepEqual(reattestEligibility({ attestation: { code: "canary_changed", fingerprintSame: true }, policyB: { approved: true, fingerprintSame: true } }), { eligible: true, why: [] });
  assert.equal(reattestEligibility({ attestation: { code: "failed", fingerprintSame: true }, policyB: { approved: true, fingerprintSame: true } }).eligible, false);
  // attestationCode mirrors attestationStatus' order and keeps fingerprintSame separately.
  const latest = { id: "att_1", status: "PASS_LOCAL", canaryVersion: OLD_CANARY, fingerprintHash: "fp1", finishedAt: "2026-10-02T21:21:08Z" };
  const now = new Date("2026-10-04T19:00:00Z");
  assert.equal(attestationCode({ latest, currentCanary: "new", currentFingerprint: "fp1", now }).code, "canary_changed");
  assert.equal(attestationCode({ latest, currentCanary: "new", currentFingerprint: "fp2", now }).fingerprintSame, false);
  assert.equal(attestationCode({ latest, currentCanary: OLD_CANARY, currentFingerprint: "fp2", now }).code, "fingerprint_changed");
  assert.equal(attestationCode({ latest: { ...latest, finishedAt: "2026-09-01T00:00:00Z" }, currentCanary: OLD_CANARY, currentFingerprint: "fp1", now }).code, "expired");
  assert.equal(attestationCode({ latest: { ...latest, status: "FAIL" }, currentCanary: OLD_CANARY, currentFingerprint: "fp1", now }).code, "failed");
  assert.equal(attestationCode({ latest: null, now }).code, "not_attested");
  assert.equal(attestationCode({ valid: true, latest, now }).code, null);
});

test("U06-BL-03 other causes: Studio with an empty library, gate paused by the owner vs Stop All, billing declaration after a fresh probe, readinessOnlyDelta", () => {
  const studio = explain({ intent: "studio", project: null, gate: { status: "open" }, media: { assets: 0, editProjects: 0, tools: "UNPINNED" } });
  assert.deepEqual(studio.causes, ["MEDIA_TOOLS_UNPINNED", "STUDIO_NO_MATERIAL"]);
  assert.deepEqual(studio.options.filter((o) => o.code === "STUDIO_NO_MATERIAL").map((o) => o.kind), ["owner_decision_inline", "owner_decision_separate"]);
  assert.equal(studio.options.find((o) => o.code === "MEDIA_TOOLS_UNPINNED").step.inPlan, true, "pinning is a step of the confirmed ops plan, not a runner command");
  assert.equal(explain({ intent: "studio", gate: { status: "open" }, media: { assets: 3, editProjects: 1, tools: "PINNED" } }).blocked, false);
  const paused = explain({ intent: "other", gate: { status: "suspended", suspendedBy: "owner_pause" } });
  assert.equal(paused.options[0].kind, "owner_decision_inline");
  assert.match(paused.options[0].label, /Continuă/);
  const stopped = explain({ intent: "other", gate: { status: "suspended", suspendedBy: "stop_all" } });
  assert.equal(stopped.options[0].kind, "admin");
  assert.doesNotMatch(allText(stopped), FORBIDDEN_WORDS);
  const decl = { role: "writer", provider: "codex", id: "billing_route", ok: false, detail: "x", billing: [{ id: "provider_side_overage_setting", status: "unverified", detail: "d" }] };
  const project = { id: "p", name: "T", source: "hub-test", route: "windows" };
  assert.deepEqual(explain({ intent: "engineering", project, gate: { status: "open" }, autonomy: "ASSISTED", checks: [decl] }).causes, ["BILLING_DECLARATION"]);
  const staleToo = { ...decl, billing: [...decl.billing, { id: "identity", status: "unverified", detail: "Rulează „Verifică contul”" }] };
  const ex = explain({ intent: "engineering", project, gate: { status: "open" }, autonomy: "ASSISTED", checks: [staleToo] });
  assert.deepEqual(ex.causes, ["ACCOUNT_CHECK_STALE"], "a stale account check comes first; the declaration is re-explained after the refresh");
  assert.deepEqual(ex.steps.map((s) => [s.command, s.payload.provider]), [["provider.probe", "codex"]]);
  // A re-proposed plan that differs only by the refreshed attestation (same fingerprint, now valid) is a readiness-only delta.
  const before = { missions: [1], attestationRefs: [{ environment: "wsl-runner", attestationId: "a1", fingerprintHash: "fp", status: "PASS_LOCAL", valid: false, canaryVersion: OLD_CANARY }] };
  assert.equal(readinessOnlyDelta(before, { ...before, attestationRefs: [{ ...before.attestationRefs[0], attestationId: "a2", valid: true, canaryVersion: "new" }] }).readinessOnly, true);
  assert.equal(readinessOnlyDelta(before, { ...before, attestationRefs: [{ ...before.attestationRefs[0], attestationId: "a2", valid: true, fingerprintHash: "fp2" }] }).readinessOnly, false);
  assert.equal(readinessOnlyDelta(before, { ...before, missions: [2], attestationRefs: [{ ...before.attestationRefs[0], valid: true }] }).readinessOnly, false);
});

test("U06-BL-04 migration 11 on a copy (dry run) and on the database: work_requests with its status check; nothing else changes", async () => {
  const dir = tempDir("u06-mig");
  const file = path.join(dir, "hub-v2.sqlite");
  const db10 = openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 10) });
  db10.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('u06-probe', '\"kept\"', ?)").run(new Date().toISOString());
  db10.close();
  const r = await dryRunMigration({ dbPath: file, tmpDir: path.join(dir, "tmp") });
  // Later migrations (M11: 12) follow it in the same run; migration 11 is the first one pending.
  assert.deepEqual([r.schemaBefore, r.schemaAfter, r.integrity, r.rowCountsUnchanged], [10, MIGRATIONS.at(-1).version, "ok", true]);
  assert.deepEqual(r.pending, MIGRATIONS.filter((m) => m.version > 10).map((m) => `${m.version}:${m.name}`));
  assert.equal(r.pending[0], "11:m10-2-work-requests");
  const db = openDatabase(file);
  try {
    assert.equal(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, MIGRATIONS.at(-1).version);
    const cols = db.prepare("PRAGMA table_info(work_requests)").all().map((c) => c.name);
    for (const c of ["id", "text_redacted", "source", "channel", "project_id", "intent", "effect_class", "status", "blocker_signature", "explained_at", "plan_ref", "created_at", "updated_at", "expires_at"]) assert.ok(cols.includes(c), c);
    assert.throws(() => db.prepare("INSERT INTO work_requests (id, source, channel, intent, status, created_by, created_at, updated_at, expires_at) VALUES ('w', 's', 'c', 'engineering', 'RUNNING', 'x', 'a', 'a', 'a')").run(), /CHECK/);
    assert.equal(db.prepare("SELECT value_json FROM settings WHERE key = 'u06-probe'").get().value_json, "\"kept\"");
  } finally { db.close(); }
});

/** A test Hub with the simulated distro attested, the owner enrolled, a routed test project and a mission draft. */
async function envOwnerHub() {
  const t = await makeTestHub({ wsl: true, queues: true });
  const { hub } = t;
  await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = (await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" })).result;
  assert.match(att.status, /^PASS/, JSON.stringify(att));
  await prepareLiveWithoutGrants(hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  const owner = await enrolOwner(t);
  const { mission } = (await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  /** What an upgrade does to the evidence: the canary version moves (same fingerprint) and the account check ages past 24 h. */
  const invalidate = () => {
    hub.db.prepare("UPDATE environment_attestations SET canary_version = ?").run(OLD_CANARY);
    const old = new Date(Date.now() - 30 * 3600000).toISOString();
    hub.providerState.set("codex@wsl-runner", { ...hub.providerState.get("codex@wsl-runner"), probedAt: old });
  };
  return { ...t, project, owner, mission, invalidate };
}
const eventsOf = (hub, type) => hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);

test("U06-BL-05 preserved request: the full text once per signature, then one line; a cleared blocker re-proposes a PROPOSED plan + lega.plan, nothing confirms or starts; cancel", async () => {
  const t = await envOwnerHub();
  try {
    const { hub, project, mission } = t;
    t.invalidate();
    const wr = hub.workRequests.create({ text: "Repară bug-ul din demo, token=sk-abcdefghijklmnopqrstuv", source: "voice-local", channel: "owner", projectId: project.id, intent: "engineering", effectClass: "BOUNDED_WORKFLOW", planRef: { kind: "factory", missionId: mission.id } });
    assert.doesNotMatch(wr.text, /sk-abcdefghij/, "the stored text is redacted");
    const ex1 = await hub.readiness.explainRequest(wr);
    assert.equal(ex1.blocked, true, JSON.stringify(ex1.causes));
    assert.ok(ex1.causes.includes("ENV_NOT_ATTESTED_CANARY") && ex1.causes.includes("ACCOUNT_CHECK_STALE"), ex1.causes.join(","));
    const first = hub.workRequests.explainOnce(wr.id, ex1);
    assert.equal(first.mode, "full"); assert.equal(first.text, ex1.text);
    const second = hub.workRequests.explainOnce(wr.id, await hub.readiness.explainRequest(wr));
    assert.equal(second.mode, "short");
    assert.match(second.text, /^Încă blocat de .*; cererea ta e păstrată\.$/);
    assert.equal(hub.workRequests.get(wr.id).status, "BLOCKED");
    // A different signature is explained in full again.
    const other = { ...ex1, signature: "ACCOUNT_CHECK_STALE", causes: ["ACCOUNT_CHECK_STALE"] };
    assert.equal(hub.workRequests.explainOnce(wr.id, other).mode, "full");
    hub.workRequests.explainOnce(wr.id, ex1);
    const grantsBefore = hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n;
    // The owner's own fixes (simulated): a fresh account check (still blocked by the canary), then a PASS attestation.
    await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
    await waitFor(() => hub.workRequests.get(wr.id).blockerSignature === "ENV_NOT_ATTESTED_CANARY" || null, 15000, 50);
    assert.equal(hub.workRequests.get(wr.id).explainedAt, null, "a changed, unspoken signature is explained in full at the next mention");
    await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" });
    const planned = await waitFor(() => (hub.workRequests.get(wr.id).status === "PLANNED" ? hub.workRequests.get(wr.id) : null), 30000, 100);
    assert.equal(planned.planRef.kind, "envelope");
    const env = hub.envelopes.get(planned.planRef.id);
    assert.equal(env.status, "PROPOSED");
    assert.equal(env.proposedVia, "work_request");
    assert.deepEqual(env.missionIds, [mission.id]);
    const plans = eventsOf(hub, "lega.plan");
    assert.equal(plans.length, 1);
    assert.equal(JSON.parse(plans[0].payload_json).needsConfirmation, true);
    assert.equal(eventsOf(hub, "envelope.confirmed").length, 0, "nothing confirmed");
    assert.equal(hub.factory.view(mission.id).factory.stage, "SPEC_DRAFT", "nothing started");
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n, grantsBefore, "no grant");
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    // The attention feed carries the re-planned request as a decision; the cockpit lists it.
    assert.ok(hub.advisor.attention().items.some((i) => i.reason === "DECISION_REQUIRED" && i.key === `work_request:${wr.id}`));
    const cockpit = await hub.cockpit.projectCockpit(project.id);
    assert.ok(cockpit.notices.some((n) => n.kind === "work_request" && n.id === wr.id && n.status === "PLANNED"));
    // Cancel ("renunță la cerere") from the voice channel; a second cancel is a conflict; a cancelled request is never re-planned.
    const c = (await dispatch(hub, "work.request.cancel", { workRequestId: wr.id }, { channel: "voice" })).result;
    assert.equal(c.status, "CANCELLED");
    await assert.rejects(dispatch(hub, "work.request.cancel", { workRequestId: wr.id }), /nu mai e activă/);
    assert.equal((await hub.workRequests.replan(wr.id)).status, "CANCELLED");
    // Expiry after 7 days.
    const old = hub.workRequests.create({ text: "x", projectId: project.id, intent: "engineering" });
    hub.db.prepare("UPDATE work_requests SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), old.id);
    assert.deepEqual(hub.workRequests.tick(), { expired: 1 });
    assert.equal(hub.workRequests.get(old.id).status, "EXPIRED");
  } finally { await t.cleanup(); }
});

test("U06-BL-06 readiness runner after the owner's confirmation: inspect → same-fingerprint re-attest → probe on automation as readiness:*, never r2/(b)/route/autonomy/mode/grants; refusals without authority", async () => {
  const t = await envOwnerHub();
  try {
    const { hub, project, mission, owner } = t;
    await dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: hub.wslRunner.state().fingerprint.hash }, { ownerSession: owner.session });
    t.invalidate();
    assert.equal(hub.wslRunner.attestationStatus().valid, false);
    // Without a confirmed plan the attestation on the automation channel is refused in the handler (authority from the database).
    await assert.rejects(dispatch(hub, "environment.attest", { environmentId: "wsl-runner", readinessFor: "envelope:env_nope" }, { channel: "automation", actor: "readiness:x" }), /doar ca pas de pregătire după confirmarea unui plan/);
    await assert.rejects(dispatch(hub, "environment.attest", { environmentId: "wsl-runner" }, { channel: "automation", actor: "scheduler" }), /doar ca pas de pregătire/);
    await assert.rejects(dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: "x" }, { channel: "automation", actor: "readiness:x" }), /cannot be issued through automation/);
    await assert.rejects(dispatch(hub, "project.environment.set", { projectId: project.id, environment: "windows" }, { channel: "automation", actor: "readiness:x" }), /cannot be issued through automation/);
    // A runner pass without a confirmation: the probe runs, the attestation is skipped (named, not silently dropped).
    const dry = await hub.readiness.run({ projectId: project.id, missionIds: [mission.id] });
    assert.ok(dry.skipped.some((s) => s.command === "environment.attest"), JSON.stringify(dry.skipped));
    assert.ok(dry.steps.some((s) => s.command === "environment.probe" && s.ok));
    assert.ok(!dry.steps.some((s) => s.command === "environment.attest"));
    assert.equal(hub.wslRunner.attestationStatus().valid, false);
    t.invalidate();
    const snapshot = () => ({ settings: Object.fromEntries(["r2Acceptance", "environmentPolicy", "projectEnvironments", "projectAutonomy", "mode", "executionGate", "billingEvidence", "isolationConsent", "legaConsent"].map((k) => [k, JSON.stringify(hub.settings.get(k))])),
      grants: hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n });
    const before = snapshot();
    // The plan the owner sees (ineligible: only automatic causes), its one confirmation recorded on the preserved request.
    const wr = hub.workRequests.create({ text: "Repară bug-ul", source: "typed", channel: "owner", projectId: project.id, intent: "engineering", planRef: { kind: "factory", missionId: mission.id } });
    const proposed = (await dispatch(hub, "envelope.propose", { projectId: project.id, missionIds: [mission.id] })).result;
    assert.equal(proposed.readiness.eligible, false);
    const ex = await hub.readiness.explainRequest(wr);
    assert.equal(ex.automaticOnly, true, ex.causes.join(","));
    const env = proposed.envelope;
    // The confirmation needs the owner session and the exact plan shown.
    await assert.rejects(dispatch(hub, "work.request.confirm_readiness", { workRequestId: wr.id, envelopeId: env.id, nonce: env.nonce, displayedHash: "0".repeat(64) }, { ownerSession: owner.session }), /nu corespunde planului afișat/);
    await assert.rejects(dispatch(hub, "work.request.confirm_readiness", { workRequestId: wr.id, envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { channel: "ui" }), /cannot be issued through ui/);
    const seqBefore = hub.bus.lastSeq();
    const confirmed = (await dispatch(hub, "work.request.confirm_readiness", { workRequestId: wr.id, envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: owner.session })).result;
    assert.equal(confirmed.status, "CONFIRMED");
    const done = await waitFor(() => hub.db.prepare("SELECT * FROM events WHERE type = 'readiness.completed' AND seq > ? AND scope_id = ?").get(seqBefore, wr.id) || null, 60000, 100);
    const payload = JSON.parse(done.payload_json);
    assert.deepEqual(payload.steps.filter((s) => s.ok).map((s) => s.command), ["environment.inspect", "environment.attest", "environment.probe"], JSON.stringify(payload));
    assert.equal(payload.cleared, true);
    const automation = hub.db.prepare("SELECT type, actor, channel FROM commands WHERE channel = 'automation' AND created_at >= (SELECT created_at FROM events WHERE seq = ?)").all(seqBefore + 1);
    assert.ok(automation.length >= 3);
    assert.ok(automation.every((c) => c.actor === `readiness:${wr.id}`), JSON.stringify(automation));
    assert.ok(automation.every((c) => READINESS_COMMANDS.includes(c.type)), "only readiness commands");
    const att = hub.wslRunner.attestationStatus();
    assert.equal(att.valid, true);
    assert.equal(att.latest.canaryVersion, CANARY_VERSION);
    assert.equal(att.latest.channel, "automation");
    assert.deepEqual(snapshot(), before, "no r2Acceptance, (b), route, autonomy, mode, gate, billing, consent or grant change");
    // The request is re-proposed (a plan to confirm), marked as differing only by the refreshed evidence.
    const planned = await waitFor(() => (hub.workRequests.get(wr.id).status === "PLANNED" ? hub.workRequests.get(wr.id) : null), 30000, 100);
    const plan = JSON.parse(eventsOf(hub, "lega.plan").at(-1).payload_json);
    assert.equal(plan.workRequestId, wr.id);
    assert.equal(plan.afterReadiness, true);
    assert.equal(plan.readinessOnly, true);
    assert.equal(hub.envelopes.get(planned.planRef.id).status, "PROPOSED");
    assert.equal(eventsOf(hub, "envelope.confirmed").length, 0);
    assert.equal(hub.factory.view(mission.id).factory.stage, "SPEC_DRAFT");
    // A second automatic attempt for the same version is never made (no loop), even with authority.
    hub.db.prepare("UPDATE environment_attestations SET canary_version = ?").run(OLD_CANARY);
    const again = await hub.readiness.run({ ref: `work_request:${wr.id}`, projectId: project.id, missionIds: [mission.id] });
    assert.ok(!again.steps.some((s) => s.command === "environment.attest" && s.ok), "authority lapsed (request PLANNED) or version already tried");
  } finally { await t.cleanup(); }
});

test("U06-BL-07 boot announcement: one environment.attestation_invalid per cause and version (deduplicated), a RISK attention item, a cockpit notice; nothing runs", async () => {
  const t = await envOwnerHub();
  try {
    const { hub, project } = t;
    assert.deepEqual(hub.getBootReport().readiness, [], "a fresh hub has nothing to announce");
    t.invalidate();
    const commandsBefore = hub.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n;
    const first = hub.readiness.announceAtBoot();
    assert.deepEqual(first.map((a) => [a.code, a.duplicate]), [["canary_changed", false]]);
    assert.deepEqual(hub.readiness.announceAtBoot().map((a) => a.duplicate), [true], "a restart on the same version announces nothing new");
    const evs = eventsOf(hub, "environment.attestation_invalid");
    assert.equal(evs.length, 1);
    const p = JSON.parse(evs[0].payload_json);
    assert.equal(p.code, "canary_changed"); assert.equal(p.attestedCanary, OLD_CANARY); assert.equal(p.currentCanary, CANARY_VERSION);
    assert.equal(p.fingerprintSame, true);
    assert.ok(p.probeAgeH >= 24);
    assert.deepEqual(p.affectedProjects, [project.id]);
    assert.equal(p.maintenanceEligible, false, "no (b) on this hub: the re-attestation stays the owner's step");
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, commandsBefore, "no inspection, probe or attestation at boot");
    assert.ok(hub.advisor.attention().items.some((i) => i.reason === "RISK" && i.key === "env:wsl-runner"));
    const cockpit = await hub.cockpit.projectCockpit(project.id);
    assert.ok(cockpit.notices.some((n) => n.kind === "environment" && n.code === "ENV_NOT_ATTESTED_CANARY"), JSON.stringify(cockpit.notices));
    // Advisor regression: a FAILED attestation is a RISK item (M05–M10 listened for a type that never existed).
    assert.equal(classifyEvent({ type: "environment.attested", scopeId: "wsl-runner", payload: { status: "FAIL" } })?.reason, "RISK");
    assert.equal(classifyEvent({ type: "environment.attestation", scopeId: "wsl-runner", payload: { status: "FAIL" } }), null);
    assert.equal(classifyEvent({ type: "environment.attested", scopeId: "wsl-runner", payload: { status: "PASS_LOCAL" } }), null);
  } finally { await t.cleanup(); }
});
