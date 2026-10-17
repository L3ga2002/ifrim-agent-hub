// Milestone 09 — A2 billing evidence (PASS_SIMULATED / pure): the provider-side overage setting (Claude usage credits,
// Codex automatic reload) is admitted only by the owner's declaration, made in the owner session and bound to the account a
// fresh probe verified; provider reports can only take it away. Fixture providers only; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { makeTestHub, enableLive, enrolOwner, declareBillingFixture, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { evaluateRoute, ATTESTATION_TEXT } from "../server/policy/billing.mjs";
import {
  evidenceState, deriveAccountIdentity, buildDeclaration, applyDeclaration, applyLatch, convertLegacyAttestations, normalizeClaudeRateLimit,
  classifyClaudeRateLimit, textVersionOf, EVIDENCE_MAX_AGE_DAYS, IDENTITY_SCHEME, billingInputs,
} from "../server/policy/billing-evidence.mjs";
import { normalizeAccount } from "../server/providers/codex.mjs";
import { claudeAuthFacts } from "../server/providers/claude.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { AGENT_COMMANDS } from "../server/runtime/commands.mjs";
import { SCHEDULE_COMMANDS } from "../server/runtime/command-catalog.mjs";

const dispatch = (hub, type, payload, opts = {}) => hub.commands.dispatch({ type, payload, actor: opts.actor || "test", channel: opts.channel || "test", ownerSession: opts.ownerSession || null,
  delegation: opts.delegation || null });
const SALT = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-10-04T12:00:00Z");
const ID_A = deriveAccountIdentity({ salt: SALT, email: "owner@example.com", plan: "max" });
const ID_B = deriveAccountIdentity({ salt: SALT, email: "someone-else@example.com", plan: "max" });
const declared = (provider, { identity = ID_A, at = NOW, text = ATTESTATION_TEXT[provider], source = "owner_session:webauthn" } = {}) =>
  applyDeclaration({}, provider, buildDeclaration({ id: `bde_${provider}`, provider, text, identity, now: at, source, recordedBy: { channel: "owner", actor: "owner", sessionId: "ses_x" } }));
