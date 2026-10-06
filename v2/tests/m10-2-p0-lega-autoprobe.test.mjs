// 2.12.1 (D23, zero-form daily use): the Codex account check („Verifică contul”: provider.probe, inference-free) goes stale after
// 24 h, and a stale check fails the billing_route and isolation checks of gate.evaluateVoice. A DERIVED Lega start (voice-first
// policy + the owner session) now refreshes a stale / failed / missing check by itself right before admission: the SAME command, on
// the automation channel as the readiness step "readiness:lega-start", once per start attempt, bounded and rate-limited; then the
// ordinary admission runs on the real facts. The preview (a GET) never refreshes anything: it marks the checks the start settles
// itself as `auto`. The grant / legacy path is unchanged. Fake app-server only: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor, HUB_ROOT } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { DERIVED_START_LIMIT, ACCOUNT_AUTO_DETAIL, ACCOUNT_REFRESH_TIMEOUT_MS } from "../server/runtime/lega.mjs";
import { inspectionFromState, accountCheckState } from "../server/policy/gate.mjs";
import { legaStartReadiness, legaCheckHint, LEGA_START_CHECKING, LEGA_ACCOUNT_AUTO_HINT } from "../web/src/lib/uiLogic.js";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const HOUR = 3600000;
const AUTO_DETAIL = "Verific singur contul la pornire (câteva secunde, fără inferență).";

/** A hub ready for the one-click start (BUILD_SAFE, gate open, billing + isolation ok, consent, owner session) with a FRESH account check. */
async function ready({ codex = "lega-ok", policy = true, clock, queues = false, configOverrides = {} } = {}) {
  const t = await makeTestHub({ codex, queues, configOverrides, ...(clock ? { clock } : {}) });
  const owner = await enrolOwner(t, { activatePolicy: policy });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  return { t, owner };
}
/** Ages the stored Codex account check (the facts stay; only when it ran changes). Returns the new probedAt. */
const age = (t, hours, patch = {}) => {
  const at = new Date(Date.now() - hours * HOUR).toISOString();
  t.hub.providerState.set("codex", { ...t.hub.providerState.get("codex"), probedAt: at, ...patch });
  return at;
};
const ownerStart = (t, owner, extra = {}) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER, ...extra } }).then((r) => r.result);
const uiStart = (t) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } }).then((r) => r.result);
const say = (t, owner, text, source = "typed") => t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text, source } }).then((x) => x.result.results[0]);
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ ...e, payload: JSON.parse(e.payload_json || "{}") }));
const lastSeq = (t) => t.hub.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM events").get().s;
const commandCount = (t) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n;
const probes = (t) => t.hub.db.prepare("SELECT id, channel, actor, status, intent_text, result_json FROM commands WHERE type = 'provider.probe' ORDER BY rowid").all();
const settingsRows = (t) => JSON.stringify(t.hub.db.prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key").all());
const voiceGrants = (t) => t.hub.grants.list().filter((g) => g.kind === "voice");
const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.id);
const check = (checks, id) => checks.find((c) => c.id === id);
const suspendGate = (t) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Stop All", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
const openGate = (t) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
const stopAndClean = async (t) => { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); };
/** A Codex account check that does not succeed (the command still runs for real: its row, its event, the stored state). */
const failingProbe = (t, error = "codex app-server exited (1)") => async () => ({ provider: "codex", environment: "windows", probedAt: new Date().toISOString(), config: t.hub.providers.codex.inspectConfig(), ok: false, error, errorCategory: "transport" });

test("LA-01 a stale account check + a derived start: exactly ONE provider.probe (automation, readiness:lega-start), then the session starts on the fresh facts; audited", async () => {
  const { t, owner } = await ready();
  try {
    age(t, 25);
    assert.equal(t.hub.gate.evaluateVoice({ ownerAuthority: { sessionId: owner.session.id, maxDurationS: 600 } }).allowed, false, "a stale check alone refuses the start");
    const m0 = lastSeq(t);
    const r = await ownerStart(t, owner);
    assert.ok(r.answerSdp && r.sessionId);
    assert.equal(r.authority, "owner_session");
    const p = probes(t);
    assert.equal(p.length, 1, "exactly one account check");
    assert.equal(p[0].channel, "automation");
    assert.equal(p[0].actor, "readiness:lega-start");
    assert.equal(p[0].status, "executed");
    assert.equal(JSON.parse(p[0].result_json).ok, true);
    assert.match(p[0].intent_text, /fără inferență/);
    const refreshed = events(t, "lega.account_refreshed");
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].source, "readiness:lega-start");
    assert.equal(refreshed[0].payload.ok, true);
    assert.equal(refreshed[0].payload.state, "stale");
    assert.ok(refreshed[0].payload.ageHours >= 24.9 && refreshed[0].payload.ageHours <= 25.2, `ageHours ${refreshed[0].payload.ageHours}`);
    assert.equal(refreshed[0].payload.ownerSessionId, owner.session.id);
    assert.equal(refreshed[0].payload.commandId, p[0].id);
    assert.equal(refreshed[0].payload.late, false, "the start that ran it was still waiting");
    assert.deepEqual(Object.keys(refreshed[0].payload).sort(), ["ageHours", "commandId", "errorCategory", "late", "ok", "ownerSessionId", "reason", "state", "waitedMs"], "no account data in the audit record");
    assert.doesNotMatch(JSON.stringify(refreshed[0].payload), /example\.com|accountIdentity|planType|chatgpt/);
    // LA-REV-02: the chain start → probe row → audit records joins on ONE correlation id (the start command's).
    const startRow = t.hub.db.prepare("SELECT id, correlation_id FROM commands WHERE type = 'lega.session.start'").get();
    const probeRow = t.hub.db.prepare("SELECT correlation_id FROM commands WHERE id = ?").get(p[0].id);
    assert.equal(probeRow.correlation_id, startRow.correlation_id, "the probe command carries the start's correlation id");
    const started = events(t, "lega.account_refresh_started");
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].payload, { ownerSessionId: owner.session.id, state: "stale", ageHours: refreshed[0].payload.ageHours });
    assert.equal(started[0].source, "readiness:lega-start");
    for (const ev of [started[0], refreshed[0]]) assert.equal(ev.correlation_id, startRow.correlation_id, `${ev.type} joins the start`);
    assert.deepEqual(t.hub.db.prepare("SELECT DISTINCT correlation_id FROM events WHERE scope_type = 'command' AND scope_id = ?").all(p[0].id).map((r) => r.correlation_id), [startRow.correlation_id], "the probe's own events too");
    // The check ran BEFORE the authority was derived, and the admission read its result.
    const order = t.hub.db.prepare("SELECT type FROM events WHERE seq > ? AND type IN ('lega.account_refresh_started','provider.probed','lega.account_refreshed','lega.authority_derived','lega.session.starting') ORDER BY seq").all(m0).map((e) => e.type);
    assert.deepEqual(order, ["lega.account_refresh_started", "provider.probed", "lega.account_refreshed", "lega.authority_derived", "lega.session.starting"]);
    assert.ok(Date.parse(t.hub.providerState.get("codex").probedAt) > Date.now() - 60000, "the stored account check is fresh now");
    const starting = events(t, "lega.session.starting").at(-1).payload;
    assert.equal(starting.accountRefreshed, true);
    assert.deepEqual(starting.accountRefresh, { commandId: p[0].id, late: false }, "the admission names the check it read");
    // The probe counter sees an automatic readiness step, not something the owner did by hand.
    const report = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(report.counters.automaticReadinessSteps, 1);
    assert.equal(report.evidence.automaticReadinessSteps.items[0].type, "provider.probe");
    assert.equal(report.counters.manualModeChanges + report.counters.manualGrantCreates + report.counters.grantFormsOpened, 0);
    // Nothing else changed: BUILD_SAFE, one derived grant born exhausted, the start itself on the owner channel.
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(voiceGrants(t).length, 1);
    assert.equal(voiceGrants(t)[0].status, "exhausted");
    assert.equal(events(t, "lega.authority_derived").length, 1);
    assert.equal(t.hub.lega.state().authority, "owner_session");
    assert.deepEqual(t.hub.db.prepare("SELECT type, channel FROM commands WHERE type IN ('grant.create','mode.set','gate.set','lega.session.start','provider.probe') ORDER BY rowid").all().map((c) => `${c.type}:${c.channel}`),
      ["lega.session.start:owner", "provider.probe:automation"]);
  } finally { await stopAndClean(t); }
});

