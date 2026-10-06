import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { newId } from "../server/core/ids.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { createProbe, NAV_SCREENS, OLD_FLOW_TARGETS, PROBE_COUNTERS } from "../server/owner/probe.mjs";

// M10.2 U03: probe counters from the existing logs (commands + events) and the owner.nav screen telemetry. Synthetic sequences:
// commands are written as the command bus writes them (a commands row + its command.accepted event); events through the bus.
// No model, no provider process, no network beyond the loopback test server.
const here = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const dispatch = (hub, type, payload, { channel = "test", actor = "test", ownerSession = null } = {}) => hub.commands.dispatch({ type, payload, actor, channel, ownerSession });

function logCommand(hub, { type, channel = "ui", actor = "user", payload = {}, status = "executed" }) {
  const id = newId("cmd");
  hub.bus.transaction(() => {
    hub.db.prepare(`INSERT INTO commands (id, type, actor, channel, intent_text, payload_json, status, policy_json, correlation_id, created_at)
      VALUES (?, ?, ?, ?, '', ?, ?, '{}', ?, ?)`).run(id, type, actor, channel, JSON.stringify(payload), status, id, new Date().toISOString());
    hub.bus.append({ type: "command.accepted", scopeType: "command", scopeId: id, source: actor, payload: { type, channel, policy: "AUTO_ALLOWED", decision: "allow" } });
  });
  return id;
}
const event = (hub, type, payload = {}) => hub.bus.emit({ type, scopeType: "system", scopeId: "probe-test", source: "test", payload });
const counts = (hub) => ({ commands: hub.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, events: hub.db.prepare("SELECT COUNT(*) AS n FROM events").get().n,
  settings: hub.db.prepare("SELECT group_concat(key || '=' || value_json || '@' || updated_at, '|') AS s FROM settings").get().s,
  sessions: hub.db.prepare("SELECT group_concat(id || '@' || last_seen_at, '|') AS s FROM owner_sessions").get().s });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r.counters[k]]));