const claudeOk = (identity = ID_A) => ({ installed: true, auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", accountIdentity: identity }, config: { apiKeyHelper: false, riskyEnvInSettings: [] } });
const overage = (route) => route.checks.find((c) => c.id === "provider_side_overage_setting");
const gateCheck = (decision, id) => decision.checks.find((c) => c.id === id);

function request(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, text, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
async function serve(t) {
  const { server, token } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  return { token, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
async function probeBoth(hub) {
  for (const id of ["codex", "claude"]) {
    const installation = await hub.providers[id].inspectInstallation();
    const probe = await hub.providers[id].probe({ withUsage: true, withModels: id === "codex" });
    hub.providerState.set(id, { ...probe, installation });
  }
}
function conversation(hub, project, text = "verifică") {
  const conv = hub.conversations.create({ projectId: project.id, title: "m09-be" }, "test");
  hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: text }, "test");
  return conv;
}
const settled = (hub, id, ms = 60000) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, ms, 50);

// ---------- pure ----------

test("M09-BE-01 identity binding: the same account is valid; another account (account_changed) or no identity (identity_unavailable) blocks", () => {
  const evidence = declared("claude");
  assert.equal(evidenceState("claude", { evidence, identity: ID_A, now: NOW, currentText: ATTESTATION_TEXT.claude }).state, "valid");
  assert.equal(evaluateRoute("claude", claudeOk(ID_A), { evidence, identity: ID_A, now: NOW }).allowed, true);
  const other = evaluateRoute("claude", claudeOk(ID_B), { evidence, identity: ID_B, now: NOW });
  assert.equal(other.allowed, false);
  assert.deepEqual(overage(other).evidence.reasons, ["account_changed"]);
  assert.match(other.blockingReasons.join(" "), /nu este contul pentru care ai declarat/);
  const none = evaluateRoute("claude", claudeOk(null), { evidence, identity: null, now: NOW });
  assert.equal(none.allowed, false);
  assert.deepEqual(overage(none).evidence.reasons, ["identity_unavailable"]);
  // Another scheme or a malformed stored pseudonym never matches.
  assert.equal(evidenceState("claude", { evidence, identity: { ...ID_A, scheme: "sha1:v0" }, now: NOW }).state, "reverify_required");
  const forged = { claude: { declaration: { ...evidence.claude.declaration, accountIdentity: { scheme: IDENTITY_SCHEME, value: "not-hex" } } } };
  assert.deepEqual(evidenceState("claude", { evidence: forged, identity: ID_A, now: NOW }).reasons, ["identity_unavailable"]);
  // The pseudonym: salted (another salt → another value), case-insensitive on the e-mail, 16 hex, tuple fallback is labelled.
  assert.match(ID_A.value, /^[0-9a-f]{16}$/);
  assert.equal(deriveAccountIdentity({ salt: SALT, email: "OWNER@example.com " }).value, ID_A.value);
  assert.notEqual(deriveAccountIdentity({ salt: "f".repeat(32), email: "owner@example.com" }).value, ID_A.value);
  assert.equal(deriveAccountIdentity({ salt: SALT, tuple: ["claude.ai", "firstParty", "max"] }).basis, "tuple");
  assert.equal(deriveAccountIdentity({ salt: "short", email: "a@b.c" }), null, "no usable salt → no identity (a bound declaration then blocks)");
  // The adapters' normalisers keep the pseudonym only.
  const codexAuth = normalizeAccount({ account: { type: "chatgpt", email: "owner@example.com", planType: "pro" } }, { salt: SALT });
  assert.equal(codexAuth.accountIdentity.basis, "email");
  assert.ok(!JSON.stringify(codexAuth).includes("example.com"));
  assert.equal(normalizeAccount({ account: { type: "chatgpt", email: "owner@example.com", planType: "pro" } }).accountIdentity, undefined, "no salt, no identity");
  const claudeAuth = claudeAuthFacts({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", email: "owner@example.com", orgId: "org-1" }, { salt: SALT });
  assert.equal(claudeAuth.accountIdentity.basis, "email");
  assert.notEqual(claudeAuth.accountIdentity.value, ID_A.value, "the organisation id is part of the pseudonym");
  assert.equal(claudeAuthFacts({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }, { salt: SALT }).accountIdentity.basis, "tuple");
  assert.ok(!JSON.stringify(claudeAuth).includes("example.com") && !JSON.stringify(claudeAuth).includes("org-1"));
});

test("M09-BE-02 expiry boundaries: valid until the last millisecond, expired at expiresAt; a future recordedAt or a stored expiry beyond 30 days never extends it", () => {
  const evidence = declared("codex", { identity: null });
  const expiresAt = new Date(NOW.getTime() + EVIDENCE_MAX_AGE_DAYS * 86400000);
  const at = (ms) => evidenceState("codex", { evidence, identity: null, now: new Date(ms), currentText: ATTESTATION_TEXT.codex });
  assert.equal(at(expiresAt.getTime() - 1).state, "valid");
  assert.deepEqual(at(expiresAt.getTime()).reasons, ["expired"]);
  assert.deepEqual(at(NOW.getTime() - 1).reasons, ["expired"], "a declaration recorded in the future is not valid");
  const stretched = { codex: { declaration: { ...evidence.codex.declaration, expiresAt: new Date(NOW.getTime() + 400 * 86400000).toISOString() } } };
  assert.deepEqual(evidenceState("codex", { evidence: stretched, now: new Date(expiresAt.getTime() + 1000) }).reasons, ["expired"], "capped at recordedAt + 30 d");
  const broken = { codex: { declaration: { ...evidence.codex.declaration, recordedAt: "not a date" } } };
  assert.deepEqual(evidenceState("codex", { evidence: broken, now: NOW }).reasons, ["expired"]);
  assert.equal(evidenceState("codex", { evidence: {}, now: NOW }).state, "missing");
  assert.equal(evidenceState("codex", { evidence: { codex: "garbage" }, now: NOW }).state, "missing");
  // Text version: a declaration made for an older text needs re-declaring.
  assert.deepEqual(evidenceState("codex", { evidence: declared("codex", { identity: null, text: "text vechi" }), now: NOW, currentText: ATTESTATION_TEXT.codex }).reasons, ["text_version_changed"]);
  assert.notEqual(textVersionOf("a"), textVersionOf("b"));
  // A latch blocks a fresh, bound declaration; a re-declaration clears it.
  const latched = applyLatch(declared("claude"), "claude", { reason: "provider_report_overage", now: NOW, by: "run:x" });
  assert.deepEqual(evidenceState("claude", { evidence: latched, identity: ID_A, now: NOW }).reasons, ["latched", "provider_report_overage"]);
  assert.throws(() => applyLatch({}, "claude", { reason: "made_up", now: NOW, by: "x" }), /Unknown latch reason/);
  const cleared = applyDeclaration(latched, "claude", buildDeclaration({ id: "bde_2", provider: "claude", text: ATTESTATION_TEXT.claude, identity: ID_A, now: NOW, source: "owner_session:webauthn" }));
  assert.equal(evidenceState("claude", { evidence: cleared, identity: ID_A, now: NOW, currentText: ATTESTATION_TEXT.claude }).state, "valid");
  assert.ok(cleared.claude.previousReverify.reasons.includes("provider_report_overage"), "the cleared latch stays on record");
  // billingInputs is the one place the inputs come from.
  const settings = { get: (k) => ({ billingEvidence: latched, usageReservePercent: 7 })[k] };
  assert.deepEqual(billingInputs(settings, { auth: { accountIdentity: ID_A }, usage: { windows: [] } }, NOW), { evidence: latched, identity: ID_A, now: NOW, usage: { windows: [] }, reservePercent: 7 });
  assert.equal(billingInputs(settings, null, NOW).identity, null);
});

test("M09-BE-03 legacy conversion at boot: Claude → reverify_required (legacy_unbound) and blocked; Codex valid until its expiry; idempotent; the legacy key is kept", async () => {
  // Pure: an owner declaration already present is never overwritten.
  const owner = declared("claude");
  const kept = convertLegacyAttestations({ attestations: { claude: { confirmedAt: NOW.toISOString(), text: ATTESTATION_TEXT.claude } }, evidence: owner, now: NOW });
  assert.deepEqual(kept.converted, []);
  assert.equal(kept.evidence.claude.declaration.id, "bde_claude");
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probeBoth(hub);
    const recorded = new Date(Date.now() - 2 * 86400000).toISOString();
    const legacy = { codex: { confirmedAt: recorded, text: ATTESTATION_TEXT.codex }, claude: { confirmedAt: recorded, text: ATTESTATION_TEXT.claude } };
    hub.bus.transaction(() => { hub.settings.set("billingAttestations", legacy, "test"); hub.settings.set("billingEvidence", {}, "test"); });
    const first = hub.convertLegacyBilling();
    assert.deepEqual(first.converted.sort(), ["claude", "codex"]);
    const evidence = hub.settings.get("billingEvidence");
    assert.equal(evidence.codex.declaration.source, "legacy_ui");
    assert.equal(evidence.codex.declaration.accountIdentity, null);
    assert.equal(evidence.codex.declaration.expiresAt, new Date(Date.parse(recorded) + 30 * 86400000).toISOString());
    assert.equal(evidence.codex.reverify, null);
    assert.deepEqual(evidence.claude.reverify.reasons, ["legacy_unbound"]);
    const project = hub.projects.hub();
    const codexGate = hub.gate.evaluate({ provider: "codex", projectId: project.id });
    const claudeGate = hub.gate.evaluate({ provider: "claude", projectId: project.id });
    assert.equal(gateCheck(codexGate, "billing_route").ok, true, gateCheck(codexGate, "billing_route").detail);
    assert.equal(gateCheck(claudeGate, "billing_route").ok, false);
    assert.match(gateCheck(claudeGate, "billing_route").detail, /nu era legată de un cont/);
    // Idempotent; the legacy key stays untouched (rollback).
    assert.deepEqual(hub.convertLegacyBilling().converted, []);
    assert.deepEqual(hub.settings.get("billingAttestations"), legacy);
    assert.equal(hub.bus.query({ typePrefix: "billing.legacy_converted", limit: 5 }).length, 1);
    assert.equal(hub.bus.query({ typePrefix: "billing.reverify_required", limit: 5 })[0].payload.reason, "legacy_unbound");
    // A Codex legacy declaration still expires.
    hub.bus.transaction(() => hub.settings.set("billingEvidence", convertLegacyAttestations({ attestations: { codex: { confirmedAt: "2026-08-01T00:00:00Z", text: ATTESTATION_TEXT.codex } }, evidence: {}, now: new Date() }).evidence, "test"));
    assert.equal(gateCheck(hub.gate.evaluate({ provider: "codex", projectId: project.id }), "billing_route").ok, false);
  } finally { await t.cleanup(); }
});

test("M09-BE-04 billing.declare: refused on ui, cli, agent and voice; needs the owner session, a fresh re-authentication, the exact text, the displayed account = the probed account, a probe ≤ 24 h; the happy path records the session", async () => {
  let offsetMs = 0;
  const t = await makeTestHub({ clock: () => new Date(Date.now() + offsetMs) });
  try {
    const { hub } = t;
    await probeBoth(hub);
    hub.bus.transaction(() => hub.settings.set("billingEvidence", applyLatch({}, "claude", { reason: "legacy_unbound", now: new Date(), by: "hub" }), "test"));
    const identity = hub.providerState.get("claude").auth.accountIdentity;
    const payload = { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: identity.value };
    assert.ok(!AGENT_COMMANDS.has("billing.declare") && !AGENT_COMMANDS.has("billing.withdraw") && !SCHEDULE_COMMANDS.has("billing.declare"));
    for (const channel of ["ui", "cli", "voice", "companion"]) await assert.rejects(dispatch(hub, "billing.declare", payload, { channel }), /cannot be issued through/, channel);
    await assert.rejects(dispatch(hub, "billing.declare", payload, { channel: "agent", delegation: "proprietar în conversație, test M09" }), /not delegated/);
    await assert.rejects(dispatch(hub, "billing.declare", payload, { channel: "owner" }), /owner channel needs an authenticated owner session/);
    await assert.rejects(dispatch(hub, "billing.declare", payload), /deschide sesiunea de proprietar/, "the test channel without a session");
    const owner = await enrolOwner(t, { activatePolicy: false });
    offsetMs = 6 * 60000; // past the 5-minute re-authentication window, well inside the 24 h probe window
    await assert.rejects(dispatch(hub, "billing.declare", payload, { channel: "owner", ownerSession: owner.session }), (e) => e.category === "authentication" && e.details?.reauth === true);
    const fresh = owner.reauth();
    await assert.rejects(dispatch(hub, "billing.declare", { ...payload, confirmText: ATTESTATION_TEXT.claude.replace("dezactivate", "activate") }, { channel: "owner", ownerSession: fresh }), /nu corespunde exact/);
    await assert.rejects(dispatch(hub, "billing.declare", { ...payload, displayedIdentity: "0000000000000000" }, { channel: "owner", ownerSession: fresh }), (e) => e.category === "conflict" && /Contul afișat/.test(e.message));
    // A stale probe (older than 24 h) is refused, never adopted.
    const state = hub.providerState.get("claude");
    hub.providerState.set("claude", { ...state, probedAt: new Date(Date.now() + offsetMs - 25 * 3600000).toISOString() });
    await assert.rejects(dispatch(hub, "billing.declare", payload, { channel: "owner", ownerSession: fresh }), (e) => e.category === "conflict" && /Verifică întâi contul/.test(e.message));
    hub.providerState.set("claude", state);
    // A probe without a derivable identity cannot be declared for.
    hub.providerState.set("claude", { ...state, auth: { ...state.auth, accountIdentity: undefined } });
    await assert.rejects(dispatch(hub, "billing.declare", payload, { channel: "owner", ownerSession: fresh }), /identitate derivabilă/);
    hub.providerState.set("claude", state);
    assert.ok(!hub.settings.get("billingEvidence").claude.declaration, "nothing was recorded by a refused attempt");
    // Happy path.
    const ok = await dispatch(hub, "billing.declare", payload, { channel: "owner", ownerSession: fresh });
    assert.equal(ok.command.channel, "owner");
    const record = hub.settings.get("billingEvidence").claude;
    assert.equal(record.declaration.source, "owner_session:webauthn");
    assert.equal(record.declaration.recordedBy.sessionId, fresh.id);
    assert.equal(record.declaration.recordedBy.credentialId10, fresh.credentialId.slice(0, 10));
    assert.equal(record.declaration.accountIdentity.value, identity.value);
    assert.equal(record.declaration.textVersion, textVersionOf(ATTESTATION_TEXT.claude));
    assert.equal(record.reverify, null, "the legacy latch is cleared by the owner's declaration");
    const event = hub.bus.query({ typePrefix: "billing.declared", limit: 1 })[0];
    assert.deepEqual(event.payload.cleared, ["legacy_unbound"]);
    assert.equal(event.payload.identity, identity.value.slice(0, 8));
    const claudeGate = hub.gate.evaluate({ provider: "claude", projectId: hub.projects.hub().id });
    assert.equal(gateCheck(claudeGate, "billing_route").ok, true, gateCheck(claudeGate, "billing_route").detail);
  } finally { await t.cleanup(); }
});

test("M09-BE-05 billing.withdraw is fail-safe from voice and companion: Claude blocks at once; the Codex gate and backup.run are unaffected", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { provider: "codex" });
    const before = gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id }), "billing_route");
    assert.equal(before.ok, true, before.detail);
    const out = await dispatch(hub, "billing.withdraw", { provider: "claude", reason: "am pornit creditele" }, { channel: "voice", actor: "voice" });
    assert.equal(out.result.withdrawn, true);
    const after = gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id }), "billing_route");
    assert.equal(after.ok, false);
    assert.match(after.detail, /ai retras declarația/);
    // Again from the companion (idempotent: one reason, the latch's first time kept).
    await dispatch(hub, "billing.withdraw", { provider: "claude" }, { channel: "companion", actor: "companion" });
    assert.deepEqual(hub.settings.get("billingEvidence").claude.reverify.reasons, ["owner_withdrawn"]);
    // A withdrawal without any declaration still latches (fail-safe).
    hub.bus.transaction(() => hub.settings.set("billingEvidence", {}, "test"));
    await dispatch(hub, "billing.withdraw", { provider: "claude" }, { channel: "ui", actor: "user" });
    assert.equal(hub.settings.get("billingEvidence").claude.reverify.required, true);
    declareBillingFixture(hub, { providers: ["codex"] });
    const codexGate = hub.gate.evaluate({ provider: "codex", projectId: project.id });
    assert.equal(gateCheck(codexGate, "billing_route").ok, true, gateCheck(codexGate, "billing_route").detail);
    assert.equal(codexGate.allowed, true, JSON.stringify(codexGate.checks.filter((c) => !c.ok)));
    const backup = await dispatch(hub, "backup.run", { projectId: project.id }, { channel: "ui", actor: "user" });
    assert.equal(backup.command.status, "executed");
    assert.equal(hub.bus.query({ typePrefix: "billing.withdrawn", limit: 5 }).length, 3);
  } finally { await t.cleanup(); }
});