test("LA-02 a fresh account check: no extra probe, no audit record, the start as before (23.9 h is still fresh)", async () => {
  const { t, owner } = await ready();
  try {
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.allowed, true);
    assert.deepEqual(pv.accountRefresh.needed, false);
    assert.equal(pv.accountRefresh.state, "fresh");
    assert.ok(!pv.checks.some((c) => c.auto || c.autoDetail || "refreshable" in c));
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(probes(t).length, 0);
    assert.equal(events(t, "lega.account_refreshed").length, 0);
    assert.equal(events(t, "lega.session.starting").at(-1).payload.accountRefreshed, undefined);
    await t.hub.lega.stopAll("test");
    age(t, 23.9);
    const again = await ownerStart(t, owner);
    assert.equal(again.authority, "owner_session");
    assert.equal(probes(t).length, 0, "younger than 24 h: nothing to refresh");
  } finally { await stopAndClean(t); }
});

test("LA-03 the refresh fails: refused with the honest reason, no session, nothing derived, no attempt consumed; the next start tries again and passes once the provider answers", async () => {
  const { t, owner } = await ready();
  const real = t.hub.providers.codex.probe;
  try {
    age(t, 30);
    // (1) the check cannot even run (the client is not found): the command fails, the stored state stays stale.
    const realInstall = t.hub.providers.codex.inspectInstallation;
    t.hub.providers.codex.inspectInstallation = async () => ({ provider: "codex", installed: false, reason: "codex.exe not found (fixture)" });
    let e = await ownerStart(t, owner).catch((x) => x);
    t.hub.providers.codex.inspectInstallation = realInstall;
    assert.equal(e.category, "gate");
    assert.match(e.message, /Lega nu a pornit: verificarea automată a contului Codex a eșuat \(codex\.exe not found \(fixture\)\)/);
    assert.deepEqual(e.details.accountRefresh, { attempted: true, ok: false, reason: "failed" });
    assert.equal(probes(t).length, 1);
    assert.equal(probes(t)[0].status, "failed");
    assert.equal(t.hub.lega.preview({ ownerSessionId: owner.session.id }).accountRefresh.state, "stale");
    // (2) the check runs and does not succeed.
    t.hub.providers.codex.probe = failingProbe(t);
    e = await ownerStart(t, owner).catch((x) => x);
    assert.equal(e.category, "gate");
    assert.match(e.message, /Lega nu a pornit: verificarea automată a contului Codex a eșuat \(codex app-server exited \(1\)\)\. Apasă din nou „Pornește Lega”/);
    assert.deepEqual(e.details.accountRefresh, { attempted: true, ok: false, reason: "failed" });
    assert.ok(failing(e.details.checks).includes("billing_route"), "the real checks, on the real facts");
    assert.equal(t.hub.lega.active(), false);
    assert.equal(t.hub.lega.state(), null, "no session was ever created");
    assert.equal(voiceGrants(t).length, 0, "no grant derived");
    for (const type of ["lega.authority_derived", "lega.attempt_consumed", "lega.session.starting"]) assert.equal(events(t, type).length, 0, type);
    assert.equal(probes(t).length, 2, "one check per start attempt");
    assert.deepEqual(probes(t).map((p) => `${p.channel}:${p.actor}`), ["automation:readiness:lega-start", "automation:readiness:lega-start"]);
    const audit = events(t, "lega.account_refreshed");
    assert.deepEqual(audit.map((a) => [a.payload.ok, a.payload.reason, a.payload.state, a.payload.late]), [[false, "failed", "stale", false], [false, "failed", "stale", false]]);
    // LA-REV-02: the audit names the probe row even when the command FAILED (its id is known from the dispatch, not from a result).
    assert.deepEqual(audit.map((a) => a.payload.commandId), probes(t).map((p) => p.id));
    assert.equal(events(t, "provider.unavailable").length, 1, "the check's own record of the failure");
    const refusal = events(t, "lega.session.refused").at(-1).payload;
    assert.deepEqual(refusal.accountRefresh, { attempted: true, ok: false, reason: "failed", commandId: probes(t)[1].id });
    assert.equal(refusal.authority, "owner_session");
    // The start limit counts derived starts only: none happened.
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.derivedStartsLeft, DERIVED_START_LIMIT.count);
    // (3) the failed check is still the Hub's to redo (not a pointer to Integrări): the next start tries again and passes.
    assert.equal(pv.accountRefresh.state, "failed");
    assert.equal(pv.accountRefresh.needed, true);
    assert.equal(check(pv.checks, "billing_route").auto, true);
    t.hub.providers.codex.probe = real;
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(probes(t).length, 3);
    assert.equal(events(t, "lega.account_refreshed").at(-1).payload.state, "failed");
    assert.equal(events(t, "lega.account_refreshed").at(-1).payload.ok, true);
  } finally { t.hub.providers.codex.probe = real; await stopAndClean(t); }
});

