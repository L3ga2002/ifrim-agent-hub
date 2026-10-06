import crypto from "node:crypto";

/**
 * M10.2.1 (D17): the execution gate's suspension record — ONE pure leaf shared by every writer (Stop All, the gate.set suspension,
 * the owner's pause, the shutdown) and every reader (the cockpit, the readiness facts, the blocker explainer, the rearm service).
 * Before it, Stop All wrote no origin, so every suspension that was not a pause read as "stop_all" (a palette „Pauză” included) and
 * the two copies of the classifier could drift. No database and no clock here: callers pass the time and the session's credential.
 *
 * executionGate.suspendedBy = { kind, id, at, since, channel, actor, credential, sessionId, deviceId, ...kind-specific }
 *   kind        pause | suspend | shutdown | stop_all | security
 *   id          sus_<…>: the key a rearm card is bound to (a new suspension = a new key; a weaker one keeps the stronger record)
 *   at / since  when this record was written / when the suspension chain started (the earliest start is kept)
 *   credential  a 24-hex hash prefix of the owner credential behind the session that suspended (never the credential id)
 */
export const SUSPENSION_PRECEDENCE = Object.freeze({ pause: 1, suspend: 2, shutdown: 3, stop_all: 4, security: 5 });
export const SUSPENSION_KINDS = Object.freeze(Object.keys(SUSPENSION_PRECEDENCE));
/** Classes classifySuspension() returns (the suspension kinds, the pause split by owner, the gate open, the two record-less cases). */
export const SUSPENSION_CLASSES = Object.freeze(["open", "owner_pause", "pause_unowned", "stop_all", "suspend", "shutdown", "security", "first_start", "legacy_unknown"]);
/** Events that make a rearm a security decision (D16): listed on the card and acknowledged explicitly; never by voice. */
export const SECURITY_EVENT_TYPES = Object.freeze(["lega.session.violation", "lega.voice_gate_bypass", "owner.credential_revoked"]);
/** The security scan starts this long before the start of the suspension chain (a violation is the usual reason to press Stop). */
export const SECURITY_LOOKBACK_MS = 15 * 60000;

/** Romanian short labels per class (the owner's words: "oprită de Stop All", "după pauza ta"). */
export const SUSPENSION_LABELS = Object.freeze({
  open: "poarta deschisă",
  owner_pause: "pauza ta",
  pause_unowned: "o pauză fără sesiunea ta",
  stop_all: "Stop All",
  suspend: "o suspendare a porții",
  shutdown: "oprirea Hub-ului",
  security: "un eveniment de securitate",
  first_start: "prima pornire",
  legacy_unknown: "o oprire fără origine înregistrată",
});
/** „Poarta e oprită …” per class: the cause in one phrase (cockpit, blockers, „Continuă” refusals). */
export const STOPPED_BY = Object.freeze({
  owner_pause: "prin pauza ta",
  pause_unowned: "printr-o pauză fără sesiunea ta de proprietar",
  stop_all: "de Stop All",
  suspend: "printr-o suspendare a porții",
  shutdown: "la oprirea Hub-ului",
  security: "după un eveniment de securitate",
  first_start: "de la prima pornire",
  legacy_unknown: "fără o origine înregistrată",
});
/** Where a suspension came from, in the owner's words (command channels; "system" = the Hub's own shutdown). */
export const CHANNEL_LABELS = Object.freeze({
  owner: "din cockpit (sesiunea ta)",
  ui: "din interfață",
  voice: "prin vocea Lega",
  companion: "de pe telefonul asociat",
  agent: "de un agent delegat",
  test: "test",
  system: "la oprirea Hub-ului",
  cli: "dintr-un script local",
  automation: "automat, de Hub",
  schedule: "dintr-o programare",
  recovery: "la repornirea Hub-ului",
});
/** The security events in the owner's words. */
export const SECURITY_EVENT_LABELS = Object.freeze({
  "lega.session.violation": "Lega a încercat o acțiune interzisă; sesiunea vocală a fost oprită",
  "lega.voice_gate_bypass": "O propoziție a ocolit filtrul vocal local; sesiunea vocală a fost oprită",
  "owner.credential_revoked": "Un autentificator al tău a fost revocat",
});

/**
 * The credential reference stored in the gate: sha256("gate-pause:" + credential id), 24 hex. Enough to compare two sessions of
 * the same authenticator, nothing to reuse. Same derivation as the owner's pause has used since M10.2 (records stay comparable).
 */
export function credentialTag(credentialId) {
  if (credentialId === null || credentialId === undefined || credentialId === "") return null;
  return crypto.createHash("sha256").update(`gate-pause:${credentialId}`).digest("hex").slice(0, 24);
}

/**
 * The origin fields of a command context: channel, actor, the credential reference (the caller resolves the session's credential id
 * from the database: a revoked or expired session gives none) and the paired device behind a `device:<id>` actor.
 */