/** Today's real flow (2026-10-04 18:40–18:50): Lega prepares a grant and points at the form; mode by hand; two old-card clicks. */
async function todaysFlow(hub) {
  event(hub, "owner.intent", { channel: "voice", source: "voice", steps: ["navigate"], clarification: false, refused: 0 });
  event(hub, "lega.grant_prepared", { kind: "run", provider: "codex" });
  event(hub, "lega.pointed", { target: "grant-create" });
  await dispatch(hub, "owner.nav", { screen: "integrations.live" }, { channel: "ui", actor: "user" });
  event(hub, "lega.pointed", { target: "live-mode" });
  logCommand(hub, { type: "mode.set", payload: { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" } });
  logCommand(hub, { type: "grant.create", payload: { provider: "codex", projectId: "p", access: "workspace-write", maxAttempts: 3 } });
  await dispatch(hub, "owner.nav", { screen: "approvals" }, { channel: "ui", actor: "user" });
  logCommand(hub, { type: "approval.decide", payload: { approvalId: "apr_a", decision: "approved", displayedHash: "h" } });
  logCommand(hub, { type: "approval.decide", payload: { approvalId: "apr_b", decision: "approved", displayedHash: "h" } });
}
/** A promo request through the new path: one clarification, one automatic readiness step, ONE ops plan consent. */
function promoFlow(hub) {
  event(hub, "owner.intent", { channel: "owner", source: "voice", steps: [], clarification: true, refused: 0 });
  event(hub, "owner.intent", { channel: "owner", source: "voice", steps: ["studio_create"], clarification: false, refused: 0, text: "SECRET-OWNER-TEXT" });
  logCommand(hub, { type: "environment.attest", channel: "owner", actor: "readiness:pln_x" });
  event(hub, "ops.plan.consent", { modality: "click", decisions: 1 });
  // A Lega pointer to a NEW-path target is not an old-flow pointer.
  event(hub, "lega.pointed", { target: "missions-list" });
}
/** An engineering request: ONE envelope confirmation. */
function engineeringFlow(hub) {
  event(hub, "owner.intent", { channel: "owner", source: "typed", steps: ["propose_work"], clarification: false, refused: 0 });
  event(hub, "envelope.confirmed", { channel: "owner_session", modality: "click" });
}

test("M10.2-PROBE-01 synthetic flows give exact counters: today's flow, the promo plan path and the engineering envelope", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const m0 = hub.bus.lastSeq();
    await todaysFlow(hub);
    const m1 = hub.bus.lastSeq();
    promoFlow(hub);
    const m2 = hub.bus.lastSeq();
    engineeringFlow(hub);
    const m3 = hub.bus.lastSeq();

    const a = hub.probe.report({ sinceSeq: m0, untilSeq: m1 });
    // M10.2.1: gateRearms (the owner's rearms of the gate in the cockpit) is a counter of its own; none in today's flow.
    assert.deepEqual(a.counters, { grantFormsOpened: 3, manualGrantCreates: 1, manualModeChanges: 1, approvalsNavigations: 3, scopeConfirmations: 0,
      clarifications: 0, extraAuthentications: 0, developerInterventions: 0, automaticReadinessSteps: 0, legaOldFlowPointers: 2, gateRearms: 0 }, JSON.stringify(a.evidence));
    assert.equal(a.evidence.approvalsNavigations.items.filter((i) => i.type === "approval.decide").length, 2, "two old-card clicks");
    assert.deepEqual(a.evidence.legaOldFlowPointers.items.map((i) => i.target).sort(), ["grant-create", "live-mode"]);

    const b = hub.probe.report({ sinceSeq: m1, untilSeq: m2 });
    assert.deepEqual(pick(b, ["grantFormsOpened", "manualModeChanges", "approvalsNavigations", "manualGrantCreates", "legaOldFlowPointers"]),
      { grantFormsOpened: 0, manualModeChanges: 0, approvalsNavigations: 0, manualGrantCreates: 0, legaOldFlowPointers: 0 });
    assert.equal(b.counters.scopeConfirmations, 1);
    assert.equal(b.counters.clarifications, 1);
    assert.equal(b.counters.automaticReadinessSteps, 1);
    assert.equal(b.counters.developerInterventions, 0);

    const c = hub.probe.report({ sinceSeq: m2, untilSeq: m3 });
    assert.deepEqual(pick(c, ["grantFormsOpened", "manualModeChanges", "approvalsNavigations", "scopeConfirmations"]),
      { grantFormsOpened: 0, manualModeChanges: 0, approvalsNavigations: 0, scopeConfirmations: 1 });

    // The whole window is the sum; the default untilSeq is the newest event.
    const all = hub.probe.report({ sinceSeq: m0 });
    assert.equal(all.window.untilSeq, m3);
    assert.equal(all.counters.scopeConfirmations, 2);
    assert.equal(all.counters.grantFormsOpened, 3);
    // No PII: the report carries ids, enum keys and counts — never a payload's text.
    assert.ok(!JSON.stringify(all).includes("SECRET-OWNER-TEXT"));
    assert.deepEqual(Object.keys(all.counters), [...PROBE_COUNTERS]);
    // Delta confirmations count as scope confirmations; gate.set open counts as a manual mode change; owner-channel grants do not.
    const m4 = hub.bus.lastSeq();
    event(hub, "envelope.delta_confirmed", { extraCycles: 1 });
    logCommand(hub, { type: "gate.set", payload: { action: "open", confirm: "OPEN GATE" } });
    logCommand(hub, { type: "gate.set", payload: { action: "suspend" } });
    logCommand(hub, { type: "grant.create", channel: "owner", actor: "owner:s" });
    logCommand(hub, { type: "approval.decide", channel: "agent", actor: "agent" });
    const d = hub.probe.report({ sinceSeq: m4 });
    assert.equal(d.counters.scopeConfirmations, 1);
    assert.equal(d.counters.manualModeChanges, 1);
    assert.equal(d.counters.manualGrantCreates, 0);
    assert.equal(d.counters.approvalsNavigations, 0, "only UI clicks on old cards count as approval clicks");
    assert.equal(d.counters.developerInterventions, 1, "a delegated agent command is a developer intervention");
    assert.throws(() => hub.probe.report({ sinceSeq: -1 }), /sinceSeq/);
    assert.throws(() => hub.probe.report({ sinceSeq: 5, untilSeq: 2 }), /untilSeq/);
  } finally { await t.cleanup(); }
});

test("M10.2-PROBE-02 owner.nav accepts only the fixed screen enum, logs only the screen key and refuses agent/cli", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.deepEqual([...NAV_SCREENS], ["integrations.live", "integrations.isolation", "approvals", "system.environments", "missions.factory", "focus.composer"]);
    await assert.rejects(dispatch(hub, "owner.nav", { screen: "integrations" }), /screen must be one of/);
    await assert.rejects(dispatch(hub, "owner.nav", { screen: "/projects/prj_123" }), /screen must be one of/);
    await assert.rejects(dispatch(hub, "owner.nav", {}), /screen is required/);
    await assert.rejects(dispatch(hub, "owner.nav", { screen: "approvals" }, { channel: "agent" }), /not delegated/);
    await assert.rejects(dispatch(hub, "owner.nav", { screen: "approvals" }, { channel: "cli" }), /cannot be issued through cli/);
    const r = await dispatch(hub, "owner.nav", { screen: "approvals", missionId: "mis_secret", text: "free text", projectId: "prj_x" }, { channel: "ui", actor: "user" });
    assert.deepEqual(r.result, { screen: "approvals" });
    const row = hub.db.prepare("SELECT payload_json, result_json, intent_text FROM commands WHERE id = ?").get(r.command.id);
    assert.deepEqual(JSON.parse(row.payload_json), { screen: "approvals" }, "no id or text reaches the log");
    assert.deepEqual(JSON.parse(row.result_json), { screen: "approvals" });
    assert.equal(row.intent_text, "");
    // Observability only: the command adds no grant, approval, setting or mode change.
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM live_grants").get().n, 0);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM approvals").get().n, 0);
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    // Lega old-flow targets are a fixed list too.
    assert.deepEqual([...OLD_FLOW_TARGETS], ["live-mode", "gate", "grant-form", "grant-create", "grants-list", "isolation"]);
  } finally { await t.cleanup(); }
});