test("LA-03b the refresh succeeds but the account itself fails a check: refused on the real, fresh facts (named), and nothing is probed again", async () => {
  const { t, owner } = await ready({ queues: true });
  try {
    age(t, 26);
    t.queue("codex", "noauth"); // the next app-server process (the automatic check) finds no ChatGPT account
    const e = await ownerStart(t, owner).catch((x) => x);
    assert.equal(e.category, "gate");
    // LA-REV-04: the message (persisted in the command row and command.failed) names the failing checks by id; what they say — the
    // account type, the plan — travels only in the response (`reasonDetail`, `checks`), which the page shows next to the message.
    assert.equal(e.message, "Am verificat contul Codex, dar Lega tot nu poate porni: billing_route");
    assert.match(e.details.reasonDetail, /Tip de cont Codex nesuportat/);
    assert.deepEqual(e.details.accountRefresh, { attempted: true, ok: true, reason: null });
    assert.deepEqual(failing(e.details.checks), ["billing_route"]);
    assert.equal(check(e.details.checks, "billing_route").auto, undefined, "a real blocker on fresh facts");
    const startRow = t.hub.db.prepare("SELECT status, error FROM commands WHERE type = 'lega.session.start' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(startRow.status, "failed");
    assert.equal(startRow.error, e.message);
    assert.doesNotMatch(startRow.error, /Tip de cont|plan|Necesar/, "no account sub-check text persisted");
    assert.doesNotMatch(events(t, "command.failed").at(-1).payload.message, /Tip de cont|plan|Necesar/);
    assert.equal(t.hub.lega.active(), false);
    assert.equal(voiceGrants(t).length, 0);
    assert.equal(events(t, "lega.authority_derived").length, 0);
    assert.equal(probes(t).length, 1);
    assert.equal(events(t, "lega.account_refreshed")[0].payload.ok, true, "the CHECK succeeded; the admission refused");
    // Fresh now: the blocker is plain, and another click spends no probe.
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.accountRefresh.state, "fresh");
    assert.equal(pv.accountRefresh.needed, false);
    assert.equal(check(pv.checks, "billing_route").auto, undefined);
    const again = await ownerStart(t, owner).catch((x) => x);
    assert.equal(again.message, "Poarta a refuzat sesiunea Lega");
    assert.equal(again.details.accountRefresh, undefined);
    assert.equal(probes(t).length, 1);
  } finally { await stopAndClean(t); }
});

test("LA-03c bounded: the start waits at most the timeout, a second attempt joins the check in flight (one probe), and the late result serves the next start", async () => {
  const { t, owner } = await ready({ configOverrides: { legaTimeScale: 0.01 } }); // the 30 s wait becomes 300 ms
  const real = t.hub.providers.codex.probe;
  try {
    assert.ok(ACCOUNT_REFRESH_TIMEOUT_MS <= 30000, "the wait is at most 30 s");
    age(t, 48);
    let calls = 0;
    t.hub.providers.codex.probe = async (options) => { calls += 1; await new Promise((r) => setTimeout(r, 1500)); return real(options); };
    const started = Date.now();
    const [a, b] = await Promise.all([ownerStart(t, owner).catch((x) => x), new Promise((r) => setTimeout(r, 60)).then(() => ownerStart(t, owner).catch((x) => x))]);
    assert.ok(Date.now() - started < 1400, "neither attempt waited for the slow check");
    for (const e of [a, b]) {
      assert.equal(e.category, "gate");
      assert.match(e.message, /verificarea automată a contului Codex nu a răspuns în 30 s/);
      assert.deepEqual(e.details.accountRefresh, { attempted: true, ok: false, reason: "timeout" });
    }
    // The join witness is the command row (written synchronously by the dispatch), not the stubbed probe: provider.probe first awaits
    // inspectInstallation (a child process), so `calls` may still be 0 here (LA-REV-01 / LA-R2).
    assert.equal(probes(t).length, 1, "the second attempt joined the check in flight (one command row)");
    // LA-REV-02: nothing is written at the timeout — the audit record comes when the check settles, with its command id; the two refusals
    // carry the command id of the check they waited for.
    assert.deepEqual(events(t, "lega.account_refreshed"), [], "no audit record with the result unknown");
    assert.equal(events(t, "lega.account_refresh_started").length, 1);
    const refusals = events(t, "lega.session.refused").slice(-2).map((x) => x.payload.accountRefresh);
    assert.deepEqual(refusals, [{ attempted: true, ok: false, reason: "timeout", commandId: probes(t)[0].id }, { attempted: true, ok: false, reason: "timeout", commandId: probes(t)[0].id }]);
    assert.equal(t.hub.lega.active(), false);
    assert.equal(voiceGrants(t).length, 0);
    // The check was not interrupted: it ends in the background (audited as late, under the first start's correlation id), and the next
    // start reads its result without another probe — and says it was admitted on that late check.
    await waitFor(() => probes(t)[0].status === "executed", 10000);
    assert.equal(calls, 1, "exactly one check ran");
    await waitFor(() => events(t, "lega.account_refreshed").length === 1, 5000);
    const settled = events(t, "lega.account_refreshed")[0];
    assert.deepEqual([settled.payload.ok, settled.payload.reason, settled.payload.late, settled.payload.commandId], [true, null, true, probes(t)[0].id]);
    assert.equal(settled.correlation_id, t.hub.db.prepare("SELECT correlation_id FROM commands WHERE type = 'lega.session.start' ORDER BY rowid").get().correlation_id, "joins the start that ran it");
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(calls, 1);
    assert.equal(probes(t).length, 1);
    assert.deepEqual(events(t, "lega.session.starting").at(-1).payload.accountRefresh, { commandId: probes(t)[0].id, late: true });
  } finally { t.hub.providers.codex.probe = real; await stopAndClean(t); }
});

test("LA-03e two starts at once on a stale check: one probe, ONE session and one derived grant; the other start is refused as a conflict (decided again after the check)", async () => {
  const { t, owner } = await ready();
  try {
    age(t, 25);
    const [a, b] = await Promise.all([ownerStart(t, owner).catch((x) => x), ownerStart(t, owner).catch((x) => x)]);
    const started = [a, b].filter((x) => x?.sessionId);
    const refused = [a, b].filter((x) => x instanceof Error);
    assert.equal(started.length, 1, JSON.stringify([a?.message, b?.message]));
    assert.equal(refused.length, 1);
    assert.equal(refused[0].category, "conflict");
    assert.match(refused[0].message, /Lega are deja o sesiune activă/);
    assert.equal(probes(t).length, 1, "the second start joined the check in flight");
    assert.equal(events(t, "lega.account_refreshed").length, 1);
    assert.equal(voiceGrants(t).length, 1, "two tabs cannot derive twice");
    assert.equal(events(t, "lega.authority_derived").length, 1);
  } finally { await stopAndClean(t); }
});