test("M09-BE-06 Claude rate_limit_event: a plain report is a usage snapshot (no latch); unknown fields verify nothing; credits_required is a quota stop; an overage signal stops the run and latches the reverify", async () => {
  // Pure classification first.
  const plain = normalizeClaudeRateLimit({ status: "allowed", resetsAt: 1790000000, utilization: 0.4 }, NOW.toISOString());
  assert.deepEqual(classifyClaudeRateLimit(plain), { overage: false, signals: [], creditsRequired: false, creditFields: false });
  const unknown = normalizeClaudeRateLimit({ status: "allowed", creditsOff: true, x: { nested: 1 } }, NOW.toISOString());
  assert.deepEqual(unknown.unknownFields, ["creditsOff", "x"]);
  assert.equal(unknown.creditsOff, undefined, "unknown values are never kept");
  assert.equal(classifyClaudeRateLimit(unknown).overage, false);
  assert.equal(classifyClaudeRateLimit(normalizeClaudeRateLimit({ isUsingOverage: "true" })).overage, false, "a wrongly typed field is dropped, not trusted");
  assert.deepEqual(classifyClaudeRateLimit(normalizeClaudeRateLimit({ overageStatus: "allowed_warning" })).signals, ["overageStatus=allowed_warning"]);
  assert.equal(classifyClaudeRateLimit(normalizeClaudeRateLimit({ overageStatus: "rejected" })).overage, false);
  assert.equal(classifyClaudeRateLimit(normalizeClaudeRateLimit(null)).overage, false);

  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "claude", attempts: 5 });
    const run = async (scenario) => {
      t.queue("claude", scenario);
      const { run: started } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "claude", access: "read-only", grantId: grant.id, model: "sonnet", actor: "test" });
      return settled(hub, started.id);
    };
    const snapshots = () => hub.db.prepare("SELECT data_json FROM usage_snapshots WHERE provider = 'claude' AND source = 'claude stream-json rate_limit_event'").all().map((r) => JSON.parse(r.data_json));

    const r1 = await run("rate-plain");
    assert.equal(r1.status, "completed", r1.errorMessage);
    assert.equal(snapshots().length, 1);
    assert.equal(snapshots()[0].status, "allowed");
    assert.equal(snapshots()[0].rateLimitType, "five_hour");
    assert.equal(hub.settings.get("billingEvidence").claude.reverify, null);
    assert.equal(hub.settings.get("billingEvidence").claude.reports.length, 0, "a plain report carries no credit field: not billing evidence");

    const r2 = await run("rate-unknown");
    assert.equal(r2.status, "completed", r2.errorMessage);
    assert.deepEqual(snapshots()[1].unknownFields, ["creditsOff", "weirdFlag"]);
    assert.equal(hub.settings.get("billingEvidence").claude.reverify, null);

    const r3 = await run("rate-credits");
    assert.equal(r3.status, "failed");
    assert.equal(r3.errorCategory, "quota");
    assert.match(r3.errorMessage, /credits_required/);
    const afterCredits = hub.settings.get("billingEvidence").claude;
    assert.equal(afterCredits.reverify, null, "credits_required is not an overage signal");
    assert.equal(afterCredits.reports.length, 1);
    assert.equal(afterCredits.reports[0].fields.errorCode, "credits_required");

    const started = Date.now();
    const r4 = await run("rate-overage");
    assert.equal(r4.status, "blocked", r4.errorMessage); // a billing stop is recorded as blocked (existing run-manager mapping of the billing category)
    assert.equal(r4.errorCategory, "billing");
    assert.match(r4.errorMessage, /usage credits \/ overage/);
    assert.ok(Date.now() - started < 4500, "stopped before the fake finished its turn");
    const latched = hub.settings.get("billingEvidence").claude;
    assert.deepEqual(latched.reverify.reasons, ["provider_report_overage"]);
    assert.equal(latched.reverify.by, `run:${r4.id}`);
    assert.deepEqual(latched.reports.at(-1).signals, ["isUsingOverage=true", "rateLimitType=overage", "overageStatus=allowed"]);
    assert.equal(latched.reports.at(-1).accountIdentity.value, hub.providerState.get("claude").auth.accountIdentity.value);
    const ev = hub.bus.query({ typePrefix: "billing.reverify_required", limit: 5 });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].runId, r4.id);
    const blocked = gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id }), "billing_route");
    assert.equal(blocked.ok, false);
    assert.match(blocked.detail, /consum peste plan/);
    // The next Claude run is refused before any process (gate, pre-inference).
    const refusal = await run("ok").then(() => null, (error) => error);
    assert.equal(refusal?.category, "gate");
    const r5 = hub.runs.getRun(refusal.details.runId);
    assert.equal(r5.status, "blocked");
    assert.equal(r5.errorCategory, "gate");
    assert.equal(refusal.details.checks.find((c) => c.id === "billing_route").ok, false);
    assert.equal(t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).length, 4, "no fifth Claude process");
  } finally { await t.cleanup(); }
});

