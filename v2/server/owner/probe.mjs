// M10.2 probe counters (U03). Observability only: every counter is computed after the fact from the logs the Hub already keeps
// (the `commands` table and the `events` table), so a probe never depends on the browser and never changes state. The only row
// this unit adds is the owner.nav command itself — a fixed screen key, no id, no text — so that opening the old grant form or
// the Approvals screen can be counted at all (owner decision 12).
//
// The counters measure what the owner had to do by hand on the old M03 path versus the one-plan path: grant forms, manual mode
// changes, Approvals navigations and old-card clicks, scope confirmations, clarifications, extra authentications, developer
// interventions, automatic readiness steps and Lega pointers to old-flow targets. They grant nothing and gate nothing.
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";

/** The screens owner.nav may name. A fixed enum: the payload can never carry an id, a path or free text. */
export const NAV_SCREENS = Object.freeze(["integrations.live", "integrations.isolation", "approvals", "system.environments", "missions.factory", "focus.composer"]);
/** Lega pointer targets (lega.pointed, emitted by U08) that lead into the old manual flow (mode, gate, grant form, isolation). */
export const OLD_FLOW_TARGETS = Object.freeze(["live-mode", "gate", "grant-form", "grant-create", "grants-list", "isolation"]);
const GRANT_FORM_TARGETS = new Set(["grant-form", "grant-create"]);
const OLD_FLOW = new Set(OLD_FLOW_TARGETS);
/** Channels a person acts on directly in the old flow (the owner's UI) or through a delegated developer agent. */
const MANUAL_CHANNELS = new Set(["ui", "agent"]);
/** Channels that are, by construction, a developer or a script acting on the Hub rather than the owner. */
const DEVELOPER_CHANNELS = new Set(["agent", "cli"]);
// gateRearms (M10.2.1): the owner's contextual rearms of the execution gate in the cockpit (gate.rearmed) — counted on their own,
// never as a manual mode change (the typed OPEN GATE through gate.set still is one).
export const PROBE_COUNTERS = Object.freeze(["grantFormsOpened", "manualGrantCreates", "manualModeChanges", "approvalsNavigations", "scopeConfirmations",
  "clarifications", "extraAuthentications", "developerInterventions", "automaticReadinessSteps", "legaOldFlowPointers", "gateRearms"]);
// The event types the counters read (one indexed range scan over the window, filtered by type).
const COUNTED_EVENTS = Object.freeze(["owner.intent", "intake.question", "lega.pointed", "lega.grant_prepared", "envelope.confirmed", "ops.plan.consent",
  "envelope.delta_confirmed", "owner.session_opened", "owner.session_reauthenticated", "gate.rearmed"]);
const SCOPE_CONFIRMATION_EVENTS = new Set(["envelope.confirmed", "ops.plan.consent", "envelope.delta_confirmed"]);
// Settings written outside settings.set on purpose: the V1 import keeps its marker in the same transaction as the imported rows
// (storage/v1-import.mjs), without a settings.changed event. Not a drift.
const DRIFT_EXEMPT = new Set(["legacyImport"]);
// Never part of the exposed table hash (a hash of a 256-bit salt reveals nothing, but the probe has no reason to touch it).
const HASH_EXCLUDED = new Set(["billingIdentitySecret"]);
/** Evidence ids per counter in a response; the counts themselves are always exact. */
const EVIDENCE_MAX = 50;

const parse = (text) => { try { return JSON.parse(text || "{}") || {}; } catch { return {}; } };
const sha = (text) => crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
const seqArg = (value, name) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new HubError("validation", `${name} trebuie să fie un număr întreg ≥ 0`);
  return n;
};

/**
 * The probe service. `report({ sinceSeq, untilSeq })` → { window, counters, evidence, settings } over events with
 * sinceSeq < seq ≤ untilSeq (untilSeq defaults to the newest event). Commands carry no sequence number of their own; every
 * logged command has exactly one command.accepted event (runtime/commands.mjs), whose seq places it in the window.
 *
 * Settings drift (part of developerInterventions). settings.changed carries the key and a reason, never the value, so the
 * table cannot be rebuilt by replaying events. Two checks stand in for that replay, both read-only:
 *  - order: settings.set writes the row and its event in one transaction, with the event stamped at or after the row. A row
 *    whose updated_at is later than its key's newest settings.changed (or a row with no event at all) was written out of band;
 *  - value: this process remembers a fingerprint of each value at boot and after each settings.changed it observes (post-commit);
 *    a different value with no event in between is a direct write that kept updated_at unchanged. It covers what happened while
 *    this process runs; a write made while the Hub was stopped is caught only when it moved updated_at.
 * A later settings.set of the same key re-baselines both checks (the drift is then hidden by a legitimate write).
 */