test("LA-03d bounded: at most the derived-start limit of automatic checks per owner session per window (from the audit); then the reason says so and nothing is probed", async () => {
  let offset = 0;
  const { t, owner } = await ready({ clock: () => new Date(Date.now() + offset) });
  const real = t.hub.providers.codex.probe;
  try {
    age(t, 25);
    t.hub.providers.codex.probe = failingProbe(t);
    for (let i = 0; i < DERIVED_START_LIMIT.count; i += 1) {
      const e = await ownerStart(t, owner).catch((x) => x);
      assert.match(e.message, /a eșuat/, `attempt ${i + 1}`);
    }
    assert.equal(probes(t).length, DERIVED_START_LIMIT.count);
    // Before the limit the read side promised the automatic check (one start left): auto marks, ready, the intake's note.
    assert.equal(events(t, "lega.account_refresh_started").length, DERIVED_START_LIMIT.count, "the limit counts probes dispatched");
    const limited = await ownerStart(t, owner).catch((x) => x);
    assert.equal(limited.category, "gate");
    assert.match(limited.message, new RegExp(`^Lega nu a pornit: am încercat deja de ${DERIVED_START_LIMIT.count} ori în ${DERIVED_START_LIMIT.windowMs / 60000} minute să verific singur contul Codex; mai încearcă peste \\d+ s`));
    assert.deepEqual(limited.details.accountRefresh, { attempted: false, ok: false, reason: "limited" });
    assert.ok(limited.details.retryAfterS > 0);
    assert.equal(check(limited.details.checks, "account_refresh_rate").ok, false);
    assert.equal(probes(t).length, DERIVED_START_LIMIT.count, "no probe past the limit");
    assert.equal(events(t, "lega.account_refreshed").length, DERIVED_START_LIMIT.count);
    assert.equal(events(t, "lega.account_refresh_started").length, DERIVED_START_LIMIT.count, "nothing dispatched past the limit");
    assert.deepEqual(events(t, "lega.session.refused").at(-1).payload.accountRefresh, { attempted: false, ok: false, reason: "limited", commandId: null, retryAfterS: limited.details.retryAfterS });
    assert.equal(voiceGrants(t).length, 0);
    // LA-REV-03: the read side stops promising what the start will not do for the rest of the window — the preview marks nothing `auto`
    // (the account checks are `limited`) and adds the honest blocker; the page blocks on it; the intent names the wait, not the account.
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.accountRefresh.needed, false);
    assert.equal(pv.accountRefresh.limited, true);
    assert.ok(pv.accountRefresh.retryAfterS > 0 && pv.accountRefresh.retryAfterS <= DERIVED_START_LIMIT.windowMs / 1000);
    assert.equal(pv.accountRefresh.state, "failed");
    assert.ok(!pv.checks.some((c) => c.auto), "nothing is promised as automatic");
    for (const id of ["billing_route", "isolation"]) { assert.equal(check(pv.checks, id).ok, false, id); assert.equal(check(pv.checks, id).limited, true, id); }
    const rate = check(pv.checks, "account_refresh_rate");
    assert.equal(rate.ok, false);
    assert.equal(rate.retryAfterS, pv.accountRefresh.retryAfterS);
    assert.match(rate.detail, new RegExp(`^Am încercat deja de ${DERIVED_START_LIMIT.count} ori în ${DERIVED_START_LIMIT.windowMs / 60000} minute să verific singur contul Codex; mai încearcă peste ${rate.retryAfterS} s sau rulează „Verifică contul” în Integrări → Codex\\.$`));
    const rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: pv });
    assert.equal(rd.ready, false);
    assert.equal(rd.accountCheck, false);
    assert.deepEqual(rd.blocking.map((c) => c.id), ["account_refresh_rate"], "the rate check is the one blocker; the limited checks' own hints are not shown");
    assert.deepEqual(rd.limited.map((c) => c.id), ["billing_route", "isolation"]);
    assert.match(legaCheckHint("account_refresh_rate"), /Verifică contul.*Integrări → Codex/);
    const said = await say(t, owner, "Pornește Lega");
    assert.ok(!said.legaStart, "the intent does not promise a start that will be refused");
    assert.match(said.message, /^Lega nu poate porni încă: Am încercat deja de \d+ ori/);
    assert.doesNotMatch(said.message, /Verific singur contul Codex la pornire|Pornesc Lega/);
    assert.equal(probes(t).length, DERIVED_START_LIMIT.count);
    // After the window the Hub checks again by itself (and promises it again).
    offset += DERIVED_START_LIMIT.windowMs + 1000;
    t.hub.db.prepare("UPDATE owner_sessions SET last_seen_at = ? WHERE id = ?").run(new Date(Date.now() + offset).toISOString(), owner.session.id);
    t.hub.providers.codex.probe = real;
    const after = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.deepEqual([after.accountRefresh.needed, after.accountRefresh.limited, after.accountRefresh.retryAfterS], [true, false, 0]);
    assert.equal(check(after.checks, "billing_route").auto, true);
    assert.equal(check(after.checks, "account_refresh_rate"), undefined);
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(probes(t).length, DERIVED_START_LIMIT.count + 1);
  } finally { t.hub.providers.codex.probe = real; await stopAndClean(t); }
});

test("LA-04 the preview with a stale check is a read: no command, no event, no settings change; the affected checks are auto, a check failing on the last known facts is not", async () => {
  const { t, owner } = await ready();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = "", headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  const { SESSION_COOKIE } = await import("../server/owner/trust.mjs");
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.token)}`;
  try {
    const checkedAt = age(t, 25);
    const before = { seq: lastSeq(t), commands: commandCount(t), settings: settingsRows(t), grants: t.hub.grants.list().length };
    const p = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    const viaGet = (await call("GET", "/api/lega", { cookie })).json;
    const noCookie = (await call("GET", "/api/lega")).json;
    assert.deepEqual({ seq: lastSeq(t), commands: commandCount(t), settings: settingsRows(t), grants: t.hub.grants.list().length }, before, "a GET never causes a side effect");
    assert.equal(probes(t).length, 0);
    assert.equal(t.hub.providerState.get("codex").probedAt, checkedAt, "the account check was not refreshed");
    for (const view of [p, viaGet.preview]) {
      assert.equal(view.authority, "owner_session");
      assert.equal(view.allowed, false, "the gate's real verdict is not embellished");
      assert.deepEqual(failing(view.checks), ["billing_route", "isolation"]);
      for (const id of ["billing_route", "isolation"]) {
        assert.equal(check(view.checks, id).auto, true, id);
        assert.equal(check(view.checks, id).autoDetail, AUTO_DETAIL, id);
        assert.equal("refreshable" in check(view.checks, id), false);
      }
      assert.deepEqual(view.accountRefresh, { needed: true, state: "stale", lastCheckedAt: checkedAt, ageHours: 25, limited: false, retryAfterS: 0 });
      assert.doesNotMatch(JSON.stringify(view.accountRefresh), /example\.com|accountIdentity/);
    }
    assert.equal(ACCOUNT_AUTO_DETAIL, AUTO_DETAIL);
    // Without the cookie the click will open the owner session and THEN derive: the same marks (mode / voice_grant stay plain).
    assert.equal(noCookie.owner.session, false);
    assert.deepEqual(failing(noCookie.preview.checks), ["mode", "voice_grant", "billing_route", "isolation"]);
    assert.deepEqual(noCookie.preview.checks.filter((c) => c.auto).map((c) => c.id), ["billing_route", "isolation"]);
    assert.equal(noCookie.preview.accountRefresh.needed, true);
    // A check that fails on the last known facts too is a plain blocker (here: the billing declaration withdrawn).
    await t.hub.commands.dispatch({ type: "billing.withdraw", channel: "ui", actor: "user", payload: { provider: "codex", reason: "test" } });
    const withdrawn = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(check(withdrawn.checks, "billing_route").ok, false);
    assert.equal(check(withdrawn.checks, "billing_route").auto, undefined, "withdrawn: not something a check of the account fixes");
    assert.equal(check(withdrawn.checks, "billing_route").autoDetail, undefined);
    assert.equal(check(withdrawn.checks, "isolation").auto, true);
    // …and the start does not spend a probe on it.
    const m1 = commandCount(t);
    const refused = await call("POST", "/api/lega/sessions", { body: { sdp: OFFER, expectWebSearch: withdrawn.webSearch }, cookie });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.message, "Poarta a refuzat sesiunea Lega");
    assert.equal(commandCount(t), m1 + 1, "only the start command itself");
    assert.equal(probes(t).length, 0);
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await stopAndClean(t); }
});

test("LA-04b HTTP end to end: the cookie's POST refreshes the stale check on the automation channel and answers 201", async () => {
  const { t, owner } = await ready();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const { SESSION_COOKIE } = await import("../server/owner/trust.mjs");
  const post = (body, headers = {}) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method: "POST", path: "/api/lega/sessions", headers: { Host: host, Origin: `http://${host}`, "X-Hub-Token": token,
      "Content-Type": "application/json", "Content-Length": data.length, Cookie: `${SESSION_COOKIE}=${encodeURIComponent(owner.token)}`, ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); req.write(data); req.end();
  });
  try {
    age(t, 25);
    const webSearch = t.hub.lega.preview({ ownerSessionId: owner.session.id }).webSearch;
    // LA-07 (HTTP): a declared cli / agent channel is refused before anything; no probe.
    for (const channel of ["cli", "agent"]) {
      const refused = await post({ sdp: OFFER, expectWebSearch: webSearch }, { "X-Hub-Channel": channel, "X-Hub-Delegation": "delegare de test pentru canalul agent" });
      assert.equal(refused.status, 403, channel);
    }
    assert.equal(probes(t).length, 0);
    const ok = await post({ sdp: OFFER, expectWebSearch: webSearch });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.ok(ok.json.answerSdp);
    assert.deepEqual(probes(t).map((p) => `${p.channel}:${p.actor}:${p.status}`), ["automation:readiness:lega-start:executed"]);
    const row = t.hub.db.prepare("SELECT channel, actor FROM commands WHERE type = 'lega.session.start' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(row.channel, "owner");
    assert.equal(row.actor, `owner:${owner.session.id}`);
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await stopAndClean(t); }
});

