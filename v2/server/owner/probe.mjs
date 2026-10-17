// M10.2 probe counters (U03). Observability only: every counter is computed after the fact from the logs the Hub already keeps
// (the `commands` table and the `events` table), so a probe never depends on the browser and never changes state. The only row
// this unit adds is the owner.nav command itself — a fixed screen key, no id, no text — so that opening the old grant form or
// the Approvals screen can be counted at all (owner decision 12).
//
// The counters measure what the owner had to do by hand on the old M03 path versus the one-plan path: grant forms, manual mode
// changes, Approvals navigations and old-card clicks, scope confirmations, clarifications, extra authentications, developer
// interventions, automatic readiness steps and Lega pointers to old-flow targets. They grant nothing and gate nothing.
//
// 2.12.2 (R4): the owner's own list (probe sheet §7), read after the live probe under his names (OWNER_PROBE_LIST): entering the
// Integrations live / advanced panel (navigationToAdvanced, no longer counted as a grant form), the first confirmation of each plan
// and every further one inside the same plan, spoken confirmations, spoken pauses, the verified spoken „Continuă” that resumed,
// Stop All per channel, the contextual rearm and the unknown sentences left without a question or an explanation. Two of them are
// existing counters under the owner's name (PROBE_ALIASES): the old keys stay, with the same count and the same evidence.
//
// 2.12.2 (P0-R6): STOP_ALL counts the owner's „Oprește tot” only — by the stop's own kind (payload.stopKind, runs.stopAll), never by the
// suspension record's precedence kind; the Hub's shutdown with work in flight is listed apart (breakdown.stopAll.shutdowns). UNKNOWN_INTENTS
// is exact for every sentence the intake ran since then: owner.intent announces (`outcome: true`) the owner.intent_outcome it writes after
// the steps ran, with the number of unknown steps it left without any answer; only older events are still estimated. GET stays SELECT-only.
//
// 2.12.3 (D1): a provider transcript the Hub left unanswered on purpose (the voice bridge leaves an unknown sentence to Lega's agent) is not
// counted when Lega answered it — a delegated turn of the same Lega session that SPOKE (lega.turn_completed spoke: true; tied to the sentence by
// its start or one of its tool calls) or the voice model's own non-empty speech (never a line the Hub spoke through the same channel), after
// the owner's sentence, before his next one and within LEGA_ANSWER_WINDOW_MS. A bare tool call (the lega.hub_actions pre-check) followed by
// silence is not an answer (D1 review). The link is the outcome's {legaSessionId, transcriptId} (ids only), or for older rows the
// owner.intent command row the event is correlated with. Read after the fact (ids, roles, origins, flags and lengths, never words); such
// sentences are listed apart (breakdown.unknownAnsweredByLega), never in UNKNOWN_INTENTS.
//
// M12 (D15): the owner's decisions are also counted per AUTHORITY (breakdown.decisionsByAuthority, additive): every approval.owner_decide
// (the approval event the owner session wrote, decided_via owner_session) and every ops.plan.consent (the owner session that confirmed the
// card, read back from owner_sessions) as webauthn or local_dev_profile. A local development session is a local trust the owner chose for
// this machine, never proof that he was present: it is never added to the webauthn figures.
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
/**
 * M12 (D15): a local development session's credential id starts with this prefix (owner/dev-profile.mjs DEV_CREDENTIAL_PREFIX; kept as a
 * literal so probe.mjs keeps its single relative import — D1-06 loads mutated copies of this file from a temporary folder).
 */
const DEV_CREDENTIAL_PREFIX = "devprofile:";

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
// 2.12.2 (R4): the owner's §7 counters are appended after the existing ones (the order of the old keys is unchanged).
export const PROBE_COUNTERS = Object.freeze(["grantFormsOpened", "manualGrantCreates", "manualModeChanges", "approvalsNavigations", "scopeConfirmations",
  "clarifications", "extraAuthentications", "developerInterventions", "automaticReadinessSteps", "legaOldFlowPointers", "gateRearms",
  "navigationToAdvanced", "planConfirmations", "extraScopeConfirmations", "voiceConfirmations", "voicePause", "voiceContinue", "stopAll",
  "contextualRearm", "unknownIntents", "manualDevDbApiInterventions"]);