test("M10.2-PROBE-03 extra authentications: the first open in the window is the baseline; every step-up after it counts", async () => {
  const t = await makeTestHub();
  try {
    const m0 = t.hub.bus.lastSeq();
    const owner = await enrolOwner(t);
    let r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.extraAuthentications, 0, JSON.stringify(r.evidence.extraAuthentications));
    assert.ok(r.extraAuthenticationsBaseline?.id);
    owner.reauth();
    r = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.extraAuthentications, 1);
    assert.equal(r.evidence.extraAuthentications.items[0].type, "owner.session_reauthenticated");
    // A window that starts after the open counts the step-up alone (no open to discount).
    const m1 = t.hub.bus.lastSeq();
    owner.reauth();
    assert.equal(t.hub.probe.report({ sinceSeq: m1 }).counters.extraAuthentications, 1);
  } finally { await t.cleanup(); }
});

test("M10.2-PROBE-04 settings drift: a direct UPDATE without an event raises developerInterventions by exactly 1; settings.set re-baselines", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    hub.bus.transaction(() => hub.settings.set("startView", "cockpit", "test"));
    const m0 = hub.bus.lastSeq();
    assert.equal(hub.probe.report({ sinceSeq: m0 }).counters.developerInterventions, 0);
    assert.deepEqual(hub.probe.report({ sinceSeq: 0 }).settings.drift, [], "a fresh Hub has no drift");
    // Out of band, keeping updated_at: caught by the in-process value fingerprint.
    hub.db.prepare("UPDATE settings SET value_json = ? WHERE key = 'startView'").run(JSON.stringify("stage"));
    let r = hub.probe.report({ sinceSeq: m0 });
    assert.equal(r.counters.developerInterventions, 1);
    assert.deepEqual(r.settings.drift.map((d) => [d.key, d.reasons]), [["startView", ["value_changed_without_event"]]]);
    assert.ok(!JSON.stringify(r).includes("\"stage\""), "the drift report names the key, never the value");
    // A legitimate write of the same key (with its event) re-baselines.
    hub.bus.transaction(() => hub.settings.set("startView", "cockpit", "test"));
    assert.equal(hub.probe.report({ sinceSeq: m0 }).counters.developerInterventions, 0);
    // Out of band while the Hub was stopped (a new process has no fingerprint of the old value): caught when updated_at moved.
    const later = new Date(Date.now() + 60000).toISOString();
    hub.db.prepare("UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'startView'").run(JSON.stringify("stage"), later);
    const fresh = createProbe({ db: hub.db, bus: hub.bus, config: hub.config });
    try {
      r = fresh.report({ sinceSeq: m0 });
      assert.equal(r.counters.developerInterventions, 1);
      assert.deepEqual(r.settings.drift[0].reasons, ["written_after_event"]);
      assert.match(r.settings.tableHash, /^[0-9a-f]{16}$/);
    } finally { fresh.close(); }
    // A row without any settings.changed event is out of band too.
    hub.db.prepare("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES ('probeTestOnly', ?, ?)").run(JSON.stringify({ enabled: true }), later);
    r = hub.probe.report({ sinceSeq: m0 });
    assert.ok(r.settings.drift.some((d) => d.key === "probeTestOnly" && d.reasons.includes("no_event")), JSON.stringify(r.settings.drift));
    hub.db.prepare("DELETE FROM settings WHERE key = 'probeTestOnly'").run();
    // The order check is bounded to the window: an out-of-band write made before the window starts is not attributed to it.
    hub.bus.transaction(() => hub.settings.set("startView", "cockpit", "test"));
    await sleep(10);
    const beforeWrite = hub.bus.lastSeq();
    hub.db.prepare("UPDATE settings SET updated_at = ? WHERE key = 'startView'").run(new Date().toISOString());
    await sleep(10);
    event(hub, "probe.window_start");
    const windowStart = hub.bus.lastSeq();
    const bounded = createProbe({ db: hub.db, bus: hub.bus, config: hub.config });
    try {
      assert.ok(bounded.report({ sinceSeq: beforeWrite }).settings.drift.some((d) => d.key === "startView"), "inside the window: counted");
      assert.ok(!bounded.report({ sinceSeq: windowStart }).settings.drift.some((d) => d.key === "startView"), "before the window: not attributed to it");
    } finally { bounded.close(); }
  } finally { await t.cleanup(); }
});