test("M09-BE-07 no clear-text account identifier anywhere: probes, provider state, settings, events and the command log carry only the salted pseudonym; the salt never reaches the API", async () => {
  const t = await makeTestHub();
  const s = await serve(t);
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { provider: "codex" });
    const owner = await enrolOwner(t, { activatePolicy: false });
    const identity = hub.providerState.get("claude").auth.accountIdentity;
    await dispatch(hub, "billing.declare", { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: identity.value }, { channel: "owner", ownerSession: owner.reauth() });
    await dispatch(hub, "provider.probe", { provider: "codex", withModels: false }, { channel: "ui", actor: "user" });
    await dispatch(hub, "billing.withdraw", { provider: "codex" }, { channel: "ui", actor: "user" });
    const dump = JSON.stringify([
      hub.db.prepare("SELECT key, value_json FROM settings").all(), hub.db.prepare("SELECT * FROM events").all(), hub.db.prepare("SELECT * FROM commands").all(),
      hub.db.prepare("SELECT * FROM integration_connections").all(),
    ]);
    assert.ok(!/example\.com/.test(dump), "no fixture e-mail in the database");
    const salt = hub.settings.get("billingIdentitySecret");
    assert.match(salt, /^[0-9a-f]{64}$/);
    const commandsLog = JSON.stringify(hub.db.prepare("SELECT payload_json, result_json FROM commands").all());
    assert.ok(!commandsLog.includes(salt), "the salt is not in the command log");
    const eventsLog = JSON.stringify(hub.db.prepare("SELECT payload_json FROM events").all());
    assert.ok(!eventsLog.includes(salt), "the salt is not in any event");
    const h = { "X-Hub-Token": s.token };
    const settings = await request(t.config.port, { path: "/api/settings", headers: h });
    assert.equal(settings.status, 200);
    assert.equal(settings.json.settings.billingIdentitySecret, undefined);
    assert.ok(!settings.text.includes(salt));
    const patched = await request(t.config.port, { method: "PATCH", path: "/api/settings", headers: h, body: { usageReservePercent: 20 } });
    assert.equal(patched.status, 200, patched.text);
    assert.ok(!patched.text.includes(salt));
    const integrations = await request(t.config.port, { path: "/api/integrations", headers: h });
    assert.ok(!integrations.text.includes(salt) && !/example\.com/.test(integrations.text));
    const claude = integrations.json.providers.find((p) => p.id === "claude");
    assert.equal(claude.billing.state, "valid");
    assert.equal(claude.billing.declaration.source, "owner_session:webauthn");
    assert.equal(claude.billing.declaration.identity.short, identity.value.slice(0, 8));
    assert.equal(claude.billing.currentIdentity.value, identity.value, "the value the page sends back as displayedIdentity");
    assert.equal(claude.auth.accountIdentity, undefined, "the auth line shows only the short pseudonym");
    assert.match(claude.auth.account, /^[0-9a-f]{8} \(pseudonim\)$/);
    const codex = integrations.json.providers.find((p) => p.id === "codex");
    assert.equal(codex.billing.state, "reverify_required");
    assert.deepEqual(codex.billing.reasons, ["latched", "owner_withdrawn"]);
    assert.equal(project.id, hub.projects.hub().id);
  } finally { await s.stop(); await t.cleanup(); }
});