test("LA-05 the grant / legacy path with a stale check is refused as before: no automatic probe, no auto marks, the hand grant untouched", async () => {
  // (1) legacy policy: the owner channel falls back to the old path.
  const legacy = await ready({ policy: false });
  try {
    const { t, owner } = legacy;
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    const hand = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    age(t, 25);
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.equal(pv.authority, "grant");
    assert.deepEqual(failing(pv.checks), ["billing_route", "isolation"]);
    assert.ok(!pv.checks.some((c) => c.auto || c.autoDetail || "refreshable" in c), "nothing is automatic on the old path");
    assert.deepEqual(pv.accountRefresh, { needed: false, state: "stale", lastCheckedAt: t.hub.providerState.get("codex").probedAt, ageHours: 25, limited: false, retryAfterS: 0 });
    for (const start of [() => ownerStart(t, owner), () => uiStart(t)]) {
      const e = await start().catch((x) => x);
      assert.equal(e.category, "gate");
      assert.equal(e.message, "Poarta a refuzat sesiunea Lega");
      assert.deepEqual(failing(e.details.checks), ["billing_route", "isolation"]);
      assert.ok(!e.details.checks.some((c) => c.auto || "refreshable" in c));
      assert.equal(e.details.accountRefresh, undefined);
      assert.equal(e.details.needSession, undefined);
    }
    assert.equal(probes(t).length, 0, "no automatic probe on the old path");
    assert.equal(events(t, "lega.account_refreshed").length, 0);
    assert.equal(t.hub.grants.get(hand.id).attemptsUsed, 0);
    assert.equal(t.hub.lega.active(), false);
    // The owner's own „Verifică contul” still fixes it, exactly as before.
    await t.hub.commands.dispatch({ type: "provider.probe", channel: "ui", actor: "user", payload: { provider: "codex" } });
    const r = await uiStart(t);
    assert.equal(r.authority, "grant");
    assert.equal(t.hub.grants.get(hand.id).attemptsUsed, 1);
  } finally { await stopAndClean(legacy.t); }
  // (2) voice-first policy, but the start arrives WITHOUT the owner session (the ui channel): the grant path, no refresh — only a
  //     derived start checks the account. The refusal says what the page needs: open the session.
  const { t } = await ready();
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    const hand = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    age(t, 25);
    const e = await uiStart(t).catch((x) => x);
    assert.equal(e.category, "gate");
    assert.equal(e.message, "Poarta a refuzat sesiunea Lega");
    assert.deepEqual(failing(e.details.checks), ["billing_route", "isolation"]);
    assert.equal(e.details.needSession, true, "the one-click path (the owner session) is what settles the account check");
    assert.equal(e.details.accountRefresh, undefined);
    assert.equal(probes(t).length, 0);
    assert.equal(events(t, "lega.account_refreshed").length, 0);
    assert.equal(t.hub.grants.get(hand.id).attemptsUsed, 0);
  } finally { await stopAndClean(t); }
});

test("LA-06 „Pornește Lega” with a stale check: legaStart (not a blockers message), the answer says the Hub checks the account itself; nothing is probed by the intent", async () => {
  const { t, owner } = await ready();
  try {
    age(t, 25);
    const before = { commandsOfProbe: probes(t).length, events: events(t, "lega.account_refreshed").length };
    const r = await say(t, owner, "Pornește Lega");
    assert.equal(r.intent, "lega_start");
    assert.equal(r.legaStart, true, JSON.stringify(r));
    assert.match(r.message, /^Pornesc Lega în sesiunea ta .*Verific singur contul Codex la pornire \(câteva secunde, fără inferență\)\./);
    assert.doesNotMatch(r.message, /Integrări|nu poate porni/);
    assert.deepEqual({ commandsOfProbe: probes(t).length, events: events(t, "lega.account_refreshed").length }, before, "the intent is a read");
    assert.equal(t.hub.lega.active(), false, "the server starts nothing from an intent");
    // A provider transcript never starts Lega (and so never reaches the refresh).
    const provider = await say(t, owner, "Pornește Lega", "voice-provider");
    assert.ok(provider.refused && !provider.legaStart);
    // A real blocker next to the stale check: the blockers message names it — and only it (the account check is the Hub's).
    await t.hub.commands.dispatch({ type: "billing.withdraw", channel: "ui", actor: "user", payload: { provider: "codex", reason: "test" } });
    const blocked = await say(t, owner, "Pornește Lega");
    assert.ok(!blocked.legaStart);
    assert.match(blocked.message, /^Lega nu poate porni încă: .*ai retras declarația/);
    assert.doesNotMatch(blocked.message, /sandbox|SECURITY_BLOCKER/, "the auto isolation check is not listed as a blocker");
    assert.equal(probes(t).length, 0);
  } finally { await stopAndClean(t); }
});

test("LA-07 agent / cli / voice (and every other non-owner channel) cannot trigger the refresh: the start is refused by the channel rules, nothing is probed", async () => {
  const { t, owner } = await ready();
  try {
    age(t, 25);
    for (const channel of ["voice", "companion", "cli", "automation", "schedule", "recovery"]) {
      await assert.rejects(t.hub.commands.dispatch({ type: "lega.session.start", channel, actor: channel, ownerSession: owner.session, payload: { sdp: OFFER } }), /cannot be issued through/, channel);
    }
    await assert.rejects(t.hub.commands.dispatch({ type: "lega.session.start", channel: "agent", actor: "agent", delegation: "delegare de test pentru canalul agent", ownerSession: owner.session, payload: { sdp: OFFER } }), /cannot be issued through agent \(not delegated\)/);
    // The account check itself is not a voice / cli / agent command either.
    for (const channel of ["voice", "companion", "cli", "schedule"]) await assert.rejects(t.hub.commands.dispatch({ type: "provider.probe", channel, actor: channel, payload: { provider: "codex" } }), /cannot be issued through/, channel);
    await assert.rejects(t.hub.commands.dispatch({ type: "provider.probe", channel: "agent", actor: "agent", delegation: "delegare de test pentru canalul agent", payload: { provider: "codex" } }), /not delegated/);
    // A forged owner session on the test channel: refused on the session, before any refresh.
    await assert.rejects(t.hub.commands.dispatch({ type: "lega.session.start", channel: "test", actor: "t", ownerSession: { id: "osn_forged" }, payload: { sdp: OFFER } }), (e) => e.category === "authentication" && e.details?.needSession === true);
    assert.equal(probes(t).length, 0);
    assert.equal(events(t, "lega.account_refreshed").length, 0);
    assert.equal(t.hub.lega.active(), false);
    assert.equal(voiceGrants(t).length, 0);
    assert.ok(Date.parse(t.hub.providerState.get("codex").probedAt) < Date.now() - 24 * HOUR, "still stale: nobody refreshed it");
  } finally { await stopAndClean(t); }
});