export function createProbe({ db, bus, config }) {
  const known = new Map(); // key → sha256 of value_json as last seen through settings.set (or at boot)
  const readRow = db.prepare("SELECT value_json FROM settings WHERE key = ?");
  for (const row of db.prepare("SELECT key, value_json FROM settings").all()) known.set(row.key, sha(row.value_json));
  // Post-commit: the row this event describes is already committed, so its current value is the one the event stands for.
  const unsubscribe = bus.subscribe((event) => {
    if (event.type !== "settings.changed" || event.scopeType !== "settings") return;
    const key = event.payload?.key || event.scopeId;
    const row = readRow.get(key);
    if (row) known.set(key, sha(row.value_json)); else known.delete(key);
  });

  const lastSeq = () => db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get().seq;
  const eventAt = (seq) => (seq > 0 ? db.prepare("SELECT created_at FROM events WHERE seq = ?").get(seq)?.created_at || null : null);

  /** Out-of-band settings writes (key names and reasons only; never a value). `fromAt` bounds the order check to the window. */
  function settingsDrift({ fromAt = null } = {}) {
    const rows = db.prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key").all();
    const lastEvent = new Map(db.prepare(`SELECT scope_id AS key, MAX(created_at) AS at FROM events WHERE scope_type = 'settings' AND type = 'settings.changed'
      GROUP BY scope_id`).all().map((r) => [r.key, r.at]));
    const drift = [];
    const present = new Set();
    for (const row of rows) {
      present.add(row.key);
      if (DRIFT_EXEMPT.has(row.key)) continue;
      const reasons = [];
      const at = lastEvent.get(row.key);
      const inWindow = !fromAt || String(row.updated_at) >= fromAt;
      if (!at && inWindow) reasons.push("no_event");
      else if (at && String(row.updated_at) > at && inWindow) reasons.push("written_after_event");
      const fingerprint = known.get(row.key);
      // A row this process has never seen (created while it was stopped) has no fingerprint: only the order check applies to it.
      if (fingerprint !== undefined && fingerprint !== sha(row.value_json)) reasons.push("value_changed_without_event");
      if (reasons.length) drift.push({ key: row.key, reasons, updatedAt: row.updated_at });
    }
    for (const key of known.keys()) if (!present.has(key) && !DRIFT_EXEMPT.has(key)) drift.push({ key, reasons: ["row_deleted_without_event"], updatedAt: null });
    const tableHash = sha(rows.filter((r) => !HASH_EXCLUDED.has(r.key)).map((r) => `${r.key}\u0000${r.value_json}`).join("\u0001")).slice(0, 16);
    return { drift, tableHash };
  }

  /** The newest event sequence number: the marker a probe starts from (GET only, nothing is written). */
  const mark = () => ({ seq: lastSeq(), at: eventAt(lastSeq()) });

  function report({ sinceSeq = 0, untilSeq = null } = {}) {
    const since = seqArg(sinceSeq, "sinceSeq") ?? 0;
    const newest = lastSeq();
    const until = Math.min(seqArg(untilSeq, "untilSeq") ?? newest, newest);
    if (until < since) throw new HubError("validation", "untilSeq trebuie să fie ≥ sinceSeq");
    const placeholders = COUNTED_EVENTS.map(() => "?").join(", ");
    const events = db.prepare(`SELECT seq, id, type, scope_id, payload_json FROM events WHERE seq > ? AND seq <= ? AND type IN (${placeholders}) ORDER BY seq`)
      .all(since, until, ...COUNTED_EVENTS).map((r) => ({ seq: r.seq, id: r.id, type: r.type, payload: parse(r.payload_json) }));
    const commands = db.prepare(`SELECT e.seq AS seq, c.id AS id, c.type AS type, c.actor AS actor, c.channel AS channel, c.status AS status, c.payload_json AS payload_json
      FROM events e JOIN commands c ON c.id = e.scope_id WHERE e.scope_type = 'command' AND e.type = 'command.accepted' AND e.seq > ? AND e.seq <= ? ORDER BY e.seq`)
      .all(since, until).map((r) => ({ seq: r.seq, id: r.id, type: r.type, actor: String(r.actor || ""), channel: r.channel, status: r.status, payload: parse(r.payload_json) }));

    const bucket = () => ({ count: 0, items: [] });
    const buckets = Object.fromEntries(PROBE_COUNTERS.map((k) => [k, bucket()]));
    // Evidence holds ids already in the log and enum details (screen, target, channel, status) — never a payload's text.
    const add = (counter, item) => { const b = buckets[counter]; b.count += 1; if (b.items.length < EVIDENCE_MAX) b.items.push(item); };
    const ev = (e, detail = {}) => ({ kind: "event", id: e.id, seq: e.seq, type: e.type, ...detail });
    const cmd = (c, detail = {}) => ({ kind: "command", id: c.id, seq: c.seq, type: c.type, channel: c.channel, status: c.status, ...detail });
    const navScreen = (c) => (c.type === "owner.nav" && c.status === "executed" && NAV_SCREENS.includes(c.payload.screen) ? c.payload.screen : null);
    const pointedTarget = (e) => { const t = e.payload.target ?? e.payload.key; return typeof t === "string" ? t : null; };

    let firstOpenSkipped = null;
    for (const e of events) {
      if (e.type === "lega.pointed") {
        const target = pointedTarget(e);
        if (GRANT_FORM_TARGETS.has(target)) add("grantFormsOpened", ev(e, { target }));
        if (OLD_FLOW.has(target)) add("legaOldFlowPointers", ev(e, { target }));
      } else if (e.type === "lega.grant_prepared") add("grantFormsOpened", ev(e));
      else if (SCOPE_CONFIRMATION_EVENTS.has(e.type)) add("scopeConfirmations", ev(e));
      else if (e.type === "owner.intent") { if (e.payload.clarification === true) add("clarifications", ev(e)); }
      else if (e.type === "intake.question") add("clarifications", ev(e));
      else if (e.type === "gate.rearmed") add("gateRearms", ev(e, { cls: typeof e.payload.cls === "string" ? e.payload.cls : null, modeReset: e.payload.modeReset === true }));
      else if (e.type === "owner.session_opened" || e.type === "owner.session_reauthenticated") {
        // The first session opened in the window is the one the probe needs anyway; every later open or step-up is extra.
        if (e.type === "owner.session_opened" && !firstOpenSkipped) { firstOpenSkipped = { id: e.id, seq: e.seq }; continue; }
        add("extraAuthentications", ev(e));
      }
    }
    for (const c of commands) {
      const screen = navScreen(c);
      if (screen === "integrations.live") add("grantFormsOpened", cmd(c, { screen }));
      if (screen === "approvals") add("approvalsNavigations", cmd(c, { screen }));
      if (c.type === "grant.create" && MANUAL_CHANNELS.has(c.channel)) add("manualGrantCreates", cmd(c));
      if (c.type === "mode.set" && MANUAL_CHANNELS.has(c.channel)) add("manualModeChanges", cmd(c, { mode: typeof c.payload.mode === "string" ? c.payload.mode : null }));
      if (c.type === "gate.set" && c.payload.action === "open" && MANUAL_CHANNELS.has(c.channel)) add("manualModeChanges", cmd(c, { gate: "open" }));
      // Every click on an old approval card in the UI (approved or rejected): the card the one-plan path replaces.
      if (c.type === "approval.decide" && c.channel === "ui") add("approvalsNavigations", cmd(c));
      // A delegated agent or a local script is a developer acting on the Hub; the test channel counts only on a real database.
      if (DEVELOPER_CHANNELS.has(c.channel) || (c.channel === "test" && !config.testMode)) add("developerInterventions", cmd(c));
      if (c.actor.startsWith("readiness:")) add("automaticReadinessSteps", cmd(c));
    }
    const fromAt = since > 0 ? eventAt(since) : null;
    const settingsCheck = settingsDrift({ fromAt });
    for (const d of settingsCheck.drift) add("developerInterventions", { kind: "settings_drift", key: d.key, reasons: d.reasons });

    return {
      window: { sinceSeq: since, untilSeq: until, fromAt, toAt: eventAt(until), testMode: Boolean(config.testMode) },
      counters: Object.fromEntries(PROBE_COUNTERS.map((k) => [k, buckets[k].count])),
      evidence: Object.fromEntries(PROBE_COUNTERS.map((k) => [k, { items: buckets[k].items, truncated: buckets[k].count > buckets[k].items.length }])),
      extraAuthenticationsBaseline: firstOpenSkipped,
      settings: { tableHash: settingsCheck.tableHash, drift: settingsCheck.drift },
    };
  }

  return { report, mark, settingsDrift, close: () => unsubscribe() };
}

/**
 * owner.nav: the web router reports entering one of the fixed screens (main.jsx). Channels: the owner-facing ones only — never
 * agent or cli (a developer's navigation is not the owner's). Nothing but the screen key is validated, logged or returned.
 */
export function registerProbeCommands(reg) {
  reg("owner.nav", { describe: "Telemetrie: ai intrat într-un ecran al fluxului vechi (doar cheia ecranului, fără id-uri sau text)",
    channels: ["ui", "owner", "voice", "companion", "test"], schema: { screen: { enum: NAV_SCREENS, required: true } },
    execute: (input) => ({ screen: input.screen }) });
}