/** Counters that are an existing counter under the owner's name: the same bucket (count and evidence), never counted twice. */
export const PROBE_ALIASES = Object.freeze({ contextualRearm: "gateRearms", manualDevDbApiInterventions: "developerInterventions" });
/** The owner's probe list (§7) in his order and with his exact names → the counter each one reads. */
export const OWNER_PROBE_LIST = Object.freeze([
  ["GRANT_FORMS_OPENED", "grantFormsOpened"], ["MANUAL_MODE_CHANGES", "manualModeChanges"], ["NAVIGATION_TO_APPROVALS", "approvalsNavigations"],
  ["NAVIGATION_TO_ADVANCED", "navigationToAdvanced"], ["PLAN_CONFIRMATIONS", "planConfirmations"], ["EXTRA_SCOPE_CONFIRMATIONS", "extraScopeConfirmations"],
  ["MANUAL_DEV_DB_API_INTERVENTIONS", "manualDevDbApiInterventions"], ["VOICE_CONFIRMATIONS", "voiceConfirmations"], ["VOICE_PAUSE", "voicePause"],
  ["VOICE_CONTINUE", "voiceContinue"], ["STOP_ALL", "stopAll"], ["CONTEXTUAL_REARM", "contextualRearm"], ["UNKNOWN_INTENTS", "unknownIntents"],
].map((pair) => Object.freeze(pair)));
// The event types the counters read (one indexed range scan over the window, filtered by type).
const COUNTED_EVENTS = Object.freeze(["owner.intent", "intake.question", "lega.pointed", "lega.grant_prepared", "envelope.confirmed", "ops.plan.consent",
  "envelope.delta_confirmed", "owner.session_opened", "owner.session_reauthenticated", "gate.rearmed",
  "ops.plan.reconfirmed", "lega.owner_pause", "owner.interrupt", "owner.continue_voice", "system.stop_all",
  // M12 (D15): the owner-session approvals (approval.owner_decide writes approval.approved / approval.rejected with its authority).
  "approval.approved", "approval.rejected"]);
/** M12 (D15): the authorities a decision is counted under (anything else is "other"; the test channel is "test"). */
const DECISION_AUTHORITIES = Object.freeze(["webauthn", "local_dev_profile"]);
const SCOPE_CONFIRMATION_EVENTS = new Set(["envelope.confirmed", "ops.plan.consent", "envelope.delta_confirmed"]);
/** The one confirmation of a plan (an envelope or an operation plan); envelope.delta_confirmed is always a further one. */
const PLAN_CONFIRMATION_EVENTS = Object.freeze(["envelope.confirmed", "ops.plan.consent"]);
/** Confirmation modalities that are the owner's spoken words (the server-held, locally verified utterance; never a provider transcript). */
const VOICE_MODALITIES = new Set(["voice", "voice-local"]);
/** owner.continue_voice outcomes (owner/intake.mjs continueFromVoiceOnce); only a resume counts as voiceContinue. */
const CONTINUE_OUTCOMES = new Set(["resumed", "executed", "held", "nothing", "question", "plan_waiting", "vetoed", "refused", "duplicate", "error"]);
const CONTINUE_DONE = new Set(["resumed", "executed"]);
/** Stop kinds recorded on system.stop_all (runtime/runs.mjs, D17) and the channels a stop can come from. */
const STOP_KINDS = new Set(["stop_all", "shutdown", "security"]);
const CHANNELS = new Set(["ui", "owner", "voice", "companion", "test", "agent", "cli", "system", "automation", "schedule"]);
/** owner.intent sources (owner/intake.mjs): an enum in the evidence, never the request's text. */
const INTENT_SOURCES = new Set(["typed", "voice-provider", "voice-local", "document", "media-local"]);
// Settings written outside settings.set on purpose: the V1 import keeps its marker in the same transaction as the imported rows
// (storage/v1-import.mjs), without a settings.changed event. Not a drift.
const DRIFT_EXEMPT = new Set(["legacyImport"]);
// Never part of the exposed table hash (a hash of a 256-bit salt reveals nothing, but the probe has no reason to touch it).
const HASH_EXCLUDED = new Set(["billingIdentitySecret"]);
/** Evidence ids per counter in a response; the counts themselves are always exact. */
const EVIDENCE_MAX = 50;
/** D1: how long after the owner's sentence an answer of Lega's agent still belongs to it (the same bound as a Lega turn's PENDING_ARM_MS). */
export const LEGA_ANSWER_WINDOW_MS = 60000;