test("LA-08 legaStartReadiness: auto checks never block (ready, the start says it checks the account), a real blocker still blocks; the panel wiring", () => {
  const checks = (failed, auto = []) => ["execution_gate", "mode", "voice_grant", "lega_consent", "billing_route", "isolation"].map((id) => ({ id, ok: !failed.includes(id) && !auto.includes(id), detail: id,
    ...(auto.includes(id) ? { auto: true, autoDetail: AUTO_DETAIL } : {}) }));
  // In the owner session: only the stale account check is unmet → ready, nothing blocks, the start checks the account.
  let rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", allowed: false, checks: checks([], ["billing_route", "isolation"]), accountRefresh: { needed: true } } });
  assert.deepEqual(rd.blocking, []);
  assert.deepEqual(rd.failed, []);
  assert.equal(rd.ready, true);
  assert.equal(rd.accountCheck, true);
  assert.equal(rd.needsSession, false);
  assert.equal(rd.needsPolicy, false);
  assert.deepEqual(rd.auto.map((c) => c.id), ["billing_route", "isolation"]);
  // A real blocker still blocks (and is the only thing listed); the account check stays the Hub's.
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: checks(["lega_consent"], ["billing_route", "isolation"]) } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["lega_consent"]);
  assert.equal(rd.ready, false);
  assert.equal(rd.accountCheck, false, "nothing is checked while a real blocker stands");
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: checks(["execution_gate"], ["billing_route"]) } });
  assert.equal(rd.gateSuspended, true);
  assert.deepEqual(rd.blocking.map((c) => c.id), ["execution_gate"]);
  // The same check failing WITHOUT the mark (it fails on the last known facts too) is a real blocker.
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: checks(["billing_route"], ["isolation"]) } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["billing_route"]);
  assert.equal(rd.accountCheck, false);
  // No owner session yet: the click opens it first (only a derived start checks the account); nothing blocks.
  rd = legaStartReadiness({ owner: { session: false, policyActive: true }, preview: { checks: checks(["mode", "voice_grant"], ["billing_route", "isolation"]) } });
  assert.deepEqual(rd.blocking, []);
  assert.equal(rd.needsSession, true);
  assert.equal(rd.accountCheck, true);
  // Old-path authority under voice-first without a session (LIVE_VALIDATION + a hand grant): the session is still what is needed.
  rd = legaStartReadiness({ owner: { session: false, policyActive: true }, preview: { checks: checks([], ["billing_route", "isolation"]) } });
  assert.equal(rd.needsSession, true);
  // Legacy policy: the Hub marks nothing; a stale check blocks exactly as before.
  rd = legaStartReadiness({ owner: { session: true, policyActive: false }, preview: { checks: checks(["billing_route", "isolation"]) } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["billing_route", "isolation"]);
  assert.equal(rd.accountCheck, false);
  assert.deepEqual(rd.auto, []);
  assert.deepEqual(rd.limited, []);
  // LA-REV-03: the automatic check's limit reached — the account checks are `limited` (not blockers: their own hints would point the
  // wrong way), the synthetic rate check is the one blocker, nothing is promised.
  const limitedChecks = [...checks([], []).map((c) => (["billing_route", "isolation"].includes(c.id) ? { ...c, ok: false, limited: true } : c)),
    { id: "account_refresh_rate", ok: false, detail: "Am încercat deja de 6 ori…", retryAfterS: 500 }];
  rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", allowed: false, checks: limitedChecks, accountRefresh: { needed: false, limited: true, retryAfterS: 500 } } });
  assert.deepEqual(rd.blocking.map((c) => c.id), ["account_refresh_rate"]);
  assert.deepEqual(rd.limited.map((c) => c.id), ["billing_route", "isolation"]);
  assert.deepEqual(rd.auto, []);
  assert.equal(rd.ready, false);
  assert.equal(rd.accountCheck, false);
  assert.match(legaCheckHint("account_refresh_rate"), /Verifică contul/);
  assert.match(legaCheckHint("account_refresh_rate"), /Integrări → Codex/);
  // Texts: Romanian, with diacritics, and no pointer to Integrări for the stale check.
  assert.equal(LEGA_START_CHECKING, "Verific contul și pornesc…");
  assert.match(LEGA_ACCOUNT_AUTO_HINT, /verifică singur contul Codex la pornire \(câteva secunde, fără inferență\)/);
  assert.match(LEGA_ACCOUNT_AUTO_HINT, /nu ai nimic de făcut în Integrări/);
  assert.match(legaCheckHint("billing_route"), /Integrări/, "a REAL billing blocker still names where it is solved");
  // The panel: the button follows `blocking` only, the in-flight line is shown while the start request runs, the hint in every state.
  const panel = fs.readFileSync(path.join(HUB_ROOT, "v2", "web", "src", "shell", "Lega.jsx"), "utf8");
  assert.match(panel, /const failed = rd\.blocking;/);
  assert.match(panel, /disabled=\{disabled \|\| failed\.length > 0 \|\| rd\.needsPolicy\}/);
  assert.match(panel, /if \(rd\.accountCheck\) \{ setStartNote\(LEGA_START_CHECKING\); setAnnounce\(LEGA_START_CHECKING\); \}/);
  assert.match(panel, /finally \{ r\.posting = false; setStartNote\(null\); \}/);
  assert.match(panel, /startNote=\{status === "preparing" \? startNote : null\}/);
  assert.ok((panel.match(/LEGA_ACCOUNT_AUTO_HINT/g) || []).length >= 4, "imported and shown next to the blockers, the session hint and the ready notice");
  assert.match(panel, /if \(rd\.blocking\.length\) throw new Error/);
  // LA-REV-04: the refusal's `reasonDetail` (the failing checks' texts, not persisted on the Hub) is shown with the message.
  assert.match(panel, /showFailure\(withReasonDetail\(e\), "Lega nu a pornit"\)/);
  assert.match(panel, /const withReasonDetail = \(error\) => \(error\?\.details\?\.reasonDetail \? \{ \.\.\.error, status: error\.status, category: error\.category, message: `\$\{error\.message\} — \$\{error\.details\.reasonDetail\}` \} : error\)/);
  // LA-R1: while the start POST runs the panel's „Anulează” sends Stop „current” (no session id yet) — what reaches the pending start.
  assert.match(panel, /else if \(wasPosting\) await stopRequest\("current", reason\);/);
});