export function originFields({ channel = null, actor = null, credentialId = null, sessionId = null } = {}) {
  const device = /^device:(.+)$/.exec(String(actor || ""));
  return { channel: channel ? String(channel).slice(0, 20) : null, actor: actor ? String(actor).slice(0, 120) : null, credential: credentialTag(credentialId),
    sessionId: sessionId ? String(sessionId).slice(0, 80) : null, deviceId: device ? device[1].slice(0, 80) : null };
}

const newSuspensionId = () => `sus_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
const rank = (kind) => SUSPENSION_PRECEDENCE[kind] || 0;
const ms = (iso) => { const t = Date.parse(String(iso || "")); return Number.isFinite(t) ? t : null; };
/** A recorded suspension of a known kind (old pause records without id included), or null. */
const recordOf = (gate) => (gate && gate.status !== "open" && gate.suspendedBy && typeof gate.suspendedBy === "object" && rank(gate.suspendedBy.kind) ? gate.suspendedBy : null);

/** When the current suspension chain started (null when the gate is open or the start is unknown, e.g. the first start). */
export function chainStart(gate) {
  if (!gate || gate.status === "open") return null;
  const by = recordOf(gate);
  return (by && (by.since || by.at)) || gate.changedAt || null;
}

/**
 * The suspendedBy to store for a new suspension of `kind` landing on `currentGate`, honouring the precedence
 * (security > stop_all > shutdown > suspend > pause):
 *  - the gate is open → a fresh record (since = at);
 *  - an equal or stronger suspension → a NEW record (new id: a rearm card shown for the old one no longer applies), since = the
 *    earliest start of the chain;
 *  - a weaker one → the stronger record is kept unchanged (the writer may still update the gate's reason text).
 * A suspended gate without a recorded origin (first start, a pre-M10.2.1 row) ranks below every kind.
 */
export function nextSuspension(currentGate, { kind, at, channel = null, actor = null, credential = null, sessionId = null, deviceId = null, extra = {} } = {}) {
  if (!rank(kind)) throw new Error(`Unknown suspension kind ${kind}`);
  if (!ms(at)) throw new Error("nextSuspension needs the time of the suspension");
  const suspended = Boolean(currentGate) && currentGate.status !== "open";
  const current = recordOf(currentGate);
  if (current && rank(kind) < rank(current.kind)) return current;
  const start = suspended ? chainStart(currentGate) : null;
  const since = start && ms(start) !== null && ms(start) < ms(at) ? start : at;
  const safeExtra = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  return { ...safeExtra, kind, id: newSuspensionId(), at, since, channel: channel || null, actor: actor || null, credential: credential || null,
    sessionId: sessionId || null, deviceId: deviceId || null };
}

/**
 * The ONE classifier (replaces the copies in cockpit.mjs and readiness-runner.mjs). Read from the recorded suspension, never from the
 * reason text: { cls, kind, id, at, since, channel, actor, credential, sessionId, deviceId }.
 *   owner_pause     a pause recorded with the owner's credential („Continuă” in a session of that credential reopens it)
 *   pause_unowned   a pause with no session behind it (a device, a provider transcript)
 *   stop_all | suspend | shutdown | security   the recorded kind
 *   first_start     the default value (never changed)
 *   legacy_unknown  suspended without a recorded origin (written before M10.2.1, or an unknown kind)
 */
export function classifySuspension(gate) {
  const empty = { kind: null, id: null, at: null, since: null, channel: null, actor: null, credential: null, sessionId: null, deviceId: null };
  if (!gate || gate.status === "open") return { cls: "open", ...empty };
  const by = recordOf(gate);
  if (!by) {
    const at = gate.changedAt || null;
    return { cls: at ? "legacy_unknown" : "first_start", ...empty, at, since: at, actor: gate.changedBy || null, channel: gate.changedBy === "system" ? "system" : null };
  }
  const cls = by.kind === "pause" ? (by.credential ? "owner_pause" : "pause_unowned") : by.kind;
  return { cls, kind: by.kind, id: by.id || null, at: by.at || gate.changedAt || null, since: by.since || by.at || gate.changedAt || null, channel: by.channel || null,
    actor: by.actor || gate.changedBy || null, credential: by.credential || null, sessionId: by.sessionId || null, deviceId: by.deviceId || null };
}

/**
 * The compare-and-set key of the current suspension: its id, or for a record without one (first start, a pre-M10.2.1 row, an old
 * pause) the exact (changedAt, changedBy, reason) triple. null when the gate is open.
 */
export function suspensionKey(gate) {
  if (!gate || gate.status === "open") return null;
  const by = gate.suspendedBy && typeof gate.suspendedBy === "object" ? gate.suspendedBy : null;
  if (by?.id) return String(by.id);
  return `legacy:${gate.changedAt || ""}|${gate.changedBy || ""}|${gate.reason || ""}`;
}