test("M09-BE-08 claude@wsl-runner is compared with its OWN login: another account in the reviewer sandbox blocks that route only", async () => {
  const INSTALLED = { pw_version: "1.61.0", pw_chromium: "chromium_headless_shell-1228", pw_sha: "670ba079b7510774", pw_owner: "runner", claude_cli: "2.1.285",
    claude_path: "/home/runner/tools/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe", claude_sha: "33dad1ec615a2e08", claude_owner: "runner",
    reviewer_config: "present:700", reviewer_creds: "present:600", reviewer_settings: "absent" };
  const t = await makeTestHub({ wsl: { claudeScenario: "other-account", facts: INSTALLED }, queues: true });
  try {
    const { hub } = t;
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    const probe = (await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" })).result;
    assert.equal(probe.reviewer.ok, true, JSON.stringify(probe.reviewer));
    await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" });
    await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
    await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
    hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test"));
    const windowsId = hub.providerState.get("claude").auth.accountIdentity;
    const wslId = hub.providerState.get("claude@wsl-runner").auth.accountIdentity;
    assert.notEqual(windowsId.value, wslId.value, "two logins, two pseudonyms");
    assert.ok(!JSON.stringify(hub.providerState.get("claude@wsl-runner")).includes("example.com"));
    const routed = hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "read-only" });
    assert.equal(routed.environment, "wsl-runner");
    assert.equal(gateCheck(routed, "billing_route").ok, false);
    assert.match(gateCheck(routed, "billing_route").detail, /nu este contul pentru care ai declarat/);
    const windowsGate = hub.gate.evaluate({ provider: "claude", projectId: hub.projects.hub().id, access: "read-only" });
    assert.equal(windowsGate.environment, "windows");
    assert.equal(gateCheck(windowsGate, "billing_route").ok, true, gateCheck(windowsGate, "billing_route").detail);
    // The owner may declare for the reviewer's account (route wsl-runner): then that route passes and Windows no longer does.
    const owner = await enrolOwner(t, { activatePolicy: false });
    await dispatch(hub, "billing.declare", { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: wslId.value, route: "wsl-runner" }, { channel: "owner", ownerSession: owner.reauth() });
    assert.equal(gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "read-only" }), "billing_route").ok, true);
    assert.equal(gateCheck(hub.gate.evaluate({ provider: "claude", projectId: hub.projects.hub().id, access: "read-only" }), "billing_route").ok, false);
    await assert.rejects(dispatch(hub, "billing.declare", { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: windowsId.value, route: "wsl-runner" }, { channel: "owner", ownerSession: owner.reauth() }), /Contul afișat/);
  } finally { await t.cleanup(); }
});