test("M10.2-PROBE-05 test-channel commands count as developer interventions only on a real (non-test) database", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const m0 = hub.bus.lastSeq();
    logCommand(hub, { type: "backup.run", channel: "test", actor: "test" });
    logCommand(hub, { type: "environment.inspect", channel: "cli", actor: "cli" });
    assert.equal(hub.probe.report({ sinceSeq: m0 }).counters.developerInterventions, 1, "cli counts; test does not on a test Hub");
    const live = createProbe({ db: hub.db, bus: hub.bus, config: { testMode: false } });
    try { assert.equal(live.report({ sinceSeq: m0 }).counters.developerInterventions, 2); } finally { live.close(); }
  } finally { await t.cleanup(); }
});

test("M10.2-PROBE-06 HTTP: the probe GET writes nothing; /api/owner/nav logs the owner channel without touching the session; agent/cli refused; the script reads it", async () => {
  const t = await makeTestHub();
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
  try {
    const owner = await enrolOwner(t);
    const { SESSION_COOKIE } = await import("../server/owner/trust.mjs");
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.token)}`;
    const m0 = (await call("GET", "/api/owner/probe?mark=1")).json.seq;
    assert.equal(m0, t.hub.bus.lastSeq());
    await todaysFlow(t.hub);

    const before = counts(t.hub);
    const got = await call("GET", `/api/owner/probe?sinceSeq=${m0}`, { cookie });
    assert.equal(got.status, 200);
    assert.equal(got.json.counters.manualModeChanges, 1);
    assert.equal(got.json.counters.grantFormsOpened, 3);
    await call("GET", "/api/owner/probe?mark=1");
    assert.deepEqual(counts(t.hub), before, "the probe GET performs no write (commands, events, settings, sessions unchanged)");
    assert.equal((await call("GET", "/api/owner/probe?sinceSeq=abc")).status, 400);

    // The owner's UI with the session cookie: owner channel, session not touched, only the screen key logged.
    const nav = await call("POST", "/api/owner/nav", { body: { screen: "system.environments", projectId: "prj_secret", note: "x" }, cookie });
    assert.equal(nav.status, 200, JSON.stringify(nav.json));
    assert.deepEqual(nav.json, { screen: "system.environments" });
    const row = t.hub.db.prepare("SELECT channel, actor, payload_json FROM commands WHERE type = 'owner.nav' ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    assert.equal(row.channel, "owner");
    assert.equal(row.actor, `owner:${owner.session.id}`);
    assert.deepEqual(JSON.parse(row.payload_json), { screen: "system.environments" });
    assert.equal(counts(t.hub).sessions, before.sessions, "navigation is not owner activity: last_seen_at unchanged");
    const anon = await call("POST", "/api/owner/nav", { body: { screen: "approvals" } });
    assert.equal(anon.status, 200);
    assert.equal(t.hub.db.prepare("SELECT channel FROM commands WHERE type = 'owner.nav' ORDER BY rowid DESC LIMIT 1").get().channel, "ui");
    assert.equal((await call("POST", "/api/owner/nav", { body: { screen: "approvals" }, cookie, headers: { "X-Hub-Channel": "agent" } })).status, 403);
    assert.equal((await call("POST", "/api/owner/nav", { body: { screen: "approvals" }, headers: { "X-Hub-Channel": "cli" } })).status, 403);
    assert.equal((await call("POST", "/api/owner/nav", { body: { screen: "projects" } })).status, 400);

    // The GET-only reader script against this Hub.
    const script = path.join(here, "..", "scripts", "probe-m10-2.mjs");
    const env = { ...process.env, HUB_V2_PORT: String(t.config.port) };
    const { stdout } = await execFileAsync(process.execPath, [script, "--since", String(m0), "--json"], { env, timeout: 30000 });
    const printed = JSON.parse(stdout);
    assert.equal(printed.counters.approvalsNavigations, 4, "today's flow (3) + the anonymous Approvals navigation");
    assert.equal(printed.counters.grantFormsOpened, 3);
    const text = await execFileAsync(process.execPath, [script, "--since", String(m0)], { env, timeout: 30000 });
    assert.match(text.stdout, /Schimbări manuale de mod/);
    await assert.rejects(execFileAsync(process.execPath, [script, "--since", "x"], { env, timeout: 30000 }), (e) => e.code === 2);
  } finally {
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