const parse = (text) => { try { return JSON.parse(text || "{}") || {}; } catch { return {}; } };
const sha = (text) => crypto.createHash("sha256").update(String(text ?? "")).digest("hex");
const seqArg = (value, name) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new HubError("validation", `${name} trebuie să fie un număr întreg ≥ 0`);
  return n;
};
/**
 * The channel of a Stop All from its event: a channel the event records itself, otherwise its source — runs.stopAll stamps the
 * command's actor (`voice` for the voice channel, `owner:<session>`, `device:<id>` for the phone, `user` for the UI, `system` for the
 * shutdown). Always an enum key, never the actor's id.
 */
const stopChannel = (e) => {
  if (CHANNELS.has(e.payload.channel)) return e.payload.channel;
  const s = e.source;
  if (s === "voice" || s.startsWith("voice:")) return "voice";
  if (s.startsWith("owner:")) return "owner";
  if (s.startsWith("device:")) return "companion";
  if (s === "user") return "ui";
  return CHANNELS.has(s) ? s : "other";
};
/**
 * The unknown steps of one owner.intent that got neither a question nor an explanation → { steps, source, exact } or null.
 * Exact when the intake records the number: on owner.intent itself (`unknownUnanswered`), or — 2.12.2, after the steps ran — on the
 * owner.intent_outcome that owner.intent announced (`outcome: true`; `outcome` is that event's payload, or null when none was written: the
 * sentence failed before the Hub answered it, so every unknown step counts). Otherwise (events from before 2.12.2) estimated from what
 * owner.intent always carried: a sentence the resolver answered with a question counts none, and each refusal reason (a confirmation it
 * could not take, which the intake turns into an "unknown" step with its reason) answers one unknown step.
 */
function unansweredUnknown(p, outcome = null) {
  const unknown = (Array.isArray(p.steps) ? p.steps : []).filter((s) => s === "unknown").length;
  if (!unknown) return null;
  const source = INTENT_SOURCES.has(p.source) ? p.source : "other";
  const exact = (n) => (n > 0 ? { steps: Math.min(n, unknown), source, exact: true } : null);
  if (Number.isSafeInteger(p.unknownUnanswered) && p.unknownUnanswered >= 0) return exact(p.unknownUnanswered);
  if (p.outcome === true) return exact(Number.isSafeInteger(outcome?.unknownUnanswered) && outcome.unknownUnanswered >= 0 ? outcome.unknownUnanswered : unknown);
  if (p.clarification === true) return null;
  const refused = Number.isSafeInteger(p.refused) && p.refused > 0 ? p.refused : 0;
  return unknown > refused ? { steps: unknown - refused, source, exact: false } : null;
}
/**
 * R4-F8: a Stop All's own kind. runs.stopAll records it as `stopKind` (2.12.2); `kind` is the suspension record's PRECEDENCE kind (a
 * shutdown landing on an unrearmed Stop All records "stop_all", an owner Stop All landing on a security record "security"), so it is never
 * read here. A stop recorded before `stopKind` existed is the Hub's shutdown when the Hub itself wrote it (source "system"), else the
 * owner's Stop All.
 */
const stopKindOf = (e) => (STOP_KINDS.has(e.payload.stopKind) ? e.payload.stopKind : e.source === "system" ? "shutdown" : "stop_all");
const tally = (map, key) => { map[key] = (map[key] || 0) + 1; };