test("M09-BE-09 a factory mission whose Claude declaration was withdrawn stops at review as BLOCKED (billing, not an attempt); after a new declaration it resumes to DELIVERY_READY — the Codex writer was never blocked", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
    hub.bus.transaction(() => {
      hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
      hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    const { mission } = (await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet", maxAttemptsPerStage: 1 } })).result;
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await dispatch(hub, "billing.withdraw", { provider: "claude", reason: "verific creditele" }, { channel: "voice", actor: "voice" });
    const requested = await dispatch(hub, "factory.start", hub.factory.view(mission.id).scope);
    await dispatch(hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await hub.commands.executeApproved(requested.command.id, "user");
    const view = () => hub.factory.view(mission.id);
    const blocked = await waitFor(() => (["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"].includes(view().factory.stage) ? view() : null), 90000, 100);
    assert.equal(blocked.factory.stage, "BLOCKED", blocked.factory.stageReason);
    assert.match(blocked.factory.stageReason, /billing/);
    assert.ok(blocked.dispatches.some((d) => d.stage === "IMPLEMENTING" && d.status === "DONE"), "the Codex writer ran while Claude was blocked");
    assert.equal(t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).length, 0, "no Claude process started");
    await waitFor(() => hub.factory.idle(mission.id).then(() => true), 30000, 100);
    // A new declaration (the owner's, in the owner session) and a plain resume.
    const owner = await enrolOwner(t, { activatePolicy: false });
    await dispatch(hub, "billing.declare", { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: hub.providerState.get("claude").auth.accountIdentity.value }, { channel: "owner", ownerSession: owner.reauth() });
    await dispatch(hub, "factory.resume", { missionId: mission.id }, { channel: "ui", actor: "user" });
    const done = await waitFor(() => (["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"].includes(view().factory.stage) && view().factory.stage !== "BLOCKED" ? view() : null), 90000, 100);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const reviews = done.dispatches.filter((d) => d.stage === "REVIEWING");
    assert.equal(reviews.at(-1).status, "DONE");
    assert.equal(reviews.at(-1).request.counted, 1, "the blocked review was not counted (limit 1 still allowed the real one)");
  } finally { await t.cleanup(); }
});

test("M09-BE-10 a new envelope stays blocked by reviewer:billing_route while Claude needs re-declaring (fail-safe, the reason is shown); after the owner declares, the plan is ready", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    await prepareLiveWithoutGrants(hub);
    const dir = path.join(t.dataDir, "factory-bug-demo");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await dispatch(hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } });
    hub.bus.transaction(() => hub.settings.set("billingEvidence", applyLatch(hub.settings.get("billingEvidence"), "claude", { reason: "legacy_unbound", now: new Date(), by: "hub" }), "test"));
    const blocked = (await dispatch(hub, "envelope.propose", { projectId: project.id })).result;
    const blocker = blocked.readiness.blockers.find((b) => /billing_route/.test(b.id));
    assert.ok(blocker, JSON.stringify(blocked.readiness.blockers));
    assert.match(JSON.stringify(blocker), /nu era legată de un cont/);
    await dispatch(hub, "billing.declare", { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: hub.providerState.get("claude").auth.accountIdentity.value }, { channel: "owner", ownerSession: owner.reauth() });
    const ready = (await dispatch(hub, "envelope.propose", { projectId: project.id })).result;
    assert.ok(!ready.readiness.blockers.some((b) => /billing_route/.test(b.id)), JSON.stringify(ready.readiness.blockers));
  } finally { await t.cleanup(); }
});