test("LA-09 the stale-check start bypasses nothing: another failing check refuses it as before and NO probe is spent (probe only when every failing check is auto)", async () => {
  const { t, owner } = await ready();
  try {
    age(t, 25);
    // The execution gate suspended: refused exactly as today, the account check untouched.
    suspendGate(t);
    let e = await ownerStart(t, owner).catch((x) => x);
    assert.equal(e.category, "gate");
    assert.equal(e.message, "Poarta a refuzat sesiunea Lega");
    assert.deepEqual(failing(e.details.checks), ["execution_gate", "billing_route", "isolation"]);
    assert.equal(check(e.details.checks, "execution_gate").auto, undefined);
    assert.equal(e.details.accountRefresh, undefined);
    assert.equal(probes(t).length, 0, "no probe wasted behind a suspended gate");
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.deepEqual(pv.checks.filter((c) => !c.ok && !c.auto).map((c) => c.id), ["execution_gate"], "the gate is the one real blocker shown");
    const said = await say(t, owner, "Pornește Lega");
    assert.ok(!said.legaStart, "the intent still answers with the gate");
    openGate(t);
    // The consent missing: same.
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", {}, "test"));
    e = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(failing(e.details.checks), ["lega_consent", "billing_route", "isolation"]);
    assert.equal(probes(t).length, 0);
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    // The isolation consent withdrawn: isolation fails on the last known facts too → a plain blocker, no probe.
    const consent = t.hub.settings.get("isolationConsent");
    t.hub.bus.transaction(() => t.hub.settings.set("isolationConsent", {}, "test"));
    e = await ownerStart(t, owner).catch((x) => x);
    assert.deepEqual(failing(e.details.checks), ["billing_route", "isolation"]);
    assert.equal(check(e.details.checks, "isolation").auto, undefined);
    assert.equal(check(e.details.checks, "billing_route").auto, true);
    assert.equal(probes(t).length, 0);
    t.hub.bus.transaction(() => t.hub.settings.set("isolationConsent", consent, "test"));
    // Live web search not named by the start (M10.2 decision 9): refused on the terms, before any check of the account.
    const lega = t.hub.settings.get("lega") || {};
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...lega, webSearch: "live" }, "test"));
    e = await ownerStart(t, owner).catch((x) => x);
    assert.equal(e.code, "LEGA_TERMS_CHANGED");
    assert.equal(e.details.needConfirm, true);
    assert.equal(probes(t).length, 0);
    t.hub.bus.transaction(() => t.hub.settings.set("lega", lega, "test"));
    assert.equal(events(t, "lega.account_refreshed").length, 0);
    assert.equal(voiceGrants(t).length, 0);
    // Everything else in order: now — and only now — the Hub checks the account, once, and the ordinary admission decides.
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(probes(t).length, 1);
    // After the refresh the gate still decides: Stop All ends the voice, and the next start is refused without a probe.
    await t.hub.commands.dispatch({ type: "system.stop_all", channel: "ui", actor: "user", payload: { reason: "test" } });
    await waitFor(() => t.hub.lega.state()?.status === "ended", 15000);
    age(t, 25);
    e = await ownerStart(t, owner).catch((x) => x);
    assert.ok(failing(e.details.checks).includes("execution_gate"));
    assert.equal(probes(t).length, 1);
  } finally { await stopAndClean(t); }
});

test("LA-10 the gate: the account outlook only marks (ok / allowed never change), per state of the check; the usage numbers are never assumed", async () => {
  const { t, owner } = await ready();
  try {
    const authority = { sessionId: owner.session.id, maxDurationS: 600 };
    const fresh = t.hub.providerState.get("codex");
    const both = () => {
      const plain = t.hub.gate.evaluateVoice({ ownerAuthority: authority });
      const marked = t.hub.gate.evaluateVoice({ ownerAuthority: authority, accountOutlook: true });
      // Marks never change the verdict: same ok per check, same allowed; the plain evaluation carries no D23 field at all.
      assert.deepEqual(marked.checks.map((c) => [c.id, c.ok, c.detail]), plain.checks.map((c) => [c.id, c.ok, c.detail]));
      assert.equal(marked.allowed, plain.allowed);
      assert.equal("account" in plain, false);
      assert.ok(!plain.checks.some((c) => "refreshable" in c));
      assert.ok(!marked.checks.some((c) => c.ok && c.refreshable), "a passing check is never marked");
      return { plain, marked, refreshable: marked.checks.filter((c) => c.refreshable).map((c) => c.id) };
    };
    const set = (state) => t.hub.providerState.set("codex", state);
    const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString();
    // fresh
    let r = both();
    assert.equal(r.plain.allowed, true);
    assert.equal(r.marked.account.state, "fresh");
    assert.deepEqual(r.refreshable, []);
    // stale, good last known facts
    set({ ...fresh, probedAt: hoursAgo(25) });
    r = both();
    assert.equal(r.plain.allowed, false);
    assert.deepEqual(r.marked.account, { state: "stale", checkedAt: t.hub.providerState.get("codex").probedAt, ageHours: 25 });
    assert.deepEqual(r.refreshable, ["billing_route", "isolation"]);
    // stale, and yesterday's usage said the allowance was exhausted: hours-old numbers are not assumed (a fresh check reads them).
    set({ ...fresh, probedAt: hoursAgo(25), usage: { ...fresh.usage, limitReached: true, ordinaryUsageAllowed: false, windows: [{ name: "primary", usedPercent: 99 }] } });
    assert.deepEqual(both().refreshable, ["billing_route", "isolation"]);
    assert.equal(inspectionFromState(t.hub.providerState.get("codex"), new Date(), { assumeFresh: true }).usage, null);
    assert.ok(inspectionFromState(t.hub.providerState.get("codex"), new Date(), { assumeFresh: true }).auth, "the account facts are read");
    assert.equal(inspectionFromState(t.hub.providerState.get("codex"), new Date()).auth, null, "…never without the explicit outlook option");
    // stale, the last known account was an API key: billing fails on those facts too.
    set({ ...fresh, probedAt: hoursAgo(25), auth: { accountType: "apiKey" } });
    assert.deepEqual(both().refreshable, ["isolation"]);
    // stale, the sandbox was not ready: isolation fails on those facts too.
    set({ ...fresh, probedAt: hoursAgo(25), sandbox: { ...fresh.sandbox, readiness: "notConfigured" } });
    assert.deepEqual(both().refreshable, ["billing_route"]);
    // failed (the last check did not succeed, there are no account facts): what does not come from the account check decides.
    const failed = { provider: "codex", probedAt: hoursAgo(0.1), ok: false, error: "x", installation: fresh.installation, config: fresh.config };
    set(failed);
    r = both();
    assert.equal(r.marked.account.state, "failed");
    assert.deepEqual(r.refreshable, ["billing_route", "isolation"]);
    assert.equal(inspectionFromState(failed, new Date(), { assumeFresh: true }).auth, null, "a failed check has no facts to assume");
    const evidence = t.hub.settings.get("billingEvidence");
    t.hub.bus.transaction(() => t.hub.settings.set("billingEvidence", {}, "test"));
    assert.deepEqual(both().refreshable, ["isolation"], "no declaration: not something a check of the account fixes");
    t.hub.bus.transaction(() => t.hub.settings.set("billingEvidence", evidence, "test"));
    const consent = t.hub.settings.get("isolationConsent");
    t.hub.bus.transaction(() => t.hub.settings.set("isolationConsent", {}, "test"));
    assert.deepEqual(both().refreshable, ["billing_route"], "no isolation consent: not something a check of the account fixes");
    t.hub.bus.transaction(() => t.hub.settings.set("isolationConsent", consent, "test"));
    // missing (never checked, the installation inspected)
    set({ installation: fresh.installation, config: fresh.config });
    r = both();
    assert.equal(r.marked.account.state, "missing");
    assert.deepEqual(r.marked.account, { state: "missing", checkedAt: null, ageHours: null });
    assert.deepEqual(r.refreshable, ["billing_route", "isolation"]);
    // never inspected at all: first-time setup, not a refresh (the installation is not known).
    set({});
    r = both();
    assert.equal(r.refreshable.includes("billing_route"), false);
    assert.ok(failing(r.marked.checks).includes("realtime_config"));
    // accountCheckState agrees with the freshness rule of inspectionFromState at the 24 h edge.
    const now = new Date();
    assert.equal(accountCheckState({ probedAt: new Date(now.getTime() - 24 * HOUR).toISOString(), ok: true }, now).state, "fresh");
    assert.equal(accountCheckState({ probedAt: new Date(now.getTime() - 24 * HOUR - 60000).toISOString(), ok: true }, now).state, "stale");
    assert.equal(accountCheckState({ probedAt: "not a date" }, now).state, "missing");
    assert.equal(accountCheckState(null, now).state, "missing");
    assert.equal(probes(t).length, 0, "an evaluation never probes");
  } finally { await stopAndClean(t); }
});