/**
 * The probe service. `report({ sinceSeq, untilSeq })` → { window, counters, evidence, settings, ownerList, breakdown, aliases } over
 * events with sinceSeq < seq ≤ untilSeq (untilSeq defaults to the newest event). Commands carry no sequence number of their own; every
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

  /**
   * For the plan confirmations in the window (R4): the seq of each plan's FIRST confirmation — looked up up to the window's end, so a
   * plan confirmed before the window and again inside it shows as confirmed twice (the earlier one is never counted) — and the
   * envelopes that continue an earlier plan (D20, „Reia misiunea X”: body.continuation). SELECTs only. A body that cannot be read
   * only loses the continuation detail (`checked: false`); the confirmation itself is still counted.
   */
  function confirmationFacts(confirmations, until) {
    const firstSeq = new Map();
    const continuationOf = new Map();
    if (!confirmations.length) return { firstSeq, continuationOf, checked: true };
    const ids = JSON.stringify([...new Set(confirmations.map((e) => e.scopeId))]);
    for (const r of db.prepare(`SELECT type, scope_id, MIN(seq) AS seq FROM events WHERE type IN (${PLAN_CONFIRMATION_EVENTS.map(() => "?").join(", ")}) AND seq <= ?
      AND scope_id IN (SELECT value FROM json_each(?)) GROUP BY type, scope_id`).all(...PLAN_CONFIRMATION_EVENTS, until, ids)) firstSeq.set(`${r.type}\u0000${r.scope_id}`, r.seq);
    const envelopeIds = [...new Set(confirmations.filter((e) => e.type === "envelope.confirmed").map((e) => e.scopeId))];
    let checked = true;
    if (envelopeIds.length) {
      try {
        for (const r of db.prepare(`SELECT id, CASE WHEN json_valid(body_json) THEN json_type(body_json, '$.continuation') END AS cont,
          CASE WHEN json_valid(body_json) THEN json_extract(body_json, '$.continuation.fromEnvelopeId') END AS from_id
          FROM mission_envelopes WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(envelopeIds))) {
          if (r.cont === "object") continuationOf.set(r.id, typeof r.from_id === "string" ? r.from_id : null);
        }
      } catch { checked = false; }
    }
    return { firstSeq, continuationOf, checked };
  }

  /**
   * R4 (UNKNOWN_INTENTS, exact): the owner.intent_outcome of each owner.intent in the window that announced one (`outcome: true`) →
   * Map(intent event id → outcome payload). Looked up after the intent (not bounded by the window's end: the outcome is written moments
   * after its sentence, and belongs to it). SELECT only.
   */
  function intentOutcomes(events) {
    const announced = events.filter((e) => e.type === "owner.intent" && e.payload.outcome === true);
    const out = new Map();
    if (!announced.length) return out;
    const ids = JSON.stringify([...new Set(announced.map((e) => e.id))]);
    for (const r of db.prepare(`SELECT payload_json FROM events WHERE type = 'owner.intent_outcome' AND seq > ?
      AND json_extract(payload_json, '$.intentEventId') IN (SELECT value FROM json_each(?)) ORDER BY seq`).all(announced[0].seq, ids)) {
      const p = parse(r.payload_json);
      if (typeof p.intentEventId === "string" && !out.has(p.intentEventId)) out.set(p.intentEventId, p);
    }
    return out;
  }

  /**
   * D1: the provider transcripts the Hub left unanswered that Lega's agent answered → Map(intent event id → { answerSeq, by }). A candidate
   * is an owner.intent from a provider transcript („voice-provider”) with unanswered unknown steps. Its link to the owner's lega.transcript
   * is the outcome's { legaSessionId, transcriptId }, else the owner.intent command row the event is correlated with (rows written before
   * the outcome carried the link, or an intake that failed before writing it). The answer is the first evidence that reached the owner from
   * THAT Lega session after the owner's transcript and within LEGA_ANSWER_WINDOW_MS: a delegated turn that spoke and started before his next
   * sentence (by "turn"), or the voice model's own non-empty speech before it (by "speech"); one answer closes at most one sentence. Like intentOutcomes, not bounded by the window's end (bounded by the time and the next sentence).
   * SELECT only; ids, roles and lengths, never words.
   */
  function legaAnswers(events, outcomes) {
    const out = new Map();
    const candidates = events.filter((e) => e.type === "owner.intent" && e.payload.source === "voice-provider" && unansweredUnknown(e.payload, outcomes.get(e.id) || null));
    if (!candidates.length) return out;
    const commandLink = db.prepare(`SELECT json_extract(payload_json, '$.legaSessionId') AS s, json_extract(payload_json, '$.transcriptId') AS t FROM commands
      WHERE id = ? AND type = 'owner.intent'`);
    const transcriptOf = db.prepare(`SELECT seq, created_at FROM events WHERE id = ? AND type = 'lega.transcript' AND scope_type = 'system' AND scope_id = ?
      AND json_extract(payload_json, '$.role') = 'user'`);
    const nextSentence = db.prepare(`SELECT MIN(seq) AS seq FROM events WHERE scope_type = 'system' AND scope_id = ? AND seq > ? AND type = 'lega.transcript'
      AND json_extract(payload_json, '$.role') = 'user'`);
    // D1 review: speech the owner heard from Lega herself — the voice model's own words (origin "realtime"; rows written before origins
    // existed carry none) — never a line the Hub spoke through the same channel (hub_bridge / hub_notice) nor an agent turn's answer (that
    // one is the turn's own lega.turn_completed below: one answer, one piece of evidence).
    const firstSpeech = db.prepare(`SELECT id, seq FROM events WHERE scope_type = 'system' AND scope_id = ? AND seq > ? AND seq < ? AND created_at <= ?
      AND type = 'lega.transcript' AND json_extract(payload_json, '$.role') = 'assistant'
        AND LENGTH(TRIM(COALESCE(json_extract(payload_json, '$.text'), ''))) > 0
        AND COALESCE(json_extract(payload_json, '$.origin'), 'realtime') = 'realtime' ORDER BY seq LIMIT 1`);
    // D1 review: a delegated turn that SPOKE (its answer, or its spoken failure line) and belongs to the sentence: it started after the owner's
    // transcript (startSeq ≥ its seq) — or one of its tool calls came after it — and before his next sentence. A bare tool call (the
    // agent's lega.hub_actions pre-check) followed by silence, an interrupted / empty / withheld turn or the owner's Stop never closes it.
    const firstTurn = db.prepare(`SELECT e.id, e.seq FROM events e WHERE e.scope_type = 'system' AND e.scope_id = ? AND e.type = 'lega.turn_completed' AND e.seq > ?
      AND e.created_at <= ? AND json_extract(e.payload_json, '$.spoke') = 1 AND COALESCE(json_extract(e.payload_json, '$.startSeq'), 0) < ?
      AND (COALESCE(json_extract(e.payload_json, '$.startSeq'), -1) >= ? OR EXISTS (SELECT 1 FROM events t WHERE t.scope_type = 'system' AND t.scope_id = e.scope_id
        AND t.type = 'lega.tool' AND t.seq > ? AND t.seq < ? AND json_extract(t.payload_json, '$.turnId') = json_extract(e.payload_json, '$.turnId')))
      ORDER BY e.seq LIMIT 1`);
    const claimed = new Set();
    for (const e of candidates) {
      const outcome = outcomes.get(e.id) || null;
      let link = typeof outcome?.legaSessionId === "string" && typeof outcome?.transcriptId === "string" ? { s: outcome.legaSessionId, t: outcome.transcriptId } : null;
      if (!link && e.correlationId) {
        const row = commandLink.get(e.correlationId);
        if (typeof row?.s === "string" && typeof row?.t === "string") link = { s: row.s, t: row.t };
      }
      if (!link) continue;
      const tr = transcriptOf.get(link.t, link.s);
      if (!tr || !(tr.seq < e.seq)) continue;
      const until = Date.parse(tr.created_at);
      if (!Number.isFinite(until)) continue;
      const next = nextSentence.get(link.s, tr.seq)?.seq ?? Number.MAX_SAFE_INTEGER;
      const windowEnd = new Date(until + LEGA_ANSWER_WINDOW_MS).toISOString();
      const speech = firstSpeech.get(link.s, tr.seq, next, windowEnd);
      const turn = firstTurn.get(link.s, tr.seq, windowEnd, next, tr.seq, tr.seq, next);
      const answer = speech && (!turn || speech.seq < turn.seq) ? { ...speech, by: "speech" } : turn ? { ...turn, by: "turn" } : null;
      if (!answer || claimed.has(answer.id)) continue;
      claimed.add(answer.id);
      out.set(e.id, { answerSeq: answer.seq, by: answer.by });
    }
    return out;
  }

  function report({ sinceSeq = 0, untilSeq = null } = {}) {
    const since = seqArg(sinceSeq, "sinceSeq") ?? 0;
    const newest = lastSeq();
    const until = Math.min(seqArg(untilSeq, "untilSeq") ?? newest, newest);
    if (until < since) throw new HubError("validation", "untilSeq trebuie să fie ≥ sinceSeq");
    const placeholders = COUNTED_EVENTS.map(() => "?").join(", ");
    const events = db.prepare(`SELECT seq, id, type, scope_id, source, payload_json, correlation_id FROM events WHERE seq > ? AND seq <= ? AND type IN (${placeholders}) ORDER BY seq`)
      .all(since, until, ...COUNTED_EVENTS).map((r) => ({ seq: r.seq, id: r.id, type: r.type, scopeId: String(r.scope_id || ""), source: String(r.source || ""), payload: parse(r.payload_json),
        correlationId: r.correlation_id || null }));
    const commands = db.prepare(`SELECT e.seq AS seq, c.id AS id, c.type AS type, c.actor AS actor, c.channel AS channel, c.status AS status, c.payload_json AS payload_json
      FROM events e JOIN commands c ON c.id = e.scope_id WHERE e.scope_type = 'command' AND e.type = 'command.accepted' AND e.seq > ? AND e.seq <= ? ORDER BY e.seq`)
      .all(since, until).map((r) => ({ seq: r.seq, id: r.id, type: r.type, actor: String(r.actor || ""), channel: r.channel, status: r.status, payload: parse(r.payload_json) }));

    const bucket = () => ({ count: 0, items: [] });
    const buckets = Object.fromEntries(PROBE_COUNTERS.map((k) => [k, bucket()]));
    // An alias IS its counter (one bucket): its count and evidence can never drift from the old key's.
    for (const [alias, target] of Object.entries(PROBE_ALIASES)) buckets[alias] = buckets[target];
    // Evidence holds ids already in the log and enum details (screen, target, channel, status) — never a payload's text.
    const add = (counter, item) => { const b = buckets[counter]; b.count += 1; if (b.items.length < EVIDENCE_MAX) b.items.push(item); };
    const ev = (e, detail = {}) => ({ kind: "event", id: e.id, seq: e.seq, type: e.type, ...detail });
    const cmd = (c, detail = {}) => ({ kind: "command", id: c.id, seq: c.seq, type: c.type, channel: c.channel, status: c.status, ...detail });
    const navScreen = (c) => (c.type === "owner.nav" && c.status === "executed" && NAV_SCREENS.includes(c.payload.screen) ? c.payload.screen : null);
    const pointedTarget = (e) => { const t = e.payload.target ?? e.payload.key; return typeof t === "string" ? t : null; };

    // R4: the owner's §7 counters, with the detail the owner reads next to each (enum keys and counts only).
    const facts = confirmationFacts(events.filter((e) => PLAN_CONFIRMATION_EVENTS.includes(e.type)), until);
    const outcomes = intentOutcomes(events);
    const answers = legaAnswers(events, outcomes);
    const breakdown = {
      extraScopeConfirmations: { delta: 0, reconfirm: 0, repeat: 0, continuation: 0, continuationChecked: facts.checked },
      voiceConfirmations: { envelope: 0, ops: 0 },
      voicePause: { owner: 0, other: 0 },
      voiceContinue: { heard: 0, byOutcome: {} },
      // R4-F8: byChannel for the owner's Stop Alls (the counted ones); byKind every stop in the window by its own kind; the Hub's shutdowns
      // with work in flight on their own line (never in STOP_ALL).
      stopAll: { byChannel: {}, byKind: {}, shutdowns: 0 },
      unknownIntents: { bySource: {}, estimated: 0 },
      // D1: provider transcripts the Hub left to Lega and Lega answered (an agent turn that spoke, or her own speech): not in UNKNOWN_INTENTS.
      unknownAnsweredByLega: { sentences: 0, turn: 0, speech: 0, items: [] },
      // M12 (D15): the owner's decisions per authority (counts only). local_dev_profile is never presented as the owner's presence.
      decisionsByAuthority: { ownerDecide: { webauthn: 0, local_dev_profile: 0, test: 0, other: 0 }, planConsent: { webauthn: 0, local_dev_profile: 0, other: 0 },
        note: "local_dev_profile = sesiune locală de dezvoltare (încredere în acest calculator), nu dovada prezenței proprietarului." },
    };
    const sessionAuthority = (id) => {
      if (!id) return "other";
      let row = null;
      try { row = db.prepare("SELECT credential_id FROM owner_sessions WHERE id = ?").get(String(id)); } catch { row = null; }
      return !row ? "other" : String(row.credential_id || "").startsWith(DEV_CREDENTIAL_PREFIX) ? "local_dev_profile" : "webauthn";
    };
    const authorityKey = (a) => (DECISION_AUTHORITIES.includes(a) ? a : "other");
    const extraConfirmation = (e, reason, detail = {}) => { add("extraScopeConfirmations", ev(e, { reason, ...detail })); breakdown.extraScopeConfirmations[reason] += 1; };
    const voicePause = (item, owner) => { add("voicePause", item); breakdown.voicePause[owner ? "owner" : "other"] += 1; };
    const ownerPauses = new Map(); // Lega session id → its lega.owner_pause events not yet matched with the pause they announced

    let firstOpenSkipped = null;
    for (const e of events) {
      // M12 (D15): decisions per authority, beside the existing counters (which they never change).
      if (e.type === "ops.plan.consent") breakdown.decisionsByAuthority.planConsent[authorityKey(sessionAuthority(e.payload.session))] += 1;
      if ((e.type === "approval.approved" || e.type === "approval.rejected") && !e.payload.envelopeId && Object.hasOwn(e.payload, "authority") && ["owner_session", "test"].includes(e.payload.via)) {
        const a = e.payload.via === "test" ? "test" : authorityKey(e.payload.authority);
        breakdown.decisionsByAuthority.ownerDecide[a] += 1;
        continue;
      }
      if (e.type === "approval.approved" || e.type === "approval.rejected") continue;
      if (e.type === "lega.pointed") {
        const target = pointedTarget(e);
        if (GRANT_FORM_TARGETS.has(target)) add("grantFormsOpened", ev(e, { target }));
        if (OLD_FLOW.has(target)) add("legaOldFlowPointers", ev(e, { target }));
      } else if (e.type === "lega.grant_prepared") add("grantFormsOpened", ev(e));
      else if (SCOPE_CONFIRMATION_EVENTS.has(e.type)) {
        add("scopeConfirmations", ev(e));
        // A plan is confirmed once; everything after that inside the same plan is extra: a confirmed difference (cycle / attempt), a
        // second confirmation of the same plan id, or a continuation plan for work an earlier plan already authorized.
        if (e.type === "envelope.delta_confirmed") extraConfirmation(e, "delta");
        else {
          const first = facts.firstSeq.get(`${e.type}\u0000${e.scopeId}`);
          if (first !== undefined && first < e.seq) extraConfirmation(e, "repeat");
          else if (e.type === "envelope.confirmed" && facts.continuationOf.has(e.scopeId)) extraConfirmation(e, "continuation", { from: facts.continuationOf.get(e.scopeId) });
          else add("planConfirmations", ev(e));
          // Spoken: the server-held utterance the plan service claimed and consumed (modality "voice"), never a provider transcript.
          if (VOICE_MODALITIES.has(e.payload.modality)) {
            add("voiceConfirmations", ev(e, { modality: e.payload.modality }));
            breakdown.voiceConfirmations[e.type === "ops.plan.consent" ? "ops" : "envelope"] += 1;
          }
        }
      }
      // The session delta of an operation plan (same credential, new owner session): a second confirmation inside the same plan.
      else if (e.type === "ops.plan.reconfirmed") extraConfirmation(e, "reconfirm");
      else if (e.type === "owner.intent") {
        if (e.payload.clarification === true) add("clarifications", ev(e));
        const unknown = unansweredUnknown(e.payload, outcomes.get(e.id) || null);
        const byLega = unknown ? answers.get(e.id) : null;
        if (byLega) {
          const b = breakdown.unknownAnsweredByLega;
          b.sentences += 1; b[byLega.by] += 1;
          if (b.items.length < EVIDENCE_MAX) b.items.push({ id: e.id, seq: e.seq, answerSeq: byLega.answerSeq, by: byLega.by });
        } else if (unknown) {
          add("unknownIntents", ev(e, unknown));
          tally(breakdown.unknownIntents.bySource, unknown.source);
          if (!unknown.exact) breakdown.unknownIntents.estimated += 1;
        }
      }
      else if (e.type === "intake.question") add("clarifications", ev(e));
      else if (e.type === "gate.rearmed") add("gateRearms", ev(e, { cls: typeof e.payload.cls === "string" ? e.payload.cls : null, modeReset: e.payload.modeReset === true }));
      else if (e.type === "lega.owner_pause") { const queue = ownerPauses.get(e.scopeId) || []; queue.push(e); ownerPauses.set(e.scopeId, queue); }
      else if (e.type === "owner.interrupt") {
        // A pause said by voice: the owner's own (announced just before by lega.owner_pause of the same Lega session, D13 / D19 — its
        // interrupt carries the actor voice:<Lega session>) or any other spoken pause (actor voice). One utterance counts once.
        if (e.payload.kind === "pause" && (e.source === "voice" || e.source.startsWith("voice:"))) {
          const marker = e.source.startsWith("voice:") ? ownerPauses.get(e.source.slice(6))?.shift() : null;
          voicePause(ev(e, { owner: Boolean(marker), via: "interrupt" }), Boolean(marker));
        }
      }
      else if (e.type === "owner.continue_voice") {
        // Every verified spoken „Continuă” is audited once with its outcome; only a resume counts (D18).
        const outcome = CONTINUE_OUTCOMES.has(e.payload.outcome) ? e.payload.outcome : "other";
        breakdown.voiceContinue.heard += 1;
        tally(breakdown.voiceContinue.byOutcome, outcome);
        if (CONTINUE_DONE.has(outcome)) add("voiceContinue", ev(e, { outcome }));
      }
      else if (e.type === "system.stop_all") {
        // R4-F8: STOP_ALL is the owner's „Oprește tot” only (its own kind); a shutdown or a security stop is listed, never counted there.
        const stopKind = stopKindOf(e);
        tally(breakdown.stopAll.byKind, stopKind);
        if (stopKind === "shutdown") breakdown.stopAll.shutdowns += 1;
        if (stopKind === "stop_all") {
          const channel = stopChannel(e);
          add("stopAll", ev(e, { channel, stopKind }));
          tally(breakdown.stopAll.byChannel, channel);
        }
      }
      else if (e.type === "owner.session_opened" || e.type === "owner.session_reauthenticated") {
        // The first session opened in the window is the one the probe needs anyway; every later open or step-up is extra.
        if (e.type === "owner.session_opened" && !firstOpenSkipped) { firstOpenSkipped = { id: e.id, seq: e.seq }; continue; }
        add("extraAuthentications", ev(e));
      }
    }
    // The owner's pause announced but with no interrupt recorded after it in the window (the pause itself failed late): still his.
    for (const queue of ownerPauses.values()) for (const e of queue) voicePause(ev(e, { owner: true, via: "owner_pause" }), true);
    for (const c of commands) {
      const screen = navScreen(c);
      // R4: the Integrations „Validare live” panel (mode, gate, grant form under „Avansat”) is a navigation to the advanced path, not
      // a grant form: the form is counted only when Lega prepared or pointed at it.
      if (screen === "integrations.live") add("navigationToAdvanced", cmd(c, { screen }));
      if (screen === "approvals") add("approvalsNavigations", cmd(c, { screen }));
      // A spoken pause that only suspended the gate (Lega's pause outside a session derived from the owner's, voice.command).
      if (c.type === "gate.set" && c.payload.action === "suspend" && c.channel === "voice" && c.status === "executed") voicePause(cmd(c, { owner: false, via: "gate" }), false);
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

    const counters = Object.fromEntries(PROBE_COUNTERS.map((k) => [k, buckets[k].count]));
    return {
      window: { sinceSeq: since, untilSeq: until, fromAt, toAt: eventAt(until), testMode: Boolean(config.testMode) },
      counters,
      evidence: Object.fromEntries(PROBE_COUNTERS.map((k) => [k, { items: buckets[k].items, truncated: buckets[k].count > buckets[k].items.length,
        ...(PROBE_ALIASES[k] ? { aliasOf: PROBE_ALIASES[k] } : {}) }])),
      extraAuthenticationsBaseline: firstOpenSkipped,
      settings: { tableHash: settingsCheck.tableHash, drift: settingsCheck.drift },
      // R4: the owner's §7 list under his exact names (the same numbers as `counters`), the detail behind some of them, the aliases.
      ownerList: Object.fromEntries(OWNER_PROBE_LIST.map(([name, key]) => [name, counters[key]])),
      breakdown,
      aliases: { ...PROBE_ALIASES },
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