test("M09-BE-11 local work continues while Claude is blocked: the Codex gate, a Codex read-only run, backup.run and the probes", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "codex", attempts: 2 });
    await dispatch(hub, "billing.withdraw", { provider: "claude" }, { channel: "voice", actor: "voice" });
    assert.equal(gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id }), "billing_route").ok, false);
    const codexGate = hub.gate.evaluate({ provider: "codex", projectId: project.id });
    assert.equal(codexGate.allowed, true, JSON.stringify(codexGate.checks.filter((c) => !c.ok)));
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: grant.id, model: "gpt-fake-sol", actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "completed", done.errorMessage);
    assert.equal((await dispatch(hub, "backup.run", { projectId: project.id }, { channel: "cli", actor: "cli" })).command.status, "executed");
    assert.equal((await dispatch(hub, "provider.probe", { provider: "claude", withModels: false }, { channel: "ui", actor: "user" })).result.ok, true, "the account check is inference-free and stays available");
    // The probe does not clear the latch: only the owner's declaration does.
    assert.equal(gateCheck(hub.gate.evaluate({ provider: "claude", projectId: project.id }), "billing_route").ok, false);
  } finally { await t.cleanup(); }
});

test("M09-BE-12 the legacy attestation: POST /api/billing/attest answers with a policy error naming the owner route; billing.attest exists on the test channel only; the owner routes need the session for declare, not for withdraw", async () => {
  const t = await makeTestHub();
  const s = await serve(t);
  try {
    const { hub } = t;
    await probeBoth(hub);
    const h = { "X-Hub-Token": s.token };
    const legacy = await request(t.config.port, { method: "POST", path: "/api/billing/attest", headers: h, body: { provider: "claude", confirmText: ATTESTATION_TEXT.claude } });
    assert.equal(legacy.status, 403);
    assert.equal(legacy.json.error.category, "policy");
    assert.match(legacy.json.error.message, /sesiunea ta de proprietar/);
    assert.equal(legacy.json.error.details.ownerRoute, "/api/owner/billing/declare");
    for (const channel of ["ui", "voice", "owner", "cli"]) await assert.rejects(dispatch(hub, "billing.attest", { provider: "codex", confirmText: ATTESTATION_TEXT.codex }, { channel, ownerSession: channel === "owner" ? { id: "x" } : null }), /cannot be issued through|owner channel/, channel);
    const viaTest = await dispatch(hub, "billing.attest", { provider: "codex", confirmText: ATTESTATION_TEXT.codex });
    assert.equal(viaTest.result.declaration.bound, true, "bound to the current probe's account");
    assert.deepEqual(hub.settings.get("billingAttestations"), {}, "the legacy key is never written again");
    const declare = await request(t.config.port, { method: "POST", path: "/api/owner/billing/declare", headers: h, body: { provider: "claude", confirmText: ATTESTATION_TEXT.claude, displayedIdentity: "0123456789abcdef" } });
    assert.equal(declare.status, 401);
    assert.equal(declare.json.error.details.needSession, true);
    const asAgent = await request(t.config.port, { method: "POST", path: "/api/owner/billing/withdraw", headers: { ...h, "X-Hub-Channel": "agent" }, body: { provider: "claude" } });
    assert.equal(asAgent.status, 403, "an agent cannot act through the owner routes");
    const withdraw = await request(t.config.port, { method: "POST", path: "/api/owner/billing/withdraw", headers: h, body: { provider: "claude", reason: "din UI" } });
    assert.equal(withdraw.status, 200, withdraw.text);
    assert.equal(withdraw.json.withdrawn, true);
    assert.equal(hub.settings.get("billingEvidence").claude.reverify.required, true);
  } finally { await s.stop(); await t.cleanup(); }
});