test("LA-11 a missing account check (never run, installation known) is refreshed by the derived start too", async () => {
  const { t, owner } = await ready();
  try {
    const fresh = t.hub.providerState.get("codex");
    t.hub.providerState.set("codex", { installation: fresh.installation, config: fresh.config });
    const pv = t.hub.lega.preview({ ownerSessionId: owner.session.id });
    assert.deepEqual(pv.accountRefresh, { needed: true, state: "missing", lastCheckedAt: null, ageHours: null, limited: false, retryAfterS: 0 });
    assert.deepEqual(pv.checks.filter((c) => c.auto).map((c) => c.id), ["billing_route", "isolation"]);
    const r = await ownerStart(t, owner);
    assert.equal(r.authority, "owner_session");
    assert.equal(probes(t).length, 1);
    assert.deepEqual([events(t, "lega.account_refreshed")[0].payload.state, events(t, "lega.account_refreshed")[0].payload.ageHours, events(t, "lega.account_refreshed")[0].payload.ok], ["missing", null, true]);
  } finally { await stopAndClean(t); }
});

test("LA-12 (LA-R1) Stop „current” / Stop All during the automatic account check cancels the start: refused after the wait, nothing derived, GPT-Live never reached", async () => {
  const { t, owner } = await ready();
  const real = t.hub.providers.codex.probe;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    age(t, 25);
    let calls = 0;
    t.hub.providers.codex.probe = async (o) => { calls += 1; await sleep(1500); return real(o); };
    // (1) The panel's „Anulează” while its start POST runs: lega.session.stop "current" (ui channel, no session id yet).
    let startP = ownerStart(t, owner).catch((x) => x);
    await sleep(150);
    assert.equal(t.hub.lega.active(), true, "a start waiting for its account check counts as active (Stop reaches it)");
    assert.equal(t.hub.lega.state(), null, "…but no session exists yet");
    const pendingSaid = await say(t, owner, "Pornește Lega");
    assert.equal(pendingSaid.message, "Lega pornește deja: verific contul Codex (câteva secunde).");
    assert.ok(!pendingSaid.legaStart);
    const stopped = await t.hub.commands.dispatch({ type: "lega.session.stop", channel: "ui", actor: "user", payload: { sessionId: "current", reason: "user" } });
    assert.equal(stopped.result, null, "no session to show; the pending start is marked cancelled");
    let e = await startP;
    assert.equal(e.category, "conflict");
    assert.equal(e.message, "Lega nu a pornit: pornirea a fost anulată în timpul verificării automate a contului Codex");
    assert.equal(e.details.cancelled, true);
    assert.equal(t.hub.lega.active(), false);
    assert.equal(t.hub.lega.state(), null, "no session was ever created");
    assert.equal(voiceGrants(t).length, 0, "no authority derived");
    for (const type of ["lega.authority_derived", "lega.attempt_consumed", "lega.session.starting", "lega.session.stopped"]) assert.equal(events(t, type).length, 0, type);
    const refused = events(t, "lega.session.refused").at(-1).payload;
    assert.equal(refused.reason, "cancelled");
    assert.equal(refused.stopReason, "user");
    assert.equal(refused.stoppedBy, "user");
    assert.equal(refused.authority, "owner_session");
    assert.equal(refused.accountRefresh.commandId, probes(t)[0].id);
    // The check itself was not interrupted (it is the Hub's, inference-free): it settles and serves the next start.
    await waitFor(() => probes(t)[0].status === "executed", 10000);
    assert.equal(calls, 1);
    await waitFor(() => events(t, "lega.account_refreshed").length === 1, 5000);
    // (2) Stop All during the check (gate suspended afterwards): cancelled too, and the second decision would refuse anyway.
    age(t, 25);
    startP = ownerStart(t, owner).catch((x) => x);
    await sleep(150);
    assert.equal(probes(t).length, 2);
    await t.hub.commands.dispatch({ type: "system.stop_all", channel: "ui", actor: "user", payload: { reason: "test" } });
    e = await startP;
    assert.equal(e.category, "conflict");
    assert.match(e.message, /anulată în timpul verificării automate/);
    assert.equal(events(t, "lega.session.refused").at(-1).payload.stopReason, "stop-all");
    assert.equal(events(t, "lega.session.refused").at(-1).payload.stoppedBy, "hub");
    assert.equal(voiceGrants(t).length, 0);
    assert.equal(events(t, "lega.authority_derived").length, 0);
    await waitFor(() => probes(t)[1].status === "executed", 10000);
    // (3) A Stop that names a session id (not "current") never reaches a pending start: not_found, and the start goes on.
    openGate(t);
    age(t, 25);
    startP = ownerStart(t, owner).catch((x) => x);
    await sleep(150);
    await assert.rejects(t.hub.lega.stop("lega_someone_else", "user", "user"), (x) => x.category === "not_found");
    const r = await startP;
    assert.ok(r.sessionId, JSON.stringify(r?.message || r));
    assert.equal(r.authority, "owner_session");
    assert.equal(events(t, "lega.authority_derived").length, 1);
    // (4) With nothing pending, Stop with no id is what it was: the ended session's view (and not_found when there was never one).
    await t.hub.lega.stopAll("test");
    assert.equal((await t.hub.lega.stop(undefined, "user", "user")).status, "ended");
    assert.equal(events(t, "lega.session.refused").filter((x) => x.payload.reason === "cancelled").length, 2, "only the two cancelled attempts");
  } finally { t.hub.providers.codex.probe = real; await stopAndClean(t); }
});
